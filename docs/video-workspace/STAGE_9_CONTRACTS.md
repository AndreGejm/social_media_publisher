# STAGE_9_CONTRACTS

## Stage

- Stage: 9 (Progress, cancellation, and completion UX)
- Status: Active contract for Stage 9 implementation

## Contract S9-C001: Render lifecycle UI ownership

Provider:
- `apps/desktop/src/features/video-workspace/hooks/useVideoWorkspaceRenderController.ts`
- `apps/desktop/src/features/video-workspace/VideoWorkspaceFeature.tsx`

Purpose:
- Keep render lifecycle orchestration inside `video-workspace` and expose deterministic phase/status to UI.

Rules:
- UI consumes `phase`, `progress`, `result`, and `errorMessage` from controller state.
- UI does not fabricate render terminal outcomes.
- Backend result remains source of truth for success/failure payloads.

## Contract S9-C002: Deterministic preflight + render start contract

Provider:
- `videoRenderRequest` model + render controller

Rules:
- Render start always runs preflight first.
- Preflight blocks start for missing media, missing filesystem paths, and invalid output settings.
- Request payload excludes preview-only overlay fields.

## Contract S9-C003: Typed IPC lifecycle contract

Provider:
- `services/tauri/video/*` via `services/tauri/tauriClient.ts`

Rules:
- `videoRenderStart` returns job identity and initial state.
- `videoRenderStatus` drives running/finalizing updates.
- `videoRenderResult` resolves terminal success/failure payload.
- `videoRenderCancel` is only callable when active job id exists.

## Contract S9-C004: Polling and terminal transition contract

Provider:
- `useVideoWorkspaceRenderController`

Rules:
- Polling is serialized (`pollInFlightRef`) and token-scoped (`runTokenRef`) to avoid stale updates.
- Terminal status (`succeeded`/`failed`/`canceled`) stops polling and triggers result fetch.
- No polling interval is started after an immediate terminal status.

## Contract S9-C005: Error handling contract

Provider:
- render controller + UI panel

Rules:
- Backend and adapter errors map to a single user-visible render error message.
- Failure state is explicit (`phase=failed`) and does not crash preview/media state.
- Cancel request errors are surfaced without mutating unrelated workspace state.

## Contract S9-C006: Boundary discipline

Allowed:
- `video-workspace` -> `services/tauri/tauriClient` public video adapter calls
- `video-workspace` -> `videoRenderRequest` model for request generation

Forbidden:
- no raw `@tauri-apps/api/*` imports in `video-workspace`
- no backend lifecycle logic in shell/app composition
- no backend status inference from frontend-only heuristics

## Contract S9-C007: Required tests

Must pass:
- `src/features/video-workspace/model/videoRenderRequest.test.ts`
  - source-path preflight checks
  - deterministic request build
  - preview-only field exclusion from render payload
- `src/features/video-workspace/VideoWorkspaceFeature.test.tsx`
  - render success status and summary
  - render start failure surfacing
  - cancel request dispatch while active
- workspace gates:
  - `typecheck`
  - `lint --max-warnings=0`
  - boundary checks
  - desktop tests
  - desktop build
  - Rust `video_render` test target
