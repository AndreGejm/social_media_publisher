import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function installTauriMock() {
  const state: MockTauriState = {
    plannedReleaseId: null,
    history: [],
    report: null
  };

  window.__TAURI__ = {
    core: {
      invoke: async (command, args) => {
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
              canonical_path: "C:/fixtures/spec.yaml"
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
              planned_request_files: { mock: "artifacts/planned_requests/mock.json" }
            };
          }
          case "execute_release": {
            const releaseId =
              (args as { release_id?: string } | undefined)?.release_id ?? state.plannedReleaseId;
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
              report_path: "artifacts/release_report.json"
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
      }
    }
  };

  return state;
}

describe("App", () => {
  beforeEach(() => {
    delete window.__TAURI__;
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
});
