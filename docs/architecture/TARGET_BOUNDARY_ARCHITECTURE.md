# Target Boundary Architecture

Phase: 2 (Design refinement only, no refactor yet)

## Design intent

Create bounded modules so future work can be done by changing one owning area plus its contracts, instead of tracing shell hooks, bridge code, and Rust internals across many files.

## Why current structure is problematic

- Output mode behavior is split across UI, transport hook, Tauri bridge, command wrappers, and Rust implementation.
- Shell composition (`WorkspaceApp.tsx`) directly coordinates many feature internals.
- The TypeScript Tauri adapter is one broad file (`tauri-api.ts`) across unrelated domains.
- Rust playback logic is embedded in a multi-domain `commands.rs` file.

## First-wave bounded modules

The first wave remains scoped to these four modules:

1. `audio-output`
2. `player-transport`
3. `tauri-audio-bridge`
4. `backend-playback-engine-service` (clarified name for broader playback-engine ownership)

## Module root naming rule (first-wave)

To avoid long-term ambiguity between `features/` and `modules/`:

- First-wave bounded owners stay under `features/` on the frontend.
- `modules/` is **not** introduced in first-wave migration.
- Existing `features/player/*` files may remain as temporary legacy hosts until responsibilities are extracted, then are reduced or removed.
- Rule: one long-term root for frontend bounded owners in this wave = `features/`.

## Proposed target folder shape (planned)

```text
apps/desktop/src/
  app/
    shell/
      AppShell.tsx
      WorkspaceApp.tsx                    # composition only after refactor
  features/
    audio-output/
      api/
      model/
      ui/
      adapters/
    player-transport/
      api/
      model/
      hooks/
      adapters/
  services/
    tauri/
      audio/                              # tauri-audio-bridge
        index.ts
        commands.ts
        mappers.ts
        types.ts
      tauriClient.ts                      # composes domain bridge entrypoints
      TauriClientProvider.tsx

apps/desktop/src-tauri/src/
  services/
    playback_engine/
      mod.rs
      control_plane.rs
      output_mode.rs
      decode.rs
      render.rs
      status.rs
  commands/
    audio_output.rs                       # output mode/status command boundary
    playback.rs                           # transport command boundary
  lib.rs                                  # command registration only
```

Notes:
- This is the target shape for first-wave migration only.
- It is not applied in Phase 2.

## Module dependency direction rules

- `app/shell` may depend only on public APIs from:
  - `player-transport`
  - `audio-output`
- `player-transport` may depend on:
  - `tauri-audio-bridge`
  - shared/domain contracts
- `player-transport` must **not** depend on `audio-output`.
- `audio-output` may depend on:
  - `tauri-audio-bridge`
  - a **narrow public transport handshake contract** from `player-transport`, only for safe stop/resume around output mode switch.
- `tauri-audio-bridge` may depend on `@tauri-apps/api/*` and typed command contracts.
- Rust command files (`commands/audio_output.rs`, `commands/playback.rs`) delegate to `services/playback_engine/*`.

Forbidden:
- `app/shell` importing module internals.
- `player-transport` importing `audio-output`.
- Feature code calling raw Tauri `invoke` directly.
- Rust command wrappers implementing business logic (must delegate to playback-engine service).

## Module definitions

### 1) audio-output

- Purpose: owns output mode UX, mode request policy, active mode status, and bit-perfect eligibility presentation.
- Owned responsibilities:
  - Shared/Exclusive mode state machine (request, transition, fallback behavior policy).
  - User warning policy for Exclusive mode.
  - Output status model (`requestedMode`, `activeMode`, `bitPerfectEligible`, `reasons`).
  - Public actions for mode changes.
- Non-goals:
  - Queue orchestration.
  - General playback transport lifecycle ownership.
  - Raw Tauri command invocation.
- Public API (planned):
  - `useAudioOutputController()`
  - `AudioOutputStatus`
  - `AudioOutputModeToggle` UI element
- Allowed dependencies:
  - `tauri-audio-bridge` audio contracts
  - narrow `player-transport` handshake contract (stop/resume-safe only)
  - shared UI/domain primitives
- Forbidden dependencies:
  - app shell internals
  - non-audio feature internals
  - deep `player-transport` internals

### 2) player-transport

- Purpose: owns playback transport lifecycle, queue playback coordination, source arming, and shared transport bridge state.
- Owned responsibilities:
  - play/pause/stop/seek transport actions
  - queue-based arming and deterministic resume behavior
  - native/legacy transport fallback behavior
  - publisher shared transport bridge adapter
  - exposes a narrow optional handshake contract for audio-output switch safety
- Non-goals:
  - output mode UX policy
  - output mode warning policy
  - bit-perfect eligibility presentation policy
- Public API (planned):
  - `usePlayerTransportController()`
  - `SharedTransportBridge`
  - `TransportState`
  - `TransportOutputSwitchHandshake` (narrow)
- Allowed dependencies:
  - `tauri-audio-bridge` transport calls
  - shared/domain contracts
- Forbidden dependencies:
  - `audio-output` module
  - shell state internals
  - UI internals of other features

### 3) tauri-audio-bridge

- Purpose: a single typed adapter boundary for frontend audio command calls.
- Owned responsibilities:
  - command invocation wrappers for audio output and playback context
  - argument validation and response sanitization
  - error shape normalization for audio commands
- Non-goals:
  - transport orchestration
  - UI logic
  - non-audio domains in this first wave
- Public API (planned):
  - `initPlaybackOutputMode(...)`
  - `getPlaybackContext()`
  - `setPlaybackQueue(...)`, `setPlaybackPlaying(...)`, `seekPlaybackRatio(...)`
  - typed `PlaybackOutputStatus` and related contracts
- Allowed dependencies:
  - `@tauri-apps/api/core`
  - shared sanitize helpers
- Forbidden dependencies:
  - React hooks/components
  - app-shell and feature state

### 4) backend-playback-engine-service

- Purpose: isolate Rust playback-engine ownership behind a dedicated backend service boundary.
- Owned responsibilities:
  - playback control plane
  - output mode acquisition/release and status derivation
  - decode and render lifecycle
  - stream state and playback context truth
- Non-goals:
  - catalog, publishing, and unrelated QC command business logic
- Public API (planned):
  - internal Rust service methods consumed by `commands/audio_output.rs` and `commands/playback.rs`
  - stable wire models used by playback/output commands
- Allowed dependencies:
  - platform audio crates and decode/resample libraries
  - shared backend error/model contracts
- Forbidden dependencies:
  - Tauri window/UI concerns
  - unrelated command domains

## Integration points

- `app/shell` composes `player-transport` and `audio-output` via public APIs only.
- `player-transport` uses `tauri-audio-bridge` for transport commands only.
- `audio-output` uses `tauri-audio-bridge` for output mode/status calls.
- `audio-output` may call only the narrow `TransportOutputSwitchHandshake` API from `player-transport` when performing mode switch safety flow.
- `tauri-audio-bridge` maps to Rust command boundaries:
  - `commands/audio_output.rs`
  - `commands/playback.rs`
- Rust command boundaries delegate to:
  - `services/playback_engine/*`

## Invariants to enforce

- App startup default output mode is `Shared`.
- Exclusive mode requires explicit user request.
- Output mode switch performs full stream teardown + clean init.
- UI output status always reflects backend truth, not optimistic assumptions.
- Bit-perfect status means `eligible`, never guaranteed passthrough claim.
- Dependency direction remains one-way: `player-transport` does not depend on `audio-output`.

## Pilot file mapping: audio-output first wave

### Current host files

- Frontend:
  - `apps/desktop/src/features/player/SharedPlayerBar.tsx`
  - `apps/desktop/src/features/player/hooks/usePlayerTransportState.ts` (output-mode/status slices)
  - `apps/desktop/src/app/shell/WorkspaceApp.tsx` (current composition point)
- Tauri bridge:
  - `apps/desktop/src/services/tauri/tauri-api.ts` (audio output + playback context calls)
  - `apps/desktop/src/services/tauri/tauriClient.ts` (re-export surface)
- Rust backend:
  - `apps/desktop/src-tauri/src/commands/playback.rs`
  - `apps/desktop/src-tauri/src/commands.rs` (output/status + playback-engine internals)
  - `apps/desktop/src-tauri/src/lib.rs` (command registration)

### Target owning modules/files

- Frontend owners:
  - `apps/desktop/src/features/audio-output/api/*`
  - `apps/desktop/src/features/audio-output/model/*`
  - `apps/desktop/src/features/audio-output/ui/*`
  - `apps/desktop/src/features/audio-output/adapters/*`
- Tauri bridge owners:
  - `apps/desktop/src/services/tauri/audio/types.ts`
  - `apps/desktop/src/services/tauri/audio/commands.ts`
  - `apps/desktop/src/services/tauri/audio/mappers.ts`
  - `apps/desktop/src/services/tauri/audio/index.ts`
- Rust backend owners:
  - `apps/desktop/src-tauri/src/commands/audio_output.rs`
  - `apps/desktop/src-tauri/src/services/playback_engine/output_mode.rs`
  - `apps/desktop/src-tauri/src/services/playback_engine/status.rs`
  - `apps/desktop/src-tauri/src/services/playback_engine/mod.rs`

### Integration-only files (allowed minimal cross-module points)

- `apps/desktop/src/app/shell/WorkspaceApp.tsx` (module composition only)
- `apps/desktop/src/features/player-transport/api/index.ts` (handshake contract export only)
- `apps/desktop/src/services/tauri/TauriClientProvider.tsx` (dependency injection only)
- `apps/desktop/src-tauri/src/commands/playback.rs` (transport command boundary only)
- `apps/desktop/src-tauri/src/lib.rs` (registration only)

## Migration strategy (first wave)

1. Define module public interfaces and contract types with no behavior change.
2. Extract frontend audio command wrappers into `services/tauri/audio/*`.
3. Introduce `features/audio-output/*` module facade for output policy and status.
4. Introduce `features/player-transport/*` module facade for transport lifecycle.
5. Update `WorkspaceApp` to compose both module facades only.
6. Move Rust playback-engine internals from `commands.rs` into `services/playback_engine/*`.
7. Add `commands/audio_output.rs` and keep `commands/playback.rs` as thin command boundaries.
8. Keep existing command wire compatibility during the first wave.

## Tradeoffs

- Short-term extra indirection while old and new paths coexist.
- More files, but lower per-change scan radius.
- Requires temporary adapter shims to avoid risky behavior rewrites.

## Intentionally not changed in first wave

- Feature UX and workflow behavior outside audio-output and transport boundaries.
- Command names used by existing frontend calls.
- Catalog/release/QC domain architecture beyond required integration contracts.

## Migration risks

- Behavior drift during stop/resume and mode-switch edge cases.
- Contract mismatch between TS bridge types and Rust wire types.
- Test fragility in broad shell tests while shell becomes thinner.

## Stop point

Phase 2 artifacts are complete after this design refinement.
No refactor or file moves are included in this phase.
