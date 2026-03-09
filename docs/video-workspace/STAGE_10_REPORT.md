# STAGE_10_REPORT

## Goal

Add persistence and preset recall to Video Workspace after Stage 9 lifecycle stabilization, while preserving bounded-module ownership and deterministic behavior.

## Changes made

Added Stage 10 contract artifact:
- `docs/video-workspace/STAGE_10_CONTRACTS.md`

Added persistence model contracts and schema guards:
- `apps/desktop/src/features/video-workspace/model/videoWorkspacePersistence.ts`
  - versioned project document schema
  - versioned preset document schema
  - versioned preferences document schema
  - recent-output-directory normalization + dedupe helper

Added persistence orchestration hook:
- `apps/desktop/src/features/video-workspace/hooks/useVideoWorkspacePersistence.ts`
  - save/load project snapshot actions
  - save/load preset actions
  - automatic last-preset + recent-folder preference persistence
  - status messaging for persistence actions

Hardened module controllers for state hydration:
- `apps/desktop/src/features/video-workspace/hooks/useVideoWorkspaceProjectState.ts`
  - added `replaceFromSnapshot`, `createSnapshot`, `resetProjectState`
- `apps/desktop/src/features/video-workspace/hooks/useVideoWorkspaceTextSettings.ts`
  - added `replaceState`
- `apps/desktop/src/features/video-workspace/hooks/useVideoWorkspaceOutputSettings.ts`
  - added `replaceState`
- `apps/desktop/src/features/video-workspace/hooks/useVideoWorkspaceOverlayController.ts`
  - added `initialSettings` support and `replaceSettings`

Integrated persistence UI and behavior in feature shell:
- `apps/desktop/src/features/video-workspace/VideoWorkspaceFeature.tsx`
  - Stage banner updated to Stage 10
  - persistence control section added (save/load project + preset)
  - persistence status feedback added
  - recent output folders selector added to Output section

Added/updated tests:
- `apps/desktop/src/features/video-workspace/model/videoWorkspacePersistence.test.ts`
- `apps/desktop/src/features/video-workspace/VideoWorkspaceFeature.test.tsx`
  - Stage 10 shell assertions
  - project snapshot save/load behavior
  - preset save/load behavior
  - remount hydration for last preset + recent output folder

## Public contracts added or changed

Added:
- `S10-C001..S10-C008` in `STAGE_10_CONTRACTS.md`

Changed:
- video-workspace controllers now expose explicit replace/hydrate entrypoints for persistence.
- output preferences now persist automatically in module-local storage.

## Tests added

- model contract tests for persistence schema parse/create behavior
- feature tests for persistence UX and hydration behavior

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
- full test run continues to show pre-existing jsdom `HTMLMediaElement.prototype.load` warnings in non-video tests; suite result is passing.

## What was deferred

Deferred past Stage 10:
- file-based import/export of project/preset documents
- multi-slot preset management UI
- explicit "open output folder" completion action (already deferred in Stage 9)

## Known limitations

- persistence currently uses local webview storage only.
- project snapshot load restores metadata/settings and source-path references but does not hydrate in-memory `File` blobs.

## Risks before next stage

1. Storage corruption/version drift risk:
- mitigated via schema-version checks + deterministic fallback parsing.

2. Path validity risk for older snapshots:
- source paths may become stale between sessions and require re-import.

3. UX discoverability risk:
- persistence actions are explicit but minimal; future UX polish may add richer state indicators.

## Next stage prerequisites

- confirm whether next phase is product expansion (new features) or persistence UX polish.
- if expansion starts, keep Stage 10 persistence contract stable and avoid widening it into a general project management subsystem.
