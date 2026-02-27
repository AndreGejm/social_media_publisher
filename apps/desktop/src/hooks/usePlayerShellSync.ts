import { useEffect } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";

import type { CatalogListTracksResponse, CatalogTrackDetailResponse } from "../services/tauriClient";

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
  playerSource: PlayerSource;
  queue: CatalogListTracksResponse["items"];
  setPlayerTrackFromQueueIndex: (index: number, options?: { autoplay?: boolean; openTracksWorkspace?: boolean }) => void;
  playerAudioRef: RefObject<HTMLAudioElement>;
  setPlayerError: Dispatch<SetStateAction<string | null>>;
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
    playerSource,
    queue,
    setPlayerTrackFromQueueIndex,
    playerAudioRef,
    setPlayerError,
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
    const audio = playerAudioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => {
        setPlayerIsPlaying(false);
        setPlayerError("Unable to start playback for the current track.");
        onNotice({ level: "warning", message: "Playback failed to start." });
      });
    } else {
      audio.pause();
    }
  };

  return { togglePlay };
}
