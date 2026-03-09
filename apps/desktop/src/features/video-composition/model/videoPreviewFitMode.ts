export type VideoPreviewFitMode = "fill_crop" | "fit_bars" | "stretch";

export type VideoPreviewFitPresentation = {
  mode: VideoPreviewFitMode;
  label: string;
  description: string;
  cssObjectFit: "cover" | "contain" | "fill";
  showsBars: boolean;
};

export const VIDEO_PREVIEW_FIT_MODE_OPTIONS: readonly VideoPreviewFitPresentation[] = [
  {
    mode: "fill_crop",
    label: "Fill / Crop",
    description: "Fill the frame and crop overflow edges.",
    cssObjectFit: "cover",
    showsBars: false
  },
  {
    mode: "fit_bars",
    label: "Fit With Bars",
    description: "Preserve full image with letterbox or pillar bars.",
    cssObjectFit: "contain",
    showsBars: true
  },
  {
    mode: "stretch",
    label: "Stretch",
    description: "Stretch image to frame bounds (distortion allowed).",
    cssObjectFit: "fill",
    showsBars: false
  }
] as const;

const VIDEO_PREVIEW_FIT_MODE_BY_ID = new Map(
  VIDEO_PREVIEW_FIT_MODE_OPTIONS.map((option) => [option.mode, option] as const)
);

export function resolveVideoPreviewFitPresentation(mode: VideoPreviewFitMode): VideoPreviewFitPresentation {
  return VIDEO_PREVIEW_FIT_MODE_BY_ID.get(mode) ?? VIDEO_PREVIEW_FIT_MODE_OPTIONS[0];
}
