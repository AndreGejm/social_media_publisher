import { expect, test } from "@playwright/test";

import {
  attachUiSignalMonitor,
  expectNoHorizontalOverflow,
  gotoCurrentShell,
  openApplicationMode,
  openWorkspace,
  readShellGeometry
} from "../support/currentShell";

const viewportCases = [
  { label: "wide", width: 1800, height: 1200, tier: "wide" },
  { label: "standard", width: 1360, height: 1024, tier: "standard" },
  { label: "compact", width: 900, height: 960, tier: "compact" }
] as const;

test("browser preview renders the current shell and keeps About available", async ({
  page
}) => {
  const signals = attachUiSignalMonitor(page);

  await gotoCurrentShell(page);

  const workspaceNav = page.getByRole("navigation", { name: "Workspaces" });
  for (const workspace of [
    "Library",
    "Quality Control",
    "Playlists",
    "Settings",
    "About"
  ]) {
    await expect(workspaceNav.getByRole("button", { name: workspace })).toBeVisible();
  }
  await expect(page.getByRole("tab", { name: "Video Workspace" })).toBeVisible();

  await openWorkspace(page, "About");

  await expect(page.getByRole("heading", { level: 3, name: "Skald QC" })).toBeVisible();
  await expect(page.getByText(/Static product and runtime diagnostics for support and build verification\./i)).toHaveCount(0);
  await expect(page.getByText(/Informational workspace/i)).toHaveCount(0);
  const runtimeLogRow = page
    .locator(".about-workspace-card[aria-label='System Information'] .about-kv-list div")
    .filter({ has: page.getByText("Runtime Error Log") })
    .first();
  await expect(runtimeLogRow.locator("dd")).toHaveText(/Unavailable/i);
  await expect(page.getByRole("button", { name: "Copy System Info" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh Diagnostics" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Shared transport" })).toBeVisible();
  await expect(page.locator(".music-right-dock")).toHaveCount(0);

  await signals.assertClean("browser preview about workspace");
});

test("settings maintenance controls are disabled until there is state to clear", async ({
  page
}) => {
  const signals = attachUiSignalMonitor(page);

  await gotoCurrentShell(page);
  await openWorkspace(page, "Settings");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear Notice" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Clear Error Banner" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reset Library Data" })).toBeEnabled();
  await expect(page.getByRole("region", { name: "Shared transport" })).toBeVisible();

  await signals.assertClean("browser preview settings workspace");
});

for (const viewportCase of viewportCases) {
  test(`${viewportCase.label} layout keeps the shell stable and positions Publish dock correctly`, async ({
    page
  }) => {
    const signals = attachUiSignalMonitor(page);

    await page.setViewportSize({
      width: viewportCase.width,
      height: viewportCase.height
    });
    await gotoCurrentShell(page);

    await expect(page.locator(".app-shell-root")).toHaveAttribute(
      "data-layout-tier",
      viewportCase.tier
    );
    await expectNoHorizontalOverflow(page, `${viewportCase.label} release preview`);

    await openApplicationMode(page, "Publish");

    await expect(page.getByRole("heading", { name: "Publish Workflow" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Release Selection" })).toBeVisible();

    const geometry = await readShellGeometry(page);
    expect(geometry.hasRightDockClass).toBe(true);
    expect(geometry.mainRect).not.toBeNull();
    expect(geometry.dockRect).not.toBeNull();

    if (!geometry.mainRect || !geometry.dockRect) {
      throw new Error(`Missing publish layout geometry for ${viewportCase.label}.`);
    }

    if (viewportCase.tier === "compact") {
      expect(geometry.dockRect.x).toBeLessThanOrEqual(geometry.mainRect.x + 12);
      expect(geometry.dockRect.y).toBeGreaterThan(geometry.mainRect.y + 40);
      expect(geometry.dockRect.width).toBeGreaterThan(geometry.mainRect.width * 0.9);
    } else {
      expect(geometry.dockRect.x).toBeGreaterThan(geometry.mainRect.x + 40);
      expect(Math.abs(geometry.dockRect.y - geometry.mainRect.y)).toBeLessThanOrEqual(24);
    }

    await expectNoHorizontalOverflow(page, `${viewportCase.label} publish`);

    await openWorkspace(page, "About");
    await expect(page.getByRole("heading", { level: 3, name: "Skald QC" })).toBeVisible();
    await expect(page.locator(".music-right-dock")).toHaveCount(0);

    await signals.assertClean(`${viewportCase.label} layout sweep`);
  });
}