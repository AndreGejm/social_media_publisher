# Import Policy

Date: 2026-03-09
Status: Active (first-wave)

## Policy Summary

All module consumers import from public entrypoints. Deep/internal imports are disallowed unless explicitly marked as temporary migration exceptions.

## Approved Public Entrypoints

- `apps/desktop/src/features/player-transport/api/index.ts`
- `apps/desktop/src/features/audio-output/api/index.ts`
- `apps/desktop/src/services/tauri/audio/index.ts`
- `apps/desktop/src/services/tauri/tauriClient.ts`

## Frontend Import Rules

1. `app/shell/*` imports feature modules via `*/api` entrypoints when available.
2. Feature modules must not import from another feature's internal `hooks/*`, `components/*`, or `services/*` paths.
3. Audio IPC access must go through `services/tauri/audio/*` (directly) or `services/tauri/tauriClient` (aggregated client API).
4. Raw `@tauri-apps/api` usage is restricted to service adapter modules.

## Backend Import Rules

1. Frontend code imports backend capabilities only through Tauri command adapters.
2. Command handlers are the boundary for frontend/backend integration and should delegate runtime logic to service ownership areas.
3. Command-layer modules must not import `backend_audio_service::runtime` directly.

## Forbidden Imports

- `**/services/tauri/tauri-api`
- `**/services/tauri/tauri-api.ts`
- `**/commands/backend_audio_service/runtime`

outside their owning modules.

## Enforced Rules (Current)

- `apps/desktop/eslint.config.js` includes `no-restricted-imports` to block forbidden frontend Tauri adapter imports.
- Rust module visibility enforces runtime encapsulation (`commands/backend_audio_service.rs` uses private `mod runtime;`).

## Migration Exceptions

- None.

## Reviewer Checklist

- Is the import path a module public API?
- Does it bypass an existing adapter boundary?
- Does it create bidirectional module coupling?
- Is there a documented exception with removal plan?
