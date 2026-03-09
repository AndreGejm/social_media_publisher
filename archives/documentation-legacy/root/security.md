# Security and Logging Hygiene

This project is currently in pre-connector mode (mock execution only). These rules apply now and must continue when real connectors are added.

## Environment Separation

- `TEST`, `STAGING`, `PRODUCTION` are code-level concepts (not UI-only).
- Core logic enforces TEST simulation guardrails.
- UI must never be trusted to enforce caps or publish safety.

## Secret Handling Rules

### Never Log

- OAuth access tokens
- refresh tokens
- API keys
- database credentials
- `Authorization` / `Proxy-Authorization` headers
- vendor-specific auth headers (`x-api-key`, `api-key`)

### Current Redaction

- `crates/core/src/transport.rs` redacts sensitive request headers before logging.
- `apps/desktop/src-tauri/src/commands.rs` redacts sensitive keys in serialized Tauri command error `details`.
- `apps/desktop/src/App.tsx` keeps UI-side error detail redaction as defense-in-depth (and console detail logging is debug-opt-in only).

### Current SecretStore Contract (Pre-Connector Phase)

- `crates/core/src/secrets.rs` provides an additive `SecretStore` trait and `InMemorySecretStore` backend for tests/local wiring only.
- `SecretValue` uses redacted `Debug` output (`SecretValue(<redacted>)`) and must not be logged via `expose()`.
- No production credentials are accepted/stored in this phase.
- No OS keychain / secure store integration is enabled yet.
- Secrets must not cross the Tauri IPC error boundary in plaintext.
- Contract proof tests:
  - `apps/desktop/src-tauri/src/commands.rs` (`command_error_boundary_never_serializes_secret_store_values`)
  - `apps/desktop/src-tauri/src/commands.rs` (`command_error_boundary_serialization_keeps_details_redacted`)
  - `crates/core/src/secrets.rs` (`secret_value_debug_is_redacted`)

### Future Requirement (Before Real Connectors)

- Secret storage must use OS keychain / Tauri secure store (not plaintext files)
- Token refresh logic must emit redacted structured events only

## Structured Logging Requirements

For connector/orchestrator flows, logs should include:

- `release_id`
- `run_id`
- `platform`
- `stage` (`PLAN`, `EXECUTE`, `VERIFY`, `ERROR`)
- `env`

Current state:

- Orchestrator emits structured `tracing` logs with `release_id` + `run_id`.
- Audit log payloads include `run_id` for plan/execute/verify/error entries.

## File Path Handling

### Current Safety Measures

- Orchestrator artifact paths are generated from:
  - hex `release_id`
  - sanitized platform names (alphanumeric / `_` / `-`)
- Planned request/report files are written under caller-provided `artifacts_root`.

### Known Gap (Must Address Before Production)

- Tauri command file paths are only minimally validated today (non-empty string / UTF-8 decoding path for spec content).
- Add canonicalization and a clear policy:
  - allow any user-selected file path (desktop local mode), or
  - restrict to approved roots
- Log canonicalized paths carefully (no secrets in path segments).

## Test Network Safety

- Unit/integration tests for transport and orchestration must use:
  - `TestTransport`
  - mock publishers
- No real network calls in tests.
- Fault injection coverage should remain deterministic and offline.

## Incident/Failure Logging Guidance (Future)

- Use stable error codes for DB/core/transport/Tauri boundaries.
- Include retry attempt counts, but never token contents.
- For `401`/token-expired flows, log provider error class only (e.g., `TOKEN_EXPIRED`).
