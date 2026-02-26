CREATE TABLE IF NOT EXISTS release_track_analysis (
  release_id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  media_fingerprint TEXT NOT NULL CHECK (length(media_fingerprint) = 64),
  duration_ms INTEGER NOT NULL CHECK (duration_ms > 0),
  peak_data_json TEXT NOT NULL,
  loudness_lufs REAL NOT NULL CHECK (loudness_lufs <= 0),
  sample_rate_hz INTEGER NOT NULL CHECK (sample_rate_hz > 0),
  channels INTEGER NOT NULL CHECK (channels > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (release_id) REFERENCES releases(release_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_release_track_analysis_updated_at
ON release_track_analysis(updated_at DESC);
