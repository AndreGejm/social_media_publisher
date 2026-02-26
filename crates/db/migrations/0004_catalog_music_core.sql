CREATE TABLE IF NOT EXISTS library_roots (
  root_id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS catalog_media_assets (
  media_asset_id TEXT PRIMARY KEY,
  content_fingerprint TEXT NOT NULL UNIQUE CHECK (length(content_fingerprint) = 64),
  primary_file_path TEXT NOT NULL,
  file_size_bytes INTEGER,
  mime_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS catalog_media_asset_locations (
  media_asset_id TEXT NOT NULL,
  file_path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (media_asset_id, file_path),
  FOREIGN KEY (media_asset_id) REFERENCES catalog_media_assets(media_asset_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS catalog_artists (
  artist_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS artwork_assets (
  artwork_asset_id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL UNIQUE,
  mime_type TEXT,
  width_px INTEGER,
  height_px INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS catalog_albums (
  album_id TEXT PRIMARY KEY,
  artist_id TEXT,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  artwork_asset_id TEXT,
  release_year INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (artist_id, normalized_title),
  FOREIGN KEY (artist_id) REFERENCES catalog_artists(artist_id) ON DELETE SET NULL,
  FOREIGN KEY (artwork_asset_id) REFERENCES artwork_assets(artwork_asset_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS catalog_tracks (
  track_id TEXT PRIMARY KEY,
  media_asset_id TEXT NOT NULL UNIQUE,
  artist_id TEXT NOT NULL,
  album_id TEXT,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  track_number INTEGER,
  duration_ms INTEGER NOT NULL CHECK (duration_ms > 0),
  peak_data_json TEXT NOT NULL,
  loudness_lufs REAL NOT NULL CHECK (loudness_lufs <= 0),
  true_peak_dbfs REAL,
  sample_rate_hz INTEGER NOT NULL CHECK (sample_rate_hz > 0),
  channels INTEGER NOT NULL CHECK (channels > 0),
  visibility_policy TEXT NOT NULL DEFAULT 'LOCAL',
  license_policy TEXT NOT NULL DEFAULT 'ALL_RIGHTS_RESERVED',
  downloadable INTEGER NOT NULL DEFAULT 0 CHECK (downloadable IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (media_asset_id) REFERENCES catalog_media_assets(media_asset_id) ON DELETE CASCADE,
  FOREIGN KEY (artist_id) REFERENCES catalog_artists(artist_id) ON DELETE RESTRICT,
  FOREIGN KEY (album_id) REFERENCES catalog_albums(album_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS album_tracks (
  album_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (album_id, track_id),
  UNIQUE (album_id, position),
  FOREIGN KEY (album_id) REFERENCES catalog_albums(album_id) ON DELETE CASCADE,
  FOREIGN KEY (track_id) REFERENCES catalog_tracks(track_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS playlists (
  playlist_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  visibility_policy TEXT NOT NULL DEFAULT 'LOCAL',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS playlist_items (
  playlist_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (playlist_id, track_id),
  UNIQUE (playlist_id, position),
  FOREIGN KEY (playlist_id) REFERENCES playlists(playlist_id) ON DELETE CASCADE,
  FOREIGN KEY (track_id) REFERENCES catalog_tracks(track_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tags (
  tag_id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  normalized_label TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS track_tags (
  track_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (track_id, tag_id),
  FOREIGN KEY (track_id) REFERENCES catalog_tracks(track_id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(tag_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS album_tags (
  album_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (album_id, tag_id),
  FOREIGN KEY (album_id) REFERENCES catalog_albums(album_id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(tag_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS track_analysis_cache (
  track_id TEXT PRIMARY KEY,
  media_fingerprint TEXT NOT NULL CHECK (length(media_fingerprint) = 64),
  duration_ms INTEGER NOT NULL CHECK (duration_ms > 0),
  peak_data_json TEXT NOT NULL,
  loudness_lufs REAL NOT NULL CHECK (loudness_lufs <= 0),
  true_peak_dbfs REAL,
  sample_rate_hz INTEGER NOT NULL CHECK (sample_rate_hz > 0),
  channels INTEGER NOT NULL CHECK (channels > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (track_id) REFERENCES catalog_tracks(track_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ingest_jobs (
  job_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  scope TEXT NOT NULL,
  total_items INTEGER NOT NULL DEFAULT 0 CHECK (total_items >= 0),
  processed_items INTEGER NOT NULL DEFAULT 0 CHECK (processed_items >= 0),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ingest_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES ingest_jobs(job_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_catalog_tracks_updated_at
ON catalog_tracks(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_catalog_tracks_artist_id
ON catalog_tracks(artist_id);

CREATE INDEX IF NOT EXISTS idx_catalog_tracks_album_id
ON catalog_tracks(album_id);

CREATE INDEX IF NOT EXISTS idx_catalog_media_asset_locations_file_path
ON catalog_media_asset_locations(file_path);

