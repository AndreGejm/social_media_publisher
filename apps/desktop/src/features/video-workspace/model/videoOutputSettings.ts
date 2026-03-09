import {
  isVideoOutputPresetId,
  type VideoOutputPresetId
} from "./videoOutputPresets";

export type VideoOutputOverwritePolicy = "disallow" | "replace";

export type VideoOutputSettings = {
  presetId: VideoOutputPresetId;
  outputDirectoryPath: string;
  outputBaseFileName: string;
  overwritePolicy: VideoOutputOverwritePolicy;
};

export type VideoOutputSettingsIssueCode =
  | "INVALID_OUTPUT_DIRECTORY"
  | "INVALID_OUTPUT_FILENAME"
  | "PRESET_NOT_FOUND";

export type VideoOutputSettingsIssue = {
  code: VideoOutputSettingsIssueCode;
  message: string;
};

export const VIDEO_OUTPUT_FILENAME_BOUNDS = {
  minLength: 1,
  maxLength: 120
} as const;

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*]|[\p{Cc}]/gu;
const OUTPUT_EXTENSION = ".mp4";

function sanitizeOutputBaseFileName(value: string): string {
  const withoutInvalidChars = value.replace(INVALID_FILENAME_CHARS, "");
  const trimmed = withoutInvalidChars.trim();
  const truncated = trimmed.slice(0, VIDEO_OUTPUT_FILENAME_BOUNDS.maxLength);
  return truncated;
}

function normalizeOutputDirectoryPath(value: string): string {
  return value.trim();
}

function normalizeOverwritePolicy(value: string): VideoOutputOverwritePolicy {
  return value === "replace" ? "replace" : "disallow";
}

export function createDefaultVideoOutputSettings(): VideoOutputSettings {
  return {
    presetId: "youtube_1080p_standard",
    outputDirectoryPath: "",
    outputBaseFileName: "video-export",
    overwritePolicy: "disallow"
  };
}

export function patchVideoOutputSettings(
  current: VideoOutputSettings,
  patch: Partial<VideoOutputSettings>
): VideoOutputSettings {
  return {
    presetId:
      patch.presetId && isVideoOutputPresetId(patch.presetId)
        ? patch.presetId
        : current.presetId,
    outputDirectoryPath:
      patch.outputDirectoryPath !== undefined
        ? normalizeOutputDirectoryPath(patch.outputDirectoryPath)
        : current.outputDirectoryPath,
    outputBaseFileName:
      patch.outputBaseFileName !== undefined
        ? sanitizeOutputBaseFileName(patch.outputBaseFileName)
        : current.outputBaseFileName,
    overwritePolicy:
      patch.overwritePolicy !== undefined
        ? normalizeOverwritePolicy(patch.overwritePolicy)
        : current.overwritePolicy
  };
}

export function validateVideoOutputSettings(
  settings: VideoOutputSettings
): VideoOutputSettingsIssue[] {
  const issues: VideoOutputSettingsIssue[] = [];

  if (!isVideoOutputPresetId(settings.presetId)) {
    issues.push({
      code: "PRESET_NOT_FOUND",
      message: "Selected output preset is not recognized."
    });
  }

  if (settings.outputDirectoryPath.trim().length === 0) {
    issues.push({
      code: "INVALID_OUTPUT_DIRECTORY",
      message: "Output directory path is required."
    });
  }

  const fileName = sanitizeOutputBaseFileName(settings.outputBaseFileName);
  if (
    fileName.length < VIDEO_OUTPUT_FILENAME_BOUNDS.minLength ||
    fileName.length > VIDEO_OUTPUT_FILENAME_BOUNDS.maxLength
  ) {
    issues.push({
      code: "INVALID_OUTPUT_FILENAME",
      message: "Output file name must be between 1 and 120 characters and filesystem-safe."
    });
  }

  return issues;
}

export function deriveVideoOutputFileName(outputBaseFileName: string): string {
  const safeBase = sanitizeOutputBaseFileName(outputBaseFileName);
  const fallbackBase = safeBase.length > 0 ? safeBase : "video-export";
  return `${fallbackBase}${OUTPUT_EXTENSION}`;
}

export function deriveVideoOutputFilePreviewPath(settings: VideoOutputSettings): string {
  const fileName = deriveVideoOutputFileName(settings.outputBaseFileName);
  const directory = settings.outputDirectoryPath.trim();

  if (!directory) return fileName;

  if (directory.endsWith("\\") || directory.endsWith("/")) {
    return `${directory}${fileName}`;
  }

  const separator = directory.includes("\\") ? "\\" : "/";
  return `${directory}${separator}${fileName}`;
}
