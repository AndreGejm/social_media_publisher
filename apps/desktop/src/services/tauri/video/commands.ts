import { invokeCommand } from "../core";
import {
  assertFiniteNumber,
  assertInteger,
  assertNonEmptyString,
  assertString,
  assertStringWithMaxLength,
  invalidArgument
} from "../core/validation";
import {
  mapVideoRenderBackendError,
  sanitizeVideoRenderCancelResponse,
  sanitizeVideoRenderEnvironmentDiagnostics,
  sanitizeVideoRenderOpenOutputFolderResponse,
  sanitizeVideoRenderProgressSnapshot,
  sanitizeVideoRenderResultResponse,
  sanitizeVideoRenderSourcePathCheckResponse,
  sanitizeVideoRenderStartResponse,
  sanitizeVideoRenderValidateResponse
} from "./mappers";
import type {
  VideoRenderCancelResponse,
  VideoRenderEnvironmentDiagnostics,
  VideoRenderOpenOutputFolderResponse,
  VideoRenderProgressSnapshot,
  VideoRenderRequest,
  VideoRenderResultResponse,
  VideoRenderSourcePathCheckResponse,
  VideoRenderStartResponse,
  VideoRenderValidateResponse
} from "./types";

const MAX_TEXT_FIELD_CHARS = 120;
const MAX_OUTPUT_PATH_CHARS = 4096;

function assertColorHex(value: string, label: string): void {
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw invalidArgument(`${label} must be a #RRGGBB hex color string.`);
  }
}

function assertUnitInterval(value: number, label: string): void {
  assertFiniteNumber(value, label);
  if (value < 0 || value > 1) {
    throw invalidArgument(`${label} must be between 0 and 1.`);
  }
}

function assertOverlaySizePercent(value: number, label: string): void {
  assertFiniteNumber(value, label);
  if (value < 0 || value > 200) {
    throw invalidArgument(`${label} must be between 0 and 200.`);
  }
}

function validateVideoRenderRequestInput(request: VideoRenderRequest): void {
  if (!request || typeof request !== "object") {
    throw invalidArgument("request must be an object.");
  }

  if (request.requestVersion !== 1) {
    throw invalidArgument("request.requestVersion must be 1.");
  }

  assertString(request.requestId, "request.requestId");
  assertNonEmptyString(request.requestId, "request.requestId");
  assertStringWithMaxLength(request.requestId, "request.requestId", 128);

  assertString(request.media.imageFileName, "request.media.imageFileName");
  assertString(request.media.audioFileName, "request.media.audioFileName");
  assertString(request.media.imageExtension, "request.media.imageExtension");
  assertString(request.media.audioExtension, "request.media.audioExtension");

  assertInteger(request.composition.widthPx, "request.composition.widthPx");
  assertInteger(request.composition.heightPx, "request.composition.heightPx");
  assertInteger(request.composition.frameRate, "request.composition.frameRate");

  if (request.composition.frameRate !== 30) {
    throw invalidArgument("request.composition.frameRate must be 30 for Stage 7.");
  }

  if (
    request.composition.fitMode !== "fill_crop" &&
    request.composition.fitMode !== "fit_bars" &&
    request.composition.fitMode !== "stretch"
  ) {
    throw invalidArgument("request.composition.fitMode is invalid.");
  }

  assertUnitInterval(request.composition.overlay.opacity, "request.composition.overlay.opacity");
  assertUnitInterval(request.composition.overlay.intensity, "request.composition.overlay.intensity");
  assertUnitInterval(request.composition.overlay.smoothing, "request.composition.overlay.smoothing");
  assertOverlaySizePercent(
    request.composition.overlay.sizePercent,
    "request.composition.overlay.sizePercent"
  );

  assertColorHex(request.composition.overlay.themeColorHex, "request.composition.overlay.themeColorHex");
  assertColorHex(request.composition.text.colorHex, "request.composition.text.colorHex");

  assertStringWithMaxLength(
    request.composition.text.titleText,
    "request.composition.text.titleText",
    MAX_TEXT_FIELD_CHARS
  );
  assertStringWithMaxLength(
    request.composition.text.artistText,
    "request.composition.text.artistText",
    MAX_TEXT_FIELD_CHARS
  );

  assertString(request.output.outputFilePath, "request.output.outputFilePath");
  assertNonEmptyString(request.output.outputFilePath, "request.output.outputFilePath");
  assertStringWithMaxLength(
    request.output.outputFilePath,
    "request.output.outputFilePath",
    MAX_OUTPUT_PATH_CHARS
  );

  if (request.output.container !== "mp4") {
    throw invalidArgument("request.output.container must be 'mp4'.");
  }
  if (request.output.videoCodec !== "h264") {
    throw invalidArgument("request.output.videoCodec must be 'h264'.");
  }
  if (request.output.audioCodec !== "aac") {
    throw invalidArgument("request.output.audioCodec must be 'aac'.");
  }
  if (request.output.pixelFormat !== "yuv420p") {
    throw invalidArgument("request.output.pixelFormat must be 'yuv420p'.");
  }
}

async function invokeVideoCommand<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  try {
    return await invokeCommand<T>(command, args);
  } catch (error) {
    throw mapVideoRenderBackendError(error);
  }
}

export async function videoRenderValidate(
  request: VideoRenderRequest
): Promise<VideoRenderValidateResponse> {
  validateVideoRenderRequestInput(request);
  const response = await invokeVideoCommand<unknown>("video_render_validate", { request });
  return sanitizeVideoRenderValidateResponse(response);
}

export async function videoRenderStart(
  request: VideoRenderRequest
): Promise<VideoRenderStartResponse> {
  validateVideoRenderRequestInput(request);
  const response = await invokeVideoCommand<unknown>("video_render_start", { request });
  return sanitizeVideoRenderStartResponse(response);
}

export async function videoRenderStatus(jobId: string): Promise<VideoRenderProgressSnapshot> {
  assertString(jobId, "jobId");
  assertNonEmptyString(jobId, "jobId");
  assertStringWithMaxLength(jobId, "jobId", 128);

  const response = await invokeVideoCommand<unknown>("video_render_status", { jobId });
  return sanitizeVideoRenderProgressSnapshot(response);
}

export async function videoRenderCancel(jobId: string): Promise<VideoRenderCancelResponse> {
  assertString(jobId, "jobId");
  assertNonEmptyString(jobId, "jobId");
  assertStringWithMaxLength(jobId, "jobId", 128);

  const response = await invokeVideoCommand<unknown>("video_render_cancel", { jobId });
  return sanitizeVideoRenderCancelResponse(response);
}

export async function videoRenderResult(jobId: string): Promise<VideoRenderResultResponse> {
  assertString(jobId, "jobId");
  assertNonEmptyString(jobId, "jobId");
  assertStringWithMaxLength(jobId, "jobId", 128);

  const response = await invokeVideoCommand<unknown>("video_render_result", { jobId });
  return sanitizeVideoRenderResultResponse(response);
}

export async function videoRenderGetEnvironmentDiagnostics(
  outputDirectoryPath?: string | null
): Promise<VideoRenderEnvironmentDiagnostics> {
  if (outputDirectoryPath != null) {
    assertString(outputDirectoryPath, "outputDirectoryPath");
    assertStringWithMaxLength(outputDirectoryPath, "outputDirectoryPath", MAX_OUTPUT_PATH_CHARS);
  }

  const response = await invokeVideoCommand<unknown>("video_render_get_environment_diagnostics", {
    outputDirectoryPath: outputDirectoryPath ?? null
  });
  return sanitizeVideoRenderEnvironmentDiagnostics(response);
}

export async function videoRenderCheckSourcePath(
  sourcePath: string
): Promise<VideoRenderSourcePathCheckResponse> {
  assertString(sourcePath, "sourcePath");
  assertNonEmptyString(sourcePath, "sourcePath");
  assertStringWithMaxLength(sourcePath, "sourcePath", MAX_OUTPUT_PATH_CHARS);

  const response = await invokeVideoCommand<unknown>("video_render_check_source_path", {
    sourcePath
  });
  return sanitizeVideoRenderSourcePathCheckResponse(response);
}

export async function videoRenderOpenOutputFolder(
  outputFilePath: string
): Promise<VideoRenderOpenOutputFolderResponse> {
  assertString(outputFilePath, "outputFilePath");
  assertNonEmptyString(outputFilePath, "outputFilePath");
  assertStringWithMaxLength(outputFilePath, "outputFilePath", MAX_OUTPUT_PATH_CHARS);

  const response = await invokeVideoCommand<unknown>("video_render_open_output_folder", {
    outputFilePath
  });
  return sanitizeVideoRenderOpenOutputFolderResponse(response);
}
