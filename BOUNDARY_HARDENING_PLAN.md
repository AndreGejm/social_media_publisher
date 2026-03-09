# Boundary Hardening Plan

Date: 2026-03-09
Scope: Targeted boundary-hardening pass after modularity audit

## 1) Transport vs Output Dependency Direction

Required direction after hardening:

- `audio-output` owns output-mode policy and output-status derivation.
- `player-transport` owns playback lifecycle, queue, and armed-source mechanics.
- `audio-output` may depend on a narrow public handshake contract exported by `player-transport/api`.
- `player-transport` must not import `audio-output` internals.

Allowed dependency graph:

- `app/shell` -> `player-transport/api`
- `app/shell` -> `audio-output/api`
- `audio-output` -> `player-transport/api` (type + contract only)
- `player-transport` -> `services/tauri/tauriClient`
- `audio-output` -> `services/tauri/tauriClient`

Forbidden:

- `player-transport/*` -> `features/audio-output/hooks|model|services`
- `audio-output/*` -> `features/player-transport/hooks|model|services` (except public API contract)

## 2) Transport Handshake Contract (for Output Switching)

`player-transport` will expose a minimal handshake to support deterministic output switching:

- read desired output config (sample rate / bit depth)
- read queue snapshot + active index + source-armed flag
- read current UI volume scalar
- pause transport safely before switch
- re-arm current source for native playback after switch
- resume playback only when deterministic
- apply backend playback-context snapshot to transport UI state
- set native-enabled/checked flags and fallback state

No direct access to transport internal refs/state outside this contract.

## 3) WorkspaceApp Import Rules

Allowed in `WorkspaceApp.tsx`:

- feature public entrypoints only (`features/<feature>/index.ts` or `features/<feature>/api/index.ts`)
- app-shell state/context modules
- shared primitives
- Tauri client provider/public client

Forbidden in `WorkspaceApp.tsx`:

- imports from `features/**/hooks/*`
- imports from `features/**/components/*`
- imports from `features/**/model/*`
- imports from `features/**/services/*`

## 4) commands.rs Ownership Target

`commands.rs` should own only:

- shared IPC type definitions and error wire model used across command modules
- service bootstrap (`shared_service`) and shared constants that are intentionally cross-domain
- module wiring (`mod ...`, `pub use ...`)

`commands.rs` should not own:

- domain command handler implementations (already split)
- large test bodies (move to `commands/tests.rs`)
- domain runtime internals (keep in module-owned files)

## 5) Direct Tauri API Usage Rules

Allowed:

- `apps/desktop/src/services/tauri/**`
- `apps/desktop/src/infrastructure/tauri/**`

Forbidden:

- `apps/desktop/src/shared/**`
- `apps/desktop/src/features/**` (except via service/infrastructure adapter imports)

Specific cleanup target:

- remove direct `@tauri-apps/api/*` import from `shared/lib/media-url.ts`
- route Tauri-specific media URL conversion through infrastructure/service adapter boundary
