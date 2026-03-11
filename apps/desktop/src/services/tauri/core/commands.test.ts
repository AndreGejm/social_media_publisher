import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: Record<string, unknown>) => invokeMock(command, args)
}));

import {
  invokeCommand,
  runtimeGetErrorLogPath,
  runtimeLogError,
  setInvokeErrorReporter
} from "./commands";

describe("tauri/core commands", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    setInvokeErrorReporter(null);
    delete window.__TAURI__;
  });

  it("reports normalized command failures to the registered reporter", async () => {
    const reporter = vi.fn();
    setInvokeErrorReporter(reporter);
    invokeMock.mockRejectedValue({
      code: "FILE_WRITE_FAILED",
      message: "disk full"
    });

    await expect(invokeCommand("catalog_list_tracks", { query: { search: "broken" } })).rejects.toMatchObject({
      code: "FILE_WRITE_FAILED",
      message: "disk full"
    });

    expect(reporter).toHaveBeenCalledWith({
      command: "catalog_list_tracks",
      args: { query: { search: "broken" } },
      error: {
        code: "FILE_WRITE_FAILED",
        message: "disk full"
      }
    });
  });

  it("sends runtime log entries through the silent command path", async () => {
    const reporter = vi.fn();
    setInvokeErrorReporter(reporter);
    invokeMock.mockResolvedValue(undefined);

    await runtimeLogError({
      source: "window.error",
      message: "Unhandled window error",
      details: {
        nested: new Error("boom")
      }
    });

    expect(invokeMock).toHaveBeenCalledWith("runtime_log_error", {
      entry: {
        source: "window.error",
        message: "Unhandled window error",
        details: {
          nested: {
            name: "Error",
            message: "boom",
            stack: expect.any(String)
          }
        }
      }
    });
    expect(reporter).not.toHaveBeenCalled();
  });

  it("returns a validated runtime error log path", async () => {
    invokeMock.mockResolvedValue("C:/Users/example/AppData/Local/Skald/logs/runtime-errors.log");

    await expect(runtimeGetErrorLogPath()).resolves.toBe(
      "C:/Users/example/AppData/Local/Skald/logs/runtime-errors.log"
    );
  });
});
