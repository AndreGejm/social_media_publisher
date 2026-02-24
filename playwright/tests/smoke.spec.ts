import { expect, test } from "@playwright/test";

test("homepage renders release publisher shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Release Publisher" })).toBeVisible();
  await expect(page.getByText("Phase 6 workflow UI")).toBeVisible();
  await expect(page.getByTestId("screen-list")).toContainText("New Release");
  await expect(page.getByTestId("screen-list")).toContainText("Report / History");
});

test("prototype validation shows failure path for empty spec path", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("validate-plan-button").click();

  await expect(page.getByRole("alert")).toContainText("Spec file path is required for planning.");
});

test("browser preview shows structured backend error when Tauri runtime is unavailable", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("spec-path-input").fill("C:\\spec.yaml");
  await page.getByTestId("media-path-input").fill("C:\\media.bin");
  await page.getByTestId("validate-plan-button").click();

  await expect(page.getByTestId("backend-error")).toContainText(
    "TAURI_UNAVAILABLE: Tauri runtime is not available in the browser preview."
  );
});

test("browser preview can run workflow with injected Tauri mock and no external network", async ({
  page
}) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      externalRequests.push(request.url());
    }
  });

  await page.addInitScript(() => {
    type PlannedAction = { platform: string; action: string; simulated: boolean };
    type HistoryRow = { release_id: string; state: string; title: string; updated_at: string };
    type ReleaseReport = {
      release_id: string;
      summary: string;
      actions: PlannedAction[];
    };

    const state: {
      releaseId: string | null;
      history: HistoryRow[];
      report: ReleaseReport | null;
    } = {
      releaseId: null,
      history: [],
      report: null
    };

    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: async (command: string, args?: Record<string, unknown>) => {
          switch (command) {
            case "load_spec":
              return {
                ok: true,
                spec: {
                  title: "Playwright Track",
                  artist: "QA Bot",
                  description: "test",
                  tags: ["mock"]
                },
                errors: [],
                canonical_path: "C:/fixtures/spec.yaml"
              };
            case "plan_release": {
              const env = ((args?.input as { env?: string } | undefined)?.env ?? "TEST") as string;
              state.releaseId = "b".repeat(64);
              state.history = [
                {
                  release_id: state.releaseId,
                  state: "PLANNED",
                  title: "Playwright Track",
                  updated_at: "2026-02-24T00:00:00Z"
                }
              ];
              return {
                release_id: state.releaseId,
                run_id: "pw-run-1",
                env,
                planned_actions: [{ platform: "mock", action: "mock.plan", simulated: true }],
                planned_request_files: { mock: "artifacts/planned_requests/mock.json" }
              };
            }
            case "execute_release": {
              const releaseId =
                ((args as { release_id?: string } | undefined)?.release_id as string | undefined) ??
                state.releaseId ??
                "unknown";
              state.history = [
                {
                  release_id: releaseId,
                  state: "COMMITTED",
                  title: "Playwright Track",
                  updated_at: "2026-02-24T00:00:01Z"
                }
              ];
              state.report = {
                release_id: releaseId,
                summary: "Playwright Track [COMMITTED] 1 platform(s)",
                actions: [{ platform: "mock", action: "VERIFIED (simulated)", simulated: true }]
              };
              return {
                release_id: releaseId,
                status: "COMMITTED",
                message: "Execution completed (TEST mode remains simulation-only).",
                report_path: "artifacts/release_report.json"
              };
            }
            case "list_history":
              return state.history;
            case "get_report":
              return state.report;
            default:
              throw { code: "UNKNOWN_COMMAND", message: `Unhandled command ${command}` };
          }
        }
      }
    };
  });

  await page.goto("/");
  await page.getByTestId("spec-path-input").fill("C:\\spec.yaml");
  await page.getByTestId("media-path-input").fill("C:\\media.bin");

  await page.getByTestId("load-spec-button").click();
  await expect(page.getByTestId("normalized-spec-summary")).toContainText("title: Playwright Track");

  await page.getByTestId("validate-plan-button").click();
  await expect(page.getByTestId("plan-summary")).toContainText("actions: 1");
  await expect(page.getByTestId("planned-actions-list")).toContainText("mock: mock.plan");

  await page.getByTestId("execute-button").click();
  await expect(page.getByTestId("status-summary")).toContainText("COMMITTED:");
  await expect(page.getByTestId("history-list")).toContainText("COMMITTED");
  await expect(page.getByTestId("report-summary")).toContainText("COMMITTED");
  await expect(page.getByTestId("report-actions-list")).toContainText("VERIFIED (simulated)");
  expect(externalRequests).toEqual([]);
});
