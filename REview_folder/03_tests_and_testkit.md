# Tests And Testkit Function Review

## Rust Test Utilities (`crates/testkit/src/lib.rs`)

### `ScriptedResponse` helpers

- `ScriptedResponse::text` (`crates/testkit/src/lib.rs:18`): builds a plain-text scripted response fixture with empty headers.
- `ScriptedResponse::try_json` (`crates/testkit/src/lib.rs:27`): builds a JSON scripted response fixture with content-type header and serialized body, surfacing JSON serialization failures.
- `ScriptedResponse::with_header` (`crates/testkit/src/lib.rs:40`): adds/overwrites a lowercased response header on scripted fixtures.

### `ScriptedTransportError` and conversions

- `ScriptedTransportError::timeout` (`crates/testkit/src/lib.rs:64`): constructs retryable timeout fault fixture.
- `ScriptedTransportError::network` (`crates/testkit/src/lib.rs:72`): constructs network fault fixture with explicit retryability.
- `From<ScriptedTransportError> for TransportError::from` (`crates/testkit/src/lib.rs:82`): maps scripted faults into production transport error types/codes.

### `ScriptedStep` and script assembly

- `ScriptedStep::response` (`crates/testkit/src/lib.rs:106`): convenience wrapper for response step variant.
- `ScriptedStep::error` (`crates/testkit/src/lib.rs:110`): convenience wrapper for error step variant.
- `ScriptedStepSpec::new` (`crates/testkit/src/lib.rs:130`): wraps a step with no request expectation.
- `ScriptedStepSpec::expect` (`crates/testkit/src/lib.rs:137`): attaches request expectation (method/url/call index) to a scripted step.
- `fault_script` (`crates/testkit/src/lib.rs:155`): canned fault scenario generator used by retry/transport tests (timeouts, 429 with retry-after, 500 bursts, malformed JSON, partial bodies, token-expired 401, partial failure sequences).

### `TestTransport`

- `TestTransport::with_steps` (`crates/testkit/src/lib.rs:231`): creates transport from raw scripted steps (auto-wraps into `ScriptedStepSpec`).
- `TestTransport::with_step_specs` (`crates/testkit/src/lib.rs:236`): creates transport with explicit step expectations and internal queue/request recording storage.
- `TestTransport::with_fault` (`crates/testkit/src/lib.rs:245`): convenience constructor using `fault_script`.
- `TestTransport::push_step` (`crates/testkit/src/lib.rs:249`): appends a raw step to existing queue.
- `TestTransport::push_step_spec` (`crates/testkit/src/lib.rs:253`): appends step with expectations to queue.
- `TestTransport::recorded_requests` (`crates/testkit/src/lib.rs:259`): returns clone of captured request log.
- `TestTransport::remaining_steps` (`crates/testkit/src/lib.rs:264`): reports queued scripted steps left.
- `TestTransport::lock_inner` (`crates/testkit/src/lib.rs:269`): mutex lock helper that converts poisoned mutex into typed transport error.
- `TestTransport::send` (`crates/testkit/src/lib.rs:282`): transport impl under test. Records request, dequeues scripted step, validates expectation, then returns scripted response or error.
- `validate_request_expectation` (`crates/testkit/src/lib.rs:308`): checks call index, method, and URL substring expectations against an incoming request.

## Rust Integration Tests: Transport/Retry (`crates/testkit/tests/transport_faults.rs`)

- `RecordingSleeper::delays` (`crates/testkit/tests/transport_faults.rs:18`): test helper returning collected retry delays.
- `RecordingSleeper::sleep_ms` (`crates/testkit/tests/transport_faults.rs:25`): sleeper impl that records delays instead of sleeping.
- `request` (`crates/testkit/tests/transport_faults.rs:30`): shared POST request fixture used by retry/transport tests.
- `retries_on_timeout_then_succeeds` (`crates/testkit/tests/transport_faults.rs:37`): validates timeout retry path, delay recording, and request replay count.
- `retries_on_500_burst_then_succeeds_with_exponential_backoff` (`crates/testkit/tests/transport_faults.rs:66`): validates status-based retries and doubling backoff.
- `honors_retry_after_for_429` (`crates/testkit/tests/transport_faults.rs:93`): verifies `Retry-After` header overrides backoff for 429.
- `malformed_json_fault_returns_typed_decode_error` (`crates/testkit/tests/transport_faults.rs:119`): confirms malformed JSON response decoding returns typed decode error.
- `partial_body_fault_returns_typed_decode_error` (`crates/testkit/tests/transport_faults.rs:130`): confirms truncated JSON body also maps to typed decode error.
- `token_expired_401_is_not_retried_by_default_policy` (`crates/testkit/tests/transport_faults.rs:141`): documents current policy treating 401 as terminal response.
- `partial_failure_script_preserves_order_and_request_recording` (`crates/testkit/tests/transport_faults.rs:161`): verifies scripted sequence ordering and request capture across response+error steps.
- `never_exceeds_max_attempts_on_repeated_timeouts` (`crates/testkit/tests/transport_faults.rs:182`): ensures retry loop honors max-attempt ceiling.
- `never_retries_permanent_400_by_default` (`crates/testkit/tests/transport_faults.rs:207`): confirms 400 is terminal under default policy.
- `scripted_step_expectations_match_method_url_and_call_index` (`crates/testkit/tests/transport_faults.rs:233`): verifies expectation matching logic on scripted requests.

## Rust Integration Tests: DB State Machine (`crates/db/tests/state_machine.rs`)

- `sqlite_file_url` (`crates/db/tests/state_machine.rs:8`): test helper converting Windows path to sqlite URL.
- `new_test_db` (`crates/db/tests/state_machine.rs:19`): creates single-connection in-memory DB for deterministic tests.
- `new_file_backed_pair` (`crates/db/tests/state_machine.rs:25`): creates two DB connections to same file-backed sqlite DB for lock contention tests.
- `sample_release` (`crates/db/tests/state_machine.rs:48`): returns valid release fixture record.
- `state_machine_happy_path_transitions` (`crates/db/tests/state_machine.rs:60`): validates standard release lifecycle transitions and persisted final state.
- `invalid_transition_is_rejected` (`crates/db/tests/state_machine.rs:86`): confirms illegal state jump is blocked with `InvalidStateTransition`.
- `run_lock_prevents_duplicate_run` (`crates/db/tests/state_machine.rs:99`): validates single-owner run lock semantics on one DB handle.
- `run_lock_prevents_parallel_acquire_across_connections` (`crates/db/tests/state_machine.rs:110`): validates lock exclusivity across separate DB connections.
- `resume_semantics_skip_completed_platforms` (`crates/db/tests/state_machine.rs:128`): confirms `pending_platforms` excludes verified actions but includes failed/missing ones.
- `audit_logs_and_history_are_persisted` (`crates/db/tests/state_machine.rs:177`): validates audit log insert and history listing behavior.
- `schema_constraints_reject_invalid_hash_lengths` (`crates/db/tests/state_machine.rs:196`): ensures DB schema constraints enforce hash-length invariants.
- `transaction_rolls_back_when_second_write_fails` (`crates/db/tests/state_machine.rs:218`): proves transaction rollback preserves atomicity after second write failure.

## Rust Source-Embedded Unit Tests

### `crates/core/src/circuit_breaker.rs`

- `opens_after_threshold_failures_and_recovers_to_half_open` (`crates/core/src/circuit_breaker.rs:102`): validates open/half-open/closed progression and circuit-open error.
- `half_open_failure_reopens_circuit` (`crates/core/src/circuit_breaker.rs:125`): validates half-open failure immediately reopens circuit with fresh timeout.

### `crates/core/src/spec.rs`

- `normalize_text_collapses_internal_whitespace` (`crates/core/src/spec.rs:186`): verifies whitespace normalization helper behavior.

### `crates/core/src/retry.rs`

- `backoff_is_capped` (`crates/core/src/retry.rs:265`): verifies exponential backoff respects `max_delay_ms`.
- `retry_after_header_overrides_default_backoff_for_429` (`crates/core/src/retry.rs:282`): validates explicit `Retry-After` precedence.
- `non_retryable_error_returns_no_delay` (`crates/core/src/retry.rs:297`): verifies non-retryable errors terminate immediately.
- `deterministic_jitter_is_bounded_and_repeatable` (`crates/core/src/retry.rs:304`): verifies deterministic jitter repeatability and bounds.

### `crates/core/src/transport.rs`

- `redacts_sensitive_headers` (`crates/core/src/transport.rs:302`): confirms redaction covers sensitive headers and preserves safe ones.
- `response_json_decode_returns_typed_error` (`crates/core/src/transport.rs:334`): confirms JSON decode failure maps to `ResponseDecodeFailed`.

## Rust Core Tests (`crates/core/tests/*`)

### `crates/core/tests/release_spec.rs`

- `parses_and_normalizes_valid_yaml` (`crates/core/tests/release_spec.rs:4`): golden-path parse/normalize test including snapshot match.
- `rejects_missing_required_fields_with_structured_errors` (`crates/core/tests/release_spec.rs:31`): validates structured missing-field error.
- `rejects_unknown_fields_as_yaml_parse_error` (`crates/core/tests/release_spec.rs:43`): checks strict YAML schema behavior.
- `fuzz_like_malformed_yaml_inputs_do_not_panic` (`crates/core/tests/release_spec.rs:56`): resilience test to ensure malformed YAML yields structured errors without panic/internal invariant leakage.

### `crates/core/tests/idempotency.rs`

- `sample_spec` (`crates/core/tests/idempotency.rs:6`): builds normalized spec fixture from YAML template.
- `release_id_is_deterministic_for_same_spec_and_media` (`crates/core/tests/idempotency.rs:19`): validates deterministic ID generation.
- `release_id_changes_when_spec_changes` (`crates/core/tests/idempotency.rs:31`): validates spec hash/ID sensitivity.
- `release_id_changes_when_media_changes` (`crates/core/tests/idempotency.rs:43`): validates media fingerprint/ID sensitivity.
- `idempotency_keys_include_consistent_hashes` (`crates/core/tests/idempotency.rs:55`): validates consistency and expected 64-char hash lengths.

### `crates/core/tests/spec_properties.rs`

- `yaml_escape` (`crates/core/tests/spec_properties.rs:4`): escapes generated strings for YAML-safe embedding in property tests.
- `normalization_is_deterministic_for_equivalent_whitespace` (`crates/core/tests/spec_properties.rs:10`): property test proving semantically equivalent whitespace/tag casing normalize to same spec and normalized JSON.

### `crates/core/tests/idempotency_properties.rs`

- `yaml_escape` (`crates/core/tests/idempotency_properties.rs:5`): YAML escaping helper for generated property inputs.
- `release_id_is_stable_for_semantically_equivalent_specs` (`crates/core/tests/idempotency_properties.rs:11`): property test linking spec normalization equivalence to idempotency key equality.

### `crates/core/tests/mock_pipeline.rs`

- `sqlite_file_url` (`crates/core/tests/mock_pipeline.rs:13`): helper converting test DB path to sqlite URL.
- `file_backed_db` (`crates/core/tests/mock_pipeline.rs:24`): creates file-backed sqlite DB for orchestration/resume tests.
- `sample_spec` (`crates/core/tests/mock_pipeline.rs:41`): normalized spec fixture generator.
- `mock_pipeline_runs_end_to_end_and_is_idempotent_on_rerun` (`crates/core/tests/mock_pipeline.rs:55`): end-to-end happy path + idempotent rerun test validating reused release ID and no duplicate execution.
- `Counters::inc` (`crates/core/tests/mock_pipeline.rs:155`): shared counter increment helper for publisher call tracking.
- `Counters::executes` (`crates/core/tests/mock_pipeline.rs:159`): returns execute-call count.
- `TestPublisher::platform_name` (`crates/core/tests/mock_pipeline.rs:173`): platform identity for test publisher.
- `TestPublisher::plan` (`crates/core/tests/mock_pipeline.rs:177`): increments plan counter and emits one simulated plan action.
- `TestPublisher::execute` (`crates/core/tests/mock_pipeline.rs:186`): increments execute counter, optionally injects first-call failure, otherwise returns simulated execution results.
- `TestPublisher::verify` (`crates/core/tests/mock_pipeline.rs:206`): increments verify counter and returns successful verification.
- `partial_failure_resume_skips_completed_platform_and_retries_only_failed_one` (`crates/core/tests/mock_pipeline.rs:217`): validates resume semantics after partial failure and per-platform attempt counts.
- `TwoActionPublisher::platform_name` (`crates/core/tests/mock_pipeline.rs:324`): platform name for cap enforcement test.
- `TwoActionPublisher::plan` (`crates/core/tests/mock_pipeline.rs:328`): emits two actions to intentionally exceed cap.
- `TwoActionPublisher::execute` (`crates/core/tests/mock_pipeline.rs:343`): unreachable in cap test; asserts plan should fail before execute.
- `TwoActionPublisher::verify` (`crates/core/tests/mock_pipeline.rs:351`): unreachable in cap test.
- `per_run_cap_is_enforced_in_core_plan_phase` (`crates/core/tests/mock_pipeline.rs:318`): verifies orchestrator rejects plan when publisher emits more actions than configured cap.
- `UnsafePublisher::platform_name` (`crates/core/tests/mock_pipeline.rs:384`): platform name for TEST guardrail test.
- `UnsafePublisher::plan` (`crates/core/tests/mock_pipeline.rs:388`): returns non-simulated plan action to trigger TEST safety guard.
- `UnsafePublisher::execute` (`crates/core/tests/mock_pipeline.rs:396`): placeholder execute result (not central to test).
- `UnsafePublisher::verify` (`crates/core/tests/mock_pipeline.rs:404`): placeholder verify result (not central to test).
- `test_env_rejects_non_simulated_actions_in_core` (`crates/core/tests/mock_pipeline.rs:378`): validates TEST-mode plan guardrail is enforced in core orchestrator.

## Tauri Backend Tests (`apps/desktop/src-tauri/src/commands.rs`)

- `new_service` (`apps/desktop/src-tauri/src/commands.rs:541`): test helper constructing isolated `CommandService` in temp runtime directory.
- `write_fixture_files` (`apps/desktop/src-tauri/src/commands.rs:549`): writes spec/media fixture files and returns paths as strings.
- `command_service_plan_execute_history_report_happy_path` (`apps/desktop/src-tauri/src/commands.rs:571`): end-to-end command service happy-path test (plan/execute/history/report).
- `rejects_odd_prefix_paths` (`apps/desktop/src-tauri/src/commands.rs:611`): validates path hardening against extended-prefix input.

## Frontend Unit Tests (`apps/desktop/src/App.test.tsx`)

### Helpers

- `installTauriMock` (`apps/desktop/src/App.test.tsx:15`): installs an in-browser `window.__TAURI__.core.invoke` mock with mutable workflow state and canned command responses.
- `invokeMock` (inside `installTauriMock`, `apps/desktop/src/App.test.tsx:22`): command dispatcher used by the mock Tauri runtime; simulates load/plan/execute/history/report state transitions.
- `invokeMock` (local to secret-redaction test, `apps/desktop/src/App.test.tsx:164`): specialized mock that throws structured backend errors with secret fields to validate redaction logging.

### Top-level test callbacks (`it(...)`)

- `it("renders the phase 1 shell", ...)` (`apps/desktop/src/App.test.tsx:110`): smoke test for baseline UI shell/branding rendering.
- `it("shows a validation error when submitting empty spec path", ...)` (`apps/desktop/src/App.test.tsx:117`): verifies client-side validation path before backend call.
- `it("shows a structured backend error when Tauri runtime is unavailable", ...)` (`apps/desktop/src/App.test.tsx:125`): validates `TAURI_UNAVAILABLE` normalization path.
- `it("runs the mocked plan -> execute -> history/report workflow", ...)` (`apps/desktop/src/App.test.tsx:137`): full mocked UI workflow test across all major screens.
- `it("redacts secret fields before logging backend error details", ...)` (`apps/desktop/src/App.test.tsx:162`): verifies recursive redaction before console error logging.

## Playwright Tests

### `playwright/tests/smoke.spec.ts`

- `test("homepage renders release publisher shell", ...)` (`playwright/tests/smoke.spec.ts:3`): browser smoke test for shell rendering.
- `test("prototype validation shows failure path for empty spec path", ...)` (`playwright/tests/smoke.spec.ts:12`): validates empty-form client-side error path.
- `test("browser preview shows structured backend error when Tauri runtime is unavailable", ...)` (`playwright/tests/smoke.spec.ts:20`): validates no-runtime structured error in browser preview.
- `test("browser preview can run workflow with injected Tauri mock and no external network", ...)` (`playwright/tests/smoke.spec.ts:32`): browser E2E-style workflow with injected mock runtime and explicit external-network request assertion.

### `playwright/runtime/desktop-runtime.spec.ts`

- `connectTauriPage` (`playwright/runtime/desktop-runtime.spec.ts:17`): connects to running Tauri WebView via CDP, waits for page availability, reloads, validates shell visibility, and returns `{ browser, page }`.
- `test("failure path rejects unsafe spec path, blocks unknown command, and creates no release side effects", ...)` (`playwright/runtime/desktop-runtime.spec.ts:41`): runtime E2E negative-path test covering path hardening, Tauri command allowlist enforcement, and side-effect absence.
- `test("happy path loads spec, plans, executes in TEST mode, and writes report/DB artifacts", ...)` (`playwright/runtime/desktop-runtime.spec.ts:96`): runtime E2E happy-path test verifying UI flow and artifact/DB file creation.

## Test Review Notes

- The test suite is strong on behavioral invariants (idempotency, retries, state transitions, TEST safety guardrails).
- Test helper functions are intentionally composable and deterministic (notably `TestTransport`, deterministic retry jitter, and tempdir-based DB/artifact isolation).
- Browser preview and runtime E2E are separated cleanly, which helps external reviewers distinguish mocked UI behavior from actual Tauri command/runtime integration.
