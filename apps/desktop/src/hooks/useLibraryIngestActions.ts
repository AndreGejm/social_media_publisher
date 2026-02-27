import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  catalogAddLibraryRoot,
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

type UseLibraryIngestActionsArgs = {
  importPathsInput: string;
  setImportPathsInput: Dispatch<SetStateAction<string>>;
  libraryRootPathInput: string;
  setLibraryRootPathInput: Dispatch<SetStateAction<string>>;
  trackSearch: string;
  libraryRootBrowsing: boolean;
  normalizePathForInput: (path: string) => string;
  onReloadCatalog: (search: string) => Promise<void>;
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

export function useLibraryIngestActions(args: UseLibraryIngestActionsArgs) {
  const refreshLibraryRoots = useCallback(async () => {
    args.setLibraryRootsLoading(true);
    args.setCatalogError(null);
    try {
      const roots = await catalogListLibraryRoots();
      args.setLibraryRoots(roots);
    } catch (error) {
      args.setCatalogError(args.mapUiError(error));
    } finally {
      args.setLibraryRootsLoading(false);
    }
  }, [args]);

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

  const handleRemoveLibraryRoot = useCallback(async (rootId: string) => {
    args.setLibraryRootMutating(true);
    args.setCatalogError(null);
    try {
      await catalogRemoveLibraryRoot(rootId);
      args.setLibraryRoots((current) => current.filter((root) => root.root_id !== rootId));
      args.onNotice({ level: "info", message: "Library root removed." });
    } catch (error) {
      args.setCatalogError(args.mapUiError(error));
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

  return {
    refreshLibraryRoots,
    handleImport,
    handleAddLibraryRoot,
    handleBrowseLibraryRoot,
    handleRemoveLibraryRoot,
    handleScanLibraryRoot
  };
}
