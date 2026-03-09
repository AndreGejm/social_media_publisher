# Module Layout And Repository Hygiene

This document is the source of truth for where new code should live.

## Top-level structure (canonical)
- `apps/`: product applications (UI + app shell)
- `crates/`: shared Rust libraries and backend/runtime services
- `scripts/`: developer and CI scripts
- `fixtures/`: deterministic test fixtures only
- `playwright/`: E2E tests only
- `documentation/`: design docs, specs, reviews
- `review/`: review artifacts and imported external findings

Everything else at repo root is treated as temporary or suspect unless explicitly approved.

## Frontend module placement (`apps/desktop/src`)
- `features/<feature-name>/`: feature UI and feature-local models
- `hooks/`: reusable cross-feature hooks (no JSX)
- `services/`: app boundaries (IPC clients, providers)
- `app/`: shell, layout, app-level state/events

When adding a new feature module:
1. Create `features/<feature-name>/`.
2. Keep feature view/components inside that folder.
3. Export only public entry points via `features/<feature-name>/index.ts`.
4. Put cross-feature state orchestration in hooks or `app/shell`, not in feature panels.

## Tauri and Rust placement
- `apps/desktop/src-tauri/src/`: Tauri runtime adapter layer only
- `crates/core/`: business/domain orchestration logic
- `crates/db/`: persistence and migrations
- `crates/connectors/*/`: platform-specific connector implementations
- `crates/testkit/`: integration test helpers

Rule: keep domain logic in `crates/core`/`crates/db`; keep `src-tauri` focused on command translation and wiring.

Command boundary convention in `src-tauri`:
- `src/commands.rs`: shared command types, validation/helpers, and re-exports
- `src/commands/release.rs`: release planning/execution command entrypoints
- `src/commands/playback.rs`: playback/device command entrypoints
- `src/commands/qc.rs`: QC preview/export command entrypoints
- `src/commands/catalog.rs`: catalog/library/publisher command entrypoints

## Cleanup and generated outputs
Generated and local scratch data must not be committed.
- Rust outputs: `target/`, `target-*`
- Test outputs: `test-results*`, `playwright-report*`
- Temporary mirrors/snapshots: `_push_workspace*`, `_tmp_*`, `.agent-tmp/`, `tmp_perm_dir/`

If generated files were previously tracked, untrack them with `git rm --cached` and keep them ignored going forward.

## Module checklist (before opening PR)
- New module has a single public `index.ts` (frontend) or `mod.rs/lib.rs` entry (Rust).
- Tests are colocated with module or in crate tests.
- No new top-level root folders were introduced.
- No generated artifacts are added to git status.
