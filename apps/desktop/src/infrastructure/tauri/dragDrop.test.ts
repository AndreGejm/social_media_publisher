import { beforeEach, describe, expect, it, vi } from "vitest";

const webviewMocks = vi.hoisted(() => {
  let dragDropHandler: ((event: { payload: { type: string; paths: string[] } }) => void) | null =
    null;

  return {
    getCurrentWebview: vi.fn(() => ({
      onDragDropEvent: vi.fn(
        async (handler: (event: { payload: { type: string; paths: string[] } }) => void) => {
          dragDropHandler = handler;
          return () => {
            if (dragDropHandler === handler) {
              dragDropHandler = null;
            }
          };
        }
      )
    })),
    emit(type: string, paths: string[]) {
      dragDropHandler?.({
        payload: {
          type,
          paths
        }
      });
    },
    reset() {
      dragDropHandler = null;
      webviewMocks.getCurrentWebview.mockClear();
    }
  };
});

const runtimeEventMocks = vi.hoisted(() => {
  let runtimeDropHandler:
    | ((event: { payload: { paths?: string[] } }) => void)
    | null = null;

  return {
    listen: vi.fn(
      async (
        _eventName: string,
        handler: (event: { payload: { paths?: string[] } }) => void
      ) => {
        runtimeDropHandler = handler;
        return () => {
          if (runtimeDropHandler === handler) {
            runtimeDropHandler = null;
          }
        };
      }
    ),
    emit(paths: string[]) {
      runtimeDropHandler?.({ payload: { paths } });
    },
    reset() {
      runtimeDropHandler = null;
      runtimeEventMocks.listen.mockClear();
    }
  };
});

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: webviewMocks.getCurrentWebview
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: runtimeEventMocks.listen
}));

import { subscribeToFileDropEvents } from "./dragDrop";

describe("subscribeToFileDropEvents", () => {
  beforeEach(() => {
    webviewMocks.reset();
    runtimeEventMocks.reset();
    delete window.__RELEASE_PUBLISHER_DROP_LISTENER_COUNT__;
  });

  it("forwards dropped file paths from the native drag-drop bridge", async () => {
    const onDrop = vi.fn();

    const unlisten = await subscribeToFileDropEvents(onDrop);

    expect(webviewMocks.getCurrentWebview).toHaveBeenCalledTimes(1);
    expect(unlisten).toEqual(expect.any(Function));
    expect(window.__RELEASE_PUBLISHER_DROP_LISTENER_COUNT__).toBe(1);

    webviewMocks.emit("drop", ["C:/Music/track.wav"]);

    expect(onDrop).toHaveBeenCalledWith(["C:/Music/track.wav"]);

    unlisten?.();
    expect(window.__RELEASE_PUBLISHER_DROP_LISTENER_COUNT__).toBe(0);
  });

  it("forwards runtime E2E drop events", async () => {
    const onDrop = vi.fn();

    await subscribeToFileDropEvents(onDrop);
    runtimeEventMocks.emit(["C:/Music/runtime-drop.wav"]);

    expect(onDrop).toHaveBeenCalledWith(["C:/Music/runtime-drop.wav"]);
    expect(window.__RELEASE_PUBLISHER_DROP_LISTENER_COUNT__).toBe(1);
  });

  it("ignores non-drop and empty payloads", async () => {
    const onDrop = vi.fn();

    await subscribeToFileDropEvents(onDrop);

    webviewMocks.emit("hover", ["C:/Music/track.wav"]);
    webviewMocks.emit("drop", []);
    runtimeEventMocks.emit([]);

    expect(onDrop).not.toHaveBeenCalled();
  });

  it("returns null when neither Tauri drop surface is available", async () => {
    const onDrop = vi.fn();
    webviewMocks.getCurrentWebview.mockImplementationOnce(() => {
      throw new Error("tauri unavailable");
    });
    runtimeEventMocks.listen.mockImplementationOnce(async () => {
      throw new Error("runtime events unavailable");
    });

    const unlisten = await subscribeToFileDropEvents(onDrop);

    expect(unlisten).toBeNull();
    expect(onDrop).not.toHaveBeenCalled();
    expect(window.__RELEASE_PUBLISHER_DROP_LISTENER_COUNT__).toBeUndefined();
  });
});
