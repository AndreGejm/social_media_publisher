# Fix Now Implementation Backlog

Date: 2026-02-25
Source: Accepted `FIX NOW` items from the external-review decision matrix (post-analysis)
Scope: Planning only. No product code changes are included in this file.

## Purpose

This backlog converts the accepted `FIX NOW` items into small, testable change-sets that can be implemented one at a time and merged only when green.

This backlog intentionally excludes all items marked `DEFER`, `REJECT`, or `CLARIFY`.

## Hard Constraints (Execution Guardrails)

- Keep determinism and stable `release_id` behavior intact.
- Preserve idempotency (reruns must not duplicate external effects).
- Preserve TEST guardrails in core (not UI-only).
- Preserve per-run caps in core.
- Preserve atomic DB updates for multi-write step persistence.
- Preserve a single serializable error boundary at the Tauri command boundary.
- Preserve and improve redaction; do not weaken it.
- No production connectors and no production credentials.

## Excluded (Not In This Backlog)

- CSP hardening: already fixed and covered by tests (`apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src/tauri-config.test.ts`).
- Broad Tauri capability allowlist/plugin-FS scoping changes: deferred until relevant plugins are used.
- WAL / `BEGIN IMMEDIATE` SQLite tuning: deferred until concurrency model changes require it.
- Full cancellation token + abort UI: deferred until connector execution semantics are finalized.
- Large orchestrator compensation/DAG refactor: deferred.
- UX feature work not required for current hardening scope (templates, steppers, filters, etc.): deferred.
- Generated TS bindings (`ts-rs` / `specta`): deferred; use constants + contract tests first.

## Standard Task Workflow (Mandatory for Every Task)

### A) Define Scope & Acceptance Criteria

- One-sentence objective.
- Explicit done conditions (tests + behavior).
- Files expected to change.

### B) Add/Upgrade Tests First (or same commit if impossible)

- Unit tests for pure logic.
- Integration test for DB/state/command boundary if relevant.
- Playwright E2E only when the task changes user-facing behavior in web/runtime flows.

### C) Implement Minimal Code Change

- Prefer small pure-function extractions.
- Keep interfaces stable unless a change is required by the task.
- No new dependencies unless justified in the task report.

### D) Run Verification Commands (Mandatory)

Rust:

```powershell
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all --all-features
```

Frontend:

```powershell
npm run lint --workspace apps/desktop
npm run typecheck --workspace apps/desktop
npm run test --workspace apps/desktop -- --run
```

Playwright:

```powershell
npm run test:e2e
# or runtime when task requires desktop runtime behavior:
npm run test:e2e:runtime
```

### E) Output Short Change Report (Mandatory)

- What changed
- Why it is safe
- What tests prove it

## Execution Order (Accepted Fix Now Items Only)

Status legend: `READY`, `TODO`, `BLOCKED`, `DONE`

| Order | ID | Priority | Status | Change-set | Primary Risk Reduced | Depends On |
|---|---|---|---|---|---|---|
| 1 | FN-SEC-01 | P0 | READY | Harden `get_report` input validation (`release_id`) and path safety | Command-boundary path abuse | None |
| 2 | FN-SEC-02 | P0 | TODO | Backend redaction at IPC/error boundary + env-gated frontend error-detail logging | Secret/detail leakage | FN-SEC-01 |
| 3 | FN-SEC-03 | P0 | TODO | SecretStore contract (trait + in-memory backend) + no-secret-over-IPC tests | Connector-readiness secret handling | FN-SEC-02 |
| 4 | FN-SEC-04 | P1 | TODO | IPC threat model + command input policy documentation | Security review repeatability | FN-SEC-01 |
| 5 | FN-STAB-01 | P0 | TODO | Persist planned release descriptor on `plan_release` | Restart/resume volatility | None |
| 6 | FN-STAB-02 | P0 | TODO | Execute from persisted descriptor (keep session fallback temporarily) | Restart-resume reliability | FN-STAB-01 |
| 7 | FN-STAB-03 | P0 | TODO | Remove `planned_releases` dependency + restart integration tests | Crash/restart correctness | FN-STAB-02 |
| 8 | FN-STAB-04 | P0 | TODO | Run-lock lease schema + DB API (expiry/takeover primitives) | Crash orphan lock DoS | None |
| 9 | FN-STAB-05 | P0 | TODO | Orchestrator lock owner epoch/lease usage + recovery tests | Crash safety / single-owner execution | FN-STAB-04 |
| 10 | FN-STAB-06 | P1 | TODO | UI stale-response guards for history/report async loads | UI race overwrites | None |
| 11 | FN-DET-01 | P1 | TODO | Strict parsing for report `result_json` inference | Silent schema corruption masking | None |
| 12 | FN-DET-02 | P1 | TODO | Correct `reused_completed_result` in report + resume reporting tests | Resume observability correctness | FN-DET-01 |
| 13 | FN-DET-03 | P1 | TODO | `upsert_release` collision invariant assertion (`release_id` hash/spec mismatch) | Determinism invariant hardening | None |
| 14 | FN-DET-04 | P1 | TODO | Typed `ExecutionResult.status` enum in core pipeline | Connector contract drift | None |
| 15 | FN-DET-05 | P1 | TODO | Typed planned action contract (replace/encapsulate string `action`) | Connector action parsing drift | FN-DET-04 |
| 16 | FN-OBS-01 | P1 | TODO | Centralize `AppError` code constants + IPC contract tests | IPC contract drift | None |
| 17 | FN-OBS-02 | P1 | TODO | Correlation IDs and path-safe diagnostics defaults in logs/UI | Traceability + data minimization | FN-SEC-02 |
| 18 | FN-MAINT-01 | P2 | TODO | `handle_get_report` single JSON decode + large payload regression test | Report path performance/dup parse | FN-SEC-01 |
| 19 | FN-MAINT-02 | P2 | TODO | `spec.rs` constants for tag limits + invariant-path cleanup | Readability / drift prevention | None |

## Detailed Task Cards

## FN-SEC-01 (P0) Harden `get_report` Input Validation and Path Safety

### A) Scope & Acceptance Criteria

- Objective: Prevent path traversal and malformed report lookup inputs by strictly validating `release_id` before building the report artifact path.
- Done conditions:
- `get_report` rejects invalid IDs (empty, non-hex, wrong length, traversal characters) with `INVALID_ARGUMENT`.
- Valid 64-char lowercase/uppercase hex `release_id` still works.
- Existing spec/media path behavior remains unchanged.
- Rust command tests cover positive and negative inputs.
- Files expected to change:
- `apps/desktop/src-tauri/src/commands.rs`
- `playwright/runtime/desktop-runtime.spec.ts` (only if runtime E2E assertion is added/updated)

### B) Tests First

- Add command-service unit/integration tests in `apps/desktop/src-tauri/src/commands.rs` tests:
- rejects `../x`, `..\\x`, `a/b`, `a..`, short IDs, non-hex IDs for `handle_get_report`.
- accepts a valid 64-char hex `release_id` and returns `None` if no report exists.
- Keep existing odd-prefix path tests unchanged.

### C) Minimal Code Change

- Add a small pure validator function (for example `validate_release_id_for_artifact_lookup`).
- Call it inside `handle_get_report` before path construction.
- Do not alter `canonicalize_file_path` behavior for spec/media inputs.

### D/E) Execution

- Use the standard workflow sections D and E above.

## FN-SEC-02 (P0) Backend Redaction at IPC/Error Boundary + Env-Gated Frontend Logging

### A) Scope & Acceptance Criteria

- Objective: Ensure sensitive values are redacted before crossing the Rust->UI boundary and avoid unconditional frontend logging of error details.
- Done conditions:
- Backend command errors redact sensitive keys recursively in `details`.
- Frontend logs error details only in an explicit safe mode (for example TEST/dev gate), with a correlation tag when available.
- Existing UI-side redaction remains as defense-in-depth.
- Tests prove a secret-like key never appears in frontend-visible error details or console logs.
- Files expected to change:
- `apps/desktop/src-tauri/src/commands.rs`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/App.test.tsx`

### B) Tests First

- Rust tests for recursive redaction helper (sensitive keys, nested objects, arrays).
- UI unit tests:
- ensure console logging is gated.
- ensure details shown/handled remain redacted.

### C) Minimal Code Change

- Add a small backend `redact_json_value` helper for `AppError.details`.
- Apply redaction in `AppError::with_details` path or at command-return boundaries.
- Add a frontend gate around `console.error` (do not remove error display UX).

### D/E) Execution

- Use the standard workflow sections D and E above.

## FN-SEC-03 (P0) SecretStore Contract (Trait + In-Memory Backend) and No-Secret IPC Contract Tests

### A) Scope & Acceptance Criteria

- Objective: Introduce a connector-readiness secret storage abstraction without adding production connectors or credentials.
- Done conditions:
- `SecretStore` trait (or equivalent) exists in Rust with an in-memory/test backend.
- No OS keychain integration required in this task.
- No secret values are serialized into DB audit rows or command error details in tests.
- Connector enablement remains mock-only.
- Files expected to change:
- `crates/core/src/...` (new secret-store module or existing core boundary module)
- `apps/desktop/src-tauri/src/commands.rs` (only if wiring is needed for future-safe command boundary types)
- `crates/core/tests/...` or `apps/desktop/src-tauri/src/commands.rs` tests
- `SECURITY.md` (optional but preferred)

### B) Tests First

- Unit tests for in-memory `SecretStore` CRUD semantics.
- Redaction/serialization contract tests (no secret values in exposed payloads/log-friendly structs).

### C) Minimal Code Change

- Add trait + in-memory implementation only.
- Avoid adding new dependencies (no keyring plugin yet).
- Keep connector code mock-only and unmodified unless a small interface hook is needed.

### D/E) Execution

- Use the standard workflow sections D and E above.

## FN-SEC-04 (P1) IPC Threat Model and Command Input Policy Documentation

### A) Scope & Acceptance Criteria

- Objective: Document the Tauri IPC trust boundary and per-command input validation policies to prevent recurring review misunderstandings and future unsafe changes.
- Done conditions:
- Threat-model document exists with:
- trust boundary (WebView untrusted, Rust command layer trusted)
- command inventory (`load_spec`, `plan_release`, `execute_release`, `list_history`, `get_report`)
- input validation rules and path policies
- redaction rules and logging expectations
- links to relevant tests
- Files expected to change:
- `SECURITY.md` or new `IPC_THREAT_MODEL.md`

### B) Tests First

- Documentation task only; no code tests required.
- Cross-reference existing tests by path.

### C) Minimal Code Change

- Documentation only.

### D/E) Execution

- Run relevant tests only if doc references changed command behavior (not expected).

## FN-STAB-01 (P0) Persist Planned Release Descriptor on `plan_release`

### A) Scope & Acceptance Criteria

- Objective: Persist a resumable plan descriptor at plan time so execution can survive app restart.
- Done conditions:
- `plan_release` writes a versioned persisted descriptor (artifact file or DB row) keyed by `release_id`.
- Descriptor includes integrity material (for example schema version + hash fields) needed for later validation.
- Existing `plan_release` response remains stable unless additional backward-compatible fields are required.
- Tests assert descriptor persistence after plan.
- Files expected to change:
- `apps/desktop/src-tauri/src/commands.rs`
- `crates/core/src/orchestrator.rs` (only if a new exportable descriptor type is introduced here)
- `apps/desktop/src-tauri/src/commands.rs` tests

### B) Tests First

- Add command-service test that plans a release and asserts descriptor artifact exists and decodes.

### C) Minimal Code Change

- Introduce a minimal persisted descriptor struct (separate from full in-memory `PlannedRelease` if that reduces churn).
- Prefer artifact-based persistence first to avoid DB schema churn in this step.

### D/E) Execution

- Use the standard workflow sections D and E above.

## FN-STAB-02 (P0) Execute from Persisted Descriptor (Transitional Fallback Allowed)

### A) Scope & Acceptance Criteria

- Objective: Allow `execute_release(release_id)` to hydrate planned execution data from the persisted descriptor instead of requiring current-session memory.
- Done conditions:
- `handle_execute_release` can execute a previously planned release after service re-instantiation.
- Transitional fallback to in-memory `planned_releases` is allowed in this task only to reduce risk.
- Hash/integrity mismatch fails safely with a stable error code.
- Tests prove persisted-hydration path works.
- Files expected to change:
- `apps/desktop/src-tauri/src/commands.rs`
- `apps/desktop/src-tauri/src/commands.rs` tests

### B) Tests First

- New test: plan with one `CommandService`, construct a fresh service on same temp dir, execute by `release_id`, expect success.

### C) Minimal Code Change

- Add descriptor load/validate helper.
- Keep orchestrator interface stable if possible.

### D/E) Execution

- Use the standard workflow sections D and E above.

## FN-STAB-03 (P0) Remove `planned_releases` Session Dependency and Restart Tests

### A) Scope & Acceptance Criteria

- Objective: Eliminate in-memory `planned_releases` as a required execution dependency.
- Done conditions:
- `planned_releases` map removed or reduced to optional cache only (not a correctness dependency).
- `PLANNED_RELEASE_NOT_FOUND` no longer occurs for a correctly persisted planned release after restart.
- Restart integration test remains green.
- Files expected to change:
- `apps/desktop/src-tauri/src/commands.rs`
- `apps/desktop/src-tauri/src/commands.rs` tests

### B) Tests First

- Promote and keep the restart test from FN-STAB-02.
- Add negative tests for missing descriptor / corrupted descriptor.

### C) Minimal Code Change

- Remove required map lookup path.
- Keep command response types stable.

### D/E) Execution

- Use the standard workflow sections D and E above.

## FN-STAB-04 (P0) Run-Lock Lease Schema and DB API

### A) Scope & Acceptance Criteria

- Objective: Add lock lease metadata and takeover primitives to prevent permanent orphaned `run_locks`.
- Done conditions:
- `run_locks` stores lease metadata (expiry and owner epoch or equivalent).
- DB APIs support acquire/renew/release and safe takeover after expiry.
- DB tests cover non-expired lock rejection and expired lock takeover.
- Files expected to change:
- `crates/db/migrations/0001_initial.sql` (or new migration if preferred)
- `crates/db/src/lib.rs`
- `crates/db/tests/state_machine.rs`

### B) Tests First

- Add DB integration tests for:
- fresh lock acquire
- acquire blocked before expiry
- takeover after expiry
- release by wrong owner/epoch rejected (if owner epoch implemented in DB layer)

### C) Minimal Code Change

- Introduce DB-level lease semantics first; do not wire orchestrator yet.
- Keep legacy API wrappers temporarily if needed for staged migration.

### D/E) Execution

- Use the standard workflow sections D and E above.

## FN-STAB-05 (P0) Orchestrator Lease Usage + Crash Recovery Tests

### A) Scope & Acceptance Criteria

- Objective: Use lease-aware run-lock APIs in the orchestrator and preserve single-owner execution semantics across crash/restart simulations.
- Done conditions:
- Orchestrator lock owner includes stable uniqueness beyond PID-only semantics (owner epoch/token).
- Orchestrator acquires/releases using lease-aware DB APIs.
- Tests prove stale-lock recovery does not allow double execution and eventual progress is possible.
- Files expected to change:
- `crates/core/src/orchestrator.rs`
- `crates/core/tests/mock_pipeline.rs`
- `crates/db/src/lib.rs` (small API wiring only if required)

### B) Tests First

- Add orchestrator integration test simulating stale lock left behind and later takeover.

### C) Minimal Code Change

- Change only lock-acquire/release call sites and owner construction first.
- Avoid broader execution-loop refactors.

### D/E) Execution

- Use the standard workflow sections D and E above.

## FN-STAB-06 (P1) UI Stale-Response Guards for History/Report Async Loads

### A) Scope & Acceptance Criteria

- Objective: Prevent out-of-order async responses from overwriting newer UI state in history/report flows.
- Done conditions:
- `refreshHistory` and `loadReportFor` ignore stale completions (sequence ID or request token).
- UI unit tests simulate delayed/out-of-order promises and confirm latest response wins.
- No backend API changes required.
- Files expected to change:
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/App.test.tsx`
- `playwright/tests/smoke.spec.ts` (only if a UX regression path needs E2E coverage)

### B) Tests First

- Add Vitest cases with deferred promises for `list_history` and `get_report`.
- Assert stale response does not overwrite current selection/report.

### C) Minimal Code Change

- Add request sequence counters or local tokens; do not introduce new dependencies.
- Keep UI layout and command names unchanged.

### D/E) Execution

- Use the standard workflow sections D and E above.

## FN-DET-01 (P1) Strict Parsing for `result_json` Inference in Report Finalization

### A) Scope & Acceptance Criteria

- Objective: Replace tolerant ad-hoc JSON key probing in `infer_simulated_and_verified` with strict parsing that fails on malformed execution/verification payloads.
- Done conditions:
- Malformed or shape-drifted `result_json` yields a deterministic orchestrator error (not silent false/false).
- Valid existing report payload shape continues to work.
- Unit tests cover malformed/missing fields and valid payloads.
- Files expected to change:
- `crates/core/src/orchestrator.rs`
- `crates/core/tests/mock_pipeline.rs` (or new targeted test file)

### B) Tests First

- Add unit tests around `infer_simulated_and_verified` (or replacement parser helper).
- Add integration case for malformed stored `result_json` during report finalization.

### C) Minimal Code Change

- Introduce typed serde helper structs for stored result payload.
- Keep public report schema unchanged in this task.

### D/E) Execution

- Use the standard workflow sections D and E above.

## FN-DET-02 (P1) Correct `reused_completed_result` in Resume Reports

### A) Scope & Acceptance Criteria

- Objective: Accurately mark when a platform result in the final report was reused from a prior successful run.
- Done conditions:
- `reused_completed_result` is no longer hardcoded false.
- Resume scenarios mark previously verified platforms as reused.
- Tests prove resumed run reports distinguish reused vs newly executed platforms.
- Optional UI text improvement is backward-compatible and test-covered if added here.
- Files expected to change:
- `crates/core/src/orchestrator.rs`
- `crates/core/tests/mock_pipeline.rs`
- `apps/desktop/src-tauri/src/commands.rs` (if report mapping changes)
- `apps/desktop/src/App.tsx` / `apps/desktop/src/App.test.tsx` (only if UI label change included)

### B) Tests First

- Extend resume/idempotency integration tests to assert `reused_completed_result`.

### C) Minimal Code Change

- Compute reused status from pre-execution pending/completed set or persisted action status.
- Avoid changing core resume semantics.

### D/E) Execution

- Use the standard workflow sections D and E above.

## FN-DET-03 (P1) `upsert_release` Collision Invariant Assertion

### A) Scope & Acceptance Criteria

- Objective: Fail fast if an existing `release_id` is reused with different deterministic hashes/spec payloads.
- Done conditions:
- `upsert_release` detects mismatch on conflict and returns deterministic DB/internal invariant error.
- Idempotent replay with matching values remains successful.
- DB tests cover match and mismatch cases.
- Files expected to change:
- `crates/db/src/lib.rs`
- `crates/db/tests/state_machine.rs`

### B) Tests First

- Add DB tests for:
- same `release_id` + same hash/spec => allowed
- same `release_id` + different `spec_hash` or `media_fingerprint` => rejected

### C) Minimal Code Change

- Add targeted post-upsert validation or conflict-side assertion query.
- Avoid schema migration unless required.

### D/E) Execution

- Use the standard workflow sections D and E above.

## FN-DET-04 (P1) Typed `ExecutionResult.status` Enum in Core Pipeline

### A) Scope & Acceptance Criteria

- Objective: Replace core `ExecutionResult.status: String` with a serde-stable enum to prevent connector status drift.
- Done conditions:
- Core pipeline model uses a typed enum for execution status.
- Mock connector and core tests updated.
- Report generation and UI command mapping still serialize/display stable values.
- Files expected to change:
- `crates/core/src/pipeline.rs`
- `crates/connectors/mock/src/lib.rs`
- `crates/core/tests/mock_pipeline.rs`
- `crates/core/src/orchestrator.rs`
- `apps/desktop/src-tauri/src/commands.rs` (if formatting helper changes)

### B) Tests First

- Add/adjust unit tests for serde serialization of the new enum.
- Update affected integration assertions.

### C) Minimal Code Change

- Introduce enum first while preserving wire serialization names.
- Keep `PlannedAction.action` string unchanged in this task.

### D/E) Execution

- Use the standard workflow sections D and E above.

## FN-DET-05 (P1) Typed Planned Action Contract (Replace/Encapsulate String `action`)

### A) Scope & Acceptance Criteria

- Objective: Reduce connector action parsing drift by introducing a typed planned-action contract (or typed kind + optional details).
- Done conditions:
- Core planned action no longer relies on a free-form string as the only action identifier.
- Mock connector and report/UI formatting continue to work with stable serialization.
- Tests cover serialization and existing display behavior.
- Files expected to change:
- `crates/core/src/pipeline.rs`
- `crates/connectors/mock/src/lib.rs`
- `crates/core/tests/mock_pipeline.rs`
- `apps/desktop/src-tauri/src/commands.rs`
- `apps/desktop/src/App.tsx` / `apps/desktop/src/App.test.tsx` (if UI payload shape changes)

### B) Tests First

- Add serde compatibility tests for planned-action contract.
- Update UI/command tests as needed.

### C) Minimal Code Change

- Prefer additive migration (new typed field + formatter) before removing legacy string if needed.
- Keep interfaces stable where possible.

### D/E) Execution

- Use the standard workflow sections D and E above.

## FN-OBS-01 (P1) Centralize `AppError` Codes + IPC Contract Tests

### A) Scope & Acceptance Criteria

- Objective: Reduce stringly error-contract drift by centralizing backend error codes and asserting stable IPC error shapes.
- Done conditions:
- `AppError` code literals are centralized (constants or enum-backed mapping).
- Tests assert key command failures return stable codes and serializable `details`.
- No new dependencies required.
- Files expected to change:
- `apps/desktop/src-tauri/src/commands.rs`
- `apps/desktop/src/App.test.tsx`
- `apps/desktop/src-tauri/src/commands.rs` tests

### B) Tests First

- Add/upgrade command-layer tests for representative error cases:
- invalid argument
- report decode failure
- planned release missing (until FN-STAB-03 removes this path)
- DB error mapping

### C) Minimal Code Change

- Introduce constants/mapping helpers only.
- Defer code generation (`ts-rs` / `specta`).

### D/E) Execution

- Use the standard workflow sections D and E above.

## FN-OBS-02 (P1) Correlation IDs and Path-Safe Diagnostics Defaults

### A) Scope & Acceptance Criteria

- Objective: Improve log traceability while reducing accidental path leakage in UI/log diagnostics.
- Done conditions:
- Correlation tags (`release_id`, `run_id` where available) are present on key command/orchestrator logs.
- UI path/error detail diagnostics default to safe/truncated form, with explicit safe-mode override if implemented.
- Tests cover redaction/truncation helpers.
- Files expected to change:
- `crates/core/src/orchestrator.rs`
- `apps/desktop/src-tauri/src/commands.rs`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/App.test.tsx`
- `HARDENING_REPORT.md` (after task completion)

### B) Tests First

- Unit tests for path redaction/truncation helper(s).
- UI tests for displayed/logged diagnostics behavior.

### C) Minimal Code Change

- Add small formatting helpers; avoid sweeping logging framework changes.
- Defer JSON log output format switch.

### D/E) Execution

- Use the standard workflow sections D and E above.

## FN-MAINT-01 (P2) `handle_get_report` Single Decode + Large Payload Regression Test

### A) Scope & Acceptance Criteria

- Objective: Remove duplicate JSON deserialization in `handle_get_report` and guard large report behavior.
- Done conditions:
- `handle_get_report` parses report bytes once (typed + raw derived without double decode, or justified single parse path).
- Tests cover larger payloads and decode correctness.
- No response shape regressions.
- Files expected to change:
- `apps/desktop/src-tauri/src/commands.rs`
- `apps/desktop/src-tauri/src/commands.rs` tests

### B) Tests First

- Add command-layer test with oversized/large synthetic `release_report.json`.

### C) Minimal Code Change

- Prefer `serde_json::from_slice::<Value>` once plus typed conversion, or equivalent safe single-pass strategy.
- Keep API shape unchanged.

### D/E) Execution

- Use the standard workflow sections D and E above.

## FN-MAINT-02 (P2) `spec.rs` Tag Policy Constants + Invariant Cleanup

### A) Scope & Acceptance Criteria

- Objective: Reduce parser drift and clarify invariants by extracting tag policy constants and tightening the impossible fallback path.
- Done conditions:
- Tag count/length limits live in named constants.
- Messages use the same constants.
- Invariant fallback is clarified (for example debug assertion + deterministic construction) without changing parser outcomes.
- Existing spec parser tests remain green and new unit tests cover constant-driven messages if needed.
- Files expected to change:
- `crates/core/src/spec.rs`
- `crates/core/tests/...` (if new parser tests are added)

### B) Tests First

- Add parser tests for tag limit boundaries only if current coverage is insufficient.

### C) Minimal Code Change

- Mechanical extraction first, then invariant-path cleanup.
- No serialization changes.

### D/E) Execution

- Use the standard workflow sections D and E above.

## First Task Ready to Execute (Next Implementation Turn)

Task: `FN-SEC-01` Harden `get_report` `release_id` validation and path safety.

Reason this is first:

- It is a real command-boundary hardening gap.
- It is small and testable.
- It does not require schema migrations or connector abstractions.
- It reduces path abuse risk without changing valid spec/media workflows.

## Completion Tracking (Fill During Execution)

Add one entry per completed task:

- Task ID:
- Commit/Patch:
- Tests added/updated:
- Verification commands run:
- Result:
- `HARDENING_REPORT.md` / `CHANGELOG.md` updates:

