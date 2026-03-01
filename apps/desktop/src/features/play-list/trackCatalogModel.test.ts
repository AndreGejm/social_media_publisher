import { describe, expect, it } from "vitest";

import type { CatalogListTracksResponse } from "../../services/tauriClient";
import {
  albumTitleDisplay,
  buildAlbumGroups,
  rankCatalogTracksBySearch,
  type TrackGroupMode,
  type TrackSortKey
} from "./trackCatalogModel";

type CatalogTrackItem = CatalogListTracksResponse["items"][number];

function makeTrack(overrides: Partial<CatalogTrackItem>): CatalogTrackItem {
  return {
    track_id: "a".repeat(64),
    title: "Track",
    artist_name: "Artist",
    album_title: null,
    duration_ms: 120_000,
    loudness_lufs: -14.0,
    file_path: "C:/Music/Artist - Track.wav",
    media_fingerprint: "b".repeat(64),
    updated_at: "2026-03-01T00:00:00Z",
    ...overrides
  };
}

function runRank(
  items: CatalogTrackItem[],
  search: string,
  sortKey: TrackSortKey = "updated_desc",
  groupMode: TrackGroupMode = "none"
) {
  return rankCatalogTracksBySearch(items, search, sortKey, groupMode);
}

describe("trackCatalogModel", () => {
  it("returns deterministic sort order when search is empty", () => {
    const items = [
      makeTrack({ track_id: "1".repeat(64), title: "B", updated_at: "2026-03-01T00:00:00Z" }),
      makeTrack({ track_id: "2".repeat(64), title: "A", updated_at: "2026-03-03T00:00:00Z" }),
      makeTrack({ track_id: "3".repeat(64), title: "C", updated_at: "2026-03-02T00:00:00Z" })
    ];

    const result = runRank(items, "", "updated_desc");
    expect(result.map((item) => item.track_id)).toEqual([
      "2".repeat(64),
      "3".repeat(64),
      "1".repeat(64)
    ]);
  });

  it("ranks title token matches above path-only matches", () => {
    const titleMatch = makeTrack({
      track_id: "1".repeat(64),
      title: "Queue Anthem",
      file_path: "C:/Music/Queue Anthem.wav"
    });
    const pathOnlyMatch = makeTrack({
      track_id: "2".repeat(64),
      title: "Different Title",
      file_path: "C:/Archive/queue-preview.wav"
    });

    const result = runRank([pathOnlyMatch, titleMatch], "queue");
    expect(result.map((item) => item.track_id)).toEqual([
      "1".repeat(64),
      "2".repeat(64)
    ]);
  });

  it("applies group mode ordering before score ties", () => {
    const artistB = makeTrack({
      track_id: "1".repeat(64),
      title: "Same",
      artist_name: "Beta Artist",
      file_path: "C:/Music/Beta/Same.wav"
    });
    const artistA = makeTrack({
      track_id: "2".repeat(64),
      title: "Same",
      artist_name: "Alpha Artist",
      file_path: "C:/Music/Alpha/Same.wav"
    });

    const result = runRank([artistB, artistA], "same", "title_asc", "artist");
    expect(result.map((item) => item.artist_name)).toEqual(["Alpha Artist", "Beta Artist"]);
  });

  it("builds album groups with aggregate stats and singles fallback", () => {
    const items = [
      makeTrack({
        track_id: "1".repeat(64),
        title: "One",
        artist_name: "Artist One",
        album_title: "Record A",
        duration_ms: 1_000,
        loudness_lufs: -10
      }),
      makeTrack({
        track_id: "2".repeat(64),
        title: "Two",
        artist_name: "Artist One",
        album_title: "Record A",
        duration_ms: 3_000,
        loudness_lufs: -14
      }),
      makeTrack({
        track_id: "3".repeat(64),
        title: "Single",
        artist_name: "Artist One",
        album_title: null,
        duration_ms: 2_000,
        loudness_lufs: -12
      })
    ];

    const groups = buildAlbumGroups(items);
    expect(groups).toHaveLength(2);

    const recordA = groups.find((group) => group.albumTitle === "Record A");
    expect(recordA).toBeTruthy();
    expect(recordA?.trackCount).toBe(2);
    expect(recordA?.totalDurationMs).toBe(4_000);
    expect(recordA?.avgLoudnessLufs).toBe(-12);

    expect(albumTitleDisplay({ album_title: null })).toBe("Singles / Unassigned");
    expect(groups[groups.length - 1]?.albumTitle).toBe("Singles / Unassigned");
  });
});
