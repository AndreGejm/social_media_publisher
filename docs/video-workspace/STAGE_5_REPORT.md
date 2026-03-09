# STAGE_5_REPORT

## Goal

Add one restrained reactive overlay style (`waveform_strip`) with deterministic analysis and bounded controls, while keeping overlay logic modular and isolated from transport/output modules.

## Changes made

Added new bounded `overlay-engine` module:
- `apps/desktop/src/features/overlay-engine/model/waveformStrip.ts`
- `apps/desktop/src/features/overlay-engine/model/waveformStrip.test.ts`
- `apps/desktop/src/features/overlay-engine/api/index.ts`
- `apps/desktop/src/features/overlay-engine/index.ts`

Added Stage 5 overlay integration hook in `video-workspace`:
- `apps/desktop/src/features/video-workspace/hooks/useVideoWorkspaceOverlayController.ts`
- `apps/desktop/src/features/video-workspace/hooks/useVideoWorkspaceOverlayController.test.ts`

Updated workspace UI for overlay controls + preview rendering:
- `apps/desktop/src/features/video-workspace/VideoWorkspaceFeature.tsx`
- `apps/desktop/src/features/video-workspace/VideoWorkspaceFeature.test.tsx`
- `apps/desktop/src/styles.css`

Added Stage 5 contract artifact:
- `docs/video-workspace/STAGE_5_CONTRACTS.md`

## Public contracts added or changed

Added:
- `S5-C001`: `overlay-engine` ownership for `waveform_strip`
- `S5-C002`: bounded overlay settings contract
- `S5-C003`: deterministic WAV envelope analysis contract
- `S5-C004`: deterministic bar derivation contract
- `S5-C005`: latest-request-wins async analysis behavior
- `S5-C006`: boundary discipline contract
- `S5-C007`: required test contract

Changed:
- `VideoWorkspaceFeature` now composes overlay status/controls through `useVideoWorkspaceOverlayController` only.

## Tests added

New tests:
- `apps/desktop/src/features/overlay-engine/model/waveformStrip.test.ts`
  - default safety
  - settings normalization bounds
  - deterministic analysis
  - deterministic bar derivation

- `apps/desktop/src/features/video-workspace/hooks/useVideoWorkspaceOverlayController.test.ts`
  - stale async completion ignored after source switch
  - default disabled/no-bars behavior

Expanded tests:
- `apps/desktop/src/features/video-workspace/VideoWorkspaceFeature.test.tsx`
  - Stage 5 shell and controls
  - overlay on/off and parameter update behavior
  - existing Stage 1-4 behavior retained

## Validation performed

Commands run:
- `corepack pnpm --filter @release-publisher/desktop test -- --run src/features/overlay-engine/model/waveformStrip.test.ts src/features/video-workspace/hooks/useVideoWorkspaceOverlayController.test.ts src/features/video-workspace/VideoWorkspaceFeature.test.tsx`
- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm check:boundaries`
- `corepack pnpm --filter @release-publisher/desktop test -- --run`

Result:
- all commands passed.

Note:
- full test run still prints existing jsdom `HTMLMediaElement.load` not-implemented warnings in unrelated test paths; test outcomes remain passing.

## What was deferred

Deferred intentionally to later stages:
- output preset and render request construction
- backend video-render service + IPC
- real MP4 rendering pipeline
- progress/cancel render UX
- persistence/preset save-load

## Known limitations

- Overlay analysis is currently WAV-focused (MVP media scope already constrained to WAV).
- Overlay integration test accepts non-loading terminal state in jsdom because File/Blob behavior may vary in test runtime; deterministic analysis itself is enforced by unit tests.

## Risks before next stage

1. Preview/render parity risk:
- overlay settings must map one-to-one into Stage 6 render intent.

2. Scope creep risk:
- adding multiple overlay styles too early can weaken module clarity; keep Stage 5 at one style.

3. Performance drift risk:
- future overlay additions must preserve single-pass analysis per source and avoid re-analysis on control tweaks.

## Next stage prerequisites

- Define Stage 6 contracts for output presets and render request schema before implementation.
- Keep `video-workspace` orchestration thin and continue consuming `overlay-engine` through public API only.
