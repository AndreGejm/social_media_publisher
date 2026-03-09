# First-Wave Refactor Log

Date: 2026-03-09  
Phase: 3/4 (first-wave execution + boundary enforcement)

## Scope in initial pass

- Established explicit frontend `tauri-audio-bridge` folder boundary under `apps/desktop/src/services/tauri/audio/*`.
- Added `player-transport` public API entrypoint under `apps/desktop/src/features/player-transport/api/*`.
- Added `audio-output` API wrapper boundary so shell output-mode UI reads a dedicated controller surface instead of transport internals.
- Switched shell composition imports to consume transport and output controllers via module API boundaries.
- Extracted output-mode runtime behavior from transport into `features/audio-output/hooks/useAudioOutputRuntimeState.ts`.
- Moved transport runtime ownership from legacy player hook path into `features/player-transport/hooks/usePlayerTransportRuntimeState.ts` and kept a compatibility shim at `features/player/hooks/usePlayerTransportState.ts`.
- Added first-wave import guardrails to prevent feature-level imports from `services/tauri/tauri-api` internals.

## Scope in continuation pass

- Split `usePlayerTransportRuntimeState` into focused internal runtime slices:
  - `useTransportQueueLifecycle`
  - `useTransportPolling`
  - `useTransportPlaybackActions`
  - shared runtime types in `playerTransportTypes.ts`
- Added non-audio domain bridge barrels under `services/tauri`:
  - `catalog/*`
  - `qc/*`
  - `publisher/*`
  - `dialog/*`
  - `core/*`
- Rewired `services/tauri/tauriClient.ts` so non-audio exports/types route through domain bridge modules.

## Scope in implementation-ownership pass

- Replaced bridge wrapper re-exports with owned implementations in all first-wave Tauri bridge domains (`core/audio/catalog/qc/publisher/dialog`).
- Converted `tauri-api.ts` to a compatibility export surface instead of a shared implementation host.
- Introduced backend service facade `commands/backend_audio_service.rs` and routed playback command handlers through it.

## Scope in current pass (backend runtime submodule split)

- Split backend runtime ownership into dedicated files under `backend_audio_service/runtime/*`:
  - `control_plane.rs` (transport/device lifecycle and queue control plane)
  - `decode.rs` (decode/SRC/format-boundary helpers)
  - `render.rs` (WASAPI engine/bootstrap/render-buffer writing)
  - `status.rs` (WASAPI status/error helpers)
- Reworked `runtime.rs` into an orchestrator/entrypoint that exports only required production surface and test-only helper exports behind `#[cfg(test)]`.
- Removed playback runtime helper block from `commands.rs` and kept command routing stable through `commands/playback.rs -> commands/backend_audio_service.rs`.
- Repaired extraction fallout from initial split:
  - corrected `decode.rs` struct initializer visibility syntax drift
  - cleaned duplicate derives
  - aligned test-only import/re-export boundaries to satisfy `#![deny(warnings)]`

## Files added

- `apps/desktop/src/services/tauri/core/validation.ts`
- `apps/desktop/src-tauri/src/commands/backend_audio_service.rs`
- `apps/desktop/src-tauri/src/commands/backend_audio_service/runtime.rs`
- `apps/desktop/src-tauri/src/commands/backend_audio_service/runtime/control_plane.rs`
- `apps/desktop/src-tauri/src/commands/backend_audio_service/runtime/decode.rs`
- `apps/desktop/src-tauri/src/commands/backend_audio_service/runtime/render.rs`
- `apps/desktop/src-tauri/src/commands/backend_audio_service/runtime/status.rs`

## Files changed (current pass highlights)

- `apps/desktop/src-tauri/src/commands.rs`
- `apps/desktop/src-tauri/src/commands/playback.rs`
- `apps/desktop/src-tauri/src/commands/backend_audio_service.rs`
- `apps/desktop/src-tauri/src/commands/backend_audio_service/runtime.rs`
- `apps/desktop/src-tauri/src/commands/backend_audio_service/runtime/decode.rs`
- `apps/desktop/src-tauri/src/commands/backend_audio_service/runtime/status.rs`
- `apps/desktop/src/features/player-transport/hooks/useTransportQueueLifecycle.ts`
- `apps/desktop/src/services/tauri/core/commands.ts`
- `apps/desktop/src/services/tauri/core/types.ts`
- `apps/desktop/src/services/tauri/core/index.ts`
- `apps/desktop/src/services/tauri/audio/commands.ts`
- `apps/desktop/src/services/tauri/audio/types.ts`
- `apps/desktop/src/services/tauri/audio/mappers.ts`
- `apps/desktop/src/services/tauri/audio/index.ts`
- `apps/desktop/src/services/tauri/catalog/commands.ts`
- `apps/desktop/src/services/tauri/catalog/types.ts`
- `apps/desktop/src/services/tauri/catalog/index.ts`
- `apps/desktop/src/services/tauri/qc/commands.ts`
- `apps/desktop/src/services/tauri/qc/types.ts`
- `apps/desktop/src/services/tauri/qc/index.ts`
- `apps/desktop/src/services/tauri/publisher/commands.ts`
- `apps/desktop/src/services/tauri/publisher/types.ts`
- `apps/desktop/src/services/tauri/publisher/index.ts`
- `apps/desktop/src/services/tauri/dialog/commands.ts`
- `apps/desktop/src/services/tauri/tauri-api.ts`
- `apps/desktop/src/services/tauri/tauriClient.ts`

## Decisions

- Kept extraction incremental: first service facade, then runtime block move, then runtime submodule split.
- Preserved command API stability: `commands/playback.rs` remains Tauri command boundary while service/runtime ownership moved behind it.
- Preserved compatibility surfaces (`tauri-api.ts`, transport hook shim) to keep first-wave changes reversible and testable.

## Deferred to next pass

- Continue domain slicing of remaining non-playback `commands.rs` internals.
- Introduce Rust-module-level import policy checks to prevent future command-layer logic creep.
- Remove frontend compatibility shims after downstream imports are fully migrated to module entrypoints.

## Validation for this pass

- Command: `corepack pnpm typecheck` -> pass
- Command: `corepack pnpm lint` -> pass
- Command: `corepack pnpm --filter @release-publisher/desktop test -- --run` -> pass
- Command: `corepack pnpm build` -> pass
- Command: `cargo check -p release-publisher-desktop --lib` -> pass
- Command: `cargo test -p release-publisher-desktop --lib` -> pass

## Scope in follow-up step-pair pass (1 and 2)

- Continued non-playback `commands.rs` slicing by moving release-domain `CommandService` methods into `apps/desktop/src-tauri/src/commands/release.rs`.
- Enforced backend runtime boundary statically by making `backend_audio_service::runtime` private and exposing only test helpers through `#[cfg(test)]` re-exports in `backend_audio_service.rs`.
- Updated `commands.rs` test imports to consume test helpers via `backend_audio_service` instead of direct runtime access.

## Files changed (follow-up step-pair)

- `apps/desktop/src-tauri/src/commands.rs`
- `apps/desktop/src-tauri/src/commands/release.rs`
- `apps/desktop/src-tauri/src/commands/backend_audio_service.rs`
- `docs/validation/BOUNDARY_VALIDATION_REPORT.md`

## Deferred after follow-up step-pair

- Optional: continue slicing remaining non-playback helper internals (catalog/qc/release utility blocks) from `commands.rs` into domain files.
- Remove stale historical notes in this log that still mention compatibility surfaces already retired.

## Validation for follow-up step-pair

- Command: `cargo check -p release-publisher-desktop --lib` -> pass
- Command: `cargo test -p release-publisher-desktop --lib` -> pass (`86` passed)
