import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  isUiAppError,
  videoRenderCancel,
  videoRenderGetEnvironmentDiagnostics,
  videoRenderOpenOutputFolder,
  videoRenderResult,
  videoRenderStart,
  videoRenderStatus,
  type VideoRenderEnvironmentDiagnostics,
  type VideoRenderProgressSnapshot,
  type VideoRenderResultResponse
} from "../../../services/tauri/tauriClient";
import {
  buildVideoRenderRequest,
  type VideoRenderPreflightIssue,
  type VideoRenderRequestBuildInput,
  type VideoRenderRequest,
  type VideoRenderRequestBuildResult
} from "../model/videoRenderRequest";

const STATUS_POLL_INTERVAL_MS = 750;

type VideoRenderUiPhase =
  | "idle"
  | "preflight_invalid"
  | "starting"
  | "running"
  | "finalizing"
  | "succeeded"
  | "failed"
  | "canceled";

export type VideoWorkspaceRenderState = {
  phase: VideoRenderUiPhase;
  request: VideoRenderRequest | null;
  preflightIssues: VideoRenderPreflightIssue[];
  jobId: string | null;
  progress: VideoRenderProgressSnapshot | null;
  result: VideoRenderResultResponse | null;
  diagnostics: VideoRenderEnvironmentDiagnostics | null;
  diagnosticsCheckedAtUtc: string | null;
  diagnosticsErrorMessage: string | null;
  openOutputFolderMessage: string | null;
  errorMessage: string | null;
};

function createInitialRenderState(): VideoWorkspaceRenderState {
  return {
    phase: "idle",
    request: null,
    preflightIssues: [],
    jobId: null,
    progress: null,
    result: null,
    diagnostics: null,
    diagnosticsCheckedAtUtc: null,
    diagnosticsErrorMessage: null,
    openOutputFolderMessage: null,
    errorMessage: null
  };
}

function mapJobStateToUiPhase(
  state: VideoRenderProgressSnapshot["state"] | VideoRenderResultResponse["state"]
): VideoRenderUiPhase {
  if (state === "running") return "running";
  if (state === "finalizing") return "finalizing";
  if (state === "succeeded") return "succeeded";
  if (state === "canceled") return "canceled";
  if (state === "failed") return "failed";
  return "starting";
}

function isTerminalJobState(state: VideoRenderProgressSnapshot["state"]): boolean {
  return state === "succeeded" || state === "failed" || state === "canceled";
}

function formatUiError(error: unknown, fallback: string): string {
  if (isUiAppError(error)) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
}

export type VideoWorkspaceRenderController = {
  state: VideoWorkspaceRenderState;
  isBusy: boolean;
  canStartRender: boolean;
  canCancelRender: boolean;
  canOpenOutputFolder: boolean;
  buildRenderRequest: () => VideoRenderRequestBuildResult;
  refreshDiagnostics: () => Promise<void>;
  startRender: () => Promise<void>;
  cancelRender: () => Promise<void>;
  openOutputFolder: () => Promise<void>;
  resetRenderState: () => void;
};

export function useVideoWorkspaceRenderController(
  buildInput: VideoRenderRequestBuildInput
): VideoWorkspaceRenderController {
  const [state, setState] = useState<VideoWorkspaceRenderState>(() => createInitialRenderState());

  const pollTimerRef = useRef<number | null>(null);
  const pollInFlightRef = useRef(false);
  const runTokenRef = useRef(0);
  const outputDirectoryPathRef = useRef(buildInput.outputSettings.outputDirectoryPath);

  outputDirectoryPathRef.current = buildInput.outputSettings.outputDirectoryPath;

  const clearPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollInFlightRef.current = false;
  }, []);

  const refreshDiagnostics = useCallback(async () => {
    try {
      const diagnostics = await videoRenderGetEnvironmentDiagnostics(outputDirectoryPathRef.current);

      setState((current) => ({
        ...current,
        diagnostics,
        diagnosticsCheckedAtUtc: new Date().toISOString(),
        diagnosticsErrorMessage: null
      }));
    } catch (error) {
      if (isUiAppError(error) && error.code === "TAURI_UNAVAILABLE") {
        setState((current) => ({
          ...current,
          diagnostics: null,
          diagnosticsCheckedAtUtc: null,
          diagnosticsErrorMessage: null
        }));
        return;
      }

      setState((current) => ({
        ...current,
        diagnosticsErrorMessage: formatUiError(error, "Environment diagnostics failed.")
      }));
    }
  }, []);

  const applyResultState = useCallback(
    (result: VideoRenderResultResponse, request: VideoRenderRequest) => {
      setState((current) => ({
        ...current,
        phase: mapJobStateToUiPhase(result.state),
        request,
        result,
        openOutputFolderMessage: null,
        errorMessage: result.failure?.message ?? null,
        preflightIssues: []
      }));
    },
    []
  );

  const fetchResult = useCallback(
    async (jobId: string, request: VideoRenderRequest, token: number) => {
      try {
        const result = await videoRenderResult(jobId);
        if (runTokenRef.current !== token) return;
        applyResultState(result, request);
      } catch (error) {
        if (runTokenRef.current !== token) return;
        setState((current) => ({
          ...current,
          phase: "failed",
          errorMessage: formatUiError(error, "Render result lookup failed."),
          result: null
        }));
      }
    },
    [applyResultState]
  );

  const pollStatusOnce = useCallback(
    async (jobId: string, request: VideoRenderRequest, token: number): Promise<boolean> => {
      if (pollInFlightRef.current) {
        return true;
      }

      pollInFlightRef.current = true;
      try {
        const progress = await videoRenderStatus(jobId);
        if (runTokenRef.current !== token) {
          return false;
        }

        const phase = mapJobStateToUiPhase(progress.state);
        setState((current) => ({
          ...current,
          phase,
          request,
          jobId,
          progress,
          preflightIssues: [],
          errorMessage: null
        }));

        if (isTerminalJobState(progress.state)) {
          clearPolling();
          await fetchResult(jobId, request, token);
          return false;
        }

        return true;
      } catch (error) {
        if (runTokenRef.current !== token) {
          return false;
        }
        clearPolling();
        setState((current) => ({
          ...current,
          phase: "failed",
          errorMessage: formatUiError(error, "Render status polling failed.")
        }));
        return false;
      } finally {
        pollInFlightRef.current = false;
      }
    },
    [clearPolling, fetchResult]
  );

  const ensurePolling = useCallback(
    (jobId: string, request: VideoRenderRequest, token: number) => {
      clearPolling();
      pollTimerRef.current = window.setInterval(() => {
        void pollStatusOnce(jobId, request, token);
      }, STATUS_POLL_INTERVAL_MS);
    },
    [clearPolling, pollStatusOnce]
  );

  const buildRenderRequest = useCallback((): VideoRenderRequestBuildResult => {
    const built = buildVideoRenderRequest(buildInput);

    if (!built.ok) {
      setState((current) => ({
        ...current,
        phase: "preflight_invalid",
        request: null,
        preflightIssues: built.issues,
        result: null,
        errorMessage: null
      }));
      return built;
    }

    setState((current) => ({
      ...current,
      request: built.request,
      preflightIssues: [],
      errorMessage: null
    }));

    return built;
  }, [buildInput]);

  const startRender = useCallback(async () => {
    let diagnostics: VideoRenderEnvironmentDiagnostics;

    try {
      diagnostics = await videoRenderGetEnvironmentDiagnostics(
        buildInput.outputSettings.outputDirectoryPath
      );
    } catch (error) {
      setState((current) => ({
        ...current,
        phase: "failed",
        diagnosticsErrorMessage: formatUiError(error, "Environment diagnostics failed."),
        errorMessage: "Render cannot start until diagnostics can be verified."
      }));
      return;
    }

    setState((current) => ({
      ...current,
      diagnostics,
      diagnosticsCheckedAtUtc: new Date().toISOString(),
      diagnosticsErrorMessage: null
    }));

    if (!diagnostics.renderCapable) {
      setState((current) => ({
        ...current,
        phase: "preflight_invalid",
        errorMessage:
          diagnostics.blockingReasons.join(" ") ||
          "Render cannot start until environment diagnostics pass."
      }));
      return;
    }

    const built = buildRenderRequest();
    if (!built.ok) {
      return;
    }

    const request = built.request;
    clearPolling();

    const token = runTokenRef.current + 1;
    runTokenRef.current = token;

    setState((current) => ({
      ...current,
      phase: "starting",
      request,
      preflightIssues: [],
      jobId: null,
      progress: null,
      result: null,
      openOutputFolderMessage: null,
      errorMessage: null
    }));

    try {
      const start = await videoRenderStart(request);
      if (runTokenRef.current !== token) {
        return;
      }

      setState((current) => ({
        ...current,
        phase: mapJobStateToUiPhase(start.state),
        request,
        jobId: start.jobId,
        progress: {
          jobId: start.jobId,
          state: start.state,
          percent: 0,
          stage: "render_start",
          frameIndex: null,
          totalFrames: null,
          encodedSeconds: null,
          message: "Render queued.",
          updatedAtUtc: new Date().toISOString()
        },
        errorMessage: null
      }));

      const shouldContinuePolling = await pollStatusOnce(start.jobId, request, token);
      if (runTokenRef.current === token && shouldContinuePolling) {
        ensurePolling(start.jobId, request, token);
      }
    } catch (error) {
      if (runTokenRef.current !== token) {
        return;
      }
      setState((current) => ({
        ...current,
        phase: "failed",
        errorMessage: formatUiError(error, "Render start failed."),
        result: null
      }));
    }
  }, [buildInput.outputSettings.outputDirectoryPath, buildRenderRequest, clearPolling, ensurePolling, pollStatusOnce]);

  const cancelRender = useCallback(async () => {
    const { jobId } = state;
    if (!jobId) return;

    try {
      await videoRenderCancel(jobId);
      setState((current) => ({
        ...current,
        errorMessage: null
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        errorMessage: formatUiError(error, "Cancel request failed.")
      }));
    }
  }, [state]);

  const openOutputFolder = useCallback(async () => {
    const outputPath = state.result?.success?.outputPath;
    if (!outputPath) {
      setState((current) => ({
        ...current,
        openOutputFolderMessage: "No rendered output is available yet."
      }));
      return;
    }

    try {
      const response = await videoRenderOpenOutputFolder(outputPath);
      setState((current) => ({
        ...current,
        openOutputFolderMessage: response.opened
          ? `Opened output folder: ${response.directoryPath}`
          : "Output folder could not be opened."
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        openOutputFolderMessage: formatUiError(error, "Failed to open output folder.")
      }));
    }
  }, [state.result?.success?.outputPath]);

  const resetRenderState = useCallback(() => {
    clearPolling();
    runTokenRef.current += 1;
    setState(createInitialRenderState());
  }, [clearPolling]);

  useEffect(() => {
    return () => {
      clearPolling();
      runTokenRef.current += 1;
    };
  }, [clearPolling]);

  const isBusy =
    state.phase === "starting" || state.phase === "running" || state.phase === "finalizing";

  return useMemo(
    () => ({
      state,
      isBusy,
      canStartRender: !isBusy,
      canCancelRender: isBusy && state.jobId !== null,
      canOpenOutputFolder: Boolean(state.result?.success?.outputPath),
      buildRenderRequest,
      refreshDiagnostics,
      startRender,
      cancelRender,
      openOutputFolder,
      resetRenderState
    }),
    [
      buildRenderRequest,
      cancelRender,
      isBusy,
      openOutputFolder,
      refreshDiagnostics,
      resetRenderState,
      startRender,
      state
    ]
  );
}


