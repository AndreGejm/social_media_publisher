import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { CatalogListTracksResponse } from "../../../services/tauri/tauriClient";

type AppNotice = { level: "info" | "success" | "warning"; message: string };
type QueueTrack = CatalogListTracksResponse["items"][number];

type UseQueueStateArgs = {
  queue: QueueTrack[];
  queueIndex: number;
  queueIndexByTrackId: Map<string, number>;
  sessionQueueTrackIds: string[];
  setSessionQueueTrackIds: Dispatch<SetStateAction<string[]>>;
  queueTracksById: Map<string, QueueTrack>;
  onQueueFeedback: (message: string) => void;
  onNotice: (notice: AppNotice) => void;
};

export function useQueueState(args: UseQueueStateArgs) {
  const {
    queue,
    queueIndex,
    queueIndexByTrackId,
    sessionQueueTrackIds,
    setSessionQueueTrackIds,
    queueTracksById,
    onQueueFeedback,
    onNotice
  } = args;
  const currentQueueIds = queue.map((item) => item.track_id);

  const materializeSessionQueueBase = useCallback(
    () => (sessionQueueTrackIds.length > 0 ? [...sessionQueueTrackIds] : [...currentQueueIds]),
    [sessionQueueTrackIds, currentQueueIds]
  );

  const setSessionQueueFromTrackIds = useCallback(
    (trackIds: string[]) => {
      // Keep imported track IDs even if the catalog list has not rerendered yet.
      const seen = new Set<string>();
      const next = trackIds.filter((trackId) => {
        if (seen.has(trackId)) return false;
        seen.add(trackId);
        return true;
      });
      setSessionQueueTrackIds(next);
      return next;
    },
    [setSessionQueueTrackIds]
  );

  const appendTracksToSessionQueue = useCallback(
    (trackIds: string[]) => {
      const base = materializeSessionQueueBase();
      const next = setSessionQueueFromTrackIds([...base, ...trackIds]);
      const message =
        trackIds.length > 1 ? `Added ${trackIds.length} tracks to queue.` : "Added track to queue.";
      onQueueFeedback(message);
      onNotice({ level: "success", message });
      return next;
    },
    [materializeSessionQueueBase, setSessionQueueFromTrackIds, onQueueFeedback, onNotice]
  );

  const enqueueTracksNext = useCallback(
    (trackIds: string[]) => {
      const uniqueTrackIds = [...new Set(trackIds)].filter((id) => queueTracksById.has(id));
      if (uniqueTrackIds.length === 0) return;
      const uniqueTrackIdSet = new Set(uniqueTrackIds);
      const base = materializeSessionQueueBase().filter((id) => !uniqueTrackIdSet.has(id));
      const insertAt = queueIndex >= 0 ? Math.min(queueIndex + 1, base.length) : 0;
      base.splice(insertAt, 0, ...uniqueTrackIds);
      setSessionQueueFromTrackIds(base);
      const message =
        uniqueTrackIds.length > 1
          ? `Queued ${uniqueTrackIds.length} selected tracks to play next.`
          : "Queued track to play next.";
      onQueueFeedback(message);
      onNotice({ level: "success", message });
    },
    [queueTracksById, materializeSessionQueueBase, queueIndex, setSessionQueueFromTrackIds, onQueueFeedback, onNotice]
  );

  const enqueueTrackNext = useCallback(
    (trackId: string) => {
      enqueueTracksNext([trackId]);
    },
    [enqueueTracksNext]
  );

  const reorderQueueByIndex = useCallback(
    (sourceIndex: number, targetIndex: number) => {
      const ids = queue.map((item) => item.track_id);
      if (sourceIndex < 0 || sourceIndex >= ids.length) return false;
      if (targetIndex < 0 || targetIndex >= ids.length) return false;
      if (sourceIndex === targetIndex) return false;
      const [moved] = ids.splice(sourceIndex, 1);
      ids.splice(targetIndex, 0, moved);
      setSessionQueueFromTrackIds(ids);
      return true;
    },
    [queue, setSessionQueueFromTrackIds]
  );

  const moveTrackInQueue = useCallback(
    (trackId: string, offset: -1 | 1) => {
      const sourceIndex = queueIndexByTrackId.get(trackId);
      if (sourceIndex == null) return;
      const targetIndex = sourceIndex + offset;
      if (!reorderQueueByIndex(sourceIndex, targetIndex)) return;
      const direction = offset < 0 ? "up" : "down";
      const message = `Moved track ${direction} in queue.`;
      onQueueFeedback(message);
      onNotice({ level: "info", message });
    },
    [queueIndexByTrackId, reorderQueueByIndex, onQueueFeedback, onNotice]
  );

  const reorderQueueByDrop = useCallback(
    (dragTrackId: string, targetTrackId: string) => {
      const sourceIndex = queueIndexByTrackId.get(dragTrackId);
      const targetIndex = queueIndexByTrackId.get(targetTrackId);
      if (sourceIndex == null || targetIndex == null) return;
      if (!reorderQueueByIndex(sourceIndex, targetIndex)) return;
      onQueueFeedback("Queue reordered.");
      onNotice({ level: "success", message: "Queue reordered." });
    },
    [queueIndexByTrackId, reorderQueueByIndex, onQueueFeedback, onNotice]
  );

  const removeTrackFromSessionQueue = useCallback(
    (trackId: string) => {
      const next = queue.map((item) => item.track_id).filter((id) => id !== trackId);
      setSessionQueueFromTrackIds(next);
      onQueueFeedback("Removed track from queue.");
      onNotice({ level: "info", message: "Removed track from queue." });
    },
    [queue, setSessionQueueFromTrackIds, onQueueFeedback, onNotice]
  );

  const clearSessionQueue = useCallback(() => {
    setSessionQueueTrackIds([]);
    onQueueFeedback("Session queue cleared. Playback follows the visible list again.");
    onNotice({ level: "info", message: "Session queue cleared. Playback follows the visible list again." });
  }, [setSessionQueueTrackIds, onQueueFeedback, onNotice]);

  const shuffleSessionQueue = useCallback(() => {
    const base = materializeSessionQueueBase();
    for (let i = base.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [base[i], base[j]] = [base[j], base[i]];
    }
    setSessionQueueFromTrackIds(base);
    onQueueFeedback("Queue shuffled.");
    onNotice({ level: "success", message: "Queue shuffled." });
  }, [materializeSessionQueueBase, setSessionQueueFromTrackIds, onQueueFeedback, onNotice]);

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

