# STAGE_2_CONTRACTS

## Stage

- Stage: 2 (File import and project state)
- Status: Active contract for Stage 2 implementation

## Contract S2-C001: Video project import state ownership

Provider:
- `features/video-workspace/hooks/useVideoWorkspaceProjectState`

Consumer:
- `features/video-workspace/VideoWorkspaceFeature`

Purpose:
- Provide deterministic project media state for one image and one audio asset.

State shape:

```ts
type VideoWorkspaceProjectState = {
  imageAsset: VideoWorkspaceMediaAsset | null;
  audioAsset: VideoWorkspaceMediaAsset | null;
  importIssues: VideoWorkspaceImportIssue[];
};
```

Behavior rules:
- Exactly one selected asset per media kind (`image`, `audio`).
- New import replaces prior asset of the same kind.
- Import failure never mutates previously valid asset.
- Import issues are explicit and user-displayable.

## Contract S2-C002: Supported media validation

Supported file types (Stage 2 MVP):
- image: `.jpg`, `.jpeg`, `.png`
- audio: `.wav`

Required validation outcomes:
- unsupported type -> `UNSUPPORTED_MEDIA_TYPE`
- wrong kind for target slot -> `INVALID_IMAGE_FILE` or `INVALID_AUDIO_FILE`
- empty selection -> `INVALID_IMAGE_FILE` or `INVALID_AUDIO_FILE` with explicit "No file selected" message

## Contract S2-C003: Import interaction surfaces

The module must support:
- file dialog import for image
- file dialog import for audio
- drag-and-drop import for image
- drag-and-drop import for audio

Interaction rules:
- UI action handlers delegate to the state hook only.
- Drag-over prevents browser-default navigation behavior.
- Dialog and drag-drop set `source` provenance (`file_dialog`, `drag_drop`) on accepted assets.

## Contract S2-C004: Serialization and determinism

Project snapshot contract:

```ts
type VideoWorkspaceProjectSnapshot = {
  schemaVersion: 1;
  imageAsset: VideoWorkspaceMediaAsset | null;
  audioAsset: VideoWorkspaceMediaAsset | null;
};
```

Rules:
- snapshot excludes transient UI concerns (import issues, drag UI state).
- snapshot parse failure returns empty deterministic state.
- serialization functions are pure and side-effect free.

## Contract S2-C005: Boundary enforcement

Allowed dependencies:
- `features/video-workspace/model/*`
- `features/video-workspace/hooks/*`
- React primitives
- shared helper styles only

Forbidden dependencies:
- `features/player-transport/*`
- `features/audio-output/*`
- `services/tauri/*`
- direct `@tauri-apps/api/*`

