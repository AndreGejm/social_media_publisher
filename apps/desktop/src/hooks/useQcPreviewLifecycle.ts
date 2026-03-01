import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { ExternalPlayerSource } from "./usePlayerTransportState";
import {
  qcGetActivePreviewMedia,
  qcGetBatchExportJobStatus,
  qcGetFeatureFlags,
  qcGetPreviewSession,
  qcListCodecProfiles,
  qcPreparePreviewSession,
  type CatalogTrackDetailResponse,
  type QcBatchExportJobStatusResponse,
  type QcCodecProfileResponse,
  type QcFeatureFlagsResponse,
  type QcPreviewSessionStateResponse,
  type UiAppError
} from "../services/tauriClient";

type AppNotice = { level: "info" | "success" | "warning"; message: string };

type UseQcPreviewLifecycleArgs = {
  qcFeatureFlags: QcFeatureFlagsResponse | null;
  setQcFeatureFlags: Dispatch<SetStateAction<QcFeatureFlagsResponse | null>>;
  qcCodecProfiles: QcCodecProfileResponse[];
  setQcCodecProfiles: Dispatch<SetStateAction<QcCodecProfileResponse[]>>;
  qcPreviewProfileAId: string;
  setQcPreviewProfileAId: Dispatch<SetStateAction<string>>;
  qcPreviewProfileBId: string;
  setQcPreviewProfileBId: Dispatch<SetStateAction<string>>;
  qcPreviewBlindXEnabled: boolean;
  setQcPreviewBlindXEnabled: Dispatch<SetStateAction<boolean>>;
  qcPreviewSession: QcPreviewSessionStateResponse | null;
  setQcPreviewSession: Dispatch<SetStateAction<QcPreviewSessionStateResponse | null>>;
  setQcCodecPreviewLoading: Dispatch<SetStateAction<boolean>>;
  selectedTrackId: string;
  selectedTrackDetail: CatalogTrackDetailResponse | null;
  playerIsPlaying: boolean;
  playerSource: { key: string } | null;
  setPlayerTrackId: Dispatch<SetStateAction<string>>;
  setPlayerExternalSource: Dispatch<SetStateAction<ExternalPlayerSource | null>>;
  setPlayerTimeSec: Dispatch<SetStateAction<number>>;
  setAutoplayRequestSourceKey: Dispatch<SetStateAction<string | null>>;
  ensureExternalPlayerSource: (source: ExternalPlayerSource, options?: { autoplay?: boolean }) => void;
  setQcBatchExportSelectedProfileIds: Dispatch<SetStateAction<string[]>>;
  qcBatchExportActiveJobId: string | null;
  setQcBatchExportStatusMessage: Dispatch<SetStateAction<string | null>>;
  setQcBatchExportSubmitting: Dispatch<SetStateAction<boolean>>;
  setQcBatchExportActiveJobId: Dispatch<SetStateAction<string | null>>;
  setAppNotice: Dispatch<SetStateAction<AppNotice | null>>;
  mapUiError: (error: unknown) => UiAppError;
  setCatalogError: Dispatch<SetStateAction<UiAppError | null>>;
};

function selectDefaultCodecPreviewPair(
  profiles: QcCodecProfileResponse[]
): { profileAId: string; profileBId: string } {
  const available = profiles.filter((profile) => profile.available);
  const candidates = available.length >= 2 ? available : profiles;
  const profileAId = candidates[0]?.profile_id ?? "";
  const fallbackPool = candidates.length > 1 ? candidates.slice(1) : profiles.slice(1);
  const profileBId = fallbackPool.find((profile) => profile.profile_id !== profileAId)?.profile_id ?? profileAId;
  return { profileAId, profileBId };
}

export function useQcPreviewLifecycle(args: UseQcPreviewLifecycleArgs) {
  const {
    qcFeatureFlags,
    setQcFeatureFlags,
    qcCodecProfiles,
    setQcCodecProfiles,
    qcPreviewProfileAId,
    setQcPreviewProfileAId,
    qcPreviewProfileBId,
    setQcPreviewProfileBId,
    qcPreviewBlindXEnabled,
    setQcPreviewBlindXEnabled,
    qcPreviewSession,
    setQcPreviewSession,
    setQcCodecPreviewLoading,
    selectedTrackId,
    selectedTrackDetail,
    playerIsPlaying,
    playerSource,
    setPlayerTrackId,
    setPlayerExternalSource,
    setPlayerTimeSec,
    setAutoplayRequestSourceKey,
    ensureExternalPlayerSource,
    setQcBatchExportSelectedProfileIds,
    qcBatchExportActiveJobId,
    setQcBatchExportStatusMessage,
    setQcBatchExportSubmitting,
    setQcBatchExportActiveJobId,
    setAppNotice,
    mapUiError,
    setCatalogError
  } = args;

  const qcCodecPreviewEnabled = Boolean(qcFeatureFlags?.qc_codec_preview_v1);
  const qcBatchExportEnabled = Boolean(qcFeatureFlags?.qc_batch_export_v1);
  const qcPreviewProfileIdsDistinct =
    qcPreviewProfileAId.trim().length > 0 &&
    qcPreviewProfileBId.trim().length > 0 &&
    qcPreviewProfileAId !== qcPreviewProfileBId;

  const applyQcPreviewPlaybackSource = useCallback(
    async (session: QcPreviewSessionStateResponse) => {
      if (!qcCodecPreviewEnabled) return;
      if (!selectedTrackDetail || session.source_track_id !== selectedTrackDetail.track_id) return;

      const activeMedia = await qcGetActivePreviewMedia();
      const previewSourceKeyPrefix = "qc-preview:";
      const shouldAutoplay = playerIsPlaying;

      if (activeMedia.variant === "bypass") {
        if ((playerSource?.key ?? "").startsWith(previewSourceKeyPrefix)) {
          setPlayerTrackId(selectedTrackDetail.track_id);
          setPlayerExternalSource(null);
          setPlayerTimeSec(0);
          if (shouldAutoplay) {
            setAutoplayRequestSourceKey(`catalog:${selectedTrackDetail.track_id}`);
          }
        }
        return;
      }

      const resolvedVariant = activeMedia.blind_x_resolved_variant ?? activeMedia.variant;
      ensureExternalPlayerSource(
        {
          key: `${previewSourceKeyPrefix}${session.source_track_id}:${resolvedVariant}:${activeMedia.media_path}`,
          filePath: activeMedia.media_path,
          title: selectedTrackDetail.title,
          artist: selectedTrackDetail.artist_name,
          durationMs: selectedTrackDetail.track.duration_ms
        },
        { autoplay: shouldAutoplay }
      );
    },
    [
      ensureExternalPlayerSource,
      playerIsPlaying,
      playerSource,
      qcCodecPreviewEnabled,
      selectedTrackDetail,
      setAutoplayRequestSourceKey,
      setPlayerExternalSource,
      setPlayerTimeSec,
      setPlayerTrackId
    ]
  );
  const applyQcPreviewPlaybackSourceRef = useRef(applyQcPreviewPlaybackSource);
  useEffect(() => {
    applyQcPreviewPlaybackSourceRef.current = applyQcPreviewPlaybackSource;
  }, [applyQcPreviewPlaybackSource]);

  useEffect(() => {
    if (qcCodecPreviewEnabled && qcPreviewSession && selectedTrackDetail) {
      if (qcPreviewSession.source_track_id === selectedTrackDetail.track_id) {
        return;
      }
    }
    if (!(playerSource?.key ?? "").startsWith("qc-preview:")) {
      return;
    }
    setPlayerExternalSource(null);
    if (selectedTrackDetail) {
      setPlayerTrackId(selectedTrackDetail.track_id);
      setPlayerTimeSec(0);
      if (playerIsPlaying) {
        setAutoplayRequestSourceKey(`catalog:${selectedTrackDetail.track_id}`);
      }
    }
  }, [
    playerIsPlaying,
    playerSource,
    qcCodecPreviewEnabled,
    qcPreviewSession,
    selectedTrackDetail,
    setAutoplayRequestSourceKey,
    setPlayerExternalSource,
    setPlayerTimeSec,
    setPlayerTrackId
  ]);

  useEffect(() => {
    const profileIds = qcCodecProfiles.map((profile) => profile.profile_id);
    const knownIds = new Set(profileIds);
    setQcBatchExportSelectedProfileIds((current) => {
      const filtered = current.filter((profileId) => knownIds.has(profileId));
      if (filtered.length > 0) {
        return filtered;
      }
      const defaults = selectDefaultCodecPreviewPair(qcCodecProfiles);
      return [...new Set([defaults.profileAId, defaults.profileBId].filter((value) => value.length > 0))];
    });
  }, [qcCodecProfiles, setQcBatchExportSelectedProfileIds]);

  useEffect(() => {
    let cancelled = false;
    const loadCodecPreviewContracts = async () => {
      try {
        const flags = await qcGetFeatureFlags();
        if (cancelled) return;
        setQcFeatureFlags(flags);
        if (!flags.qc_codec_preview_v1) {
          setQcCodecProfiles([]);
          setQcPreviewSession(null);
          return;
        }

        const [profilesRaw, persistedSession] = await Promise.all([
          qcListCodecProfiles(),
          qcGetPreviewSession()
        ]);
        if (cancelled) return;

        const availableProfiles = profilesRaw.filter((profile) => profile.available);
        const profiles = availableProfiles.length > 0 ? availableProfiles : profilesRaw;
        setQcCodecProfiles(profiles);

        const knownProfileIds = new Set(profiles.map((profile) => profile.profile_id));
        if (
          persistedSession &&
          knownProfileIds.has(persistedSession.profile_a_id) &&
          knownProfileIds.has(persistedSession.profile_b_id)
        ) {
          setQcPreviewProfileAId(persistedSession.profile_a_id);
          setQcPreviewProfileBId(persistedSession.profile_b_id);
          setQcPreviewBlindXEnabled(persistedSession.blind_x_enabled);
          setQcPreviewSession(persistedSession);
          setQcBatchExportSelectedProfileIds([
            persistedSession.profile_a_id,
            persistedSession.profile_b_id
          ]);
          return;
        }

        const defaults = selectDefaultCodecPreviewPair(profiles);
        setQcPreviewProfileAId(defaults.profileAId);
        setQcPreviewProfileBId(defaults.profileBId);
        setQcPreviewBlindXEnabled(false);
        setQcPreviewSession(null);
        setQcBatchExportSelectedProfileIds(
          [...new Set([defaults.profileAId, defaults.profileBId].filter((value) => value.length > 0))]
        );
      } catch (error) {
        if (cancelled) return;
        setCatalogError(mapUiError(error));
      }
    };

    void loadCodecPreviewContracts();
    return () => {
      cancelled = true;
    };
  }, [
    mapUiError,
    setCatalogError,
    setQcBatchExportSelectedProfileIds,
    setQcCodecProfiles,
    setQcFeatureFlags,
    setQcPreviewBlindXEnabled,
    setQcPreviewProfileAId,
    setQcPreviewProfileBId,
    setQcPreviewSession
  ]);

  useEffect(() => {
    if (!qcCodecPreviewEnabled || !selectedTrackId) {
      setQcPreviewSession(null);
      return;
    }
    if (!qcPreviewProfileIdsDistinct) {
      setQcPreviewSession(null);
      return;
    }

    let cancelled = false;
    setQcCodecPreviewLoading(true);
    void qcPreparePreviewSession({
      source_track_id: selectedTrackId,
      profile_a_id: qcPreviewProfileAId,
      profile_b_id: qcPreviewProfileBId,
      blind_x_enabled: qcPreviewBlindXEnabled
    })
      .then((session) => {
        if (cancelled) return;
        setQcPreviewSession(session);
        void applyQcPreviewPlaybackSourceRef.current(session).catch((error) => {
          if (cancelled) return;
          const normalized = mapUiError(error);
          if (normalized.code === "FEATURE_DISABLED") {
            setQcFeatureFlags((current) =>
              current
                ? {
                    ...current,
                    qc_codec_preview_v1: false
                  }
                : current
            );
            return;
          }
          setCatalogError(normalized);
        });
      })
      .catch((error) => {
        if (cancelled) return;
        const normalized = mapUiError(error);
        if (normalized.code === "FEATURE_DISABLED") {
          setQcFeatureFlags((current) =>
            current
              ? {
                  ...current,
                  qc_codec_preview_v1: false
                }
              : current
          );
          setAppNotice({
            level: "warning",
            message: "Codec preview is disabled in this build."
          });
          return;
        }
        setCatalogError(normalized);
      })
      .finally(() => {
        if (!cancelled) {
          setQcCodecPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    mapUiError,
    qcCodecPreviewEnabled,
    qcPreviewBlindXEnabled,
    qcPreviewProfileAId,
    qcPreviewProfileBId,
    qcPreviewProfileIdsDistinct,
    selectedTrackId,
    setAppNotice,
    setCatalogError,
    setQcCodecPreviewLoading,
    setQcFeatureFlags,
    setQcPreviewSession
  ]);

  useEffect(() => {
    setQcBatchExportStatusMessage(null);
    setQcBatchExportActiveJobId(null);
  }, [selectedTrackId, setQcBatchExportActiveJobId, setQcBatchExportStatusMessage]);

  useEffect(() => {
    if (!qcBatchExportActiveJobId) {
      return;
    }

    let cancelled = false;
    let timeoutId: number | undefined;
    const terminalStatuses = new Set(["completed", "completed_with_errors", "failed"]);

    const formatBatchExportStatus = (status: QcBatchExportJobStatusResponse): string => {
      return `Batch export ${status.status}: ${status.completed_profiles}/${status.total_profiles} completed, ${status.failed_profiles} failed (${status.progress_percent}%)`;
    };

    const pollStatus = async () => {
      try {
        const status = await qcGetBatchExportJobStatus(qcBatchExportActiveJobId);
        if (cancelled) return;

        if (!status) {
          setQcBatchExportStatusMessage(`Batch export job ${qcBatchExportActiveJobId} is unavailable.`);
          setQcBatchExportSubmitting(false);
          setQcBatchExportActiveJobId(null);
          return;
        }

        setQcBatchExportStatusMessage(formatBatchExportStatus(status));

        if (terminalStatuses.has(status.status)) {
          setQcBatchExportSubmitting(false);
          setQcBatchExportActiveJobId(null);
          if (status.status === "completed") {
            setAppNotice({
              level: "success",
              message: `Batch export completed (${status.completed_profiles}/${status.total_profiles}).`
            });
          } else if (status.status === "completed_with_errors") {
            setAppNotice({
              level: "warning",
              message: `Batch export completed with errors (${status.failed_profiles} failed profile(s)).`
            });
          } else {
            setAppNotice({
              level: "warning",
              message: "Batch export failed."
            });
          }
          return;
        }
      } catch (error) {
        if (cancelled) return;
        const normalized = mapUiError(error);
        setQcBatchExportStatusMessage(`${normalized.code}: ${normalized.message}`);
        setQcBatchExportSubmitting(false);
        setQcBatchExportActiveJobId(null);
        setCatalogError(normalized);
        return;
      }

      timeoutId = window.setTimeout(() => {
        void pollStatus();
      }, 800);
    };

    void pollStatus();
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    mapUiError,
    qcBatchExportActiveJobId,
    setAppNotice,
    setCatalogError,
    setQcBatchExportActiveJobId,
    setQcBatchExportStatusMessage,
    setQcBatchExportSubmitting
  ]);

  return {
    qcCodecPreviewEnabled,
    qcBatchExportEnabled,
    qcPreviewProfileIdsDistinct,
    applyQcPreviewPlaybackSource
  };
}
