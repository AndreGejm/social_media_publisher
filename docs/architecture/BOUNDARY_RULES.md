# Boundary Rules

Date: 2026-03-09
Status: Active (first-wave)

## Objective

Define enforceable ownership boundaries so feature work is performed inside bounded modules through public APIs, not deep internal imports.

## Module Ownership

| Module | Owns | Public entrypoint(s) | Must not own |
| --- | --- | --- | --- |
| `app-shell` | Workspace composition, UI routing/composition, top-level orchestration | `apps/desktop/src/app/shell/*` | Playback business rules, output-mode policy internals, raw IPC invocation |
| `player-transport` | Transport lifecycle, queue execution, arming/seek/play-pause orchestration, publisher transport bridge | `apps/desktop/src/features/player-transport/api/index.ts` | Output-mode policy state machine, raw Tauri invoke wiring |
| `audio-output` | Output mode policy (shared/exclusive), output status shaping for UI, mode-switch fallback behavior | `apps/desktop/src/features/audio-output/api/index.ts` | Queue ownership, catalog/library logic, direct shell composition logic |
| `tauri-audio-bridge` | Typed frontend adapter for audio-related IPC calls and wire models | `apps/desktop/src/services/tauri/audio/index.ts` | UI state decisions, transport lifecycle policy |
| `backend-audio-service` | Runtime playback/output lifecycle, device ownership, decode/render state, backend playback context truth | `apps/desktop/src-tauri/src/commands/playback.rs` (command boundary) | Frontend UI concerns, shell orchestration |

## Dependency Direction

1. `app-shell` composes modules through module public APIs only.
2. `player-transport` depends on shared/domain contracts and adapter APIs; it does not own output policy.
3. `audio-output` may use a narrow transport handshake contract for safe pause/resume and queue re-arm semantics during mode switches.
4. `tauri-audio-bridge` is the only frontend boundary for audio IPC commands/types.
5. Backend command handlers delegate playback/output ownership to backend audio runtime/service boundaries.

## Allowed Cross-Module Integration Points

- `WorkspaceApp.tsx` (composition only)
- `features/player-transport/api/index.ts`
- `features/audio-output/api/index.ts`
- `services/tauri/audio/index.ts`
- `services/tauri/tauriClient.ts` (public client aggregator)

## Forbidden Patterns

- Deep imports from another module's internal hooks/components/services.
- Importing raw Tauri IPC wrappers from feature/app layers.
- Raw Tauri invoke usage outside service adapter boundaries.
- Shell-level business logic for transport/output internals.
- Command-layer direct imports of `backend_audio_service::runtime` internals.

## First-Wave Enforcement

- Frontend lint rule: `no-restricted-imports` blocks legacy Tauri adapter import patterns outside `src/services/tauri/*`.
- Backend static check: `commands/backend_audio_service.rs` keeps `runtime` private (`mod runtime;`) so sibling command modules cannot access runtime internals directly.

## Temporary Exceptions (tracked)

- None.

## Change Rule

Any new cross-module dependency requires:

1. explicit owner assignment,
2. public entrypoint exposure,
3. contract update in architecture docs,
4. lint/import-policy compatibility.
