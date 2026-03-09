# Shell Composition Refactor

Date: 2026-03-09
Phase: 3 (shell to composition-only)

## Target

- `app/shell` composes feature modules and passes shell context data.
- Workspace business logic lives under `features/workspace`.
- Shell must not deep-import feature internals.

## Changes Made

### 1) Ownership inversion (removed feature->shell inversion)

Before:

- `features/workspace/WorkspaceFeature.tsx` imported `app/shell/WorkspaceApp.tsx`.

After:

- `apps/desktop/src/features/workspace/WorkspaceRuntime.tsx` now owns workspace runtime behavior.
- `apps/desktop/src/features/workspace/WorkspaceFeature.tsx` is the feature entrypoint wrapper over `WorkspaceRuntime`.
- `apps/desktop/src/features/workspace/index.ts` exports `WorkspaceFeature` + shell-frame types.

### 2) Shell reduced to adapter/wrapper

- `apps/desktop/src/app/shell/WorkspaceApp.tsx` now maps shell context -> `shellFrame` prop and renders `WorkspaceFeature`.
- `apps/desktop/src/app/shell/AppShell.tsx` composes `WorkspaceFeature` via public feature entrypoint only.

### 3) Feature-runtime de-coupling from shell internals

- `WorkspaceRuntime` no longer imports `AppShellContext`.
- Shell data is passed as explicit `shellFrame` props.

## Import Boundary Outcome

Allowed shell imports in practice:

- `features/workspace` public entrypoint
- local shell context

No deep shell imports from `features/*/(hooks|model|services|components)` remain in non-test shell files.

## Size/Complexity Effect

- `app/shell/WorkspaceApp.tsx` is now 18 lines (composition wrapper).
- Workspace runtime implementation lives in feature-owned file:
  - `features/workspace/WorkspaceRuntime.tsx` (1635 lines)

## Validation

- `corepack pnpm typecheck` -> pass
- `corepack pnpm lint` -> pass
- `corepack pnpm --filter @release-publisher/desktop test -- --run` -> pass
- `scripts/check-boundaries.ps1` shell deep-import check -> pass

## Residual Note

Vitest still emits repeated React warnings about "Maximum update depth exceeded" in two workspace tests, but tests pass and behavior is unchanged. This existed as runtime warning noise and should be isolated in a dedicated stability follow-up.
