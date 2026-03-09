import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  type CatalogIngestJobResponse,
  type CatalogListTracksResponse
} from "../services/tauriClient";
import { useTauriClient } from "../services/TauriClientProvider";
import { useIngestJobPolling } from "./useIngestJobPolling";
import type { DropIngestResult } from "./useLibraryIngestActions";

type PlayListMode = "library" | "queue";

type UseDroppedIngestAutoplayControllerArgs = {
  activeScanJobs: Record<string, CatalogIngestJobResponse>;
  setActiveScanJobs: Dispatch<SetStateAction<Record<string, CatalogIngestJobResponse>>>;
  loadCatalogTracks: (search: string) => Promise<CatalogListTracksResponse | null>;
  trackSearch: string;
  setTrackSearch: Dispatch<SetStateAction<string>>;
  setShowFavoritesOnly: Dispatch<SetStateAction<boolean>>;
  setPlayListModeWithQueueSync: Dispatch<SetStateAction<PlayListMode>>;
  appendTracksToSessionQueue: (trackIds: string[]) => void;
  playTrackNow: (trackId: string) => void;
  handleIngestDroppedPaths: (rawPaths: string[]) => Promise<DropIngestResult | null>;
};

function normalizePathForRootMatch(path: string): string {
  let normalized = path.replace(/\\/g, "/").trim();
  if (normalized.startsWith("//?/")) {
    normalized = normalized.slice(4);
  }
  while (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized.toLowerCase();
}

// Windows-only assumption: path comparison is case-insensitive via .toLowerCase().
// On a case-sensitive filesystem (Linux) this would produce false negatives.
function filePathMatchesRoot(filePath: string, rootPath: string): boolean {
  const normalizedFilePath = normalizePathForRootMatch(filePath);
  const normalizedRootPath = normalizePathForRootMatch(rootPath);
  if (!normalizedRootPath) return false;
  return normalizedFilePath === normalizedRootPath || normalizedFilePath.startsWith(`${normalizedRootPath}/`);
}

export function useDroppedIngestAutoplayController(args: UseDroppedIngestAutoplayControllerArgs) {
  const {
    activeScanJobs,
    setActiveScanJobs,
    loadCatalogTracks,
    trackSearch,
    setTrackSearch,
    setShowFavoritesOnly,
    setPlayListModeWithQueueSync,
    appendTracksToSessionQueue,
    playTrackNow,
    handleIngestDroppedPaths
  } = args;

  const { catalogListTracks } = useTauriClient();

  const catalogListTracksRef = useRef(catalogListTracks);
  useEffect(() => {
    catalogListTracksRef.current = catalogListTracks;
  }, [catalogListTracks]);

  const handleIngestDroppedPathsRef = useRef(handleIngestDroppedPaths);
  const playTrackNowRef = useRef(playTrackNow);
  const appendTracksToSessionQueueRef = useRef(appendTracksToSessionQueue);
  const setPlayListModeWithQueueSyncRef = useRef(setPlayListModeWithQueueSync);
  const pendingDroppedScanAutoplayJobsRef = useRef<Map<string, string>>(new Map());
  const handledDroppedScanAutoplayJobIdsRef = useRef<Set<string>>(new Set());
  // Ref keeps trackSearch current inside async callbacks that outlive their render cycle.
  const trackSearchRef = useRef(trackSearch);
  useEffect(() => { trackSearchRef.current = trackSearch; }, [trackSearch]);

  useEffect(() => {
    handleIngestDroppedPathsRef.current = handleIngestDroppedPaths;
  }, [handleIngestDroppedPaths]);

  useEffect(() => {
    playTrackNowRef.current = playTrackNow;
  }, [playTrackNow]);

  useEffect(() => {
    appendTracksToSessionQueueRef.current = appendTracksToSessionQueue;
  }, [appendTracksToSessionQueue]);

  useEffect(() => {
    setPlayListModeWithQueueSyncRef.current = setPlayListModeWithQueueSync;
  }, [setPlayListModeWithQueueSync]);

  useIngestJobPolling({
    activeScanJobs,
    setActiveScanJobs,
    onJobsCompleted: (completedJobs) => {
      void (async () => {
        const pendingDropJobs = pendingDroppedScanAutoplayJobsRef.current;
        const handledDropJobs = handledDroppedScanAutoplayJobIdsRef.current;
        const hasPendingDropAutoplay = pendingDropJobs.size > 0;
        const reloadResponse = await loadCatalogTracks(hasPendingDropAutoplay ? "" : trackSearchRef.current);
        if (!hasPendingDropAutoplay) return;
        if (!reloadResponse) return;

        setTrackSearch((current) => (current === "" ? current : ""));
        let loadedItems = [...reloadResponse.items];
        let offset = loadedItems.length;
        while (offset < reloadResponse.total) {
          const nextPage = await catalogListTracksRef.current({
            search: null,
            limit: 100,
            offset
          });
          if (!nextPage || nextPage.items.length === 0) break;
          loadedItems = [...loadedItems, ...nextPage.items];
          offset += nextPage.items.length;
        }

        const matchedTrackIdsInDropOrder: string[] = [];
        const matchedTrackIdSet = new Set<string>();
        for (const job of completedJobs) {
          if (handledDropJobs.has(job.job_id)) continue;
          const rootPath = pendingDropJobs.get(job.job_id);
          if (!rootPath) continue;

          handledDropJobs.add(job.job_id);
          pendingDropJobs.delete(job.job_id);
          if (job.status !== "COMPLETED" || job.processed_items === 0) {
            continue;
          }
          for (const item of loadedItems) {
            if (!filePathMatchesRoot(item.file_path, rootPath)) continue;
            if (matchedTrackIdSet.has(item.track_id)) continue;
            matchedTrackIdSet.add(item.track_id);
            matchedTrackIdsInDropOrder.push(item.track_id);
          }
        }
        if (matchedTrackIdsInDropOrder.length === 0) return;

        setShowFavoritesOnly((current) => (current ? false : current));
        setPlayListModeWithQueueSync((current) => (current === "library" ? current : "library"));
        appendTracksToSessionQueue(matchedTrackIdsInDropOrder);
        playTrackNowRef.current(matchedTrackIdsInDropOrder[0]);
      })();
    }
  });

  useEffect(() => {
    if (!window.__TAURI__?.core?.invoke) return;

    let cancelled = false;
    let unlistenDropEvent: (() => void) | undefined;

    const attachDropListener = async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        if (cancelled) return;
        unlistenDropEvent = await getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type !== "drop") return;
          const droppedPaths = event.payload.paths;
          if (!Array.isArray(droppedPaths) || droppedPaths.length === 0) return;
          void handleIngestDroppedPathsRef.current(droppedPaths).then((result) => {
            if (result?.importedTrackIds && result.importedTrackIds.length > 0) {
              pendingDroppedScanAutoplayJobsRef.current.clear();
              handledDroppedScanAutoplayJobIdsRef.current.clear();
              const importedTrackIds = result.importedTrackIds;
              setTrackSearch((current) => (current === "" ? current : ""));
              setShowFavoritesOnly((current) => (current ? false : current));
              setPlayListModeWithQueueSyncRef.current((current) => (current === "library" ? current : "library"));
              appendTracksToSessionQueueRef.current(importedTrackIds);
              playTrackNowRef.current(result.firstImportedTrackId ?? importedTrackIds[0]);
              return;
            }
            if (result?.scanJobsStarted && result.scanJobsStarted.length > 0) {
              for (const scanJob of result.scanJobsStarted) {
                handledDroppedScanAutoplayJobIdsRef.current.delete(scanJob.jobId);
                pendingDroppedScanAutoplayJobsRef.current.set(scanJob.jobId, scanJob.rootPath);
              }
            }
          });
        });
      } catch {
        // Drag-drop integration is optional in browser/test runtimes.
      }
    };

    void attachDropListener();
    return () => {
      cancelled = true;
      if (unlistenDropEvent) {
        unlistenDropEvent();
      }
    };
  }, [setShowFavoritesOnly, setTrackSearch]);
}
