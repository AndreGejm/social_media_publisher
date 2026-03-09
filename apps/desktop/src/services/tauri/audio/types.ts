export type AudioHardwareState = {
  sample_rate_hz: number;
  bit_depth: number;
  buffer_size_frames: number;
  is_exclusive_lock: boolean;
};

export type PlaybackOutputMode = "shared" | "exclusive";

export type PlaybackOutputRuntimeMode = PlaybackOutputMode | "released";

export type PlaybackOutputStatus = {
  requested_mode: PlaybackOutputRuntimeMode;
  active_mode: PlaybackOutputRuntimeMode;
  sample_rate_hz: number | null;
  bit_depth: number | null;
  bit_perfect_eligible: boolean;
  reasons: string[];
};

export type PlaybackQueueState = {
  total_tracks: number;
};

export type PlaybackContextState = {
  volume_scalar: number;
  is_bit_perfect_bypassed: boolean;
  output_status?: PlaybackOutputStatus;
  active_queue_index: number;
  is_queue_ui_expanded: boolean;
  queued_track_change_requests: number;
  is_playing?: boolean;
  position_seconds?: number;
  track_duration_seconds?: number;
};
