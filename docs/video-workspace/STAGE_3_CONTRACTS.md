# STAGE_3_CONTRACTS

## Stage

- Stage: 3 (Static composition preview)
- Status: Active contract for Stage 3 implementation

## Contract S3-C001: Fit-mode composition contract

Provider:
- `features/video-composition/api/index.ts`

Consumer:
- `features/video-workspace/VideoWorkspaceFeature.tsx`
- `features/video-workspace/hooks/useVideoWorkspacePreviewController.ts`

Purpose:
- Centralize image fit behavior in a pure composition module.

API:

```ts
type VideoPreviewFitMode = "fill_crop" | "fit_bars" | "stretch";

type VideoPreviewFitPresentation = {
  mode: VideoPreviewFitMode;
  label: string;
  description: string;
  cssObjectFit: "cover" | "contain" | "fill";
  showsBars: boolean;
};

declare function resolveVideoPreviewFitPresentation(
  mode: VideoPreviewFitMode
): VideoPreviewFitPresentation;
```

Behavior rules:
- `fill_crop` -> `cover`, no bars
- `fit_bars` -> `contain`, bars enabled
- `stretch` -> `fill`, no bars
- Option ordering is deterministic and stable.

## Contract S3-C002: Local preview transport ownership

Provider:
- `features/video-workspace/hooks/useVideoWorkspacePreviewController.ts`

Consumer:
- `features/video-workspace/VideoWorkspaceFeature.tsx`

Purpose:
- Own preview playback state and controls inside `video-workspace` only.

Behavior rules:
- Preview control path is local and does not call `player-transport`.
- Playback state transitions are deterministic: `idle -> paused -> playing -> paused` with explicit `error` terminal branch.
- `seekToRatio` is clamped to `[0, 1]` and updates `currentTime` deterministically.
- `restart` resets preview position to zero and preserves playing/paused intent.

## Contract S3-C003: Project state + runtime media handle split

Provider:
- `features/video-workspace/hooks/useVideoWorkspaceProjectState.ts`

Consumer:
- `features/video-workspace/VideoWorkspaceFeature.tsx`
- `features/video-workspace/hooks/useVideoWorkspacePreviewController.ts`

Purpose:
- Keep serializable project state separate from runtime-only file handles.

Behavior rules:
- `projectState` remains serializable and deterministic.
- `mediaFiles` stores ephemeral `File` objects for preview only.
- Import failure must not replace prior valid media files.
- Clearing image/audio clears both asset metadata and corresponding runtime file.

## Contract S3-C004: Preview lifecycle and URL resource ownership

Provider:
- `features/video-workspace/hooks/useVideoWorkspacePreviewController.ts`

Purpose:
- Ensure object URL creation/revocation is owned by one module.

Behavior rules:
- New media file selection creates new object URL.
- Replaced/removed media files revoke previous URL during cleanup.
- No object URL lifecycle handling outside preview controller.

## Contract S3-C005: Boundary discipline for Stage 3

Allowed dependencies:
- `features/video-workspace/*` -> `features/video-composition/api`
- `features/video-workspace/*` -> React primitives

Forbidden dependencies:
- `features/video-workspace/*` -> `features/player-transport/*`
- `features/video-workspace/*` -> `features/audio-output/*`
- `features/video-workspace/*` -> direct `@tauri-apps/api/*`

Validation expectations:
- `corepack pnpm check:boundaries` must pass.
- Stage 3 tests must verify preview controls and fit behavior without global transport APIs.
