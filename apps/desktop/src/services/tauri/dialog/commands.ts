import { isUiAppError, type UiAppError } from "../core";
import { localFilePathToMediaUrl } from "../../../shared/lib/media-url";

const DIRECTORY_PICKER_TIMEOUT_MS = 10 * 60 * 1000;

type DialogFilterInput = {
  name: string;
  extensions: string[];
};

type PickFileDialogOptions = {
  title?: string;
  filters?: DialogFilterInput[];
};

function sanitizeDialogFilters(filters?: DialogFilterInput[]): DialogFilterInput[] | undefined {
  if (!Array.isArray(filters) || filters.length === 0) {
    return undefined;
  }

  const sanitized = filters
    .map((filter) => {
      if (!filter || typeof filter !== "object") {
        return null;
      }

      const name = typeof filter.name === "string" ? filter.name.trim() : "";
      const extensions = Array.isArray(filter.extensions)
        ? filter.extensions
            .map((extension) => (typeof extension === "string" ? extension.trim().toLowerCase() : ""))
            .filter((extension) => /^[a-z0-9]+$/.test(extension))
        : [];

      if (name.length === 0 || extensions.length === 0) {
        return null;
      }

      return {
        name,
        extensions
      };
    })
    .filter((filter): filter is DialogFilterInput => filter !== null);

  return sanitized.length > 0 ? sanitized : undefined;
}

async function raceDialogOpen<T>(task: Promise<T>): Promise<T> {
  let timeoutId: number | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(() => {
        reject({
          code: "TAURI_DIALOG_TIMEOUT",
          message: "Native picker timed out after 10 minutes. Retry browsing."
        } satisfies UiAppError);
      }, DIRECTORY_PICKER_TIMEOUT_MS);
    });

    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
}

export async function pickDirectoryDialog(
  options?: { title?: string }
): Promise<string | null> {
  try {
    const dialog = await import("@tauri-apps/plugin-dialog");
    const selected = await raceDialogOpen(
      dialog.open({
        directory: true,
        multiple: false,
        title: options?.title ?? "Select Folder"
      })
    );

    return typeof selected === "string" ? selected : null;
  } catch (error) {
    if (isUiAppError(error)) {
      throw error;
    }

    throw {
      code: "TAURI_DIALOG_UNAVAILABLE",
      message: "Native folder picker is not available in this runtime."
    } satisfies UiAppError;
  }
}

export async function pickFileDialog(options?: PickFileDialogOptions): Promise<string | null> {
  try {
    const dialog = await import("@tauri-apps/plugin-dialog");
    const selected = await raceDialogOpen(
      dialog.open({
        directory: false,
        multiple: false,
        title: options?.title ?? "Select File",
        filters: sanitizeDialogFilters(options?.filters)
      })
    );

    return typeof selected === "string" ? selected : null;
  } catch (error) {
    if (isUiAppError(error)) {
      throw error;
    }

    throw {
      code: "TAURI_DIALOG_UNAVAILABLE",
      message: "Native file picker is not available in this runtime."
    } satisfies UiAppError;
  }
}

function fileNameFromPath(sourcePath: string): string {
  const normalized = sourcePath.replace(/\\/g, "/").trim();
  const parts = normalized.split("/").filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? "media";
}

export async function loadFileFromNativePath(
  sourcePath: string,
  options?: { mimeTypeHint?: string }
): Promise<File> {
  const normalizedPath = sourcePath.trim();
  if (normalizedPath.length === 0) {
    throw {
      code: "TAURI_FILE_READ_INVALID_PATH",
      message: "Native file path cannot be empty."
    } satisfies UiAppError;
  }

  try {
    let fileUrl = "";

    try {
      const core = await import("@tauri-apps/api/core");
      if (typeof core.convertFileSrc === "function") {
        fileUrl = core.convertFileSrc(normalizedPath);
      }
    } catch {
      // Continue to file:// URL fallback.
    }

    if (!fileUrl) {
      fileUrl = localFilePathToMediaUrl(normalizedPath);
    }

    if (!fileUrl) {
      throw {
        code: "TAURI_FILE_READ_UNAVAILABLE",
        message: "Native file loading is unavailable in this runtime."
      } satisfies UiAppError;
    }

    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw {
        code: "TAURI_FILE_READ_FAILED",
        message: `Unable to read selected file (status ${response.status}).`
      } satisfies UiAppError;
    }

    const blob = await response.blob();
    const fileType = options?.mimeTypeHint ?? blob.type ?? "application/octet-stream";
    const file = new File([blob], fileNameFromPath(normalizedPath), {
      type: fileType,
      lastModified: Date.now()
    });

    try {
      Object.defineProperty(file, "path", {
        configurable: true,
        enumerable: false,
        writable: false,
        value: normalizedPath
      });
    } catch {
      // Non-fatal in hardened runtimes where File properties are non-configurable.
    }

    return file;
  } catch (error) {
    if (isUiAppError(error)) {
      throw error;
    }

    throw {
      code: "TAURI_FILE_READ_UNAVAILABLE",
      message: "Native file loading is unavailable in this runtime."
    } satisfies UiAppError;
  }
}

