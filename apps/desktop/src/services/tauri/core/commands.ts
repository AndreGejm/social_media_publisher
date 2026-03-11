import { invoke as tauriInvoke } from "@tauri-apps/api/core";

import { isUiAppError, type UiAppError } from "./types";

declare global {
  interface Window {
    __TAURI__?: { core?: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> } };
  }
}

export type InvokeErrorReport = {
  command: string;
  args?: Record<string, unknown>;
  error: UiAppError;
};

export type RuntimeLogErrorInput = {
  source: string;
  message: string;
  details?: unknown;
};

const MAX_RUNTIME_LOG_STRING_CHARS = 2048;
const MAX_RUNTIME_LOG_DEPTH = 5;
const MAX_RUNTIME_LOG_ARRAY_ITEMS = 32;
const MAX_RUNTIME_LOG_OBJECT_KEYS = 32;

let invokeErrorReporter: ((report: InvokeErrorReport) => void) | null = null;

function normalizeCommandError(command: string, error: unknown): UiAppError {
  if (isUiAppError(error)) {
    return error;
  }

  return {
    code: "TAURI_UNAVAILABLE",
    message: "Tauri runtime is not available in the browser preview.",
    details: { command }
  } satisfies UiAppError;
}

async function invokeCoreCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const globalInvoke = window.__TAURI__?.core?.invoke;
  if (globalInvoke) {
    return globalInvoke<T>(command, args);
  }

  if (typeof tauriInvoke !== "function") {
    throw new Error("invoke unavailable");
  }

  return tauriInvoke<T>(command, args);
}

function sanitizeRuntimeLogString(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_RUNTIME_LOG_STRING_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_RUNTIME_LOG_STRING_CHARS)}...`;
}

function toJsonSafeValue(value: unknown, depth = 0): unknown {
  if (depth >= MAX_RUNTIME_LOG_DEPTH) {
    return "<max-depth-reached>";
  }

  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return sanitizeRuntimeLogString(value);
  }

  if (value instanceof Error) {
    return {
      name: sanitizeRuntimeLogString(value.name),
      message: sanitizeRuntimeLogString(value.message),
      stack: typeof value.stack === "string" ? sanitizeRuntimeLogString(value.stack) : undefined
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_RUNTIME_LOG_ARRAY_ITEMS).map((item) => toJsonSafeValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .slice(0, MAX_RUNTIME_LOG_OBJECT_KEYS)
      .map(([key, item]) => [sanitizeRuntimeLogString(key), toJsonSafeValue(item, depth + 1)]);
    return Object.fromEntries(entries);
  }

  return String(value);
}

export function setInvokeErrorReporter(
  reporter: ((report: InvokeErrorReport) => void) | null
): void {
  invokeErrorReporter = reporter;
}

export async function invokeSilentCommand<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  try {
    return await invokeCoreCommand<T>(command, args);
  } catch (error) {
    throw normalizeCommandError(command, error);
  }
}

export async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invokeCoreCommand<T>(command, args);
  } catch (error) {
    const normalized = normalizeCommandError(command, error);
    invokeErrorReporter?.({ command, args, error: normalized });
    throw normalized;
  }
}

export async function runtimeLogError(entry: RuntimeLogErrorInput): Promise<void> {
  const source = sanitizeRuntimeLogString(entry.source);
  const message = sanitizeRuntimeLogString(entry.message);
  if (source.length === 0 || message.length === 0) {
    return;
  }

  await invokeSilentCommand<void>("runtime_log_error", {
    entry: {
      source,
      message,
      details: entry.details === undefined ? null : toJsonSafeValue(entry.details)
    }
  });
}

export async function runtimeGetErrorLogPath(): Promise<string> {
  const response = await invokeSilentCommand<unknown>("runtime_get_error_log_path");
  if (typeof response !== "string") {
    throw {
      code: "INVALID_RUNTIME_ERROR_LOG_PATH",
      message: "Runtime error log path response is invalid."
    } satisfies UiAppError;
  }

  const trimmed = response.trim();
  if (trimmed.length === 0) {
    throw {
      code: "INVALID_RUNTIME_ERROR_LOG_PATH",
      message: "Runtime error log path response is empty."
    } satisfies UiAppError;
  }

  return trimmed;
}
