import { FormEvent, useMemo, useState } from "react";

import { invoke as tauriInvoke } from "@tauri-apps/api/core";

type Screen = "New Release" | "Plan / Preview" | "Execute" | "Report / History";
type AppEnv = "TEST" | "STAGING" | "PRODUCTION";

type UiAppError = { code: string; message: string; details?: unknown };
type SpecError = { code: string; field?: string | null; message: string };

type ReleaseSpec = {
  title: string;
  artist: string;
  description: string;
  tags: string[];
  mock?: { enabled: boolean; note?: string | null } | null;
};

type LoadSpecResponse = {
  ok: boolean;
  spec: ReleaseSpec | null;
  errors: SpecError[];
  canonical_path?: string | null;
};

type PlannedAction = { platform: string; action: string; simulated: boolean };
type PlanReleaseResponse = {
  release_id: string;
  run_id: string;
  env: AppEnv;
  planned_actions: PlannedAction[];
  planned_request_files: Record<string, string>;
};

type ExecuteReleaseResponse = {
  release_id: string;
  status: string;
  message: string;
  report_path?: string | null;
};

type HistoryRow = { release_id: string; state: string; title: string; updated_at: string };
type ReleaseReport = { release_id: string; summary: string; actions: PlannedAction[]; raw?: unknown };

const screens: Screen[] = ["New Release", "Plan / Preview", "Execute", "Report / History"];

declare global {
  interface Window {
    __TAURI__?: { core?: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> } };
  }
}

async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const globalInvoke = window.__TAURI__?.core?.invoke;
  if (globalInvoke) {
    return globalInvoke<T>(command, args);
  }

  try {
    if (typeof tauriInvoke !== "function") {
      throw new Error("invoke unavailable");
    }
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      "message" in error &&
      typeof (error as { code?: unknown }).code === "string" &&
      typeof (error as { message?: unknown }).message === "string"
    ) {
      throw error;
    }
    throw {
      code: "TAURI_UNAVAILABLE",
      message: "Tauri runtime is not available in the browser preview.",
      details: { command }
    } satisfies UiAppError;
  }
}

function redactErrorDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactErrorDetails);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(obj).map(([key, item]) => {
        const lower = key.toLowerCase();
        const secret =
          lower.includes("authorization") ||
          lower.includes("cookie") ||
          lower.includes("refresh_token") ||
          lower.includes("refresh-token") ||
          lower.includes("client_secret") ||
          lower.includes("client-secret") ||
          lower.includes("api_key") ||
          lower.includes("api-key");
        return [key, secret ? "<redacted>" : redactErrorDetails(item)];
      })
    );
  }
  return value;
}

function normalizeAppError(error: unknown): UiAppError {
  if (error && typeof error === "object") {
    const maybe = error as Partial<UiAppError>;
    if (typeof maybe.code === "string" && typeof maybe.message === "string") {
      return { code: maybe.code, message: maybe.message, details: redactErrorDetails(maybe.details) };
    }
  }
  return { code: "UNEXPECTED_UI_ERROR", message: error instanceof Error ? error.message : "Unknown UI error" };
}

function formatSpecErrors(errors: SpecError[]): string {
  return errors
    .map((e) => `${e.code}${e.field ? ` (${e.field})` : ""}: ${e.message}`)
    .join(" | ");
}

export default function App() {
  const [activeScreen, setActiveScreen] = useState<Screen>("New Release");
  const [specPath, setSpecPath] = useState("");
  const [mediaPath, setMediaPath] = useState("");
  const [env, setEnv] = useState<AppEnv>("TEST");
  const [mockSelected, setMockSelected] = useState(true);

  const [uiError, setUiError] = useState<string | null>(null);
  const [backendError, setBackendError] = useState<UiAppError | null>(null);
  const [statusMessage, setStatusMessage] = useState("Idle.");

  const [loadedSpec, setLoadedSpec] = useState<LoadSpecResponse | null>(null);
  const [planResult, setPlanResult] = useState<PlanReleaseResponse | null>(null);
  const [executeResult, setExecuteResult] = useState<ExecuteReleaseResponse | null>(null);
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [selectedHistoryReleaseId, setSelectedHistoryReleaseId] = useState("");
  const [report, setReport] = useState<ReleaseReport | null>(null);

  const [loadingSpec, setLoadingSpec] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [refreshingHistory, setRefreshingHistory] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);

  const selectedPlatforms = useMemo(() => (mockSelected ? ["mock"] : []), [mockSelected]);

  const setStructuredError = (error: unknown, fallbackStatus: string) => {
    const appError = normalizeAppError(error);
    setBackendError(appError);
    setStatusMessage(fallbackStatus);
    if (appError.details !== undefined) {
      console.error("release-publisher.error.details", appError.details);
    }
  };

  const validatePathsAndPlatforms = (event?: FormEvent) => {
    event?.preventDefault();
    if (!specPath.trim()) {
      setUiError("Spec file path is required for planning.");
      return false;
    }
    if (!mediaPath.trim()) {
      setUiError("Media file path is required for planning.");
      return false;
    }
    if (selectedPlatforms.length === 0) {
      setUiError("Select at least one platform.");
      return false;
    }
    setUiError(null);
    return true;
  };

  const refreshHistory = async () => {
    setRefreshingHistory(true);
    try {
      const rows = await invokeCommand<HistoryRow[]>("list_history");
      setHistoryRows(rows);
      if (!selectedHistoryReleaseId && rows[0]) {
        setSelectedHistoryReleaseId(rows[0].release_id);
      }
      return rows;
    } finally {
      setRefreshingHistory(false);
    }
  };

  const loadReportFor = async (releaseId: string) => {
    if (!releaseId.trim()) {
      setReport(null);
      return null;
    }
    setLoadingReport(true);
    try {
      const result = await invokeCommand<ReleaseReport | null>("get_report", { releaseId });
      setReport(result);
      return result;
    } finally {
      setLoadingReport(false);
    }
  };

  const onLoadSpec = async () => {
    if (!specPath.trim()) {
      setUiError("Spec file path is required for planning.");
      return;
    }
    setUiError(null);
    setBackendError(null);
    setLoadingSpec(true);
    setStatusMessage("Loading and validating spec...");
    try {
      const response = await invokeCommand<LoadSpecResponse>("load_spec", { path: specPath });
      setLoadedSpec(response);
      setActiveScreen("Plan / Preview");
      setStatusMessage(response.ok ? "Spec parsed and normalized." : `Spec validation failed: ${response.errors.length} issue(s).`);
    } catch (error) {
      setStructuredError(error, "Spec load failed.");
    } finally {
      setLoadingSpec(false);
    }
  };

  const onPlanPreview = async (event: FormEvent) => {
    if (!validatePathsAndPlatforms(event)) return;
    setBackendError(null);
    setPlanning(true);
    setStatusMessage("Planning release...");
    try {
      const response = await invokeCommand<PlanReleaseResponse>("plan_release", {
        input: {
          spec_path: specPath,
          media_path: mediaPath,
          platforms: selectedPlatforms,
          env
        }
      });
      setPlanResult(response);
      setExecuteResult(null);
      setActiveScreen("Plan / Preview");
      setStatusMessage(`Planned ${response.planned_actions.length} action(s) in ${response.env}.`);
      await refreshHistory().catch(() => undefined);
    } catch (error) {
      setStructuredError(error, "Plan failed.");
    } finally {
      setPlanning(false);
    }
  };

  const onExecute = async (explicitReleaseId?: string) => {
    const releaseId = explicitReleaseId ?? planResult?.release_id ?? selectedHistoryReleaseId;
    if (!releaseId) {
      setBackendError({ code: "NOT_PLANNED", message: "Plan a release before executing." });
      return;
    }
    setBackendError(null);
    setExecuting(true);
    setStatusMessage(`Executing release ${releaseId.slice(0, 8)}...`);
    try {
      const response = await invokeCommand<ExecuteReleaseResponse>("execute_release", { releaseId });
      setExecuteResult(response);
      setSelectedHistoryReleaseId(response.release_id);
      setActiveScreen("Execute");
      setStatusMessage(`${response.status}: ${response.message}`);
      await refreshHistory();
      await loadReportFor(response.release_id);
      setActiveScreen("Report / History");
    } catch (error) {
      setStructuredError(error, "Execution failed.");
    } finally {
      setExecuting(false);
    }
  };

  const onRefreshHistory = async () => {
    setBackendError(null);
    setStatusMessage("Refreshing history...");
    try {
      const rows = await refreshHistory();
      setActiveScreen("Report / History");
      setStatusMessage(`Loaded ${rows.length} release(s) from history.`);
    } catch (error) {
      setStructuredError(error, "History refresh failed.");
    }
  };

  const onOpenReport = async () => {
    if (!selectedHistoryReleaseId) {
      setUiError("Select a release in history first.");
      return;
    }
    setUiError(null);
    setBackendError(null);
    setStatusMessage("Loading report...");
    try {
      const result = await loadReportFor(selectedHistoryReleaseId);
      setActiveScreen("Report / History");
      setStatusMessage(result ? "Report loaded." : "No report artifact found for the selected release.");
    } catch (error) {
      setStructuredError(error, "Report load failed.");
    }
  };

  const onResume = async () => {
    if (!selectedHistoryReleaseId) {
      setUiError("Select a release in history first.");
      return;
    }
    await onExecute(selectedHistoryReleaseId);
  };

  return (
    <main className="app-shell">
      <header className="hero">
        <p className="eyebrow">Phase 6 workflow UI</p>
        <h1>Release Publisher</h1>
        <p className="lede">
          Tauri commands are wired to the hardened Rust core. TEST mode remains simulation-only.
        </p>
      </header>

      <section className="panel" aria-labelledby="workflow-heading">
        <h2 id="workflow-heading">Workflow Screens</h2>
        <ul data-testid="screen-list" className="screen-list">
          {screens.map((screen) => (
            <li key={screen}>
              <button
                type="button"
                className={`tab-button${activeScreen === screen ? " active" : ""}`}
                onClick={() => setActiveScreen(screen)}
              >
                {screen}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel grid" aria-labelledby="new-release-heading">
        <div>
          <h2 id="new-release-heading">New Release</h2>
          <form onSubmit={onPlanPreview} noValidate>
            <label htmlFor="spec-path-input">Spec File Path</label>
            <div className="form-row single">
              <input
                id="spec-path-input"
                data-testid="spec-path-input"
                type="text"
                value={specPath}
                onChange={(event) => setSpecPath(event.target.value)}
                placeholder="C:\\path\\to\\release.yaml"
              />
            </div>

            <label htmlFor="media-path-input">Media File Path</label>
            <div className="form-row single">
              <input
                id="media-path-input"
                data-testid="media-path-input"
                type="text"
                value={mediaPath}
                onChange={(event) => setMediaPath(event.target.value)}
                placeholder="C:\\path\\to\\media.bin"
              />
            </div>

            <label htmlFor="env-select">Environment</label>
            <div className="form-row single">
              <select
                id="env-select"
                data-testid="env-select"
                value={env}
                onChange={(event) => setEnv(event.target.value as AppEnv)}
              >
                <option value="TEST">TEST</option>
                <option value="STAGING">STAGING</option>
                <option value="PRODUCTION">PRODUCTION</option>
              </select>
            </div>

            <fieldset className="platform-fieldset">
              <legend>Platforms</legend>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  data-testid="platform-mock-checkbox"
                  checked={mockSelected}
                  onChange={(event) => setMockSelected(event.target.checked)}
                />
                Mock connector (safe simulation)
              </label>
            </fieldset>

            <div className="action-row">
              <button type="button" data-testid="load-spec-button" onClick={onLoadSpec} disabled={loadingSpec || planning || executing}>
                {loadingSpec ? "Loading Spec..." : "Load Spec"}
              </button>
              <button type="submit" data-testid="validate-plan-button" disabled={planning || executing}>
                {planning ? "Planning..." : "Plan / Preview"}
              </button>
              <button type="button" data-testid="execute-button" onClick={() => void onExecute()} disabled={executing || !planResult?.release_id}>
                {executing ? "Executing..." : "Execute"}
              </button>
            </div>
          </form>

          {uiError ? (
            <p role="alert" className="error-text">{uiError}</p>
          ) : (
            <p className="helper-text">
              Browser preview can use an injected Tauri mock. Desktop runtime calls real Rust commands.
            </p>
          )}
          {backendError ? (
            <p role="status" className="error-text" data-testid="backend-error">
              {backendError.code}: {backendError.message}
            </p>
          ) : null}
          <div className="helper-text" data-testid="status-summary">{statusMessage}</div>
          <div className="helper-text" data-testid="plan-summary">
            Planned release: {planResult?.release_id ?? "none"} | actions: {planResult?.planned_actions.length ?? 0} | history: {historyRows.length}
          </div>
        </div>

        <div>
          <h3>Safety Model</h3>
          <ul className="compact-list">
            <li>TEST mode is simulation-only in Rust core.</li>
            <li>Per-run caps are enforced in core and tested.</li>
            <li>Idempotent reruns reuse the same release_id.</li>
          </ul>
          <div className="mini-card"><strong>Selected ENV:</strong> <span data-testid="env-display">{env}</span></div>
          <div className="mini-card"><strong>Selected platforms:</strong> <span data-testid="selected-platforms">{selectedPlatforms.join(", ") || "none"}</span></div>
        </div>
      </section>

      <section className="panel" aria-labelledby="plan-preview-heading">
        <h2 id="plan-preview-heading">Plan / Preview</h2>
        <div className="grid">
          <div>
            <h3>Normalized Spec Summary</h3>
            <div data-testid="normalized-spec-summary" className="code-block">
              {loadedSpec?.ok && loadedSpec.spec ? (
                <>
                  <div>title: {loadedSpec.spec.title}</div>
                  <div>artist: {loadedSpec.spec.artist}</div>
                  <div>description: {loadedSpec.spec.description || "(empty)"}</div>
                  <div>tags: {loadedSpec.spec.tags.join(", ") || "(none)"}</div>
                  <div>spec_path: {loadedSpec.canonical_path ?? "n/a"}</div>
                </>
              ) : loadedSpec && !loadedSpec.ok ? (
                <div>invalid spec: {formatSpecErrors(loadedSpec.errors)}</div>
              ) : (
                <div>Load a spec to preview normalized metadata.</div>
              )}
            </div>
          </div>

          <div>
            <h3>Planned Actions</h3>
            <ul data-testid="planned-actions-list" className="compact-list">
              {planResult?.planned_actions.length ? (
                planResult.planned_actions.map((action, index) => (
                  <li key={`${action.platform}-${index}`}>
                    {action.platform}: {action.action} [{action.simulated ? "simulated" : "live"}]
                  </li>
                ))
              ) : (
                <li>No plan yet.</li>
              )}
            </ul>
            <div className="helper-text" data-testid="planned-request-files">
              {planResult
                ? Object.entries(planResult.planned_request_files).map(([platform, path]) => `${platform}: ${path}`).join(" | ")
                : "planned_requests/*.json will appear here after planning"}
            </div>
          </div>
        </div>
      </section>

      <section className="panel" aria-labelledby="execute-heading">
        <h2 id="execute-heading">Execute</h2>
        <div className="grid">
          <div className="mini-card" data-testid="execute-result">
            <div><strong>Release:</strong> {executeResult?.release_id ?? planResult?.release_id ?? "none"}</div>
            <div><strong>Status:</strong> {executeResult?.status ?? "not executed"}</div>
            <div><strong>Message:</strong> {executeResult?.message ?? "Execution has not run yet."}</div>
            <div><strong>Report Path:</strong> {executeResult?.report_path ?? "not generated"}</div>
          </div>
          <div>
            <h3>Execution Notes</h3>
            <ul className="compact-list">
              <li>TEST mode blocks irreversible publish actions in the core.</li>
              <li>Mock connector is the only available platform in this phase.</li>
              <li>History/report are refreshed after execute.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="panel" aria-labelledby="history-heading">
        <h2 id="history-heading">Report / History</h2>
        <div className="action-row">
          <button type="button" data-testid="refresh-history-button" onClick={onRefreshHistory} disabled={refreshingHistory}>
            {refreshingHistory ? "Refreshing..." : "Refresh History"}
          </button>
          <button type="button" data-testid="open-report-button" onClick={onOpenReport} disabled={loadingReport || !selectedHistoryReleaseId}>
            {loadingReport ? "Loading Report..." : "Open Report"}
          </button>
          <button type="button" data-testid="resume-release-button" onClick={onResume} disabled={executing || !selectedHistoryReleaseId}>
            Resume
          </button>
        </div>

        <div className="grid history-grid">
          <div>
            <h3>History</h3>
            <ul data-testid="history-list" className="history-list">
              {historyRows.length ? (
                historyRows.map((row) => (
                  <li key={row.release_id}>
                    <label className="history-row">
                      <input
                        type="radio"
                        name="history-selection"
                        checked={selectedHistoryReleaseId === row.release_id}
                        onChange={() => setSelectedHistoryReleaseId(row.release_id)}
                      />
                      <span className="history-row-title">{row.title}</span>
                      <span className="history-row-state">{row.state}</span>
                      <code className="history-row-id">{row.release_id.slice(0, 12)}</code>
                    </label>
                  </li>
                ))
              ) : (
                <li>No releases in history yet.</li>
              )}
            </ul>
          </div>

          <div>
            <h3>Report</h3>
            <div className="code-block" data-testid="report-summary">
              {report ? (
                <>
                  <div>{report.summary}</div>
                  <div>release_id: {report.release_id}</div>
                </>
              ) : (
                <div>No report selected.</div>
              )}
            </div>
            <ul data-testid="report-actions-list" className="compact-list">
              {report?.actions.length ? (
                report.actions.map((action, index) => <li key={`${action.platform}-${index}`}>{action.platform}: {action.action}</li>)
              ) : (
                <li>No report actions loaded.</li>
              )}
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
