import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export type UiAppError = { code: string; message: string; details?: unknown };

export type TrackModel = {
  file_path: string;
  duration_ms: number;
  peak_data: number[];
  loudness_lufs: number;
};

export type CatalogTrackListItem = {
  track_id: string;
  title: string;
  artist_name: string;
  album_title?: string | null;
  duration_ms: number;
  loudness_lufs: number;
  file_path: string;
  media_fingerprint: string;
  updated_at: string;
};

export type CatalogListTracksInput = {
  search?: string | null;
  limit?: number | null;
  offset?: number | null;
};

export type CatalogListTracksResponse = {
  items: CatalogTrackListItem[];
  total: number;
  limit: number;
  offset: number;
};

export type CatalogTrackDetailResponse = {
  track_id: string;
  media_asset_id: string;
  title: string;
  artist_id: string;
  artist_name: string;
  album_id?: string | null;
  album_title?: string | null;
  file_path: string;
  media_fingerprint: string;
  track: TrackModel;
  sample_rate_hz: number;
  channels: number;
  true_peak_dbfs?: number | null;
  visibility_policy: string;
  license_policy: string;
  downloadable: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
};

export type CatalogUpdateTrackMetadataInput = {
  track_id: string;
  visibility_policy: string;
  license_policy: string;
  downloadable: boolean;
  tags: string[];
};

export type PublisherCreateDraftFromTrackResponse = {
  draft_id: string;
  source_track_id: string;
  media_path: string;
  spec_path: string;
  spec: {
    title: string;
    artist: string;
    description: string;
    tags: string[];
    mock?: { enabled: boolean; note?: string | null } | null;
  };
  spec_yaml: string;
};

export type CatalogImportFailure = {
  path: string;
  code: string;
  message: string;
};

export type CatalogImportFilesResponse = {
  imported: CatalogTrackListItem[];
  failed: CatalogImportFailure[];
};

export type LibraryRootResponse = {
  root_id: string;
  path: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type CatalogScanRootResponse = {
  job_id: string;
  root_id: string;
};

export type CatalogIngestJobResponse = {
  job_id: string;
  status: string;
  scope: string;
  total_items: number;
  processed_items: number;
  error_count: number;
  created_at: string;
  updated_at: string;
};

declare global {
  interface Window {
    __TAURI__?: { core?: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> } };
  }
}

export async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const globalInvoke = window.__TAURI__?.core?.invoke;
  if (globalInvoke) {
    return globalInvoke<T>(command, args);
  }

  try {
    if (typeof tauriInvoke !== "function") {
      throw new Error("invoke unavailable");
    }
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      "message" in error &&
      typeof (error as { code?: unknown }).code === "string" &&
      typeof (error as { message?: unknown }).message === "string"
    ) {
      throw error;
    }

    throw {
      code: "TAURI_UNAVAILABLE",
      message: "Tauri runtime is not available in the browser preview.",
      details: { command }
    } satisfies UiAppError;
  }
}

export async function catalogImportFiles(paths: string[]): Promise<CatalogImportFilesResponse> {
  return invokeCommand<CatalogImportFilesResponse>("catalog_import_files", { paths });
}

export async function catalogListTracks(
  query?: CatalogListTracksInput
): Promise<CatalogListTracksResponse> {
  return invokeCommand<CatalogListTracksResponse>("catalog_list_tracks", { query });
}

export async function catalogGetTrack(trackId: string): Promise<CatalogTrackDetailResponse | null> {
  return invokeCommand<CatalogTrackDetailResponse | null>("catalog_get_track", { trackId });
}

export async function publisherCreateDraftFromTrack(
  trackId: string
): Promise<PublisherCreateDraftFromTrackResponse> {
  return invokeCommand<PublisherCreateDraftFromTrackResponse>("publisher_create_draft_from_track", {
    trackId
  });
}

export async function catalogUpdateTrackMetadata(
  input: CatalogUpdateTrackMetadataInput
): Promise<CatalogTrackDetailResponse> {
  return invokeCommand<CatalogTrackDetailResponse>("catalog_update_track_metadata", { input });
}

export async function catalogAddLibraryRoot(path: string): Promise<LibraryRootResponse> {
  return invokeCommand<LibraryRootResponse>("catalog_add_library_root", { path });
}

export async function catalogListLibraryRoots(): Promise<LibraryRootResponse[]> {
  return invokeCommand<LibraryRootResponse[]>("catalog_list_library_roots");
}

export async function catalogRemoveLibraryRoot(rootId: string): Promise<boolean> {
  return invokeCommand<boolean>("catalog_remove_library_root", { rootId });
}

export async function catalogScanRoot(rootId: string): Promise<CatalogScanRootResponse> {
  return invokeCommand<CatalogScanRootResponse>("catalog_scan_root", { rootId });
}

export async function catalogGetIngestJob(jobId: string): Promise<CatalogIngestJobResponse | null> {
  return invokeCommand<CatalogIngestJobResponse | null>("catalog_get_ingest_job", { jobId });
}

export async function pickDirectoryDialog(
  options?: { title?: string }
): Promise<string | null> {
  try {
    const dialog = await import("@tauri-apps/plugin-dialog");
    const selected = await dialog.open({
      directory: true,
      multiple: false,
      title: options?.title ?? "Select Folder"
    });
    return typeof selected === "string" ? selected : null;
  } catch {
    throw {
      code: "TAURI_DIALOG_UNAVAILABLE",
      message: "Native folder picker is not available in this runtime."
    } satisfies UiAppError;
  }
}
