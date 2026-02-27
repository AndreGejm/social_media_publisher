import type { Dispatch, SetStateAction } from "react";

import type {
  CatalogTrackDetailResponse,
  PublisherCreateDraftFromTrackResponse
} from "../services/tauriClient";

type AppNotice = { level: "info" | "success" | "warning"; message: string };

export type PublishSelectionItem = {
  trackId: string;
  title: string;
  artistName: string;
  mediaPath: string;
  specPath: string;
  draftId: string;
};

type UsePublishSelectionStateArgs = {
  setPublishSelectionItems: Dispatch<SetStateAction<PublishSelectionItem[]>>;
  setPublisherDraftPrefill: Dispatch<SetStateAction<PublisherCreateDraftFromTrackResponse | null>>;
  onResetPublishStep: () => void;
  onSwitchToPublishMode: () => void;
  onPublishFeedback: (message: string) => void;
  onNotice: (notice: AppNotice) => void;
};

export function usePublishSelectionState(args: UsePublishSelectionStateArgs) {
  const addTrackToPublishSelection = (
    track: CatalogTrackDetailResponse,
    draft: PublisherCreateDraftFromTrackResponse
  ) => {
    const nextItem: PublishSelectionItem = {
      trackId: track.track_id,
      title: track.title,
      artistName: track.artist_name,
      mediaPath: draft.media_path,
      specPath: draft.spec_path,
      draftId: draft.draft_id
    };
    args.setPublishSelectionItems((current) => [
      nextItem,
      ...current.filter((item) => item.trackId !== nextItem.trackId)
    ]);
    args.onPublishFeedback(`Prepared ${track.title} for release selection.`);
  };

  const removePublishSelectionItem = (trackId: string) => {
    args.setPublishSelectionItems((current) => current.filter((item) => item.trackId !== trackId));
    args.onPublishFeedback("Removed track from release selection.");
    args.onNotice({ level: "info", message: "Removed track from release selection." });
  };

  const clearPublishSelection = () => {
    args.setPublishSelectionItems([]);
    args.onPublishFeedback("Release selection cleared.");
    args.onNotice({ level: "info", message: "Release selection cleared." });
  };

  const applyPublishSelectionItem = (item: PublishSelectionItem) => {
    args.setPublisherDraftPrefill((current) => {
      if (
        current &&
        current.source_track_id === item.trackId &&
        current.media_path === item.mediaPath &&
        current.spec_path === item.specPath &&
        current.draft_id === item.draftId
      ) {
        return current;
      }
      return {
        draft_id: item.draftId,
        source_track_id: item.trackId,
        media_path: item.mediaPath,
        spec_path: item.specPath,
        spec:
          current?.source_track_id === item.trackId
            ? current.spec
            : {
                title: item.title,
                artist: item.artistName,
                description: "",
                tags: []
              },
        spec_yaml: current?.source_track_id === item.trackId ? current.spec_yaml : ""
      };
    });
    args.onResetPublishStep();
    args.onPublishFeedback(`Loaded ${item.title} into Publish workflow.`);
    args.onSwitchToPublishMode();
  };

  return {
    addTrackToPublishSelection,
    removePublishSelectionItem,
    clearPublishSelection,
    applyPublishSelectionItem
  };
}
