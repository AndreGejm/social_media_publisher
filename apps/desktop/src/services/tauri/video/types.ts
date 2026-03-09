export type VideoRenderRequest = {
  requestVersion: 1;
  requestId: string;
  media: {
    imageFileName: string;
    audioFileName: string;
    imageExtension: string;
    audioExtension: string;
  };
  composition: {
    widthPx: number;
    heightPx: number;
    frameRate: 30;
    fitMode: "fill_crop" | "fit_bars" | "stretch";
    text: {
      enabled: boolean;
      preset: "none" | "title_bottom_center" | "title_artist_bottom_left" | "title_artist_center_stack";
      titleText: string;
      artistText: string;
      fontSizePx: number;
      colorHex: string;
    };
    overlay: {
      enabled: boolean;
      style: "waveform_strip";
      opacity: number;
      intensity: number;
      smoothing: number;
      position: "top" | "bottom";
      themeColorHex: string;
    };
  };
  output: {
    presetId: "youtube_1080p_standard" | "youtube_1440p_standard" | "youtube_1080p_audio_priority";
    outputFilePath: string;
    overwritePolicy: "disallow" | "replace";
    container: "mp4";
    videoCodec: "h264";
    audioCodec: "aac";
    pixelFormat: "yuv420p";
    videoBitrateKbps: number;
    audioBitrateKbps: number;
  };
};

export type VideoRenderValidationIssueCode =
  | "MISSING_IMAGE"
  | "MISSING_AUDIO"
  | "UNSUPPORTED_IMAGE_TYPE"
  | "UNSUPPORTED_AUDIO_TYPE"
  | "INVALID_OUTPUT_PATH"
  | "INVALID_REQUEST_VERSION"
  | "INVALID_COMPOSITION"
  | "INVALID_OUTPUT_FORMAT";

export type VideoRenderValidationIssue = {
  code: VideoRenderValidationIssueCode;
  message: string;
  field: string;
};

export type VideoRenderValidateResponse = {
  ok: boolean;
  issues: VideoRenderValidationIssue[];
};

export type VideoRenderJobState =
  | "idle"
  | "validating"
  | "starting"
  | "running"
  | "finalizing"
  | "succeeded"
  | "failed"
  | "canceled";

export type VideoRenderStartResponse = {
  jobId: string;
  state: VideoRenderJobState;
};

export type VideoRenderProgressSnapshot = {
  jobId: string;
  state: VideoRenderJobState;
  percent: number;
  stage: string;
  frameIndex: number | null;
  totalFrames: number | null;
  encodedSeconds: number | null;
  message: string | null;
  updatedAtUtc: string;
};

export type VideoRenderCancelResponse = {
  jobId: string;
  state: VideoRenderJobState;
  canceled: boolean;
};

export type VideoRenderResultFailureCode =
  | "invalid_request"
  | "unsupported_media_type"
  | "missing_input"
  | "input_read_failed"
  | "output_path_invalid"
  | "encoder_unavailable"
  | "encoder_failed"
  | "overlay_computation_failed"
  | "text_layout_failed"
  | "progress_channel_closed"
  | "canceled_by_user"
  | "internal_invariant_violation";

export type VideoRenderSuccess = {
  jobId: string;
  outputPath: string;
  durationSeconds: number;
  fileSizeBytes: number;
  completedAtUtc: string;
};

export type VideoRenderFailure = {
  jobId: string | null;
  code: VideoRenderResultFailureCode;
  message: string;
  retryable: boolean;
  details: Record<string, unknown> | null;
};

export type VideoRenderResultResponse = {
  jobId: string;
  state: VideoRenderJobState;
  success: VideoRenderSuccess | null;
  failure: VideoRenderFailure | null;
};

export type VideoRenderFfmpegSource = "bundled_resource" | "path" | "missing";

export type VideoRenderFfmpegDiagnostics = {
  available: boolean;
  source: VideoRenderFfmpegSource;
  executablePath: string | null;
  version: string | null;
  message: string | null;
};

export type VideoRenderOutputDirectoryDiagnostics = {
  directoryPath: string;
  exists: boolean;
  writable: boolean;
  message: string | null;
};

export type VideoRenderEnvironmentDiagnostics = {
  ffmpeg: VideoRenderFfmpegDiagnostics;
  outputDirectory: VideoRenderOutputDirectoryDiagnostics | null;
  renderCapable: boolean;
  blockingReasons: string[];
};

export type VideoRenderSourcePathCheckResponse = {
  sourcePath: string;
  exists: boolean;
  isFile: boolean;
};

export type VideoRenderOpenOutputFolderResponse = {
  opened: boolean;
  directoryPath: string;
};
