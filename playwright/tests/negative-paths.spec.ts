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
  readMockTauriState,
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

async function openQueueMode(page: Page) {
  await page.getByRole("tab", { name: "Queue" }).click();
}

function previewTransport(page: Page) {
  return page.locator('[aria-label="Preview transport controls"]');
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
  await expect(page.getByRole("list", { name: "Library tracks" })).toContainText("Stable Track", {
    timeout: 30_000
  });

  await signals.assertClean("import negatives", {
    allowedNotifications: [/Imported 1 track\(s\)\./i]
  });
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
  await expect(page.locator("[aria-label=\"Notifications\"]")).toContainText("Catalog list request timed out.", {
    timeout: 30_000
  });

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

  await previewTransport(page).getByRole("button", { name: "Play" }).click();
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

  await gotoMockShell(page, {
    ingestPollsBeforeComplete: 10
  });
  await openWorkspace(page, "Library");
  await page.getByRole("textbox", { name: "Library root path" }).fill("C:/Interrupt Root");
  await page.getByRole("button", { name: "Add Folder" }).click();

  const rootRow = page.locator(".library-root-row").filter({ hasText: "C:/Interrupt Root" }).first();
  await rootRow.getByRole("button", { name: "Scan Folder" }).click();
  const cancelScanButton = rootRow.getByRole("button", { name: "Cancel Scan" });
  await expect(cancelScanButton).toBeEnabled({ timeout: 30_000 });
  await cancelScanButton.click();

  await expect
    .poll(async () => (await rootRow.textContent()) ?? "")
    .toContain("CANCELED");

  await openWorkspace(page, "Playlists");
  await expect(page.getByRole("list", { name: "Library tracks" })).not.toContainText("Fresh Root Track", {
    timeout: 30_000
  });

  await signals.assertClean("scan interruption", {
    allowedNotifications: [/Library root added/i, /Library root scan started/i, /Scan cancellation requested/i]
  });
});

test("queued references are pruned when their scanned root is removed", async ({ page }) => {
  const signals = attachUiSignalMonitor(page);

  await gotoMockShell(page);
  await openWorkspace(page, "Library");
  await page.getByRole("textbox", { name: "Library root path" }).fill("C:/Prune Root");
  await page.getByRole("button", { name: "Add Folder" }).click();

  const rootRow = page.locator(".library-root-row").filter({ hasText: "C:/Prune Root" }).first();
  await rootRow.getByRole("button", { name: "Scan Folder" }).click();
  await expect
    .poll(async () => (await rootRow.textContent()) ?? "")
    .toContain("COMPLETED");

  await openWorkspace(page, "Playlists");
  await expect(page.getByRole("list", { name: "Library tracks" })).toContainText("Fresh Root Track", {
    timeout: 30_000
  });
  await page.getByRole("checkbox", { name: "Select Fresh Root Track for batch actions" }).check();
  await page.getByRole("button", { name: "Add Selection to Queue" }).click();
  await openQueueMode(page);

  const queueList = page.getByRole("list", { name: "Queue tracks" });
  await expect(queueList).toContainText("Fresh Root Track");

  await openWorkspace(page, "Library");
  await rootRow.getByRole("button", { name: "Remove Folder" }).click();

  await openWorkspace(page, "Playlists");
  await openQueueMode(page);
  await expect(page.getByText(/Queue is empty\. Add tracks from Library mode or Play Selection\./i)).toBeVisible();

  await signals.assertClean("deleted queue references", {
    allowedNotifications: [
      /Library root added/i,
      /Library root removed/i,
      /Library root scan started/i,
      /Added track to queue/i
    ]
  });
});

test("deleted queue items can also be pruned through the mock backend without a crash", async ({ page }) => {
  const signals = attachUiSignalMonitor(page);

  await gotoMockShell(page, {
    initialTracks: [{ path: "C:/Deleted/Artist Deleted - Removed Soon.wav" }]
  });

  await openWorkspace(page, "Playlists");
  const removedSoonCheckbox = page.getByRole("checkbox", {
    name: "Select Removed Soon for batch actions"
  });
  await expect(removedSoonCheckbox).toBeVisible({ timeout: 30_000 });
  await removedSoonCheckbox.check();
  await page.getByRole("button", { name: "Add Selection to Queue" }).click();
  await openQueueMode(page);
  await expect(page.getByRole("list", { name: "Queue tracks" })).toContainText("Removed Soon");

  await deleteMockTracksByPath(page, ["C:/Deleted/Artist Deleted - Removed Soon.wav"]);
  await expect.poll(async () => (await readMockTauriState(page)).queuePaths.length).toBe(0);

  await page.reload();
  await expect(page.getByRole("tablist", { name: "Application mode" })).toBeVisible();
  await openWorkspace(page, "Playlists");
  await openQueueMode(page);
  await expect(page.getByText(/Queue is empty/i)).toBeVisible();

  await signals.assertClean("backend queue pruning", {
    allowedNotifications: [/Added track to queue/i]
  });
});
