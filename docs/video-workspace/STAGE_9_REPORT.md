# STAGE_9_REPORT

## Goal

Harden the Video Workspace render UX around real Stage 8 backend rendering: deterministic start/progress/cancel/result behavior, clear terminal messaging, and safe error handling.

## Changes made

Added Stage 9 contract artifact:
- `docs/video-workspace/STAGE_9_CONTRACTS.md`

Updated Video Workspace render lifecycle orchestration:
- `apps/desktop/src/features/video-workspace/hooks/useVideoWorkspaceRenderController.ts`
  - added typed lifecycle state model (`idle`, `preflight_invalid`, `starting`, `running`, `finalizing`, `succeeded`, `failed`, `canceled`)
  - added preflight-driven render start path
  - added status polling + terminal result fetch
  - added cancel and reset flows
  - added stale-update protection and polling serialization
  - fixed terminal polling behavior to avoid restarting interval after immediate terminal status

Updated Video Workspace render and media model integration:
- `apps/desktop/src/features/video-workspace/VideoWorkspaceFeature.tsx`
  - wired render panel to controller lifecycle state
  - added runtime status display, preflight issue list, error surface, and success summary
  - added actions: Build Render Request, Render MP4, Cancel Render, Reset
- `apps/desktop/src/features/video-workspace/model/videoWorkspaceProjectState.ts`
  - media assets now track `sourcePath` for backend render path handoff
- `apps/desktop/src/features/video-workspace/model/videoRenderRequest.ts`
  - preflight validates media source-path availability
  - render request uses filesystem source paths
  - request composition strips preview-only overlay fields (e.g. `barCount`)

Updated and expanded frontend tests:
- `apps/desktop/src/features/video-workspace/model/videoRenderRequest.test.ts`
- `apps/desktop/src/features/video-workspace/VideoWorkspaceFeature.test.tsx`
  - added Stage 9 lifecycle tests with typed tauri render mocks

## Public contracts added or changed

Added:
- `S9-C001` render lifecycle UI ownership contract
- `S9-C002` deterministic preflight + render start contract
- `S9-C003` typed IPC lifecycle contract
- `S9-C004` polling and terminal transition contract
- `S9-C005` error handling contract
- `S9-C006` boundary discipline contract
- `S9-C007` required test/validation contract

Changed:
- render payload overlay contract now excludes preview-only fields.
- media import model now includes optional filesystem source provenance for backend render.

## Tests added

- `videoRenderRequest` model tests now include source-path failure and overlay payload-shape checks.
- `VideoWorkspaceFeature` tests now include:
  - success terminal lifecycle UI
  - backend start failure UI
  - cancel dispatch during active render

## Validation performed

Commands run:
- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm --filter @release-publisher/desktop test -- --run src/features/video-workspace`
- `corepack pnpm check:boundaries`
- `corepack pnpm test`
- `corepack pnpm build`
- `cargo test -p release-publisher-desktop --lib video_render`

Result:
- all commands passed.

Notes:
- `corepack pnpm test -- --run ...` from root failed due argument placement; the corrected filtered command above passed.
- full test run still logs existing jsdom `HTMLMediaElement.prototype.load` warnings from non-video tests; suite outcome is passing.

## What was deferred

Deferred to later stage:
- explicit "open output folder" action wiring in render completion panel
- persisted render history list

## Known limitations

- media source paths rely on runtime-provided file path metadata; re-selection is required when path is unavailable.
- render completion UX reports backend result faithfully but does not yet provide direct folder-open action.

## Risks before next stage

1. Source-path provenance risk:
- if platform/runtime file objects omit local path metadata, render preflight blocks and requires alternate path capture flow.

2. UX polish risk:
- completion affordances (open folder, recent renders) remain deferred and should be handled before broad rollout.

3. Preview/render parity risk:
- Stage 10 persistence and presets must preserve exact request-shape parity to avoid drift.

## Next stage prerequisites

- define persistence schema/versioning for project state and presets.
- finalize recent-folder/last-preset storage boundaries.
- keep render lifecycle contract unchanged while adding persistence affordances.
