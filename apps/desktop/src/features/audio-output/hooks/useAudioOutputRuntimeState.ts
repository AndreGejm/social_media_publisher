import { useCallback, useEffect, useRef, useState } from "react";

import { clampVolumeScalar } from "../../player/transportMath";
import type { AudioOutputTransportHandshake } from "../../player-transport/api";
import {
  type PlaybackContextState,
  type PlaybackOutputMode,
  type PlaybackOutputStatus,
  type UiAppError
} from "../../../services/tauri/tauriClient";
import { useTauriClient } from "../../../services/tauri/TauriClientProvider";
import { sanitizeUiErrorMessage } from "../../../shared/lib/ui-sanitize";

type AppNotice = { level: "info" | "success" | "warning"; message: string };

const DEFAULT_OUTPUT_MODE: PlaybackOutputMode = "shared";
const OUTPUT_STATUS_NOTE =
  "Eligibility reflects output-path conditions only; Skald decodes PCM in software and does not provide encoded bitstream passthrough.";

export function defaultPlaybackOutputStatus(
  mode: PlaybackOutputMode = DEFAULT_OUTPUT_MODE,
  reason = "Exclusive output mode is not active."
): PlaybackOutputStatus {
  return {
    requested_mode: mode,
    active_mode: "released",
    sample_rate_hz: null,
    bit_depth: null,
    bit_perfect_eligible: false,
    reasons: [reason, OUTPUT_STATUS_NOTE]
  };
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function arePlaybackOutputStatusesEqual(
  left: PlaybackOutputStatus,
  right: PlaybackOutputStatus
): boolean {
  return (
    left.requested_mode === right.requested_mode &&
    left.active_mode === right.active_mode &&
    left.sample_rate_hz === right.sample_rate_hz &&
    left.bit_depth === right.bit_depth &&
    left.bit_perfect_eligible === right.bit_perfect_eligible &&
    areStringArraysEqual(left.reasons, right.reasons)
  );
}

export type UseAudioOutputRuntimeStateArgs = {
  transport: AudioOutputTransportHandshake;
  nativeTransportEnabled: boolean;
  nativeTransportChecked: boolean;
  latestPlaybackContext: PlaybackContextState | null;
  onNotice: (notice: AppNotice) => void;
};

export type AudioOutputRuntimeState = {
  requestedOutputMode: PlaybackOutputMode;
  activeOutputMode: PlaybackOutputMode;
  playbackOutputStatus: PlaybackOutputStatus;
  outputModeSwitching: boolean;
  requestPlaybackOutputMode: (nextMode: PlaybackOutputMode) => void;
};

export function useAudioOutputRuntimeState(
  args: UseAudioOutputRuntimeStateArgs
): AudioOutputRuntimeState {
  const {
    getPlaybackContext,
    initExclusiveDevice,
    isUiAppError,
    setPlaybackQueue,
    setPlaybackVolume
  } = useTauriClient();

  const { transport, nativeTransportEnabled, nativeTransportChecked, latestPlaybackContext, onNotice } = args;

  const [requestedOutputMode, setRequestedOutputMode] =
    useState<PlaybackOutputMode>(DEFAULT_OUTPUT_MODE);
  const [activeOutputMode, setActiveOutputMode] =
    useState<PlaybackOutputMode>(DEFAULT_OUTPUT_MODE);
  const [playbackOutputStatus, setPlaybackOutputStatus] = useState<PlaybackOutputStatus>(() =>
    defaultPlaybackOutputStatus(DEFAULT_OUTPUT_MODE)
  );
  const [outputModeSwitching, setOutputModeSwitching] = useState(false);

  const hasBootstrappedOutputModeRef = useRef(false);
  const exclusiveWarningShownRef = useRef(false);

  const normalizeUiError = useCallback(
    (error: unknown): UiAppError => {
      if (isUiAppError(error)) return error;
      return {
        code: "UNEXPECTED_UI_ERROR",
        message: error instanceof Error ? error.message : "Unknown UI error"
      };
    },
    [isUiAppError]
  );

  const shouldUseLegacyAudioFallback = useCallback(
    (error: UiAppError) => error.code === "TAURI_UNAVAILABLE" || error.code === "UNKNOWN_COMMAND",
    []
  );

  const fallbackToBrowserShared = useCallback(
    (reason: string) => {
      transport.fallbackToBrowserShared(reason);
      setRequestedOutputMode("shared");
      setActiveOutputMode("shared");
      setPlaybackOutputStatus(defaultPlaybackOutputStatus("shared", reason));
    },
    [transport]
  );

  const applyPlaybackOutputStatusFromContext = useCallback(
    (context: PlaybackContextState, requestedModeOverride?: PlaybackOutputMode) => {
      const rawStatus = context.output_status;
      const requestedModeFromStatus = requestedModeOverride ?? requestedOutputMode;
      const activeModeFromStatus = rawStatus?.active_mode === "exclusive" ? "exclusive" : "shared";
      const reasons = Array.isArray(rawStatus?.reasons)
        ? rawStatus.reasons.filter((reason) => typeof reason === "string" && reason.trim().length > 0)
        : [];
      const outputStatus: PlaybackOutputStatus = {
        requested_mode: requestedModeFromStatus,
        active_mode: rawStatus?.active_mode === "released" ? "released" : activeModeFromStatus,
        sample_rate_hz:
          typeof rawStatus?.sample_rate_hz === "number" && Number.isFinite(rawStatus.sample_rate_hz)
            ? rawStatus.sample_rate_hz
            : null,
        bit_depth:
          typeof rawStatus?.bit_depth === "number" && Number.isFinite(rawStatus.bit_depth)
            ? rawStatus.bit_depth
            : null,
        bit_perfect_eligible: Boolean(rawStatus?.bit_perfect_eligible),
        reasons:
          reasons.length > 0
            ? reasons
            : [
                "Output status is unavailable for the current transport state.",
                OUTPUT_STATUS_NOTE
              ]
      };
      setActiveOutputMode((current) =>
        current === activeModeFromStatus ? current : activeModeFromStatus
      );
      setPlaybackOutputStatus((current) =>
        arePlaybackOutputStatusesEqual(current, outputStatus) ? current : outputStatus
      );
    },
    [requestedOutputMode]
  );

  useEffect(() => {
    if (!latestPlaybackContext) return;
    applyPlaybackOutputStatusFromContext(latestPlaybackContext);
  }, [applyPlaybackOutputStatusFromContext, latestPlaybackContext]);

  useEffect(() => {
    if (outputModeSwitching || !nativeTransportChecked || nativeTransportEnabled) return;
    setActiveOutputMode("shared");
    setPlaybackOutputStatus((current) => {
      if (
        current.requested_mode === "shared" &&
        current.active_mode === "released" &&
        current.reasons.some((reason) => reason.includes("Native output is not active"))
      ) {
        return current;
      }
      return defaultPlaybackOutputStatus(
        "shared",
        "Native output is not active. Playback is using browser-shared audio."
      );
    });
  }, [nativeTransportChecked, nativeTransportEnabled, outputModeSwitching]);

  const switchPlaybackOutputMode = useCallback(
    async (nextMode: PlaybackOutputMode, options?: { startup?: boolean }) => {
      if (outputModeSwitching) return false;

      if (nextMode === "exclusive" && !options?.startup && !exclusiveWarningShownRef.current) {
        exclusiveWarningShownRef.current = true;
        onNotice({
          level: "warning",
          message:
            "Exclusive mode can take ownership of the current Windows audio endpoint. Other apps on this device may lose audio while Skald is active."
        });
      }

      setOutputModeSwitching(true);
      setRequestedOutputMode(nextMode);

      const wasPlaying = transport.getIsPlaying();
      await transport.pauseForModeSwitch();

      const outputConfig = transport.getDesiredOutputConfig();
      const queueSnapshot = transport.getQueueSnapshot();
      const initMode = async (mode: PlaybackOutputMode) =>
        initExclusiveDevice(
          outputConfig.sampleRateHz,
          outputConfig.bitDepth,
          mode === "exclusive"
        );
      const syncNativePlaybackState = async () => {
        const scalar = clampVolumeScalar(transport.getNowPlayingVolumeScalar());
        await setPlaybackVolume(scalar);
        await setPlaybackQueue(queueSnapshot.paths);
      };

      try {
        const hardware = await initMode(nextMode);
        if (nextMode === "exclusive" && !hardware.is_exclusive_lock) {
          throw {
            code: "EXCLUSIVE_AUDIO_UNAVAILABLE",
            message: "Exclusive output request did not return an exclusive hardware lock."
          } satisfies UiAppError;
        }

        transport.setNativeTransportEnabled(true);
        setActiveOutputMode(nextMode);
        transport.setPlayerError(null);

        let transportSyncFailed = false;
        try {
          await syncNativePlaybackState();
        } catch (syncError) {
          transportSyncFailed = true;
          const message = sanitizeUiErrorMessage(
            syncError,
            "Output mode switched, but playback queue synchronization failed."
          );
          transport.setPlayerError(message);
        }

        if (wasPlaying && transportSyncFailed) {
          onNotice({
            level: "warning",
            message:
              "Output mode switched, but playback could not be safely resumed. Playback remains paused."
          });
        } else {
          const armed = await transport.rearmCurrentTrackForNativePlayback();
          if (wasPlaying && armed) {
            await transport.resumeNativePlayback();
          } else if (wasPlaying && !armed) {
            onNotice({
              level: "warning",
              message:
                "Playback mode switched, but the current track could not be deterministically re-armed. Playback remains paused."
            });
          }
        }

        try {
          const context = await getPlaybackContext();
          transport.applyPlaybackContext(context);
          applyPlaybackOutputStatusFromContext(context, nextMode);
        } catch {
          setPlaybackOutputStatus(defaultPlaybackOutputStatus(nextMode));
        }

        return true;
      } catch (error) {
        const appError = normalizeUiError(error);

        if (nextMode === "exclusive") {
          onNotice({
            level: "warning",
            message: "Exclusive mode could not be acquired. Skald will remain in shared mode."
          });
          try {
            await initMode("shared");
            transport.setNativeTransportEnabled(true);
            setRequestedOutputMode("shared");
            setActiveOutputMode("shared");
            transport.setPlayerError(null);
            try {
              await syncNativePlaybackState();
            } catch (syncError) {
              const message = sanitizeUiErrorMessage(
                syncError,
                "Shared mode initialized, but playback queue synchronization failed."
              );
              transport.setPlayerError(message);
            }
            try {
              const context = await getPlaybackContext();
              transport.applyPlaybackContext(context);
              applyPlaybackOutputStatusFromContext(context, "shared");
            } catch {
              setPlaybackOutputStatus(defaultPlaybackOutputStatus("shared"));
            }
            return false;
          } catch (fallbackError) {
            const message = sanitizeUiErrorMessage(
              fallbackError,
              "Exclusive mode failed and shared native mode could not be initialized."
            );
            fallbackToBrowserShared(
              "Native output could not be initialized. Falling back to browser-shared audio."
            );
            if (!shouldUseLegacyAudioFallback(normalizeUiError(fallbackError))) {
              transport.setPlayerError(message);
            }
            return false;
          }
        }

        fallbackToBrowserShared(
          "Native shared output could not be initialized. Falling back to browser-shared audio."
        );
        if (!shouldUseLegacyAudioFallback(appError)) {
          transport.setPlayerError(appError.message);
        }
        return false;
      } finally {
        transport.setNativeTransportChecked(true);
        setOutputModeSwitching(false);
      }
    },
    [
      applyPlaybackOutputStatusFromContext,
      fallbackToBrowserShared,
      getPlaybackContext,
      initExclusiveDevice,
      normalizeUiError,
      onNotice,
      outputModeSwitching,
      setPlaybackQueue,
      setPlaybackVolume,
      shouldUseLegacyAudioFallback,
      transport
    ]
  );

  useEffect(() => {
    if (hasBootstrappedOutputModeRef.current) return;
    hasBootstrappedOutputModeRef.current = true;
    void switchPlaybackOutputMode(DEFAULT_OUTPUT_MODE, { startup: true });
  }, [switchPlaybackOutputMode]);

  const requestPlaybackOutputMode = useCallback(
    (nextMode: PlaybackOutputMode) => {
      if (outputModeSwitching) return;
      if (nextMode === requestedOutputMode && nativeTransportChecked) {
        return;
      }
      void switchPlaybackOutputMode(nextMode);
    },
    [nativeTransportChecked, outputModeSwitching, requestedOutputMode, switchPlaybackOutputMode]
  );

  return {
    requestedOutputMode,
    activeOutputMode,
    playbackOutputStatus,
    outputModeSwitching,
    requestPlaybackOutputMode
  };
}

