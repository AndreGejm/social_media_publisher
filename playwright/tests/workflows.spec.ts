import { expect, test, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";

import {
  attachUiSignalMonitor,
  gotoCurrentShell,
  openWorkspace
} from "../support/currentShell";
import {
  installMockTauriBridge,
  simulateNativeTrackEnd,
  type MockTauriScenario
} from "../support/mockTauri";

const VALID_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B5N4AAAAASUVORK5CYII=",
  "base64"
);

async function gotoMockShell(page: Page, scenario?: MockTauriScenario) {
  await installMockTauriBridge(page, scenario);
  await gotoCurrentShell(page);
}

async function importLibraryPaths(page: Page, paths: string[]) {
  await openWorkspace(page, "Library");
  await page.getByRole("tab", { name: "Import Files" }).click();
  await page.getByRole("textbox", { name: "Import file paths" }).fill(paths.join("\n"));
  await page.getByRole("button", { name: "Import Files" }).click();
  await expect(
    page.getByText(/Imported \d+ track\(s\)\.|No tracks were imported\./i)
  ).toBeVisible({ timeout: 30_000 });
}

async function addVisibleSelectionsToQueue(page: Page, trackTitles: string[]) {
  for (const title of trackTitles) {
    const checkbox = page.getByRole("checkbox", { name: `Select ${title} for batch actions` });
    await expect(checkbox).toBeVisible({ timeout: 30_000 });
    await checkbox.check();
  }
  await page.getByRole("button", { name: "Add Selection to Queue" }).click();
}

async function openQueueMode(page: Page) {
  await page.getByRole("tab", { name: "Queue" }).click();
}

async function dropNativePath(page: Page, dropLabel: string, sourcePath: string) {
  await page.getByRole("button", { name: dropLabel }).evaluate((element, droppedPath) => {
    const dataTransfer = new DataTransfer();
    const normalizedPath = droppedPath.replace(/\\/g, "/");
    dataTransfer.setData("text/plain", droppedPath);
    dataTransfer.setData("text/uri-list", `file:///${normalizedPath}`);
    element.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
  }, sourcePath);
}

function previewTransport(page: Page) {
  return page.locator('[aria-label="Preview transport controls"]');
}

test("library to queue flow imports tracks and manages the session queue", async ({ page }) => {
  const signals = attachUiSignalMonitor(page);

  await gotoMockShell(page);
  await importLibraryPaths(page, [
    "C:/Library/Artist One - Imported A.wav",
    "C:/Library/Artist Two - Imported B.flac"
  ]);

  await openWorkspace(page, "Playlists");
  await expect(page.getByRole("list", { name: "Library tracks" })).toContainText("Imported A", {
    timeout: 30_000
  });
  await expect(page.getByRole("list", { name: "Library tracks" })).toContainText("Imported B", {
    timeout: 30_000
  });

  await addVisibleSelectionsToQueue(page, ["Imported A", "Imported B"]);
  await openQueueMode(page);

  const queueList = page.getByRole("list", { name: "Queue tracks" });
  await expect(queueList).toContainText("Imported A");
  await expect(queueList).toContainText("Imported B");

  await page.getByRole("button", { name: "Track actions for Imported A" }).click();
  await page.getByRole("menuitem", { name: "Remove from Queue" }).click();
  await expect(queueList).not.toContainText("Imported A");
  await expect(queueList).toContainText("Imported B");

  await page.getByRole("button", { name: "Clear Queue" }).click();
  await expect(page.getByText("Queue follows visible list")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear Queue" })).toBeDisabled();

  await signals.assertClean("library queue workflow", {
    allowedNotifications: [
      /Imported 2 track\(s\)\./i,
      /Added 2 tracks to queue/i,
      /Removed track from queue/i,
      /Session queue cleared/i
    ]
  });
});

test("listen queue state stays isolated from the Video workspace", async ({ page }) => {
  const signals = attachUiSignalMonitor(page);

  await gotoMockShell(page);
  await importLibraryPaths(page, ["C:/Isolation/Artist Three - Isolation Track.wav"]);

  await openWorkspace(page, "Playlists");
  await addVisibleSelectionsToQueue(page, ["Isolation Track"]);

  await openWorkspace(page, "Video Workspace");
  await expect(page.getByRole("heading", { name: "Video Rendering" })).toBeVisible();
  await expect(page.getByText("No image selected.")).toBeVisible();
  await expect(page.getByText("No audio selected.")).toBeVisible();
  await expect(page.getByRole("button", { name: /1 queue item\(s\)/i })).toBeVisible();
  await expect(page.getByTestId("video-preview-readiness")).toHaveText(
    /Import both image and audio to unlock full preview behavior/i
  );

  await signals.assertClean("workspace isolation", {
    allowedNotifications: [/Imported 1 track\(s\)\./i, /Added track to queue/i]
  });
});

test("transport controls play, pause, stop, next, previous, and auto-advance", async ({ page }) => {
  const signals = attachUiSignalMonitor(page);

  await gotoMockShell(page, {
    initialTracks: [
      { path: "C:/Transport/Artist Alpha - Track One.wav", durationMs: 120_000 },
      { path: "C:/Transport/Artist Beta - Track Two.wav", durationMs: 150_000 }
    ]
  });

  await openWorkspace(page, "Playlists");
  await addVisibleSelectionsToQueue(page, ["Track One", "Track Two"]);

  const sharedTransport = page.getByRole("region", { name: "Shared transport" });
  await sharedTransport.getByRole("button", { name: "Play" }).click();
  await expect(sharedTransport.locator("strong").first()).toHaveText("Track One");
  await expect(sharedTransport.getByRole("button", { name: "Pause" })).toBeVisible();

  await sharedTransport.getByRole("button", { name: "Next" }).click();
  await expect(sharedTransport.locator("strong").first()).toHaveText("Track Two");

  await sharedTransport.getByRole("button", { name: "Prev" }).click();
  await expect(sharedTransport.locator("strong").first()).toHaveText("Track One");

  await sharedTransport.getByRole("button", { name: "Pause" }).click();
  await expect(sharedTransport.getByRole("button", { name: "Play" })).toBeVisible();
  await sharedTransport.getByRole("button", { name: "Play" }).click();
  await expect(sharedTransport.getByRole("button", { name: "Pause" })).toBeVisible();

  await sharedTransport.getByRole("button", { name: "Stop" }).click();
  await expect(sharedTransport).toContainText("0:00");

  await sharedTransport.getByRole("button", { name: "Play" }).click();
  await simulateNativeTrackEnd(page);
  await expect(sharedTransport.locator("strong").first()).toHaveText("Track Two");

  await signals.assertClean("transport controls", {
    allowedNotifications: [/Added 2 tracks to queue/i]
  });
});

test("import and ingest handles duplicate files and unsupported formats during root scanning", async ({ page }) => {
  const signals = attachUiSignalMonitor(page);

  await gotoMockShell(page, {
    initialTracks: [{ path: "C:/Scan Root/Artist One - Imported A.wav" }]
  });

  await openWorkspace(page, "Library");
  await page.getByRole("textbox", { name: "Library root path" }).fill("C:/Scan Root");
  await page.getByRole("button", { name: "Add Folder" }).click();

  const rootRow = page.locator(".library-root-row").filter({ hasText: "C:/Scan Root" }).first();
  await expect(rootRow).toBeVisible();

  await rootRow.getByRole("button", { name: "Scan Folder" }).click();
  await expect
    .poll(async () => (await rootRow.textContent()) ?? "")
    .toContain("COMPLETED");
  await expect(rootRow).toContainText("errors 2");

  await openWorkspace(page, "Playlists");
  await expect(page.getByRole("list", { name: "Library tracks" })).toContainText("Fresh Root Track", {
    timeout: 30_000
  });
  await expect(page.getByRole("list", { name: "Library tracks" })).toContainText("Imported A", {
    timeout: 30_000
  });

  await signals.assertClean("import and ingest", {
    allowedNotifications: [/Library root added/i, /Library root scan started/i]
  });
});

test("theme preference persists across a browser-preview restart", async ({ page }) => {
  await gotoMockShell(page);

  await openWorkspace(page, "Settings");
  await page.getByRole("combobox", { name: "Theme preference" }).selectOption("light");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme ?? ""))
    .toBe("light");

  await page.reload();
  await expect(page.getByRole("tablist", { name: "Application mode" })).toBeVisible();
  await openWorkspace(page, "Settings");
  await expect(page.getByRole("combobox", { name: "Theme preference" })).toHaveValue("light");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme ?? ""))
    .toBe("light");
});

test("track QC keeps the detail view focused on metadata and release actions", async ({ page }) => {
  const signals = attachUiSignalMonitor(page);

  await gotoMockShell(page, {
    initialTracks: [{ path: "C:/QC/Example Artist - QC Coverage.wav" }]
  });

  await openWorkspace(page, "Playlists");
  await page.getByRole("button", { name: /^QC Coverage/i }).click();

  await openWorkspace(page, "Quality Control");

  const trackDetailCard = page.locator(".track-detail-card").first();
  await expect(page.getByRole("heading", { name: "Choose QC Intent" })).toBeVisible();
  await expect(trackDetailCard.getByRole("heading", { name: "QC Coverage" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search tracks" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh List" })).toHaveCount(0);
  await expect(trackDetailCard.getByRole("button", { name: "Play Now" })).toHaveCount(0);
  await expect(trackDetailCard.getByRole("button", { name: "Add to Queue" })).toHaveCount(0);
  await expect(trackDetailCard.getByRole("button", { name: "Play Next" })).toHaveCount(0);
  await expect(trackDetailCard.getByRole("button", { name: "Favorite" })).toHaveCount(0);
  await expect(trackDetailCard.getByRole("button", { name: "Edit Metadata" })).toBeVisible();
  await expect(trackDetailCard.getByRole("button", { name: "Prepare for Release..." })).toBeVisible();

  await signals.assertClean("track qc simplified detail view");
});

test("video render flow builds a request, completes, and opens the output folder", async ({ page }) => {
  const signals = attachUiSignalMonitor(page);

  await gotoMockShell(page);
  await openWorkspace(page, "Video Workspace");

  await dropNativePath(page, "Drop image file", "C:/Media/coverage-cover.png");
  await dropNativePath(page, "Drop audio file", "C:/Media/coverage-render.wav");

  await page.getByRole("textbox", { name: "Output directory" }).fill("C:/Exports");
  await page.getByRole("textbox", { name: "Output file name" }).fill("coverage-render");
  await expect(page.getByTestId("video-output-file-preview")).toContainText("C:/Exports/coverage-render.mp4");

  await page.getByRole("button", { name: "Build render request" }).click();
  await expect(page.getByTestId("video-render-request-summary")).toContainText("coverage-render.mp4");
  await expect(page.getByTestId("video-render-request-json")).toContainText("coverage-render.mp4");

  await page.getByRole("button", { name: "Render MP4" }).click();
  await expect(page.getByTestId("video-render-success-summary")).toContainText(
    "C:/Exports/coverage-render.mp4",
    { timeout: 15_000 }
  );
  await page.getByRole("button", { name: "Open Output Folder" }).click();
  await expect(page.getByTestId("video-open-output-folder-status")).toContainText(
    /Opened output folder: C:\/Exports/i
  );

  await signals.assertClean("video render success", {
    allowedConsoleErrors: [
      /Not allowed to load local resource: file:\/\/\/C:\/Media\/coverage-cover\.png/i,
      /Not allowed to load local resource: file:\/\/\/C:\/Media\/coverage-render\.wav/i
    ]
  });
});

test("video preview controls remain usable after loading valid media", async ({ page }) => {
  const signals = attachUiSignalMonitor(page);

  await gotoMockShell(page);
  await openWorkspace(page, "Video Workspace");

  await page.locator('input[aria-label="Image file dialog"]').setInputFiles({
    name: "cover.png",
    mimeType: "image/png",
    buffer: VALID_PNG_BYTES
  });
  await page.locator('input[aria-label="Audio file dialog"]').setInputFiles(
    "C:/Dev/testing chtgpt/fixtures/runtime-e2e/runtime-drop.wav"
  );

  await expect(page.getByTestId("video-preview-readiness")).toHaveText(/Preview is ready/i);
  await previewTransport(page).getByRole("button", { name: "Play" }).click();
  await expect(page.getByTestId("video-preview-status")).toContainText(/Playback:/i);

  await signals.assertClean("video preview happy path");
});

