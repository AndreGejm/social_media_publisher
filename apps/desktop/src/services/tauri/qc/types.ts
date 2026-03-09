export type QcFeatureFlagsResponse = {
  qc_codec_preview_v1: boolean;
  qc_realtime_meters_v1: boolean;
  qc_batch_export_v1: boolean;
};

export const QC_PREVIEW_VARIANTS = ["bypass", "codec_a", "codec_b", "blind_x"] as const;
export type QcPreviewVariant = (typeof QC_PREVIEW_VARIANTS)[number];

export type QcCodecFamily = "opus" | "vorbis" | "aac" | "mp3";

export type QcCodecProfileResponse = {
  profile_id: string;
  label: string;
  codec_family: QcCodecFamily;
  target_platform: string;
  target_bitrate_kbps: number;
  expected_latency_ms: number;
  available: boolean;
};

export type QcPreparePreviewSessionInput = {
  source_track_id: string;
  profile_a_id: string;
  profile_b_id: string;
  blind_x_enabled: boolean;
};

export type QcPreviewSessionStateResponse = {
  source_track_id: string;
  active_variant: QcPreviewVariant;
  profile_a_id: string;
  profile_b_id: string;
  blind_x_enabled: boolean;
  blind_x_revealed: boolean;
};

export type QcPreviewActiveMediaResponse = {
  variant: QcPreviewVariant;
  media_path: string;
  blind_x_resolved_variant: QcPreviewVariant | null;
};

export type QcBatchExportStartInput = {
  source_track_id: string;
  profile_ids: string[];
  output_dir: string;
  target_integrated_lufs?: number | null;
};

export type QcBatchExportStartResponse = {
  job_id: string;
  status: string;
  message: string;
};

export type QcBatchExportProfileStatusResponse = {
  profile_id: string;
  codec_family: QcCodecFamily;
  target_platform: string;
  target_bitrate_kbps: number;
  status: string;
  progress_percent: number;
  output_path: string | null;
  output_bytes: number | null;
  message: string | null;
};

export type QcBatchExportJobStatusResponse = {
  job_id: string;
  source_track_id: string;
  output_dir: string;
  requested_profile_ids: string[];
  requested_target_integrated_lufs: number | null;
  status: string;
  progress_percent: number;
  total_profiles: number;
  completed_profiles: number;
  failed_profiles: number;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  summary_path: string | null;
  profiles: QcBatchExportProfileStatusResponse[];
};
