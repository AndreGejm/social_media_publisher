# Command Root Refactor

Date: 2026-03-09
Phase: 4 (thin backend command root)

## Target

Keep `commands.rs` as boundary glue and shared IPC surface, not a monolithic test/runtime owner.

## Changes Made

### Extracted inline test module

- Moved large inline `#[cfg(test)] mod tests` from:
  - `apps/desktop/src-tauri/src/commands.rs`
- Into:
  - `apps/desktop/src-tauri/src/commands/tests.rs`

`commands.rs` now references tests via:

- `#[cfg(test)] mod tests;`

### Preserved command boundary behavior

- Command handler modules remain split and unchanged:
  - `commands/playback.rs`
  - `commands/catalog.rs`
  - `commands/qc.rs`
  - `commands/release.rs`
  - `commands/backend_audio_service.rs`

## Size Reduction

- `commands.rs`: 6139 -> 3421 lines
- extracted test module: 2717 lines

This materially reduces command-root sprawl and keeps domain tests out of command boundary glue.

## Validation

- Rust backend tests:
  - `cargo test -p release-publisher-desktop --lib` -> pass (86 passed)
- Frontend build/type/tests still pass after extraction:
  - `corepack pnpm typecheck` -> pass
  - `corepack pnpm --filter @release-publisher/desktop test -- --run` -> pass
  - `corepack pnpm build` -> pass

## Remaining Follow-up (Not in this pass)

`commands.rs` still owns significant shared IPC models/constants and can be further domain-sliced in a later wave if needed. This pass focused on high-confidence thinning without changing command contracts.
