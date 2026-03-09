export type OverlayStyle = "waveform_strip";

export type OverlayPosition = "top" | "bottom";

export type VideoOverlaySettings = {
  enabled: boolean;
  style: OverlayStyle;
  opacity: number;
  intensity: number;
  smoothing: number;
  position: OverlayPosition;
  themeColorHex: string;
  barCount: number;
};

export type OverlayAnalysisStatus = "idle" | "loading" | "ready" | "error";

export type AudioWaveformAnalysis = {
  envelope: readonly number[];
  sampleRateHz: number | null;
  channels: number | null;
  durationSeconds: number | null;
  dataFormat: "wav_pcm" | "wav_float" | "wav_byte_fallback";
  sourceFileName: string;
};

export type OverlayAnalysisErrorCode =
  | "FILE_READ_FAILED"
  | "INVALID_WAV_HEADER"
  | "UNSUPPORTED_WAV_FORMAT"
  | "MISSING_WAV_DATA_CHUNK"
  | "EMPTY_AUDIO_DATA";

export class OverlayAnalysisError extends Error {
  readonly code: OverlayAnalysisErrorCode;

  constructor(code: OverlayAnalysisErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "OverlayAnalysisError";
  }
}

export const OVERLAY_SETTINGS_BOUNDS = {
  opacityMin: 0,
  opacityMax: 1,
  intensityMin: 0,
  intensityMax: 1,
  smoothingMin: 0,
  smoothingMax: 1,
  barCountMin: 16,
  barCountMax: 128
} as const;

const DEFAULT_OVERLAY_COLOR = "#7ED957";
const OVERLAY_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normalizeHexColor(colorHex: string): string {
  if (!OVERLAY_COLOR_PATTERN.test(colorHex)) return DEFAULT_OVERLAY_COLOR;
  return colorHex.toUpperCase();
}

function normalizeBarCount(value: number): number {
  if (!Number.isFinite(value)) return 56;
  return Math.round(clamp(value, OVERLAY_SETTINGS_BOUNDS.barCountMin, OVERLAY_SETTINGS_BOUNDS.barCountMax));
}

export function createDefaultVideoOverlaySettings(): VideoOverlaySettings {
  return {
    enabled: false,
    style: "waveform_strip",
    opacity: 0.32,
    intensity: 0.5,
    smoothing: 0.45,
    position: "bottom",
    themeColorHex: DEFAULT_OVERLAY_COLOR,
    barCount: 56
  };
}

export function patchVideoOverlaySettings(
  current: VideoOverlaySettings,
  patch: Partial<VideoOverlaySettings>
): VideoOverlaySettings {
  return {
    enabled: patch.enabled ?? current.enabled,
    style: "waveform_strip",
    opacity:
      patch.opacity !== undefined
        ? clamp(patch.opacity, OVERLAY_SETTINGS_BOUNDS.opacityMin, OVERLAY_SETTINGS_BOUNDS.opacityMax)
        : current.opacity,
    intensity:
      patch.intensity !== undefined
        ? clamp(patch.intensity, OVERLAY_SETTINGS_BOUNDS.intensityMin, OVERLAY_SETTINGS_BOUNDS.intensityMax)
        : current.intensity,
    smoothing:
      patch.smoothing !== undefined
        ? clamp(patch.smoothing, OVERLAY_SETTINGS_BOUNDS.smoothingMin, OVERLAY_SETTINGS_BOUNDS.smoothingMax)
        : current.smoothing,
    position: patch.position === "top" ? "top" : patch.position === "bottom" ? "bottom" : current.position,
    themeColorHex:
      patch.themeColorHex !== undefined
        ? normalizeHexColor(patch.themeColorHex)
        : current.themeColorHex,
    barCount: patch.barCount !== undefined ? normalizeBarCount(patch.barCount) : current.barCount
  };
}

type ParsedWavHeader = {
  audioFormat: number;
  channels: number;
  sampleRateHz: number;
  bitsPerSample: number;
  blockAlign: number;
  dataOffset: number;
  dataLength: number;
};

function readAscii(view: DataView, offset: number, length: number): string {
  let text = "";
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(view.getUint8(offset + index));
  }
  return text;
}

function parseWavHeader(bytes: Uint8Array): ParsedWavHeader {
  if (bytes.byteLength < 44) {
    throw new OverlayAnalysisError("INVALID_WAV_HEADER", "WAV file header is too short.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") {
    throw new OverlayAnalysisError("INVALID_WAV_HEADER", "WAV file missing RIFF/WAVE signature.");
  }

  let offset = 12;
  let fmt: Omit<ParsedWavHeader, "dataOffset" | "dataLength"> | null = null;
  let dataOffset = -1;
  let dataLength = -1;

  while (offset + 8 <= view.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;

    if (chunkDataOffset + chunkSize > view.byteLength) {
      break;
    }

    if (chunkId === "fmt ") {
      if (chunkSize < 16) {
        throw new OverlayAnalysisError("INVALID_WAV_HEADER", "WAV fmt chunk is truncated.");
      }

      fmt = {
        audioFormat: view.getUint16(chunkDataOffset, true),
        channels: view.getUint16(chunkDataOffset + 2, true),
        sampleRateHz: view.getUint32(chunkDataOffset + 4, true),
        blockAlign: view.getUint16(chunkDataOffset + 12, true),
        bitsPerSample: view.getUint16(chunkDataOffset + 14, true)
      };
    }

    if (chunkId === "data") {
      dataOffset = chunkDataOffset;
      dataLength = chunkSize;
      break;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (!fmt) {
    throw new OverlayAnalysisError("INVALID_WAV_HEADER", "WAV fmt chunk was not found.");
  }

  if (dataOffset < 0 || dataLength <= 0) {
    throw new OverlayAnalysisError("MISSING_WAV_DATA_CHUNK", "WAV data chunk was not found.");
  }

  if (fmt.channels <= 0 || fmt.blockAlign <= 0) {
    throw new OverlayAnalysisError("INVALID_WAV_HEADER", "WAV channels or block alignment is invalid.");
  }

  return {
    ...fmt,
    dataOffset,
    dataLength: Math.min(dataLength, bytes.byteLength - dataOffset)
  };
}

function decodeChannelSample(params: {
  bytes: Uint8Array;
  view: DataView;
  sampleOffset: number;
  audioFormat: number;
  bitsPerSample: number;
}): number {
  const { bytes, view, sampleOffset, audioFormat, bitsPerSample } = params;

  if (audioFormat === 3 && bitsPerSample === 32) {
    return clamp(view.getFloat32(sampleOffset, true), -1, 1);
  }

  if (audioFormat !== 1) {
    throw new OverlayAnalysisError(
      "UNSUPPORTED_WAV_FORMAT",
      `Unsupported WAV format ${audioFormat} with ${bitsPerSample} bits per sample.`
    );
  }

  if (bitsPerSample === 8) {
    return (bytes[sampleOffset] - 128) / 128;
  }

  if (bitsPerSample === 16) {
    return view.getInt16(sampleOffset, true) / 32768;
  }

  if (bitsPerSample === 24) {
    const low = bytes[sampleOffset];
    const mid = bytes[sampleOffset + 1];
    const high = bytes[sampleOffset + 2];
    let value = low | (mid << 8) | (high << 16);
    if (value & 0x800000) {
      value |= ~0xffffff;
    }
    return value / 8388608;
  }

  if (bitsPerSample === 32) {
    return view.getInt32(sampleOffset, true) / 2147483648;
  }

  throw new OverlayAnalysisError(
    "UNSUPPORTED_WAV_FORMAT",
    `Unsupported PCM bit depth ${bitsPerSample}.`
  );
}

export function analyzeWavBytesToEnvelope(
  bytes: Uint8Array,
  args?: { envelopeBins?: number; sourceFileName?: string }
): AudioWaveformAnalysis {
  const envelopeBins = Math.max(32, Math.round(args?.envelopeBins ?? 512));
  const sourceFileName = args?.sourceFileName ?? "unknown.wav";

  const header = parseWavHeader(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const frameCount = Math.floor(header.dataLength / header.blockAlign);

  if (frameCount <= 0) {
    throw new OverlayAnalysisError("EMPTY_AUDIO_DATA", "WAV file does not contain audio frames.");
  }

  const envelope: number[] = [];
  const framesPerBin = Math.max(1, Math.floor(frameCount / envelopeBins));

  for (let binIndex = 0; binIndex < envelopeBins; binIndex += 1) {
    const startFrame = binIndex * framesPerBin;
    const endFrame = binIndex === envelopeBins - 1 ? frameCount : Math.min(frameCount, startFrame + framesPerBin);

    if (startFrame >= frameCount) {
      envelope.push(0);
      continue;
    }

    const sampleStride = Math.max(1, Math.floor((endFrame - startFrame) / 256));
    let sumAbs = 0;
    let sampled = 0;

    for (let frame = startFrame; frame < endFrame; frame += sampleStride) {
      const frameOffset = header.dataOffset + frame * header.blockAlign;
      const channelOffset = frameOffset;
      const sample = decodeChannelSample({
        bytes,
        view,
        sampleOffset: channelOffset,
        audioFormat: header.audioFormat,
        bitsPerSample: header.bitsPerSample
      });
      sumAbs += Math.abs(sample);
      sampled += 1;
    }

    const averageEnergy = sampled > 0 ? sumAbs / sampled : 0;
    envelope.push(clamp(averageEnergy, 0, 1));
  }

  const maxValue = envelope.reduce((max, value) => Math.max(max, value), 0);
  const normalizedEnvelope =
    maxValue > 0 ? envelope.map((value) => clamp(value / maxValue, 0, 1)) : envelope.map(() => 0);

  const format =
    header.audioFormat === 3
      ? "wav_float"
      : header.audioFormat === 1 && (header.bitsPerSample === 8 || header.bitsPerSample === 16 || header.bitsPerSample === 24 || header.bitsPerSample === 32)
        ? "wav_pcm"
        : "wav_byte_fallback";

  return {
    envelope: normalizedEnvelope,
    sampleRateHz: header.sampleRateHz,
    channels: header.channels,
    durationSeconds: header.sampleRateHz > 0 ? frameCount / header.sampleRateHz : null,
    dataFormat: format,
    sourceFileName
  };
}

export async function analyzeAudioFileToEnvelope(
  file: File,
  args?: { envelopeBins?: number }
): Promise<AudioWaveformAnalysis> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    return analyzeWavBytesToEnvelope(new Uint8Array(arrayBuffer), {
      envelopeBins: args?.envelopeBins,
      sourceFileName: file.name
    });
  } catch (error) {
    if (error instanceof OverlayAnalysisError) {
      throw error;
    }

    throw new OverlayAnalysisError(
      "FILE_READ_FAILED",
      `Failed to analyze overlay source "${file.name}".`
    );
  }
}

function smoothEnvelopeAt(envelope: readonly number[], index: number, smoothing: number): number {
  const radius = Math.round(clamp(smoothing, 0, 1) * 4);
  if (radius <= 0) return envelope[index] ?? 0;

  let sum = 0;
  let count = 0;

  for (let cursor = index - radius; cursor <= index + radius; cursor += 1) {
    if (cursor < 0 || cursor >= envelope.length) continue;
    sum += envelope[cursor];
    count += 1;
  }

  return count > 0 ? sum / count : 0;
}

export function deriveWaveformStripBars(args: {
  analysis: AudioWaveformAnalysis | null;
  progressRatio: number;
  settings: VideoOverlaySettings;
}): number[] {
  const { analysis, settings } = args;
  if (!analysis || analysis.envelope.length === 0) return [];

  const progressRatio = clamp(args.progressRatio, 0, 1);
  const barCount = normalizeBarCount(settings.barCount);
  const envelope = analysis.envelope;

  const centerIndex = Math.round(progressRatio * (envelope.length - 1));
  const halfBars = Math.floor(barCount / 2);

  const bars: number[] = [];
  for (let barIndex = 0; barIndex < barCount; barIndex += 1) {
    const sourceIndex = clamp(centerIndex - halfBars + barIndex, 0, envelope.length - 1);
    const smoothed = smoothEnvelopeAt(envelope, sourceIndex, settings.smoothing);
    const scaled = clamp(smoothed * (0.3 + settings.intensity * 0.7), 0, 1);
    bars.push(scaled);
  }

  return bars;
}

