import type { Dispatch, SetStateAction } from "react";

import type { ExternalPlayerSource } from "../../player-transport/api";
import type { CatalogListTracksResponse } from "../../../services/tauri/tauriClient";

type AppNotice = { level: "info" | "success" | "warning"; message: string };
type QueueTrack = CatalogListTracksResponse["items"][number];

type TrackRowContextAction =
  | "play_now"
  | "add_queue"
  | "play_next"
  | "select_batch"
  | "toggle_favorite"
  | "show_in_tracks"
  | "remove_queue"
  | "move_up_queue"
  | "move_down_queue";

type AlbumGroupPlaybackInput = {
  albumTitle: string;
  trackIds: string[];
};

type UsePlayListActionsArgs = {
  queue: QueueTrack[];
  queueTracksById: Map<string, QueueTrack>;
  orderedBatchSelectionIds: string[];
  selectedAlbumBatchTrackIds: string[];
  contextMenuTrack: QueueTrack | null;
  hasOpenTrackRowContextMenu: boolean;
  closeTrackRowContextMenu: () => void;
  setSessionQueueTrackIds: Dispatch<SetStateAction<string[]>>;
  setSessionQueueFromTrackIds: (trackIds: string[]) => string[];
  appendTracksToSessionQueue: (trackIds: string[]) => string[];
  enqueueTrackNext: (trackId: string) => void;
  moveTrackInQueue: (trackId: string, offset: -1 | 1) => void;
  removeTrackFromSessionQueue: (trackId: string) => void;
  setPlayerExternalSource: Dispatch<SetStateAction<ExternalPlayerSource | null>>;
  setPlayerTrackId: Dispatch<SetStateAction<string>>;
  setSelectedTrackId: Dispatch<SetStateAction<string>>;
  setPlayerError: Dispatch<SetStateAction<string | null>>;
  setAutoplayRequestSourceKey: Dispatch<SetStateAction<string | null>>;
  setPlayerTimeSec: Dispatch<SetStateAction<number>>;
  setActiveWorkspace: Dispatch<
    SetStateAction<"Library" | "Quality Control" | "Playlists" | "Video Workspace" | "Publisher Ops" | "Settings" | "About">
  >;
  setQualityControlMode: Dispatch<SetStateAction<"track" | "album">>;
  setPlayListMode: Dispatch<SetStateAction<"library" | "queue">>;
  setBatchSelectedTrackIds: Dispatch<SetStateAction<string[]>>;
  setFavoriteTrackIds: Dispatch<SetStateAction<string[]>>;
  onQueueFeedback: (message: string) => void;
  onNotice: (notice: AppNotice) => void;
};

function moveItemToFront(ids: string[], trackId: string): string[] {
  const deduped = ids.filter((id) => id !== trackId);
  return [trackId, ...deduped];
}

export function usePlayListActions(args: UsePlayListActionsArgs) {
  const setPlayerTrackFromQueueIndex = (
    index: number,
    options?: { autoplay?: boolean; openTracksWorkspace?: boolean }
  ) => {
    const item = args.queue[index];
    if (!item) return;
    const { autoplay = true, openTracksWorkspace = false } = options ?? {};
    args.setPlayerExternalSource(null);
    args.setPlayerTrackId(item.track_id);
    args.setSelectedTrackId(item.track_id);
    args.setPlayerError(null);
    if (autoplay) {
      args.setAutoplayRequestSourceKey(`catalog:${item.track_id}`);
    }
    if (openTracksWorkspace) {
      args.setQualityControlMode("track");
      args.setActiveWorkspace("Quality Control");
    }
  };

  const toggleTrackBatchSelection = (trackId: string, checked?: boolean) => {
    args.setBatchSelectedTrackIds((current) => {
      const nextChecked = checked ?? !current.includes(trackId);
      if (nextChecked) {
        return current.includes(trackId) ? current : [...current, trackId];
      }
      return current.filter((id) => id !== trackId);
    });
  };

  const clearBatchSelection = () => {
    args.setBatchSelectedTrackIds([]);
    args.onNotice({ level: "info", message: "Track selection cleared." });
  };

  const clearAlbumBatchSelection = () => {
    if (args.selectedAlbumBatchTrackIds.length === 0) return;
    const selectedIds = new Set(args.selectedAlbumBatchTrackIds);
    args.setBatchSelectedTrackIds((current) => current.filter((id) => !selectedIds.has(id)));
    args.onNotice({ level: "info", message: "Album track selection cleared." });
  };

  const playTrackNow = (trackId: string, options?: { openTracksWorkspace?: boolean }) => {
    const { openTracksWorkspace = false } = options ?? {};
    args.setSessionQueueTrackIds((current) => {
      const base = current.length > 0 ? current : args.queue.map((item) => item.track_id);
      const next = moveItemToFront(base, trackId);
      const seen = new Set<string>();
      return next.filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    });
    args.setPlayerExternalSource(null);
    args.setPlayerTrackId(trackId);
    args.setAutoplayRequestSourceKey(`catalog:${trackId}`);
    args.setPlayerError(null);
    args.setPlayerTimeSec(0);
    args.setSelectedTrackId(trackId);
    if (openTracksWorkspace) {
      args.setQualityControlMode("track");
      args.setActiveWorkspace("Quality Control");
    }
  };

  const playBatchSelectionNow = () => {
    if (args.orderedBatchSelectionIds.length === 0) return;
    args.setSessionQueueFromTrackIds(args.orderedBatchSelectionIds);
    playTrackNow(args.orderedBatchSelectionIds[0]);
    const message = `Playing selection (${args.orderedBatchSelectionIds.length} track${args.orderedBatchSelectionIds.length === 1 ? "" : "s"}).`;
    args.onQueueFeedback(message);
    args.onNotice({ level: "success", message });
  };

  const armTrackFromPlayList = (trackId: string, options?: { queueIndex?: number }) => {
    if (options?.queueIndex != null) {
      setPlayerTrackFromQueueIndex(options.queueIndex, { autoplay: false });
      return;
    }
    args.setSelectedTrackId(trackId);
    args.setPlayerExternalSource(null);
    args.setPlayerTrackId(trackId);
    args.setAutoplayRequestSourceKey(null);
    args.setPlayerError(null);
    args.setPlayerTimeSec(0);
  };

  const toggleFavoriteTrack = (trackId: string) => {
    args.setFavoriteTrackIds((current) => {
      const next = current.includes(trackId) ? current.filter((id) => id !== trackId) : [trackId, ...current];
      args.onNotice({
        level: "info",
        message: next.includes(trackId) ? "Track marked as favorite." : "Track removed from favorites."
      });
      return next;
    });
  };

  const playAlbumGroup = (group: AlbumGroupPlaybackInput) => {
    args.setSessionQueueFromTrackIds(group.trackIds);
    if (group.trackIds[0]) {
      playTrackNow(group.trackIds[0], { openTracksWorkspace: true });
      const message = `Album queued and playback requested for ${group.albumTitle}.`;
      args.onQueueFeedback(message);
      args.onNotice({ level: "success", message });
    }
  };

  const runTrackContextMenuAction = (action: TrackRowContextAction) => {
    if (!args.contextMenuTrack || !args.hasOpenTrackRowContextMenu) return;
    switch (action) {
      case "play_now":
        playTrackNow(args.contextMenuTrack.track_id);
        break;
      case "add_queue":
        args.appendTracksToSessionQueue([args.contextMenuTrack.track_id]);
        break;
      case "play_next":
        args.enqueueTrackNext(args.contextMenuTrack.track_id);
        break;
      case "select_batch":
        toggleTrackBatchSelection(args.contextMenuTrack.track_id, true);
        args.onNotice({ level: "info", message: "Track added to batch selection." });
        break;
      case "toggle_favorite":
        toggleFavoriteTrack(args.contextMenuTrack.track_id);
        break;
      case "show_in_tracks":
        args.setSelectedTrackId(args.contextMenuTrack.track_id);
        args.setQualityControlMode("track");
        args.setActiveWorkspace("Quality Control");
        args.setPlayListMode("library");
        break;
      case "remove_queue":
        args.removeTrackFromSessionQueue(args.contextMenuTrack.track_id);
        break;
      case "move_up_queue":
        args.moveTrackInQueue(args.contextMenuTrack.track_id, -1);
        break;
      case "move_down_queue":
        args.moveTrackInQueue(args.contextMenuTrack.track_id, 1);
        break;
    }
    args.closeTrackRowContextMenu();
  };

  return {
    setPlayerTrackFromQueueIndex,
    toggleTrackBatchSelection,
    clearBatchSelection,
    clearAlbumBatchSelection,
    playTrackNow,
    playBatchSelectionNow,
    armTrackFromPlayList,
    runTrackContextMenuAction,
    toggleFavoriteTrack,
    playAlbumGroup
  };
}

