import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeLogErrorMock = vi.fn<
  (entry: { source: string; message: string; details?: unknown }) => Promise<void>
>();
let invokeReporter: ((report: {
  command: string;
  args?: Record<string, unknown>;
  error: { code: string; message: string; details?: unknown };
}) => void) | null = null;

vi.mock("./tauri/core", () => ({
  isUiAppError: (error: unknown) =>
    Boolean(
      error &&
        typeof error === "object" &&
        "code" in (error as Record<string, unknown>) &&
        "message" in (error as Record<string, unknown>)
    ),
  runtimeLogError: (entry: { source: string; message: string; details?: unknown }) => runtimeLogErrorMock(entry),
  setInvokeErrorReporter: (reporter: typeof invokeReporter) => {
    invokeReporter = reporter;
  }
}));

import {
  __resetRuntimeErrorLoggingForTests,
  installRuntimeErrorLogging
} from "./runtimeErrorLog";

async function flushRuntimeLogs(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("runtimeErrorLog", () => {
  beforeEach(() => {
    runtimeLogErrorMock.mockReset();
    runtimeLogErrorMock.mockResolvedValue(undefined);
    invokeReporter = null;
    __resetRuntimeErrorLoggingForTests();
  });

  afterEach(() => {
    __resetRuntimeErrorLoggingForTests();
  });

  it("forwards invoke failures into the dedicated runtime log", async () => {
    installRuntimeErrorLogging();

    invokeReporter?.({
      command: "video_render_start",
      args: { outputFilePath: "C:/Exports/out.mp4" },
      error: {
        code: "INVALID_ARGUMENT",
        message: "Output file path is invalid.",
        details: { field: "outputFilePath" }
      }
    });
    await flushRuntimeLogs();

    expect(runtimeLogErrorMock).toHaveBeenCalledWith({
      source: "invoke:video_render_start",
      message: "Output file path is invalid.",
      details: {
        code: "INVALID_ARGUMENT",
        command: "video_render_start",
        args: { outputFilePath: "C:/Exports/out.mp4" },
        details: { field: "outputFilePath" }
      }
    });
  });

  it("captures uncaught window errors", async () => {
    installRuntimeErrorLogging();

    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "Unexpected crash",
        filename: "app.tsx",
        lineno: 12,
        colno: 4,
        error: new Error("Unexpected crash")
      })
    );
    await flushRuntimeLogs();

    expect(runtimeLogErrorMock).toHaveBeenCalledWith({
      source: "window.error",
      message: "Unexpected crash",
      details: {
        filename: "app.tsx",
        line: 12,
        column: 4,
        error: {
          name: "Error",
          message: "Unexpected crash",
          stack: expect.any(String)
        }
      }
    });
  });

  it("captures console.error output", async () => {
    const baseConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    installRuntimeErrorLogging();

    console.error("render pipeline failed", { code: "BROKEN" });
    await flushRuntimeLogs();

    expect(runtimeLogErrorMock).toHaveBeenCalledWith({
      source: "console.error",
      message: 'render pipeline failed {"code":"BROKEN"}',
      details: {
        arguments: [
          {
            value: "render pipeline failed"
          },
          {
            code: "BROKEN"
          }
        ]
      }
    });

    baseConsoleError.mockRestore();
  });
});

