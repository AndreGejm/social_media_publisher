use release_publisher_core::orchestrator::{
    Orchestrator, OrchestratorError, PlannedRelease, ReleaseReportArtifact, RunReleaseInput,
};
use release_publisher_core::pipeline::ExecutionEnvironment;
use release_publisher_core::spec::{parse_release_spec_yaml, ReleaseSpec, SpecError};
use release_publisher_db::{Db, DbConfig, DbError};
use release_publisher_mock_connector::MockPublisher;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use tokio::sync::{Mutex, OnceCell};

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
        self.details = Some(details);
        self
    }

    fn invalid_argument(message: impl Into<String>) -> Self {
        Self::new("INVALID_ARGUMENT", message)
    }

    fn file_read_failed(message: impl Into<String>) -> Self {
        Self::new("FILE_READ_FAILED", message)
    }

    fn invalid_encoding(message: impl Into<String>) -> Self {
        Self::new("INVALID_ENCODING", message)
    }
}

impl From<DbError> for AppError {
    fn from(value: DbError) -> Self {
        Self::new(
            format!("DB_{}", db_error_code_name(&value).to_ascii_uppercase()),
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
                Self::new("ORCHESTRATOR_INVALID_INPUT", message)
            }
            OrchestratorError::UnknownPublisher { platform } => Self::new(
                "ORCHESTRATOR_UNKNOWN_PUBLISHER",
                format!("unknown publisher `{platform}`"),
            ),
            OrchestratorError::DuplicatePublisher { platform } => Self::new(
                "ORCHESTRATOR_DUPLICATE_PUBLISHER",
                format!("duplicate publisher `{platform}`"),
            ),
            OrchestratorError::CapExceeded {
                platform,
                count,
                cap,
            } => Self::new(
                "CAP_EXCEEDED",
                format!("per-run action cap exceeded for `{platform}`"),
            )
            .with_details(serde_json::json!({ "platform": platform, "count": count, "cap": cap })),
            OrchestratorError::TestGuardrailViolation { platform } => Self::new(
                "TEST_GUARDRAIL_VIOLATION",
                format!("TEST environment requires simulated actions/results for `{platform}`"),
            ),
            OrchestratorError::InvalidReleaseState(message) => {
                Self::new("INVALID_RELEASE_STATE", message)
            }
            OrchestratorError::Db(error) => Self::from(error),
            OrchestratorError::Io(error) => Self::new("IO_ERROR", error.to_string()),
            OrchestratorError::Serialization(error) => {
                Self::new("SERIALIZATION_ERROR", error.to_string())
            }
        }
    }
}

struct CommandService {
    orchestrator: Arc<Orchestrator>,
    artifacts_root: PathBuf,
    planned_releases: Mutex<HashMap<String, PlannedRelease>>,
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
            planned_releases: Mutex::new(HashMap::new()),
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
            AppError::new("SPEC_VALIDATION_FAILED", "release spec is invalid")
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

        self.planned_releases
            .lock()
            .await
            .insert(planned.release_id.clone(), planned);

        Ok(response)
    }

    async fn handle_execute_release(
        &self,
        release_id: String,
    ) -> Result<ExecuteReleaseResponse, AppError> {
        if release_id.trim().is_empty() {
            return Err(AppError::invalid_argument("release_id cannot be empty"));
        }

        let planned = {
            let guard = self.planned_releases.lock().await;
            guard.get(release_id.trim()).cloned()
        }
        .ok_or_else(|| {
            AppError::new(
                "PLANNED_RELEASE_NOT_FOUND",
                "release must be planned in this app session before execution",
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
        if release_id.trim().is_empty() {
            return Err(AppError::invalid_argument("release_id cannot be empty"));
        }
        let report_path = self
            .artifacts_root
            .join(release_id.trim())
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
        let parsed: ReleaseReportArtifact = serde_json::from_slice(&bytes)
            .map_err(|e| AppError::new("REPORT_DECODE_FAILED", e.to_string()))?;
        let raw: Value = serde_json::from_slice(&bytes)
            .map_err(|e| AppError::new("REPORT_DECODE_FAILED", e.to_string()))?;

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

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
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
    async fn rejects_odd_prefix_paths() {
        let (service, _dir) = new_service().await;
        let err = service
            .handle_load_spec("\\\\?\\C:\\temp\\x.yaml".to_string())
            .await
            .expect_err("odd prefix must be rejected");
        assert_eq!(err.code, "INVALID_ARGUMENT");
    }
}
