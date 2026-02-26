import * as tauriCore from "@tauri-apps/api/core";

function normalizeDisplayPath(path: string): string {
  return path.split("\\").join("/");
}

/**
 * Converts a local filesystem path to a media-safe URL for Tauri/WebView playback.
 *
 * In Tauri, prefer the asset protocol via `convertFileSrc` because direct `file://` URLs
 * can fail in WebView security contexts. In browser preview/tests, fall back to `file://`.
 */
export function localFilePathToMediaUrl(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";

  try {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      const convertFileSrc = (tauriCore as unknown as { convertFileSrc?: (filePath: string) => string }).convertFileSrc;
      if (typeof convertFileSrc === "function") {
        return convertFileSrc(trimmed);
      }
    }
  } catch {
    // Browser preview or unsupported runtime; fall back below.
  }

  const normalized = normalizeDisplayPath(trimmed);
  if (/^[a-zA-Z]:\//.test(normalized)) return encodeURI(`file:///${normalized}`);
  if (normalized.startsWith("/")) return encodeURI(`file://${normalized}`);
  return normalized;
}

/**
 * Trims surrounding single or double quotes once for pasted local paths.
 */
export function normalizeQuotedPathInput(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}
