import { invokeCommand } from "../core";
import { assertHexId } from "../core/validation";
import type { PublisherCreateDraftFromTrackResponse } from "./types";

export async function publisherCreateDraftFromTrack(
  trackId: string
): Promise<PublisherCreateDraftFromTrackResponse> {
  const normalizedTrackId = assertHexId(trackId, "trackId");
  return invokeCommand<PublisherCreateDraftFromTrackResponse>("publisher_create_draft_from_track", {
    trackId: normalizedTrackId
  });
}
