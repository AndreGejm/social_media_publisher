# Hardening Report (Phase 4 -> Hardened for Phase 5 Prep)

## Scope
- Hardened Rust DB layer, orchestrator atomicity, Tauri command boundary, frontend error handling, transport testkit invariants, and CI quality gates.
- No real platform connectors were added.
- All execution remains mock/test-safe (`MockPublisher` only).
- Ongoing Phase 5 pre-connector hardening continues in small change-sets (including Tauri CSP hardening).

## What Changed

### 1) Typed DB Errors + Stable Codes
- Added `DbErrorCode`, `DbError`, and `DbResult<T>` in `crates/db/src/lib.rs`.
- Converted DB public APIs to typed results (no public `anyhow::Result` in DB APIs).
- Added deterministic SQLx error mapping for:
  - connection
  - migration
  - constraint violation
  - busy/locked
  - not found
  - row decode / JSON serialization/deserialization

### 2) Transactional DB Writes (Atomic Step Persistence)
- Added `DbTx` transaction wrapper in `crates/db/src/lib.rs` with transactional methods:
  - `upsert_release`
  - `get_release`
  - `transition_release_state`
  - `set_release_failed`
  - `upsert_platform_action`
  - `get_platform_action`
  - `append_audit_log`
- Orchestrator now uses transactions for multi-write steps in `crates/core/src/orchestrator.rs`:
  - plan phase platform row + audit log
  - execute phase platform row + audit log
  - verify phase platform row + audit log
  - failure path platform row + release FAILED state + audit log
  - final `EXECUTING -> VERIFIED -> COMMITTED` sequence

### 3) Tauri Command Boundary (Real Core/DB Wiring)
- Replaced command stubs in `apps/desktop/src-tauri/src/commands.rs` with a real command service backed by:
  - `Orchestrator`
  - SQLite DB
  - `MockPublisher`
- Commands now call real core logic:
  - `load_spec`
  - `plan_release`
  - `execute_release`
  - `list_history`
  - `get_report`
- Added single serializable error boundary:
  - `AppError { code, message, details }`

### 4) Tauri Path Safety Hardening
- Added path canonicalization + file-type checks in `apps/desktop/src-tauri/src/commands.rs`.
- Rejects unsafe/odd prefixes:
  - `file://`
  - device/extended paths (`\\?\`, `\\.\`)
  - UNC/network paths

### 5) Frontend Error Handling + UI Hardening
- UI now uses a command invocation abstraction (`apps/desktop/src/App.tsx`) and shows structured backend errors as `code + message`.
- Added error detail redaction in UI logging for keys containing:
  - authorization
  - cookie
  - refresh token
  - client secret
  - API key
- Browser preview safely reports `TAURI_UNAVAILABLE` instead of pretending to execute commands.

### 6) Frontend Linting + CI Gates
- Added real ESLint config (`apps/desktop/eslint.config.js`).
- Replaced placeholder lint script with `eslint . --max-warnings=0`.
- CI now enforces:
  - frontend lint
  - frontend typecheck
  - frontend unit tests
  - Playwright
  - rustfmt check
  - clippy with `-D warnings`

### 7) Transport/Testkit Hardening
- Expanded header redaction in `crates/core/src/transport.rs` to include:
  - cookies
  - client-secret headers
- Added deterministic `TestTransport` request matching in `crates/testkit/src/lib.rs` by:
  - method
  - URL substring
  - call index
- Added retry/transport invariant tests in `crates/testkit/tests/transport_faults.rs`:
  - max attempts cap
  - no retries for permanent `400`
  - scripted request matching

## Tests Added / Updated

### DB / Atomicity
- `crates/db/tests/state_machine.rs`
  - asserts typed error codes
  - adds rollback test for mid-transaction failure

### Core / Safety
- `crates/core/tests/mock_pipeline.rs`
  - cap enforcement test (`cap=1`)
  - TEST-mode non-simulated action guardrail rejection test

### Tauri Command Path (Rust-side, real command service)
- `apps/desktop/src-tauri/src/commands.rs` tests:
  - plan -> execute -> history -> report happy path
  - unsafe path rejection

### Frontend / Playwright
- `apps/desktop/src/App.test.tsx`
  - structured backend error display (`TAURI_UNAVAILABLE`)
- `playwright/tests/smoke.spec.ts`
  - browser preview structured backend error path

## Remaining Blocker (Stop-the-line for strict DoD)
- A Playwright E2E that exercises a **real Tauri command path** end-to-end (inside an actual Tauri webview/runtime) is **not fully implemented/proven** here.
  - Current Playwright config runs against Vite web preview only.
  - I added real Tauri command-path coverage via Rust command-service tests, but not a Playwright-on-Tauri runtime harness.

## Verification Commands

### Rust
```powershell
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all --all-features
```

### Frontend
```powershell
npm install
npm run lint --workspace apps/desktop
npm run typecheck --workspace apps/desktop
npm run test --workspace apps/desktop -- --run
```

### Playwright (web preview)
```powershell
npm run test:e2e
```

### Targeted Invariant Suites
```powershell
cargo test -p release-publisher-db --test state_machine
cargo test -p release-publisher-core --test mock_pipeline
cargo test -p release-publisher-core --test idempotency_properties
cargo test -p release-publisher-testkit --test transport_faults
```

## Notes
- This environment does not have `cargo` installed, so I could not run Rust `fmt/clippy/test` here.
- Network-restricted environment also prevented dependency install/execution for npm-based checks.

## Incremental Backlog Execution Log

### 2026-02-25 - BL-01-T1 (Report Lookup `release_id` Validation)
- Scope:
  - Added strict `release_id` validation for report artifact lookup (`get_report`) in `apps/desktop/src-tauri/src/commands.rs`.
  - Validation now requires a non-empty 64-character hex string and normalizes case to lowercase before artifact path lookup.
- Why it is safe:
  - Change is isolated to `handle_get_report`; spec/media path handling and execution paths are unchanged.
  - Valid lowercase IDs keep existing behavior; uppercase IDs are accepted via normalization.
  - Invalid traversal-like or malformed IDs now fail fast with the existing serializable `AppError` boundary (`INVALID_ARGUMENT`).
- Tests added/updated:
  - `apps/desktop/src-tauri/src/commands.rs`:
    - unit test: accepts hex and normalizes uppercase -> lowercase
    - unit test: rejects malformed/short/non-hex inputs
    - command-service test: `get_report` rejects invalid `release_id` inputs
    - command-service test: `get_report` accepts uppercase hex lookup (returns `None` when artifact absent)
- Verification results:
  - `cargo fmt --all -- --check` ✅
  - `cargo clippy --all-targets --all-features -- -D warnings` ✅ (required sandbox escalation due build artifact write restrictions)
  - `cargo test --all --all-features` ✅ (required sandbox escalation due build artifact write restrictions)
  - `npm run lint --workspace apps/desktop` ✅
  - `npm run typecheck --workspace apps/desktop` ⚠️ blocked by pre-existing frontend TypeScript config issue (`apps/desktop/src/tauri-config.test.ts` missing Node typings)
  - `npm run test --workspace apps/desktop -- --run` ✅ (required sandbox escalation because Vitest/Vite spawn hit `EPERM` in sandbox)
  - Playwright: not run for this task (Rust-only command input validation; no UI/E2E behavior changed)

### 2026-02-25 - BL-GATE-01-T1 (Frontend Typecheck Gate Unblock - Node Types)
- Scope:
  - Fixed a pre-existing frontend `typecheck` failure caused by Node built-in module imports in `apps/desktop/src/tauri-config.test.ts` not having Node type declarations enabled/installed.
  - Added Node types to the desktop TS config and installed `@types/node` as a desktop dev dependency.
- Root cause:
  - `apps/desktop/tsconfig.app.json` limited `compilerOptions.types` to `vitest/globals`, excluding Node ambient types.
  - `@types/node` was not present in the current workspace install.
- Why it is safe:
  - Change is test/tooling-only (`tsconfig` + dev dependency); no runtime app logic, Rust core behavior, or command contracts changed.
  - Fix only affects TypeScript compile-time type resolution for test files importing `node:` modules.
- Files changed:
  - `apps/desktop/tsconfig.app.json`
  - `apps/desktop/package.json`
  - `pnpm-lock.yaml`
- Verification results (rerun after fix):
  - `cargo fmt --all -- --check` ✅
  - `cargo clippy --all-targets --all-features -- -D warnings` ✅ (sandbox escalation for build artifacts)
  - `cargo test --all --all-features` ✅ (sandbox escalation for build artifacts)
  - `npm run lint --workspace apps/desktop` ✅
  - `npm run typecheck --workspace apps/desktop` ✅
  - `npm run test --workspace apps/desktop -- --run` ✅ (sandbox escalation for Vitest/Vite spawn)
  - `npm run test:e2e` ✅ (web Playwright suite; relevant frontend gate confirmation)

### 2026-02-25 - BL-02-T1 (Backend Recursive Redaction at `AppError.details`)
- Scope:
  - Added backend recursive redaction for sensitive keys in command error `details` at the `AppError` boundary (`with_details` now redacts before storing).
  - Covers nested objects and arrays.
- Why it is safe:
  - Preserves the existing serializable Tauri error boundary shape (`{ code, message, details? }`).
  - Redaction is applied only to `details` payload values for sensitive keys; non-sensitive fields are unchanged.
  - UI-side redaction remains in place as defense-in-depth.
- Tests added/updated:
  - `apps/desktop/src-tauri/src/commands.rs`:
    - unit test asserting recursive redaction of `authorization`, `cookie`, `client_secret`, `refresh-token`, and `api_key` keys while preserving safe fields
- Verification results:
  - `cargo fmt --all -- --check` ✅
  - `cargo clippy --all-targets --all-features -- -D warnings` ✅ (sandbox escalation for build artifacts)
  - `cargo test --all --all-features` ✅ (sandbox escalation for build artifacts)
  - `npm run lint --workspace apps/desktop` ✅
  - `npm run typecheck --workspace apps/desktop` ✅
  - `npm run test --workspace apps/desktop -- --run` ✅ (sandbox escalation for Vitest/Vite spawn)
  - `npm run test:e2e` ✅ (web Playwright smoke suite)

### 2026-02-25 - BL-02-T2 (Frontend Error-Detail Logging Gate - Default Off)
- Scope:
  - Changed frontend backend-error detail logging to be disabled by default.
  - Added an explicit debug opt-in flag (`window.__RELEASE_PUBLISHER_DEBUG_ERROR_DETAILS__ = true`) to enable console logging of backend error details during local debugging.
- Why it is safe:
  - Backend error UI display (`code: message`) is unchanged.
  - UI-side redaction remains active before any optional logging occurs.
  - Default behavior now reduces accidental local leakage of backend error details to browser/devtools logs.
- Tests added/updated:
  - `apps/desktop/src/App.test.tsx`:
    - new test: backend error details are not logged by default
    - updated logging test: redacted details are logged only when debug flag is explicitly enabled
- Verification results:
  - `cargo fmt --all -- --check` ✅
  - `cargo clippy --all-targets --all-features -- -D warnings` ✅ (sandbox escalation for build artifacts)
  - `cargo test --all --all-features` ✅ (sandbox escalation for build artifacts)
  - `npm run lint --workspace apps/desktop` ✅
  - `npm run typecheck --workspace apps/desktop` ✅
  - `npm run test --workspace apps/desktop -- --run` ✅ (sandbox escalation for Vitest/Vite spawn)
  - `npm run test:e2e` ✅ (web Playwright smoke suite)

### 2026-02-25 - BL-02-T3 (Command-Boundary Proof Test for Backend-Redacted `AppError.details`)
- Scope:
  - Added a command-layer test probe that returns a synthetic `AppError` with sensitive nested `details`.
  - Added a command-boundary serialization test that verifies sensitive values remain redacted after serializing/deserializing the Tauri command error payload.
- Why it is safe:
  - Production error boundary shape remains unchanged (`{ code, message, details? }`).
  - Change is test-focused and validates backend redaction at the command serialization boundary, not just helper-level redaction.
  - No command interfaces, orchestrator behavior, or frontend logic changed.
- Tests added/updated:
  - `apps/desktop/src-tauri/src/commands.rs`:
    - test-only probe returning `AppError` with nested sensitive keys in `details`
    - unit test asserting serialized and round-tripped `AppError` payload preserves redacted values for sensitive keys
- Verification results:
  - `cargo fmt --all -- --check` [OK] (after formatting the new test code)
  - `cargo clippy --all-targets --all-features -- -D warnings` [OK] (sandbox escalation for build artifacts)
  - `cargo test --all --all-features` [OK] (includes `command_error_boundary_serialization_keeps_details_redacted`; sandbox escalation for build artifacts)
  - `npm run lint --workspace apps/desktop` [OK]
  - `npm run typecheck --workspace apps/desktop` [OK]
  - `npm run test --workspace apps/desktop -- --run` [OK] (sandbox escalation for Vitest/Vite spawn)
  - `npm run test:e2e` [OK] (web Playwright smoke suite)

### 2026-02-25 - BL-03-T1 (Core SecretStore Contract + In-Memory Test Backend)
- Scope:
  - Added an additive `core::secrets` module that defines a `SecretStore` trait, typed `SecretStoreError`/`SecretStoreErrorCode`, `SecretValue` (redacted `Debug`), `SecretRecord`, and an `InMemorySecretStore` backend for tests/local wiring.
  - Exported the module from `crates/core/src/lib.rs` for future connector integration without introducing Tauri or OS keychain coupling.
- Why it is safe:
  - No production connector integration or credential storage was added.
  - Change is additive and isolated to `release-publisher-core`; existing orchestrator/transport/IPC paths are unchanged.
  - `SecretValue` and `InMemorySecretStore` custom `Debug` implementations avoid leaking secret material in logs/debug output.
- Tests added/updated:
  - `crates/core/src/secrets.rs` unit tests:
    - put/get/delete round-trip for in-memory store
    - missing-key `NotFound` behavior
    - secret key validation failures (`InvalidArgument`)
    - redacted `Debug` for `SecretValue`
    - `InMemorySecretStore` `Debug` reports count only (no secret values)
    - empty secret value rejection
- Verification results:
  - `cargo fmt --all -- --check` [OK]
  - `cargo clippy --all-targets --all-features -- -D warnings` [OK] (sandbox escalation for build artifacts)
  - `cargo test --all --all-features` [OK] (includes new `secrets` unit tests; sandbox escalation for build artifacts)
  - `npm run lint --workspace apps/desktop` [OK]
  - `npm run typecheck --workspace apps/desktop` [OK]
  - `npm run test --workspace apps/desktop -- --run` [OK] (sandbox escalation for Vitest/Vite spawn)
  - `npm run test:e2e` [OK] (web Playwright smoke suite)

### 2026-02-25 - BL-03-T2 (Command-Boundary SecretStore Redaction Proof Test)
- Scope:
  - Added a desktop command-layer test probe that reads a secret from `InMemorySecretStore` and constructs a synthetic `AppError` with secret-derived values in `details`.
  - Added a command-boundary serialization test proving the Tauri-serializable error payload never contains the raw stored secret string.
- Why it is safe:
  - Test-only change in `apps/desktop/src-tauri/src/commands.rs`; no production command behavior or interfaces changed.
  - Reuses the existing backend `AppError::with_details` redaction path and validates it against a real `SecretStore` retrieval flow.
- Tests added/updated:
  - `apps/desktop/src-tauri/src/commands.rs`:
    - test-only `command_error_secret_store_probe_for_test()` helper using `InMemorySecretStore`
    - `command_error_boundary_never_serializes_secret_store_values` (asserts redaction + absence of raw secret in serialized JSON)
- Verification results:
  - `cargo fmt --all -- --check` [OK]
  - `cargo clippy --all-targets --all-features -- -D warnings` [OK] (sandbox escalation for build artifacts)
  - `cargo test --all --all-features` [OK] (includes `command_error_boundary_never_serializes_secret_store_values`; sandbox escalation for build artifacts)
  - `npm run lint --workspace apps/desktop` [OK]
  - `npm run typecheck --workspace apps/desktop` [OK]
  - `npm run test --workspace apps/desktop -- --run` [OK] (sandbox escalation for Vitest/Vite spawn)
  - `npm run test:e2e` [OK] (web Playwright smoke suite)

### 2026-02-25 - BL-03-T3 (SecretStore Phase Guard Contract Documentation)
- Scope:
  - Updated `SECURITY.md` to document the current pre-connector `SecretStore` contract (`core::secrets` + `InMemorySecretStore`), explicit no-production-credentials/no-OS-keychain status for this phase, and the no-plaintext-secrets-over-IPC rule.
  - Linked the contract to the new proof tests for command-boundary redaction and `SecretValue` debug redaction.
- Why it is safe:
  - Documentation-only change; no runtime behavior, interfaces, or persistence changed.
  - Clarifies current constraints to prevent premature keychain/credential integration and unsafe secret handling assumptions.
- Tests added/updated:
  - None (documentation-only). Existing referenced proof tests remain green.
- Verification results:
  - `cargo fmt --all -- --check` [OK]
  - `cargo clippy --all-targets --all-features -- -D warnings` [OK] (sandbox escalation for build artifacts)
  - `cargo test --all --all-features` [OK] (sandbox escalation for build artifacts)
  - `npm run lint --workspace apps/desktop` [OK]
  - `npm run typecheck --workspace apps/desktop` [OK]
  - `npm run test --workspace apps/desktop -- --run` [OK] (sandbox escalation for Vitest/Vite spawn)
  - `npm run test:e2e` [OK] (web Playwright smoke suite)

### 2026-02-25 - BL-04-T1 (IPC Threat Model + Command Input Policy Documentation)
- Scope:
  - Added `IPC_THREAT_MODEL.md` documenting the Tauri IPC trust boundary, explicit command surface, per-command input validation/path policies, error boundary/redaction rules, current threat mitigations, known backlog-tracked risks, and regression test references.
  - Document reflects current code (including `get_report` `release_id` validation hardening and backend/frontend error-detail redaction behavior).
- Why it is safe:
  - Documentation-only change; no runtime behavior, persistence, command interfaces, or connector behavior changed.
  - Reduces future unsafe changes and review misunderstandings by making the command boundary and validation rules explicit.
- Tests added/updated:
  - None (documentation-only task). Document cross-references existing tests by file/path.
- Verification results:
  - `cargo fmt --all -- --check` [OK]
  - `cargo clippy --all-targets --all-features -- -D warnings` [OK] (sandbox escalation for build artifacts)
  - `cargo test --all --all-features` [OK] (sandbox escalation for build artifacts)
  - `npm run lint --workspace apps/desktop` [OK]
  - `npm run typecheck --workspace apps/desktop` [OK]
  - `npm run test --workspace apps/desktop -- --run` [OK] (sandbox escalation for Vitest/Vite spawn)
  - `npm run test:e2e` [OK] (web Playwright smoke suite)

### 2026-02-25 - BL-05-T1 (Persist Planned Release Descriptor on `plan_release`)
- Scope:
  - Added a versioned `planned_release_descriptor.json` artifact written during `handle_plan_release` under the managed release artifacts directory (`artifacts/<release_id>/`).
  - Descriptor includes schema version and integrity material (`release_id`, `spec_hash`, `media_fingerprint`) plus plan data needed for future restart-safe execution hydration.
  - Existing `plan_release` response shape and current execute path behavior are unchanged.
- Why it is safe:
  - Additive artifact persistence only; no DB schema changes and no execute-path logic changes in this task.
  - Descriptor is derived from the already-produced `PlannedRelease` and written after planning succeeds, preserving existing core/orchestrator invariants.
  - Future restart-hydration work can build on this persisted descriptor without relying solely on in-memory session state.
- Tests added/updated:
  - `apps/desktop/src-tauri/src/commands.rs`:
    - `plan_release_persists_descriptor_artifact_with_integrity_fields` (asserts descriptor file exists, decodes, and contains schema/integrity fields + planned action/request file data)
- Verification results:
  - `cargo fmt --all -- --check` [OK]
  - `cargo clippy --all-targets --all-features -- -D warnings` [OK] (sandbox escalation for build artifacts)
  - `cargo test --all --all-features` [OK] (includes `plan_release_persists_descriptor_artifact_with_integrity_fields`; sandbox escalation for build artifacts)
  - `npm run lint --workspace apps/desktop` [OK]
  - `npm run typecheck --workspace apps/desktop` [OK]
  - `npm run test --workspace apps/desktop -- --run` [OK] (sandbox escalation for Vitest/Vite spawn)
  - `npm run test:e2e` [OK] (web Playwright smoke suite)

### 2026-02-25 - BL-05-T2 (Execute from Persisted Descriptor with Transitional Cache Fallback)
- Scope:
  - Updated `handle_execute_release` to hydrate `PlannedRelease` from persisted `planned_release_descriptor.json` when the in-memory `planned_releases` cache is empty (restart-safe path).
  - Kept the in-memory cache lookup as a transitional fast path for this task only.
  - Added descriptor load/validation helpers (schema version, structure, and integrity checks against DB `ReleaseRecord` hashes) with stable error codes for decode/version/integrity failures.
  - Tightened `execute_release` input handling to validate/normalize `release_id` as 64-char hex before descriptor path derivation.
  - Updated `IPC_THREAT_MODEL.md` to reflect the new `execute_release` validation + persisted-descriptor hydration behavior.
- Why it is safe:
  - Orchestrator interface remains unchanged; hydration reconstructs `PlannedRelease` from the versioned descriptor and verifies integrity (`release_id`, `spec_hash`, `media_fingerprint`) against persisted DB state before execution.
  - Transitional in-memory cache path remains available to reduce behavior risk while restart-safe execution is introduced.
  - Descriptor mismatches fail before execution with a stable error code (`PLANNED_RELEASE_DESCRIPTOR_INTEGRITY_MISMATCH`).
- Tests added/updated:
  - `apps/desktop/src-tauri/src/commands.rs`:
    - `execute_release_hydrates_persisted_descriptor_after_service_restart`
    - `execute_release_rejects_persisted_descriptor_integrity_mismatch`
- Verification results:
  - `cargo fmt --all -- --check` [OK]
  - `cargo clippy --all-targets --all-features -- -D warnings` [OK] (sandbox escalation for build artifacts)
  - `cargo test --all --all-features` [OK] (includes restart hydration + integrity mismatch tests; sandbox escalation for build artifacts)
  - `npm run lint --workspace apps/desktop` [OK]
  - `npm run typecheck --workspace apps/desktop` [OK]
  - `npm run test --workspace apps/desktop -- --run` [OK] (sandbox escalation for Vitest/Vite spawn)
  - `npm run test:e2e` [OK] (web Playwright smoke suite)

### 2026-02-25 - BL-05-T3 (Remove `planned_releases` Dependency + Descriptor Negative Tests)
- Scope:
  - Removed the in-memory `planned_releases` cache from `CommandService`; `execute_release` now hydrates planned execution data exclusively from the persisted descriptor (`planned_release_descriptor.json`).
  - Kept the orchestrator interface unchanged and retained safe failure behavior for missing/corrupt/tampered descriptors.
  - Added negative command-service tests for missing descriptor and corrupted descriptor JSON.
  - Updated `IPC_THREAT_MODEL.md` to remove transitional cache language and document persisted descriptor as the authoritative execute input source.
- Why it is safe:
  - `handle_execute_release` still validates `release_id` and descriptor schema/structure/integrity before executing.
  - Correctly persisted plans continue to execute after restart (covered by existing restart hydration test).
  - Missing/corrupt descriptors fail deterministically with stable command error codes instead of unsafe fallback behavior.
- Tests added/updated:
  - `apps/desktop/src-tauri/src/commands.rs`:
    - `execute_release_returns_not_found_when_persisted_descriptor_missing`
    - `execute_release_rejects_corrupted_persisted_descriptor`
    - existing restart and integrity mismatch tests remain green
- Verification results:
  - `cargo fmt --all -- --check` [OK]
  - `cargo clippy --all-targets --all-features -- -D warnings` [OK] (sandbox escalation for build artifacts)
  - `cargo test --all --all-features` [OK] (includes new missing/corrupt descriptor negative tests; sandbox escalation for build artifacts)
  - `npm run lint --workspace apps/desktop` [OK]
  - `npm run typecheck --workspace apps/desktop` [OK]
  - `npm run test --workspace apps/desktop -- --run` [OK] (sandbox escalation for Vitest/Vite spawn)
  - `npm run test:e2e` [OK] (web Playwright smoke suite)

### 2026-02-25 - BL-06-T1 / FN-STAB-04 (Run-Lock Lease Schema + DB Lease APIs)
- Scope:
  - Added a new DB migration to extend `run_locks` with lease metadata (`owner_epoch`, `lease_expires_at_unix_ms`) while preserving compatibility with existing legacy run-lock APIs via safe defaults.
  - Added lease-aware DB APIs for acquire/renew/release plus `get_run_lock_lease` inspection helper and a typed `RunLockLeaseRecord`.
  - Added DB integration tests covering non-expired takeover rejection, expired takeover success, and renew/release owner-epoch matching.
- Why it is safe:
  - DB-layer only change; orchestrator lock wiring is unchanged in this task.
  - Legacy `acquire_run_lock` / `release_run_lock` behavior remains available for staged migration to lease-aware APIs.
  - Lease APIs are deterministic for tests (`now_unix_ms` + `ttl_ms` passed explicitly) and enforce safe takeover only after expiry.
- Tests added/updated:
  - `crates/db/tests/state_machine.rs`:
    - `lease_run_lock_blocks_takeover_before_expiry`
    - `lease_run_lock_allows_takeover_after_expiry`
    - `lease_run_lock_renew_and_release_require_matching_owner_epoch`
- Verification results:
  - `cargo fmt --all -- --check` [OK]
  - `cargo clippy --all-targets --all-features -- -D warnings` [OK] (sandbox escalation for build artifacts)
  - `cargo test --all --all-features` [OK] (includes new DB lease tests; sandbox escalation for build artifacts)
  - `npm run lint --workspace apps/desktop` [OK]
  - `npm run typecheck --workspace apps/desktop` [OK]
  - `npm run test --workspace apps/desktop -- --run` [OK] (sandbox escalation for Vitest/Vite spawn)
  - `npm run test:e2e` [OK] (web Playwright smoke suite)

### 2026-02-25 - BL-07-T1 / FN-STAB-05 (Orchestrator Lease-Aware Lock Usage + Crash Recovery Tests)
- Scope:
  - Switched orchestrator execution lock acquisition/release from legacy `acquire_run_lock` / `release_run_lock` to lease-aware DB APIs (`acquire_run_lock_lease`, `release_run_lock_lease`).
  - Lock owner identity is no longer PID-only: orchestrator now uses a unique owner token (`pid + UUID`) plus an `owner_epoch` timestamp for lease ownership matching.
  - Added core integration tests covering active non-expired lease blocking (no double execution) and stale lease takeover recovery (eventual progress after crash-like orphaned lock).
- Why it is safe:
  - Orchestrator execution pipeline and DB transaction semantics remain unchanged; only the run-lock acquire/release calls were swapped to lease-aware DB APIs.
  - Lease TTL is conservative for current mock/test execution duration and stale-lock recovery now works without manual DB surgery.
  - Tests prove both safety (active lock blocks) and availability (stale lock can be recovered).
- Tests added/updated:
  - `crates/core/tests/mock_pipeline.rs`:
    - `execute_planned_release_blocks_when_non_expired_lease_lock_exists`
    - `execute_planned_release_recovers_from_stale_lease_lock`
- Verification results:
  - `cargo fmt --all -- --check` [OK]
  - `cargo clippy --all-targets --all-features -- -D warnings` [OK] (sandbox escalation for build artifacts)
  - `cargo test --all --all-features` [OK] (includes new orchestrator lease recovery tests; sandbox escalation for build artifacts)
  - `npm run lint --workspace apps/desktop` [OK]
  - `npm run typecheck --workspace apps/desktop` [OK]
  - `npm run test --workspace apps/desktop -- --run` [OK] (sandbox escalation for Vitest/Vite spawn)
  - `npm run test:e2e` [OK] (web Playwright smoke suite)

### 2026-02-25 - BL-08-T1 / FN-STAB-06 (History Refresh Stale-Response Guard)
- Scope:
  - Added a frontend request-sequence guard for `refreshHistory()` so only the most recent in-flight `list_history` response can update history state or clear the loading spinner.
  - Added a Vitest race-condition test that forces overlapping history refresh calls to resolve out of order and proves stale results are ignored.
- Why it is safe:
  - UI-only change; no Rust/core/IPC interfaces or persistence behavior changed.
  - Guard is additive and preserves the existing `refreshHistory()` return value and call pattern.
  - Loading state is only cleared by the latest request, preventing stale requests from hiding an active refresh.
- Tests added/updated:
  - `apps/desktop/src/App.test.tsx`:
    - `ignores_stale_history_responses_when_refresh_requests_resolve_out_of_order` (behavioral race test via deferred `list_history` responses)
- Verification results:
  - `cargo fmt --all -- --check` [OK]
  - `cargo clippy --all-targets --all-features -- -D warnings` [OK] (sandbox escalation for build artifacts)
  - `cargo test --all --all-features` [OK] (sandbox escalation for build artifacts)
  - `npm run lint --workspace apps/desktop` [OK]
  - `npm run typecheck --workspace apps/desktop` [OK]
  - `npm run test --workspace apps/desktop -- --run` [OK] (includes new stale-history race test; sandbox escalation for Vitest/Vite spawn)
  - `npm run test:e2e` [OK] (web Playwright smoke suite)

### 2026-02-25 - BL-08-T2 / FN-STAB-06 (Report Load Stale-Response Guard)
- Scope:
  - Added a frontend request-sequence guard for `loadReportFor()` so only the most recent in-flight `get_report` response can update report state or clear the report loading spinner.
  - Added a Vitest race-condition test that forces overlapping report loads (`Open Report` + `Execute`) to resolve out of order and proves stale report content is ignored.
- Why it is safe:
  - UI-only change; no Rust/core/IPC contracts, DB behavior, or orchestrator logic changed.
  - Guard preserves the `loadReportFor()` call signature and return shape while preventing stale state overwrites.
  - Report requests can now overlap safely without stale completions replacing newer report content.
- Tests added/updated:
  - `apps/desktop/src/App.test.tsx`:
    - `ignores stale report responses when report loads resolve out of order`
- Verification results:
  - `cargo fmt --all -- --check` [OK]
  - `cargo clippy --all-targets --all-features -- -D warnings` [OK] (sandbox escalation for build artifacts)
  - `cargo test --all --all-features` [OK] (sandbox escalation for build artifacts)
  - `npm run lint --workspace apps/desktop` [OK]
  - `npm run typecheck --workspace apps/desktop` [OK]
  - `npm run test --workspace apps/desktop -- --run` [OK] (includes new stale-report race test; sandbox escalation for Vitest/Vite spawn)
  - `npm run test:e2e` [OK] (web Playwright smoke suite)

### 2026-02-25 - BL-09-T1 / FN-DET-01 (Strict `result_json` Flag Inference Parsing + Unit Tests)
- Scope:
  - Hardened `infer_simulated_and_verified()` in the core orchestrator to strictly deserialize the stored `result_json` inference payload shape instead of silently defaulting missing/malformed fields to `false`.
  - Added unit tests covering missing `result_json` (allowed), valid stored payload parsing, and corrupted schema rejection.
- Why it is safe:
  - Pure core logic change limited to report flag inference from already-persisted `result_json`.
  - `None` remains allowed and still returns `(false, false)` for rows with no stored result payload.
  - Unknown extra fields remain tolerated; only missing/wrong-type required fields now fail.
- Tests added/updated:
  - `crates/core/src/orchestrator.rs`:
    - `infer_simulated_and_verified_returns_false_false_when_result_json_missing`
    - `infer_simulated_and_verified_parses_valid_result_json_flags`
    - `infer_simulated_and_verified_rejects_invalid_result_json_schema`
- Verification results:
  - `cargo fmt --all -- --check` [OK]
  - `cargo clippy --all-targets --all-features -- -D warnings` [OK] (sandbox escalation for build artifacts)
  - `cargo test --all --all-features` [OK] (includes new orchestrator unit tests; sandbox escalation for build artifacts)
  - `npm run lint --workspace apps/desktop` [OK]
  - `npm run typecheck --workspace apps/desktop` [OK]
  - `npm run test --workspace apps/desktop -- --run` [OK] (sandbox escalation for Vitest/Vite spawn)
  - `npm run test:e2e` [OK] (web Playwright smoke suite)

### 2026-02-25 - BL-09-T2 / FN-DET-01 (Corrupted Stored `result_json` Integration Regression Test)
- Scope:
  - Added a core integration test that executes a release, corrupts the persisted `platform_actions.result_json` schema in SQLite, then reruns the same release to confirm report generation now fails deterministically instead of silently inferring false flags.
  - No production code changes in this task (test-only proof of the `BL-09-T1` hardening).
- Why it is safe:
  - Test-only change in `crates/core/tests/mock_pipeline.rs`; no runtime behavior or interfaces changed.
  - Validates the real DB/orchestrator resume/rerun path, reducing risk that unit-only parser coverage misses an integration failure mode.
- Tests added/updated:
  - `crates/core/tests/mock_pipeline.rs`:
    - `rerun_rejects_corrupted_stored_result_json_schema`
- Verification results:
  - `cargo fmt --all -- --check` [OK]
  - `cargo clippy --all-targets --all-features -- -D warnings` [OK] (sandbox escalation for build artifacts)
  - `cargo test --all --all-features` [OK] (includes corrupted stored `result_json` rerun regression test; sandbox escalation for build artifacts)
  - `npm run lint --workspace apps/desktop` [OK]
  - `npm run typecheck --workspace apps/desktop` [OK]
  - `npm run test --workspace apps/desktop -- --run` [OK] (sandbox escalation for Vitest/Vite spawn)
  - `npm run test:e2e` [OK] (web Playwright smoke suite)

### 2026-02-25 - BL-10 / FN-DET-02 (Correct `reused_completed_result` Resume/Idempotent Report Flags)
- Scope:
  - Fixed `reused_completed_result` in release report generation so it is derived from the current run's `pending_platforms` snapshot instead of being hardcoded `false`.
  - Added tests-first assertions for both idempotent rerun and partial resume flows to prove reused vs retried platform reporting is correct.
- Why it is safe:
  - Orchestrator-only change; no DB schema, IPC contract, or UI behavior changed.
  - Uses existing deterministic `pending_platforms()` data already computed at run start, so no extra persistence or timing-dependent logic was introduced.
  - Reuse flag is only set for completed platform rows not pending in the current run, preserving current execution behavior and counts.
- Tests added/updated:
  - `crates/core/tests/mock_pipeline.rs`:
    - `mock_pipeline_runs_end_to_end_and_is_idempotent_on_rerun` now asserts:
      - first run `reused_completed_result == false`
      - idempotent rerun `reused_completed_result == true`
    - `partial_failure_resume_skips_completed_platform_and_retries_only_failed_one` now asserts:
      - previously verified platform marked reused
      - retried failed platform not marked reused
- Verification results:
  - `cargo fmt --all -- --check` [OK]
  - `cargo clippy --all-targets --all-features -- -D warnings` [OK] (sandbox escalation for build artifacts)
  - `cargo test --all --all-features` [OK] (includes updated resume/idempotent report assertions; sandbox escalation for build artifacts)
  - `npm run lint --workspace apps/desktop` [OK]
  - `npm run typecheck --workspace apps/desktop` [OK]
  - `npm run test --workspace apps/desktop -- --run` [OK] (sandbox escalation for Vitest/Vite spawn)
  - `npm run test:e2e` [OK] (web Playwright smoke suite)

### 2026-02-25 - BL-11 / FN-DET-03 (DB `upsert_release` Collision Invariant Assertion)
- Scope:
  - Hardened both `Db::upsert_release` and `DbTx::upsert_release` so a `release_id` conflict only updates `title` when immutable release invariants match (`spec_hash`, `media_fingerprint`, `normalized_spec_json`).
  - Added deterministic mismatch error handling and tests proving invariant-mismatch conflicts fail without mutating the stored release row.
  - Preserved idempotent behavior for same-invariant title updates.
- Why it is safe:
  - Atomic SQL guard is enforced in the same `INSERT ... ON CONFLICT ... DO UPDATE` statement via a conflict `WHERE` clause (no non-atomic pre-read race).
  - Existing behavior for inserts and same-invariant title updates is preserved.
  - Mismatch conflicts now fail deterministically with `DbErrorCode::ConstraintViolation` and a stable invariant-mismatch message instead of silently proceeding.
- Tests added/updated:
  - `crates/db/tests/state_machine.rs`:
    - `upsert_release_rejects_invariant_mismatch_on_release_id_collision`
      - verifies same-invariant title update still succeeds
      - verifies mismatched `spec_hash` collision fails and does not overwrite stored title/invariants
    - `tx_upsert_release_rejects_invariant_mismatch_on_release_id_collision`
      - verifies transactional `upsert_release` path rejects mismatch (`media_fingerprint` / `normalized_spec_json`) and stored row remains unchanged
- Verification results:
  - `cargo fmt --all -- --check` [OK]
  - `cargo clippy --all-targets --all-features -- -D warnings` [OK] (sandbox escalation for build artifacts)
  - `cargo test --all --all-features` [OK] (includes new DB invariant collision tests; sandbox escalation for build artifacts)
  - `npm run lint --workspace apps/desktop` [OK]
  - `npm run typecheck --workspace apps/desktop` [OK]
  - `npm run test --workspace apps/desktop -- --run` [OK] (sandbox escalation for Vitest/Vite spawn)
  - `npm run test:e2e` [OK] (web Playwright smoke suite)

### 2026-02-25 - BL-12-T1 / FN-TYPE-01 (Typed `ExecutionResult.status` With Serde-Stable Compatibility)
- Scope:
  - Replaced `ExecutionResult.status: String` with a typed core pipeline enum `ExecutionStatus` (currently `Simulated`) while preserving legacy serialized string format (`"SIMULATED"`).
  - Updated the mock connector and core test publishers to emit the typed status.
  - Added serde compatibility tests proving `ExecutionResult` still serializes/deserializes the legacy wire/storage string shape.
- Why it is safe:
  - Serialized JSON remains backward-compatible (`status` is still a string token like `"SIMULATED"`), so persisted `result_json` and existing report/test artifacts are unaffected.
  - Change is localized to the core pipeline model + mock/test publishers; no DB schema, Tauri IPC contract, or UI behavior changed.
  - Additional enum variants can be added later as real connectors are introduced without reverting to stringly contracts.
- Tests added/updated:
  - `crates/core/src/pipeline.rs`:
    - `execution_result_status_serializes_as_legacy_string`
    - `execution_result_status_deserializes_legacy_string`
  - Updated compile/runtime coverage via:
    - `crates/connectors/mock/src/lib.rs`
    - `crates/core/tests/mock_pipeline.rs`
- Verification results:
  - `cargo fmt --all -- --check` [OK]
  - `cargo clippy --all-targets --all-features -- -D warnings` [OK] (sandbox escalation for build artifacts)
  - `cargo test --all --all-features` [OK] (includes new pipeline serde compatibility tests; sandbox escalation for build artifacts)
  - `npm run lint --workspace apps/desktop` [OK]
  - `npm run typecheck --workspace apps/desktop` [OK]
  - `npm run test --workspace apps/desktop -- --run` [OK] (sandbox escalation for Vitest/Vite spawn)
  - `npm run test:e2e` [OK] (web Playwright smoke suite)

### 2026-02-25 - BL-12-T2 / FN-TYPE-02 (Additive Typed `PlannedAction` Contract With Backward-Compatible Deserialization)
- Scope:
  - Added a typed core enum `PlannedActionType` and an additive `PlannedAction.action_type` field (serde `default`) to reduce future connector drift while preserving the existing human-readable `action` string.
  - Kept backward compatibility for previously persisted descriptors/plan JSON by defaulting missing `action_type` to `UNKNOWN`.
  - Updated mock connector and core test publishers to emit `PlannedActionType::Publish`.
  - Added serde compatibility tests for missing `action_type` (old payloads) and string-token serialization (`"PUBLISH"`).
- Why it is safe:
  - Additive core model change only; UI-facing Tauri DTOs remain unchanged and continue using the display `action` string.
  - Old persisted `planned_actions` JSON/descriptors remain deserializable because `action_type` is optional on read via `#[serde(default)]`.
  - Execution pipeline semantics, DB schema, and Tauri error boundary are unchanged.
- Tests added/updated:
  - `crates/core/src/pipeline.rs`:
    - `planned_action_deserializes_without_action_type_for_backward_compat`
    - `planned_action_action_type_serializes_as_string_token`
  - Updated mock/core publisher constructors:
    - `crates/connectors/mock/src/lib.rs`
    - `crates/core/tests/mock_pipeline.rs`
- Verification results:
  - `cargo fmt --all -- --check` [OK]
  - `cargo clippy --all-targets --all-features -- -D warnings` [OK] (sandbox escalation for build artifacts)
  - `cargo test --all --all-features` [OK] (includes new planned-action serde compatibility tests; sandbox escalation for build artifacts)
  - `npm run lint --workspace apps/desktop` [OK]
  - `npm run typecheck --workspace apps/desktop` [OK]
  - `npm run test --workspace apps/desktop -- --run` [OK] (sandbox escalation for Vitest/Vite spawn)
  - `npm run test:e2e` [OK] (web Playwright smoke suite)

### 2026-02-25 - BL-13-T1 / FN-CONTRACT-01 (Centralize Backend IPC Error Code Constants)
- Scope:
  - Added a centralized `app_error_codes` constant module in `apps/desktop/src-tauri/src/commands.rs` and mechanically replaced production `AppError` code string literals with constants.
  - Refactor included command helpers, `DbError`/`OrchestratorError` mappings, descriptor/report decode paths, and test probe command errors.
  - No wire behavior changes intended; explicit string assertions were left in tests to preserve/prepare contract checks in the next task.
- Why it is safe:
  - Pure mechanical refactor of code-string definitions and callsites; no branching logic or error mapping semantics changed.
  - Existing explicit test assertions still verify emitted string codes at the boundary.
  - Test-only constants were gated with `#[cfg(test)]` to avoid dead-code warnings in production builds.
- Tests added/updated:
  - No new tests in this task (mechanical refactor only); relied on full existing regression suites.
- Verification results:
  - `cargo fmt --all -- --check` [OK]
  - `cargo clippy --all-targets --all-features -- -D warnings` [OK] (sandbox escalation for build artifacts)
  - `cargo test --all --all-features` [OK] (sandbox escalation for build artifacts)
  - `npm run lint --workspace apps/desktop` [OK]
  - `npm run typecheck --workspace apps/desktop` [OK]
  - `npm run test --workspace apps/desktop -- --run` [OK] (sandbox escalation for Vitest/Vite spawn)
  - `npm run test:e2e` [OK] (web Playwright smoke suite)

### 2026-02-25 - BL-13-T2 / FN-CONTRACT-02 (IPC `AppError` Wire Contract Tests for Stable Codes + Shape)
- Scope:
  - Added explicit command-boundary IPC contract tests in `apps/desktop/src-tauri/src/commands.rs` for stable `AppError` wire shape and key failure mappings.
  - Added a small test helper to assert the serialized top-level shape remains exactly `{ "code", "message", "details" }`.
  - Covered two representative failures:
    - `handle_get_report` invalid `release_id` -> `INVALID_ARGUMENT`
    - `handle_plan_release` invalid spec -> `SPEC_VALIDATION_FAILED`
- Why it is safe:
  - Test-only change; no production runtime logic, schema, or IPC serialization code changed.
  - Increases confidence that future refactors do not accidentally change the Tauri command error boundary or key code/message values consumed by the UI.
  - The invalid-spec test uses a malformed YAML fixture to exercise the existing spec-validation error path deterministically.
- Tests added/updated:
  - `apps/desktop/src-tauri/src/commands.rs`:
    - `command_error_contract_invalid_release_id_wire_shape_is_stable`
    - `command_error_contract_spec_validation_failed_wire_shape_is_stable`
    - `assert_app_error_wire_top_level_shape` (test helper)
- Verification results:
  - `cargo fmt --all -- --check` [OK]
  - `cargo clippy --all-targets --all-features -- -D warnings` [OK] (sandbox escalation for build artifacts)
  - `cargo test --all --all-features` [OK] (includes new IPC contract tests; sandbox escalation for build artifacts)
  - `npm run lint --workspace apps/desktop` [OK]
  - `npm run typecheck --workspace apps/desktop` [OK]
  - `npm run test --workspace apps/desktop -- --run` [OK] (sandbox escalation for Vitest/Vite spawn)
  - `npm run test:e2e` [OK] (web Playwright smoke suite)

### 2026-02-25 - BL-14-T1 / FN-LOG-01 (Path-Safe UI Diagnostics Defaults With TEST-Only Debug Reveal)
- Scope:
  - Added frontend path-formatting helpers in `apps/desktop/src/App.tsx` to avoid showing full absolute local paths in normal UI diagnostics.
  - Absolute local paths are now redacted to a stable tail form (`[local]/.../<tail>`) for:
    - normalized spec preview `spec_path`
    - planned request file paths
    - execute result report path
  - Relative artifact paths remain unchanged (no unnecessary masking).
  - Added an explicit TEST-only debug opt-in flag (`window.__RELEASE_PUBLISHER_DEBUG_FULL_PATHS__`) to reveal full paths when needed for local debugging.
- Why it is safe:
  - UI-only presentation change; backend IPC payloads, DB state, orchestrator behavior, and Tauri command contracts are unchanged.
  - Default path hiding reduces accidental local path disclosure while preserving enough context (tail segments) for operator debugging.
  - Full-path visibility remains available only with explicit debug opt-in in TEST mode.
- Tests added/updated:
  - `apps/desktop/src/App.test.tsx`:
    - `redacts absolute diagnostic paths in the UI by default`
    - `reveals full diagnostic paths when debug path visibility is enabled in TEST`
  - Updated test mock helper to accept path overrides for focused diagnostics-path assertions.
- Verification results:
  - `cargo fmt --all -- --check` [OK]
  - `cargo clippy --all-targets --all-features -- -D warnings` [OK] (sandbox escalation for build artifacts)
  - `cargo test --all --all-features` [OK] (sandbox escalation for build artifacts)
  - `npm run lint --workspace apps/desktop` [OK]
  - `npm run typecheck --workspace apps/desktop` [OK]
  - `npm run test --workspace apps/desktop -- --run` [OK] (includes new UI diagnostics-path tests; sandbox escalation for Vitest/Vite spawn)
  - `npm run test:e2e` [OK] (web Playwright smoke suite)

### 2026-02-25 - BL-14-T2 / FN-LOG-02 (Additive Transport Correlation Context for Debug Logging)
- Scope:
  - Added an additive `TransportRequest.log_correlation` field (`release_id`, `run_id`) in `crates/core/src/transport.rs` plus a small builder helper `with_log_correlation(...)`.
  - Updated `RealTransport::send` debug logging to emit `release_id` and `run_id` fields (defaulting to `n/a` when absent) alongside the existing `operation/method/url/headers` fields.
  - Added tests proving correlation context survives clone/serde and is preserved across retry attempts in the test transport recording path.
- Why it is safe:
  - Additive transport model change only; existing callers remain valid (`log_correlation` defaults to `None`).
  - No retry semantics, backoff behavior, or transport redaction behavior changed.
  - This is connector-readiness groundwork: no production connectors are enabled and no credentials/side effects are introduced.
- Tests added/updated:
  - `crates/core/src/transport.rs`:
    - `transport_request_correlation_context_round_trips_and_clones`
  - `crates/testkit/tests/transport_faults.rs`:
    - strengthened `retries_on_timeout_then_succeeds` to assert recorded requests retain correlation IDs across retries
- Verification results:
  - `cargo fmt --all -- --check` [OK]
  - `cargo clippy --all-targets --all-features -- -D warnings` [OK] (sandbox escalation for build artifacts)
  - `cargo test --all --all-features` [OK] (includes new transport correlation tests; sandbox escalation for build artifacts)
  - `npm run lint --workspace apps/desktop` [OK]
  - `npm run typecheck --workspace apps/desktop` [OK]
  - `npm run test --workspace apps/desktop -- --run` [OK] (sandbox escalation for Vitest/Vite spawn)
  - `npm run test:e2e` [OK] (web Playwright smoke suite)

### 2026-02-25 - BL-15-T1 / FN-PERF-01 (`handle_get_report` Single Byte Decode + Large Payload Regression)
- Scope:
  - Replaced `handle_get_report`'s double `serde_json::from_slice(&bytes)` path with a shared helper that parses report bytes once to `serde_json::Value` and derives `ReleaseReportArtifact` from that in-memory value.
  - Preserved existing behavior:
    - `REPORT_DECODE_FAILED` mapping on decode/shape errors
    - raw report payload returned to the UI (`raw`) including unknown fields
    - existing report summary/action derivation logic unchanged
  - Added a command-layer regression test for a large `release_report.json` payload (large blob + many platform entries) to guard behavior on bigger artifacts.
- Why it is safe:
  - No DB/orchestrator/IPC response schema changes; only internal report decode implementation changed.
  - Raw unknown fields are intentionally preserved because `raw` is built from the parsed `Value`, not reserialized from the typed struct.
  - Optimization is local to `handle_get_report`; all error codes and messages remain stable.
- Tests added/updated:
  - `apps/desktop/src-tauri/src/commands.rs`:
    - `get_report_handles_large_payload_and_preserves_raw_unknown_fields`
    - `decode_release_report_artifact_and_raw` helper (implementation)
- Verification results:
  - `cargo fmt --all -- --check` [OK]
  - `cargo clippy --all-targets --all-features -- -D warnings` [OK] (sandbox escalation for build artifacts)
  - `cargo test --all --all-features` [OK] (includes new large report regression test; sandbox escalation for build artifacts)
  - `npm run lint --workspace apps/desktop` [OK]
  - `npm run typecheck --workspace apps/desktop` [OK]
  - `npm run test --workspace apps/desktop -- --run` [OK] (sandbox escalation for Vitest/Vite spawn)
  - `npm run test:e2e` [OK] (web Playwright smoke suite)

### 2026-02-25 - BL-16-T1 / FN-READ-01 (`spec.rs` Tag Policy Constants + Invariant Path Cleanup)
- Scope:
  - Extracted `spec.rs` tag-policy magic numbers into private constants (`MAX_TAG_LEN_CHARS`, `MAX_TAG_COUNT`) and reused them in validation logic, truncation, and user-facing structured error messages.
  - Added a small constant for the internal invariant fallback message to avoid duplicated literals.
  - Cleaned up `normalize_and_validate(...)` final assembly path with a `debug_assert!` plus explicit `let-else` invariant check, preserving the deterministic `InternalInvariant` error fallback in non-debug builds.
- Why it is safe:
  - Parser behavior and external error contract are preserved (same `SpecErrorCode`s and same tag-limit messages).
  - Change is localized to spec normalization/validation internals and readability; no DB, orchestration, or IPC layers are affected.
  - Existing fuzz-like tests plus new explicit tag-policy tests guard against regressions and accidental `InternalInvariant` leakage on normal invalid inputs.
- Tests added/updated:
  - `crates/core/tests/release_spec.rs`:
    - `enforces_tag_policy_with_stable_structured_errors`
    - `accepts_tag_policy_boundaries`
- Verification results:
  - `cargo fmt --all -- --check` [OK]
  - `cargo clippy --all-targets --all-features -- -D warnings` [OK] (sandbox escalation for build artifacts)
  - `cargo test --all --all-features` [OK] (includes new spec tag-policy tests; sandbox escalation for build artifacts)
  - `npm run lint --workspace apps/desktop` [OK]
  - `npm run typecheck --workspace apps/desktop` [OK]
  - `npm run test --workspace apps/desktop -- --run` [OK] (sandbox escalation for Vitest/Vite spawn)
  - `npm run test:e2e` [OK] (web Playwright smoke suite)
