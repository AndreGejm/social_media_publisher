import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PublisherOpsWorkspace from "./PublisherOpsWorkspace";

type MockTauriState = {
  plannedReleaseId: string | null;
  history: Array<{ release_id: string; state: string; title: string; updated_at: string }>;
  report: {
    release_id: string;
    summary: string;
    actions: Array<{ platform: string; action: string; simulated: boolean }>;
  } | null;
  qcByReleaseId: Record<
    string,
    {
      release: {
        id: string;
        title: string;
        artist: string;
        tracks: Array<{ file_path: string; duration_ms: number; peak_data: number[]; loudness_lufs: number }>;
      };
      media_fingerprint: string;
      sample_rate_hz: number;
      channels: number;
      created_at: string;
      updated_at: string;
    }
  >;
};

type TauriMockOptions = {
  canonicalPath?: string;
  plannedRequestPath?: string;
  reportPath?: string;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function installTauriMock(options: TauriMockOptions = {}) {
  const state: MockTauriState = {
    plannedReleaseId: null,
    history: [],
    report: null,
    qcByReleaseId: {}
  };

  const buildAnalyzeAudioResponse = (filePath: string) => ({
    canonical_path: filePath.replace(/\\/g, "/"),
    media_fingerprint: "f".repeat(64),
    track: {
      file_path: filePath,
      duration_ms: 3000,
      peak_data: [-10, -8, -6, -5, -7, -9],
      loudness_lufs: -14.2
    },
    sample_rate_hz: 44_100,
    channels: 2
  });

  const buildPersistedQcResponse = (releaseId: string, filePath: string) => ({
    release: {
      id: releaseId,
      title: "Test Track",
      artist: "Example Artist",
      tracks: [
        {
          file_path: filePath,
          duration_ms: 3000,
          peak_data: [-10, -8, -6, -5, -7, -9],
          loudness_lufs: -14.2
        }
      ]
    },
    media_fingerprint: "f".repeat(64),
    sample_rate_hz: 44_100,
    channels: 2,
    created_at: "2026-02-26T12:00:00Z",
    updated_at: "2026-02-26T12:00:01Z"
  });

  const invokeMock = async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
    switch (command) {
      case "load_spec":
        return {
          ok: true,
          spec: {
            title: "Test Track",
            artist: "Example Artist",
            description: "Desc",
            tags: ["mock", "release"]
          },
          errors: [],
          canonical_path: options.canonicalPath ?? "C:/fixtures/spec.yaml"
        };
      case "plan_release": {
        const env = (args?.input as { env?: string } | undefined)?.env ?? "TEST";
        state.plannedReleaseId = "a".repeat(64);
        state.history = [
          {
            release_id: state.plannedReleaseId,
            state: "PLANNED",
            title: "Test Track",
            updated_at: "2026-02-24T00:00:00Z"
          }
        ];
        return {
          release_id: state.plannedReleaseId,
          run_id: "run-1",
          env,
          planned_actions: [{ platform: "mock", action: "mock.plan", simulated: true }],
          planned_request_files: {
            mock: options.plannedRequestPath ?? "artifacts/planned_requests/mock.json"
          }
        };
      }
      case "execute_release": {
        const releaseId =
          (args as { releaseId?: string; release_id?: string } | undefined)?.releaseId ??
          (args as { releaseId?: string; release_id?: string } | undefined)?.release_id ??
          state.plannedReleaseId;
        state.history = [
          {
            release_id: releaseId ?? "unknown",
            state: "COMMITTED",
            title: "Test Track",
            updated_at: "2026-02-24T00:00:01Z"
          }
        ];
        state.report = {
          release_id: releaseId ?? "unknown",
          summary: "Test Track [COMMITTED] 1 platform(s)",
          actions: [{ platform: "mock", action: "VERIFIED (simulated)", simulated: true }]
        };
        return {
          release_id: releaseId ?? "unknown",
          status: "COMMITTED",
          message: "Execution completed (TEST mode remains simulation-only).",
          report_path: options.reportPath ?? "artifacts/release_report.json"
        };
      }
      case "list_history":
        return state.history;
      case "get_report":
        return state.report;
      case "analyze_audio_file": {
        const path = (args as { path?: string } | undefined)?.path ?? "C:\\fixtures\\test.wav";
        return buildAnalyzeAudioResponse(path);
      }
      case "analyze_and_persist_release_track": {
        const releaseId = (args as { releaseId?: string } | undefined)?.releaseId ?? state.plannedReleaseId ?? "unknown";
        const path = (args as { path?: string } | undefined)?.path ?? "C:\\fixtures\\test.wav";
        const persisted = buildPersistedQcResponse(releaseId, path);
        state.qcByReleaseId[releaseId] = persisted;
        return persisted;
      }
      case "get_release_track_analysis": {
        const releaseId = (args as { releaseId?: string } | undefined)?.releaseId ?? "";
        return state.qcByReleaseId[releaseId] ?? null;
      }
      default:
        throw {
          code: "UNKNOWN_COMMAND",
          message: `unhandled command ${command}`
        };
    }
  };

  window.__TAURI__ = {
    core: {
      invoke: invokeMock as unknown as NonNullable<NonNullable<typeof window.__TAURI__>["core"]>["invoke"]
    }
  };

  return state;
}

describe("PublisherOpsWorkspace", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    delete window.__TAURI__;
    delete window.__RELEASE_PUBLISHER_DEBUG_ERROR_DETAILS__;
    delete (window as Window & { __RELEASE_PUBLISHER_DEBUG_FULL_PATHS__?: boolean })
      .__RELEASE_PUBLISHER_DEBUG_FULL_PATHS__;
  });

  it("renders the phase 1 shell", () => {
    render(<PublisherOpsWorkspace />);

    expect(screen.getByRole("heading", { name: "Release Publisher" })).toBeInTheDocument();
    expect(screen.getByText(/Phase 6 workflow UI/i)).toBeInTheDocument();
  });

  it("does not emit stale screen callbacks while external screen sync is in flight", async () => {
    const onScreenChange = vi.fn();
    const view = render(
      <PublisherOpsWorkspace
        showInternalWorkflowTabs={false}
        externalRequestedScreen="Execute"
        onScreenChange={onScreenChange}
      />
    );

    await waitFor(() => {
      expect(onScreenChange).toHaveBeenCalledWith("Execute");
    });
    expect(onScreenChange).not.toHaveBeenCalledWith("New Release");

    onScreenChange.mockClear();
    view.rerender(
      <PublisherOpsWorkspace
        showInternalWorkflowTabs={false}
        externalRequestedScreen="New Release"
        onScreenChange={onScreenChange}
      />
    );

    await waitFor(() => {
      expect(onScreenChange).toHaveBeenCalledWith("New Release");
    });
    expect(onScreenChange).not.toHaveBeenCalledWith("Execute");
  });

  it("shows a validation error when submitting empty spec path", () => {
    render(<PublisherOpsWorkspace />);

    fireEvent.click(screen.getByTestId("validate-plan-button"));

    expect(screen.getByRole("alert")).toHaveTextContent("Spec file path is required for planning.");
  });

  it("shows a structured backend error when Tauri runtime is unavailable", async () => {
    render(<PublisherOpsWorkspace />);

    fireEvent.change(screen.getByTestId("spec-path-input"), { target: { value: "C:\\spec.yaml" } });
    fireEvent.change(screen.getByTestId("media-path-input"), { target: { value: "C:\\media.bin" } });
    fireEvent.click(screen.getByTestId("validate-plan-button"));

    expect(
      await screen.findByText(/TAURI_UNAVAILABLE: Tauri runtime is not available in the browser preview\./i)
    ).toBeInTheDocument();
  });

  it("runs the mocked plan -> execute -> history/report workflow", async () => {
    installTauriMock();
    render(<PublisherOpsWorkspace />);

    fireEvent.change(screen.getByTestId("spec-path-input"), { target: { value: "C:\\spec.yaml" } });
    fireEvent.change(screen.getByTestId("media-path-input"), { target: { value: "C:\\media.bin" } });

    fireEvent.click(screen.getByTestId("load-spec-button"));
    expect(await screen.findByTestId("normalized-spec-summary")).toHaveTextContent("title: Test Track");

    fireEvent.click(screen.getByTestId("validate-plan-button"));
    await waitFor(() => {
      expect(screen.getByTestId("plan-summary")).toHaveTextContent("actions: 1");
    });
    expect(screen.getByTestId("planned-actions-list")).toHaveTextContent("mock: mock.plan");
    expect(screen.getByTestId("execute-button")).toBeEnabled();
    expect(screen.getByTestId("execute-gate-hint")).toHaveTextContent("Plan available. Execute is enabled.");

    fireEvent.click(screen.getByTestId("execute-button"));
    await waitFor(() => {
      expect(screen.getByTestId("status-summary")).toHaveTextContent("COMMITTED:");
    });
    expect(screen.getByTestId("history-list")).toHaveTextContent("COMMITTED");
    expect(screen.getByTestId("report-summary")).toHaveTextContent("COMMITTED");
    expect(screen.getByTestId("report-actions-list")).toHaveTextContent("VERIFIED (simulated)");
  });

  it("enables execute after planning a release", async () => {
    installTauriMock();
    render(<PublisherOpsWorkspace />);

    fireEvent.change(screen.getByTestId("spec-path-input"), { target: { value: "C:\\spec.yaml" } });
    fireEvent.change(screen.getByTestId("media-path-input"), { target: { value: "C:\\media.bin" } });
    fireEvent.click(screen.getByTestId("validate-plan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("plan-summary")).toHaveTextContent("actions: 1");
    });
    expect(screen.getByTestId("execute-button")).toBeEnabled();
    expect(screen.getByTestId("execute-gate-hint")).toHaveTextContent("Plan available. Execute is enabled.");
  });

  it("redacts absolute diagnostic paths in the UI by default", async () => {
    installTauriMock({
      canonicalPath: "C:/Users/alice/Documents/releases/spec.yaml",
      plannedRequestPath: "C:/Users/alice/AppData/Local/ReleasePublisher/artifacts/planned_requests/mock.json",
      reportPath: "C:/Users/alice/AppData/Local/ReleasePublisher/artifacts/release_report.json"
    });
    render(<PublisherOpsWorkspace />);

    fireEvent.change(screen.getByTestId("spec-path-input"), { target: { value: "C:\\spec.yaml" } });
    fireEvent.change(screen.getByTestId("media-path-input"), { target: { value: "C:\\media.bin" } });

    fireEvent.click(screen.getByTestId("load-spec-button"));
    await waitFor(() => {
      expect(screen.getByTestId("normalized-spec-summary")).toHaveTextContent("spec_path:");
    });
    expect(screen.getByTestId("normalized-spec-summary")).toHaveTextContent("[local]/.../releases/spec.yaml");
    expect(screen.getByTestId("normalized-spec-summary")).not.toHaveTextContent("C:/Users/alice");

    fireEvent.click(screen.getByTestId("validate-plan-button"));
    await waitFor(() => {
      expect(screen.getByTestId("planned-request-files")).toHaveTextContent("[local]/.../planned_requests/mock.json");
    });
    expect(screen.getByTestId("planned-request-files")).not.toHaveTextContent("C:/Users/alice/AppData");

    expect(screen.getByTestId("execute-button")).toBeEnabled();
    fireEvent.click(screen.getByTestId("execute-button"));
    await waitFor(() => {
      expect(screen.getByTestId("execute-result")).toHaveTextContent("[local]/.../artifacts/release_report.json");
    });
    expect(screen.getByTestId("execute-result")).not.toHaveTextContent("C:/Users/alice/AppData");
  });

  it("reveals full diagnostic paths when debug path visibility is enabled in TEST", async () => {
    (window as Window & { __RELEASE_PUBLISHER_DEBUG_FULL_PATHS__?: boolean })
      .__RELEASE_PUBLISHER_DEBUG_FULL_PATHS__ = true;
    installTauriMock({
      canonicalPath: "C:/Users/alice/Documents/releases/spec.yaml",
      plannedRequestPath: "C:/Users/alice/AppData/Local/ReleasePublisher/artifacts/planned_requests/mock.json",
      reportPath: "C:/Users/alice/AppData/Local/ReleasePublisher/artifacts/release_report.json"
    });
    render(<PublisherOpsWorkspace />);

    fireEvent.change(screen.getByTestId("spec-path-input"), { target: { value: "C:\\spec.yaml" } });
    fireEvent.change(screen.getByTestId("media-path-input"), { target: { value: "C:\\media.bin" } });

    fireEvent.click(screen.getByTestId("load-spec-button"));
    await waitFor(() => {
      expect(screen.getByTestId("normalized-spec-summary")).toHaveTextContent(
        "C:/Users/alice/Documents/releases/spec.yaml"
      );
    });

    fireEvent.click(screen.getByTestId("validate-plan-button"));
    await waitFor(() => {
      expect(screen.getByTestId("planned-request-files")).toHaveTextContent(
        "C:/Users/alice/AppData/Local/ReleasePublisher/artifacts/planned_requests/mock.json"
      );
    });

    expect(screen.getByTestId("execute-button")).toBeEnabled();
    fireEvent.click(screen.getByTestId("execute-button"));
    await waitFor(() => {
      expect(screen.getByTestId("execute-result")).toHaveTextContent(
        "C:/Users/alice/AppData/Local/ReleasePublisher/artifacts/release_report.json"
      );
    });
  });

  it("does not log backend error details by default", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const invokeMock = async (command: string): Promise<unknown> => {
      if (command === "plan_release") {
        throw {
          code: "SPEC_VALIDATION_FAILED",
          message: "release spec is invalid",
          details: {
            authorization: "Bearer super-secret",
            safe: "keep"
          }
        };
      }
      throw { code: "UNEXPECTED", message: "not implemented" };
    };
    window.__TAURI__ = {
      core: {
        invoke: invokeMock as unknown as NonNullable<NonNullable<typeof window.__TAURI__>["core"]>["invoke"]
      }
    };

    render(<PublisherOpsWorkspace />);
    fireEvent.change(screen.getByTestId("spec-path-input"), { target: { value: "C:\\spec.yaml" } });
    fireEvent.change(screen.getByTestId("media-path-input"), { target: { value: "C:\\media.bin" } });
    fireEvent.click(screen.getByTestId("validate-plan-button"));

    expect(await screen.findByTestId("backend-error")).toHaveTextContent("SPEC_VALIDATION_FAILED");
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("redacts secret fields before logging backend error details when debug logging is enabled", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    window.__RELEASE_PUBLISHER_DEBUG_ERROR_DETAILS__ = true;
    const invokeMock = async (command: string): Promise<unknown> => {
      if (command === "plan_release") {
        throw {
          code: "SPEC_VALIDATION_FAILED",
          message: "release spec is invalid",
          details: {
            authorization: "Bearer super-secret",
            nested: {
              client_secret: "dont-log-me",
              refresh_token: "refresh-secret"
            },
            safe: "keep"
          }
        };
      }
      throw { code: "UNEXPECTED", message: "not implemented" };
    };
    window.__TAURI__ = {
      core: {
        invoke: invokeMock as unknown as NonNullable<NonNullable<typeof window.__TAURI__>["core"]>["invoke"]
      }
    };

    render(<PublisherOpsWorkspace />);
    fireEvent.change(screen.getByTestId("spec-path-input"), { target: { value: "C:\\spec.yaml" } });
    fireEvent.change(screen.getByTestId("media-path-input"), { target: { value: "C:\\media.bin" } });
    fireEvent.click(screen.getByTestId("validate-plan-button"));

    expect(await screen.findByTestId("backend-error")).toHaveTextContent("SPEC_VALIDATION_FAILED");
    expect(errorSpy).toHaveBeenCalledWith("release-publisher.error.details", {
      authorization: "<redacted>",
      nested: {
        client_secret: "<redacted>",
        refresh_token: "<redacted>"
      },
      safe: "keep"
    });

    errorSpy.mockRestore();
  });

  it("ignores stale history responses when refresh requests resolve out of order", async () => {
    const listHistoryCalls: Array<Deferred<Array<{ release_id: string; state: string; title: string; updated_at: string }>>> = [];
    const releaseId = "a".repeat(64);

    const invokeMock = async (command: string): Promise<unknown> => {
      switch (command) {
        case "plan_release":
          return {
            release_id: releaseId,
            run_id: "run-1",
            env: "TEST",
            planned_actions: [{ platform: "mock", action: "mock.plan", simulated: true }],
            planned_request_files: { mock: "artifacts/planned_requests/mock.json" }
          };
        case "execute_release":
          return {
            release_id: releaseId,
            status: "COMMITTED",
            message: "Execution completed (TEST mode remains simulation-only).",
            report_path: "artifacts/release_report.json"
          };
        case "list_history": {
          const deferred = createDeferred<Array<{ release_id: string; state: string; title: string; updated_at: string }>>();
          listHistoryCalls.push(deferred);
          return deferred.promise;
        }
        case "get_report":
          return null;
        case "load_spec":
          return {
            ok: true,
            spec: {
              title: "Test Track",
              artist: "Example Artist",
              description: "Desc",
              tags: ["mock"]
            },
            errors: [],
            canonical_path: "C:/fixtures/spec.yaml"
          };
        case "analyze_and_persist_release_track":
          return {
            release: {
              id: releaseId,
              title: "Test Track",
              artist: "Example Artist",
              tracks: [
                {
                  file_path: "C:\\media.bin",
                  duration_ms: 3000,
                  peak_data: [-10, -8, -6, -5],
                  loudness_lufs: -14.2
                }
              ]
            },
            media_fingerprint: "f".repeat(64),
            sample_rate_hz: 44_100,
            channels: 2,
            created_at: "2026-02-26T12:00:00Z",
            updated_at: "2026-02-26T12:00:01Z"
          };
        case "get_release_track_analysis":
          return null;
        default:
          throw { code: "UNEXPECTED", message: `unhandled command ${command}` };
      }
    };

    window.__TAURI__ = {
      core: {
        invoke: invokeMock as unknown as NonNullable<NonNullable<typeof window.__TAURI__>["core"]>["invoke"]
      }
    };

    render(<PublisherOpsWorkspace />);

    fireEvent.change(screen.getByTestId("spec-path-input"), { target: { value: "C:\\spec.yaml" } });
    fireEvent.change(screen.getByTestId("media-path-input"), { target: { value: "C:\\media.bin" } });
    fireEvent.click(screen.getByTestId("validate-plan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("plan-summary")).toHaveTextContent("actions: 1");
    });
    await waitFor(() => {
      expect(listHistoryCalls).toHaveLength(1);
    });

    expect(screen.getByTestId("execute-button")).toBeEnabled();

    fireEvent.click(screen.getByTestId("execute-button"));
    await waitFor(() => {
      expect(listHistoryCalls).toHaveLength(2);
    });

    await act(async () => {
      listHistoryCalls[1].resolve([
        {
          release_id: releaseId,
          state: "COMMITTED",
          title: "Latest Track",
          updated_at: "2026-02-25T00:00:02Z"
        }
      ]);
    });

    await waitFor(() => {
      expect(screen.getByTestId("history-list")).toHaveTextContent("COMMITTED");
      expect(screen.getByTestId("history-list")).toHaveTextContent("Latest Track");
    });

    await act(async () => {
      listHistoryCalls[0].resolve([
        {
          release_id: releaseId,
          state: "PLANNED",
          title: "Stale Track",
          updated_at: "2026-02-25T00:00:01Z"
        }
      ]);
    });

    await waitFor(() => {
      expect(screen.getByTestId("history-list")).toHaveTextContent("COMMITTED");
      expect(screen.getByTestId("history-list")).toHaveTextContent("Latest Track");
      expect(screen.getByTestId("history-list")).not.toHaveTextContent("Stale Track");
      expect(screen.getByTestId("history-list")).not.toHaveTextContent("PLANNED");
    });
  });

  it("ignores stale report responses when report loads resolve out of order", async () => {
    const releaseId = "b".repeat(64);
    const getReportCalls: Array<
      Deferred<{
        release_id: string;
        summary: string;
        actions: Array<{ platform: string; action: string; simulated: boolean }>;
      } | null>
    > = [];

    const invokeMock = async (command: string): Promise<unknown> => {
      switch (command) {
        case "load_spec":
          return {
            ok: true,
            spec: {
              title: "Report Race Track",
              artist: "Example Artist",
              description: "Desc",
              tags: ["mock"]
            },
            errors: [],
            canonical_path: "C:/fixtures/spec.yaml"
          };
        case "plan_release":
          return {
            release_id: releaseId,
            run_id: "run-2",
            env: "TEST",
            planned_actions: [{ platform: "mock", action: "mock.plan", simulated: true }],
            planned_request_files: { mock: "artifacts/planned_requests/mock.json" }
          };
        case "list_history":
          return [
            {
              release_id: releaseId,
              state: "PLANNED",
              title: "Report Race Track",
              updated_at: "2026-02-25T00:00:00Z"
            }
          ];
        case "execute_release":
          return {
            release_id: releaseId,
            status: "COMMITTED",
            message: "Execution completed (TEST mode remains simulation-only).",
            report_path: "artifacts/release_report.json"
          };
        case "analyze_and_persist_release_track":
          return {
            release: {
              id: releaseId,
              title: "Report Race Track",
              artist: "Example Artist",
              tracks: [
                {
                  file_path: "C:\\media.bin",
                  duration_ms: 3200,
                  peak_data: [-12, -9, -7, -6],
                  loudness_lufs: -13.8
                }
              ]
            },
            media_fingerprint: "e".repeat(64),
            sample_rate_hz: 44_100,
            channels: 2,
            created_at: "2026-02-26T12:10:00Z",
            updated_at: "2026-02-26T12:10:01Z"
          };
        case "get_report": {
          const deferred = createDeferred<{
            release_id: string;
            summary: string;
            actions: Array<{ platform: string; action: string; simulated: boolean }>;
          } | null>();
          getReportCalls.push(deferred);
          return deferred.promise;
        }
        case "get_release_track_analysis":
          return null;
        default:
          throw { code: "UNEXPECTED", message: `unhandled command ${command}` };
      }
    };

    window.__TAURI__ = {
      core: {
        invoke: invokeMock as unknown as NonNullable<NonNullable<typeof window.__TAURI__>["core"]>["invoke"]
      }
    };

    render(<PublisherOpsWorkspace />);

    fireEvent.change(screen.getByTestId("spec-path-input"), { target: { value: "C:\\spec.yaml" } });
    fireEvent.change(screen.getByTestId("media-path-input"), { target: { value: "C:\\media.bin" } });
    fireEvent.click(screen.getByTestId("validate-plan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("plan-summary")).toHaveTextContent("actions: 1");
    });
    await waitFor(() => {
      expect(screen.getByTestId("history-list")).toHaveTextContent("Report Race Track");
      expect(screen.getByTestId("open-report-button")).toBeEnabled();
    });

    expect(screen.getByTestId("execute-button")).toBeEnabled();

    fireEvent.click(screen.getByTestId("open-report-button"));
    await waitFor(() => {
      expect(getReportCalls).toHaveLength(1);
      expect(screen.getByTestId("open-report-button")).toHaveTextContent("Loading Release Report...");
    });

    fireEvent.click(screen.getByTestId("execute-button"));
    await waitFor(() => {
      expect(getReportCalls).toHaveLength(2);
    });

    await act(async () => {
      getReportCalls[1].resolve({
        release_id: releaseId,
        summary: "Latest report summary",
        actions: [{ platform: "mock", action: "VERIFIED (simulated)", simulated: true }]
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("report-summary")).toHaveTextContent("Latest report summary");
      expect(screen.getByTestId("report-actions-list")).toHaveTextContent("VERIFIED (simulated)");
    });

    await act(async () => {
      getReportCalls[0].resolve({
        release_id: releaseId,
        summary: "Stale report summary",
        actions: [{ platform: "mock", action: "STALE", simulated: true }]
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("report-summary")).toHaveTextContent("Latest report summary");
      expect(screen.getByTestId("report-summary")).not.toHaveTextContent("Stale report summary");
      expect(screen.getByTestId("report-actions-list")).not.toHaveTextContent("STALE");
    });
  });

  it.skip("gracefully rejects malformed QC payloads and keeps the approval gate locked", async () => {
    installTauriMock();
    const originalInvoke = window.__TAURI__?.core?.invoke;
    if (!originalInvoke) throw new Error("tauri mock invoke missing");

    window.__TAURI__ = {
      core: {
        invoke: (async (command: string, args?: Record<string, unknown>) => {
          if (command === "analyze_and_persist_release_track") {
            const releaseId = (args as { releaseId?: string } | undefined)?.releaseId ?? "a".repeat(64);
            const path = (args as { path?: string } | undefined)?.path ?? "C:\\media.bin";
            return {
              release: {
                id: releaseId,
                title: "Test Track",
                artist: "Example Artist",
                tracks: [{ file_path: path, duration_ms: 3000, peak_data: [], loudness_lufs: -14.2 }]
              },
              media_fingerprint: "f".repeat(64),
              sample_rate_hz: 44_100,
              channels: 2,
              created_at: "2026-02-26T12:00:00Z",
              updated_at: "2026-02-26T12:00:01Z"
            };
          }
          if (command === "analyze_audio_file") {
            const path = (args as { path?: string } | undefined)?.path ?? "C:\\media.bin";
            return {
              canonical_path: path.replace(/\\/g, "/"),
              media_fingerprint: "f".repeat(64),
              track: {
                file_path: path,
                duration_ms: 3000,
                peak_data: [],
                loudness_lufs: -14.2
              },
              sample_rate_hz: 44_100,
              channels: 2
            };
          }
          return originalInvoke(command, args);
        }) as unknown as NonNullable<NonNullable<typeof window.__TAURI__>["core"]>["invoke"]
      }
    };

    render(<PublisherOpsWorkspace />);

    fireEvent.change(screen.getByTestId("spec-path-input"), { target: { value: "C:\\spec.yaml" } });
    fireEvent.change(screen.getByTestId("media-path-input"), { target: { value: "C:\\media.bin" } });
    fireEvent.click(screen.getByTestId("validate-plan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("plan-summary")).toHaveTextContent("actions: 1");
    });

    fireEvent.click(screen.getByTestId("analyze-qc-button"));

    await waitFor(() => {
      expect(screen.getByTestId("backend-error")).toHaveTextContent("INVALID_QC_PAYLOAD");
    });
    expect(screen.getByTestId("qc-analysis-summary")).toHaveTextContent("No QC analysis loaded.");
    expect(screen.queryByTestId("approve-release-button")).not.toBeInTheDocument();
    expect(screen.getByTestId("execute-button")).toBeDisabled();
    expect(screen.getByTestId("qc-gate-status")).toHaveTextContent("pending");
    expect(screen.getByTestId("execute-gate-hint")).toHaveTextContent("Analyze the planned audio in Verify / QC.");
  });

  it.skip("re-locks execute immediately during reanalysis and keeps it locked after QC analysis failure", async () => {
    installTauriMock();
    const originalInvoke = window.__TAURI__?.core?.invoke;
    if (!originalInvoke) throw new Error("tauri mock invoke missing");

    let analyzePersistCalls = 0;
    const secondAnalyzeDeferred = createDeferred<unknown>();
    let failFallbackAnalyze = false;

    window.__TAURI__ = {
      core: {
        invoke: (async (command: string, args?: Record<string, unknown>) => {
          if (command === "analyze_and_persist_release_track") {
            analyzePersistCalls += 1;
            if (analyzePersistCalls === 2) {
              return secondAnalyzeDeferred.promise;
            }
          }
          if (command === "analyze_audio_file" && failFallbackAnalyze) {
            throw { code: "AUDIO_ANALYSIS_FAILED", message: "simulated terminal QC failure" };
          }
          return originalInvoke(command, args);
        }) as unknown as NonNullable<NonNullable<typeof window.__TAURI__>["core"]>["invoke"]
      }
    };

    render(<PublisherOpsWorkspace />);

    fireEvent.change(screen.getByTestId("spec-path-input"), { target: { value: "C:\\spec.yaml" } });
    fireEvent.change(screen.getByTestId("media-path-input"), { target: { value: "C:\\media.bin" } });
    fireEvent.click(screen.getByTestId("validate-plan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("plan-summary")).toHaveTextContent("actions: 1");
    });

    fireEvent.click(screen.getByTestId("analyze-qc-button"));
    await waitFor(() => {
      expect(screen.getByTestId("qc-analysis-summary")).toHaveTextContent("Test Track");
    });

    fireEvent.click(screen.getByTestId("approve-release-button"));
    await waitFor(() => {
      expect(screen.getByTestId("execute-button")).toBeEnabled();
      expect(screen.getByTestId("qc-gate-status")).toHaveTextContent("approved at");
    });

    fireEvent.click(screen.getByTestId("analyze-qc-button"));

    await waitFor(() => {
      expect(analyzePersistCalls).toBe(2);
      expect(screen.getByTestId("analyze-qc-button")).toHaveTextContent("Analyzing...");
    });
    expect(screen.getByTestId("execute-button")).toBeDisabled();
    expect(screen.getByTestId("qc-gate-status")).toHaveTextContent("pending");
    expect(screen.getByTestId("execute-gate-hint")).toHaveTextContent("QC analysis is running. Execute is temporarily locked.");

    failFallbackAnalyze = true;
    await act(async () => {
      secondAnalyzeDeferred.reject({ code: "AUDIO_ANALYSIS_FAILED", message: "simulated terminal QC failure" });
    });

    await waitFor(() => {
      expect(screen.getByTestId("backend-error")).toHaveTextContent("AUDIO_ANALYSIS_FAILED");
    });
    expect(screen.getByTestId("qc-analysis-summary")).toHaveTextContent("No QC analysis loaded.");
    expect(screen.queryByTestId("approve-release-button")).not.toBeInTheDocument();
    expect(screen.getByTestId("execute-button")).toBeDisabled();
    expect(screen.getByTestId("qc-gate-status")).toHaveTextContent("pending");
  });

  it.skip("preserves both persisted and fallback QC analysis errors in debug details", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    window.__RELEASE_PUBLISHER_DEBUG_ERROR_DETAILS__ = true;
    installTauriMock();
    const originalInvoke = window.__TAURI__?.core?.invoke;
    if (!originalInvoke) throw new Error("tauri mock invoke missing");

    window.__TAURI__ = {
      core: {
        invoke: (async (command: string, args?: Record<string, unknown>) => {
          if (command === "analyze_and_persist_release_track") {
            throw {
              code: "UNKNOWN_COMMAND",
              message: "persisting QC command is unavailable"
            };
          }
          if (command === "analyze_audio_file") {
            throw {
              code: "AUDIO_ANALYSIS_FAILED",
              message: "decoder rejected hostile input",
              details: { path: "C:\\media.bin" }
            };
          }
          return originalInvoke(command, args);
        }) as unknown as NonNullable<NonNullable<typeof window.__TAURI__>["core"]>["invoke"]
      }
    };

    render(<PublisherOpsWorkspace />);

    fireEvent.change(screen.getByTestId("spec-path-input"), { target: { value: "C:\\spec.yaml" } });
    fireEvent.change(screen.getByTestId("media-path-input"), { target: { value: "C:\\media.bin" } });
    fireEvent.click(screen.getByTestId("validate-plan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("plan-summary")).toHaveTextContent("actions: 1");
    });

    fireEvent.click(screen.getByTestId("analyze-qc-button"));

    expect(await screen.findByTestId("backend-error")).toHaveTextContent("AUDIO_ANALYSIS_FAILED");
    expect(errorSpy).toHaveBeenCalledWith("release-publisher.error.details", {
      strategy: "persist_then_fallback",
      persisted_attempt: {
        code: "UNKNOWN_COMMAND",
        message: "persisting QC command is unavailable"
      },
      fallback_attempt: {
        code: "AUDIO_ANALYSIS_FAILED",
        message: "decoder rejected hostile input",
        details: { path: "C:\\media.bin" }
      }
    });

    errorSpy.mockRestore();
  });

  it.skip("clears stale QC state when loading persisted QC returns a malformed payload", async () => {
    installTauriMock();
    const originalInvoke = window.__TAURI__?.core?.invoke;
    if (!originalInvoke) throw new Error("tauri mock invoke missing");

    let corruptSavedQc = false;
    window.__TAURI__ = {
      core: {
        invoke: (async (command: string, args?: Record<string, unknown>) => {
          if (command === "get_release_track_analysis" && corruptSavedQc) {
            const releaseId = (args as { releaseId?: string } | undefined)?.releaseId ?? "a".repeat(64);
            return {
              release: {
                id: releaseId,
                title: "Test Track",
                artist: "Example Artist",
                tracks: [{ file_path: "C:\\media.bin", duration_ms: 3000, peak_data: [], loudness_lufs: -14.2 }]
              },
              media_fingerprint: "f".repeat(64),
              sample_rate_hz: 44_100,
              channels: 2,
              created_at: "2026-02-26T12:00:00Z",
              updated_at: "2026-02-26T12:00:01Z"
            };
          }
          return originalInvoke(command, args);
        }) as unknown as NonNullable<NonNullable<typeof window.__TAURI__>["core"]>["invoke"]
      }
    };

    render(<PublisherOpsWorkspace />);

    fireEvent.change(screen.getByTestId("spec-path-input"), { target: { value: "C:\\spec.yaml" } });
    fireEvent.change(screen.getByTestId("media-path-input"), { target: { value: "C:\\media.bin" } });
    fireEvent.click(screen.getByTestId("validate-plan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("plan-summary")).toHaveTextContent("actions: 1");
      expect(screen.getByTestId("load-qc-history-button")).toBeEnabled();
    });

    fireEvent.click(screen.getByTestId("analyze-qc-button"));
    await waitFor(() => {
      expect(screen.getByTestId("qc-analysis-summary")).toHaveTextContent("Test Track");
    });
    fireEvent.click(screen.getByTestId("approve-release-button"));
    await waitFor(() => {
      expect(screen.getByTestId("execute-button")).toBeEnabled();
    });

    corruptSavedQc = true;
    fireEvent.click(screen.getByTestId("load-qc-history-button"));

    await waitFor(() => {
      expect(screen.getByTestId("backend-error")).toHaveTextContent("INVALID_QC_PAYLOAD");
    });
    expect(screen.getByTestId("qc-analysis-summary")).toHaveTextContent("No QC analysis loaded.");
    expect(screen.getByTestId("execute-button")).toBeDisabled();
    expect(screen.getByTestId("qc-gate-status")).toHaveTextContent("approved at");
    expect(screen.getByTestId("execute-gate-hint")).toHaveTextContent("Analyze the planned audio in Verify / QC.");
  });

  it.skip("uses the shared transport bridge for QC playback when provided", async () => {
    installTauriMock();
    const sharedTransport = {
      state: {
        sourceKey: null as string | null,
        currentTimeSec: 0,
        isPlaying: false
      },
      ensureSource: vi.fn((source: { sourceKey: string }) => {
        sharedTransport.state.sourceKey = source.sourceKey;
      }),
      seekToRatio: vi.fn()
    };

    render(<PublisherOpsWorkspace sharedTransport={sharedTransport} />);

    fireEvent.change(screen.getByTestId("spec-path-input"), { target: { value: "C:\\spec.yaml" } });
    fireEvent.change(screen.getByTestId("media-path-input"), { target: { value: "C:\\media.wav" } });
    fireEvent.click(screen.getByTestId("validate-plan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("plan-summary")).toHaveTextContent("actions: 1");
    });

    fireEvent.click(screen.getByTestId("analyze-qc-button"));
    await waitFor(() => {
      expect(screen.getByTestId("qc-analysis-summary")).toHaveTextContent("Test Track");
    });

    expect(sharedTransport.ensureSource).toHaveBeenCalled();
    expect(screen.queryByTestId("qc-play-toggle")).not.toBeInTheDocument();
    expect(screen.getByText("Playback is controlled by the global transport.")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("qc-seek-range"), { target: { value: "250" } });
    expect(sharedTransport.seekToRatio).toHaveBeenCalled();
  });
});



