import type { VideoOverlaySettings } from "../../overlay-engine/api";
import type { VideoPreviewFitMode } from "../../video-composition/api";
import type { VideoWorkspaceMediaAsset } from "./videoWorkspaceProjectState";
import type { VideoWorkspaceTextSettings } from "./videoWorkspaceTextSettings";
import {
  deriveVideoOutputFilePreviewPath,
  validateVideoOutputSettings,
  type VideoOutputSettings,
  type VideoOutputSettingsIssue
} from "./videoOutputSettings";
import {
  resolveVideoOutputPreset,
  type VideoOutputPreset,
  type VideoOutputPresetId
} from "./videoOutputPresets";

export type VideoRenderPreflightIssueCode =
  | "MISSING_IMAGE"
  | "MISSING_AUDIO"
  | "MISSING_IMAGE_PATH"
  | "MISSING_AUDIO_PATH"
  | "INVALID_OUTPUT_DIRECTORY"
  | "INVALID_OUTPUT_FILENAME"
  | "PRESET_NOT_FOUND";

export type VideoRenderPreflightIssue = {
  code: VideoRenderPreflightIssueCode;
  message: string;
  field:
    | "image"
    | "audio"
    | "image.path"
    | "audio.path"
    | "output.directory"
    | "output.filename"
    | "preset";
};

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
    fitMode: VideoPreviewFitMode;
    text: VideoWorkspaceTextSettings;
    overlay: {
      enabled: boolean;
      style: VideoOverlaySettings["style"];
      opacity: number;
      intensity: number;
      smoothing: number;
      position: VideoOverlaySettings["position"];
      themeColorHex: string;
      sizePercent: number;
    };
  };
  output: {
    presetId: VideoOutputPresetId;
    outputFilePath: string;
    overwritePolicy: VideoOutputSettings["overwritePolicy"];
    container: "mp4";
    videoCodec: "h264";
    audioCodec: "aac";
    pixelFormat: "yuv420p";
    videoBitrateKbps: number;
    audioBitrateKbps: number;
  };
};

export type VideoRenderRequestBuildInput = {
  imageAsset: VideoWorkspaceMediaAsset | null;
  audioAsset: VideoWorkspaceMediaAsset | null;
  fitMode: VideoPreviewFitMode;
  textSettings: VideoWorkspaceTextSettings;
  overlaySettings: VideoOverlaySettings;
  outputSettings: VideoOutputSettings;
};

export type VideoRenderRequestBuildResult =
  | { ok: true; request: VideoRenderRequest }
  | { ok: false; issues: VideoRenderPreflightIssue[] };

function mapOutputIssue(issue: VideoOutputSettingsIssue): VideoRenderPreflightIssue {
  if (issue.code === "INVALID_OUTPUT_DIRECTORY") {
    return {
      code: "INVALID_OUTPUT_DIRECTORY",
      message: issue.message,
      field: "output.directory"
    };
  }

  if (issue.code === "INVALID_OUTPUT_FILENAME") {
    return {
      code: "INVALID_OUTPUT_FILENAME",
      message: issue.message,
      field: "output.filename"
    };
  }

  return {
    code: "PRESET_NOT_FOUND",
    message: issue.message,
    field: "preset"
  };
}

function hasSourcePath(asset: VideoWorkspaceMediaAsset | null): boolean {
  return Boolean(asset?.sourcePath && asset.sourcePath.trim().length > 0);
}

export function preflightVideoRenderRequest(
  input: VideoRenderRequestBuildInput
): VideoRenderPreflightIssue[] {
  const issues: VideoRenderPreflightIssue[] = [];

  if (!input.imageAsset) {
    issues.push({
      code: "MISSING_IMAGE",
      message: "Select one image file before building a render request.",
      field: "image"
    });
  }

  if (!input.audioAsset) {
    issues.push({
      code: "MISSING_AUDIO",
      message: "Select one WAV audio file before building a render request.",
      field: "audio"
    });
  }

  if (input.imageAsset && !hasSourcePath(input.imageAsset)) {
    issues.push({
      code: "MISSING_IMAGE_PATH",
      message:
        "Image source path is unavailable. Re-select the image from a local filesystem location.",
      field: "image.path"
    });
  }

  if (input.audioAsset && !hasSourcePath(input.audioAsset)) {
    issues.push({
      code: "MISSING_AUDIO_PATH",
      message:
        "Audio source path is unavailable. Re-select the WAV file from a local filesystem location.",
      field: "audio.path"
    });
  }

  issues.push(...validateVideoOutputSettings(input.outputSettings).map(mapOutputIssue));

  return issues;
}

function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function toRequestWithoutId(args: {
  input: VideoRenderRequestBuildInput;
  outputPreset: VideoOutputPreset;
  outputFilePath: string;
}): Omit<VideoRenderRequest, "requestId"> {
  const { input, outputPreset, outputFilePath } = args;

  const imagePath = input.imageAsset?.sourcePath?.trim() ?? "";
  const audioPath = input.audioAsset?.sourcePath?.trim() ?? "";

  return {
    requestVersion: 1,
    media: {
      imageFileName: imagePath,
      audioFileName: audioPath,
      imageExtension: input.imageAsset?.extension ?? "",
      audioExtension: input.audioAsset?.extension ?? ""
    },
    composition: {
      widthPx: outputPreset.widthPx,
      heightPx: outputPreset.heightPx,
      frameRate: outputPreset.frameRate,
      fitMode: input.fitMode,
      text: input.textSettings,
      overlay: {
        enabled: input.overlaySettings.enabled,
        style: input.overlaySettings.style,
        opacity: input.overlaySettings.opacity,
        intensity: input.overlaySettings.intensity,
        smoothing: input.overlaySettings.smoothing,
        position: input.overlaySettings.position,
        themeColorHex: input.overlaySettings.themeColorHex,
        sizePercent: input.overlaySettings.sizePercent
      }
    },
    output: {
      presetId: outputPreset.id,
      outputFilePath,
      overwritePolicy: input.outputSettings.overwritePolicy,
      container: outputPreset.container,
      videoCodec: outputPreset.videoCodec,
      audioCodec: outputPreset.audioCodec,
      pixelFormat: outputPreset.pixelFormat,
      videoBitrateKbps: outputPreset.videoBitrateKbps,
      audioBitrateKbps: outputPreset.audioBitrateKbps
    }
  };
}

export function buildVideoRenderRequest(
  input: VideoRenderRequestBuildInput
): VideoRenderRequestBuildResult {
  const issues = preflightVideoRenderRequest(input);
  if (issues.length > 0) {
    return {
      ok: false,
      issues
    };
  }

  const outputPreset = resolveVideoOutputPreset(input.outputSettings.presetId);
  const outputFilePath = deriveVideoOutputFilePreviewPath(input.outputSettings);

  const requestWithoutId = toRequestWithoutId({
    input,
    outputPreset,
    outputFilePath
  });

  const requestId = `vwreq_${fnv1aHash(JSON.stringify(requestWithoutId))}`;

  return {
    ok: true,
    request: {
      ...requestWithoutId,
      requestId
    }
  };
}

export function toVideoRenderRequestJson(request: VideoRenderRequest): string {
  return JSON.stringify(request, null, 2);
}
