import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  clampVolumeScalar,
  isPlaybackPositionUnchanged,
  normalizePlaybackPositionSeconds
} from "../../player/transportMath";
import { localFilePathToMediaUrl } from "../../../infrastructure/tauri/media-url";
import {
  type PlaybackContextState,
  type UiAppError
} from "../../../services/tauri/tauriClient";
import { useTauriClient } from "../../../services/tauri/TauriClientProvider";
import { sanitizeUiErrorMessage, sanitizeUiText } from "../../../shared/lib/ui-sanitize";
import type { AudioOutputTransportHandshake } from "../api/contracts";
import {
  type ExternalPlayerSource,
  type NowPlayingState,
  type ResolvedPlayerSource,
  type SetNowPlayingQueueVisibleOptions,
  type UsePlayerTransportStateArgs
} from "./playerTransportTypes";
import { useTransportPlaybackActions } from "./useTransportPlaybackActions";
import { useTransportQueueLifecycle } from "./useTransportQueueLifecycle";
import { useTransportPolling } from "./useTransportPolling";

const VOLUME_SYNC_THROTTLE_MS = 80;

export type {
  ExternalPlayerSource,
  NowPlayingState,
  UsePlayerTransportStateArgs
} from "./playerTransportTypes";

function areStringArraysEqual(left: string[] | undefined, right: string[] | undefined): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function arePlaybackOutputStatusesEqual(
  left: PlaybackContextState["output_status"],
  right: PlaybackContextState["output_status"]
): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return (
    left.requested_mode === right.requested_mode &&
    left.active_mode === right.active_mode &&
    left.sample_rate_hz === right.sample_rate_hz &&
    left.bit_depth === right.bit_depth &&
    left.bit_perfect_eligible === right.bit_perfect_eligible &&
    areStringArraysEqual(left.reasons, right.reasons)
  );
}

function arePlaybackContextsEqual(
  left: PlaybackContextState | null,
  right: PlaybackContextState
): boolean {
  if (!left) return false;
  return (
    left.volume_scalar === right.volume_scalar &&
    left.is_bit_perfect_bypassed === right.is_bit_perfect_bypassed &&
    left.active_queue_index === right.active_queue_index &&
    left.is_queue_ui_expanded === right.is_queue_ui_expanded &&
    left.queued_track_change_requests === right.queued_track_change_requests &&
    left.is_playing === right.is_playing &&
    left.position_seconds === right.position_seconds &&
    left.track_duration_seconds === right.track_duration_seconds &&
    arePlaybackOutputStatusesEqual(left.output_status, right.output_status)
  );
}

export function usePlayerTransportRuntimeState(args: UsePlayerTransportStateArgs) {
  const { queue, selectedTrackDetail, trackDetailsById, onNotice } = args;
  const {
    getPlaybackContext,
    getPlaybackDecodeError,
    isUiAppError,
    pushPlaybackTrackChangeRequest,
    seekPlaybackRatio,
    setPlaybackPlaying,
    setPlaybackQueue,
    setPlaybackVolume,
    togglePlaybackQueueVisibility
  } = useTauriClient();

  const [playerTrackId, setPlayerTrackId] = useState<string>("");
  const [playerExternalSource, setPlayerExternalSource] = useState<ExternalPlayerSource | null>(null);
  const [autoplayRequestSourceKey, setAutoplayRequestSourceKey] = useState<string | null>(null);
  const [playerTimeSec, setPlayerTimeSec] = useState(0);
  const [playerIsPlaying, setPlayerIsPlaying] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [nativeTransportEnabled, setNativeTransportEnabled] = useState(false);
  const [nativeTransportChecked, setNativeTransportChecked] = useState(false);
  const [latestPlaybackContext, setLatestPlaybackContext] = useState<PlaybackContextState | null>(null);
  const [nowPlayingState, setNowPlayingState] = useState<NowPlayingState>({
    volume_scalar: 1.0,
    is_queue_visible: false,
    is_volume_muted: false
  });

  const playerAudioRef = useRef<HTMLAudioElement>(null);
  const preMuteVolumeScalarRef = useRef(1.0);
  const nowPlayingStateRef = useRef(nowPlayingState);
  const playerIsPlayingRef = useRef(playerIsPlaying);

  const desiredSampleRateHzRef = useRef(44_100);
  const desiredBitDepthRef = useRef(16);
  const queueFilePathsRef = useRef<string[]>([]);
  const queueIndexRef = useRef(-1);
  const hasPlayerSourceRef = useRef(false);

  const volumeSyncThrottleActiveRef = useRef(false);
  const pendingVolumeScalarRef = useRef<number | null>(null);
  const volumeSyncTimerRef = useRef<number | null>(null);

  useEffect(() => {
    nowPlayingStateRef.current = nowPlayingState;
  }, [nowPlayingState]);

  useEffect(() => {
    playerIsPlayingRef.current = playerIsPlaying;
  }, [playerIsPlaying]);

  const applyPlaybackContextToNowPlayingState = useCallback((context: PlaybackContextState) => {
    const scalar = clampVolumeScalar(context.volume_scalar);
    if (scalar > 0) {
      preMuteVolumeScalarRef.current = scalar;
    }

    setNowPlayingState((current) => {
      const next: NowPlayingState = {
        volume_scalar: scalar,
        is_queue_visible: Boolean(context.is_queue_ui_expanded),
        is_volume_muted: scalar <= 0
      };

      if (
        current.volume_scalar === next.volume_scalar &&
        current.is_queue_visible === next.is_queue_visible &&
        current.is_volume_muted === next.is_volume_muted
      ) {
        return current;
      }
      return next;
    });
  }, []);

  const applyPlaybackContextSnapshot = useCallback(
    (context: PlaybackContextState) => {
      setLatestPlaybackContext((current) =>
        arePlaybackContextsEqual(current, context) ? current : context
      );
      applyPlaybackContextToNowPlayingState(context);

      const nextIsPlaying = Boolean(context.is_playing);
      setPlayerIsPlaying((current) => (current === nextIsPlaying ? current : nextIsPlaying));

      if (typeof context.position_seconds === "number" && Number.isFinite(context.position_seconds)) {
        const nextPositionSec = normalizePlaybackPositionSeconds(context.position_seconds);
        setPlayerTimeSec((current) =>
          isPlaybackPositionUnchanged(current, nextPositionSec) ? current : nextPositionSec
        );
      }
    },
    [applyPlaybackContextToNowPlayingState]
  );

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

  const fallbackToBrowserShared = useCallback((reason: string) => {
    void reason;
    setNativeTransportEnabled(false);
    setNativeTransportChecked(true);
    setLatestPlaybackContext(null);
    setPlayerIsPlaying(false);
    setPlayerError(null);
  }, []);

  const sendVolumeToNativeTransport = useCallback(
    async (scalar: number) => {
      try {
        await setPlaybackVolume(scalar);
      } catch (error) {
        const message = sanitizeUiErrorMessage(error, "Unable to update playback volume.");
        setPlayerError(message);
      }
    },
    [setPlaybackVolume]
  );

  const scheduleNativeVolumeSync = useCallback(
    (scalar: number) => {
      if (!nativeTransportEnabled) return;

      if (!volumeSyncThrottleActiveRef.current) {
        volumeSyncThrottleActiveRef.current = true;
        void sendVolumeToNativeTransport(scalar);
        volumeSyncTimerRef.current = window.setTimeout(() => {
          volumeSyncThrottleActiveRef.current = false;
          const pending = pendingVolumeScalarRef.current;
          pendingVolumeScalarRef.current = null;
          if (pending != null) {
            scheduleNativeVolumeSync(pending);
          }
        }, VOLUME_SYNC_THROTTLE_MS);
        return;
      }

      pendingVolumeScalarRef.current = scalar;
    },
    [nativeTransportEnabled, sendVolumeToNativeTransport]
  );

  const setNowPlayingVolumeScalar = useCallback(
    (nextScalar: number) => {
      const scalar = clampVolumeScalar(nextScalar);
      setNowPlayingState((current) => ({
        volume_scalar: scalar,
        is_queue_visible: current.is_queue_visible,
        is_volume_muted: scalar <= 0
      }));

      if (scalar > 0) {
        preMuteVolumeScalarRef.current = scalar;
      }

      if (nativeTransportEnabled) {
        scheduleNativeVolumeSync(scalar);
        return;
      }

      const audio = playerAudioRef.current;
      if (audio) {
        audio.volume = scalar;
      }
    },
    [nativeTransportEnabled, scheduleNativeVolumeSync]
  );

  const setNowPlayingQueueVisible = useCallback(
    async (nextVisible: boolean, options?: SetNowPlayingQueueVisibleOptions) => {
      const currentVisible = nowPlayingStateRef.current.is_queue_visible;
      if (nextVisible === currentVisible) {
        return currentVisible;
      }

      if (!nativeTransportEnabled) {
        setNowPlayingState((current) => ({
          ...current,
          is_queue_visible: nextVisible
        }));
        return nextVisible;
      }

      try {
        await togglePlaybackQueueVisibility();
        const context = await getPlaybackContext();
        applyPlaybackContextSnapshot(context);
        return Boolean(context.is_queue_ui_expanded);
      } catch (error) {
        if (!options?.suppressError) {
          const message = sanitizeUiErrorMessage(error, "Unable to toggle queue visibility.");
          setPlayerError(message);
        }
        return currentVisible;
      }
    },
    [applyPlaybackContextSnapshot, getPlaybackContext, nativeTransportEnabled, togglePlaybackQueueVisibility]
  );

  const toggleNowPlayingQueueVisibility = useCallback(() => {
    return setNowPlayingQueueVisible(!nowPlayingStateRef.current.is_queue_visible);
  }, [setNowPlayingQueueVisible]);

  const toggleNowPlayingMute = useCallback(() => {
    if (nowPlayingStateRef.current.is_volume_muted) {
      const restoreScalar = preMuteVolumeScalarRef.current > 0 ? preMuteVolumeScalarRef.current : 1.0;
      setNowPlayingVolumeScalar(restoreScalar);
      return;
    }

    if (nowPlayingStateRef.current.volume_scalar > 0) {
      preMuteVolumeScalarRef.current = nowPlayingStateRef.current.volume_scalar;
    }
    setNowPlayingVolumeScalar(0);
  }, [setNowPlayingVolumeScalar]);

  useEffect(
    () => () => {
      if (volumeSyncTimerRef.current != null) {
        window.clearTimeout(volumeSyncTimerRef.current);
        volumeSyncTimerRef.current = null;
        volumeSyncThrottleActiveRef.current = false;
        pendingVolumeScalarRef.current = null;
      }
    },
    [nativeTransportEnabled]
  );

  const playerTrackDetail = useMemo(() => {
    if (!playerTrackId) return null;
    if (selectedTrackDetail?.track_id === playerTrackId) return selectedTrackDetail;
    return trackDetailsById[playerTrackId] ?? null;
  }, [playerTrackId, selectedTrackDetail, trackDetailsById]);

  const playerQueueItem = useMemo(
    () => queue.find((item) => item.track_id === playerTrackId) ?? null,
    [queue, playerTrackId]
  );

  const playerSource = useMemo<ResolvedPlayerSource | null>(() => {
    if (playerExternalSource) {
      return {
        key: sanitizeUiText(playerExternalSource.key, 256),
        filePath: sanitizeUiText(playerExternalSource.filePath, 4096),
        title: sanitizeUiText(playerExternalSource.title, 256),
        artist: sanitizeUiText(playerExternalSource.artist, 256),
        durationMs: playerExternalSource.durationMs
      };
    }
    if (playerTrackDetail) {
      return {
        key: `catalog:${playerTrackDetail.track_id}`,
        filePath: playerTrackDetail.file_path,
        title: sanitizeUiText(playerTrackDetail.title, 256),
        artist: sanitizeUiText(playerTrackDetail.artist_name, 256),
        durationMs: playerTrackDetail.track.duration_ms
      };
    }
    if (!playerQueueItem) return null;
    return {
      key: `catalog:${playerQueueItem.track_id}`,
      filePath: playerQueueItem.file_path,
      title: sanitizeUiText(playerQueueItem.title, 256),
      artist: sanitizeUiText(playerQueueItem.artist_name, 256),
      durationMs: playerQueueItem.duration_ms
    };
  }, [playerExternalSource, playerQueueItem, playerTrackDetail]);

  const playerAudioSrc = playerSource ? localFilePathToMediaUrl(playerSource.filePath) : undefined;
  const queueIndex = useMemo(
    () => queue.findIndex((item) => item.track_id === playerTrackId),
    [queue, playerTrackId]
  );

  const desiredSampleRateHz =
    playerTrackDetail?.sample_rate_hz ?? selectedTrackDetail?.sample_rate_hz ?? 44_100;
  const desiredBitDepth = 16;
  const queueFilePaths = useMemo(() => queue.map((item) => item.file_path), [queue]);

  desiredSampleRateHzRef.current = desiredSampleRateHz;
  desiredBitDepthRef.current = desiredBitDepth;
  queueFilePathsRef.current = queueFilePaths;
  queueIndexRef.current = queueIndex;
  hasPlayerSourceRef.current = Boolean(playerSource);

  useTransportQueueLifecycle({
    nativeTransportEnabled,
    queueFilePaths,
    setPlaybackQueue,
    setPlayerError,
    playerSource,
    setPlayerTimeSec,
    setPlayerIsPlaying,
    setPlaybackPlaying,
    playerAudioRef,
    playerTrackId,
    autoplayRequestSourceKey,
    queueIndex,
    pushPlaybackTrackChangeRequest,
    onNotice,
    playerAudioSrc,
    setAutoplayRequestSourceKey
  });

  const handlePollingPlaybackContext = useCallback((context: PlaybackContextState) => {
    setLatestPlaybackContext((current) =>
      arePlaybackContextsEqual(current, context) ? current : context
    );
  }, []);

  useTransportPolling({
    nativeTransportEnabled,
    applyPlaybackContextToNowPlayingState,
    onPlaybackContext: handlePollingPlaybackContext,
    getPlaybackContext,
    getPlaybackDecodeError,
    setPlayerIsPlaying,
    setPlayerTimeSec,
    setPlayerError,
    normalizeUiError,
    shouldUseLegacyAudioFallback,
    onNativeTransportUnavailable: fallbackToBrowserShared
  });

  const {
    ensureExternalPlayerSource,
    seekPlayer,
    setNativePlaybackPlaying,
    publisherOpsSharedTransportBridge
  } = useTransportPlaybackActions({
    playerSource,
    playerTimeSec,
    playerIsPlaying,
    nativeTransportEnabled,
    playerAudioRef,
    setPlayerExternalSource,
    setPlayerTrackId,
    setPlayerError,
    setAutoplayRequestSourceKey,
    seekPlaybackRatio,
    setPlayerTimeSec,
    setPlaybackPlaying,
    setPlayerIsPlaying
  });

  const pauseForModeSwitch = useCallback(async () => {
    if (nativeTransportEnabled) {
      try {
        await setPlaybackPlaying(false);
      } catch {
        // Continue: output-mode reinitialization can still attempt recovery.
      }
    }

    const audio = playerAudioRef.current;
    if (audio) {
      try {
        audio.pause();
      } catch {
        // Ignore media runtime pause errors and continue with mode switch.
      }
    }

    setPlayerIsPlaying(false);
  }, [nativeTransportEnabled, setPlaybackPlaying]);

  const rearmCurrentTrackForNativePlayback = useCallback(async () => {
    if (!hasPlayerSourceRef.current || queueIndexRef.current < 0) return false;
    const accepted = await pushPlaybackTrackChangeRequest(queueIndexRef.current);
    if (!accepted) return false;
    await setPlaybackPlaying(false);
    return true;
  }, [pushPlaybackTrackChangeRequest, setPlaybackPlaying]);

  const resumeNativePlayback = useCallback(async () => {
    await setPlaybackPlaying(true);
    setPlayerIsPlaying(true);
  }, [setPlaybackPlaying]);

  const audioOutputTransportHandshake = useMemo<AudioOutputTransportHandshake>(
    () => ({
      getDesiredOutputConfig: () => ({
        sampleRateHz: desiredSampleRateHzRef.current,
        bitDepth: desiredBitDepthRef.current
      }),
      getQueueSnapshot: () => ({
        paths: [...queueFilePathsRef.current],
        activeIndex: queueIndexRef.current,
        hasPlayerSource: hasPlayerSourceRef.current
      }),
      getNowPlayingVolumeScalar: () => nowPlayingStateRef.current.volume_scalar,
      getIsPlaying: () => playerIsPlayingRef.current,
      pauseForModeSwitch,
      rearmCurrentTrackForNativePlayback,
      resumeNativePlayback,
      applyPlaybackContext: applyPlaybackContextSnapshot,
      setNativeTransportEnabled,
      setNativeTransportChecked,
      fallbackToBrowserShared,
      setPlayerError
    }),
    [
      applyPlaybackContextSnapshot,
      fallbackToBrowserShared,
      pauseForModeSwitch,
      rearmCurrentTrackForNativePlayback,
      resumeNativePlayback
    ]
  );

  return {
    playerTrackId,
    setPlayerTrackId,
    playerExternalSource,
    setPlayerExternalSource,
    autoplayRequestSourceKey,
    setAutoplayRequestSourceKey,
    playerTimeSec,
    setPlayerTimeSec,
    playerIsPlaying,
    setPlayerIsPlaying,
    playerError,
    setPlayerError,
    nativeTransportEnabled,
    nativeTransportChecked,
    latestPlaybackContext,
    audioOutputTransportHandshake,
    nowPlayingState,
    setNowPlayingVolumeScalar,
    setNowPlayingQueueVisible,
    toggleNowPlayingQueueVisibility,
    toggleNowPlayingMute,
    playerAudioRef,
    playerTrackDetail,
    playerSource,
    playerAudioSrc,
    queueIndex,
    ensureExternalPlayerSource,
    seekPlayer,
    setNativePlaybackPlaying,
    publisherOpsSharedTransportBridge
  };
}





