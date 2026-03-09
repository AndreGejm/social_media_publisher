import { describe, expect, it } from "vitest";

import {
  isVideoOutputPresetId,
  resolveVideoOutputPreset,
  VIDEO_OUTPUT_PRESETS
} from "./videoOutputPresets";

describe("videoOutputPresets", () => {
  it("defines deterministic preset ordering", () => {
    expect(VIDEO_OUTPUT_PRESETS.map((preset) => preset.id)).toEqual([
      "youtube_1080p_standard",
      "youtube_1440p_standard",
      "youtube_1080p_audio_priority"
    ]);
  });

  it("resolves preset details", () => {
    const preset = resolveVideoOutputPreset("youtube_1440p_standard");

    expect(preset.widthPx).toBe(2560);
    expect(preset.heightPx).toBe(1440);
    expect(preset.audioBitrateKbps).toBe(320);
  });

  it("validates preset identifiers", () => {
    expect(isVideoOutputPresetId("youtube_1080p_standard")).toBe(true);
    expect(isVideoOutputPresetId("bad_preset")).toBe(false);
  });
});
