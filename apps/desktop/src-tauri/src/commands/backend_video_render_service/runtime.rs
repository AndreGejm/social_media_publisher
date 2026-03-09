use super::*;
use serde_json::json;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_REQUEST_ID_CHARS: usize = 128;
const MAX_RENDER_PATH_CHARS: usize = 4096;
const MAX_TEXT_CHARS: usize = 120;
const MIN_TEXT_FONT_SIZE_PX: u32 = 18;
const MAX_TEXT_FONT_SIZE_PX: u32 = 72;
const MAX_RENDER_DIMENSION: u32 = 8192;
const MAX_FFMPEG_ERROR_CHARS: usize = 512;
const MAX_DIAGNOSTIC_MESSAGE_CHARS: usize = 256;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct VideoRenderRequest {
    pub request_version: u32,
    pub request_id: String,
    pub media: VideoRenderMediaInput,
    pub composition: VideoRenderCompositionInput,
    pub output: VideoRenderOutputInput,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct VideoRenderMediaInput {
    pub image_file_name: String,
    pub audio_file_name: String,
    pub image_extension: String,
    pub audio_extension: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct VideoRenderCompositionInput {
    pub width_px: u32,
    pub height_px: u32,
    pub frame_rate: u32,
    pub fit_mode: String,
    pub text: VideoRenderTextInput,
    pub overlay: VideoRenderOverlayInput,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct VideoRenderTextInput {
    pub enabled: bool,
    pub preset: String,
    pub title_text: String,
    pub artist_text: String,
    pub font_size_px: u32,
    pub color_hex: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct VideoRenderOverlayInput {
    pub enabled: bool,
    pub style: String,
    pub opacity: f32,
    pub intensity: f32,
    pub smoothing: f32,
    pub position: String,
    pub theme_color_hex: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct VideoRenderOutputInput {
    pub preset_id: String,
    pub output_file_path: String,
    pub overwrite_policy: String,
    pub container: String,
    pub video_codec: String,
    pub audio_codec: String,
    pub pixel_format: String,
    pub video_bitrate_kbps: u32,
    pub audio_bitrate_kbps: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum VideoRenderValidationIssueCode {
    MissingImage,
    MissingAudio,
    UnsupportedImageType,
    UnsupportedAudioType,
    InvalidOutputPath,
    InvalidRequestVersion,
    InvalidComposition,
    InvalidOutputFormat,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoRenderValidationIssue {
    pub code: VideoRenderValidationIssueCode,
    pub message: String,
    pub field: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoRenderValidateResponse {
    pub ok: bool,
    pub issues: Vec<VideoRenderValidationIssue>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum VideoRenderJobState {
    Validating,
    Starting,
    Running,
    Finalizing,
    Succeeded,
    Failed,
    Canceled,
}

impl VideoRenderJobState {
    fn is_terminal(self) -> bool {
        matches!(self, Self::Succeeded | Self::Failed | Self::Canceled)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoRenderStartResponse {
    pub job_id: String,
    pub state: VideoRenderJobState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoRenderProgressSnapshot {
    pub job_id: String,
    pub state: VideoRenderJobState,
    pub percent: f32,
    pub stage: String,
    pub frame_index: Option<u64>,
    pub total_frames: Option<u64>,
    pub encoded_seconds: Option<f64>,
    pub message: Option<String>,
    pub updated_at_utc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoRenderCancelResponse {
    pub job_id: String,
    pub state: VideoRenderJobState,
    pub canceled: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum VideoRenderFailureCode {
    InvalidRequest,
    UnsupportedMediaType,
    MissingInput,
    InputReadFailed,
    OutputPathInvalid,
    EncoderUnavailable,
    EncoderFailed,
    OverlayComputationFailed,
    TextLayoutFailed,
    ProgressChannelClosed,
    CanceledByUser,
    InternalInvariantViolation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoRenderSuccess {
    pub job_id: String,
    pub output_path: String,
    pub duration_seconds: f64,
    pub file_size_bytes: u64,
    pub completed_at_utc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoRenderFailure {
    pub job_id: Option<String>,
    pub code: VideoRenderFailureCode,
    pub message: String,
    pub retryable: bool,
    pub details: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoRenderResultResponse {
    pub job_id: String,
    pub state: VideoRenderJobState,
    pub success: Option<VideoRenderSuccess>,
    pub failure: Option<VideoRenderFailure>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum VideoRenderFfmpegSource {
    BundledResource,
    Path,
    Missing,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoRenderFfmpegDiagnostics {
    pub available: bool,
    pub source: VideoRenderFfmpegSource,
    pub executable_path: Option<String>,
    pub version: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoRenderOutputDirectoryDiagnostics {
    pub directory_path: String,
    pub exists: bool,
    pub writable: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoRenderDiagnosticsResponse {
    pub ffmpeg: VideoRenderFfmpegDiagnostics,
    pub output_directory: Option<VideoRenderOutputDirectoryDiagnostics>,
    pub render_capable: bool,
    pub blocking_reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoRenderSourcePathCheckResponse {
    pub source_path: String,
    pub exists: bool,
    pub is_file: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoRenderOpenOutputFolderResponse {
    pub opened: bool,
    pub directory_path: String,
}

#[derive(Debug, Clone)]
struct ResolvedFfmpegExecutable {
    path: PathBuf,
    source: VideoRenderFfmpegSource,
}

#[derive(Debug, Clone)]
struct VideoRenderJobRecord {
    job_id: String,
    state: VideoRenderJobState,
    percent: f32,
    stage: String,
    frame_index: Option<u64>,
    total_frames: Option<u64>,
    encoded_seconds: Option<f64>,
    message: Option<String>,
    updated_at_utc: String,
    success: Option<VideoRenderSuccess>,
    failure: Option<VideoRenderFailure>,
}

impl VideoRenderJobRecord {
    fn to_progress_snapshot(&self) -> VideoRenderProgressSnapshot {
        VideoRenderProgressSnapshot {
            job_id: self.job_id.clone(),
            state: self.state,
            percent: self.percent,
            stage: self.stage.clone(),
            frame_index: self.frame_index,
            total_frames: self.total_frames,
            encoded_seconds: self.encoded_seconds,
            message: self.message.clone(),
            updated_at_utc: self.updated_at_utc.clone(),
        }
    }

    fn to_result_response(&self) -> VideoRenderResultResponse {
        VideoRenderResultResponse {
            job_id: self.job_id.clone(),
            state: self.state,
            success: self.success.clone(),
            failure: self.failure.clone(),
        }
    }
}

#[derive(Default)]
struct VideoRenderRuntimeState {
    next_job_nonce: u64,
    active_job_id: Option<String>,
    jobs: HashMap<String, VideoRenderJobRecord>,
    cancel_tokens: HashMap<String, Arc<AtomicBool>>,
}

#[derive(Debug, Clone)]
struct VideoRenderProgressEvent {
    state: VideoRenderJobState,
    percent: f32,
    stage: String,
    frame_index: Option<u64>,
    total_frames: Option<u64>,
    encoded_seconds: Option<f64>,
    message: Option<String>,
}

enum VideoRenderJobOutcome {
    Success(VideoRenderSuccess),
    Failure(VideoRenderFailure),
}

trait VideoRenderJobRunner: Send + Sync {
    fn run_job(
        &self,
        job_id: &str,
        request: &VideoRenderRequest,
        cancel_requested: Arc<AtomicBool>,
        on_progress: &mut dyn FnMut(VideoRenderProgressEvent),
    ) -> VideoRenderJobOutcome;
}

struct FfmpegVideoRenderJobRunner;

#[derive(Debug)]
struct PreparedRenderJob {
    image_path: PathBuf,
    audio_path: PathBuf,
    output_path: PathBuf,
    output_path_string: String,
    duration_seconds: f64,
    total_frames: u64,
    filter_complex: String,
}

pub(crate) struct VideoRenderRuntime {
    state: Arc<Mutex<VideoRenderRuntimeState>>,
    runner: Arc<dyn VideoRenderJobRunner>,
}

impl Default for VideoRenderRuntime {
    fn default() -> Self {
        Self {
            state: Arc::new(Mutex::new(VideoRenderRuntimeState::default())),
            runner: Arc::new(FfmpegVideoRenderJobRunner),
        }
    }
}

impl VideoRenderRuntime {
    #[cfg(test)]
    fn with_runner(runner: Arc<dyn VideoRenderJobRunner>) -> Self {
        Self {
            state: Arc::new(Mutex::new(VideoRenderRuntimeState::default())),
            runner,
        }
    }
}

pub(crate) fn shared_video_render_runtime() -> Arc<VideoRenderRuntime> {
    static RUNTIME: OnceLock<Arc<VideoRenderRuntime>> = OnceLock::new();
    Arc::clone(RUNTIME.get_or_init(|| Arc::new(VideoRenderRuntime::default())))
}

impl VideoRenderRuntime {
    pub(crate) fn validate_request(
        &self,
        request: VideoRenderRequest,
    ) -> Result<VideoRenderValidateResponse, AppError> {
        let issues = collect_validation_issues(&request);
        Ok(VideoRenderValidateResponse {
            ok: issues.is_empty(),
            issues,
        })
    }

    pub(crate) fn start_render(
        &self,
        request: VideoRenderRequest,
    ) -> Result<VideoRenderStartResponse, AppError> {
        let issues = collect_validation_issues(&request);
        if !issues.is_empty() {
            return Err(AppError::new(
                app_error_codes::VIDEO_RENDER_INVALID_REQUEST,
                "render request validation failed",
            )
            .with_details(json!({ "issues": issues })));
        }

        let mut guard = self.state.lock().map_err(|_| {
            AppError::new(
                app_error_codes::VIDEO_RENDER_INTERNAL_ERROR,
                "failed to acquire render runtime lock",
            )
        })?;

        if let Some(active_job_id) = guard.active_job_id.clone() {
            if let Some(active_job) = guard.jobs.get(&active_job_id) {
                if !active_job.state.is_terminal() {
                    return Err(AppError::new(
                        app_error_codes::VIDEO_RENDER_JOB_CONFLICT,
                        "A render job is already running",
                    )
                    .with_details(json!({ "activeJobId": active_job_id })));
                }
            }
            guard.active_job_id = None;
        }

        let job_id = next_job_id(&mut guard);
        let cancel_token = Arc::new(AtomicBool::new(false));
        guard.active_job_id = Some(job_id.clone());
        guard
            .cancel_tokens
            .insert(job_id.clone(), Arc::clone(&cancel_token));
        guard.jobs.insert(
            job_id.clone(),
            VideoRenderJobRecord {
                job_id: job_id.clone(),
                state: VideoRenderJobState::Validating,
                percent: 2.0,
                stage: "render_validate".to_string(),
                frame_index: Some(0),
                total_frames: None,
                encoded_seconds: Some(0.0),
                message: Some("Validating render request.".to_string()),
                updated_at_utc: now_utc_stub(),
                success: None,
                failure: None,
            },
        );
        drop(guard);

        let state = Arc::clone(&self.state);
        let runner = Arc::clone(&self.runner);
        let job_id_for_thread = job_id.clone();
        let request_for_thread = request;

        std::thread::Builder::new()
            .name(format!("rp-video-render-{job_id_for_thread}"))
            .spawn(move || {
                run_render_worker(
                    state,
                    runner,
                    job_id_for_thread,
                    request_for_thread,
                    cancel_token,
                );
            })
            .map_err(|error| {
                if let Ok(mut guard) = self.state.lock() {
                    guard.jobs.remove(&job_id);
                    guard.cancel_tokens.remove(&job_id);
                    if guard.active_job_id.as_deref() == Some(job_id.as_str()) {
                        guard.active_job_id = None;
                    }
                }
                AppError::new(
                    app_error_codes::VIDEO_RENDER_INTERNAL_ERROR,
                    format!("failed to spawn video render worker: {error}"),
                )
            })?;

        Ok(VideoRenderStartResponse {
            job_id,
            state: VideoRenderJobState::Validating,
        })
    }

    pub(crate) fn get_render_status(
        &self,
        job_id: &str,
    ) -> Result<VideoRenderProgressSnapshot, AppError> {
        let normalized_job_id = normalize_job_id(job_id)?;
        let guard = self.state.lock().map_err(|_| {
            AppError::new(
                app_error_codes::VIDEO_RENDER_INTERNAL_ERROR,
                "failed to acquire render runtime lock",
            )
        })?;

        let record = guard
            .jobs
            .get(&normalized_job_id)
            .ok_or_else(|| render_job_not_found(&normalized_job_id))?;
        Ok(record.to_progress_snapshot())
    }

    pub(crate) fn cancel_render(
        &self,
        job_id: &str,
    ) -> Result<VideoRenderCancelResponse, AppError> {
        let normalized_job_id = normalize_job_id(job_id)?;
        let mut guard = self.state.lock().map_err(|_| {
            AppError::new(
                app_error_codes::VIDEO_RENDER_INTERNAL_ERROR,
                "failed to acquire render runtime lock",
            )
        })?;

        let token = guard.cancel_tokens.get(&normalized_job_id).cloned();
        let record = guard
            .jobs
            .get_mut(&normalized_job_id)
            .ok_or_else(|| render_job_not_found(&normalized_job_id))?;

        let canceled = if record.state.is_terminal() {
            false
        } else {
            if let Some(token) = token {
                token.store(true, Ordering::SeqCst);
            }
            record.message = Some("Cancel requested.".to_string());
            record.updated_at_utc = now_utc_stub();
            true
        };

        Ok(VideoRenderCancelResponse {
            job_id: record.job_id.clone(),
            state: record.state,
            canceled,
        })
    }

    pub(crate) fn get_render_result(
        &self,
        job_id: &str,
    ) -> Result<VideoRenderResultResponse, AppError> {
        let normalized_job_id = normalize_job_id(job_id)?;
        let guard = self.state.lock().map_err(|_| {
            AppError::new(
                app_error_codes::VIDEO_RENDER_INTERNAL_ERROR,
                "failed to acquire render runtime lock",
            )
        })?;

        let record = guard
            .jobs
            .get(&normalized_job_id)
            .ok_or_else(|| render_job_not_found(&normalized_job_id))?;
        Ok(record.to_result_response())
    }
    pub(crate) fn get_environment_diagnostics(
        &self,
        output_directory_path: Option<&str>,
    ) -> Result<VideoRenderDiagnosticsResponse, AppError> {
        Ok(collect_video_render_diagnostics(output_directory_path))
    }

    pub(crate) fn check_source_path(
        &self,
        source_path: &str,
    ) -> Result<VideoRenderSourcePathCheckResponse, AppError> {
        check_source_path_details(source_path)
    }

    pub(crate) fn open_output_folder(
        &self,
        output_file_path: &str,
    ) -> Result<VideoRenderOpenOutputFolderResponse, AppError> {
        open_output_folder_for_file(output_file_path)
    }

}

fn run_render_worker(
    state: Arc<Mutex<VideoRenderRuntimeState>>,
    runner: Arc<dyn VideoRenderJobRunner>,
    job_id: String,
    request: VideoRenderRequest,
    cancel_token: Arc<AtomicBool>,
) {
    let progress_state = Arc::clone(&state);
    let progress_job_id = job_id.clone();
    let mut sink = move |event: VideoRenderProgressEvent| {
        if let Ok(mut guard) = progress_state.lock() {
            if let Some(record) = guard.jobs.get_mut(&progress_job_id) {
                if record.state.is_terminal() {
                    return;
                }
                record.state = event.state;
                record.percent = event.percent.clamp(0.0, 100.0);
                record.stage = event.stage;
                record.frame_index = event.frame_index;
                record.total_frames = event.total_frames;
                record.encoded_seconds = event.encoded_seconds;
                record.message = event.message;
                record.updated_at_utc = now_utc_stub();
            }
        }
    };

    let outcome = runner.run_job(&job_id, &request, Arc::clone(&cancel_token), &mut sink);

    if let Ok(mut guard) = state.lock() {
        if let Some(record) = guard.jobs.get_mut(&job_id) {
            match outcome {
                VideoRenderJobOutcome::Success(mut success) => {
                    success.job_id = job_id.clone();
                    record.state = VideoRenderJobState::Succeeded;
                    record.percent = 100.0;
                    record.stage = "render_complete".to_string();
                    record.frame_index = record.total_frames;
                    record.encoded_seconds = Some(success.duration_seconds);
                    record.message = Some("Render completed successfully.".to_string());
                    record.updated_at_utc = now_utc_stub();
                    record.success = Some(success);
                    record.failure = None;
                }
                VideoRenderJobOutcome::Failure(mut failure) => {
                    failure.job_id = Some(job_id.clone());
                    let canceled = failure.code == VideoRenderFailureCode::CanceledByUser;
                    record.state = if canceled {
                        VideoRenderJobState::Canceled
                    } else {
                        VideoRenderJobState::Failed
                    };
                    record.stage = if canceled {
                        "render_canceled".to_string()
                    } else {
                        "render_failed".to_string()
                    };
                    record.message = Some(failure.message.clone());
                    record.updated_at_utc = now_utc_stub();
                    record.success = None;
                    record.failure = Some(failure);
                }
            }
        }

        if guard.active_job_id.as_deref() == Some(job_id.as_str()) {
            guard.active_job_id = None;
        }
        guard.cancel_tokens.remove(&job_id);
    }
}
fn make_failure(
    job_id: Option<String>,
    code: VideoRenderFailureCode,
    message: impl Into<String>,
    retryable: bool,
    details: Option<Value>,
) -> VideoRenderFailure {
    VideoRenderFailure {
        job_id,
        code,
        message: truncate_message(&message.into(), MAX_FFMPEG_ERROR_CHARS),
        retryable,
        details,
    }
}

fn ffmpeg_source_label(source: VideoRenderFfmpegSource) -> &'static str {
    match source {
        VideoRenderFfmpegSource::BundledResource => "bundled_resource",
        VideoRenderFfmpegSource::Path => "path",
        VideoRenderFfmpegSource::Missing => "missing",
    }
}

fn ffmpeg_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    }
}

fn push_unique_candidate(candidates: &mut Vec<PathBuf>, candidate: PathBuf) {
    if candidates.iter().any(|existing| *existing == candidate) {
        return;
    }
    candidates.push(candidate);
}

fn bundled_ffmpeg_candidates() -> Vec<PathBuf> {
    let binary_name = ffmpeg_binary_name();
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(configured_path) = std::env::var("RELEASE_PUBLISHER_FFMPEG_PATH") {
        let trimmed = configured_path.trim();
        if !trimmed.is_empty() {
            push_unique_candidate(&mut candidates, PathBuf::from(trimmed));
        }
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let local_candidates = [
                exe_dir.join(binary_name),
                exe_dir.join("resources").join(binary_name),
                exe_dir.join("resources").join("ffmpeg").join(binary_name),
                exe_dir
                    .join("resources")
                    .join("ffmpeg")
                    .join(std::env::consts::OS)
                    .join(binary_name),
                exe_dir
                    .join("resources")
                    .join("ffmpeg")
                    .join("win32")
                    .join(binary_name),
            ];

            for candidate in local_candidates {
                push_unique_candidate(&mut candidates, candidate);
            }

            if let Some(parent_dir) = exe_dir.parent() {
                push_unique_candidate(
                    &mut candidates,
                    parent_dir.join("resources").join(binary_name),
                );
                push_unique_candidate(
                    &mut candidates,
                    parent_dir
                        .join("resources")
                        .join("ffmpeg")
                        .join(binary_name),
                );
                push_unique_candidate(
                    &mut candidates,
                    parent_dir
                        .join("resources")
                        .join("ffmpeg")
                        .join(std::env::consts::OS)
                        .join(binary_name),
                );
                push_unique_candidate(
                    &mut candidates,
                    parent_dir
                        .join("resources")
                        .join("ffmpeg")
                        .join("win32")
                        .join(binary_name),
                );
            }
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let manifest_candidates = [
        manifest_dir.join("resources").join(binary_name),
        manifest_dir.join("resources").join("ffmpeg").join(binary_name),
        manifest_dir
            .join("resources")
            .join("ffmpeg")
            .join(std::env::consts::OS)
            .join(binary_name),
        manifest_dir
            .join("resources")
            .join("ffmpeg")
            .join("win32")
            .join(binary_name),
    ];
    for candidate in manifest_candidates {
        push_unique_candidate(&mut candidates, candidate);
    }

    candidates
}

fn find_ffmpeg_in_path() -> Option<PathBuf> {
    let binary_name = ffmpeg_binary_name();
    let path_env = std::env::var_os("PATH")?;
    for directory in std::env::split_paths(&path_env) {
        let candidate = directory.join(binary_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn resolve_ffmpeg_executable() -> Option<ResolvedFfmpegExecutable> {
    for candidate in bundled_ffmpeg_candidates() {
        if candidate.is_file() {
            return Some(ResolvedFfmpegExecutable {
                path: candidate,
                source: VideoRenderFfmpegSource::BundledResource,
            });
        }
    }

    find_ffmpeg_in_path().map(|path| ResolvedFfmpegExecutable {
        path,
        source: VideoRenderFfmpegSource::Path,
    })
}

fn read_ffmpeg_version(path: &PathBuf) -> Result<String, String> {
    let output = Command::new(path)
        .arg("-version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("failed to launch ffmpeg for version probe: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "ffmpeg version probe failed with status {}",
            output.status
        ));
    }

    let first_line = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .unwrap_or("ffmpeg")
        .trim()
        .to_string();

    Ok(truncate_message(&first_line, MAX_DIAGNOSTIC_MESSAGE_CHARS))
}

fn sanitize_diagnostic_message(raw: impl Into<String>) -> String {
    truncate_message(&raw.into(), MAX_DIAGNOSTIC_MESSAGE_CHARS)
}

fn probe_output_directory(path_raw: &str) -> VideoRenderOutputDirectoryDiagnostics {
    let trimmed = path_raw.trim().to_string();
    if trimmed.is_empty() {
        return VideoRenderOutputDirectoryDiagnostics {
            directory_path: String::new(),
            exists: false,
            writable: false,
            message: Some("Output directory path is empty.".to_string()),
        };
    }

    if trimmed.len() > MAX_RENDER_PATH_CHARS {
        return VideoRenderOutputDirectoryDiagnostics {
            directory_path: trimmed,
            exists: false,
            writable: false,
            message: Some(format!(
                "Output directory path exceeds {MAX_RENDER_PATH_CHARS} characters."
            )),
        };
    }

    let directory_path = PathBuf::from(&trimmed);
    let metadata = match std::fs::metadata(&directory_path) {
        Ok(metadata) => metadata,
        Err(error) => {
            return VideoRenderOutputDirectoryDiagnostics {
                directory_path: trimmed,
                exists: false,
                writable: false,
                message: Some(sanitize_diagnostic_message(format!(
                    "Output directory is missing or inaccessible: {error}"
                ))),
            }
        }
    };

    if !metadata.is_dir() {
        return VideoRenderOutputDirectoryDiagnostics {
            directory_path: trimmed,
            exists: true,
            writable: false,
            message: Some("Output path exists but is not a directory.".to_string()),
        };
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_micros();
    let probe_path = directory_path.join(format!(
        ".release-publisher-write-probe-{}-{}.tmp",
        std::process::id(),
        timestamp
    ));

    match std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&probe_path)
    {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe_path);
            VideoRenderOutputDirectoryDiagnostics {
                directory_path: trimmed,
                exists: true,
                writable: true,
                message: None,
            }
        }
        Err(error) => VideoRenderOutputDirectoryDiagnostics {
            directory_path: trimmed,
            exists: true,
            writable: false,
            message: Some(sanitize_diagnostic_message(format!(
                "Output directory is not writable: {error}"
            ))),
        },
    }
}

fn collect_video_render_diagnostics(
    output_directory_path: Option<&str>,
) -> VideoRenderDiagnosticsResponse {
    let mut blocking_reasons: Vec<String> = Vec::new();

    let ffmpeg = if let Some(resolved) = resolve_ffmpeg_executable() {
        match read_ffmpeg_version(&resolved.path) {
            Ok(version) => VideoRenderFfmpegDiagnostics {
                available: true,
                source: resolved.source,
                executable_path: Some(path_to_string(&resolved.path)),
                version: Some(version),
                message: None,
            },
            Err(error_message) => {
                blocking_reasons
                    .push("FFmpeg executable exists but failed version probe.".to_string());
                VideoRenderFfmpegDiagnostics {
                    available: false,
                    source: resolved.source,
                    executable_path: Some(path_to_string(&resolved.path)),
                    version: None,
                    message: Some(sanitize_diagnostic_message(error_message)),
                }
            }
        }
    } else {
        blocking_reasons.push("FFmpeg executable is unavailable.".to_string());
        VideoRenderFfmpegDiagnostics {
            available: false,
            source: VideoRenderFfmpegSource::Missing,
            executable_path: None,
            version: None,
            message: Some(
                "FFmpeg was not found in bundled resources and was not available on PATH."
                    .to_string(),
            ),
        }
    };

    let output_directory = output_directory_path.map(probe_output_directory);
    if let Some(directory_probe) = &output_directory {
        if !directory_probe.exists {
            blocking_reasons.push("Output directory does not exist.".to_string());
        } else if !directory_probe.writable {
            blocking_reasons.push("Output directory is not writable.".to_string());
        }
    }

    VideoRenderDiagnosticsResponse {
        ffmpeg,
        output_directory,
        render_capable: blocking_reasons.is_empty(),
        blocking_reasons,
    }
}

fn check_source_path_details(
    source_path: &str,
) -> Result<VideoRenderSourcePathCheckResponse, AppError> {
    let normalized = source_path.trim();
    if normalized.is_empty() {
        return Err(AppError::invalid_argument("sourcePath cannot be empty"));
    }
    if normalized.len() > MAX_RENDER_PATH_CHARS {
        return Err(AppError::invalid_argument(format!(
            "sourcePath exceeds maximum length of {MAX_RENDER_PATH_CHARS} characters"
        )));
    }

    let path = PathBuf::from(normalized);
    match std::fs::metadata(&path) {
        Ok(metadata) => Ok(VideoRenderSourcePathCheckResponse {
            source_path: normalized.to_string(),
            exists: true,
            is_file: metadata.is_file(),
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(VideoRenderSourcePathCheckResponse {
                source_path: normalized.to_string(),
                exists: false,
                is_file: false,
            })
        }
        Err(error) => Err(AppError::file_read_failed(format!(
            "failed to inspect sourcePath: {error}"
        ))),
    }
}

fn open_output_folder_for_file(
    output_file_path: &str,
) -> Result<VideoRenderOpenOutputFolderResponse, AppError> {
    let trimmed = output_file_path.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid_argument("outputFilePath cannot be empty"));
    }
    if trimmed.len() > MAX_RENDER_PATH_CHARS {
        return Err(AppError::invalid_argument(format!(
            "outputFilePath exceeds maximum length of {MAX_RENDER_PATH_CHARS} characters"
        )));
    }

    let file_path = PathBuf::from(trimmed);
    let parent = file_path.parent().ok_or_else(|| {
        AppError::invalid_argument("outputFilePath must include a parent directory")
    })?;

    let metadata = std::fs::metadata(parent).map_err(|error| {
        AppError::file_read_failed(format!("failed to inspect output directory: {error}"))
    })?;
    if !metadata.is_dir() {
        return Err(AppError::invalid_argument(
            "outputFilePath parent is not a directory",
        ));
    }

    let mut command = if cfg!(target_os = "windows") {
        let mut command = Command::new("explorer");
        command.arg(parent.as_os_str());
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(parent.as_os_str());
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(parent.as_os_str());
        command
    };

    command.spawn().map_err(|error| {
        AppError::new(
            app_error_codes::VIDEO_RENDER_INTERNAL_ERROR,
            format!("failed to open output folder: {error}"),
        )
    })?;

    Ok(VideoRenderOpenOutputFolderResponse {
        opened: true,
        directory_path: path_to_string(parent),
    })
}
fn resolve_source_path(
    raw: &str,
    label: &str,
    missing_code: VideoRenderFailureCode,
) -> Result<PathBuf, VideoRenderFailure> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(make_failure(
            None,
            missing_code,
            format!("{label} source path is required."),
            false,
            None,
        ));
    }

    if trimmed.len() > MAX_RENDER_PATH_CHARS {
        return Err(make_failure(
            None,
            VideoRenderFailureCode::InputReadFailed,
            format!(
                "{label} source path exceeds maximum length of {MAX_RENDER_PATH_CHARS} characters."
            ),
            false,
            None,
        ));
    }

    let path = PathBuf::from(trimmed);
    match std::fs::metadata(&path) {
        Ok(metadata) if metadata.is_file() => Ok(path),
        Ok(_) => Err(make_failure(
            None,
            VideoRenderFailureCode::InputReadFailed,
            format!("{label} source path is not a file."),
            false,
            Some(json!({ "path": trimmed })),
        )),
        Err(error) => Err(make_failure(
            None,
            missing_code,
            format!("{label} source file is missing or unreadable."),
            false,
            Some(json!({ "path": trimmed, "source": format!("{error}") })),
        )),
    }
}

fn prepare_output_path(output: &VideoRenderOutputInput) -> Result<PathBuf, VideoRenderFailure> {
    let output_path = output.output_file_path.trim();
    if output_path.is_empty() {
        return Err(make_failure(
            None,
            VideoRenderFailureCode::OutputPathInvalid,
            "Output file path is required.",
            false,
            None,
        ));
    }

    let path = PathBuf::from(output_path);
    let Some(parent) = path.parent() else {
        return Err(make_failure(
            None,
            VideoRenderFailureCode::OutputPathInvalid,
            "Output path must include a parent directory.",
            false,
            Some(json!({ "path": output_path })),
        ));
    };

    match std::fs::metadata(parent) {
        Ok(meta) if meta.is_dir() => {}
        Ok(_) => {
            return Err(make_failure(
                None,
                VideoRenderFailureCode::OutputPathInvalid,
                "Output parent path is not a directory.",
                false,
                Some(json!({ "path": path_to_string(parent) })),
            ))
        }
        Err(error) => {
            return Err(make_failure(
                None,
                VideoRenderFailureCode::OutputPathInvalid,
                "Output directory does not exist or is inaccessible.",
                false,
                Some(json!({ "path": path_to_string(parent), "source": format!("{error}") })),
            ))
        }
    }

    if path.exists() {
        if output.overwrite_policy == "replace" {
            if let Err(error) = std::fs::remove_file(&path) {
                return Err(make_failure(
                    None,
                    VideoRenderFailureCode::OutputPathInvalid,
                    "Failed to replace existing output file.",
                    false,
                    Some(json!({ "path": output_path, "source": format!("{error}") })),
                ));
            }
        } else {
            return Err(make_failure(
                None,
                VideoRenderFailureCode::OutputPathInvalid,
                "Output file already exists and overwrite policy is disallow.",
                false,
                Some(json!({ "path": output_path })),
            ));
        }
    }

    Ok(path)
}

fn normalize_color_hex(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Some(stripped) = trimmed.strip_prefix('#') {
        stripped.to_ascii_uppercase()
    } else {
        trimmed.to_ascii_uppercase()
    }
}

fn escape_drawtext_text(raw: &str) -> String {
    raw.replace('\\', "\\\\")
        .replace(':', "\\:")
        .replace('"', "\\\"")
        .replace('\'', "\\'")
        .replace('%', "\\%")
}

fn build_drawtext(
    input_label: &str,
    output_label: &str,
    text: &str,
    font_size: u32,
    color: &str,
    x: &str,
    y: &str,
) -> String {
    format!(
        "[{input_label}]drawtext=text='{text}':fontcolor=#{color}:fontsize={font_size}:x={x}:y={y}:shadowcolor=black@0.6:shadowx=2:shadowy=2:bordercolor=black@0.35:borderw=1[{output_label}]"
    )
}

fn build_filter_complex(request: &VideoRenderRequest) -> Result<String, VideoRenderFailure> {
    let width = request.composition.width_px;
    let height = request.composition.height_px;

    let mut filters: Vec<String> = Vec::new();
    let mut current = "vbase".to_string();

    let fit = match request.composition.fit_mode.as_str() {
        "fill_crop" => format!(
            "[0:v]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}[{current}]"
        ),
        "fit_bars" => format!(
            "[0:v]scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black[{current}]"
        ),
        "stretch" => format!("[0:v]scale={width}:{height}[{current}]"),
        _ => {
            return Err(make_failure(
                None,
                VideoRenderFailureCode::InvalidRequest,
                "Unsupported fit mode for render.",
                false,
                Some(json!({ "fitMode": request.composition.fit_mode })),
            ))
        }
    };
    filters.push(fit);

    if request.composition.overlay.enabled {
        if request.composition.overlay.style != "waveform_strip" {
            return Err(make_failure(
                None,
                VideoRenderFailureCode::OverlayComputationFailed,
                "Unsupported overlay style requested.",
                false,
                Some(json!({ "style": request.composition.overlay.style })),
            ));
        }

        let strip_h = ((height as f32)
            * (0.12 + request.composition.overlay.intensity.clamp(0.0, 1.0) * 0.18))
            .round()
            .clamp(24.0, height as f32) as u32;
        let strip_rate = ((request.composition.frame_rate as f32)
            * (1.0 - request.composition.overlay.smoothing.clamp(0.0, 1.0) * 0.65))
            .round()
            .clamp(8.0, request.composition.frame_rate.max(8) as f32)
            as u32;

        let overlay_color = normalize_color_hex(&request.composition.overlay.theme_color_hex);
        let overlay_y = if request.composition.overlay.position == "top" {
            "0"
        } else {
            "H-h"
        };

        filters.push(format!(
            "[1:a]aformat=channel_layouts=stereo,showwaves=s={width}x{strip_h}:mode=cline:rate={strip_rate}:colors=0x{overlay_color},format=rgba,colorchannelmixer=aa={:.3}[vwave]",
            request.composition.overlay.opacity.clamp(0.0, 1.0)
        ));

        let next = "voverlay".to_string();
        filters.push(format!("[{current}][vwave]overlay=0:{overlay_y}[{next}]"));
        current = next;
    }

    if request.composition.text.enabled {
        let title = request.composition.text.title_text.trim();
        let artist = request.composition.text.artist_text.trim();
        let color = normalize_color_hex(&request.composition.text.color_hex);
        let font_size = request.composition.text.font_size_px;

        match request.composition.text.preset.as_str() {
            "none" => {}
            "title_bottom_center" => {
                if !title.is_empty() {
                    let out = "vtext1".to_string();
                    filters.push(build_drawtext(
                        &current,
                        &out,
                        &escape_drawtext_text(title),
                        font_size,
                        &color,
                        "(w-text_w)/2",
                        "h-(text_h*2)-48",
                    ));
                    current = out;
                }
            }
            "title_artist_bottom_left" => {
                if !title.is_empty() {
                    let out = "vtext1".to_string();
                    filters.push(build_drawtext(
                        &current,
                        &out,
                        &escape_drawtext_text(title),
                        font_size,
                        &color,
                        "48",
                        "h-(text_h*2)-72",
                    ));
                    current = out;
                }
                if !artist.is_empty() {
                    let out = "vtext2".to_string();
                    filters.push(build_drawtext(
                        &current,
                        &out,
                        &escape_drawtext_text(artist),
                        font_size.saturating_sub(4).max(MIN_TEXT_FONT_SIZE_PX),
                        &color,
                        "48",
                        "h-text_h-36",
                    ));
                    current = out;
                }
            }
            "title_artist_center_stack" => {
                if !title.is_empty() {
                    let out = "vtext1".to_string();
                    filters.push(build_drawtext(
                        &current,
                        &out,
                        &escape_drawtext_text(title),
                        font_size,
                        &color,
                        "(w-text_w)/2",
                        "(h/2)-text_h-8",
                    ));
                    current = out;
                }
                if !artist.is_empty() {
                    let out = "vtext2".to_string();
                    filters.push(build_drawtext(
                        &current,
                        &out,
                        &escape_drawtext_text(artist),
                        font_size.saturating_sub(4).max(MIN_TEXT_FONT_SIZE_PX),
                        &color,
                        "(w-text_w)/2",
                        "(h/2)+12",
                    ));
                    current = out;
                }
            }
            _ => {
                return Err(make_failure(
                    None,
                    VideoRenderFailureCode::TextLayoutFailed,
                    "Unsupported text preset for render.",
                    false,
                    Some(json!({ "preset": request.composition.text.preset })),
                ))
            }
        }
    }

    filters.push(format!("[{current}]format=yuv420p[vout]"));
    Ok(filters.join(";"))
}

fn prepare_render_job(
    request: &VideoRenderRequest,
) -> Result<PreparedRenderJob, VideoRenderFailure> {
    let image_path = resolve_source_path(
        &request.media.image_file_name,
        "Image",
        VideoRenderFailureCode::MissingInput,
    )?;
    let audio_path = resolve_source_path(
        &request.media.audio_file_name,
        "Audio",
        VideoRenderFailureCode::MissingInput,
    )?;
    let output_path = prepare_output_path(&request.output)?;

    let analysis = analyze_audio_track_file(&audio_path).map_err(|error| {
        let (code, message) = match error {
            CoreAudioError::Unsupported(_) => (
                VideoRenderFailureCode::UnsupportedMediaType,
                "Audio source format is not supported for rendering.",
            ),
            CoreAudioError::Io { .. }
            | CoreAudioError::InvalidInput(_)
            | CoreAudioError::Decode(_)
            | CoreAudioError::Analysis(_) => (
                VideoRenderFailureCode::InputReadFailed,
                "Audio source decode/analysis failed during render preparation.",
            ),
        };
        make_failure(
            None,
            code,
            message,
            false,
            Some(json!({ "source": format!("{error}") })),
        )
    })?;

    let duration_seconds = f64::from(analysis.duration_ms) / 1000.0;
    if !duration_seconds.is_finite() || duration_seconds <= 0.0 {
        return Err(make_failure(
            None,
            VideoRenderFailureCode::InputReadFailed,
            "Audio duration is invalid.",
            false,
            Some(json!({ "durationMs": analysis.duration_ms })),
        ));
    }

    let total_frames = (duration_seconds * f64::from(request.composition.frame_rate))
        .round()
        .max(1.0) as u64;

    let filter_complex = build_filter_complex(request)?;

    Ok(PreparedRenderJob {
        image_path,
        audio_path,
        output_path: output_path.clone(),
        output_path_string: path_to_string(&output_path),
        duration_seconds,
        total_frames,
        filter_complex,
    })
}

fn parse_hhmmss(raw: &str) -> Option<f64> {
    let mut parts = raw.split(':');
    let h = parts.next()?.parse::<f64>().ok()?;
    let m = parts.next()?.parse::<f64>().ok()?;
    let s = parts.next()?.parse::<f64>().ok()?;
    Some((h * 3600.0) + (m * 60.0) + s)
}

fn progress_from_encoded_seconds(
    frame_rate: u32,
    duration_seconds: f64,
    total_frames: u64,
    encoded_seconds: f64,
) -> VideoRenderProgressEvent {
    let safe_encoded = encoded_seconds.max(0.0).min(duration_seconds.max(0.0));
    let ratio = if duration_seconds > 0.0 {
        (safe_encoded / duration_seconds).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let frame_index = (safe_encoded * f64::from(frame_rate)).round().max(0.0) as u64;

    VideoRenderProgressEvent {
        state: VideoRenderJobState::Running,
        percent: (12.0 + ratio * 84.0).clamp(12.0, 98.0) as f32,
        stage: "render_encode".to_string(),
        frame_index: Some(frame_index.min(total_frames)),
        total_frames: Some(total_frames),
        encoded_seconds: Some(safe_encoded),
        message: Some("Encoding MP4 stream.".to_string()),
    }
}

fn parse_ffmpeg_progress_line(
    line: &str,
    frame_rate: u32,
    duration_seconds: f64,
    total_frames: u64,
) -> Option<VideoRenderProgressEvent> {
    let (key, value) = line.split_once('=')?;
    match key {
        "out_time_us" | "out_time_ms" => {
            let micros = value.parse::<f64>().ok()?;
            Some(progress_from_encoded_seconds(
                frame_rate,
                duration_seconds,
                total_frames,
                micros / 1_000_000.0,
            ))
        }
        "out_time" => Some(progress_from_encoded_seconds(
            frame_rate,
            duration_seconds,
            total_frames,
            parse_hhmmss(value)?,
        )),
        "progress" if value == "end" => Some(VideoRenderProgressEvent {
            state: VideoRenderJobState::Finalizing,
            percent: 99.0,
            stage: "render_finalize_mux".to_string(),
            frame_index: Some(total_frames),
            total_frames: Some(total_frames),
            encoded_seconds: Some(duration_seconds),
            message: Some("Finalizing MP4 container.".to_string()),
        }),
        _ => None,
    }
}

fn truncate_message(raw: &str, max_chars: usize) -> String {
    let trimmed = raw.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let mut out = String::with_capacity(max_chars + 3);
    for ch in trimmed.chars().take(max_chars) {
        out.push(ch);
    }
    out.push_str("...");
    out
}

impl VideoRenderJobRunner for FfmpegVideoRenderJobRunner {
    fn run_job(
        &self,
        job_id: &str,
        request: &VideoRenderRequest,
        cancel_requested: Arc<AtomicBool>,
        on_progress: &mut dyn FnMut(VideoRenderProgressEvent),
    ) -> VideoRenderJobOutcome {
        let prepared = match prepare_render_job(request) {
            Ok(prepared) => prepared,
            Err(mut failure) => {
                failure.job_id = Some(job_id.to_string());
                return VideoRenderJobOutcome::Failure(failure);
            }
        };

        on_progress(VideoRenderProgressEvent {
            state: VideoRenderJobState::Starting,
            percent: 8.0,
            stage: "render_prepare_encoder".to_string(),
            frame_index: Some(0),
            total_frames: Some(prepared.total_frames),
            encoded_seconds: Some(0.0),
            message: Some("Preparing ffmpeg encoder process.".to_string()),
        });

        let ffmpeg_executable = match resolve_ffmpeg_executable() {
            Some(resolved) => resolved,
            None => {
                return VideoRenderJobOutcome::Failure(make_failure(
                    Some(job_id.to_string()),
                    VideoRenderFailureCode::EncoderUnavailable,
                    "ffmpeg executable was not found in bundled resources or PATH.",
                    true,
                    None,
                ));
            }
        };

        let mut command = Command::new(&ffmpeg_executable.path);
        command
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-nostdin");

        if request.output.overwrite_policy == "replace" {
            command.arg("-y");
        } else {
            command.arg("-n");
        }

        command
            .arg("-loop")
            .arg("1")
            .arg("-framerate")
            .arg(request.composition.frame_rate.to_string())
            .arg("-i")
            .arg(prepared.image_path.as_os_str())
            .arg("-i")
            .arg(prepared.audio_path.as_os_str())
            .arg("-filter_complex")
            .arg(prepared.filter_complex)
            .arg("-map")
            .arg("[vout]")
            .arg("-map")
            .arg("1:a:0")
            .arg("-c:v")
            .arg("libx264")
            .arg("-pix_fmt")
            .arg("yuv420p")
            .arg("-r")
            .arg(request.composition.frame_rate.to_string())
            .arg("-b:v")
            .arg(format!("{}k", request.output.video_bitrate_kbps))
            .arg("-c:a")
            .arg("aac")
            .arg("-b:a")
            .arg(format!("{}k", request.output.audio_bitrate_kbps))
            .arg("-movflags")
            .arg("+faststart")
            .arg("-shortest")
            .arg("-progress")
            .arg("pipe:1")
            .arg("-nostats")
            .arg(prepared.output_path.as_os_str())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return VideoRenderJobOutcome::Failure(make_failure(
                    Some(job_id.to_string()),
                    VideoRenderFailureCode::EncoderUnavailable,
                    "Resolved ffmpeg executable was not found when launching render process.",
                    true,
                    Some(json!({
                        "ffmpegPath": path_to_string(&ffmpeg_executable.path),
                        "ffmpegSource": ffmpeg_source_label(ffmpeg_executable.source),
                        "source": format!("{error}"),
                    })),
                ));
            }
            Err(error) => {
                return VideoRenderJobOutcome::Failure(make_failure(
                    Some(job_id.to_string()),
                    VideoRenderFailureCode::EncoderFailed,
                    "Failed to launch ffmpeg encoder process.",
                    true,
                    Some(json!({
                        "ffmpegPath": path_to_string(&ffmpeg_executable.path),
                        "ffmpegSource": ffmpeg_source_label(ffmpeg_executable.source),
                        "source": format!("{error}"),
                    })),
                ));
            }
        };

        on_progress(VideoRenderProgressEvent {
            state: VideoRenderJobState::Running,
            percent: 12.0,
            stage: "render_encode".to_string(),
            frame_index: Some(0),
            total_frames: Some(prepared.total_frames),
            encoded_seconds: Some(0.0),
            message: Some("Encoding MP4 video stream.".to_string()),
        });

        let stdout = match child.stdout.take() {
            Some(stdout) => stdout,
            None => {
                let _ = child.kill();
                let _ = child.wait();
                return VideoRenderJobOutcome::Failure(make_failure(
                    Some(job_id.to_string()),
                    VideoRenderFailureCode::ProgressChannelClosed,
                    "ffmpeg progress output stream was unavailable.",
                    true,
                    None,
                ));
            }
        };

        let stderr_thread = child.stderr.take().map(|stderr| {
            std::thread::spawn(move || {
                let mut stderr_buf = String::new();
                let mut reader = BufReader::new(stderr);
                let _ = reader.read_to_string(&mut stderr_buf);
                stderr_buf
            })
        });

        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    if cancel_requested.load(Ordering::SeqCst) {
                        let _ = child.kill();
                    }
                    if let Some(event) = parse_ffmpeg_progress_line(
                        line.trim(),
                        request.composition.frame_rate,
                        prepared.duration_seconds,
                        prepared.total_frames,
                    ) {
                        on_progress(event);
                    }
                }
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return VideoRenderJobOutcome::Failure(make_failure(
                        Some(job_id.to_string()),
                        VideoRenderFailureCode::ProgressChannelClosed,
                        "ffmpeg progress stream read failed.",
                        true,
                        Some(json!({ "source": format!("{error}") })),
                    ));
                }
            }
        }

        if cancel_requested.load(Ordering::SeqCst) {
            let _ = child.kill();
        }

        let status = match child.wait() {
            Ok(status) => status,
            Err(error) => {
                return VideoRenderJobOutcome::Failure(make_failure(
                    Some(job_id.to_string()),
                    VideoRenderFailureCode::EncoderFailed,
                    "Failed while waiting for ffmpeg process termination.",
                    true,
                    Some(json!({ "source": format!("{error}") })),
                ));
            }
        };

        let stderr_text = stderr_thread
            .and_then(|handle| handle.join().ok())
            .unwrap_or_default();

        if cancel_requested.load(Ordering::SeqCst) {
            return VideoRenderJobOutcome::Failure(make_failure(
                Some(job_id.to_string()),
                VideoRenderFailureCode::CanceledByUser,
                "Render canceled by user.",
                true,
                None,
            ));
        }

        if !status.success() {
            let stderr_trimmed = truncate_message(&stderr_text, MAX_FFMPEG_ERROR_CHARS);
            let message = if stderr_trimmed.is_empty() {
                format!("ffmpeg exited with status {status}")
            } else {
                format!("ffmpeg exited with status {status}: {stderr_trimmed}")
            };
            return VideoRenderJobOutcome::Failure(make_failure(
                Some(job_id.to_string()),
                VideoRenderFailureCode::EncoderFailed,
                message,
                true,
                None,
            ));
        }

        let metadata = match std::fs::metadata(&prepared.output_path) {
            Ok(metadata) => metadata,
            Err(error) => {
                return VideoRenderJobOutcome::Failure(make_failure(
                    Some(job_id.to_string()),
                    VideoRenderFailureCode::EncoderFailed,
                    "Render process finished but output file was not found.",
                    false,
                    Some(json!({ "source": format!("{error}") })),
                ));
            }
        };

        if metadata.len() == 0 {
            return VideoRenderJobOutcome::Failure(make_failure(
                Some(job_id.to_string()),
                VideoRenderFailureCode::EncoderFailed,
                "Render process produced an empty output file.",
                false,
                None,
            ));
        }

        on_progress(VideoRenderProgressEvent {
            state: VideoRenderJobState::Finalizing,
            percent: 99.0,
            stage: "render_finalize".to_string(),
            frame_index: Some(prepared.total_frames),
            total_frames: Some(prepared.total_frames),
            encoded_seconds: Some(prepared.duration_seconds),
            message: Some("Finalizing encoded output.".to_string()),
        });

        VideoRenderJobOutcome::Success(VideoRenderSuccess {
            job_id: job_id.to_string(),
            output_path: prepared.output_path_string,
            duration_seconds: prepared.duration_seconds,
            file_size_bytes: metadata.len(),
            completed_at_utc: now_utc_stub(),
        })
    }
}
fn render_job_not_found(job_id: &str) -> AppError {
    AppError::new(
        app_error_codes::VIDEO_RENDER_JOB_NOT_FOUND,
        format!("render job `{job_id}` was not found"),
    )
}

fn normalize_job_id(job_id: &str) -> Result<String, AppError> {
    let normalized = job_id.trim();
    if normalized.is_empty() {
        return Err(AppError::invalid_argument("job_id cannot be empty"));
    }
    if normalized.len() > MAX_REQUEST_ID_CHARS {
        return Err(AppError::invalid_argument(format!(
            "job_id exceeds maximum length of {MAX_REQUEST_ID_CHARS} characters"
        )));
    }
    Ok(normalized.to_string())
}

fn next_job_id(state: &mut VideoRenderRuntimeState) -> String {
    let nonce = state.next_job_nonce;
    state.next_job_nonce = state.next_job_nonce.saturating_add(1);
    format!("vrj_{nonce:016x}")
}

fn now_utc_stub() -> String {
    let now_ms = current_unix_ms();
    format!("{now_ms}")
}

fn collect_validation_issues(request: &VideoRenderRequest) -> Vec<VideoRenderValidationIssue> {
    let mut issues = Vec::new();

    if request.request_version != 1 {
        issues.push(VideoRenderValidationIssue {
            code: VideoRenderValidationIssueCode::InvalidRequestVersion,
            message: "requestVersion must be 1.".to_string(),
            field: "requestVersion".to_string(),
        });
    }

    let request_id = request.request_id.trim();
    if request_id.is_empty() || request_id.len() > MAX_REQUEST_ID_CHARS {
        issues.push(VideoRenderValidationIssue {
            code: VideoRenderValidationIssueCode::InvalidRequestVersion,
            message: format!(
                "requestId is required and must be at most {MAX_REQUEST_ID_CHARS} characters."
            ),
            field: "requestId".to_string(),
        });
    }

    if request.media.image_file_name.trim().is_empty() {
        issues.push(VideoRenderValidationIssue {
            code: VideoRenderValidationIssueCode::MissingImage,
            message: "Image source is required.".to_string(),
            field: "media.imageFileName".to_string(),
        });
    }

    if request.media.audio_file_name.trim().is_empty() {
        issues.push(VideoRenderValidationIssue {
            code: VideoRenderValidationIssueCode::MissingAudio,
            message: "Audio source is required.".to_string(),
            field: "media.audioFileName".to_string(),
        });
    }

    let image_extension = request.media.image_extension.trim().to_ascii_lowercase();
    if !matches!(image_extension.as_str(), "jpg" | "jpeg" | "png") {
        issues.push(VideoRenderValidationIssue {
            code: VideoRenderValidationIssueCode::UnsupportedImageType,
            message: "Image extension must be jpg, jpeg, or png.".to_string(),
            field: "media.imageExtension".to_string(),
        });
    }

    let audio_extension = request.media.audio_extension.trim().to_ascii_lowercase();
    if audio_extension != "wav" {
        issues.push(VideoRenderValidationIssue {
            code: VideoRenderValidationIssueCode::UnsupportedAudioType,
            message: "Audio extension must be wav for Stage 8.".to_string(),
            field: "media.audioExtension".to_string(),
        });
    }

    let output_path = request.output.output_file_path.trim();
    if output_path.is_empty() || output_path.len() > MAX_RENDER_PATH_CHARS {
        issues.push(VideoRenderValidationIssue {
            code: VideoRenderValidationIssueCode::InvalidOutputPath,
            message: format!(
                "outputFilePath is required and must be at most {MAX_RENDER_PATH_CHARS} characters."
            ),
            field: "output.outputFilePath".to_string(),
        });
    }

    if request.composition.width_px == 0
        || request.composition.height_px == 0
        || request.composition.width_px > MAX_RENDER_DIMENSION
        || request.composition.height_px > MAX_RENDER_DIMENSION
    {
        issues.push(VideoRenderValidationIssue {
            code: VideoRenderValidationIssueCode::InvalidComposition,
            message: format!(
                "Composition dimensions must be between 1 and {MAX_RENDER_DIMENSION} pixels."
            ),
            field: "composition".to_string(),
        });
    }

    if request.composition.frame_rate != 30 {
        issues.push(VideoRenderValidationIssue {
            code: VideoRenderValidationIssueCode::InvalidComposition,
            message: "frameRate must be 30 for Stage 8.".to_string(),
            field: "composition.frameRate".to_string(),
        });
    }

    if !matches!(
        request.composition.fit_mode.as_str(),
        "fill_crop" | "fit_bars" | "stretch"
    ) {
        issues.push(VideoRenderValidationIssue {
            code: VideoRenderValidationIssueCode::InvalidComposition,
            message: "fitMode is invalid.".to_string(),
            field: "composition.fitMode".to_string(),
        });
    }

    if !matches!(
        request.composition.text.preset.as_str(),
        "none" | "title_bottom_center" | "title_artist_bottom_left" | "title_artist_center_stack"
    ) {
        issues.push(VideoRenderValidationIssue {
            code: VideoRenderValidationIssueCode::InvalidComposition,
            message: "text.preset is invalid.".to_string(),
            field: "composition.text.preset".to_string(),
        });
    }

    if request.composition.text.enabled && request.composition.text.preset == "none" {
        issues.push(VideoRenderValidationIssue {
            code: VideoRenderValidationIssueCode::InvalidComposition,
            message: "text.preset must be selected when text is enabled.".to_string(),
            field: "composition.text.preset".to_string(),
        });
    }

    if request.composition.text.title_text.chars().count() > MAX_TEXT_CHARS {
        issues.push(VideoRenderValidationIssue {
            code: VideoRenderValidationIssueCode::InvalidComposition,
            message: format!("titleText exceeds {MAX_TEXT_CHARS} characters."),
            field: "composition.text.titleText".to_string(),
        });
    }

    if request.composition.text.artist_text.chars().count() > MAX_TEXT_CHARS {
        issues.push(VideoRenderValidationIssue {
            code: VideoRenderValidationIssueCode::InvalidComposition,
            message: format!("artistText exceeds {MAX_TEXT_CHARS} characters."),
            field: "composition.text.artistText".to_string(),
        });
    }

    if request.composition.text.font_size_px < MIN_TEXT_FONT_SIZE_PX
        || request.composition.text.font_size_px > MAX_TEXT_FONT_SIZE_PX
    {
        issues.push(VideoRenderValidationIssue {
            code: VideoRenderValidationIssueCode::InvalidComposition,
            message: format!(
                "text.fontSizePx must be between {MIN_TEXT_FONT_SIZE_PX} and {MAX_TEXT_FONT_SIZE_PX}."
            ),
            field: "composition.text.fontSizePx".to_string(),
        });
    }

    if !is_valid_hex_color(&request.composition.text.color_hex)
        || !is_valid_hex_color(&request.composition.overlay.theme_color_hex)
    {
        issues.push(VideoRenderValidationIssue {
            code: VideoRenderValidationIssueCode::InvalidComposition,
            message: "Color fields must be #RRGGBB.".to_string(),
            field: "composition".to_string(),
        });
    }

    if request.composition.overlay.style != "waveform_strip" {
        issues.push(VideoRenderValidationIssue {
            code: VideoRenderValidationIssueCode::InvalidComposition,
            message: "overlay.style must be waveform_strip in Stage 8.".to_string(),
            field: "composition.overlay.style".to_string(),
        });
    }

    if !matches!(
        request.composition.overlay.position.as_str(),
        "top" | "bottom"
    ) {
        issues.push(VideoRenderValidationIssue {
            code: VideoRenderValidationIssueCode::InvalidComposition,
            message: "overlay.position must be top or bottom.".to_string(),
            field: "composition.overlay.position".to_string(),
        });
    }

    if !is_unit_interval(request.composition.overlay.opacity)
        || !is_unit_interval(request.composition.overlay.intensity)
        || !is_unit_interval(request.composition.overlay.smoothing)
    {
        issues.push(VideoRenderValidationIssue {
            code: VideoRenderValidationIssueCode::InvalidComposition,
            message: "overlay.opacity/intensity/smoothing must be between 0 and 1.".to_string(),
            field: "composition.overlay".to_string(),
        });
    }

    if request.output.preset_id.trim().is_empty() {
        issues.push(VideoRenderValidationIssue {
            code: VideoRenderValidationIssueCode::InvalidOutputFormat,
            message: "output.presetId is required.".to_string(),
            field: "output.presetId".to_string(),
        });
    }

    if !matches!(
        request.output.overwrite_policy.as_str(),
        "disallow" | "replace"
    ) {
        issues.push(VideoRenderValidationIssue {
            code: VideoRenderValidationIssueCode::InvalidOutputFormat,
            message: "output.overwritePolicy must be disallow or replace.".to_string(),
            field: "output.overwritePolicy".to_string(),
        });
    }

    if request.output.video_bitrate_kbps == 0 || request.output.audio_bitrate_kbps == 0 {
        issues.push(VideoRenderValidationIssue {
            code: VideoRenderValidationIssueCode::InvalidOutputFormat,
            message: "output bitrate values must be greater than zero.".to_string(),
            field: "output".to_string(),
        });
    }

    if request.output.container != "mp4"
        || request.output.video_codec != "h264"
        || request.output.audio_codec != "aac"
        || request.output.pixel_format != "yuv420p"
    {
        issues.push(VideoRenderValidationIssue {
            code: VideoRenderValidationIssueCode::InvalidOutputFormat,
            message: "Output format must be mp4/h264/aac/yuv420p.".to_string(),
            field: "output".to_string(),
        });
    }

    issues
}

fn is_unit_interval(value: f32) -> bool {
    value.is_finite() && (0.0..=1.0).contains(&value)
}

fn is_valid_hex_color(value: &str) -> bool {
    let value = value.trim();
    value.len() == 7
        && value.starts_with('#')
        && value[1..].chars().all(|ch| ch.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;
    use std::time::{Duration, Instant};

    #[derive(Clone)]
    struct MockRunner {
        mode: MockRunnerMode,
    }

    #[derive(Clone)]
    enum MockRunnerMode {
        Success,
        WaitForCancel,
        Failure(VideoRenderFailureCode),
    }

    impl VideoRenderJobRunner for MockRunner {
        fn run_job(
            &self,
            job_id: &str,
            request: &VideoRenderRequest,
            cancel_requested: Arc<AtomicBool>,
            on_progress: &mut dyn FnMut(VideoRenderProgressEvent),
        ) -> VideoRenderJobOutcome {
            match self.mode {
                MockRunnerMode::Success => {
                    on_progress(VideoRenderProgressEvent {
                        state: VideoRenderJobState::Running,
                        percent: 70.0,
                        stage: "mock_encode".to_string(),
                        frame_index: Some(700),
                        total_frames: Some(1000),
                        encoded_seconds: Some(20.0),
                        message: Some("Mock encoding.".to_string()),
                    });
                    thread::sleep(Duration::from_millis(20));
                    VideoRenderJobOutcome::Success(VideoRenderSuccess {
                        job_id: job_id.to_string(),
                        output_path: request.output.output_file_path.clone(),
                        duration_seconds: 30.0,
                        file_size_bytes: 1024,
                        completed_at_utc: now_utc_stub(),
                    })
                }
                MockRunnerMode::WaitForCancel => {
                    on_progress(VideoRenderProgressEvent {
                        state: VideoRenderJobState::Running,
                        percent: 20.0,
                        stage: "mock_wait_cancel".to_string(),
                        frame_index: Some(200),
                        total_frames: Some(1000),
                        encoded_seconds: Some(6.0),
                        message: Some("Waiting for cancel.".to_string()),
                    });

                    let deadline = Instant::now() + Duration::from_secs(2);
                    while !cancel_requested.load(Ordering::SeqCst) && Instant::now() < deadline {
                        thread::sleep(Duration::from_millis(10));
                    }

                    if cancel_requested.load(Ordering::SeqCst) {
                        VideoRenderJobOutcome::Failure(make_failure(
                            Some(job_id.to_string()),
                            VideoRenderFailureCode::CanceledByUser,
                            "Render canceled by user.",
                            true,
                            None,
                        ))
                    } else {
                        VideoRenderJobOutcome::Success(VideoRenderSuccess {
                            job_id: job_id.to_string(),
                            output_path: request.output.output_file_path.clone(),
                            duration_seconds: 30.0,
                            file_size_bytes: 2048,
                            completed_at_utc: now_utc_stub(),
                        })
                    }
                }
                MockRunnerMode::Failure(code) => VideoRenderJobOutcome::Failure(make_failure(
                    Some(job_id.to_string()),
                    code,
                    "Mock render failed.",
                    false,
                    None,
                )),
            }
        }
    }

    fn request_fixture() -> VideoRenderRequest {
        VideoRenderRequest {
            request_version: 1,
            request_id: "vwreq_stage8_fixture".to_string(),
            media: VideoRenderMediaInput {
                image_file_name: "C:\\Fixtures\\cover.png".to_string(),
                audio_file_name: "C:\\Fixtures\\mix.wav".to_string(),
                image_extension: "png".to_string(),
                audio_extension: "wav".to_string(),
            },
            composition: VideoRenderCompositionInput {
                width_px: 1920,
                height_px: 1080,
                frame_rate: 30,
                fit_mode: "fill_crop".to_string(),
                text: VideoRenderTextInput {
                    enabled: false,
                    preset: "none".to_string(),
                    title_text: String::new(),
                    artist_text: String::new(),
                    font_size_px: 34,
                    color_hex: "#ffffff".to_string(),
                },
                overlay: VideoRenderOverlayInput {
                    enabled: false,
                    style: "waveform_strip".to_string(),
                    opacity: 0.32,
                    intensity: 0.5,
                    smoothing: 0.45,
                    position: "bottom".to_string(),
                    theme_color_hex: "#44c8ff".to_string(),
                },
            },
            output: VideoRenderOutputInput {
                preset_id: "youtube_1080p_standard".to_string(),
                output_file_path: "C:\\Exports\\session-01.mp4".to_string(),
                overwrite_policy: "replace".to_string(),
                container: "mp4".to_string(),
                video_codec: "h264".to_string(),
                audio_codec: "aac".to_string(),
                pixel_format: "yuv420p".to_string(),
                video_bitrate_kbps: 8000,
                audio_bitrate_kbps: 192,
            },
        }
    }

    fn wait_for_terminal(runtime: &VideoRenderRuntime, job_id: &str) -> VideoRenderJobState {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let status = runtime
                .get_render_status(job_id)
                .expect("status should resolve");
            if status.state.is_terminal() {
                return status.state;
            }
            if Instant::now() > deadline {
                panic!("job did not reach terminal state in time");
            }
            thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn validate_request_reports_missing_media_and_output_path() {
        let runtime = VideoRenderRuntime::with_runner(Arc::new(MockRunner {
            mode: MockRunnerMode::Success,
        }));
        let mut request = request_fixture();
        request.media.image_file_name = "".to_string();
        request.media.audio_file_name = "".to_string();
        request.output.output_file_path = "".to_string();

        let response = runtime
            .validate_request(request)
            .expect("validation should not fail hard");
        assert!(!response.ok);
        assert!(response
            .issues
            .iter()
            .any(|issue| issue.code == VideoRenderValidationIssueCode::MissingImage));
        assert!(response
            .issues
            .iter()
            .any(|issue| issue.code == VideoRenderValidationIssueCode::MissingAudio));
        assert!(response
            .issues
            .iter()
            .any(|issue| issue.code == VideoRenderValidationIssueCode::InvalidOutputPath));
    }

    #[test]
    fn start_render_rejects_invalid_request_with_structured_error() {
        let runtime = VideoRenderRuntime::with_runner(Arc::new(MockRunner {
            mode: MockRunnerMode::Success,
        }));
        let mut request = request_fixture();
        request.output.container = "mov".to_string();

        let error = runtime
            .start_render(request)
            .expect_err("invalid request should fail start");
        assert_eq!(error.code, app_error_codes::VIDEO_RENDER_INVALID_REQUEST);
        assert_eq!(error.message, "render request validation failed");
    }

    #[test]
    fn status_progresses_to_success_with_mock_runner() {
        let runtime = VideoRenderRuntime::with_runner(Arc::new(MockRunner {
            mode: MockRunnerMode::Success,
        }));
        let start = runtime
            .start_render(request_fixture())
            .expect("start should succeed");
        assert_eq!(
            wait_for_terminal(&runtime, &start.job_id),
            VideoRenderJobState::Succeeded
        );

        let result = runtime
            .get_render_result(&start.job_id)
            .expect("result should resolve");
        assert_eq!(result.state, VideoRenderJobState::Succeeded);
        assert!(result.success.is_some());
        assert!(result.failure.is_none());
    }

    #[test]
    fn cancel_transitions_running_job_to_canceled_state() {
        let runtime = VideoRenderRuntime::with_runner(Arc::new(MockRunner {
            mode: MockRunnerMode::WaitForCancel,
        }));
        let start = runtime
            .start_render(request_fixture())
            .expect("start should succeed");
        let cancel = runtime
            .cancel_render(&start.job_id)
            .expect("cancel should succeed");
        assert!(cancel.canceled);

        assert_eq!(
            wait_for_terminal(&runtime, &start.job_id),
            VideoRenderJobState::Canceled
        );
    }

    #[test]
    fn start_rejects_second_active_job_until_first_finishes() {
        let runtime = VideoRenderRuntime::with_runner(Arc::new(MockRunner {
            mode: MockRunnerMode::WaitForCancel,
        }));
        let start_a = runtime
            .start_render(request_fixture())
            .expect("first start should succeed");

        let conflict = runtime
            .start_render(request_fixture())
            .expect_err("second start should conflict");
        assert_eq!(conflict.code, app_error_codes::VIDEO_RENDER_JOB_CONFLICT);

        runtime
            .cancel_render(&start_a.job_id)
            .expect("cancel should succeed");
        assert_eq!(
            wait_for_terminal(&runtime, &start_a.job_id),
            VideoRenderJobState::Canceled
        );

        let start_b = runtime
            .start_render(request_fixture())
            .expect("start should succeed after terminal");
        assert_ne!(start_a.job_id, start_b.job_id);
    }

    #[test]
    fn failed_runner_sets_failed_terminal_state() {
        let runtime = VideoRenderRuntime::with_runner(Arc::new(MockRunner {
            mode: MockRunnerMode::Failure(VideoRenderFailureCode::EncoderFailed),
        }));

        let start = runtime
            .start_render(request_fixture())
            .expect("start should succeed");
        assert_eq!(
            wait_for_terminal(&runtime, &start.job_id),
            VideoRenderJobState::Failed
        );

        let result = runtime
            .get_render_result(&start.job_id)
            .expect("result should resolve");
        assert_eq!(result.state, VideoRenderJobState::Failed);
        assert_eq!(
            result.failure.expect("failure payload should exist").code,
            VideoRenderFailureCode::EncoderFailed
        );
    }

    #[test]
    fn ffmpeg_runner_integration_renders_mp4_when_ffmpeg_available() {
        let ffmpeg_available = Command::new("ffmpeg")
            .arg("-version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        if !ffmpeg_available {
            return;
        }

        let temp_dir = tempfile::tempdir().expect("temp dir should be created");
        let image_path = temp_dir.path().join("cover.png");
        let audio_path = temp_dir.path().join("tone.wav");
        let output_path = temp_dir.path().join("rendered.mp4");

        let image_status = Command::new("ffmpeg")
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-f")
            .arg("lavfi")
            .arg("-i")
            .arg("color=c=0x1f6feb:s=640x360")
            .arg("-frames:v")
            .arg("1")
            .arg(image_path.as_os_str())
            .status()
            .expect("ffmpeg should generate sample image");
        assert!(image_status.success());

        let audio_status = Command::new("ffmpeg")
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-f")
            .arg("lavfi")
            .arg("-i")
            .arg("sine=frequency=440:sample_rate=48000:duration=1.5")
            .arg("-ac")
            .arg("2")
            .arg(audio_path.as_os_str())
            .status()
            .expect("ffmpeg should generate sample wav");
        assert!(audio_status.success());

        let runtime = VideoRenderRuntime::with_runner(Arc::new(FfmpegVideoRenderJobRunner));
        let mut request = request_fixture();
        request.media.image_file_name = path_to_string(&image_path);
        request.media.audio_file_name = path_to_string(&audio_path);
        request.output.output_file_path = path_to_string(&output_path);

        let start = runtime.start_render(request).expect("start should succeed");
        assert_eq!(
            wait_for_terminal(&runtime, &start.job_id),
            VideoRenderJobState::Succeeded
        );

        let result = runtime
            .get_render_result(&start.job_id)
            .expect("result should resolve");
        assert_eq!(result.state, VideoRenderJobState::Succeeded);
        assert!(result.success.is_some());

        let metadata = std::fs::metadata(output_path).expect("rendered output should exist");
        assert!(metadata.len() > 0);
    }
}


