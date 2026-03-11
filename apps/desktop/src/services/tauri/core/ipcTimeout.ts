import { invoke } from "@tauri-apps/api/core";
import { type EventCallback, type UnlistenFn, listen } from "@tauri-apps/api/event";

import { isUiAppError, type UiAppError } from "./types";

/**
 * An error thrown when an IPC call to the Tauri backend exceeds the requested timeframe.
 */
export class IpcTimeoutError extends Error {
  constructor(command: string, timeoutMs: number) {
    super(`Tauri IPC call '${command}' timed out after ${timeoutMs}ms.`);
    this.name = "IpcTimeoutError";
  }
}

declare global {
  interface Window {
    __TAURI__?: { core?: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> } };
    __TAURI_INTERNALS__?: {
      invoke?: (
        command: string,
        args?: Record<string, unknown>,
        options?: unknown
      ) => Promise<unknown>;
    };
  }
}

function createTauriUnavailableError(command: string): UiAppError {
  return {
    code: "TAURI_UNAVAILABLE",
    message: "Tauri runtime is not available in the browser preview.",
    details: { command }
  } satisfies UiAppError;
}

function hasTauriRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    typeof window.__TAURI__?.core?.invoke === "function" ||
    typeof window.__TAURI_INTERNALS__?.invoke === "function"
  );
}

function normalizeIpcError(command: string, error: unknown): UiAppError | unknown {
  if (isUiAppError(error)) {
    return error;
  }

  if (!hasTauriRuntime()) {
    return createTauriUnavailableError(command);
  }

  return error;
}

/**
 * Wraps a Tauri `invoke` call in a `Promise.race` with the specified timeout.
 *
 * @param command The Tauri command name to invoke.
 * @param args The arguments to pass to the Tauri command.
 * @param timeoutMs The max time in milliseconds to wait before rejecting. Default is 5000ms.
 * @returns The resolved data from the backend.
 * @throws {IpcTimeoutError} If the backend does not reply before the timeout.
 */
export async function invokeWithTimeout<T>(
  command: string,
  args?: Record<string, unknown>,
  timeoutMs: number = 5000
): Promise<T> {
  if (!hasTauriRuntime()) {
    throw createTauriUnavailableError(command);
  }

  let timeoutId: number;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new IpcTimeoutError(command, timeoutMs));
    }, timeoutMs);
  });

  const invokePromise = invoke<T>(command, args)
    .catch((error) => {
      throw normalizeIpcError(command, error);
    })
    .finally(() => {
      window.clearTimeout(timeoutId);
    });

  return Promise.race([invokePromise, timeoutPromise]);
}

/**
 * Wraps a Tauri `listen` event subscription call in a `Promise.race` with the specified timeout.
 * This prevents the frontend mounting chain from hanging if the native webview fails to connect the listener.
 *
 * @param event The Tauri event name to listen to.
 * @param handler The callback block.
 * @param timeoutMs The max time in milliseconds to wait before rejecting. Default is 2500ms.
 * @returns The UnlistenFn used to teardown the subscription.
 * @throws {IpcTimeoutError} If the listener registration hangs for more than the timeout duration.
 */
export async function listenWithTimeout<T>(
  event: string,
  handler: EventCallback<T>,
  timeoutMs: number = 2500
): Promise<UnlistenFn> {
  const command = `listen:${event}`;
  if (!hasTauriRuntime()) {
    throw createTauriUnavailableError(command);
  }

  let timeoutId: number;

  const timeoutPromise = new Promise<UnlistenFn>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new IpcTimeoutError(command, timeoutMs));
    }, timeoutMs);
  });

  const listenPromise = listen<T>(event, handler)
    .catch((error) => {
      throw normalizeIpcError(command, error);
    })
    .finally(() => {
      window.clearTimeout(timeoutId);
    });

  return Promise.race([listenPromise, timeoutPromise]);
}
