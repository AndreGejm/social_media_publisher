export type VideoOutputPresetId =
  | "youtube_1080p_standard"
  | "youtube_1440p_standard"
  | "youtube_1080p_audio_priority";

export type VideoOutputPreset = {
  id: VideoOutputPresetId;
  label: string;
  widthPx: number;
  heightPx: number;
  frameRate: 30;
  container: "mp4";
  videoCodec: "h264";
  audioCodec: "aac";
  pixelFormat: "yuv420p";
  videoBitrateKbps: number;
  audioBitrateKbps: 192 | 256 | 320;
};

export const VIDEO_OUTPUT_PRESETS: readonly VideoOutputPreset[] = [
  {
    id: "youtube_1080p_standard",
    label: "YouTube 1080p Standard",
    widthPx: 1920,
    heightPx: 1080,
    frameRate: 30,
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    pixelFormat: "yuv420p",
    videoBitrateKbps: 8000,
    audioBitrateKbps: 256
  },
  {
    id: "youtube_1440p_standard",
    label: "YouTube 1440p Standard",
    widthPx: 2560,
    heightPx: 1440,
    frameRate: 30,
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    pixelFormat: "yuv420p",
    videoBitrateKbps: 16000,
    audioBitrateKbps: 320
  },
  {
    id: "youtube_1080p_audio_priority",
    label: "YouTube 1080p Audio Priority",
    widthPx: 1920,
    heightPx: 1080,
    frameRate: 30,
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    pixelFormat: "yuv420p",
    videoBitrateKbps: 6000,
    audioBitrateKbps: 320
  }
] as const;

const VIDEO_OUTPUT_PRESET_BY_ID = new Map(
  VIDEO_OUTPUT_PRESETS.map((preset) => [preset.id, preset] as const)
);

export function isVideoOutputPresetId(value: unknown): value is VideoOutputPresetId {
  return typeof value === "string" && VIDEO_OUTPUT_PRESET_BY_ID.has(value as VideoOutputPresetId);
}

export function resolveVideoOutputPreset(presetId: VideoOutputPresetId): VideoOutputPreset {
  return VIDEO_OUTPUT_PRESET_BY_ID.get(presetId) ?? VIDEO_OUTPUT_PRESETS[0];
}
