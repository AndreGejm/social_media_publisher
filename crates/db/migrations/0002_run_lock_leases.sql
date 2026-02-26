ALTER TABLE run_locks
ADD COLUMN owner_epoch INTEGER NOT NULL DEFAULT 0 CHECK (owner_epoch >= 0);

ALTER TABLE run_locks
ADD COLUMN lease_expires_at_unix_ms INTEGER NOT NULL DEFAULT 9223372036854775807
CHECK (lease_expires_at_unix_ms >= 0);
