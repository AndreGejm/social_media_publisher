# STAGE_6_REPORT

## Goal

Implement output preset selection and deterministic render request construction (with preflight validation) for the Video Workspace MVP, without starting backend rendering yet.

## Changes made

Added Stage 6 contract artifact:
- `docs/video-workspace/STAGE_6_CONTRACTS.md`

Added output preset model and tests:
- `apps/desktop/src/features/video-workspace/model/videoOutputPresets.ts`
- `apps/desktop/src/features/video-workspace/model/videoOutputPresets.test.ts`

Added output settings model and tests:
- `apps/desktop/src/features/video-workspace/model/videoOutputSettings.ts`
- `apps/desktop/src/features/video-workspace/model/videoOutputSettings.test.ts`

Added render request builder model and tests:
- `apps/desktop/src/features/video-workspace/model/videoRenderRequest.ts`
- `apps/desktop/src/features/video-workspace/model/videoRenderRequest.test.ts`

Added output settings hook:
- `apps/desktop/src/features/video-workspace/hooks/useVideoWorkspaceOutputSettings.ts`

Updated Video Workspace Stage 6 UI composition:
- `apps/desktop/src/features/video-workspace/VideoWorkspaceFeature.tsx`
  - output preset selection
  - output path and file name inputs
  - overwrite policy selection
  - output preview path
  - build render request action
  - preflight issue rendering
  - deterministic request JSON preview

Updated Stage 6 styles:
- `apps/desktop/src/styles.css`
  - output controls block
  - render panel block
  - preflight issue list and request JSON presentation

Updated feature tests to cover Stage 6 behavior and align selectors with accessible labels:
- `apps/desktop/src/features/video-workspace/VideoWorkspaceFeature.test.tsx`

## Public contracts added or changed

Added:
- `S6-C001`: output preset catalog contract
- `S6-C002`: output settings normalization/validation contract
- `S6-C003`: render preflight and deterministic request construction contract
- `S6-C004`: render panel contract (idle / invalid / ready)
- `S6-C005`: boundary contract (no backend rendering in Stage 6)
- `S6-C006`: Stage 6 required test contract

Changed:
- `VideoWorkspaceFeature` now composes output configuration and request building through:
  - `useVideoWorkspaceOutputSettings`
  - `buildVideoRenderRequest` / `toVideoRenderRequestJson`

## Tests added

New tests:
- `apps/desktop/src/features/video-workspace/model/videoOutputPresets.test.ts`
- `apps/desktop/src/features/video-workspace/model/videoOutputSettings.test.ts`
- `apps/desktop/src/features/video-workspace/model/videoRenderRequest.test.ts`

Expanded tests:
- `apps/desktop/src/features/video-workspace/VideoWorkspaceFeature.test.tsx`
  - Stage 6 shell and output controls
  - output preset and file preview behavior
  - missing media preflight behavior
  - output directory validation behavior
  - deterministic request JSON behavior

## Validation performed

Commands run:
- `corepack pnpm --filter @release-publisher/desktop test -- --run src/features/video-workspace/model/videoOutputPresets.test.ts src/features/video-workspace/model/videoOutputSettings.test.ts src/features/video-workspace/model/videoRenderRequest.test.ts src/features/video-workspace/VideoWorkspaceFeature.test.tsx`
- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm check:boundaries`
- `corepack pnpm test`
- `corepack pnpm build`

Result:
- all commands passed.

Notes:
- one transient test failure occurred during implementation due stricter Stage 6 alert surface and button label matching; tests were updated to assert deterministic, accessible behavior and final suite is green.
- terminal consistently prints a local PowerShell profile execution-policy warning before command output; this does not affect build/test outcomes.

## What was deferred

Deferred to Stage 7+:
- backend-video-render-service skeleton
- typed IPC contracts for render start/progress/cancel/result
- real MP4 encoding path and progress runtime
- completion/cancellation UX flow

## Known limitations

- Stage 6 request build is frontend-domain only; no backend validation or rendering execution yet.
- output path validation remains intentionally lightweight (presence + filename safety) until backend preflight adds filesystem/runtime checks.

## Risks before next stage

1. Frontend/backend contract drift:
- request schema must be mirrored by Stage 7 backend contract tests before runtime wiring.

2. Preview vs render parity drift:
- fit/text/overlay fields in request must map one-to-one into backend renderer semantics.

3. Scope expansion risk:
- avoid exposing advanced codec knobs before backend service and validation are stable.

## Next stage prerequisites

- define Stage 7 IPC contracts for render lifecycle (`start`, `status/progress`, `cancel`, `result/error`) before wiring UI actions.
- implement backend request validation as source of truth and keep frontend request construction deterministic and minimal.