import { useCallback, useMemo, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";

import type { SharedTransportBridgeForPublisherOps } from "../../publisher-ops/types";
import { sanitizeUiErrorMessage } from "../../../shared/lib/ui-sanitize";
import type { ExternalPlayerSource, ResolvedPlayerSource } from "./playerTransportTypes";

type UseTransportPlaybackActionsArgs = {
  playerSource: ResolvedPlayerSource | null;
  playerTimeSec: number;
  playerIsPlaying: boolean;
  nativeTransportEnabled: boolean;
  playerAudioRef: RefObject<HTMLAudioElement>;
  setPlayerExternalSource: Dispatch<SetStateAction<ExternalPlayerSource | null>>;
  setPlayerTrackId: Dispatch<SetStateAction<string>>;
  setPlayerError: Dispatch<SetStateAction<string | null>>;
  setAutoplayRequestSourceKey: Dispatch<SetStateAction<string | null>>;
  seekPlaybackRatio: (ratio: number) => Promise<void>;
  setPlayerTimeSec: Dispatch<SetStateAction<number>>;
  setPlaybackPlaying: (isPlaying: boolean) => Promise<void>;
  setPlayerIsPlaying: Dispatch<SetStateAction<boolean>>;
};

type TransportPlaybackActions = {
  ensureExternalPlayerSource: (
    source: ExternalPlayerSource,
    options?: { autoplay?: boolean }
  ) => void;
  seekPlayer: (ratio: number) => void;
  setNativePlaybackPlaying: (isPlaying: boolean) => Promise<void>;
  publisherOpsSharedTransportBridge: SharedTransportBridgeForPublisherOps;
};

export function useTransportPlaybackActions(
  args: UseTransportPlaybackActionsArgs
): TransportPlaybackActions {
  const {
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
  } = args;

  const isQueueBackedSource = playerSource?.key?.startsWith("catalog:") ?? false;

  const publisherOpsTransportStateRef = useRef<SharedTransportBridgeForPublisherOps["state"]>({
    sourceKey: null,
    currentTimeSec: 0,
    isPlaying: false
  });

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
    [setAutoplayRequestSourceKey, setPlayerError, setPlayerExternalSource, setPlayerTrackId]
  );

  const seekPlayer = useCallback(
    (ratio: number) => {
      const source = playerSource;
      if (!source) return;

      const clampedRatio = Math.max(0, Math.min(1, ratio));
      const durationSec = Math.max(source.durationMs / 1000, 0.001);
      const nextTime = Math.max(0, Math.min(durationSec, durationSec * clampedRatio));

      if (nativeTransportEnabled && isQueueBackedSource) {
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
    [
      isQueueBackedSource,
      nativeTransportEnabled,
      playerAudioRef,
      playerSource,
      seekPlaybackRatio,
      setPlayerError,
      setPlayerTimeSec
    ]
  );

  const setNativePlaybackPlaying = useCallback(
    async (isPlaying: boolean) => {
      if (!nativeTransportEnabled || !isQueueBackedSource) {
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
    [
      isQueueBackedSource,
      nativeTransportEnabled,
      playerAudioRef,
      setPlaybackPlaying,
      setPlayerError,
      setPlayerIsPlaying
    ]
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
    ensureExternalPlayerSource,
    seekPlayer,
    setNativePlaybackPlaying,
    publisherOpsSharedTransportBridge
  };
}
