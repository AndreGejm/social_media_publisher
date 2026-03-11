import {
  isUiAppError,
  runtimeLogError,
  setInvokeErrorReporter,
  type InvokeErrorReport,
  type RuntimeLogErrorInput
} from "./tauri/core";

let installed = false;
let originalConsoleError: typeof console.error | null = null;
let errorListener: ((event: ErrorEvent) => void) | null = null;
let rejectionListener: ((event: PromiseRejectionEvent) => void) | null = null;
let logQueue: Promise<void> = Promise.resolve();

function formatMessage(parts: unknown[]): string {
  return parts
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (part instanceof Error) {
        return part.message;
      }
      try {
        return JSON.stringify(part);
      } catch {
        return String(part);
      }
    })
    .join(" ")
    .trim();
}

function errorDetails(error: unknown): Record<string, unknown> | undefined {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  if (isUiAppError(error)) {
    return {
      code: error.code,
      message: error.message,
      details: error.details
    };
  }

  if (error == null) {
    return undefined;
  }

  if (typeof error === "object") {
    return error as Record<string, unknown>;
  }

  return { value: String(error) };
}

function enqueueRuntimeLog(entry: RuntimeLogErrorInput): void {
  logQueue = logQueue
    .then(async () => {
      await runtimeLogError(entry);
    })
    .catch(() => undefined);
}

function logInvokeError(report: InvokeErrorReport): void {
  enqueueRuntimeLog({
    source: `invoke:${report.command}`,
    message: report.error.message,
    details: {
      code: report.error.code,
      command: report.command,
      args: report.args,
      details: report.error.details
    }
  });
}

export function installRuntimeErrorLogging(): void {
  if (installed || typeof window === "undefined") {
    return;
  }
  installed = true;

  setInvokeErrorReporter(logInvokeError);

  errorListener = (event: ErrorEvent) => {
    enqueueRuntimeLog({
      source: "window.error",
      message: event.message || "Unhandled window error",
      details: {
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
        error: errorDetails(event.error)
      }
    });
  };
  window.addEventListener("error", errorListener);

  rejectionListener = (event: PromiseRejectionEvent) => {
    const reason = errorDetails(event.reason);
    enqueueRuntimeLog({
      source: "window.unhandledrejection",
      message: isUiAppError(event.reason)
        ? event.reason.message
        : event.reason instanceof Error
          ? event.reason.message
          : "Unhandled promise rejection",
      details: reason
    });
  };
  window.addEventListener("unhandledrejection", rejectionListener);

  originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    originalConsoleError?.(...args);
    enqueueRuntimeLog({
      source: "console.error",
      message: formatMessage(args) || "console.error called without a message",
      details: {
        arguments: args.map((item) => errorDetails(item) ?? item)
      }
    });
  };
}

export function __resetRuntimeErrorLoggingForTests(): void {
  if (typeof window !== "undefined") {
    if (errorListener) {
      window.removeEventListener("error", errorListener);
    }
    if (rejectionListener) {
      window.removeEventListener("unhandledrejection", rejectionListener);
    }
  }

  if (originalConsoleError) {
    console.error = originalConsoleError;
  }

  installed = false;
  originalConsoleError = null;
  errorListener = null;
  rejectionListener = null;
  logQueue = Promise.resolve();
  setInvokeErrorReporter(null);
}
