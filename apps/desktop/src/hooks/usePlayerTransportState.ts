import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SharedTransportBridgeForPublisherOps } from "../App";
import {
  clampVolumeScalar,
  isPlaybackPositionUnchanged,
  normalizePlaybackPositionSeconds
} from "../features/player/transportMath";
import { localFilePathToMediaUrl } from "../media-url";
import {
  getPlaybackContext,
  getPlaybackDecodeError,
  initExclusiveDevice,
  pushPlaybackTrackChangeRequest,
  seekPlaybackRatio,
  setPlaybackPlaying,
  setPlaybackQueue,
  setPlaybackVolume,
  togglePlaybackQueueVisibility,
  type CatalogListTracksResponse,
  type CatalogTrackDetailResponse,
  type PlaybackContextState,
  type UiAppError
} from "../services/tauriClient";
import { sanitizeUiErrorMessage, sanitizeUiText } from "../ui-sanitize";

type AppNotice = { level: "info" | "success" | "warning"; message: string };
const VOLUME_SYNC_THROTTLE_MS = 80;

export type ExternalPlayerSource = {
  key: string;
  filePath: string;
  title: string;
  artist: string;
  durationMs: number;
};

type ResolvedPlayerSource = {
  key: string;
  filePath: string;
  title: string;
  artist: string;
  durationMs: number;
};

export type NowPlayingState = {
  volume_scalar: number;
  is_queue_visible: boolean;
  is_volume_muted: boolean;
};

type SetNowPlayingQueueVisibleOptions = {
  suppressError?: boolean;
};

type UsePlayerTransportStateArgs = {
  queue: CatalogListTracksResponse["items"];
  selectedTrackDetail: CatalogTrackDetailResponse | null;
  trackDetailsById: Record<string, CatalogTrackDetailResponse>;
  onNotice: (notice: AppNotice) => void;
};

export function usePlayerTransportState(args: UsePlayerTransportStateArgs) {
  const { queue, selectedTrackDetail, trackDetailsById, onNotice } = args;
  const [playerTrackId, setPlayerTrackId] = useState<string>("");
  const [playerExternalSource, setPlayerExternalSource] = useState<ExternalPlayerSource | null>(null);
  const [autoplayRequestSourceKey, setAutoplayRequestSourceKey] = useState<string | null>(null);
  const [playerTimeSec, setPlayerTimeSec] = useState(0);
  const [playerIsPlaying, setPlayerIsPlaying] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [nativeTransportEnabled, setNativeTransportEnabled] = useState(false);
  const [nativeTransportChecked, setNativeTransportChecked] = useState(false);
  const [nowPlayingState, setNowPlayingState] = useState<NowPlayingState>({
    volume_scalar: 1.0,
    is_queue_visible: false,
    is_volume_muted: false
  });
  const playerAudioRef = useRef<HTMLAudioElement>(null);
  const preMuteVolumeScalarRef = useRef(1.0);
  const nowPlayingStateRef = useRef(nowPlayingState);
  const volumeSyncThrottleActiveRef = useRef(false);
  const pendingVolumeScalarRef = useRef<number | null>(null);
  const volumeSyncTimerRef = useRef<number | null>(null);

  const publisherOpsTransportStateRef = useRef<SharedTransportBridgeForPublisherOps["state"]>({
    sourceKey: null,
    currentTimeSec: 0,
    isPlaying: false
  });

  useEffect(() => {
    nowPlayingStateRef.current = nowPlayingState;
  }, [nowPlayingState]);

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

  const sendVolumeToNativeTransport = useCallback(
    async (scalar: number) => {
      try {
        await setPlaybackVolume(scalar);
      } catch (error) {
        const message = sanitizeUiErrorMessage(error, "Unable to update playback volume.");
        setPlayerError(message);
      }
    },
    [setPlayerError]
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
        applyPlaybackContextToNowPlayingState(context);
        return Boolean(context.is_queue_ui_expanded);
      } catch (error) {
        if (!options?.suppressError) {
          const message = sanitizeUiErrorMessage(error, "Unable to toggle queue visibility.");
          setPlayerError(message);
        }
        return currentVisible;
      }
    },
    [applyPlaybackContextToNowPlayingState, nativeTransportEnabled]
  );

  const toggleNowPlayingQueueVisibility = useCallback(() => {
    return setNowPlayingQueueVisible(!nowPlayingStateRef.current.is_queue_visible);
  }, [setNowPlayingQueueVisible]);

  const toggleNowPlayingMute = useCallback(() => {
    if (nowPlayingStateRef.current.is_volume_muted) {
      const restoreScalar =
        preMuteVolumeScalarRef.current > 0 ? preMuteVolumeScalarRef.current : 1.0;
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
      }
    },
    []
  );

  const playerTrackDetail = useMemo(() => {
    if (!playerTrackId) return null;
    if (selectedTrackDetail?.track_id === playerTrackId) return selectedTrackDetail;
    return trackDetailsById[playerTrackId] ?? null;
  }, [playerTrackId, selectedTrackDetail, trackDetailsById]);

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
    if (!playerTrackDetail) return null;
    return {
      key: `catalog:${playerTrackDetail.track_id}`,
      filePath: playerTrackDetail.file_path,
      title: sanitizeUiText(playerTrackDetail.title, 256),
      artist: sanitizeUiText(playerTrackDetail.artist_name, 256),
      durationMs: playerTrackDetail.track.duration_ms
    };
  }, [playerExternalSource, playerTrackDetail]);

  const playerAudioSrc = playerSource ? localFilePathToMediaUrl(playerSource.filePath) : undefined;
  const queueIndex = useMemo(
    () => queue.findIndex((item) => item.track_id === playerTrackId),
    [queue, playerTrackId]
  );
  const desiredSampleRateHz =
    playerTrackDetail?.sample_rate_hz ?? selectedTrackDetail?.sample_rate_hz ?? 44_100;
  const desiredBitDepth = 16;
  const queueFilePaths = useMemo(() => queue.map((item) => item.file_path), [queue]);

  const normalizeUiError = (error: unknown): UiAppError => {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      "message" in error &&
      typeof (error as { code?: unknown }).code === "string" &&
      typeof (error as { message?: unknown }).message === "string"
    ) {
      return error as UiAppError;
    }
    return {
      code: "UNEXPECTED_UI_ERROR",
      message: error instanceof Error ? error.message : "Unknown UI error"
    };
  };

  const shouldUseLegacyAudioFallback = (error: UiAppError) =>
    error.code === "TAURI_UNAVAILABLE" || error.code === "UNKNOWN_COMMAND";

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        await initExclusiveDevice(desiredSampleRateHz, desiredBitDepth);
        const scalar = clampVolumeScalar(nowPlayingStateRef.current.volume_scalar);
        await setPlaybackVolume(scalar);
        if (cancelled) return;
        setNativeTransportEnabled(true);
        setPlayerError(null);
      } catch (error) {
        if (cancelled) return;
        const appError = normalizeUiError(error);
        setNativeTransportEnabled(false);
        if (!shouldUseLegacyAudioFallback(appError)) {
          setPlayerError(appError.message);
        }
      } finally {
        if (!cancelled) {
          setNativeTransportChecked(true);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [desiredBitDepth, desiredSampleRateHz]);

  useEffect(() => {
    if (nativeTransportEnabled) return;
    const audio = playerAudioRef.current;
    if (!audio) return;
    audio.volume = clampVolumeScalar(nowPlayingState.volume_scalar);
  }, [nativeTransportEnabled, nowPlayingState.volume_scalar, playerAudioSrc]);

  useEffect(() => {
    if (!nativeTransportEnabled) return;
    let cancelled = false;
    const run = async () => {
      try {
        await setPlaybackQueue(queueFilePaths);
      } catch (error) {
        if (cancelled) return;
        const message = sanitizeUiErrorMessage(
          error,
          "Unable to synchronize playback queue with native transport."
        );
        setPlayerError(message);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [nativeTransportEnabled, queueFilePaths]);

  useEffect(() => {
    if (!playerSource) return;
    if (nativeTransportEnabled) {
      setPlayerTimeSec((current) => (current === 0 ? current : 0));
      setPlayerIsPlaying((current) => (current ? false : current));
      void setPlaybackPlaying(false).catch(() => {
        // Native transport may become unavailable; polling loop handles fallback/error state.
      });
      return;
    }
    const audio = playerAudioRef.current;
    if (!audio) return;
    try {
      audio.load();
    } catch (error) {
      const message = sanitizeUiErrorMessage(error, "Unable to load audio source.");
      setPlayerError(message);
    }
    try {
      audio.currentTime = 0;
    } catch {
      // unsupported media runtime
    }
    setPlayerTimeSec((current) => (current === 0 ? current : 0));
    setPlayerIsPlaying((current) => (current ? false : current));
  }, [nativeTransportEnabled, playerSource]);

  useEffect(() => {
    if (!nativeTransportEnabled) return;
    if (!playerSource || !playerTrackId) return;
    if (autoplayRequestSourceKey) return;
    if (queueIndex < 0) return;

    let cancelled = false;
    const run = async () => {
      try {
        await setPlaybackQueue(queueFilePaths);
        await pushPlaybackTrackChangeRequest(queueIndex);
        await setPlaybackPlaying(false);
      } catch (error) {
        if (cancelled) return;
        const message = sanitizeUiErrorMessage(
          error,
          "Unable to arm track in native playback transport."
        );
        setPlayerError(message);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    autoplayRequestSourceKey,
    nativeTransportEnabled,
    playerSource,
    playerTrackId,
    queueFilePaths,
    queueIndex
  ]);

  useEffect(() => {
    if (!autoplayRequestSourceKey) return;
    if (!playerSource || autoplayRequestSourceKey !== playerSource.key) return;
    const run = async () => {
      try {
        if (nativeTransportEnabled) {
          if (queueIndex < 0) {
            throw {
              code: "PLAYBACK_QUEUE_REQUEST_REJECTED",
              message: "Selected track is not available in the active queue."
            } satisfies UiAppError;
          }
          await setPlaybackQueue(queueFilePaths);
          const accepted = await pushPlaybackTrackChangeRequest(queueIndex);
          if (!accepted) {
            throw {
              code: "PLAYBACK_QUEUE_REQUEST_REJECTED",
              message: "Native transport rejected the track-change request."
            } satisfies UiAppError;
          }
          await setPlaybackPlaying(true);
          setPlayerIsPlaying(true);
        } else {
          if (!playerAudioSrc) return;
          const audio = playerAudioRef.current;
          if (!audio) return;
          const maybePromise = audio.play();
          if (maybePromise && typeof maybePromise.then === "function") {
            await maybePromise;
          }
        }
        setPlayerError(null);
        onNotice({ level: "success", message: "Playback started." });
      } catch (error) {
        const message = sanitizeUiErrorMessage(error, "Unable to start playback for this file.");
        setPlayerError(message);
        onNotice({ level: "warning", message: "Playback failed to start. Check file format support or file access." });
      } finally {
        setAutoplayRequestSourceKey((current) => (current === playerSource.key ? null : current));
      }
    };
    void run();
  }, [
    autoplayRequestSourceKey,
    nativeTransportEnabled,
    onNotice,
    playerAudioSrc,
    playerSource,
    queueFilePaths,
    queueIndex
  ]);

  useEffect(() => {
    if (!nativeTransportEnabled) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const context = await getPlaybackContext();
        if (cancelled) return;
        applyPlaybackContextToNowPlayingState(context);
        const nextIsPlaying = Boolean(context.is_playing);
        setPlayerIsPlaying((current) => (current === nextIsPlaying ? current : nextIsPlaying));
        if (typeof context.position_seconds === "number" && Number.isFinite(context.position_seconds)) {
          const nextPositionSec = normalizePlaybackPositionSeconds(context.position_seconds);
          setPlayerTimeSec((current) =>
            isPlaybackPositionUnchanged(current, nextPositionSec) ? current : nextPositionSec
          );
        }
        const decodeError = await getPlaybackDecodeError();
        if (cancelled) return;
        if (decodeError && decodeError.trim().length > 0) {
          setPlayerError(sanitizeUiText(decodeError, 512));
        }
      } catch (error) {
        if (cancelled) return;
        const appError = normalizeUiError(error);
        if (shouldUseLegacyAudioFallback(appError)) {
          setNativeTransportEnabled(false);
          return;
        }
        setPlayerError(appError.message);
      }
    };

    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 250);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [applyPlaybackContextToNowPlayingState, nativeTransportEnabled]);

  const ensureExternalPlayerSource = useCallback(
    (source: ExternalPlayerSource, options?: { autoplay?: boolean }) => {
      const { autoplay = false } = options ?? {};
      setPlayerExternalSource((current) => {
        if (
          current &&
          current.key === source.key &&
          current.filePath === source.filePath &&
          current.title === source.title &&
          current.artist === source.artist &&
          current.durationMs === source.durationMs
        ) {
          return current;
        }
        return source;
      });
      setPlayerTrackId("");
      setPlayerError(null);
      if (autoplay) {
        setAutoplayRequestSourceKey(source.key);
      }
    },
    []
  );

  const seekPlayer = useCallback(
    (ratio: number) => {
      const source = playerSource;
      if (!source) return;
      const clampedRatio = Math.max(0, Math.min(1, ratio));
      const durationSec = Math.max(source.durationMs / 1000, 0.001);
      const nextTime = Math.max(0, Math.min(durationSec, durationSec * clampedRatio));

      if (nativeTransportEnabled) {
        void seekPlaybackRatio(clampedRatio)
          .then(() => {
            setPlayerTimeSec(nextTime);
          })
          .catch((error) => {
            const message = sanitizeUiErrorMessage(error, "Unable to seek the current track.");
            setPlayerError(message);
          });
        return;
      }
      const audio = playerAudioRef.current;
      if (!audio) return;
      try {
        audio.currentTime = nextTime;
        setPlayerTimeSec(nextTime);
      } catch {
        setPlayerError("Unable to seek the current track.");
      }
    },
    [nativeTransportEnabled, playerSource]
  );

  const setNativePlaybackPlaying = useCallback(
    async (isPlaying: boolean) => {
      if (!nativeTransportEnabled) {
        const audio = playerAudioRef.current;
        if (!audio) {
          throw new Error("Legacy playback element is unavailable.");
        }
        if (isPlaying) {
          const maybePromise = audio.play();
          if (maybePromise && typeof maybePromise.then === "function") {
            await maybePromise;
          }
        } else {
          audio.pause();
        }
        setPlayerError(null);
        return;
      }
      await setPlaybackPlaying(isPlaying);
      setPlayerIsPlaying(isPlaying);
    },
    [nativeTransportEnabled, setPlayerError]
  );

  publisherOpsTransportStateRef.current = {
    sourceKey: playerSource?.key ?? null,
    currentTimeSec: playerTimeSec,
    isPlaying: playerIsPlaying
  };

  const publisherOpsSharedTransportBridge = useMemo<SharedTransportBridgeForPublisherOps>(
    () => ({
      get state() {
        return publisherOpsTransportStateRef.current;
      },
      ensureSource: (source, options) => {
        ensureExternalPlayerSource(
          {
            key: source.sourceKey,
            filePath: source.filePath,
            title: source.title,
            artist: source.artist,
            durationMs: source.durationMs
          },
          options
        );
      },
      seekToRatio: (sourceKey, ratio) => {
        if (!playerSource || playerSource.key !== sourceKey) return;
        seekPlayer(ratio);
      }
    }),
    [ensureExternalPlayerSource, playerSource, seekPlayer]
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
