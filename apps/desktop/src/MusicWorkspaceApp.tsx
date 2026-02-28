import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { readStorage } from "./app/state/localStorage";
import { useOptionalAppShellState } from "./app/shell/AppShellContext";
import PublisherOpsWorkspace, { type PublisherOpsScreen } from "./App";
import { LibraryIngestSidebar } from "./features/library-ingest";
import { PlayListPanel } from "./features/play-list";
import { TrackDetailPanel } from "./features/track-detail";
import { AlbumsPanel } from "./features/albums";
import { SettingsPanel } from "./features/settings";
import { PublishSelectionDock } from "./features/publish-selection";
import { SharedPlayerBar } from "./features/player";
import { TrackRowContextMenu } from "./features/context-menu";
import { useCatalogSelectionState } from "./hooks/useCatalogSelectionState";
import { useIngestJobPolling } from "./hooks/useIngestJobPolling";
import { useLibraryIngestActions } from "./hooks/useLibraryIngestActions";
import { usePublishSelectionState, type PublishSelectionItem } from "./hooks/usePublishSelectionState";
import { usePlayListActions } from "./hooks/usePlayListActions";
import { useQueueState } from "./hooks/useQueueState";
import { usePlayerTransportState } from "./hooks/usePlayerTransportState";
import { usePlayerTrackDetailPrefetch } from "./hooks/usePlayerTrackDetailPrefetch";
import { usePlayerShellSync } from "./hooks/usePlayerShellSync";
import { usePublisherBridgeActions } from "./hooks/usePublisherBridgeActions";
import { useTopNotifications } from "./hooks/useTopNotifications";
import { useTrackMetadataEditorState } from "./hooks/useTrackMetadataEditorState";
import { useTrackRowContextMenuState } from "./hooks/useTrackRowContextMenuState";
import { useWorkspaceModeState } from "./hooks/useWorkspaceModeState";
import { useWorkspacePersistence } from "./hooks/useWorkspacePersistence";
import { useWorkspaceUiEffects } from "./hooks/useWorkspaceUiEffects";
import { HelpTooltip } from "./HelpTooltip";
import type { QcPlayerAnalysis } from "./QcPlayer";
import { normalizeQuotedPathInput } from "./media-url";
import LibraryHomeSection from "./features/workspace/components/LibraryHomeSection";
import MusicTopbar from "./features/workspace/components/MusicTopbar";
import PublishStepShell from "./features/workspace/components/PublishStepShell";
import {
  type CatalogIngestJobResponse,
  type CatalogImportFailure,
  type CatalogListTracksResponse,
  type CatalogTrackDetailResponse,
  type LibraryRootResponse,
  type PublisherCreateDraftFromTrackResponse,
  type UiAppError
} from "./services/tauriClient";
import { sanitizeUiText } from "./ui-sanitize";

type Workspace = "Library" | "Quality Control" | "Playlists" | "Publisher Ops" | "Settings" | "About";
type AppMode = "Listen" | "Publish";
type LibraryIngestTab = "scan_folders" | "import_files";
type TrackSortKey = "updated_desc" | "title_asc" | "artist_asc" | "duration_desc" | "loudness_desc";
type ThemePreference = "system" | "light" | "dark";
type PlayListMode = "library" | "queue";
type QualityControlMode = "track" | "album";

const workspaces: Workspace[] = ["Library", "Quality Control", "Playlists", "Publisher Ops", "Settings", "About"];
const listenModeWorkspaces: Workspace[] = ["Library", "Quality Control", "Playlists"];
const publishModeWorkspaces: Workspace[] = ["Publisher Ops"];
const globalWorkspaces: Workspace[] = ["Settings", "About"];
const appModes: AppMode[] = ["Listen", "Publish"];
const libraryIngestTabs: Array<{ value: LibraryIngestTab; label: string }> = [
  { value: "scan_folders", label: "Scan Folders" },
  { value: "import_files", label: "Import Files" }
];
const trackVisibilityOptions = ["LOCAL", "PRIVATE", "SHARE_EXPORT_READY"] as const;
const trackLicenseOptions = ["ALL_RIGHTS_RESERVED", "CC_BY", "CC_BY_SA", "CC_BY_NC", "CC0", "CUSTOM"] as const;
const trackSortOptions: Array<{ value: TrackSortKey; label: string }> = [
  { value: "updated_desc", label: "Recently Updated" },
  { value: "title_asc", label: "Title (A-Z)" },
  { value: "artist_asc", label: "Artist (A-Z)" },
  { value: "duration_desc", label: "Duration (Longest)" },
  { value: "loudness_desc", label: "Loudness (Highest)" }
];
const publishWorkflowSteps: PublisherOpsScreen[] = [
  "New Release",
  "Plan / Preview",
  "Execute",
  "Report / History"
];
const STORAGE_KEYS = {
  activeMode: "rp.music.activeMode.v1",
  activeWorkspace: "rp.music.activeWorkspace.v1",
  qualityControlMode: "rp.music.qualityControlMode.v1",
  publishShellStep: "rp.publish.shellStep.v1",
  libraryIngestTab: "rp.music.libraryIngestTab.v1",
  libraryIngestCollapsed: "rp.music.libraryIngestCollapsed.v1",
  libraryOverviewCollapsed: "rp.music.libraryOverviewCollapsed.v1",
  libraryQuickActionsCollapsed: "rp.music.libraryQuickActionsCollapsed.v1",
  settingsPreferencesCollapsed: "rp.music.settingsPreferencesCollapsed.v1",
  settingsSummaryCollapsed: "rp.music.settingsSummaryCollapsed.v1",
  trackSort: "rp.music.trackSort.v1",
  favorites: "rp.music.favorites.v1",
  onlyFavorites: "rp.music.onlyFavorites.v1",
  sessionQueue: "rp.music.sessionQueue.v1",
  publishSelectionQueue: "rp.publish.selectionQueue.v1",
  themePreference: "rp.music.themePreference.v1",
  compactDensity: "rp.music.compactDensity.v1",
  showFullPaths: "rp.music.showFullPaths.v1",
  playListMode: "rp.music.playListMode.v1"
} as const;

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
    releaseTitle: sanitizeUiText(track.title, 256),
    releaseArtist: sanitizeUiText(track.artist_name, 256),
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

function isWorkspace(value: unknown): value is Workspace {
  return typeof value === "string" && (workspaces as readonly string[]).includes(value);
}

function isAppMode(value: unknown): value is AppMode {
  return value === "Listen" || value === "Publish";
}

function isTrackSortKey(value: unknown): value is TrackSortKey {
  return typeof value === "string" && trackSortOptions.some((option) => option.value === value);
}

function isLibraryIngestTab(value: unknown): value is LibraryIngestTab {
  return value === "scan_folders" || value === "import_files";
}

function isPlayListMode(value: unknown): value is PlayListMode {
  return value === "library" || value === "queue";
}

function isQualityControlMode(value: unknown): value is QualityControlMode {
  return value === "track" || value === "album";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isPublishSelectionItem(value: unknown): value is PublishSelectionItem {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.trackId === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.artistName === "string" &&
    typeof candidate.mediaPath === "string" &&
    typeof candidate.specPath === "string" &&
    typeof candidate.draftId === "string"
  );
}

function isPublishSelectionItemArray(value: unknown): value is PublishSelectionItem[] {
  return Array.isArray(value) && value.every((item) => isPublishSelectionItem(item));
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function isPublisherOpsScreen(value: unknown): value is PublisherOpsScreen {
  return typeof value === "string" && publishWorkflowSteps.includes(value as PublisherOpsScreen);
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

export default function MusicWorkspaceApp() {
  const shellState = useOptionalAppShellState();
  const [activeMode, setActiveMode] = useState<AppMode>(() =>
    readStorage<AppMode>(STORAGE_KEYS.activeMode, "Listen", isAppMode)
  );
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace>(() =>
    (() => {
      const stored = readStorage<string>(
        STORAGE_KEYS.activeWorkspace,
        "Library",
        (value): value is string => typeof value === "string"
      );
      if (stored === "Tracks" || stored === "Albums") {
        return "Quality Control";
      }
      return isWorkspace(stored) ? stored : "Library";
    })()
  );
  const [qualityControlMode, setQualityControlMode] = useState<QualityControlMode>(() => {
    const legacyWorkspace = readStorage<string>(
      STORAGE_KEYS.activeWorkspace,
      "Library",
      (value): value is string => typeof value === "string"
    );
    const fallbackMode: QualityControlMode = legacyWorkspace === "Albums" ? "album" : "track";
    return readStorage<QualityControlMode>(
      STORAGE_KEYS.qualityControlMode,
      fallbackMode,
      isQualityControlMode
    );
  });
  const [publishShellStep, setPublishShellStep] = useState<PublisherOpsScreen>(() =>
    readStorage<PublisherOpsScreen>(STORAGE_KEYS.publishShellStep, "New Release", isPublisherOpsScreen)
  );
  const [libraryIngestTab, setLibraryIngestTab] = useState<LibraryIngestTab>(() =>
    readStorage<LibraryIngestTab>(
      STORAGE_KEYS.libraryIngestTab,
      "scan_folders",
      isLibraryIngestTab
    )
  );
  const [libraryIngestCollapsed, setLibraryIngestCollapsed] = useState<boolean>(() =>
    readStorage<boolean>(STORAGE_KEYS.libraryIngestCollapsed, false, (value): value is boolean => typeof value === "boolean")
  );
  const [libraryOverviewCollapsed, setLibraryOverviewCollapsed] = useState<boolean>(() =>
    readStorage<boolean>(STORAGE_KEYS.libraryOverviewCollapsed, false, (value): value is boolean => typeof value === "boolean")
  );
  const [libraryQuickActionsCollapsed, setLibraryQuickActionsCollapsed] = useState<boolean>(() =>
    readStorage<boolean>(STORAGE_KEYS.libraryQuickActionsCollapsed, false, (value): value is boolean => typeof value === "boolean")
  );
  const [settingsPreferencesCollapsed, setSettingsPreferencesCollapsed] = useState<boolean>(() =>
    readStorage<boolean>(STORAGE_KEYS.settingsPreferencesCollapsed, false, (value): value is boolean => typeof value === "boolean")
  );
  const [settingsSummaryCollapsed, setSettingsSummaryCollapsed] = useState<boolean>(() =>
    readStorage<boolean>(STORAGE_KEYS.settingsSummaryCollapsed, false, (value): value is boolean => typeof value === "boolean")
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
  const [playListMode, setPlayListMode] = useState<PlayListMode>(() =>
    readStorage<PlayListMode>(STORAGE_KEYS.playListMode, "library", isPlayListMode)
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
  const [publishSelectionItems, setPublishSelectionItems] = useState<PublishSelectionItem[]>(() =>
    readStorage<PublishSelectionItem[]>(
      STORAGE_KEYS.publishSelectionQueue,
      [],
      isPublishSelectionItemArray
    )
  );

  const [catalogFailures, setCatalogFailures] = useState<CatalogImportFailure[]>([]);
  const [catalogImporting, setCatalogImporting] = useState(false);
  const [catalogError, setCatalogError] = useState<UiAppError | null>(null);
  const [appNotice, setAppNotice] = useState<AppNotice | null>(null);
  const [listenQueueFeedback, setListenQueueFeedback] = useState<string | null>(null);
  const [publishSelectionFeedback, setPublishSelectionFeedback] = useState<string | null>(null);
  const [libraryRoots, setLibraryRoots] = useState<LibraryRootResponse[]>([]);
  const [libraryRootsLoading, setLibraryRootsLoading] = useState(false);
  const [libraryRootMutating, setLibraryRootMutating] = useState(false);
  const [libraryRootBrowsing, setLibraryRootBrowsing] = useState(false);
  const [activeScanJobs, setActiveScanJobs] = useState<Record<string, CatalogIngestJobResponse>>({});

  const [batchSelectedTrackIds, setBatchSelectedTrackIds] = useState<string[]>([]);
  const [queueDragTrackId, setQueueDragTrackId] = useState<string | null>(null);
  const [selectedAlbumKey, setSelectedAlbumKey] = useState<string>("");
  const [trackDetailEditMode, setTrackDetailEditMode] = useState(false);
  const [publisherOpsBooted, setPublisherOpsBooted] = useState(false);

  const [publisherDraftPrefill, setPublisherDraftPrefill] = useState<PublisherCreateDraftFromTrackResponse | null>(null);
  const {
    modeWorkspaces,
    showLibraryIngestSidebar,
    switchAppMode
  } = useWorkspaceModeState({
    activeMode,
    setActiveMode,
    activeWorkspace,
    setActiveWorkspace,
    setPublisherOpsBooted,
    listenModeWorkspaces,
    publishModeWorkspaces,
    globalWorkspaces
  });
  const {
    catalogPage,
    setCatalogPage,
    catalogLoading,
    selectedTrackId,
    setSelectedTrackId,
    selectedTrackDetail,
    setSelectedTrackDetail,
    trackDetailsById,
    setTrackDetailsById,
    selectedTrackLoading,
    loadCatalogTracks
  } = useCatalogSelectionState({
    deferredTrackSearch,
    mapUiError: normalizeUiError,
    setCatalogError
  });
  const {
    trackRowContextMenu,
    setTrackRowContextMenu,
    handleTrackRowContextMenu,
    handleTrackRowMenuButtonClick,
    handleAlbumTrackRowContextMenu,
    handleAlbumTrackRowMenuButtonClick
  } = useTrackRowContextMenuState({
    onSelectTrack: setSelectedTrackId
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
  const isQueueMode = playListMode === "queue";
  const activePlayListItems = useMemo(
    () => (isQueueMode ? queue : visibleTracks),
    [isQueueMode, queue, visibleTracks]
  );
  const queueUsesSessionOrder = sessionQueueTrackIds.length > 0;
  const queueIndexByTrackId = useMemo(
    () => new Map(queue.map((item, index) => [item.track_id, index] as const)),
    [queue]
  );
  const publishSelectionCount = publishSelectionItems.length;
  const albumGroups = useMemo(() => buildAlbumGroups(visibleTracks), [visibleTracks]);
  const selectedAlbumGroup = useMemo(
    () => albumGroups.find((group) => group.key === selectedAlbumKey) ?? albumGroups[0] ?? null,
    [albumGroups, selectedAlbumKey]
  );
  const selectedAlbumTracks = useMemo(
    () => (selectedAlbumGroup ? selectedAlbumGroup.trackIds.map((id) => visibleTracksById.get(id)).filter((item): item is CatalogListTracksResponse["items"][number] => Boolean(item)) : []),
    [selectedAlbumGroup, visibleTracksById]
  );
  const selectedAlbumBatchTracks = useMemo(
    () => selectedAlbumTracks.filter((track) => batchSelectedTrackIdSet.has(track.track_id)),
    [selectedAlbumTracks, batchSelectedTrackIdSet]
  );
  const selectedAlbumBatchTrackIds = useMemo(
    () => selectedAlbumBatchTracks.map((track) => track.track_id),
    [selectedAlbumBatchTracks]
  );
  const favoriteTrackCount = favoriteTrackIds.length;
  const isSelectedTrackFavorite = Boolean(selectedTrackDetail && favoriteTrackIdSet.has(selectedTrackDetail.track_id));
  const contextMenuTrack = trackRowContextMenu ? visibleTracksById.get(trackRowContextMenu.trackId) ?? null : null;
  const contextMenuQueueIndex =
    trackRowContextMenu?.source === "queue"
      ? trackRowContextMenu.queueIndex ?? queueIndexByTrackId.get(trackRowContextMenu.trackId) ?? -1
      : -1;
  const contextMenuIsQueueSource = trackRowContextMenu?.source === "queue";

  const selectedTrackAnalysis = selectedTrackDetail ? toQcAnalysis(selectedTrackDetail) : null;

  const rootScanJobs = useMemo(
    () => Object.values(activeScanJobs).sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [activeScanJobs]
  );
  const activeRootScanJobs = useMemo(
    () => rootScanJobs.filter((job) => !["COMPLETED", "FAILED"].includes(job.status)),
    [rootScanJobs]
  );
  const libraryIngestStatusItems = useMemo(() => {
    const items: string[] = [];
    if (catalogImporting) items.push("Import in progress");
    if (activeRootScanJobs.length > 0) {
      const total = activeRootScanJobs.reduce((sum, job) => sum + job.total_items, 0);
      const processed = activeRootScanJobs.reduce((sum, job) => sum + job.processed_items, 0);
      items.push(
        total > 0
          ? `Scanning ${activeRootScanJobs.length} folder(s): ${processed}/${total}`
          : `Scanning ${activeRootScanJobs.length} folder(s)`
      );
    }
    return items;
  }, [activeRootScanJobs, catalogImporting]);

  const showNotice = (notice: AppNotice) => {
    setAppNotice(notice);
  };

  const noteListenQueueAction = (message: string) => {
    setListenQueueFeedback(message);
  };

  const notePublishSelectionAction = (message: string) => {
    setPublishSelectionFeedback(message);
  };

  const {
    playerTrackId,
    setPlayerTrackId,
    setPlayerExternalSource,
    setAutoplayRequestSourceKey,
    playerTimeSec,
    setPlayerTimeSec,
    playerIsPlaying,
    setPlayerIsPlaying,
    playerError,
    setPlayerError,
    playerAudioRef,
    playerSource,
    playerAudioSrc,
    queueIndex,
    seekPlayer,
    publisherOpsSharedTransportBridge
  } = usePlayerTransportState({
    queue,
    selectedTrackDetail,
    trackDetailsById,
    onNotice: showNotice
  });

  const {
    trackEditor,
    trackEditorDirty,
    trackEditorSaving,
    trackEditorError,
    trackEditorNotice,
    trackEditorTagsPreview,
    canSaveTrackMetadata,
    canResetTrackMetadata,
    handleSaveTrackMetadata,
    patchTrackEditor,
    resetTrackEditorFromSelectedDetail,
    clearTrackEditorMessages
  } = useTrackMetadataEditorState({
    selectedTrackDetail,
    setSelectedTrackDetail,
    setTrackDetailsById,
    setCatalogPage,
    setTrackDetailEditMode,
    mapUiError: normalizeUiError
  });

  const {
    addTrackToPublishSelection,
    removePublishSelectionItem,
    clearPublishSelection,
    applyPublishSelectionItem
  } = usePublishSelectionState({
    setPublishSelectionItems,
    setPublisherDraftPrefill,
    onResetPublishStep: () => setPublishShellStep("New Release"),
    onSwitchToPublishMode: () => {
      setActiveMode("Publish");
      setPublisherOpsBooted(true);
      setActiveWorkspace("Publisher Ops");
    },
    onPublishFeedback: notePublishSelectionAction,
    onNotice: showNotice
  });

  const { publisherBridgeLoadingTrackId, handleOpenInPublisherOps } = usePublisherBridgeActions({
    setCatalogError,
    setPublisherDraftPrefill: (draft) => setPublisherDraftPrefill(draft),
    addTrackToPublishSelection,
    onNotice: showNotice,
    switchAppMode,
    mapUiError: normalizeUiError
  });

  const topNotifications = useTopNotifications({
    activeMode,
    appNotice,
    catalogError,
    playerError,
    listenQueueFeedback,
    publishSelectionFeedback,
    clearCatalogError: () => setCatalogError(null),
    clearPlayerError: () => setPlayerError(null),
    clearAppNotice: () => setAppNotice(null),
    clearListenQueueFeedback: () => setListenQueueFeedback(null),
    clearPublishSelectionFeedback: () => setPublishSelectionFeedback(null)
  });

  useWorkspacePersistence({
    storageKeys: STORAGE_KEYS,
    activeMode,
    activeWorkspace,
    qualityControlMode,
    publishShellStep,
    libraryIngestTab,
    libraryIngestCollapsed,
    libraryOverviewCollapsed,
    libraryQuickActionsCollapsed,
    settingsPreferencesCollapsed,
    settingsSummaryCollapsed,
    themePreference,
    compactDensity,
    showFullPaths,
    trackSort,
    playListMode,
    showFavoritesOnly,
    favoriteTrackIds,
    sessionQueueTrackIds,
    publishSelectionItems
  });

  useWorkspaceUiEffects({
    appNotice,
    setAppNotice,
    listenQueueFeedback,
    setListenQueueFeedback,
    publishSelectionFeedback,
    setPublishSelectionFeedback,
    playerError,
    setPlayerError,
    themePreference,
    albumGroups,
    setSelectedAlbumKey,
    visibleTracksById,
    setSessionQueueTrackIds,
    setBatchSelectedTrackIds,
    setTrackRowContextMenu
  });

  useEffect(() => {
    void refreshLibraryRootsAction();
  }, []);

  usePlayerTrackDetailPrefetch({
    playerTrackId,
    selectedTrackDetail,
    trackDetailsById,
    setTrackDetailsById
  });

  useIngestJobPolling({
    activeScanJobs,
    setActiveScanJobs,
    onAnyJobCompleted: () => {
      void loadCatalogTracks(trackSearch);
    }
  });

  const {
    setSessionQueueFromTrackIds,
    appendTracksToSessionQueue,
    enqueueTracksNext,
    enqueueTrackNext,
    moveTrackInQueue,
    reorderQueueByDrop,
    removeTrackFromSessionQueue,
    clearSessionQueue,
    shuffleSessionQueue
  } = useQueueState({
    queue,
    queueIndex,
    queueIndexByTrackId,
    sessionQueueTrackIds,
    setSessionQueueTrackIds,
    visibleTracksById,
    onQueueFeedback: noteListenQueueAction,
    onNotice: showNotice
  });

  const {
    setPlayerTrackFromQueueIndex,
    toggleTrackBatchSelection,
    clearBatchSelection,
    clearAlbumBatchSelection,
    playTrackNow,
    playBatchSelectionNow,
    armTrackFromPlayList,
    runTrackContextMenuAction,
    toggleFavoriteTrack,
    playAlbumGroup
  } = usePlayListActions({
    queue,
    visibleTracksById,
    orderedBatchSelectionIds,
    selectedAlbumBatchTrackIds,
    contextMenuTrack,
    hasOpenTrackRowContextMenu: Boolean(trackRowContextMenu),
    closeTrackRowContextMenu: () => setTrackRowContextMenu(null),
    setSessionQueueTrackIds,
    setSessionQueueFromTrackIds,
    appendTracksToSessionQueue,
    enqueueTrackNext,
    moveTrackInQueue,
    removeTrackFromSessionQueue,
    setPlayerExternalSource,
    setPlayerTrackId,
    setSelectedTrackId,
    setPlayerError,
    setAutoplayRequestSourceKey,
    setPlayerTimeSec,
    setActiveWorkspace,
    setQualityControlMode,
    setPlayListMode,
    setBatchSelectedTrackIds,
    setFavoriteTrackIds,
    onQueueFeedback: noteListenQueueAction,
    onNotice: showNotice
  });

  const {
    refreshLibraryRoots: refreshLibraryRootsAction,
    handleImport: handleImportAction,
    handleAddLibraryRoot: handleAddLibraryRootAction,
    handleBrowseLibraryRoot: handleBrowseLibraryRootAction,
    handleRemoveLibraryRoot: handleRemoveLibraryRootAction,
    handleScanLibraryRoot: handleScanLibraryRootAction
  } = useLibraryIngestActions({
    importPathsInput,
    setImportPathsInput,
    libraryRootPathInput,
    setLibraryRootPathInput,
    trackSearch,
    libraryRootBrowsing,
    normalizePathForInput,
    onReloadCatalog: loadCatalogTracks,
    mapUiError: normalizeUiError,
    onNotice: showNotice,
    setCatalogError,
    setCatalogImporting,
    setCatalogFailures,
    setSelectedTrackId,
    setLibraryRoots,
    setLibraryRootsLoading,
    setLibraryRootMutating,
    setLibraryRootBrowsing,
    setActiveScanJobs
  });
  const { togglePlay } = usePlayerShellSync({
    shellState,
    playerTrackId,
    selectedTrackDetail,
    setPlayerTrackId,
    setPlayerTimeSec,
    playerIsPlaying,
    setPlayerIsPlaying,
    playerSource,
    queue,
    setPlayerTrackFromQueueIndex,
    playerAudioRef,
    setPlayerError,
    onNotice: showNotice
  });

  const openTracksWorkspace = () => {
    setQualityControlMode("track");
    setActiveWorkspace("Quality Control");
  };
  const openAlbumsWorkspace = () => {
    setQualityControlMode("album");
    setActiveWorkspace("Quality Control");
  };
  const openLibraryWorkspace = () => setActiveWorkspace("Library");
  const openWorkspace = (workspace: Workspace) => setActiveWorkspace(workspace);
  const showPublishMode = () => switchAppMode("Publish");
  const toggleLibraryIngestCollapsed = () => setLibraryIngestCollapsed((value) => !value);
  const toggleLibraryOverviewCollapsed = () => setLibraryOverviewCollapsed((value) => !value);
  const toggleLibraryQuickActionsCollapsed = () => setLibraryQuickActionsCollapsed((value) => !value);
  const handleBrowseLibraryRoot = () => void handleBrowseLibraryRootAction();
  const handleAddLibraryRoot = () => void handleAddLibraryRootAction();
  const handleRefreshLibraryRoots = () => void refreshLibraryRootsAction();
  const handleScanLibraryRoot = (rootId: string) => void handleScanLibraryRootAction(rootId);
  const handleRemoveLibraryRoot = (rootId: string) => void handleRemoveLibraryRootAction(rootId);
  const handleImportFiles = () => void handleImportAction();
  const handleTrackSortChange = (value: string) => setTrackSort(value as TrackSortKey);
  const handleSaveMetadata = () => void handleSaveTrackMetadata();
  const handleOpenPublisherOps = (track: CatalogTrackDetailResponse) => void handleOpenInPublisherOps(track);
  const handleQcPlay = () => setPlayerIsPlaying(true);
  const handleQcPause = () => setPlayerIsPlaying(false);
  const handlePublishShellStepChange = (step: PublisherOpsScreen) => setPublishShellStep(step);
  const toggleShowFavoritesOnly = () => setShowFavoritesOnly((current) => !current);
  const handleRefreshTracks = () => void loadCatalogTracks(trackSearch);
  const handleQueueDragEnd = () => setQueueDragTrackId(null);
  const handleAddTrackToQueue = (trackId: string) => appendTracksToSessionQueue([trackId]);
  const handleEnterTrackEditMode = () => {
    setTrackDetailEditMode(true);
    clearTrackEditorMessages();
  };
  const handleCancelTrackEditMode = () => {
    resetTrackEditorFromSelectedDetail();
    setTrackDetailEditMode(false);
  };
  const handleQcTogglePlay = () => {
    if (!selectedTrackDetail) return;
    if (playerTrackId !== selectedTrackDetail.track_id) {
      setPlayerTrackId(selectedTrackDetail.track_id);
      setPlayerTimeSec(0);
    }
    togglePlay();
  };
  const handleQcSeek = (ratio: number) => {
    if (!selectedTrackDetail) return;
    if (playerTrackId !== selectedTrackDetail.track_id) {
      setPlayerTrackId(selectedTrackDetail.track_id);
    }
    seekPlayer(ratio);
  };
  const handleShowFirstAlbumTrackInTracks = (group: AlbumGroup) => {
    if (group.trackIds[0]) {
      setSelectedTrackId(group.trackIds[0]);
      setQualityControlMode("track");
      setActiveWorkspace("Quality Control");
    }
  };
  const handleShowTrackInTracks = (trackId: string) => {
    setSelectedTrackId(trackId);
    setQualityControlMode("track");
    setActiveWorkspace("Quality Control");
  };
  const toggleSettingsPreferencesCollapsed = () => setSettingsPreferencesCollapsed((value) => !value);
  const toggleSettingsSummaryCollapsed = () => setSettingsSummaryCollapsed((value) => !value);
  const clearNotice = () => setAppNotice(null);
  const clearErrorBanner = () => setCatalogError(null);
  const handlePlayerPrev = () => setPlayerTrackFromQueueIndex(Math.max(0, queueIndex - 1));
  const handlePlayerNext = () => setPlayerTrackFromQueueIndex(Math.min(queue.length - 1, queueIndex + 1));
  const handlePlayerAudioTimeUpdate = () => setPlayerTimeSec(playerAudioRef.current?.currentTime ?? 0);
  const handlePlayerAudioPlay = () => {
    setPlayerIsPlaying(true);
    setPlayerError(null);
  };
  const handlePlayerAudioPause = () => setPlayerIsPlaying(false);
  const handlePlayerAudioEnded = () => {
    setPlayerIsPlaying(false);
    if (queueIndex >= 0 && queueIndex < queue.length - 1) {
      setPlayerTrackFromQueueIndex(queueIndex + 1);
    } else {
      setPlayerTimeSec(0);
    }
  };
  const closeTrackRowContextMenu = () => setTrackRowContextMenu(null);
  const showListenMode = () => {
    switchAppMode("Listen");
    setQualityControlMode("track");
    setActiveWorkspace("Quality Control");
  };
  const playListPanelProps = {
    trackSearch,
    onTrackSearchChange: setTrackSearch,
    trackSort,
    trackSortOptions,
    onTrackSortChange: handleTrackSortChange,
    onRefreshList: handleRefreshTracks,
    catalogLoading,
    isQueueMode,
    onSetMode: setPlayListMode,
    queueUsesSessionOrder,
    queueLength: queue.length,
    onShuffleQueue: shuffleSessionQueue,
    onClearQueue: clearSessionQueue,
    showFavoritesOnly,
    onToggleFavoritesOnly: toggleShowFavoritesOnly,
    onOpenAlbumsView: openAlbumsWorkspace,
    orderedBatchSelectionIds,
    onPlaySelectionNow: playBatchSelectionNow,
    onAddSelectionToQueue: appendTracksToSessionQueue,
    onPlaySelectionNext: enqueueTracksNext,
    onClearBatchSelection: clearBatchSelection,
    activePlayListItems,
    catalogItemsCount: catalogPage.items.length,
    selectedTrackId,
    batchSelectedTrackIdSet,
    onToggleTrackBatchSelection: toggleTrackBatchSelection,
    onArmTrackFromPlayList: armTrackFromPlayList,
    onPlayTrackNow: playTrackNow,
    favoriteTrackIdSet,
    contextMenuTrackId: trackRowContextMenu?.trackId ?? null,
    onTrackRowContextMenu: handleTrackRowContextMenu,
    onTrackRowMenuButtonClick: handleTrackRowMenuButtonClick,
    queueDragTrackId,
    onQueueDragStart: setQueueDragTrackId,
    onQueueReorderDrop: reorderQueueByDrop,
    onQueueDragEnd: handleQueueDragEnd
  };

  return (
    <div
      className={`music-shell${compactDensity ? " compact" : ""}${activeMode === "Publish" ? " with-right-dock" : ""}`}
      data-layout-tier={shellState?.layout.geometry.tier ?? "standard"}
      data-refresh-tick={shellState?.refreshTick ?? 0}
    >
      <aside className="music-sidebar">
        <div className="music-brand">
          <p className="eyebrow">Skald QC</p>
          <h1>Skald QC</h1>
          <p className="music-brand-subtitle">Codec Preview, QC &amp; Multi-Platform Publishing</p>
        </div>

        <nav aria-label="Workspaces" className="workspace-nav">
          {[...modeWorkspaces, ...globalWorkspaces].map((workspace) => (
            <HelpTooltip
              key={workspace}
              content={
                workspace === "Publisher Ops"
                  ? "Deterministic release pipeline (New Release -> Plan / Preview -> Execute -> Report / History)."
                  : `Open the ${workspace} workspace.`
              }
              side="bottom"
            >
              <button
                type="button"
                className={`workspace-nav-item${activeWorkspace === workspace ? " active" : ""}`}
                onClick={() => openWorkspace(workspace)}
              >
                {workspace}
              </button>
            </HelpTooltip>
          ))}
        </nav>

        <LibraryIngestSidebar
          visible={showLibraryIngestSidebar}
          libraryIngestCollapsed={libraryIngestCollapsed}
          onToggleCollapsed={toggleLibraryIngestCollapsed}
          libraryIngestTab={libraryIngestTab}
          tabs={libraryIngestTabs}
          onSelectTab={setLibraryIngestTab}
          statusItems={libraryIngestStatusItems}
          libraryRootPathInput={libraryRootPathInput}
          onChangeLibraryRootPathInput={setLibraryRootPathInput}
          onBrowseLibraryRoot={handleBrowseLibraryRoot}
          libraryRootMutating={libraryRootMutating}
          libraryRootBrowsing={libraryRootBrowsing}
          onAddLibraryRoot={handleAddLibraryRoot}
          onRefreshLibraryRoots={handleRefreshLibraryRoots}
          libraryRootsLoading={libraryRootsLoading}
          libraryRoots={libraryRoots}
          rootScanJobs={rootScanJobs}
          showFullPaths={showFullPaths}
          formatDisplayPath={formatDisplayPath}
          onScanLibraryRoot={handleScanLibraryRoot}
          onRemoveLibraryRoot={handleRemoveLibraryRoot}
          importPathsInput={importPathsInput}
          onChangeImportPathsInput={setImportPathsInput}
          onImportFiles={handleImportFiles}
          catalogImporting={catalogImporting}
          catalogFailures={catalogFailures}
        />
      </aside>

      <div className="music-main">
        <MusicTopbar
          activeMode={activeMode}
          activeWorkspace={activeWorkspace}
          appModes={appModes}
          onSwitchAppMode={switchAppMode}
          tracksCount={catalogPage.total}
          albumGroupsCount={albumGroups.length}
          favoritesCount={favoriteTrackCount}
          queueCount={queue.length}
          importErrorsCount={catalogFailures.length}
          onOpenTracksWorkspace={openTracksWorkspace}
          onOpenAlbumsWorkspace={openAlbumsWorkspace}
          onOpenLibraryWorkspace={openLibraryWorkspace}
        />

        {topNotifications.length > 0 ? (
          <div className="notification-stack-top" aria-label="Notifications">
            {topNotifications.map((notification) => (
              <div
                key={notification.id}
                className={`app-notification ${notification.level}`}
                role={notification.level === "warning" || notification.level === "error" ? "alert" : "status"}
                aria-live={notification.level === "warning" || notification.level === "error" ? "assertive" : "polite"}
              >
                <div className="app-notification-main">
                  <strong className="app-notification-label">{notification.label}</strong>
                  <span>{notification.message}</span>
                </div>
                <button
                  type="button"
                  className="app-notification-dismiss"
                  onClick={notification.dismiss}
                  aria-label={`Dismiss ${notification.label} notification`}
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <main className="workspace-content">
          <PublishStepShell
            activeMode={activeMode}
            publishShellStep={publishShellStep}
            publishWorkflowSteps={publishWorkflowSteps}
            onPublishShellStepChange={handlePublishShellStepChange}
          />

          <LibraryHomeSection
            hidden={activeMode !== "Listen" || activeWorkspace !== "Library"}
            libraryOverviewCollapsed={libraryOverviewCollapsed}
            onToggleLibraryOverviewCollapsed={toggleLibraryOverviewCollapsed}
            tracksCount={catalogPage.total}
            queueCount={queue.length}
            albumGroupsCount={albumGroups.length}
            favoritesCount={favoriteTrackCount}
            libraryQuickActionsCollapsed={libraryQuickActionsCollapsed}
            onToggleLibraryQuickActionsCollapsed={toggleLibraryQuickActionsCollapsed}
            onOpenTracksWorkspace={openTracksWorkspace}
            onOpenAlbumsWorkspace={openAlbumsWorkspace}
            onShowPublishMode={showPublishMode}
          />

          <section hidden={activeMode !== "Listen" || activeWorkspace !== "Quality Control"} className="workspace-section qc-intent-shell">
            <div className="qc-intent-head">
              <p className="eyebrow">Quality Control</p>
              <h3>Choose QC Intent</h3>
              <p className="helper-text">
                Track QC validates single-file absolute checks. Album QC validates cross-track sequence and relative consistency.
              </p>
            </div>
            <div className="qc-intent-toggle" role="tablist" aria-label="Quality Control intent">
              <button
                type="button"
                role="tab"
                aria-selected={qualityControlMode === "track"}
                className={`qc-intent-tab${qualityControlMode === "track" ? " active" : ""}`}
                onClick={() => setQualityControlMode("track")}
              >
                Track QC
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={qualityControlMode === "album"}
                className={`qc-intent-tab${qualityControlMode === "album" ? " active" : ""}`}
                onClick={() => setQualityControlMode("album")}
              >
                Album QC
              </button>
            </div>
          </section>

          <section
            hidden={activeMode !== "Listen" || activeWorkspace !== "Quality Control" || qualityControlMode !== "track"}
            className="workspace-section tracks-layout"
          >
            <PlayListPanel {...playListPanelProps} />

            <TrackDetailPanel
              selectedTrackLoading={selectedTrackLoading}
              selectedTrackDetail={selectedTrackDetail}
              selectedTrackAnalysis={selectedTrackAnalysis}
              trackDetailEditMode={trackDetailEditMode}
              trackEditorDirty={trackEditorDirty}
              isSelectedTrackFavorite={isSelectedTrackFavorite}
              onPlayNow={playTrackNow}
              onAddToQueue={handleAddTrackToQueue}
              onPlayNext={enqueueTrackNext}
              onToggleFavorite={toggleFavoriteTrack}
              onEnterEditMode={handleEnterTrackEditMode}
              onSaveMetadata={handleSaveMetadata}
              canSaveTrackMetadata={canSaveTrackMetadata}
              trackEditorSaving={trackEditorSaving}
              canResetTrackMetadata={canResetTrackMetadata}
              onResetFields={resetTrackEditorFromSelectedDetail}
              onCancelEdit={handleCancelTrackEditMode}
              onOpenPublisherOps={handleOpenPublisherOps}
              publisherBridgeLoadingTrackId={publisherBridgeLoadingTrackId}
              showFullPaths={showFullPaths}
              formatDisplayPath={formatDisplayPath}
              trackEditor={trackEditor}
              onPatchTrackEditor={patchTrackEditor}
              trackVisibilityOptions={trackVisibilityOptions}
              trackLicenseOptions={trackLicenseOptions}
              trackEditorTagsPreviewCount={trackEditorTagsPreview.length}
              trackEditorError={trackEditorError}
              trackEditorNotice={trackEditorNotice}
              qcCurrentTimeSec={playerTrackId === selectedTrackDetail?.track_id ? playerTimeSec : 0}
              qcIsPlaying={playerTrackId === selectedTrackDetail?.track_id ? playerIsPlaying : false}
              onQcTogglePlay={handleQcTogglePlay}
              onQcSeek={handleQcSeek}
              onQcTimeUpdate={setPlayerTimeSec}
              onQcPlay={handleQcPlay}
              onQcPause={handleQcPause}
              playerAudioRef={playerAudioRef}
              playerAudioSrc={playerAudioSrc}
            />

          </section>

          <AlbumsPanel
            hidden={activeMode !== "Listen" || activeWorkspace !== "Quality Control" || qualityControlMode !== "album"}
            albumGroups={albumGroups}
            selectedAlbumGroup={selectedAlbumGroup}
            onSelectAlbumGroup={setSelectedAlbumKey}
            formatClock={formatClock}
            onPlayAlbumGroup={playAlbumGroup}
            onAddAlbumToQueue={appendTracksToSessionQueue}
            onShowFirstAlbumTrackInTracks={handleShowFirstAlbumTrackInTracks}
            selectedAlbumTracks={selectedAlbumTracks}
            favoriteTrackIdSet={favoriteTrackIdSet}
            selectedAlbumBatchTrackIds={selectedAlbumBatchTrackIds}
            onAddSelectionToQueue={appendTracksToSessionQueue}
            onPlaySelectionNext={enqueueTracksNext}
            onClearAlbumBatchSelection={clearAlbumBatchSelection}
            onAlbumTrackContextMenu={handleAlbumTrackRowContextMenu}
            batchSelectedTrackIdSet={batchSelectedTrackIdSet}
            onToggleTrackBatchSelection={toggleTrackBatchSelection}
            onShowTrackInTracks={handleShowTrackInTracks}
            trackRowContextMenuTrackId={trackRowContextMenu?.trackId ?? null}
            trackRowContextMenuSource={trackRowContextMenu?.source ?? null}
            onAlbumTrackRowMenuButtonClick={handleAlbumTrackRowMenuButtonClick}
          />

          <section hidden={activeMode !== "Listen" || activeWorkspace !== "Playlists"} className="workspace-section">
            <PlayListPanel {...playListPanelProps} />
          </section>

          <SettingsPanel
            hidden={activeWorkspace !== "Settings"}
            settingsPreferencesCollapsed={settingsPreferencesCollapsed}
            onToggleSettingsPreferencesCollapsed={toggleSettingsPreferencesCollapsed}
            themePreference={themePreference}
            onThemePreferenceChange={setThemePreference}
            compactDensity={compactDensity}
            onCompactDensityChange={setCompactDensity}
            showFullPaths={showFullPaths}
            onShowFullPathsChange={setShowFullPaths}
            onClearNotice={clearNotice}
            onClearErrorBanner={clearErrorBanner}
            settingsSummaryCollapsed={settingsSummaryCollapsed}
            onToggleSettingsSummaryCollapsed={toggleSettingsSummaryCollapsed}
            summary={{
              tracksCount: catalogPage.total,
              albumGroupsCount: albumGroups.length,
              favoritesCount: favoriteTrackCount,
              queueCount: queue.length,
              releaseSelectionsCount: publishSelectionCount,
              importFailuresCount: catalogFailures.length,
              libraryRootsCount: libraryRoots.length
            }}
          />

          <section hidden={activeWorkspace !== "About"} className="workspace-section placeholder-workspace">
            <h3>About</h3>
          </section>

          {publisherOpsBooted || activeWorkspace === "Publisher Ops" ? (
            <section hidden={activeMode !== "Publish" || activeWorkspace !== "Publisher Ops"} className="workspace-section publisher-ops-host">
              <PublisherOpsWorkspace
                prefillMediaPath={publisherDraftPrefill?.media_path ?? null}
                prefillSpecPath={publisherDraftPrefill?.spec_path ?? null}
                sharedTransport={publisherOpsSharedTransportBridge}
                externalRequestedScreen={publishShellStep}
                onScreenChange={handlePublishShellStepChange}
                showInternalWorkflowTabs={false}
              />
            </section>
          ) : null}
        </main>

        {activeMode === "Listen" ? (
          <SharedPlayerBar
            playerSource={playerSource}
            playerIsPlaying={playerIsPlaying}
            playerTimeSec={playerTimeSec}
            queueIndex={queueIndex}
            queueLength={queue.length}
            onPrev={handlePlayerPrev}
            onTogglePlay={togglePlay}
            onNext={handlePlayerNext}
            onSeekRatio={seekPlayer}
            formatClock={formatClock}
            audioRef={playerAudioRef}
            audioSrc={playerAudioSrc}
            onAudioTimeUpdate={handlePlayerAudioTimeUpdate}
            onAudioPlay={handlePlayerAudioPlay}
            onAudioPause={handlePlayerAudioPause}
            onAudioEnded={handlePlayerAudioEnded}
          />
        ) : null}
      </div>

      <PublishSelectionDock
        visible={activeMode === "Publish"}
        publishSelectionItems={publishSelectionItems}
        activeDraftTrackId={publisherDraftPrefill?.source_track_id ?? null}
        onClearSelection={clearPublishSelection}
        onShowInTracks={showListenMode}
        onApplySelectionItem={applyPublishSelectionItem}
        onRemoveSelectionItem={removePublishSelectionItem}
      />

      <TrackRowContextMenu
        visible={Boolean(trackRowContextMenu && contextMenuTrack)}
        trackTitle={contextMenuTrack?.title ?? ""}
        x={trackRowContextMenu?.x ?? 0}
        y={trackRowContextMenu?.y ?? 0}
        isFavorite={Boolean(contextMenuTrack && favoriteTrackIdSet.has(contextMenuTrack.track_id))}
        isBatchSelected={Boolean(contextMenuTrack && batchSelectedTrackIdSet.has(contextMenuTrack.track_id))}
        isQueueSource={contextMenuIsQueueSource}
        queueIndex={contextMenuQueueIndex}
        queueLength={queue.length}
        onClose={closeTrackRowContextMenu}
        onAction={runTrackContextMenuAction}
      />
    </div>
  );
}






