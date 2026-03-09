# STAGE_4_REPORT

## Goal

Add a bounded, intentionally limited text layer to Video Workspace so users can apply optional title/artist text with preset layouts and see live preview updates.

## Changes made

Added pure text layout preset model in `video-composition`:
- `apps/desktop/src/features/video-composition/model/videoTextLayout.ts`
- `apps/desktop/src/features/video-composition/model/videoTextLayout.test.ts`
- updated `apps/desktop/src/features/video-composition/api/index.ts`
- updated `apps/desktop/src/features/video-composition/index.ts`

Added text settings model with bounds and serialization:
- `apps/desktop/src/features/video-workspace/model/videoWorkspaceTextSettings.ts`
- `apps/desktop/src/features/video-workspace/model/videoWorkspaceTextSettings.test.ts`

Added text settings state hook:
- `apps/desktop/src/features/video-workspace/hooks/useVideoWorkspaceTextSettings.ts`

Updated Stage 4 UI and live preview rendering:
- `apps/desktop/src/features/video-workspace/VideoWorkspaceFeature.tsx`
  - Text section controls: enable toggle, layout preset, title, artist, size, color, reset
  - live preview text overlay with preset-specific layout behavior

Updated styles for text controls and overlay:
- `apps/desktop/src/styles.css`

Added Stage 4 contract artifact:
- `docs/video-workspace/STAGE_4_CONTRACTS.md`

## Public contracts added or changed

Added:
- `S4-C001`: text layout preset ownership (`video-composition`)
- `S4-C002`: text settings bounds + serialization contract
- `S4-C003`: live preview text rendering behavior contract
- `S4-C004`: boundary discipline contract
- `S4-C005`: required Stage 4 test contract

Changed:
- `VideoWorkspaceFeature` now composes text settings and preview overlay behaviors within `video-workspace` only.

## Tests added

New tests:
- `apps/desktop/src/features/video-composition/model/videoTextLayout.test.ts`
- `apps/desktop/src/features/video-workspace/model/videoWorkspaceTextSettings.test.ts`

Expanded tests:
- `apps/desktop/src/features/video-workspace/VideoWorkspaceFeature.test.tsx`
  - text enabled/disabled behavior
  - preset layout application and artist visibility behavior
  - existing Stage 3 preview controls retained

## Validation performed

Commands run:
- `corepack pnpm --filter @release-publisher/desktop test -- --run src/features/video-composition/model/videoPreviewFitMode.test.ts src/features/video-composition/model/videoTextLayout.test.ts src/features/video-workspace/model/videoWorkspaceProjectState.test.ts src/features/video-workspace/model/videoWorkspaceTextSettings.test.ts src/features/video-workspace/VideoWorkspaceFeature.test.tsx`
- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm check:boundaries`
- `corepack pnpm --filter @release-publisher/desktop test -- --run`

Result:
- all commands passed.

Note:
- full test run prints existing jsdom `HTMLMediaElement.load` not-implemented warnings from non-video-workspace tests, but test outcomes are passing.

## What was deferred

Deferred intentionally to later stages:
- reactive overlay engine
- output preset and render request construction
- backend video render service and IPC contract
- render progress/cancellation UX
- persistence and preset save/load

## Known limitations

- Text layer remains intentionally narrow (preset-based only, no advanced typography system).
- Preview text behavior is UI-level only; final render parity work belongs to Stage 6+ with render intent mapping.

## Risks before next stage

1. Preview/render parity risk:
- text settings must be mapped one-to-one into render intent fields in Stage 6.

2. Scope creep risk:
- adding many text controls would degrade bounded-module simplicity; keep current control set constrained.

3. Contract drift risk:
- if additional text presets are introduced later, update `video-composition` preset contracts and tests first.

## Next stage prerequisites

- Define Stage 5 overlay-engine contract before implementation.
- Keep text and overlay concerns separate (no mixed model ownership).
- Preserve `video-workspace` isolation from global transport and output modules.
