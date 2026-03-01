import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  catalogAddLibraryRoot,
  catalogCancelIngestJob,
  catalogImportFiles,
  catalogListLibraryRoots,
  catalogRemoveLibraryRoot,
  catalogScanRoot,
  pickDirectoryDialog,
  type CatalogImportFailure,
  type CatalogIngestJobResponse,
  type LibraryRootResponse,
  type UiAppError
} from "../services/tauriClient";

type AppNotice = { level: "info" | "success" | "warning"; message: string };
export type DropScanJob = {
  jobId: string;
  rootId: string;
  rootPath: string;
};
export type DropIngestResult = {
  firstImportedTrackId: string | null;
  importedTrackIds: string[];
  importedCount: number;
  importFailureCount: number;
  rootsQueuedCount: number;
  scansStartedCount: number;
  scanFailureCount: number;
  scanJobsStarted: DropScanJob[];
};

type UseLibraryIngestActionsArgs = {
  importPathsInput: string;
  setImportPathsInput: Dispatch<SetStateAction<string>>;
  libraryRootPathInput: string;
  setLibraryRootPathInput: Dispatch<SetStateAction<string>>;
  trackSearch: string;
  libraryRootBrowsing: boolean;
  addParentFoldersAsRootsOnDrop: boolean;
  normalizePathForInput: (path: string) => string;
  onReloadCatalog: (search: string) => Promise<unknown>;
  mapUiError: (error: unknown) => UiAppError;
  onNotice: (notice: AppNotice) => void;
  setCatalogError: Dispatch<SetStateAction<UiAppError | null>>;
  setCatalogImporting: Dispatch<SetStateAction<boolean>>;
  setCatalogFailures: Dispatch<SetStateAction<CatalogImportFailure[]>>;
  setSelectedTrackId: Dispatch<SetStateAction<string>>;
  setLibraryRoots: Dispatch<SetStateAction<LibraryRootResponse[]>>;
  setLibraryRootsLoading: Dispatch<SetStateAction<boolean>>;
  setLibraryRootMutating: Dispatch<SetStateAction<boolean>>;
  setLibraryRootBrowsing: Dispatch<SetStateAction<boolean>>;
  setActiveScanJobs: Dispatch<SetStateAction<Record<string, CatalogIngestJobResponse>>>;
};

function parentDirectoryPath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed) return null;
  const withoutTrailingSeparators = trimmed.replace(/[\\/]+$/, "");
  if (!withoutTrailingSeparators) return null;
  const splitIndex = Math.max(
    withoutTrailingSeparators.lastIndexOf("/"),
    withoutTrailingSeparators.lastIndexOf("\\")
  );
  if (splitIndex < 0) return null;
  if (splitIndex === 0) return withoutTrailingSeparators.slice(0, 1);
  if (splitIndex === 2 && /^[a-z]:/i.test(withoutTrailingSeparators)) {
    return `${withoutTrailingSeparators.slice(0, 2)}\\`;
  }
  return withoutTrailingSeparators.slice(0, splitIndex);
}

export function useLibraryIngestActions(args: UseLibraryIngestActionsArgs) {
  const argsRef = useRef(args);

  useEffect(() => {
    argsRef.current = args;
  }, [args]);

  const refreshLibraryRoots = useCallback(async () => {
    const currentArgs = argsRef.current;
    currentArgs.setLibraryRootsLoading(true);
    currentArgs.setCatalogError(null);
    try {
      const roots = await catalogListLibraryRoots();
      currentArgs.setLibraryRoots(roots);
    } catch (error) {
      currentArgs.setCatalogError(currentArgs.mapUiError(error));
    } finally {
      currentArgs.setLibraryRootsLoading(false);
    }
  }, []);

  const handleImport = useCallback(async () => {
    const paths = args.importPathsInput
      .split(/\r?\n|,/)
      .map((value) => args.normalizePathForInput(value))
      .filter(Boolean);
    if (paths.length === 0) {
      args.setCatalogError({ code: "INVALID_ARGUMENT", message: "Enter at least one local audio file path to import." });
      return;
    }
    args.setCatalogImporting(true);
    args.setCatalogError(null);
    try {
      const response = await catalogImportFiles(paths);
      args.setCatalogFailures(response.failed);
      args.setImportPathsInput("");
      await args.onReloadCatalog(args.trackSearch);
      args.onNotice({
        level: response.failed.length > 0 ? "warning" : "success",
        message:
          response.imported.length > 0
            ? `Imported ${response.imported.length} track(s).`
            : "No tracks were imported."
      });
      if (response.imported[0]) {
        args.setSelectedTrackId(response.imported[0].track_id);
      }
    } catch (error) {
      args.setCatalogError(args.mapUiError(error));
    } finally {
      args.setCatalogImporting(false);
    }
  }, [args]);

  const handleAddLibraryRoot = useCallback(async () => {
    const path = args.normalizePathForInput(args.libraryRootPathInput);
    if (!path) {
      args.setCatalogError({ code: "INVALID_ARGUMENT", message: "Enter a local folder path to add a library root." });
      return;
    }
    args.setLibraryRootMutating(true);
    args.setCatalogError(null);
    try {
      const root = await catalogAddLibraryRoot(path);
      args.setLibraryRootPathInput("");
      args.setLibraryRoots((current) => {
        const deduped = current.filter((item) => item.root_id !== root.root_id);
        return [root, ...deduped];
      });
      args.onNotice({ level: "success", message: "Library root added." });
    } catch (error) {
      args.setCatalogError(args.mapUiError(error));
    } finally {
      args.setLibraryRootMutating(false);
    }
  }, [args]);

  const handleBrowseLibraryRoot = useCallback(async () => {
    if (args.libraryRootBrowsing) return;
    args.setLibraryRootBrowsing(true);
    args.setCatalogError(null);
    try {
      const selected = await pickDirectoryDialog({ title: "Select Library Root Folder" });
      if (!selected) return;
      args.setLibraryRootPathInput(selected);
      args.onNotice({ level: "info", message: "Library root path selected. Click Add Root to persist it." });
    } catch (error) {
      args.setCatalogError(args.mapUiError(error));
    } finally {
      args.setLibraryRootBrowsing(false);
    }
  }, [args]);

  const handleRemoveLibraryRoot = useCallback(async (rootId: string): Promise<boolean> => {
    args.setLibraryRootMutating(true);
    args.setCatalogError(null);
    try {
      await catalogRemoveLibraryRoot(rootId);
      args.setLibraryRoots((current) => current.filter((root) => root.root_id !== rootId));
      args.setSelectedTrackId("");
      await args.onReloadCatalog(args.trackSearch);
      args.onNotice({ level: "info", message: "Library root removed." });
      return true;
    } catch (error) {
      args.setCatalogError(args.mapUiError(error));
      return false;
    } finally {
      args.setLibraryRootMutating(false);
    }
  }, [args]);

  const handleScanLibraryRoot = useCallback(async (rootId: string) => {
    args.setLibraryRootMutating(true);
    args.setCatalogError(null);
    try {
      const job = await catalogScanRoot(rootId);
      args.setActiveScanJobs((current) => ({
        ...current,
        [job.job_id]: {
          job_id: job.job_id,
          status: "PENDING",
          scope: `SCAN_ROOT:${rootId}`,
          total_items: 0,
          processed_items: 0,
          error_count: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      }));
      args.onNotice({ level: "info", message: "Library root scan started." });
    } catch (error) {
      args.setCatalogError(args.mapUiError(error));
    } finally {
      args.setLibraryRootMutating(false);
    }
  }, [args]);

  const handleCancelIngestJob = useCallback(async (jobId: string): Promise<boolean> => {
    args.setCatalogError(null);
    try {
      const canceled = await catalogCancelIngestJob(jobId);
      if (!canceled) {
        args.onNotice({ level: "info", message: "Scan is already in a terminal state." });
        return false;
      }
      args.setActiveScanJobs((current) => {
        const previous = current[jobId];
        if (!previous || previous.status === "CANCELED") {
          return current;
        }
        return {
          ...current,
          [jobId]: {
            ...previous,
            status: "CANCELED",
            updated_at: new Date().toISOString()
          }
        };
      });
      args.onNotice({ level: "info", message: "Scan cancellation requested." });
      return true;
    } catch (error) {
      args.setCatalogError(args.mapUiError(error));
      return false;
    }
  }, [args]);

  const handleIngestDroppedPaths = useCallback(async (rawPaths: string[]): Promise<DropIngestResult | null> => {
    const normalizedPaths = rawPaths
      .map((value) => args.normalizePathForInput(value))
      .filter(Boolean);
    if (normalizedPaths.length === 0) return null;

    const dedupedPaths = [...new Set(normalizedPaths)];
    const attemptedRootPathSet = new Set<string>();
    const queuedRootPathSet = new Set<string>();
    const queuedRootsById = new Map<string, LibraryRootResponse>();
    const importPaths: string[] = [];

    let importedCount = 0;
    let importFailureCount = 0;
    let scansStartedCount = 0;
    let scanFailureCount = 0;
    let firstImportedTrackId: string | null = null;
    let importedTrackIds: string[] = [];
    const scanJobsStarted: DropScanJob[] = [];

    const queueLibraryRoot = async (candidatePath: string): Promise<LibraryRootResponse | null> => {
      const normalized = args.normalizePathForInput(candidatePath);
      if (!normalized) return null;
      const normalizedKey = normalized.toLowerCase();
      if (queuedRootPathSet.has(normalizedKey)) {
        const existing = [...queuedRootsById.values()].find(
          (root) => root.path.toLowerCase() === normalizedKey
        );
        return existing ?? null;
      }
      if (attemptedRootPathSet.has(normalizedKey)) return null;

      attemptedRootPathSet.add(normalizedKey);
      try {
        const root = await catalogAddLibraryRoot(normalized);
        queuedRootPathSet.add(normalizedKey);
        queuedRootsById.set(root.root_id, root);
        args.setLibraryRoots((current) => {
          const deduped = current.filter((item) => item.root_id !== root.root_id);
          return [root, ...deduped];
        });
        return root;
      } catch {
        return null;
      }
    };

    args.setCatalogError(null);
    args.setCatalogImporting(true);
    args.setLibraryRootMutating(true);
    try {
      for (const path of dedupedPaths) {
        const addedRoot = await queueLibraryRoot(path);
        if (addedRoot) continue;

        const parentDirectory = parentDirectoryPath(path);
        if (args.addParentFoldersAsRootsOnDrop && parentDirectory) {
          await queueLibraryRoot(parentDirectory);
        }
        importPaths.push(path);
      }

      if (importPaths.length > 0) {
        const response = await catalogImportFiles(importPaths);
        importedCount = response.imported.length;
        importFailureCount = response.failed.length;
        importedTrackIds = response.imported.map((item) => item.track_id);
        args.setCatalogFailures(response.failed);
        if (response.imported[0]) {
          firstImportedTrackId = response.imported[0].track_id;
          args.setSelectedTrackId(response.imported[0].track_id);
        }
      }

      for (const [rootId, root] of queuedRootsById) {
        try {
          const job = await catalogScanRoot(rootId);
          scansStartedCount += 1;
          scanJobsStarted.push({
            jobId: job.job_id,
            rootId,
            rootPath: root.path
          });
          args.setActiveScanJobs((current) => ({
            ...current,
            [job.job_id]: {
              job_id: job.job_id,
              status: "PENDING",
              scope: `SCAN_ROOT:${rootId}`,
              total_items: 0,
              processed_items: 0,
              error_count: 0,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }
          }));
        } catch {
          scanFailureCount += 1;
        }
      }

      await Promise.all([
        args.onReloadCatalog(args.trackSearch),
        refreshLibraryRoots()
      ]);

      const rootsQueuedCount = queuedRootPathSet.size;
      const summaryParts: string[] = [];
      if (rootsQueuedCount > 0) {
        summaryParts.push(`queued ${rootsQueuedCount} root${rootsQueuedCount === 1 ? "" : "s"}`);
      }
      if (scansStartedCount > 0) {
        summaryParts.push(`started ${scansStartedCount} scan${scansStartedCount === 1 ? "" : "s"}`);
      }
      if (importedCount > 0) {
        summaryParts.push(`imported ${importedCount} track${importedCount === 1 ? "" : "s"}`);
      }
      if (importFailureCount > 0) {
        summaryParts.push(`${importFailureCount} import error${importFailureCount === 1 ? "" : "s"}`);
      }
      if (scanFailureCount > 0) {
        summaryParts.push(`${scanFailureCount} scan error${scanFailureCount === 1 ? "" : "s"}`);
      }

      if (summaryParts.length > 0) {
        args.onNotice({
          level: importFailureCount > 0 || scanFailureCount > 0 ? "warning" : "success",
          message: `Dropped media processed: ${summaryParts.join(", ")}.`
        });
      } else {
        args.onNotice({
          level: "warning",
          message: "Dropped media did not produce importable files or scannable folders."
        });
      }

      return {
        firstImportedTrackId,
        importedTrackIds,
        importedCount,
        importFailureCount,
        rootsQueuedCount,
        scansStartedCount,
        scanFailureCount,
        scanJobsStarted
      };
    } catch (error) {
      args.setCatalogError(args.mapUiError(error));
      return null;
    } finally {
      args.setCatalogImporting(false);
      args.setLibraryRootMutating(false);
    }
  }, [args, refreshLibraryRoots]);

  return {
    refreshLibraryRoots,
    handleImport,
    handleAddLibraryRoot,
    handleBrowseLibraryRoot,
    handleRemoveLibraryRoot,
    handleScanLibraryRoot,
    handleCancelIngestJob,
    handleIngestDroppedPaths
  };
}
