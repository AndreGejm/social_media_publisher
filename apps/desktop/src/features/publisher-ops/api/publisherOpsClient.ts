import { invokeCommand, isUiAppError, type UiAppError } from "../../../services/tauri/tauriClient";

export type AppEnv = "TEST" | "STAGING" | "PRODUCTION";

export type SpecError = { code: string; field?: string | null; message: string };

export type ReleaseSpec = {
  title: string;
  artist: string;
  description: string;
  tags: string[];
  mock?: { enabled: boolean; note?: string | null } | null;
};

export type LoadSpecResponse = {
  ok: boolean;
  spec: ReleaseSpec | null;
  errors: SpecError[];
  canonical_path?: string | null;
};

export type PlannedAction = { platform: string; action: string; simulated: boolean };

export type PlanReleaseInput = {
  spec_path: string;
  media_path: string;
  platforms: string[];
  env: AppEnv;
};

export type PlanReleaseResponse = {
  release_id: string;
  run_id: string;
  env: AppEnv;
  planned_actions: PlannedAction[];
  planned_request_files: Record<string, string>;
};

export type ExecuteReleaseResponse = {
  release_id: string;
  status: string;
  message: string;
  report_path?: string | null;
};

export type HistoryRow = {
  release_id: string;
  state: string;
  title: string;
  updated_at: string;
};

export type ReleaseReport = {
  release_id: string;
  summary: string;
  actions: PlannedAction[];
  raw?: unknown;
};

const APP_ENVS = new Set<AppEnv>(["TEST", "STAGING", "PRODUCTION"]);

function invalidArgument(message: string, details?: unknown): UiAppError {
  return {
    code: "INVALID_ARGUMENT",
    message,
    details
  };
}

function assertNonEmptyPath(path: string, label: string): string {
  if (typeof path !== "string" || path.trim().length === 0) {
    throw invalidArgument(`${label} must be a non-empty path string.`);
  }
  return path;
}

function assertReleaseId(releaseId: string): string {
  if (typeof releaseId !== "string") {
    throw invalidArgument("releaseId must be a string.");
  }
  const normalized = releaseId.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw invalidArgument("releaseId must be a 64-character hex string.");
  }
  return normalized;
}

function assertAppEnv(value: unknown): AppEnv {
  if (typeof value !== "string" || !APP_ENVS.has(value as AppEnv)) {
    throw invalidArgument("input.env must be one of TEST, STAGING, PRODUCTION.");
  }
  return value as AppEnv;
}

function assertPlatforms(platforms: string[]): string[] {
  if (!Array.isArray(platforms)) {
    throw invalidArgument("input.platforms must be an array.");
  }
  if (platforms.length === 0) {
    throw invalidArgument("input.platforms must include at least one platform.");
  }
  const normalized = platforms.map((platform, index) => {
    if (typeof platform !== "string" || platform.trim().length === 0) {
      throw invalidArgument(`input.platforms[${index}] must be a non-empty string.`);
    }
    return platform.trim();
  });
  return Array.from(new Set(normalized));
}

export function normalizePublisherOpsUiError(error: unknown): UiAppError {
  if (isUiAppError(error)) return error;
  return {
    code: "UNEXPECTED_UI_ERROR",
    message: error instanceof Error ? error.message : "Unknown UI error"
  };
}

export async function loadReleaseSpec(path: string): Promise<LoadSpecResponse> {
  const normalizedPath = assertNonEmptyPath(path, "path");
  return invokeCommand<LoadSpecResponse>("load_spec", { path: normalizedPath });
}

export async function planRelease(input: PlanReleaseInput): Promise<PlanReleaseResponse> {
  const specPath = assertNonEmptyPath(input.spec_path, "input.spec_path");
  const mediaPath = assertNonEmptyPath(input.media_path, "input.media_path");
  const platforms = assertPlatforms(input.platforms);
  const env = assertAppEnv(input.env);

  return invokeCommand<PlanReleaseResponse>("plan_release", {
    input: {
      spec_path: specPath,
      media_path: mediaPath,
      platforms,
      env
    }
  });
}

export async function executeRelease(releaseId: string): Promise<ExecuteReleaseResponse> {
  const normalizedReleaseId = assertReleaseId(releaseId);
  return invokeCommand<ExecuteReleaseResponse>("execute_release", { releaseId: normalizedReleaseId });
}

export async function listReleaseHistory(): Promise<HistoryRow[]> {
  return invokeCommand<HistoryRow[]>("list_history");
}

export async function getReleaseReport(releaseId: string): Promise<ReleaseReport | null> {
  const normalizedReleaseId = assertReleaseId(releaseId);
  return invokeCommand<ReleaseReport | null>("get_report", { releaseId: normalizedReleaseId });
}
