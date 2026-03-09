import { sanitizeUiErrorMessage, sanitizeUiText } from "../../../shared/lib/ui-sanitize";
import { isUiAppError, type UiAppError } from "../core";
import type {
  VideoRenderCancelResponse,
  VideoRenderEnvironmentDiagnostics,
  VideoRenderFailure,
  VideoRenderFfmpegSource,
  VideoRenderJobState,
  VideoRenderOpenOutputFolderResponse,
  VideoRenderProgressSnapshot,
  VideoRenderResultResponse,
  VideoRenderSourcePathCheckResponse,
  VideoRenderStartResponse,
  VideoRenderValidateResponse,
  VideoRenderValidationIssue
} from "./types";

const KNOWN_JOB_STATES: readonly VideoRenderJobState[] = [
  "idle",
  "validating",
  "starting",
  "running",
  "finalizing",
  "succeeded",
  "failed",
  "canceled"
] as const;

const KNOWN_VALIDATION_CODES: readonly VideoRenderValidationIssue["code"][] = [
  "MISSING_IMAGE",
  "MISSING_AUDIO",
  "UNSUPPORTED_IMAGE_TYPE",
  "UNSUPPORTED_AUDIO_TYPE",
  "INVALID_OUTPUT_PATH",
  "INVALID_REQUEST_VERSION",
  "INVALID_COMPOSITION",
  "INVALID_OUTPUT_FORMAT"
] as const;

const KNOWN_RESULT_CODES: readonly VideoRenderFailure["code"][] = [
  "invalid_request",
  "unsupported_media_type",
  "missing_input",
  "input_read_failed",
  "output_path_invalid",
  "encoder_unavailable",
  "encoder_failed",
  "overlay_computation_failed",
  "text_layout_failed",
  "progress_channel_closed",
  "canceled_by_user",
  "internal_invariant_violation"
] as const;

const KNOWN_FFMPEG_SOURCES: readonly VideoRenderFfmpegSource[] = [
  "bundled_resource",
  "path",
  "missing"
] as const;

function isKnownJobState(value: string): value is VideoRenderJobState {
  return KNOWN_JOB_STATES.includes(value as VideoRenderJobState);
}

function sanitizeJobState(value: unknown): VideoRenderJobState {
  if (typeof value === "string" && isKnownJobState(value)) {
    return value;
  }
  return "failed";
}

function sanitizePercent(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

function sanitizeValidationIssue(issue: unknown): VideoRenderValidationIssue {
  const raw = issue && typeof issue === "object" ? (issue as Record<string, unknown>) : {};
  const code = String(raw.code ?? "INVALID_OUTPUT_FORMAT");
  const safeCode = KNOWN_VALIDATION_CODES.includes(code as VideoRenderValidationIssue["code"])
    ? (code as VideoRenderValidationIssue["code"])
    : "INVALID_OUTPUT_FORMAT";

  return {
    code: safeCode,
    field: sanitizeUiText(String(raw.field ?? "request"), 64),
    message: sanitizeUiText(String(raw.message ?? "Render validation failed."), 256)
  };
}

function sanitizeResultFailure(value: unknown): VideoRenderFailure | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const code = String(raw.code ?? "internal_invariant_violation");
  const safeCode = KNOWN_RESULT_CODES.includes(code as VideoRenderFailure["code"])
    ? (code as VideoRenderFailure["code"])
    : "internal_invariant_violation";

  return {
    jobId: typeof raw.jobId === "string" ? sanitizeUiText(raw.jobId, 128) : null,
    code: safeCode,
    message: sanitizeUiText(String(raw.message ?? "Video render failed."), 256),
    retryable: Boolean(raw.retryable),
    details:
      raw.details && typeof raw.details === "object"
        ? (raw.details as Record<string, unknown>)
        : null
  };
}

function sanitizeFfmpegSource(value: unknown): VideoRenderFfmpegSource {
  if (typeof value === "string" && KNOWN_FFMPEG_SOURCES.includes(value as VideoRenderFfmpegSource)) {
    return value as VideoRenderFfmpegSource;
  }
  return "missing";
}

export function sanitizeVideoRenderValidateResponse(
  value: unknown
): VideoRenderValidateResponse {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    ok: Boolean(raw.ok),
    issues: Array.isArray(raw.issues) ? raw.issues.map(sanitizeValidationIssue) : []
  };
}

export function sanitizeVideoRenderStartResponse(value: unknown): VideoRenderStartResponse {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    jobId: sanitizeUiText(String(raw.jobId ?? ""), 128),
    state: sanitizeJobState(raw.state)
  };
}

export function sanitizeVideoRenderProgressSnapshot(
  value: unknown
): VideoRenderProgressSnapshot {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    jobId: sanitizeUiText(String(raw.jobId ?? ""), 128),
    state: sanitizeJobState(raw.state),
    percent: sanitizePercent(raw.percent),
    stage: sanitizeUiText(String(raw.stage ?? "render"), 64),
    frameIndex:
      typeof raw.frameIndex === "number" && Number.isFinite(raw.frameIndex)
        ? raw.frameIndex
        : null,
    totalFrames:
      typeof raw.totalFrames === "number" && Number.isFinite(raw.totalFrames)
        ? raw.totalFrames
        : null,
    encodedSeconds:
      typeof raw.encodedSeconds === "number" && Number.isFinite(raw.encodedSeconds)
        ? raw.encodedSeconds
        : null,
    message:
      raw.message == null ? null : sanitizeUiText(String(raw.message), 256),
    updatedAtUtc: sanitizeUiText(String(raw.updatedAtUtc ?? new Date(0).toISOString()), 64)
  };
}

export function sanitizeVideoRenderCancelResponse(value: unknown): VideoRenderCancelResponse {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    jobId: sanitizeUiText(String(raw.jobId ?? ""), 128),
    state: sanitizeJobState(raw.state),
    canceled: Boolean(raw.canceled)
  };
}

export function sanitizeVideoRenderResultResponse(value: unknown): VideoRenderResultResponse {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  const success =
    raw.success && typeof raw.success === "object"
      ? {
          jobId: sanitizeUiText(String((raw.success as Record<string, unknown>).jobId ?? ""), 128),
          outputPath: sanitizeUiText(
            String((raw.success as Record<string, unknown>).outputPath ?? ""),
            4096
          ),
          durationSeconds:
            typeof (raw.success as Record<string, unknown>).durationSeconds === "number"
              ? ((raw.success as Record<string, unknown>).durationSeconds as number)
              : 0,
          fileSizeBytes:
            typeof (raw.success as Record<string, unknown>).fileSizeBytes === "number"
              ? ((raw.success as Record<string, unknown>).fileSizeBytes as number)
              : 0,
          completedAtUtc: sanitizeUiText(
            String((raw.success as Record<string, unknown>).completedAtUtc ?? new Date(0).toISOString()),
            64
          )
        }
      : null;

  return {
    jobId: sanitizeUiText(String(raw.jobId ?? ""), 128),
    state: sanitizeJobState(raw.state),
    success,
    failure: sanitizeResultFailure(raw.failure)
  };
}

export function sanitizeVideoRenderEnvironmentDiagnostics(
  value: unknown
): VideoRenderEnvironmentDiagnostics {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const ffmpegRaw =
    raw.ffmpeg && typeof raw.ffmpeg === "object"
      ? (raw.ffmpeg as Record<string, unknown>)
      : {};
  const outputDirectoryRaw =
    raw.outputDirectory && typeof raw.outputDirectory === "object"
      ? (raw.outputDirectory as Record<string, unknown>)
      : null;

  return {
    ffmpeg: {
      available: Boolean(ffmpegRaw.available),
      source: sanitizeFfmpegSource(ffmpegRaw.source),
      executablePath:
        typeof ffmpegRaw.executablePath === "string"
          ? sanitizeUiText(ffmpegRaw.executablePath, 4096)
          : null,
      version:
        typeof ffmpegRaw.version === "string" ? sanitizeUiText(ffmpegRaw.version, 256) : null,
      message:
        typeof ffmpegRaw.message === "string" ? sanitizeUiText(ffmpegRaw.message, 256) : null
    },
    outputDirectory: outputDirectoryRaw
      ? {
          directoryPath: sanitizeUiText(String(outputDirectoryRaw.directoryPath ?? ""), 4096),
          exists: Boolean(outputDirectoryRaw.exists),
          writable: Boolean(outputDirectoryRaw.writable),
          message:
            typeof outputDirectoryRaw.message === "string"
              ? sanitizeUiText(outputDirectoryRaw.message, 256)
              : null
        }
      : null,
    renderCapable: Boolean(raw.renderCapable),
    blockingReasons: Array.isArray(raw.blockingReasons)
      ? raw.blockingReasons.map((reason) => sanitizeUiText(String(reason), 256))
      : []
  };
}

export function sanitizeVideoRenderSourcePathCheckResponse(
  value: unknown
): VideoRenderSourcePathCheckResponse {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    sourcePath: sanitizeUiText(String(raw.sourcePath ?? ""), 4096),
    exists: Boolean(raw.exists),
    isFile: Boolean(raw.isFile)
  };
}

export function sanitizeVideoRenderOpenOutputFolderResponse(
  value: unknown
): VideoRenderOpenOutputFolderResponse {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    opened: Boolean(raw.opened),
    directoryPath: sanitizeUiText(String(raw.directoryPath ?? ""), 4096)
  };
}

const BACKEND_ERROR_MAP: Record<string, string> = {
  VIDEO_RENDER_INVALID_REQUEST: "INVALID_ARGUMENT",
  VIDEO_RENDER_JOB_CONFLICT: "RENDER_IN_PROGRESS_CONFLICT",
  VIDEO_RENDER_JOB_NOT_FOUND: "VIDEO_RENDER_JOB_NOT_FOUND",
  VIDEO_RENDER_INTERNAL_ERROR: "UNEXPECTED_BACKEND_ERROR"
};

export function mapVideoRenderBackendError(error: unknown): UiAppError {
  if (isUiAppError(error)) {
    return {
      code: BACKEND_ERROR_MAP[error.code] ?? error.code,
      message: sanitizeUiErrorMessage(error.message, "Video render command failed."),
      details: error.details
    };
  }

  return {
    code: "UNEXPECTED_BACKEND_ERROR",
    message: sanitizeUiErrorMessage(error, "Video render command failed.")
  };
}
