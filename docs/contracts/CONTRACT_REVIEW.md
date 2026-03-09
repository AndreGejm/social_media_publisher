# Contract Review Report

Date: 2026-03-09  
Scope: C-001 through C-008 from `MODULE_CONTRACT_CATALOG.md`  
Mode: Architecture/QA review only (no implementation changes)

## Review rubric

- Clarity
- Completeness
- Ambiguity
- Likely failure modes
- Coupling risk
- Testability
- Missing type/state/error definitions
- Concurrency/race-condition risk
- Provider/consumer ownership correctness

Scoring scale: `High`, `Medium`, `Low` adequacy (higher is better).

## C-001 Shell -> Player Transport Controller

- Clarity: Medium
- Completeness: Low
- Ambiguity: High
- Likely failure modes:
  - Shell mutates transport state out-of-band because state/action boundaries are not explicit.
  - Queue and source identity drift when selection updates race with transport updates.
- Coupling risk: High (`WorkspaceApp.tsx` currently wires many internals directly).
- Testability: Medium-Low (no formal state snapshot or action pre/postconditions defined).
- Missing definitions:
  - Exact `TransportState` schema.
  - Queue identity/revision semantics.
  - Deterministic behavior guarantees for play/pause/stop when no source is armed.
- Concurrency/race risk: High (polling loop, UI actions, and mode transitions can overlap).
- Ownership correctness: Correct (provider should remain `player-transport`, consumer should remain `app/shell`).

## C-002 Shell -> Audio Output Controller

- Clarity: Medium
- Completeness: Low
- Ambiguity: High
- Likely failure modes:
  - UI displays requested mode as active mode when backend failed to switch.
  - Startup behavior diverges from shared-default requirement under initialization failures.
- Coupling risk: Medium-High (currently mixed inside transport hook).
- Testability: Medium-Low (no exact failure postconditions or fallback contract).
- Missing definitions:
  - Output controller state machine states and transitions.
  - Failure semantics for exclusive acquisition failure.
  - Allowed/forbidden side effects during switch.
- Concurrency/race risk: High (re-entrant mode switching, in-flight mode change overlap).
- Ownership correctness: Correct (`audio-output` provider, `app/shell` consumer).

## C-003 Audio Output -> Player Transport Handshake

- Clarity: Low
- Completeness: Low
- Ambiguity: Very High
- Likely failure modes:
  - Half-stopped transport state after mode switch errors.
  - Non-deterministic resume behavior (wrong source, wrong queue index, or no re-arm).
- Coupling risk: High (this contract is the critical seam; currently underspecified).
- Testability: Low (no typed handshake I/O and no invariants for resume behavior).
- Missing definitions:
  - Snapshot schema captured before switch.
  - Restore semantics when backend mode differs from requested mode.
  - Idempotency requirements for repeated prepare/restore calls.
- Concurrency/race risk: Very High (switch and user transport actions can interleave).
- Ownership correctness: Correct (provider `player-transport`, consumer `audio-output`).

## C-004 Audio Output -> Tauri Audio Bridge

- Clarity: Medium
- Completeness: Medium-Low
- Ambiguity: Medium-High
- Likely failure modes:
  - Unsanitized/partial output status values propagate to UI.
  - Missing or inconsistent error code handling between Rust and TS layers.
- Coupling risk: Medium
- Testability: Medium (wrapper exists but behavioral guarantees are not formalized).
- Missing definitions:
  - Exact input/output schema with versioned fields.
  - Structured error taxonomy for audio commands.
  - Capability/discovery semantics for device constraints.
- Concurrency/race risk: Medium-High (status polling may observe transitional states without sequence control).
- Ownership correctness: Correct.

## C-005 Player Transport -> Tauri Audio Bridge

- Clarity: Medium
- Completeness: Medium-Low
- Ambiguity: Medium
- Likely failure modes:
  - Queue changes race with track-change requests causing stale index acceptance/rejection.
  - Seek/play requests applied before queue/source is actually armed.
- Coupling risk: High (transport correctness depends on this contract precision).
- Testability: Medium
- Missing definitions:
  - Queue identity/revision contract.
  - Deterministic ordering/serialization rules for queue/track-change operations.
  - Failure postconditions (what must be true after rejection/errors).
- Concurrency/race risk: High
- Ownership correctness: Correct.

## C-006 Tauri Audio Bridge -> Backend Audio Service (IPC)

- Clarity: Medium
- Completeness: Medium
- Ambiguity: Medium-High
- Likely failure modes:
  - IPC schema drift between Rust structs and TS model assumptions.
  - Backward-compat regressions from command name/arg mapping changes.
- Coupling risk: High (this is the hard ABI/API seam).
- Testability: Medium-High (can be strongly tested if versioned wire contracts are fixed).
- Missing definitions:
  - Command-level wire compatibility rules (required/optional fields per version).
  - Error-code subset guarantees for playback/output commands.
  - Timeout and retry behavior expectations.
- Concurrency/race risk: Medium (backend worker and command calls are concurrent).
- Ownership correctness: Mostly correct; provider should be explicitly described as `commands/*.rs` boundary backed by playback-engine service.

## C-007 Backend Audio Status Truth Contract

- Clarity: Medium
- Completeness: Medium-Low
- Ambiguity: Medium
- Likely failure modes:
  - Frontend infers eligibility state instead of trusting backend snapshot.
  - Stale context snapshots displayed as current truth.
- Coupling risk: Medium
- Testability: Medium
- Missing definitions:
  - Snapshot freshness metadata (sequence/timestamp).
  - Rule for unknown or partially unavailable hardware/track fields.
  - Explicit requirement that note/reasons list remains stable and additive.
- Concurrency/race risk: Medium
- Ownership correctness: Correct (backend truth provider).

## C-008 Publisher Shared Transport Bridge

- Clarity: Medium
- Completeness: Medium-Low
- Ambiguity: Medium
- Likely failure modes:
  - Seek requests applied to stale/non-matching source.
  - Ensure-source calls causing unintended autoplay or source replacement.
- Coupling risk: Medium
- Testability: Medium
- Missing definitions:
  - Idempotency semantics for `ensureSource`.
  - No-op vs error behavior for `seekToRatio` source mismatch.
  - Update/observation semantics for bridge state changes.
- Concurrency/race risk: Medium
- Ownership correctness: Correct (`player-transport` provider).

## Cross-contract systemic risks

1. Error semantics are not globally standardized.
2. Queue identity and operation ordering are undefined.
3. Snapshot/state freshness is not contractually enforced.
4. Mode-switch handshake is underspecified relative to race risk.
5. Import boundary guardrails are defined in prose but not expressed as enforceable checks.

## Contract readiness verdict

- Current catalog is a solid architectural direction, but not yet enforceable for safe refactor execution.
- Major blockers before refactor implementation:
  - C-003 handshake hardening
  - cross-cutting error taxonomy
  - queue identity and snapshot contracts
  - explicit race/serialization rules across C-002/C-003/C-005/C-006
