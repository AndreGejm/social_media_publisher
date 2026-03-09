import type { QcPlayerAnalysis } from "../../player/QcPlayer";
import { sanitizeUiText } from "../../../shared/lib/ui-sanitize";
import { normalizeQuotedPathInput } from "../../../shared/lib/media-url";
import type { CatalogTrackDetailResponse, UiAppError } from "../../../services/tauri/tauriClient";

export function normalizeWorkspaceUiError(error: unknown): UiAppError {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    "message" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return error as UiAppError;
  }
  return {
    code: "UNEXPECTED_UI_ERROR",
    message: error instanceof Error ? error.message : "Unknown UI error"
  };
}

export function toWorkspaceQcAnalysis(track: CatalogTrackDetailResponse): QcPlayerAnalysis {
  return {
    releaseTitle: sanitizeUiText(track.title, 256),
    releaseArtist: sanitizeUiText(track.artist_name, 256),
    trackFilePath: track.file_path,
    durationMs: track.track.duration_ms,
    peakData: track.track.peak_data,
    loudnessLufs: track.track.loudness_lufs,
    sampleRateHz: track.sample_rate_hz,
    channels: track.channels,
    mediaFingerprint: track.media_fingerprint
  };
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName;
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return true;
  return Boolean(target.closest("[contenteditable='true']"));
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "00:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function normalizePathForInput(path: string): string {
  return normalizeQuotedPathInput(path);
}

export function formatDisplayPath(path: string, options: { showFullPaths: boolean }): string {
  const normalized = path.replace(/\\/g, "/");
  if (options.showFullPaths) return normalized;
  const parts = normalized.split("/");
  if (parts.length <= 3) return normalized;
  return `${parts.slice(0, 2).join("/")}/.../${parts.slice(-2).join("/")}`;
}
