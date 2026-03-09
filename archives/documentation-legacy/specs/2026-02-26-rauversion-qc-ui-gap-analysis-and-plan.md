# Rauversion-Informed QC UI Gap Analysis and Implementation Plan (Addendum)

Date: 2026-02-26

Purpose: Reconcile the existing requirements PDF with the actual codebase and the current implementation constraint:

- Do not change core publishing pipeline behavior
- Do not change MockTransport / connector logic
- Do not change SQLite state transition behavior
- Keep offline-first native audio analysis (no ffmpeg / audiowaveform CLI dependency)

This addendum keeps the original direction but adjusts the rollout so it is implementable against the current codebase without breaking the verified pipeline.

## Inputs Reviewed

- Rauversion repository README and feature list (`https://github.com/rauversion/rauversion`)
- Current desktop frontend (`apps/desktop/src/App.tsx`)
- Current desktop Tauri command surface (`apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src-tauri/src/commands.rs`)
- Current orchestrator execution behavior (`crates/core/src/orchestrator.rs`)
- Existing requirements PDF (extracted text in `requirements/Studio-Release-Orchestrator_ Architectural Blueprint and Implementation Plan - Google Dokument.txt`)

## What Rauversion Contributes (Relevant UI/Product Signals)

Rauversion is not just a file upload UI. The features most relevant to our QC stage are:

- audio peaks preprocessing
- embeddable audio player
- rich metadata/tags workflows
- responsive modern web UI patterns
- upload/processing flows designed to avoid blocking the main UI

These are the right reference points for a QC/verification stage in our desktop app.

## Current Codebase Reality (Observed)

The current app is a workflow shell with strong safety and state handling, but not yet a media QC experience.

- Frontend screens are: `New Release`, `Plan / Preview`, `Execute`, `Report / History`
- There is no waveform renderer, no audio playback UI, no QC approval UI
- Tauri exposes only: `load_spec`, `plan_release`, `execute_release`, `list_history`, `get_report`
- The core orchestrator executes `execute -> verify -> commit` in one backend flow
- The DB already has `VERIFIED` state, but the frontend has no manual stop at that point

## Gap Analysis (Current App vs Rauversion-like QC UX)

## 1. Audio Analysis (Critical Gap)

Missing now:

- native audio decoding in the desktop backend
- waveform peak extraction for UI visualization
- loudness analysis (LUFS)
- true peak metric for QC display
- IPC contract for analysis requests/results

Impact:

- Cannot render a responsive waveform without decoding on the UI thread
- Cannot support QC decisions based on loudness/peak measurements

## 2. QC Stage UX (Critical Gap)

Missing now:

- dedicated Verify/QC screen
- transport controls (play/pause/seek)
- visual waveform seeking
- prominent manual approval CTA
- QC status persistence per release

Impact:

- Users cannot listen and inspect before release action
- No human gate in the UI despite requirement intent

## 3. Pipeline Integration Constraint Mismatch (Critical Design Constraint)

The original requirements text asks for a manual QC gate in the pipeline state machine. That is not compatible with the current strict constraint to keep core pipeline state transitions unchanged.

Current backend behavior:

- `execute_release` ultimately transitions through `VERIFIED` and then `COMMITTED` in the same call

Required adjustment for this phase:

- Implement a UI-level approval gate before calling `execute_release`
- Do not split backend execution/commit in this phase

Result:

- We preserve pipeline correctness and tests
- We still achieve an operator-controlled QC checkpoint in the user workflow
- The "Approve for Release" button advances the UI workflow and unlocks execution

## 4. Data Contract / Metadata Support (Moderate Gap)

Missing now:

- track-level analysis payload in frontend models
- analysis result caching and retrieval by release context
- optional QC review artifact (approved by, timestamp, notes)

Impact:

- QC state is not durable/auditable yet
- Analysis may be recomputed unnecessarily

## 5. UI Polish and Player Ergonomics (Moderate Gap)

Current UI strengths:

- clear workflow structure
- error handling and path redaction
- test coverage for workflow interactions

Current UI limitations:

- form-heavy layout
- no media-first visual hierarchy
- no playback affordances
- no progressive loading states for heavy analysis

## Requirements Update (Addendum to Existing PDF)

This addendum updates the implementation sequencing, not the long-term product direction.

## Updated Constraint-Aware Requirement

For the current phase, the manual QC approval gate MUST be implemented as a frontend workflow gate that prevents calling `execute_release` until the operator has completed QC review and explicitly approved the release.

The backend pipeline, MockTransport behavior, and SQLite state transitions MUST remain unchanged.

## Updated QC Approval Persistence Requirement

Add a desktop-side QC review artifact (JSON file under the existing release artifacts directory) to persist:

- release_id
- source media path or path fingerprint
- analysis summary (LUFS, true peak, duration, channels)
- approval status
- approved_at timestamp
- optional reviewer note

This avoids changing the core DB schema/state machine while preserving local auditability.

## Updated Analysis API Requirement

The first shipping version MUST support analysis by `file_path`.

Support for analysis by `release_id` SHOULD be implemented via artifact cache lookup and can be added without changing core state transitions.

Rationale:

- the current persisted release metadata does not retain the original media file path
- the frontend already has the local media path during planning/QC

## Implementation Plan (Rust First, Then React)

## Phase A: Rust Audio Analysis + Tauri IPC (First)

Goal: deliver a native analysis service the UI can call without freezing.

### A1. Add audio analysis module (desktop Tauri crate only)

Add new module(s) under `apps/desktop/src-tauri/src/`, for example:

- `audio_analysis.rs`
- `audio_analysis_types.rs` (optional)

Keep this isolated from `crates/core` to respect the "no pipeline changes" constraint.

### A2. Add dependencies (desktop Tauri crate)

Add native Rust crates for audio decoding and loudness analysis:

- `symphonia` (audio decode / demux)
- `ebur128` (integrated loudness and true/sample peak)

Implementation notes:

- run decoding/analysis in `tokio::task::spawn_blocking`
- avoid loading entire decoded PCM into memory when streaming analysis is possible
- compute peaks incrementally while feeding frames to `ebur128`

### A3. Define IPC command contract

Add Tauri commands:

- `analyze_audio_file(file_path: String, options?: AudioAnalysisOptions) -> AudioAnalysisResult`
- `get_qc_review(release_id: String) -> Option<QcReviewArtifact>`
- `set_qc_review(input: SetQcReviewInput) -> QcReviewArtifact`

Optional later:

- `get_audio_analysis_for_release(release_id: String) -> Option<AudioAnalysisResult>`

### A4. AudioAnalysisResult shape (proposed)

Fields:

- `file_path_display` (sanitized/redacted display path)
- `file_path_canonical` (only if debug path visibility is enabled, same redaction pattern as existing UI)
- `duration_ms`
- `sample_rate_hz`
- `channels`
- `integrated_lufs`
- `true_peak_dbfs` (preferred)
- `sample_peak_dbfs` (fallback/diagnostic)
- `waveform_peaks_dbfs: Vec<f32>` (downsampled)
- `peak_bin_count`
- `analysis_version`
- `cache_key`

### A5. Peak extraction algorithm (v1)

Use a deterministic, UI-friendly envelope:

- decode to normalized PCM `[-1.0, 1.0]`
- fold multichannel to absolute max per frame (or per bin)
- compute max absolute amplitude per bin window
- convert amplitude to dBFS using `20 * log10(max(amp, floor))`
- clamp to a floor (for example `-96.0 dBFS`) to avoid `-inf`

Recommended frontend target:

- 1,000-4,000 bins depending on duration and viewport

### A6. Loudness / Peak analysis (v1)

Use `ebur128` to compute:

- integrated loudness (LUFS)
- true peak (if mode enabled and supported)

Notes:

- enable the correct `Mode` flags (`I` and `TRUE_PEAK`; include `SAMPLE_PEAK` as fallback)
- feed frames in the sample format expected by the crate (`f32` path preferred)
- return structured errors for unsupported codecs/containers

### A7. Artifact cache and QC review persistence

Store under release artifacts (no DB schema change required):

- `artifacts/<release_id>/qc/audio_analysis.json`
- `artifacts/<release_id>/qc/review.json`

If `release_id` is not available yet, allow uncached analysis by file path and cache in memory for the session.

### A8. Rust tests

Add tests for:

- invalid path / unsupported file handling
- peak array invariants (`<= 0 dBFS`, non-empty, deterministic length)
- LUFS/peak fields present on valid fixture audio
- QC review artifact read/write roundtrip

Do not alter existing pipeline tests.

## Phase B: React Verify/QC Player UX (Second)

Goal: create a modern QC experience inspired by Rauversion without breaking the current workflow.

### B1. Introduce a dedicated `Verify / QC` screen

Replace the current 4-screen flow with 5 screens:

- `New Release`
- `Plan / Preview`
- `Verify / QC`
- `Execute`
- `Report / History`

Behavior:

- after planning, route the user to `Verify / QC`
- `Execute` button remains disabled until QC approval exists for the current release/media
- preserve direct history/report access for already committed releases

### B2. Build a reusable `QcAudioPlayer` component

Frontend component responsibilities:

- load audio element from local file path
- request Rust analysis via IPC
- render waveform using precomputed peaks
- show transport controls and current time/duration
- surface loudness/true peak metrics
- display track metadata (title, artist, tags)
- capture manual approval and optional note

Suggested component split:

- `VerifyQcScreen`
- `QcAudioPlayer`
- `QcMetricsPanel`
- `QcApprovalPanel`

### B3. Waveform rendering strategy

Use Wavesurfer.js in peaks-driven mode:

- initialize waveform with precomputed `waveform_peaks_dbfs`
- avoid browser-side waveform decode computation for large files
- sync waveform seek with native `<audio>` playback
- destroy/recreate instance cleanly on track change

UX requirements:

- drag-to-seek and click-to-seek
- keyboard-accessible play/pause and seek
- visible loading and analysis progress states
- reduced-motion-safe animations

### B4. Rauversion-inspired UI direction (desktop-first, responsive)

Design goals:

- media-first hero player card
- strong visual hierarchy (waveform dominates)
- metadata chips and QC stats at a glance
- obvious approval status state ("Not Reviewed", "Approved", "Needs Review")
- polished controls and spacing for desktop use

Recommended visual structure:

- top: release title, artist, tags, state pill
- middle: waveform + playhead + transport
- side/bottom: LUFS, true peak, duration, sample rate, channels
- footer: approval CTA + note + "Proceed to Execute"

### B5. Manual approval gate (constraint-safe implementation)

Implement a UI gate, not a pipeline-state gate:

- `Approve for Release` writes `qc/review.json` via Tauri command
- UI sets `qcApproved = true` for the release
- `Execute` action remains disabled until `qcApproved`

This satisfies operator control without changing backend state transitions.

### B6. Frontend tests

Add/adjust tests for:

- `Execute` disabled before QC approval
- QC approval enables execution
- analysis result metrics render correctly
- waveform/analysis loading error states

Keep existing workflow tests passing by updating the Tauri mock to support new commands.

## Phase C: Optional Later (If Core Pipeline Constraint Is Relaxed)

This phase is explicitly out of scope for the current constraint set.

Possible future enhancement:

- split current `execute_release` into `execute_release` and `commit_release` (or equivalent)
- persist backend `VERIFIED` as a true pause point
- make "Approve for Release" transition backend `VERIFIED -> COMMITTED`

This would deliver a hard backend gate instead of the current UI gate.

## Delivery Sequence (Recommended)

1. Rust audio analysis module and IPC (`analyze_audio_file`)
2. QC review artifact commands (`get_qc_review`, `set_qc_review`)
3. React `Verify / QC` screen and `QcAudioPlayer`
4. Wavesurfer integration with precomputed peaks
5. Approval gate wiring to existing `Execute` action
6. Tests (Rust + React + Playwright smoke)
7. UI polish pass (layout, typography, accessibility, reduced motion)

## Acceptance Criteria for This Iteration

- No changes to `crates/core` execution semantics or state transitions
- No changes to MockTransport behavior
- User can analyze a local audio file natively via Rust (no external CLI tools)
- User can see waveform, LUFS, and true peak metrics in the QC screen
- User can listen and seek visually
- User must click `Approve for Release` before `Execute` becomes available
- Existing plan/execute/report flow remains functional and tested

