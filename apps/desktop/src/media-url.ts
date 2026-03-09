import * as tauriCore from "@tauri-apps/api/core";
import { sanitizeUiText } from "./ui-sanitize";

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

function normalizeDisplayPath(path: string): string {
  return path.split("\\").join("/");
}

function isLikelyLocalPath(path: string): boolean {
  if (!path) return false;
  if (/^[a-zA-Z]:[\\/]/.test(path)) return true;
  if (path.startsWith("\\\\")) return true;
  if (path.startsWith("/")) return true;
  if (path.startsWith("file://")) return true;
  return false;
}

function hasUnsupportedScheme(path: string): boolean {
  const schemeMatch = path.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (!schemeMatch) return false;
  const scheme = schemeMatch[1].toLowerCase();
  return scheme !== "file" && !/^[a-zA-Z]$/.test(schemeMatch[1]);
}

/**
 * Converts a local filesystem path to a media-safe URL for Tauri/WebView playback.
 *
 * In Tauri, prefer the asset protocol via `convertFileSrc` because direct `file://` URLs
 * can fail in WebView security contexts. In browser preview/tests, fall back to `file://`.
 */
export function localFilePathToMediaUrl(path: string): string {
  const trimmed = sanitizeUiText(stripWindowsExtendedPathPrefix(path), 4096);
  if (!trimmed) return "";
  if (hasUnsupportedScheme(trimmed)) return "";
  if (!isLikelyLocalPath(trimmed)) return "";

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
  if (/^[a-zA-Z]:\//.test(normalized)) {
    // Encode each path segment individually to preserve '#', '%', and '?' in filenames.
    // Skip index 0 (which is the drive letter, e.g. "C:") — it contains no special chars.
    const encoded = normalized.split("/").map((seg, i) => i === 0 ? seg : encodeURIComponent(seg)).join("/");
    return `file:///${encoded}`;
  }
  if (normalized.startsWith("/")) {
    const encoded = normalized.split("/").map((seg) => encodeURIComponent(seg)).join("/");
    return `file://${encoded}`;
  }
  if (normalized.startsWith("file://")) return normalized; // already a URL — don't double-encode
  return "";
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
