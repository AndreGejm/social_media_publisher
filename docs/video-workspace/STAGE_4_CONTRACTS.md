# STAGE_4_CONTRACTS

## Stage

- Stage: 4 (Simple text layer)
- Status: Active contract for Stage 4 implementation

## Contract S4-C001: Text layout preset ownership

Provider:
- `features/video-composition/api/index.ts`

Consumer:
- `features/video-workspace/VideoWorkspaceFeature.tsx`
- `features/video-workspace/model/videoWorkspaceTextSettings.ts`

Purpose:
- Define bounded text layout presets and their rendering semantics for preview.

API:

```ts
type VideoTextLayoutPresetId =
  | "none"
  | "title_bottom_center"
  | "title_artist_bottom_left"
  | "title_artist_center_stack";

type VideoTextLayoutPreset = {
  id: VideoTextLayoutPresetId;
  label: string;
  description: string;
  overlayClassName:
    | "layout-none"
    | "layout-title-bottom-center"
    | "layout-title-artist-bottom-left"
    | "layout-title-artist-center-stack";
  supportsArtist: boolean;
};
```

Rules:
- Preset ordering is deterministic.
- `supportsArtist` governs whether artist text may render in preview.
- `none` disables text rendering regardless of text values.

## Contract S4-C002: Text settings model and bounds

Provider:
- `features/video-workspace/model/videoWorkspaceTextSettings.ts`

Consumer:
- `features/video-workspace/hooks/useVideoWorkspaceTextSettings.ts`
- Stage 4 UI in `VideoWorkspaceFeature`

Purpose:
- Provide deterministic text settings with sanitization, bounds, and serialization.

Settings shape:

```ts
type VideoWorkspaceTextSettings = {
  enabled: boolean;
  preset: VideoTextLayoutPresetId;
  titleText: string;
  artistText: string;
  fontSizePx: number;
  colorHex: string;
};
```

Bounds:
- `titleText.length <= 120`
- `artistText.length <= 120`
- `18 <= fontSizePx <= 72`
- `colorHex` must match `#RRGGBB`

Rules:
- Incoming text is sanitized for control characters.
- Font size and color are normalized at patch time.
- Snapshot parsing falls back to defaults on invalid schema/payload.

## Contract S4-C003: Live preview text rendering behavior

Provider:
- `features/video-workspace/VideoWorkspaceFeature.tsx`

Purpose:
- Ensure text controls update preview immediately without transport coupling.

Rules:
- Text overlay renders only when:
  - text layer is enabled,
  - preset is not `none`,
  - title or supported artist text is non-empty.
- Artist line renders only when preset `supportsArtist === true`.
- Text styling is bounded to limited controls (`fontSizePx`, `colorHex`).

## Contract S4-C004: Text layer boundary discipline

Allowed dependencies:
- `video-workspace` -> `video-composition/api`
- `video-workspace` -> React primitives + module-local models/hooks

Forbidden dependencies:
- `video-workspace` -> `player-transport/*`
- `video-workspace` -> `audio-output/*`
- `video-workspace` -> direct `@tauri-apps/api/*`

Validation expectations:
- boundary checks pass after Stage 4 changes
- text layer tests verify enable/disable and preset rendering behavior

## Contract S4-C005: Stage 4 required tests

Must pass:
- text enabled/disabled preview behavior
- preset layout application behavior
- text settings bounds/validation model tests
- text settings snapshot serialization/hydration tests
- existing Stage 3 preview control tests (regression guard)
