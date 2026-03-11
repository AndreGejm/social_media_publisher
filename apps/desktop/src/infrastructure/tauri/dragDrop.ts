import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";

const RUNTIME_TEST_FILE_DROP_EVENT = "skald://test-file-drop";

type DragDropUnlisten = () => void;

type RuntimeTestFileDropPayload = {
  paths?: string[];
};

declare global {
  interface Window {
    __RELEASE_PUBLISHER_DROP_LISTENER_COUNT__?: number;
    __RELEASE_PUBLISHER_DROP_LISTENER_DEBUG__?: {
      nativeListenerBound: boolean;
      runtimeListenerBound: boolean;
      nativeBindError: string | null;
      runtimeBindError: string | null;
      lastDeliverySource: "native" | "runtime" | null;
      lastDroppedPaths: string[];
    };
  }
}

function updateDropListenerDebugCount(delta: number): void {
  const current =
    typeof window.__RELEASE_PUBLISHER_DROP_LISTENER_COUNT__ === "number"
      ? window.__RELEASE_PUBLISHER_DROP_LISTENER_COUNT__
      : 0;
  window.__RELEASE_PUBLISHER_DROP_LISTENER_COUNT__ = Math.max(0, current + delta);
}

function updateDropListenerDebugState(
  update: Partial<NonNullable<Window["__RELEASE_PUBLISHER_DROP_LISTENER_DEBUG__"]>>
): void {
  const current = window.__RELEASE_PUBLISHER_DROP_LISTENER_DEBUG__ ?? {
    nativeListenerBound: false,
    runtimeListenerBound: false,
    nativeBindError: null,
    runtimeBindError: null,
    lastDeliverySource: null,
    lastDroppedPaths: []
  };
  window.__RELEASE_PUBLISHER_DROP_LISTENER_DEBUG__ = {
    ...current,
    ...update
  };
}

export async function subscribeToFileDropEvents(
  onDrop: (paths: string[]) => void
): Promise<DragDropUnlisten | null> {
  const unlisteners: DragDropUnlisten[] = [];

  try {
    const webview = getCurrentWebview();
    const unlistenNativeDrop = (await Promise.race([
      webview.onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const droppedPaths = event.payload.paths;
        if (!Array.isArray(droppedPaths) || droppedPaths.length === 0) return;
        updateDropListenerDebugState({
          lastDeliverySource: "native",
          lastDroppedPaths: [...droppedPaths]
        });
        onDrop(droppedPaths);
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout binding native drop")), 2000))
    ])) as DragDropUnlisten;
    unlisteners.push(unlistenNativeDrop);
    updateDropListenerDebugState({
      nativeListenerBound: true,
      nativeBindError: null
    });
  } catch (error) {
    updateDropListenerDebugState({
      nativeBindError: error instanceof Error ? error.message : String(error)
    });
  }

  try {
    const unlistenRuntimeDrop = (await Promise.race([
      listen<RuntimeTestFileDropPayload>(RUNTIME_TEST_FILE_DROP_EVENT, (event) => {
        const droppedPaths = Array.isArray(event.payload?.paths) ? event.payload.paths : [];
        if (droppedPaths.length === 0) return;
        updateDropListenerDebugState({
          lastDeliverySource: "runtime",
          lastDroppedPaths: [...droppedPaths]
        });
        onDrop(droppedPaths);
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout binding runtime drop")), 2000))
    ])) as DragDropUnlisten;
    unlisteners.push(unlistenRuntimeDrop);
    updateDropListenerDebugState({
      runtimeListenerBound: true,
      runtimeBindError: null
    });
  } catch (error) {
    updateDropListenerDebugState({
      runtimeBindError: error instanceof Error ? error.message : String(error)
    });
  }

  if (unlisteners.length === 0) {
    return null;
  }

  updateDropListenerDebugCount(1);
  let cleanedUp = false;

  return () => {
    if (cleanedUp) return;
    cleanedUp = true;
    for (const unlisten of unlisteners) {
      unlisten();
    }
    updateDropListenerDebugCount(-1);
  };
}
