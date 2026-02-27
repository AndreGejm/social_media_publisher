# Theory of Operation

## Revision History

| Version | Date | Author | Description of Changes |
| --- | --- | --- | --- |
| v1.0.1 | 2026-02-27 | Platform Engineering (Codex) | Clarified pipeline semantics as `Plan -> QC -> Execute -> Audit/Remote Verify`; added Catalog Subsystem definition; documented shared-transport I/O handoff rules; clarified backend-authoritative spec parsing/validation path. |
| v1.0.0 | 2026-02-26 | Platform Engineering (Codex) | Initial Theory of Operation covering frontend, IPC boundary, Rust backend, SQLite WAL persistence, audio analysis circuitry, idempotency, state machine, and error strategy. |

## 1. System Overview

This application is an offline-first desktop Music Asset Management system built with Tauri, Rust, React, and SQLite. It combines two tightly related operating modes:

- Listen and Library mode for local catalog ingest, browsing, metadata editing, queueing, and playback.
- Publish mode for deterministic release orchestration through a strict state machine (`Plan -> QC -> Execute -> Audit/Remote Verify`) using a mock transport.

Core design intent:

- Reliability first: deterministic state transitions, strict validation at boundaries, typed errors, and retry for lock contention.
- Security first: frontend is treated as untrusted input, backend enforces validation and authorization scope.
- Offline first: all core operations work without network dependencies.
- Auditability: release artifacts, descriptors, and reports are persisted locally and reloadable.

## 2. Design Philosophy

### 2.1 Offline-first and deterministic

- Local SQLite is the source of truth.
- Release identity and idempotency are deterministic (`BLAKE3` over normalized materials).
- Publisher workflow is replayable and resumable from persisted state.

### 2.2 Strict boundary control

- IPC input is validated as hostile.
- Command payloads are typed and constrained.
- Errors are machine-readable and user-safe.

### 2.3 Separation of concerns

- Frontend handles interaction and presentation.
- Rust backend handles orchestration, validation, persistence, and audio analysis.
- IPC layer is narrow and explicit.

## 3. Architectural Components

## 3.1 Frontend (React)

Primary shell:

- Top mode switch: `Listen` and `Publish`.
- Listen workspaces: `Library`, `Tracks`, `Albums`, `Playlists`, `Settings`.
- Publish workspace host: `Publisher Ops` with shell-level step tabs.
- Persistent global transport dock at the bottom.
- Persistent right dock switching context:
  - Listen: playback queue
  - Publish: release selection queue

QC and waveform:

- `QcPlayer` consumes precomputed backend analysis (peaks and loudness).
- Waveform interaction is seek-first (visual inspection plus transport integration).
- Playback dispatches to shared global transport in shell integration.
- Architecture is compatible with Wavesurfer-style rendering contracts because waveform data is backend-precomputed and normalized.

Untrusted UI model:

- Frontend state is convenience only.
- Backend does not trust client-provided values for files, IDs, or metrics.
- UI approval gates are user workflow controls, not backend trust anchors.

## 3.2 IPC Bridge (Tauri)

IPC is exposed through explicit `#[tauri::command]` handlers and a constrained ACL surface.

Command groups include:

- Publisher workflow: `load_spec`, `plan_release`, `execute_release`, `list_history`, `get_report`
- Audio and QC: `analyze_audio_file`, `analyze_and_persist_release_track`, `get_release_track_analysis`
- Catalog and library: `catalog_*`
- Publisher adapter: `publisher_create_draft_from_track`

Boundary hardening patterns:

- `deny_unknown_fields` for critical input structs.
- Length limits (paths, search payloads, peak bins).
- Canonicalization and path policy checks.
- Domain validation for IDs and enums.
- DB row semantic validation before data crosses back to UI.

Security transport and isolation:

- Tauri Isolation Pattern is enabled (`security.pattern.use = "isolation"`).
- App capability is narrowed to audited command permissions.
- CSP is strict in production and controlled in development.

## 3.3 Backend Engine (Rust)

Core modules:

- `crates/core`
  - `orchestrator`: deterministic plan/execute/verify orchestration
  - `idempotency`: BLAKE3-based fingerprint and release ID generation
  - `audio_processor`: native decode + analysis
  - domain models and spec parsing
- `crates/db`
  - typed SQLite access layer
  - migration management
  - state transition enforcement
  - retry helpers for `BusyLocked`

Execution model:

- Async Rust operations via Tokio runtime and Tauri async commands.
- CPU-heavy analysis happens in Rust backend process, isolated from UI thread.
- Panic-avoidance policy in production modules (clippy denies for `unwrap`, `expect`, `panic`).

## 3.4 Persistence Layer (SQLite WAL)

Database characteristics:

- SQLite with WAL journal mode enabled for file-backed deployments.
- Additive migrations:
  - `0001_initial.sql`
  - `0002_run_lock_leases.sql`
  - `0003_release_track_analysis.sql`
  - `0004_catalog_music_core.sql`

Primary persistence domains:

- Release state machine rows and per-platform action rows
- Run locks / lease control
- QC analysis cache
- Catalog entities (tracks, artists, albums, playlists, tags, media assets, ingest jobs/events)

Unidirectional data flow:

1. UI intent -> IPC command
2. Command validation -> core/db operation
3. Persisted result -> typed response
4. UI re-renders from response/state

## 3.5 Catalog Subsystem

Purpose:

- Provide local music-library indexing and authoring independent of publisher pipeline state.

Core entities:

- `library_roots`, `media_assets`, `artists`, `albums`, `tracks`
- `playlists`, `playlist_items`, `tags`, `track_tags`, `album_tags`
- `ingest_jobs`, `ingest_events`

Primary command surface:

- `catalog_add_library_root`, `catalog_remove_library_root`, `catalog_scan_root`, `catalog_get_ingest_job`
- `catalog_import_files`, `catalog_list_tracks`, `catalog_get_track`, `catalog_update_track_metadata`

Design constraints:

- Catalog rows do not depend on release state-machine rows.
- Catalog track metadata and analysis are reusable by Publisher Ops through an adapter (`publisher_create_draft_from_track`).
- Frontend workspace state persistence (local storage) is non-authoritative; SQLite remains source of truth for catalog data.

## 4. Core Data Contracts

Example model contract used across backend and IPC:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Release {
    id: String,
    title: String,
    artist: String,
    tracks: Vec<Track>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Track {
    file_path: String,
    duration_ms: u32,   // invariant: > 0
    peak_data: Vec<f32>,// invariant: finite, non-empty, each <= 0.0 dBFS
    loudness_lufs: f32, // invariant: finite, <= 0.0 LUFS
}
```

Error wire contract (simplified):

```rust
pub struct AppError {
    pub code: String,
    pub message: String,
    pub details: Option<serde_json::Value>,
}
```

Design note:

- Human-readable messages are paired with stable machine codes.
- Sensitive details are redacted before crossing IPC.

## 5. Core Operational Workflows

## 5.1 Audio Circuitry (Decode -> Analyze -> Render)

Objective: produce deterministic, UI-safe QC metrics from local audio files.

Pipeline:

1. Input validation
   - path checked and canonicalized
   - unsupported or malformed inputs rejected early
2. Decode (`symphonia`)
   - decode into interleaved `f32` PCM
   - enforce fixed sample-rate and fixed channel-count stream
   - reject non-finite sample output
3. Loudness (`ebur128`)
   - stream chunks into EBU R128 analyzer
   - compute integrated loudness (LUFS)
   - enforce finite and <= 0.0 result constraints
4. Waveform peaks
   - downsample by frame windows into bounded bins
   - compute max absolute amplitude per bin across channels
   - convert to dBFS: `20 * log10(amplitude)` with floor clamp
   - clamp output to `<= 0.0` and configured floor
5. Persist and return
   - optional DB persistence of analysis
   - frontend receives normalized metrics for fast rendering and seek

Why this works:

- The frontend never computes heavy DSP itself.
- UI remains responsive while using precomputed analysis arrays.
- Same analysis path supports both Library and Publish QC surfaces.

### 5.1.0 Internal Config Contract: `AnalysisConfig::default()`

**Rust signature**

```rust
impl Default for AnalysisConfig {
    fn default() -> Self
}
```

**Purpose**

Defines the canonical default analysis knobs used by production file/in-memory analysis paths when no custom config is supplied.

**Default values**

- `target_peak_bins = 2048`
- `dbfs_floor = -96.0`

**Behavior**

- Returns a deterministic baseline configuration for peak envelope extraction and dBFS clamping.
- Used by `analyze_interleaved_samples(...)` through `AnalysisConfig::default()`.

**Side-effects**

- None.

**Why this exists**

- Keeps waveform density and floor behavior stable across UI and test runs unless explicitly overridden.

### 5.1.1 Function Contract: `analyze_track(...)`

**Rust signature**

```rust
pub fn analyze_track(file_path: impl AsRef<std::path::Path>) -> Result<TrackAnalysis, AudioError>
```

**Purpose**

Single entrypoint for file-based QC analysis. It composes decode + signal analysis into one deterministic call path.

**Inputs**

- `file_path`: local filesystem path to an audio file (`impl AsRef<Path>` for caller flexibility).

**Outputs**

On success, returns `TrackAnalysis` with:

- `duration_ms: u32`
- `peak_data: Vec<f32>` (downsampled dBFS bins)
- `loudness_lufs: f32` (integrated LUFS)
- `sample_rate_hz: u32`
- `channels: u16`

**Behavior**

1. Calls `decode_audio_file(file_path)` to decode interleaved PCM.
2. Calls `analyze_interleaved_samples(...)` to compute LUFS + waveform peaks.
3. Returns typed errors without panic paths in production code.

**Side-effects**

- No DB writes
- No IPC
- No network calls
- File read only (through decode path)

**Error surface (`AudioError`)**

- `Io`: file open/read failures (includes original path context)
- `Unsupported`: unsupported/invalid container/codec scenarios
- `Decode`: decode-stage failures
- `InvalidInput`: invariant failures in analysis inputs
- `Analysis`: loudness/peak computation failures

**Determinism and constraints**

- Deterministic output for identical file bytes and analysis config.
- Enforces bounded/normalized metrics suitable for UI rendering and QC gating.

### 5.1.2 Function Contract: `decode_audio_file(...)`

**Rust signature**

```rust
pub fn decode_audio_file(file_path: impl AsRef<std::path::Path>) -> Result<DecodedAudio, AudioError>
```

**Purpose**

Decodes an audio file into interleaved `f32` PCM samples using `symphonia`, while enforcing deterministic stream constraints required by downstream QC analysis.

**Inputs**

- `file_path`: local filesystem path to an audio file.

**Outputs**

On success, returns `DecodedAudio` with:

- `sample_rate_hz: u32`
- `channels: u16`
- `interleaved_samples: Vec<f32>`

**Behavior**

1. Opens file and probes container/track with `symphonia`.
2. Selects default audio track and creates decoder.
3. Iterates demux packets and decodes PCM frames.
4. Rejects mid-stream variability:
   - variable sample rate
   - variable channel count
5. Rejects invalid decode outputs:
   - zero channels / zero sample rate
   - non-finite samples
   - sample buffer not aligned to channel count
6. Returns normalized interleaved PCM suitable for `analyze_interleaved_samples(...)`.

**Side-effects**

- File read only.
- No DB writes, no IPC, no network calls.

**Error surface (`AudioError`)**

- `Io`: file open/read failures with path context.
- `Unsupported`: unsupported format/no default audio track.
- `Decode`: probe/decode/demux failures or invalid stream characteristics.
- `InvalidInput`: post-decode invariant failures.

**Determinism and safety guarantees**

- For identical file bytes and codec behavior, decoded output is deterministic.
- Corrupt frames may be skipped where safe; fatal decode/stream-shape violations return typed errors.

### 5.1.3 Function Contract: `analyze_interleaved_samples(...)`

**Rust signature**

```rust
pub fn analyze_interleaved_samples(
    interleaved_samples: &[f32],
    sample_rate_hz: u32,
    channels: u16,
) -> Result<TrackAnalysis, AudioError>
```

**Purpose**

Performs pure in-memory QC analysis on decoded PCM (no file I/O), producing duration, waveform peak bins (dBFS), and integrated LUFS.

**Inputs**

- `interleaved_samples`: interleaved `f32` PCM samples.
- `sample_rate_hz`: decoded sample rate.
- `channels`: decoded channel count.

**Outputs**

Returns `TrackAnalysis` with:

- `duration_ms`
- `peak_data` (downsampled dBFS bins)
- `loudness_lufs` (integrated LUFS)
- `sample_rate_hz`
- `channels`

**Behavior**

1. Validates input invariants:
   - non-empty samples
   - `sample_rate_hz > 0`
   - `channels > 0`
   - sample count divisible by channel count
   - finite sample values
2. Computes peak envelope using fixed-bin downsampling and dBFS conversion.
3. Computes integrated LUFS using EBU R128 analysis.
4. Computes duration from frame count and sample rate.
5. Enforces output invariants (`peak_data <= 0.0`, `loudness_lufs <= 0.0`, finite values).

**Side-effects**

- None (pure computation).
- No filesystem, DB, IPC, or network interaction.

**Error surface (`AudioError`)**

- `InvalidInput`: malformed PCM shape/rate/channels/non-finite values.
- `Analysis`: LUFS/peak/duration computation failures or invariant violations.

**Determinism**

- Deterministic for identical PCM input, sample rate, channel count, and analysis config.
- Suitable for unit testing with synthetic buffers (e.g., sine wave fixtures).

### 5.1.4 Internal Contract: `analyze_interleaved_samples_with_config(...)`

**Rust signature**

```rust
fn analyze_interleaved_samples_with_config(
    interleaved_samples: &[f32],
    sample_rate_hz: u32,
    channels: u16,
    config: AnalysisConfig,
) -> Result<TrackAnalysis, AudioError>
```

**Purpose**

Shared internal analysis implementation used by both production and test paths, allowing configurable peak-bin and dBFS-floor behavior while preserving the same metric contracts.

**Inputs**

- `interleaved_samples`: interleaved PCM samples.
- `sample_rate_hz`: sample rate in Hz.
- `channels`: channel count.
- `config`:
  - `target_peak_bins`
  - `dbfs_floor`

**Behavior**

1. Calls `validate_analysis_input(...)` for structural and numeric invariants.
2. Computes frame count and duration (`duration_ms_from_frames(...)`).
3. Computes peak bins (`compute_peak_data_dbfs(...)`) using config.
4. Computes integrated LUFS (`compute_integrated_lufs(...)`).
5. Returns normalized `TrackAnalysis`.

**Side-effects**

- None (pure in-memory computation).

**Error surface**

- Bubbles `AudioError` from validation, duration, peak, and loudness steps.
- No panic paths in production code.

**Why this exists**

- Keeps one canonical analysis implementation.
- Enables deterministic fault-injection/unit tests with non-default analysis knobs.

### 5.1.5 Internal Guard Contract: `validate_analysis_input(...)`

**Rust signature**

```rust
fn validate_analysis_input(
    interleaved_samples: &[f32],
    sample_rate_hz: u32,
    channels: u16,
    config: AnalysisConfig,
) -> Result<(), AudioError>
```

**Purpose**

Performs all pre-DSP guard checks so invalid inputs are rejected before loudness or waveform calculations begin.

**Validation rules**

- `sample_rate_hz > 0`
- `channels > 0`
- `interleaved_samples` is non-empty
- sample length divisible by channel count
- all samples are finite
- `config.target_peak_bins > 0`
- `config.dbfs_floor` is finite and `<= 0.0`

**Behavior**

- Returns `Ok(())` when input is safe for deterministic analysis.
- Returns `AudioError::InvalidInput` with explicit reason on first failing invariant.

**Side-effects**

- None.

**Why this exists**

- Centralizes invariant enforcement.
- Prevents expensive DSP work on invalid buffers.
- Keeps downstream functions simpler and assumption-safe.

### 5.1.6 Internal Contract: `duration_ms_from_frames(...)`

**Rust signature**

```rust
fn duration_ms_from_frames(total_frames: usize, sample_rate_hz: u32) -> Result<u32, AudioError>
```

**Purpose**

Converts decoded frame count and sample rate into a bounded millisecond duration used by QC results.

**Inputs**

- `total_frames`: number of PCM frames (not samples).
- `sample_rate_hz`: sample rate in Hz.

**Behavior**

1. Rejects `total_frames == 0`.
2. Computes milliseconds using integer arithmetic:
   - `millis = (total_frames * 1000) / sample_rate_hz`
3. Rejects overflow when converting to `u32`.
4. Rejects durations that round down to `0 ms` (insufficient audio length).

**Outputs**

- Returns non-zero `u32` duration in milliseconds.

**Error surface**

- `AudioError::Analysis` for zero-frame, overflow, or zero-ms-rounded results.

**Side-effects**

- None.

**Why this exists**

- Ensures duration values in `TrackAnalysis` are valid and stable for UI and persistence contracts.

### 5.1.7 Internal Contract: `compute_integrated_lufs(...)`

**Rust signature**

```rust
fn compute_integrated_lufs(
    interleaved_samples: &[f32],
    sample_rate_hz: u32,
    channels: u16,
) -> Result<f32, AudioError>
```

**Purpose**

Computes integrated loudness (LUFS) for one contiguous interleaved PCM buffer using EBU R128 semantics.

**Inputs**

- `interleaved_samples`: interleaved PCM samples.
- `sample_rate_hz`: sample rate in Hz.
- `channels`: channel count.

**Behavior**

1. Wraps the contiguous buffer into a one-chunk iterator.
2. Delegates all validation and EBU R128 processing to `compute_integrated_lufs_from_chunks(...)`.
3. Returns integrated LUFS as `f32`.

**Output contract**

- Returned LUFS must be finite.
- Returned LUFS must be `<= 0.0` (with tiny positive epsilon clamped to `0.0` in delegated path).

**Error surface**

- Bubbles `AudioError::Analysis` and related errors from chunked LUFS computation.

**Side-effects**

- None (pure in-memory analysis).

**Why this exists**

- Provides the simple contiguous-buffer API used by production analysis while sharing one canonical LUFS implementation with chunked fault-injection test paths.

### 5.1.8 Internal Contract: `compute_integrated_lufs_from_chunks(...)`

**Rust signature**

```rust
fn compute_integrated_lufs_from_chunks<T, I>(
    chunks: I,
    sample_rate_hz: u32,
    channels: u16,
) -> Result<f32, AudioError>
where
    T: AsRef<[f32]>,
    I: IntoIterator<Item = Result<T, AudioError>>,
```

**Purpose**

Canonical EBU R128 loudness implementation that supports streaming/chunked PCM input and fault-injection scenarios while preserving production validation semantics.

**Inputs**

- `chunks`: iterator of chunk results, each chunk containing interleaved `f32` samples.
- `sample_rate_hz`: sample rate in Hz.
- `channels`: channel count.

**Behavior**

1. Validates `sample_rate_hz > 0` and `channels > 0`.
2. Initializes EBU R128 meter with integrated + sample-peak modes.
3. Iterates chunks:
   - propagates upstream chunk errors (`?`)
   - skips empty chunks
   - enforces chunk alignment (`len % channels == 0`)
   - enforces finite samples
   - feeds frames to meter
4. Rejects all-empty streams (`zero frames`).
5. Reads global integrated loudness.
6. Enforces loudness validity:
   - finite value required
   - tiny positive epsilon clamped to `0.0`
   - larger positive values rejected

**Output contract**

- Returns finite LUFS `<= 0.0` (or `0.0` via epsilon clamp).

**Error surface**

- `AudioError::Analysis` for meter init/feed/read failures and semantic violations.
- Propagates upstream chunk-provided `AudioError` values unchanged.

**Side-effects**

- None outside local meter state (pure in-memory computation).

**Why this exists**

- Enables deterministic streaming analysis behavior.
- Provides a direct hook for destructive tests (mid-stream failures, malformed chunks) without duplicating loudness logic.

### 5.1.9 Internal Contract: `compute_peak_data_dbfs(...)`

**Rust signature**

```rust
fn compute_peak_data_dbfs(
    interleaved_samples: &[f32],
    channels: usize,
    target_peak_bins: usize,
    dbfs_floor: f32,
) -> Result<Vec<f32>, AudioError>
```

**Purpose**

Builds a fixed-size waveform envelope for UI rendering by computing max-absolute amplitude per frame window and converting each bin to dBFS.

**Inputs**

- `interleaved_samples`: interleaved PCM samples.
- `channels`: channel count (`usize`).
- `target_peak_bins`: desired maximum number of bins.
- `dbfs_floor`: lower dBFS clamp (must be finite and `<= 0.0`).

**Behavior**

1. Validates:
   - `channels > 0`
   - `target_peak_bins > 0`
   - `samples.len() % channels == 0`
   - non-empty frame count
2. Computes frame count and bin count:
   - `bins = min(total_frames, target_peak_bins)` (at least 1)
   - `frames_per_bin = ceil(total_frames / bins)`
3. For each bin window:
   - scans all frames/channels in window
   - captures max absolute linear amplitude
   - converts to dBFS via `amplitude_to_dbfs(...)`
4. Rejects empty peak result (defensive guard).

**Outputs**

- `Vec<f32>` peak bins in dBFS, each value clamped to `<= 0.0` and floor-bounded.

**Error surface**

- `AudioError::InvalidInput` for shape/config violations.
- `AudioError::Analysis` if no bins are produced.

**Side-effects**

- None (pure in-memory computation).

**Why this exists**

- Produces lightweight, deterministic waveform data suitable for fast seek/inspection in UI.
- Decouples UI rendering from expensive per-pixel audio processing.

### 5.1.10 Internal Contract: `amplitude_to_dbfs(...)`

**Rust signature**

```rust
fn amplitude_to_dbfs(amplitude: f32, dbfs_floor: f32) -> f32
```

**Purpose**

Converts linear amplitude to dBFS with strict clamping rules so peak envelopes remain bounded and UI-safe.

**Inputs**

- `amplitude`: linear sample magnitude (can be any finite/non-finite `f32`).
- `dbfs_floor`: requested lower floor in dBFS.

**Behavior**

1. Resolves effective floor:
   - uses provided `dbfs_floor` when finite and `<= 0.0`
   - otherwise falls back to default floor (`-96.0 dBFS`)
2. Normalizes amplitude:
   - non-finite values treated as `0.0`
   - absolute value used
3. Converts to dBFS:
   - clamps linear domain to `[min_linear_from_floor, 1.0]`
   - computes `20 * log10(clamped_linear)`
4. Final clamps:
   - upper bound `0.0 dBFS`
   - lower bound `floor`

**Outputs**

- A finite `f32` dBFS value in range `[floor, 0.0]`.

**Side-effects**

- None (pure function).

**Why this exists**

- Guarantees stable, bounded dBFS values even with malformed or extreme sample values.
- Prevents UI/rendering artifacts from non-finite or out-of-range amplitudes.

## 5.2 Idempotency and Release Identity

Goal: guarantee stable identity for semantically identical releases.

Material construction:

- `media_fingerprint = BLAKE3(raw_audio_bytes)`
- `spec_hash = BLAKE3(normalized_compact_spec_json)`
- `release_id = BLAKE3(domain + "\n" + media_fingerprint + "\n" + spec_hash)`

Domain separation string:

- `release-publisher.release-id.v2.blake3`

Effect:

- 1-bit mutations in audio bytes or metadata produce a different `release_id`.
- Prevents accidental overwrite/collision in deterministic flow.

## 5.3 Release Pipeline Semantics (Plan -> QC -> Execute -> Audit/Remote Verify)

State model (simplified):

- `VALIDATED`
- `PLANNED`
- `EXECUTING`
- `VERIFIED`
- `COMMITTED`
- `FAILED`

Nominal flow:

1. Plan
   - validate input/spec
   - compute idempotency keys
   - build per-platform planned actions
   - persist release + actions + planned descriptor
   - transition `VALIDATED -> PLANNED`
2. QC (local)
   - run local waveform + LUFS analysis
   - require explicit manual approval gate in Publish mode before execution is enabled
   - keep QC as workflow guard; do not treat UI approval state as backend trust anchor
3. Execute
   - acquire run lock lease
   - transition `PLANNED -> EXECUTING`
   - execute mock publisher actions
4. Audit/remote verify (backend)
   - process post-execution verification results
   - transition `EXECUTING -> VERIFIED -> COMMITTED` on success
   - transition to `FAILED` on fatal path
5. Report/history
   - persist report artifact
   - expose historical release runs for inspection/resume

Important UI distinction:

- UI wording uses `Verify / QC` for user comprehension, but this document treats local QC and backend remote verify as separate phases.
- Core backend state machine semantics remain deterministic and database-driven.

## 5.4 Catalog-to-Publisher Bridge

Bridge behavior:

- From Track Detail, `Prepare for Release...` generates a draft release spec from catalog metadata.
- Draft YAML is persisted to artifacts.
- Publisher Ops is opened with both media path and spec path prefilled.
- `load_spec` remains backend-authoritative: YAML parsing and validation happen in Rust, and frontend never treats client-side parsing as trusted.

This preserves backward compatibility:

- Existing spec-file workflow remains supported.
- New catalog-authored entry point is additive.

## 5.5 Shared Transport Handoff and I/O Safety

Problem class:

- A globally mounted transport can overlap with catalog ingest or publish QC analysis if mode transitions are not coordinated.

Handoff rules:

- On `Listen -> Publish` transition where QC is entered, shared transport pauses before QC analysis actions are initiated.
- On mode transition, active transport source is reset when source context changes to avoid stale playback handles.
- Playback and analysis use non-exclusive read access semantics so decode paths do not require write-style file locks.

Operational expectation:

- If playback is active and a user starts QC analysis, UI should prioritize analysis safety by pausing transport and surfacing deterministic status feedback.

## 6. Error Classification Strategy

## 6.1 Philosophy

Errors are handled by intent, not by stack trace shape:

- Terminal errors: caller must change input or state before retry.
- Transient errors: retry may succeed without semantic change.

## 6.2 Typical terminal categories

Examples:

- `INVALID_ARGUMENT`
- `SPEC_VALIDATION_FAILED`
- `AUDIO_MODEL_INVALID`
- `INVALID_RELEASE_STATE`
- `CAP_EXCEEDED`
- DB constraint violations and row decode failures

Behavior:

- Return explicit code and context.
- Do not retry automatically.
- Surface actionable UI message.

## 6.3 Typical transient categories

Examples:

- `DB_BUSY_LOCKED`
- short-lived IO/lock contention failures
- pool timeout under contention

Behavior:

- retry with bounded backoff where safe (DB and orchestrator wrappers)
- preserve deterministic semantics and idempotent writes

## 6.4 Propagation chain

1. subsystem error (`AudioError`, `DbError`, `OrchestratorError`)
2. mapping to `AppError { code, message, details }`
3. IPC response to frontend
4. frontend status/notice rendering and gate behavior updates

## 7. Security Model

Key controls:

- Frontend treated as hostile input source.
- Tauri Isolation Pattern enabled.
- Command allowlist via app ACL (no broad `core:default` capability grant).
- Strict CSP in production.
- Path normalization and scheme rejection.
- Payload size bounds and semantic validation.
- Error-detail redaction for sensitive keys.

Boundary rule:

- No client-supplied value is trusted without backend validation.

## 8. Reliability and Test Strategy

Test layers:

- Unit tests:
  - audio decode/analyze invariants
  - model validations
  - idempotency determinism and mutation sensitivity
- Integration tests:
  - state machine transitions
  - WAL behavior and rollback scenarios
  - lock contention and retry logic
- IPC tests:
  - malformed payload rejection
  - DB tamper and decode-hardening checks
- Frontend tests:
  - queue and mode behavior
  - workflow gating
  - metadata editor interactions

Destructive patterns covered:

- corrupted headers, zero-byte files, unsupported codecs
- mid-stream LUFS feed failure
- one-bit payload mutations for hash immutability
- database lock contention and crash-like interruption paths

### 8.x Audio Processor Test Harness Contracts (`#[cfg(test)]`)

The `audio_processor.rs` test module defines internal helper functions and fault-injection scenarios used to validate production safety guarantees.

**Scope**

- Synthetic signal generation (e.g., sine-wave buffers) for deterministic metric checks.
- Hostile fixture generation (zero-byte, corrupted headers, unsupported codec stubs).
- Mid-stream chunk failure simulation for loudness pipeline.
- Mathematical guard tests for:
  - LUFS behavior under gain changes
  - dBFS clamping/floor behavior
  - input invariant rejection
  - panic resistance in decode paths

**Operational rule**

- Test-only helper functions are compile-time gated via `#[cfg(test)]`.
- They do not ship in production binaries and have no runtime side-effects outside test execution.

**Why this section exists**

- Captures parity for test-only function logic.
- Documents the destructive testing layer that enforces backend resilience claims.

#### Test Helper Contract: `TempTestFile::path(...)`

**Rust signature**

```rust
fn path(&self) -> &std::path::Path
```

**Purpose**

Returns the filesystem path of a temporary hostile-audio fixture used by decode/analysis tests.

**Behavior**

- Exposes read-only path access for test decode entrypoints.
- Used to feed temp files into `decode_audio_file(...)` / `analyze_track(...)` tests.

**Side-effects**

- None.

**Why this exists**

- Keeps test fixture ownership separate from test call sites while enabling deterministic temp-file lifecycle management.

#### Test Helper Contract: `TempTestFile::drop(...)`

**Rust signature**

```rust
impl Drop for TempTestFile {
    fn drop(&mut self)
}
```

**Purpose**

Ensures temporary test fixture files are cleaned up automatically when the helper leaves scope.

**Behavior**

- Attempts to remove the temp file path on drop.
- Ignores remove errors intentionally (best-effort cleanup) to avoid masking test assertions.

**Side-effects**

- Filesystem delete attempt for test temp file.

**Why this exists**

- Prevents fixture-file accumulation across destructive decode tests.
- Keeps test cleanup automatic and scope-bound.

#### Test Helper Contract: `create_temp_file_with_bytes(...)`

**Rust signature**

```rust
fn create_temp_file_with_bytes(extension: &str, bytes: &[u8]) -> TempTestFile
```

**Purpose**

Creates a temporary file fixture with caller-provided raw bytes for hostile decode and analysis tests.

**Inputs**

- `extension`: file extension hint used for temp filename.
- `bytes`: exact byte payload to write to disk.

**Behavior**

1. Allocates a unique temp file path.
2. Writes provided bytes as-is.
3. Returns `TempTestFile` wrapper for scoped lifecycle management.

**Side-effects**

- Filesystem write in temp directory.

**Why this exists**

- Enables deterministic injection of malformed/corrupted/edge-case file contents.
- Supports real file-path decode tests without external test assets.

#### Test Helper Contract: `append_u16_le(...)`

**Rust signature**

```rust
fn append_u16_le(out: &mut Vec<u8>, value: u16)
```

**Purpose**

Appends a 16-bit unsigned integer to a byte buffer in little-endian order for synthetic WAV fixture construction.

**Inputs**

- `out`: mutable byte buffer under construction.
- `value`: `u16` value to encode.

**Behavior**

- Encodes `value` as little-endian bytes.
- Appends encoded bytes to `out`.

**Side-effects**

- Mutates provided output buffer.

**Why this exists**

- Provides deterministic binary encoding primitives for handcrafted RIFF/WAV test payloads.

#### Test Helper Contract: `append_u32_le(...)`

**Rust signature**

```rust
fn append_u32_le(out: &mut Vec<u8>, value: u32)
```

**Purpose**

Appends a 32-bit unsigned integer to a byte buffer in little-endian order for handcrafted WAV container fields.

**Inputs**

- `out`: mutable byte buffer under construction.
- `value`: `u32` value to encode.

**Behavior**

- Encodes `value` as little-endian bytes.
- Appends encoded bytes to `out`.

**Side-effects**

- Mutates provided output buffer.

**Why this exists**

- Complements `append_u16_le(...)` for deterministic RIFF/WAV fixture generation in destructive decode tests.

#### Test Helper Contract: `pcm_s16_wav_bytes(...)`

**Rust signature**

```rust
fn pcm_s16_wav_bytes(samples: &[i16], sample_rate_hz: u32, channels: u16) -> Vec<u8>
```

**Purpose**

Builds a minimal PCM S16 WAV byte payload from raw sample values for file-based decode/analysis test fixtures.

**Inputs**

- `samples`: signed 16-bit PCM sample values.
- `sample_rate_hz`: sample rate to encode in WAV header.
- `channels`: channel count to encode in WAV header.

**Behavior**

- Constructs RIFF/WAVE headers and `fmt`/`data` chunks in little-endian form.
- Encodes provided PCM payload as WAV `data` chunk content.
- Returns complete WAV bytes suitable for writing to temp files.

**Outputs**

- `Vec<u8>` containing a deterministic WAV container payload.

**Side-effects**

- None (returns owned bytes only).

**Why this exists**

- Enables controlled generation of valid baseline WAV fixtures without external files.
- Supports deterministic analysis/loudness regression tests.

#### Test Helper Contract: `wav_bytes_with_format_tag(...)`

**Rust signature**

```rust
fn wav_bytes_with_format_tag(
    samples: &[i16],
    sample_rate_hz: u32,
    channels: u16,
    format_tag: u16,
) -> Vec<u8>
```

**Purpose**

Generates WAV payloads with caller-selected `fmt` format tags to simulate supported and unsupported codec declarations.

**Behavior**

- Builds RIFF/WAVE bytes similar to `pcm_s16_wav_bytes(...)`.
- Injects the provided `format_tag` into the WAV `fmt` chunk.

**Why this exists**

- Enables deterministic unsupported-codec decode tests without external fixture files.

#### Test Helper Contract: `flip_single_bit(...)`

**Rust signature**

```rust
fn flip_single_bit(mut bytes: Vec<u8>, byte_index: usize, bit_index: u8) -> Vec<u8>
```

**Purpose**

Applies precise one-bit mutations to byte payloads for corruption and immutability tests.

**Behavior**

- Flips one selected bit when indices are in range.
- Returns mutated byte vector.

**Why this exists**

- Supports deterministic “minimal corruption” and mutation-sensitivity testing.

#### Test Helper Contract: `assert_decode_fails_without_panic(...)`

**Rust signature**

```rust
fn assert_decode_fails_without_panic(path: &std::path::Path)
```

**Purpose**

Asserts that hostile decode inputs fail by `Result` error, never by panic.

**Behavior**

- Invokes `decode_audio_file(...)` under `catch_unwind`.
- Fails test if decode panics.
- Fails test if decode unexpectedly succeeds for hostile fixture.

**Why this exists**

- Enforces zero-panic policy under corrupted input conditions.

#### Test Helper Contract: `generate_sine_wave_interleaved(...)`

**Rust signature**

```rust
fn generate_sine_wave_interleaved(
    sample_rate_hz: u32,
    channels: u16,
    frequency_hz: f32,
    duration_seconds: f32,
    amplitude: f32,
) -> Vec<f32>
```

**Purpose**

Creates deterministic synthetic PCM buffers for loudness and peak math validation.

**Why this exists**

- Provides controlled, reproducible test input independent of external media files.

#### Test Helper Contract: `max_abs_sample(...)`

**Rust signature**

```rust
fn max_abs_sample(samples: &[f32]) -> f32
```

**Purpose**

Computes maximum absolute sample value for expected-value checks in waveform peak tests.

### 8.x.1 Audio Processor Test Cases (`audio_processor.rs`)

The following test functions validate behavior and fault tolerance of production audio functions:

- `analyze_interleaved_samples_produces_valid_metrics_for_440hz_sine`
  - Validates expected metric shape and invariants for deterministic synthetic tone input.
- `integrated_lufs_increases_by_approximately_6db_when_amplitude_doubles`
  - Verifies LUFS responds correctly to gain scaling.
- `peak_downsampling_uses_dbfs_floor_for_silence`
  - Verifies silence maps to configured dBFS floor.
- `analyze_interleaved_samples_rejects_invalid_inputs`
  - Confirms `InvalidInput` handling for empty/unaligned/invalid parameters.
- `analyze_track_returns_io_error_for_missing_file`
  - Confirms file-not-found path maps to typed I/O error.
- `amplitude_to_dbfs_clamps_to_zero_and_floor`
  - Verifies amplitude conversion clamps in `[floor, 0.0]`.
- `decode_audio_file_rejects_zero_byte_file_without_panicking`
  - Verifies hostile zero-byte input fails without panic.
- `decode_audio_file_rejects_corrupted_byte_corpus_without_panicking`
  - Verifies corrupted fixtures fail safely without panic.
- `decode_audio_file_rejects_unsupported_wav_codec_format_tag`
  - Verifies unsupported WAV format tags are rejected.
- `integrated_lufs_streaming_bubbles_io_error_midstream`
  - Verifies mid-stream chunk error bubbles with typed error.
- `integrated_lufs_streaming_rejects_misaligned_chunk`
  - Verifies chunk alignment guard.
- `integrated_lufs_streaming_rejects_zero_sample_rate`
  - Verifies zero sample-rate guard.
- `integrated_lufs_streaming_rejects_zero_channels`
  - Verifies zero channel-count guard.
- `integrated_lufs_streaming_rejects_non_finite_samples`
  - Verifies non-finite sample guard.
- `integrated_lufs_streaming_rejects_zero_frames_when_chunks_are_empty`
  - Verifies all-empty chunk streams are rejected.

## 9. Operational Notes

- The application is designed to function disconnected.
- Publish execution currently uses mock transport semantics by design.
- Catalog and publisher are integrated, but remain separate concerns.
- Shared transport is globally mounted and persists across workspace navigation.

## 10. Known Constraints and Non-Goals (Current Version)

- Real external publish connectors are not enabled in this release path.
- Marketplace/events/social/multi-user domains are out of scope.
- QC true-peak may be optional in some response paths depending on persisted source.

## 11. Maintaining This Document

When updating this document:

1. Add a new row in Revision History.
2. Update affected workflow sections and command names.
3. Keep examples aligned with current IPC and model contracts.
4. Include migration/version implications when persistence schemas change.

Suggested cadence:

- Update on every feature branch merge that changes command surface, persistence shape, or user workflow behavior.
