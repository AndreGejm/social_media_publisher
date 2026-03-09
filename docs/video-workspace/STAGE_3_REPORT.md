# STAGE_3_REPORT

## Goal

Implement static composition preview for the Video Workspace with deterministic image fit modes and isolated audio preview playback controls, while preserving module boundaries.

## Changes made

Added a pure fit-mode composition module:
- `apps/desktop/src/features/video-composition/model/videoPreviewFitMode.ts`
- `apps/desktop/src/features/video-composition/model/videoPreviewFitMode.test.ts`
- `apps/desktop/src/features/video-composition/api/index.ts`
- `apps/desktop/src/features/video-composition/index.ts`

Hardened project state controller for Stage 3 runtime needs:
- `apps/desktop/src/features/video-workspace/hooks/useVideoWorkspaceProjectState.ts`
  - adds `mediaFiles` runtime handles (`imageFile`, `audioFile`) separate from serializable `projectState`

Added isolated preview runtime ownership:
- `apps/desktop/src/features/video-workspace/hooks/useVideoWorkspacePreviewController.ts`
  - owns fit mode state, object URL lifecycle, playback controls, progress sync, and error state

Wired Stage 3 UI behavior in bounded workspace module:
- `apps/desktop/src/features/video-workspace/VideoWorkspaceFeature.tsx`
  - Visual section: fit mode controls
  - Preview section: static frame rendering + local play/pause/restart/seek + status/progress

Updated styles for Stage 3 UI surfaces:
- `apps/desktop/src/styles.css`

Added Stage 2 missing report and Stage 3 contracts:
- `docs/video-workspace/STAGE_2_REPORT.md`
- `docs/video-workspace/STAGE_3_CONTRACTS.md`

## Public contracts added or changed

Added:
- `S3-C001`: fit-mode composition contract in `video-composition`
- `S3-C002`: local preview transport contract in `video-workspace`
- `S3-C003`: serializable project state + runtime file handle split
- `S3-C004`: object URL lifecycle ownership contract
- `S3-C005`: Stage 3 boundary contract

Changed:
- `useVideoWorkspaceProjectState` return surface now includes:

```ts
mediaFiles: {
  imageFile: File | null;
  audioFile: File | null;
}
```

## Tests added

- `apps/desktop/src/features/video-composition/model/videoPreviewFitMode.test.ts`
  - deterministic fit-mode mapping and ordering

- `apps/desktop/src/features/video-workspace/VideoWorkspaceFeature.test.tsx` (expanded)
  - Stage 3 shell rendering
  - fit mode updates
  - preview play/pause transitions
  - progress display and seek behavior
  - existing Stage 2 import paths retained

## Validation performed

Commands run:
- `corepack pnpm --filter @release-publisher/desktop test -- --run src/features/video-composition/model/videoPreviewFitMode.test.ts src/features/video-workspace/VideoWorkspaceFeature.test.tsx src/features/video-workspace/model/videoWorkspaceProjectState.test.ts`
- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm check:boundaries`
- `corepack pnpm --filter @release-publisher/desktop test -- --run`

Results:
- all commands passed.

## What was deferred

Deferred intentionally to Stage 4+:
- text layer editing and presets
- reactive overlay engine
- output preset and render intent assembly
- backend video render service and IPC wiring

## Known limitations

- Preview playback currently uses browser media element semantics (sufficient for Stage 3 preview only).
- Preview waveform/reactive overlay is not yet implemented.
- No persistence for visual preview settings yet.

## Risks before next stage

1. Preview/render parity risk:
- Stage 4+ must ensure text and overlay logic derive from shared composition contracts to avoid mismatch.

2. Runtime resource lifecycle risk:
- Stage 4+ additions must preserve single ownership of object URL and playback cleanup in preview controller.

3. Scope creep risk:
- keep Stage 4 text system bounded to a small preset-based model (no editor-level controls).

## Next stage prerequisites

- Define Stage 4 text-layer contract before implementation.
- Keep `video-workspace` as owner of preview orchestration.
- Continue enforcing no dependency on `player-transport` and no direct Tauri API usage.
