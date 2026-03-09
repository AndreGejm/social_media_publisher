import { describe, expect, it } from "vitest";

import {
  analyzeWavBytesToEnvelope,
  createDefaultVideoOverlaySettings,
  deriveWaveformStripBars,
  patchVideoOverlaySettings,
  type AudioWaveformAnalysis
} from "./waveformStrip";

function createPcm16MonoWav(samples: readonly number[], sampleRateHz = 44_100): Uint8Array {
  const channelCount = 1;
  const bitsPerSample = 16;
  const blockAlign = channelCount * (bitsPerSample / 8);
  const byteRate = sampleRateHz * blockAlign;
  const dataLength = samples.length * blockAlign;
  const totalLength = 44 + dataLength;

  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);

  function writeAscii(offset: number, text: string): void {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  }

  writeAscii(0, "RIFF");
  view.setUint32(4, totalLength - 8, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, "data");
  view.setUint32(40, dataLength, true);

  let cursor = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    const intSample = Math.round(clamped * 32767);
    view.setInt16(cursor, intSample, true);
    cursor += 2;
  }

  return new Uint8Array(buffer);
}

describe("overlay-engine waveformStrip", () => {
  it("provides restrained default settings", () => {
    const defaults = createDefaultVideoOverlaySettings();

    expect(defaults.enabled).toBe(false);
    expect(defaults.style).toBe("waveform_strip");
    expect(defaults.opacity).toBeLessThanOrEqual(0.35);
    expect(defaults.intensity).toBeLessThanOrEqual(0.5);
  });

  it("clamps and normalizes patched settings", () => {
    const patched = patchVideoOverlaySettings(createDefaultVideoOverlaySettings(), {
      opacity: 7,
      intensity: -2,
      smoothing: 4,
      position: "top",
      themeColorHex: "#00aaee",
      barCount: 500
    });

    expect(patched.opacity).toBe(1);
    expect(patched.intensity).toBe(0);
    expect(patched.smoothing).toBe(1);
    expect(patched.position).toBe("top");
    expect(patched.themeColorHex).toBe("#00AAEE");
    expect(patched.barCount).toBe(128);
  });

  it("analyzes wav bytes deterministically for same input", () => {
    const wav = createPcm16MonoWav([0, 0.25, -0.4, 0.75, -0.2, 0.5, -0.8, 0.1]);

    const first = analyzeWavBytesToEnvelope(wav, { envelopeBins: 16, sourceFileName: "A.wav" });
    const second = analyzeWavBytesToEnvelope(wav, { envelopeBins: 16, sourceFileName: "A.wav" });

    expect(first).toEqual(second);
  });

  it("derives deterministic waveform strip bars", () => {
    const analysis: AudioWaveformAnalysis = {
      envelope: [0, 0.2, 0.9, 0.5, 0.1, 0.8, 0.4, 0.3],
      sampleRateHz: 44_100,
      channels: 2,
      durationSeconds: 2.1,
      dataFormat: "wav_pcm",
      sourceFileName: "mix.wav"
    };

    const settings = patchVideoOverlaySettings(createDefaultVideoOverlaySettings(), {
      enabled: true,
      barCount: 24,
      intensity: 0.8,
      smoothing: 0.25
    });

    const first = deriveWaveformStripBars({
      analysis,
      progressRatio: 0.42,
      settings
    });

    const second = deriveWaveformStripBars({
      analysis,
      progressRatio: 0.42,
      settings
    });

    expect(first).toEqual(second);
    expect(first).toHaveLength(24);
    expect(first.every((value) => value >= 0 && value <= 1)).toBe(true);
  });
});
