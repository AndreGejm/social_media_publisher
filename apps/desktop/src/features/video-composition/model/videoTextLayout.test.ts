import { describe, expect, it } from "vitest";

import {
  isVideoTextLayoutPresetId,
  resolveVideoTextLayoutPreset,
  VIDEO_TEXT_LAYOUT_PRESETS
} from "./videoTextLayout";

describe("videoTextLayout", () => {
  it("defines deterministic preset ordering", () => {
    expect(VIDEO_TEXT_LAYOUT_PRESETS.map((preset) => preset.id)).toEqual([
      "none",
      "title_bottom_center",
      "title_artist_bottom_left",
      "title_artist_center_stack"
    ]);
  });

  it("resolves known preset data", () => {
    const preset = resolveVideoTextLayoutPreset("title_artist_bottom_left");
    expect(preset.overlayClassName).toBe("layout-title-artist-bottom-left");
    expect(preset.supportsArtist).toBe(true);
  });

  it("validates preset id strings", () => {
    expect(isVideoTextLayoutPresetId("title_bottom_center")).toBe(true);
    expect(isVideoTextLayoutPresetId("unknown")).toBe(false);
  });
});
