const PLAYBACK_POSITION_EPSILON_SECONDS = 0.001;

export function clampVolumeScalar(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

export function volumePercentToScalar(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return clampVolumeScalar(value / 100);
}

export function normalizePlaybackPositionSeconds(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  return value;
}

export function isPlaybackPositionUnchanged(
  currentSeconds: number,
  nextSeconds: number,
  epsilonSeconds = PLAYBACK_POSITION_EPSILON_SECONDS
): boolean {
  return Math.abs(currentSeconds - nextSeconds) < epsilonSeconds;
}
