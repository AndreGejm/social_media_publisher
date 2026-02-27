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
  await expect(
    page.getByRole("heading", { name: /Release Publisher|Music Core/i }).first()
  ).toBeVisible({ timeout: 15_000 });

  return { browser, page };
}

test("failure path rejects unsafe spec path, blocks unknown command, and creates no release side effects", async () => {
  const { browser, page } = await connectTauriPage();
  try {
    const legacyPublisherUiPresent = (await page.getByTestId("spec-path-input").count()) > 0;
    test.skip(!legacyPublisherUiPresent, "legacy publisher testids are not present in this runtime shell");

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
    const legacyPublisherUiPresent = (await page.getByTestId("spec-path-input").count()) > 0;
    test.skip(!legacyPublisherUiPresent, "legacy publisher testids are not present in this runtime shell");

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

test("catalog command smoke resolves add-root/import/scan without backend timeout", async () => {
  const { browser, page } = await connectTauriPage();
  let addedRootId: string | null = null;

  try {
    const commandSmoke = await page.evaluate(
      async ({ mediaPath }) => {
        const invoke = (window as Window & {
          __TAURI_INTERNALS__?: {
            invoke?: (
              cmd: string,
              args?: Record<string, unknown>,
              options?: unknown
            ) => Promise<unknown>;
          };
        }).__TAURI_INTERNALS__?.invoke;

        if (typeof invoke !== "function") {
          return { ok: false, error: "invoke unavailable" };
        }

        const withTimeout = async <T>(promise: Promise<T>, label: string): Promise<T> => {
          const timeoutMs = 3_000;
          const timeout = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
          });
          return Promise.race([promise, timeout]);
        };

        const rootPath = mediaPath ? mediaPath.replace(/[/\\][^/\\]+$/, "") : "";
        if (!rootPath) {
          return { ok: false, error: "fixture media path missing or invalid" };
        }

        try {
          const addRoot = (await withTimeout(
            invoke("catalog_add_library_root", { path: rootPath }, undefined) as Promise<{
              root_id: string;
            }>,
            "catalog_add_library_root"
          )) as { root_id: string };

          const importResult = await withTimeout(
            invoke("catalog_import_files", { paths: [mediaPath] }, undefined) as Promise<{
              imported: unknown[];
              failed: unknown[];
            }>,
            "catalog_import_files"
          );

          const scanRoot = (await withTimeout(
            invoke("catalog_scan_root", { rootId: addRoot.root_id }, undefined) as Promise<{
              job_id: string;
              root_id: string;
            }>,
            "catalog_scan_root"
          )) as { job_id: string; root_id: string };

          const scanJob = await withTimeout(
            invoke("catalog_get_ingest_job", { jobId: scanRoot.job_id }, undefined) as Promise<unknown>,
            "catalog_get_ingest_job"
          );

          return {
            ok: true,
            rootId: addRoot.root_id,
            importResultShapeOk:
              importResult != null &&
              typeof importResult === "object" &&
              Array.isArray((importResult as { imported?: unknown[] }).imported) &&
              Array.isArray((importResult as { failed?: unknown[] }).failed),
            scanJobExists: scanJob !== null
          };
        } catch (error) {
          return { ok: false, error: String(error) };
        }
      },
      { mediaPath: fixtureMediaPath ?? "" }
    );

    expect(commandSmoke.ok).toBe(true);
    expect(commandSmoke.importResultShapeOk).toBe(true);
    expect(commandSmoke.scanJobExists).toBe(true);
    addedRootId = commandSmoke.rootId ?? null;
  } finally {
    if (addedRootId) {
      await page.evaluate(async ({ rootId }) => {
        const invoke = (window as Window & {
          __TAURI_INTERNALS__?: {
            invoke?: (
              cmd: string,
              args?: Record<string, unknown>,
              options?: unknown
            ) => Promise<unknown>;
          };
        }).__TAURI_INTERNALS__?.invoke;
        if (typeof invoke === "function") {
          try {
            await invoke("catalog_remove_library_root", { rootId }, undefined);
          } catch {
            // best-effort cleanup
          }
        }
      }, { rootId: addedRootId });
    }
    await browser.close();
  }
});
