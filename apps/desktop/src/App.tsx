import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { HelpTooltip } from "./HelpTooltip";

export type PublisherOpsScreen = "New Release" | "Plan / Preview" | "Execute" | "Report / History";
type Screen = PublisherOpsScreen;
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
type TrackModel = { file_path: string; duration_ms: number; peak_data: number[]; loudness_lufs: number };
type ReleaseModel = { id: string; title: string; artist: string; tracks: TrackModel[] };
type QcAnalysisView = {
  release: ReleaseModel;
  track: TrackModel;
  media_fingerprint: string;
  sample_rate_hz: number;
  channels: number;
  created_at?: string;
  updated_at?: string;
};
type QcApprovalRecord = { approved_at: string };

const screens: Screen[] = ["New Release", "Plan / Preview", "Execute", "Report / History"];
const screenHelpText: Record<Screen, string> = {
  "New Release": "Enter file paths, choose environment, and prepare a release run.",
  "Plan / Preview": "Review normalized metadata and simulated platform actions before execution.",
  Execute: "Review the most recent execute result and execution notes.",
  "Report / History": "Browse saved releases, reports, and resume previous runs."
};

declare global {
  interface Window {
    __TAURI__?: { core?: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> } };
    __RELEASE_PUBLISHER_DEBUG_ERROR_DETAILS__?: boolean;
    __RELEASE_PUBLISHER_DEBUG_FULL_PATHS__?: boolean;
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

function shouldLogBackendErrorDetails(): boolean {
  return window.__RELEASE_PUBLISHER_DEBUG_ERROR_DETAILS__ === true;
}

function normalizeDisplayPath(path: string): string {
  return path.split("\\").join("/");
}

function isLikelyAbsolutePath(path: string): boolean {
  return /^[a-zA-Z]:\//.test(path) || path.startsWith("//") || path.startsWith("/");
}

function redactAbsolutePathForDisplay(path: string): string {
  const normalized = normalizeDisplayPath(path);
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) return "[local]/...";
  const tail = segments.slice(-2).join("/");
  return `[local]/.../${tail}`;
}

function shouldRevealFullDiagnosticPaths(env: AppEnv): boolean {
  return env === "TEST" && window.__RELEASE_PUBLISHER_DEBUG_FULL_PATHS__ === true;
}

function formatDiagnosticPath(path: string | null | undefined, revealFullPaths: boolean): string {
  if (!path) return "n/a";
  const normalized = normalizeDisplayPath(path);
  if (revealFullPaths || !isLikelyAbsolutePath(normalized)) {
    return normalized;
  }
  return redactAbsolutePathForDisplay(normalized);
}

function formatSpecErrors(errors: SpecError[]): string {
  return errors
    .map((e) => `${e.code}${e.field ? ` (${e.field})` : ""}: ${e.message}`)
    .join(" | ");
}

type AppProps = {
  prefillMediaPath?: string | null;
  prefillSpecPath?: string | null;
  sharedTransport?: SharedTransportBridgeForPublisherOps | null;
  externalRequestedScreen?: PublisherOpsScreen | null;
  onScreenChange?: ((screen: PublisherOpsScreen) => void) | null;
  showInternalWorkflowTabs?: boolean;
};

export type SharedTransportSourceForPublisherOps = {
  sourceKey: string;
  filePath: string;
  title: string;
  artist: string;
  durationMs: number;
};

export type SharedTransportBridgeForPublisherOps = {
  state: {
    sourceKey: string | null;
    currentTimeSec: number;
    isPlaying: boolean;
  };
  ensureSource: (
    source: SharedTransportSourceForPublisherOps,
    options?: { autoplay?: boolean }
  ) => void;
  seekToRatio: (sourceKey: string, ratio: number) => void;
};

function toPublisherOpsSharedTransportSource(
  analysis: QcAnalysisView
): SharedTransportSourceForPublisherOps {
  return {
    sourceKey: `publisher-qc:${analysis.release.id}:${analysis.media_fingerprint}`,
    filePath: analysis.track.file_path,
    title: analysis.release.title,
    artist: analysis.release.artist,
    durationMs: analysis.track.duration_ms
  };
}

export default function App({
  prefillMediaPath = null,
  prefillSpecPath = null,
  sharedTransport = null,
  externalRequestedScreen = null,
  onScreenChange = null,
  showInternalWorkflowTabs = true
}: AppProps) {
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
  const [qcAnalysis, setQcAnalysis] = useState<QcAnalysisView | null>(null);
  const [qcApprovedByReleaseId] = useState<Record<string, QcApprovalRecord>>({});
  const [, setQcCurrentTimeSec] = useState(0);
  const [, setQcIsPlaying] = useState(false);

  const [loadingSpec, setLoadingSpec] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [refreshingHistory, setRefreshingHistory] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const historyRequestSeqRef = useRef(0);
  const reportRequestSeqRef = useRef(0);
  const qcAudioRef = useRef<HTMLAudioElement>(null);
  const lastBroadcastScreenRef = useRef<Screen | null>(null);

  useEffect(() => {
    if (!externalRequestedScreen) return;
    setActiveScreen((current) => (current === externalRequestedScreen ? current : externalRequestedScreen));
  }, [externalRequestedScreen]);

  useEffect(() => {
    if (!onScreenChange) return;
    // Avoid broadcasting stale screen state while an external screen request is still syncing.
    if (externalRequestedScreen && activeScreen !== externalRequestedScreen) return;
    if (lastBroadcastScreenRef.current === activeScreen) return;
    lastBroadcastScreenRef.current = activeScreen;
    onScreenChange(activeScreen);
  }, [activeScreen, externalRequestedScreen, onScreenChange]);

  useEffect(() => {
    const nextMediaPath = prefillMediaPath?.trim();
    const nextSpecPath = prefillSpecPath?.trim();
    if (!nextMediaPath && !nextSpecPath) return;

    if (nextMediaPath) {
      setMediaPath((current) => (current === nextMediaPath ? current : nextMediaPath));
    }
    if (nextSpecPath) {
      setSpecPath((current) => (current === nextSpecPath ? current : nextSpecPath));
    }
    setLoadedSpec(null);
    setPlanResult(null);
    setExecuteResult(null);
    setReport(null);
    setQcAnalysis(null);
    setQcCurrentTimeSec(0);
    setQcIsPlaying(false);
    setActiveScreen("New Release");
    setStatusMessage("Loaded draft from Library into Publisher Ops. Review spec and continue planning.");
  }, [prefillMediaPath, prefillSpecPath]);

  const selectedPlatforms = useMemo(() => (mockSelected ? ["mock"] : []), [mockSelected]);
  const revealFullDiagnosticPaths = shouldRevealFullDiagnosticPaths(env);
  const currentPlannedReleaseId = planResult?.release_id ?? "";
  const qcApprovalForCurrentPlan = currentPlannedReleaseId ? qcApprovedByReleaseId[currentPlannedReleaseId] : undefined;
  const qcSharedTransportSource = useMemo(
    () => (qcAnalysis ? toPublisherOpsSharedTransportSource(qcAnalysis) : null),
    [qcAnalysis]
  );

  const setStructuredError = (error: unknown, fallbackStatus: string) => {
    const appError = normalizeAppError(error);
    setBackendError(appError);
    setStatusMessage(fallbackStatus);
    if (appError.details !== undefined && shouldLogBackendErrorDetails()) {
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

  const resetQcPlayback = () => {
    if (sharedTransport) {
      setQcCurrentTimeSec(0);
      setQcIsPlaying(false);
      return;
    }
    const audio = qcAudioRef.current;
    if (audio) {
      if (!audio.paused) {
        try {
          audio.pause();
        } catch {
          // jsdom / unsupported media runtime
        }
      }
      try {
        audio.currentTime = 0;
      } catch {
        // unsupported media runtime / unloaded media element
      }
    }
    setQcCurrentTimeSec(0);
    setQcIsPlaying(false);
  };

  useEffect(() => {
    if (!sharedTransport || !qcSharedTransportSource) return;
    sharedTransport.ensureSource(qcSharedTransportSource, { autoplay: false });
  }, [sharedTransport, qcSharedTransportSource]);

  const refreshHistory = async () => {
    const requestSeq = historyRequestSeqRef.current + 1;
    historyRequestSeqRef.current = requestSeq;
    setRefreshingHistory(true);
    try {
      const rows = await invokeCommand<HistoryRow[]>("list_history");
      if (requestSeq !== historyRequestSeqRef.current) {
        return rows;
      }
      setHistoryRows(rows);
      if (!selectedHistoryReleaseId && rows[0]) {
        setSelectedHistoryReleaseId(rows[0].release_id);
      }
      return rows;
    } finally {
      if (requestSeq === historyRequestSeqRef.current) {
        setRefreshingHistory(false);
      }
    }
  };

  const loadReportFor = async (releaseId: string) => {
    const requestSeq = reportRequestSeqRef.current + 1;
    reportRequestSeqRef.current = requestSeq;
    if (!releaseId.trim()) {
      setReport(null);
      return null;
    }
    setLoadingReport(true);
    try {
      const result = await invokeCommand<ReleaseReport | null>("get_report", { releaseId });
      if (requestSeq !== reportRequestSeqRef.current) {
        return result;
      }
      setReport(result);
      return result;
    } finally {
      if (requestSeq === reportRequestSeqRef.current) {
        setLoadingReport(false);
      }
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
      setQcAnalysis(null);
      resetQcPlayback();
      setActiveScreen("Plan / Preview");
      setStatusMessage(`Planned ${response.planned_actions.length} action(s) in ${response.env}. Review actions, then run Execute when ready.`);
      void refreshHistory().catch(() => undefined);
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
    setUiError(null);
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

      {showInternalWorkflowTabs ? (
        <section className="panel" aria-labelledby="workflow-heading">
          <h2 id="workflow-heading">Workflow Screens</h2>
          <ul data-testid="screen-list" className="screen-list">
            {screens.map((screen) => (
              <li key={screen}>
                <HelpTooltip content={screenHelpText[screen]} side="bottom">
                  <button
                    type="button"
                    className={`tab-button${activeScreen === screen ? " active" : ""}`}
                    onClick={() => setActiveScreen(screen)}
                  >
                    {screen}
                  </button>
                </HelpTooltip>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section hidden={activeScreen !== "New Release"} className="panel grid" aria-labelledby="new-release-heading">
        <div>
          <h2 id="new-release-heading">New Release</h2>
          <form onSubmit={onPlanPreview} noValidate>
            <div className="label-with-help">
              <label htmlFor="spec-path-input">Spec File Path</label>
              <HelpTooltip content="Local YAML file containing release metadata (title, artist, tags, and mock settings)." side="bottom" />
            </div>
            <div className="form-row single">
              <HelpTooltip content="Paste or type a local path to a UTF-8 YAML release spec." side="bottom">
                <input
                  id="spec-path-input"
                  data-testid="spec-path-input"
                  type="text"
                  value={specPath}
                  onChange={(event) => setSpecPath(event.target.value)}
                  placeholder="C:\\path\\to\\release.yaml"
                />
              </HelpTooltip>
            </div>

            <div className="label-with-help">
              <label htmlFor="media-path-input">Media File Path</label>
              <HelpTooltip content="Local audio file used for hashing, QC analysis, and execution planning." side="bottom" />
            </div>
            <div className="form-row single">
              <HelpTooltip content="Paste or type a local file path. Network and file:// paths are blocked by the backend." side="bottom">
                <input
                  id="media-path-input"
                  data-testid="media-path-input"
                  type="text"
                  value={mediaPath}
                  onChange={(event) => setMediaPath(event.target.value)}
                  placeholder="C:\\path\\to\\media.bin"
                />
              </HelpTooltip>
            </div>

            <div className="label-with-help">
              <label htmlFor="env-select">Environment</label>
              <HelpTooltip
                variant="popover"
                iconLabel="How environment selection works"
                title="Environment"
                side="bottom"
                content={
                  <>
                    <p>`TEST` is simulation-only and safest for validation.</p>
                    <p>`STAGING` and `PRODUCTION` keep the same planning pipeline but are intended for real integrations later.</p>
                  </>
                }
              />
            </div>
            <div className="form-row single">
              <HelpTooltip content="Selects which execution environment label is sent to the Rust pipeline." side="bottom">
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
              </HelpTooltip>
            </div>

            <fieldset className="platform-fieldset">
              <legend>
                <span className="legend-with-help">
                  <span>Platforms</span>
                  <HelpTooltip content="Choose which publishers the plan/execute pipeline will target." side="bottom" />
                </span>
              </legend>
              <HelpTooltip content="Enables the mock publisher only. This is a safe simulated connector for offline testing." side="bottom">
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    data-testid="platform-mock-checkbox"
                    checked={mockSelected}
                    onChange={(event) => setMockSelected(event.target.checked)}
                  />
                  Mock connector (safe simulation)
                </label>
              </HelpTooltip>
            </fieldset>

            <div className="action-row">
              <HelpTooltip content="Loads the YAML release spec and shows validation results.">
                <button type="button" data-testid="load-spec-button" onClick={onLoadSpec} disabled={loadingSpec || planning || executing}>
                  {loadingSpec ? "Loading Spec..." : "Load Spec"}
                </button>
              </HelpTooltip>

              <span className="help-action-group">
                <HelpTooltip content="Builds a safe preview of platform actions before any execute step.">
                  <button type="submit" data-testid="validate-plan-button" disabled={planning || executing}>
                    {planning ? "Planning..." : "Plan / Preview"}
                  </button>
                </HelpTooltip>
                <HelpTooltip
                  variant="popover"
                  iconLabel="How Plan / Preview works"
                  title="Plan / Preview"
                  content={
                    <>
                      <p>
                        Parses and normalizes the release spec, reads the local media file, and asks the Rust core to derive a deterministic
                        BLAKE3-based release identity.
                      </p>
                      <p>
                        Persists release and platform plan rows in SQLite (WAL mode), writes planned request artifacts, and prepares the QC step
                        without publishing anything.
                      </p>
                    </>
                  }
                />
              </span>

              <span className="help-action-group">
                <HelpTooltip content="Runs the planned pipeline using the currently approved QC result.">
                  <button
                    type="button"
                    data-testid="execute-button"
                    onClick={() => void onExecute()}
                    disabled={executing || !planResult?.release_id}
                  >
                    {executing ? "Executing..." : "Execute"}
                  </button>
                </HelpTooltip>
                <HelpTooltip
                  variant="popover"
                  iconLabel="How Execute works"
                  title="Execute"
                  content={
                    <>
                      <p>
                        Loads the persisted plan descriptor, acquires a release run lock, and advances the deterministic state machine through the
                        execute/verify pipeline in Rust.
                      </p>
                      <p>
                        In TEST mode, actions remain simulation-only (MockTransport). Audit logs, platform status, and report artifacts are saved
                        locally, with SQLite writes committed through WAL.
                      </p>
                    </>
                  }
                />
              </span>
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
          <div className="helper-text" data-testid="execute-gate-hint">
            Execute gate:{" "}
            {!planResult?.release_id ? "Plan a release to enable Execute." : "Plan available. Execute is enabled."}
          </div>
        </div>

        <div>
          <h3>Safety Model</h3>
          <ul className="compact-list">
            <li>TEST mode is simulation-only in Rust core.</li>
            <li>Per-run caps are enforced in core and tested.</li>
            <li>Idempotent reruns reuse the same release_id.</li>
            <li>Execute reads the persisted release plan and writes report/history artifacts.</li>
          </ul>
          <div className="mini-card"><strong>Selected ENV:</strong> <span data-testid="env-display">{env}</span></div>
          <div className="mini-card"><strong>Selected platforms:</strong> <span data-testid="selected-platforms">{selectedPlatforms.join(", ") || "none"}</span></div>
          <div className="mini-card">
            <strong>QC approval:</strong>{" "}
            <span data-testid="qc-gate-status">
              {qcApprovalForCurrentPlan ? `approved at ${qcApprovalForCurrentPlan.approved_at}` : "pending"}
            </span>
          </div>
        </div>
      </section>

      <section hidden={activeScreen !== "Plan / Preview"} className="panel" aria-labelledby="plan-preview-heading">
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
                  <div>spec_path: {formatDiagnosticPath(loadedSpec.canonical_path, revealFullDiagnosticPaths)}</div>
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
                ? Object.entries(planResult.planned_request_files)
                    .map(([platform, path]) => `${platform}: ${formatDiagnosticPath(path, revealFullDiagnosticPaths)}`)
                    .join(" | ")
                : "planned_requests/*.json will appear here after planning"}
            </div>
          </div>
        </div>
      </section>

      <section hidden={activeScreen !== "Execute"} className="panel" aria-labelledby="execute-heading">
        <h2 id="execute-heading">Execute</h2>
        <div className="grid">
          <div className="mini-card" data-testid="execute-result">
            <div><strong>Release:</strong> {executeResult?.release_id ?? planResult?.release_id ?? "none"}</div>
            <div><strong>Status:</strong> {executeResult?.status ?? "not executed"}</div>
            <div><strong>Message:</strong> {executeResult?.message ?? "Execution has not run yet."}</div>
            <div>
              <strong>Report Path:</strong>{" "}
              {executeResult?.report_path
                ? formatDiagnosticPath(executeResult.report_path, revealFullDiagnosticPaths)
                : "not generated"}
            </div>
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

      <section hidden={activeScreen !== "Report / History"} className="panel" aria-labelledby="history-heading">
        <h2 id="history-heading">Report / History</h2>
        <div className="action-row">
          <HelpTooltip content="Reloads the release history list from local SQLite storage.">
            <button type="button" data-testid="refresh-history-button" onClick={onRefreshHistory} disabled={refreshingHistory}>
              {refreshingHistory ? "Refreshing..." : "Refresh History"}
            </button>
          </HelpTooltip>
          <HelpTooltip content="Loads the saved report artifact for the currently selected release." side="bottom">
            <button type="button" data-testid="open-report-button" onClick={onOpenReport} disabled={loadingReport || !selectedHistoryReleaseId}>
              {loadingReport ? "Loading Release Report..." : "Open Release Report"}
            </button>
          </HelpTooltip>
          <HelpTooltip content="Resumes execution for the selected release using its persisted plan/report state." side="bottom">
            <button type="button" data-testid="resume-release-button" onClick={onResume} disabled={executing || !selectedHistoryReleaseId}>
              Resume Release
            </button>
          </HelpTooltip>
        </div>

        <div className="grid history-grid">
          <div>
            <h3>History</h3>
            <ul data-testid="history-list" className="history-list">
              {historyRows.length ? (
                historyRows.map((row) => (
                  <li key={row.release_id}>
                    <HelpTooltip
                      content="Selects this release for Open Release Report and Resume Release actions."
                      side="bottom"
                    >
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
                    </HelpTooltip>
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

