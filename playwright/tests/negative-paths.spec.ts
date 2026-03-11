import { expect, test, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";

import {
  attachUiSignalMonitor,
  gotoCurrentShell,
  openWorkspace
} from "../support/currentShell";
import {
  deleteMockTracksByPath,
  installMockTauriBridge,
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
}

test("invalid file types and corrupt metadata surface once and keep the app usable", async ({ page }) => {
  const signals = attachUiSignalMonitor(page);

  await gotoMockShell(page);
  await importLibraryPaths(page, [
    "C:/Negative/Artist Good - Stable Track.wav",
    "C:/Negative/Artist Bad - Notes.txt",
    "C:/Negative/Artist Broken - corrupt-track.wav"
  ]);

  await expect(page.getByText(/Import failures \(2\)/i)).toBeVisible();
  await expect(page.getByText(/UNSUPPORTED_FORMAT/i)).toBeVisible();
  await expect(page.getByText(/CORRUPT_METADATA/i)).toBeVisible();

  await openWorkspace(page, "Playlists");
  await expect(page.getByRole("list", { name: "Library tracks" })).toContainText("Stable Track");

  await signals.assertClean("import negatives");
});

test("backend IPC timeout shows a single error surface and navigation still works", async ({ page }) => {
  const signals = attachUiSignalMonitor(page);

  await gotoMockShell(page, {
    commandErrors: [
      {
        command: "catalog_list_tracks",
        code: "IPC_TIMEOUT",
        message: "Catalog list request timed out."
      }
    ]
  });

  await openWorkspace(page, "Playlists");
  await expect(page.getByText(/Catalog list request timed out/i)).toHaveCount(1);

  await openWorkspace(page, "Settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await openWorkspace(page, "About");
  await expect(page.getByRole("button", { name: "Copy System Info" })).toBeVisible();

  await signals.assertClean("catalog timeout", {
    allowedNotifications: [/Catalog list request timed out/i]
  });
});

test("video preview renderer failure surfaces once and the workspace remains editable", async ({ page }) => {
  const signals = attachUiSignalMonitor(page);

  await gotoMockShell(page);
  await openWorkspace(page, "Video Workspace");

  await page.locator('input[aria-label="Image file dialog"]').setInputFiles({
    name: "cover.png",
    mimeType: "image/png",
    buffer: VALID_PNG_BYTES
  });
  await page.locator('input[aria-label="Audio file dialog"]').setInputFiles({
    name: "broken-preview.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("not-a-real-waveform")
  });

  await page.getByRole("button", { name: "Play" }).click();
  await page.evaluate(() => {
    const audio = document.querySelector('[data-testid="video-preview-audio-element"]');
    if (audio instanceof HTMLAudioElement) {
      audio.dispatchEvent(new Event("error"));
    }
  });

  await expect(page.getByText("Preview audio playback failed.")).toHaveCount(1);
  await page.getByRole("textbox", { name: "Title text" }).fill("Still editable after failure");
  await expect(page.getByTestId("video-preview-readiness")).toHaveText(/Preview is ready/i);

  await signals.assertClean("video preview failure", {
    allowedNotifications: [/Preview audio playback failed/i]
  });
});

test("scan interruption cancels cleanly without crashing the workspace", async ({ page }) => {
  const signals = attachUiSignalMonitor(page);

  await gotoMockShell(page);
  await openWorkspace(page, "Library");
  await page.getByRole("textbox", { name: "Library root path" }).fill("C:/Interrupt Root");
  await page.getByRole("button", { name: "Add Folder" }).click();
  await page.getByRole("button", { name: "Scan Folder" }).click();
  await page.getByRole("button", { name: "Cancel Scan" }).click();

  await expect
    .poll(async () => (await page.locator(".library-root-row").first().textContent()) ?? "")
    .toContain("CANCELED");

  await openWorkspace(page, "Playlists");
  await expect(page.getByRole("list", { name: "Library tracks" })).not.toContainText("Fresh Root Track");

  await signals.assertClean("scan interruption", {
    allowedNotifications: [/Library root added/i, /Library root scan started/i]
  });
});

test("queued references are pruned when their scanned root is removed", async ({ page }) => {
  const signals = attachUiSignalMonitor(page);

  await gotoMockShell(page);
  await openWorkspace(page, "Library");
  await page.getByRole("textbox", { name: "Library root path" }).fill("C:/Prune Root");
  await page.getByRole("button", { name: "Add Folder" }).click();
  await page.getByRole("button", { name: "Scan Folder" }).click();
  await expect
    .poll(async () => (await page.locator(".library-root-row").first().textContent()) ?? "")
    .toContain("COMPLETED");

  await openWorkspace(page, "Playlists");
  await page.getByRole("checkbox", { name: "Select Fresh Root Track for batch actions" }).check();
  await page.getByRole("button", { name: "Add Selection to Queue" }).click();
  await expect(page.getByRole("button", { name: /1 queue item\(s\)/i })).toBeVisible();

  await openWorkspace(page, "Library");
  await page.getByRole("button", { name: "Remove Folder" }).click();

  await openWorkspace(page, "Playlists");
  await page.getByRole("tab", { name: "Queue" }).click();
  await expect(page.getByText(/Queue is empty\. Add tracks from Library mode or Play Selection\./i)).toBeVisible();

  await signals.assertClean("deleted queue references", {
    allowedNotifications: [/Library root added/i, /Library root removed/i, /Library root scan started/i, /Added track to queue/i]
  });
});

test("deleted queue items can also be pruned through the mock backend without a crash", async ({ page }) => {
  await gotoMockShell(page, {
    initialTracks: [{ path: "C:/Deleted/Artist Deleted - Removed Soon.wav" }]
  });

  await openWorkspace(page, "Playlists");
  await page.getByRole("checkbox", { name: "Select Removed Soon for batch actions" }).check();
  await page.getByRole("button", { name: "Add Selection to Queue" }).click();
  await expect(page.getByRole("button", { name: /1 queue item\(s\)/i })).toBeVisible();

  await deleteMockTracksByPath(page, ["C:/Deleted/Artist Deleted - Removed Soon.wav"]);
  await page.reload();
  await expect(page.getByRole("tablist", { name: "Application mode" })).toBeVisible();
  await openWorkspace(page, "Playlists");
  await page.getByRole("tab", { name: "Queue" }).click();
  await expect(page.getByText(/Queue is empty/i)).toBeVisible();
});
