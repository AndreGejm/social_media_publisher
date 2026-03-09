import {
  isVideoTextLayoutPresetId,
  type VideoTextLayoutPresetId
} from "../../video-composition/api";

export type VideoWorkspaceTextSettings = {
  enabled: boolean;
  preset: VideoTextLayoutPresetId;
  titleText: string;
  artistText: string;
  fontSizePx: number;
  colorHex: string;
};

export type VideoWorkspaceTextSettingsIssueCode =
  | "TITLE_TOO_LONG"
  | "ARTIST_TOO_LONG"
  | "FONT_SIZE_OUT_OF_BOUNDS"
  | "INVALID_COLOR_HEX";

export type VideoWorkspaceTextSettingsIssue = {
  code: VideoWorkspaceTextSettingsIssueCode;
  message: string;
};

export type VideoWorkspaceTextSettingsSnapshot = {
  schemaVersion: 1;
  settings: VideoWorkspaceTextSettings;
};

const TITLE_MAX_LENGTH = 120;
const ARTIST_MAX_LENGTH = 120;
const MIN_FONT_SIZE_PX = 18;
const MAX_FONT_SIZE_PX = 72;
const DEFAULT_FONT_SIZE_PX = 34;

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function sanitizeTextInput(value: string, maxLength: number): string {
  const withoutControlChars = value.replace(/[\p{Cc}]/gu, "");
  return withoutControlChars.slice(0, maxLength);
}

function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FONT_SIZE_PX;
  return Math.min(MAX_FONT_SIZE_PX, Math.max(MIN_FONT_SIZE_PX, Math.round(value)));
}

function normalizeHexColor(value: string): string {
  if (!HEX_COLOR_PATTERN.test(value)) return "#FFFFFF";
  return value.toUpperCase();
}

export function createDefaultVideoWorkspaceTextSettings(): VideoWorkspaceTextSettings {
  return {
    enabled: false,
    preset: "none",
    titleText: "",
    artistText: "",
    fontSizePx: DEFAULT_FONT_SIZE_PX,
    colorHex: "#FFFFFF"
  };
}

export function patchVideoWorkspaceTextSettings(
  current: VideoWorkspaceTextSettings,
  patch: Partial<VideoWorkspaceTextSettings>
): VideoWorkspaceTextSettings {
  const nextPreset = patch.preset ?? current.preset;

  return {
    enabled: patch.enabled ?? current.enabled,
    preset: isVideoTextLayoutPresetId(nextPreset) ? nextPreset : current.preset,
    titleText:
      patch.titleText !== undefined
        ? sanitizeTextInput(patch.titleText, TITLE_MAX_LENGTH)
        : current.titleText,
    artistText:
      patch.artistText !== undefined
        ? sanitizeTextInput(patch.artistText, ARTIST_MAX_LENGTH)
        : current.artistText,
    fontSizePx:
      patch.fontSizePx !== undefined ? clampFontSize(patch.fontSizePx) : current.fontSizePx,
    colorHex:
      patch.colorHex !== undefined ? normalizeHexColor(patch.colorHex) : current.colorHex
  };
}

export function validateVideoWorkspaceTextSettings(
  settings: VideoWorkspaceTextSettings
): VideoWorkspaceTextSettingsIssue[] {
  const issues: VideoWorkspaceTextSettingsIssue[] = [];

  if (settings.titleText.length > TITLE_MAX_LENGTH) {
    issues.push({
      code: "TITLE_TOO_LONG",
      message: `Title exceeds ${TITLE_MAX_LENGTH} characters.`
    });
  }

  if (settings.artistText.length > ARTIST_MAX_LENGTH) {
    issues.push({
      code: "ARTIST_TOO_LONG",
      message: `Artist exceeds ${ARTIST_MAX_LENGTH} characters.`
    });
  }

  if (settings.fontSizePx < MIN_FONT_SIZE_PX || settings.fontSizePx > MAX_FONT_SIZE_PX) {
    issues.push({
      code: "FONT_SIZE_OUT_OF_BOUNDS",
      message: `Font size must stay between ${MIN_FONT_SIZE_PX}px and ${MAX_FONT_SIZE_PX}px.`
    });
  }

  if (!HEX_COLOR_PATTERN.test(settings.colorHex)) {
    issues.push({
      code: "INVALID_COLOR_HEX",
      message: "Text color must use #RRGGBB format."
    });
  }

  return issues;
}

export function toVideoWorkspaceTextSettingsSnapshot(
  settings: VideoWorkspaceTextSettings
): VideoWorkspaceTextSettingsSnapshot {
  return {
    schemaVersion: 1,
    settings
  };
}

function isVideoWorkspaceTextSettings(value: unknown): value is VideoWorkspaceTextSettings {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.enabled === "boolean" &&
    isVideoTextLayoutPresetId(candidate.preset) &&
    typeof candidate.titleText === "string" &&
    typeof candidate.artistText === "string" &&
    typeof candidate.fontSizePx === "number" &&
    typeof candidate.colorHex === "string"
  );
}

export function fromVideoWorkspaceTextSettingsSnapshot(
  snapshot: unknown
): VideoWorkspaceTextSettings {
  if (!snapshot || typeof snapshot !== "object") return createDefaultVideoWorkspaceTextSettings();

  const candidate = snapshot as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) return createDefaultVideoWorkspaceTextSettings();

  if (!isVideoWorkspaceTextSettings(candidate.settings)) {
    return createDefaultVideoWorkspaceTextSettings();
  }

  return patchVideoWorkspaceTextSettings(
    createDefaultVideoWorkspaceTextSettings(),
    candidate.settings
  );
}

export const VIDEO_WORKSPACE_TEXT_BOUNDS = {
  titleMaxLength: TITLE_MAX_LENGTH,
  artistMaxLength: ARTIST_MAX_LENGTH,
  minFontSizePx: MIN_FONT_SIZE_PX,
  maxFontSizePx: MAX_FONT_SIZE_PX
} as const;
