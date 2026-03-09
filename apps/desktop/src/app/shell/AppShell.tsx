import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { createAppEventBus } from "../events/eventBus";
import { buildLayoutSnapshot } from "../layout/layoutManager";
import { WorkspaceFeature } from "../../features/workspace";
import AppShellContext from "./AppShellContext";

const DEFAULT_REFRESH_RATE_HZ = 30;

function readViewportSize(): { width: number; height: number } {
  if (typeof window === "undefined") {
    return { width: 0, height: 0 };
  }
  return {
    width: window.innerWidth,
    height: window.innerHeight
  };
}

export default function AppShell() {
  const [{ width, height }, setViewport] = useState(readViewportSize);
  const [refreshTick, setRefreshTick] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(() =>
    typeof window === "undefined" ? 1 : Number(window.devicePixelRatio) || 1
  );
  const refreshRateHz = DEFAULT_REFRESH_RATE_HZ;
  const eventBus = useMemo(() => createAppEventBus(), []);

  useEffect(() => {
    const onResize = () => {
      const next = readViewportSize();
      setViewport(next);
      eventBus.emit("WINDOW_RESIZED", { width: next.width, height: next.height });
    };

    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [eventBus]);

  useEffect(() => {
    const intervalMs = Math.max(1, Math.floor(1000 / refreshRateHz));
    const timer = window.setInterval(() => {
      setRefreshTick((current) => {
        const next = current + 1;
        eventBus.emit("REFRESH_TICK", { tick: next, refreshRateHz });
        return next;
      });
    }, intervalMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [eventBus, refreshRateHz]);

  useEffect(() => {
    const detectZoom = () => {
      const nextZoom = Number(window.devicePixelRatio) || 1;
      setZoomLevel((current) => {
        if (Math.abs(current - nextZoom) < 0.001) return current;
        eventBus.emit("ZOOM_CHANGED", { zoomLevel: nextZoom });
        return nextZoom;
      });
    };
    detectZoom();

    window.addEventListener("resize", detectZoom);
    return () => {
      window.removeEventListener("resize", detectZoom);
    };
  }, [eventBus]);

  const layout = useMemo(
    () =>
      buildLayoutSnapshot({
        viewportWidth: width,
        viewportHeight: height,
        zoomLevel
      }),
    [width, height, zoomLevel]
  );

  const shellState = useMemo(
    () => ({
      refreshRateHz,
      refreshTick,
      layout,
      eventBus
    }),
    [eventBus, layout, refreshRateHz, refreshTick]
  );

  return (
    <AppShellContext.Provider value={shellState}>
      <div
        className="app-shell-root"
        data-layout-tier={layout.geometry.tier}
        style={
          {
            "--shell-sidebar-width": `${layout.geometry.sidebarWidthPx}px`,
            "--shell-right-dock-width": `${layout.geometry.rightDockWidthPx}px`,
            "--shell-min-workspace-width": `${layout.geometry.minWorkspaceWidthPx}px`
          } as CSSProperties
        }
      >
        <WorkspaceFeature shellFrame={{ layoutTier: layout.geometry.tier, refreshTick, eventBus }} />
      </div>
    </AppShellContext.Provider>
  );
}


