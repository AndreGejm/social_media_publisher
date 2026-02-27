# Rust Runtime And DB Function Review

## `crates/core/src/lib.rs`

- `crates/core/src/lib.rs`: no functions; this file is only a module export surface (`circuit_breaker`, `idempotency`, `orchestrator`, `pipeline`, `retry`, `spec`, `transport`).

## `crates/core/src/circuit_breaker.rs`

- `Default::default` for `CircuitBreakerConfig` (`crates/core/src/circuit_breaker.rs:11`): returns conservative retry protection defaults (`failure_threshold=3`, `open_duration_ms=30000`).
- `CircuitBreaker::new` (`crates/core/src/circuit_breaker.rs:35`): initializes breaker in `Closed` state with zero failures.
- `CircuitBreaker::state` (`crates/core/src/circuit_breaker.rs:43`): computes effective state at `now_ms`; lazily converts expired `Open` to `HalfOpen` without mutating internal state.
- `CircuitBreaker::before_request` (`crates/core/src/circuit_breaker.rs:50`): gatekeeper called before sending a request; denies if still `Open`, allows `Closed/HalfOpen`, and mutates expired `Open` into `HalfOpen` on first post-expiry request.
- `CircuitBreaker::record_success` (`crates/core/src/circuit_breaker.rs:64`): clears failure streak and closes the circuit after a successful attempt.
- `CircuitBreaker::record_failure` (`crates/core/src/circuit_breaker.rs:69`): increments failures in `Closed`, opens after threshold, reopens/extends open window when failing in `HalfOpen`, and refreshes `Open` timeout on repeated failures while open.

## `crates/core/src/idempotency.rs`

- `sha256_hex` (`crates/core/src/idempotency.rs:14`): utility hash function returning lowercase hex SHA-256 for arbitrary bytes.
- `try_spec_hash` (`crates/core/src/idempotency.rs:19`): serializes normalized spec as compact JSON and hashes it; avoids pretty-print formatting noise.
- `media_fingerprint_from_bytes` (`crates/core/src/idempotency.rs:25`): media digest helper; currently direct SHA-256 of raw bytes.
- `media_fingerprint_from_file` (`crates/core/src/idempotency.rs:29`): async file read + digest wrapper; filesystem errors bubble through `anyhow`.
- `try_compute_release_id` (`crates/core/src/idempotency.rs:34`): builds deterministic release ID from domain separator + spec hash + media fingerprint, then hashes the composed string.
- `try_build_idempotency_keys` (`crates/core/src/idempotency.rs:50`): convenience aggregator returning spec hash, media fingerprint, and derived release ID in one struct.

## `crates/core/src/pipeline.rs`

- `Publisher::platform_name` (`crates/core/src/pipeline.rs:50`): trait contract for stable platform registry key.
- `Publisher::plan` (`crates/core/src/pipeline.rs:51`): trait contract to produce planned actions for a release/environment before execution.
- `Publisher::execute` (`crates/core/src/pipeline.rs:52`): trait contract to run planned actions and return execution results.
- `Publisher::verify` (`crates/core/src/pipeline.rs:57`): trait contract for post-execution verification (required by orchestrator before commit).

## `crates/core/src/retry.rs`

- `Default::default` for `RetryPolicy` (`crates/core/src/retry.rs:16`): sets retry envelope, capped backoff, deterministic jitter, and retriable HTTP statuses.
- `RetryPolicy::validate` (`crates/core/src/retry.rs:29`): validates policy invariants (attempts, base/max delay ordering, jitter bound).
- `RetryReport::new` (`crates/core/src/retry.rs:76`): explicit constructor for an empty retry report (same effect as `Default`).
- `Sleeper::sleep_ms` trait method (`crates/core/src/retry.rs:85`): abstraction for testable sleeping.
- `TokioSleeper::sleep_ms` (`crates/core/src/retry.rs:93`): production sleeper implementation using `tokio::time::sleep`.
- `send_with_retry` (`crates/core/src/retry.rs:98`): core retry loop. Validates policy, sends cloned request per attempt, records outcome metadata, sleeps on retryable outcomes, and returns either terminal response/error.
- `retry_delay_for_response` (`crates/core/src/retry.rs:158`): decides retry delay for HTTP responses. Honors `Retry-After` for `429`, otherwise applies status-based exponential backoff + jitter, and stops at final attempt.
- `retry_delay_for_error` (`crates/core/src/retry.rs:187`): decides retry delay for transport errors based on retryability and attempt count.
- `exponential_backoff_ms` (`crates/core/src/retry.rs:204`): computes power-of-two backoff with saturation and policy cap.
- `apply_deterministic_jitter_ms` (`crates/core/src/retry.rs:211`): adds bounded deterministic jitter (seed + attempt + salt) to avoid synchronized retries while remaining reproducible in tests.
- `parse_retry_after_seconds` (`crates/core/src/retry.rs:239`): reads lowercase normalized `retry-after` header and parses integer seconds only.
- `transport_error_code_salt` (`crates/core/src/retry.rs:245`): maps transport error code enum to a stable salt used by deterministic jitter.

## `crates/core/src/spec.rs`

- `ReleaseSpec::try_normalized_json` (`crates/core/src/spec.rs:55`): pretty-serializes already-normalized spec for storage/debug artifacts.
- `ReleaseSpec::normalized_json` (`crates/core/src/spec.rs:59`): alias of `try_normalized_json` for API convenience/backward readability.
- `ReleaseSpec::normalized_json_compact` (`crates/core/src/spec.rs:63`): compact JSON serializer used by hashing/idempotency.
- `parse_release_spec_yaml` (`crates/core/src/spec.rs:68`): entry-point parser. Converts YAML parsing failures into structured `SpecError` list and delegates normalization/validation.
- `normalize_and_validate` (`crates/core/src/spec.rs:83`): canonicalization pipeline for title/artist/description/tags/mock options; collects multiple validation errors and returns internal-invariant error only if required-field normalization bookkeeping breaks.
- `normalize_required_text` (`crates/core/src/spec.rs:117`): validates required string fields (`title`, `artist`) for presence and non-empty normalized content.
- `normalize_tags` (`crates/core/src/spec.rs:147`): deduplicates tags case-insensitively, trims/normalizes whitespace, enforces max tag length and max tag count, and returns sorted (BTreeSet) capped list.
- `normalize_text` (`crates/core/src/spec.rs:177`): collapses all whitespace runs to single spaces and trims via split/join semantics.

## `crates/core/src/transport.rs`

- `From<&HttpMethod> for reqwest::Method::from` (`crates/core/src/transport.rs:19`): maps internal HTTP method enum to `reqwest` method.
- `TransportRequest::new` (`crates/core/src/transport.rs:42`): initializes request with empty headers/body and optional metadata unset.
- `TransportRequest::with_json_body` (`crates/core/src/transport.rs:53`): sets JSON content-type and serialized body; returns typed serialization failure as `TransportError`.
- `TransportResponse::is_success` (`crates/core/src/transport.rs:75`): convenience 2xx status check.
- `TransportResponse::header` (`crates/core/src/transport.rs:79`): case-insensitive-by-normalization header lookup (expects stored lowercase keys).
- `TransportResponse::body_text` (`crates/core/src/transport.rs:85`): UTF-8 decode wrapper returning typed decode error.
- `TransportResponse::json` (`crates/core/src/transport.rs:95`): JSON decode helper returning typed decode error.
- `TransportError::new` (`crates/core/src/transport.rs:128`): base constructor for categorized transport errors.
- `TransportError::timeout` (`crates/core/src/transport.rs:136`): standard retryable timeout error constructor.
- `TransportError::network` (`crates/core/src/transport.rs:140`): network error constructor with explicit retryability.
- `TransportError::invalid_request` (`crates/core/src/transport.rs:144`): non-retryable caller/input request error.
- `TransportError::circuit_open` (`crates/core/src/transport.rs:148`): retryable error emitted when circuit breaker blocks request.
- `TransportError::script_exhausted` (`crates/core/src/transport.rs:152`): non-retryable test transport error when scripted queue is empty.
- `Transport::send` trait method (`crates/core/src/transport.rs:159`): transport abstraction boundary used by retry layer and tests.
- `RealTransport::new` (`crates/core/src/transport.rs:168`): wraps a caller-provided `reqwest::Client`.
- `RealTransport::try_default` (`crates/core/src/transport.rs:172`): builds default `reqwest` client and maps build failure into transport error.
- `RealTransport::send` (`crates/core/src/transport.rs:182`): executes HTTP call with headers/body/timeout, emits redacted debug log, reads full response body, and normalizes headers.
- `redact_headers` (`crates/core/src/transport.rs:225`): clones header map with sensitive values replaced by `"<redacted>"`.
- `is_sensitive_header` (`crates/core/src/transport.rs:238`): centralized sensitive-header allowlist used for log redaction.
- `build_header_map` (`crates/core/src/transport.rs:252`): validates and converts string header map into `reqwest` `HeaderMap`.
- `normalize_header_map` (`crates/core/src/transport.rs:266`): converts response headers to lowercase-string `BTreeMap`, dropping non-UTF8 header values.
- `map_reqwest_error` (`crates/core/src/transport.rs:277`): classifies reqwest errors into timeout/invalid-request/network/internal categories with retryability flags.

## `crates/connectors/mock/src/lib.rs`

- `MockPublisher::platform_name` (`crates/connectors/mock/src/lib.rs:11`): fixed registry name `"mock"`.
- `MockPublisher::plan` (`crates/connectors/mock/src/lib.rs:15`): returns a single simulated action describing a mock publish.
- `MockPublisher::execute` (`crates/connectors/mock/src/lib.rs:23`): maps planned actions into simulated `ExecutionResult`s with `"SIMULATED"` status.
- `MockPublisher::verify` (`crates/connectors/mock/src/lib.rs:39`): always returns one successful verification result for TEST-mode workflows.

## `crates/core/src/orchestrator.rs`

### Constructors and registry helpers

- `RunReleaseInput::new` (`crates/core/src/orchestrator.rs:56`): convenience constructor that sets default per-platform action cap and stores artifacts root path.
- `Orchestrator::new` (`crates/core/src/orchestrator.rs:126`): creates orchestrator with DB handle and empty publisher registry.
- `Orchestrator::with_publishers` (`crates/core/src/orchestrator.rs:133`): bulk-registers publishers and fails fast on duplicates.
- `Orchestrator::register_publisher` (`crates/core/src/orchestrator.rs:144`): inserts publisher keyed by `platform_name`; enforces uniqueness.
- `Orchestrator::db` (`crates/core/src/orchestrator.rs:156`): exposes DB handle for read/query operations used by higher layers.
- `Orchestrator::publisher` (`crates/core/src/orchestrator.rs:725`): resolves publisher by normalized platform key or returns `UnknownPublisher`.

### Release plan/execute lifecycle

- `Orchestrator::run_release` (`crates/core/src/orchestrator.rs:160`): high-level orchestration wrapper that plans first, logs identifiers, then executes planned release.
- `Orchestrator::plan_release` (`crates/core/src/orchestrator.rs:174`): critical planning phase.
  - Validates input and normalizes platform list.
  - Computes idempotency keys and creates release/planned request directories.
  - Upserts release record and transitions state to `PLANNED` when needed.
  - Invokes each publisher’s `plan`, enforces action cap and TEST simulation guardrail.
  - Persists per-platform planned action rows/audit logs (skips overwriting already completed platform rows).
  - Writes per-platform planned request JSON artifact files.
  - Returns `PlannedRelease` object containing in-memory plan and artifact paths.
- `Orchestrator::execute_planned_release` (`crates/core/src/orchestrator.rs:305`): acquires run lock, delegates to `execute_locked`, then reliably attempts lock release and preserves primary execution error if both steps fail.
- `Orchestrator::execute_locked` (`crates/core/src/orchestrator.rs:342`): main execution state machine.
  - Loads current release state and pending platforms.
  - Performs legal state transitions (`PLANNED/FAILED/COMMITTED -> EXECUTING`, shortcut finalization from `VERIFIED/COMMITTED` when appropriate).
  - For each pending platform, marks action `EXECUTING`, appends audit log, calls publisher execute/verify, applies TEST guardrails and verification checks, stores results, marks action `Verified`.
  - On publisher failure or guardrail violation, marks platform/release failed and exits early.
  - After all platforms succeed, transitions release `EXECUTING -> VERIFIED -> COMMITTED` transactionally.
  - Finalizes and writes release report artifact.
- `Orchestrator::finalize_report` (`crates/core/src/orchestrator.rs:610`): assembles `ReleaseReportArtifact` from DB release/action rows plus planned file paths, infers `simulated/verified` flags from stored result JSON, writes `release_report.json`, and returns output paths/structs.
- `Orchestrator::transition_to_planned_if_needed` (`crates/core/src/orchestrator.rs:679`): performs idempotent state prep before planning reruns (`VALIDATED` or `FAILED` to `PLANNED`; leaves later states unchanged).
- `Orchestrator::mark_platform_failed` (`crates/core/src/orchestrator.rs:734`): transactional failure handler that marks platform action failed, transitions release to failed, records error audit log, and commits.

### Validation and utility helpers

- `validate_run_input` (`crates/core/src/orchestrator.rs:773`): enforces non-empty media and positive per-platform cap.
- `normalize_platforms` (`crates/core/src/orchestrator.rs:787`): trims/lowercases platform names, removes empties/duplicates, and requires at least one platform.
- `enforce_cap` (`crates/core/src/orchestrator.rs:807`): raises typed `CapExceeded` if action/result count exceeds configured cap.
- `require_verified` (`crates/core/src/orchestrator.rs:818`): requires non-empty verification set with all entries marked `verified=true`.
- `sanitize_filename` (`crates/core/src/orchestrator.rs:830`): converts platform IDs to safe artifact filenames (ASCII alnum/`-_`, else `_`).
- `relative_or_full` (`crates/core/src/orchestrator.rs:848`): emits artifact path relative to release root when possible, normalized to forward slashes.
- `infer_simulated_and_verified` (`crates/core/src/orchestrator.rs:854`): inspects stored result JSON to infer platform-level summary flags, tolerant of missing/malformed keys by defaulting to `false`.
- `write_json_pretty` (`crates/core/src/orchestrator.rs:889`): async pretty JSON file writer used for planned request and report artifacts.

## `crates/db/src/lib.rs`

### Error and state helpers

- `DbError::new` (`crates/db/src/lib.rs:38`): base typed DB error constructor.
- `DbError::invalid_state_transition` (`crates/db/src/lib.rs:45`): convenience constructor for transition rule violations.
- `DbError::serialize_json` (`crates/db/src/lib.rs:49`): wraps serde JSON serialization failures for DB payload columns.
- `DbError::deserialize_json` (`crates/db/src/lib.rs:56`): wraps stored JSON parse failures.
- `DbError::map_sqlx` (`crates/db/src/lib.rs:63`): central sqlx-to-`DbError` classifier covering pool, I/O, decode, sqlite DB errors, and fallback unknowns.
- `classify_sqlite_database_error` (`crates/db/src/lib.rs:95`): sqlite-specific message/code classifier (busy/locked, constraints, generic query).
- `ReleaseState::as_str` (`crates/db/src/lib.rs:126`): canonical serialized DB enum string.
- `ReleaseState::can_transition_to` (`crates/db/src/lib.rs:137`): explicit release state transition policy (includes resume transitions from `FAILED` and `COMMITTED` to `EXECUTING`).
- `ReleaseState::from_str` (`crates/db/src/lib.rs:158`): parses DB string state; unknown values produce row-decode error.
- `PlatformActionStatus::as_str` (`crates/db/src/lib.rs:185`): canonical serialized platform action status string.
- `PlatformActionStatus::is_completed` (`crates/db/src/lib.rs:195`): marks `Verified`/`Skipped` as terminal-complete.
- `PlatformActionStatus::from_str` (`crates/db/src/lib.rs:203`): parses DB action status with row-decode error on unknown values.
- `DbConfig::sqlite` (`crates/db/src/lib.rs:300`): sqlite config constructor with default pool size 5.

### `Db` (pool-backed operations)

- `Db::connect` (`crates/db/src/lib.rs:318`): opens sqlite pool, enables foreign keys, runs migrations, and returns `Db`.
- `Db::pool` (`crates/db/src/lib.rs:345`): exposes underlying `SqlitePool`.
- `Db::begin_tx` (`crates/db/src/lib.rs:349`): starts transaction and wraps it in `DbTx`.
- `Db::upsert_release` (`crates/db/src/lib.rs:358`): inserts/updates release (title/update timestamp only on conflict), then reloads row.
- `Db::get_release` (`crates/db/src/lib.rs:384`): fetches a single release row and maps it into `ReleaseRecord`.
- `Db::transition_release_state` (`crates/db/src/lib.rs:401`): validates transition policy then conditional-update transitions state when current state matches expected.
- `Db::set_release_failed` (`crates/db/src/lib.rs:432`): conditional transition to `FAILED` plus `last_error` write.
- `Db::acquire_run_lock` (`crates/db/src/lib.rs:463`): lock acquisition via `INSERT OR IGNORE` on `run_locks`; returns `true` only for the winner.
- `Db::release_run_lock` (`crates/db/src/lib.rs:479`): deletes lock row for the specific owner.
- `Db::upsert_platform_action` (`crates/db/src/lib.rs:495`): insert/update platform action row, preserving plan/result/external_id when caller passes `None`, optionally increments `attempt_count`, then reloads row.
- `Db::get_platform_action` (`crates/db/src/lib.rs:542`): fetches one platform action for release/platform key.
- `Db::list_platform_actions` (`crates/db/src/lib.rs:564`): loads all platform actions for a release ordered by platform.
- `Db::pending_platforms` (`crates/db/src/lib.rs:585`): subtracts completed platform rows from requested platform list to support resume behavior.
- `Db::append_audit_log` (`crates/db/src/lib.rs:604`): inserts audit log payload/message and reloads inserted row by `last_insert_rowid`.
- `Db::list_history` (`crates/db/src/lib.rs:635`): returns release history list sorted by latest update desc.

### `DbTx` (transaction-backed equivalents)

- `DbTx::commit` (`crates/db/src/lib.rs:669`): commits transaction with mapped sqlx errors.
- `DbTx::rollback` (`crates/db/src/lib.rs:676`): rolls back transaction with mapped sqlx errors.
- `DbTx::upsert_release` (`crates/db/src/lib.rs:683`): transactional equivalent of `Db::upsert_release`.
- `DbTx::get_release` (`crates/db/src/lib.rs:709`): transactional equivalent of `Db::get_release`.
- `DbTx::transition_release_state` (`crates/db/src/lib.rs:726`): transactional equivalent of `Db::transition_release_state`.
- `DbTx::set_release_failed` (`crates/db/src/lib.rs:755`): transactional equivalent of `Db::set_release_failed`.
- `DbTx::upsert_platform_action` (`crates/db/src/lib.rs:785`): transactional equivalent of `Db::upsert_platform_action`.
- `DbTx::get_platform_action` (`crates/db/src/lib.rs:830`): transactional equivalent of `Db::get_platform_action`.
- `DbTx::append_audit_log` (`crates/db/src/lib.rs:851`): transactional equivalent of `Db::append_audit_log`.

### Row/JSON mapping helpers

- `serialize_json_opt` (`crates/db/src/lib.rs:881`): serializes optional JSON payloads to optional strings for DB storage.
- `parse_json_opt` (`crates/db/src/lib.rs:889`): parses optional JSON strings from DB columns.
- `map_release_row` (`crates/db/src/lib.rs:896`): row decoder for `ReleaseRecord`, including enum parsing and typed decode error mapping.
- `map_platform_action_row` (`crates/db/src/lib.rs:929`): row decoder for `PlatformActionRecord`, including JSON payload parsing and status enum conversion.
- `map_audit_log_row` (`crates/db/src/lib.rs:967`): row decoder for `AuditLogEntry`.

## Cross-Cutting Review Notes (Rust Runtime/DB)

- Strong points:
  - Core safety constraints (TEST simulation, caps, verification) are enforced server-side in `orchestrator`, not delegated to UI.
  - State transition rules are centralized in `ReleaseState::can_transition_to` and rechecked at DB update boundaries.
  - Retry/report/transport layers use typed error classification consistently.
  - Resume semantics are supported via `pending_platforms` and idempotent release IDs.

- Review watchpoints:
  - `finalize_report` currently hardcodes `reused_completed_result = false` (`crates/core/src/orchestrator.rs:633`), so resume reuse is not surfaced in report summaries yet.
  - `infer_simulated_and_verified` is tolerant and defaults missing fields to `false`, which is safe but can hide malformed stored JSON without explicit diagnostics.
  - `Db::upsert_release` conflict update only refreshes title/timestamp; changes to normalized spec/hash/media for same `release_id` are intentionally ignored, which reviewers should validate against product expectations.
