use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{
    sqlite::{SqlitePoolOptions, SqliteRow},
    Row, Sqlite, SqlitePool, Transaction,
};
use std::str::FromStr;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

pub type DbResult<T> = Result<T, DbError>;

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct DbError {
    pub code: DbErrorCode,
    pub message: String,
}

impl DbError {
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
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Planned => "PLANNED",
            Self::Executing => "EXECUTING",
            Self::Verified => "VERIFIED",
            Self::Failed => "FAILED",
            Self::Skipped => "SKIPPED",
        }
    }

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryItem {
    pub release_id: String,
    pub state: String,
    pub title: String,
    pub updated_at: String,
}

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NewReleaseRecord {
    pub release_id: String,
    pub title: String,
    pub state: ReleaseState,
    pub spec_hash: String,
    pub media_fingerprint: String,
    pub normalized_spec_json: String,
}

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuditLogEntry {
    pub id: i64,
    pub release_id: String,
    pub stage: String,
    pub message: String,
    pub payload_json: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NewAuditLogEntry {
    pub release_id: String,
    pub stage: String,
    pub message: String,
    pub payload_json: Option<Value>,
}

#[derive(Debug, Clone)]
pub struct DbConfig {
    pub database_url: String,
    pub max_connections: u32,
}

impl DbConfig {
    pub fn sqlite(database_url: impl Into<String>) -> Self {
        Self {
            database_url: database_url.into(),
            max_connections: 5,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Db {
    pool: SqlitePool,
}

pub struct DbTx<'a> {
    inner: Transaction<'a, Sqlite>,
}

impl Db {
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

        MIGRATOR.run(&pool).await.map_err(|e| {
            DbError::new(
                DbErrorCode::Migration,
                format!("failed to run migrations: {e}"),
            )
        })?;

        Ok(Self { pool })
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub async fn begin_tx(&self) -> DbResult<DbTx<'_>> {
        let inner = self
            .pool
            .begin()
            .await
            .map_err(|e| DbError::map_sqlx(e, "begin transaction"))?;
        Ok(DbTx { inner })
    }

    pub async fn upsert_release(&self, input: &NewReleaseRecord) -> DbResult<ReleaseRecord> {
        sqlx::query(
            r#"
            INSERT INTO releases (
                release_id, title, state, spec_hash, media_fingerprint, normalized_spec_json
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(release_id) DO UPDATE SET
                title = excluded.title,
                updated_at = CURRENT_TIMESTAMP
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

        self.get_release(&input.release_id)
            .await?
            .ok_or_else(|| DbError::new(DbErrorCode::NotFound, "release missing after upsert"))
    }

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
    pub async fn commit(self) -> DbResult<()> {
        self.inner
            .commit()
            .await
            .map_err(|e| DbError::map_sqlx(e, "commit transaction"))
    }

    pub async fn rollback(self) -> DbResult<()> {
        self.inner
            .rollback()
            .await
            .map_err(|e| DbError::map_sqlx(e, "rollback transaction"))
    }

    pub async fn upsert_release(&mut self, input: &NewReleaseRecord) -> DbResult<ReleaseRecord> {
        sqlx::query(
            r#"
            INSERT INTO releases (
                release_id, title, state, spec_hash, media_fingerprint, normalized_spec_json
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(release_id) DO UPDATE SET
                title = excluded.title,
                updated_at = CURRENT_TIMESTAMP
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

        self.get_release(&input.release_id)
            .await?
            .ok_or_else(|| DbError::new(DbErrorCode::NotFound, "release missing after upsert"))
    }

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

fn serialize_json_opt(value: &Option<Value>) -> DbResult<Option<String>> {
    value
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(DbError::serialize_json)
}

fn parse_json_opt(value: Option<String>) -> DbResult<Option<Value>> {
    value
        .map(|v| serde_json::from_str(&v))
        .transpose()
        .map_err(DbError::deserialize_json)
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
