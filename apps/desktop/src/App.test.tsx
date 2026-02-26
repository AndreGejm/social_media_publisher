import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

type MockTauriState = {
  plannedReleaseId: string | null;
  history: Array<{ release_id: string; state: string; title: string; updated_at: string }>;
  report: {
    release_id: string;
    summary: string;
    actions: Array<{ platform: string; action: string; simulated: boolean }>;
  } | null;
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
    report: null
  };

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

describe("App", () => {
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
    render(<App />);

    expect(screen.getByRole("heading", { name: "Release Publisher" })).toBeInTheDocument();
    expect(screen.getByText(/Phase 6 workflow UI/i)).toBeInTheDocument();
  });

  it("shows a validation error when submitting empty spec path", () => {
    render(<App />);

    fireEvent.click(screen.getByTestId("validate-plan-button"));

    expect(screen.getByRole("alert")).toHaveTextContent("Spec file path is required for planning.");
  });

  it("shows a structured backend error when Tauri runtime is unavailable", async () => {
    render(<App />);

    fireEvent.change(screen.getByTestId("spec-path-input"), { target: { value: "C:\\spec.yaml" } });
    fireEvent.change(screen.getByTestId("media-path-input"), { target: { value: "C:\\media.bin" } });
    fireEvent.click(screen.getByTestId("validate-plan-button"));

    expect(
      await screen.findByText(/TAURI_UNAVAILABLE: Tauri runtime is not available in the browser preview\./i)
    ).toBeInTheDocument();
  });

  it("runs the mocked plan -> execute -> history/report workflow", async () => {
    installTauriMock();
    render(<App />);

    fireEvent.change(screen.getByTestId("spec-path-input"), { target: { value: "C:\\spec.yaml" } });
    fireEvent.change(screen.getByTestId("media-path-input"), { target: { value: "C:\\media.bin" } });

    fireEvent.click(screen.getByTestId("load-spec-button"));
    expect(await screen.findByTestId("normalized-spec-summary")).toHaveTextContent("title: Test Track");

    fireEvent.click(screen.getByTestId("validate-plan-button"));
    await waitFor(() => {
      expect(screen.getByTestId("plan-summary")).toHaveTextContent("actions: 1");
    });
    expect(screen.getByTestId("planned-actions-list")).toHaveTextContent("mock: mock.plan");

    fireEvent.click(screen.getByTestId("execute-button"));
    await waitFor(() => {
      expect(screen.getByTestId("status-summary")).toHaveTextContent("COMMITTED:");
    });
    expect(screen.getByTestId("history-list")).toHaveTextContent("COMMITTED");
    expect(screen.getByTestId("report-summary")).toHaveTextContent("COMMITTED");
    expect(screen.getByTestId("report-actions-list")).toHaveTextContent("VERIFIED (simulated)");
  });

  it("redacts absolute diagnostic paths in the UI by default", async () => {
    installTauriMock({
      canonicalPath: "C:/Users/alice/Documents/releases/spec.yaml",
      plannedRequestPath: "C:/Users/alice/AppData/Local/ReleasePublisher/artifacts/planned_requests/mock.json",
      reportPath: "C:/Users/alice/AppData/Local/ReleasePublisher/artifacts/release_report.json"
    });
    render(<App />);

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
    render(<App />);

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

    render(<App />);
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

    render(<App />);
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
        default:
          throw { code: "UNEXPECTED", message: `unhandled command ${command}` };
      }
    };

    window.__TAURI__ = {
      core: {
        invoke: invokeMock as unknown as NonNullable<NonNullable<typeof window.__TAURI__>["core"]>["invoke"]
      }
    };

    render(<App />);

    fireEvent.change(screen.getByTestId("spec-path-input"), { target: { value: "C:\\spec.yaml" } });
    fireEvent.change(screen.getByTestId("media-path-input"), { target: { value: "C:\\media.bin" } });
    fireEvent.click(screen.getByTestId("validate-plan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("plan-summary")).toHaveTextContent("actions: 1");
    });
    await waitFor(() => {
      expect(listHistoryCalls).toHaveLength(1);
    });

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
        case "get_report": {
          const deferred = createDeferred<{
            release_id: string;
            summary: string;
            actions: Array<{ platform: string; action: string; simulated: boolean }>;
          } | null>();
          getReportCalls.push(deferred);
          return deferred.promise;
        }
        default:
          throw { code: "UNEXPECTED", message: `unhandled command ${command}` };
      }
    };

    window.__TAURI__ = {
      core: {
        invoke: invokeMock as unknown as NonNullable<NonNullable<typeof window.__TAURI__>["core"]>["invoke"]
      }
    };

    render(<App />);

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

    fireEvent.click(screen.getByTestId("open-report-button"));
    await waitFor(() => {
      expect(getReportCalls).toHaveLength(1);
      expect(screen.getByTestId("open-report-button")).toHaveTextContent("Loading Report...");
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
});
