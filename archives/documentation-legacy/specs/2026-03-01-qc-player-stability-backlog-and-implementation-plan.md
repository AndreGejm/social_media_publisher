# QC Player Stability Backlog And Implementation Plan

Date: 2026-03-01  
Scope: Desktop Listen/QC workspaces only (Library, Quality Control, Playlists, Settings).  
Out of scope: Publish workspace implementation changes.

## 1. Objective

Ship a production-ready QC preview + music player that is:

- Stable: no render loops, no silent fallback behavior, predictable runtime behavior under load.
- Maintainable: smaller ownership boundaries, explicit command contracts, clear failure semantics.
- Testable: deterministic behavior with automated coverage across Rust + frontend.

## 2. Core Principles (Non-Negotiable)

1. No silent degradation for codec/QC correctness paths.
2. Every async workflow must be idempotent and cancellation-safe.
3. State updates must be change-guarded to avoid render churn and loops.
4. Feature behavior must be represented by command-contract tests, not only UI tests.
5. All new behavior must include structured failure states visible to users.

## 3. Current Baseline

- Frontend tests: passing in `apps/desktop` (70 passed, 5 skipped).
- Rust desktop lib tests: passing in `release-publisher-desktop` (69 passed).
- Known risk themes:
  - QC preview session state exists, but real codec-preview audio path must be treated as the truth target.
  - Batch export completion semantics must remain strict (no misleading success paths).
  - Signal-quality correctness (true peak + precision path) must be explicit and tested.

## 4. Implementation Phases

## Phase 0: Planning And Guardrails (0.5 day)

### Work items

- Confirm this document as the single source of truth for execution order.
- Add/confirm feature flags and rollout toggles for high-risk behavior changes.
- Define a "stop on red" policy for failing stability gates.

### Pass criteria

- This file is committed and referenced in `documentation/README.md`.
- Team agrees to no parallel "side" implementation outside this sequence.

### Fail criteria

- Work starts without acceptance criteria linked to tasks.
- Contract changes are introduced without tests.

## Phase 1: QC Preview Truth Layer (3 to 4 days)

### Work items

- Implement real preview artifact preparation for profile A/B from source track.
- Bind preview variant selection to actual playback source switching.
- Keep Blind-X mapping deterministic per session and revealable.
- Add explicit errors for unavailable encoders/codecs.

### Pass criteria

- Switching `bypass` / `codec_a` / `codec_b` changes actual audio source path.
- Blind-X reveal deterministically resolves to A or B and is test-covered.
- No fake "active variant" state disconnected from playback path.

### Fail criteria

- Variant switch only updates metadata/session state.
- Playback continues on source/bypass regardless of selected variant.

## Phase 2: Batch Export Semantics Hardening (1 to 1.5 days)

### Work items

- Remove/forbid "passthrough copy marked completed" semantics.
- Enforce explicit per-profile result states:
  - `completed`
  - `failed_encoder_unavailable`
  - `failed_encode`
  - `failed_io`
- Update UI messages and JSON summary schema accordingly.

### Pass criteria

- Missing encoder or encode failure always reports failed state.
- Summary artifacts reflect true status and are stable-schema tested.

### Fail criteria

- Any path reports completed when actual encode did not happen.

## Phase 3: Signal Integrity Metrics Upgrade (2 days)

### Work items

- Implement true-peak (dBTP) computation path suitable for mastering QC.
- Keep integrated LUFS as canonical and consistent across ingest/export.
- Ensure stored catalog metrics are sourced from the upgraded analysis path.

### Pass criteria

- True-peak value is produced by dedicated peak analysis path, not waveform max proxy.
- Metric tests verify finite, bounded, and deterministic outputs.

### Fail criteria

- `true_peak_dbfs` remains derived from peak bins/sample max approximation.

## Phase 4: Playback Precision Upgrade (1.5 to 2 days)

### Work items

- Remove early i16 quantization in "bit-perfect" path where avoidable.
- Preserve precision until final device-format conversion.
- Add conversion tests for 16/24/32-bit output packing behavior.

### Pass criteria

- Internal decode/render path maintains precision beyond i16 where expected.
- Unit tests protect against regression in conversion/clamping.

### Fail criteria

- Internal path still truncates to i16 before 24/32-bit output.

## Phase 5: Search And Catalog Scalability (2 to 3 days)

### Work items

- Introduce FTS-backed search index (title/artist/album/file_path).
- Move ranking logic to backend query weights where possible.
- Keep frontend ranking only as deterministic tie-breaker.
- Preserve paged loading behavior with stable ordering.

### Pass criteria

- Search results remain stable across pages.
- Large library queries perform without first-page bias artifacts.

### Fail criteria

- Search relevance depends only on frontend ranking of partial pages.

## Phase 6: Ingest Robustness And Control (2 to 3 days)

### Work items

- Add ingest cancellation support.
- Add bounded parallelism for scans/import workers.
- Improve ingest progress/error event reporting for UI clarity.

### Pass criteria

- Long scans can be cancelled safely.
- Ingest status updates remain monotonic and do not loop.

### Fail criteria

- Cancel leaves jobs in ambiguous state or corrupts import progress.

## Phase 7: Maintainability Refactor (2 days)

### Work items

- Split `MusicWorkspaceApp` orchestration responsibilities into focused controllers/hooks:
  - preview controller
  - ingest controller
  - queue controller
  - player transport controller
- Keep behavior unchanged while reducing coupling and effect complexity.

### Pass criteria

- No behavior regressions in existing tests.
- Ownership boundaries documented and test entry points clearer.

### Fail criteria

- Refactor increases implicit coupling or weakens coverage.

## Phase 8: Contract And Regression Hardening (2 days)

### Work items

- Add command-contract tests for QC and playback commands.
- Add regression tests for:
  - dropped-folder autoplay sequence
  - queue toggle fallback
  - variant-source switching
  - batch export failure semantics
- Add explicit render-loop guard tests where practical.

### Pass criteria

- Contract tests validate expected success/error wire shapes.
- Prior infinite-loop vectors are covered by automated tests.

### Fail criteria

- Behavior relies on manual QA only for known risk paths.

## Phase 9: Stabilization, Release Readiness, And Go/No-Go (1 day)

### Work items

- Run full desktop + Rust test suites.
- Execute smoke checklist for ingest, queue, playback, preview, export.
- Produce short release readiness summary against criteria.

### Pass criteria

- All automated gates pass.
- No P0/P1 defects open in scope areas.
- Go/No-Go checklist fully green.

### Fail criteria

- Known correctness issues are deferred without flags/mitigation.

## 5. Backlog (Execution Order)

Status keys: `TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`.

| ID | Priority | Phase | Task | Estimate | Dependencies | Status |
|---|---|---|---|---|---|---|
| QCP-001 | P0 | 0 | Lock implementation contract and gates | 0.5d | None | DONE |
| QCP-002 | P0 | 1 | Real A/B preview artifact preparation | 1.5d | QCP-001 | DONE |
| QCP-003 | P0 | 1 | Playback source switching bound to variant | 1d | QCP-002 | DONE |
| QCP-004 | P0 | 1 | Blind-X deterministic mapping + reveal tests | 1d | QCP-002 | DONE |
| QCP-005 | P0 | 2 | Remove passthrough-as-success export behavior | 0.5d | QCP-001 | DONE |
| QCP-006 | P0 | 2 | Add explicit export failure states (API + UI) | 1d | QCP-005 | DONE |
| QCP-007 | P1 | 3 | True-peak analysis path upgrade | 1d | QCP-001 | DONE |
| QCP-008 | P1 | 3 | LUFS/peak persistence and validation tests | 1d | QCP-007 | DONE |
| QCP-009 | P1 | 4 | Precision-safe decode/render path | 1.5d | QCP-001 | DONE |
| QCP-010 | P1 | 4 | Output packing regression tests (16/24/32) | 0.5d | QCP-009 | DONE |
| QCP-011 | P1 | 5 | FTS migration + ranked query implementation | 2d | QCP-001 | DONE |
| QCP-012 | P1 | 5 | Pagination stability and ranking tests | 1d | QCP-011 | DONE |
| QCP-013 | P1 | 6 | Ingest cancellation API + UI | 1d | QCP-001 | DONE |
| QCP-014 | P1 | 6 | Bounded ingest parallelism + event robustness | 1.5d | QCP-013 | DONE |
| QCP-015 | P2 | 7 | Split large workspace orchestrator modules | 2d | QCP-001 | DONE |
| QCP-016 | P0 | 8 | Add command-contract tests for QC/player APIs | 1d | QCP-006,QCP-008,QCP-010 | DONE |
| QCP-017 | P0 | 8 | Add regression tests for known loop/fallback paths | 1d | QCP-003,QCP-006,QCP-014 | DONE |
| QCP-018 | P0 | 9 | Full validation run + Go/No-Go report | 1d | All above | DONE |

## 5.1 Progress Log

- 2026-03-01: Implemented backend `qc_get_active_preview_media` with lazy preview artifact generation and deterministic Blind-X assignment.
- 2026-03-01: Wired frontend playback source switching to QC preview variant state via `qcGetActivePreviewMedia` (including bypass return-to-catalog behavior).
- 2026-03-01: Added frontend mock coverage updates for the new preview-media command.
- 2026-03-01: Extracted playlist ranking/grouping into pure module `trackCatalogModel` with focused unit coverage.
- 2026-03-01: Added frontend IPC argument validation guards in `tauri-api.ts` to reject malformed payloads before invoke.
- 2026-03-01: Added tauri-api boundary tests for invalid argument rejection and valid invoke pass-through.
- 2026-03-01: Hardened player transport by guarding redundant state writes and handling legacy media-load failures in controlled error paths.
- 2026-03-01: Extracted shared player volume/position math into pure module `transportMath` with unit tests.
- 2026-03-01: `apps/desktop` test suite for `MusicWorkspaceApp` passes.
- 2026-03-01: Added strict frontend validation for `catalog_update_track_metadata` boundary payloads.
- 2026-03-01: `apps/desktop` full test suite passes (`87 passed`, `5 skipped`), plus production build passes.
- 2026-03-01: Added backend contract tests for `qc_get_active_preview_media` success and error wire shapes with dependency-injected command helper.
- 2026-03-01: Added backend contract test for blind-X hidden identity semantics (`blind_x_revealed=false` masks resolved variant while preserving deterministic media routing).
- 2026-03-01: Added frontend blind-X reveal regression test (`hidden -> revealed`) and fixed preview-session effect coupling that could reset reveal state on playback-source changes.
- 2026-03-01: Removed QC batch-export passthrough fallback-success path; ffmpeg launch/encode failures now report explicit failed profile outcomes.
- 2026-03-01: Added frontend regression test that surfaces terminal failed batch-export status (`Batch export failed`) from polled job state.
- 2026-03-01: Added playback error-wire contract tests for invalid volume and invalid seek-ratio boundaries.
- 2026-03-01: Added regression coverage for QC variant-source switching in shared transport (`Codec A`/`Codec B` changes update player source path).
- 2026-03-01: Upgraded core audio analysis to compute true peak using EBU R128 `Mode::TRUE_PEAK` and wired the result into catalog import persistence.
- 2026-03-01: Added core/unit coverage for true-peak computation and catalog round-trip assertions that `true_peak_dbfs` is populated.
- 2026-03-01: Expanded LUFS/peak persistence guards with DB and command-layer tests (tampered catalog peak JSON, positive true-peak decode rejection, loudness CHECK enforcement, and import input validation).
- 2026-03-01: Refactored exclusive playback decode/render path to preserve `f32` stereo samples until final device packing, removing early `i16` quantization from the bit-perfect path.
- 2026-03-01: Added 16/24/32-bit PCM packing regression tests (`write_pcm_stereo_frame_*`) and updated stereo interleave tests for the new precision path.
- 2026-03-01: Added `0005_catalog_search_fts.sql` with FTS5 search index + sync triggers and switched backend catalog search to ranked FTS (`bm25`) including file-path indexing.
- 2026-03-01: Added search pagination stability regression test in DB state-machine coverage and validated stable first-page ordering + non-overlapping pages.
- 2026-03-01: Added ingest cancellation support end-to-end (`catalog_cancel_ingest_job`) with persisted `CANCELED` status, scan-loop short-circuit checks, and frontend cancel controls in Library ingest.
- 2026-03-01: Added cancellation boundary coverage in Rust command tests and frontend regression coverage for active-scan cancellation action wiring.
- 2026-03-01: `cargo test -p release-publisher-desktop --lib` passes (`76 passed`) and `cargo clippy --all-targets --all-features` passes.
- 2026-03-01: Added frontend regression guard that throws on React `Maximum update depth exceeded` warnings during `MusicWorkspaceApp` tests.
- 2026-03-01: Re-validated frontend full suite (`90 passed`, `5 skipped`) and build gate after loop-regression guard.
- 2026-03-01: Re-validated gates after precision + search phases: desktop lib (`82 passed`), db crate (`27 passed`), frontend (`90 passed`, `5 skipped`), and clippy all-targets/features green.
- 2026-03-01: Re-validated gates after ingest-cancel phase: desktop lib (`83 passed`), db crate (`27 passed`), frontend (`93 passed`, `5 skipped`), and clippy all-targets/features green.
- 2026-03-01: Implemented bounded ingest scan worker slots in backend command service (`RELEASE_PUBLISHER_MAX_CONCURRENT_INGEST_SCANS`) and added explicit queued/running/completed/canceled ingest events with summary payloads.
- 2026-03-01: Hardened ingest polling with bounded IPC parallelism and deduped terminal callbacks to prevent repeated completion handling under rapid poll cycles.
- 2026-03-01: Split `MusicWorkspaceApp` orchestration into dedicated controllers/hooks: `useDroppedIngestAutoplayController` (ingest/drop-autoplay flow) and `useQcPreviewLifecycle` (QC preview and batch-export lifecycle).
- 2026-03-01: Completed Phase 9 validation gate sweep: desktop lib (`83 passed`), db crate (`27 passed`), frontend (`93 passed`, `5 skipped`), `cargo clippy --all-targets --all-features` green, and desktop production build green.

## 6. Definition Of Done (Global)

A task is `DONE` only when all are true:

1. Behavior implemented and linked to task ID in commit message/PR notes.
2. Automated tests added/updated for new behavior.
3. Existing tests pass in relevant packages.
4. Error paths and user-facing messages are explicit and actionable.
5. No new lint/type/test warnings introduced.

## 7. Stability / Maintainability / Testability Checklist

Use this checklist in every implementation task.

### Stability

- Effects are idempotent and guarded against duplicate execution.
- Async callbacks are cancellation-safe.
- State setters avoid redundant updates (`prev === next` guards where applicable).
- Feature fallback behavior is explicit and observable.

### Maintainability

- New logic placed in focused modules/hooks, not monolithic component growth.
- Types are explicit at API boundaries.
- Constants and feature flags are centralized.
- Comments explain invariants, not obvious mechanics.

### Testability

- Contract tests for command payload and error wire shapes.
- Regression tests for prior incident classes.
- Deterministic test fixtures for ingest/playback/QC behavior.
- No reliance on timing races without explicit polling/await strategy.

## 8. Pass/Fail Quality Gates

## Gate A: Build/Test Gate (required every phase)

Pass:

- `npm run test --workspace apps/desktop -- --run`
- `cargo test -p release-publisher-desktop --lib`

Fail:

- Any red test in modified scope.
- New flaky test detected (non-deterministic failures across reruns).

## Gate B: Functional Correctness Gate

Pass:

- Variant selection modifies actual playback source for A/B/X workflows.
- Export status reflects real encode outcomes.
- Ingest remove/reset flows leave no stale visible state.

Fail:

- UI claims state change without backend truth change.
- "Completed" status for failed/missing encode path.

## Gate C: Regression Safety Gate

Pass:

- No "Maximum update depth exceeded" warnings in test logs.
- Queue toggle fallback and drop-autoplay paths covered and green.

Fail:

- Render loop warning/error reappears.
- Prior fixed bug scenarios are no longer covered.

## 9. Manual Smoke Checklist (Release Candidate)

1. Drop folder with new tracks -> scan starts -> first dropped track autoplays.
2. Remove root folder -> track list, queue, favorites, and selection are pruned.
3. Queue reorder works with pointer drag and keyboard shortcuts.
4. Search by title/artist/album/path returns expected ranking and stable pagination.
5. QC preview variant switching audibly changes source (A/B/bypass).
6. Batch export shows truthful per-profile outcomes.
7. Queue/library toggle produces no false playback error banners.

Any failed smoke item is release-blocking for this scope.

## 10. Context Reset Recovery

If context resets, resume in this order:

1. Open this file and continue from first `TODO` item in Section 5.
2. Confirm gates in Sections 8 and 9 for the current phase.
3. Do not start a later phase while earlier-phase `P0` backlog items are open.

## 11. Change Log

- 2026-03-01: Initial master backlog and pass/fail implementation plan created.
- 2026-03-01: Added QC preview active-media command contract coverage and helper extraction for deterministic testing.

## 12. Go/No-Go Summary (2026-03-01)

Verdict: `GO` (scope-limited to Listen/QC workspaces).

- Gate A (Build/Test): PASS
  - `npm run test --workspace apps/desktop -- --run` -> `93 passed`, `5 skipped`
  - `cargo test -p release-publisher-desktop --lib` -> `83 passed`
  - `cargo test -p release-publisher-db` -> `27 passed`
- Gate B (Functional Correctness): PASS (feature-flag, ingest, search, playback and export truth-path behavior covered by command/UI regression tests in scope).
- Gate C (Regression Safety): PASS (`Maximum update depth` guard remains green in workspace tests; queue/drop-autoplay regressions covered and passing).

No open `P0`/`P1` backlog items remain in this document’s scope.
