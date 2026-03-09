import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  videoRenderCancel,
  videoRenderCheckSourcePath,
  videoRenderGetEnvironmentDiagnostics,
  videoRenderOpenOutputFolder,
  videoRenderResult,
  videoRenderStart,
  videoRenderStatus,
  videoRenderValidate
} from "./commands";
import type { VideoRenderRequest } from "./types";

const invokeCommandMock = vi.fn();

vi.mock("../core", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) =>
    invokeCommandMock(command, args),
  isUiAppError: (error: unknown) =>
    Boolean(
      error &&
        typeof error === "object" &&
        "code" in (error as Record<string, unknown>) &&
        "message" in (error as Record<string, unknown>)
    )
}));

function createRequest(): VideoRenderRequest {
  return {
    requestVersion: 1,
    requestId: "vwreq_contract_test",
    media: {
      imageFileName: "cover.png",
      audioFileName: "mix.wav",
      imageExtension: "png",
      audioExtension: "wav"
    },
    composition: {
      widthPx: 1920,
      heightPx: 1080,
      frameRate: 30,
      fitMode: "fill_crop",
      text: {
        enabled: false,
        preset: "none",
        titleText: "",
        artistText: "",
        fontSizePx: 34,
        colorHex: "#ffffff"
      },
      overlay: {
        enabled: false,
        style: "waveform_strip",
        opacity: 0.32,
        intensity: 0.5,
        smoothing: 0.45,
        position: "bottom",
        themeColorHex: "#44c8ff"
      }
    },
    output: {
      presetId: "youtube_1080p_standard",
      outputFilePath: "C:\\Exports\\session-01.mp4",
      overwritePolicy: "replace",
      container: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      pixelFormat: "yuv420p",
      videoBitrateKbps: 8000,
      audioBitrateKbps: 192
    }
  };
}

describe("tauri/video commands", () => {
  beforeEach(() => {
    invokeCommandMock.mockReset();
  });

  it("validates and forwards render validate command", async () => {
    invokeCommandMock.mockResolvedValue({
      ok: true,
      issues: []
    });

    const request = createRequest();
    const response = await videoRenderValidate(request);

    expect(response.ok).toBe(true);
    expect(invokeCommandMock).toHaveBeenCalledWith("video_render_validate", {
      request
    });
  });

  it("maps backend errors to UiAppError envelope", async () => {
    invokeCommandMock.mockRejectedValue({
      code: "VIDEO_RENDER_INVALID_REQUEST",
      message: "invalid request from backend"
    });

    await expect(videoRenderStart(createRequest())).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      message: "invalid request from backend"
    });
  });

  it("rejects invalid request input before IPC", async () => {
    const request = {
      ...createRequest(),
      output: {
        ...createRequest().output,
        container: "mov"
      }
    } as unknown as VideoRenderRequest;

    await expect(videoRenderStart(request)).rejects.toMatchObject({
      code: "INVALID_ARGUMENT"
    });
    expect(invokeCommandMock).not.toHaveBeenCalled();
  });

  it("uses typed command routing for status cancel and result", async () => {
    invokeCommandMock
      .mockResolvedValueOnce({
        jobId: "job_1",
        state: "running",
        percent: 35,
        stage: "mock_render",
        frameIndex: 350,
        totalFrames: 1000,
        encodedSeconds: 10,
        message: null,
        updatedAtUtc: "2026-03-09T10:00:00Z"
      })
      .mockResolvedValueOnce({
        jobId: "job_1",
        state: "canceled",
        canceled: true
      })
      .mockResolvedValueOnce({
        jobId: "job_1",
        state: "canceled",
        success: null,
        failure: {
          jobId: "job_1",
          code: "canceled_by_user",
          message: "Render canceled by user.",
          retryable: true,
          details: null
        }
      });

    const status = await videoRenderStatus("job_1");
    const cancel = await videoRenderCancel("job_1");
    const result = await videoRenderResult("job_1");

    expect(status.state).toBe("running");
    expect(cancel.canceled).toBe(true);
    expect(result.failure?.code).toBe("canceled_by_user");

    expect(invokeCommandMock).toHaveBeenNthCalledWith(1, "video_render_status", {
      jobId: "job_1"
    });
    expect(invokeCommandMock).toHaveBeenNthCalledWith(2, "video_render_cancel", {
      jobId: "job_1"
    });
    expect(invokeCommandMock).toHaveBeenNthCalledWith(3, "video_render_result", {
      jobId: "job_1"
    });
  });

  it("returns sanitized diagnostics payload", async () => {
    invokeCommandMock.mockResolvedValue({
      ffmpeg: {
        available: true,
        source: "bundled_resource",
        executablePath: "C:\\Program Files\\Skald\\resources\\ffmpeg\\win32\\ffmpeg.exe",
        version: "ffmpeg version 7.0",
        message: null
      },
      outputDirectory: {
        directoryPath: "C:\\Exports",
        exists: true,
        writable: true,
        message: null
      },
      renderCapable: true,
      blockingReasons: []
    });

    const response = await videoRenderGetEnvironmentDiagnostics("C:\\Exports");

    expect(response.ffmpeg.available).toBe(true);
    expect(response.ffmpeg.source).toBe("bundled_resource");
    expect(response.outputDirectory?.writable).toBe(true);
    expect(invokeCommandMock).toHaveBeenCalledWith(
      "video_render_get_environment_diagnostics",
      { outputDirectoryPath: "C:\\Exports" }
    );
  });

  it("forwards source-path check and open-output-folder commands", async () => {
    invokeCommandMock
      .mockResolvedValueOnce({
        sourcePath: "C:\\Media\\cover.png",
        exists: true,
        isFile: true
      })
      .mockResolvedValueOnce({
        opened: true,
        directoryPath: "C:\\Exports"
      });

    const sourceCheck = await videoRenderCheckSourcePath("C:\\Media\\cover.png");
    const openFolder = await videoRenderOpenOutputFolder("C:\\Exports\\song.mp4");

    expect(sourceCheck.exists).toBe(true);
    expect(openFolder.opened).toBe(true);
    expect(invokeCommandMock).toHaveBeenNthCalledWith(1, "video_render_check_source_path", {
      sourcePath: "C:\\Media\\cover.png"
    });
    expect(invokeCommandMock).toHaveBeenNthCalledWith(2, "video_render_open_output_folder", {
      outputFilePath: "C:\\Exports\\song.mp4"
    });
  });
});
