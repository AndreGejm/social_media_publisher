import type { CatalogListTracksResponse } from "../../services/tauri/tauriClient";

export type TrackSortKey =
  | "updated_desc"
  | "title_asc"
  | "artist_asc"
  | "album_asc"
  | "duration_desc"
  | "loudness_desc";

export type TrackGroupMode = "none" | "artist" | "album";

export type AlbumGroup = {
  key: string;
  albumTitle: string;
  artistName: string;
  trackIds: string[];
  trackCount: number;
  totalDurationMs: number;
  avgLoudnessLufs: number | null;
};

type CatalogTrackItem = CatalogListTracksResponse["items"][number];

const trackTextSortCollator = new Intl.Collator(undefined, {
  usage: "sort",
  sensitivity: "base",
  numeric: true
});

export function albumTitleDisplay(item: { album_title?: string | null }): string {
  const title = item.album_title?.trim();
  if (!title) {
    return "Singles / Unassigned";
  }
  return title;
}

function compareCatalogTracks(a: CatalogTrackItem, b: CatalogTrackItem, sortKey: TrackSortKey): number {
  const compareText = (left: string, right: string) => trackTextSortCollator.compare(left, right);
  if (sortKey === "title_asc") {
    return compareText(a.title, b.title) || compareText(a.artist_name, b.artist_name);
  }
  if (sortKey === "artist_asc") {
    return compareText(a.artist_name, b.artist_name) || compareText(a.title, b.title);
  }
  if (sortKey === "album_asc") {
    return (
      compareText(albumTitleDisplay(a), albumTitleDisplay(b)) ||
      compareText(a.artist_name, b.artist_name) ||
      compareText(a.title, b.title)
    );
  }
  if (sortKey === "duration_desc") {
    return b.duration_ms - a.duration_ms || compareText(a.title, b.title);
  }
  if (sortKey === "loudness_desc") {
    return b.loudness_lufs - a.loudness_lufs || compareText(a.title, b.title);
  }
  return b.updated_at.localeCompare(a.updated_at) || compareText(a.title, b.title);
}

function compareTrackGroups(a: CatalogTrackItem, b: CatalogTrackItem, groupMode: TrackGroupMode): number {
  const compareText = (left: string, right: string) => trackTextSortCollator.compare(left, right);
  if (groupMode === "artist") {
    return compareText(a.artist_name, b.artist_name);
  }
  if (groupMode === "album") {
    return compareText(albumTitleDisplay(a), albumTitleDisplay(b)) || compareText(a.artist_name, b.artist_name);
  }
  return 0;
}

function sortCatalogTracks(items: CatalogTrackItem[], sortKey: TrackSortKey): CatalogTrackItem[] {
  const sorted = [...items];
  sorted.sort((a, b) => compareCatalogTracks(a, b, sortKey));
  return sorted;
}

function normalizeTrackSearchTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function rankCatalogTrackForSearch(item: CatalogTrackItem, tokens: string[], phrase: string): number {
  if (tokens.length === 0) {
    return 0;
  }

  const title = item.title.toLowerCase();
  const artist = item.artist_name.toLowerCase();
  const album = albumTitleDisplay(item).toLowerCase();
  const filePath = item.file_path.toLowerCase();

  let score = 0;
  for (const token of tokens) {
    const titleExact = title === token;
    const titlePrefix = title.startsWith(token);
    const titleMatch = title.includes(token);
    const artistPrefix = artist.startsWith(token);
    const artistMatch = artist.includes(token);
    const albumPrefix = album.startsWith(token);
    const albumMatch = album.includes(token);
    const pathPrefix = filePath.startsWith(token);
    const pathMatch = filePath.includes(token);

    if (!(titleMatch || artistMatch || albumMatch || pathMatch)) {
      return 0;
    }

    if (titleExact) score += 140;
    else if (titlePrefix) score += 105;
    else if (titleMatch) score += 72;

    if (artistPrefix) score += 48;
    else if (artistMatch) score += 33;

    if (albumPrefix) score += 30;
    else if (albumMatch) score += 21;

    if (pathPrefix) score += 18;
    else if (pathMatch) score += 9;
  }

  if (phrase.length > 0) {
    if (title.includes(phrase)) score += 44;
    if (artist.includes(phrase)) score += 20;
    if (album.includes(phrase)) score += 14;
    if (filePath.includes(phrase)) score += 8;
  }
  return score;
}

export function rankCatalogTracksBySearch(
  items: CatalogTrackItem[],
  rawSearch: string,
  sortKey: TrackSortKey,
  groupMode: TrackGroupMode
): CatalogTrackItem[] {
  const tokens = normalizeTrackSearchTokens(rawSearch);
  if (tokens.length === 0) {
    const sorted = sortCatalogTracks(items, sortKey);
    if (groupMode === "none") {
      return sorted;
    }
    return [...sorted].sort((a, b) => {
      const groupComparison = compareTrackGroups(a, b, groupMode);
      if (groupComparison !== 0) {
        return groupComparison;
      }
      return compareCatalogTracks(a, b, sortKey);
    });
  }

  const phrase = tokens.join(" ");
  const ranked = items
    .map((item) => ({
      item,
      score: rankCatalogTrackForSearch(item, tokens, phrase)
    }))
    .filter((entry) => entry.score > 0);

  ranked.sort((a, b) => {
    if (groupMode !== "none") {
      const groupComparison = compareTrackGroups(a.item, b.item, groupMode);
      if (groupComparison !== 0) {
        return groupComparison;
      }
    }
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return compareCatalogTracks(a.item, b.item, sortKey);
  });

  return ranked.map((entry) => entry.item);
}

export function buildAlbumGroups(items: CatalogTrackItem[]): AlbumGroup[] {
  const groups = new Map<string, AlbumGroup>();
  for (const item of items) {
    const albumTitle = albumTitleDisplay(item);
    const artistName = item.artist_name?.trim() || "Unknown Artist";
    const key = `${artistName.toLowerCase()}::${albumTitle.toLowerCase()}`;
    const existing = groups.get(key);
    if (existing) {
      existing.trackIds.push(item.track_id);
      existing.trackCount += 1;
      existing.totalDurationMs += item.duration_ms;
      if (existing.avgLoudnessLufs == null) {
        existing.avgLoudnessLufs = item.loudness_lufs;
      } else {
        existing.avgLoudnessLufs =
          (existing.avgLoudnessLufs * (existing.trackCount - 1) + item.loudness_lufs) /
          existing.trackCount;
      }
      continue;
    }

    groups.set(key, {
      key,
      albumTitle,
      artistName,
      trackIds: [item.track_id],
      trackCount: 1,
      totalDurationMs: item.duration_ms,
      avgLoudnessLufs: item.loudness_lufs
    });
  }

  return [...groups.values()].sort((a, b) => {
    if (a.albumTitle === "Singles / Unassigned" && b.albumTitle !== "Singles / Unassigned") {
      return 1;
    }
    if (b.albumTitle === "Singles / Unassigned" && a.albumTitle !== "Singles / Unassigned") {
      return -1;
    }
    return a.albumTitle.localeCompare(b.albumTitle) || a.artistName.localeCompare(b.artistName);
  });
}
