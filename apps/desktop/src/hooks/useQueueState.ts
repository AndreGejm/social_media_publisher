import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { CatalogListTracksResponse } from "../services/tauriClient";

type AppNotice = { level: "info" | "success" | "warning"; message: string };
type QueueTrack = CatalogListTracksResponse["items"][number];

type UseQueueStateArgs = {
  queue: QueueTrack[];
  queueIndex: number;
  queueIndexByTrackId: Map<string, number>;
  sessionQueueTrackIds: string[];
  setSessionQueueTrackIds: Dispatch<SetStateAction<string[]>>;
  visibleTracksById: Map<string, QueueTrack>;
  onQueueFeedback: (message: string) => void;
  onNotice: (notice: AppNotice) => void;
};

export function useQueueState(args: UseQueueStateArgs) {
  const currentQueueIds = args.queue.map((item) => item.track_id);

  const materializeSessionQueueBase = useCallback(
    () => (args.sessionQueueTrackIds.length > 0 ? [...args.sessionQueueTrackIds] : [...currentQueueIds]),
    [args.sessionQueueTrackIds, currentQueueIds]
  );

  const setSessionQueueFromTrackIds = useCallback(
    (trackIds: string[]) => {
      const seen = new Set<string>();
      const next = trackIds.filter((trackId) => {
        if (seen.has(trackId)) return false;
        seen.add(trackId);
        return args.visibleTracksById.has(trackId);
      });
      args.setSessionQueueTrackIds(next);
      return next;
    },
    [args.setSessionQueueTrackIds, args.visibleTracksById]
  );

  const appendTracksToSessionQueue = useCallback(
    (trackIds: string[]) => {
      const base = materializeSessionQueueBase();
      const next = setSessionQueueFromTrackIds([...base, ...trackIds]);
      const message =
        trackIds.length > 1 ? `Added ${trackIds.length} tracks to queue.` : "Added track to queue.";
      args.onQueueFeedback(message);
      args.onNotice({ level: "success", message });
      return next;
    },
    [args, materializeSessionQueueBase, setSessionQueueFromTrackIds]
  );

  const enqueueTracksNext = useCallback(
    (trackIds: string[]) => {
      const uniqueTrackIds = [...new Set(trackIds)].filter((id) => args.visibleTracksById.has(id));
      if (uniqueTrackIds.length === 0) return;
      const uniqueTrackIdSet = new Set(uniqueTrackIds);
      const base = materializeSessionQueueBase().filter((id) => !uniqueTrackIdSet.has(id));
      const insertAt = args.queueIndex >= 0 ? Math.min(args.queueIndex + 1, base.length) : 0;
      base.splice(insertAt, 0, ...uniqueTrackIds);
      setSessionQueueFromTrackIds(base);
      const message =
        uniqueTrackIds.length > 1
          ? `Queued ${uniqueTrackIds.length} selected tracks to play next.`
          : "Queued track to play next.";
      args.onQueueFeedback(message);
      args.onNotice({ level: "success", message });
    },
    [args, materializeSessionQueueBase, setSessionQueueFromTrackIds]
  );

  const enqueueTrackNext = useCallback(
    (trackId: string) => {
      enqueueTracksNext([trackId]);
    },
    [enqueueTracksNext]
  );

  const reorderQueueByIndex = useCallback(
    (sourceIndex: number, targetIndex: number) => {
      const ids = args.queue.map((item) => item.track_id);
      if (sourceIndex < 0 || sourceIndex >= ids.length) return false;
      if (targetIndex < 0 || targetIndex >= ids.length) return false;
      if (sourceIndex === targetIndex) return false;
      const [moved] = ids.splice(sourceIndex, 1);
      ids.splice(targetIndex, 0, moved);
      setSessionQueueFromTrackIds(ids);
      return true;
    },
    [args.queue, setSessionQueueFromTrackIds]
  );

  const moveTrackInQueue = useCallback(
    (trackId: string, offset: -1 | 1) => {
      const sourceIndex = args.queueIndexByTrackId.get(trackId);
      if (sourceIndex == null) return;
      const targetIndex = sourceIndex + offset;
      if (!reorderQueueByIndex(sourceIndex, targetIndex)) return;
      const direction = offset < 0 ? "up" : "down";
      const message = `Moved track ${direction} in queue.`;
      args.onQueueFeedback(message);
      args.onNotice({ level: "info", message });
    },
    [args, reorderQueueByIndex]
  );

  const reorderQueueByDrop = useCallback(
    (dragTrackId: string, targetTrackId: string) => {
      const sourceIndex = args.queueIndexByTrackId.get(dragTrackId);
      const targetIndex = args.queueIndexByTrackId.get(targetTrackId);
      if (sourceIndex == null || targetIndex == null) return;
      if (!reorderQueueByIndex(sourceIndex, targetIndex)) return;
      args.onQueueFeedback("Queue reordered.");
      args.onNotice({ level: "success", message: "Queue reordered." });
    },
    [args, reorderQueueByIndex]
  );

  const removeTrackFromSessionQueue = useCallback(
    (trackId: string) => {
      const next = args.queue.map((item) => item.track_id).filter((id) => id !== trackId);
      setSessionQueueFromTrackIds(next);
      args.onQueueFeedback("Removed track from queue.");
      args.onNotice({ level: "info", message: "Removed track from queue." });
    },
    [args, setSessionQueueFromTrackIds]
  );

  const clearSessionQueue = useCallback(() => {
    args.setSessionQueueTrackIds([]);
    args.onQueueFeedback("Session queue cleared. Playback follows the visible list again.");
    args.onNotice({ level: "info", message: "Session queue cleared. Playback follows the visible list again." });
  }, [args]);

  const shuffleSessionQueue = useCallback(() => {
    const base = materializeSessionQueueBase();
    for (let i = base.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [base[i], base[j]] = [base[j], base[i]];
    }
    setSessionQueueFromTrackIds(base);
    args.onQueueFeedback("Queue shuffled.");
    args.onNotice({ level: "success", message: "Queue shuffled." });
  }, [args, materializeSessionQueueBase, setSessionQueueFromTrackIds]);

  return {
    setSessionQueueFromTrackIds,
    appendTracksToSessionQueue,
    enqueueTracksNext,
    enqueueTrackNext,
    moveTrackInQueue,
    reorderQueueByDrop,
    removeTrackFromSessionQueue,
    clearSessionQueue,
    shuffleSessionQueue
  };
}
