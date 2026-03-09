import { describe, expect, it } from "vitest";

import {
  createDefaultVideoWorkspaceTextSettings,
  fromVideoWorkspaceTextSettingsSnapshot,
  patchVideoWorkspaceTextSettings,
  toVideoWorkspaceTextSettingsSnapshot,
  validateVideoWorkspaceTextSettings,
  VIDEO_WORKSPACE_TEXT_BOUNDS
} from "./videoWorkspaceTextSettings";

describe("videoWorkspaceTextSettings", () => {
  it("creates bounded default settings", () => {
    const defaults = createDefaultVideoWorkspaceTextSettings();

    expect(defaults.enabled).toBe(false);
    expect(defaults.preset).toBe("none");
    expect(defaults.fontSizePx).toBeGreaterThanOrEqual(VIDEO_WORKSPACE_TEXT_BOUNDS.minFontSizePx);
  });

  it("patches and sanitizes text settings", () => {
    const defaults = createDefaultVideoWorkspaceTextSettings();

    const next = patchVideoWorkspaceTextSettings(defaults, {
      enabled: true,
      preset: "title_artist_bottom_left",
      titleText: "Title\u0000",
      artistText: "Artist\u0007",
      fontSizePx: 999,
      colorHex: "#00ff88"
    });

    expect(next.enabled).toBe(true);
    expect(next.preset).toBe("title_artist_bottom_left");
    expect(next.titleText).toBe("Title");
    expect(next.artistText).toBe("Artist");
    expect(next.fontSizePx).toBe(VIDEO_WORKSPACE_TEXT_BOUNDS.maxFontSizePx);
    expect(next.colorHex).toBe("#00FF88");
  });

  it("returns validation issues for out-of-bounds raw state", () => {
    const issues = validateVideoWorkspaceTextSettings({
      enabled: true,
      preset: "title_bottom_center",
      titleText: "t",
      artistText: "a",
      fontSizePx: 10,
      colorHex: "not-a-color"
    });

    expect(issues.map((issue) => issue.code)).toContain("FONT_SIZE_OUT_OF_BOUNDS");
    expect(issues.map((issue) => issue.code)).toContain("INVALID_COLOR_HEX");
  });

  it("serializes and hydrates text settings deterministically", () => {
    const settings = patchVideoWorkspaceTextSettings(createDefaultVideoWorkspaceTextSettings(), {
      enabled: true,
      preset: "title_artist_center_stack",
      titleText: "Northern Lights",
      artistText: "Skald",
      fontSizePx: 42,
      colorHex: "#112233"
    });

    const snapshot = toVideoWorkspaceTextSettingsSnapshot(settings);
    const hydrated = fromVideoWorkspaceTextSettingsSnapshot(snapshot);

    expect(hydrated).toEqual({
      ...settings,
      colorHex: "#112233".toUpperCase()
    });
  });

  it("falls back to defaults for invalid snapshot", () => {
    const hydrated = fromVideoWorkspaceTextSettingsSnapshot({ schemaVersion: 2, settings: {} });

    expect(hydrated).toEqual(createDefaultVideoWorkspaceTextSettings());
  });
});
