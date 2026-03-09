import {
  createDefaultVideoOverlaySettings,
  patchVideoOverlaySettings,
  type VideoOverlaySettings
} from "../../overlay-engine/api";
import type { VideoPreviewFitMode } from "../../video-composition/api";
import {
  createDefaultVideoOutputSettings,
  patchVideoOutputSettings,
  type VideoOutputSettings
} from "./videoOutputSettings";
import {
  isVideoOutputPresetId,
  type VideoOutputPresetId
} from "./videoOutputPresets";
import {
  createDefaultVideoWorkspaceTextSettings,
  patchVideoWorkspaceTextSettings,
  type VideoWorkspaceTextSettings
} from "./videoWorkspaceTextSettings";
import {
  fromVideoWorkspaceProjectSnapshot,
  toVideoWorkspaceProjectSnapshot,
  type VideoWorkspaceProjectSnapshot
} from "./videoWorkspaceProjectState";

const MAX_RECENT_OUTPUT_DIRECTORIES = 5;

export const VIDEO_WORKSPACE_STORAGE_KEYS = {
  projectDocument: "rp.video.workspace.project.v1",
  presetDocument: "rp.video.workspace.preset.v1",
  preferencesDocument: "rp.video.workspace.preferences.v1"
} as const;

export type VideoWorkspaceProjectDocument = {
  schemaVersion: 1;
  savedAtUtc: string;
  projectSnapshot: VideoWorkspaceProjectSnapshot;
  fitMode: VideoPreviewFitMode;
  textSettings: VideoWorkspaceTextSettings;
  overlaySettings: VideoOverlaySettings;
  outputSettings: VideoOutputSettings;
};

export type VideoWorkspacePresetDocument = {
  schemaVersion: 1;
  savedAtUtc: string;
  fitMode: VideoPreviewFitMode;
  textSettings: VideoWorkspaceTextSettings;
  overlaySettings: VideoOverlaySettings;
  outputPresetId: VideoOutputPresetId;
  overwritePolicy: VideoOutputSettings["overwritePolicy"];
};

export type VideoWorkspacePreferencesDocument = {
  schemaVersion: 1;
  lastOutputPresetId: VideoOutputPresetId;
  recentOutputDirectories: string[];
};

function isVideoPreviewFitMode(value: unknown): value is VideoPreviewFitMode {
  return value === "fill_crop" || value === "fit_bars" || value === "stretch";
}

function normalizeSavedAtUtc(value: unknown): string {
  if (typeof value !== "string") return new Date(0).toISOString();
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : new Date(0).toISOString();
}

function normalizeRecentOutputDirectories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const unique = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const normalized = entry.trim();
    if (normalized.length === 0) continue;
    unique.add(normalized);
    if (unique.size >= MAX_RECENT_OUTPUT_DIRECTORIES) {
      break;
    }
  }

  return Array.from(unique);
}

export function pushRecentOutputDirectory(
  existingDirectories: readonly string[],
  candidateDirectoryPath: string
): string[] {
  const normalizedCandidate = candidateDirectoryPath.trim();
  if (normalizedCandidate.length === 0) {
    return normalizeRecentOutputDirectories(existingDirectories);
  }

  const next = [normalizedCandidate, ...existingDirectories]
    .map((path) => path.trim())
    .filter((path) => path.length > 0);

  return normalizeRecentOutputDirectories(next);
}

export function createVideoWorkspaceProjectDocument(args: {
  savedAtUtc?: string;
  projectSnapshot: VideoWorkspaceProjectSnapshot;
  fitMode: VideoPreviewFitMode;
  textSettings: VideoWorkspaceTextSettings;
  overlaySettings: VideoOverlaySettings;
  outputSettings: VideoOutputSettings;
}): VideoWorkspaceProjectDocument {
  return {
    schemaVersion: 1,
    savedAtUtc: args.savedAtUtc ?? new Date().toISOString(),
    projectSnapshot: toVideoWorkspaceProjectSnapshot(
      fromVideoWorkspaceProjectSnapshot(args.projectSnapshot)
    ),
    fitMode: isVideoPreviewFitMode(args.fitMode) ? args.fitMode : "fill_crop",
    textSettings: patchVideoWorkspaceTextSettings(
      createDefaultVideoWorkspaceTextSettings(),
      args.textSettings
    ),
    overlaySettings: patchVideoOverlaySettings(
      createDefaultVideoOverlaySettings(),
      args.overlaySettings
    ),
    outputSettings: patchVideoOutputSettings(createDefaultVideoOutputSettings(), args.outputSettings)
  };
}

export function parseVideoWorkspaceProjectDocument(
  value: unknown
): VideoWorkspaceProjectDocument | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) return null;

  const fitMode = isVideoPreviewFitMode(candidate.fitMode)
    ? candidate.fitMode
    : "fill_crop";

  return {
    schemaVersion: 1,
    savedAtUtc: normalizeSavedAtUtc(candidate.savedAtUtc),
    projectSnapshot: toVideoWorkspaceProjectSnapshot(
      fromVideoWorkspaceProjectSnapshot(candidate.projectSnapshot)
    ),
    fitMode,
    textSettings: patchVideoWorkspaceTextSettings(
      createDefaultVideoWorkspaceTextSettings(),
      candidate.textSettings as Partial<VideoWorkspaceTextSettings>
    ),
    overlaySettings: patchVideoOverlaySettings(
      createDefaultVideoOverlaySettings(),
      candidate.overlaySettings as Partial<VideoOverlaySettings>
    ),
    outputSettings: patchVideoOutputSettings(
      createDefaultVideoOutputSettings(),
      candidate.outputSettings as Partial<VideoOutputSettings>
    )
  };
}

export function createVideoWorkspacePresetDocument(args: {
  savedAtUtc?: string;
  fitMode: VideoPreviewFitMode;
  textSettings: VideoWorkspaceTextSettings;
  overlaySettings: VideoOverlaySettings;
  outputPresetId: VideoOutputPresetId;
  overwritePolicy: VideoOutputSettings["overwritePolicy"];
}): VideoWorkspacePresetDocument {
  return {
    schemaVersion: 1,
    savedAtUtc: args.savedAtUtc ?? new Date().toISOString(),
    fitMode: isVideoPreviewFitMode(args.fitMode) ? args.fitMode : "fill_crop",
    textSettings: patchVideoWorkspaceTextSettings(
      createDefaultVideoWorkspaceTextSettings(),
      args.textSettings
    ),
    overlaySettings: patchVideoOverlaySettings(
      createDefaultVideoOverlaySettings(),
      args.overlaySettings
    ),
    outputPresetId: isVideoOutputPresetId(args.outputPresetId)
      ? args.outputPresetId
      : "youtube_1080p_standard",
    overwritePolicy: args.overwritePolicy === "replace" ? "replace" : "disallow"
  };
}

export function parseVideoWorkspacePresetDocument(
  value: unknown
): VideoWorkspacePresetDocument | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) return null;

  return {
    schemaVersion: 1,
    savedAtUtc: normalizeSavedAtUtc(candidate.savedAtUtc),
    fitMode: isVideoPreviewFitMode(candidate.fitMode) ? candidate.fitMode : "fill_crop",
    textSettings: patchVideoWorkspaceTextSettings(
      createDefaultVideoWorkspaceTextSettings(),
      candidate.textSettings as Partial<VideoWorkspaceTextSettings>
    ),
    overlaySettings: patchVideoOverlaySettings(
      createDefaultVideoOverlaySettings(),
      candidate.overlaySettings as Partial<VideoOverlaySettings>
    ),
    outputPresetId: isVideoOutputPresetId(candidate.outputPresetId)
      ? candidate.outputPresetId
      : "youtube_1080p_standard",
    overwritePolicy: candidate.overwritePolicy === "replace" ? "replace" : "disallow"
  };
}

export function createVideoWorkspacePreferencesDocument(args: {
  lastOutputPresetId: VideoOutputPresetId;
  recentOutputDirectories: readonly string[];
}): VideoWorkspacePreferencesDocument {
  return {
    schemaVersion: 1,
    lastOutputPresetId: isVideoOutputPresetId(args.lastOutputPresetId)
      ? args.lastOutputPresetId
      : "youtube_1080p_standard",
    recentOutputDirectories: normalizeRecentOutputDirectories(args.recentOutputDirectories)
  };
}

export function parseVideoWorkspacePreferencesDocument(
  value: unknown
): VideoWorkspacePreferencesDocument | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) return null;

  return {
    schemaVersion: 1,
    lastOutputPresetId: isVideoOutputPresetId(candidate.lastOutputPresetId)
      ? candidate.lastOutputPresetId
      : "youtube_1080p_standard",
    recentOutputDirectories: normalizeRecentOutputDirectories(candidate.recentOutputDirectories)
  };
}
