# Hardening Report (Phase 4 -> Hardened for Phase 5 Prep)

## Scope
- Hardened Rust DB layer, orchestrator atomicity, Tauri command boundary, frontend error handling, transport testkit invariants, and CI quality gates.
- No real platform connectors were added.
- All execution remains mock/test-safe (`MockPublisher` only).

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
