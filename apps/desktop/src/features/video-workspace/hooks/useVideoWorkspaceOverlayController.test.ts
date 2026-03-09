import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AudioWaveformAnalysis } from "../../overlay-engine/api";
import { useVideoWorkspaceOverlayController } from "./useVideoWorkspaceOverlayController";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {
    promise,
    resolve,
    reject
  };
}

function createFile(name: string, type: string): File {
  return new File(["stub"], name, { type });
}

function buildAnalysis(sourceFileName: string): AudioWaveformAnalysis {
  return {
    envelope: [0.1, 0.3, 0.8, 0.2],
    sampleRateHz: 44_100,
    channels: 2,
    durationSeconds: 5.2,
    dataFormat: "wav_pcm",
    sourceFileName
  };
}

describe("useVideoWorkspaceOverlayController", () => {
  it("ignores stale analysis completion when audio source changes", async () => {
    const first = deferred<AudioWaveformAnalysis>();
    const second = deferred<AudioWaveformAnalysis>();

    const analyzer = vi.fn((file: File) => {
      if (file.name === "first.wav") return first.promise;
      return second.promise;
    });

    const firstFile = createFile("first.wav", "audio/wav");
    const secondFile = createFile("second.wav", "audio/wav");

    const { result, rerender } = renderHook(
      (props: { file: File | null; progress: number }) =>
        useVideoWorkspaceOverlayController({
          audioFile: props.file,
          progressRatio: props.progress,
          analyzeAudioFile: analyzer
        }),
      {
        initialProps: {
          file: firstFile,
          progress: 0
        }
      }
    );

    expect(result.current.analysis.status).toBe("loading");

    rerender({
      file: secondFile,
      progress: 0
    });

    act(() => {
      first.resolve(buildAnalysis("first.wav"));
    });

    await Promise.resolve();

    expect(result.current.analysis.status).toBe("loading");

    act(() => {
      second.resolve(buildAnalysis("second.wav"));
    });

    await waitFor(() => {
      expect(result.current.analysis.status).toBe("ready");
    });

    expect(result.current.analysis.analysis?.sourceFileName).toBe("second.wav");
  });

  it("keeps overlay disabled by default with no bars", () => {
    const { result } = renderHook(() =>
      useVideoWorkspaceOverlayController({
        audioFile: null,
        progressRatio: 0
      })
    );

    expect(result.current.settings.enabled).toBe(false);
    expect(result.current.bars).toEqual([]);
  });
});
