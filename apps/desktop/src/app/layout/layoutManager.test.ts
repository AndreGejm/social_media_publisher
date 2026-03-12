import { describe, expect, it } from "vitest";

import { buildLayoutSnapshot } from "./layoutManager";

describe("buildLayoutSnapshot", () => {
  it("returns compact geometry below the compact breakpoint", () => {
    const snapshot = buildLayoutSnapshot({ viewportWidth: 1099, viewportHeight: 900, zoomLevel: 1 });

    expect(snapshot.geometry).toEqual({
      tier: "compact",
      sidebarWidthPx: 240,
      minWorkspaceWidthPx: 560,
      rightDockWidthPx: 300
    });
  });

  it("returns standard geometry between the compact and wide breakpoints", () => {
    const snapshot = buildLayoutSnapshot({ viewportWidth: 1400, viewportHeight: 900, zoomLevel: 1.25 });

    expect(snapshot.geometry).toEqual({
      tier: "standard",
      sidebarWidthPx: 300,
      minWorkspaceWidthPx: 760,
      rightDockWidthPx: 360
    });
  });

  it("returns wide geometry for ultrawide viewport widths", () => {
    const snapshot = buildLayoutSnapshot({ viewportWidth: 5120, viewportHeight: 1440, zoomLevel: 1 });

    expect(snapshot.geometry).toEqual({
      tier: "wide",
      sidebarWidthPx: 340,
      minWorkspaceWidthPx: 900,
      rightDockWidthPx: 420
    });
  });
});