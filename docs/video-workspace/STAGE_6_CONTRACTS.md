# STAGE_6_CONTRACTS

## Stage

- Stage: 6 (Output preset and render request construction)
- Status: Active contract for Stage 6 implementation

## Contract S6-C001: Output preset catalog ownership

Provider:
- `features/video-workspace/model/videoOutputPresets.ts`

Consumer:
- `features/video-workspace/hooks/useVideoWorkspaceOutputSettings.ts`
- `features/video-workspace/model/videoRenderRequest.ts`
- `features/video-workspace/VideoWorkspaceFeature.tsx`

Purpose:
- Provide deterministic YouTube-focused output presets for MVP render-request assembly.

Required presets:
- `youtube_1080p_standard`
- `youtube_1440p_standard`
- `youtube_1080p_audio_priority`

Rules:
- Preset definitions are immutable constants.
- Preset lookup by ID must be deterministic.
- Primary UI exposes preset selection only (no free-form codec editing in Stage 6).

## Contract S6-C002: Output settings model and validation

Provider:
- `features/video-workspace/model/videoOutputSettings.ts`

Purpose:
- Own bounded output settings and deterministic normalization.

Settings shape:

```ts
type VideoOutputSettings = {
  presetId: VideoOutputPresetId;
  outputDirectoryPath: string;
  outputBaseFileName: string;
  overwritePolicy: "disallow" | "replace";
};
```

Rules:
- `outputDirectoryPath` must be non-empty after trim for preflight pass.
- `outputBaseFileName` must be filesystem-safe and length-bounded.
- Output file preview is derived and deterministic: `directory + separator + base + ".mp4"`.

## Contract S6-C003: Render preflight and request builder contract

Provider:
- `features/video-workspace/model/videoRenderRequest.ts`

Purpose:
- Build a deterministic serializable render request object without invoking backend rendering.

Input sources:
- media selection state (image/audio metadata)
- visual fit mode
- overlay settings
- text settings
- output settings + resolved preset

Result contract:

```ts
type VideoRenderRequestBuildResult =
  | { ok: true; request: VideoRenderRequest }
  | { ok: false; issues: VideoRenderPreflightIssue[] };
```

Rules:
- Missing required media produces typed issues (`MISSING_IMAGE`, `MISSING_AUDIO`).
- Invalid output directory/file name produces typed issues.
- Unknown preset produces typed issue (`PRESET_NOT_FOUND`).
- Request object must be deterministic for same input snapshot.
- Request serialization must be stable via explicit field ordering.

## Contract S6-C004: UI integration behavior

Provider:
- `features/video-workspace/VideoWorkspaceFeature.tsx`

Rules:
- Output section allows preset selection, output directory input, base filename input, overwrite policy.
- Output section shows resolved output file preview path.
- Render section supports preflight/build action only (no backend invoke yet).
- Render section shows either typed validation issues or built request summary/JSON preview.

## Contract S6-C005: Boundary discipline

Allowed:
- `video-workspace/*` -> module-local models/hooks
- `video-workspace/*` -> `video-composition/api`
- `video-workspace/*` -> `overlay-engine/api`

Forbidden:
- no backend invoke for Stage 6 render build
- no direct `@tauri-apps/api/*` usage in Stage 6 additions
- no coupling to `player-transport`/`audio-output`

## Contract S6-C006: Required tests

Must pass:
- preset selection model behavior
- output settings normalization and validation
- render preflight missing-input validation
- output path/filename validation
- deterministic render request generation (contract/snapshot)
- feature test for Output/Render section flow
