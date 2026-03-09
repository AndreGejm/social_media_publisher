# VIDEO_WORKSPACE_DATA_MODELS

## 1. Scope

This document defines Stage 0 data contracts for the Video Workspace MVP.

Rules:
- All models are serializable.
- All model fields are explicit and typed.
- No hidden inferred state is required by consumers.

## 2. TypeScript canonical models

```ts
export type VideoProjectSchemaVersion = 1;

export type VideoImageFitMode = "fill_crop" | "fit_bars" | "stretch";

export type VideoOverlayStyle = "none" | "waveform_strip";

export type VideoTextLayoutPreset =
  | "none"
  | "title_bottom_center"
  | "title_artist_bottom_left"
  | "title_artist_center_stack";

export type VideoOutputPresetId =
  | "youtube_1080p_standard"
  | "youtube_1440p_standard"
  | "youtube_1080p_audio_priority";

export type MediaAssetKind = "image" | "audio";

export type MediaAssetRef = {
  id: string; // deterministic hash id (path + size + modified)
  kind: MediaAssetKind;
  path: string;
  fileName: string;
  extension: string;
  sizeBytes: number;
  modifiedAtUtc: string;
  durationSeconds: number | null; // null for image
  widthPx: number | null; // image only
  heightPx: number | null; // image only
  sampleRateHz: number | null; // audio only
  channels: number | null; // audio only
};

export type VideoVisualSettings = {
  imageFitMode: VideoImageFitMode;
  backgroundColorHex: string; // bars background when fit mode uses bars
};

export type VideoOverlaySettings = {
  enabled: boolean;
  style: VideoOverlayStyle;
  opacity: number; // 0.0..1.0
  intensity: number; // 0.0..1.0
  smoothing: number; // 0.0..1.0
  position: "top" | "bottom";
  themeColorHex: string;
};

export type VideoTextSettings = {
  enabled: boolean;
  preset: VideoTextLayoutPreset;
  titleText: string;
  artistText: string;
  fontFamily: "system_sans";
  fontWeight: 400 | 500 | 600 | 700;
  fontSizePx: number;
  colorHex: string;
  shadowOpacity: number; // 0.0..1.0
};

export type VideoOutputPreset = {
  id: VideoOutputPresetId;
  label: string;
  widthPx: number;
  heightPx: number;
  frameRate: 30;
  videoCodec: "h264";
  audioCodec: "aac";
  pixelFormat: "yuv420p";
  audioBitrateKbps: 192 | 256 | 320;
  videoBitrateKbps: number;
};

export type VideoOutputSettings = {
  presetId: VideoOutputPresetId;
  outputDirectoryPath: string;
  outputBaseFileName: string;
  overwritePolicy: "disallow" | "replace";
};

export type VideoProjectState = {
  schemaVersion: VideoProjectSchemaVersion;
  projectId: string;
  createdAtUtc: string;
  updatedAtUtc: string;
  imageAsset: MediaAssetRef | null;
  audioAsset: MediaAssetRef | null;
  visual: VideoVisualSettings;
  overlay: VideoOverlaySettings;
  text: VideoTextSettings;
  output: VideoOutputSettings;
};

export type VideoPreviewPlaybackState = "idle" | "loading" | "ready" | "playing" | "paused" | "error";

export type VideoPreviewState = {
  playbackState: VideoPreviewPlaybackState;
  durationSeconds: number;
  positionSeconds: number;
  bufferedSeconds: number;
  isSeeking: boolean;
  isOverlayRealtimeEnabled: boolean;
  lastError: string | null;
};

export type VideoRenderIntent = {
  requestVersion: 1;
  requestId: string;
  projectId: string;
  media: {
    imagePath: string;
    audioPath: string;
  };
  composition: {
    widthPx: number;
    heightPx: number;
    frameRate: 30;
    fitMode: VideoImageFitMode;
    backgroundColorHex: string;
    text: VideoTextSettings;
    overlay: VideoOverlaySettings;
  };
  output: {
    presetId: VideoOutputPresetId;
    outputFilePath: string;
    overwritePolicy: "disallow" | "replace";
    container: "mp4";
    videoCodec: "h264";
    audioCodec: "aac";
    pixelFormat: "yuv420p";
  };
};

export type VideoRenderIntentResult =
  | { ok: true; intent: VideoRenderIntent }
  | { ok: false; errors: VideoRenderValidationIssue[] };

export type VideoRenderValidationIssue = {
  code:
    | "MISSING_IMAGE"
    | "MISSING_AUDIO"
    | "INVALID_OUTPUT_DIRECTORY"
    | "INVALID_OUTPUT_FILENAME"
    | "UNSUPPORTED_IMAGE_TYPE"
    | "UNSUPPORTED_AUDIO_TYPE"
    | "TEXT_OUT_OF_BOUNDS"
    | "OVERLAY_OUT_OF_BOUNDS"
    | "PRESET_NOT_FOUND";
  message: string;
  field:
    | "image"
    | "audio"
    | "output.directory"
    | "output.filename"
    | "text"
    | "overlay"
    | "preset";
};

export type VideoRenderRuntimeState = {
  jobId: string | null;
  state:
    | "idle"
    | "validating"
    | "queued"
    | "running"
    | "finalizing"
    | "succeeded"
    | "failed"
    | "canceled";
  progressPercent: number;
  stageLabel: string;
  updatedAtUtc: string | null;
  result: VideoRenderResult | null;
  error: VideoRenderError | null;
};

export type VideoRenderProgress = {
  jobId: string;
  state: "validating" | "starting" | "running" | "finalizing";
  percent: number;
  stage: string;
  frameIndex: number | null;
  totalFrames: number | null;
  encodedSeconds: number | null;
  updatedAtUtc: string;
};

export type VideoRenderResult = {
  jobId: string;
  outputPath: string;
  durationSeconds: number;
  fileSizeBytes: number;
  completedAtUtc: string;
};

export type VideoRenderError = {
  jobId: string | null;
  code:
    | "INVALID_REQUEST"
    | "UNSUPPORTED_MEDIA"
    | "INPUT_IO_FAILURE"
    | "OUTPUT_IO_FAILURE"
    | "ENCODER_FAILURE"
    | "RENDER_CANCELED"
    | "RENDER_IN_PROGRESS_CONFLICT"
    | "UNEXPECTED_BACKEND_ERROR";
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};
```

## 3. Validation and bounds

- `opacity`, `intensity`, `smoothing`: inclusive range `[0.0, 1.0]`.
- `fontSizePx`: `[12, 96]` for MVP.
- `titleText` max length: `120`.
- `artistText` max length: `120`.
- `outputBaseFileName`: `[1, 120]`, filesystem-safe characters only.
- `progressPercent`: `[0, 100]`, monotonic non-decreasing per `jobId`.

## 4. Serialization rules

- `VideoProjectState.schemaVersion` is mandatory.
- Unknown fields must be ignored during parse and excluded during save.
- Missing required fields fail parse with typed validation issue.
- All timestamps use UTC ISO-8601 strings.

## 5. Backend wire model mapping

Frontend to backend request mapping:
- `VideoRenderIntent` maps to Rust `VideoRenderRequest` one-to-one.
- `requestVersion` must equal Rust `request_version`.
- hex colors must be normalized to `#RRGGBB` before crossing IPC.

Backend to frontend status mapping:
- Rust `VideoRenderProgressSnapshot` -> `VideoRenderProgress`.
- Rust terminal success -> `VideoRenderResult`.
- Rust failure envelope -> `VideoRenderError`.

## 6. Determinism requirements

- `VideoRenderIntent` is generated from a single immutable project snapshot.
- For the same snapshot and output path, generated intent must be byte-equivalent (field order and value equivalence in JSON serialization).
- Overlay parameter derivation from same audio source and settings must be deterministic.

## 7. Data ownership boundaries

- `video-workspace` owns `VideoProjectState`, `VideoPreviewState`, and `VideoRenderRuntimeState` in frontend.
- `backend-video-render-service` owns render execution status truth.
- `services/tauri/video` owns serialization/sanitization across IPC.


