# Hardening Decisions

This document records hardening decisions and verification steps for the Release Publisher codebase before real platform connectors are introduced.

## Scope

Current hardened scope includes:

- `ReleaseSpec` parsing/normalization and deterministic hashing inputs
- Idempotency key generation (`release_id`)
- SQLite persistence/state machine + run locking
- Mock orchestration pipeline (`plan -> execute -> verify`)
- Transport abstraction + retry/backoff + circuit breaker + scripted fault injection
- Tauri command error boundary (structured app errors)

## Core Invariants

### Determinism

- `ReleaseSpec` normalization is canonical for supported fields:
  - trims/collapses whitespace
  - tags are deduplicated, lowercased, sorted via `BTreeSet`
- `release_id` is derived from:
  - `spec_hash = sha256(compact normalized JSON)`
  - `media_fingerprint = sha256(media bytes)`
  - domain-separated material (`release-publisher.release-id.v1`)
- Same normalized spec + same media bytes must produce the same `release_id`.

### Idempotency / Resume

- `platform_actions` uses `(release_id, platform)` primary key to prevent duplicates.
- Completed platform rows (`VERIFIED`, `SKIPPED`) are not downgraded to `PLANNED` on re-plan.
- Rerun execution skips completed platforms using `Db::pending_platforms(...)`.
- Run lock (`run_locks`) prevents concurrent execution for a single `release_id`.

### Safety Controls

- `TEST` environment is enforced in core orchestrator:
  - planned actions must be `simulated = true`
  - execution results must be `simulated = true`
- Per-run cap `max_actions_per_platform_per_run` is enforced in core during:
  - `plan`
  - `execute`
  - result processing

### Transport Fault Handling

- Typed transport error codes classify failures (timeout/network/invalid request/etc.).
- Retry policy is bounded (`max_attempts`, `max_delay_ms`).
- `Retry-After` header is honored for `429`.
- Deterministic jitter is applied and test-covered.
- Circuit breaker is deterministic (`now_ms` is injected by caller/tests).

## What Is Intentionally Not Yet Hardened

- Real platform connector OAuth/token refresh logic
- Transactional orchestration step bundles (DB state + audit + platform updates in a single SQL transaction)
- Typed DB error codes (`DbErrorCode`) replacing `anyhow` in DB public API
- Tauri command wiring to the orchestrator (currently still stubbed beyond `load_spec`)

## Test Strategy (Current)

### Determinism / Idempotency

- Example-based unit tests:
  - `crates/core/tests/idempotency.rs`
- Property-based tests:
  - `crates/core/tests/spec_properties.rs`
  - `crates/core/tests/idempotency_properties.rs`
- DB integration tests:
  - `crates/db/tests/state_machine.rs`
- Orchestrator integration tests:
  - `crates/core/tests/mock_pipeline.rs`
  - includes partial-failure resume semantics across two publishers

### Fault Injection / Transport

- `crates/testkit/tests/transport_faults.rs` covers:
  - timeout
  - `429` + `Retry-After`
  - `5xx` burst
  - malformed JSON
  - partial body (truncated JSON)
  - token-expiry simulated `401`
  - partial failure sequence

## Verification (Local/CI)

Run all commands with warnings treated as errors where applicable:

```powershell
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all --all-features

npm install
npm run typecheck --workspace apps/desktop
npm run test --workspace apps/desktop -- --run
npm run build --workspace apps/desktop
npm run test:e2e
```

Pass criteria:

- no formatting changes required
- clippy exits `0` with `-D warnings`
- all Rust tests pass (including property tests and transport fault tests)
- frontend unit tests pass
- Playwright smoke + failure-path tests pass

## Blockers Before Real Connectors

These remain stop-the-line for real connector work:

1. Typed DB errors and stable error codes
2. Transactional orchestration step writes
3. Tauri command wiring to real orchestrator (plan/execute/history/report)
4. Stronger filesystem path policy (canonicalization/allowlist policy)

