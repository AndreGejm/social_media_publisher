# Boundary Validation Report

Date: 2026-03-09
Scope: First-wave boundary extraction and enforcement (bridge implementation ownership + backend audio command/runtime boundary + runtime submodule split)

## Commands Run

1. `corepack pnpm typecheck`
2. `corepack pnpm lint`
3. `corepack pnpm --filter @release-publisher/desktop test -- --run`
4. `corepack pnpm build`
5. `cargo check -p release-publisher-desktop --lib`
6. `cargo test -p release-publisher-desktop --lib`
7. `cargo check -p release-publisher-desktop --lib` (follow-up step pair pass)
8. `cargo test -p release-publisher-desktop --lib` (follow-up step pair pass)

## Results

- `typecheck`: PASS
- `lint`: PASS
- `test` (desktop): PASS (`13` files, `127` passed, `5` skipped)
- `build`: PASS
- `cargo check` (`release-publisher-desktop` lib): PASS
- `cargo test` (`release-publisher-desktop` lib): PASS (`86` passed)

## Fixes Applied During Validation Window

- Replaced bridge wrapper modules with owned implementations across `core/audio/catalog/qc/publisher/dialog`.
- Retired `tauri-api*` compatibility shim files; frontend Tauri access now resolves through domain bridges and `tauriClient`.
- Added `commands/backend_audio_service/runtime.rs` and moved playback control-plane runtime ownership there.
- Split backend runtime internals into ownership files:
  - `runtime/control_plane.rs`
  - `runtime/decode.rs`
  - `runtime/render.rs`
  - `runtime/status.rs`
- Routed playback command handlers through `backend_audio_service` while preserving public command behavior.
- Applied runtime-split stabilization fixes:
  - corrected decode initializer visibility drift
  - cleaned duplicate derives
  - aligned test-only re-exports/imports to satisfy `#![deny(warnings)]`
  - removed stale imports

## Follow-up Step Pair Completion (1 and 2)

- Continued non-playback `commands.rs` slicing by moving release-domain `CommandService` methods into `commands/release.rs`.
  - moved: `handle_load_spec`, `handle_plan_release`, `handle_execute_release`, `handle_list_history`, `handle_get_report`, `handle_analyze_audio_file`, `handle_analyze_and_persist_release_track`, `handle_get_release_track_analysis`
- Added static Rust boundary enforcement for backend runtime internals:
  - changed `commands/backend_audio_service.rs` from `pub(crate) mod runtime;` to private `mod runtime;`
  - exposed only test helper surface via `#[cfg(test)] pub(crate) use runtime::{...}`
  - verified no remaining `backend_audio_service::runtime` imports outside module ownership

## Boundary Enforcement Checks

- No domain bridge module (`audio/catalog/qc/publisher/dialog/core`) depends on a compatibility shim; ownership is local to domain bridge modules.
- `tauri-api.ts` compatibility entrypoint has been removed.
- `commands/playback.rs` delegates playback/output operations to `backend_audio_service`.
- `PlaybackControlPlane` runtime ownership is isolated in `runtime/control_plane.rs`.
- Decode/SRC/format-boundary helpers are isolated in `runtime/decode.rs`.
- WASAPI engine/render-loop helpers are isolated in `runtime/render.rs`.
- WASAPI status/error helpers are isolated in `runtime/status.rs`.
- Runtime internals are no longer importable from command-layer siblings because `runtime` is private to `backend_audio_service`.

## Subsystem Confidence

- `tauri-audio-bridge` implementation ownership boundary: High
- `player-transport` runtime boundary after decomposition + fallback hardening: High
- `workspace shell` composition boundary: High
- `backend-audio-service` command boundary (`playback.rs` -> service facade): High
- `backend-audio-service` runtime ownership split (`control_plane/decode/render/status`): High
- `backend-audio-service` runtime privacy boundary (`runtime` private + test-only re-export): High

## Unresolved Items

1. Further domain slicing of remaining catalog/qc/release helper internals in `commands.rs` is optional follow-on cleanup and outside this step-pair completion scope.
