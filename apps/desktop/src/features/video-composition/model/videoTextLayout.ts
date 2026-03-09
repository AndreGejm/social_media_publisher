export type VideoTextLayoutPresetId =
  | "none"
  | "title_bottom_center"
  | "title_artist_bottom_left"
  | "title_artist_center_stack";

export type VideoTextLayoutPreset = {
  id: VideoTextLayoutPresetId;
  label: string;
  description: string;
  overlayClassName:
    | "layout-none"
    | "layout-title-bottom-center"
    | "layout-title-artist-bottom-left"
    | "layout-title-artist-center-stack";
  supportsArtist: boolean;
};

export const VIDEO_TEXT_LAYOUT_PRESETS: readonly VideoTextLayoutPreset[] = [
  {
    id: "none",
    label: "No Text",
    description: "Disable text rendering in preview and output.",
    overlayClassName: "layout-none",
    supportsArtist: false
  },
  {
    id: "title_bottom_center",
    label: "Title Bottom Center",
    description: "Single title near the bottom center.",
    overlayClassName: "layout-title-bottom-center",
    supportsArtist: false
  },
  {
    id: "title_artist_bottom_left",
    label: "Title + Artist Bottom Left",
    description: "Title and artist stacked at bottom left.",
    overlayClassName: "layout-title-artist-bottom-left",
    supportsArtist: true
  },
  {
    id: "title_artist_center_stack",
    label: "Title + Artist Center Stack",
    description: "Centered title and artist stack.",
    overlayClassName: "layout-title-artist-center-stack",
    supportsArtist: true
  }
] as const;

const PRESET_BY_ID = new Map(VIDEO_TEXT_LAYOUT_PRESETS.map((preset) => [preset.id, preset] as const));

export function isVideoTextLayoutPresetId(value: unknown): value is VideoTextLayoutPresetId {
  return typeof value === "string" && PRESET_BY_ID.has(value as VideoTextLayoutPresetId);
}

export function resolveVideoTextLayoutPreset(presetId: VideoTextLayoutPresetId): VideoTextLayoutPreset {
  return PRESET_BY_ID.get(presetId) ?? VIDEO_TEXT_LAYOUT_PRESETS[0];
}
