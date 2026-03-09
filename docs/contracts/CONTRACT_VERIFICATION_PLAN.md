# Contract Verification Plan

Date: 2026-03-09  
Scope: Verification required before/through first-wave contract adoption

## Objectives

- Prove each contract C-001..C-008 is enforceable and testable.
- Detect schema drift at bridge/IPC boundaries early.
- Prevent architectural regressions (deep imports, raw invoke leakage, frontend truth fabrication).

## Test strategy overview

1. Provider contract tests (module-level behavior against hardened contracts)
2. Consumer integration tests with mocks/fakes (contract usage correctness)
3. IPC compatibility tests (bridge <-> command wire shape and error shape)
4. Static boundary enforcement (lint + import policy)
5. High-risk regression scenarios (output switching, queue control, publisher preview bridge)

---

## 1) Provider contract tests

### audio-output provider (C-002)

- Startup default mode test (`shared` by default).
- Exclusive request success/failure tests.
- Failure postcondition test: failed exclusive switch leaves controller usable.
- Mode switch serialization test: second switch request while in-flight is deterministic.

### player-transport provider (C-001, C-003, C-008)

- Transport state snapshot integrity tests.
- Action precondition tests (seek/play without source, invalid ratio handling).
- Output-switch handshake tests:
  - prepare/restore success
  - restore failure keeps paused stable state
  - stale snapshot rejection
- Publisher bridge tests:
  - ensureSource idempotency
  - seek mismatch no-op
  - concurrent ensureSource ordering

### tauri-audio-bridge provider (C-004, C-005)

- Input validation tests for all bridge methods.
- Response sanitization tests (malformed status fields, nullability normalization).
- Error mapping tests (bridge returns stable `ContractError` shape).

### backend playback-engine provider (C-006, C-007)

- Output status truth derivation tests for eligibility reasons.
- Context snapshot consistency tests.
- Error sanitization/redaction tests.
- Command behavior tests for playback operations and failure codes.

---

## 2) Consumer integration tests with mocks/fakes

### app-shell consuming player-transport + audio-output

- Shell composes both module APIs without direct internal access.
- Shell does not call raw Tauri APIs.
- Output mode UI reflects backend-driven status snapshots.

### audio-output consuming player-transport handshake + bridge

- Uses only handshake surface (no transport internals).
- Correct fallback handling when bridge reports exclusive unavailable.

### player-transport consuming bridge

- Queue sync and track-change request ordering with fake bridge.
- Deterministic behavior when bridge rejects requests.

### publisher-ops consuming shared transport bridge

- No direct transport mutation outside bridge methods.
- Preview source switching and seeking through contract only.

---

## 3) IPC compatibility tests

### Command wire-shape compatibility

For each command in C-006:
- request key naming compatibility (`camelCase` args from TS mapping to command args)
- response schema shape compatibility
- error schema compatibility (`{ code, message, details? }`)

Commands to verify:
- `init_exclusive_device`
- `set_volume`
- `set_playback_queue`
- `push_track_change_request`
- `set_playback_playing`
- `seek_playback_ratio`
- `get_playback_context`
- `get_playback_decode_error`

### Schema drift checks

- Snapshot contract fixtures in TS and Rust sides.
- Optional/additive field compatibility checks.

---

## 4) Static-analysis and lint guardrails

### Import boundary enforcement

- Enforce shell imports from module public entrypoints only.
- Enforce no deep imports into provider internals from consumers.

Suggested mechanisms:
- ESLint `no-restricted-imports` rules for module internals.
- Dependency graph rule checks (for example dependency-cruiser or equivalent) to enforce:
  - no `player-transport -> audio-output`
  - no raw `@tauri-apps/api/core` usage outside `services/tauri/audio/*`

### API usage enforcement

- Ban direct `invoke` usage outside bridge with lint rule/search guard.
- Require typed bridge responses (no `unknown` passthrough to modules).

---

## 5) Regression scenario suite (must-pass)

### Output switching regressions

- Start in shared mode with other app audio active.
- Switch to exclusive while playback active.
- Exclusive acquisition failure -> shared fallback.
- Switch back to shared restores expected coexistence behavior.

### Queue control regressions

- Queue sync + track-change ordering under rapid updates.
- Seek and play behavior when queue/track changes are in-flight.
- No stale queue-index application after queue revision changes.

### Publisher preview bridge regressions

- Ensure source and seek across source transitions.
- No seek on stale source key.
- No unintended autoplay on idempotent ensureSource.

---

## Contract-to-test matrix

| Contract | Provider tests | Consumer integration tests | IPC tests |
| --- | --- | --- | --- |
| C-001 | Yes | Yes (shell) | N/A |
| C-002 | Yes | Yes (shell) | Indirect via C-004/C-006 |
| C-003 | Yes | Yes (audio-output consumer) | N/A |
| C-004 | Yes | Yes (audio-output consumer) | Yes |
| C-005 | Yes | Yes (player-transport consumer) | Yes |
| C-006 | Yes | Indirect | Yes (primary) |
| C-007 | Yes | Yes (audio-output renderer) | Yes (via context response) |
| C-008 | Yes | Yes (publisher-ops consumer) | N/A |

---

## Verification gates and exit criteria

### Gate A: Contract definition completeness

- All C-001..C-008 hardened sections complete.
- G-001/G-002/G-003/G-006 blockers have ratified definitions.

### Gate B: Static boundaries enforced

- Import and raw invoke guardrails active in lint/static checks.

### Gate C: Contract test coverage

- Provider tests implemented and passing for each contract.
- Consumer integration tests passing for shell/audio-output/player-transport/publisher bridge.

### Gate D: IPC compatibility stability

- Command wire-shape compatibility tests passing.
- Error shape compatibility tests passing.

### Gate E: Regression confidence

- Output switching, queue control, and publisher preview regression suite passing.

Refactor implementation should proceed only after Gate A and Gate B are satisfied, and broad migration should proceed only after Gate C through E are green.
