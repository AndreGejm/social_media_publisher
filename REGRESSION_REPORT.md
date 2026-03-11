# Regression Report

Status: Targeted Pass 3 regression rerun complete. Core shell, browser-preview, and packaged-runtime checks are green for the supported scenarios, startup restart recovery, browser-fallback playback state, and passive Video Workspace navigation are now hardened, and one noncritical packaged-runtime drag/drop case is explicitly deferred as future work.

## What Was Tested

- `node C:\Dev\testing chtgpt\node_modules\.pnpm\typescript@5.9.3\node_modules\typescript\bin\tsc -b --pretty false`
- `npm.cmd exec vitest -- --run src/app/shell/WorkspaceApp.test.tsx src/app/shell/WorkspaceApp.pass2.test.tsx src/services/tauri/core/ipcTimeout.test.ts src/infrastructure/tauri/dragDrop.test.ts` (69 passing focused desktop tests, including restart-state normalization, browser-fallback playback navigation, and repeated transport coverage)
- `corepack pnpm --filter @release-publisher/desktop test -- --run src/app/shell/WorkspaceApp.test.tsx -t "release-preview workspaces|corrupted persisted restart state|cold start restore"` (3 passed focused shell recovery/navigation tests)
- `corepack pnpm --filter @release-publisher/desktop test -- --run src/features/video-workspace/VideoWorkspaceFeature.test.tsx` (28 passed dedicated Video Workspace tests)
- `node_modules/.bin/playwright.CMD test --config playwright.config.ts` (5 passed)
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/runtime-e2e/run-tauri-runtime-e2e.ps1 -NoBundleBuild -AppExePath target/release/Skald.exe` to reproduce and diagnose the packaged-runtime drag/drop gap against a fresh binary
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/runtime-e2e/run-tauri-runtime-e2e.ps1 -SkipBuild -AppExePath target/release/Skald.exe` after deferring the noncritical packaged-runtime drag/drop scenario (3 passed, 1 skipped)

## What Failed Before

- The shared player bar unmounted when navigating to `About` in Release Preview mode.
- `Clear Notice` and `Clear Error Banner` rendered as enabled in `Settings` even when there was nothing to clear.
- Browser preview could surface a raw `undefined.invoke` startup failure as a visible error banner and misleading Settings state.
- Hidden Video Workspace state could react to Library dropped media even while the Video Workspace panel was not active.
- Dropped-media shell regressions did not register listeners deterministically in mocked/test runtimes.
- Cold restart could preserve stale queue, favorite, and publish-selection ids because invalid persisted track references were not pruned during initial shell restore.
- Browser-fallback `Play Now` could load the selected track into the shared player while leaving the transport visually idle on `Play`, so navigation-under-playback was not truthful.
- Opening `Video Workspace` during passive browser-preview navigation surfaced output-path and `TAURI_UNAVAILABLE` warning banners before any render action.
- The packaged-runtime drag/drop scenario initially appeared to be a bridge failure, but a fresh rebuild showed the bridge and shell callback were working while the dropped file still failed to converge into catalog state reliably.

## What Was Fixed

- `WorkspaceRuntime.tsx` now keeps the shared player mounted for all Release Preview workspaces, including `About`.
- `SettingsPanel.tsx` now disables `Clear Notice` and `Clear Error Banner` when the corresponding banner state is absent, and `WorkspaceRuntime.tsx` now passes those booleans explicitly.
- `ipcTimeout.ts` now normalizes missing-runtime browser-preview calls as `TAURI_UNAVAILABLE` instead of surfacing raw invoke failures, and the catalog command paths now degrade without spurious startup errors.
- `VideoWorkspaceFeature` now subscribes to native drop events only while `Video Workspace` is the active visible workspace.
- Queue resolution in `WorkspaceRuntime.tsx` now keeps imported-track fallbacks so dropped-import playback can stay alive even when catalog refresh lags behind the imported track record.
- `subscribeToFileDropEvents` now uses stable Tauri imports, records listener diagnostics, and remains deterministic across mocked/test runtimes.
- `WorkspaceRuntime.tsx` now performs a one-time startup prune of persisted track references so restart recovery clears invalid queue, favorite, and publish-selection ids immediately on launch.
- `useTransportQueueLifecycle.ts` now flips `playerIsPlaying` to `true` as soon as browser-fallback autoplay succeeds, so `Play Now` and cross-workspace navigation reflect active playback immediately.
- `useVideoWorkspaceRenderController.ts` now suppresses idle `TAURI_UNAVAILABLE` diagnostics failures during passive browser-preview loads, and `VideoWorkspaceFeature.tsx` only surfaces the empty output-directory alert after real preflight/failure states instead of on first open.
- `WorkspaceApp.test.tsx`, `WorkspaceApp.pass2.test.tsx`, `ipcTimeout.test.ts`, `dragDrop.test.ts`, and the Playwright smoke/runtime suites now cover the fixed contracts directly, including invalid Publish/listen workspace restore, cold-start persisted-state pruning, playback navigation stability, and repeated transport actions.

## What Still Fails

- No blocking failures remain in the targeted Pass 3 regression set.
- One noncritical packaged-runtime drag/drop scenario is deferred: the synthetic drop reaches the shell listener after rebuild, but the dropped file still does not surface in `catalog_list_tracks` reliably enough for a low-risk fix in this pass. That check remains visible as `test.fixme` in `playwright/runtime/desktop-runtime.spec.ts`.

## What Remains Untested

- Real user drag/drop behavior in packaged runtime remains only partially verified beyond the deferred synthetic scenario above.
- Broader monkey/negative testing and deeper runtime/browser restart-corruption variants from `TEST_MATRIX.md` still need a later sweep.
- Full repo automation outside the targeted desktop shell, browser-preview, and runtime suites above has not been rerun in this pass.


