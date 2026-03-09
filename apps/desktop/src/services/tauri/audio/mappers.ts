import { sanitizeUiText } from "../../../shared/lib/ui-sanitize";
import type { PlaybackContextState, PlaybackOutputStatus } from "./types";

export function sanitizePlaybackContextSnapshot(
  context: PlaybackContextState
): PlaybackContextState {
  const status = context.output_status;
  return {
    ...context,
    output_status: status ? sanitizePlaybackOutputStatus(status) : undefined
  };
}

function sanitizePlaybackOutputStatus(
  status: PlaybackOutputStatus
): PlaybackOutputStatus {
  const normalizeMode = (value: string): PlaybackOutputStatus["active_mode"] => {
    if (value === "shared" || value === "exclusive" || value === "released") {
      return value;
    }
    return "released";
  };

  return {
    requested_mode: normalizeMode(String(status.requested_mode)),
    active_mode: normalizeMode(String(status.active_mode)),
    sample_rate_hz:
      typeof status.sample_rate_hz === "number" && Number.isFinite(status.sample_rate_hz)
        ? status.sample_rate_hz
        : null,
    bit_depth:
      typeof status.bit_depth === "number" && Number.isFinite(status.bit_depth)
        ? status.bit_depth
        : null,
    bit_perfect_eligible: Boolean(status.bit_perfect_eligible),
    reasons: Array.isArray(status.reasons)
      ? status.reasons
          .map((reason) => sanitizeUiText(String(reason), 512))
          .filter(Boolean)
      : []
  };
}
