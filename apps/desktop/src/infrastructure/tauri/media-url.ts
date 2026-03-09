import * as tauriCore from "@tauri-apps/api/core";

import { normalizeQuotedPathInput, localFilePathToMediaUrl as toFileUrl } from "../../shared/lib/media-url";
import { sanitizeUiText } from "../../shared/lib/ui-sanitize";

function stripWindowsExtendedPathPrefix(path: string): string {
  if (path.startsWith("\\\\?\\")) {
    const trimmed = path.slice(4);
    if (trimmed.toUpperCase().startsWith("UNC\\")) {
      return `\\\\${trimmed.slice(4)}`;
    }
    return trimmed;
  }
  if (path.startsWith("//?/")) {
    const trimmed = path.slice(4);
    if (trimmed.toUpperCase().startsWith("UNC/")) {
      return `//${trimmed.slice(4)}`;
    }
    return trimmed;
  }
  return path;
}

/**
 * Converts a local filesystem path to a media URL and prefers Tauri asset URLs
 * when running inside Tauri runtime.
 */
export function localFilePathToMediaUrl(path: string): string {
  const fallback = toFileUrl(path);
  if (!fallback) return "";

  const normalizedPath = sanitizeUiText(
    stripWindowsExtendedPathPrefix(normalizeQuotedPathInput(path)),
    4096
  );
  if (!normalizedPath || normalizedPath.startsWith("file://")) {
    return fallback;
  }

  try {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      const convertFileSrc = (
        tauriCore as unknown as { convertFileSrc?: (filePath: string) => string }
      ).convertFileSrc;
      if (typeof convertFileSrc === "function") {
        return convertFileSrc(normalizedPath);
      }
    }
  } catch {
    // Browser preview or unsupported runtime; fall back below.
  }

  return fallback;
}
