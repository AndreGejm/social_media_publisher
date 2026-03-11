#![deny(warnings)]

//! SQLite persistence layer for the deterministic release pipeline.
//!
//! This crate owns state transitions, audit logging, QC analysis persistence and
//! retry behavior for transient SQLite `database is locked` conditions.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{
    sqlite::{SqlitePoolOptions, SqliteRow},
    Executor, Row, Sqlite, SqlitePool, Transaction,
};
use std::{collections::BTreeSet, future::Future, str::FromStr, time::Duration};

static MIGRATOR: sqlx::migrate::Migrator = {
    let mut migrator = sqlx::migrate!("./migrations");
    // Allow startup across builds where a historical migration version may not
    // be present in the currently resolved migration source.
    migrator.ignore_missing = true;
    migrator
};

pub type DbResult<T> = Result<T, DbError>;

/// Retry policy used for transient SQLite busy/locked errors.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct DbBusyRetryPolicy {
    /// Total attempts, including the initial call.
    pub max_attempts: u32,
    /// Base delay used for exponential backoff.
    pub base_delay_ms: u64,
    /// Hard cap for a single backoff delay.
    pub max_delay_ms: u64,
    /// Jitter percentage applied to the computed delay.
    pub jitter_ratio_pct: u8,
    /// Deterministic jitter seed so tests remain stable.
    pub jitter_seed: u64,
}

impl Default for DbBusyRetryPolicy {
    fn default() -> Self {
        Self {
            max_attempts: 4,
            base_delay_ms: 25,
            max_delay_ms: 250,
            jitter_ratio_pct: 20,
            jitter_seed: 0xA3D9_4E2B_17C8_F005,
        }
    }
}

impl DbBusyRetryPolicy {
    /// Validates retry policy bounds before use.
    pub fn validate(&self) -> DbResult<()> {
        if self.max_attempts == 0 {
            return Err(DbError::new(
                DbErrorCode::Query,
                "db busy retry max_attempts must be >= 1",
            ));
        }
        if self.base_delay_ms == 0 {
            return Err(DbError::new(
                DbErrorCode::Query,
                "db busy retry base_delay_ms must be >= 1",
            ));
        }
        if self.max_delay_ms < self.base_delay_ms {
            return Err(DbError::new(
                DbErrorCode::Query,
                "db busy retry max_delay_ms must be >= base_delay_ms",
            ));
        }
        if self.jitter_ratio_pct > 100 {
            return Err(DbError::new(
                DbErrorCode::Query,
                "db busy retry jitter_ratio_pct must be <= 100",
            ));
        }
        Ok(())
    }
}

/// Retries an async DB operation only when it fails with [`DbErrorCode::BusyLocked`].
pub async fn retry_busy_locked<T, F, Fut>(policy: &DbBusyRetryPolicy, op: F) -> DbResult<T>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = DbResult<T>>,
{
    retry_busy_locked_with_sleep(policy, op, |delay_ms| async move {
        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
    })
    .await
}

/// Retries an async DB operation with an injected sleep function (for tests/fault injection).
pub async fn retry_busy_locked_with_sleep<T, F, Fut, S, SleepFut>(
    policy: &DbBusyRetryPolicy,
    mut op: F,
    mut sleep_fn: S,
) -> DbResult<T>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = DbResult<T>>,
    S: FnMut(u64) -> SleepFut,
    SleepFut: Future<Output = ()>,
{
    policy.validate()?;

    for attempt in 1..=policy.max_attempts {
        match op().await {
            Ok(value) => return Ok(value),
            Err(error)
                if error.code == DbErrorCode::BusyLocked && attempt < policy.max_attempts =>
            {
                let delay_ms = db_busy_retry_delay_ms(policy, attempt);
                sleep_fn(delay_ms).await;
            }
            Err(error) => return Err(error),
        }
    }

    Err(DbError::new(
        DbErrorCode::BusyLocked,
        "db busy retry loop exhausted without returning terminal result",
    ))
}

/// Computes an exponential backoff delay with deterministic bounded jitter.
pub fn db_busy_retry_delay_ms(policy: &DbBusyRetryPolicy, attempt: u32) -> u64 {
    let exp = attempt.saturating_sub(1).min(20);
    let multiplier = 1_u64 << exp;
    let base = policy
        .base_delay_ms
        .saturating_mul(multiplier)
        .min(policy.max_delay_ms);

    if policy.jitter_ratio_pct == 0 || base == 0 {
        return base;
    }

    let max_jitter = base
        .saturating_mul(u64::from(policy.jitter_ratio_pct))
        .saturating_div(100);
    if max_jitter == 0 {
        return base;
    }

    let mut x = policy.jitter_seed ^ ((attempt as u64) << 32) ^ 0x4442_4C4B; // "DBLK"
    x ^= x >> 12;
    x ^= x << 25;
    x ^= x >> 27;
    let jitter = x % (max_jitter + 1);
    base.saturating_add(jitter).min(policy.max_delay_ms)
}

/// Stable error codes returned by the persistence layer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DbErrorCode {
    Connection,
    Migration,
    ConstraintViolation,
    BusyLocked,
    NotFound,
    InvalidStateTransition,
    Serialization,
    Deserialization,
    RowDecode,
    Io,
    Query,
    Unknown,
}

/// Structured database error used across the state machine and IPC boundary.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct DbError {
    /// Machine-readable error category.
    pub code: DbErrorCode,
    /// Human-readable context-rich message.
    pub message: String,
}

impl DbError {
    /// Creates a new structured database error.
    pub fn new(code: DbErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn invalid_state_transition(message: impl Into<String>) -> Self {
        Self::new(DbErrorCode::InvalidStateTransition, message)
    }

    fn serialize_json(error: serde_json::Error) -> Self {
        Self::new(
            DbErrorCode::Serialization,
            format!("failed to serialize JSON: {error}"),
        )
    }

    fn deserialize_json(error: serde_json::Error) -> Self {
        Self::new(
            DbErrorCode::Deserialization,
            format!("failed to parse stored JSON: {error}"),
        )
    }

    fn map_sqlx(error: sqlx::Error, op: &str) -> Self {
        match error {
            sqlx::Error::RowNotFound => {
                Self::new(DbErrorCode::NotFound, format!("{op}: row not found"))
            }
            sqlx::Error::Io(err) => Self::new(DbErrorCode::Io, format!("{op}: {err}")),
            sqlx::Error::PoolTimedOut => Self::new(
                DbErrorCode::BusyLocked,
                format!("{op}: connection pool timed out"),
            ),
            sqlx::Error::PoolClosed => Self::new(
                DbErrorCode::Connection,
                format!("{op}: connection pool closed"),
            ),
            sqlx::Error::ColumnDecode { source, .. } | sqlx::Error::Decode(source) => {
                Self::new(DbErrorCode::RowDecode, format!("{op}: {source}"))
            }
            sqlx::Error::ColumnNotFound(column) => Self::new(
                DbErrorCode::RowDecode,
                format!("{op}: missing column `{column}`"),
            ),
            sqlx::Error::Database(db_err) => {
                let message = db_err.message().to_string();
                let sqlite_code = db_err.code().map(|code| code.to_string());
                let code = classify_sqlite_database_error(sqlite_code.as_deref(), &message);
                Self::new(code, format!("{op}: {message}"))
            }
            other => Self::new(DbErrorCode::Unknown, format!("{op}: {other}")),
        }
    }
}

fn classify_sqlite_database_error(sqlite_code: Option<&str>, message: &str) -> DbErrorCode {
    let lower = message.to_ascii_lowercase();
    if lower.contains("database is locked")
        || lower.contains("database schema is locked")
        || matches!(sqlite_code, Some("5") | Some("6"))
    {
        return DbErrorCode::BusyLocked;
    }

    if lower.contains("constraint failed")
        || lower.contains("foreign key constraint failed")
        || matches!(sqlite_code, Some(code) if code.starts_with("19"))
    {
        return DbErrorCode::ConstraintViolation;
    }

    DbErrorCode::Query
}

/// Deterministic pipeline states for a release row.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReleaseState {
    Validated,
    Planned,
    Executing,
    Verified,
    Committed,
    Failed,
}

impl ReleaseState {
    /// Returns the canonical storage string used in SQLite rows and reports.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Validated => "VALIDATED",
            Self::Planned => "PLANNED",
            Self::Executing => "EXECUTING",
            Self::Verified => "VERIFIED",
            Self::Committed => "COMMITTED",
            Self::Failed => "FAILED",
        }
    }

    /// Returns whether a transition is allowed by the state machine rules.
    pub fn can_transition_to(self, next: Self) -> bool {
        matches!(
            (self, next),
            (Self::Validated, Self::Planned)
                | (Self::Planned, Self::Executing)
                | (Self::Executing, Self::Verified)
                | (Self::Verified, Self::Committed)
                | (Self::Validated, Self::Failed)
                | (Self::Planned, Self::Failed)
                | (Self::Executing, Self::Failed)
                | (Self::Verified, Self::Failed)
                | (Self::Failed, Self::Planned)
                | (Self::Failed, Self::Executing)
                | (Self::Committed, Self::Executing)
        )
    }
}

impl FromStr for ReleaseState {
    type Err = DbError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "VALIDATED" => Ok(Self::Validated),
            "PLANNED" => Ok(Self::Planned),
            "EXECUTING" => Ok(Self::Executing),
            "VERIFIED" => Ok(Self::Verified),
            "COMMITTED" => Ok(Self::Committed),
            "FAILED" => Ok(Self::Failed),
            _ => Err(DbError::new(
                DbErrorCode::RowDecode,
                format!("unknown release state: {value}"),
            )),
        }
    }
}

/// Per-platform execution state tracked alongside the release state machine.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PlatformActionStatus {
    Planned,
    Executing,
    Verified,
    Failed,
    Skipped,
}

impl PlatformActionStatus {
    /// Returns the canonical storage string for the platform action status.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Planned => "PLANNED",
            Self::Executing => "EXECUTING",
            Self::Verified => "VERIFIED",
            Self::Failed => "FAILED",
            Self::Skipped => "SKIPPED",
        }
    }

    /// Returns `true` when the platform action no longer needs work for this run.
    pub fn is_completed(self) -> bool {
        matches!(self, Self::Verified | Self::Skipped)
    }
}

impl FromStr for PlatformActionStatus {
    type Err = DbError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "PLANNED" => Ok(Self::Planned),
            "EXECUTING" => Ok(Self::Executing),
            "VERIFIED" => Ok(Self::Verified),
            "FAILED" => Ok(Self::Failed),
            "SKIPPED" => Ok(Self::Skipped),
            _ => Err(DbError::new(
                DbErrorCode::RowDecode,
                format!("unknown platform status: {value}"),
            )),
        }
    }
}

/// Lightweight history projection used by the desktop UI history/report lists.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryItem {
    pub release_id: String,
    pub state: String,
    pub title: String,
    pub updated_at: String,
}

/// Persisted release row with normalized spec identity fields.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReleaseRecord {
    pub release_id: String,
    pub title: String,
    pub state: ReleaseState,
    pub spec_hash: String,
    pub media_fingerprint: String,
    pub normalized_spec_json: String,
    pub last_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Input payload used to insert or idempotently upsert a release row.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NewReleaseRecord {
    pub release_id: String,
    pub title: String,
    pub state: ReleaseState,
    pub spec_hash: String,
    pub media_fingerprint: String,
    pub normalized_spec_json: String,
}

/// Persisted per-platform execution row.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlatformActionRecord {
    pub release_id: String,
    pub platform: String,
    pub status: PlatformActionStatus,
    pub plan_json: Option<Value>,
    pub result_json: Option<Value>,
    pub external_id: Option<String>,
    pub attempt_count: i64,
    pub last_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Mutation input for inserting/updating a per-platform execution row.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UpsertPlatformAction {
    pub release_id: String,
    pub platform: String,
    pub status: PlatformActionStatus,
    pub plan_json: Option<Value>,
    pub result_json: Option<Value>,
    pub external_id: Option<String>,
    pub increment_attempt: bool,
    pub last_error: Option<String>,
}

/// Persisted audit log entry for plan/execute/verify/error stages.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuditLogEntry {
    pub id: i64,
    pub release_id: String,
    pub stage: String,
    pub message: String,
    pub payload_json: Option<String>,
    pub created_at: String,
}

/// Lease-based execution lock row used to guard concurrent runs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RunLockLeaseRecord {
    pub release_id: String,
    pub owner: String,
    pub owner_epoch: i64,
    pub lease_expires_at_unix_ms: i64,
    pub created_at: String,
}

/// Input payload for adding a new audit log entry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NewAuditLogEntry {
    pub release_id: String,
    pub stage: String,
    pub message: String,
    pub payload_json: Option<Value>,
}

/// Persisted QC audio-analysis metrics keyed by `release_id`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReleaseTrackAnalysisRecord {
    pub release_id: String,
    pub file_path: String,
    pub media_fingerprint: String,
    pub duration_ms: u32,
    pub peak_data: Vec<f32>,
    pub loudness_lufs: f32,
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub created_at: String,
    pub updated_at: String,
}

/// Input payload for upserting persisted QC audio-analysis metrics.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UpsertReleaseTrackAnalysis {
    pub release_id: String,
    pub file_path: String,
    pub media_fingerprint: String,
    pub duration_ms: u32,
    pub peak_data: Vec<f32>,
    pub loudness_lufs: f32,
    pub sample_rate_hz: u32,
    pub channels: u16,
}

/// Input payload for importing or re-importing a local catalog track.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UpsertCatalogTrackImport {
    pub track_id: String,
    pub media_asset_id: String,
    pub artist_id: String,
    pub album_id: Option<String>,
    pub file_path: String,
    pub media_fingerprint: String,
    pub title: String,
    pub artist_name: String,
    pub album_title: Option<String>,
    pub duration_ms: u32,
    pub peak_data: Vec<f32>,
    pub loudness_lufs: f32,
    pub true_peak_dbfs: Option<f32>,
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub visibility_policy: String,
    pub license_policy: String,
    pub downloadable: bool,
}

/// Input payload for updating editable catalog track metadata (authoring slice).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UpdateCatalogTrackMetadata {
    pub track_id: String,
    pub visibility_policy: String,
    pub license_policy: String,
    pub downloadable: bool,
    pub tags: Vec<CatalogTrackTagAssignment>,
}

/// One normalized tag assignment to attach to a catalog track.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CatalogTrackTagAssignment {
    pub tag_id: String,
    pub label: String,
}

/// Detailed catalog track projection used by the desktop library and player views.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CatalogTrackRecord {
    pub track_id: String,
    pub media_asset_id: String,
    pub media_fingerprint: String,
    pub file_path: String,
    pub title: String,
    pub artist_id: String,
    pub artist_name: String,
    pub album_id: Option<String>,
    pub album_title: Option<String>,
    pub duration_ms: u32,
    pub peak_data: Vec<f32>,
    pub loudness_lufs: f32,
    pub true_peak_dbfs: Option<f32>,
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub visibility_policy: String,
    pub license_policy: String,
    pub downloadable: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// Compact list item projection for catalog track browsing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CatalogTrackListItem {
    pub track_id: String,
    pub title: String,
    pub artist_name: String,
    pub album_title: Option<String>,
    pub duration_ms: u32,
    pub loudness_lufs: f32,
    pub file_path: String,
    pub media_fingerprint: String,
    pub updated_at: String,
}

/// Query params for paginated catalog track listing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CatalogListTracksQuery {
    pub search: Option<String>,
    pub limit: u32,
    pub offset: u32,
}

/// Paginated catalog track list result.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CatalogTrackListPage {
    pub items: Vec<CatalogTrackListItem>,
    pub total: u64,
    pub limit: u32,
    pub offset: u32,
}

/// Persisted local library root directory configuration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LibraryRootRecord {
    pub root_id: String,
    pub path: String,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// Input payload for adding/updating a library root.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UpsertLibraryRoot {
    pub root_id: String,
    pub path: String,
    pub enabled: bool,
}

/// Stable ingest job lifecycle statuses for local catalog scans/imports.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IngestJobStatus {
    Pending,
    Running,
    Completed,
    Canceled,
    Failed,
}

impl IngestJobStatus {
    /// Returns the canonical storage string used in SQLite rows and IPC payloads.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "PENDING",
            Self::Running => "RUNNING",
            Self::Completed => "COMPLETED",
            Self::Canceled => "CANCELED",
            Self::Failed => "FAILED",
        }
    }
}

impl FromStr for IngestJobStatus {
    type Err = DbError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "PENDING" => Ok(Self::Pending),
            "RUNNING" => Ok(Self::Running),
            "COMPLETED" => Ok(Self::Completed),
            "CANCELED" => Ok(Self::Canceled),
            "FAILED" => Ok(Self::Failed),
            _ => Err(DbError::new(
                DbErrorCode::RowDecode,
                format!("unknown ingest job status: {value}"),
            )),
        }
    }
}

/// Persisted ingest job progress projection used by the desktop polling UI.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IngestJobRecord {
    pub job_id: String,
    pub status: IngestJobStatus,
    pub scope: String,
    pub total_items: u32,
    pub processed_items: u32,
    pub error_count: u32,
    pub created_at: String,
    pub updated_at: String,
}

/// Input payload for creating a new ingest job.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NewIngestJob {
    pub job_id: String,
    pub status: IngestJobStatus,
    pub scope: String,
    pub total_items: u32,
    pub processed_items: u32,
    pub error_count: u32,
}

/// Input payload for updating ingest job progress and status.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UpdateIngestJob {
    pub job_id: String,
    pub status: IngestJobStatus,
    pub total_items: u32,
    pub processed_items: u32,
    pub error_count: u32,
}

/// Persisted event row for ingest diagnostics/progress trails.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct IngestEventRecord {
    pub id: i64,
    pub job_id: String,
    pub level: String,
    pub message: String,
    pub payload_json: Option<Value>,
    pub created_at: String,
}

/// Input payload for appending an ingest event row.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NewIngestEvent {
    pub job_id: String,
    pub level: String,
    pub message: String,
    pub payload_json: Option<Value>,
}

/// Connection settings for a SQLite-backed [`Db`].
#[derive(Debug, Clone)]
pub struct DbConfig {
    pub database_url: String,
    pub max_connections: u32,
}

impl DbConfig {
    /// Creates a SQLite configuration with sensible default pool size.
    pub fn sqlite(database_url: impl Into<String>) -> Self {
        Self {
            database_url: database_url.into(),
            max_connections: 5,
        }
    }
}

/// SQLite-backed persistence service for the release state machine.
#[derive(Debug, Clone)]
pub struct Db {
    pool: SqlitePool,
}

/// Transaction-scoped view of [`Db`] operations.
pub struct DbTx<'a> {
    inner: Transaction<'a, Sqlite>,
}

impl Db {
    /// Opens the database pool, enables foreign keys/WAL (when supported), and runs migrations.
    pub async fn connect(config: &DbConfig) -> DbResult<Self> {
        let pool = SqlitePoolOptions::new()
            .max_connections(config.max_connections)
            .connect(&config.database_url)
            .await
            .map_err(|e| {
                DbError::new(
                    DbErrorCode::Connection,
                    format!("failed to connect sqlite DB: {} ({e})", config.database_url),
                )
            })?;

        sqlx::query("PRAGMA foreign_keys = ON;")
            .execute(&pool)
            .await
            .map_err(|e| DbError::map_sqlx(e, "enable sqlite foreign_keys"))?;

        enable_sqlite_wal_if_supported(&pool, &config.database_url).await?;

        MIGRATOR.run(&pool).await.map_err(|e| {
            DbError::new(
                DbErrorCode::Migration,
                format!("failed to run migrations: {e}"),
            )
        })?;

        Ok(Self { pool })
    }

    /// Returns the underlying SQLx pool for advanced/test-only queries.
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    /// Starts a transaction for atomic state-machine updates.
    pub async fn begin_tx(&self) -> DbResult<DbTx<'_>> {
        let inner = self
            .pool
            .begin()
            .await
            .map_err(|e| DbError::map_sqlx(e, "begin transaction"))?;
        Ok(DbTx { inner })
    }

    /// Idempotently inserts or updates a release row when identity fields match.
    pub async fn upsert_release(&self, input: &NewReleaseRecord) -> DbResult<ReleaseRecord> {
        let result = sqlx::query(
            r#"
            INSERT INTO releases (
                release_id, title, state, spec_hash, media_fingerprint, normalized_spec_json
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(release_id) DO UPDATE SET
                title = excluded.title,
                updated_at = CURRENT_TIMESTAMP
            WHERE releases.spec_hash = excluded.spec_hash
              AND releases.media_fingerprint = excluded.media_fingerprint
              AND releases.normalized_spec_json = excluded.normalized_spec_json
            "#,
        )
        .bind(&input.release_id)
        .bind(&input.title)
        .bind(input.state.as_str())
        .bind(&input.spec_hash)
        .bind(&input.media_fingerprint)
        .bind(&input.normalized_spec_json)
        .execute(&self.pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "upsert release"))?;

        let stored = self
            .get_release(&input.release_id)
            .await?
            .ok_or_else(|| DbError::new(DbErrorCode::NotFound, "release missing after upsert"))?;

        if result.rows_affected() == 0 {
            ensure_release_upsert_invariants_match(&stored, input)?;
        }

        Ok(stored)
    }

    /// Fetches a release row by `release_id`.
    pub async fn get_release(&self, release_id: &str) -> DbResult<Option<ReleaseRecord>> {
        let row = sqlx::query(
            r#"
            SELECT release_id, title, state, spec_hash, media_fingerprint, normalized_spec_json,
                   last_error, created_at, updated_at
            FROM releases
            WHERE release_id = ?
            "#,
        )
        .bind(release_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "fetch release"))?;

        row.map(map_release_row).transpose()
    }

    /// Upserts persisted QC analysis metrics for a release.
    ///
    /// The payload is validated before storage and `peak_data` is serialized as JSON.
    pub async fn upsert_release_track_analysis(
        &self,
        input: &UpsertReleaseTrackAnalysis,
    ) -> DbResult<ReleaseTrackAnalysisRecord> {
        validate_release_track_analysis_input(input)?;
        let peak_data_json = serialize_vec_f32_json(&input.peak_data)?;

        sqlx::query(
            r#"
            INSERT INTO release_track_analysis (
                release_id, file_path, media_fingerprint, duration_ms, peak_data_json,
                loudness_lufs, sample_rate_hz, channels
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(release_id) DO UPDATE SET
                file_path = excluded.file_path,
                media_fingerprint = excluded.media_fingerprint,
                duration_ms = excluded.duration_ms,
                peak_data_json = excluded.peak_data_json,
                loudness_lufs = excluded.loudness_lufs,
                sample_rate_hz = excluded.sample_rate_hz,
                channels = excluded.channels,
                updated_at = CURRENT_TIMESTAMP
            "#,
        )
        .bind(&input.release_id)
        .bind(&input.file_path)
        .bind(&input.media_fingerprint)
        .bind(i64::from(input.duration_ms))
        .bind(peak_data_json)
        .bind(f64::from(input.loudness_lufs))
        .bind(i64::from(input.sample_rate_hz))
        .bind(i64::from(input.channels))
        .execute(&self.pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "upsert release track analysis"))?;

        self.get_release_track_analysis(&input.release_id)
            .await?
            .ok_or_else(|| {
                DbError::new(
                    DbErrorCode::NotFound,
                    "release track analysis missing after upsert",
                )
            })
    }

    /// Fetches persisted QC analysis metrics for a release.
    pub async fn get_release_track_analysis(
        &self,
        release_id: &str,
    ) -> DbResult<Option<ReleaseTrackAnalysisRecord>> {
        if release_id.trim().is_empty() {
            return Err(DbError::new(
                DbErrorCode::Query,
                "release track analysis release_id cannot be empty",
            ));
        }

        let row = sqlx::query(
            r#"
            SELECT release_id, file_path, media_fingerprint, duration_ms, peak_data_json,
                   loudness_lufs, sample_rate_hz, channels, created_at, updated_at
            FROM release_track_analysis
            WHERE release_id = ?
            "#,
        )
        .bind(release_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "fetch release track analysis"))?;

        row.map(map_release_track_analysis_row).transpose()
    }

    /// Imports or updates a catalog track and related artist/album/media rows.
    pub async fn upsert_catalog_track_import(
        &self,
        input: &UpsertCatalogTrackImport,
    ) -> DbResult<CatalogTrackRecord> {
        validate_catalog_track_import_input(input)?;
        let peak_data_json = serialize_vec_f32_json(&input.peak_data)?;
        let mut tx = self.begin_tx().await?;

        sqlx::query(
            r#"
            INSERT INTO catalog_artists (artist_id, name, normalized_name)
            VALUES (?, ?, ?)
            ON CONFLICT(artist_id) DO UPDATE SET
                name = excluded.name,
                normalized_name = excluded.normalized_name,
                updated_at = CURRENT_TIMESTAMP
            "#,
        )
        .bind(&input.artist_id)
        .bind(&input.artist_name)
        .bind(normalize_catalog_text(&input.artist_name))
        .execute(tx.inner.as_mut())
        .await
        .map_err(|e| DbError::map_sqlx(e, "upsert catalog artist"))?;

        if let (Some(album_id), Some(album_title)) = (&input.album_id, &input.album_title) {
            sqlx::query(
                r#"
                INSERT INTO catalog_albums (album_id, artist_id, title, normalized_title)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(album_id) DO UPDATE SET
                    artist_id = excluded.artist_id,
                    title = excluded.title,
                    normalized_title = excluded.normalized_title,
                    updated_at = CURRENT_TIMESTAMP
                "#,
            )
            .bind(album_id)
            .bind(&input.artist_id)
            .bind(album_title)
            .bind(normalize_catalog_text(album_title))
            .execute(tx.inner.as_mut())
            .await
            .map_err(|e| DbError::map_sqlx(e, "upsert catalog album"))?;
        }

        sqlx::query(
            r#"
            INSERT INTO catalog_media_assets (media_asset_id, content_fingerprint, primary_file_path)
            VALUES (?, ?, ?)
            ON CONFLICT(media_asset_id) DO UPDATE SET
                content_fingerprint = excluded.content_fingerprint,
                primary_file_path = excluded.primary_file_path,
                updated_at = CURRENT_TIMESTAMP
            WHERE catalog_media_assets.content_fingerprint = excluded.content_fingerprint
            "#,
        )
        .bind(&input.media_asset_id)
        .bind(&input.media_fingerprint)
        .bind(&input.file_path)
        .execute(tx.inner.as_mut())
        .await
        .map_err(|e| DbError::map_sqlx(e, "upsert catalog media asset"))?;

        sqlx::query(
            r#"
            INSERT INTO catalog_media_asset_locations (media_asset_id, file_path)
            VALUES (?, ?)
            ON CONFLICT(file_path) DO UPDATE SET
                media_asset_id = excluded.media_asset_id,
                updated_at = CURRENT_TIMESTAMP
            "#,
        )
        .bind(&input.media_asset_id)
        .bind(&input.file_path)
        .execute(tx.inner.as_mut())
        .await
        .map_err(|e| DbError::map_sqlx(e, "upsert catalog media location"))?;

        sqlx::query(
            r#"
            INSERT INTO catalog_tracks (
                track_id, media_asset_id, artist_id, album_id, title, normalized_title, duration_ms,
                peak_data_json, loudness_lufs, true_peak_dbfs, sample_rate_hz, channels,
                visibility_policy, license_policy, downloadable
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(track_id) DO UPDATE SET
                media_asset_id = excluded.media_asset_id,
                artist_id = excluded.artist_id,
                album_id = excluded.album_id,
                title = excluded.title,
                normalized_title = excluded.normalized_title,
                duration_ms = excluded.duration_ms,
                peak_data_json = excluded.peak_data_json,
                loudness_lufs = excluded.loudness_lufs,
                true_peak_dbfs = excluded.true_peak_dbfs,
                sample_rate_hz = excluded.sample_rate_hz,
                channels = excluded.channels,
                visibility_policy = excluded.visibility_policy,
                license_policy = excluded.license_policy,
                downloadable = excluded.downloadable,
                updated_at = CURRENT_TIMESTAMP
            "#,
        )
        .bind(&input.track_id)
        .bind(&input.media_asset_id)
        .bind(&input.artist_id)
        .bind(&input.album_id)
        .bind(&input.title)
        .bind(normalize_catalog_text(&input.title))
        .bind(i64::from(input.duration_ms))
        .bind(peak_data_json)
        .bind(f64::from(input.loudness_lufs))
        .bind(input.true_peak_dbfs.map(f64::from))
        .bind(i64::from(input.sample_rate_hz))
        .bind(i64::from(input.channels))
        .bind(&input.visibility_policy)
        .bind(&input.license_policy)
        .bind(if input.downloadable { 1_i64 } else { 0_i64 })
        .execute(tx.inner.as_mut())
        .await
        .map_err(|e| DbError::map_sqlx(e, "upsert catalog track"))?;

        sqlx::query(
            r#"
            INSERT INTO track_analysis_cache (
                track_id, media_fingerprint, duration_ms, peak_data_json, loudness_lufs, true_peak_dbfs, sample_rate_hz, channels
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(track_id) DO UPDATE SET
                media_fingerprint = excluded.media_fingerprint,
                duration_ms = excluded.duration_ms,
                peak_data_json = excluded.peak_data_json,
                loudness_lufs = excluded.loudness_lufs,
                true_peak_dbfs = excluded.true_peak_dbfs,
                sample_rate_hz = excluded.sample_rate_hz,
                channels = excluded.channels,
                updated_at = CURRENT_TIMESTAMP
            "#,
        )
        .bind(&input.track_id)
        .bind(&input.media_fingerprint)
        .bind(i64::from(input.duration_ms))
        .bind(serialize_vec_f32_json(&input.peak_data)?)
        .bind(f64::from(input.loudness_lufs))
        .bind(input.true_peak_dbfs.map(f64::from))
        .bind(i64::from(input.sample_rate_hz))
        .bind(i64::from(input.channels))
        .execute(tx.inner.as_mut())
        .await
        .map_err(|e| DbError::map_sqlx(e, "upsert track analysis cache"))?;

        let track = get_catalog_track_with_executor(tx.inner.as_mut(), &input.track_id)
            .await?
            .ok_or_else(|| {
                DbError::new(DbErrorCode::NotFound, "catalog track missing after upsert")
            })?;
        tx.commit().await?;
        Ok(track)
    }

    /// Lists catalog tracks with optional search and pagination.
    pub async fn list_catalog_tracks(
        &self,
        query: &CatalogListTracksQuery,
    ) -> DbResult<CatalogTrackListPage> {
        validate_catalog_list_tracks_query(query)?;

        let search_terms = query
            .search
            .as_ref()
            .map(|value| normalize_catalog_search_terms(value))
            .unwrap_or_default();
        let match_query = build_catalog_fts_match_query(&search_terms);

        let total_i64: i64 = if let Some(match_query) = match_query.as_deref() {
            sqlx::query_scalar(
                r#"
                SELECT COUNT(*)
                FROM catalog_tracks t
                JOIN catalog_track_search ON catalog_track_search.track_id = t.track_id
                WHERE catalog_track_search MATCH ?
                "#,
            )
            .bind(match_query)
            .fetch_one(&self.pool)
            .await
            .map_err(|e| DbError::map_sqlx(e, "count catalog tracks with search"))?
        } else {
            sqlx::query_scalar("SELECT COUNT(*) FROM catalog_tracks")
                .fetch_one(&self.pool)
                .await
                .map_err(|e| DbError::map_sqlx(e, "count catalog tracks"))?
        };
        let total = u64::try_from(total_i64).map_err(|_| {
            DbError::new(
                DbErrorCode::RowDecode,
                format!("count catalog tracks: out of range ({total_i64})"),
            )
        })?;
        let rows = if let Some(match_query) = match_query.as_deref() {
            sqlx::query(
                r#"
                SELECT
                    t.track_id,
                    t.title,
                    a.name AS artist_name,
                    al.title AS album_title,
                    t.duration_ms,
                    t.loudness_lufs,
                    m.primary_file_path AS file_path,
                    m.content_fingerprint AS media_fingerprint,
                    t.updated_at
                FROM catalog_track_search
                JOIN catalog_tracks t ON t.track_id = catalog_track_search.track_id
                JOIN catalog_artists a ON a.artist_id = t.artist_id
                LEFT JOIN catalog_albums al ON al.album_id = t.album_id
                JOIN catalog_media_assets m ON m.media_asset_id = t.media_asset_id
                WHERE catalog_track_search MATCH ?
                ORDER BY
                    bm25(catalog_track_search, 10.0, 7.0, 4.0, 1.5) ASC,
                    t.updated_at DESC,
                    t.track_id ASC
                LIMIT ? OFFSET ?
                "#,
            )
            .bind(match_query)
            .bind(i64::from(query.limit))
            .bind(i64::from(query.offset))
            .fetch_all(&self.pool)
            .await
            .map_err(|e| DbError::map_sqlx(e, "list catalog tracks with search"))?
        } else {
            sqlx::query(
                r#"
                SELECT
                    t.track_id,
                    t.title,
                    a.name AS artist_name,
                    al.title AS album_title,
                    t.duration_ms,
                    t.loudness_lufs,
                    m.primary_file_path AS file_path,
                    m.content_fingerprint AS media_fingerprint,
                    t.updated_at
                FROM catalog_tracks t
                JOIN catalog_artists a ON a.artist_id = t.artist_id
                LEFT JOIN catalog_albums al ON al.album_id = t.album_id
                JOIN catalog_media_assets m ON m.media_asset_id = t.media_asset_id
                ORDER BY t.updated_at DESC, t.track_id ASC
                LIMIT ? OFFSET ?
                "#,
            )
            .bind(i64::from(query.limit))
            .bind(i64::from(query.offset))
            .fetch_all(&self.pool)
            .await
            .map_err(|e| DbError::map_sqlx(e, "list catalog tracks"))?
        };

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            items.push(map_catalog_track_list_row(row)?);
        }

        Ok(CatalogTrackListPage {
            items,
            total,
            limit: query.limit,
            offset: query.offset,
        })
    }

    /// Fetches a detailed catalog track by `track_id`.
    pub async fn get_catalog_track(&self, track_id: &str) -> DbResult<Option<CatalogTrackRecord>> {
        validate_hexish_id(track_id, "catalog track_id")?;
        get_catalog_track_with_executor(&self.pool, track_id).await
    }

    /// Lists human-readable tag labels attached to a catalog track.
    pub async fn list_catalog_track_tags(&self, track_id: &str) -> DbResult<Vec<String>> {
        validate_hexish_id(track_id, "catalog track_id")?;
        list_catalog_track_tags_with_executor(&self.pool, track_id).await
    }

    /// Updates editable catalog track metadata (rights/visibility/downloadable/tags) atomically.
    pub async fn update_catalog_track_metadata(
        &self,
        input: &UpdateCatalogTrackMetadata,
    ) -> DbResult<CatalogTrackRecord> {
        validate_update_catalog_track_metadata_input(input)?;

        let mut tx = self.begin_tx().await?;

        let update_result = sqlx::query(
            r#"
            UPDATE catalog_tracks
            SET visibility_policy = ?,
                license_policy = ?,
                downloadable = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE track_id = ?
            "#,
        )
        .bind(&input.visibility_policy)
        .bind(&input.license_policy)
        .bind(if input.downloadable { 1_i64 } else { 0_i64 })
        .bind(&input.track_id)
        .execute(tx.inner.as_mut())
        .await
        .map_err(|e| DbError::map_sqlx(e, "update catalog track metadata"))?;

        if update_result.rows_affected() != 1 {
            return Err(DbError::new(
                DbErrorCode::NotFound,
                "catalog track not found for metadata update",
            ));
        }

        sqlx::query("DELETE FROM track_tags WHERE track_id = ?")
            .bind(&input.track_id)
            .execute(tx.inner.as_mut())
            .await
            .map_err(|e| DbError::map_sqlx(e, "delete catalog track tags"))?;

        for tag in &input.tags {
            let normalized_label = normalize_catalog_text(&tag.label);
            let stored_tag_id = if let Some(existing_tag_id) = sqlx::query_scalar::<_, String>(
                "SELECT tag_id FROM tags WHERE normalized_label = ?",
            )
            .bind(&normalized_label)
            .fetch_optional(tx.inner.as_mut())
            .await
            .map_err(|e| DbError::map_sqlx(e, "fetch tag_id by normalized_label"))?
            {
                sqlx::query(
                    "UPDATE tags SET label = ?, updated_at = CURRENT_TIMESTAMP WHERE tag_id = ?",
                )
                .bind(&tag.label)
                .bind(&existing_tag_id)
                .execute(tx.inner.as_mut())
                .await
                .map_err(|e| DbError::map_sqlx(e, "refresh existing tag label"))?;
                existing_tag_id
            } else {
                sqlx::query(
                    r#"
                    INSERT INTO tags (tag_id, label, normalized_label)
                    VALUES (?, ?, ?)
                    ON CONFLICT(tag_id) DO UPDATE SET
                        label = excluded.label,
                        normalized_label = excluded.normalized_label,
                        updated_at = CURRENT_TIMESTAMP
                    "#,
                )
                .bind(&tag.tag_id)
                .bind(&tag.label)
                .bind(&normalized_label)
                .execute(tx.inner.as_mut())
                .await
                .map_err(|e| DbError::map_sqlx(e, "upsert tag"))?;
                tag.tag_id.clone()
            };

            sqlx::query(
                r#"
                INSERT INTO track_tags (track_id, tag_id)
                VALUES (?, ?)
                ON CONFLICT(track_id, tag_id) DO NOTHING
                "#,
            )
            .bind(&input.track_id)
            .bind(&stored_tag_id)
            .execute(tx.inner.as_mut())
            .await
            .map_err(|e| DbError::map_sqlx(e, "insert track tag"))?;
        }

        let track = get_catalog_track_with_executor(tx.inner.as_mut(), &input.track_id)
            .await?
            .ok_or_else(|| {
                DbError::new(
                    DbErrorCode::NotFound,
                    "catalog track missing after metadata update",
                )
            })?;
        tx.commit().await?;
        Ok(track)
    }

    /// Upserts a configured local library root directory.
    pub async fn upsert_library_root(
        &self,
        input: &UpsertLibraryRoot,
    ) -> DbResult<LibraryRootRecord> {
        validate_library_root_input(input)?;

        sqlx::query(
            r#"
            INSERT INTO library_roots (root_id, path, enabled)
            VALUES (?, ?, ?)
            ON CONFLICT(root_id) DO UPDATE SET
                path = excluded.path,
                enabled = excluded.enabled,
                updated_at = CURRENT_TIMESTAMP
            "#,
        )
        .bind(&input.root_id)
        .bind(&input.path)
        .bind(if input.enabled { 1_i64 } else { 0_i64 })
        .execute(&self.pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "upsert library root"))?;

        self.get_library_root(&input.root_id)
            .await?
            .ok_or_else(|| DbError::new(DbErrorCode::NotFound, "library root missing after upsert"))
    }

    /// Lists configured library roots ordered by most recent update first.
    pub async fn list_library_roots(&self) -> DbResult<Vec<LibraryRootRecord>> {
        let rows = sqlx::query(
            r#"
            SELECT root_id, path, enabled, created_at, updated_at
            FROM library_roots
            ORDER BY updated_at DESC, root_id ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "list library roots"))?;

        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            out.push(map_library_root_row(row)?);
        }
        Ok(out)
    }

    /// Fetches a library root by `root_id`.
    pub async fn get_library_root(&self, root_id: &str) -> DbResult<Option<LibraryRootRecord>> {
        validate_hexish_id(root_id, "library root_id")?;
        let row = sqlx::query(
            r#"
            SELECT root_id, path, enabled, created_at, updated_at
            FROM library_roots
            WHERE root_id = ?
            "#,
        )
        .bind(root_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "fetch library root"))?;
        row.map(map_library_root_row).transpose()
    }

    /// Deletes a library root by `root_id`. Returns `true` when a row was removed.
    ///
    /// Removing a root also prunes catalog media locations that live under that root path and
    /// deletes orphaned media assets (which cascade-delete dependent tracks/analysis rows).
    pub async fn delete_library_root(&self, root_id: &str) -> DbResult<bool> {
        validate_hexish_id(root_id, "library root_id")?;
        let mut tx = self.begin_tx().await?;
        let root_path =
            sqlx::query_scalar::<_, String>("SELECT path FROM library_roots WHERE root_id = ?")
                .bind(root_id)
                .fetch_optional(tx.inner.as_mut())
                .await
                .map_err(|e| DbError::map_sqlx(e, "fetch library root path for delete"))?;

        let Some(root_path) = root_path else {
            return Ok(false);
        };

        let normalized_root_prefix = normalize_library_root_path_for_catalog_match(&root_path);
        if !normalized_root_prefix.is_empty() {
            let matched_media_asset_rows = sqlx::query(
                r#"
                SELECT DISTINCT media_asset_id
                FROM catalog_media_asset_locations
                WHERE
                    substr(lower(replace(file_path, '//?/', '')), 1, length(?)) = ?
                    AND (
                        length(lower(replace(file_path, '//?/', ''))) = length(?)
                        OR substr(lower(replace(file_path, '//?/', '')), length(?) + 1, 1) = '/'
                    )
                "#,
            )
            .bind(&normalized_root_prefix)
            .bind(&normalized_root_prefix)
            .bind(&normalized_root_prefix)
            .bind(&normalized_root_prefix)
            .fetch_all(tx.inner.as_mut())
            .await
            .map_err(|e| DbError::map_sqlx(e, "list catalog media assets for root prune"))?;

            let mut matched_media_asset_ids = Vec::with_capacity(matched_media_asset_rows.len());
            for row in matched_media_asset_rows {
                matched_media_asset_ids.push(row.try_get::<String, _>("media_asset_id").map_err(
                    |e| DbError::map_sqlx(e, "decode catalog media asset id for root prune"),
                )?);
            }

            sqlx::query(
                r#"
                DELETE FROM catalog_media_asset_locations
                WHERE
                    substr(lower(replace(file_path, '//?/', '')), 1, length(?)) = ?
                    AND (
                        length(lower(replace(file_path, '//?/', ''))) = length(?)
                        OR substr(lower(replace(file_path, '//?/', '')), length(?) + 1, 1) = '/'
                    )
                "#,
            )
            .bind(&normalized_root_prefix)
            .bind(&normalized_root_prefix)
            .bind(&normalized_root_prefix)
            .bind(&normalized_root_prefix)
            .execute(tx.inner.as_mut())
            .await
            .map_err(|e| DbError::map_sqlx(e, "delete catalog media locations for root prune"))?;

            for media_asset_id in matched_media_asset_ids {
                sqlx::query(
                    r#"
                    DELETE FROM catalog_media_assets
                    WHERE media_asset_id = ?
                      AND NOT EXISTS (
                          SELECT 1
                          FROM catalog_media_asset_locations l
                          WHERE l.media_asset_id = catalog_media_assets.media_asset_id
                      )
                    "#,
                )
                .bind(&media_asset_id)
                .execute(tx.inner.as_mut())
                .await
                .map_err(|e| DbError::map_sqlx(e, "delete orphan catalog media asset"))?;
            }
        }

        let result = sqlx::query("DELETE FROM library_roots WHERE root_id = ?")
            .bind(root_id)
            .execute(tx.inner.as_mut())
            .await
            .map_err(|e| DbError::map_sqlx(e, "delete library root"))?;
        tx.inner
            .commit()
            .await
            .map_err(|e| DbError::map_sqlx(e, "commit delete library root transaction"))?;
        Ok(result.rows_affected() == 1)
    }

    /// Clears persisted local catalog/library state without touching release pipeline history tables.
    pub async fn reset_catalog_library_data(&self) -> DbResult<()> {
        let mut tx = self.begin_tx().await?;

        sqlx::query("DELETE FROM ingest_events")
            .execute(tx.inner.as_mut())
            .await
            .map_err(|e| DbError::map_sqlx(e, "reset catalog ingest_events"))?;
        sqlx::query("DELETE FROM ingest_jobs")
            .execute(tx.inner.as_mut())
            .await
            .map_err(|e| DbError::map_sqlx(e, "reset catalog ingest_jobs"))?;
        sqlx::query("DELETE FROM library_roots")
            .execute(tx.inner.as_mut())
            .await
            .map_err(|e| DbError::map_sqlx(e, "reset catalog library_roots"))?;

        sqlx::query("DELETE FROM playlist_items")
            .execute(tx.inner.as_mut())
            .await
            .map_err(|e| DbError::map_sqlx(e, "reset catalog playlist_items"))?;
        sqlx::query("DELETE FROM playlists")
            .execute(tx.inner.as_mut())
            .await
            .map_err(|e| DbError::map_sqlx(e, "reset catalog playlists"))?;
        sqlx::query("DELETE FROM track_analysis_cache")
            .execute(tx.inner.as_mut())
            .await
            .map_err(|e| DbError::map_sqlx(e, "reset catalog track_analysis_cache"))?;
        sqlx::query("DELETE FROM track_tags")
            .execute(tx.inner.as_mut())
            .await
            .map_err(|e| DbError::map_sqlx(e, "reset catalog track_tags"))?;
        sqlx::query("DELETE FROM album_tags")
            .execute(tx.inner.as_mut())
            .await
            .map_err(|e| DbError::map_sqlx(e, "reset catalog album_tags"))?;
        sqlx::query("DELETE FROM album_tracks")
            .execute(tx.inner.as_mut())
            .await
            .map_err(|e| DbError::map_sqlx(e, "reset catalog album_tracks"))?;
        sqlx::query("DELETE FROM catalog_tracks")
            .execute(tx.inner.as_mut())
            .await
            .map_err(|e| DbError::map_sqlx(e, "reset catalog catalog_tracks"))?;
        sqlx::query("DELETE FROM catalog_albums")
            .execute(tx.inner.as_mut())
            .await
            .map_err(|e| DbError::map_sqlx(e, "reset catalog catalog_albums"))?;
        sqlx::query("DELETE FROM catalog_artists")
            .execute(tx.inner.as_mut())
            .await
            .map_err(|e| DbError::map_sqlx(e, "reset catalog catalog_artists"))?;
        sqlx::query("DELETE FROM artwork_assets")
            .execute(tx.inner.as_mut())
            .await
            .map_err(|e| DbError::map_sqlx(e, "reset catalog artwork_assets"))?;
        sqlx::query("DELETE FROM catalog_media_asset_locations")
            .execute(tx.inner.as_mut())
            .await
            .map_err(|e| DbError::map_sqlx(e, "reset catalog catalog_media_asset_locations"))?;
        sqlx::query("DELETE FROM catalog_media_assets")
            .execute(tx.inner.as_mut())
            .await
            .map_err(|e| DbError::map_sqlx(e, "reset catalog catalog_media_assets"))?;
        sqlx::query("DELETE FROM tags")
            .execute(tx.inner.as_mut())
            .await
            .map_err(|e| DbError::map_sqlx(e, "reset catalog tags"))?;

        tx.inner
            .commit()
            .await
            .map_err(|e| DbError::map_sqlx(e, "commit reset catalog library data transaction"))?;
        Ok(())
    }

    /// Inserts a new ingest job row for async import/scan tracking.
    pub async fn create_ingest_job(&self, input: &NewIngestJob) -> DbResult<IngestJobRecord> {
        validate_new_ingest_job(input)?;
        sqlx::query(
            r#"
            INSERT INTO ingest_jobs (job_id, status, scope, total_items, processed_items, error_count)
            VALUES (?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&input.job_id)
        .bind(input.status.as_str())
        .bind(&input.scope)
        .bind(i64::from(input.total_items))
        .bind(i64::from(input.processed_items))
        .bind(i64::from(input.error_count))
        .execute(&self.pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "create ingest job"))?;

        self.get_ingest_job(&input.job_id)
            .await?
            .ok_or_else(|| DbError::new(DbErrorCode::NotFound, "ingest job missing after insert"))
    }

    /// Updates ingest job progress and status in one write.
    pub async fn update_ingest_job(&self, input: &UpdateIngestJob) -> DbResult<IngestJobRecord> {
        validate_update_ingest_job(input)?;
        let result = sqlx::query(
            r#"
            UPDATE ingest_jobs
            SET status = ?, total_items = ?, processed_items = ?, error_count = ?, updated_at = CURRENT_TIMESTAMP
            WHERE job_id = ?
            "#,
        )
        .bind(input.status.as_str())
        .bind(i64::from(input.total_items))
        .bind(i64::from(input.processed_items))
        .bind(i64::from(input.error_count))
        .bind(&input.job_id)
        .execute(&self.pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "update ingest job"))?;
        if result.rows_affected() != 1 {
            return Err(DbError::new(
                DbErrorCode::NotFound,
                "update ingest job: job_id not found",
            ));
        }
        self.get_ingest_job(&input.job_id)
            .await?
            .ok_or_else(|| DbError::new(DbErrorCode::NotFound, "ingest job missing after update"))
    }

    /// Fetches an ingest job by `job_id`.
    pub async fn get_ingest_job(&self, job_id: &str) -> DbResult<Option<IngestJobRecord>> {
        validate_hexish_id(job_id, "ingest job_id")?;
        let row = sqlx::query(
            r#"
            SELECT job_id, status, scope, total_items, processed_items, error_count, created_at, updated_at
            FROM ingest_jobs
            WHERE job_id = ?
            "#,
        )
        .bind(job_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "fetch ingest job"))?;
        row.map(map_ingest_job_row).transpose()
    }
    /// Lists ingest jobs that were left non-terminal (PENDING/RUNNING).
    pub async fn list_incomplete_ingest_jobs(&self) -> DbResult<Vec<IngestJobRecord>> {
        let rows = sqlx::query(
            r#"
            SELECT job_id, status, scope, total_items, processed_items, error_count, created_at, updated_at
            FROM ingest_jobs
            WHERE status IN ('PENDING', 'RUNNING')
            ORDER BY updated_at ASC, job_id ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "list incomplete ingest jobs"))?;

        rows.into_iter().map(map_ingest_job_row).collect()
    }

    /// Appends an ingest event row for audit/progress diagnostics.
    pub async fn append_ingest_event(&self, entry: &NewIngestEvent) -> DbResult<IngestEventRecord> {
        validate_new_ingest_event(entry)?;
        let payload_json = serialize_json_opt(&entry.payload_json)?;
        let result = sqlx::query(
            r#"
            INSERT INTO ingest_events (job_id, level, message, payload_json)
            VALUES (?, ?, ?, ?)
            "#,
        )
        .bind(&entry.job_id)
        .bind(&entry.level)
        .bind(&entry.message)
        .bind(payload_json)
        .execute(&self.pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "insert ingest event"))?;
        let id = result.last_insert_rowid();
        let row = sqlx::query(
            r#"
            SELECT id, job_id, level, message, payload_json, created_at
            FROM ingest_events WHERE id = ?
            "#,
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "fetch inserted ingest event"))?;
        map_ingest_event_row(row)
    }

    /// Transitions a release row only when the current state matches `expected`.
    ///
    /// Returns `Ok(true)` when the row transitioned, `Ok(false)` when the row
    /// existed but was not in the expected state.
    pub async fn transition_release_state(
        &self,
        release_id: &str,
        expected: ReleaseState,
        next: ReleaseState,
    ) -> DbResult<bool> {
        if !expected.can_transition_to(next) {
            return Err(DbError::invalid_state_transition(format!(
                "invalid state transition: {} -> {}",
                expected.as_str(),
                next.as_str()
            )));
        }

        let result = sqlx::query(
            r#"
            UPDATE releases
            SET state = ?, updated_at = CURRENT_TIMESTAMP
            WHERE release_id = ? AND state = ?
            "#,
        )
        .bind(next.as_str())
        .bind(release_id)
        .bind(expected.as_str())
        .execute(&self.pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "transition release state"))?;

        Ok(result.rows_affected() == 1)
    }

    /// Transitions a release into `FAILED` while storing the terminal error message.
    pub async fn set_release_failed(
        &self,
        release_id: &str,
        from: ReleaseState,
        message: impl Into<String>,
    ) -> DbResult<bool> {
        let message = message.into();
        if !from.can_transition_to(ReleaseState::Failed) {
            return Err(DbError::invalid_state_transition(format!(
                "invalid state transition to FAILED from {}",
                from.as_str()
            )));
        }
        let result = sqlx::query(
            r#"
            UPDATE releases
            SET state = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP
            WHERE release_id = ? AND state = ?
            "#,
        )
        .bind(ReleaseState::Failed.as_str())
        .bind(message)
        .bind(release_id)
        .bind(from.as_str())
        .execute(&self.pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "set release failed"))?;

        Ok(result.rows_affected() == 1)
    }

    pub async fn get_run_lock_lease(
        &self,
        release_id: &str,
    ) -> DbResult<Option<RunLockLeaseRecord>> {
        let row = sqlx::query(
            r#"
            SELECT release_id, owner, owner_epoch, lease_expires_at_unix_ms, created_at
            FROM run_locks
            WHERE release_id = ?
            "#,
        )
        .bind(release_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "fetch run lock lease"))?;

        row.map(map_run_lock_lease_row).transpose()
    }

    pub async fn acquire_run_lock_lease(
        &self,
        release_id: &str,
        owner: &str,
        owner_epoch: i64,
        now_unix_ms: i64,
        lease_ttl_ms: i64,
    ) -> DbResult<bool> {
        let lease_expires_at_unix_ms =
            validate_run_lock_lease_params(owner, owner_epoch, now_unix_ms, lease_ttl_ms)?;
        let result = sqlx::query(
            r#"
            INSERT INTO run_locks (release_id, owner, owner_epoch, lease_expires_at_unix_ms)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(release_id) DO UPDATE SET
                owner = excluded.owner,
                owner_epoch = excluded.owner_epoch,
                lease_expires_at_unix_ms = excluded.lease_expires_at_unix_ms
            WHERE run_locks.lease_expires_at_unix_ms <= ?
            "#,
        )
        .bind(release_id)
        .bind(owner)
        .bind(owner_epoch)
        .bind(lease_expires_at_unix_ms)
        .bind(now_unix_ms)
        .execute(&self.pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "acquire run lock lease"))?;

        Ok(result.rows_affected() == 1)
    }

    pub async fn renew_run_lock_lease(
        &self,
        release_id: &str,
        owner: &str,
        owner_epoch: i64,
        now_unix_ms: i64,
        lease_ttl_ms: i64,
    ) -> DbResult<bool> {
        let lease_expires_at_unix_ms =
            validate_run_lock_lease_params(owner, owner_epoch, now_unix_ms, lease_ttl_ms)?;
        let result = sqlx::query(
            r#"
            UPDATE run_locks
            SET lease_expires_at_unix_ms = ?
            WHERE release_id = ?
              AND owner = ?
              AND owner_epoch = ?
              AND lease_expires_at_unix_ms > ?
            "#,
        )
        .bind(lease_expires_at_unix_ms)
        .bind(release_id)
        .bind(owner)
        .bind(owner_epoch)
        .bind(now_unix_ms)
        .execute(&self.pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "renew run lock lease"))?;

        Ok(result.rows_affected() == 1)
    }

    pub async fn release_run_lock_lease(
        &self,
        release_id: &str,
        owner: &str,
        owner_epoch: i64,
    ) -> DbResult<bool> {
        if owner.trim().is_empty() {
            return Err(DbError::new(
                DbErrorCode::Query,
                "release run lock lease owner cannot be empty",
            ));
        }
        if owner_epoch < 0 {
            return Err(DbError::new(
                DbErrorCode::Query,
                "release run lock lease owner_epoch must be non-negative",
            ));
        }

        let result = sqlx::query(
            r#"
            DELETE FROM run_locks
            WHERE release_id = ? AND owner = ? AND owner_epoch = ?
            "#,
        )
        .bind(release_id)
        .bind(owner)
        .bind(owner_epoch)
        .execute(&self.pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "release run lock lease"))?;

        Ok(result.rows_affected() == 1)
    }

    pub async fn acquire_run_lock(&self, release_id: &str, owner: &str) -> DbResult<bool> {
        let result = sqlx::query(
            r#"
            INSERT OR IGNORE INTO run_locks (release_id, owner)
            VALUES (?, ?)
            "#,
        )
        .bind(release_id)
        .bind(owner)
        .execute(&self.pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "acquire run lock"))?;

        Ok(result.rows_affected() == 1)
    }

    pub async fn release_run_lock(&self, release_id: &str, owner: &str) -> DbResult<bool> {
        let result = sqlx::query(
            r#"
            DELETE FROM run_locks
            WHERE release_id = ? AND owner = ?
            "#,
        )
        .bind(release_id)
        .bind(owner)
        .execute(&self.pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "release run lock"))?;

        Ok(result.rows_affected() == 1)
    }

    /// Inserts or updates a per-platform execution row, preserving prior plan/result fields when omitted.
    pub async fn upsert_platform_action(
        &self,
        action: &UpsertPlatformAction,
    ) -> DbResult<PlatformActionRecord> {
        let plan_json = serialize_json_opt(&action.plan_json)?;
        let result_json = serialize_json_opt(&action.result_json)?;

        sqlx::query(
            r#"
            INSERT INTO platform_actions (
                release_id, platform, status, plan_json, result_json, external_id, attempt_count, last_error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(release_id, platform) DO UPDATE SET
                status = excluded.status,
                plan_json = COALESCE(excluded.plan_json, platform_actions.plan_json),
                result_json = COALESCE(excluded.result_json, platform_actions.result_json),
                external_id = COALESCE(excluded.external_id, platform_actions.external_id),
                attempt_count = CASE
                    WHEN excluded.attempt_count = 1 THEN platform_actions.attempt_count + 1
                    ELSE platform_actions.attempt_count
                END,
                last_error = excluded.last_error,
                updated_at = CURRENT_TIMESTAMP
            "#,
        )
        .bind(&action.release_id)
        .bind(&action.platform)
        .bind(action.status.as_str())
        .bind(plan_json)
        .bind(result_json)
        .bind(&action.external_id)
        .bind(if action.increment_attempt { 1_i64 } else { 0_i64 })
        .bind(&action.last_error)
        .execute(&self.pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "upsert platform action"))?;

        self.get_platform_action(&action.release_id, &action.platform)
            .await?
            .ok_or_else(|| {
                DbError::new(
                    DbErrorCode::NotFound,
                    "platform action missing after upsert",
                )
            })
    }

    /// Fetches a single platform execution row.
    pub async fn get_platform_action(
        &self,
        release_id: &str,
        platform: &str,
    ) -> DbResult<Option<PlatformActionRecord>> {
        let row = sqlx::query(
            r#"
            SELECT release_id, platform, status, plan_json, result_json, external_id, attempt_count,
                   last_error, created_at, updated_at
            FROM platform_actions
            WHERE release_id = ? AND platform = ?
            "#,
        )
        .bind(release_id)
        .bind(platform)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "fetch platform action"))?;

        row.map(map_platform_action_row).transpose()
    }

    /// Lists all platform execution rows for a release, ordered by platform name.
    pub async fn list_platform_actions(
        &self,
        release_id: &str,
    ) -> DbResult<Vec<PlatformActionRecord>> {
        let rows = sqlx::query(
            r#"
            SELECT release_id, platform, status, plan_json, result_json, external_id, attempt_count,
                   last_error, created_at, updated_at
            FROM platform_actions
            WHERE release_id = ?
            ORDER BY platform ASC
            "#,
        )
        .bind(release_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "list platform actions"))?;

        rows.into_iter().map(map_platform_action_row).collect()
    }

    /// Returns requested platforms that do not already have a completed result.
    pub async fn pending_platforms(
        &self,
        release_id: &str,
        requested_platforms: &[String],
    ) -> DbResult<Vec<String>> {
        let existing = self.list_platform_actions(release_id).await?;
        let completed: std::collections::HashSet<String> = existing
            .into_iter()
            .filter(|row| row.status.is_completed())
            .map(|row| row.platform)
            .collect();

        Ok(requested_platforms
            .iter()
            .filter(|platform| !completed.contains(platform.as_str()))
            .cloned()
            .collect())
    }

    /// Appends a stage audit record and returns the stored row.
    pub async fn append_audit_log(&self, entry: &NewAuditLogEntry) -> DbResult<AuditLogEntry> {
        let payload_json = serialize_json_opt(&entry.payload_json)?;
        let result = sqlx::query(
            r#"
            INSERT INTO audit_logs (release_id, stage, message, payload_json)
            VALUES (?, ?, ?, ?)
            "#,
        )
        .bind(&entry.release_id)
        .bind(&entry.stage)
        .bind(&entry.message)
        .bind(payload_json)
        .execute(&self.pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "insert audit log"))?;

        let id = result.last_insert_rowid();
        let row = sqlx::query(
            r#"
            SELECT id, release_id, stage, message, payload_json, created_at
            FROM audit_logs WHERE id = ?
            "#,
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "fetch inserted audit log"))?;

        map_audit_log_row(row)
    }

    /// Lists releases for the desktop history screen, newest first.
    pub async fn list_history(&self) -> DbResult<Vec<HistoryItem>> {
        let rows = sqlx::query(
            r#"
            SELECT release_id, state, title, updated_at
            FROM releases
            ORDER BY updated_at DESC, release_id DESC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "list history"))?;

        rows.into_iter()
            .map(|row| {
                Ok(HistoryItem {
                    release_id: row
                        .try_get("release_id")
                        .map_err(|e| DbError::map_sqlx(e, "decode history.release_id"))?,
                    state: row
                        .try_get("state")
                        .map_err(|e| DbError::map_sqlx(e, "decode history.state"))?,
                    title: row
                        .try_get("title")
                        .map_err(|e| DbError::map_sqlx(e, "decode history.title"))?,
                    updated_at: row
                        .try_get("updated_at")
                        .map_err(|e| DbError::map_sqlx(e, "decode history.updated_at"))?,
                })
            })
            .collect()
    }
}

impl<'a> DbTx<'a> {
    /// Commits the transaction.
    pub async fn commit(self) -> DbResult<()> {
        self.inner
            .commit()
            .await
            .map_err(|e| DbError::map_sqlx(e, "commit transaction"))
    }

    /// Rolls the transaction back.
    pub async fn rollback(self) -> DbResult<()> {
        self.inner
            .rollback()
            .await
            .map_err(|e| DbError::map_sqlx(e, "rollback transaction"))
    }

    /// Transactional variant of [`Db::upsert_release`].
    pub async fn upsert_release(&mut self, input: &NewReleaseRecord) -> DbResult<ReleaseRecord> {
        let result = sqlx::query(
            r#"
            INSERT INTO releases (
                release_id, title, state, spec_hash, media_fingerprint, normalized_spec_json
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(release_id) DO UPDATE SET
                title = excluded.title,
                updated_at = CURRENT_TIMESTAMP
            WHERE releases.spec_hash = excluded.spec_hash
              AND releases.media_fingerprint = excluded.media_fingerprint
              AND releases.normalized_spec_json = excluded.normalized_spec_json
            "#,
        )
        .bind(&input.release_id)
        .bind(&input.title)
        .bind(input.state.as_str())
        .bind(&input.spec_hash)
        .bind(&input.media_fingerprint)
        .bind(&input.normalized_spec_json)
        .execute(self.inner.as_mut())
        .await
        .map_err(|e| DbError::map_sqlx(e, "upsert release"))?;

        let stored = self
            .get_release(&input.release_id)
            .await?
            .ok_or_else(|| DbError::new(DbErrorCode::NotFound, "release missing after upsert"))?;

        if result.rows_affected() == 0 {
            ensure_release_upsert_invariants_match(&stored, input)?;
        }

        Ok(stored)
    }

    /// Transactional variant of [`Db::get_release`].
    pub async fn get_release(&mut self, release_id: &str) -> DbResult<Option<ReleaseRecord>> {
        let row = sqlx::query(
            r#"
            SELECT release_id, title, state, spec_hash, media_fingerprint, normalized_spec_json,
                   last_error, created_at, updated_at
            FROM releases
            WHERE release_id = ?
            "#,
        )
        .bind(release_id)
        .fetch_optional(self.inner.as_mut())
        .await
        .map_err(|e| DbError::map_sqlx(e, "fetch release"))?;

        row.map(map_release_row).transpose()
    }

    /// Transactional variant of [`Db::transition_release_state`].
    pub async fn transition_release_state(
        &mut self,
        release_id: &str,
        expected: ReleaseState,
        next: ReleaseState,
    ) -> DbResult<bool> {
        if !expected.can_transition_to(next) {
            return Err(DbError::invalid_state_transition(format!(
                "invalid state transition: {} -> {}",
                expected.as_str(),
                next.as_str()
            )));
        }
        let result = sqlx::query(
            r#"
            UPDATE releases
            SET state = ?, updated_at = CURRENT_TIMESTAMP
            WHERE release_id = ? AND state = ?
            "#,
        )
        .bind(next.as_str())
        .bind(release_id)
        .bind(expected.as_str())
        .execute(self.inner.as_mut())
        .await
        .map_err(|e| DbError::map_sqlx(e, "transition release state"))?;
        Ok(result.rows_affected() == 1)
    }

    /// Transactional variant of [`Db::set_release_failed`].
    pub async fn set_release_failed(
        &mut self,
        release_id: &str,
        from: ReleaseState,
        message: impl Into<String>,
    ) -> DbResult<bool> {
        let message = message.into();
        if !from.can_transition_to(ReleaseState::Failed) {
            return Err(DbError::invalid_state_transition(format!(
                "invalid state transition to FAILED from {}",
                from.as_str()
            )));
        }
        let result = sqlx::query(
            r#"
            UPDATE releases
            SET state = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP
            WHERE release_id = ? AND state = ?
            "#,
        )
        .bind(ReleaseState::Failed.as_str())
        .bind(message)
        .bind(release_id)
        .bind(from.as_str())
        .execute(self.inner.as_mut())
        .await
        .map_err(|e| DbError::map_sqlx(e, "set release failed"))?;
        Ok(result.rows_affected() == 1)
    }

    /// Transactional variant of [`Db::upsert_platform_action`].
    pub async fn upsert_platform_action(
        &mut self,
        action: &UpsertPlatformAction,
    ) -> DbResult<PlatformActionRecord> {
        let plan_json = serialize_json_opt(&action.plan_json)?;
        let result_json = serialize_json_opt(&action.result_json)?;
        sqlx::query(
            r#"
            INSERT INTO platform_actions (
                release_id, platform, status, plan_json, result_json, external_id, attempt_count, last_error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(release_id, platform) DO UPDATE SET
                status = excluded.status,
                plan_json = COALESCE(excluded.plan_json, platform_actions.plan_json),
                result_json = COALESCE(excluded.result_json, platform_actions.result_json),
                external_id = COALESCE(excluded.external_id, platform_actions.external_id),
                attempt_count = CASE
                    WHEN excluded.attempt_count = 1 THEN platform_actions.attempt_count + 1
                    ELSE platform_actions.attempt_count
                END,
                last_error = excluded.last_error,
                updated_at = CURRENT_TIMESTAMP
            "#,
        )
        .bind(&action.release_id)
        .bind(&action.platform)
        .bind(action.status.as_str())
        .bind(plan_json)
        .bind(result_json)
        .bind(&action.external_id)
        .bind(if action.increment_attempt { 1_i64 } else { 0_i64 })
        .bind(&action.last_error)
        .execute(self.inner.as_mut())
        .await
        .map_err(|e| DbError::map_sqlx(e, "upsert platform action"))?;
        self.get_platform_action(&action.release_id, &action.platform)
            .await?
            .ok_or_else(|| {
                DbError::new(
                    DbErrorCode::NotFound,
                    "platform action missing after upsert",
                )
            })
    }

    /// Transactional variant of [`Db::get_platform_action`].
    pub async fn get_platform_action(
        &mut self,
        release_id: &str,
        platform: &str,
    ) -> DbResult<Option<PlatformActionRecord>> {
        let row = sqlx::query(
            r#"
            SELECT release_id, platform, status, plan_json, result_json, external_id, attempt_count,
                   last_error, created_at, updated_at
            FROM platform_actions
            WHERE release_id = ? AND platform = ?
            "#,
        )
        .bind(release_id)
        .bind(platform)
        .fetch_optional(self.inner.as_mut())
        .await
        .map_err(|e| DbError::map_sqlx(e, "fetch platform action"))?;
        row.map(map_platform_action_row).transpose()
    }

    /// Transactional variant of [`Db::append_audit_log`].
    pub async fn append_audit_log(&mut self, entry: &NewAuditLogEntry) -> DbResult<AuditLogEntry> {
        let payload_json = serialize_json_opt(&entry.payload_json)?;
        let result = sqlx::query(
            r#"
            INSERT INTO audit_logs (release_id, stage, message, payload_json)
            VALUES (?, ?, ?, ?)
            "#,
        )
        .bind(&entry.release_id)
        .bind(&entry.stage)
        .bind(&entry.message)
        .bind(payload_json)
        .execute(self.inner.as_mut())
        .await
        .map_err(|e| DbError::map_sqlx(e, "insert audit log"))?;
        let id = result.last_insert_rowid();
        let row = sqlx::query(
            r#"
            SELECT id, release_id, stage, message, payload_json, created_at
            FROM audit_logs WHERE id = ?
            "#,
        )
        .bind(id)
        .fetch_one(self.inner.as_mut())
        .await
        .map_err(|e| DbError::map_sqlx(e, "fetch inserted audit log"))?;
        map_audit_log_row(row)
    }
}

async fn enable_sqlite_wal_if_supported(pool: &SqlitePool, database_url: &str) -> DbResult<()> {
    if sqlite_url_is_in_memory(database_url) {
        return Ok(());
    }

    let mode: String = sqlx::query_scalar("PRAGMA journal_mode = WAL;")
        .fetch_one(pool)
        .await
        .map_err(|e| DbError::map_sqlx(e, "enable sqlite WAL journal_mode"))?;

    if !mode.eq_ignore_ascii_case("wal") {
        return Err(DbError::new(
            DbErrorCode::Connection,
            format!("failed to enable sqlite WAL journal_mode (got `{mode}`)"),
        ));
    }

    Ok(())
}

fn sqlite_url_is_in_memory(database_url: &str) -> bool {
    let lower = database_url.to_ascii_lowercase();
    lower.contains(":memory:") || lower.contains("mode=memory")
}

fn validate_release_track_analysis_input(input: &UpsertReleaseTrackAnalysis) -> DbResult<()> {
    if input.release_id.trim().is_empty() {
        return Err(DbError::new(
            DbErrorCode::Query,
            "release track analysis release_id cannot be empty",
        ));
    }
    if input.file_path.trim().is_empty() {
        return Err(DbError::new(
            DbErrorCode::Query,
            "release track analysis file_path cannot be empty",
        ));
    }
    if input.media_fingerprint.len() != 64
        || !input
            .media_fingerprint
            .bytes()
            .all(|b| b.is_ascii_hexdigit())
    {
        return Err(DbError::new(
            DbErrorCode::Query,
            "release track analysis media_fingerprint must be a 64-character hex string",
        ));
    }
    if input.duration_ms == 0 {
        return Err(DbError::new(
            DbErrorCode::Query,
            "release track analysis duration_ms must be > 0",
        ));
    }
    if input.peak_data.is_empty() {
        return Err(DbError::new(
            DbErrorCode::Query,
            "release track analysis peak_data must not be empty",
        ));
    }
    if input
        .peak_data
        .iter()
        .any(|peak| !peak.is_finite() || *peak > 0.0)
    {
        return Err(DbError::new(
            DbErrorCode::Query,
            "release track analysis peak_data values must be finite and <= 0.0",
        ));
    }
    if !input.loudness_lufs.is_finite() || input.loudness_lufs > 0.0 {
        return Err(DbError::new(
            DbErrorCode::Query,
            "release track analysis loudness_lufs must be finite and <= 0.0",
        ));
    }
    if input.sample_rate_hz == 0 {
        return Err(DbError::new(
            DbErrorCode::Query,
            "release track analysis sample_rate_hz must be > 0",
        ));
    }
    if input.channels == 0 {
        return Err(DbError::new(
            DbErrorCode::Query,
            "release track analysis channels must be > 0",
        ));
    }
    Ok(())
}

fn validate_catalog_list_tracks_query(query: &CatalogListTracksQuery) -> DbResult<()> {
    if query.limit == 0 {
        return Err(DbError::new(
            DbErrorCode::Query,
            "catalog list tracks limit must be > 0",
        ));
    }
    if query.limit > 500 {
        return Err(DbError::new(
            DbErrorCode::Query,
            "catalog list tracks limit must be <= 500",
        ));
    }
    Ok(())
}

fn validate_catalog_track_import_input(input: &UpsertCatalogTrackImport) -> DbResult<()> {
    validate_hexish_id(&input.track_id, "catalog track_id")?;
    validate_hexish_id(&input.media_asset_id, "catalog media_asset_id")?;
    validate_hexish_id(&input.artist_id, "catalog artist_id")?;
    if let Some(album_id) = &input.album_id {
        validate_hexish_id(album_id, "catalog album_id")?;
    }
    if input.file_path.trim().is_empty() {
        return Err(DbError::new(
            DbErrorCode::Query,
            "catalog file_path cannot be empty",
        ));
    }
    if input.media_fingerprint.len() != 64
        || !input
            .media_fingerprint
            .bytes()
            .all(|b| b.is_ascii_hexdigit())
    {
        return Err(DbError::new(
            DbErrorCode::Query,
            "catalog media_fingerprint must be a 64-character hex string",
        ));
    }
    if normalize_catalog_text(&input.title).is_empty() {
        return Err(DbError::new(
            DbErrorCode::Query,
            "catalog title cannot be empty",
        ));
    }
    if normalize_catalog_text(&input.artist_name).is_empty() {
        return Err(DbError::new(
            DbErrorCode::Query,
            "catalog artist_name cannot be empty",
        ));
    }
    if let Some(album_title) = &input.album_title {
        if normalize_catalog_text(album_title).is_empty() {
            return Err(DbError::new(
                DbErrorCode::Query,
                "catalog album_title cannot be blank when provided",
            ));
        }
    }
    if input.duration_ms == 0 {
        return Err(DbError::new(
            DbErrorCode::Query,
            "catalog duration_ms must be > 0",
        ));
    }
    if input.peak_data.is_empty() {
        return Err(DbError::new(
            DbErrorCode::Query,
            "catalog peak_data must not be empty",
        ));
    }
    if input
        .peak_data
        .iter()
        .any(|peak| !peak.is_finite() || *peak > 0.0)
    {
        return Err(DbError::new(
            DbErrorCode::Query,
            "catalog peak_data values must be finite and <= 0.0",
        ));
    }
    if !input.loudness_lufs.is_finite() || input.loudness_lufs > 0.0 {
        return Err(DbError::new(
            DbErrorCode::Query,
            "catalog loudness_lufs must be finite and <= 0.0",
        ));
    }
    if input
        .true_peak_dbfs
        .is_some_and(|value| !value.is_finite() || value > 0.0)
    {
        return Err(DbError::new(
            DbErrorCode::Query,
            "catalog true_peak_dbfs must be finite and <= 0.0 when provided",
        ));
    }
    if input.sample_rate_hz == 0 {
        return Err(DbError::new(
            DbErrorCode::Query,
            "catalog sample_rate_hz must be > 0",
        ));
    }
    if input.channels == 0 {
        return Err(DbError::new(
            DbErrorCode::Query,
            "catalog channels must be > 0",
        ));
    }
    if normalize_catalog_text(&input.visibility_policy).is_empty() {
        return Err(DbError::new(
            DbErrorCode::Query,
            "catalog visibility_policy cannot be empty",
        ));
    }
    if normalize_catalog_text(&input.license_policy).is_empty() {
        return Err(DbError::new(
            DbErrorCode::Query,
            "catalog license_policy cannot be empty",
        ));
    }

    Ok(())
}

fn validate_update_catalog_track_metadata_input(
    input: &UpdateCatalogTrackMetadata,
) -> DbResult<()> {
    validate_hexish_id(&input.track_id, "catalog track_id")?;
    let visibility = normalize_catalog_text(&input.visibility_policy);
    if visibility.is_empty() {
        return Err(DbError::new(
            DbErrorCode::Query,
            "catalog track visibility_policy cannot be empty",
        ));
    }
    if visibility.len() > 64 {
        return Err(DbError::new(
            DbErrorCode::Query,
            "catalog track visibility_policy exceeds 64 characters",
        ));
    }

    let license = normalize_catalog_text(&input.license_policy);
    if license.is_empty() {
        return Err(DbError::new(
            DbErrorCode::Query,
            "catalog track license_policy cannot be empty",
        ));
    }
    if license.len() > 64 {
        return Err(DbError::new(
            DbErrorCode::Query,
            "catalog track license_policy exceeds 64 characters",
        ));
    }

    if input.tags.len() > 32 {
        return Err(DbError::new(
            DbErrorCode::Query,
            "catalog track tags exceeds maximum of 32 entries",
        ));
    }

    let mut normalized_seen = BTreeSet::new();
    for tag in &input.tags {
        validate_hexish_id(&tag.tag_id, "catalog tag_id")?;
        let label_trimmed = tag.label.trim();
        if label_trimmed.is_empty() {
            return Err(DbError::new(
                DbErrorCode::Query,
                "catalog tag label cannot be empty",
            ));
        }
        if label_trimmed.chars().count() > 64 {
            return Err(DbError::new(
                DbErrorCode::Query,
                "catalog tag label exceeds 64 characters",
            ));
        }
        let normalized = normalize_catalog_text(label_trimmed);
        if normalized.is_empty() {
            return Err(DbError::new(
                DbErrorCode::Query,
                "catalog tag label normalized value cannot be empty",
            ));
        }
        if !normalized_seen.insert(normalized) {
            return Err(DbError::new(
                DbErrorCode::Query,
                "catalog tag labels must be unique after normalization",
            ));
        }
    }

    Ok(())
}

fn validate_library_root_input(input: &UpsertLibraryRoot) -> DbResult<()> {
    validate_hexish_id(&input.root_id, "library root_id")?;
    if input.path.trim().is_empty() {
        return Err(DbError::new(
            DbErrorCode::Query,
            "library root path cannot be empty",
        ));
    }
    Ok(())
}

fn normalize_library_root_path_for_catalog_match(raw: &str) -> String {
    let mut normalized = raw.trim().replace('\\', "/");
    if normalized.starts_with("//?/") {
        normalized = normalized.trim_start_matches("//?/").to_string();
    }
    while normalized.ends_with('/') {
        normalized.pop();
    }
    normalized.to_ascii_lowercase()
}

fn validate_new_ingest_job(input: &NewIngestJob) -> DbResult<()> {
    validate_hexish_id(&input.job_id, "ingest job_id")?;
    if input.scope.trim().is_empty() {
        return Err(DbError::new(
            DbErrorCode::Query,
            "ingest job scope cannot be empty",
        ));
    }
    if input.processed_items > input.total_items {
        return Err(DbError::new(
            DbErrorCode::Query,
            "ingest job processed_items cannot exceed total_items",
        ));
    }
    Ok(())
}

fn validate_update_ingest_job(input: &UpdateIngestJob) -> DbResult<()> {
    validate_hexish_id(&input.job_id, "ingest job_id")?;
    if input.processed_items > input.total_items {
        return Err(DbError::new(
            DbErrorCode::Query,
            "ingest job processed_items cannot exceed total_items",
        ));
    }
    Ok(())
}

fn validate_new_ingest_event(input: &NewIngestEvent) -> DbResult<()> {
    validate_hexish_id(&input.job_id, "ingest event job_id")?;
    if input.level.trim().is_empty() {
        return Err(DbError::new(
            DbErrorCode::Query,
            "ingest event level cannot be empty",
        ));
    }
    if input.message.trim().is_empty() {
        return Err(DbError::new(
            DbErrorCode::Query,
            "ingest event message cannot be empty",
        ));
    }
    Ok(())
}

fn validate_hexish_id(value: &str, label: &str) -> DbResult<()> {
    let trimmed = value.trim();
    if trimmed.len() != 64 || !trimmed.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(DbError::new(
            DbErrorCode::Query,
            format!("{label} must be a 64-character hex string"),
        ));
    }
    Ok(())
}

fn decode_sqlite_bool_i64(value: i64, label: &str) -> DbResult<bool> {
    match value {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(DbError::new(
            DbErrorCode::RowDecode,
            format!("{label}: expected 0 or 1 (got {value})"),
        )),
    }
}

fn normalize_catalog_text(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

fn normalize_catalog_search_terms(value: &str) -> Vec<String> {
    normalize_catalog_text(value)
        .split(' ')
        .filter(|term| !term.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn build_catalog_fts_match_query(terms: &[String]) -> Option<String> {
    let mut sanitized_terms = Vec::new();
    for term in terms {
        let normalized = term
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { ' ' })
            .collect::<String>();
        sanitized_terms.extend(
            normalized
                .split_whitespace()
                .filter(|token| !token.is_empty())
                .map(ToOwned::to_owned),
        );
    }
    if sanitized_terms.is_empty() {
        return None;
    }
    Some(
        sanitized_terms
            .iter()
            .map(|term| format!("{term}*"))
            .collect::<Vec<_>>()
            .join(" AND "),
    )
}

fn decode_u32_from_i64(value: i64, label: &str) -> DbResult<u32> {
    u32::try_from(value).map_err(|_| {
        DbError::new(
            DbErrorCode::RowDecode,
            format!("{label}: out of range ({value})"),
        )
    })
}

fn decode_u16_from_i64(value: i64, label: &str) -> DbResult<u16> {
    u16::try_from(value).map_err(|_| {
        DbError::new(
            DbErrorCode::RowDecode,
            format!("{label}: out of range ({value})"),
        )
    })
}

fn decode_non_positive_f32_from_f64(value: f64, label: &str) -> DbResult<f32> {
    let value_f32 = value as f32;
    if !value_f32.is_finite() || value_f32 > 0.0 {
        return Err(DbError::new(
            DbErrorCode::RowDecode,
            format!("{label}: invalid value ({value})"),
        ));
    }
    Ok(value_f32)
}

fn decode_non_positive_opt_f32_from_opt_f64(
    value: Option<f64>,
    label: &str,
) -> DbResult<Option<f32>> {
    value
        .map(|v| decode_non_positive_f32_from_f64(v, label))
        .transpose()
}

fn serialize_json_opt(value: &Option<Value>) -> DbResult<Option<String>> {
    value
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(DbError::serialize_json)
}

fn serialize_vec_f32_json(value: &[f32]) -> DbResult<String> {
    serde_json::to_string(value).map_err(DbError::serialize_json)
}

fn parse_vec_f32_json(value: String) -> DbResult<Vec<f32>> {
    serde_json::from_str::<Vec<f32>>(&value)
        .map_err(DbError::deserialize_json)
        .and_then(|peaks| {
            if peaks.is_empty() {
                return Err(DbError::new(
                    DbErrorCode::Deserialization,
                    "stored peak_data_json must decode to a non-empty array",
                ));
            }
            if peaks.iter().any(|peak| !peak.is_finite() || *peak > 0.0) {
                return Err(DbError::new(
                    DbErrorCode::Deserialization,
                    "stored peak_data_json contains invalid values",
                ));
            }
            Ok(peaks)
        })
}

fn parse_json_opt(value: Option<String>) -> DbResult<Option<Value>> {
    value
        .map(|v| serde_json::from_str(&v))
        .transpose()
        .map_err(DbError::deserialize_json)
}

async fn get_catalog_track_with_executor<'e, E>(
    executor: E,
    track_id: &str,
) -> DbResult<Option<CatalogTrackRecord>>
where
    E: Executor<'e, Database = Sqlite>,
{
    let row = sqlx::query(
        r#"
        SELECT
            t.track_id,
            t.media_asset_id,
            m.content_fingerprint AS media_fingerprint,
            m.primary_file_path AS file_path,
            t.title,
            t.artist_id,
            a.name AS artist_name,
            t.album_id,
            al.title AS album_title,
            t.duration_ms,
            t.peak_data_json,
            t.loudness_lufs,
            t.true_peak_dbfs,
            t.sample_rate_hz,
            t.channels,
            t.visibility_policy,
            t.license_policy,
            t.downloadable,
            t.created_at,
            t.updated_at
        FROM catalog_tracks t
        JOIN catalog_media_assets m ON m.media_asset_id = t.media_asset_id
        JOIN catalog_artists a ON a.artist_id = t.artist_id
        LEFT JOIN catalog_albums al ON al.album_id = t.album_id
        WHERE t.track_id = ?
        "#,
    )
    .bind(track_id)
    .fetch_optional(executor)
    .await
    .map_err(|e| DbError::map_sqlx(e, "fetch catalog track"))?;

    row.map(map_catalog_track_detail_row).transpose()
}

async fn list_catalog_track_tags_with_executor<'e, E>(
    executor: E,
    track_id: &str,
) -> DbResult<Vec<String>>
where
    E: Executor<'e, Database = Sqlite>,
{
    let rows = sqlx::query(
        r#"
        SELECT tg.label
        FROM track_tags tt
        JOIN tags tg ON tg.tag_id = tt.tag_id
        WHERE tt.track_id = ?
        ORDER BY lower(tg.label) ASC, tg.label ASC
        "#,
    )
    .bind(track_id)
    .fetch_all(executor)
    .await
    .map_err(|e| DbError::map_sqlx(e, "list catalog track tags"))?;

    rows.into_iter()
        .map(|row| {
            row.try_get("label")
                .map_err(|e| DbError::map_sqlx(e, "decode tags.label"))
        })
        .collect()
}

fn validate_run_lock_lease_params(
    owner: &str,
    owner_epoch: i64,
    now_unix_ms: i64,
    lease_ttl_ms: i64,
) -> DbResult<i64> {
    if owner.trim().is_empty() {
        return Err(DbError::new(
            DbErrorCode::Query,
            "run lock lease owner cannot be empty",
        ));
    }
    if owner_epoch < 0 {
        return Err(DbError::new(
            DbErrorCode::Query,
            "run lock lease owner_epoch must be non-negative",
        ));
    }
    if now_unix_ms < 0 {
        return Err(DbError::new(
            DbErrorCode::Query,
            "run lock lease now_unix_ms must be non-negative",
        ));
    }
    if lease_ttl_ms <= 0 {
        return Err(DbError::new(
            DbErrorCode::Query,
            "run lock lease ttl must be positive",
        ));
    }
    now_unix_ms
        .checked_add(lease_ttl_ms)
        .ok_or_else(|| DbError::new(DbErrorCode::Query, "run lock lease expiry overflow"))
}

fn map_release_row(row: SqliteRow) -> DbResult<ReleaseRecord> {
    Ok(ReleaseRecord {
        release_id: row
            .try_get("release_id")
            .map_err(|e| DbError::map_sqlx(e, "decode release.release_id"))?,
        title: row
            .try_get("title")
            .map_err(|e| DbError::map_sqlx(e, "decode release.title"))?,
        state: ReleaseState::from_str(
            &row.try_get::<String, _>("state")
                .map_err(|e| DbError::map_sqlx(e, "decode release.state"))?,
        )?,
        spec_hash: row
            .try_get("spec_hash")
            .map_err(|e| DbError::map_sqlx(e, "decode release.spec_hash"))?,
        media_fingerprint: row
            .try_get("media_fingerprint")
            .map_err(|e| DbError::map_sqlx(e, "decode release.media_fingerprint"))?,
        normalized_spec_json: row
            .try_get("normalized_spec_json")
            .map_err(|e| DbError::map_sqlx(e, "decode release.normalized_spec_json"))?,
        last_error: row
            .try_get("last_error")
            .map_err(|e| DbError::map_sqlx(e, "decode release.last_error"))?,
        created_at: row
            .try_get("created_at")
            .map_err(|e| DbError::map_sqlx(e, "decode release.created_at"))?,
        updated_at: row
            .try_get("updated_at")
            .map_err(|e| DbError::map_sqlx(e, "decode release.updated_at"))?,
    })
}

fn map_run_lock_lease_row(row: SqliteRow) -> DbResult<RunLockLeaseRecord> {
    Ok(RunLockLeaseRecord {
        release_id: row
            .try_get("release_id")
            .map_err(|e| DbError::map_sqlx(e, "decode run_lock.release_id"))?,
        owner: row
            .try_get("owner")
            .map_err(|e| DbError::map_sqlx(e, "decode run_lock.owner"))?,
        owner_epoch: row
            .try_get("owner_epoch")
            .map_err(|e| DbError::map_sqlx(e, "decode run_lock.owner_epoch"))?,
        lease_expires_at_unix_ms: row
            .try_get("lease_expires_at_unix_ms")
            .map_err(|e| DbError::map_sqlx(e, "decode run_lock.lease_expires_at_unix_ms"))?,
        created_at: row
            .try_get("created_at")
            .map_err(|e| DbError::map_sqlx(e, "decode run_lock.created_at"))?,
    })
}

fn ensure_release_upsert_invariants_match(
    stored: &ReleaseRecord,
    input: &NewReleaseRecord,
) -> DbResult<()> {
    let mut mismatches = Vec::new();
    if stored.spec_hash != input.spec_hash {
        mismatches.push("spec_hash");
    }
    if stored.media_fingerprint != input.media_fingerprint {
        mismatches.push("media_fingerprint");
    }
    if stored.normalized_spec_json != input.normalized_spec_json {
        mismatches.push("normalized_spec_json");
    }

    if mismatches.is_empty() {
        return Ok(());
    }

    Err(DbError::new(
        DbErrorCode::ConstraintViolation,
        format!(
            "upsert release: release_id `{}` invariant mismatch on conflict ({})",
            input.release_id,
            mismatches.join(", ")
        ),
    ))
}

fn map_release_track_analysis_row(row: SqliteRow) -> DbResult<ReleaseTrackAnalysisRecord> {
    let duration_ms_i64: i64 = row
        .try_get("duration_ms")
        .map_err(|e| DbError::map_sqlx(e, "decode release_track_analysis.duration_ms"))?;
    let sample_rate_hz_i64: i64 = row
        .try_get("sample_rate_hz")
        .map_err(|e| DbError::map_sqlx(e, "decode release_track_analysis.sample_rate_hz"))?;
    let channels_i64: i64 = row
        .try_get("channels")
        .map_err(|e| DbError::map_sqlx(e, "decode release_track_analysis.channels"))?;
    let loudness_lufs_f64: f64 = row
        .try_get("loudness_lufs")
        .map_err(|e| DbError::map_sqlx(e, "decode release_track_analysis.loudness_lufs"))?;

    let duration_ms =
        decode_u32_from_i64(duration_ms_i64, "decode release_track_analysis.duration_ms")?;
    let sample_rate_hz = decode_u32_from_i64(
        sample_rate_hz_i64,
        "decode release_track_analysis.sample_rate_hz",
    )?;
    let channels = decode_u16_from_i64(channels_i64, "decode release_track_analysis.channels")?;
    let loudness_lufs = decode_non_positive_f32_from_f64(
        loudness_lufs_f64,
        "decode release_track_analysis.loudness_lufs",
    )?;

    let peak_data_json: String = row
        .try_get("peak_data_json")
        .map_err(|e| DbError::map_sqlx(e, "decode release_track_analysis.peak_data_json"))?;
    let peak_data = parse_vec_f32_json(peak_data_json)?;

    Ok(ReleaseTrackAnalysisRecord {
        release_id: row
            .try_get("release_id")
            .map_err(|e| DbError::map_sqlx(e, "decode release_track_analysis.release_id"))?,
        file_path: row
            .try_get("file_path")
            .map_err(|e| DbError::map_sqlx(e, "decode release_track_analysis.file_path"))?,
        media_fingerprint: row
            .try_get("media_fingerprint")
            .map_err(|e| DbError::map_sqlx(e, "decode release_track_analysis.media_fingerprint"))?,
        duration_ms,
        peak_data,
        loudness_lufs,
        sample_rate_hz,
        channels,
        created_at: row
            .try_get("created_at")
            .map_err(|e| DbError::map_sqlx(e, "decode release_track_analysis.created_at"))?,
        updated_at: row
            .try_get("updated_at")
            .map_err(|e| DbError::map_sqlx(e, "decode release_track_analysis.updated_at"))?,
    })
}

fn map_catalog_track_list_row(row: SqliteRow) -> DbResult<CatalogTrackListItem> {
    let duration_ms_i64: i64 = row
        .try_get("duration_ms")
        .map_err(|e| DbError::map_sqlx(e, "decode catalog_tracks.duration_ms"))?;
    let duration_ms = decode_u32_from_i64(duration_ms_i64, "decode catalog_tracks.duration_ms")?;

    let loudness_lufs_f64: f64 = row
        .try_get("loudness_lufs")
        .map_err(|e| DbError::map_sqlx(e, "decode catalog_tracks.loudness_lufs"))?;
    let loudness_lufs =
        decode_non_positive_f32_from_f64(loudness_lufs_f64, "decode catalog_tracks.loudness_lufs")?;

    Ok(CatalogTrackListItem {
        track_id: row
            .try_get("track_id")
            .map_err(|e| DbError::map_sqlx(e, "decode catalog_tracks.track_id"))?,
        title: row
            .try_get("title")
            .map_err(|e| DbError::map_sqlx(e, "decode catalog_tracks.title"))?,
        artist_name: row
            .try_get("artist_name")
            .map_err(|e| DbError::map_sqlx(e, "decode catalog_artists.name"))?,
        album_title: row
            .try_get("album_title")
            .map_err(|e| DbError::map_sqlx(e, "decode catalog_albums.title"))?,
        duration_ms,
        loudness_lufs,
        file_path: row
            .try_get("file_path")
            .map_err(|e| DbError::map_sqlx(e, "decode catalog_media_assets.primary_file_path"))?,
        media_fingerprint: row
            .try_get("media_fingerprint")
            .map_err(|e| DbError::map_sqlx(e, "decode catalog_media_assets.content_fingerprint"))?,
        updated_at: row
            .try_get("updated_at")
            .map_err(|e| DbError::map_sqlx(e, "decode catalog_tracks.updated_at"))?,
    })
}

fn map_catalog_track_detail_row(row: SqliteRow) -> DbResult<CatalogTrackRecord> {
    let duration_ms_i64: i64 = row
        .try_get("duration_ms")
        .map_err(|e| DbError::map_sqlx(e, "decode catalog_tracks.duration_ms"))?;
    let sample_rate_hz_i64: i64 = row
        .try_get("sample_rate_hz")
        .map_err(|e| DbError::map_sqlx(e, "decode catalog_tracks.sample_rate_hz"))?;
    let channels_i64: i64 = row
        .try_get("channels")
        .map_err(|e| DbError::map_sqlx(e, "decode catalog_tracks.channels"))?;
    let loudness_lufs_f64: f64 = row
        .try_get("loudness_lufs")
        .map_err(|e| DbError::map_sqlx(e, "decode catalog_tracks.loudness_lufs"))?;
    let true_peak_dbfs_f64: Option<f64> = row
        .try_get("true_peak_dbfs")
        .map_err(|e| DbError::map_sqlx(e, "decode catalog_tracks.true_peak_dbfs"))?;
    let downloadable_i64: i64 = row
        .try_get("downloadable")
        .map_err(|e| DbError::map_sqlx(e, "decode catalog_tracks.downloadable"))?;

    let duration_ms = decode_u32_from_i64(duration_ms_i64, "decode catalog_tracks.duration_ms")?;
    let sample_rate_hz =
        decode_u32_from_i64(sample_rate_hz_i64, "decode catalog_tracks.sample_rate_hz")?;
    let channels = decode_u16_from_i64(channels_i64, "decode catalog_tracks.channels")?;
    let loudness_lufs =
        decode_non_positive_f32_from_f64(loudness_lufs_f64, "decode catalog_tracks.loudness_lufs")?;
    let true_peak_dbfs = decode_non_positive_opt_f32_from_opt_f64(
        true_peak_dbfs_f64,
        "decode catalog_tracks.true_peak_dbfs",
    )?;
    if downloadable_i64 != 0 && downloadable_i64 != 1 {
        return Err(DbError::new(
            DbErrorCode::RowDecode,
            format!("decode catalog_tracks.downloadable: expected 0 or 1 (got {downloadable_i64})"),
        ));
    }

    let peak_data_json: String = row
        .try_get("peak_data_json")
        .map_err(|e| DbError::map_sqlx(e, "decode catalog_tracks.peak_data_json"))?;
    let peak_data = parse_vec_f32_json(peak_data_json)?;

    Ok(CatalogTrackRecord {
        track_id: row
            .try_get("track_id")
            .map_err(|e| DbError::map_sqlx(e, "decode catalog_tracks.track_id"))?,
        media_asset_id: row
            .try_get("media_asset_id")
            .map_err(|e| DbError::map_sqlx(e, "decode catalog_tracks.media_asset_id"))?,
        media_fingerprint: row
            .try_get("media_fingerprint")
            .map_err(|e| DbError::map_sqlx(e, "decode catalog_media_assets.content_fingerprint"))?,
        file_path: row
            .try_get("file_path")
            .map_err(|e| DbError::map_sqlx(e, "decode catalog_media_assets.primary_file_path"))?,
        title: row
            .try_get("title")
            .map_err(|e| DbError::map_sqlx(e, "decode catalog_tracks.title"))?,
        artist_id: row
            .try_get("artist_id")
            .map_err(|e| DbError::map_sqlx(e, "decode catalog_tracks.artist_id"))?,
        artist_name: row
            .try_get("artist_name")
            .map_err(|e| DbError::map_sqlx(e, "decode catalog_artists.name"))?,
        album_id: row
            .try_get("album_id")
            .map_err(|e| DbError::map_sqlx(e, "decode catalog_tracks.album_id"))?,
        album_title: row
            .try_get("album_title")
            .map_err(|e| DbError::map_sqlx(e, "decode catalog_albums.title"))?,
        duration_ms,
        peak_data,
        loudness_lufs,
        true_peak_dbfs,
        sample_rate_hz,
        channels,
        visibility_policy: row
            .try_get("visibility_policy")
            .map_err(|e| DbError::map_sqlx(e, "decode catalog_tracks.visibility_policy"))?,
        license_policy: row
            .try_get("license_policy")
            .map_err(|e| DbError::map_sqlx(e, "decode catalog_tracks.license_policy"))?,
        downloadable: downloadable_i64 == 1,
        created_at: row
            .try_get("created_at")
            .map_err(|e| DbError::map_sqlx(e, "decode catalog_tracks.created_at"))?,
        updated_at: row
            .try_get("updated_at")
            .map_err(|e| DbError::map_sqlx(e, "decode catalog_tracks.updated_at"))?,
    })
}

fn map_library_root_row(row: SqliteRow) -> DbResult<LibraryRootRecord> {
    let enabled_i64: i64 = row
        .try_get("enabled")
        .map_err(|e| DbError::map_sqlx(e, "decode library_roots.enabled"))?;

    Ok(LibraryRootRecord {
        root_id: row
            .try_get("root_id")
            .map_err(|e| DbError::map_sqlx(e, "decode library_roots.root_id"))?,
        path: row
            .try_get("path")
            .map_err(|e| DbError::map_sqlx(e, "decode library_roots.path"))?,
        enabled: decode_sqlite_bool_i64(enabled_i64, "decode library_roots.enabled")?,
        created_at: row
            .try_get("created_at")
            .map_err(|e| DbError::map_sqlx(e, "decode library_roots.created_at"))?,
        updated_at: row
            .try_get("updated_at")
            .map_err(|e| DbError::map_sqlx(e, "decode library_roots.updated_at"))?,
    })
}

fn map_ingest_job_row(row: SqliteRow) -> DbResult<IngestJobRecord> {
    let total_items_i64: i64 = row
        .try_get("total_items")
        .map_err(|e| DbError::map_sqlx(e, "decode ingest_jobs.total_items"))?;
    let processed_items_i64: i64 = row
        .try_get("processed_items")
        .map_err(|e| DbError::map_sqlx(e, "decode ingest_jobs.processed_items"))?;
    let error_count_i64: i64 = row
        .try_get("error_count")
        .map_err(|e| DbError::map_sqlx(e, "decode ingest_jobs.error_count"))?;
    let status = IngestJobStatus::from_str(
        &row.try_get::<String, _>("status")
            .map_err(|e| DbError::map_sqlx(e, "decode ingest_jobs.status"))?,
    )?;
    let total_items = decode_u32_from_i64(total_items_i64, "decode ingest_jobs.total_items")?;
    let processed_items =
        decode_u32_from_i64(processed_items_i64, "decode ingest_jobs.processed_items")?;
    let error_count = decode_u32_from_i64(error_count_i64, "decode ingest_jobs.error_count")?;
    if processed_items > total_items {
        return Err(DbError::new(
            DbErrorCode::RowDecode,
            "decode ingest_jobs: processed_items cannot exceed total_items",
        ));
    }

    Ok(IngestJobRecord {
        job_id: row
            .try_get("job_id")
            .map_err(|e| DbError::map_sqlx(e, "decode ingest_jobs.job_id"))?,
        status,
        scope: row
            .try_get("scope")
            .map_err(|e| DbError::map_sqlx(e, "decode ingest_jobs.scope"))?,
        total_items,
        processed_items,
        error_count,
        created_at: row
            .try_get("created_at")
            .map_err(|e| DbError::map_sqlx(e, "decode ingest_jobs.created_at"))?,
        updated_at: row
            .try_get("updated_at")
            .map_err(|e| DbError::map_sqlx(e, "decode ingest_jobs.updated_at"))?,
    })
}

fn map_ingest_event_row(row: SqliteRow) -> DbResult<IngestEventRecord> {
    Ok(IngestEventRecord {
        id: row
            .try_get("id")
            .map_err(|e| DbError::map_sqlx(e, "decode ingest_events.id"))?,
        job_id: row
            .try_get("job_id")
            .map_err(|e| DbError::map_sqlx(e, "decode ingest_events.job_id"))?,
        level: row
            .try_get("level")
            .map_err(|e| DbError::map_sqlx(e, "decode ingest_events.level"))?,
        message: row
            .try_get("message")
            .map_err(|e| DbError::map_sqlx(e, "decode ingest_events.message"))?,
        payload_json: parse_json_opt(
            row.try_get("payload_json")
                .map_err(|e| DbError::map_sqlx(e, "decode ingest_events.payload_json"))?,
        )?,
        created_at: row
            .try_get("created_at")
            .map_err(|e| DbError::map_sqlx(e, "decode ingest_events.created_at"))?,
    })
}

fn map_platform_action_row(row: SqliteRow) -> DbResult<PlatformActionRecord> {
    Ok(PlatformActionRecord {
        release_id: row
            .try_get("release_id")
            .map_err(|e| DbError::map_sqlx(e, "decode platform.release_id"))?,
        platform: row
            .try_get("platform")
            .map_err(|e| DbError::map_sqlx(e, "decode platform.platform"))?,
        status: PlatformActionStatus::from_str(
            &row.try_get::<String, _>("status")
                .map_err(|e| DbError::map_sqlx(e, "decode platform.status"))?,
        )?,
        plan_json: parse_json_opt(
            row.try_get("plan_json")
                .map_err(|e| DbError::map_sqlx(e, "decode platform.plan_json"))?,
        )?,
        result_json: parse_json_opt(
            row.try_get("result_json")
                .map_err(|e| DbError::map_sqlx(e, "decode platform.result_json"))?,
        )?,
        external_id: row
            .try_get("external_id")
            .map_err(|e| DbError::map_sqlx(e, "decode platform.external_id"))?,
        attempt_count: row
            .try_get("attempt_count")
            .map_err(|e| DbError::map_sqlx(e, "decode platform.attempt_count"))?,
        last_error: row
            .try_get("last_error")
            .map_err(|e| DbError::map_sqlx(e, "decode platform.last_error"))?,
        created_at: row
            .try_get("created_at")
            .map_err(|e| DbError::map_sqlx(e, "decode platform.created_at"))?,
        updated_at: row
            .try_get("updated_at")
            .map_err(|e| DbError::map_sqlx(e, "decode platform.updated_at"))?,
    })
}

fn map_audit_log_row(row: SqliteRow) -> DbResult<AuditLogEntry> {
    Ok(AuditLogEntry {
        id: row
            .try_get("id")
            .map_err(|e| DbError::map_sqlx(e, "decode audit.id"))?,
        release_id: row
            .try_get("release_id")
            .map_err(|e| DbError::map_sqlx(e, "decode audit.release_id"))?,
        stage: row
            .try_get("stage")
            .map_err(|e| DbError::map_sqlx(e, "decode audit.stage"))?,
        message: row
            .try_get("message")
            .map_err(|e| DbError::map_sqlx(e, "decode audit.message"))?,
        payload_json: row
            .try_get("payload_json")
            .map_err(|e| DbError::map_sqlx(e, "decode audit.payload_json"))?,
        created_at: row
            .try_get("created_at")
            .map_err(|e| DbError::map_sqlx(e, "decode audit.created_at"))?,
    })
}
