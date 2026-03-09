export type PublisherCreateDraftFromTrackResponse = {
  draft_id: string;
  source_track_id: string;
  media_path: string;
  spec_path: string;
  spec: {
    title: string;
    artist: string;
    description: string;
    tags: string[];
    mock?: { enabled: boolean; note?: string | null } | null;
  };
  spec_yaml: string;
};
