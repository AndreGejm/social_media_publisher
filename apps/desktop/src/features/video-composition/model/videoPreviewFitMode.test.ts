import { describe, expect, it } from "vitest";

import {
  resolveVideoPreviewFitPresentation,
  VIDEO_PREVIEW_FIT_MODE_OPTIONS
} from "./videoPreviewFitMode";

describe("videoPreviewFitMode", () => {
  it("maps fill_crop to cover with no bars", () => {
    const presentation = resolveVideoPreviewFitPresentation("fill_crop");
    expect(presentation.cssObjectFit).toBe("cover");
    expect(presentation.showsBars).toBe(false);
  });

  it("maps fit_bars to contain with bars", () => {
    const presentation = resolveVideoPreviewFitPresentation("fit_bars");
    expect(presentation.cssObjectFit).toBe("contain");
    expect(presentation.showsBars).toBe(true);
  });

  it("maps stretch to fill with no bars", () => {
    const presentation = resolveVideoPreviewFitPresentation("stretch");
    expect(presentation.cssObjectFit).toBe("fill");
    expect(presentation.showsBars).toBe(false);
  });

  it("provides deterministic option ordering", () => {
    expect(VIDEO_PREVIEW_FIT_MODE_OPTIONS.map((option) => option.mode)).toEqual([
      "fill_crop",
      "fit_bars",
      "stretch"
    ]);
  });
});
