import { chromium, expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const cdpUrl = process.env.TAURI_E2E_CDP_URL;
const fixtureSpecPath = process.env.TAURI_E2E_FIXTURE_SPEC_PATH;
const fixtureInvalidSpecPath = process.env.TAURI_E2E_FIXTURE_INVALID_SPEC_PATH;
const fixtureMediaPath = process.env.TAURI_E2E_FIXTURE_MEDIA_PATH;
const dataDir = process.env.TAURI_E2E_DATA_DIR;

test.describe.configure({ mode: "serial" });
test.skip(
  !cdpUrl || !fixtureSpecPath || !fixtureInvalidSpecPath || !fixtureMediaPath || !dataDir,
  "TAURI runtime E2E env vars are not configured"
);

async function connectTauriPage() {
  if (!cdpUrl) {
    throw new Error("TAURI_E2E_CDP_URL is required");
  }

  const browser = await chromium.connectOverCDP(cdpUrl);
  let page = browser.contexts().flatMap((context) => context.pages())[0];

  for (let i = 0; i < 30 && !page; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    page = browser.contexts().flatMap((context) => context.pages())[0];
  }

  if (!page) {
    await browser.close();
    throw new Error("No Tauri webview page was available via CDP");
  }

  await page.reload();
  await expect(page.getByRole("heading", { name: "Release Publisher" })).toBeVisible();

  return { browser, page };
}

test("failure path rejects unsafe spec path, blocks unknown command, and creates no release side effects", async () => {
  const { browser, page } = await connectTauriPage();
  try {
    await page.getByTestId("spec-path-input").fill("file://C:/unsafe.yaml");
    await page.getByTestId("media-path-input").fill(fixtureMediaPath ?? "");
    await page.getByTestId("load-spec-button").click();

    await expect(page.getByTestId("backend-error")).toContainText("INVALID_ARGUMENT");
    await expect(page.getByTestId("history-list")).toContainText("No releases in history yet.");

    const allowlistProbe = await page.evaluate(async () => {
      const invoke = (window as Window & {
        __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: Record<string, unknown>, options?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__?.invoke;
      if (typeof invoke !== "function") {
        return { listHistoryWorked: false, unknownRejected: false, unknownError: "invoke unavailable" };
      }

      let listHistoryWorked = false;
      let unknownRejected = false;
      let unknownError = "";

      try {
        const rows = (await invoke("list_history", {}, undefined)) as unknown[];
        listHistoryWorked = Array.isArray(rows);
      } catch (error) {
        listHistoryWorked = false;
        unknownError = String(error);
      }

      try {
        await invoke("definitely_not_allowed_command", {}, undefined);
      } catch (error) {
        unknownRejected = true;
        unknownError = String(error);
      }

      return { listHistoryWorked, unknownRejected, unknownError };
    });

    expect(allowlistProbe.listHistoryWorked).toBe(true);
    expect(allowlistProbe.unknownRejected).toBe(true);

    const artifactsRoot = path.join(dataDir ?? "", "artifacts");
    if (fs.existsSync(artifactsRoot)) {
      const reports = fs.readdirSync(artifactsRoot, { recursive: true }).filter((entry) =>
        String(entry).endsWith("release_report.json")
      );
      expect(reports).toHaveLength(0);
    }
  } finally {
    await browser.close();
  }
});

test("happy path loads spec, plans, executes in TEST mode, and writes report/DB artifacts", async () => {
  const { browser, page } = await connectTauriPage();
  try {
    await page.getByTestId("spec-path-input").fill(fixtureSpecPath ?? "");
    await page.getByTestId("media-path-input").fill(fixtureMediaPath ?? "");
    await page.getByTestId("env-select").selectOption("TEST");

    await page.getByTestId("load-spec-button").click();
    await expect(page.getByTestId("normalized-spec-summary")).toContainText("title:");

    await page.getByTestId("validate-plan-button").click();
    await expect(page.getByTestId("planned-actions-list")).toContainText("mock:");
    await expect(page.getByTestId("plan-summary")).toContainText("actions: 1");

    await page.getByTestId("execute-button").click();
    await expect(page.getByTestId("status-summary")).toContainText("COMMITTED:");
    await expect(page.getByTestId("history-list")).toContainText("COMMITTED");
    await expect(page.getByTestId("report-summary")).toContainText("COMMITTED");
    await expect(page.getByTestId("report-actions-list")).toContainText("VERIFIED");

    const dbPath = path.join(dataDir ?? "", "release_publisher.sqlite");
    expect(fs.existsSync(dbPath)).toBe(true);

    const artifactsRoot = path.join(dataDir ?? "", "artifacts");
    expect(fs.existsSync(artifactsRoot)).toBe(true);

    const reportPaths = fs
      .readdirSync(artifactsRoot, { recursive: true })
      .map((entry) => path.join(artifactsRoot, String(entry)))
      .filter((entry) => entry.endsWith("release_report.json"));
    expect(reportPaths.length).toBeGreaterThanOrEqual(1);

    const reportText = fs.readFileSync(reportPaths[0], "utf8");
    expect(reportText).toContain("\"state\": \"COMMITTED\"");
  } finally {
    await browser.close();
  }
});
