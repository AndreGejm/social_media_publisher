# Boundary Guardrails

Date: 2026-03-09
Phase: 6 (enforcement)

## Guardrails Added

## 1) ESLint import-boundary enforcement

Updated:

- `apps/desktop/eslint.config.js`

New/strengthened restrictions:

- forbid raw `@tauri-apps/api/*` imports outside:
  - `src/services/tauri/**`
  - `src/infrastructure/tauri/**`
- forbid `player-transport` importing `audio-output` internals.
- forbid `audio-output` importing `player-transport` internals (except public API contract path).
- forbid non-test `app/shell` files from deep-importing feature internals (`hooks/model/services/components`).

## 2) Lightweight architecture audit scripts

Added:

- `scripts/check-boundaries.ps1`
- `scripts/check-boundaries.sh`

Checks performed:

- raw Tauri API imports outside adapters
- transport/output internal cross-import leaks
- shell deep imports into feature internals

## 3) Script integration

Updated root scripts in `package.json`:

- `check:boundaries`: runs `scripts/check-boundaries.ps1`

## Validation Evidence

Executed and passing:

- `corepack pnpm lint`
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-boundaries.ps1`
- `corepack pnpm typecheck`
- `corepack pnpm --filter @release-publisher/desktop test -- --run`
- `corepack pnpm build`
- `cargo test -p release-publisher-desktop --lib`

## Remaining Risk

- Workspace tests still log repeated React "Maximum update depth exceeded" warnings under specific transport/output scenarios.
- This warning noise should be treated as a focused follow-up hardening task, even though current tests pass.
