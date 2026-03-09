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
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::File;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, OnceLock, RwLock,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use tokio::sync::{OnceCell, Semaphore};
#[cfg(target_os = "windows")]
use windows::Win32::Media::Audio::{
    eMultimedia, eRender, IAudioClient, IAudioRenderClient, IMMDeviceEnumerator,
    MMDeviceEnumerator, AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, WAVEFORMATEX,
    WAVE_FORMAT_PCM,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
};

mod backend_audio_service;
mod backend_video_render_service;
mod catalog;
mod playback;
mod qc;
mod release;
mod video_render;

#[cfg(test)]
pub(crate) use backend_audio_service::{
    append_interleaved_to_stereo_f32, resample_stereo_interleaved_frames,
    validate_audio_format_boundary, write_pcm_stereo_frame, AudioFormatBoundary,
    PlaybackControlPlane,
};
pub use catalog::*;
pub use playback::*;
pub use qc::*;
pub use release::*;
pub use video_render::*;

#[cfg(test)]
use qc::{qc_get_active_preview_media_with_dependencies, qc_start_batch_export_with_dependencies};

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum AudioLockState {
    Released = 0,
    SharedMode = 1,
    ExclusiveMode = 2,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDeviceContext {
    pub current_lock_state: AudioLockState,
    pub user_prefers_exclusive: bool,
    pub is_app_in_focus: bool,
    pub is_playing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioHardwareState {
    pub sample_rate_hz: u32,
    pub bit_depth: u16,
    pub buffer_size_frames: u32,
    pub is_exclusive_lock: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlaybackOutputMode {
    Released,
    Shared,
    Exclusive,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybackOutputStatus {
    pub requested_mode: PlaybackOutputMode,
    pub active_mode: PlaybackOutputMode,
    pub sample_rate_hz: Option<u32>,
    pub bit_depth: Option<u16>,
    pub bit_perfect_eligible: bool,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybackContextState {
    pub volume_scalar: f32,
    pub is_bit_perfect_bypassed: bool,
    pub output_status: PlaybackOutputStatus,
    pub active_queue_index: u32,
    pub is_queue_ui_expanded: bool,
    pub queued_track_change_requests: usize,
    pub is_playing: bool,
    pub position_seconds: f64,
    pub track_duration_seconds: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybackQueueState {
    pub total_tracks: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QcFeatureFlagsResponse {
    pub qc_codec_preview_v1: bool,
    pub qc_realtime_meters_v1: bool,
    pub qc_batch_export_v1: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum QcPreviewVariant {
    Bypass,
    CodecA,
    CodecB,
    BlindX,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum QcCodecFamily {
    Opus,
    Vorbis,
    Aac,
    Mp3,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QcCodecProfileResponse {
    pub profile_id: String,
    pub label: String,
    pub codec_family: QcCodecFamily,
    pub target_platform: String,
    pub target_bitrate_kbps: u32,
    pub expected_latency_ms: u32,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QcPreparePreviewSessionInput {
    pub source_track_id: String,
    pub profile_a_id: String,
    pub profile_b_id: String,
    pub blind_x_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QcPreviewSessionStateResponse {
    pub source_track_id: String,
    pub active_variant: QcPreviewVariant,
    pub profile_a_id: String,
    pub profile_b_id: String,
    pub blind_x_enabled: bool,
    pub blind_x_revealed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QcPreviewActiveMediaResponse {
    pub variant: QcPreviewVariant,
    pub media_path: String,
    pub blind_x_resolved_variant: Option<QcPreviewVariant>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QcBatchExportStartInput {
    pub source_track_id: String,
    pub profile_ids: Vec<String>,
    pub output_dir: String,
    pub target_integrated_lufs: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QcBatchExportStartResponse {
    pub job_id: String,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QcBatchExportProfileStatusResponse {
    pub profile_id: String,
    pub codec_family: QcCodecFamily,
    pub target_platform: String,
    pub target_bitrate_kbps: u32,
    pub status: String,
    pub progress_percent: u8,
    pub output_path: Option<String>,
    pub output_bytes: Option<u64>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QcBatchExportJobStatusResponse {
    pub job_id: String,
    pub source_track_id: String,
    pub output_dir: String,
    pub requested_profile_ids: Vec<String>,
    pub requested_target_integrated_lufs: Option<f32>,
    pub status: String,
    pub progress_percent: u8,
    pub total_profiles: usize,
    pub completed_profiles: usize,
    pub failed_profiles: usize,
    pub created_at_unix_ms: u64,
    pub updated_at_unix_ms: u64,
    pub summary_path: Option<String>,
    pub profiles: Vec<QcBatchExportProfileStatusResponse>,
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
const PLAYBACK_COMMAND_QUEUE_CAPACITY: usize = 1_024;
const PLAYBACK_COMMAND_THREAD_IDLE_MS: u64 = 2;
const MAX_PLAYBACK_QUEUE_TRACKS: usize = 10_000;
const UNITY_GAIN_LEVEL: f32 = 1.0;
const PUBLISHER_CATALOG_DRAFTS_DIR: &str = "publisher_catalog_drafts";
const PUBLISHER_CATALOG_DRAFT_SPEC_FILE_NAME: &str = "release_spec.yaml";
const ENV_QC_CODEC_PREVIEW_V1: &str = "RELEASE_PUBLISHER_QC_CODEC_PREVIEW_V1";
const ENV_QC_REALTIME_METERS_V1: &str = "RELEASE_PUBLISHER_QC_REALTIME_METERS_V1";
const ENV_QC_BATCH_EXPORT_V1: &str = "RELEASE_PUBLISHER_QC_BATCH_EXPORT_V1";
const ENV_MAX_CONCURRENT_INGEST_SCANS: &str = "RELEASE_PUBLISHER_MAX_CONCURRENT_INGEST_SCANS";
const DEFAULT_QC_CODEC_PREVIEW_V1: bool = true;
const DEFAULT_QC_REALTIME_METERS_V1: bool = false;
const DEFAULT_QC_BATCH_EXPORT_V1: bool = true;
const DEFAULT_MAX_CONCURRENT_INGEST_SCANS: usize = 2;
const MAX_CONCURRENT_INGEST_SCANS_HARD_LIMIT: usize = 8;
const QC_PREVIEW_SESSION_ARTIFACTS_DIR: &str = "qc_preview_sessions";
const INSTALL_FINGERPRINT_SCHEMA_VERSION: u32 = 1;
const INSTALL_FINGERPRINT_FILE_NAME: &str = "install_fingerprint.json";
const ALLOWED_CATALOG_VISIBILITY_POLICIES: &[&str] = &["LOCAL", "PRIVATE", "SHARE_EXPORT_READY"];
const ALLOWED_CATALOG_LICENSE_POLICIES: &[&str] = &[
    "ALL_RIGHTS_RESERVED",
    "CC_BY",
    "CC_BY_SA",
    "CC_BY_NC",
    "CC0",
    "CUSTOM",
];

fn parse_env_flag_bool(raw: &str) -> Option<bool> {
    let normalized = raw.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

fn read_env_flag_bool(key: &str, default: bool) -> bool {
    std::env::var(key)
        .ok()
        .and_then(|value| parse_env_flag_bool(&value))
        .unwrap_or(default)
}

fn read_env_usize(key: &str, default: usize, min: usize, max: usize) -> usize {
    let default = default.clamp(min, max);
    std::env::var(key)
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .map(|value| value.clamp(min, max))
        .unwrap_or(default)
}

fn max_concurrent_ingest_scans_from_env() -> usize {
    read_env_usize(
        ENV_MAX_CONCURRENT_INGEST_SCANS,
        DEFAULT_MAX_CONCURRENT_INGEST_SCANS,
        1,
        MAX_CONCURRENT_INGEST_SCANS_HARD_LIMIT,
    )
}

fn qc_feature_flags_from_env() -> QcFeatureFlagsResponse {
    QcFeatureFlagsResponse {
        qc_codec_preview_v1: read_env_flag_bool(
            ENV_QC_CODEC_PREVIEW_V1,
            DEFAULT_QC_CODEC_PREVIEW_V1,
        ),
        qc_realtime_meters_v1: read_env_flag_bool(
            ENV_QC_REALTIME_METERS_V1,
            DEFAULT_QC_REALTIME_METERS_V1,
        ),
        qc_batch_export_v1: read_env_flag_bool(ENV_QC_BATCH_EXPORT_V1, DEFAULT_QC_BATCH_EXPORT_V1),
    }
}

fn qc_codec_profile_registry(flags: &QcFeatureFlagsResponse) -> Vec<QcCodecProfileResponse> {
    let available = flags.qc_codec_preview_v1;
    vec![
        QcCodecProfileResponse {
            profile_id: "spotify_vorbis_320".to_string(),
            label: "Spotify Vorbis 320 kbps".to_string(),
            codec_family: QcCodecFamily::Vorbis,
            target_platform: "Spotify".to_string(),
            target_bitrate_kbps: 320,
            expected_latency_ms: 38,
            available,
        },
        QcCodecProfileResponse {
            profile_id: "apple_music_aac_256".to_string(),
            label: "Apple Music AAC 256 kbps".to_string(),
            codec_family: QcCodecFamily::Aac,
            target_platform: "Apple Music".to_string(),
            target_bitrate_kbps: 256,
            expected_latency_ms: 34,
            available,
        },
        QcCodecProfileResponse {
            profile_id: "youtube_opus_160".to_string(),
            label: "YouTube Opus 160 kbps".to_string(),
            codec_family: QcCodecFamily::Opus,
            target_platform: "YouTube".to_string(),
            target_bitrate_kbps: 160,
            expected_latency_ms: 45,
            available,
        },
        QcCodecProfileResponse {
            profile_id: "legacy_mp3_320".to_string(),
            label: "MP3 CBR 320 kbps".to_string(),
            codec_family: QcCodecFamily::Mp3,
            target_platform: "Legacy MP3".to_string(),
            target_bitrate_kbps: 320,
            expected_latency_ms: 32,
            available,
        },
    ]
}

fn normalize_qc_profile_id(raw: &str, label: &str) -> Result<String, AppError> {
    let normalized = raw.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return Err(AppError::invalid_argument(format!(
            "{label} cannot be empty"
        )));
    }
    if normalized
        .chars()
        .any(|ch| !ch.is_ascii_alphanumeric() && ch != '_' && ch != '-')
    {
        return Err(AppError::invalid_argument(format!(
            "{label} must contain only ASCII letters, digits, '_' or '-'"
        )));
    }
    Ok(normalized)
}

fn ensure_qc_profile_ids_known(
    profile_ids: &[String],
    known_profiles: &[QcCodecProfileResponse],
) -> Result<(), AppError> {
    for profile_id in profile_ids {
        let known = known_profiles
            .iter()
            .any(|profile| profile.profile_id == *profile_id);
        if !known {
            return Err(AppError::invalid_argument(format!(
                "unknown qc profile_id: {profile_id}"
            )));
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct QcBatchExportProfileSummary {
    profile_id: String,
    codec_family: QcCodecFamily,
    output_path: Option<String>,
    status: String,
    message: String,
    copied_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct QcBatchExportSummary {
    job_id: String,
    source_track_id: String,
    source_file_path: String,
    output_dir: String,
    requested_profile_ids: Vec<String>,
    requested_target_integrated_lufs: Option<f32>,
    completed_profiles: usize,
    failed_profiles: usize,
    profile_results: Vec<QcBatchExportProfileSummary>,
}

#[derive(Debug)]
struct QcBatchExportJobStore {
    jobs: RwLock<HashMap<String, QcBatchExportJobStatusResponse>>,
}

impl QcBatchExportJobStore {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            jobs: RwLock::new(HashMap::new()),
        })
    }

    fn insert_job(&self, job: QcBatchExportJobStatusResponse) {
        if let Ok(mut guard) = self.jobs.write() {
            guard.insert(job.job_id.clone(), job);
        } else {
            tracing::warn!(
                target: "desktop.qc",
                "failed to lock QC batch export store for insert"
            );
        }
    }

    fn get_job(&self, job_id: &str) -> Result<Option<QcBatchExportJobStatusResponse>, AppError> {
        self.jobs
            .read()
            .map(|guard| guard.get(job_id).cloned())
            .map_err(|_| {
                AppError::new(
                    app_error_codes::INVALID_RELEASE_STATE,
                    "failed to read QC batch export job state",
                )
            })
    }

    fn mutate_job(&self, job_id: &str, mutator: impl FnOnce(&mut QcBatchExportJobStatusResponse)) {
        let mut guard = match self.jobs.write() {
            Ok(guard) => guard,
            Err(_) => {
                tracing::warn!(
                    target: "desktop.qc",
                    job_id = %job_id,
                    "failed to lock QC batch export store for update"
                );
                return;
            }
        };
        let Some(job) = guard.get_mut(job_id) else {
            tracing::warn!(
                target: "desktop.qc",
                job_id = %job_id,
                "QC batch export job missing in state store"
            );
            return;
        };
        mutator(job);
        qc_refresh_batch_export_progress(job);
    }
}

fn next_qc_batch_export_job_id(source_track_id: &str) -> String {
    static QC_BATCH_EXPORT_JOB_NONCE: AtomicU64 = AtomicU64::new(0);
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let nonce = QC_BATCH_EXPORT_JOB_NONCE.fetch_add(1, Ordering::Relaxed);
    catalog_id(
        "qc-batch-export-job.v1",
        &format!("{source_track_id}:{now_ms}:{nonce}"),
    )
}

fn current_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn shared_qc_batch_export_job_store() -> Arc<QcBatchExportJobStore> {
    static STORE: OnceLock<Arc<QcBatchExportJobStore>> = OnceLock::new();
    Arc::clone(STORE.get_or_init(QcBatchExportJobStore::new))
}

fn qc_profile_extension(codec_family: &QcCodecFamily) -> &'static str {
    match codec_family {
        QcCodecFamily::Vorbis => "ogg",
        QcCodecFamily::Aac => "m4a",
        QcCodecFamily::Opus => "opus",
        QcCodecFamily::Mp3 => "mp3",
    }
}

fn qc_batch_export_target_path(
    source_path: &Path,
    output_dir: &Path,
    profile: &QcCodecProfileResponse,
) -> PathBuf {
    let stem = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("track");
    let extension = qc_profile_extension(&profile.codec_family);
    output_dir.join(format!("{stem}--{}.{extension}", profile.profile_id))
}

fn qc_batch_export_summary_path(output_dir: &Path, job_id: &str) -> PathBuf {
    output_dir.join(format!("qc_batch_export_{job_id}_summary.json"))
}

fn qc_preview_session_cache_key(session: &QcPreviewSessionStateResponse) -> String {
    let material = format!(
        "{}\n{}\n{}",
        session.source_track_id, session.profile_a_id, session.profile_b_id
    );
    blake3_hex(material.as_bytes())
}

fn qc_preview_session_output_dir(artifacts_root: &Path, session_cache_key: &str) -> PathBuf {
    artifacts_root
        .join(QC_PREVIEW_SESSION_ARTIFACTS_DIR)
        .join(session_cache_key)
}

fn qc_preview_variant_target_path(
    output_dir: &Path,
    variant_label: &str,
    profile: &QcCodecProfileResponse,
) -> PathBuf {
    output_dir.join(format!(
        "{variant_label}.{}",
        qc_profile_extension(&profile.codec_family)
    ))
}

fn qc_preview_blind_assignment(session_cache_key: &str) -> QcPreviewVariant {
    let nibble = session_cache_key
        .bytes()
        .next()
        .and_then(|byte| char::from(byte).to_digit(16))
        .unwrap_or(0);
    if nibble.is_multiple_of(2) {
        QcPreviewVariant::CodecA
    } else {
        QcPreviewVariant::CodecB
    }
}

async fn qc_encode_preview_artifact_if_needed(
    source_file_path: &Path,
    output_path: &Path,
    profile: &QcCodecProfileResponse,
) -> Result<(), AppError> {
    if let Ok(metadata) = tokio::fs::metadata(output_path).await {
        if metadata.is_file() {
            return Ok(());
        }
    }

    match encode_qc_profile_artifact(source_file_path, output_path, profile, None).await {
        Ok(_) => Ok(()),
        Err(error) => Err(AppError::new(
            app_error_codes::IO_ERROR,
            format!(
                "failed to prepare QC preview media for profile {}: {error}",
                profile.profile_id
            ),
        )),
    }
}

async fn qc_preview_media_state_is_reusable(
    media_state: &QcPreviewSessionMediaState,
    session_cache_key: &str,
) -> bool {
    if media_state.session_cache_key != session_cache_key {
        return false;
    }
    for path in [
        &media_state.source_media_path,
        &media_state.codec_a_media_path,
        &media_state.codec_b_media_path,
    ] {
        let Ok(metadata) = tokio::fs::metadata(Path::new(path)).await else {
            return false;
        };
        if !metadata.is_file() {
            return false;
        }
    }
    true
}

async fn qc_ensure_preview_media_state(
    service: &CommandService,
    store: &QcPreviewSessionStore,
    flags: &QcFeatureFlagsResponse,
    session: &QcPreviewSessionStateResponse,
) -> Result<QcPreviewSessionMediaState, AppError> {
    let session_cache_key = qc_preview_session_cache_key(session);
    if let Some(existing) = store.get_media_state()? {
        if qc_preview_media_state_is_reusable(&existing, &session_cache_key).await {
            return Ok(existing);
        }
    }

    let source_track = service
        .handle_catalog_get_track(&session.source_track_id)
        .await?
        .ok_or_else(|| AppError::invalid_argument("catalog source_track_id not found"))?;
    let source_file_path =
        canonicalize_file_path(&source_track.file_path, "catalog source file").await?;

    let profiles = qc_codec_profile_registry(flags);
    let profiles_by_id: HashMap<String, QcCodecProfileResponse> = profiles
        .into_iter()
        .map(|profile| (profile.profile_id.clone(), profile))
        .collect();
    let profile_a = profiles_by_id
        .get(&session.profile_a_id)
        .cloned()
        .ok_or_else(|| AppError::invalid_argument("profile_a_id is not available"))?;
    let profile_b = profiles_by_id
        .get(&session.profile_b_id)
        .cloned()
        .ok_or_else(|| AppError::invalid_argument("profile_b_id is not available"))?;

    let output_dir = qc_preview_session_output_dir(&service.artifacts_root, &session_cache_key);
    tokio::fs::create_dir_all(&output_dir)
        .await
        .map_err(|error| {
            AppError::file_write_failed(format!(
                "failed to create QC preview session output dir: {error}"
            ))
        })?;

    let codec_a_path = qc_preview_variant_target_path(&output_dir, "codec_a", &profile_a);
    let codec_b_path = qc_preview_variant_target_path(&output_dir, "codec_b", &profile_b);
    qc_encode_preview_artifact_if_needed(&source_file_path, &codec_a_path, &profile_a).await?;
    qc_encode_preview_artifact_if_needed(&source_file_path, &codec_b_path, &profile_b).await?;

    let media_state = QcPreviewSessionMediaState {
        session_cache_key: session_cache_key.clone(),
        source_media_path: path_to_string(&source_file_path),
        codec_a_media_path: path_to_string(&codec_a_path),
        codec_b_media_path: path_to_string(&codec_b_path),
        blind_x_assignment: qc_preview_blind_assignment(&session_cache_key),
    };
    store.set_media_state(media_state.clone())?;
    Ok(media_state)
}

fn qc_refresh_batch_export_progress(job: &mut QcBatchExportJobStatusResponse) {
    let now = current_unix_ms();
    let completed = job
        .profiles
        .iter()
        .filter(|profile| profile.status == "completed")
        .count();
    let failed = job
        .profiles
        .iter()
        .filter(|profile| profile.status == "failed")
        .count();
    let running = job
        .profiles
        .iter()
        .filter(|profile| profile.status == "running")
        .count();

    job.completed_profiles = completed;
    job.failed_profiles = failed;
    job.total_profiles = job.profiles.len();
    job.progress_percent = if job.profiles.is_empty() {
        100
    } else {
        (job.profiles
            .iter()
            .map(|profile| u64::from(profile.progress_percent))
            .sum::<u64>()
            / (job.profiles.len() as u64))
            .min(100) as u8
    };
    job.status = if completed == job.total_profiles && failed == 0 {
        "completed".to_string()
    } else if completed + failed == job.total_profiles && failed > 0 && completed > 0 {
        "completed_with_errors".to_string()
    } else if failed == job.total_profiles && job.total_profiles > 0 {
        "failed".to_string()
    } else if running > 0 || completed > 0 || failed > 0 {
        "running".to_string()
    } else {
        "queued".to_string()
    };
    job.updated_at_unix_ms = now;
}

fn qc_find_profile_mut<'a>(
    job: &'a mut QcBatchExportJobStatusResponse,
    profile_id: &str,
) -> Option<&'a mut QcBatchExportProfileStatusResponse> {
    job.profiles
        .iter_mut()
        .find(|profile| profile.profile_id == profile_id)
}

enum QcEncoderExecutionResult {
    Encoded { output_bytes: u64 },
}

fn qc_ffmpeg_codec_args(profile: &QcCodecProfileResponse) -> Vec<String> {
    let bitrate = format!("{}k", profile.target_bitrate_kbps);
    match profile.codec_family {
        QcCodecFamily::Vorbis => vec![
            "-vn".to_string(),
            "-c:a".to_string(),
            "libvorbis".to_string(),
            "-b:a".to_string(),
            bitrate,
        ],
        QcCodecFamily::Aac => vec![
            "-vn".to_string(),
            "-c:a".to_string(),
            "aac".to_string(),
            "-b:a".to_string(),
            bitrate,
            "-movflags".to_string(),
            "+faststart".to_string(),
        ],
        QcCodecFamily::Opus => vec![
            "-vn".to_string(),
            "-c:a".to_string(),
            "libopus".to_string(),
            "-b:a".to_string(),
            bitrate,
        ],
        QcCodecFamily::Mp3 => vec![
            "-vn".to_string(),
            "-c:a".to_string(),
            "libmp3lame".to_string(),
            "-b:a".to_string(),
            bitrate,
        ],
    }
}

async fn encode_qc_profile_artifact(
    source_file_path: &Path,
    output_path: &Path,
    profile: &QcCodecProfileResponse,
    target_integrated_lufs: Option<f32>,
) -> Result<QcEncoderExecutionResult, String> {
    let source_file_path = source_file_path.to_path_buf();
    let output_path = output_path.to_path_buf();
    let ffmpeg_source_file_path = source_file_path.clone();
    let ffmpeg_output_path = output_path.clone();
    let ffmpeg_codec_args = qc_ffmpeg_codec_args(profile);
    let ffmpeg_loudnorm_arg = target_integrated_lufs
        .map(|target_lufs| format!("loudnorm=I={target_lufs:.1}:TP=-1.0:LRA=11"));

    let ffmpeg_output = tokio::task::spawn_blocking(move || {
        let mut command = std::process::Command::new("ffmpeg");
        command
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-nostdin")
            .arg("-y")
            .arg("-i")
            .arg(ffmpeg_source_file_path.as_os_str());

        if let Some(loudnorm_arg) = ffmpeg_loudnorm_arg {
            command.arg("-af").arg(loudnorm_arg);
        }
        for arg in ffmpeg_codec_args {
            command.arg(arg);
        }
        command.arg(ffmpeg_output_path.as_os_str());
        command.output()
    })
    .await
    .map_err(|error| format!("failed to join ffmpeg worker: {error}"))?;

    let output = match ffmpeg_output {
        Ok(output) => output,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Err(format!("ffmpeg executable not found in PATH: {error}"));
        }
        Err(error) => return Err(format!("failed to launch ffmpeg: {error}")),
    };

    if output.status.success() {
        let metadata = tokio::fs::metadata(output_path)
            .await
            .map_err(|error| format!("encoded file missing after ffmpeg success: {error}"))?;
        return Ok(QcEncoderExecutionResult::Encoded {
            output_bytes: metadata.len(),
        });
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let ffmpeg_error = if stderr.is_empty() {
        format!("ffmpeg exited with status {}", output.status)
    } else {
        format!("ffmpeg exited with status {}: {stderr}", output.status)
    };

    Err(ffmpeg_error)
}

async fn run_qc_batch_export_job(
    job_id: String,
    source_track_id: String,
    source_file_path: PathBuf,
    output_dir: PathBuf,
    selected_profiles: Vec<QcCodecProfileResponse>,
    target_integrated_lufs: Option<f32>,
    store: Arc<QcBatchExportJobStore>,
) {
    store.mutate_job(&job_id, |job| {
        job.status = "running".to_string();
    });

    let mut completed_profiles = 0usize;
    let mut failed_profiles = 0usize;
    let mut profile_results = Vec::with_capacity(selected_profiles.len());

    for profile in &selected_profiles {
        let profile_id = profile.profile_id.clone();
        store.mutate_job(&job_id, |job| {
            if let Some(progress) = qc_find_profile_mut(job, &profile_id) {
                progress.status = "running".to_string();
                progress.progress_percent = 10;
                progress.message = Some("Encoding started".to_string());
            }
        });

        let output_path = qc_batch_export_target_path(&source_file_path, &output_dir, profile);
        match encode_qc_profile_artifact(
            &source_file_path,
            &output_path,
            profile,
            target_integrated_lufs,
        )
        .await
        {
            Ok(QcEncoderExecutionResult::Encoded { output_bytes }) => {
                completed_profiles += 1;
                store.mutate_job(&job_id, |job| {
                    if let Some(progress) = qc_find_profile_mut(job, &profile_id) {
                        progress.status = "completed".to_string();
                        progress.progress_percent = 100;
                        progress.output_path = Some(path_to_string(&output_path));
                        progress.output_bytes = Some(output_bytes);
                        progress.message = Some("Encoded successfully".to_string());
                    }
                });
                profile_results.push(QcBatchExportProfileSummary {
                    profile_id: profile.profile_id.clone(),
                    codec_family: profile.codec_family.clone(),
                    output_path: Some(path_to_string(&output_path)),
                    status: "completed".to_string(),
                    message: "encoded successfully".to_string(),
                    copied_bytes: Some(output_bytes),
                });
            }
            Err(error) => {
                failed_profiles += 1;
                store.mutate_job(&job_id, |job| {
                    if let Some(progress) = qc_find_profile_mut(job, &profile_id) {
                        progress.status = "failed".to_string();
                        progress.progress_percent = 100;
                        progress.output_path = None;
                        progress.output_bytes = None;
                        progress.message = Some(error.clone());
                    }
                });
                profile_results.push(QcBatchExportProfileSummary {
                    profile_id: profile.profile_id.clone(),
                    codec_family: profile.codec_family.clone(),
                    output_path: None,
                    status: "failed".to_string(),
                    message: format!("failed to write output artifact: {error}"),
                    copied_bytes: None,
                });
            }
        }
    }

    let summary = QcBatchExportSummary {
        job_id: job_id.clone(),
        source_track_id,
        source_file_path: path_to_string(&source_file_path),
        output_dir: path_to_string(&output_dir),
        requested_profile_ids: selected_profiles
            .iter()
            .map(|profile| profile.profile_id.clone())
            .collect(),
        requested_target_integrated_lufs: target_integrated_lufs,
        completed_profiles,
        failed_profiles,
        profile_results,
    };

    let summary_path = qc_batch_export_summary_path(&output_dir, &job_id);
    match serde_json::to_vec_pretty(&summary) {
        Ok(bytes) => {
            if let Err(error) = tokio::fs::write(&summary_path, bytes).await {
                tracing::warn!(
                    target: "desktop.qc",
                    job_id = %job_id,
                    output_dir = %path_to_string(&output_dir),
                    error = %error,
                    "failed to persist QC batch export summary"
                );
            } else {
                tracing::info!(
                    target: "desktop.qc",
                    job_id = %job_id,
                    output_dir = %path_to_string(&output_dir),
                    completed_profiles,
                    failed_profiles,
                    summary_path = %path_to_string(&summary_path),
                    "QC batch export job completed"
                );
                store.mutate_job(&job_id, |job| {
                    job.summary_path = Some(path_to_string(&summary_path));
                });
            }
        }
        Err(error) => tracing::warn!(
            target: "desktop.qc",
            job_id = %job_id,
            error = %error,
            "failed to serialize QC batch export summary"
        ),
    }
}

#[derive(Debug)]
struct QcPreviewSessionStore {
    state: RwLock<Option<QcPreviewSessionStateResponse>>,
    media_state: RwLock<Option<QcPreviewSessionMediaState>>,
}

#[derive(Debug, Clone)]
struct QcPreviewSessionMediaState {
    session_cache_key: String,
    source_media_path: String,
    codec_a_media_path: String,
    codec_b_media_path: String,
    blind_x_assignment: QcPreviewVariant,
}

impl QcPreviewSessionStore {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            state: RwLock::new(None),
            media_state: RwLock::new(None),
        })
    }

    fn get_state(&self) -> Result<Option<QcPreviewSessionStateResponse>, AppError> {
        self.state.read().map(|guard| guard.clone()).map_err(|_| {
            AppError::new(
                app_error_codes::INVALID_RELEASE_STATE,
                "failed to read QC preview session state",
            )
        })
    }

    fn set_state(
        &self,
        session: QcPreviewSessionStateResponse,
    ) -> Result<QcPreviewSessionStateResponse, AppError> {
        let mut guard = self.state.write().map_err(|_| {
            AppError::new(
                app_error_codes::INVALID_RELEASE_STATE,
                "failed to update QC preview session state",
            )
        })?;
        *guard = Some(session.clone());
        if let Ok(mut media_guard) = self.media_state.write() {
            *media_guard = None;
        }
        Ok(session)
    }

    fn set_active_variant(
        &self,
        variant: QcPreviewVariant,
    ) -> Result<QcPreviewSessionStateResponse, AppError> {
        let mut guard = self.state.write().map_err(|_| {
            AppError::new(
                app_error_codes::INVALID_RELEASE_STATE,
                "failed to update QC preview session state",
            )
        })?;
        let session = guard
            .as_mut()
            .ok_or_else(|| AppError::invalid_argument("QC preview session is not prepared"))?;
        if matches!(variant, QcPreviewVariant::BlindX) && !session.blind_x_enabled {
            return Err(AppError::invalid_argument(
                "blind_x variant is unavailable when blind_x_enabled is false",
            ));
        }
        session.active_variant = variant;
        if !matches!(session.active_variant, QcPreviewVariant::BlindX) {
            session.blind_x_revealed = true;
        }
        Ok(session.clone())
    }

    fn reveal_blind_x(&self) -> Result<QcPreviewSessionStateResponse, AppError> {
        let mut guard = self.state.write().map_err(|_| {
            AppError::new(
                app_error_codes::INVALID_RELEASE_STATE,
                "failed to update QC preview session state",
            )
        })?;
        let session = guard
            .as_mut()
            .ok_or_else(|| AppError::invalid_argument("QC preview session is not prepared"))?;
        if !session.blind_x_enabled {
            return Err(AppError::invalid_argument(
                "blind_x reveal requires blind_x_enabled to be true",
            ));
        }
        session.blind_x_revealed = true;
        Ok(session.clone())
    }

    fn get_media_state(&self) -> Result<Option<QcPreviewSessionMediaState>, AppError> {
        self.media_state
            .read()
            .map(|guard| guard.clone())
            .map_err(|_| {
                AppError::new(
                    app_error_codes::INVALID_RELEASE_STATE,
                    "failed to read QC preview media state",
                )
            })
    }

    fn set_media_state(&self, media_state: QcPreviewSessionMediaState) -> Result<(), AppError> {
        let mut guard = self.media_state.write().map_err(|_| {
            AppError::new(
                app_error_codes::INVALID_RELEASE_STATE,
                "failed to update QC preview media state",
            )
        })?;
        *guard = Some(media_state);
        Ok(())
    }
}

fn shared_qc_preview_store() -> Arc<QcPreviewSessionStore> {
    static STORE: OnceLock<Arc<QcPreviewSessionStore>> = OnceLock::new();
    Arc::clone(STORE.get_or_init(QcPreviewSessionStore::new))
}

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
    pub const ORCHESTRATOR_PUBLISHER_FAILURE: &str = "ORCHESTRATOR_PUBLISHER_FAILURE";
    pub const CAP_EXCEEDED: &str = "CAP_EXCEEDED";
    pub const TEST_GUARDRAIL_VIOLATION: &str = "TEST_GUARDRAIL_VIOLATION";
    pub const INVALID_RELEASE_STATE: &str = "INVALID_RELEASE_STATE";
    pub const EXCLUSIVE_AUDIO_UNAVAILABLE: &str = "EXCLUSIVE_AUDIO_UNAVAILABLE";
    pub const PLAYBACK_INVALID_VOLUME: &str = "PLAYBACK_INVALID_VOLUME";
    pub const PLAYBACK_QUEUE_REQUEST_REJECTED: &str = "PLAYBACK_QUEUE_REQUEST_REJECTED";
    pub const VIDEO_RENDER_INVALID_REQUEST: &str = "VIDEO_RENDER_INVALID_REQUEST";
    pub const VIDEO_RENDER_JOB_CONFLICT: &str = "VIDEO_RENDER_JOB_CONFLICT";
    pub const VIDEO_RENDER_JOB_NOT_FOUND: &str = "VIDEO_RENDER_JOB_NOT_FOUND";
    pub const VIDEO_RENDER_INTERNAL_ERROR: &str = "VIDEO_RENDER_INTERNAL_ERROR";
    pub const FEATURE_DISABLED: &str = "FEATURE_DISABLED";

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
struct PersistedInstallFingerprint {
    schema_version: u32,
    binary_fingerprint: String,
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

    fn feature_disabled(message: impl Into<String>) -> Self {
        Self::new(app_error_codes::FEATURE_DISABLED, message)
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
            OrchestratorError::PublisherFailure {
                platform,
                code,
                retryable,
                message,
            } => Self::new(app_error_codes::ORCHESTRATOR_PUBLISHER_FAILURE, message).with_details(
                serde_json::json!({
                    "platform": platform,
                    "publisher_error_code": code,
                    "retryable": retryable,
                }),
            ),
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
    cancel_requested_ingest_jobs: RwLock<HashSet<String>>,
    ingest_scan_semaphore: Arc<Semaphore>,
    max_concurrent_ingest_scans: usize,
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
        match maybe_reset_catalog_on_install_change(&db, base_dir).await {
            Ok(true) => {
                tracing::info!(
                    target: "desktop.catalog",
                    "catalog library reset because install fingerprint changed"
                );
            }
            Ok(false) => {}
            Err(error) => {
                tracing::warn!(
                    target: "desktop.catalog",
                    error_code = %error.code,
                    error = %error.message,
                    "failed to evaluate install fingerprint for catalog reset"
                );
            }
        }
        let orchestrator = Orchestrator::with_publishers(
            db.clone(),
            vec![Arc::new(MockPublisher) as Arc<dyn release_publisher_core::pipeline::Publisher>],
        )
        .map_err(AppError::from)?;
        let max_concurrent_ingest_scans = max_concurrent_ingest_scans_from_env();

        Ok(Self {
            db,
            orchestrator: Arc::new(orchestrator),
            artifacts_root,
            cancel_requested_ingest_jobs: RwLock::new(HashSet::new()),
            ingest_scan_semaphore: Arc::new(Semaphore::new(max_concurrent_ingest_scans)),
            max_concurrent_ingest_scans,
        })
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

    async fn handle_catalog_reset_library_data(&self) -> Result<bool, AppError> {
        self.db.reset_catalog_library_data().await?;
        Ok(true)
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

    async fn handle_catalog_cancel_ingest_job(&self, job_id: &str) -> Result<bool, AppError> {
        let job_id = validate_catalog_hex_id(job_id, "ingest job_id")?;
        let Some(job) = self.db.get_ingest_job(&job_id).await? else {
            return Ok(false);
        };
        if matches!(
            job.status,
            DbIngestJobStatus::Completed | DbIngestJobStatus::Failed | DbIngestJobStatus::Canceled
        ) {
            return Ok(false);
        }

        self.mark_ingest_job_cancel_requested(&job_id);
        self.db
            .update_ingest_job(&UpdateIngestJob {
                job_id: job_id.clone(),
                status: DbIngestJobStatus::Canceled,
                total_items: job.total_items,
                processed_items: job.processed_items,
                error_count: job.error_count,
            })
            .await?;
        let _ = self
            .db
            .append_ingest_event(&NewIngestEvent {
                job_id: job_id.clone(),
                level: "INFO".to_string(),
                message: "Ingest job canceled by user request.".to_string(),
                payload_json: Some(serde_json::json!({ "status": "CANCELED" })),
            })
            .await;
        Ok(true)
    }

    fn mark_ingest_job_cancel_requested(&self, job_id: &str) {
        if let Ok(mut guard) = self.cancel_requested_ingest_jobs.write() {
            guard.insert(job_id.to_string());
        }
    }

    fn clear_ingest_job_cancel_requested(&self, job_id: &str) {
        if let Ok(mut guard) = self.cancel_requested_ingest_jobs.write() {
            guard.remove(job_id);
        }
    }

    fn is_ingest_job_cancel_requested(&self, job_id: &str) -> bool {
        self.cancel_requested_ingest_jobs
            .read()
            .map(|guard| guard.contains(job_id))
            .unwrap_or(false)
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
                true_peak_dbfs: analyzed.true_peak_dbfs,
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

fn current_install_fingerprint() -> Option<String> {
    let executable_path = std::env::current_exe().ok()?;
    let metadata = std::fs::metadata(&executable_path).ok()?;
    let modified_unix_ms = metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis();
    let normalized_path = executable_path.to_string_lossy().replace('\\', "/");
    Some(format!(
        "{}:{}:{}:{}",
        env!("CARGO_PKG_VERSION"),
        normalized_path,
        metadata.len(),
        modified_unix_ms
    ))
}

fn install_fingerprint_path(base_dir: &Path) -> PathBuf {
    base_dir.join(INSTALL_FINGERPRINT_FILE_NAME)
}

async fn maybe_reset_catalog_on_install_change(db: &Db, base_dir: &Path) -> Result<bool, AppError> {
    let Some(current_fingerprint) = current_install_fingerprint() else {
        return Ok(false);
    };
    let fingerprint_path = install_fingerprint_path(base_dir);
    let mut should_reset_catalog = true;

    if let Ok(bytes) = tokio::fs::read(&fingerprint_path).await {
        if let Ok(persisted) = serde_json::from_slice::<PersistedInstallFingerprint>(&bytes) {
            if persisted.schema_version == INSTALL_FINGERPRINT_SCHEMA_VERSION
                && persisted.binary_fingerprint == current_fingerprint
            {
                should_reset_catalog = false;
            }
        }
    }

    if should_reset_catalog {
        db.reset_catalog_library_data().await?;
    }

    let fingerprint_record = PersistedInstallFingerprint {
        schema_version: INSTALL_FINGERPRINT_SCHEMA_VERSION,
        binary_fingerprint: current_fingerprint,
    };
    let encoded = serde_json::to_vec_pretty(&fingerprint_record).map_err(|error| {
        AppError::new(
            app_error_codes::SERIALIZATION_ERROR,
            format!("failed to encode install fingerprint state: {error}"),
        )
    })?;
    tokio::fs::write(fingerprint_path, encoded)
        .await
        .map_err(|error| {
            AppError::file_write_failed(format!(
                "failed to write install fingerprint state: {error}"
            ))
        })?;

    Ok(should_reset_catalog)
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
    true_peak_dbfs: Option<f32>,
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
        true_peak_dbfs: if analysis.true_peak_dbfs.is_finite() {
            Some(analysis.true_peak_dbfs)
        } else {
            None
        },
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

async fn append_ingest_info_event(
    service: &CommandService,
    job_id: &str,
    message: &str,
    payload_json: Option<Value>,
) {
    let _ = service
        .db
        .append_ingest_event(&NewIngestEvent {
            job_id: job_id.to_string(),
            level: "INFO".to_string(),
            message: message.to_string(),
            payload_json,
        })
        .await;
}

async fn run_catalog_scan_job(
    service: Arc<CommandService>,
    root: DbLibraryRootRecord,
    job_id: String,
) {
    append_ingest_info_event(
        service.as_ref(),
        &job_id,
        "Scan job queued and waiting for an ingest worker slot.",
        Some(serde_json::json!({
            "status": "PENDING",
            "max_parallel_scans": service.max_concurrent_ingest_scans
        })),
    )
    .await;

    let scan_permit = match Arc::clone(&service.ingest_scan_semaphore)
        .acquire_owned()
        .await
    {
        Ok(permit) => permit,
        Err(error) => {
            let _ = service
                .db
                .update_ingest_job(&UpdateIngestJob {
                    job_id: job_id.clone(),
                    status: DbIngestJobStatus::Failed,
                    total_items: 0,
                    processed_items: 0,
                    error_count: 1,
                })
                .await;
            let _ = service
                .db
                .append_ingest_event(&NewIngestEvent {
                    job_id: job_id.clone(),
                    level: "ERROR".to_string(),
                    message: format!("failed to acquire ingest scan worker slot: {error}"),
                    payload_json: Some(serde_json::json!({
                        "status": "FAILED",
                        "code": app_error_codes::IO_ERROR
                    })),
                })
                .await;
            tracing::warn!(
                target: "desktop.catalog",
                job_id = %job_id,
                error = %error,
                "catalog root scan job failed to acquire worker slot"
            );
            service.clear_ingest_job_cancel_requested(&job_id);
            return;
        }
    };

    append_ingest_info_event(
        service.as_ref(),
        &job_id,
        "Scan job acquired worker slot and started.",
        Some(serde_json::json!({
            "status": "RUNNING",
            "max_parallel_scans": service.max_concurrent_ingest_scans
        })),
    )
    .await;

    let run_result = run_catalog_scan_job_inner(Arc::clone(&service), root, job_id.clone()).await;
    drop(scan_permit);

    if let Err(error) = run_result {
        let fallback_counts = match service.db.get_ingest_job(&job_id).await {
            Ok(Some(job)) => (job.total_items, job.processed_items, job.error_count),
            _ => (0, 0, 1),
        };
        let _ = service
            .db
            .update_ingest_job(&UpdateIngestJob {
                job_id: job_id.clone(),
                status: DbIngestJobStatus::Failed,
                total_items: fallback_counts.0,
                processed_items: fallback_counts.1,
                error_count: fallback_counts.2.saturating_add(1),
            })
            .await;
        let _ = service
            .db
            .append_ingest_event(&NewIngestEvent {
                job_id: job_id.clone(),
                level: "ERROR".to_string(),
                message: error.message.clone(),
                payload_json: Some(serde_json::json!({
                    "code": error.code,
                    "status": "FAILED",
                    "total_items": fallback_counts.0,
                    "processed_items": fallback_counts.1,
                    "error_count": fallback_counts.2.saturating_add(1)
                })),
            })
            .await;
        tracing::warn!(
            target: "desktop.catalog",
            job_id = %job_id,
            error_code = %error.code,
            error = %error.message,
            "catalog root scan job failed"
        );
    }
    service.clear_ingest_job_cancel_requested(&job_id);
}

async fn run_catalog_scan_job_inner(
    service: Arc<CommandService>,
    root: DbLibraryRootRecord,
    job_id: String,
) -> Result<(), AppError> {
    if service.is_ingest_job_cancel_requested(&job_id) {
        return Ok(());
    }

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

    if service.is_ingest_job_cancel_requested(&job_id) {
        let _ = service
            .db
            .update_ingest_job(&UpdateIngestJob {
                job_id: job_id.clone(),
                status: DbIngestJobStatus::Canceled,
                total_items: u32::try_from(files.len()).unwrap_or(u32::MAX),
                processed_items: 0,
                error_count: 0,
            })
            .await;
        append_ingest_info_event(
            service.as_ref(),
            &job_id,
            "Scan canceled before file import started.",
            Some(serde_json::json!({
                "status": "CANCELED",
                "total_items": u32::try_from(files.len()).unwrap_or(u32::MAX),
                "processed_items": 0,
                "error_count": 0
            })),
        )
        .await;
        return Ok(());
    }

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
        if service.is_ingest_job_cancel_requested(&job_id) {
            service
                .db
                .update_ingest_job(&UpdateIngestJob {
                    job_id: job_id.clone(),
                    status: DbIngestJobStatus::Canceled,
                    total_items,
                    processed_items,
                    error_count,
                })
                .await?;
            append_ingest_info_event(
                service.as_ref(),
                &job_id,
                "Scan canceled while importing files.",
                Some(serde_json::json!({
                    "status": "CANCELED",
                    "total_items": total_items,
                    "processed_items": processed_items,
                    "error_count": error_count
                })),
            )
            .await;
            return Ok(());
        }

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

    if service.is_ingest_job_cancel_requested(&job_id) {
        service
            .db
            .update_ingest_job(&UpdateIngestJob {
                job_id: job_id.clone(),
                status: DbIngestJobStatus::Canceled,
                total_items,
                processed_items,
                error_count,
            })
            .await?;
        append_ingest_info_event(
            service.as_ref(),
            &job_id,
            "Scan canceled after import loop completion.",
            Some(serde_json::json!({
                "status": "CANCELED",
                "total_items": total_items,
                "processed_items": processed_items,
                "error_count": error_count
            })),
        )
        .await;
        return Ok(());
    }

    let final_status = DbIngestJobStatus::Completed;
    service
        .db
        .update_ingest_job(&UpdateIngestJob {
            job_id: job_id.clone(),
            status: final_status,
            total_items,
            processed_items,
            error_count,
        })
        .await?;
    append_ingest_info_event(
        service.as_ref(),
        &job_id,
        "Scan completed.",
        Some(serde_json::json!({
            "status": "COMPLETED",
            "total_items": total_items,
            "processed_items": processed_items,
            "error_count": error_count
        })),
    )
    .await;

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

#[cfg(test)]
mod tests;
