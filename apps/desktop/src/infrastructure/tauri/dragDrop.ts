type DragDropUnlisten = () => void;

export async function subscribeToFileDropEvents(
  onDrop: (paths: string[]) => void
): Promise<DragDropUnlisten | null> {
  try {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    const webview = getCurrentWebview();

    return await webview.onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;
      const droppedPaths = event.payload.paths;
      if (!Array.isArray(droppedPaths) || droppedPaths.length === 0) return;
      onDrop(droppedPaths);
    });
  } catch {
    // Optional in browser/test runtimes.
    return null;
  }
}
