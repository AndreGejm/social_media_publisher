# Contract Gap Analysis

Date: 2026-03-09  
Scope: Pre-refactor contract gaps blocking safe first-wave adoption

## Summary

The hardened C-001..C-008 set is materially stronger, but several cross-cutting contracts are still required to prevent hidden coupling and refactor regressions.

## Gap register

| Gap ID | Required contract | Priority | Why missing contract is risky | Affected contracts | Proposed owner |
| --- | --- | --- | --- | --- | --- |
| G-001 | Error taxonomy contract | P0 (blocker) | Without a shared error code taxonomy, providers and consumers drift on fallback behavior and user messaging. | C-002, C-004, C-005, C-006, C-007, C-008 | `tauri-audio-bridge` + backend playback service |
| G-002 | Playback context/state snapshot contract | P0 (blocker) | No formal freshness/version semantics makes stale state indistinguishable from current truth. | C-001, C-002, C-004, C-006, C-007 | `backend-playback-engine-service` |
| G-003 | Queue identity contract | P0 (blocker) | Queue mutations and track-change requests can race without a stable queue revision identity. | C-001, C-003, C-005 | `player-transport` |
| G-004 | Event/subscription contract (optional but needed if reducing polling) | P1 | Poll-only state sync increases latency and race windows; consumers need explicit event semantics if subscriptions are introduced. | C-001, C-002, C-007, C-008 | `player-transport` + bridge |
| G-005 | Device capability contract | P1 | Exclusive/shared support and supported formats are inferred indirectly; mode decisions need explicit capability inputs. | C-002, C-004, C-006, C-007 | `backend-playback-engine-service` + bridge |
| G-006 | Switch transaction serialization contract | P0 (blocker) | Output-switch and transport actions can interleave and cause half-applied state transitions. | C-002, C-003, C-005 | `audio-output` + `player-transport` |
| G-007 | IPC sanitization/redaction contract | P1 | Bridge/backend may diverge on acceptable error/detail payloads, risking sensitive or unstable data propagation. | C-004, C-006 | `tauri-audio-bridge` + backend |
| G-008 | Contract versioning/compatibility contract | P1 | Additive field changes can break strict consumers without explicit compatibility policy. | C-004, C-005, C-006, C-007 | Architecture + bridge owners |

## Minimum required gap details

### G-001 Error taxonomy contract

Required before refactor implementation:
- Shared enum/union of stable codes for playback/output paths.
- Error class mapping rules:
  - validation
  - capability/unavailable
  - transient runtime
  - permanent runtime
- Retryability semantics per code.
- User-facing message policy vs internal detail policy.

### G-002 Playback context/state snapshot contract

Required before refactor implementation:
- Snapshot freshness fields (`snapshot_seq` and/or `captured_at_iso`).
- Atomicity expectation of fields in one snapshot.
- Rules for missing optional values.
- Stale snapshot handling policy on consumer side.

### G-003 Queue identity contract

Required before refactor implementation:
- Deterministic queue revision generation inputs.
- Rules for revision changes (order change, track add/remove, metadata-only updates).
- Rejection policy for stale track-change requests.

### G-004 Event/subscription contract

Required if any polling reduction or event-driven update is introduced:
- Event names, payload schemas, and ordering guarantees.
- Subscription lifecycle and unsubscription guarantees.
- Backpressure/drop/coalescing policy.

### G-005 Device capability contract

Required before refactor implementation if output-mode decisions are policy-driven:
- Capability snapshot schema:
  - exclusive supported
  - shared supported
  - supported bit-depth/sample-rate combinations
- Fallback preference rules linked to capabilities.

## Adoption order recommendation

1. G-001, G-002, G-003, G-006 (blockers)
2. G-005 (high-value for output policy quality)
3. G-004, G-007, G-008 (stabilization contracts)

## Go/no-go gate for starting broad refactor

Refactor should not proceed beyond narrow scaffolding until:
- Error taxonomy is ratified.
- Playback snapshot contract is ratified.
- Queue identity + switch serialization contracts are ratified.

Without these, implementation agents will still need to inspect internals to infer behavior, violating the stated acceptance criteria.
