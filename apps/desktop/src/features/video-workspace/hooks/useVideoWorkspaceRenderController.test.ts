import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDefaultVideoOverlaySettings } from "../../overlay-engine/api";
import { createDefaultVideoOutputSettings } from "../model/videoOutputSettings";
import type { VideoRenderRequestBuildInput } from "../model/videoRenderRequest";
import { createDefaultVideoWorkspaceTextSettings } from "../model/videoWorkspaceTextSettings";
import { useVideoWorkspaceRenderController } from "./useVideoWorkspaceRenderController";

const tauriVideoMocks = vi.hoisted(() => ({
  diagnostics: vi.fn(),
  start: vi.fn(),
  status: vi.fn(),
  cancel: vi.fn(),
  result: vi.fn(),
  openOutputFolder: vi.fn()
}));

vi.mock("../../../services/tauri/tauriClient", () => ({
  isUiAppError: (error: unknown): error is { code: string; message: string } => {
    if (!error || typeof error !== "object") return false;
    const candidate = error as Record<string, unknown>;
    return typeof candidate.code === "string" && typeof candidate.message === "string";
  },
  videoRenderGetEnvironmentDiagnostics: tauriVideoMocks.diagnostics,
  videoRenderStart: tauriVideoMocks.start,
  videoRenderStatus: tauriVideoMocks.status,
  videoRenderCancel: tauriVideoMocks.cancel,
  videoRenderResult: tauriVideoMocks.result,
  videoRenderOpenOutputFolder: tauriVideoMocks.openOutputFolder
}));

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

function buildDiagnostics(outputDirectoryPath: string) {
  return {
    ffmpeg: {
      available: true,
      source: "bundled_resource" as const,
      executablePath: "C:/ffmpeg/ffmpeg.exe",
      version: "6.1",
      message: null
    },
    outputDirectory: {
      directoryPath: outputDirectoryPath,
      exists: true,
      writable: true,
      message: null
    },
    renderCapable: true,
    blockingReasons: []
  };
}

function createBuildInput(outputDirectoryPath: string): VideoRenderRequestBuildInput {
  return {
    imageAsset: null,
    audioAsset: null,
    fitMode: "fill_crop",
    textSettings: createDefaultVideoWorkspaceTextSettings(),
    overlaySettings: createDefaultVideoOverlaySettings(),
    outputSettings: {
      ...createDefaultVideoOutputSettings(),
      outputDirectoryPath
    }
  };
}

afterEach(() => {
  tauriVideoMocks.diagnostics.mockReset();
  tauriVideoMocks.start.mockReset();
  tauriVideoMocks.status.mockReset();
  tauriVideoMocks.cancel.mockReset();
  tauriVideoMocks.result.mockReset();
  tauriVideoMocks.openOutputFolder.mockReset();
});

describe("useVideoWorkspaceRenderController", () => {
  it("ignores stale diagnostics completion when a newer refresh resolves first", async () => {
    const first = deferred<ReturnType<typeof buildDiagnostics>>();
    const second = deferred<ReturnType<typeof buildDiagnostics>>();

    tauriVideoMocks.diagnostics
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { result, rerender } = renderHook(
      (props: { outputDirectoryPath: string }) =>
        useVideoWorkspaceRenderController(createBuildInput(props.outputDirectoryPath)),
      {
        initialProps: {
          outputDirectoryPath: "C:/Exports/first"
        }
      }
    );

    act(() => {
      void result.current.refreshDiagnostics();
    });

    rerender({
      outputDirectoryPath: "C:/Exports/second"
    });

    act(() => {
      void result.current.refreshDiagnostics();
    });

    expect(tauriVideoMocks.diagnostics).toHaveBeenNthCalledWith(1, "C:/Exports/first");
    expect(tauriVideoMocks.diagnostics).toHaveBeenNthCalledWith(2, "C:/Exports/second");

    await act(async () => {
      second.resolve(buildDiagnostics("C:/Exports/second"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.state.diagnostics?.outputDirectory?.directoryPath).toBe("C:/Exports/second");
    });

    await act(async () => {
      first.resolve(buildDiagnostics("C:/Exports/first"));
      await Promise.resolve();
    });

    expect(result.current.state.diagnostics?.outputDirectory?.directoryPath).toBe("C:/Exports/second");
    expect(result.current.state.diagnosticsErrorMessage).toBeNull();
  });

  it("ignores stale diagnostics failures after a newer refresh has already succeeded", async () => {
    const first = deferred<ReturnType<typeof buildDiagnostics>>();
    const second = deferred<ReturnType<typeof buildDiagnostics>>();

    tauriVideoMocks.diagnostics
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { result, rerender } = renderHook(
      (props: { outputDirectoryPath: string }) =>
        useVideoWorkspaceRenderController(createBuildInput(props.outputDirectoryPath)),
      {
        initialProps: {
          outputDirectoryPath: "C:/Exports/first"
        }
      }
    );

    act(() => {
      void result.current.refreshDiagnostics();
    });

    rerender({
      outputDirectoryPath: "C:/Exports/second"
    });

    act(() => {
      void result.current.refreshDiagnostics();
    });

    await act(async () => {
      second.resolve(buildDiagnostics("C:/Exports/second"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.state.diagnostics?.outputDirectory?.directoryPath).toBe("C:/Exports/second");
    });

    await act(async () => {
      first.reject(new Error("Stale diagnostics failure"));
      await Promise.resolve();
    });

    expect(result.current.state.diagnostics?.outputDirectory?.directoryPath).toBe("C:/Exports/second");
    expect(result.current.state.diagnosticsErrorMessage).toBeNull();
  });
});
