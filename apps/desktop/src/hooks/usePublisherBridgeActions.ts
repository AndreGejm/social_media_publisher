import { useState } from "react";

import {
  publisherCreateDraftFromTrack,
  type CatalogTrackDetailResponse,
  type UiAppError
} from "../services/tauriClient";

type AppNotice = { level: "info" | "success" | "warning"; message: string };

type UsePublisherBridgeActionsArgs = {
  setCatalogError: (error: UiAppError | null) => void;
  addTrackToPublishSelection: (track: CatalogTrackDetailResponse, draft: Awaited<ReturnType<typeof publisherCreateDraftFromTrack>>) => void;
  setPublisherDraftPrefill: (draft: Awaited<ReturnType<typeof publisherCreateDraftFromTrack>>) => void;
  onNotice: (notice: AppNotice) => void;
  switchAppMode: (mode: "Listen" | "Publish") => void;
  mapUiError: (error: unknown) => UiAppError;
};

export function usePublisherBridgeActions(args: UsePublisherBridgeActionsArgs) {
  const [publisherBridgeLoadingTrackId, setPublisherBridgeLoadingTrackId] = useState<string | null>(null);

  const handleOpenInPublisherOps = async (track: CatalogTrackDetailResponse) => {
    args.setCatalogError(null);
    setPublisherBridgeLoadingTrackId(track.track_id);
    try {
      const draft = await publisherCreateDraftFromTrack(track.track_id);
      args.setPublisherDraftPrefill(draft);
      args.addTrackToPublishSelection(track, draft);
      args.onNotice({ level: "success", message: `Prepared ${track.title} for release workflow.` });
      args.switchAppMode("Publish");
    } catch (error) {
      args.setCatalogError(args.mapUiError(error));
    } finally {
      setPublisherBridgeLoadingTrackId(null);
    }
  };

  return {
    publisherBridgeLoadingTrackId,
    handleOpenInPublisherOps
  };
}
