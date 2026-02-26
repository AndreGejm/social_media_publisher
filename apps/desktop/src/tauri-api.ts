import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { sanitizeUiText } from "./ui-sanitize";

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

function sanitizeTrackModel(track: TrackModel): TrackModel {
  return {
    file_path: sanitizeUiText(track.file_path, 4096),
    duration_ms: track.duration_ms,
    peak_data: track.peak_data,
    loudness_lufs: track.loudness_lufs
  };
}

function sanitizeCatalogTrackListItem(item: CatalogTrackListItem): CatalogTrackListItem {
  return {
    ...item,
    title: sanitizeUiText(item.title, 256),
    artist_name: sanitizeUiText(item.artist_name, 256),
    album_title: item.album_title == null ? item.album_title : sanitizeUiText(item.album_title, 256),
    file_path: sanitizeUiText(item.file_path, 4096),
    media_fingerprint: sanitizeUiText(item.media_fingerprint, 128),
    updated_at: sanitizeUiText(item.updated_at, 128)
  };
}

function sanitizeCatalogTrackDetail(detail: CatalogTrackDetailResponse): CatalogTrackDetailResponse {
  return {
    ...detail,
    title: sanitizeUiText(detail.title, 256),
    artist_name: sanitizeUiText(detail.artist_name, 256),
    album_title: detail.album_title == null ? detail.album_title : sanitizeUiText(detail.album_title, 256),
    file_path: sanitizeUiText(detail.file_path, 4096),
    media_fingerprint: sanitizeUiText(detail.media_fingerprint, 128),
    visibility_policy: sanitizeUiText(detail.visibility_policy, 64),
    license_policy: sanitizeUiText(detail.license_policy, 64),
    tags: detail.tags.map((tag) => sanitizeUiText(tag, 64)).filter(Boolean),
    created_at: sanitizeUiText(detail.created_at, 128),
    updated_at: sanitizeUiText(detail.updated_at, 128),
    track: sanitizeTrackModel(detail.track)
  };
}

function sanitizeImportFailure(item: CatalogImportFailure): CatalogImportFailure {
  return {
    path: sanitizeUiText(item.path, 4096),
    code: sanitizeUiText(item.code, 64),
    message: sanitizeUiText(item.message, 256)
  };
}

function sanitizeLibraryRoot(root: LibraryRootResponse): LibraryRootResponse {
  return {
    ...root,
    root_id: sanitizeUiText(root.root_id, 128),
    path: sanitizeUiText(root.path, 4096),
    created_at: sanitizeUiText(root.created_at, 128),
    updated_at: sanitizeUiText(root.updated_at, 128)
  };
}

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
  const response = await invokeCommand<CatalogImportFilesResponse>("catalog_import_files", { paths });
  return {
    imported: response.imported.map(sanitizeCatalogTrackListItem),
    failed: response.failed.map(sanitizeImportFailure)
  };
}

export async function catalogListTracks(
  query?: CatalogListTracksInput
): Promise<CatalogListTracksResponse> {
  const response = await invokeCommand<CatalogListTracksResponse>("catalog_list_tracks", { query });
  return {
    ...response,
    items: response.items.map(sanitizeCatalogTrackListItem)
  };
}

export async function catalogGetTrack(trackId: string): Promise<CatalogTrackDetailResponse | null> {
  const response = await invokeCommand<CatalogTrackDetailResponse | null>("catalog_get_track", { trackId });
  return response ? sanitizeCatalogTrackDetail(response) : null;
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
  const response = await invokeCommand<CatalogTrackDetailResponse>("catalog_update_track_metadata", { input });
  return sanitizeCatalogTrackDetail(response);
}

export async function catalogAddLibraryRoot(path: string): Promise<LibraryRootResponse> {
  const response = await invokeCommand<LibraryRootResponse>("catalog_add_library_root", { path });
  return sanitizeLibraryRoot(response);
}

export async function catalogListLibraryRoots(): Promise<LibraryRootResponse[]> {
  const response = await invokeCommand<LibraryRootResponse[]>("catalog_list_library_roots");
  return response.map(sanitizeLibraryRoot);
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
