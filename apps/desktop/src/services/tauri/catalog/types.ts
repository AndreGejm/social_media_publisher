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
