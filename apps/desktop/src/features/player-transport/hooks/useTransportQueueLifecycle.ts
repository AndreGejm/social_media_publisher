import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";

import { sanitizeUiErrorMessage } from "../../../shared/lib/ui-sanitize";
import type { UiAppError } from "../../../services/tauri/tauriClient";
import type { AppNotice, ResolvedPlayerSource } from "./playerTransportTypes";

type UseTransportQueueLifecycleArgs = {
  nativeTransportEnabled: boolean;
  queueFilePaths: string[];
  setPlaybackQueue: (paths: string[]) => Promise<{ total_tracks: number }>;
  setPlayerError: Dispatch<SetStateAction<string | null>>;
  playerSource: ResolvedPlayerSource | null;
  setPlayerTimeSec: Dispatch<SetStateAction<number>>;
  setPlayerIsPlaying: Dispatch<SetStateAction<boolean>>;
  setPlaybackPlaying: (isPlaying: boolean) => Promise<void>;
  playerAudioRef: RefObject<HTMLAudioElement>;
  playerTrackId: string;
  autoplayRequestSourceKey: string | null;
  queueIndex: number;
  pushPlaybackTrackChangeRequest: (newIndex: number) => Promise<boolean>;
  onNotice: (notice: AppNotice) => void;
  playerAudioSrc: string | undefined;
  setAutoplayRequestSourceKey: Dispatch<SetStateAction<string | null>>;
};

export function useTransportQueueLifecycle(args: UseTransportQueueLifecycleArgs): void {
  const {
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
  } = args;
  const pendingNativeArmSourceKeyRef = useRef<string | null>(null);
  const lastHandledAutoplaySourceKeyRef = useRef<string | null>(null);
  const autoplayInFlightSourceKeyRef = useRef<string | null>(null);
  const autoplayRequestSourceKeyRef = useRef<string | null>(autoplayRequestSourceKey);
  const autoplayRunIdRef = useRef(0);
  const playerSourceKey = playerSource?.key ?? null;

  autoplayRequestSourceKeyRef.current = autoplayRequestSourceKey;

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
  }, [nativeTransportEnabled, queueFilePaths, setPlaybackQueue, setPlayerError]);

  useEffect(() => {
    if (!playerSourceKey) return;

    const shouldAutoplaySource = autoplayRequestSourceKeyRef.current === playerSourceKey;

    if (nativeTransportEnabled) {
      setPlayerTimeSec((current) => (current === 0 ? current : 0));
      if (!shouldAutoplaySource) {
        setPlayerIsPlaying((current) => (current ? false : current));
        void Promise.resolve(setPlaybackPlaying(false)).catch(() => {
          // Native transport may become unavailable; polling loop handles fallback/error state.
        });
      }
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
  }, [
    nativeTransportEnabled,
    playerAudioRef,
    playerAudioSrc,
    playerSourceKey,
    setPlaybackPlaying,
    setPlayerError,
    setPlayerIsPlaying,
    setPlayerTimeSec
  ]);

  useEffect(() => {
    if (!nativeTransportEnabled || !playerSourceKey || !playerTrackId || queueIndex < 0) {
      pendingNativeArmSourceKeyRef.current = null;
      if (!playerSourceKey) {
        lastHandledAutoplaySourceKeyRef.current = null;
      }
      return;
    }

    if (
      lastHandledAutoplaySourceKeyRef.current &&
      lastHandledAutoplaySourceKeyRef.current !== playerSourceKey
    ) {
      lastHandledAutoplaySourceKeyRef.current = null;
    }

    if (lastHandledAutoplaySourceKeyRef.current === playerSourceKey) {
      pendingNativeArmSourceKeyRef.current = null;
      return;
    }

    if (autoplayRequestSourceKeyRef.current) {
      pendingNativeArmSourceKeyRef.current = null;
      return;
    }

    pendingNativeArmSourceKeyRef.current = playerSourceKey;
  }, [nativeTransportEnabled, playerSourceKey, playerTrackId, queueIndex]);

  useEffect(() => {
    if (!nativeTransportEnabled) return;
    if (!playerSourceKey || !playerTrackId) return;
    if (queueIndex < 0) return;
    if (pendingNativeArmSourceKeyRef.current !== playerSourceKey) return;

    pendingNativeArmSourceKeyRef.current = null;

    let cancelled = false;
    const run = async () => {
      try {
        await setPlaybackQueue(queueFilePaths);
        await pushPlaybackTrackChangeRequest(queueIndex);
        await setPlaybackPlaying(false);
      } catch (error) {
        if (cancelled) return;
        const message = sanitizeUiErrorMessage(error, "Unable to arm track in native playback transport.");
        setPlayerError(message);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    nativeTransportEnabled,
    playerSourceKey,
    playerTrackId,
    pushPlaybackTrackChangeRequest,
    queueFilePaths,
    queueIndex,
    setPlaybackPlaying,
    setPlaybackQueue,
    setPlayerError
  ]);

  useEffect(() => {
    if (!autoplayRequestSourceKey) return;
    if (!playerSourceKey || autoplayRequestSourceKey !== playerSourceKey) return;
    if (autoplayInFlightSourceKeyRef.current === autoplayRequestSourceKey) return;

    autoplayInFlightSourceKeyRef.current = autoplayRequestSourceKey;
    autoplayRunIdRef.current += 1;
    const autoplayRunId = autoplayRunIdRef.current;
    const requestedSourceKey = autoplayRequestSourceKey;
    const resolvedSourceKey = playerSourceKey;
    let cancelled = false;

    const isCurrentRun = () => !cancelled && autoplayRunIdRef.current === autoplayRunId;

    const finalizeRun = () => {
      if (!isCurrentRun()) return;
      lastHandledAutoplaySourceKeyRef.current = resolvedSourceKey;
      autoplayInFlightSourceKeyRef.current = null;
      setAutoplayRequestSourceKey((current) =>
        current === resolvedSourceKey ? null : current
      );
    };

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
          if (!isCurrentRun()) return;

          const accepted = await pushPlaybackTrackChangeRequest(queueIndex);
          if (!isCurrentRun()) return;
          if (!accepted) {
            throw {
              code: "PLAYBACK_QUEUE_REQUEST_REJECTED",
              message: "Native transport rejected the track-change request."
            } satisfies UiAppError;
          }

          await setPlaybackPlaying(true);
          if (!isCurrentRun()) return;
          setPlayerIsPlaying(true);
        } else {
          if (!playerAudioSrc) return;
          const audio = playerAudioRef.current;
          if (!audio) return;
          const maybePromise = audio.play();
          if (maybePromise && typeof maybePromise.then === "function") {
            await maybePromise;
          }
          if (!isCurrentRun()) return;
          setPlayerIsPlaying(true);
        }

        if (!isCurrentRun()) return;
        setPlayerError(null);
      } catch (error) {
        if (!isCurrentRun()) return;
        const message = sanitizeUiErrorMessage(error, "Unable to start playback for this file.");
        setPlayerError(message);
        onNotice({
          level: "warning",
          message: "Playback failed to start. Check file format support or file access."
        });
      } finally {
        finalizeRun();
      }
    };

    void run();
    return () => {
      cancelled = true;
      if (
        autoplayRunIdRef.current === autoplayRunId &&
        autoplayInFlightSourceKeyRef.current === requestedSourceKey
      ) {
        autoplayInFlightSourceKeyRef.current = null;
      }
    };
  }, [
    autoplayRequestSourceKey,
    nativeTransportEnabled,
    onNotice,
    playerAudioRef,
    playerAudioSrc,
    playerSourceKey,
    pushPlaybackTrackChangeRequest,
    queueFilePaths,
    queueIndex,
    setAutoplayRequestSourceKey,
    setPlaybackPlaying,
    setPlaybackQueue,
    setPlayerError,
    setPlayerIsPlaying
  ]);
}
