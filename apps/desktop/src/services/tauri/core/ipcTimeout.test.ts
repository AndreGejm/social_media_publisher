import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const listenMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: Record<string, unknown>) => invokeMock(command, args)
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: unknown) => listenMock(event, handler)
}));

import { invokeWithTimeout, listenWithTimeout } from "./ipcTimeout";

describe("tauri/core ipcTimeout", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    delete window.__TAURI__;
    delete window.__TAURI_INTERNALS__;
  });

  it("returns TAURI_UNAVAILABLE before invoking commands in browser preview", async () => {
    await expect(invokeWithTimeout("catalog_list_tracks")).rejects.toMatchObject({
      code: "TAURI_UNAVAILABLE",
      message: "Tauri runtime is not available in the browser preview.",
      details: { command: "catalog_list_tracks" }
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("invokes commands when a Tauri runtime bridge is present", async () => {
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn(async () => null)
    };
    invokeMock.mockResolvedValue({ ok: true });

    await expect(invokeWithTimeout("catalog_list_tracks", { query: null }, 10)).resolves.toEqual({
      ok: true
    });
    expect(invokeMock).toHaveBeenCalledWith("catalog_list_tracks", { query: null });
  });

  it("returns TAURI_UNAVAILABLE before registering listeners in browser preview", async () => {
    await expect(listenWithTimeout("skald://runtime-test", vi.fn(), 10)).rejects.toMatchObject({
      code: "TAURI_UNAVAILABLE",
      message: "Tauri runtime is not available in the browser preview.",
      details: { command: "listen:skald://runtime-test" }
    });
    expect(listenMock).not.toHaveBeenCalled();
  });
});
