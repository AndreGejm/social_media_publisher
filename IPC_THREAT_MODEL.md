# Tauri IPC Threat Model and Command Input Policy

This document defines the current IPC trust boundary and per-command input policies for the desktop app (`Tauri v2` + Rust core + React/TS UI).

It is intentionally scoped to the current phase:

- Mock connector only (`release_publisher_mock_connector::MockPublisher`)
- No production connectors enabled
- No production credentials accepted/stored
- Core-enforced safety invariants remain the source of truth (not UI-only controls)

## 1. Trust Boundary

### Boundary Summary

- WebView/React UI is **untrusted input**.
- Tauri command handlers in `apps/desktop/src-tauri/src/commands.rs` are the **trusted validation boundary** for IPC inputs.
- Core/orchestrator/db crates are trusted to enforce execution invariants (TEST guardrails, caps, idempotency, transactional state).

### Command Surface (Explicit, Narrow)

The desktop app registers exactly five Tauri commands in `apps/desktop/src-tauri/src/lib.rs` (`tauri::generate_handler!`):

- `load_spec`
- `plan_release`
- `execute_release`
- `list_history`
- `get_report`

### Tauri Capability Scope (Current)

- Capability file: `apps/desktop/src-tauri/capabilities/default.json`
- Current permissions: `core:default`
- No Tauri FS plugin command surface is used for spec/media/report access; file access is implemented in Rust command handlers.

## 2. Security Invariants at the IPC Boundary

- All command errors cross the boundary through a single serializable shape:
  - `AppError { code, message, details? }`
  - Source: `apps/desktop/src-tauri/src/commands.rs` (`AppError`)
- `AppError::with_details(...)` recursively redacts sensitive keys before serialization.
- UI-side redaction remains defense-in-depth, and frontend console logging of backend `details` is debug-opt-in only (`window.__RELEASE_PUBLISHER_DEBUG_ERROR_DETAILS__`).
- UI must not be trusted for:
  - environment guardrails (`TEST`/`STAGING`/`PRODUCTION`)
  - per-run caps
  - idempotency
  - publish safety

## 3. Data Flow (Current)

1. React UI invokes a Tauri command (`@tauri-apps/api` path is abstracted in UI code).
2. Rust command handler validates/coerces input and converts failures to `AppError`.
3. Command service calls orchestrator/DB/core code.
4. Result is serialized back to UI or a redacted `AppError` is returned.

## 4. Command Inventory and Input Policies

### `load_spec(path: String)`

- Rust entrypoint: `apps/desktop/src-tauri/src/commands.rs` (`load_spec`, `handle_load_spec`)
- Input trust level: untrusted path string from UI
- Validation/policy:
  - rejects odd path prefixes via `reject_odd_prefixes(...)`
    - rejects `file://`
    - rejects Windows device/extended paths (`\\?\`, `\\.\`)
    - rejects UNC/network paths (`\\server\...`, `//server/...`)
  - canonicalizes path via `canonicalize_file_path(...)`
  - requires the canonical target to be a file
  - reads bytes and requires UTF-8 for spec text
  - parses YAML into `ReleaseSpec`
- Side effects:
  - file read only (no publish, no DB mutation)
- Output:
  - `LoadSpecResponse { ok, spec?, errors[], canonical_path? }`
- Notes:
  - Returning `canonical_path` is intentional for operator clarity; path-safe logging/UI display policy is tracked separately.

### `plan_release(input: PlanReleaseInput)`

- Rust entrypoint: `apps/desktop/src-tauri/src/commands.rs` (`plan_release`, `handle_plan_release`)
- Input trust level: untrusted structured input (`spec_path`, `media_path`, `platforms`, `env`)
- Validation/policy:
  - `spec_path` and `media_path` use the same `canonicalize_file_path(...)` policy as `load_spec`
  - spec bytes must decode as UTF-8
  - YAML spec must parse/validate (`parse_release_spec_yaml`)
  - downstream core/orchestrator enforces environment and plan safety invariants
- Side effects:
  - DB writes via orchestrator (transactional in core/db layers)
  - artifact file writes under command service `artifacts_root`
  - in-memory `planned_releases` session cache write (temporary design; see known risks)
- Output:
  - `PlanReleaseResponse`
- Notes:
  - Current implementation stores planned state in-session (`planned_releases`) for later execute; backlog items `FN-STAB-01..03` replace this with restart-safe persistence.

### `execute_release(release_id: String)`

- Rust entrypoint: `apps/desktop/src-tauri/src/commands.rs` (`execute_release`, `handle_execute_release`)
- Input trust level: untrusted `release_id` string from UI
- Validation/policy (current):
  - validates `release_id` as a 64-character ASCII hex string (normalized lowercase) before descriptor path derivation
  - hydrates planned execution data from persisted `planned_release_descriptor.json`
  - validates descriptor schema version and structure
  - validates descriptor integrity (`release_id`, `spec_hash`, `media_fingerprint`) against the DB release record before execution
- Side effects:
  - executes orchestrator pipeline against mock publisher only (current phase)
  - DB state/audit/platform updates
  - report artifact write under `artifacts_root`
- Output:
  - `ExecuteReleaseResponse`
- Known temporary limitation:
  - descriptor corruption/deletion blocks execution and fails safely; operator recovery/import tooling is not implemented in this phase.

### `list_history()`

- Rust entrypoint: `apps/desktop/src-tauri/src/commands.rs` (`list_history`, `handle_list_history`)
- Input trust level: no caller-controlled payload
- Validation/policy:
  - no direct user input to validate
  - DB read-only query via `orchestrator.db().list_history()`
- Side effects:
  - none (read-only)
- Output:
  - `Vec<HistoryRow>`

### `get_report(release_id: String)`

- Rust entrypoint: `apps/desktop/src-tauri/src/commands.rs` (`get_report`, `handle_get_report`)
- Input trust level: untrusted `release_id` string from UI
- Validation/policy:
  - `validate_release_id_for_artifact_lookup(...)` requires:
    - non-empty trimmed input
    - exactly 64 characters
    - ASCII hex only
    - normalized lowercase
  - report path is derived internally as:
    - `artifacts_root/<release_id>/release_report.json`
  - caller cannot provide an arbitrary report filesystem path
- Side effects:
  - file read under managed artifacts root only
- Output:
  - `Option<ReleaseReport>`

## 5. Error Boundary and Redaction Rules

### Rust -> UI Error Contract

- Boundary type: `AppError` in `apps/desktop/src-tauri/src/commands.rs`
- Contract shape: `{ code, message, details? }`
- All conversions (`DbError`, `OrchestratorError`, command validation errors) terminate at this boundary before serialization.

### Redaction Rules (Current)

- Backend:
  - `AppError::with_details(...)` recursively redacts values for keys containing:
    - `authorization`
    - `cookie`
    - `refresh_token` / `refresh-token`
    - `client_secret` / `client-secret`
    - `api_key` / `api-key`
- Frontend:
  - UI keeps redaction as defense-in-depth
  - backend error `details` are not logged to console unless `window.__RELEASE_PUBLISHER_DEBUG_ERROR_DETAILS__ === true`

## 6. Threats Considered (Current Phase) and Mitigations

### Path Injection / Traversal via IPC Inputs

- Threat:
  - UI passes malformed paths, UNC paths, device paths, or scheme-like inputs to reach unintended files.
- Mitigation:
  - `reject_odd_prefixes(...)` + `canonicalize_file_path(...)` for spec/media paths
  - `get_report` no longer accepts arbitrary paths; it derives the path from validated `release_id`
  - `execute_release` descriptor lookup also derives the path from validated `release_id`

### Secret Leakage Through Errors or Logs

- Threat:
  - secrets appear in `details`, logs, or debug output and cross IPC/plaintext boundaries
- Mitigation:
  - backend recursive redaction in `AppError::with_details(...)`
  - `SecretValue` debug redaction (`core::secrets`)
  - frontend detail logging debug-opt-in only
  - transport header redaction in `crates/core/src/transport.rs`

### UI Bypass of Safety Controls

- Threat:
  - UI manipulation attempts to bypass env guardrails or per-run limits
- Mitigation:
  - core/orchestrator enforces TEST simulation guardrails and action caps
  - command layer does not trust UI claims for safety invariants

### Overbroad Tauri Plugin Exposure

- Threat:
  - excessive plugin permissions expand the attack surface beyond intended command handlers
- Mitigation (current):
  - narrow command set registered explicitly
  - no Tauri FS plugin command path used for file access in this phase
  - capability file limited to `core:default`

## 7. Known Risks / Planned Hardening (Tracked in Backlog)

- Descriptor corruption/deletion recovery UX/tooling (safe repair/import path) is not implemented yet
  - tracked in future hardening/operability work (not a connector enablement blocker for mock-only mode)
- Crash stale run-lock recovery / lease semantics
  - tracked by `FN-STAB-04`, `FN-STAB-05`
- IPC error code contract centralization
  - tracked by `FN-OBS-01`
- Correlation IDs and path-safe diagnostics defaults
  - tracked by `FN-OBS-02`

## 8. Evidence / Regression Tests (Current)

### Command Boundary / Input Validation

- `apps/desktop/src-tauri/src/commands.rs`
  - `rejects_odd_prefix_paths`
  - `validate_release_id_for_artifact_lookup_accepts_hex_and_normalizes_case`
  - `validate_release_id_for_artifact_lookup_rejects_invalid_inputs`
  - `get_report_rejects_invalid_release_id_inputs`
  - `get_report_accepts_uppercase_hex_release_id_lookup`

### Error Redaction / Secret Leakage Prevention

- `apps/desktop/src-tauri/src/commands.rs`
  - `app_error_with_details_redacts_sensitive_keys_recursively`
  - `command_error_boundary_serialization_keeps_details_redacted`
  - `command_error_boundary_never_serializes_secret_store_values`
- `crates/core/src/secrets.rs`
  - `secret_value_debug_is_redacted`
- `crates/core/src/transport.rs`
  - transport header redaction tests

### Core Safety Guardrails / Idempotency (Relevant to IPC Threat Assumptions)

- `crates/core/tests/mock_pipeline.rs`
  - TEST guardrail enforcement
  - per-run cap enforcement
  - idempotent rerun behavior

### Tauri Config Security Baseline

- `apps/desktop/src/tauri-config.test.ts`
  - asserts non-null CSP and disallows wildcard / `unsafe-eval`

## 9. Change Control Rule (Required)

Update this document when any of the following changes occur:

- a new Tauri command is added/removed
- a command input type or validation rule changes
- a new plugin/capability permission is added
- error boundary shape or redaction policy changes
- real connector credentials/secret storage are introduced
