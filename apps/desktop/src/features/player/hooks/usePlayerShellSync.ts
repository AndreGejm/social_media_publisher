import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { CatalogListTracksResponse, CatalogTrackDetailResponse } from "../../../services/tauri/tauriClient";

type AppNotice = { level: "info" | "success" | "warning"; message: string };

type PlayerSource = {
  key: string;
  filePath: string;
  title: string;
  artist: string;
  durationMs: number;
} | null;

type ShellLike = {
  eventBus: {
    emit: (event: "PLAYBACK_CHANGED", payload: { trackId: string | null; isPlaying: boolean }) => void;
  };
} | null;

type UsePlayerShellSyncArgs = {
  shellState: ShellLike;
  playerTrackId: string;
  selectedTrackDetail: CatalogTrackDetailResponse | null;
  setPlayerTrackId: Dispatch<SetStateAction<string>>;
  setPlayerTimeSec: Dispatch<SetStateAction<number>>;
  playerIsPlaying: boolean;
  setPlayerIsPlaying: Dispatch<SetStateAction<boolean>>;
  setNativePlaybackPlaying: (isPlaying: boolean) => Promise<void>;
  playerSource: PlayerSource;
  queue: CatalogListTracksResponse["items"];
  setPlayerTrackFromQueueIndex: (index: number, options?: { autoplay?: boolean; openTracksWorkspace?: boolean }) => void;
  setPlayerError: Dispatch<SetStateAction<string | null>>;
  seekPlayer: (ratio: number) => void;
  onNotice: (notice: AppNotice) => void;
};

export function usePlayerShellSync(args: UsePlayerShellSyncArgs) {
  const {
    shellState,
    playerTrackId,
    selectedTrackDetail,
    setPlayerTrackId,
    setPlayerTimeSec,
    playerIsPlaying,
    setPlayerIsPlaying,
    setNativePlaybackPlaying,
    playerSource,
    queue,
    setPlayerTrackFromQueueIndex,
    setPlayerError,
    seekPlayer,
    onNotice
  } = args;

  useEffect(() => {
    if (playerTrackId || !selectedTrackDetail) return;
    setPlayerTrackId(selectedTrackDetail.track_id);
    setPlayerTimeSec(0);
    setPlayerIsPlaying(false);
  }, [playerTrackId, selectedTrackDetail, setPlayerIsPlaying, setPlayerTimeSec, setPlayerTrackId]);

  useEffect(() => {
    if (!shellState) return;
    shellState.eventBus.emit("PLAYBACK_CHANGED", {
      trackId: playerTrackId || null,
      isPlaying: playerIsPlaying
    });
  }, [shellState, playerIsPlaying, playerTrackId]);

  const togglePlay = () => {
    if (!playerSource) {
      if (queue[0]) {
        setPlayerTrackFromQueueIndex(0, { autoplay: true });
      } else {
        onNotice({ level: "info", message: "No track is loaded in the shared transport." });
      }
      return;
    }

    void setNativePlaybackPlaying(!playerIsPlaying).catch((error) => {
      const message =
        error instanceof Error ? error.message : "Unable to start playback for the current track.";
      setPlayerIsPlaying(false);
      setPlayerError(message);
      onNotice({ level: "warning", message: "Playback failed to start." });
    });
  };

  const stopPlayer = () => {
    if (!playerSource) return;
    void setNativePlaybackPlaying(false)
      .then(() => {
        setPlayerTimeSec(0);
      })
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : "Unable to stop playback.";
        setPlayerError(message);
      });
    setPlayerIsPlaying(false);
    setPlayerTimeSec(0);
    seekPlayer(0);
  };

  return { togglePlay, stopPlayer };
}
