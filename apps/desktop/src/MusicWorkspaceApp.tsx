import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import PublisherOpsWorkspace, { type SharedTransportBridgeForPublisherOps } from "./App";
import { HelpTooltip } from "./HelpTooltip";
import { QcPlayer, type QcPlayerAnalysis } from "./QcPlayer";
import { localFilePathToMediaUrl, normalizeQuotedPathInput } from "./media-url";
import {
  catalogAddLibraryRoot,
  catalogGetIngestJob,
  catalogGetTrack,
  catalogImportFiles,
  catalogListTracks,
  catalogListLibraryRoots,
  catalogRemoveLibraryRoot,
  catalogScanRoot,
  catalogUpdateTrackMetadata,
  pickDirectoryDialog,
  publisherCreateDraftFromTrack,
  type CatalogIngestJobResponse,
  type CatalogImportFailure,
  type CatalogListTracksResponse,
  type CatalogScanRootResponse,
  type CatalogTrackDetailResponse,
  type LibraryRootResponse,
  type PublisherCreateDraftFromTrackResponse,
  type UiAppError
} from "./tauri-api";

type Workspace = "Library" | "Albums" | "Tracks" | "Playlists" | "Publisher Ops" | "Settings";
type TrackSortKey = "updated_desc" | "title_asc" | "artist_asc" | "duration_desc" | "loudness_desc";
type ThemePreference = "system" | "light" | "dark";

const workspaces: Workspace[] = ["Library", "Albums", "Tracks", "Playlists", "Publisher Ops", "Settings"];
const trackVisibilityOptions = ["LOCAL", "PRIVATE", "SHARE_EXPORT_READY"] as const;
const trackLicenseOptions = ["ALL_RIGHTS_RESERVED", "CC_BY", "CC_BY_SA", "CC_BY_NC", "CC0", "CUSTOM"] as const;
const trackSortOptions: Array<{ value: TrackSortKey; label: string }> = [
  { value: "updated_desc", label: "Recently Updated" },
  { value: "title_asc", label: "Title (A-Z)" },
  { value: "artist_asc", label: "Artist (A-Z)" },
  { value: "duration_desc", label: "Duration (Longest)" },
  { value: "loudness_desc", label: "Loudness (Highest)" }
];
const STORAGE_KEYS = {
  activeWorkspace: "rp.music.activeWorkspace.v1",
  trackSort: "rp.music.trackSort.v1",
  favorites: "rp.music.favorites.v1",
  onlyFavorites: "rp.music.onlyFavorites.v1",
  sessionQueue: "rp.music.sessionQueue.v1",
  themePreference: "rp.music.themePreference.v1",
  compactDensity: "rp.music.compactDensity.v1",
  showFullPaths: "rp.music.showFullPaths.v1"
} as const;

type TrackMetadataEditorState = {
  trackId: string;
  visibilityPolicy: string;
  licensePolicy: string;
  downloadable: boolean;
  tagsInput: string;
};

const EMPTY_TRACK_EDITOR_STATE: TrackMetadataEditorState = {
  trackId: "",
  visibilityPolicy: "LOCAL",
  licensePolicy: "ALL_RIGHTS_RESERVED",
  downloadable: false,
  tagsInput: ""
};

type AlbumGroup = {
  key: string;
  albumTitle: string;
  artistName: string;
  trackIds: string[];
  trackCount: number;
  totalDurationMs: number;
  avgLoudnessLufs: number | null;
};

type AppNotice = { level: "info" | "success" | "warning"; message: string };
type TrackRowContextMenuState = { trackId: string; x: number; y: number };
type ExternalPlayerSource = {
  key: string;
  filePath: string;
  title: string;
  artist: string;
  durationMs: number;
};
type ResolvedPlayerSource = {
  key: string;
  filePath: string;
  title: string;
  artist: string;
  durationMs: number;
};

function normalizeUiError(error: unknown): UiAppError {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    "message" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return error as UiAppError;
  }
  return {
    code: "UNEXPECTED_UI_ERROR",
    message: error instanceof Error ? error.message : "Unknown UI error"
  };
}

function toQcAnalysis(track: CatalogTrackDetailResponse): QcPlayerAnalysis {
  return {
    releaseTitle: track.title,
    releaseArtist: track.artist_name,
    trackFilePath: track.file_path,
    durationMs: track.track.duration_ms,
    peakData: track.track.peak_data,
    loudnessLufs: track.track.loudness_lufs,
    sampleRateHz: track.sample_rate_hz,
    channels: track.channels,
    mediaFingerprint: track.media_fingerprint
  };
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "00:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function tagsToEditorInput(tags: string[]): string {
  return tags.join(", ");
}

function normalizeTagLabel(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function parseTagEditorInput(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw.split(/[,\r\n]+/)) {
    const label = normalizeTagLabel(token);
    if (!label) continue;
    const normalized = label.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(label);
  }
  return out;
}

function trackEditorStateFromDetail(detail: CatalogTrackDetailResponse | null): TrackMetadataEditorState {
  if (!detail) {
    return EMPTY_TRACK_EDITOR_STATE;
  }
  return {
    trackId: detail.track_id,
    visibilityPolicy: detail.visibility_policy,
    licensePolicy: detail.license_policy,
    downloadable: detail.downloadable,
    tagsInput: tagsToEditorInput(detail.tags)
  };
}

function readStorage<T>(key: string, fallback: T, guard?: (value: unknown) => value is T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (guard && !guard(parsed)) return fallback;
    return (parsed as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // best-effort persistence only
  }
}

function isWorkspace(value: unknown): value is Workspace {
  return typeof value === "string" && (workspaces as readonly string[]).includes(value);
}

function isTrackSortKey(value: unknown): value is TrackSortKey {
  return typeof value === "string" && trackSortOptions.some((option) => option.value === value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function normalizePathForInput(path: string): string {
  return normalizeQuotedPathInput(path);
}

function formatDisplayPath(path: string, options: { showFullPaths: boolean }): string {
  const normalized = path.replace(/\\/g, "/");
  if (options.showFullPaths) return normalized;
  const parts = normalized.split("/");
  if (parts.length <= 3) return normalized;
  return `${parts.slice(0, 2).join("/")}/.../${parts.slice(-2).join("/")}`;
}

function sortCatalogTracks(items: CatalogListTracksResponse["items"], sortKey: TrackSortKey) {
  const sorted = [...items];
  sorted.sort((a, b) => {
    switch (sortKey) {
      case "title_asc":
        return a.title.localeCompare(b.title) || a.artist_name.localeCompare(b.artist_name);
      case "artist_asc":
        return a.artist_name.localeCompare(b.artist_name) || a.title.localeCompare(b.title);
      case "duration_desc":
        return b.duration_ms - a.duration_ms || a.title.localeCompare(b.title);
      case "loudness_desc":
        return b.loudness_lufs - a.loudness_lufs || a.title.localeCompare(b.title);
      case "updated_desc":
      default:
        return b.updated_at.localeCompare(a.updated_at) || a.title.localeCompare(b.title);
    }
  });
  return sorted;
}

function albumTitleDisplay(item: { album_title?: string | null }): string {
  const title = item.album_title?.trim();
  return title && title.length > 0 ? title : "Singles / Unassigned";
}

function buildAlbumGroups(items: CatalogListTracksResponse["items"]): AlbumGroup[] {
  const groups = new Map<string, AlbumGroup>();
  for (const item of items) {
    const albumTitle = albumTitleDisplay(item);
    const artistName = item.artist_name?.trim() || "Unknown Artist";
    const key = `${artistName.toLowerCase()}::${albumTitle.toLowerCase()}`;
    const current = groups.get(key);
    if (current) {
      current.trackIds.push(item.track_id);
      current.trackCount += 1;
      current.totalDurationMs += item.duration_ms;
      current.avgLoudnessLufs =
        current.avgLoudnessLufs == null
          ? item.loudness_lufs
          : ((current.avgLoudnessLufs * (current.trackCount - 1)) + item.loudness_lufs) / current.trackCount;
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
    if (a.albumTitle === "Singles / Unassigned" && b.albumTitle !== "Singles / Unassigned") return 1;
    if (b.albumTitle === "Singles / Unassigned" && a.albumTitle !== "Singles / Unassigned") return -1;
    return a.albumTitle.localeCompare(b.albumTitle) || a.artistName.localeCompare(b.artistName);
  });
}

function moveItemToFront(ids: string[], trackId: string): string[] {
  const deduped = ids.filter((id) => id !== trackId);
  return [trackId, ...deduped];
}

export default function MusicWorkspaceApp() {
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace>(() =>
    readStorage<Workspace>(STORAGE_KEYS.activeWorkspace, "Library", isWorkspace)
  );
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    readStorage<ThemePreference>(STORAGE_KEYS.themePreference, "system", isThemePreference)
  );
  const [compactDensity, setCompactDensity] = useState<boolean>(() =>
    readStorage<boolean>(STORAGE_KEYS.compactDensity, false, (value): value is boolean => typeof value === "boolean")
  );
  const [showFullPaths, setShowFullPaths] = useState<boolean>(() =>
    readStorage<boolean>(STORAGE_KEYS.showFullPaths, false, (value): value is boolean => typeof value === "boolean")
  );
  const [importPathsInput, setImportPathsInput] = useState("");
  const [libraryRootPathInput, setLibraryRootPathInput] = useState("");
  const [trackSearch, setTrackSearch] = useState("");
  const deferredTrackSearch = useDeferredValue(trackSearch);
  const [trackSort, setTrackSort] = useState<TrackSortKey>(() =>
    readStorage<TrackSortKey>(STORAGE_KEYS.trackSort, "updated_desc", isTrackSortKey)
  );
  const [showFavoritesOnly, setShowFavoritesOnly] = useState<boolean>(() =>
    readStorage<boolean>(STORAGE_KEYS.onlyFavorites, false, (value): value is boolean => typeof value === "boolean")
  );
  const [favoriteTrackIds, setFavoriteTrackIds] = useState<string[]>(() =>
    readStorage<string[]>(STORAGE_KEYS.favorites, [], isStringArray)
  );
  const [sessionQueueTrackIds, setSessionQueueTrackIds] = useState<string[]>(() =>
    readStorage<string[]>(STORAGE_KEYS.sessionQueue, [], isStringArray)
  );

  const [catalogPage, setCatalogPage] = useState<CatalogListTracksResponse>({
    items: [],
    total: 0,
    limit: 100,
    offset: 0
  });
  const [catalogFailures, setCatalogFailures] = useState<CatalogImportFailure[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogImporting, setCatalogImporting] = useState(false);
  const [catalogError, setCatalogError] = useState<UiAppError | null>(null);
  const [appNotice, setAppNotice] = useState<AppNotice | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [libraryRoots, setLibraryRoots] = useState<LibraryRootResponse[]>([]);
  const [libraryRootsLoading, setLibraryRootsLoading] = useState(false);
  const [libraryRootMutating, setLibraryRootMutating] = useState(false);
  const [activeScanJobs, setActiveScanJobs] = useState<Record<string, CatalogIngestJobResponse>>({});

  const [selectedTrackId, setSelectedTrackId] = useState<string>("");
  const [batchSelectedTrackIds, setBatchSelectedTrackIds] = useState<string[]>([]);
  const [trackRowContextMenu, setTrackRowContextMenu] = useState<TrackRowContextMenuState | null>(null);
  const [selectedTrackDetail, setSelectedTrackDetail] = useState<CatalogTrackDetailResponse | null>(null);
  const [trackDetailsById, setTrackDetailsById] = useState<Record<string, CatalogTrackDetailResponse>>({});
  const [selectedTrackLoading, setSelectedTrackLoading] = useState(false);
  const [trackEditor, setTrackEditor] = useState<TrackMetadataEditorState>(EMPTY_TRACK_EDITOR_STATE);
  const [trackEditorDirty, setTrackEditorDirty] = useState(false);
  const [trackEditorSaving, setTrackEditorSaving] = useState(false);
  const [trackEditorError, setTrackEditorError] = useState<UiAppError | null>(null);
  const [trackEditorNotice, setTrackEditorNotice] = useState<string | null>(null);

  const [playerTrackId, setPlayerTrackId] = useState<string>("");
  const [playerExternalSource, setPlayerExternalSource] = useState<ExternalPlayerSource | null>(null);
  const [autoplayRequestSourceKey, setAutoplayRequestSourceKey] = useState<string | null>(null);
  const [playerTimeSec, setPlayerTimeSec] = useState(0);
  const [playerIsPlaying, setPlayerIsPlaying] = useState(false);
  const playerAudioRef = useRef<HTMLAudioElement>(null);
  const previousSelectedTrackIdRef = useRef<string>("");
  const [selectedAlbumKey, setSelectedAlbumKey] = useState<string>("");
  const [trackDetailEditMode, setTrackDetailEditMode] = useState(false);
  const [publisherOpsBooted, setPublisherOpsBooted] = useState(false);

  const [publisherDraftPrefill, setPublisherDraftPrefill] = useState<PublisherCreateDraftFromTrackResponse | null>(null);
  const [publisherBridgeLoadingTrackId, setPublisherBridgeLoadingTrackId] = useState<string | null>(null);
  const publisherOpsTransportStateRef = useRef<SharedTransportBridgeForPublisherOps["state"]>({
    sourceKey: null,
    currentTimeSec: 0,
    isPlaying: false
  });

  const favoriteTrackIdSet = useMemo(() => new Set(favoriteTrackIds), [favoriteTrackIds]);
  const batchSelectedTrackIdSet = useMemo(() => new Set(batchSelectedTrackIds), [batchSelectedTrackIds]);
  const visibleTracks = useMemo(() => {
    const filtered = showFavoritesOnly
      ? catalogPage.items.filter((item) => favoriteTrackIdSet.has(item.track_id))
      : catalogPage.items;
    return sortCatalogTracks(filtered, trackSort);
  }, [catalogPage.items, favoriteTrackIdSet, showFavoritesOnly, trackSort]);
  const visibleTracksById = useMemo(
    () => new Map(visibleTracks.map((item) => [item.track_id, item] as const)),
    [visibleTracks]
  );
  const orderedBatchSelection = useMemo(
    () => visibleTracks.filter((item) => batchSelectedTrackIdSet.has(item.track_id)),
    [visibleTracks, batchSelectedTrackIdSet]
  );
  const orderedBatchSelectionIds = useMemo(
    () => orderedBatchSelection.map((item) => item.track_id),
    [orderedBatchSelection]
  );
  const queue = useMemo(() => {
    const sessionQueue = sessionQueueTrackIds
      .map((trackId) => visibleTracksById.get(trackId))
      .filter((item): item is CatalogListTracksResponse["items"][number] => Boolean(item));
    return sessionQueue.length > 0 ? sessionQueue : visibleTracks;
  }, [sessionQueueTrackIds, visibleTracks, visibleTracksById]);
  const queueUsesSessionOrder = sessionQueueTrackIds.length > 0;
  const albumGroups = useMemo(() => buildAlbumGroups(visibleTracks), [visibleTracks]);
  const selectedAlbumGroup = useMemo(
    () => albumGroups.find((group) => group.key === selectedAlbumKey) ?? albumGroups[0] ?? null,
    [albumGroups, selectedAlbumKey]
  );
  const selectedAlbumTracks = useMemo(
    () => (selectedAlbumGroup ? selectedAlbumGroup.trackIds.map((id) => visibleTracksById.get(id)).filter((item): item is CatalogListTracksResponse["items"][number] => Boolean(item)) : []),
    [selectedAlbumGroup, visibleTracksById]
  );
  const favoriteTrackCount = favoriteTrackIds.length;
  const isSelectedTrackFavorite = Boolean(selectedTrackDetail && favoriteTrackIdSet.has(selectedTrackDetail.track_id));
  const contextMenuTrack = trackRowContextMenu ? visibleTracksById.get(trackRowContextMenu.trackId) ?? null : null;

  const selectedTrackAnalysis = selectedTrackDetail ? toQcAnalysis(selectedTrackDetail) : null;
  const playerTrackDetail = useMemo(() => {
    if (!playerTrackId) return null;
    if (selectedTrackDetail?.track_id === playerTrackId) return selectedTrackDetail;
    return trackDetailsById[playerTrackId] ?? null;
  }, [playerTrackId, selectedTrackDetail, trackDetailsById]);
  const playerSource = useMemo<ResolvedPlayerSource | null>(() => {
    if (playerExternalSource) {
      return {
        key: playerExternalSource.key,
        filePath: playerExternalSource.filePath,
        title: playerExternalSource.title,
        artist: playerExternalSource.artist,
        durationMs: playerExternalSource.durationMs
      };
    }
    if (!playerTrackDetail) return null;
    return {
      key: `catalog:${playerTrackDetail.track_id}`,
      filePath: playerTrackDetail.file_path,
      title: playerTrackDetail.title,
      artist: playerTrackDetail.artist_name,
      durationMs: playerTrackDetail.track.duration_ms
    };
  }, [playerExternalSource, playerTrackDetail]);
  const playerAudioSrc = playerSource ? localFilePathToMediaUrl(playerSource.filePath) : undefined;

  const rootScanJobs = useMemo(
    () => Object.values(activeScanJobs).sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [activeScanJobs]
  );

  const refreshLibraryRoots = async () => {
    setLibraryRootsLoading(true);
    setCatalogError(null);
    try {
      const roots = await catalogListLibraryRoots();
      setLibraryRoots(roots);
    } catch (error) {
      setCatalogError(normalizeUiError(error));
    } finally {
      setLibraryRootsLoading(false);
    }
  };

  useEffect(() => {
    writeStorage(STORAGE_KEYS.activeWorkspace, activeWorkspace);
  }, [activeWorkspace]);

  useEffect(() => {
    if (activeWorkspace === "Publisher Ops") {
      setPublisherOpsBooted(true);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.themePreference, themePreference);
  }, [themePreference]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.compactDensity, compactDensity);
  }, [compactDensity]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.showFullPaths, showFullPaths);
  }, [showFullPaths]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.trackSort, trackSort);
  }, [trackSort]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.onlyFavorites, showFavoritesOnly);
  }, [showFavoritesOnly]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.favorites, favoriteTrackIds);
  }, [favoriteTrackIds]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.sessionQueue, sessionQueueTrackIds);
  }, [sessionQueueTrackIds]);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const resolveTheme = () => {
      const applied =
        themePreference === "system" ? (media?.matches ? "dark" : "light") : themePreference;
      root.dataset.theme = applied;
      root.style.colorScheme = applied;
    };
    resolveTheme();
    if (!media) return;
    media.addEventListener?.("change", resolveTheme);
    return () => {
      media.removeEventListener?.("change", resolveTheme);
    };
  }, [themePreference]);

  const loadCatalogTracks = useCallback(async (search: string) => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const response = await catalogListTracks({
        search: search.trim() ? search.trim() : null,
        limit: 100,
        offset: 0
      });
      setCatalogPage(response);
      if (response.items.length > 0) {
        setSelectedTrackId((current) => (current ? current : response.items[0].track_id));
      }
    } catch (error) {
      setCatalogError(normalizeUiError(error));
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalogTracks(deferredTrackSearch);
  }, [deferredTrackSearch, loadCatalogTracks]);

  useEffect(() => {
    void refreshLibraryRoots();
  }, []);

  useEffect(() => {
    if (!selectedTrackId) {
      setSelectedTrackDetail(null);
      return;
    }
    let cancelled = false;
    setSelectedTrackLoading(true);
    setCatalogError(null);
    void (async () => {
      try {
        const detail = await catalogGetTrack(selectedTrackId);
        if (cancelled) return;
        setSelectedTrackDetail(detail);
        if (detail) {
          setTrackDetailsById((current) => ({ ...current, [detail.track_id]: detail }));
        }
        if (!playerTrackId && detail) {
          setPlayerTrackId(detail.track_id);
          setPlayerTimeSec(0);
          setPlayerIsPlaying(false);
        }
      } catch (error) {
        if (!cancelled) setCatalogError(normalizeUiError(error));
      } finally {
        if (!cancelled) setSelectedTrackLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedTrackId, playerTrackId]);

  useEffect(() => {
    if (!playerTrackId) return;
    if (selectedTrackDetail?.track_id === playerTrackId) return;
    if (trackDetailsById[playerTrackId]) return;
    let cancelled = false;
    void (async () => {
      try {
        const detail = await catalogGetTrack(playerTrackId);
        if (cancelled || !detail) return;
        setTrackDetailsById((current) => ({ ...current, [detail.track_id]: detail }));
      } catch {
        // Non-blocking; selection and queue should remain usable even if detail fetch fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playerTrackId, selectedTrackDetail, trackDetailsById]);

  useEffect(() => {
    if (!selectedTrackDetail) {
      setTrackEditor(EMPTY_TRACK_EDITOR_STATE);
      setTrackEditorDirty(false);
      setTrackEditorError(null);
      setTrackEditorNotice(null);
      setTrackDetailEditMode(false);
      previousSelectedTrackIdRef.current = "";
      return;
    }
    const isSameTrackRefresh = previousSelectedTrackIdRef.current === selectedTrackDetail.track_id;
    setTrackEditor(trackEditorStateFromDetail(selectedTrackDetail));
    setTrackEditorDirty(false);
    setTrackEditorError(null);
    if (!isSameTrackRefresh) {
      setTrackEditorNotice(null);
      setTrackDetailEditMode(false);
    }
    previousSelectedTrackIdRef.current = selectedTrackDetail.track_id;
  }, [selectedTrackDetail]);

  useEffect(() => {
    if (albumGroups.length === 0) {
      setSelectedAlbumKey("");
      return;
    }
    setSelectedAlbumKey((current) =>
      current && albumGroups.some((group) => group.key === current) ? current : albumGroups[0].key
    );
  }, [albumGroups]);

  useEffect(() => {
    setSessionQueueTrackIds((current) => current.filter((id) => visibleTracksById.has(id)));
  }, [visibleTracksById]);

  useEffect(() => {
    setBatchSelectedTrackIds((current) => current.filter((id) => visibleTracksById.has(id)));
    setTrackRowContextMenu((current) =>
      current && !visibleTracksById.has(current.trackId) ? null : current
    );
  }, [visibleTracksById]);

  useEffect(() => {
    if (!trackRowContextMenu) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTrackRowContextMenu(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [trackRowContextMenu]);

  useEffect(() => {
    const activeJobIds = Object.values(activeScanJobs)
      .filter((job) => !["COMPLETED", "FAILED"].includes(job.status))
      .map((job) => job.job_id);
    if (activeJobIds.length === 0) return;

    const timer = window.setInterval(() => {
      void (async () => {
        const updates = await Promise.all(
          activeJobIds.map(async (jobId) => {
            try {
              const job = await catalogGetIngestJob(jobId);
              return job;
            } catch {
              return null;
            }
          })
        );
        setActiveScanJobs((current) => {
          const next = { ...current };
          for (const job of updates) {
            if (job) next[job.job_id] = job;
          }
          return next;
        });
        if (updates.some((job) => job?.status === "COMPLETED")) {
          void loadCatalogTracks(trackSearch);
        }
      })();
    }, 500);

    return () => window.clearInterval(timer);
  }, [activeScanJobs, loadCatalogTracks, trackSearch]);

  useEffect(() => {
    if (!playerSource) return;
    const audio = playerAudioRef.current;
    if (!audio) return;
    audio.load();
    try {
      audio.currentTime = 0;
    } catch {
      // unsupported media runtime
    }
    setPlayerTimeSec(0);
    setPlayerIsPlaying(false);
  }, [playerSource]);

  useEffect(() => {
    if (!autoplayRequestSourceKey) return;
    if (!playerSource || autoplayRequestSourceKey !== playerSource.key) return;
    if (!playerAudioSrc) return;
    const audio = playerAudioRef.current;
    if (!audio) return;
    const run = async () => {
      try {
        const maybePromise = audio.play();
        if (maybePromise && typeof maybePromise.then === "function") {
          await maybePromise;
        }
        setPlayerError(null);
        setAppNotice({ level: "success", message: "Playback started." });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to start playback for this file.";
        setPlayerError(message);
        setAppNotice({ level: "warning", message: "Playback failed to start. Check file format support or file access." });
      } finally {
        setAutoplayRequestSourceKey((current) => (current === playerSource.key ? null : current));
      }
    };
    void run();
  }, [autoplayRequestSourceKey, playerAudioSrc, playerSource]);

  const queueIndex = useMemo(
    () => queue.findIndex((item) => item.track_id === playerTrackId),
    [queue, playerTrackId]
  );

  const setPlayerTrackFromQueueIndex = (
    index: number,
    options?: { autoplay?: boolean; openTracksWorkspace?: boolean }
  ) => {
    const item = queue[index];
    if (!item) return;
    const { autoplay = true, openTracksWorkspace = false } = options ?? {};
    setPlayerExternalSource(null);
    setPlayerTrackId(item.track_id);
    setSelectedTrackId(item.track_id);
    setPlayerError(null);
    if (autoplay) {
      setAutoplayRequestSourceKey(`catalog:${item.track_id}`);
    }
    if (openTracksWorkspace) {
      setActiveWorkspace("Tracks");
    }
  };

  const toggleTrackBatchSelection = (trackId: string, checked?: boolean) => {
    setBatchSelectedTrackIds((current) => {
      const nextChecked = checked ?? !current.includes(trackId);
      if (nextChecked) {
        return current.includes(trackId) ? current : [...current, trackId];
      }
      return current.filter((id) => id !== trackId);
    });
  };

  const clearBatchSelection = () => {
    setBatchSelectedTrackIds([]);
    setAppNotice({ level: "info", message: "Track selection cleared." });
  };

  const playTrackNow = (trackId: string, options?: { openTracksWorkspace?: boolean }) => {
    const { openTracksWorkspace = false } = options ?? {};
    setSessionQueueTrackIds((current) => {
      const base = current.length > 0 ? current : queue.map((item) => item.track_id);
      const next = moveItemToFront(base, trackId);
      const seen = new Set<string>();
      return next.filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return visibleTracksById.has(id);
      });
    });
    setPlayerExternalSource(null);
    setPlayerTrackId(trackId);
    setAutoplayRequestSourceKey(`catalog:${trackId}`);
    setPlayerError(null);
    setPlayerTimeSec(0);
    setSelectedTrackId(trackId);
    if (openTracksWorkspace) {
      setActiveWorkspace("Tracks");
    }
  };

  const currentQueueIds = queue.map((item) => item.track_id);
  const materializeSessionQueueBase = () =>
    sessionQueueTrackIds.length > 0 ? [...sessionQueueTrackIds] : [...currentQueueIds];

  const setSessionQueueFromTrackIds = (trackIds: string[]) => {
    const seen = new Set<string>();
    const next = trackIds.filter((trackId) => {
      if (seen.has(trackId)) return false;
      seen.add(trackId);
      return visibleTracksById.has(trackId);
    });
    setSessionQueueTrackIds(next);
    return next;
  };

  const appendTracksToSessionQueue = (trackIds: string[]) => {
    const base = materializeSessionQueueBase();
    const next = setSessionQueueFromTrackIds([...base, ...trackIds]);
    setAppNotice({
      level: "success",
      message: trackIds.length > 1 ? `Added ${trackIds.length} tracks to queue.` : "Added track to queue."
    });
    return next;
  };

  const enqueueTracksNext = (trackIds: string[]) => {
    const uniqueTrackIds = [...new Set(trackIds)].filter((id) => visibleTracksById.has(id));
    if (uniqueTrackIds.length === 0) return;
    const uniqueTrackIdSet = new Set(uniqueTrackIds);
    const base = materializeSessionQueueBase().filter((id) => !uniqueTrackIdSet.has(id));
    const insertAt = queueIndex >= 0 ? Math.min(queueIndex + 1, base.length) : 0;
    base.splice(insertAt, 0, ...uniqueTrackIds);
    setSessionQueueFromTrackIds(base);
    setAppNotice({
      level: "success",
      message:
        uniqueTrackIds.length > 1
          ? `Queued ${uniqueTrackIds.length} selected tracks to play next.`
          : "Queued track to play next."
    });
  };

  const enqueueTrackNext = (trackId: string) => {
    enqueueTracksNext([trackId]);
  };

  const playBatchSelectionNow = () => {
    if (orderedBatchSelectionIds.length === 0) return;
    setSessionQueueFromTrackIds(orderedBatchSelectionIds);
    playTrackNow(orderedBatchSelectionIds[0]);
    setAppNotice({
      level: "success",
      message: `Playing selection (${orderedBatchSelectionIds.length} track${orderedBatchSelectionIds.length === 1 ? "" : "s"}).`
    });
  };

  const openTrackRowContextMenu = (trackId: string, x: number, y: number) => {
    const clampedX = Math.max(8, Math.min(window.innerWidth - 220, x));
    const clampedY = Math.max(8, Math.min(window.innerHeight - 180, y));
    setSelectedTrackId(trackId);
    setTrackRowContextMenu({ trackId, x: clampedX, y: clampedY });
  };

  const handleTrackRowContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    trackId: string
  ) => {
    event.preventDefault();
    openTrackRowContextMenu(trackId, event.clientX, event.clientY);
  };

  const handleTrackRowMenuButtonClick = (
    event: ReactMouseEvent<HTMLButtonElement>,
    trackId: string
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    openTrackRowContextMenu(trackId, rect.right, rect.bottom + 6);
  };

  const runTrackContextMenuAction = (action: "play_now" | "add_queue" | "play_next" | "select_batch") => {
    if (!contextMenuTrack) return;
    switch (action) {
      case "play_now":
        playTrackNow(contextMenuTrack.track_id);
        break;
      case "add_queue":
        appendTracksToSessionQueue([contextMenuTrack.track_id]);
        break;
      case "play_next":
        enqueueTrackNext(contextMenuTrack.track_id);
        break;
      case "select_batch":
        toggleTrackBatchSelection(contextMenuTrack.track_id, true);
        setAppNotice({ level: "info", message: "Track added to batch selection." });
        break;
    }
    setTrackRowContextMenu(null);
  };

  const removeTrackFromSessionQueue = (trackId: string) => {
    setSessionQueueTrackIds((current) => current.filter((id) => id !== trackId));
    setAppNotice({ level: "info", message: "Removed track from queue." });
  };

  const clearSessionQueue = () => {
    setSessionQueueTrackIds([]);
    setAppNotice({ level: "info", message: "Queue reset to visible list order." });
  };

  const shuffleSessionQueue = () => {
    const base = materializeSessionQueueBase();
    for (let i = base.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [base[i], base[j]] = [base[j], base[i]];
    }
    setSessionQueueFromTrackIds(base);
    setAppNotice({ level: "success", message: "Queue shuffled." });
  };

  const toggleFavoriteTrack = (trackId: string) => {
    setFavoriteTrackIds((current) => {
      const next = current.includes(trackId) ? current.filter((id) => id !== trackId) : [trackId, ...current];
      setAppNotice({
        level: "info",
        message: next.includes(trackId) ? "Track marked as favorite." : "Track removed from favorites."
      });
      return next;
    });
  };

  const playAlbumGroup = (group: AlbumGroup) => {
    setSessionQueueFromTrackIds(group.trackIds);
    if (group.trackIds[0]) {
      playTrackNow(group.trackIds[0], { openTracksWorkspace: true });
      setAppNotice({ level: "success", message: `Album queued and playback requested for ${group.albumTitle}.` });
    }
  };

  const ensureExternalPlayerSource = useCallback((
    source: ExternalPlayerSource,
    options?: { autoplay?: boolean }
  ) => {
    const { autoplay = false } = options ?? {};
    setPlayerExternalSource((current) => {
      if (
        current &&
        current.key === source.key &&
        current.filePath === source.filePath &&
        current.title === source.title &&
        current.artist === source.artist &&
        current.durationMs === source.durationMs
      ) {
        return current;
      }
      return source;
    });
    setPlayerTrackId("");
    setPlayerError(null);
    if (autoplay) {
      setAutoplayRequestSourceKey(source.key);
    }
  }, []);

  const togglePlay = () => {
    if (!playerSource) {
      if (queue[0]) {
        setPlayerTrackFromQueueIndex(0, { autoplay: true });
      } else {
        setAppNotice({ level: "info", message: "No track is loaded in the shared transport." });
      }
      return;
    }
    const audio = playerAudioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => {
        setPlayerIsPlaying(false);
        setPlayerError("Unable to start playback for the current track.");
        setAppNotice({ level: "warning", message: "Playback failed to start." });
      });
    } else {
      audio.pause();
    }
  };

  const seekPlayer = useCallback((ratio: number) => {
    const audio = playerAudioRef.current;
    const source = playerSource;
    if (!audio || !source) return;
    const durationSec = Math.max(source.durationMs / 1000, 0.001);
    const nextTime = Math.max(0, Math.min(durationSec, durationSec * ratio));
    try {
      audio.currentTime = nextTime;
    } catch {
      setPlayerError("Unable to seek the current track.");
      return;
    }
    setPlayerTimeSec(nextTime);
  }, [playerSource]);

  publisherOpsTransportStateRef.current = {
    sourceKey: playerSource?.key ?? null,
    currentTimeSec: playerTimeSec,
    isPlaying: playerIsPlaying
  };

  const publisherOpsSharedTransportBridge = useMemo<SharedTransportBridgeForPublisherOps>(
    () => ({
      get state() {
        return publisherOpsTransportStateRef.current;
      },
      ensureSource: (source, options) => {
        ensureExternalPlayerSource(
          {
            key: source.sourceKey,
            filePath: source.filePath,
            title: source.title,
            artist: source.artist,
            durationMs: source.durationMs
          },
          options
        );
      },
      seekToRatio: (sourceKey, ratio) => {
        if (!playerSource || playerSource.key !== sourceKey) return;
        seekPlayer(ratio);
      }
    }),
    [ensureExternalPlayerSource, playerSource, seekPlayer]
  );

  const handleImport = async () => {
    const paths = importPathsInput
      .split(/\r?\n|,/)
      .map((value) => normalizePathForInput(value))
      .filter(Boolean);
    if (paths.length === 0) {
      setCatalogError({ code: "INVALID_ARGUMENT", message: "Enter at least one local audio file path to import." });
      return;
    }
    setCatalogImporting(true);
    setCatalogError(null);
    try {
      const response = await catalogImportFiles(paths);
      setCatalogFailures(response.failed);
      setImportPathsInput("");
      await loadCatalogTracks(trackSearch);
      setAppNotice({
        level: response.failed.length > 0 ? "warning" : "success",
        message:
          response.imported.length > 0
            ? `Imported ${response.imported.length} track(s).`
            : "No tracks were imported."
      });
      if (response.imported[0]) {
        setSelectedTrackId(response.imported[0].track_id);
      }
    } catch (error) {
      setCatalogError(normalizeUiError(error));
    } finally {
      setCatalogImporting(false);
    }
  };

  const handleAddLibraryRoot = async () => {
    const path = normalizePathForInput(libraryRootPathInput);
    if (!path) {
      setCatalogError({ code: "INVALID_ARGUMENT", message: "Enter a local folder path to add a library root." });
      return;
    }
    setLibraryRootMutating(true);
    setCatalogError(null);
    try {
      const root = await catalogAddLibraryRoot(path);
      setLibraryRootPathInput("");
      setLibraryRoots((current) => {
        const deduped = current.filter((item) => item.root_id !== root.root_id);
        return [root, ...deduped];
      });
      setAppNotice({ level: "success", message: "Library root added." });
    } catch (error) {
      setCatalogError(normalizeUiError(error));
    } finally {
      setLibraryRootMutating(false);
    }
  };

  const handleBrowseLibraryRoot = async () => {
    setCatalogError(null);
    try {
      const selected = await pickDirectoryDialog({ title: "Select Library Root Folder" });
      if (!selected) return;
      setLibraryRootPathInput(selected);
      setAppNotice({ level: "info", message: "Library root path selected. Click Add Root to persist it." });
    } catch (error) {
      setCatalogError(normalizeUiError(error));
    }
  };

  const handleRemoveLibraryRoot = async (rootId: string) => {
    setLibraryRootMutating(true);
    setCatalogError(null);
    try {
      await catalogRemoveLibraryRoot(rootId);
      setLibraryRoots((current) => current.filter((root) => root.root_id !== rootId));
      setAppNotice({ level: "info", message: "Library root removed." });
    } catch (error) {
      setCatalogError(normalizeUiError(error));
    } finally {
      setLibraryRootMutating(false);
    }
  };

  const handleScanLibraryRoot = async (rootId: string) => {
    setLibraryRootMutating(true);
    setCatalogError(null);
    try {
      const job: CatalogScanRootResponse = await catalogScanRoot(rootId);
      setActiveScanJobs((current) => ({
        ...current,
        [job.job_id]: {
          job_id: job.job_id,
          status: "PENDING",
          scope: `SCAN_ROOT:${rootId}`,
          total_items: 0,
          processed_items: 0,
          error_count: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      }));
      setAppNotice({ level: "info", message: "Library root scan started." });
    } catch (error) {
      setCatalogError(normalizeUiError(error));
    } finally {
      setLibraryRootMutating(false);
    }
  };

  const handleSaveTrackMetadata = async () => {
    if (!selectedTrackDetail) return;
    if (trackEditor.trackId !== selectedTrackDetail.track_id) return;

    setTrackEditorSaving(true);
    setTrackEditorError(null);
    setTrackEditorNotice(null);
    try {
      const updated = await catalogUpdateTrackMetadata({
        track_id: selectedTrackDetail.track_id,
        visibility_policy: trackEditor.visibilityPolicy,
        license_policy: trackEditor.licensePolicy,
        downloadable: trackEditor.downloadable,
        tags: parseTagEditorInput(trackEditor.tagsInput)
      });
      setSelectedTrackDetail(updated);
      setTrackDetailsById((current) => ({ ...current, [updated.track_id]: updated }));
      setCatalogPage((current) => ({
        ...current,
        items: current.items.map((item) =>
          item.track_id === updated.track_id ? { ...item, updated_at: updated.updated_at } : item
        )
      }));
      setTrackEditorDirty(false);
      setTrackEditorNotice("Track metadata saved.");
      setTrackDetailEditMode(false);
    } catch (error) {
      setTrackEditorError(normalizeUiError(error));
    } finally {
      setTrackEditorSaving(false);
    }
  };

  const handleOpenInPublisherOps = async (track: CatalogTrackDetailResponse) => {
    setCatalogError(null);
    setPublisherBridgeLoadingTrackId(track.track_id);
    try {
      const draft = await publisherCreateDraftFromTrack(track.track_id);
      setPublisherDraftPrefill(draft);
      setActiveWorkspace("Publisher Ops");
    } catch (error) {
      setCatalogError(normalizeUiError(error));
    } finally {
      setPublisherBridgeLoadingTrackId(null);
    }
  };

  const trackEditorTagsPreview = useMemo(() => parseTagEditorInput(trackEditor.tagsInput), [trackEditor.tagsInput]);
  const trackEditorBoundToSelection = Boolean(
    selectedTrackDetail && trackEditor.trackId === selectedTrackDetail.track_id
  );
  const canSaveTrackMetadata = !trackEditorSaving && trackEditorBoundToSelection && trackEditorDirty;
  const canResetTrackMetadata = !trackEditorSaving && Boolean(selectedTrackDetail) && trackEditorDirty;

  const markTrackEditorDirty = () => {
    setTrackEditorDirty(true);
    setTrackEditorNotice(null);
  };

  const patchTrackEditor = (patch: Partial<TrackMetadataEditorState>) => {
    setTrackEditor((current) => ({ ...current, ...patch }));
    markTrackEditorDirty();
  };

  const resetTrackEditorFromSelectedDetail = () => {
    if (!selectedTrackDetail) return;
    setTrackEditor(trackEditorStateFromDetail(selectedTrackDetail));
    setTrackEditorDirty(false);
    setTrackEditorError(null);
    setTrackEditorNotice(null);
  };

  return (
    <div className={`music-shell${compactDensity ? " compact" : ""}`}>
      <aside className="music-sidebar">
        <div className="music-brand">
          <p className="eyebrow">Rauversion-style</p>
          <h1>Music Core</h1>
          <p className="music-brand-subtitle">Offline-first library, player, and publisher ops.</p>
        </div>

        <nav aria-label="Workspaces" className="workspace-nav">
          {workspaces.map((workspace) => (
            <HelpTooltip
              key={workspace}
              content={
                workspace === "Publisher Ops"
                  ? "Existing deterministic release pipeline (Plan → Verify/QC → Execute → Report) preserved."
                  : `Open the ${workspace} workspace.`
              }
              side="bottom"
            >
              <button
                type="button"
                className={`workspace-nav-item${activeWorkspace === workspace ? " active" : ""}`}
                onClick={() => setActiveWorkspace(workspace)}
              >
                {workspace}
              </button>
            </HelpTooltip>
          ))}
        </nav>

        <section className="sidebar-panel">
          <div className="sidebar-panel-head">
            <h2>Library Roots</h2>
            <HelpTooltip
              variant="popover"
              iconLabel="How library root scanning works"
              title="Library Roots"
              side="bottom"
              content={
                <>
                  <p>Add local folders as library roots, then run scans to ingest supported audio files recursively.</p>
                  <p>Scans run in the background and update SQLite-backed ingest jobs so progress can be polled safely.</p>
                </>
              }
            />
          </div>

          <HelpTooltip content="Local directory path to scan recursively for audio files. UNC/network paths are blocked by the Rust IPC boundary.">
            <input
              className="tracks-search"
              type="text"
              value={libraryRootPathInput}
              onChange={(event) => setLibraryRootPathInput(event.target.value)}
              placeholder={"C:\\Music"}
              aria-label="Library root path"
            />
          </HelpTooltip>
          <div className="library-root-actions">
            <HelpTooltip content="Opens a native folder picker to populate the library root path input.">
              <button
                type="button"
                className="secondary-action"
                onClick={() => void handleBrowseLibraryRoot()}
                disabled={libraryRootMutating}
              >
                Browse...
              </button>
            </HelpTooltip>
            <HelpTooltip content="Adds this folder as a persisted local library root.">
              <button
                type="button"
                className="secondary-action"
                onClick={() => void handleAddLibraryRoot()}
                disabled={libraryRootMutating}
              >
                Add Root
              </button>
            </HelpTooltip>
            <HelpTooltip content="Reloads the saved library root list from SQLite.">
              <button
                type="button"
                className="secondary-action"
                onClick={() => void refreshLibraryRoots()}
                disabled={libraryRootsLoading}
              >
                {libraryRootsLoading ? "Loading..." : "Refresh Roots"}
              </button>
            </HelpTooltip>
          </div>

          <div className="library-roots-list">
            {libraryRoots.length === 0 ? (
              <p className="sidebar-inline-note">No library roots added yet.</p>
            ) : (
              libraryRoots.map((root) => {
                const latestJob = rootScanJobs.find((job) => job.scope === `SCAN_ROOT:${root.root_id}`);
                const progress =
                  latestJob && latestJob.total_items > 0
                    ? `${latestJob.processed_items}/${latestJob.total_items}`
                    : latestJob
                      ? `${latestJob.processed_items}`
                      : "Idle";
                return (
                  <div key={root.root_id} className="library-root-row">
                    <div className="library-root-meta">
                      <strong>{formatDisplayPath(root.path, { showFullPaths })}</strong>
                      <span>
                        {latestJob ? `${latestJob.status} • ${progress} • errors ${latestJob.error_count}` : "No scans yet"}
                      </span>
                    </div>
                    <div className="library-root-row-actions">
                      <HelpTooltip content="Scans this library root recursively and imports supported audio files into the local catalog.">
                        <button
                          type="button"
                          className="secondary-action"
                          onClick={() => void handleScanLibraryRoot(root.root_id)}
                          disabled={libraryRootMutating}
                        >
                          Scan
                        </button>
                      </HelpTooltip>
                      <HelpTooltip content="Removes the saved library root configuration (does not delete local files or imported tracks).">
                        <button
                          type="button"
                          className="secondary-action"
                          onClick={() => void handleRemoveLibraryRoot(root.root_id)}
                          disabled={libraryRootMutating}
                        >
                          Remove
                        </button>
                      </HelpTooltip>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="sidebar-panel">
          <div className="sidebar-panel-head">
            <h2>Import Audio</h2>
            <HelpTooltip
              variant="popover"
              iconLabel="How catalog import works"
              title="Catalog Import"
              side="bottom"
              content={
                <>
                  <p>Imports local audio files into the offline catalog.</p>
                  <p>Rust decodes audio, computes LUFS + waveform peaks, fingerprints media with BLAKE3, and stores track metadata in SQLite WAL.</p>
                  <p>Publisher Ops remains separate and is only triggered when you explicitly bridge a track.</p>
                </>
              }
            />
          </div>

          <HelpTooltip content="Paste one or more local file paths (newline or comma separated) to import them into the local music catalog.">
            <textarea
              className="catalog-import-textarea"
              rows={5}
              value={importPathsInput}
              onChange={(event) => setImportPathsInput(event.target.value)}
              placeholder={"C:\\Music\\Artist - Track.wav\nC:\\Music\\Another\\Song.flac"}
            />
          </HelpTooltip>
          <HelpTooltip content="Runs native Rust analysis and stores imported tracks in the local catalog.">
            <button type="button" className="primary-action" onClick={() => void handleImport()} disabled={catalogImporting}>
              {catalogImporting ? "Importing..." : "Import to Library"}
            </button>
          </HelpTooltip>
          {catalogFailures.length > 0 ? (
            <div className="import-failures" role="status" aria-live="polite">
              <strong>Import failures ({catalogFailures.length})</strong>
              <ul>
                {catalogFailures.slice(0, 3).map((failure) => (
                  <li key={`${failure.path}-${failure.code}`}>
                    <code>{failure.code}</code>: {formatDisplayPath(failure.path, { showFullPaths })}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </aside>

      <div className="music-main">
        <header className="music-topbar">
          <div>
            <p className="eyebrow">Workspace</p>
            <h2>{activeWorkspace}</h2>
            <p className="music-topbar-subtitle">
              {activeWorkspace === "Settings"
                ? "Configure local UI behavior, playback preferences, and path display settings."
                : "Library Summary"}
            </p>
          </div>
          <div className="topbar-stats" aria-label="Library summary quick links">
            <button type="button" className="topbar-pill button" onClick={() => setActiveWorkspace("Tracks")}>
              {catalogPage.total.toLocaleString()} track(s)
            </button>
            <button type="button" className="topbar-pill button" onClick={() => setActiveWorkspace("Albums")}>
              {albumGroups.length.toLocaleString()} album group(s)
            </button>
            <button type="button" className="topbar-pill button" onClick={() => setActiveWorkspace("Tracks")}>
              {favoriteTrackCount.toLocaleString()} favorite(s)
            </button>
            <button type="button" className="topbar-pill button" onClick={() => setActiveWorkspace("Tracks")}>
              {queue.length.toLocaleString()} queue item(s)
            </button>
            <button
              type="button"
              className={`topbar-pill button${catalogFailures.length > 0 ? " warning" : ""}`}
              onClick={() => setActiveWorkspace("Library")}
            >
              {catalogFailures.length} import error(s)
            </button>
          </div>
        </header>

        {appNotice ? (
          <div className={`catalog-notice-banner ${appNotice.level}`} role="status" aria-live="polite">
            {appNotice.message}
          </div>
        ) : null}

        {catalogError ? (
          <div className="catalog-error-banner" role="alert">
            <strong>{catalogError.code}</strong>: {catalogError.message}
          </div>
        ) : null}

        <main className="workspace-content">
          <section hidden={activeWorkspace !== "Library"} className="workspace-section">
            <div className="library-hero">
              <div className="library-hero-copy">
                <p className="eyebrow">Library</p>
                <h3>Music-first workspace, publisher pipeline preserved</h3>
                <p>
                  This app now starts in a Rauversion-style music catalog shell. Import local audio, inspect metadata and waveform
                  metrics, then bridge selected tracks into <strong>Publisher Ops</strong> when you are ready to run the deterministic
                  publish pipeline.
                </p>
              </div>
              <div className="library-hero-cards">
                <div className="hero-card">
                  <span className="hero-card-label">Tracks</span>
                  <strong>{catalogPage.total.toLocaleString()}</strong>
                </div>
                <div className="hero-card">
                  <span className="hero-card-label">Queue</span>
                  <strong>{queue.length.toLocaleString()}</strong>
                </div>
                <div className="hero-card">
                  <span className="hero-card-label">Albums</span>
                  <strong>{albumGroups.length.toLocaleString()}</strong>
                </div>
                <div className="hero-card">
                  <span className="hero-card-label">Favorites</span>
                  <strong>{favoriteTrackCount.toLocaleString()}</strong>
                </div>
              </div>
            </div>
            <div className="library-quick-links">
              <HelpTooltip content="Open the detailed tracks browser with list + player detail panel.">
                <button type="button" className="secondary-action" onClick={() => setActiveWorkspace("Tracks")}>
                  Open Tracks Workspace
                </button>
              </HelpTooltip>
              <HelpTooltip content="Open the grouped album browser generated from imported catalog tracks.">
                <button type="button" className="secondary-action" onClick={() => setActiveWorkspace("Albums")}>
                  Open Albums Workspace
                </button>
              </HelpTooltip>
              <HelpTooltip content="Open the existing publisher pipeline workflow (plan/verify/execute/report).">
                <button type="button" className="secondary-action" onClick={() => setActiveWorkspace("Publisher Ops")}>
                  Open Publisher Ops
                </button>
              </HelpTooltip>
            </div>
          </section>

          <section hidden={activeWorkspace !== "Tracks"} className="workspace-section tracks-layout">
            <div className="tracks-column tracks-list-column">
              <div className="tracks-toolbar">
                <HelpTooltip content="Search local tracks by title, artist, or album.">
                  <input
                    type="search"
                    className="tracks-search"
                    value={trackSearch}
                    onChange={(event) => setTrackSearch(event.target.value)}
                    placeholder="Search tracks, artists, albums..."
                    aria-label="Search tracks"
                  />
                </HelpTooltip>
                <HelpTooltip content="Sorts the visible track list locally (search and favorites filters still apply).">
                  <select
                    className="tracks-toolbar-select"
                    value={trackSort}
                    onChange={(event) => setTrackSort(event.target.value as TrackSortKey)}
                    aria-label="Track sort"
                  >
                    {trackSortOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </HelpTooltip>
                <HelpTooltip content="Reload the local track list from SQLite.">
                  <button type="button" className="secondary-action" onClick={() => void loadCatalogTracks(trackSearch)} disabled={catalogLoading}>
                    {catalogLoading ? "Refreshing..." : "Refresh"}
                  </button>
                </HelpTooltip>
              </div>
              <div className="tracks-subtoolbar">
                <HelpTooltip content="Toggle a favorites-only view using local session favorites.">
                  <button
                    type="button"
                    className={`filter-chip${showFavoritesOnly ? " active" : ""}`}
                    onClick={() => setShowFavoritesOnly((current) => !current)}
                  >
                    {showFavoritesOnly ? "Favorites Only" : "All Tracks"}
                  </button>
                </HelpTooltip>
                <HelpTooltip content="Opens the album grouping view for the current visible tracks.">
                  <button type="button" className="secondary-action compact" onClick={() => setActiveWorkspace("Albums")}>
                    Albums View
                  </button>
                </HelpTooltip>
                <span className={`queue-mode-pill${queueUsesSessionOrder ? "" : " subtle"}`}>
                  {queueUsesSessionOrder ? "Session queue active" : "Queue follows visible list"}
                </span>
                {selectedTrackId ? (
                  <div className="tracks-selection-actions" role="group" aria-label="Selected track actions">
                    <HelpTooltip content="Play the selected track immediately and move it to the front of the local queue.">
                      <button
                        type="button"
                        className="secondary-action compact"
                        onClick={() => playTrackNow(selectedTrackId)}
                      >
                        Play Now
                      </button>
                    </HelpTooltip>
                    <HelpTooltip content="Add the selected track to the local queue without interrupting playback.">
                      <button
                        type="button"
                        className="secondary-action compact"
                        onClick={() => appendTracksToSessionQueue([selectedTrackId])}
                      >
                        Add to Queue
                      </button>
                    </HelpTooltip>
                    <HelpTooltip content="Place the selected track immediately after the currently playing queue item.">
                      <button
                        type="button"
                        className="secondary-action compact"
                        onClick={() => enqueueTrackNext(selectedTrackId)}
                      >
                        Play Next
                      </button>
                    </HelpTooltip>
                  </div>
                ) : null}
                {orderedBatchSelectionIds.length > 0 ? (
                  <div className="tracks-batch-actions" role="group" aria-label="Batch actions for selected tracks">
                    <span className="queue-mode-pill">{orderedBatchSelectionIds.length} selected</span>
                    <HelpTooltip content="Replace the session queue with the selected tracks (visible-list order) and start playback from the first selected track.">
                      <button type="button" className="secondary-action compact" onClick={playBatchSelectionNow}>
                        Play Selection
                      </button>
                    </HelpTooltip>
                    <HelpTooltip content="Add the selected tracks to the end of the session queue in visible-list order.">
                      <button
                        type="button"
                        className="secondary-action compact"
                        onClick={() => appendTracksToSessionQueue(orderedBatchSelectionIds)}
                      >
                        Add Selection to Queue
                      </button>
                    </HelpTooltip>
                    <HelpTooltip content="Insert the selected tracks immediately after the current queue item in visible-list order.">
                      <button
                        type="button"
                        className="secondary-action compact"
                        onClick={() => enqueueTracksNext(orderedBatchSelectionIds)}
                      >
                        Play Selection Next
                      </button>
                    </HelpTooltip>
                    <HelpTooltip content="Clear the current multi-selection in the track list.">
                      <button type="button" className="secondary-action compact" onClick={clearBatchSelection}>
                        Clear Selection
                      </button>
                    </HelpTooltip>
                  </div>
                ) : null}
              </div>

              <div className="tracks-list-shell" role="list" aria-label="Imported tracks">
                {visibleTracks.length === 0 ? (
                  <p className="empty-state">
                    {catalogPage.items.length === 0
                      ? "No tracks imported yet. Use the Import Audio panel in the sidebar."
                      : "No tracks match the current filters. Try clearing search or turning off Favorites Only."}
                  </p>
                ) : (
                  visibleTracks.map((item) => (
                    <div
                      key={item.track_id}
                      role="listitem"
                      className={`track-row-shell${selectedTrackId === item.track_id ? " selected" : ""}${batchSelectedTrackIdSet.has(item.track_id) ? " batch-selected" : ""}`}
                      onContextMenu={(event) => handleTrackRowContextMenu(event, item.track_id)}
                    >
                      <label className="track-row-batch-checkbox">
                        <input
                          type="checkbox"
                          checked={batchSelectedTrackIdSet.has(item.track_id)}
                          onChange={(event) => toggleTrackBatchSelection(item.track_id, event.target.checked)}
                          aria-label={`Select ${item.title} for batch actions`}
                          onClick={(event) => event.stopPropagation()}
                        />
                      </label>
                      <button
                        type="button"
                        className="track-row track-row-main-button"
                        onClick={() => setSelectedTrackId(item.track_id)}
                        aria-current={selectedTrackId === item.track_id ? "true" : undefined}
                      >
                        <span className="track-row-title">
                          {favoriteTrackIdSet.has(item.track_id) ? <span className="track-row-favorite">*</span> : null}
                          {item.title}
                        </span>
                        <span className="track-row-subtitle">
                          {item.artist_name}
                          {item.album_title ? ` | ${item.album_title}` : ""}
                        </span>
                        <span className="track-row-meta">
                          {Math.max(1, Math.round(item.duration_ms / 1000))}s | {item.loudness_lufs.toFixed(1)} LUFS
                        </span>
                      </button>
                      <HelpTooltip content="Open track row actions (Play Now, Add to Queue, Play Next, Add to Selection)." side="bottom">
                        <button
                          type="button"
                          className="track-row-menu-button"
                          aria-label={`Track actions for ${item.title}`}
                          aria-haspopup="menu"
                          aria-expanded={trackRowContextMenu?.trackId === item.track_id}
                          onClick={(event) => handleTrackRowMenuButtonClick(event, item.track_id)}
                        >
                          ⋯
                        </button>
                      </HelpTooltip>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="tracks-column tracks-detail-column">
              {selectedTrackLoading ? <p className="empty-state">Loading track detail…</p> : null}
              {!selectedTrackLoading && !selectedTrackDetail ? (
                <p className="empty-state">Select a track to view waveform, QC metrics, and metadata.</p>
              ) : null}
              {selectedTrackDetail && selectedTrackAnalysis ? (
                <div className="track-detail-stack">
                  <div className="track-detail-card">
                    <div className="track-detail-head">
                      <div>
                        <p className="eyebrow">Track Detail</p>
                        <h3>{selectedTrackDetail.title}</h3>
                        <p className="track-detail-subtitle">
                          {selectedTrackDetail.artist_name}
                          {selectedTrackDetail.album_title ? ` | ${selectedTrackDetail.album_title}` : ""}
                        </p>
                      </div>
                      <div className="track-detail-actions">
                        <HelpTooltip content="Play this track now and move it to the front of the current local session queue.">
                          <button
                            type="button"
                            className="secondary-action"
                            onClick={() => playTrackNow(selectedTrackDetail.track_id)}
                          >
                            Play Now
                          </button>
                        </HelpTooltip>
                        <HelpTooltip content="Adds this track to the end of the local session queue without changing playback.">
                          <button
                            type="button"
                            className="secondary-action"
                            onClick={() => appendTracksToSessionQueue([selectedTrackDetail.track_id])}
                          >
                            Add to Queue
                          </button>
                        </HelpTooltip>
                        <HelpTooltip content="Places this track immediately after the currently playing track in the local queue.">
                          <button
                            type="button"
                            className="secondary-action"
                            onClick={() => enqueueTrackNext(selectedTrackDetail.track_id)}
                          >
                            Play Next
                          </button>
                        </HelpTooltip>
                        <HelpTooltip content="Marks this track as a local session favorite for quick filtering and browsing.">
                          <button
                            type="button"
                            className={`secondary-action${isSelectedTrackFavorite ? " active" : ""}`}
                            onClick={() => toggleFavoriteTrack(selectedTrackDetail.track_id)}
                            aria-pressed={isSelectedTrackFavorite}
                          >
                            {isSelectedTrackFavorite ? "Unfavorite" : "Favorite"}
                          </button>
                        </HelpTooltip>
                        {!trackDetailEditMode ? (
                          <HelpTooltip content="Enables inline metadata editing for this track detail view.">
                            <button
                              type="button"
                              className="secondary-action"
                              onClick={() => {
                                setTrackDetailEditMode(true);
                                setTrackEditorError(null);
                                setTrackEditorNotice(null);
                              }}
                            >
                              Edit Metadata
                            </button>
                          </HelpTooltip>
                        ) : (
                          <>
                            <HelpTooltip content="Saves tags, rights, and visibility to the local SQLite catalog for this track.">
                              <button
                                type="button"
                                className="primary-action"
                                onClick={() => void handleSaveTrackMetadata()}
                                disabled={!canSaveTrackMetadata}
                              >
                                {trackEditorSaving ? "Saving..." : "Save Metadata"}
                              </button>
                            </HelpTooltip>
                            <HelpTooltip content="Cancels edit mode and restores the last saved metadata for this track.">
                              <button
                                type="button"
                                className="secondary-action"
                                onClick={() => {
                                  resetTrackEditorFromSelectedDetail();
                                  setTrackDetailEditMode(false);
                                }}
                                disabled={trackEditorSaving}
                              >
                                Cancel Edit
                              </button>
                            </HelpTooltip>
                          </>
                        )}
                        <HelpTooltip
                          variant="popover"
                          iconLabel="How the Publisher Ops bridge works"
                          title="Bridge to Publisher Ops"
                          side="bottom"
                          content={
                            <>
                              <p>This generates a draft release spec from the selected catalog track and loads both spec and media paths into Publisher Ops.</p>
                              <p>The deterministic plan/execute state machine stays unchanged and still requires spec input and manual QC approval.</p>
                            </>
                          }
                        />
                        <HelpTooltip content="Generates a catalog-backed draft spec, then opens Publisher Ops with both spec and media paths prefilled.">
                          <button
                            type="button"
                            className="primary-action"
                            onClick={() => void handleOpenInPublisherOps(selectedTrackDetail)}
                            disabled={publisherBridgeLoadingTrackId === selectedTrackDetail.track_id}
                          >
                            {publisherBridgeLoadingTrackId === selectedTrackDetail.track_id
                              ? "Preparing Draft..."
                              : "Open in Publisher Ops"}
                          </button>
                        </HelpTooltip>
                      </div>
                    </div>

                    <div className="track-meta-grid">
                      <div>
                        <span className="track-meta-label">File</span>
                        <code className="track-meta-value">
                          {formatDisplayPath(selectedTrackDetail.file_path, { showFullPaths })}
                        </code>
                      </div>

                      <div>
                        <span className="track-meta-label">Visibility</span>
                        {trackDetailEditMode ? (
                          <HelpTooltip content="Controls how this track should be treated in local catalog workflows and future export/share features.">
                            <select
                              aria-label="Visibility"
                              value={trackEditor.visibilityPolicy}
                              onChange={(event) => patchTrackEditor({ visibilityPolicy: event.target.value })}
                              disabled={trackEditorSaving}
                              className="track-meta-inline-select"
                            >
                              {trackVisibilityOptions.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </HelpTooltip>
                        ) : (
                          <span className="track-meta-value">{selectedTrackDetail.visibility_policy}</span>
                        )}
                      </div>

                      <div>
                        <span className="track-meta-label">License</span>
                        {trackDetailEditMode ? (
                          <HelpTooltip content="Sets the local rights/license policy used for future publish adapters and export mappings.">
                            <select
                              aria-label="License"
                              value={trackEditor.licensePolicy}
                              onChange={(event) => patchTrackEditor({ licensePolicy: event.target.value })}
                              disabled={trackEditorSaving}
                              className="track-meta-inline-select"
                            >
                              {trackLicenseOptions.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </HelpTooltip>
                        ) : (
                          <span className="track-meta-value">{selectedTrackDetail.license_policy}</span>
                        )}
                      </div>

                      <div>
                        <span className="track-meta-label">Downloadable</span>
                        {trackDetailEditMode ? (
                          <label className="track-editor-checkbox inline">
                            <input
                              type="checkbox"
                              checked={trackEditor.downloadable}
                              onChange={(event) => patchTrackEditor({ downloadable: event.target.checked })}
                              disabled={trackEditorSaving}
                            />
                            <span>Downloadable in future publish/export workflows</span>
                          </label>
                        ) : (
                          <span className="track-meta-value">{selectedTrackDetail.downloadable ? "Yes" : "No"}</span>
                        )}
                      </div>
                    </div>

                    <div className="track-detail-inline-editor">
                      <div className="track-detail-inline-editor-head">
                        <div>
                          <span className="track-meta-label">Tags</span>
                          <div className="track-meta-value subtle">
                            {trackDetailEditMode
                              ? "Inline edit mode (local catalog only)"
                              : "Read-only view. Click Edit Metadata to modify and save."}
                          </div>
                        </div>
                        <HelpTooltip
                          variant="popover"
                          iconLabel="How track metadata editing works"
                          title="Track Metadata"
                          side="bottom"
                          content={
                            <>
                              <p>These fields update the local catalog only (SQLite) and do not run Publisher Ops by themselves.</p>
                              <p>Use tags, rights, and visibility to prepare a track before bridging it into the deterministic publish pipeline.</p>
                            </>
                          }
                        />
                      </div>

                      {trackDetailEditMode ? (
                        <label className="track-editor-field">
                          <span className="sr-only">Tags</span>
                          <HelpTooltip content="Comma or newline separated tags. Duplicate tags are collapsed locally and revalidated by Rust IPC before saving.">
                            <textarea
                              aria-label="Tags"
                              className="track-editor-tags"
                              rows={3}
                              value={trackEditor.tagsInput}
                              onChange={(event) => patchTrackEditor({ tagsInput: event.target.value })}
                              placeholder="ambient, downtempo, late night"
                              disabled={trackEditorSaving}
                            />
                          </HelpTooltip>
                          <small className="track-editor-help-text">
                            {trackEditorTagsPreview.length} tag(s) prepared for save
                            {trackEditorDirty ? " • unsaved changes" : ""}
                          </small>
                        </label>
                      ) : (
                        <div className="track-chip-row" aria-label="Track tags">
                          {selectedTrackDetail.tags.length > 0 ? (
                            selectedTrackDetail.tags.map((tag) => (
                              <span key={tag} className="track-chip">
                                #{tag}
                              </span>
                            ))
                          ) : (
                            <span className="track-chip empty">No tags yet</span>
                          )}
                        </div>
                      )}
                    </div>

                    {trackDetailEditMode && canResetTrackMetadata ? (
                      <div className="track-detail-inline-reset">
                        <HelpTooltip content="Restores the editor fields to the last saved metadata without leaving edit mode.">
                          <button
                            type="button"
                            className="secondary-action"
                            onClick={resetTrackEditorFromSelectedDetail}
                            disabled={trackEditorSaving}
                          >
                            Reset Fields
                          </button>
                        </HelpTooltip>
                      </div>
                    ) : null}

                    {trackEditorError ? (
                      <div className="track-editor-error" role="alert">
                        <strong>{trackEditorError.code}</strong>: {trackEditorError.message}
                      </div>
                    ) : null}
                    {trackEditorNotice ? (
                      <div className="track-editor-notice" role="status" aria-live="polite">
                        {trackEditorNotice}
                      </div>
                    ) : null}
                  </div>

                  <QcPlayer
                    analysis={selectedTrackAnalysis}
                    currentTimeSec={playerTrackId === selectedTrackDetail.track_id ? playerTimeSec : 0}
                    isPlaying={playerTrackId === selectedTrackDetail.track_id ? playerIsPlaying : false}
                    onTogglePlay={() => {
                      if (playerTrackId !== selectedTrackDetail.track_id) {
                        setPlayerTrackId(selectedTrackDetail.track_id);
                        setPlayerTimeSec(0);
                      }
                      togglePlay();
                    }}
                    onSeek={(ratio) => {
                      if (playerTrackId !== selectedTrackDetail.track_id) {
                        setPlayerTrackId(selectedTrackDetail.track_id);
                      }
                      seekPlayer(ratio);
                    }}
                    onTimeUpdate={setPlayerTimeSec}
                    onPlay={() => setPlayerIsPlaying(true)}
                    onPause={() => setPlayerIsPlaying(false)}
                    audioRef={playerAudioRef}
                    renderAudioElement={false}
                    audioSrc={playerAudioSrc}
                    showPlayToggle={false}
                  />
                </div>
              ) : null}
            </div>

          </section>

          <section hidden={activeWorkspace !== "Albums"} className="workspace-section albums-layout">
            <div className="albums-column albums-list-column">
              <div className="albums-head">
                <div>
                  <p className="eyebrow">Albums</p>
                  <h3>Grouped from Local Catalog Tracks</h3>
                </div>
                <HelpTooltip content="Album groups are generated from track metadata in the local catalog. Unassigned tracks appear under Singles / Unassigned.">
                  <span className="queue-help-badge">{albumGroups.length} groups</span>
                </HelpTooltip>
              </div>
              <div className="albums-list-shell" role="list" aria-label="Album groups">
                {albumGroups.length === 0 ? (
                  <p className="empty-state">Import tracks to populate album groups.</p>
                ) : (
                  albumGroups.map((group) => (
                    <button
                      key={group.key}
                      type="button"
                      role="listitem"
                      className={`album-row${selectedAlbumGroup?.key === group.key ? " selected" : ""}`}
                      onClick={() => setSelectedAlbumKey(group.key)}
                    >
                      <span className="album-row-title">{group.albumTitle}</span>
                      <span className="album-row-subtitle">{group.artistName}</span>
                      <span className="album-row-meta">
                        {group.trackCount} track(s) | {formatClock(group.totalDurationMs / 1000)}
                        {group.avgLoudnessLufs != null ? ` | ${group.avgLoudnessLufs.toFixed(1)} LUFS avg` : ""}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="albums-column albums-detail-column">
              {!selectedAlbumGroup ? (
                <p className="empty-state">Select an album group to inspect tracks and queue playback.</p>
              ) : (
                <div className="album-detail-card">
                  <div className="album-detail-head">
                    <div>
                      <p className="eyebrow">Album Detail</p>
                      <h3>{selectedAlbumGroup.albumTitle}</h3>
                      <p className="track-detail-subtitle">{selectedAlbumGroup.artistName}</p>
                    </div>
                    <div className="track-detail-actions">
                      <HelpTooltip content="Start playback with this album group's first track and load the album into the local session queue.">
                        <button
                          type="button"
                          className="secondary-action"
                          onClick={() => playAlbumGroup(selectedAlbumGroup)}
                          disabled={selectedAlbumGroup.trackIds.length === 0}
                        >
                          Play Album
                        </button>
                      </HelpTooltip>
                      <HelpTooltip content="Append all album tracks to the end of the local session queue.">
                        <button
                          type="button"
                          className="secondary-action"
                          onClick={() => appendTracksToSessionQueue(selectedAlbumGroup.trackIds)}
                          disabled={selectedAlbumGroup.trackIds.length === 0}
                        >
                          Add Album to Queue
                        </button>
                      </HelpTooltip>
                      <HelpTooltip content="Open Tracks workspace and focus the first track in this album group.">
                        <button
                          type="button"
                          className="secondary-action"
                          onClick={() => {
                            if (selectedAlbumGroup.trackIds[0]) {
                              setSelectedTrackId(selectedAlbumGroup.trackIds[0]);
                              setActiveWorkspace("Tracks");
                            }
                          }}
                          disabled={selectedAlbumGroup.trackIds.length === 0}
                        >
                          Open in Tracks
                        </button>
                      </HelpTooltip>
                    </div>
                  </div>

                  <div className="album-summary-grid">
                    <div>
                      <span className="track-meta-label">Tracks</span>
                      <span className="track-meta-value">{selectedAlbumGroup.trackCount}</span>
                    </div>
                    <div>
                      <span className="track-meta-label">Total Duration</span>
                      <span className="track-meta-value">{formatClock(selectedAlbumGroup.totalDurationMs / 1000)}</span>
                    </div>
                    <div>
                      <span className="track-meta-label">Average Loudness</span>
                      <span className="track-meta-value">
                        {selectedAlbumGroup.avgLoudnessLufs != null
                          ? `${selectedAlbumGroup.avgLoudnessLufs.toFixed(1)} LUFS`
                          : "n/a"}
                      </span>
                    </div>
                    <div>
                      <span className="track-meta-label">Favorites in Album</span>
                      <span className="track-meta-value">
                        {selectedAlbumTracks.filter((track) => favoriteTrackIdSet.has(track.track_id)).length}
                      </span>
                    </div>
                  </div>

                  <div className="album-track-list" role="list" aria-label={`${selectedAlbumGroup.albumTitle} tracks`}>
                    {selectedAlbumTracks.map((track, index) => (
                      <div key={track.track_id} className="album-track-row" role="listitem">
                        <button
                          type="button"
                          className="album-track-row-main"
                          onClick={() => {
                            setSelectedTrackId(track.track_id);
                            setActiveWorkspace("Tracks");
                          }}
                        >
                          <span className="album-track-index">{index + 1}</span>
                          <span className="album-track-text">
                            <strong>
                              {favoriteTrackIdSet.has(track.track_id) ? "* " : ""}
                              {track.title}
                            </strong>
                            <small>
                              {Math.max(1, Math.round(track.duration_ms / 1000))}s | {track.loudness_lufs.toFixed(1)} LUFS
                            </small>
                          </span>
                        </button>
                        <div className="album-track-actions">
                          <HelpTooltip content="Play this track now and move it to the front of the local session queue.">
                            <button
                              type="button"
                              className="secondary-action compact"
                              onClick={() => playTrackNow(track.track_id, { openTracksWorkspace: true })}
                            >
                              Play
                            </button>
                          </HelpTooltip>
                          <HelpTooltip content="Toggle local favorite status for this track.">
                            <button
                              type="button"
                              className={`secondary-action compact${favoriteTrackIdSet.has(track.track_id) ? " active" : ""}`}
                              onClick={() => toggleFavoriteTrack(track.track_id)}
                            >
                              {favoriteTrackIdSet.has(track.track_id) ? "Unfav" : "Fav"}
                            </button>
                          </HelpTooltip>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          <section hidden={activeWorkspace !== "Playlists"} className="workspace-section placeholder-workspace">
            <h3>Playlists</h3>
            <p>Playlist editor and ordered track collections are planned after the first Tracks + Player milestone.</p>
          </section>

          <section hidden={activeWorkspace !== "Settings"} className="workspace-section settings-layout">
            <div className="settings-card">
              <div className="settings-card-head">
                <div>
                  <p className="eyebrow">Settings</p>
                  <h3>UI & Playback Preferences</h3>
                  <p className="helper-text">
                    Local-only preferences stored in browser/Tauri webview storage. They do not change publisher pipeline semantics.
                  </p>
                </div>
              </div>

              <div className="settings-grid">
                <label className="settings-field">
                  <span>Theme</span>
                  <HelpTooltip content="Choose light, dark, or follow the operating system theme.">
                    <select
                      aria-label="Theme preference"
                      value={themePreference}
                      onChange={(event) => setThemePreference(event.target.value as ThemePreference)}
                    >
                      <option value="system">System</option>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  </HelpTooltip>
                </label>

                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={compactDensity}
                    onChange={(event) => setCompactDensity(event.target.checked)}
                  />
                  <span>Compact density (denser lists and controls)</span>
                </label>

                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={showFullPaths}
                    onChange={(event) => setShowFullPaths(event.target.checked)}
                  />
                  <span>Show full local file paths (disable truncation)</span>
                </label>
              </div>

              <div className="settings-actions">
                <HelpTooltip content="Clears the current UI notice banner.">
                  <button type="button" className="secondary-action" onClick={() => setAppNotice(null)}>
                    Clear Notice
                  </button>
                </HelpTooltip>
                <HelpTooltip content="Clears the current catalog error banner shown in the music shell.">
                  <button type="button" className="secondary-action" onClick={() => setCatalogError(null)}>
                    Clear Error Banner
                  </button>
                </HelpTooltip>
              </div>
            </div>

            <div className="settings-card">
              <div className="settings-card-head">
                <div>
                  <p className="eyebrow">Library Status</p>
                  <h3>Quick Summary</h3>
                </div>
              </div>
              <ul className="compact-list settings-summary-list">
                <li>Tracks in current view: {catalogPage.total}</li>
                <li>Album groups: {albumGroups.length}</li>
                <li>Favorites: {favoriteTrackCount}</li>
                <li>Queue items: {queue.length}</li>
                <li>Import failures (session): {catalogFailures.length}</li>
                <li>Library roots: {libraryRoots.length}</li>
              </ul>
            </div>
          </section>

          {publisherOpsBooted || activeWorkspace === "Publisher Ops" ? (
            <section hidden={activeWorkspace !== "Publisher Ops"} className="workspace-section publisher-ops-host">
              <PublisherOpsWorkspace
                prefillMediaPath={publisherDraftPrefill?.media_path ?? null}
                prefillSpecPath={publisherDraftPrefill?.spec_path ?? null}
                sharedTransport={publisherOpsSharedTransportBridge}
              />
            </section>
          ) : null}
        </main>

        <div className="persistent-player-bar" role="region" aria-label="Shared transport">
            <div className="persistent-player-main">
              <div className="persistent-player-meta">
                <p className="eyebrow">Shared Player</p>
                <strong>{playerSource?.title ?? "No track loaded"}</strong>
                <p className="persistent-player-subtitle">
                  {playerSource?.artist || "Queue a track to start playback"}
                </p>
              </div>
              <div className="persistent-player-actions">
                <HelpTooltip content="Play the previous track in the current queue order.">
                  <button
                    type="button"
                    className="media-button ghost"
                    onClick={() => setPlayerTrackFromQueueIndex(Math.max(0, queueIndex - 1))}
                    disabled={queueIndex <= 0}
                  >
                    Prev
                  </button>
                </HelpTooltip>
                <HelpTooltip content={playerIsPlaying ? "Pause local playback." : "Play local audio from the shared player."}>
                  <button
                    type="button"
                    className="media-button"
                    onClick={togglePlay}
                    disabled={!playerSource && queue.length === 0}
                  >
                    {playerIsPlaying ? "Pause" : "Play"}
                  </button>
                </HelpTooltip>
                <HelpTooltip content="Play the next track in the current queue order.">
                  <button
                    type="button"
                    className="media-button ghost"
                    onClick={() => setPlayerTrackFromQueueIndex(Math.min(queue.length - 1, queueIndex + 1))}
                    disabled={queueIndex < 0 || queueIndex >= queue.length - 1}
                  >
                    Next
                  </button>
                </HelpTooltip>
              </div>
            </div>

            <div className="persistent-player-timeline">
              <span>{formatClock(playerTimeSec)}</span>
              <input
                type="range"
                min={0}
                max={1000}
                value={Math.round(
                  playerSource && playerSource.durationMs > 0
                    ? (playerTimeSec / (playerSource.durationMs / 1000)) * 1000
                    : 0
                )}
                onChange={(event) => seekPlayer(Number(event.target.value) / 1000)}
                aria-label="Shared player seek"
                disabled={!playerSource}
              />
              <span>{formatClock((playerSource?.durationMs ?? 0) / 1000)}</span>
            </div>

            {playerError ? (
              <div className="player-error-inline" role="alert">
                {playerError}
              </div>
            ) : null}

            <audio
              ref={playerAudioRef}
              src={playerAudioSrc}
              preload="metadata"
              onTimeUpdate={() => setPlayerTimeSec(playerAudioRef.current?.currentTime ?? 0)}
              onPlay={() => {
                setPlayerIsPlaying(true);
                setPlayerError(null);
              }}
              onPause={() => setPlayerIsPlaying(false)}
              onEnded={() => {
                setPlayerIsPlaying(false);
                if (queueIndex >= 0 && queueIndex < queue.length - 1) {
                  setPlayerTrackFromQueueIndex(queueIndex + 1);
                } else {
                  setPlayerTimeSec(0);
                }
              }}
            />
          </div>
      </div>

      <aside className="music-right-dock" aria-label="Queue and session state">
        <div className="queue-card queue-card-docked">
          <div className="queue-head">
            <h3>Queue</h3>
            <HelpTooltip content="Visible in all workspaces. Playback always uses this local session queue or the current visible list fallback.">
              <span className="queue-help-badge">{queueUsesSessionOrder ? "Session queue" : "Visible list"}</span>
            </HelpTooltip>
          </div>
          <div className="queue-card-controls">
            <HelpTooltip content="Randomizes the current local queue order for this app session.">
              <button
                type="button"
                className="secondary-action compact"
                onClick={shuffleSessionQueue}
                disabled={queue.length < 2}
              >
                Shuffle
              </button>
            </HelpTooltip>
            <HelpTooltip content="Clears the manual session queue so playback follows the visible track list order again.">
              <button
                type="button"
                className="secondary-action compact"
                onClick={clearSessionQueue}
                disabled={!queueUsesSessionOrder}
              >
                Reset Queue
              </button>
            </HelpTooltip>
            <HelpTooltip content="Open the Tracks workspace where queue source filtering and track list ordering can be changed.">
              <button type="button" className="secondary-action compact" onClick={() => setActiveWorkspace("Tracks")}>
                Open Tracks
              </button>
            </HelpTooltip>
          </div>
          <div className="queue-summary-strip">
            <span>{queue.length} item(s)</span>
            <span>{playerTrackId ? "Track loaded" : "No track loaded"}</span>
          </div>
          <div className="queue-list">
            {queue.length === 0 ? (
              <p className="empty-state">No playable tracks in the current queue/filter scope.</p>
            ) : (
              queue.map((item, index) => (
                <div key={item.track_id} className={`queue-row${item.track_id === playerTrackId ? " active" : ""}`}>
                  <button
                    type="button"
                    className="queue-row-select"
                    onClick={() => setPlayerTrackFromQueueIndex(index)}
                  >
                    <span>{index + 1}</span>
                    <span className="queue-row-main">
                      <strong>{item.title}</strong>
                      <small>{item.artist_name}</small>
                    </span>
                  </button>
                  {queueUsesSessionOrder ? (
                    <HelpTooltip content="Remove this track from the local session queue.">
                      <button
                        type="button"
                        className="queue-row-remove"
                        onClick={() => removeTrackFromSessionQueue(item.track_id)}
                        aria-label={`Remove ${item.title} from queue`}
                      >
                        Remove
                      </button>
                    </HelpTooltip>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </aside>

      {trackRowContextMenu && contextMenuTrack ? (
        <div
          className="track-row-context-backdrop"
          onClick={() => setTrackRowContextMenu(null)}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div
            className="track-row-context-menu"
            role="menu"
            aria-label={`Actions for ${contextMenuTrack.title}`}
            style={{ left: trackRowContextMenu.x, top: trackRowContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button type="button" role="menuitem" onClick={() => runTrackContextMenuAction("play_now")}>
              Play Now
            </button>
            <button type="button" role="menuitem" onClick={() => runTrackContextMenuAction("add_queue")}>
              Add to Queue
            </button>
            <button type="button" role="menuitem" onClick={() => runTrackContextMenuAction("play_next")}>
              Play Next
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => runTrackContextMenuAction("select_batch")}
              disabled={batchSelectedTrackIdSet.has(contextMenuTrack.track_id)}
            >
              {batchSelectedTrackIdSet.has(contextMenuTrack.track_id) ? "Already in Selection" : "Add to Selection"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
