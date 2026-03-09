import { invokeCommand } from "../core";
import {
  assertFiniteNumber,
  assertInteger,
  assertPath,
  invalidArgument
} from "../core/validation";
import { sanitizePlaybackContextSnapshot } from "./mappers";
import type {
  AudioHardwareState,
  PlaybackContextState,
  PlaybackOutputMode,
  PlaybackQueueState
} from "./types";

const MAX_PLAYBACK_QUEUE_TRACKS = 10_000;
const MAX_PLAYBACK_QUEUE_INDEX = 9_999;

export async function initExclusiveDevice(
  targetRateHz: number,
  targetBitDepth: number,
  preferExclusive = true
): Promise<AudioHardwareState> {
  assertInteger(targetRateHz, "targetRateHz");
  assertInteger(targetBitDepth, "targetBitDepth");
  if (targetRateHz < 8_000 || targetRateHz > 384_000) {
    throw invalidArgument("targetRateHz must be between 8000 and 384000.");
  }
  if (targetBitDepth < 8 || targetBitDepth > 64) {
    throw invalidArgument("targetBitDepth must be between 8 and 64.");
  }
  if (typeof preferExclusive !== "boolean") {
    throw invalidArgument("preferExclusive must be a boolean.");
  }

  return invokeCommand<AudioHardwareState>("init_exclusive_device", {
    targetRateHz,
    targetBitDepth,
    preferExclusive
  });
}

export async function initPlaybackOutputMode(
  targetRateHz: number,
  targetBitDepth: number,
  mode: PlaybackOutputMode
): Promise<AudioHardwareState> {
  if (mode !== "shared" && mode !== "exclusive") {
    throw invalidArgument("mode must be 'shared' or 'exclusive'.");
  }
  return initExclusiveDevice(targetRateHz, targetBitDepth, mode === "exclusive");
}

export async function setPlaybackVolume(level: number): Promise<void> {
  assertFiniteNumber(level, "level");
  if (level < 0 || level > 1) {
    throw invalidArgument("level must be between 0 and 1.");
  }
  await invokeCommand<void>("set_volume", { level });
}

export async function setPlaybackQueue(paths: string[]): Promise<PlaybackQueueState> {
  if (!Array.isArray(paths)) {
    throw invalidArgument("paths must be an array of file paths.");
  }
  if (paths.length > MAX_PLAYBACK_QUEUE_TRACKS) {
    throw invalidArgument(
      `paths accepts at most ${MAX_PLAYBACK_QUEUE_TRACKS} entries for playback queue sync.`
    );
  }
  for (let index = 0; index < paths.length; index += 1) {
    assertPath(paths[index], `paths[${index}]`);
  }

  return invokeCommand<PlaybackQueueState>("set_playback_queue", { paths });
}

export async function pushPlaybackTrackChangeRequest(newIndex: number): Promise<boolean> {
  assertInteger(newIndex, "newIndex");
  if (newIndex < 0 || newIndex > MAX_PLAYBACK_QUEUE_INDEX) {
    throw invalidArgument(`newIndex must be between 0 and ${MAX_PLAYBACK_QUEUE_INDEX}.`);
  }

  return invokeCommand<boolean>("push_track_change_request", { newIndex });
}

export async function setPlaybackPlaying(isPlaying: boolean): Promise<void> {
  if (typeof isPlaying !== "boolean") {
    throw invalidArgument("isPlaying must be a boolean.");
  }

  await invokeCommand<void>("set_playback_playing", { isPlaying });
}

export async function seekPlaybackRatio(ratio: number): Promise<void> {
  assertFiniteNumber(ratio, "ratio");
  if (ratio < 0 || ratio > 1) {
    throw invalidArgument("ratio must be between 0 and 1.");
  }

  await invokeCommand<void>("seek_playback_ratio", { ratio });
}

export async function getPlaybackContext(): Promise<PlaybackContextState> {
  const context = await invokeCommand<PlaybackContextState>("get_playback_context");
  return sanitizePlaybackContextSnapshot(context);
}

export async function getPlaybackDecodeError(): Promise<string | null> {
  return invokeCommand<string | null>("get_playback_decode_error");
}

export async function togglePlaybackQueueVisibility(): Promise<void> {
  await invokeCommand<void>("toggle_queue_visibility");
}
