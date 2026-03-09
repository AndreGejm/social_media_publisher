import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { sanitizeUiText } from "./ui-sanitize";

export type UiAppError = { code: string; message: string; details?: unknown };

export function isUiAppError(error: unknown): error is UiAppError {
  return (
    error != null &&
    typeof error === "object" &&
    "code" in error &&
    "message" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}
const DIRECTORY_PICKER_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_IPC_PATH_CHARS = 4096;
const MAX_CATALOG_TRACK_SEARCH_CHARS = 512;
const MAX_CATALOG_IMPORT_FILE_PATHS = 200;
const MAX_PLAYBACK_QUEUE_TRACKS = 10_000;
const MAX_PLAYBACK_QUEUE_INDEX = 9_999;
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

function invalidArgument(message: string, details?: unknown): UiAppError {
  return {
    code: "INVALID_ARGUMENT",
    message,
    details
  };
}

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw invalidArgument(`${label} must be a finite number.`);
  }
}

function assertInteger(value: number, label: string): void {
  assertFiniteNumber(value, label);
  if (!Number.isInteger(value)) {
    throw invalidArgument(`${label} must be an integer.`);
  }
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") {
    throw invalidArgument(`${label} must be a string.`);
  }
}

function assertStringWithMaxLength(value: string, label: string, maxLength: number): void {
  if (value.length > maxLength) {
    throw invalidArgument(`${label} exceeds maximum length of ${maxLength} characters.`);
  }
}

function assertNonEmptyString(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw invalidArgument(`${label} cannot be empty.`);
  }
}

function assertPath(value: unknown, label: string): string {
  assertString(value, label);
  assertNonEmptyString(value, label);
  assertStringWithMaxLength(value, label, MAX_IPC_PATH_CHARS);
  return value;
}

function assertHexId(value: unknown, label: string): string {
  assertString(value, label);
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw invalidArgument(`${label} must be a 64-character hex string.`);
  }
  return normalized;
}

function assertQcProfileId(value: unknown, label: string): string {
  assertString(value, label);
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(normalized)) {
    throw invalidArgument(`${label} must contain only a-z, 0-9, '_' or '-'.`);
  }
  return normalized;
}

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

export type AudioHardwareState = {
  sample_rate_hz: number;
  bit_depth: number;
  buffer_size_frames: number;
  is_exclusive_lock: boolean;
};

export type PlaybackQueueState = {
  total_tracks: number;
};

export type PlaybackContextState = {
  volume_scalar: number;
  is_bit_perfect_bypassed: boolean;
  active_queue_index: number;
  is_queue_ui_expanded: boolean;
  queued_track_change_requests: number;
  is_playing?: boolean;
  position_seconds?: number;
  track_duration_seconds?: number;
};

export type QcFeatureFlagsResponse = {
  qc_codec_preview_v1: boolean;
  qc_realtime_meters_v1: boolean;
  qc_batch_export_v1: boolean;
};

// Single source of truth — both the TypeScript type and runtime validation
// array are derived from this const so they can never drift apart.
export const QC_PREVIEW_VARIANTS = ["bypass", "codec_a", "codec_b", "blind_x"] as const;
export type QcPreviewVariant = (typeof QC_PREVIEW_VARIANTS)[number];

export type QcCodecFamily = "opus" | "vorbis" | "aac" | "mp3";

export type QcCodecProfileResponse = {
  profile_id: string;
  label: string;
  codec_family: QcCodecFamily;
  target_platform: string;
  target_bitrate_kbps: number;
  expected_latency_ms: number;
  available: boolean;
};

export type QcPreparePreviewSessionInput = {
  source_track_id: string;
  profile_a_id: string;
  profile_b_id: string;
  blind_x_enabled: boolean;
};

export type QcPreviewSessionStateResponse = {
  source_track_id: string;
  active_variant: QcPreviewVariant;
  profile_a_id: string;
  profile_b_id: string;
  blind_x_enabled: boolean;
  blind_x_revealed: boolean;
};

export type QcPreviewActiveMediaResponse = {
  variant: QcPreviewVariant;
  media_path: string;
  blind_x_resolved_variant: QcPreviewVariant | null;
};

export type QcBatchExportStartInput = {
  source_track_id: string;
  profile_ids: string[];
  output_dir: string;
  target_integrated_lufs?: number | null;
};

export type QcBatchExportStartResponse = {
  job_id: string;
  status: string;
  message: string;
};

export type QcBatchExportProfileStatusResponse = {
  profile_id: string;
  codec_family: QcCodecFamily;
  target_platform: string;
  target_bitrate_kbps: number;
  status: string;
  progress_percent: number;
  output_path: string | null;
  output_bytes: number | null;
  message: string | null;
};

export type QcBatchExportJobStatusResponse = {
  job_id: string;
  source_track_id: string;
  output_dir: string;
  requested_profile_ids: string[];
  requested_target_integrated_lufs: number | null;
  status: string;
  progress_percent: number;
  total_profiles: number;
  completed_profiles: number;
  failed_profiles: number;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  summary_path: string | null;
  profiles: QcBatchExportProfileStatusResponse[];
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

function sanitizeQcCodecProfile(profile: QcCodecProfileResponse): QcCodecProfileResponse {
  return {
    ...profile,
    profile_id: sanitizeUiText(profile.profile_id, 128),
    label: sanitizeUiText(profile.label, 256),
    target_platform: sanitizeUiText(profile.target_platform, 128)
  };
}

function sanitizeQcPreviewState(
  state: QcPreviewSessionStateResponse
): QcPreviewSessionStateResponse {
  return {
    ...state,
    source_track_id: sanitizeUiText(state.source_track_id, 128),
    profile_a_id: sanitizeUiText(state.profile_a_id, 128),
    profile_b_id: sanitizeUiText(state.profile_b_id, 128)
  };
}

function sanitizeQcPreviewActiveMedia(
  response: QcPreviewActiveMediaResponse
): QcPreviewActiveMediaResponse {
  return {
    ...response,
    media_path: sanitizeUiText(response.media_path, 4096),
    blind_x_resolved_variant: response.blind_x_resolved_variant ?? null
  };
}

function sanitizeQcBatchExportJobStatus(
  status: QcBatchExportJobStatusResponse
): QcBatchExportJobStatusResponse {
  return {
    ...status,
    job_id: sanitizeUiText(status.job_id, 128),
    source_track_id: sanitizeUiText(status.source_track_id, 128),
    output_dir: sanitizeUiText(status.output_dir, 4096),
    requested_profile_ids: status.requested_profile_ids.map((item) => sanitizeUiText(item, 128)).filter(Boolean),
    status: sanitizeUiText(status.status, 64),
    summary_path: status.summary_path ? sanitizeUiText(status.summary_path, 4096) : null,
    profiles: status.profiles.map((profile) => ({
      ...profile,
      profile_id: sanitizeUiText(profile.profile_id, 128),
      target_platform: sanitizeUiText(profile.target_platform, 128),
      status: sanitizeUiText(profile.status, 64),
      output_path: profile.output_path ? sanitizeUiText(profile.output_path, 4096) : null,
      message: profile.message ? sanitizeUiText(profile.message, 256) : null
    }))
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

export async function publisherCreateDraftFromTrack(
  trackId: string
): Promise<PublisherCreateDraftFromTrackResponse> {
  const normalizedTrackId = assertHexId(trackId, "trackId");
  return invokeCommand<PublisherCreateDraftFromTrackResponse>("publisher_create_draft_from_track", {
    trackId: normalizedTrackId
  });
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
  return invokeCommand<CatalogIngestJobResponse | null>("catalog_get_ingest_job", { jobId: normalizedJobId });
}

export async function catalogCancelIngestJob(jobId: string): Promise<boolean> {
  const normalizedJobId = assertHexId(jobId, "jobId");
  return invokeCommand<boolean>("catalog_cancel_ingest_job", { jobId: normalizedJobId });
}

export async function initExclusiveDevice(
  targetRateHz: number,
  targetBitDepth: number
): Promise<AudioHardwareState> {
  assertInteger(targetRateHz, "targetRateHz");
  assertInteger(targetBitDepth, "targetBitDepth");
  if (targetRateHz < 8_000 || targetRateHz > 384_000) {
    throw invalidArgument("targetRateHz must be between 8000 and 384000.");
  }
  if (targetBitDepth < 8 || targetBitDepth > 64) {
    throw invalidArgument("targetBitDepth must be between 8 and 64.");
  }
  return invokeCommand<AudioHardwareState>("init_exclusive_device", {
    targetRateHz,
    targetBitDepth
  });
}

export async function setPlaybackVolume(level: number): Promise<void> {
  assertFiniteNumber(level, "level");
  if (level < 0 || level > 1) {
    throw invalidArgument("level must be between 0 and 1.");
  }
  await invokeCommand<void>("set_volume", { level });
}

export async function setPlaybackQueue(paths: string[]): Promise<PlaybackQueueState> {
  if (!Array.isArray(paths)) {
    throw invalidArgument("paths must be an array of file paths.");
  }
  if (paths.length > MAX_PLAYBACK_QUEUE_TRACKS) {
    throw invalidArgument(
      `paths accepts at most ${MAX_PLAYBACK_QUEUE_TRACKS} entries for playback queue sync.`
    );
  }
  for (let index = 0; index < paths.length; index += 1) {
    assertPath(paths[index], `paths[${index}]`);
  }
  return invokeCommand<PlaybackQueueState>("set_playback_queue", { paths });
}

export async function pushPlaybackTrackChangeRequest(newIndex: number): Promise<boolean> {
  assertInteger(newIndex, "newIndex");
  if (newIndex < 0 || newIndex > MAX_PLAYBACK_QUEUE_INDEX) {
    throw invalidArgument(`newIndex must be between 0 and ${MAX_PLAYBACK_QUEUE_INDEX}.`);
  }
  return invokeCommand<boolean>("push_track_change_request", { newIndex });
}

export async function setPlaybackPlaying(isPlaying: boolean): Promise<void> {
  if (typeof isPlaying !== "boolean") {
    throw invalidArgument("isPlaying must be a boolean.");
  }
  await invokeCommand<void>("set_playback_playing", { isPlaying });
}

export async function seekPlaybackRatio(ratio: number): Promise<void> {
  assertFiniteNumber(ratio, "ratio");
  if (ratio < 0 || ratio > 1) {
    throw invalidArgument("ratio must be between 0 and 1.");
  }
  await invokeCommand<void>("seek_playback_ratio", { ratio });
}

export async function getPlaybackContext(): Promise<PlaybackContextState> {
  return invokeCommand<PlaybackContextState>("get_playback_context");
}

export async function getPlaybackDecodeError(): Promise<string | null> {
  return invokeCommand<string | null>("get_playback_decode_error");
}

export async function qcGetFeatureFlags(): Promise<QcFeatureFlagsResponse> {
  return invokeCommand<QcFeatureFlagsResponse>("qc_get_feature_flags");
}

export async function qcListCodecProfiles(): Promise<QcCodecProfileResponse[]> {
  const response = await invokeCommand<QcCodecProfileResponse[]>("qc_list_codec_profiles");
  return response.map(sanitizeQcCodecProfile);
}

export async function qcPreparePreviewSession(
  input: QcPreparePreviewSessionInput
): Promise<QcPreviewSessionStateResponse> {
  const sourceTrackId = assertHexId(input.source_track_id, "input.source_track_id");
  const profileAId = assertQcProfileId(input.profile_a_id, "input.profile_a_id");
  const profileBId = assertQcProfileId(input.profile_b_id, "input.profile_b_id");
  if (profileAId === profileBId) {
    throw invalidArgument("input.profile_a_id and input.profile_b_id must be different.");
  }
  if (typeof input.blind_x_enabled !== "boolean") {
    throw invalidArgument("input.blind_x_enabled must be a boolean.");
  }
  const response = await invokeCommand<QcPreviewSessionStateResponse>("qc_prepare_preview_session", {
    input: {
      source_track_id: sourceTrackId,
      profile_a_id: profileAId,
      profile_b_id: profileBId,
      blind_x_enabled: input.blind_x_enabled
    }
  });
  return sanitizeQcPreviewState(response);
}

export async function qcGetPreviewSession(): Promise<QcPreviewSessionStateResponse | null> {
  const response = await invokeCommand<QcPreviewSessionStateResponse | null>("qc_get_preview_session");
  return response ? sanitizeQcPreviewState(response) : null;
}

export async function qcSetPreviewVariant(
  variant: QcPreviewVariant
): Promise<QcPreviewSessionStateResponse> {
  if (!QC_PREVIEW_VARIANTS.includes(variant)) {
    throw invalidArgument("variant must be one of: bypass, codec_a, codec_b, blind_x.");
  }
  const response = await invokeCommand<QcPreviewSessionStateResponse>("qc_set_preview_variant", {
    variant
  });
  return sanitizeQcPreviewState(response);
}

export async function qcRevealBlindX(): Promise<QcPreviewSessionStateResponse> {
  const response = await invokeCommand<QcPreviewSessionStateResponse>("qc_reveal_blind_x");
  return sanitizeQcPreviewState(response);
}

export async function qcGetActivePreviewMedia(): Promise<QcPreviewActiveMediaResponse> {
  const response = await invokeCommand<QcPreviewActiveMediaResponse>("qc_get_active_preview_media");
  return sanitizeQcPreviewActiveMedia(response);
}

export async function qcStartBatchExport(
  input: QcBatchExportStartInput
): Promise<QcBatchExportStartResponse> {
  const sourceTrackId = assertHexId(input.source_track_id, "input.source_track_id");
  assertPath(input.output_dir, "input.output_dir");
  if (!Array.isArray(input.profile_ids) || input.profile_ids.length === 0) {
    throw invalidArgument("input.profile_ids must include at least one profile id.");
  }
  const profileIds = input.profile_ids.map((profileId, index) =>
    assertQcProfileId(profileId, `input.profile_ids[${index}]`)
  );
  if (input.target_integrated_lufs != null) {
    assertFiniteNumber(input.target_integrated_lufs, "input.target_integrated_lufs");
  }
  return invokeCommand<QcBatchExportStartResponse>("qc_start_batch_export", {
    input: {
      source_track_id: sourceTrackId,
      profile_ids: profileIds,
      output_dir: input.output_dir,
      target_integrated_lufs: input.target_integrated_lufs ?? null
    }
  });
}

export async function qcGetBatchExportJobStatus(
  jobId: string
): Promise<QcBatchExportJobStatusResponse | null> {
  const normalizedJobId = assertHexId(jobId, "jobId");
  const response = await invokeCommand<QcBatchExportJobStatusResponse | null>(
    "qc_get_batch_export_job_status",
    { jobId: normalizedJobId }
  );
  return response ? sanitizeQcBatchExportJobStatus(response) : null;
}

export async function togglePlaybackQueueVisibility(): Promise<void> {
  await invokeCommand<void>("toggle_queue_visibility");
}

export async function pickDirectoryDialog(
  options?: { title?: string }
): Promise<string | null> {
  let timeoutId: number | undefined;
  try {
    const dialog = await import("@tauri-apps/plugin-dialog");
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(() => {
        reject({
          code: "TAURI_DIALOG_TIMEOUT",
          message: "Folder picker timed out after 10 minutes. Retry browsing for a folder."
        } satisfies UiAppError);
      }, DIRECTORY_PICKER_TIMEOUT_MS);
    });

    const selected = await Promise.race([
      dialog.open({
        directory: true,
        multiple: false,
        title: options?.title ?? "Select Folder"
      }),
      timeoutPromise
    ]);
    return typeof selected === "string" ? selected : null;
  } catch (error) {
    if (isUiAppError(error)) {
      throw error;
    }
    throw {
      code: "TAURI_DIALOG_UNAVAILABLE",
      message: "Native folder picker is not available in this runtime."
    } satisfies UiAppError;
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
}
