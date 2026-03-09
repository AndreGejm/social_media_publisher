# Tauri Boundary Cleanup

Date: 2026-03-09
Phase: 5 (remove residual Tauri boundary leaks)

## Target

Constrain direct `@tauri-apps/api/*` usage to approved adapter/infrastructure layers.

## Changes Made

### 1) Media URL conversion boundary fixed

Tauri-specific media URL behavior moved behind infrastructure adapter:

- Added/kept Tauri-aware adapter:
  - `apps/desktop/src/infrastructure/tauri/media-url.ts`
- `shared` utility is now framework-agnostic:
  - `apps/desktop/src/shared/lib/media-url.ts`

`shared/lib/media-url.ts` no longer imports `@tauri-apps/api/*`.

### 2) Feature usage rerouted through adapter

Updated consumers to use infrastructure adapter (not shared direct Tauri calls):

- `apps/desktop/src/features/player-transport/hooks/usePlayerTransportRuntimeState.ts`
- `apps/desktop/src/features/player/QcPlayer.tsx`

## Current Direct Tauri Import Inventory

Allowed locations only:

- `apps/desktop/src/services/tauri/core/commands.ts`
- `apps/desktop/src/infrastructure/tauri/media-url.ts`
- `apps/desktop/src/infrastructure/tauri/dragDrop.ts`
- test mock usage in `apps/desktop/src/app/shell/WorkspaceApp.test.tsx`

No direct `@tauri-apps/api/*` imports remain in `features/**` or `shared/**` runtime code.

## Validation

- `scripts/check-boundaries.ps1` raw Tauri import check -> pass
- `corepack pnpm lint` -> pass
- `corepack pnpm --filter @release-publisher/desktop test -- --run` -> pass
