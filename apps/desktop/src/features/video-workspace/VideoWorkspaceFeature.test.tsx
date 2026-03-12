import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauriVideoMocks = vi.hoisted(() => ({
  start: vi.fn(),
  status: vi.fn(),
  cancel: vi.fn(),
  result: vi.fn(),
  diagnostics: vi.fn(),
  sourcePathCheck: vi.fn(),
  openOutputFolder: vi.fn(),
  pickFileDialog: vi.fn(),
  loadFileFromNativePath: vi.fn()
}));

vi.mock("../../services/tauri/tauriClient", () => ({
  isUiAppError: (error: unknown): error is { code: string; message: string } => {
    if (!error || typeof error !== "object") return false;
    const candidate = error as Record<string, unknown>;
    return typeof candidate.code === "string" && typeof candidate.message === "string";
  },
  videoRenderStart: tauriVideoMocks.start,
  videoRenderStatus: tauriVideoMocks.status,
  videoRenderCancel: tauriVideoMocks.cancel,
  videoRenderResult: tauriVideoMocks.result,
  videoRenderGetEnvironmentDiagnostics: tauriVideoMocks.diagnostics,
  videoRenderCheckSourcePath: tauriVideoMocks.sourcePathCheck,
  videoRenderOpenOutputFolder: tauriVideoMocks.openOutputFolder,
  pickFileDialog: tauriVideoMocks.pickFileDialog,
  loadFileFromNativePath: tauriVideoMocks.loadFileFromNativePath
}));

import VideoWorkspaceFeature from "./VideoWorkspaceFeature";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();

  const createObjectURL = vi.fn((blob: Blob) => {
    const fileName = blob instanceof File ? blob.name : "media";
    return `blob:${fileName}`;
  });
  const revokeObjectURL = vi.fn();

  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: createObjectURL
  });

  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: revokeObjectURL
  });

  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    writable: true,
    value: vi.fn().mockResolvedValue(undefined)
  });

  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    writable: true,
    value: vi.fn()
  });

  Object.defineProperty(HTMLMediaElement.prototype, "load", {
    configurable: true,
    writable: true,
    value: vi.fn()
  });

  tauriVideoMocks.start.mockReset();
  tauriVideoMocks.status.mockReset();
  tauriVideoMocks.cancel.mockReset();
  tauriVideoMocks.result.mockReset();
  tauriVideoMocks.diagnostics.mockReset();
  tauriVideoMocks.sourcePathCheck.mockReset();
  tauriVideoMocks.openOutputFolder.mockReset();
  tauriVideoMocks.pickFileDialog.mockReset();
  tauriVideoMocks.loadFileFromNativePath.mockReset();

  tauriVideoMocks.start.mockResolvedValue({
    jobId: "job-1",
    state: "running"
  });
  tauriVideoMocks.status.mockResolvedValue({
    jobId: "job-1",
    state: "running",
    percent: 18,
    stage: "encoding",
    frameIndex: 54,
    totalFrames: 300,
    encodedSeconds: 1.8,
    message: "Encoding...",
    updatedAtUtc: "2026-03-09T10:00:00.000Z"
  });
  tauriVideoMocks.cancel.mockResolvedValue({
    jobId: "job-1",
    state: "canceled",
    canceled: true
  });
  tauriVideoMocks.result.mockResolvedValue({
    jobId: "job-1",
    state: "succeeded",
    success: {
      jobId: "job-1",
      outputPath: "C:\\Exports\\session-01.mp4",
      durationSeconds: 120,
      fileSizeBytes: 4_500_000,
      completedAtUtc: "2026-03-09T10:05:00.000Z"
    },
    failure: null
  });

  tauriVideoMocks.diagnostics.mockResolvedValue({
    ffmpeg: {
      available: true,
      source: "path",
      executablePath: "C:\\ffmpeg\\ffmpeg.exe",
      version: "ffmpeg version n7.0",
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

  tauriVideoMocks.sourcePathCheck.mockResolvedValue({
    sourcePath: "C:\\Media\\mock.dat",
    exists: true,
    isFile: true
  });

  tauriVideoMocks.openOutputFolder.mockResolvedValue({
    opened: true,
    directoryPath: "C:\\Exports"
  });

  tauriVideoMocks.pickFileDialog.mockResolvedValue(null);
  tauriVideoMocks.loadFileFromNativePath.mockResolvedValue(createFile("native.wav", "audio/wav"));
});

function withNativePath(file: File, absolutePath?: string): File {
  Object.defineProperty(file, "path", {
    configurable: true,
    value: absolutePath ?? `C:\\Media\\${file.name}`
  });
  return file;
}

function createFile(name: string, type: string, contents = "stub"): File {
  const file = new File([contents], name, {
    type,
    lastModified: 1_706_214_400_000
  });

  return withNativePath(file);
}

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
    view.setInt16(cursor, Math.round(clamped * 32767), true);
    cursor += 2;
  }

  return new Uint8Array(buffer);
}

function createWavFile(name: string): File {
  const waveform = createPcm16MonoWav([
    0,
    0.2,
    -0.35,
    0.5,
    -0.7,
    0.15,
    0.8,
    -0.1,
    0.45,
    -0.25,
    0.6,
    -0.4
  ]);
  const waveformBuffer = waveform.buffer as ArrayBuffer;

  const file = new File([waveformBuffer], name, {
    type: "audio/wav",
    lastModified: 1_706_214_400_000
  });

  return withNativePath(file);
}

function createDropEventData(files: File[]) {
  return {
    dataTransfer: {
      files,
      types: ["Files"]
    }
  };
}

function populateValidMediaAndOutput(): void {
  fireEvent.change(screen.getByLabelText("Image file dialog"), {
    target: { files: [createFile("cover.png", "image/png")] }
  });
  fireEvent.change(screen.getByLabelText("Audio file dialog"), {
    target: { files: [createWavFile("mix.wav")] }
  });
  fireEvent.change(screen.getByLabelText("Output directory"), {
    target: { value: "C:\\Exports" }
  });
  fireEvent.change(screen.getByLabelText("Output file name"), {
    target: { value: "session-01" }
  });
}

describe("VideoWorkspaceFeature", () => {
  it("renders the Stage 10 shell with output, render, and persistence controls", () => {
    render(<VideoWorkspaceFeature />);

    expect(screen.getByRole("heading", { name: "Image + Audio to YouTube MP4" })).toBeInTheDocument();
    expect(
      screen.getByText(
        /Stage 10: local project and preset persistence is active with save\/load flows and remembered output preferences/i
      )
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Enable reactive overlay")).toBeInTheDocument();
    expect(screen.getByLabelText("Enable text layer")).toBeInTheDocument();
    expect(screen.getByLabelText("Output preset")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /build render request/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save project/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /load saved project snapshot/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save workspace preset/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /load saved workspace preset/i })).toBeInTheDocument();
  });

  it("imports an image file from file dialog and shows metadata", async () => {
    render(<VideoWorkspaceFeature />);

    const input = screen.getByLabelText("Image file dialog") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [createFile("cover.jpg", "image/jpeg")] } });

    const imageMeta = await screen.findByTestId("image-metadata");
    expect(within(imageMeta).getByText("cover.jpg")).toBeInTheDocument();
    expect(within(imageMeta).getByText("JPG")).toBeInTheDocument();
  });

  it("imports a WAV file from file dialog and shows metadata", async () => {
    render(<VideoWorkspaceFeature />);

    const input = screen.getByLabelText("Audio file dialog") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [createWavFile("master.wav")] } });

    const audioMeta = await screen.findByTestId("audio-metadata");
    expect(within(audioMeta).getByText("master.wav")).toBeInTheDocument();
    expect(within(audioMeta).getByText("WAV")).toBeInTheDocument();
  });

  it("rejects unsupported files with a clear import issue", async () => {
    render(<VideoWorkspaceFeature />);

    const input = screen.getByLabelText("Audio file dialog") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [createFile("notes.txt", "text/plain")] } });

    const unsupportedIssue = await screen.findByText(/unsupported file type/i);
    expect(unsupportedIssue).toBeInTheDocument();
  });

  it("updates state when dropping a valid image file", async () => {
    render(<VideoWorkspaceFeature />);

    const dropZone = screen.getByRole("button", { name: "Drop image file" });
    fireEvent.drop(dropZone, createDropEventData([createFile("artwork.png", "image/png")]));

    await waitFor(() => {
      const imageMeta = screen.getByTestId("image-metadata");
      expect(within(imageMeta).getByText("artwork.png")).toBeInTheDocument();
    });
  });

  it("shows project media ready when both image and audio are selected", async () => {
    render(<VideoWorkspaceFeature />);

    const imageInput = screen.getByLabelText("Image file dialog") as HTMLInputElement;
    const audioInput = screen.getByLabelText("Audio file dialog") as HTMLInputElement;

    fireEvent.change(imageInput, { target: { files: [createFile("cover.png", "image/png")] } });
    fireEvent.change(audioInput, { target: { files: [createWavFile("mix.wav")] } });

    await waitFor(() => {
      expect(screen.getByLabelText("Project media readiness")).toHaveTextContent(/Project media is ready/i);
    });

    expect(screen.getByTestId("video-preview-readiness")).toHaveTextContent(/Preview is ready/i);
  });

  it("keeps overlay disabled by default with safe status", () => {
    render(<VideoWorkspaceFeature />);

    expect(screen.getByLabelText("Enable reactive overlay")).not.toBeChecked();
    expect(screen.queryByTestId("video-overlay-waveform")).toBeNull();
    expect(screen.getByTestId("video-overlay-status")).toHaveTextContent("Overlay analysis: Idle");
  });

  it("renders waveform overlay and applies parameter changes", async () => {
    render(<VideoWorkspaceFeature />);

    const imageInput = screen.getByLabelText("Image file dialog") as HTMLInputElement;
    const audioInput = screen.getByLabelText("Audio file dialog") as HTMLInputElement;

    fireEvent.change(imageInput, { target: { files: [createFile("cover.png", "image/png")] } });
    fireEvent.change(audioInput, { target: { files: [createWavFile("mix.wav")] } });

    await waitFor(() => {
      expect(screen.getByTestId("video-overlay-status").textContent ?? "").not.toContain("Analyzing");
    });

    fireEvent.click(screen.getByLabelText("Enable reactive overlay"));

    const overlay = await screen.findByTestId("video-overlay-waveform");
    expect(overlay).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Overlay position"), {
      target: { value: "top" }
    });
    fireEvent.change(screen.getByLabelText("Overlay opacity"), {
      target: { value: "0.80" }
    });
    fireEvent.change(screen.getByLabelText("Overlay intensity"), {
      target: { value: "0.90" }
    });
    fireEvent.change(screen.getByLabelText("Overlay smoothing"), {
      target: { value: "0.20" }
    });

    expect(overlay).toHaveAttribute("data-overlay-position", "top");
    expect(overlay).toHaveAttribute("data-overlay-opacity", "0.80");
    expect(overlay).toHaveAttribute("data-overlay-intensity", "0.90");
    expect(overlay).toHaveAttribute("data-overlay-smoothing", "0.20");
  });

  it("updates preview fit mode deterministically", async () => {
    render(<VideoWorkspaceFeature />);

    const imageInput = screen.getByLabelText("Image file dialog") as HTMLInputElement;
    fireEvent.change(imageInput, { target: { files: [createFile("cover.png", "image/png")] } });

    const frame = await screen.findByTestId("video-preview-frame");
    expect(frame).toHaveAttribute("data-fit-mode", "fill_crop");
    expect(frame).toHaveAttribute("data-object-fit", "cover");

    fireEvent.click(screen.getByRole("radio", { name: /fit with bars/i }));
    expect(frame).toHaveAttribute("data-fit-mode", "fit_bars");

    fireEvent.click(screen.getByRole("radio", { name: /stretch/i }));
    expect(frame).toHaveAttribute("data-fit-mode", "stretch");
  });

  it("renders text overlay when enabled and hides it when disabled", async () => {
    render(<VideoWorkspaceFeature />);

    const imageInput = screen.getByLabelText("Image file dialog") as HTMLInputElement;
    fireEvent.change(imageInput, { target: { files: [createFile("cover.png", "image/png")] } });

    fireEvent.click(screen.getByLabelText("Enable text layer"));
    fireEvent.change(screen.getByLabelText("Text layout preset"), {
      target: { value: "title_bottom_center" }
    });
    fireEvent.change(screen.getByLabelText("Title text"), {
      target: { value: "Skald Session" }
    });

    const overlay = await screen.findByTestId("video-preview-text-overlay");
    expect(overlay).toHaveAttribute("data-layout-preset", "title_bottom_center");

    fireEvent.click(screen.getByLabelText("Enable text layer"));
    expect(screen.queryByTestId("video-preview-text-overlay")).toBeNull();
  });

  it("applies output preset selection and file preview path", () => {
    render(<VideoWorkspaceFeature />);

    fireEvent.change(screen.getByLabelText("Output preset"), {
      target: { value: "youtube_1440p_standard" }
    });
    fireEvent.change(screen.getByLabelText("Output directory"), {
      target: { value: "C:\\Exports" }
    });
    fireEvent.change(screen.getByLabelText("Output file name"), {
      target: { value: "session-01" }
    });

    expect(screen.getByTestId("video-output-preset-summary")).toHaveTextContent("2560 x 1440");
    expect(screen.getByTestId("video-output-file-preview")).toHaveTextContent("C:\\Exports\\session-01.mp4");
  });

  it("does not re-run diagnostics on each output-directory keystroke and refreshes on demand", async () => {
    render(<VideoWorkspaceFeature />);

    await waitFor(() => {
      expect(tauriVideoMocks.diagnostics).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(screen.getByLabelText("Output directory"), {
      target: { value: "C:/Exports/Queued" }
    });

    await waitFor(() => {
      expect(tauriVideoMocks.diagnostics).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: /refresh render diagnostics/i }));

    await waitFor(() => {
      expect(tauriVideoMocks.diagnostics).toHaveBeenCalledTimes(2);
    });
    expect(tauriVideoMocks.diagnostics).toHaveBeenLastCalledWith("C:/Exports/Queued");
  });

  it("saves and loads a project snapshot from local persistence", async () => {
    render(<VideoWorkspaceFeature />);

    populateValidMediaAndOutput();

    fireEvent.change(screen.getByLabelText("Output preset"), {
      target: { value: "youtube_1440p_standard" }
    });

    fireEvent.click(screen.getByRole("button", { name: /save project/i }));
    expect(screen.getByTestId("video-persistence-status")).toHaveTextContent(/saved locally/i);

    fireEvent.change(screen.getByLabelText("Output preset"), {
      target: { value: "youtube_1080p_standard" }
    });

    fireEvent.click(screen.getByRole("button", { name: /load saved project snapshot/i }));

    await waitFor(() => {
      expect((screen.getByLabelText("Output preset") as HTMLSelectElement).value).toBe(
        "youtube_1440p_standard"
      );
    });

    const imageMeta = await screen.findByTestId("image-metadata");
    expect(within(imageMeta).getByText("cover.png")).toBeInTheDocument();
  });

  it("saves and loads a workspace preset", async () => {
    render(<VideoWorkspaceFeature />);

    fireEvent.click(screen.getByRole("radio", { name: /stretch/i }));
    fireEvent.click(screen.getByLabelText("Enable text layer"));
    fireEvent.change(screen.getByLabelText("Title text"), {
      target: { value: "Preset Title" }
    });
    fireEvent.change(screen.getByLabelText("Output preset"), {
      target: { value: "youtube_1440p_standard" }
    });

    fireEvent.click(screen.getByRole("button", { name: /save workspace preset/i }));

    fireEvent.click(screen.getByRole("radio", { name: /fill \/ crop/i }));
    fireEvent.change(screen.getByLabelText("Title text"), {
      target: { value: "Changed" }
    });
    fireEvent.change(screen.getByLabelText("Output preset"), {
      target: { value: "youtube_1080p_standard" }
    });

    fireEvent.click(screen.getByRole("button", { name: /load saved workspace preset/i }));

    await waitFor(() => {
      expect((screen.getByLabelText("Output preset") as HTMLSelectElement).value).toBe(
        "youtube_1440p_standard"
      );
    });

    expect((screen.getByLabelText("Title text") as HTMLInputElement).value).toBe("Preset Title");
    expect((screen.getByRole("radio", { name: /stretch/i }) as HTMLInputElement).checked).toBe(true);
  });

  it("restores last output preset and recent folder after remount", async () => {
    const firstRender = render(<VideoWorkspaceFeature />);

    fireEvent.change(screen.getByLabelText("Output preset"), {
      target: { value: "youtube_1440p_standard" }
    });
    fireEvent.change(screen.getByLabelText("Output directory"), {
      target: { value: "C:\\Exports\\RecentA" }
    });

    firstRender.unmount();

    render(<VideoWorkspaceFeature />);

    await waitFor(() => {
      expect((screen.getByLabelText("Output preset") as HTMLSelectElement).value).toBe(
        "youtube_1440p_standard"
      );
    });

    expect((screen.getByLabelText("Output directory") as HTMLInputElement).value).toBe(
      "C:\\Exports\\RecentA"
    );
    expect(screen.getByLabelText("Recent output directories")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "C:\\Exports\\RecentA" })).toBeInTheDocument();
  });
  it("shows missing media preflight issues", () => {
    render(<VideoWorkspaceFeature />);

    fireEvent.change(screen.getByLabelText("Output directory"), {
      target: { value: "C:\\Exports" }
    });
    fireEvent.change(screen.getByLabelText("Output file name"), {
      target: { value: "demo" }
    });

    fireEvent.click(screen.getByRole("button", { name: /build render request/i }));

    const issues = screen.getByTestId("video-render-preflight-issues");
    expect(issues).toHaveTextContent(/Select one image file/i);
    expect(issues).toHaveTextContent(/Select one WAV audio file/i);
  });

  it("shows output directory validation issue when media is ready", async () => {
    render(<VideoWorkspaceFeature />);

    fireEvent.change(screen.getByLabelText("Image file dialog"), {
      target: { files: [createFile("cover.png", "image/png")] }
    });
    fireEvent.change(screen.getByLabelText("Audio file dialog"), {
      target: { files: [createWavFile("mix.wav")] }
    });

    fireEvent.change(screen.getByLabelText("Output directory"), {
      target: { value: "" }
    });

    fireEvent.click(screen.getByRole("button", { name: /build render request/i }));

    const issues = await screen.findByTestId("video-render-preflight-issues");
    expect(issues).toHaveTextContent(/Output directory path is required/i);
  });

  it("builds deterministic render request JSON", async () => {
    render(<VideoWorkspaceFeature />);

    populateValidMediaAndOutput();

    fireEvent.change(screen.getByLabelText("Output preset"), {
      target: { value: "youtube_1440p_standard" }
    });
    fireEvent.change(screen.getByLabelText("Overwrite policy"), {
      target: { value: "replace" }
    });

    fireEvent.click(screen.getByRole("button", { name: /build render request/i }));

    const jsonNode = await screen.findByTestId("video-render-request-json");
    const parsed = JSON.parse(jsonNode.textContent ?? "{}");

    expect(parsed.requestVersion).toBe(1);
    expect(parsed.output.presetId).toBe("youtube_1440p_standard");
    expect(parsed.output.outputFilePath).toBe("C:\\Exports\\session-01.mp4");
    expect(parsed.output.overwritePolicy).toBe("replace");
    expect(parsed.composition.widthPx).toBe(2560);
    expect(parsed.media.imageFileName).toBe("C:\\Media\\cover.png");
    expect(parsed.media.audioFileName).toBe("C:\\Media\\mix.wav");
  });

  it("starts render and shows terminal success summary", async () => {
    tauriVideoMocks.status.mockResolvedValueOnce({
      jobId: "job-1",
      state: "succeeded",
      percent: 100,
      stage: "complete",
      frameIndex: 300,
      totalFrames: 300,
      encodedSeconds: 120,
      message: "Done",
      updatedAtUtc: "2026-03-09T10:05:00.000Z"
    });

    render(<VideoWorkspaceFeature />);

    populateValidMediaAndOutput();

    fireEvent.click(screen.getByRole("button", { name: /render mp4/i }));

    await waitFor(() => {
      expect(screen.getByTestId("video-render-runtime-status")).toHaveTextContent(/Render status: Succeeded/i);
    });

    const summary = await screen.findByTestId("video-render-success-summary");
    expect(summary).toHaveTextContent("C:\\Exports\\session-01.mp4");
    expect(tauriVideoMocks.start).toHaveBeenCalledTimes(1);
    expect(tauriVideoMocks.result).toHaveBeenCalledWith("job-1");
  });

  it("shows backend error when render start fails", async () => {
    tauriVideoMocks.start.mockRejectedValueOnce({
      code: "VIDEO_RENDER_START_FAILED",
      message: "Backend render queue is busy."
    });

    render(<VideoWorkspaceFeature />);

    populateValidMediaAndOutput();

    fireEvent.click(screen.getByRole("button", { name: /render mp4/i }));

    const error = await screen.findByTestId("video-render-error");
    expect(error).toHaveTextContent("Backend render queue is busy.");
    expect(screen.getByTestId("video-render-runtime-status")).toHaveTextContent(/Render status: Failed/i);
  });

  it("submits cancel request while render is active", async () => {
    render(<VideoWorkspaceFeature />);

    populateValidMediaAndOutput();

    fireEvent.click(screen.getByRole("button", { name: /render mp4/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /cancel render/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /cancel render/i }));

    await waitFor(() => {
      expect(tauriVideoMocks.cancel).toHaveBeenCalledWith("job-1");
    });
  });

  it("opens output folder from the success summary", async () => {
    tauriVideoMocks.status.mockResolvedValueOnce({
      jobId: "job-1",
      state: "succeeded",
      percent: 100,
      stage: "complete",
      frameIndex: 300,
      totalFrames: 300,
      encodedSeconds: 120,
      message: "Done",
      updatedAtUtc: "2026-03-09T10:05:00.000Z"
    });

    render(<VideoWorkspaceFeature />);

    populateValidMediaAndOutput();
    fireEvent.click(screen.getByRole("button", { name: /render mp4/i }));

    await screen.findByTestId("video-render-success-summary");

    fireEvent.click(screen.getByRole("button", { name: /open output folder/i }));

    await waitFor(() => {
      expect(tauriVideoMocks.openOutputFolder).toHaveBeenCalledWith("C:\\Exports\\session-01.mp4");
    });

    expect(screen.getByTestId("video-open-output-folder-status")).toHaveTextContent(
      "Opened output folder: C:\\Exports"
    );
  });

  it("blocks render start when diagnostics verification fails", async () => {
    render(<VideoWorkspaceFeature />);

    populateValidMediaAndOutput();

    await waitFor(() => {
      expect(tauriVideoMocks.diagnostics).toHaveBeenCalled();
    });

    tauriVideoMocks.diagnostics.mockRejectedValueOnce({
      code: "VIDEO_RENDER_DIAGNOSTICS_FAILED",
      message: "FFmpeg diagnostics unavailable."
    });

    fireEvent.click(screen.getByRole("button", { name: /render mp4/i }));

    expect(await screen.findByTestId("video-render-diagnostics-error")).toHaveTextContent(
      "FFmpeg diagnostics unavailable."
    );
    expect(screen.getByTestId("video-render-error")).toHaveTextContent(
      "Render cannot start until diagnostics can be verified."
    );
    expect(tauriVideoMocks.start).not.toHaveBeenCalled();
  });

  it("shows relink prompts when saved source paths are missing", async () => {
    render(<VideoWorkspaceFeature />);

    populateValidMediaAndOutput();
    fireEvent.click(screen.getByRole("button", { name: /save project/i }));

    tauriVideoMocks.sourcePathCheck.mockResolvedValue({
      sourcePath: "C:\\Media\\missing.file",
      exists: false,
      isFile: false
    });

    fireEvent.click(screen.getByRole("button", { name: /load saved project snapshot/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/Saved source path is missing\./i)).toHaveLength(2);
    });

    expect(screen.getByTestId("video-persistence-status")).toHaveTextContent(/Re-link missing media/i);
  });

  it("imports an image via native picker path", async () => {
    const nativeImage = createFile("native-cover.png", "image/png");

    tauriVideoMocks.pickFileDialog.mockResolvedValueOnce("C:\\Media\\native-cover.png");
    tauriVideoMocks.loadFileFromNativePath.mockResolvedValueOnce(nativeImage);

    render(<VideoWorkspaceFeature />);

    fireEvent.click(screen.getByRole("button", { name: /browse image \(native\)/i }));

    const imageMeta = await screen.findByTestId("image-metadata");
    expect(within(imageMeta).getByText("native-cover.png")).toBeInTheDocument();
    expect(tauriVideoMocks.pickFileDialog).toHaveBeenCalled();
    expect(tauriVideoMocks.loadFileFromNativePath).toHaveBeenCalledWith("C:\\Media\\native-cover.png");
  });

  it("falls back to native path import when native file loading is unavailable", async () => {
    tauriVideoMocks.pickFileDialog.mockResolvedValueOnce("C:\\Media\\native-cover.png");
    tauriVideoMocks.loadFileFromNativePath.mockRejectedValueOnce({
      code: "TAURI_FILE_READ_UNAVAILABLE",
      message: "Native file loading is unavailable in this runtime."
    });

    render(<VideoWorkspaceFeature />);

    fireEvent.click(screen.getByRole("button", { name: /browse image \(native\)/i }));

    const imageMeta = await screen.findByTestId("image-metadata");
    expect(within(imageMeta).getByText("native-cover.png")).toBeInTheDocument();
    expect(within(imageMeta).getByText("PNG")).toBeInTheDocument();
    expect(screen.queryByText(/Native file loading is unavailable/i)).toBeNull();
  });

  it("keeps artist field editable even when the selected layout hides artist text", () => {
    render(<VideoWorkspaceFeature />);

    fireEvent.change(screen.getByLabelText("Text layout preset"), {
      target: { value: "title_bottom_center" }
    });

    const artistInput = screen.getByLabelText("Artist text") as HTMLInputElement;
    expect(artistInput).not.toBeDisabled();

    fireEvent.change(artistInput, {
      target: { value: "Skald Artist" }
    });

    expect(artistInput.value).toBe("Skald Artist");
    expect(screen.getByText(/layout hides artist text/i)).toBeInTheDocument();
  });
  it("runs preview play and pause transitions through local preview controls", async () => {
    render(<VideoWorkspaceFeature />);

    fireEvent.change(screen.getByLabelText("Audio file dialog"), {
      target: { files: [createWavFile("mix.wav")] }
    });

    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    await waitFor(() => {
      expect(screen.getByTestId("video-preview-status")).toHaveTextContent("Playback: Playing");
      expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByTestId("video-preview-status")).toHaveTextContent("Playback: Paused");
  });

  it("updates preview progress and seek deterministically", async () => {
    render(<VideoWorkspaceFeature />);

    fireEvent.change(screen.getByLabelText("Audio file dialog"), {
      target: { files: [createWavFile("mix.wav")] }
    });

    const audioElement = screen.getByTestId("video-preview-audio-element") as HTMLAudioElement;
    Object.defineProperty(audioElement, "duration", {
      configurable: true,
      value: 120
    });
    Object.defineProperty(audioElement, "currentTime", {
      configurable: true,
      writable: true,
      value: 30
    });

    fireEvent.loadedMetadata(audioElement);
    fireEvent.timeUpdate(audioElement);

    expect(screen.getByLabelText("Preview progress")).toHaveTextContent("0:30 / 2:00");

    fireEvent.change(screen.getByLabelText("Preview position"), {
      target: { value: "0.5" }
    });

    expect(audioElement.currentTime).toBe(60);
  });
});









