import { sanitizeUiText } from "../../../shared/lib/ui-sanitize";
import { invokeCommand } from "../core";
import {
  assertFiniteNumber,
  assertHexId,
  assertPath,
  assertQcProfileId,
  invalidArgument
} from "../core/validation";
import {
  QC_PREVIEW_VARIANTS,
  type QcBatchExportJobStatusResponse,
  type QcBatchExportStartInput,
  type QcBatchExportStartResponse,
  type QcCodecProfileResponse,
  type QcFeatureFlagsResponse,
  type QcPreviewActiveMediaResponse,
  type QcPreparePreviewSessionInput,
  type QcPreviewSessionStateResponse,
  type QcPreviewVariant
} from "./types";

function sanitizeQcCodecProfile(profile: QcCodecProfileResponse): QcCodecProfileResponse {
  return {
    ...profile,
    profile_id: sanitizeUiText(profile.profile_id, 128),
    label: sanitizeUiText(profile.label, 256),
    target_platform: sanitizeUiText(profile.target_platform, 128)
  };
}

function sanitizeQcPreviewState(
  state: QcPreviewSessionStateResponse
): QcPreviewSessionStateResponse {
  return {
    ...state,
    source_track_id: sanitizeUiText(state.source_track_id, 128),
    profile_a_id: sanitizeUiText(state.profile_a_id, 128),
    profile_b_id: sanitizeUiText(state.profile_b_id, 128)
  };
}

function sanitizeQcPreviewActiveMedia(
  response: QcPreviewActiveMediaResponse
): QcPreviewActiveMediaResponse {
  return {
    ...response,
    media_path: sanitizeUiText(response.media_path, 4096),
    blind_x_resolved_variant: response.blind_x_resolved_variant ?? null
  };
}

function sanitizeQcBatchExportJobStatus(
  status: QcBatchExportJobStatusResponse
): QcBatchExportJobStatusResponse {
  return {
    ...status,
    job_id: sanitizeUiText(status.job_id, 128),
    source_track_id: sanitizeUiText(status.source_track_id, 128),
    output_dir: sanitizeUiText(status.output_dir, 4096),
    requested_profile_ids: status.requested_profile_ids.map((item) => sanitizeUiText(item, 128)).filter(Boolean),
    status: sanitizeUiText(status.status, 64),
    summary_path: status.summary_path ? sanitizeUiText(status.summary_path, 4096) : null,
    profiles: status.profiles.map((profile) => ({
      ...profile,
      profile_id: sanitizeUiText(profile.profile_id, 128),
      target_platform: sanitizeUiText(profile.target_platform, 128),
      status: sanitizeUiText(profile.status, 64),
      output_path: profile.output_path ? sanitizeUiText(profile.output_path, 4096) : null,
      message: profile.message ? sanitizeUiText(profile.message, 256) : null
    }))
  };
}

export async function qcGetFeatureFlags(): Promise<QcFeatureFlagsResponse> {
  return invokeCommand<QcFeatureFlagsResponse>("qc_get_feature_flags");
}

export async function qcListCodecProfiles(): Promise<QcCodecProfileResponse[]> {
  const response = await invokeCommand<QcCodecProfileResponse[]>("qc_list_codec_profiles");
  return response.map(sanitizeQcCodecProfile);
}

export async function qcPreparePreviewSession(
  input: QcPreparePreviewSessionInput
): Promise<QcPreviewSessionStateResponse> {
  const sourceTrackId = assertHexId(input.source_track_id, "input.source_track_id");
  const profileAId = assertQcProfileId(input.profile_a_id, "input.profile_a_id");
  const profileBId = assertQcProfileId(input.profile_b_id, "input.profile_b_id");
  if (profileAId === profileBId) {
    throw invalidArgument("input.profile_a_id and input.profile_b_id must be different.");
  }
  if (typeof input.blind_x_enabled !== "boolean") {
    throw invalidArgument("input.blind_x_enabled must be a boolean.");
  }

  const response = await invokeCommand<QcPreviewSessionStateResponse>("qc_prepare_preview_session", {
    input: {
      source_track_id: sourceTrackId,
      profile_a_id: profileAId,
      profile_b_id: profileBId,
      blind_x_enabled: input.blind_x_enabled
    }
  });
  return sanitizeQcPreviewState(response);
}

export async function qcGetPreviewSession(): Promise<QcPreviewSessionStateResponse | null> {
  const response = await invokeCommand<QcPreviewSessionStateResponse | null>("qc_get_preview_session");
  return response ? sanitizeQcPreviewState(response) : null;
}

export async function qcSetPreviewVariant(
  variant: QcPreviewVariant
): Promise<QcPreviewSessionStateResponse> {
  if (!QC_PREVIEW_VARIANTS.includes(variant)) {
    throw invalidArgument("variant must be one of: bypass, codec_a, codec_b, blind_x.");
  }

  const response = await invokeCommand<QcPreviewSessionStateResponse>("qc_set_preview_variant", {
    variant
  });
  return sanitizeQcPreviewState(response);
}

export async function qcRevealBlindX(): Promise<QcPreviewSessionStateResponse> {
  const response = await invokeCommand<QcPreviewSessionStateResponse>("qc_reveal_blind_x");
  return sanitizeQcPreviewState(response);
}

export async function qcGetActivePreviewMedia(): Promise<QcPreviewActiveMediaResponse> {
  const response = await invokeCommand<QcPreviewActiveMediaResponse>("qc_get_active_preview_media");
  return sanitizeQcPreviewActiveMedia(response);
}

export async function qcStartBatchExport(
  input: QcBatchExportStartInput
): Promise<QcBatchExportStartResponse> {
  const sourceTrackId = assertHexId(input.source_track_id, "input.source_track_id");
  assertPath(input.output_dir, "input.output_dir");
  if (!Array.isArray(input.profile_ids) || input.profile_ids.length === 0) {
    throw invalidArgument("input.profile_ids must include at least one profile id.");
  }

  const profileIds = input.profile_ids.map((profileId, index) =>
    assertQcProfileId(profileId, `input.profile_ids[${index}]`)
  );

  if (input.target_integrated_lufs != null) {
    assertFiniteNumber(input.target_integrated_lufs, "input.target_integrated_lufs");
  }

  return invokeCommand<QcBatchExportStartResponse>("qc_start_batch_export", {
    input: {
      source_track_id: sourceTrackId,
      profile_ids: profileIds,
      output_dir: input.output_dir,
      target_integrated_lufs: input.target_integrated_lufs ?? null
    }
  });
}

export async function qcGetBatchExportJobStatus(
  jobId: string
): Promise<QcBatchExportJobStatusResponse | null> {
  const normalizedJobId = assertHexId(jobId, "jobId");
  const response = await invokeCommand<QcBatchExportJobStatusResponse | null>(
    "qc_get_batch_export_job_status",
    { jobId: normalizedJobId }
  );
  return response ? sanitizeQcBatchExportJobStatus(response) : null;
}
