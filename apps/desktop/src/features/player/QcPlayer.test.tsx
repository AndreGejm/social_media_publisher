import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QcPlayer, type QcPlayerAnalysis } from "./QcPlayer";

function baseAnalysis(overrides?: Partial<QcPlayerAnalysis>): QcPlayerAnalysis {
  return {
    releaseTitle: "Test Track",
    releaseArtist: "Example Artist",
    trackFilePath: "C:\\fixtures\\test.wav",
    durationMs: 3000,
    peakData: [-12, -8, -6, -4],
    loudnessLufs: -14.2,
    sampleRateHz: 44_100,
    channels: 2,
    mediaFingerprint: "f".repeat(64),
    ...overrides
  };
}

describe("QcPlayer", () => {
  it("renders safely when peakData is empty and degrades metrics without throwing", () => {
    const audioRef = createRef<HTMLAudioElement>();

    render(
      <QcPlayer
        analysis={baseAnalysis({ peakData: [] })}
        currentTimeSec={0}
        isPlaying={false}
        onTogglePlay={() => undefined}
        onSeek={() => undefined}
        onTimeUpdate={() => undefined}
        onPlay={() => undefined}
        onPause={() => undefined}
        audioRef={audioRef}
        renderAudioElement={false}
      />
    );

    const waveform = screen.getByTestId("qc-waveform");
    expect(waveform).toBeInTheDocument();
    expect(waveform.querySelectorAll(".waveform-bar")).toHaveLength(0);
    expect(screen.getByTestId("qc-peak")).toHaveTextContent("n/a");
    expect(screen.getByTestId("qc-lufs")).toHaveTextContent("LUFS");
  });

  it("sanitizes untrusted title and artist text before rendering", () => {
    const audioRef = createRef<HTMLAudioElement>();
    render(
      <QcPlayer
        analysis={baseAnalysis({
          releaseTitle: "Bad\u0000Title\u202E",
          releaseArtist: "Artist\u0007Name"
        })}
        currentTimeSec={0}
        isPlaying={false}
        onTogglePlay={() => undefined}
        onSeek={() => undefined}
        onTimeUpdate={() => undefined}
        onPlay={() => undefined}
        onPause={() => undefined}
        audioRef={audioRef}
        renderAudioElement={false}
      />
    );

    expect(screen.getByText("Bad Title")).toBeInTheDocument();
    expect(screen.getByText("Artist Name")).toBeInTheDocument();
  });
});
