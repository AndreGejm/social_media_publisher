# BACKEND_VIDEO_RENDER_SERVICE_SPEC

## 1. Module identity

- Module name: `backend-video-render-service`
- Layer: Rust backend bounded runtime service
- Spec version: `1.0.0`
- Spec status: `DESIGN_READY`
- Planned command boundary entrypoint: `apps/desktop/src-tauri/src/commands/video_render.rs`
- Planned service boundary entrypoint: `apps/desktop/src-tauri/src/commands/backend_video_render_service.rs`

Ownership rule:
- This module is the single owner of render-job validation, render execution lifecycle, progress truth, cancellation behavior, and backend render error mapping.

## 2. Architectural position

```text
Frontend video-workspace
  -> services/tauri/video (typed bridge)
    -> commands/video_render.rs
      -> backend-video-render-service
        -> ffmpeg adapter + filesystem
```

Responsibilities by layer:
- Frontend: request composition and UX.
- Bridge: typed IPC mapping and sanitization.
- Command boundary: argument shape validation and service delegation.
- `backend-video-render-service`: deterministic render runtime and progress source of truth.

## 3. Runtime responsibilities

Owned responsibilities:
- Parse and validate render request.
- Resolve input/output paths and output naming.
- Execute deterministic render pipeline for MVP:
  - still image + audio
  - optional text layer
  - optional single overlay style
  - YouTube preset encoding defaults
- Emit structured progress snapshots.
- Handle cancel request deterministically.
- Emit structured result or structured error.

Explicit non-goals:
- UI composition logic.
- Arbitrary timeline editing.
- Multiple concurrent render jobs in MVP.
- Upload or distribution workflows.

## 4. Public service interface (Stage 0 contract)

```rust
pub type VideoRenderServiceResult<T> = Result<T, VideoRenderServiceError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VideoRenderJobState {
    Idle,
    Validating,
    Starting,
    Running,
    Finalizing,
    Succeeded,
    Failed,
    Canceled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VideoRenderFailureCode {
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
pub struct VideoRenderJobId(pub String);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoRenderProgressSnapshot {
    pub job_id: VideoRenderJobId,
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
pub struct VideoRenderSuccess {
    pub job_id: VideoRenderJobId,
    pub output_path: String,
    pub duration_seconds: f64,
    pub file_size_bytes: u64,
    pub completed_at_utc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoRenderFailure {
    pub job_id: Option<VideoRenderJobId>,
    pub code: VideoRenderFailureCode,
    pub message: String,
    pub retryable: bool,
    pub details: Option<serde_json::Value>,
}

pub trait BackendVideoRenderServiceApi: Send + Sync {
    fn validate_render_request(
        &self,
        request: VideoRenderRequest
    ) -> VideoRenderServiceResult<ValidatedVideoRenderRequest>;

    fn start_render(
        &self,
        request: VideoRenderRequest
    ) -> VideoRenderServiceResult<VideoRenderJobId>;

    fn get_render_status(
        &self,
        job_id: &VideoRenderJobId
    ) -> VideoRenderServiceResult<VideoRenderProgressSnapshot>;

    fn cancel_render(
        &self,
        job_id: &VideoRenderJobId
    ) -> VideoRenderServiceResult<()>;

    fn get_render_result(
        &self,
        job_id: &VideoRenderJobId
    ) -> VideoRenderServiceResult<Result<VideoRenderSuccess, VideoRenderFailure>>;
}
```

## 5. Request validation policy

Validation must enforce:
- one image input path (existing readable file)
- one audio input path (existing readable file)
- allowed image extensions: `.jpg`, `.jpeg`, `.png`
- allowed audio extensions for MVP: `.wav`
- output path parent exists and is writable
- selected output preset is known and supported
- overlay style is either `none` or `waveform_strip` for MVP
- text fields length and bounds are within documented limits

On validation failure:
- no render job is created
- return `VideoRenderFailureCode::InvalidRequest` or specific code

## 6. Concurrency and job policy

MVP policy:
- single active render job per application runtime.
- second `start_render` call while one job is active returns deterministic error:
  - `VideoRenderFailureCode::InternalInvariantViolation`
  - message: "A render job is already running"

Cancellation policy:
- cancel is best-effort but deterministic:
  - if job is `Running|Starting|Finalizing`, transition to `Canceled`
  - if job already terminal, cancel is idempotent no-op success

Progress policy:
- progress snapshots are monotonic in `percent`.
- terminal states are immutable once reached.

## 7. Render pipeline contract (MVP)

Ordered pipeline:
1. Validate request
2. Probe media metadata
3. Resolve output plan from preset
4. Build filter graph (image + optional text + optional overlay)
5. Start encoder process/pipeline
6. Emit progress snapshots until terminal state
7. Publish final success/failure result

Output defaults for MVP:
- container: MP4
- video codec: H.264
- pixel format: yuv420p
- frame rate: 30 fps
- audio codec: AAC

## 8. Integration contract with command layer

`commands/video_render.rs` is thin glue only:
- map IPC input to `VideoRenderRequest`
- call service API
- sanitize and map errors to stable UI error envelope

Commands planned:
- `video_render_validate`
- `video_render_start`
- `video_render_status`
- `video_render_cancel`
- `video_render_result`

Command layer forbidden behavior:
- no ffmpeg command composition
- no media-path business logic beyond basic argument sanitation
- no render-state mutation outside service API

## 9. Error taxonomy and UI mapping

Backend error envelope:
- code: stable machine-readable enum
- message: sanitized human-readable text
- retryable: boolean
- details: optional bounded object

Frontend mapping target (through bridge):
- `INVALID_REQUEST`
- `UNSUPPORTED_MEDIA`
- `INPUT_IO_FAILURE`
- `OUTPUT_IO_FAILURE`
- `ENCODER_FAILURE`
- `RENDER_IN_PROGRESS_CONFLICT`
- `RENDER_CANCELED`
- `UNEXPECTED_BACKEND_ERROR`

## 10. Invariants

- backend is source of truth for render status.
- render result can only be terminal once.
- output file is never marked success unless file exists and size > 0.
- no partial success response.
- progress cannot regress.
- request hash and job id binding remains stable for a given started job.

## 11. Required tests (future stages)

Unit tests:
- request validation matrix (happy and failure cases)
- preset-to-encoder mapping determinism
- progress state transition legality
- error mapping coverage

Integration tests:
- start/status/result happy path
- cancellation path
- invalid input path failure
- output file existence check on success

Contract tests:
- command response shape compatibility
- frontend bridge parser compatibility with backend payloads

## 12. Candidate file scope (planned)

- `apps/desktop/src-tauri/src/commands/video_render.rs`
- `apps/desktop/src-tauri/src/commands/backend_video_render_service.rs`
- `apps/desktop/src-tauri/src/commands/backend_video_render_service/runtime.rs`
- `apps/desktop/src-tauri/src/commands/backend_video_render_service/runtime/validate.rs`
- `apps/desktop/src-tauri/src/commands/backend_video_render_service/runtime/pipeline.rs`
- `apps/desktop/src-tauri/src/commands/backend_video_render_service/runtime/status.rs`
- `apps/desktop/src-tauri/src/commands/backend_video_render_service/runtime/error.rs`


