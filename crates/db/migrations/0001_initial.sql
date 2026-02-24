CREATE TABLE IF NOT EXISTS releases (
  release_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('VALIDATED','PLANNED','EXECUTING','VERIFIED','COMMITTED','FAILED')),
  spec_hash TEXT NOT NULL CHECK (length(spec_hash) = 64),
  media_fingerprint TEXT NOT NULL CHECK (length(media_fingerprint) = 64),
  normalized_spec_json TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS platform_actions (
  release_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PLANNED','EXECUTING','VERIFIED','FAILED','SKIPPED')),
  plan_json TEXT,
  result_json TEXT,
  external_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (release_id, platform),
  FOREIGN KEY (release_id) REFERENCES releases(release_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (release_id) REFERENCES releases(release_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS run_locks (
  release_id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (release_id) REFERENCES releases(release_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_releases_updated_at ON releases(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_actions_release ON platform_actions(release_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_release ON audit_logs(release_id, id);
