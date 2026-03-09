import { useEffect, type Dispatch, type SetStateAction } from "react";

import { sanitizeUiText } from "../../../shared/lib/ui-sanitize";
import {
  isPlaybackPositionUnchanged,
  normalizePlaybackPositionSeconds
} from "../../player/transportMath";
import type { PlaybackContextState, UiAppError } from "../../../services/tauri/tauriClient";

type UseTransportPollingArgs = {
  nativeTransportEnabled: boolean;
  applyPlaybackContextToNowPlayingState: (context: PlaybackContextState) => void;
  onPlaybackContext: (context: PlaybackContextState) => void;
  getPlaybackContext: () => Promise<PlaybackContextState>;
  getPlaybackDecodeError: () => Promise<string | null>;
  setPlayerIsPlaying: Dispatch<SetStateAction<boolean>>;
  setPlayerTimeSec: Dispatch<SetStateAction<number>>;
  setPlayerError: Dispatch<SetStateAction<string | null>>;
  normalizeUiError: (error: unknown) => UiAppError;
  shouldUseLegacyAudioFallback: (error: UiAppError) => boolean;
  onNativeTransportUnavailable: (reason: string) => void;
};

export function useTransportPolling(args: UseTransportPollingArgs): void {
  const {
    nativeTransportEnabled,
    applyPlaybackContextToNowPlayingState,
    onPlaybackContext,
    getPlaybackContext,
    getPlaybackDecodeError,
    setPlayerIsPlaying,
    setPlayerTimeSec,
    setPlayerError,
    normalizeUiError,
    shouldUseLegacyAudioFallback,
    onNativeTransportUnavailable
  } = args;

  useEffect(() => {
    if (!nativeTransportEnabled) return;

    let cancelled = false;
    const refresh = async () => {
      try {
        const context = await getPlaybackContext();
        if (cancelled) return;

        applyPlaybackContextToNowPlayingState(context);
        onPlaybackContext(context);

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
          onNativeTransportUnavailable(
            "Native output became unavailable. Falling back to browser-shared audio."
          );
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
  }, [
    applyPlaybackContextToNowPlayingState,
    onNativeTransportUnavailable,
    getPlaybackContext,
    getPlaybackDecodeError,
    nativeTransportEnabled,
    normalizeUiError,
    onPlaybackContext,
    setPlayerError,
    setPlayerIsPlaying,
    setPlayerTimeSec,
    shouldUseLegacyAudioFallback
  ]);
}
