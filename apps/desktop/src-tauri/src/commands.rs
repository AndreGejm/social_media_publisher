use release_publisher_core::orchestrator::{
    Orchestrator, OrchestratorError, PlannedRelease, ReleaseReportArtifact, RunReleaseInput,
};
use release_publisher_core::pipeline::{ExecutionEnvironment, PlannedAction as CorePlannedAction};
use release_publisher_core::spec::{parse_release_spec_yaml, ReleaseSpec, SpecError};
use release_publisher_db::{Db, DbConfig, DbError};
use release_publisher_mock_connector::MockPublisher;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use tokio::sync::OnceCell;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AppEnv {
    Test,
    Staging,
    Production,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadSpecResponse {
    pub ok: bool,
    pub spec: Option<ReleaseSpec>,
    pub errors: Vec<SpecError>,
    pub canonical_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanReleaseInput {
    pub media_path: String,
    pub spec_path: String,
    pub platforms: Vec<String>,
    pub env: AppEnv,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlannedAction {
    pub platform: String,
    pub action: String,
    pub simulated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanReleaseResponse {
    pub release_id: String,
    pub planned_actions: Vec<PlannedAction>,
    pub env: AppEnv,
    pub run_id: String,
    pub planned_request_files: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecuteReleaseResponse {
    pub release_id: String,
    pub status: String,
    pub message: String,
    pub report_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryRow {
    pub release_id: String,
    pub state: String,
    pub title: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseReport {
    pub release_id: String,
    pub summary: String,
    pub actions: Vec<PlannedAction>,
    pub raw: Option<Value>,
}

const PLANNED_RELEASE_DESCRIPTOR_SCHEMA_VERSION: u32 = 1;
const PLANNED_RELEASE_DESCRIPTOR_FILE_NAME: &str = "planned_release_descriptor.json";

mod app_error_codes {
    pub const DB_PREFIX: &str = "DB_";

    pub const INVALID_ARGUMENT: &str = "INVALID_ARGUMENT";
    pub const FILE_READ_FAILED: &str = "FILE_READ_FAILED";
    pub const FILE_WRITE_FAILED: &str = "FILE_WRITE_FAILED";
    pub const INVALID_ENCODING: &str = "INVALID_ENCODING";
    pub const IO_ERROR: &str = "IO_ERROR";
    pub const SERIALIZATION_ERROR: &str = "SERIALIZATION_ERROR";

    pub const SPEC_VALIDATION_FAILED: &str = "SPEC_VALIDATION_FAILED";
    pub const REPORT_DECODE_FAILED: &str = "REPORT_DECODE_FAILED";
    pub const PLANNED_RELEASE_NOT_FOUND: &str = "PLANNED_RELEASE_NOT_FOUND";
    pub const PLANNED_RELEASE_DESCRIPTOR_DECODE_FAILED: &str =
        "PLANNED_RELEASE_DESCRIPTOR_DECODE_FAILED";
    pub const PLANNED_RELEASE_DESCRIPTOR_UNSUPPORTED_VERSION: &str =
        "PLANNED_RELEASE_DESCRIPTOR_UNSUPPORTED_VERSION";
    pub const PLANNED_RELEASE_DESCRIPTOR_INVALID: &str = "PLANNED_RELEASE_DESCRIPTOR_INVALID";
    pub const PLANNED_RELEASE_DESCRIPTOR_INTEGRITY_MISMATCH: &str =
        "PLANNED_RELEASE_DESCRIPTOR_INTEGRITY_MISMATCH";

    pub const ORCHESTRATOR_INVALID_INPUT: &str = "ORCHESTRATOR_INVALID_INPUT";
    pub const ORCHESTRATOR_UNKNOWN_PUBLISHER: &str = "ORCHESTRATOR_UNKNOWN_PUBLISHER";
    pub const ORCHESTRATOR_DUPLICATE_PUBLISHER: &str = "ORCHESTRATOR_DUPLICATE_PUBLISHER";
    pub const CAP_EXCEEDED: &str = "CAP_EXCEEDED";
    pub const TEST_GUARDRAIL_VIOLATION: &str = "TEST_GUARDRAIL_VIOLATION";
    pub const INVALID_RELEASE_STATE: &str = "INVALID_RELEASE_STATE";

    #[cfg(test)]
    pub const TEST_REDACTION_PROBE: &str = "TEST_REDACTION_PROBE";
    #[cfg(test)]
    pub const TEST_SECRET_STORE_REDACTION: &str = "TEST_SECRET_STORE_REDACTION";
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct PersistedPlannedReleaseDescriptor {
    schema_version: u32,
    release_id: String,
    run_id: String,
    env: ExecutionEnvironment,
    platforms: Vec<String>,
    max_actions_per_platform_per_run: u32,
    planned_actions: BTreeMap<String, Vec<CorePlannedAction>>,
    planned_request_files: BTreeMap<String, String>,
    spec_hash: String,
    media_fingerprint: String,
}

impl PersistedPlannedReleaseDescriptor {
    fn from_planned_release(planned: &PlannedRelease) -> Self {
        Self {
            schema_version: PLANNED_RELEASE_DESCRIPTOR_SCHEMA_VERSION,
            release_id: planned.release_id.clone(),
            run_id: planned.run_id.clone(),
            env: planned.env.clone(),
            platforms: planned.platforms.clone(),
            max_actions_per_platform_per_run: planned.max_actions_per_platform_per_run,
            planned_actions: planned.planned_actions.clone(),
            planned_request_files: planned
                .planned_request_files
                .iter()
                .map(|(platform, path)| (platform.clone(), path_to_string(path)))
                .collect(),
            spec_hash: planned.spec_hash.clone(),
            media_fingerprint: planned.media_fingerprint.clone(),
        }
    }

    fn into_planned_release(self, artifacts_root: &Path) -> PlannedRelease {
        let release_dir = artifacts_root.join(&self.release_id);
        let planned_requests_dir = release_dir.join("planned_requests");
        PlannedRelease {
            release_id: self.release_id,
            run_id: self.run_id,
            env: self.env,
            platforms: self.platforms,
            max_actions_per_platform_per_run: self.max_actions_per_platform_per_run,
            release_dir,
            planned_requests_dir,
            planned_actions: self.planned_actions,
            planned_request_files: self
                .planned_request_files
                .into_iter()
                .map(|(platform, path)| (platform, PathBuf::from(path)))
                .collect(),
            spec_hash: self.spec_hash,
            media_fingerprint: self.media_fingerprint,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub details: Option<Value>,
}

impl AppError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }

    fn with_details(mut self, details: Value) -> Self {
        self.details = Some(redact_error_details_value(details));
        self
    }

    fn invalid_argument(message: impl Into<String>) -> Self {
        Self::new(app_error_codes::INVALID_ARGUMENT, message)
    }

    fn file_read_failed(message: impl Into<String>) -> Self {
        Self::new(app_error_codes::FILE_READ_FAILED, message)
    }

    fn file_write_failed(message: impl Into<String>) -> Self {
        Self::new(app_error_codes::FILE_WRITE_FAILED, message)
    }

    fn invalid_encoding(message: impl Into<String>) -> Self {
        Self::new(app_error_codes::INVALID_ENCODING, message)
    }
}

fn redact_error_details_value(value: Value) -> Value {
    match value {
        Value::Array(items) => {
            Value::Array(items.into_iter().map(redact_error_details_value).collect())
        }
        Value::Object(map) => {
            let redacted = map
                .into_iter()
                .map(|(key, value)| {
                    if is_sensitive_detail_key(&key) {
                        (key, Value::String("<redacted>".to_string()))
                    } else {
                        (key, redact_error_details_value(value))
                    }
                })
                .collect();
            Value::Object(redacted)
        }
        other => other,
    }
}

fn is_sensitive_detail_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    lower.contains("authorization")
        || lower.contains("cookie")
        || lower.contains("refresh_token")
        || lower.contains("refresh-token")
        || lower.contains("client_secret")
        || lower.contains("client-secret")
        || lower.contains("api_key")
        || lower.contains("api-key")
}

impl From<DbError> for AppError {
    fn from(value: DbError) -> Self {
        Self::new(
            format!(
                "{}{}",
                app_error_codes::DB_PREFIX,
                db_error_code_name(&value).to_ascii_uppercase()
            ),
            value.to_string(),
        )
        .with_details(serde_json::json!({
            "db_error_code": value.code,
        }))
    }
}

impl From<OrchestratorError> for AppError {
    fn from(value: OrchestratorError) -> Self {
        match value {
            OrchestratorError::InvalidInput(message) => {
                Self::new(app_error_codes::ORCHESTRATOR_INVALID_INPUT, message)
            }
            OrchestratorError::UnknownPublisher { platform } => Self::new(
                app_error_codes::ORCHESTRATOR_UNKNOWN_PUBLISHER,
                format!("unknown publisher `{platform}`"),
            ),
            OrchestratorError::DuplicatePublisher { platform } => Self::new(
                app_error_codes::ORCHESTRATOR_DUPLICATE_PUBLISHER,
                format!("duplicate publisher `{platform}`"),
            ),
            OrchestratorError::CapExceeded {
                platform,
                count,
                cap,
            } => Self::new(
                app_error_codes::CAP_EXCEEDED,
                format!("per-run action cap exceeded for `{platform}`"),
            )
            .with_details(serde_json::json!({ "platform": platform, "count": count, "cap": cap })),
            OrchestratorError::TestGuardrailViolation { platform } => Self::new(
                app_error_codes::TEST_GUARDRAIL_VIOLATION,
                format!("TEST environment requires simulated actions/results for `{platform}`"),
            ),
            OrchestratorError::InvalidReleaseState(message) => {
                Self::new(app_error_codes::INVALID_RELEASE_STATE, message)
            }
            OrchestratorError::Db(error) => Self::from(error),
            OrchestratorError::Io(error) => Self::new(app_error_codes::IO_ERROR, error.to_string()),
            OrchestratorError::Serialization(error) => {
                Self::new(app_error_codes::SERIALIZATION_ERROR, error.to_string())
            }
        }
    }
}

struct CommandService {
    orchestrator: Arc<Orchestrator>,
    artifacts_root: PathBuf,
}

impl CommandService {
    async fn from_default_location() -> Result<Self, AppError> {
        let base_dir = resolve_runtime_base_dir()?;
        Self::for_base_dir(base_dir).await
    }

    async fn for_base_dir(base_dir: PathBuf) -> Result<Self, AppError> {
        tokio::fs::create_dir_all(&base_dir).await.map_err(|e| {
            AppError::file_read_failed(format!("failed to create runtime dir: {e}"))
        })?;
        let artifacts_root = base_dir.join("artifacts");
        tokio::fs::create_dir_all(&artifacts_root)
            .await
            .map_err(|e| {
                AppError::file_read_failed(format!("failed to create artifacts dir: {e}"))
            })?;

        let db_path = base_dir.join("release_publisher.sqlite");
        tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(false)
            .open(&db_path)
            .await
            .map_err(|e| AppError::file_read_failed(format!("failed to create DB file: {e}")))?;
        let db_url = sqlite_url_for_path(&db_path);
        let mut cfg = DbConfig::sqlite(db_url);
        cfg.max_connections = 1;
        let db = Db::connect(&cfg).await?;
        let orchestrator = Orchestrator::with_publishers(
            db,
            vec![Arc::new(MockPublisher) as Arc<dyn release_publisher_core::pipeline::Publisher>],
        )
        .map_err(AppError::from)?;

        Ok(Self {
            orchestrator: Arc::new(orchestrator),
            artifacts_root,
        })
    }

    async fn handle_load_spec(&self, path: String) -> Result<LoadSpecResponse, AppError> {
        let canonical = canonicalize_file_path(&path, "spec file").await?;
        let bytes = tokio::fs::read(&canonical)
            .await
            .map_err(|e| AppError::file_read_failed(format!("failed to read spec file: {e}")))?;
        let raw = String::from_utf8(bytes).map_err(|e| {
            AppError::invalid_encoding(format!("spec file must be valid UTF-8: {e}"))
        })?;

        match parse_release_spec_yaml(&raw) {
            Ok(spec) => Ok(LoadSpecResponse {
                ok: true,
                spec: Some(spec),
                errors: vec![],
                canonical_path: Some(path_to_string(&canonical)),
            }),
            Err(errors) => Ok(LoadSpecResponse {
                ok: false,
                spec: None,
                errors,
                canonical_path: Some(path_to_string(&canonical)),
            }),
        }
    }

    async fn handle_plan_release(
        &self,
        input: PlanReleaseInput,
    ) -> Result<PlanReleaseResponse, AppError> {
        let spec_path = canonicalize_file_path(&input.spec_path, "spec file").await?;
        let media_path = canonicalize_file_path(&input.media_path, "media file").await?;

        let spec_bytes = tokio::fs::read(&spec_path)
            .await
            .map_err(|e| AppError::file_read_failed(format!("failed to read spec file: {e}")))?;
        let media_bytes = tokio::fs::read(&media_path)
            .await
            .map_err(|e| AppError::file_read_failed(format!("failed to read media file: {e}")))?;
        let raw_spec = String::from_utf8(spec_bytes).map_err(|e| {
            AppError::invalid_encoding(format!("spec file must be valid UTF-8: {e}"))
        })?;
        let spec = parse_release_spec_yaml(&raw_spec).map_err(|errors| {
            AppError::new(
                app_error_codes::SPEC_VALIDATION_FAILED,
                "release spec is invalid",
            )
            .with_details(serde_json::json!({ "errors": errors }))
        })?;

        let planned = self
            .orchestrator
            .plan_release(RunReleaseInput::new(
                spec,
                media_bytes,
                input.env.clone().into(),
                input.platforms.clone(),
                &self.artifacts_root,
            ))
            .await?;

        let response = PlanReleaseResponse {
            release_id: planned.release_id.clone(),
            run_id: planned.run_id.clone(),
            env: input.env,
            planned_actions: flatten_planned_actions(&planned),
            planned_request_files: planned
                .planned_request_files
                .iter()
                .map(|(platform, path)| (platform.clone(), path_to_string(path)))
                .collect(),
        };

        persist_planned_release_descriptor(&planned).await?;

        Ok(response)
    }

    async fn handle_execute_release(
        &self,
        release_id: String,
    ) -> Result<ExecuteReleaseResponse, AppError> {
        let release_id = validate_release_id_for_artifact_lookup(&release_id)?;
        let planned = self
            .load_persisted_planned_release_descriptor(&release_id)
            .await?
            .ok_or_else(|| {
                AppError::new(
                    app_error_codes::PLANNED_RELEASE_NOT_FOUND,
                    "release must be planned before execution and have a valid persisted descriptor",
                )
            })?;

        let output = self.orchestrator.execute_planned_release(planned).await?;
        Ok(ExecuteReleaseResponse {
            release_id: output.report.release_id.clone(),
            status: output.report.state.clone(),
            message: "Execution completed (TEST mode remains simulation-only).".to_string(),
            report_path: Some(path_to_string(&output.release_report_path)),
        })
    }

    async fn handle_list_history(&self) -> Result<Vec<HistoryRow>, AppError> {
        let rows = self.orchestrator.db().list_history().await?;
        Ok(rows
            .into_iter()
            .map(|row| HistoryRow {
                release_id: row.release_id,
                state: row.state,
                title: row.title,
                updated_at: row.updated_at,
            })
            .collect())
    }

    async fn handle_get_report(
        &self,
        release_id: String,
    ) -> Result<Option<ReleaseReport>, AppError> {
        let release_id = validate_release_id_for_artifact_lookup(&release_id)?;
        let report_path = self
            .artifacts_root
            .join(&release_id)
            .join("release_report.json");
        let exists = tokio::fs::try_exists(&report_path)
            .await
            .map_err(|e| AppError::file_read_failed(format!("failed to check report file: {e}")))?;
        if !exists {
            return Ok(None);
        }

        let bytes = tokio::fs::read(&report_path)
            .await
            .map_err(|e| AppError::file_read_failed(format!("failed to read report file: {e}")))?;
        let (parsed, raw) = decode_release_report_artifact_and_raw(&bytes)?;

        Ok(Some(ReleaseReport {
            release_id: parsed.release_id.clone(),
            summary: format!(
                "{} [{}] {} platform(s)",
                parsed.title,
                parsed.state,
                parsed.platforms.len()
            ),
            actions: parsed
                .platforms
                .iter()
                .map(|platform| PlannedAction {
                    platform: platform.platform.clone(),
                    action: format!(
                        "{} ({})",
                        platform.status,
                        if platform.simulated {
                            "simulated"
                        } else {
                            "live"
                        }
                    ),
                    simulated: platform.simulated,
                })
                .collect(),
            raw: Some(raw),
        }))
    }

    async fn load_persisted_planned_release_descriptor(
        &self,
        release_id: &str,
    ) -> Result<Option<PlannedRelease>, AppError> {
        let Some(descriptor) =
            read_persisted_planned_release_descriptor(&self.artifacts_root, release_id).await?
        else {
            return Ok(None);
        };

        validate_planned_release_descriptor_structure(&descriptor)?;
        let release = self
            .orchestrator
            .db()
            .get_release(release_id)
            .await?
            .ok_or_else(|| {
                AppError::new(
                    app_error_codes::PLANNED_RELEASE_DESCRIPTOR_INTEGRITY_MISMATCH,
                    "persisted planned release descriptor has no matching release record",
                )
            })?;

        if descriptor.release_id != release.release_id
            || descriptor.spec_hash != release.spec_hash
            || descriptor.media_fingerprint != release.media_fingerprint
        {
            return Err(AppError::new(
                app_error_codes::PLANNED_RELEASE_DESCRIPTOR_INTEGRITY_MISMATCH,
                "persisted planned release descriptor integrity check failed",
            )
            .with_details(serde_json::json!({
                "release_id": descriptor.release_id,
                "expected_release_id": release.release_id,
                "spec_hash": descriptor.spec_hash,
                "expected_spec_hash": release.spec_hash,
                "media_fingerprint": descriptor.media_fingerprint,
                "expected_media_fingerprint": release.media_fingerprint,
            })));
        }

        Ok(Some(descriptor.into_planned_release(&self.artifacts_root)))
    }
}

fn resolve_runtime_base_dir() -> Result<PathBuf, AppError> {
    static DEFAULT_BASE_DIR: OnceLock<PathBuf> = OnceLock::new();
    if let Ok(value) = std::env::var("RELEASE_PUBLISHER_DATA_DIR") {
        return Ok(PathBuf::from(value));
    }
    let default = DEFAULT_BASE_DIR.get_or_init(|| {
        #[cfg(target_os = "windows")]
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            return PathBuf::from(local_app_data).join("ReleasePublisher");
        }

        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(".release-publisher-data")
    });
    Ok(default.clone())
}

fn sqlite_url_for_path(path: &Path) -> String {
    let mut normalized = path.to_string_lossy().replace('\\', "/");
    if normalized.len() >= 2 {
        let bytes = normalized.as_bytes();
        if bytes[1] == b':' && bytes[0].is_ascii_alphabetic() && !normalized.starts_with('/') {
            normalized.insert(0, '/');
        }
    }
    format!("sqlite://{normalized}")
}

fn db_error_code_name(error: &DbError) -> &'static str {
    match error.code {
        release_publisher_db::DbErrorCode::Connection => "connection",
        release_publisher_db::DbErrorCode::Migration => "migration",
        release_publisher_db::DbErrorCode::ConstraintViolation => "constraint_violation",
        release_publisher_db::DbErrorCode::BusyLocked => "busy_locked",
        release_publisher_db::DbErrorCode::NotFound => "not_found",
        release_publisher_db::DbErrorCode::InvalidStateTransition => "invalid_state_transition",
        release_publisher_db::DbErrorCode::Serialization => "serialization",
        release_publisher_db::DbErrorCode::Deserialization => "deserialization",
        release_publisher_db::DbErrorCode::RowDecode => "row_decode",
        release_publisher_db::DbErrorCode::Io => "io",
        release_publisher_db::DbErrorCode::Query => "query",
        release_publisher_db::DbErrorCode::Unknown => "unknown",
    }
}

async fn shared_service() -> Result<Arc<CommandService>, AppError> {
    static SERVICE: OnceCell<Arc<CommandService>> = OnceCell::const_new();
    SERVICE
        .get_or_try_init(|| async { CommandService::from_default_location().await.map(Arc::new) })
        .await
        .map(Arc::clone)
}

fn decode_release_report_artifact_and_raw(
    bytes: &[u8],
) -> Result<(ReleaseReportArtifact, Value), AppError> {
    // Decode from bytes once to preserve raw unknown fields while avoiding a second byte parse.
    let raw: Value = serde_json::from_slice(bytes)
        .map_err(|e| AppError::new(app_error_codes::REPORT_DECODE_FAILED, e.to_string()))?;
    let parsed: ReleaseReportArtifact = serde_json::from_value(raw.clone())
        .map_err(|e| AppError::new(app_error_codes::REPORT_DECODE_FAILED, e.to_string()))?;
    Ok((parsed, raw))
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn planned_release_descriptor_path(release_dir: &Path) -> PathBuf {
    release_dir.join(PLANNED_RELEASE_DESCRIPTOR_FILE_NAME)
}

async fn persist_planned_release_descriptor(planned: &PlannedRelease) -> Result<(), AppError> {
    let path = planned_release_descriptor_path(&planned.release_dir);
    let descriptor = PersistedPlannedReleaseDescriptor::from_planned_release(planned);
    let bytes = serde_json::to_vec_pretty(&descriptor).map_err(|e| {
        AppError::new(
            app_error_codes::SERIALIZATION_ERROR,
            format!("failed to serialize planned release descriptor: {e}"),
        )
    })?;
    tokio::fs::write(&path, bytes).await.map_err(|e| {
        AppError::file_write_failed(format!("failed to write planned release descriptor: {e}"))
    })?;
    Ok(())
}

async fn read_persisted_planned_release_descriptor(
    artifacts_root: &Path,
    release_id: &str,
) -> Result<Option<PersistedPlannedReleaseDescriptor>, AppError> {
    let release_dir = artifacts_root.join(release_id);
    let path = planned_release_descriptor_path(&release_dir);
    let exists = tokio::fs::try_exists(&path).await.map_err(|e| {
        AppError::file_read_failed(format!("failed to check planned descriptor: {e}"))
    })?;
    if !exists {
        return Ok(None);
    }

    let bytes = tokio::fs::read(&path).await.map_err(|e| {
        AppError::file_read_failed(format!("failed to read planned descriptor: {e}"))
    })?;
    let descriptor: PersistedPlannedReleaseDescriptor =
        serde_json::from_slice(&bytes).map_err(|e| {
            AppError::new(
                app_error_codes::PLANNED_RELEASE_DESCRIPTOR_DECODE_FAILED,
                format!("failed to decode planned release descriptor: {e}"),
            )
        })?;
    if descriptor.schema_version != PLANNED_RELEASE_DESCRIPTOR_SCHEMA_VERSION {
        return Err(AppError::new(
            app_error_codes::PLANNED_RELEASE_DESCRIPTOR_UNSUPPORTED_VERSION,
            format!(
                "unsupported planned release descriptor schema version `{}`",
                descriptor.schema_version
            ),
        ));
    }
    Ok(Some(descriptor))
}

fn validate_planned_release_descriptor_structure(
    descriptor: &PersistedPlannedReleaseDescriptor,
) -> Result<(), AppError> {
    if descriptor.platforms.is_empty() {
        return Err(AppError::new(
            app_error_codes::PLANNED_RELEASE_DESCRIPTOR_INVALID,
            "persisted planned release descriptor must include at least one platform",
        ));
    }

    for platform in &descriptor.platforms {
        if !descriptor.planned_actions.contains_key(platform) {
            return Err(AppError::new(
                app_error_codes::PLANNED_RELEASE_DESCRIPTOR_INVALID,
                format!("missing planned actions for platform `{platform}`"),
            ));
        }
        if !descriptor.planned_request_files.contains_key(platform) {
            return Err(AppError::new(
                app_error_codes::PLANNED_RELEASE_DESCRIPTOR_INVALID,
                format!("missing planned request file for platform `{platform}`"),
            ));
        }
    }

    if !is_64_char_hex(&descriptor.spec_hash) || !is_64_char_hex(&descriptor.media_fingerprint) {
        return Err(AppError::new(
            app_error_codes::PLANNED_RELEASE_DESCRIPTOR_INVALID,
            "persisted planned release descriptor contains invalid integrity fields",
        ));
    }

    Ok(())
}

fn is_64_char_hex(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())
}

fn validate_release_id_for_artifact_lookup(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid_argument("release_id cannot be empty"));
    }
    if trimmed.len() != 64 {
        return Err(AppError::invalid_argument(
            "release_id must be a 64-character hex string",
        ));
    }
    if !trimmed.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(AppError::invalid_argument(
            "release_id must be a 64-character hex string",
        ));
    }
    Ok(trimmed.to_ascii_lowercase())
}

fn reject_odd_prefixes(raw: &str) -> Result<(), AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid_argument("path cannot be empty"));
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("file:") {
        return Err(AppError::invalid_argument(
            "file:// style paths are not supported",
        ));
    }
    if trimmed.starts_with("\\\\?\\") || trimmed.starts_with("\\\\.\\") {
        return Err(AppError::invalid_argument(
            "extended/device paths are not allowed",
        ));
    }
    if trimmed.starts_with("\\\\") || trimmed.starts_with("//") {
        return Err(AppError::invalid_argument(
            "UNC/network paths are not allowed",
        ));
    }
    Ok(())
}

async fn canonicalize_file_path(input: &str, label: &str) -> Result<PathBuf, AppError> {
    reject_odd_prefixes(input)?;
    let path = PathBuf::from(input.trim());
    let canonical = tokio::fs::canonicalize(&path)
        .await
        .map_err(|e| AppError::file_read_failed(format!("failed to canonicalize {label}: {e}")))?;
    let metadata = tokio::fs::metadata(&canonical)
        .await
        .map_err(|e| AppError::file_read_failed(format!("failed to stat {label}: {e}")))?;
    if !metadata.is_file() {
        return Err(AppError::invalid_argument(format!(
            "{label} must be a file"
        )));
    }
    Ok(canonical)
}

fn flatten_planned_actions(planned: &PlannedRelease) -> Vec<PlannedAction> {
    planned
        .planned_actions
        .values()
        .flat_map(|actions| actions.iter())
        .map(|action| PlannedAction {
            platform: action.platform.clone(),
            action: action.action.clone(),
            simulated: action.simulated,
        })
        .collect()
}

impl From<AppEnv> for ExecutionEnvironment {
    fn from(value: AppEnv) -> Self {
        match value {
            AppEnv::Test => Self::Test,
            AppEnv::Staging => Self::Staging,
            AppEnv::Production => Self::Production,
        }
    }
}

#[tauri::command]
pub async fn load_spec(path: String) -> Result<LoadSpecResponse, AppError> {
    shared_service().await?.handle_load_spec(path).await
}

#[tauri::command]
pub async fn plan_release(input: PlanReleaseInput) -> Result<PlanReleaseResponse, AppError> {
    shared_service().await?.handle_plan_release(input).await
}

#[tauri::command]
pub async fn execute_release(release_id: String) -> Result<ExecuteReleaseResponse, AppError> {
    shared_service()
        .await?
        .handle_execute_release(release_id)
        .await
}

#[tauri::command]
pub async fn list_history() -> Result<Vec<HistoryRow>, AppError> {
    shared_service().await?.handle_list_history().await
}

#[tauri::command]
pub async fn get_report(release_id: String) -> Result<Option<ReleaseReport>, AppError> {
    shared_service().await?.handle_get_report(release_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use release_publisher_core::secrets::{
        InMemorySecretStore, SecretRecord, SecretStore, SecretValue,
    };
    use tempfile::tempdir;

    async fn new_service() -> (CommandService, tempfile::TempDir) {
        let dir = tempdir().expect("tempdir");
        let service = CommandService::for_base_dir(dir.path().join("runtime"))
            .await
            .expect("service");
        (service, dir)
    }

    async fn write_fixture_files(dir: &Path) -> (String, String) {
        let spec_path = dir.join("spec.yaml");
        let media_path = dir.join("media.bin");
        tokio::fs::write(
            &spec_path,
            br#"title: "Test"
artist: "Artist"
description: "Desc"
tags: ["mock"]"#,
        )
        .await
        .expect("write spec");
        tokio::fs::write(&media_path, b"media-bytes")
            .await
            .expect("write media");
        (
            spec_path.to_string_lossy().to_string(),
            media_path.to_string_lossy().to_string(),
        )
    }

    fn assert_app_error_wire_top_level_shape(wire: &serde_json::Value) {
        let object = wire
            .as_object()
            .expect("AppError should serialize to a JSON object");
        let mut keys: Vec<_> = object.keys().cloned().collect();
        keys.sort();
        assert_eq!(keys, vec!["code", "details", "message"]);
    }

    #[tokio::test]
    async fn command_service_plan_execute_history_report_happy_path() {
        let (service, dir) = new_service().await;
        let (spec_path, media_path) = write_fixture_files(dir.path()).await;

        let plan = service
            .handle_plan_release(PlanReleaseInput {
                media_path,
                spec_path,
                platforms: vec!["mock".to_string()],
                env: AppEnv::Test,
            })
            .await
            .expect("plan");
        assert_eq!(plan.release_id.len(), 64);
        assert_eq!(plan.env, AppEnv::Test);
        assert_eq!(plan.planned_actions.len(), 1);
        assert!(plan.planned_actions[0].simulated);

        let exec = service
            .handle_execute_release(plan.release_id.clone())
            .await
            .expect("execute");
        assert_eq!(exec.release_id, plan.release_id);
        assert_eq!(exec.status, "COMMITTED");
        assert!(exec.report_path.is_some());

        let history = service.handle_list_history().await.expect("history");
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].release_id, plan.release_id);

        let report = service
            .handle_get_report(plan.release_id.clone())
            .await
            .expect("report")
            .expect("report exists");
        assert_eq!(report.release_id, plan.release_id);
        assert!(report.summary.contains("COMMITTED"));
    }

    #[tokio::test]
    async fn plan_release_persists_descriptor_artifact_with_integrity_fields() {
        let (service, dir) = new_service().await;
        let (spec_path, media_path) = write_fixture_files(dir.path()).await;

        let plan = service
            .handle_plan_release(PlanReleaseInput {
                media_path,
                spec_path,
                platforms: vec!["mock".to_string()],
                env: AppEnv::Test,
            })
            .await
            .expect("plan");

        let release_dir = service.artifacts_root.join(&plan.release_id);
        let descriptor_path = planned_release_descriptor_path(&release_dir);
        assert!(
            tokio::fs::try_exists(&descriptor_path)
                .await
                .expect("descriptor existence check"),
            "planned descriptor should exist at {}",
            descriptor_path.display()
        );

        let bytes = tokio::fs::read(&descriptor_path)
            .await
            .expect("read planned descriptor");
        let descriptor: PersistedPlannedReleaseDescriptor =
            serde_json::from_slice(&bytes).expect("decode planned descriptor");

        assert_eq!(
            descriptor.schema_version,
            PLANNED_RELEASE_DESCRIPTOR_SCHEMA_VERSION
        );
        assert_eq!(descriptor.release_id, plan.release_id);
        assert_eq!(descriptor.run_id, plan.run_id);
        assert_eq!(descriptor.env, ExecutionEnvironment::Test);
        assert_eq!(descriptor.platforms, vec!["mock".to_string()]);
        assert_eq!(descriptor.max_actions_per_platform_per_run, 1);
        assert_eq!(descriptor.spec_hash.len(), 64);
        assert_eq!(descriptor.media_fingerprint.len(), 64);

        let actions = descriptor
            .planned_actions
            .get("mock")
            .expect("planned actions for mock");
        assert_eq!(actions.len(), 1);
        assert!(actions[0].simulated);

        let planned_request_path = descriptor
            .planned_request_files
            .get("mock")
            .expect("planned request file for mock");
        assert!(planned_request_path.ends_with("/planned_requests/mock.json"));
    }

    #[tokio::test]
    async fn execute_release_hydrates_persisted_descriptor_after_service_restart() {
        let dir = tempdir().expect("tempdir");
        let runtime_dir = dir.path().join("runtime");
        let service1 = CommandService::for_base_dir(runtime_dir.clone())
            .await
            .expect("service1");
        let (spec_path, media_path) = write_fixture_files(dir.path()).await;

        let plan = service1
            .handle_plan_release(PlanReleaseInput {
                media_path,
                spec_path,
                platforms: vec!["mock".to_string()],
                env: AppEnv::Test,
            })
            .await
            .expect("plan");

        drop(service1);

        let service2 = CommandService::for_base_dir(runtime_dir)
            .await
            .expect("service2");

        let exec = service2
            .handle_execute_release(plan.release_id.clone())
            .await
            .expect("execute from persisted descriptor after restart");
        assert_eq!(exec.release_id, plan.release_id);
        assert_eq!(exec.status, "COMMITTED");
        assert!(exec.report_path.is_some());
    }

    #[tokio::test]
    async fn execute_release_rejects_persisted_descriptor_integrity_mismatch() {
        let dir = tempdir().expect("tempdir");
        let runtime_dir = dir.path().join("runtime");
        let service1 = CommandService::for_base_dir(runtime_dir.clone())
            .await
            .expect("service1");
        let (spec_path, media_path) = write_fixture_files(dir.path()).await;

        let plan = service1
            .handle_plan_release(PlanReleaseInput {
                media_path,
                spec_path,
                platforms: vec!["mock".to_string()],
                env: AppEnv::Test,
            })
            .await
            .expect("plan");

        let descriptor_path =
            planned_release_descriptor_path(&service1.artifacts_root.join(&plan.release_id));
        let bytes = tokio::fs::read(&descriptor_path)
            .await
            .expect("read descriptor");
        let mut descriptor: PersistedPlannedReleaseDescriptor =
            serde_json::from_slice(&bytes).expect("decode descriptor");
        descriptor.spec_hash = if descriptor.spec_hash == "0".repeat(64) {
            "1".repeat(64)
        } else {
            "0".repeat(64)
        };
        let tampered = serde_json::to_vec_pretty(&descriptor).expect("encode tampered descriptor");
        tokio::fs::write(&descriptor_path, tampered)
            .await
            .expect("write tampered descriptor");

        drop(service1);

        let service2 = CommandService::for_base_dir(runtime_dir)
            .await
            .expect("service2");
        let err = service2
            .handle_execute_release(plan.release_id)
            .await
            .expect_err("tampered descriptor should fail safely");
        assert_eq!(err.code, "PLANNED_RELEASE_DESCRIPTOR_INTEGRITY_MISMATCH");
    }

    #[tokio::test]
    async fn execute_release_returns_not_found_when_persisted_descriptor_missing() {
        let dir = tempdir().expect("tempdir");
        let runtime_dir = dir.path().join("runtime");
        let service1 = CommandService::for_base_dir(runtime_dir.clone())
            .await
            .expect("service1");
        let (spec_path, media_path) = write_fixture_files(dir.path()).await;

        let plan = service1
            .handle_plan_release(PlanReleaseInput {
                media_path,
                spec_path,
                platforms: vec!["mock".to_string()],
                env: AppEnv::Test,
            })
            .await
            .expect("plan");

        let descriptor_path =
            planned_release_descriptor_path(&service1.artifacts_root.join(&plan.release_id));
        tokio::fs::remove_file(&descriptor_path)
            .await
            .expect("remove descriptor");
        drop(service1);

        let service2 = CommandService::for_base_dir(runtime_dir)
            .await
            .expect("service2");
        let err = service2
            .handle_execute_release(plan.release_id)
            .await
            .expect_err("missing descriptor should fail");
        assert_eq!(err.code, "PLANNED_RELEASE_NOT_FOUND");
    }

    #[tokio::test]
    async fn execute_release_rejects_corrupted_persisted_descriptor() {
        let dir = tempdir().expect("tempdir");
        let runtime_dir = dir.path().join("runtime");
        let service1 = CommandService::for_base_dir(runtime_dir.clone())
            .await
            .expect("service1");
        let (spec_path, media_path) = write_fixture_files(dir.path()).await;

        let plan = service1
            .handle_plan_release(PlanReleaseInput {
                media_path,
                spec_path,
                platforms: vec!["mock".to_string()],
                env: AppEnv::Test,
            })
            .await
            .expect("plan");

        let descriptor_path =
            planned_release_descriptor_path(&service1.artifacts_root.join(&plan.release_id));
        tokio::fs::write(&descriptor_path, b"{not-json")
            .await
            .expect("write corrupt descriptor");
        drop(service1);

        let service2 = CommandService::for_base_dir(runtime_dir)
            .await
            .expect("service2");
        let err = service2
            .handle_execute_release(plan.release_id)
            .await
            .expect_err("corrupt descriptor should fail");
        assert_eq!(err.code, "PLANNED_RELEASE_DESCRIPTOR_DECODE_FAILED");
    }

    #[tokio::test]
    async fn rejects_odd_prefix_paths() {
        let (service, _dir) = new_service().await;
        let err = service
            .handle_load_spec("\\\\?\\C:\\temp\\x.yaml".to_string())
            .await
            .expect_err("odd prefix must be rejected");
        assert_eq!(err.code, "INVALID_ARGUMENT");
    }

    #[test]
    fn validate_release_id_for_artifact_lookup_accepts_hex_and_normalizes_case() {
        let upper = "A".repeat(64);
        let normalized = validate_release_id_for_artifact_lookup(&upper).expect("valid release id");
        assert_eq!(normalized, "a".repeat(64));
    }

    #[test]
    fn validate_release_id_for_artifact_lookup_rejects_invalid_inputs() {
        let invalid = vec![
            "".to_string(),
            "   ".to_string(),
            "abc".to_string(),
            "../report".to_string(),
            "g".repeat(64),
            "a/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string(),
        ];

        for input in invalid {
            let err = validate_release_id_for_artifact_lookup(&input)
                .expect_err("invalid release id must be rejected");
            assert_eq!(err.code, "INVALID_ARGUMENT", "input: {input}");
        }
    }

    #[tokio::test]
    async fn get_report_rejects_invalid_release_id_inputs() {
        let (service, _dir) = new_service().await;

        let invalid = vec![
            "../bad".to_string(),
            "..\\bad".to_string(),
            "short".to_string(),
            "g".repeat(64),
        ];

        for input in invalid {
            let err = service
                .handle_get_report(input)
                .await
                .expect_err("invalid release_id must be rejected");
            assert_eq!(err.code, "INVALID_ARGUMENT");
        }
    }

    #[tokio::test]
    async fn get_report_accepts_uppercase_hex_release_id_lookup() {
        let (service, _dir) = new_service().await;
        let result = service
            .handle_get_report("A".repeat(64))
            .await
            .expect("uppercase hex release_id should validate");
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn get_report_handles_large_payload_and_preserves_raw_unknown_fields() {
        let (service, _dir) = new_service().await;
        let release_id = "c".repeat(64);
        let report_dir = service.artifacts_root.join(&release_id);
        tokio::fs::create_dir_all(&report_dir)
            .await
            .expect("create report dir");

        let large_blob = "x".repeat(256 * 1024);
        let platform_count = 256usize;
        let platforms: Vec<Value> = (0..platform_count)
            .map(|idx| {
                serde_json::json!({
                    "platform": format!("mock-{idx:03}"),
                    "status": "VERIFIED",
                    "simulated": true,
                    "verified": true,
                    "attempt_count": 1,
                    "external_id": serde_json::Value::Null,
                    "reused_completed_result": idx % 2 == 0
                })
            })
            .collect();

        let report_json = serde_json::json!({
            "release_id": release_id,
            "run_id": "run-large",
            "env": "TEST",
            "state": "COMMITTED",
            "title": "Large Report Track",
            "spec_hash": "d".repeat(64),
            "media_fingerprint": "e".repeat(64),
            "planned_request_files": {
                "mock": "artifacts/planned_requests/mock.json"
            },
            "platforms": platforms,
            "diagnostics": {
                "blob": large_blob,
                "note": "preserve unknown fields in raw"
            }
        });
        let bytes = serde_json::to_vec(&report_json).expect("serialize large report fixture");
        tokio::fs::write(report_dir.join("release_report.json"), bytes)
            .await
            .expect("write large report fixture");

        let report = service
            .handle_get_report(release_id)
            .await
            .expect("large report should decode")
            .expect("report should exist");

        assert_eq!(report.release_id.len(), 64);
        assert!(report.summary.contains("COMMITTED"));
        assert!(report
            .summary
            .contains(&format!("{platform_count} platform(s)")));
        assert_eq!(report.actions.len(), platform_count);
        let raw = report.raw.expect("raw report payload should be included");
        assert_eq!(
            raw["diagnostics"]["blob"]
                .as_str()
                .map(str::len)
                .expect("diagnostics blob string"),
            256 * 1024
        );
        assert_eq!(raw["diagnostics"]["note"], "preserve unknown fields in raw");
    }

    #[tokio::test]
    async fn command_error_contract_invalid_release_id_wire_shape_is_stable() {
        let (service, _dir) = new_service().await;

        let err = service
            .handle_get_report("short".to_string())
            .await
            .expect_err("invalid release_id should fail");
        assert_eq!(err.code, "INVALID_ARGUMENT");
        assert_eq!(err.message, "release_id must be a 64-character hex string");
        assert!(err.details.is_none());

        let wire = serde_json::to_value(&err).expect("serialize AppError");
        assert_app_error_wire_top_level_shape(&wire);
        assert_eq!(wire["code"], "INVALID_ARGUMENT");
        assert_eq!(
            wire["message"],
            "release_id must be a 64-character hex string"
        );
        assert!(wire["details"].is_null());
    }

    #[tokio::test]
    async fn command_error_contract_spec_validation_failed_wire_shape_is_stable() {
        let (service, dir) = new_service().await;
        let (spec_path, media_path) = write_fixture_files(dir.path()).await;
        tokio::fs::write(&spec_path, b"title: [unterminated\n")
            .await
            .expect("overwrite invalid spec");

        let err = service
            .handle_plan_release(PlanReleaseInput {
                media_path,
                spec_path,
                platforms: vec!["mock".to_string()],
                env: AppEnv::Test,
            })
            .await
            .expect_err("invalid spec should fail planning");
        assert_eq!(err.code, "SPEC_VALIDATION_FAILED");
        assert_eq!(err.message, "release spec is invalid");

        let wire = serde_json::to_value(&err).expect("serialize AppError");
        assert_app_error_wire_top_level_shape(&wire);
        assert_eq!(wire["code"], "SPEC_VALIDATION_FAILED");
        assert_eq!(wire["message"], "release spec is invalid");
        let errors = wire["details"]["errors"]
            .as_array()
            .expect("validation errors should be an array");
        assert!(
            !errors.is_empty(),
            "validation details.errors should include at least one item"
        );
    }

    fn command_error_redaction_probe_for_test() -> Result<(), AppError> {
        Err(AppError::new(
            app_error_codes::TEST_REDACTION_PROBE,
            "synthetic command error",
        )
        .with_details(serde_json::json!({
            "authorization": "Bearer should-not-cross-boundary",
            "nested": {
                "cookie": "session=secret",
                "safe": "keep"
            },
            "items": [
                {"client_secret": "shh"},
                {"safe": "ok"}
            ]
        })))
    }

    fn command_error_secret_store_probe_for_test() -> Result<(), AppError> {
        let store = InMemorySecretStore::new();
        store
            .put(
                SecretRecord::new(
                    "connectors/mock/api-key",
                    SecretValue::new("store-secret-123").expect("secret value"),
                )
                .expect("secret record"),
            )
            .expect("seed secret store");

        let secret = store
            .get("connectors/mock/api-key")
            .expect("stored secret should exist");

        Err(AppError::new(
            app_error_codes::TEST_SECRET_STORE_REDACTION,
            "synthetic secret-store command error",
        )
        .with_details(serde_json::json!({
            "api_key": secret.expose(),
            "nested": {
                "client_secret": secret.expose(),
                "debug": format!("{secret:?}")
            },
            "safe": "keep"
        })))
    }

    #[test]
    fn app_error_with_details_redacts_sensitive_keys_recursively() {
        let err = AppError::new("TEST", "test").with_details(serde_json::json!({
            "authorization": "Bearer abc",
            "nested": {
                "client_secret": "top-secret",
                "refresh-token": "refresh-secret",
                "safe": "ok"
            },
            "items": [
                {"cookie": "session=abc"},
                {"api_key": "key-123"},
                {"safe": "value"}
            ],
            "safe": "keep"
        }));

        let details = err.details.expect("details should exist");
        assert_eq!(details["authorization"], "<redacted>");
        assert_eq!(details["nested"]["client_secret"], "<redacted>");
        assert_eq!(details["nested"]["refresh-token"], "<redacted>");
        assert_eq!(details["nested"]["safe"], "ok");
        assert_eq!(details["items"][0]["cookie"], "<redacted>");
        assert_eq!(details["items"][1]["api_key"], "<redacted>");
        assert_eq!(details["items"][2]["safe"], "value");
        assert_eq!(details["safe"], "keep");
    }

    #[test]
    fn command_error_boundary_serialization_keeps_details_redacted() {
        let err = command_error_redaction_probe_for_test()
            .expect_err("probe should return command error");

        let wire = serde_json::to_value(&err).expect("serialize AppError");
        assert_eq!(wire["code"], "TEST_REDACTION_PROBE");
        assert_eq!(wire["message"], "synthetic command error");
        assert_eq!(wire["details"]["authorization"], "<redacted>");
        assert_eq!(wire["details"]["nested"]["cookie"], "<redacted>");
        assert_eq!(wire["details"]["nested"]["safe"], "keep");
        assert_eq!(wire["details"]["items"][0]["client_secret"], "<redacted>");
        assert_eq!(wire["details"]["items"][1]["safe"], "ok");

        let round_trip: AppError = serde_json::from_value(wire).expect("deserialize AppError");
        let details = round_trip.details.expect("round-tripped details");
        assert_eq!(details["authorization"], "<redacted>");
        assert_eq!(details["nested"]["cookie"], "<redacted>");
        assert_eq!(details["items"][0]["client_secret"], "<redacted>");
    }

    #[test]
    fn command_error_boundary_never_serializes_secret_store_values() {
        let err = command_error_secret_store_probe_for_test()
            .expect_err("probe should return command error");

        let wire = serde_json::to_value(&err).expect("serialize AppError");
        let wire_text = serde_json::to_string(&wire).expect("stringify AppError payload");
        assert_eq!(wire["code"], "TEST_SECRET_STORE_REDACTION");
        assert_eq!(wire["details"]["api_key"], "<redacted>");
        assert_eq!(wire["details"]["nested"]["client_secret"], "<redacted>");
        assert_eq!(
            wire["details"]["nested"]["debug"],
            "SecretValue(<redacted>)"
        );
        assert_eq!(wire["details"]["safe"], "keep");
        assert!(!wire_text.contains("store-secret-123"));
    }
}
