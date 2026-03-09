# MODULE_SPEC: backend-audio-service

## 1. Module Identity

- Module name: `backend-audio-service`
- Layer: Rust backend runtime module
- Architectural role: deterministic native audio runtime and playback state owner
- Public entrypoint: `apps/desktop/src-tauri/src/backend_audio_service/mod.rs`
- Ownership boundary: this module is the single authoritative owner of playback runtime state, output mode state, decode state, and render-loop lifecycle.

Authoritative ownership rule:
- `backend-audio-service` is the only module allowed to mutate playback runtime context.
- Command handlers can request state changes only through the service API.

## 2. Architectural Position

Runtime stack:

```text
Frontend (React)
  -> Tauri command handlers (commands/playback.rs)
    -> backend-audio-service
      -> OS audio APIs (WASAPI) + decode/resample libraries
```

Layer responsibilities:
- Frontend: expresses intent, renders status, never directly controls audio device.
- Tauri command handlers: argument validation, service-call mapping, error envelope translation.
- backend-audio-service: runtime state machine, device/session lifecycle, decode/render pipeline, deterministic behavior under concurrency.
- OS/decode layer: hardware interaction and media decode primitives only.

## 3. Runtime Responsibilities

Owned responsibilities:
- Device acquisition and release for shared and exclusive output.
- Playback control plane state.
- Queue ownership for playback runtime.
- Track decode preparation and decode error tracking.
- Render loop lifecycle and frame cursor updates.
- Output mode switching policy and fallback behavior.
- Playback context/status derivation for IPC.
- Bit-perfect eligibility calculation with explicit reason codes.

Explicit non-responsibilities:
- UI concerns, window focus policy, or frontend notifications.
- Catalog/library/release orchestration domains.
- Direct Tauri command registration concerns.
- Any mutation of frontend state.

## 4. Public Service Interface

### 4.1 Canonical Rust API

```rust
pub type AudioServiceResult<T> = Result<T, AudioServiceError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputMode {
    Shared,
    Exclusive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputRuntimeMode {
    Released,
    Shared,
    Exclusive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeLifecycleState {
    Uninitialized,
    ReadyReleased,
    ReadyShared,
    ReadyExclusive,
    PlayingShared,
    PlayingExclusive,
    PausedShared,
    PausedExclusive,
    FaultedRecoverable,
    FaultedTerminal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BitPerfectReasonCode {
    NotExclusiveMode,
    VolumeNotUnity,
    SoftwareGainActive,
    SoftwareResamplerActive,
    BitDepthMismatch,
    SourceBitDepthUnknown,
    NoDecodedTrackArmed,
    NoNativeStream,
    SoftwarePcmPathNote,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybackOutputStatus {
    pub requested_mode: OutputMode,
    pub active_mode: OutputRuntimeMode,
    pub sample_rate_hz: Option<u32>,
    pub bit_depth: Option<u16>,
    pub bit_perfect_eligible: bool,
    pub reason_codes: Vec<BitPerfectReasonCode>,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitializeOutputRequest {
    pub target_mode: OutputMode,
    pub target_sample_rate_hz: u32,
    pub target_bit_depth: u16,
    pub allow_shared_fallback: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitializeOutputResult {
    pub requested_mode: OutputMode,
    pub active_mode: OutputRuntimeMode,
    pub hardware: Option<AudioHardwareState>,
    pub fallback_applied: bool,
    pub format_fallback_applied: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybackQueueState {
    pub total_tracks: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackChangeRequestResult {
    pub accepted: bool,
    pub request_id: u64,
    pub queued_requests: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecodeErrorInfo {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDeviceContextSnapshot {
    pub current_lock_state: OutputRuntimeMode,
    pub user_prefers_exclusive: bool,
    pub is_playing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybackContextSnapshot {
    pub revision: u64,
    pub lifecycle_state: RuntimeLifecycleState,
    pub volume_scalar: f32,
    pub is_bit_perfect_bypassed: bool,
    pub output_status: PlaybackOutputStatus,
    pub active_queue_index: u32,
    pub queued_track_change_requests: usize,
    pub is_queue_ui_expanded: bool,
    pub is_playing: bool,
    pub position_seconds: f64,
    pub track_duration_seconds: f64,
    pub decode_error: Option<DecodeErrorInfo>,
}

pub trait BackendAudioServiceApi: Send + Sync {
    fn initialize_output(&self, request: InitializeOutputRequest) -> AudioServiceResult<InitializeOutputResult>;
    fn release_output(&self) -> AudioServiceResult<()>;

    fn set_playback_queue(&self, paths: Vec<String>) -> AudioServiceResult<PlaybackQueueState>;
    fn push_track_change_request(&self, new_index: u32) -> AudioServiceResult<TrackChangeRequestResult>;

    fn set_playback_playing(&self, is_playing: bool) -> AudioServiceResult<()>;
    fn seek_playback_ratio(&self, ratio: f32) -> AudioServiceResult<()>;
    fn set_volume_scalar(&self, level: f32) -> AudioServiceResult<()>;
    fn toggle_queue_visibility(&self) -> AudioServiceResult<bool>;

    fn get_playback_context(&self) -> PlaybackContextSnapshot;
    fn get_playback_decode_error(&self) -> Option<DecodeErrorInfo>;
    fn get_audio_device_context(&self) -> AudioServiceResult<AudioDeviceContextSnapshot>;
}
```

### 4.2 Method behavior contract

| Method | Inputs | Outputs | Possible errors | Blocking behavior | Idempotency |
| --- | --- | --- | --- | --- | --- |
| `initialize_output` | `InitializeOutputRequest` | `InitializeOutputResult` | `InvalidArgument`, `ExclusiveDenied`, `DeviceUnavailable`, `UnsupportedFormat`, `EngineStartTimeout`, `InternalInvariantViolation` | May block during engine startup/shutdown (bounded, max 3s startup wait) | Idempotent for same effective active config |
| `release_output` | none | `()` | `DeviceUnavailable`, `InternalInvariantViolation` | May block on render-thread join (bounded, max 3s) | Idempotent |
| `set_playback_queue` | sanitized path list | `PlaybackQueueState` | `InvalidArgument`, `QueueRejected` | Bounded lock/write; no device I/O | Idempotent by normalized queue contents |
| `push_track_change_request` | `new_index` | `TrackChangeRequestResult` | `QueueRejected`, `InvalidArgument` | Non-blocking enqueue | Not idempotent (new request id each call) |
| `set_playback_playing` | boolean | `()` | `QueueRejected`, `DeviceUnavailable`, `RuntimeNotReady` | Non-blocking state update; no device reinit | Idempotent for same value |
| `seek_playback_ratio` | 0.0..1.0 | `()` | `InvalidArgument`, `QueueRejected` | Non-blocking atomic update | Idempotent for same ratio |
| `set_volume_scalar` | 0.0..1.0 | `()` | `InvalidArgument` | Non-blocking atomic update | Idempotent for same value |
| `toggle_queue_visibility` | none | `bool` (new visibility) | `InternalInvariantViolation` | Non-blocking atomic/lock update | Not idempotent |
| `get_playback_context` | none | `PlaybackContextSnapshot` | none | Non-blocking snapshot read | Read-only |
| `get_playback_decode_error` | none | `Option<DecodeErrorInfo>` | none | Non-blocking snapshot read | Read-only |
| `get_audio_device_context` | none | `AudioDeviceContextSnapshot` | `DeviceUnavailable` | Non-blocking snapshot read | Read-only |

## 5. Playback Context Model

Authoritative model:
- Internal runtime state is held by service-owned atomics/locks.
- External observers receive immutable `PlaybackContextSnapshot` values.

Field contract:

| Field | Type | Nullability | Writer ownership | Update semantics |
| --- | --- | --- | --- | --- |
| `revision` | `u64` | non-null | control-plane mutation path | increments on every successful mutating operation |
| `lifecycle_state` | `RuntimeLifecycleState` | non-null | control-plane mutation path | must match legal state machine transitions |
| `volume_scalar` | `f32` | non-null | command thread via service | range `[0.0, 1.0]`, finite only |
| `is_bit_perfect_bypassed` | `bool` | non-null | service volume update path | `true` only when gain path is bypassed |
| `output_status.requested_mode` | `OutputMode` | non-null | output policy path | caller intent after fallback normalization |
| `output_status.active_mode` | `OutputRuntimeMode` | non-null | device transition path | `released/shared/exclusive` backend truth |
| `output_status.sample_rate_hz` | `Option<u32>` | nullable | device transition path | `None` when no active stream |
| `output_status.bit_depth` | `Option<u16>` | nullable | device transition path | `None` when no active stream |
| `output_status.bit_perfect_eligible` | `bool` | non-null | status derivation path | derived only from current state and reason codes |
| `output_status.reasons` | `Vec<String>` | non-null | status derivation path | deterministic order, sanitized |
| `output_status.reason_codes` | `Vec<BitPerfectReasonCode>` | non-null | status derivation path | deterministic order, machine-readable |
| `active_queue_index` | `u32` | non-null | track-change worker | last applied queue index |
| `queued_track_change_requests` | `usize` | non-null | queue worker metrics | current queue depth |
| `is_queue_ui_expanded` | `bool` | non-null | service toggle path | preserved for transport parity |
| `is_playing` | `bool` | non-null | service play/pause path, render fault path | true only when transport state is playing |
| `position_seconds` | `f64` | non-null | render-thread cursor projection | clamped `0..track_duration_seconds` |
| `track_duration_seconds` | `f64` | non-null | decode stage metadata | `0.0` when no decoded track |
| `decode_error` | `Option<DecodeErrorInfo>` | nullable | decode path | last decode failure, cleared on successful decode |

## 6. Runtime Lifecycle State Machine

### 6.1 States

- `Uninitialized`
- `ReadyReleased`
- `ReadyShared`
- `ReadyExclusive`
- `PlayingShared`
- `PlayingExclusive`
- `PausedShared`
- `PausedExclusive`
- `FaultedRecoverable`
- `FaultedTerminal`

### 6.2 Allowed transitions

- `Uninitialized -> ReadyReleased` (service startup)
- `ReadyReleased -> ReadyShared` (`initialize_output(shared)` success)
- `ReadyReleased -> ReadyExclusive` (`initialize_output(exclusive)` success)
- `ReadyShared -> PlayingShared` (`set_playback_playing(true)` with armed decoded track)
- `ReadyExclusive -> PlayingExclusive` (`set_playback_playing(true)` with armed decoded track)
- `PlayingShared -> PausedShared` (`set_playback_playing(false)`)
- `PlayingExclusive -> PausedExclusive` (`set_playback_playing(false)`)
- `PausedShared -> PlayingShared` (`set_playback_playing(true)`)
- `PausedExclusive -> PlayingExclusive` (`set_playback_playing(true)`)
- `ReadyShared|PausedShared|PlayingShared -> ReadyExclusive` (successful mode switch)
- `ReadyExclusive|PausedExclusive|PlayingExclusive -> ReadyShared` (successful mode switch)
- Any active state -> `ReadyReleased` (`release_output` success)
- Any active state -> `FaultedRecoverable` (device lost/render fatal step error)
- `FaultedRecoverable -> ReadyShared|ReadyExclusive` (successful reinitialization)
- `FaultedRecoverable -> FaultedTerminal` (invariant breach during recovery)

### 6.3 Forbidden transitions

- `Uninitialized -> Playing*`
- `ReadyReleased -> Playing*` (without active device)
- `FaultedTerminal -> any non-terminal state` (requires service restart)
- direct `PlayingShared <-> PlayingExclusive` without explicit output reinitialization

### 6.4 Command behavior by state

- In `ReadyReleased`: `set_playback_playing(true)` must fail with `RuntimeNotReady`.
- In `Playing*`: repeated `set_playback_playing(true)` is a no-op.
- In `Paused*`: repeated `set_playback_playing(false)` is a no-op.
- In `FaultedRecoverable`: mutating transport commands return `DeviceUnavailable` until successful `initialize_output`.
- In `FaultedTerminal`: all mutating commands return `InternalInvariantViolation`.

## 7. Output Mode Policy

Shared mode policy:
- startup default request is shared mode.
- shared mode permits OS mixer/SRC behavior.
- active mode is `shared` only when an initialized stream is running in shared mode.

Exclusive mode policy:
- exclusive mode is opt-in only from explicit command request.
- exclusive acquisition failure must not crash the service.
- exclusive mode requires full device reinitialization.

Switch and fallback policy:
1. Validate request.
2. Build target device config candidates.
3. Attempt to start new engine for target mode.
4. If target mode is exclusive and fails and `allow_shared_fallback=true`, attempt shared initialization once.
5. Swap engines only after new engine startup succeeds (two-phase commit).
6. If all attempts fail:
   - keep previous active engine/context unchanged when available
   - otherwise remain `ReadyReleased` or `FaultedRecoverable` depending on failure class

Device reinitialization rule:
- reinitialize when mode, sample rate, or bit depth target changes.

Bit-perfect eligibility derivation:
- Eligibility must be `true` only when all blocking conditions pass:
  - active mode is exclusive
  - gain path bypassed (`volume_scalar == 1.0` and bypass flag true)
  - no software resampler used for current decoded track
  - source bit depth known and matches active output bit depth
  - native stream active
- Service must append informational note that playback is software-decoded PCM and not encoded bitstream passthrough.

Reason code model:
- Use `BitPerfectReasonCode` from section `4.1 Canonical Rust API`.
- `reason_codes` ordering is deterministic and stable for contract tests.

## 8. Concurrency Model

Execution domains:
- Command domain: concurrent Tauri command calls.
- Decode worker domain: asynchronous track-change/decode processing.
- Render domain: dedicated native audio render thread.

Synchronization model:
- `device_transition_lock` serializes `initialize_output` and `release_output`.
- `state_mutation_lock` serializes multi-field mutations that must commit atomically.
- Atomics for high-frequency scalar/flag/cursor values.
- `RwLock` for complex state (`queue`, `decoded_track`, `hardware_state`, `decode_error`).

Locking rules:
- Never hold a write lock while performing blocking OS audio calls.
- Global lock order for nested locks (strict):
  1. `device_transition_lock`
  2. `state_mutation_lock`
  3. `audio_engine` lock
  4. `hardware_state` lock
  5. `queue/decoded/decode_error` locks
- Render thread must not take `device_transition_lock`.

Frame-boundary update rules:
- `playback_frame_cursor` updates occur only at render-frame commit boundaries.
- `get_playback_context` reads cursor atomically and projects position deterministically.

Blocking model:
- Potentially blocking: `initialize_output`, `release_output`.
- Non-blocking (bounded, lock-only): queue set, play/pause, seek, volume, context/decode reads.
- Decode happens outside command handlers.

Race handling:
- Track-change queue is processed as last-write-wins for pending requests (drain-and-apply-latest policy).
- Stale track-change requests are observable through `request_id` and `last_applied` progression.

## 9. Decode and Render Pipeline

Pipeline stages:
1. Decode stage:
   - decode source media to interleaved stereo `f32` PCM
   - capture source metadata (sample rate, source bit depth, frame count)
2. Optional resample stage:
   - when source sample rate differs from active hardware sample rate
   - mark `used_software_resampler=true`
3. Render stage:
   - quantize PCM to active output bit depth (16/24/32)
   - fill output buffer, silence-fill when paused or no track

Format negotiation:
- Target format is `(sample_rate_hz, bit_depth, channel_count=2)`.
- Candidate fallback formats are deterministic and ordered.
- Selected format is returned in `AudioHardwareState`.

Buffer strategy:
- One active decoded track buffer at a time.
- Cursor-based sequential frame read.
- Underflow/no-track path renders silence.

Timing model:
- Render loop runs at fixed short sleep interval (2 ms target).
- Buffer write size determined by API-reported available frames.

Error recovery behavior:
- Decode error: set `decode_error`, keep runtime alive, do not crash render thread.
- Render/device API error: transition to `FaultedRecoverable`, stop stream safely.
- Recovery requires explicit `initialize_output`.

## 10. Error Taxonomy

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioServiceErrorCode {
    InvalidArgument,
    RuntimeNotReady,
    QueueRejected,
    ExclusiveDenied,
    DeviceUnavailable,
    DeviceLost,
    UnsupportedFormat,
    EngineStartTimeout,
    DecodeFailed,
    StreamError,
    LockPoisoned,
    InternalInvariantViolation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorRecoverability {
    Recoverable,
    Retryable,
    Fatal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioServiceError {
    pub code: AudioServiceErrorCode,
    pub message: String,
    pub details: Option<serde_json::Value>,
    pub recoverability: ErrorRecoverability,
}
```

Classification requirements:
- Recoverable: invalid args, queue rejected, decode failed.
- Retryable: exclusive denied, unsupported format, transient device unavailable.
- Fatal: lock poisoning or invariant violation.

IPC mapping requirement:
- Command layer maps `AudioServiceErrorCode` to stable `AppError.code` values.
- Error message/details must be sanitized before crossing IPC boundary.

## 11. Integration Contract with Commands

Command handlers in `commands/playback.rs` must be thin adapters only.

Command to service mapping:

| Command | Service method |
| --- | --- |
| `set_volume` | `set_volume_scalar` |
| `set_playback_queue` | `set_playback_queue` |
| `push_track_change_request` | `push_track_change_request` |
| `set_playback_playing` | `set_playback_playing` |
| `seek_playback_ratio` | `seek_playback_ratio` |
| `toggle_queue_visibility` | `toggle_queue_visibility` |
| `init_exclusive_device` | `initialize_output` (mode derived from `prefer_exclusive`) |
| `acquire_audio_device_lock` | `initialize_output` |
| `release_audio_device_lock` | `release_output` |
| `get_audio_device_context` | `get_audio_device_context` |
| `get_playback_context` | `get_playback_context` |
| `get_playback_decode_error` | `get_playback_decode_error` |

Integration rules:
- Commands must not mutate playback state directly.
- Commands must not call OS audio APIs directly.
- Concurrent command invocations are allowed; service enforces serialization for conflicting operations.
- Conflicting operations (`initialize_output`, `release_output`) must never run concurrently.

## 12. Invariants

- Backend playback context is the sole source of truth for output and transport status.
- Device acquisition and release are serialized.
- Render loop exclusively owns stream start/stop lifecycle once engine is active.
- Exclusive failure never panics process; runtime remains recoverable.
- If fallback succeeds, `active_mode` reflects fallback mode immediately.
- Decode failures do not crash render thread.
- `position_seconds` is always finite and clamped within duration.
- `volume_scalar` is always finite in range `[0.0, 1.0]`.
- Queue mutations and applied track index updates are deterministic.
- Every mutating operation increments context revision exactly once.

## 13. Refactor Guardrails

- Command layer cannot import private `backend_audio_service::*` internals.
- Only `backend_audio_service/mod.rs` public exports are allowed at command boundary.
- UI/frontend cannot call native audio APIs directly.
- Only this service may mutate runtime playback context.
- Device I/O code must stay in runtime/render/output modules, never command handlers.
- New command endpoints must map to existing service contracts or require explicit spec version bump.

## 14. Test Requirements

Mandatory unit tests:
- Device initialization validation (rate/bit-depth bounds and mode validation).
- Idempotency tests (`initialize_output`, `release_output`, `set_playback_playing`, `set_volume_scalar`).
- Lifecycle transition legality and forbidden transitions.
- Bit-perfect eligibility reason-code derivation.
- Error classification and IPC mapping sanitization.

Mandatory integration/runtime tests:
- Shared startup acquisition path.
- Exclusive acquisition success path.
- Exclusive failure with shared fallback enabled.
- Exclusive failure with fallback disabled preserves previous engine.
- Mode switching while playback active (deterministic pause/resume behavior per contract).
- Queue update + rapid track-change requests (last-write-wins behavior).
- Decode failure path keeps runtime alive and returns structured decode error.
- Render thread startup timeout and shutdown behavior.
- Concurrent command stress test for deterministic final context revision and state.

Test architecture requirements:
- Unit tests run against pure control/status logic without OS device dependency.
- Integration tests use adapter seams for audio backend where possible.
- Windows-specific WASAPI tests are isolated and feature-gated.

## 15. Implementation Structure

Target module structure:

```text
apps/desktop/src-tauri/src/backend_audio_service/
  mod.rs
  api.rs
  error.rs
  types.rs
  control_plane.rs
  output_mode.rs
  decode.rs
  render.rs
  status.rs
```

Ownership by file:
- `mod.rs`: public exports, service construction, dependency wiring.
- `api.rs`: `BackendAudioServiceApi` trait and method contracts.
- `error.rs`: typed errors, recoverability, IPC mapping helpers.
- `types.rs`: shared service data models and enums.
- `control_plane.rs`: lifecycle state machine, command serialization, queue and transport state.
- `output_mode.rs`: output initialization/release and fallback policy.
- `decode.rs`: decode and optional resample pipeline.
- `render.rs`: render thread lifecycle and buffer writing.
- `status.rs`: context snapshot and bit-perfect eligibility derivation.

Boundary enforcement:
- `commands/playback.rs` imports only `backend_audio_service::api` public surface.
- No cross-domain imports (catalog/release/qc) into this module.


