use release_publisher_core::audio_processor::{
    analyze_track as analyze_audio_track_file, AudioError as CoreAudioError,
};
use release_publisher_core::idempotency::{blake3_hex, media_fingerprint_from_file};
use release_publisher_core::models::{
    ModelError as CoreModelError, Release as CoreReleaseModel, Track as CoreTrackModel,
};
use release_publisher_core::orchestrator::{
    Orchestrator, OrchestratorError, PlannedRelease, ReleaseReportArtifact, RunReleaseInput,
};
use release_publisher_core::pipeline::{ExecutionEnvironment, PlannedAction as CorePlannedAction};
use release_publisher_core::spec::{parse_release_spec_yaml, MockOptions, ReleaseSpec, SpecError};
use release_publisher_db::{
    CatalogListTracksQuery as DbCatalogListTracksQuery,
    CatalogTrackListItem as DbCatalogTrackListItem, CatalogTrackRecord as DbCatalogTrackRecord,
    CatalogTrackTagAssignment as DbCatalogTrackTagAssignment, Db, DbConfig, DbError,
    IngestJobRecord as DbIngestJobRecord, IngestJobStatus as DbIngestJobStatus,
    LibraryRootRecord as DbLibraryRootRecord, NewIngestEvent, NewIngestJob,
    ReleaseTrackAnalysisRecord, UpdateCatalogTrackMetadata as DbUpdateCatalogTrackMetadata,
    UpdateIngestJob, UpsertCatalogTrackImport, UpsertLibraryRoot, UpsertReleaseTrackAnalysis,
};
use release_publisher_mock_connector::MockPublisher;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, OnceLock,
};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
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
#[serde(deny_unknown_fields)]
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
pub struct AnalyzeAudioFileResponse {
    pub canonical_path: String,
    pub media_fingerprint: String,
    pub track: CoreTrackModel,
    pub sample_rate_hz: u32,
    pub channels: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseTrackAnalysisResponse {
    pub release: CoreReleaseModel,
    pub media_fingerprint: String,
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogListTracksInput {
    pub search: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogListTracksResponse {
    pub items: Vec<CatalogTrackListItem>,
    pub total: u64,
    pub limit: u32,
    pub offset: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogTrackDetailResponse {
    pub track_id: String,
    pub media_asset_id: String,
    pub title: String,
    pub artist_id: String,
    pub artist_name: String,
    pub album_id: Option<String>,
    pub album_title: Option<String>,
    pub file_path: String,
    pub media_fingerprint: String,
    pub track: CoreTrackModel,
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub true_peak_dbfs: Option<f32>,
    pub visibility_policy: String,
    pub license_policy: String,
    pub downloadable: bool,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublisherCreateDraftFromTrackResponse {
    pub draft_id: String,
    pub source_track_id: String,
    pub media_path: String,
    pub spec_path: String,
    pub spec: ReleaseSpec,
    pub spec_yaml: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogUpdateTrackMetadataInput {
    pub track_id: String,
    pub visibility_policy: String,
    pub license_policy: String,
    pub downloadable: bool,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogImportFailure {
    pub path: String,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogImportFilesResponse {
    pub imported: Vec<CatalogTrackListItem>,
    pub failed: Vec<CatalogImportFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryRootResponse {
    pub root_id: String,
    pub path: String,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogScanRootResponse {
    pub job_id: String,
    pub root_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogIngestJobResponse {
    pub job_id: String,
    pub status: String,
    pub scope: String,
    pub total_items: u32,
    pub processed_items: u32,
    pub error_count: u32,
    pub created_at: String,
    pub updated_at: String,
}

const PLANNED_RELEASE_DESCRIPTOR_SCHEMA_VERSION: u32 = 1;
const PLANNED_RELEASE_DESCRIPTOR_FILE_NAME: &str = "planned_release_descriptor.json";
const MAX_IPC_PATH_CHARS: usize = 4_096;
const MAX_IPC_ERROR_MESSAGE_CHARS: usize = 512;
const MAX_CATALOG_TRACK_SEARCH_CHARS: usize = 512;
const MAX_IPC_PEAK_BINS: usize = 8_192;
const MAX_CATALOG_IMPORT_TOTAL_PATH_CHARS: usize = 131_072;
const MAX_CATALOG_TRACK_TAGS: usize = 32;
const MAX_CATALOG_TAG_LABEL_CHARS: usize = 64;
const MAX_PLAN_RELEASE_PLATFORMS: usize = 32;
const MAX_PLATFORM_LABEL_CHARS: usize = 64;
const MAX_RELEASE_SPEC_TAGS_FROM_CATALOG: usize = 10;
const MAX_RELEASE_SPEC_TAG_LEN_CHARS: usize = 32;
const PUBLISHER_CATALOG_DRAFTS_DIR: &str = "publisher_catalog_drafts";
const PUBLISHER_CATALOG_DRAFT_SPEC_FILE_NAME: &str = "release_spec.yaml";
const ALLOWED_CATALOG_VISIBILITY_POLICIES: &[&str] = &["LOCAL", "PRIVATE", "SHARE_EXPORT_READY"];
const ALLOWED_CATALOG_LICENSE_POLICIES: &[&str] = &[
    "ALL_RIGHTS_RESERVED",
    "CC_BY",
    "CC_BY_SA",
    "CC_BY_NC",
    "CC0",
    "CUSTOM",
];

mod app_error_codes {
    pub const DB_PREFIX: &str = "DB_";

    pub const INVALID_ARGUMENT: &str = "INVALID_ARGUMENT";
    pub const FILE_READ_FAILED: &str = "FILE_READ_FAILED";
    pub const FILE_WRITE_FAILED: &str = "FILE_WRITE_FAILED";
    pub const INVALID_ENCODING: &str = "INVALID_ENCODING";
    pub const IO_ERROR: &str = "IO_ERROR";
    pub const SERIALIZATION_ERROR: &str = "SERIALIZATION_ERROR";
    pub const AUDIO_ANALYSIS_FAILED: &str = "AUDIO_ANALYSIS_FAILED";
    pub const AUDIO_MODEL_INVALID: &str = "AUDIO_MODEL_INVALID";
    pub const NORMALIZED_SPEC_DECODE_FAILED: &str = "NORMALIZED_SPEC_DECODE_FAILED";
    pub const MEDIA_FINGERPRINT_MISMATCH: &str = "MEDIA_FINGERPRINT_MISMATCH";

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

#[derive(Debug)]
struct DecodedReleaseReport {
    parsed: ReleaseReportArtifact,
    raw: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub details: Option<Value>,
}

impl AppError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        let message = message.into();
        Self {
            code: code.into(),
            message: sanitize_error_message(&message),
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
        Value::String(text) => Value::String(sanitize_error_message(&text)),
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

fn sanitize_error_message(raw: &str) -> String {
    let normalized = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if contains_suspicious_error_payload(&normalized) {
        return "internal error".to_string();
    }

    if normalized.chars().count() <= MAX_IPC_ERROR_MESSAGE_CHARS {
        normalized
    } else {
        let mut truncated = normalized
            .chars()
            .take(MAX_IPC_ERROR_MESSAGE_CHARS)
            .collect::<String>();
        truncated.push_str("...");
        truncated
    }
}

fn contains_suspicious_error_payload(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("stack backtrace")
        || lower.contains("panicked at")
        || lower.contains("thread '")
        || lower.contains(" at src/")
        || lower.contains(" at src\\")
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

fn map_core_audio_error(error: CoreAudioError) -> AppError {
    match error {
        CoreAudioError::Io { path, source } => AppError::file_read_failed(format!(
            "failed to read audio file `{}`: {source}",
            path_to_string(&path)
        )),
        CoreAudioError::InvalidInput(message)
        | CoreAudioError::Unsupported(message)
        | CoreAudioError::Decode(message)
        | CoreAudioError::Analysis(message) => {
            AppError::new(app_error_codes::AUDIO_ANALYSIS_FAILED, message)
        }
    }
}

fn map_core_model_error(error: CoreModelError) -> AppError {
    AppError::new(app_error_codes::AUDIO_MODEL_INVALID, error.to_string())
}

struct IpcAudioMetrics<'a> {
    duration_ms: u32,
    peak_data: &'a [f32],
    loudness_lufs: f32,
    sample_rate_hz: u32,
    channels: u16,
    true_peak_dbfs: Option<f32>,
}

fn validate_ipc_audio_metrics(label: &str, metrics: IpcAudioMetrics<'_>) -> Result<(), AppError> {
    if metrics.duration_ms == 0 {
        return Err(AppError::new(
            app_error_codes::AUDIO_MODEL_INVALID,
            format!("{label} duration_ms must be > 0"),
        ));
    }
    if metrics.peak_data.is_empty() {
        return Err(AppError::new(
            app_error_codes::AUDIO_MODEL_INVALID,
            format!("{label} peak_data must not be empty"),
        ));
    }
    if metrics.peak_data.len() > MAX_IPC_PEAK_BINS {
        return Err(AppError::new(
            app_error_codes::AUDIO_MODEL_INVALID,
            format!("{label} peak_data exceeds IPC safety limit ({MAX_IPC_PEAK_BINS} bins)"),
        ));
    }
    if metrics
        .peak_data
        .iter()
        .any(|peak| !peak.is_finite() || *peak > 0.0)
    {
        return Err(AppError::new(
            app_error_codes::AUDIO_MODEL_INVALID,
            format!("{label} peak_data values must be finite and <= 0.0"),
        ));
    }
    if !metrics.loudness_lufs.is_finite() || metrics.loudness_lufs > 0.0 {
        return Err(AppError::new(
            app_error_codes::AUDIO_MODEL_INVALID,
            format!("{label} loudness_lufs must be finite and <= 0.0"),
        ));
    }
    if metrics.sample_rate_hz == 0 {
        return Err(AppError::new(
            app_error_codes::AUDIO_MODEL_INVALID,
            format!("{label} sample_rate_hz must be > 0"),
        ));
    }
    if metrics.channels == 0 {
        return Err(AppError::new(
            app_error_codes::AUDIO_MODEL_INVALID,
            format!("{label} channels must be > 0"),
        ));
    }
    if let Some(true_peak_dbfs) = metrics.true_peak_dbfs {
        if !true_peak_dbfs.is_finite() || true_peak_dbfs > 0.0 {
            return Err(AppError::new(
                app_error_codes::AUDIO_MODEL_INVALID,
                format!("{label} true_peak_dbfs must be finite and <= 0.0 when present"),
            ));
        }
    }
    Ok(())
}

fn validate_track_analysis_record_for_ipc(
    row: &ReleaseTrackAnalysisRecord,
) -> Result<(), AppError> {
    validate_ipc_audio_metrics(
        "persisted track analysis",
        IpcAudioMetrics {
            duration_ms: row.duration_ms,
            peak_data: &row.peak_data,
            loudness_lufs: row.loudness_lufs,
            sample_rate_hz: row.sample_rate_hz,
            channels: row.channels,
            true_peak_dbfs: None,
        },
    )
}

fn validate_catalog_track_record_for_ipc(record: &DbCatalogTrackRecord) -> Result<(), AppError> {
    validate_ipc_audio_metrics(
        "catalog track",
        IpcAudioMetrics {
            duration_ms: record.duration_ms,
            peak_data: &record.peak_data,
            loudness_lufs: record.loudness_lufs,
            sample_rate_hz: record.sample_rate_hz,
            channels: record.channels,
            true_peak_dbfs: record.true_peak_dbfs,
        },
    )
}

struct CommandService {
    db: Db,
    orchestrator: Arc<Orchestrator>,
    artifacts_root: PathBuf,
}

struct PreparedCatalogScanJob {
    root: DbLibraryRootRecord,
    job: DbIngestJobRecord,
}

struct PreparedCatalogTrackMetadataUpdate {
    track_id: String,
    visibility_policy: String,
    license_policy: String,
    downloadable: bool,
    tags: Vec<DbCatalogTrackTagAssignment>,
}

impl CommandService {
    async fn from_default_location() -> Result<Self, AppError> {
        let base_dir = resolve_runtime_base_dir()?;
        Self::for_base_dir(base_dir).await
    }

    async fn for_base_dir(base_dir: impl AsRef<Path>) -> Result<Self, AppError> {
        let base_dir = base_dir.as_ref();

        tokio::fs::create_dir_all(base_dir).await.map_err(|e| {
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
            db.clone(),
            vec![Arc::new(MockPublisher) as Arc<dyn release_publisher_core::pipeline::Publisher>],
        )
        .map_err(AppError::from)?;

        Ok(Self {
            db,
            orchestrator: Arc::new(orchestrator),
            artifacts_root,
        })
    }

    async fn handle_load_spec(&self, path: &str) -> Result<LoadSpecResponse, AppError> {
        let canonical = canonicalize_file_path(path, "spec file").await?;
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
        let platforms = validate_plan_release_platforms(&input.platforms)?;

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
                platforms,
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
        release_id: &str,
    ) -> Result<ExecuteReleaseResponse, AppError> {
        let release_id = validate_release_id_for_artifact_lookup(release_id)?;
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

    async fn handle_get_report(&self, release_id: &str) -> Result<Option<ReleaseReport>, AppError> {
        let release_id = validate_release_id_for_artifact_lookup(release_id)?;
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
        let DecodedReleaseReport { parsed, raw } = decode_release_report_artifact(&bytes)?;

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

    async fn handle_analyze_audio_file(
        &self,
        path: &str,
    ) -> Result<AnalyzeAudioFileResponse, AppError> {
        let canonical = canonicalize_file_path(path, "audio file").await?;
        let analyzed = analyze_audio_file_to_track_payload(&canonical).await?;
        Ok(AnalyzeAudioFileResponse {
            canonical_path: path_to_string(&canonical),
            media_fingerprint: analyzed.media_fingerprint,
            track: analyzed.track,
            sample_rate_hz: analyzed.sample_rate_hz,
            channels: analyzed.channels,
        })
    }

    async fn handle_analyze_and_persist_release_track(
        &self,
        release_id: &str,
        path: &str,
    ) -> Result<ReleaseTrackAnalysisResponse, AppError> {
        let release_id = validate_release_id_for_artifact_lookup(release_id)?;
        let canonical = canonicalize_file_path(path, "audio file").await?;
        let analyzed = analyze_audio_file_to_track_payload(&canonical).await?;

        let release = self
            .orchestrator
            .db()
            .get_release(&release_id)
            .await?
            .ok_or_else(|| {
                AppError::invalid_argument(
                    "release_id must exist in local history before persisting track analysis",
                )
            })?;

        if release.media_fingerprint != analyzed.media_fingerprint {
            return Err(AppError::new(
                app_error_codes::MEDIA_FINGERPRINT_MISMATCH,
                "audio file does not match the planned release media fingerprint",
            )
            .with_details(serde_json::json!({
                "release_id": release_id,
                "expected_media_fingerprint": release.media_fingerprint,
                "actual_media_fingerprint": analyzed.media_fingerprint,
            })));
        }

        let row = self
            .orchestrator
            .db()
            .upsert_release_track_analysis(&UpsertReleaseTrackAnalysis {
                release_id: release_id.clone(),
                file_path: path_to_string(&canonical),
                media_fingerprint: analyzed.media_fingerprint.clone(),
                duration_ms: analyzed.track.duration_ms(),
                peak_data: analyzed.track.peak_data().to_vec(),
                loudness_lufs: analyzed.track.loudness_lufs(),
                sample_rate_hz: analyzed.sample_rate_hz,
                channels: analyzed.channels,
            })
            .await?;

        self.build_release_track_analysis_response(row).await
    }

    async fn handle_get_release_track_analysis(
        &self,
        release_id: &str,
    ) -> Result<Option<ReleaseTrackAnalysisResponse>, AppError> {
        let release_id = validate_release_id_for_artifact_lookup(release_id)?;
        let Some(row) = self
            .orchestrator
            .db()
            .get_release_track_analysis(&release_id)
            .await?
        else {
            return Ok(None);
        };

        Ok(Some(self.build_release_track_analysis_response(row).await?))
    }

    async fn handle_catalog_import_files(
        &self,
        paths: Vec<String>,
    ) -> Result<CatalogImportFilesResponse, AppError> {
        if paths.is_empty() {
            return Err(AppError::invalid_argument(
                "catalog_import_files requires at least one file path",
            ));
        }
        if paths.len() > 200 {
            return Err(AppError::invalid_argument(
                "catalog_import_files accepts at most 200 paths per request",
            ));
        }
        let total_path_chars: usize = paths.iter().map(String::len).sum();
        if total_path_chars > MAX_CATALOG_IMPORT_TOTAL_PATH_CHARS {
            return Err(AppError::invalid_argument(format!(
                "catalog_import_files payload exceeds maximum aggregate path length of {MAX_CATALOG_IMPORT_TOTAL_PATH_CHARS} characters"
            )));
        }

        let mut imported = Vec::new();
        let mut failed = Vec::new();

        for raw_path in paths {
            match self.import_catalog_track_from_path(&raw_path).await {
                Ok(track) => imported.push(catalog_track_list_item_from_record(track)),
                Err(error) => failed.push(CatalogImportFailure {
                    path: raw_path,
                    code: error.code,
                    message: error.message,
                }),
            }
        }

        Ok(CatalogImportFilesResponse { imported, failed })
    }

    async fn handle_catalog_list_tracks(
        &self,
        input: Option<CatalogListTracksInput>,
    ) -> Result<CatalogListTracksResponse, AppError> {
        let input = input.unwrap_or(CatalogListTracksInput {
            search: None,
            limit: None,
            offset: None,
        });
        let search = input
            .search
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        if let Some(search) = &search {
            if search.len() > MAX_CATALOG_TRACK_SEARCH_CHARS {
                return Err(AppError::invalid_argument(format!(
                    "catalog track search exceeds maximum length of {MAX_CATALOG_TRACK_SEARCH_CHARS} characters"
                )));
            }
        }

        let page = self
            .db
            .list_catalog_tracks(&DbCatalogListTracksQuery {
                search,
                limit: input.limit.unwrap_or(100),
                offset: input.offset.unwrap_or(0),
            })
            .await?;

        Ok(CatalogListTracksResponse {
            items: page
                .items
                .into_iter()
                .map(catalog_track_list_item_from_db_list_item)
                .collect(),
            total: page.total,
            limit: page.limit,
            offset: page.offset,
        })
    }

    async fn handle_catalog_get_track(
        &self,
        track_id: &str,
    ) -> Result<Option<CatalogTrackDetailResponse>, AppError> {
        let track_id = validate_catalog_track_id(track_id)?;
        let Some(record) = self.db.get_catalog_track(&track_id).await? else {
            return Ok(None);
        };
        let tags = self.db.list_catalog_track_tags(&track_id).await?;
        Ok(Some(build_catalog_track_detail_response_with_tags(
            record, tags,
        )?))
    }

    async fn handle_catalog_update_track_metadata(
        &self,
        input: CatalogUpdateTrackMetadataInput,
    ) -> Result<CatalogTrackDetailResponse, AppError> {
        let prepared = validate_catalog_update_track_metadata_input(input)?;
        let track = self
            .db
            .update_catalog_track_metadata(&DbUpdateCatalogTrackMetadata {
                track_id: prepared.track_id.clone(),
                visibility_policy: prepared.visibility_policy,
                license_policy: prepared.license_policy,
                downloadable: prepared.downloadable,
                tags: prepared.tags,
            })
            .await?;
        let tags = self.db.list_catalog_track_tags(&prepared.track_id).await?;
        build_catalog_track_detail_response_with_tags(track, tags)
    }

    async fn handle_publisher_create_draft_from_track(
        &self,
        track_id: &str,
    ) -> Result<PublisherCreateDraftFromTrackResponse, AppError> {
        let track_id = validate_catalog_track_id(track_id)?;
        let Some(record) = self.db.get_catalog_track(&track_id).await? else {
            return Err(AppError::invalid_argument("catalog track_id not found"));
        };
        let tags = self.db.list_catalog_track_tags(&track_id).await?;
        let detail = build_catalog_track_detail_response_with_tags(record, tags)?;
        let draft = build_publisher_draft_from_catalog_track(&detail, &self.artifacts_root)?;
        self.persist_publisher_catalog_draft(&draft).await?;
        Ok(draft)
    }

    async fn handle_catalog_add_library_root(
        &self,
        path: &str,
    ) -> Result<LibraryRootResponse, AppError> {
        let canonical = canonicalize_directory_path(path, "library root").await?;
        let canonical_str = path_to_string(&canonical);
        let root_id = catalog_id(
            "catalog-library-root.v1",
            &canonical_str.to_ascii_lowercase(),
        );
        let row = self
            .db
            .upsert_library_root(&UpsertLibraryRoot {
                root_id,
                path: canonical_str,
                enabled: true,
            })
            .await?;
        Ok(library_root_response_from_db(row))
    }

    async fn handle_catalog_list_library_roots(
        &self,
    ) -> Result<Vec<LibraryRootResponse>, AppError> {
        let rows = self.db.list_library_roots().await?;
        Ok(rows
            .into_iter()
            .map(library_root_response_from_db)
            .collect())
    }

    async fn handle_catalog_remove_library_root(&self, root_id: &str) -> Result<bool, AppError> {
        let root_id = validate_catalog_hex_id(root_id, "library root_id")?;
        self.db
            .delete_library_root(&root_id)
            .await
            .map_err(AppError::from)
    }

    async fn handle_catalog_scan_root_prepare(
        &self,
        root_id: &str,
    ) -> Result<PreparedCatalogScanJob, AppError> {
        let root_id = validate_catalog_hex_id(root_id, "library root_id")?;
        let root = self
            .db
            .get_library_root(&root_id)
            .await?
            .ok_or_else(|| AppError::invalid_argument("library root_id not found"))?;
        if !root.enabled {
            return Err(AppError::invalid_argument(
                "library root is disabled and cannot be scanned",
            ));
        }

        let job_id = next_catalog_scan_job_id(&root_id);
        let job = self
            .db
            .create_ingest_job(&NewIngestJob {
                job_id,
                status: DbIngestJobStatus::Pending,
                scope: format!("SCAN_ROOT:{root_id}"),
                total_items: 0,
                processed_items: 0,
                error_count: 0,
            })
            .await?;

        Ok(PreparedCatalogScanJob { root, job })
    }

    async fn handle_catalog_get_ingest_job(
        &self,
        job_id: &str,
    ) -> Result<Option<CatalogIngestJobResponse>, AppError> {
        let job_id = validate_catalog_hex_id(job_id, "ingest job_id")?;
        let Some(job) = self.db.get_ingest_job(&job_id).await? else {
            return Ok(None);
        };
        Ok(Some(catalog_ingest_job_response_from_db(job)))
    }

    async fn import_catalog_track_from_path(
        &self,
        path: &str,
    ) -> Result<DbCatalogTrackRecord, AppError> {
        let canonical = canonicalize_file_path(path, "catalog audio file").await?;
        self.import_catalog_track_from_canonical_path(&canonical)
            .await
    }

    async fn import_catalog_track_from_canonical_path(
        &self,
        canonical: &Path,
    ) -> Result<DbCatalogTrackRecord, AppError> {
        let analyzed = analyze_audio_file_to_track_payload(canonical).await?;
        let guessed = guess_catalog_metadata_from_path(canonical);

        let artist_key = guessed.artist_name.to_ascii_lowercase();
        let album_key = guessed
            .album_title
            .as_ref()
            .map(|title| title.to_ascii_lowercase());
        let media_fingerprint = analyzed.media_fingerprint.clone();
        let media_asset_id = catalog_id("catalog-media-asset.v1", &media_fingerprint);
        let track_id = catalog_id("catalog-track.v1", &media_fingerprint);
        let artist_id = catalog_id("catalog-artist.v1", &artist_key);
        let album_id = album_key
            .as_ref()
            .map(|key| catalog_id("catalog-album.v1", &format!("{artist_id}:{key}")));
        let true_peak_dbfs = analyzed
            .track
            .peak_data()
            .iter()
            .copied()
            .fold(f32::NEG_INFINITY, f32::max);
        let true_peak_dbfs = if true_peak_dbfs.is_finite() {
            Some(true_peak_dbfs)
        } else {
            None
        };

        self.db
            .upsert_catalog_track_import(&UpsertCatalogTrackImport {
                track_id,
                media_asset_id,
                artist_id,
                album_id,
                file_path: path_to_string(canonical),
                media_fingerprint,
                title: guessed.title,
                artist_name: guessed.artist_name,
                album_title: guessed.album_title,
                duration_ms: analyzed.track.duration_ms(),
                peak_data: analyzed.track.peak_data().to_vec(),
                loudness_lufs: analyzed.track.loudness_lufs(),
                true_peak_dbfs,
                sample_rate_hz: analyzed.sample_rate_hz,
                channels: analyzed.channels,
                visibility_policy: "LOCAL".to_string(),
                license_policy: "ALL_RIGHTS_RESERVED".to_string(),
                downloadable: false,
            })
            .await
            .map_err(AppError::from)
    }

    async fn persist_publisher_catalog_draft(
        &self,
        draft: &PublisherCreateDraftFromTrackResponse,
    ) -> Result<(), AppError> {
        let draft_dir = self
            .artifacts_root
            .join(PUBLISHER_CATALOG_DRAFTS_DIR)
            .join(&draft.draft_id);
        tokio::fs::create_dir_all(&draft_dir)
            .await
            .map_err(|error| {
                AppError::file_write_failed(format!(
                    "failed to create publisher catalog draft dir: {error}"
                ))
            })?;
        let spec_path = draft_dir.join(PUBLISHER_CATALOG_DRAFT_SPEC_FILE_NAME);
        tokio::fs::write(&spec_path, draft.spec_yaml.as_bytes())
            .await
            .map_err(|error| {
                AppError::file_write_failed(format!(
                    "failed to write publisher catalog draft spec: {error}"
                ))
            })?;
        Ok(())
    }

    async fn build_release_track_analysis_response(
        &self,
        row: ReleaseTrackAnalysisRecord,
    ) -> Result<ReleaseTrackAnalysisResponse, AppError> {
        validate_track_analysis_record_for_ipc(&row)?;
        let release_row = self
            .orchestrator
            .db()
            .get_release(&row.release_id)
            .await?
            .ok_or_else(|| {
                AppError::new(
                    app_error_codes::PLANNED_RELEASE_DESCRIPTOR_INTEGRITY_MISMATCH,
                    "release track analysis exists without a matching release record",
                )
            })?;

        let spec: ReleaseSpec =
            serde_json::from_str(&release_row.normalized_spec_json).map_err(|error| {
                AppError::new(
                    app_error_codes::NORMALIZED_SPEC_DECODE_FAILED,
                    format!("failed to decode normalized release spec JSON: {error}"),
                )
            })?;

        let track = CoreTrackModel::new(
            row.file_path.clone(),
            row.duration_ms,
            row.peak_data.clone(),
            row.loudness_lufs,
        )
        .map_err(map_core_model_error)?;

        let release_model = CoreReleaseModel::new(
            release_row.release_id.clone(),
            release_row.title,
            spec.artist,
            vec![track],
        )
        .map_err(map_core_model_error)?;

        Ok(ReleaseTrackAnalysisResponse {
            release: release_model,
            media_fingerprint: row.media_fingerprint,
            sample_rate_hz: row.sample_rate_hz,
            channels: row.channels,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
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
    let should_log_init = SERVICE.get().is_none();
    let init_started = Instant::now();
    if should_log_init {
        tracing::info!(target: "desktop.catalog", "command service init started");
    }
    let service = SERVICE
        .get_or_try_init(|| async { CommandService::from_default_location().await.map(Arc::new) })
        .await;
    if should_log_init {
        match &service {
            Ok(_) => tracing::info!(
                target: "desktop.catalog",
                elapsed_ms = init_started.elapsed().as_millis() as u64,
                "command service init completed"
            ),
            Err(error) => tracing::warn!(
                target: "desktop.catalog",
                elapsed_ms = init_started.elapsed().as_millis() as u64,
                error_code = %error.code,
                error = %error.message,
                "command service init failed"
            ),
        }
    }
    service.map(Arc::clone)
}

struct AnalyzedTrackPayload {
    track: CoreTrackModel,
    media_fingerprint: String,
    sample_rate_hz: u32,
    channels: u16,
}

async fn analyze_audio_file_to_track_payload(
    path: &Path,
) -> Result<AnalyzedTrackPayload, AppError> {
    let canonical_path = path.to_path_buf();
    let decode_path = canonical_path.clone();
    let analysis = tokio::task::spawn_blocking(move || analyze_audio_track_file(&decode_path))
        .await
        .map_err(|error| {
            AppError::new(
                app_error_codes::AUDIO_ANALYSIS_FAILED,
                format!("audio analysis task failed to join: {error}"),
            )
        })?
        .map_err(map_core_audio_error)?;

    let media_fingerprint =
        media_fingerprint_from_file(&canonical_path)
            .await
            .map_err(|error| {
                AppError::file_read_failed(format!(
                    "failed to compute media fingerprint for audio file: {error}"
                ))
            })?;

    let track = CoreTrackModel::new(
        path_to_string(&canonical_path),
        analysis.duration_ms,
        analysis.peak_data,
        analysis.loudness_lufs,
    )
    .map_err(map_core_model_error)?;

    Ok(AnalyzedTrackPayload {
        track,
        media_fingerprint,
        sample_rate_hz: analysis.sample_rate_hz,
        channels: analysis.channels,
    })
}

struct GuessedCatalogMetadata {
    title: String,
    artist_name: String,
    album_title: Option<String>,
}

static CATALOG_SCAN_JOB_NONCE: AtomicU64 = AtomicU64::new(0);

fn guess_catalog_metadata_from_path(path: &Path) -> GuessedCatalogMetadata {
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Untitled Track");
    let stem = stem.replace('_', " ");

    let (artist_name, title) = match stem.split_once(" - ") {
        Some((artist, title)) if !artist.trim().is_empty() && !title.trim().is_empty() => {
            (artist.trim().to_string(), title.trim().to_string())
        }
        _ => ("Unknown Artist".to_string(), stem.trim().to_string()),
    };

    GuessedCatalogMetadata {
        title,
        artist_name,
        album_title: None,
    }
}

fn catalog_id(domain: &str, material: &str) -> String {
    let mut bytes = Vec::with_capacity(domain.len() + material.len() + 1);
    bytes.extend_from_slice(domain.as_bytes());
    bytes.push(b'\n');
    bytes.extend_from_slice(material.as_bytes());
    blake3_hex(&bytes)
}

fn publisher_catalog_draft_spec_path(artifacts_root: &Path, draft_id: &str) -> PathBuf {
    artifacts_root
        .join(PUBLISHER_CATALOG_DRAFTS_DIR)
        .join(draft_id)
        .join(PUBLISHER_CATALOG_DRAFT_SPEC_FILE_NAME)
}

fn sanitize_catalog_tags_for_release_spec(tags: &[String]) -> Vec<String> {
    let mut seen = std::collections::BTreeSet::new();
    let mut out = Vec::new();
    for tag in tags {
        let normalized = normalize_catalog_tag_label(tag).to_ascii_lowercase();
        if normalized.is_empty() {
            continue;
        }
        if normalized.len() > MAX_RELEASE_SPEC_TAG_LEN_CHARS {
            continue;
        }
        if !seen.insert(normalized.clone()) {
            continue;
        }
        out.push(normalized);
        if out.len() >= MAX_RELEASE_SPEC_TAGS_FROM_CATALOG {
            break;
        }
    }
    out
}

fn generated_catalog_track_spec_description(track: &CatalogTrackDetailResponse) -> String {
    let mut parts = vec!["Generated from local catalog track".to_string()];
    if let Some(album_title) = &track.album_title {
        if !album_title.trim().is_empty() {
            parts.push(format!("album: {}", album_title.trim()));
        }
    }
    parts.push(format!("visibility: {}", track.visibility_policy));
    parts.push(format!("license: {}", track.license_policy));
    parts.push(format!(
        "downloadable: {}",
        if track.downloadable { "yes" } else { "no" }
    ));
    parts.join(" | ")
}

fn build_release_spec_from_catalog_track(track: &CatalogTrackDetailResponse) -> ReleaseSpec {
    ReleaseSpec {
        title: track.title.trim().to_string(),
        artist: track.artist_name.trim().to_string(),
        description: generated_catalog_track_spec_description(track),
        tags: sanitize_catalog_tags_for_release_spec(&track.tags),
        mock: Some(MockOptions {
            enabled: true,
            note: Some(format!("Generated from catalog track {}", track.track_id)),
        }),
    }
}

fn build_publisher_draft_from_catalog_track(
    track: &CatalogTrackDetailResponse,
    artifacts_root: &Path,
) -> Result<PublisherCreateDraftFromTrackResponse, AppError> {
    let spec = build_release_spec_from_catalog_track(track);
    let spec_yaml = serde_yaml::to_string(&spec).map_err(|error| {
        AppError::new(
            app_error_codes::SERIALIZATION_ERROR,
            format!("failed to serialize catalog track draft spec YAML: {error}"),
        )
    })?;

    if let Err(errors) = parse_release_spec_yaml(&spec_yaml) {
        return Err(AppError::new(
            app_error_codes::SPEC_VALIDATION_FAILED,
            "generated catalog draft spec failed validation",
        )
        .with_details(serde_json::json!({ "errors": errors })));
    }

    let draft_material = format!(
        "{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}",
        track.track_id,
        track.media_fingerprint,
        track.updated_at,
        track.visibility_policy,
        track.license_policy,
        if track.downloadable { "1" } else { "0" },
        track.tags.join(","),
        spec_yaml
    );
    let draft_id = catalog_id("publisher-catalog-draft-track.v1", &draft_material);
    let spec_path = publisher_catalog_draft_spec_path(artifacts_root, &draft_id);

    Ok(PublisherCreateDraftFromTrackResponse {
        draft_id,
        source_track_id: track.track_id.clone(),
        media_path: track.file_path.clone(),
        spec_path: path_to_string(&spec_path),
        spec,
        spec_yaml,
    })
}

fn next_catalog_scan_job_id(root_id: &str) -> String {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let nonce = CATALOG_SCAN_JOB_NONCE.fetch_add(1, Ordering::Relaxed);
    catalog_id(
        "catalog-ingest-job.v1",
        &format!("{root_id}:{now_ms}:{nonce}"),
    )
}

fn normalize_catalog_tag_label(raw: &str) -> String {
    raw.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn validate_catalog_track_tags_for_ipc(tags: &[String]) -> Result<(), AppError> {
    if tags.len() > MAX_CATALOG_TRACK_TAGS {
        return Err(AppError::new(
            app_error_codes::AUDIO_MODEL_INVALID,
            format!("catalog tags exceed maximum count of {MAX_CATALOG_TRACK_TAGS}"),
        ));
    }
    for tag in tags {
        let label = normalize_catalog_tag_label(tag);
        if label.is_empty() {
            return Err(AppError::new(
                app_error_codes::AUDIO_MODEL_INVALID,
                "catalog tag labels must not be empty",
            ));
        }
        if label.len() > MAX_CATALOG_TAG_LABEL_CHARS {
            return Err(AppError::new(
                app_error_codes::AUDIO_MODEL_INVALID,
                format!(
                    "catalog tag labels exceed maximum length of {MAX_CATALOG_TAG_LABEL_CHARS} characters"
                ),
            ));
        }
    }
    Ok(())
}

fn validate_plan_release_platforms(raw: &[String]) -> Result<Vec<String>, AppError> {
    if raw.is_empty() {
        return Err(AppError::invalid_argument(
            "plan_release requires at least one platform",
        ));
    }
    if raw.len() > MAX_PLAN_RELEASE_PLATFORMS {
        return Err(AppError::invalid_argument(format!(
            "plan_release accepts at most {MAX_PLAN_RELEASE_PLATFORMS} platforms"
        )));
    }

    let mut normalized = Vec::with_capacity(raw.len());
    let mut seen = std::collections::BTreeSet::new();
    for platform_raw in raw {
        let platform = platform_raw.trim().to_ascii_lowercase();
        if platform.is_empty() {
            return Err(AppError::invalid_argument(
                "platform labels must not be blank",
            ));
        }
        if platform.len() > MAX_PLATFORM_LABEL_CHARS {
            return Err(AppError::invalid_argument(format!(
                "platform labels exceed maximum length of {MAX_PLATFORM_LABEL_CHARS} characters"
            )));
        }
        if !platform
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        {
            return Err(AppError::invalid_argument(
                "platform labels must only contain ASCII alphanumeric, '.', '_' or '-' characters",
            ));
        }
        if !seen.insert(platform.clone()) {
            return Err(AppError::invalid_argument(format!(
                "duplicate platform label `{platform}` is not allowed"
            )));
        }
        normalized.push(platform);
    }

    Ok(normalized)
}

fn validate_catalog_policy(raw: &str, label: &str, allowed: &[&str]) -> Result<String, AppError> {
    let normalized = raw.trim().to_ascii_uppercase();
    if normalized.is_empty() {
        return Err(AppError::invalid_argument(format!(
            "{label} must not be blank"
        )));
    }
    if allowed.iter().any(|value| *value == normalized) {
        Ok(normalized)
    } else {
        Err(AppError::invalid_argument(format!(
            "{label} must be one of: {}",
            allowed.join(", ")
        )))
    }
}

fn validate_catalog_update_track_metadata_input(
    input: CatalogUpdateTrackMetadataInput,
) -> Result<PreparedCatalogTrackMetadataUpdate, AppError> {
    let track_id = validate_catalog_track_id(&input.track_id)?;
    let visibility_policy = validate_catalog_policy(
        &input.visibility_policy,
        "visibility_policy",
        ALLOWED_CATALOG_VISIBILITY_POLICIES,
    )?;
    let license_policy = validate_catalog_policy(
        &input.license_policy,
        "license_policy",
        ALLOWED_CATALOG_LICENSE_POLICIES,
    )?;

    if input.tags.len() > MAX_CATALOG_TRACK_TAGS {
        return Err(AppError::invalid_argument(format!(
            "tags exceed maximum count of {MAX_CATALOG_TRACK_TAGS}"
        )));
    }

    let mut seen_normalized = std::collections::BTreeSet::new();
    let mut tags = Vec::with_capacity(input.tags.len());
    for raw_tag in input.tags {
        let label = normalize_catalog_tag_label(&raw_tag);
        if label.is_empty() {
            return Err(AppError::invalid_argument(
                "tag labels must not be empty or whitespace only",
            ));
        }
        if label.len() > MAX_CATALOG_TAG_LABEL_CHARS {
            return Err(AppError::invalid_argument(format!(
                "tag labels exceed maximum length of {MAX_CATALOG_TAG_LABEL_CHARS} characters"
            )));
        }
        let normalized_label = label.to_ascii_lowercase();
        if !seen_normalized.insert(normalized_label.clone()) {
            return Err(AppError::invalid_argument(format!(
                "duplicate tag label after normalization: `{label}`"
            )));
        }
        tags.push(DbCatalogTrackTagAssignment {
            tag_id: catalog_id("catalog-tag.v1", &normalized_label),
            label,
        });
    }

    Ok(PreparedCatalogTrackMetadataUpdate {
        track_id,
        visibility_policy,
        license_policy,
        downloadable: input.downloadable,
        tags,
    })
}

fn validate_catalog_track_id(raw: &str) -> Result<String, AppError> {
    validate_catalog_hex_id(raw, "catalog track_id")
}

fn validate_catalog_hex_id(raw: &str, label: &str) -> Result<String, AppError> {
    let normalized = raw.trim().to_ascii_lowercase();
    if normalized.len() != 64 || !normalized.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(AppError::invalid_argument(format!(
            "{label} must be a 64-character hex string"
        )));
    }
    Ok(normalized)
}

fn catalog_track_list_item_from_db_list_item(item: DbCatalogTrackListItem) -> CatalogTrackListItem {
    CatalogTrackListItem {
        track_id: item.track_id,
        title: item.title,
        artist_name: item.artist_name,
        album_title: item.album_title,
        duration_ms: item.duration_ms,
        loudness_lufs: item.loudness_lufs,
        file_path: item.file_path,
        media_fingerprint: item.media_fingerprint,
        updated_at: item.updated_at,
    }
}

fn catalog_track_list_item_from_record(record: DbCatalogTrackRecord) -> CatalogTrackListItem {
    CatalogTrackListItem {
        track_id: record.track_id,
        title: record.title,
        artist_name: record.artist_name,
        album_title: record.album_title,
        duration_ms: record.duration_ms,
        loudness_lufs: record.loudness_lufs,
        file_path: record.file_path,
        media_fingerprint: record.media_fingerprint,
        updated_at: record.updated_at,
    }
}

fn build_catalog_track_detail_response_with_tags(
    record: DbCatalogTrackRecord,
    tags: Vec<String>,
) -> Result<CatalogTrackDetailResponse, AppError> {
    validate_catalog_track_record_for_ipc(&record)?;
    validate_catalog_track_tags_for_ipc(&tags)?;
    let track = CoreTrackModel::new(
        record.file_path.clone(),
        record.duration_ms,
        record.peak_data.clone(),
        record.loudness_lufs,
    )
    .map_err(map_core_model_error)?;

    Ok(CatalogTrackDetailResponse {
        track_id: record.track_id,
        media_asset_id: record.media_asset_id,
        title: record.title,
        artist_id: record.artist_id,
        artist_name: record.artist_name,
        album_id: record.album_id,
        album_title: record.album_title,
        file_path: record.file_path,
        media_fingerprint: record.media_fingerprint,
        track,
        sample_rate_hz: record.sample_rate_hz,
        channels: record.channels,
        true_peak_dbfs: record.true_peak_dbfs,
        visibility_policy: record.visibility_policy,
        license_policy: record.license_policy,
        downloadable: record.downloadable,
        tags,
        created_at: record.created_at,
        updated_at: record.updated_at,
    })
}

fn library_root_response_from_db(row: DbLibraryRootRecord) -> LibraryRootResponse {
    LibraryRootResponse {
        root_id: row.root_id,
        path: row.path,
        enabled: row.enabled,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn catalog_ingest_job_response_from_db(row: DbIngestJobRecord) -> CatalogIngestJobResponse {
    CatalogIngestJobResponse {
        job_id: row.job_id,
        status: row.status.as_str().to_string(),
        scope: row.scope,
        total_items: row.total_items,
        processed_items: row.processed_items,
        error_count: row.error_count,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn is_supported_catalog_audio_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase()),
        Some(ext)
            if matches!(
                ext.as_str(),
                "wav" | "wave" | "flac" | "mp3" | "ogg" | "oga" | "m4a" | "aac" | "caf" | "aiff" | "aif" | "opus"
            )
    )
}

fn collect_supported_audio_files_recursive(root: &Path) -> Result<Vec<PathBuf>, AppError> {
    let mut files = Vec::new();
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let entries = std::fs::read_dir(&dir).map_err(|e| {
            AppError::file_read_failed(format!(
                "failed to read directory while scanning library root: {e}"
            ))
        })?;
        for entry in entries {
            let entry = entry.map_err(|e| {
                AppError::file_read_failed(format!(
                    "failed to read directory entry while scanning library root: {e}"
                ))
            })?;
            let path = entry.path();
            let file_type = entry.file_type().map_err(|e| {
                AppError::file_read_failed(format!(
                    "failed to read file type while scanning library root: {e}"
                ))
            })?;
            if file_type.is_dir() {
                stack.push(path);
            } else if file_type.is_file() && is_supported_catalog_audio_extension(&path) {
                files.push(path);
            }
        }
    }

    files.sort();
    Ok(files)
}

async fn run_catalog_scan_job(
    service: Arc<CommandService>,
    root: DbLibraryRootRecord,
    job_id: String,
) {
    if let Err(error) = run_catalog_scan_job_inner(service, root, job_id.clone()).await {
        tracing::warn!(
            target: "desktop.catalog",
            job_id = %job_id,
            error_code = %error.code,
            error = %error.message,
            "catalog root scan job failed"
        );
    }
}

async fn run_catalog_scan_job_inner(
    service: Arc<CommandService>,
    root: DbLibraryRootRecord,
    job_id: String,
) -> Result<(), AppError> {
    let _ = service
        .db
        .update_ingest_job(&UpdateIngestJob {
            job_id: job_id.clone(),
            status: DbIngestJobStatus::Running,
            total_items: 0,
            processed_items: 0,
            error_count: 0,
        })
        .await;

    let root_path = PathBuf::from(&root.path);
    let files =
        tokio::task::spawn_blocking(move || collect_supported_audio_files_recursive(&root_path))
            .await
            .map_err(|error| {
                AppError::new(
                    app_error_codes::IO_ERROR,
                    format!("catalog root scan task failed to join: {error}"),
                )
            })??;

    service
        .db
        .update_ingest_job(&UpdateIngestJob {
            job_id: job_id.clone(),
            status: DbIngestJobStatus::Running,
            total_items: u32::try_from(files.len()).unwrap_or(u32::MAX),
            processed_items: 0,
            error_count: 0,
        })
        .await?;

    let mut processed_items: u32 = 0;
    let mut error_count: u32 = 0;
    let total_items = u32::try_from(files.len()).unwrap_or(u32::MAX);

    for file in files {
        let file_str = path_to_string(&file);
        let result = service
            .import_catalog_track_from_canonical_path(&file)
            .await;
        processed_items = processed_items.saturating_add(1);
        if let Err(error) = result {
            error_count = error_count.saturating_add(1);
            let _ = service
                .db
                .append_ingest_event(&NewIngestEvent {
                    job_id: job_id.clone(),
                    level: "ERROR".to_string(),
                    message: error.message.clone(),
                    payload_json: Some(serde_json::json!({
                        "code": error.code,
                        "path": file_str
                    })),
                })
                .await;
        }

        service
            .db
            .update_ingest_job(&UpdateIngestJob {
                job_id: job_id.clone(),
                status: DbIngestJobStatus::Running,
                total_items,
                processed_items,
                error_count,
            })
            .await?;
    }

    let final_status = DbIngestJobStatus::Completed;
    service
        .db
        .update_ingest_job(&UpdateIngestJob {
            job_id,
            status: final_status,
            total_items,
            processed_items,
            error_count,
        })
        .await?;

    Ok(())
}

fn decode_release_report_artifact(bytes: &[u8]) -> Result<DecodedReleaseReport, AppError> {
    // Decode from bytes once to preserve raw unknown fields while avoiding a second byte parse.
    let raw: Value = serde_json::from_slice(bytes)
        .map_err(|e| AppError::new(app_error_codes::REPORT_DECODE_FAILED, e.to_string()))?;
    let parsed: ReleaseReportArtifact = serde_json::from_value(raw.clone())
        .map_err(|e| AppError::new(app_error_codes::REPORT_DECODE_FAILED, e.to_string()))?;
    Ok(DecodedReleaseReport { parsed, raw })
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
    if trimmed.len() > MAX_IPC_PATH_CHARS {
        return Err(AppError::invalid_argument(format!(
            "path exceeds maximum length of {MAX_IPC_PATH_CHARS} characters"
        )));
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

fn strip_single_layer_matching_quotes(raw: &str) -> &str {
    let trimmed = raw.trim();
    if trimmed.len() >= 2 {
        let bytes = trimmed.as_bytes();
        let first = bytes[0];
        let last = bytes[trimmed.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return trimmed[1..trimmed.len() - 1].trim();
        }
    }
    trimmed
}

async fn canonicalize_file_path(input: impl AsRef<Path>, label: &str) -> Result<PathBuf, AppError> {
    let input = input.as_ref();
    let path = match input.to_str() {
        Some(raw) => {
            let normalized = strip_single_layer_matching_quotes(raw);
            reject_odd_prefixes(normalized)?;
            PathBuf::from(normalized)
        }
        None => input.to_path_buf(),
    };
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

async fn canonicalize_directory_path(
    input: impl AsRef<Path>,
    label: &str,
) -> Result<PathBuf, AppError> {
    let input = input.as_ref();
    let path = match input.to_str() {
        Some(raw) => {
            let normalized = strip_single_layer_matching_quotes(raw);
            reject_odd_prefixes(normalized)?;
            PathBuf::from(normalized)
        }
        None => input.to_path_buf(),
    };
    let canonical = tokio::fs::canonicalize(&path)
        .await
        .map_err(|e| AppError::file_read_failed(format!("failed to canonicalize {label}: {e}")))?;
    let metadata = tokio::fs::metadata(&canonical)
        .await
        .map_err(|e| AppError::file_read_failed(format!("failed to stat {label}: {e}")))?;
    if !metadata.is_dir() {
        return Err(AppError::invalid_argument(format!(
            "{label} must be a directory"
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
    shared_service().await?.handle_load_spec(&path).await
}

#[tauri::command]
pub async fn plan_release(input: PlanReleaseInput) -> Result<PlanReleaseResponse, AppError> {
    shared_service().await?.handle_plan_release(input).await
}

#[tauri::command]
pub async fn execute_release(release_id: String) -> Result<ExecuteReleaseResponse, AppError> {
    shared_service()
        .await?
        .handle_execute_release(&release_id)
        .await
}

#[tauri::command]
pub async fn list_history() -> Result<Vec<HistoryRow>, AppError> {
    shared_service().await?.handle_list_history().await
}

#[tauri::command]
pub async fn get_report(release_id: String) -> Result<Option<ReleaseReport>, AppError> {
    shared_service().await?.handle_get_report(&release_id).await
}

#[tauri::command]
pub async fn analyze_audio_file(path: String) -> Result<AnalyzeAudioFileResponse, AppError> {
    shared_service()
        .await?
        .handle_analyze_audio_file(&path)
        .await
}

#[tauri::command]
pub async fn analyze_and_persist_release_track(
    release_id: String,
    path: String,
) -> Result<ReleaseTrackAnalysisResponse, AppError> {
    shared_service()
        .await?
        .handle_analyze_and_persist_release_track(&release_id, &path)
        .await
}

#[tauri::command]
pub async fn get_release_track_analysis(
    release_id: String,
) -> Result<Option<ReleaseTrackAnalysisResponse>, AppError> {
    shared_service()
        .await?
        .handle_get_release_track_analysis(&release_id)
        .await
}

#[tauri::command]
pub async fn catalog_import_files(
    paths: Vec<String>,
) -> Result<CatalogImportFilesResponse, AppError> {
    let started = Instant::now();
    tracing::info!(
        target: "desktop.catalog",
        command = "catalog_import_files",
        path_count = paths.len(),
        "command started"
    );
    let result = shared_service()
        .await?
        .handle_catalog_import_files(paths)
        .await;
    match &result {
        Ok(response) => tracing::info!(
            target: "desktop.catalog",
            command = "catalog_import_files",
            elapsed_ms = started.elapsed().as_millis() as u64,
            imported = response.imported.len(),
            failed = response.failed.len(),
            "command completed"
        ),
        Err(error) => tracing::warn!(
            target: "desktop.catalog",
            command = "catalog_import_files",
            elapsed_ms = started.elapsed().as_millis() as u64,
            error_code = %error.code,
            error = %error.message,
            "command failed"
        ),
    }
    result
}

#[tauri::command]
pub async fn catalog_list_tracks(
    query: Option<CatalogListTracksInput>,
) -> Result<CatalogListTracksResponse, AppError> {
    let started = Instant::now();
    tracing::info!(
        target: "desktop.catalog",
        command = "catalog_list_tracks",
        has_search = query
            .as_ref()
            .and_then(|item| item.search.as_ref())
            .map(|item| !item.trim().is_empty())
            .unwrap_or(false),
        limit = query.as_ref().and_then(|item| item.limit).unwrap_or(100),
        offset = query.as_ref().and_then(|item| item.offset).unwrap_or(0),
        "command started"
    );
    let result = shared_service()
        .await?
        .handle_catalog_list_tracks(query)
        .await;
    match &result {
        Ok(response) => tracing::info!(
            target: "desktop.catalog",
            command = "catalog_list_tracks",
            elapsed_ms = started.elapsed().as_millis() as u64,
            returned = response.items.len(),
            total = response.total,
            "command completed"
        ),
        Err(error) => tracing::warn!(
            target: "desktop.catalog",
            command = "catalog_list_tracks",
            elapsed_ms = started.elapsed().as_millis() as u64,
            error_code = %error.code,
            error = %error.message,
            "command failed"
        ),
    }
    result
}

#[tauri::command]
pub async fn catalog_get_track(
    track_id: String,
) -> Result<Option<CatalogTrackDetailResponse>, AppError> {
    shared_service()
        .await?
        .handle_catalog_get_track(&track_id)
        .await
}

#[tauri::command]
pub async fn publisher_create_draft_from_track(
    track_id: String,
) -> Result<PublisherCreateDraftFromTrackResponse, AppError> {
    shared_service()
        .await?
        .handle_publisher_create_draft_from_track(&track_id)
        .await
}

#[tauri::command]
pub async fn catalog_update_track_metadata(
    input: CatalogUpdateTrackMetadataInput,
) -> Result<CatalogTrackDetailResponse, AppError> {
    shared_service()
        .await?
        .handle_catalog_update_track_metadata(input)
        .await
}

#[tauri::command]
pub async fn catalog_add_library_root(path: String) -> Result<LibraryRootResponse, AppError> {
    let started = Instant::now();
    tracing::info!(
        target: "desktop.catalog",
        command = "catalog_add_library_root",
        path_len = path.len(),
        "command started"
    );
    let result = shared_service()
        .await?
        .handle_catalog_add_library_root(&path)
        .await;
    match &result {
        Ok(response) => tracing::info!(
            target: "desktop.catalog",
            command = "catalog_add_library_root",
            elapsed_ms = started.elapsed().as_millis() as u64,
            root_id = %response.root_id,
            "command completed"
        ),
        Err(error) => tracing::warn!(
            target: "desktop.catalog",
            command = "catalog_add_library_root",
            elapsed_ms = started.elapsed().as_millis() as u64,
            error_code = %error.code,
            error = %error.message,
            "command failed"
        ),
    }
    result
}

#[tauri::command]
pub async fn catalog_list_library_roots() -> Result<Vec<LibraryRootResponse>, AppError> {
    let started = Instant::now();
    tracing::info!(
        target: "desktop.catalog",
        command = "catalog_list_library_roots",
        "command started"
    );
    let result = shared_service()
        .await?
        .handle_catalog_list_library_roots()
        .await;
    match &result {
        Ok(response) => tracing::info!(
            target: "desktop.catalog",
            command = "catalog_list_library_roots",
            elapsed_ms = started.elapsed().as_millis() as u64,
            roots = response.len(),
            "command completed"
        ),
        Err(error) => tracing::warn!(
            target: "desktop.catalog",
            command = "catalog_list_library_roots",
            elapsed_ms = started.elapsed().as_millis() as u64,
            error_code = %error.code,
            error = %error.message,
            "command failed"
        ),
    }
    result
}

#[tauri::command]
pub async fn catalog_remove_library_root(root_id: String) -> Result<bool, AppError> {
    shared_service()
        .await?
        .handle_catalog_remove_library_root(&root_id)
        .await
}

#[tauri::command]
pub async fn catalog_scan_root(root_id: String) -> Result<CatalogScanRootResponse, AppError> {
    let started = Instant::now();
    tracing::info!(
        target: "desktop.catalog",
        command = "catalog_scan_root",
        root_id = %root_id,
        "command started"
    );
    let service = shared_service().await?;
    let prepared = service.handle_catalog_scan_root_prepare(&root_id).await.map_err(|error| {
        tracing::warn!(
            target: "desktop.catalog",
            command = "catalog_scan_root",
            root_id = %root_id,
            elapsed_ms = started.elapsed().as_millis() as u64,
            error_code = %error.code,
            error = %error.message,
            "command failed before dispatch"
        );
        error
    })?;
    let response = CatalogScanRootResponse {
        job_id: prepared.job.job_id.clone(),
        root_id: prepared.root.root_id.clone(),
    };
    tracing::info!(
        target: "desktop.catalog",
        command = "catalog_scan_root",
        root_id = %response.root_id,
        job_id = %response.job_id,
        elapsed_ms = started.elapsed().as_millis() as u64,
        "command dispatched background job"
    );
    let service_clone = Arc::clone(&service);
    tokio::spawn(async move {
        run_catalog_scan_job(service_clone, prepared.root, prepared.job.job_id).await;
    });
    Ok(response)
}

#[tauri::command]
pub async fn catalog_get_ingest_job(
    job_id: String,
) -> Result<Option<CatalogIngestJobResponse>, AppError> {
    shared_service()
        .await?
        .handle_catalog_get_ingest_job(&job_id)
        .await
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

    fn decode_plan_release_input_from_ipc_value_for_test(
        value: serde_json::Value,
    ) -> Result<PlanReleaseInput, AppError> {
        serde_json::from_value(value).map_err(|error| {
            AppError::invalid_argument(format!("invalid plan_release payload: {error}"))
        })
    }

    fn decode_catalog_list_tracks_input_from_ipc_value_for_test(
        value: serde_json::Value,
    ) -> Result<CatalogListTracksInput, AppError> {
        serde_json::from_value(value).map_err(|error| {
            AppError::invalid_argument(format!("invalid catalog_list_tracks payload: {error}"))
        })
    }

    fn decode_catalog_update_track_metadata_input_from_ipc_value_for_test(
        value: serde_json::Value,
    ) -> Result<CatalogUpdateTrackMetadataInput, AppError> {
        serde_json::from_value(value).map_err(|error| {
            AppError::invalid_argument(format!(
                "invalid catalog_update_track_metadata payload: {error}"
            ))
        })
    }

    async fn write_spec_file(dir: &Path, title: &str, artist: &str) -> String {
        let spec_path = dir.join("spec-audio.yaml");
        let spec = format!(
            "title: \"{title}\"\nartist: \"{artist}\"\ndescription: \"QC\"\ntags: [\"qc\", \"audio\"]\n"
        );
        tokio::fs::write(&spec_path, spec)
            .await
            .expect("write spec file");
        spec_path.to_string_lossy().to_string()
    }

    fn pcm16_wav_sine_bytes(
        sample_rate_hz: u32,
        duration_ms: u32,
        frequency_hz: f32,
        amplitude: f32,
    ) -> Vec<u8> {
        let channels: u16 = 1;
        let bits_per_sample: u16 = 16;
        let bytes_per_sample = (bits_per_sample / 8) as u32;
        let total_frames = ((u64::from(sample_rate_hz) * u64::from(duration_ms)) / 1_000) as u32;
        let data_size = total_frames * u32::from(channels) * bytes_per_sample;
        let byte_rate = sample_rate_hz * u32::from(channels) * bytes_per_sample;
        let block_align = channels * (bits_per_sample / 8);
        let riff_size = 36u32 + data_size;

        let mut out = Vec::with_capacity((44 + data_size) as usize);
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&riff_size.to_le_bytes());
        out.extend_from_slice(b"WAVE");
        out.extend_from_slice(b"fmt ");
        out.extend_from_slice(&16u32.to_le_bytes()); // PCM fmt chunk size
        out.extend_from_slice(&1u16.to_le_bytes()); // PCM format
        out.extend_from_slice(&channels.to_le_bytes());
        out.extend_from_slice(&sample_rate_hz.to_le_bytes());
        out.extend_from_slice(&byte_rate.to_le_bytes());
        out.extend_from_slice(&block_align.to_le_bytes());
        out.extend_from_slice(&bits_per_sample.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&data_size.to_le_bytes());

        let amp = amplitude.clamp(0.0, 0.999);
        for frame_idx in 0..total_frames {
            let t = frame_idx as f32 / sample_rate_hz as f32;
            let sample = (std::f32::consts::TAU * frequency_hz * t).sin() * amp;
            let pcm = (sample * i16::MAX as f32).round() as i16;
            out.extend_from_slice(&pcm.to_le_bytes());
        }

        out
    }

    async fn write_wav_fixture_file(dir: &Path, file_name: &str) -> String {
        let path = dir.join(file_name);
        let wav = pcm16_wav_sine_bytes(48_000, 1_500, 440.0, 0.4);
        tokio::fs::write(&path, wav)
            .await
            .expect("write wav fixture");
        path.to_string_lossy().to_string()
    }

    async fn wait_for_ingest_job_terminal(
        service: &CommandService,
        job_id: &str,
    ) -> CatalogIngestJobResponse {
        for _ in 0..100 {
            let job = service
                .handle_catalog_get_ingest_job(job_id)
                .await
                .expect("get ingest job")
                .expect("ingest job exists");
            if matches!(job.status.as_str(), "COMPLETED" | "FAILED") {
                return job;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        panic!("ingest job did not reach terminal state in time");
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
            .handle_execute_release(&plan.release_id)
            .await
            .expect("execute");
        assert_eq!(exec.release_id, plan.release_id);
        assert_eq!(exec.status, "COMMITTED");
        assert!(exec.report_path.is_some());

        let history = service.handle_list_history().await.expect("history");
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].release_id, plan.release_id);

        let report = service
            .handle_get_report(&plan.release_id)
            .await
            .expect("report")
            .expect("report exists");
        assert_eq!(report.release_id, plan.release_id);
        assert!(report.summary.contains("COMMITTED"));
    }

    #[tokio::test]
    async fn command_service_analyze_audio_file_returns_track_model_and_metrics() {
        let (service, dir) = new_service().await;
        let wav_path = write_wav_fixture_file(dir.path(), "analysis.wav").await;

        let analyzed = service
            .handle_analyze_audio_file(&wav_path)
            .await
            .expect("analyze audio file");

        assert!(analyzed.canonical_path.ends_with("/analysis.wav"));
        assert_eq!(analyzed.media_fingerprint.len(), 64);
        assert_eq!(analyzed.sample_rate_hz, 48_000);
        assert_eq!(analyzed.channels, 1);
        assert_eq!(analyzed.track.file_path(), analyzed.canonical_path);
        assert!(analyzed.track.duration_ms() >= 1_499 && analyzed.track.duration_ms() <= 1_500);
        assert!(!analyzed.track.peak_data().is_empty());
        assert!(analyzed.track.peak_data().iter().all(|peak| *peak <= 0.0));
        assert!(analyzed.track.loudness_lufs() <= 0.0);
    }

    #[tokio::test]
    async fn catalog_import_list_and_get_track_round_trip() {
        let (service, dir) = new_service().await;
        let wav_a = write_wav_fixture_file(dir.path(), "Artist A - Sunset.wav").await;
        let wav_b_path = dir.path().join("Midnight.wav");
        tokio::fs::write(
            &wav_b_path,
            pcm16_wav_sine_bytes(48_000, 1_500, 880.0, 0.25),
        )
        .await
        .expect("write second wav");
        let wav_b = wav_b_path.to_string_lossy().to_string();

        let imported = service
            .handle_catalog_import_files(vec![wav_a.clone(), wav_b.clone()])
            .await
            .expect("catalog import");
        assert_eq!(imported.failed.len(), 0);
        assert_eq!(imported.imported.len(), 2);

        let list = service
            .handle_catalog_list_tracks(Some(CatalogListTracksInput {
                search: Some("sunset".to_string()),
                limit: Some(20),
                offset: Some(0),
            }))
            .await
            .expect("catalog list");
        assert_eq!(list.total, 1);
        assert_eq!(list.items.len(), 1);
        assert_eq!(list.items[0].artist_name, "Artist A");
        assert!(list.items[0].title.contains("Sunset"));

        let detail = service
            .handle_catalog_get_track(&list.items[0].track_id)
            .await
            .expect("catalog get")
            .expect("track should exist");
        assert_eq!(detail.artist_name, "Artist A");
        assert!(detail.title.contains("Sunset"));
        assert!(detail.file_path.ends_with("Sunset.wav"));
        assert_eq!(detail.sample_rate_hz, 48_000);
        assert_eq!(detail.channels, 1);
        assert!(!detail.track.peak_data().is_empty());
    }

    #[tokio::test]
    async fn catalog_update_track_metadata_round_trips_tags_and_policies() {
        let (service, dir) = new_service().await;
        let wav = write_wav_fixture_file(dir.path(), "Artist B - Authoring.wav").await;
        let imported = service
            .handle_catalog_import_files(vec![wav])
            .await
            .expect("catalog import");
        let track_id = imported.imported[0].track_id.clone();

        let updated = service
            .handle_catalog_update_track_metadata(CatalogUpdateTrackMetadataInput {
                track_id: track_id.clone(),
                visibility_policy: "private".to_string(),
                license_policy: "cc_by".to_string(),
                downloadable: true,
                tags: vec!["Indie Rock".to_string(), "  Sunset  Vibes  ".to_string()],
            })
            .await
            .expect("update metadata");

        assert_eq!(updated.track_id, track_id);
        assert_eq!(updated.visibility_policy, "PRIVATE");
        assert_eq!(updated.license_policy, "CC_BY");
        assert!(updated.downloadable);
        assert_eq!(
            updated.tags,
            vec!["Indie Rock".to_string(), "Sunset Vibes".to_string()]
        );

        let fetched = service
            .handle_catalog_get_track(&updated.track_id)
            .await
            .expect("get track")
            .expect("track should exist");
        assert_eq!(fetched.visibility_policy, "PRIVATE");
        assert_eq!(fetched.license_policy, "CC_BY");
        assert!(fetched.downloadable);
        assert_eq!(
            fetched.tags,
            vec!["Indie Rock".to_string(), "Sunset Vibes".to_string()]
        );
    }

    #[tokio::test]
    async fn catalog_update_track_metadata_rejects_duplicate_or_invalid_tags_and_policies() {
        let (service, dir) = new_service().await;
        let wav = write_wav_fixture_file(dir.path(), "Artist C - Tags.wav").await;
        let imported = service
            .handle_catalog_import_files(vec![wav])
            .await
            .expect("catalog import");
        let track_id = imported.imported[0].track_id.clone();

        let duplicate_err = service
            .handle_catalog_update_track_metadata(CatalogUpdateTrackMetadataInput {
                track_id: track_id.clone(),
                visibility_policy: "LOCAL".to_string(),
                license_policy: "ALL_RIGHTS_RESERVED".to_string(),
                downloadable: false,
                tags: vec!["Dream Pop".to_string(), " dream   pop ".to_string()],
            })
            .await
            .expect_err("duplicate normalized tags must be rejected");
        assert_eq!(duplicate_err.code, "INVALID_ARGUMENT");
        assert!(duplicate_err.message.contains("duplicate tag"));

        let policy_err = service
            .handle_catalog_update_track_metadata(CatalogUpdateTrackMetadataInput {
                track_id,
                visibility_policy: "PUBLIC_WEB".to_string(),
                license_policy: "ALL_RIGHTS_RESERVED".to_string(),
                downloadable: false,
                tags: vec![],
            })
            .await
            .expect_err("unknown visibility policy must be rejected");
        assert_eq!(policy_err.code, "INVALID_ARGUMENT");
        assert!(policy_err.message.contains("visibility_policy"));
    }

    #[tokio::test]
    async fn publisher_create_draft_from_track_generates_valid_spec_file_and_prefill_paths() {
        let (service, dir) = new_service().await;
        let wav = write_wav_fixture_file(dir.path(), "Artist D - Bridge Me.wav").await;
        let imported = service
            .handle_catalog_import_files(vec![wav.clone()])
            .await
            .expect("catalog import");
        let track_id = imported.imported[0].track_id.clone();

        let _updated = service
            .handle_catalog_update_track_metadata(CatalogUpdateTrackMetadataInput {
                track_id: track_id.clone(),
                visibility_policy: "PRIVATE".to_string(),
                license_policy: "CC_BY".to_string(),
                downloadable: true,
                tags: vec![
                    "Dream Pop".to_string(),
                    "Late Night".to_string(),
                    "this-tag-is-way-too-long-for-release-spec-and-should-be-dropped".to_string(),
                ],
            })
            .await
            .expect("update catalog metadata");

        let draft = service
            .handle_publisher_create_draft_from_track(&track_id)
            .await
            .expect("create publisher draft");

        assert_eq!(draft.source_track_id, track_id);
        let draft_media_path = draft.media_path.replace('\\', "/");
        let wav_path = wav.replace('\\', "/");
        assert!(
            draft_media_path == wav_path || draft_media_path.ends_with(&wav_path),
            "unexpected media path: draft={draft_media_path} wav={wav_path}"
        );
        assert!(draft.spec_path.contains("/publisher_catalog_drafts/"));
        assert!(draft.spec_path.ends_with("/release_spec.yaml"));
        assert_eq!(draft.spec.title, "Bridge Me");
        assert_eq!(draft.spec.artist, "Artist D");
        assert!(draft.spec.description.contains("visibility: PRIVATE"));
        assert!(draft.spec.description.contains("license: CC_BY"));
        assert_eq!(
            draft.spec.tags,
            vec!["dream pop".to_string(), "late night".to_string()]
        );
        assert!(draft.spec_yaml.contains("title: Bridge Me"));

        let spec_path_fs = PathBuf::from(draft.spec_path.replace('/', "\\"));
        let bytes = tokio::fs::read(&spec_path_fs)
            .await
            .expect("read generated draft spec");
        let yaml = String::from_utf8(bytes).expect("utf8 yaml");
        let parsed = parse_release_spec_yaml(&yaml).expect("generated yaml should parse");
        assert_eq!(parsed.title, "Bridge Me");
        assert_eq!(parsed.artist, "Artist D");
        assert_eq!(
            parsed.tags,
            vec!["dream pop".to_string(), "late night".to_string()]
        );
    }

    #[tokio::test]
    async fn publisher_create_draft_from_track_rejects_invalid_or_missing_track_id() {
        let (service, _dir) = new_service().await;

        let invalid = service
            .handle_publisher_create_draft_from_track("not-a-track-id")
            .await
            .expect_err("invalid track id must be rejected");
        assert_eq!(invalid.code, "INVALID_ARGUMENT");

        let missing = service
            .handle_publisher_create_draft_from_track(&"a".repeat(64))
            .await
            .expect_err("missing track id must be rejected");
        assert_eq!(missing.code, "INVALID_ARGUMENT");
        assert!(missing.message.contains("not found"));
    }

    #[tokio::test]
    async fn catalog_import_files_collects_per_file_failures_and_keeps_successes() {
        let (service, dir) = new_service().await;
        let good_wav = write_wav_fixture_file(dir.path(), "Good.wav").await;
        let bad_path = dir.path().join("missing.wav").to_string_lossy().to_string();

        let response = service
            .handle_catalog_import_files(vec![good_wav, bad_path.clone()])
            .await
            .expect("catalog import should return partial results");
        assert_eq!(response.imported.len(), 1);
        assert_eq!(response.failed.len(), 1);
        assert_eq!(response.failed[0].path, bad_path);
        assert!(!response.failed[0].code.is_empty());
        assert!(!response.failed[0].message.is_empty());
    }

    #[tokio::test]
    async fn catalog_import_files_rejects_oversized_aggregate_path_payload() {
        let (service, _dir) = new_service().await;
        let oversized = "a".repeat((MAX_CATALOG_IMPORT_TOTAL_PATH_CHARS / 2) + 1024);
        let err = service
            .handle_catalog_import_files(vec![format!("C:/{oversized}"), format!("D:/{oversized}")])
            .await
            .expect_err("oversized import payload must be rejected");
        assert_eq!(err.code, "INVALID_ARGUMENT");
        assert!(err.message.contains("payload exceeds maximum aggregate path length"));
    }

    #[tokio::test]
    async fn catalog_library_root_round_trip_and_remove() {
        let (service, dir) = new_service().await;
        let root_dir = dir.path().join("library-root");
        tokio::fs::create_dir_all(&root_dir)
            .await
            .expect("create library root");

        let added = service
            .handle_catalog_add_library_root(&root_dir.to_string_lossy())
            .await
            .expect("add library root");
        assert_eq!(added.root_id.len(), 64);
        assert!(added.path.ends_with("/library-root"));
        assert!(added.enabled);

        let listed = service
            .handle_catalog_list_library_roots()
            .await
            .expect("list roots");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].root_id, added.root_id);

        let removed = service
            .handle_catalog_remove_library_root(&added.root_id)
            .await
            .expect("remove root");
        assert!(removed);
        let listed_after = service
            .handle_catalog_list_library_roots()
            .await
            .expect("list roots after remove");
        assert!(listed_after.is_empty());
    }

    #[tokio::test]
    async fn catalog_scan_root_creates_ingest_job_updates_progress_and_imports_tracks() {
        let (service, dir) = new_service().await;
        let service = Arc::new(service);
        let root_dir = dir.path().join("scan-root");
        tokio::fs::create_dir_all(&root_dir)
            .await
            .expect("create scan root");
        let _wav1 = write_wav_fixture_file(&root_dir, "Artist X - Track One.wav").await;
        tokio::fs::write(
            root_dir.join("Track Two.wav"),
            pcm16_wav_sine_bytes(48_000, 1_500, 880.0, 0.25),
        )
        .await
        .expect("write second wav fixture");
        tokio::fs::write(root_dir.join("notes.txt"), b"ignore-me")
            .await
            .expect("write non-audio file");

        let root = service
            .handle_catalog_add_library_root(&root_dir.to_string_lossy())
            .await
            .expect("add root");
        let prepared = service
            .handle_catalog_scan_root_prepare(&root.root_id)
            .await
            .expect("prepare scan");
        let job_id = prepared.job.job_id.clone();

        run_catalog_scan_job_inner(Arc::clone(&service), prepared.root, job_id.clone())
            .await
            .expect("run scan job");

        let job = wait_for_ingest_job_terminal(service.as_ref(), &job_id).await;
        assert_eq!(job.status, "COMPLETED");
        assert_eq!(job.total_items, 2);
        assert_eq!(job.processed_items, 2);
        assert_eq!(job.error_count, 0);

        let listed = service
            .handle_catalog_list_tracks(Some(CatalogListTracksInput {
                search: None,
                limit: Some(10),
                offset: Some(0),
            }))
            .await
            .expect("list imported tracks");
        assert_eq!(listed.total, 2);
    }

    #[tokio::test]
    async fn catalog_scan_root_records_failures_without_aborting_successful_imports() {
        let (service, dir) = new_service().await;
        let service = Arc::new(service);
        let root_dir = dir.path().join("scan-root-errors");
        tokio::fs::create_dir_all(&root_dir)
            .await
            .expect("create scan root");
        let _good = write_wav_fixture_file(&root_dir, "Good Track.wav").await;
        tokio::fs::write(root_dir.join("Broken.wav"), b"not-a-real-wav")
            .await
            .expect("write corrupt wav");

        let root = service
            .handle_catalog_add_library_root(&root_dir.to_string_lossy())
            .await
            .expect("add root");
        let prepared = service
            .handle_catalog_scan_root_prepare(&root.root_id)
            .await
            .expect("prepare scan");
        let job_id = prepared.job.job_id.clone();

        run_catalog_scan_job_inner(Arc::clone(&service), prepared.root, job_id.clone())
            .await
            .expect("run scan job");

        let job = wait_for_ingest_job_terminal(service.as_ref(), &job_id).await;
        assert_eq!(job.status, "COMPLETED");
        assert_eq!(job.total_items, 2);
        assert_eq!(job.processed_items, 2);
        assert_eq!(job.error_count, 1);

        let listed = service
            .handle_catalog_list_tracks(Some(CatalogListTracksInput {
                search: None,
                limit: Some(10),
                offset: Some(0),
            }))
            .await
            .expect("list imported tracks");
        assert_eq!(listed.total, 1);
    }

    #[tokio::test]
    async fn command_service_analyze_and_persist_release_track_round_trips_release_model() {
        let (service, dir) = new_service().await;
        let spec_path = write_spec_file(dir.path(), "QC Track", "QC Artist").await;
        let wav_path = write_wav_fixture_file(dir.path(), "release-media.wav").await;

        let plan = service
            .handle_plan_release(PlanReleaseInput {
                media_path: wav_path.clone(),
                spec_path,
                platforms: vec!["mock".to_string()],
                env: AppEnv::Test,
            })
            .await
            .expect("plan");

        let persisted = service
            .handle_analyze_and_persist_release_track(&plan.release_id, &wav_path)
            .await
            .expect("analyze+persist");

        assert_eq!(persisted.release.id(), plan.release_id);
        assert_eq!(persisted.release.title(), "QC Track");
        assert_eq!(persisted.release.artist(), "QC Artist");
        assert_eq!(persisted.release.tracks().len(), 1);
        assert!(persisted.release.tracks()[0]
            .file_path()
            .ends_with("/release-media.wav"));
        assert_eq!(persisted.media_fingerprint.len(), 64);
        assert_eq!(persisted.sample_rate_hz, 48_000);
        assert_eq!(persisted.channels, 1);

        let fetched = service
            .handle_get_release_track_analysis(&plan.release_id)
            .await
            .expect("get persisted analysis")
            .expect("analysis should exist");

        assert_eq!(fetched.release.id(), persisted.release.id());
        assert_eq!(fetched.release.title(), persisted.release.title());
        assert_eq!(fetched.release.artist(), persisted.release.artist());
        assert_eq!(fetched.release.tracks(), persisted.release.tracks());
        assert_eq!(fetched.media_fingerprint, persisted.media_fingerprint);
        assert_eq!(fetched.sample_rate_hz, persisted.sample_rate_hz);
        assert_eq!(fetched.channels, persisted.channels);
    }

    #[tokio::test]
    async fn analyze_and_persist_release_track_rejects_media_fingerprint_mismatch() {
        let (service, dir) = new_service().await;
        let spec_path = write_spec_file(dir.path(), "QC Track", "QC Artist").await;
        let planned_media_path = dir.path().join("planned-media.bin");
        tokio::fs::write(&planned_media_path, b"not-audio-but-valid-bytes")
            .await
            .expect("write planned media");
        let wav_path = write_wav_fixture_file(dir.path(), "different-audio.wav").await;

        let plan = service
            .handle_plan_release(PlanReleaseInput {
                media_path: planned_media_path.to_string_lossy().to_string(),
                spec_path,
                platforms: vec!["mock".to_string()],
                env: AppEnv::Test,
            })
            .await
            .expect("plan");

        let err = service
            .handle_analyze_and_persist_release_track(&plan.release_id, &wav_path)
            .await
            .expect_err("mismatched file should be rejected");
        assert_eq!(err.code, "MEDIA_FINGERPRINT_MISMATCH");
    }

    #[test]
    fn plan_release_input_ipc_payload_rejects_missing_unknown_and_malicious_fields() {
        let valid = serde_json::json!({
            "media_path": "C:/tmp/media.wav",
            "spec_path": "C:/tmp/spec.yaml",
            "platforms": ["mock"],
            "env": "TEST"
        });
        let parsed =
            decode_plan_release_input_from_ipc_value_for_test(valid).expect("valid payload");
        assert_eq!(parsed.platforms, vec!["mock".to_string()]);
        assert_eq!(parsed.env, AppEnv::Test);

        let missing_fields = serde_json::json!({
            "media_path": "C:/tmp/media.wav",
            "platforms": ["mock"],
            "env": "TEST"
        });
        let err = decode_plan_release_input_from_ipc_value_for_test(missing_fields)
            .expect_err("missing spec_path must be rejected");
        assert_eq!(err.code, "INVALID_ARGUMENT");
        assert!(err.message.contains("invalid plan_release payload"));

        let malicious_unknown_fields = serde_json::json!({
            "media_path": "C:/tmp/media.wav",
            "spec_path": "C:/tmp/spec.yaml",
            "platforms": ["mock"],
            "env": "TEST",
            "duration_ms": -1,
            "peak_index": 999999999usize,
            "peak_data": [0.0, -1.0, -6.0],
            "qc_override": {
                "peak_index": 18446744073709551615u64,
                "duration_ms": -123
            }
        });
        let err = decode_plan_release_input_from_ipc_value_for_test(malicious_unknown_fields)
            .expect_err("unknown/malicious fields must be rejected at IPC boundary");
        assert_eq!(err.code, "INVALID_ARGUMENT");
        assert!(
            err.message.contains("unknown field"),
            "unexpected message: {}",
            err.message
        );

        let invalid_env = serde_json::json!({
            "media_path": "C:/tmp/media.wav",
            "spec_path": "C:/tmp/spec.yaml",
            "platforms": ["mock"],
            "env": "ROOTKIT"
        });
        let err = decode_plan_release_input_from_ipc_value_for_test(invalid_env)
            .expect_err("invalid env enum must be rejected");
        assert_eq!(err.code, "INVALID_ARGUMENT");
    }

    #[tokio::test]
    async fn qc_commands_reject_invalid_release_id_and_path_inputs() {
        let (service, dir) = new_service().await;
        let invalid_release_id = "short".to_string();

        let err = service
            .handle_analyze_and_persist_release_track(&invalid_release_id, "x.wav")
            .await
            .expect_err("invalid release_id must be rejected");
        assert_eq!(err.code, "INVALID_ARGUMENT");

        let err = service
            .handle_get_release_track_analysis(&invalid_release_id)
            .await
            .expect_err("invalid release_id must be rejected");
        assert_eq!(err.code, "INVALID_ARGUMENT");

        let err = service
            .handle_analyze_audio_file(&dir.path().to_string_lossy())
            .await
            .expect_err("directory path must be rejected for audio analysis");
        assert_eq!(err.code, "INVALID_ARGUMENT");

        let err = service
            .handle_analyze_audio_file("file:///tmp/audio.wav")
            .await
            .expect_err("file:// path must be rejected");
        assert_eq!(err.code, "INVALID_ARGUMENT");

        let missing_file = dir.path().join("missing.wav");
        let err = service
            .handle_analyze_audio_file(&missing_file.to_string_lossy())
            .await
            .expect_err("missing file path must be rejected");
        assert_eq!(err.code, "FILE_READ_FAILED");
    }

    #[tokio::test]
    async fn qc_commands_reject_overlong_audio_path_inputs_before_fs_access() {
        let (service, _dir) = new_service().await;
        let overlong_path = format!("C:/{}", "a".repeat(MAX_IPC_PATH_CHARS + 64));

        let err = service
            .handle_analyze_audio_file(&overlong_path)
            .await
            .expect_err("overlong path should be rejected at IPC boundary");
        assert_eq!(err.code, "INVALID_ARGUMENT");
        assert!(err.message.contains("maximum length"));
    }

    #[tokio::test]
    async fn catalog_list_tracks_rejects_overlong_search_payload() {
        let (service, _dir) = new_service().await;
        let err = service
            .handle_catalog_list_tracks(Some(CatalogListTracksInput {
                search: Some("x".repeat(MAX_CATALOG_TRACK_SEARCH_CHARS + 1)),
                limit: Some(20),
                offset: Some(0),
            }))
            .await
            .expect_err("overlong search payload must be rejected");
        assert_eq!(err.code, "INVALID_ARGUMENT");
        assert!(err.message.contains("maximum length"));
    }

    #[test]
    fn catalog_list_tracks_input_ipc_payload_rejects_unknown_malicious_fields() {
        let malicious = serde_json::json!({
            "search": "sunset",
            "limit": 25,
            "offset": 0,
            "peak_data": [0.0, -3.0],
            "loudness_lufs": -14.0
        });

        let err = decode_catalog_list_tracks_input_from_ipc_value_for_test(malicious)
            .expect_err("unknown fields should be rejected at IPC boundary");
        assert_eq!(err.code, "INVALID_ARGUMENT");
        assert!(
            err.message.contains("unknown field"),
            "unexpected message: {}",
            err.message
        );
    }

    #[test]
    fn catalog_update_track_metadata_input_ipc_payload_rejects_unknown_fields() {
        let malicious = serde_json::json!({
            "track_id": "a".repeat(64),
            "visibility_policy": "LOCAL",
            "license_policy": "ALL_RIGHTS_RESERVED",
            "downloadable": false,
            "tags": ["ambient"],
            "peak_data": [0.0, -3.0],
            "duration_ms": -1
        });

        let err = decode_catalog_update_track_metadata_input_from_ipc_value_for_test(malicious)
            .expect_err("unknown fields should be rejected at IPC boundary");
        assert_eq!(err.code, "INVALID_ARGUMENT");
        assert!(
            err.message.contains("unknown field"),
            "unexpected message: {}",
            err.message
        );
    }

    #[tokio::test]
    async fn release_track_analysis_negative_duration_tamper_is_blocked_by_sqlite_check() {
        let (service, dir) = new_service().await;
        let spec_path = write_spec_file(dir.path(), "Tamper Duration", "QC Artist").await;
        let wav_path = write_wav_fixture_file(dir.path(), "tamper-duration.wav").await;

        let plan = service
            .handle_plan_release(PlanReleaseInput {
                media_path: wav_path.clone(),
                spec_path,
                platforms: vec!["mock".to_string()],
                env: AppEnv::Test,
            })
            .await
            .expect("plan");

        service
            .handle_analyze_and_persist_release_track(&plan.release_id, &wav_path)
            .await
            .expect("persist valid analysis");

        let error =
            sqlx::query("UPDATE release_track_analysis SET duration_ms = -1 WHERE release_id = ?")
                .bind(plan.release_id.clone())
                .execute(service.orchestrator.db().pool())
                .await
                .expect_err("negative duration tamper should be blocked by sqlite CHECK");
        let message = error.to_string();
        assert!(
            message.contains("CHECK constraint failed") && message.contains("duration_ms > 0"),
            "unexpected sqlite error: {message}"
        );
    }

    #[tokio::test]
    async fn get_release_track_analysis_rejects_tampered_extreme_duration_row() {
        let (service, dir) = new_service().await;
        let spec_path = write_spec_file(dir.path(), "Tamper Huge Duration", "QC Artist").await;
        let wav_path = write_wav_fixture_file(dir.path(), "tamper-huge-duration.wav").await;

        let plan = service
            .handle_plan_release(PlanReleaseInput {
                media_path: wav_path.clone(),
                spec_path,
                platforms: vec!["mock".to_string()],
                env: AppEnv::Test,
            })
            .await
            .expect("plan");

        service
            .handle_analyze_and_persist_release_track(&plan.release_id, &wav_path)
            .await
            .expect("persist valid analysis");

        sqlx::query(
            "UPDATE release_track_analysis SET duration_ms = 9223372036854775807 WHERE release_id = ?",
        )
        .bind(plan.release_id.clone())
        .execute(service.orchestrator.db().pool())
        .await
        .expect("tamper duration to extreme out-of-range integer");

        let err = service
            .handle_get_release_track_analysis(&plan.release_id)
            .await
            .expect_err("out-of-range duration row must be rejected");
        assert_eq!(err.code, "DB_ROW_DECODE");
        assert!(err.message.contains("duration_ms"));
    }

    #[tokio::test]
    async fn get_release_track_analysis_rejects_tampered_peak_data_json() {
        let (service, dir) = new_service().await;
        let spec_path = write_spec_file(dir.path(), "Tamper Peaks", "QC Artist").await;
        let wav_path = write_wav_fixture_file(dir.path(), "tamper-peaks.wav").await;

        let plan = service
            .handle_plan_release(PlanReleaseInput {
                media_path: wav_path.clone(),
                spec_path,
                platforms: vec!["mock".to_string()],
                env: AppEnv::Test,
            })
            .await
            .expect("plan");

        service
            .handle_analyze_and_persist_release_track(&plan.release_id, &wav_path)
            .await
            .expect("persist valid analysis");

        sqlx::query("UPDATE release_track_analysis SET peak_data_json = ? WHERE release_id = ?")
            .bind("[0.0, 1.0, -3.0]")
            .bind(plan.release_id.clone())
            .execute(service.orchestrator.db().pool())
            .await
            .expect("tamper peak_data_json");

        let err = service
            .handle_get_release_track_analysis(&plan.release_id)
            .await
            .expect_err("invalid peak_data values must be rejected");
        assert_eq!(err.code, "DB_DESERIALIZATION");
        assert!(err.message.contains("peak_data"));
    }

    #[tokio::test]
    async fn get_release_track_analysis_rejects_tampered_excessive_peak_data_json() {
        let (service, dir) = new_service().await;
        let spec_path = write_spec_file(dir.path(), "Tamper Huge Peaks", "QC Artist").await;
        let wav_path = write_wav_fixture_file(dir.path(), "tamper-huge-peaks.wav").await;

        let plan = service
            .handle_plan_release(PlanReleaseInput {
                media_path: wav_path.clone(),
                spec_path,
                platforms: vec!["mock".to_string()],
                env: AppEnv::Test,
            })
            .await
            .expect("plan");

        service
            .handle_analyze_and_persist_release_track(&plan.release_id, &wav_path)
            .await
            .expect("persist valid analysis");

        let oversized_peaks = serde_json::to_string(&vec![-6.0f32; MAX_IPC_PEAK_BINS + 1])
            .expect("serialize oversized peak array");
        sqlx::query("UPDATE release_track_analysis SET peak_data_json = ? WHERE release_id = ?")
            .bind(oversized_peaks)
            .bind(plan.release_id.clone())
            .execute(service.orchestrator.db().pool())
            .await
            .expect("tamper peak_data_json to oversized array");

        let err = service
            .handle_get_release_track_analysis(&plan.release_id)
            .await
            .expect_err("oversized peak array must be rejected before IPC serialization");
        assert_eq!(err.code, "AUDIO_MODEL_INVALID");
        assert!(err.message.contains("IPC safety limit"));
    }

    #[tokio::test]
    async fn release_track_analysis_zero_sample_rate_and_channels_tamper_is_blocked_by_sqlite_check(
    ) {
        let (service, dir) = new_service().await;
        let spec_path = write_spec_file(dir.path(), "Tamper Rates", "QC Artist").await;
        let wav_path = write_wav_fixture_file(dir.path(), "tamper-rates.wav").await;

        let plan = service
            .handle_plan_release(PlanReleaseInput {
                media_path: wav_path.clone(),
                spec_path,
                platforms: vec!["mock".to_string()],
                env: AppEnv::Test,
            })
            .await
            .expect("plan");

        service
            .handle_analyze_and_persist_release_track(&plan.release_id, &wav_path)
            .await
            .expect("persist valid analysis");

        let error = sqlx::query(
            "UPDATE release_track_analysis SET sample_rate_hz = 0, channels = 0 WHERE release_id = ?",
        )
        .bind(plan.release_id.clone())
        .execute(service.orchestrator.db().pool())
        .await
        .expect_err("zero sample rate/channels tamper should be blocked by sqlite CHECK");
        let message = error.to_string();
        assert!(
            message.contains("CHECK constraint failed")
                && (message.contains("sample_rate_hz > 0") || message.contains("channels > 0")),
            "unexpected sqlite error: {message}"
        );
    }

    #[tokio::test]
    async fn build_release_track_analysis_response_rejects_zero_sample_rate_and_channels() {
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

        let err = service
            .build_release_track_analysis_response(ReleaseTrackAnalysisRecord {
                release_id: plan.release_id,
                file_path: "C:/tmp/fake.wav".to_string(),
                media_fingerprint: "a".repeat(64),
                duration_ms: 1_000,
                peak_data: vec![0.0, -6.0],
                loudness_lufs: -14.0,
                sample_rate_hz: 0,
                channels: 0,
                created_at: "2026-02-26T00:00:00Z".to_string(),
                updated_at: "2026-02-26T00:00:00Z".to_string(),
            })
            .await
            .expect_err("command-layer IPC validator should reject zero sample rate/channels");
        assert_eq!(err.code, "AUDIO_MODEL_INVALID");
        assert!(
            err.message.contains("sample_rate_hz") || err.message.contains("channels"),
            "unexpected message: {}",
            err.message
        );
    }

    #[test]
    fn build_catalog_track_detail_response_rejects_excessive_peak_data() {
        let err = build_catalog_track_detail_response_with_tags(
            DbCatalogTrackRecord {
                track_id: "b".repeat(64),
                media_asset_id: "c".repeat(64),
                media_fingerprint: "d".repeat(64),
                file_path: "C:/tmp/catalog.wav".to_string(),
                title: "Catalog Track".to_string(),
                artist_id: "e".repeat(64),
                artist_name: "Artist".to_string(),
                album_id: None,
                album_title: None,
                duration_ms: 1_000,
                peak_data: vec![-6.0; MAX_IPC_PEAK_BINS + 1],
                loudness_lufs: -14.0,
                true_peak_dbfs: Some(-1.0),
                sample_rate_hz: 48_000,
                channels: 1,
                visibility_policy: "LOCAL".to_string(),
                license_policy: "ALL_RIGHTS_RESERVED".to_string(),
                downloadable: false,
                created_at: "2026-02-26T00:00:00Z".to_string(),
                updated_at: "2026-02-26T00:00:00Z".to_string(),
            },
            Vec::new(),
        )
        .expect_err("oversized catalog peak array must be rejected");

        assert_eq!(err.code, "AUDIO_MODEL_INVALID");
        assert!(err.message.contains("IPC safety limit"));
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
            .handle_execute_release(&plan.release_id)
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
            .handle_execute_release(&plan.release_id)
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
            .handle_execute_release(&plan.release_id)
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
            .handle_execute_release(&plan.release_id)
            .await
            .expect_err("corrupt descriptor should fail");
        assert_eq!(err.code, "PLANNED_RELEASE_DESCRIPTOR_DECODE_FAILED");
    }

    #[tokio::test]
    async fn rejects_odd_prefix_paths() {
        let (service, _dir) = new_service().await;
        let err = service
            .handle_load_spec("\\\\?\\C:\\temp\\x.yaml")
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

    #[test]
    fn validate_plan_release_platforms_accepts_normalized_unique_labels() {
        let normalized = validate_plan_release_platforms(&[
            " Mock ".to_string(),
            "spotify-live".to_string(),
            "you_tube.v2".to_string(),
        ])
        .expect("valid platform labels should pass");

        assert_eq!(
            normalized,
            vec![
                "mock".to_string(),
                "spotify-live".to_string(),
                "you_tube.v2".to_string()
            ]
        );
    }

    #[test]
    fn validate_plan_release_platforms_rejects_invalid_cases() {
        let cases = vec![
            vec![],
            vec!["   ".to_string()],
            vec!["mock".to_string(), "MOCK".to_string()],
            vec!["mock/platform".to_string()],
            vec!["a".repeat(MAX_PLATFORM_LABEL_CHARS + 1)],
            (0..(MAX_PLAN_RELEASE_PLATFORMS + 1))
                .map(|idx| format!("p-{idx}"))
                .collect::<Vec<_>>(),
        ];

        for case in cases {
            let err = validate_plan_release_platforms(&case)
                .expect_err("invalid platform labels must be rejected");
            assert_eq!(err.code, "INVALID_ARGUMENT");
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
                .handle_get_report(&input)
                .await
                .expect_err("invalid release_id must be rejected");
            assert_eq!(err.code, "INVALID_ARGUMENT");
        }
    }

    #[tokio::test]
    async fn get_report_accepts_uppercase_hex_release_id_lookup() {
        let (service, _dir) = new_service().await;
        let result = service
            .handle_get_report(&"A".repeat(64))
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
            .handle_get_report(&release_id)
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
            .handle_get_report("short")
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
    fn app_error_new_sanitizes_sensitive_or_oversized_messages() {
        let panic_like = AppError::new(
            "TEST",
            "thread 'main' panicked at src/main.rs:10:3\nstack backtrace: ...",
        );
        assert_eq!(panic_like.message, "internal error");

        let long = AppError::new("TEST", "x".repeat(MAX_IPC_ERROR_MESSAGE_CHARS + 64));
        assert!(long.message.ends_with("..."));
        assert!(long.message.chars().count() <= MAX_IPC_ERROR_MESSAGE_CHARS + 3);
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
