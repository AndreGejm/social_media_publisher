import { sanitizeUiText } from "../../../shared/lib/ui-sanitize";
import { invokeCommand } from "../core";
import {
  assertHexId,
  assertInteger,
  assertNonEmptyString,
  assertPath,
  assertString,
  assertStringWithMaxLength,
  invalidArgument
} from "../core/validation";
import type {
  CatalogImportFailure,
  CatalogImportFilesResponse,
  CatalogIngestJobResponse,
  CatalogListTracksInput,
  CatalogListTracksResponse,
  CatalogScanRootResponse,
  CatalogTrackDetailResponse,
  CatalogTrackListItem,
  CatalogUpdateTrackMetadataInput,
  LibraryRootResponse,
  TrackModel
} from "./types";

const MAX_CATALOG_TRACK_SEARCH_CHARS = 512;
const MAX_CATALOG_IMPORT_FILE_PATHS = 200;
const MAX_CATALOG_TRACK_TAGS = 32;
const MAX_CATALOG_TAG_LABEL_CHARS = 64;

const ALLOWED_TRACK_VISIBILITY_POLICIES = new Set(["LOCAL", "PRIVATE", "SHARE_EXPORT_READY"]);
const ALLOWED_TRACK_LICENSE_POLICIES = new Set([
  "ALL_RIGHTS_RESERVED",
  "CC_BY",
  "CC_BY_SA",
  "CC_BY_NC",
  "CC0",
  "CUSTOM"
]);

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

export async function catalogImportFiles(paths: string[]): Promise<CatalogImportFilesResponse> {
  if (!Array.isArray(paths)) {
    throw invalidArgument("paths must be an array of file paths.");
  }
  if (paths.length > MAX_CATALOG_IMPORT_FILE_PATHS) {
    throw invalidArgument(
      `paths accepts at most ${MAX_CATALOG_IMPORT_FILE_PATHS} entries per request.`
    );
  }
  for (let index = 0; index < paths.length; index += 1) {
    assertPath(paths[index], `paths[${index}]`);
  }

  const response = await invokeCommand<CatalogImportFilesResponse>("catalog_import_files", { paths });
  return {
    imported: response.imported.map(sanitizeCatalogTrackListItem),
    failed: response.failed.map(sanitizeImportFailure)
  };
}

export async function catalogListTracks(
  query?: CatalogListTracksInput
): Promise<CatalogListTracksResponse> {
  if (query?.search != null) {
    assertString(query.search, "query.search");
    assertStringWithMaxLength(
      query.search,
      "query.search",
      MAX_CATALOG_TRACK_SEARCH_CHARS
    );
  }
  if (query?.limit != null) {
    assertInteger(query.limit, "query.limit");
    if (query.limit < 0) {
      throw invalidArgument("query.limit must be greater than or equal to 0.");
    }
  }
  if (query?.offset != null) {
    assertInteger(query.offset, "query.offset");
    if (query.offset < 0) {
      throw invalidArgument("query.offset must be greater than or equal to 0.");
    }
  }

  const response = await invokeCommand<CatalogListTracksResponse>("catalog_list_tracks", { query });
  return {
    ...response,
    items: response.items.map(sanitizeCatalogTrackListItem)
  };
}

export async function catalogGetTrack(trackId: string): Promise<CatalogTrackDetailResponse | null> {
  const normalizedTrackId = assertHexId(trackId, "trackId");
  const response = await invokeCommand<CatalogTrackDetailResponse | null>("catalog_get_track", {
    trackId: normalizedTrackId
  });
  return response ? sanitizeCatalogTrackDetail(response) : null;
}

export async function catalogUpdateTrackMetadata(
  input: CatalogUpdateTrackMetadataInput
): Promise<CatalogTrackDetailResponse> {
  const normalizedTrackId = assertHexId(input.track_id, "input.track_id");
  assertString(input.visibility_policy, "input.visibility_policy");
  assertString(input.license_policy, "input.license_policy");
  if (!ALLOWED_TRACK_VISIBILITY_POLICIES.has(input.visibility_policy)) {
    throw invalidArgument("input.visibility_policy is unsupported.", {
      allowed: [...ALLOWED_TRACK_VISIBILITY_POLICIES]
    });
  }
  if (!ALLOWED_TRACK_LICENSE_POLICIES.has(input.license_policy)) {
    throw invalidArgument("input.license_policy is unsupported.", {
      allowed: [...ALLOWED_TRACK_LICENSE_POLICIES]
    });
  }
  if (typeof input.downloadable !== "boolean") {
    throw invalidArgument("input.downloadable must be a boolean.");
  }
  if (!Array.isArray(input.tags)) {
    throw invalidArgument("input.tags must be an array of strings.");
  }
  if (input.tags.length > MAX_CATALOG_TRACK_TAGS) {
    throw invalidArgument(`input.tags accepts at most ${MAX_CATALOG_TRACK_TAGS} values.`);
  }

  const normalizedTags = input.tags.map((tag, index) => {
    assertString(tag, `input.tags[${index}]`);
    assertNonEmptyString(tag, `input.tags[${index}]`);
    assertStringWithMaxLength(tag, `input.tags[${index}]`, MAX_CATALOG_TAG_LABEL_CHARS);
    return tag.trim();
  });

  const response = await invokeCommand<CatalogTrackDetailResponse>("catalog_update_track_metadata", {
    input: {
      track_id: normalizedTrackId,
      visibility_policy: input.visibility_policy,
      license_policy: input.license_policy,
      downloadable: input.downloadable,
      tags: normalizedTags
    }
  });
  return sanitizeCatalogTrackDetail(response);
}

export async function catalogAddLibraryRoot(path: string): Promise<LibraryRootResponse> {
  assertPath(path, "path");
  const response = await invokeCommand<LibraryRootResponse>("catalog_add_library_root", { path });
  return sanitizeLibraryRoot(response);
}

export async function catalogListLibraryRoots(): Promise<LibraryRootResponse[]> {
  const response = await invokeCommand<LibraryRootResponse[]>("catalog_list_library_roots");
  return response.map(sanitizeLibraryRoot);
}

export async function catalogRemoveLibraryRoot(rootId: string): Promise<boolean> {
  const normalizedRootId = assertHexId(rootId, "rootId");
  return invokeCommand<boolean>("catalog_remove_library_root", { rootId: normalizedRootId });
}

export async function catalogResetLibraryData(): Promise<boolean> {
  return invokeCommand<boolean>("catalog_reset_library_data");
}

export async function catalogScanRoot(rootId: string): Promise<CatalogScanRootResponse> {
  const normalizedRootId = assertHexId(rootId, "rootId");
  return invokeCommand<CatalogScanRootResponse>("catalog_scan_root", { rootId: normalizedRootId });
}

export async function catalogGetIngestJob(jobId: string): Promise<CatalogIngestJobResponse | null> {
  const normalizedJobId = assertHexId(jobId, "jobId");
  return invokeCommand<CatalogIngestJobResponse | null>("catalog_get_ingest_job", {
    jobId: normalizedJobId
  });
}

export async function catalogCancelIngestJob(jobId: string): Promise<boolean> {
  const normalizedJobId = assertHexId(jobId, "jobId");
  return invokeCommand<boolean>("catalog_cancel_ingest_job", { jobId: normalizedJobId });
}
