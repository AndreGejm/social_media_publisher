import { describe, expect, it } from "vitest";

import {
  clampVolumeScalar,
  isPlaybackPositionUnchanged,
  normalizePlaybackPositionSeconds,
  volumePercentToScalar
} from "./transportMath";

describe("transportMath", () => {
  it("clamps volume scalar to [0, 1]", () => {
    expect(clampVolumeScalar(-1)).toBe(0);
    expect(clampVolumeScalar(0.42)).toBe(0.42);
    expect(clampVolumeScalar(3)).toBe(1);
    expect(clampVolumeScalar(Number.NaN)).toBe(1);
  });

  it("converts volume percent to scalar safely", () => {
    expect(volumePercentToScalar(50)).toBe(0.5);
    expect(volumePercentToScalar(-20)).toBe(0);
    expect(volumePercentToScalar(200)).toBe(1);
    expect(volumePercentToScalar(Number.NaN)).toBe(1);
  });

  it("normalizes playback position to finite non-negative values", () => {
    expect(normalizePlaybackPositionSeconds(12.34)).toBe(12.34);
    expect(normalizePlaybackPositionSeconds(-5)).toBe(0);
    expect(normalizePlaybackPositionSeconds(Number.NaN)).toBe(0);
  });

  it("detects unchanged playback position within epsilon", () => {
    expect(isPlaybackPositionUnchanged(10, 10.0005)).toBe(true);
    expect(isPlaybackPositionUnchanged(10, 10.002)).toBe(false);
  });
});
