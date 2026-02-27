export type LayoutTier = "compact" | "standard" | "wide";

export type LayoutGeometry = {
  tier: LayoutTier;
  sidebarWidthPx: number;
  minWorkspaceWidthPx: number;
  rightDockWidthPx: number;
};

export type LayoutSnapshot = {
  viewportWidth: number;
  viewportHeight: number;
  zoomLevel: number;
  geometry: LayoutGeometry;
};

const COMPACT_WIDTH_THRESHOLD_PX = 1100;
const WIDE_WIDTH_THRESHOLD_PX = 1680;

function resolveGeometry(viewportWidth: number): LayoutGeometry {
  if (viewportWidth < COMPACT_WIDTH_THRESHOLD_PX) {
    return {
      tier: "compact",
      sidebarWidthPx: 240,
      minWorkspaceWidthPx: 560,
      rightDockWidthPx: 300
    };
  }

  if (viewportWidth >= WIDE_WIDTH_THRESHOLD_PX) {
    return {
      tier: "wide",
      sidebarWidthPx: 340,
      minWorkspaceWidthPx: 900,
      rightDockWidthPx: 420
    };
  }

  return {
    tier: "standard",
    sidebarWidthPx: 300,
    minWorkspaceWidthPx: 760,
    rightDockWidthPx: 360
  };
}

export function buildLayoutSnapshot(params: {
  viewportWidth: number;
  viewportHeight: number;
  zoomLevel: number;
}): LayoutSnapshot {
  const viewportWidth = Math.max(0, Math.round(params.viewportWidth));
  const viewportHeight = Math.max(0, Math.round(params.viewportHeight));

  return {
    viewportWidth,
    viewportHeight,
    zoomLevel: params.zoomLevel,
    geometry: resolveGeometry(viewportWidth)
  };
}
