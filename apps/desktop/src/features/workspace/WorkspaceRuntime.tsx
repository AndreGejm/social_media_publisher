import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { readStorage } from "../../app/state/localStorage";
import {
  PublisherOpsWorkspace,
  type PublisherOpsScreen,
  usePublisherBridgeActions
} from "../../features/publisher-ops";
import {
  LibraryIngestSidebar,
  useDroppedIngestAutoplayController,
  useLibraryIngestActions
} from "../../features/library-ingest";
import {
  PlayListPanel,
  useCatalogSelectionState,
  usePlayListActions,
  buildAlbumGroups,
  rankCatalogTracksBySearch,
  type AlbumGroup,
  type TrackGroupMode,
  type TrackSortKey
} from "../../features/play-list";
import {
  TrackDetailPanel,
  useTrackMetadataEditorState
} from "../../features/track-detail";
import { AlbumsPanel } from "../../features/albums";
import { SettingsPanel } from "../../features/settings";
import {
  PublishSelectionDock,
  usePublishSelectionState,
  type PublishSelectionItem
} from "../../features/publish-selection";
import {
  SharedPlayerBar,
  useQcPreviewLifecycle,
  useQueueState,
  usePlayerTrackDetailPrefetch,
  usePlayerShellSync,
  volumePercentToScalar
} from "../../features/player";
import {
  TrackRowContextMenu,
  useTrackRowContextMenuState
} from "../../features/context-menu";
import { usePlayerTransportController } from "../../features/player-transport/api";
import { useAudioOutputController } from "../../features/audio-output/api";
import { VideoWorkspaceFeature } from "../../features/video-workspace/api";
import { useWorkspaceModeState } from "./hooks/useWorkspaceModeState";
import { useWorkspacePersistence } from "./hooks/useWorkspacePersistence";
import { useWorkspaceUiEffects } from "./hooks/useWorkspaceUiEffects";
import {
  formatClock,
  formatDisplayPath,
  isEditableShortcutTarget,
  normalizePathForInput,
  normalizeWorkspaceUiError,
  toWorkspaceQcAnalysis
} from "./model/workspaceRuntimeUtils";
import LibraryHomeSection from "./components/LibraryHomeSection";
import MusicTopbar from "./components/MusicTopbar";
import PublishStepShell from "./components/PublishStepShell";
import { useTopNotifications } from "../../shared/hooks/useTopNotifications";
import { HelpTooltip } from "../../shared/ui/HelpTooltip";
import {
  type CatalogIngestJobResponse,
  type CatalogImportFailure,
  type CatalogListTracksResponse,
  type CatalogTrackDetailResponse,
  type LibraryRootResponse,
  type PublisherCreateDraftFromTrackResponse,
  type UiAppError
} from "../../services/tauri/tauriClient";
import { useTauriClient } from "../../services/tauri/TauriClientProvider";
import {
  DEFAULT_SHORTCUT_BINDINGS,
  findShortcutBindingConflicts,
  keyboardEventToShortcutBinding,
  sanitizeShortcutBindings,
  type ShortcutActionId,
  type ShortcutBindings
} from "../../shared/input/shortcuts";
import {
  getDefaultThemeVariantForMode,
  getThemeVariantMode,
  isThemePreference,
  isThemeVariantId,
  type ThemePreference,
  type ThemeVariantId
} from "../../shared/theme/themeVariants";

type Workspace = "Library" | "Quality Control" | "Playlists" | "Video Workspace" | "Publisher Ops" | "Settings" | "About";
type AppMode = "Listen" | "Publish";
type LibraryIngestTab = "scan_folders" | "import_files";
type PlayListMode = "library" | "queue";
type QualityControlMode = "track" | "album";

const workspaces: Workspace[] = ["Library", "Quality Control", "Playlists", "Video Workspace", "Publisher Ops", "Settings", "About"];
const listenModeWorkspaces: Workspace[] = ["Library", "Quality Control", "Playlists", "Video Workspace"];
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
  { value: "album_asc", label: "Album (A-Z)" },
  { value: "duration_desc", label: "Duration (Longest)" },
  { value: "loudness_desc", label: "Loudness (Highest)" }
];
const trackGroupOptions: Array<{ value: TrackGroupMode; label: string }> = [
  { value: "none", label: "No Grouping" },
  { value: "artist", label: "Group by Artist" },
  { value: "album", label: "Group by Album" }
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
  themeVariantPreference: "rp.music.themeVariantPreference.v1",
  compactDensity: "rp.music.compactDensity.v1",
  showFullPaths: "rp.music.showFullPaths.v1",
  shortcutBindings: "rp.music.shortcutBindings.v1",
  playListMode: "rp.music.playListMode.v1",
  trackGroupMode: "rp.music.trackGroupMode.v1",
  dropAddParentFoldersAsRootsOnDrop: "rp.music.dropParentRootsOnDrop.v1"
} as const;

type AppNotice = { level: "info" | "success" | "warning"; message: string };



function isWorkspace(value: unknown): value is Workspace {
  return typeof value === "string" && (workspaces as readonly string[]).includes(value);
}

function isAppMode(value: unknown): value is AppMode {
  return value === "Listen" || value === "Publish";
}

function isTrackSortKey(value: unknown): value is TrackSortKey {
  return typeof value === "string" && trackSortOptions.some((option) => option.value === value);
}

function isTrackGroupMode(value: unknown): value is TrackGroupMode {
  return value === "none" || value === "artist" || value === "album";
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

function isPublisherOpsScreen(value: unknown): value is PublisherOpsScreen {
  return typeof value === "string" && publishWorkflowSteps.includes(value as PublisherOpsScreen);
}




export type WorkspaceShellFrame = {
  layoutTier: string;
  refreshTick: number;
  eventBus: {
    emit: (event: "PLAYBACK_CHANGED", payload: { trackId: string | null; isPlaying: boolean }) => void;
  };
};

type WorkspaceRuntimeProps = {
  shellFrame?: WorkspaceShellFrame | null;
};

export default function WorkspaceRuntime(props: WorkspaceRuntimeProps) {
  const tauriClient = useTauriClient();
  const tauriClientRef = useRef(tauriClient);
  useEffect(() => {
    tauriClientRef.current = tauriClient;
  }, [tauriClient]);

  const shellFrame = props.shellFrame ?? null;
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
  const [themeVariantPreference, setThemeVariantPreference] = useState<ThemeVariantId>(() =>
    readStorage<ThemeVariantId>(
      STORAGE_KEYS.themeVariantPreference,
      getDefaultThemeVariantForMode("dark"),
      isThemeVariantId
    )
  );
  const [compactDensity, setCompactDensity] = useState<boolean>(() =>
    readStorage<boolean>(STORAGE_KEYS.compactDensity, false, (value): value is boolean => typeof value === "boolean")
  );
  const [showFullPaths, setShowFullPaths] = useState<boolean>(() =>
    readStorage<boolean>(STORAGE_KEYS.showFullPaths, false, (value): value is boolean => typeof value === "boolean")
  );
  const [shortcutBindings, setShortcutBindings] = useState<ShortcutBindings>(() => {
    const stored = readStorage<unknown>(STORAGE_KEYS.shortcutBindings, DEFAULT_SHORTCUT_BINDINGS);
    return sanitizeShortcutBindings(stored);
  });
  const [importPathsInput, setImportPathsInput] = useState("");
  const [libraryRootPathInput, setLibraryRootPathInput] = useState("");
  const [trackSearch, setTrackSearch] = useState("");
  const deferredTrackSearch = useDeferredValue(trackSearch);
  const [trackSort, setTrackSort] = useState<TrackSortKey>(() =>
    readStorage<TrackSortKey>(STORAGE_KEYS.trackSort, "updated_desc", isTrackSortKey)
  );
  const [trackGroupMode, setTrackGroupMode] = useState<TrackGroupMode>(() =>
    readStorage<TrackGroupMode>(STORAGE_KEYS.trackGroupMode, "none", isTrackGroupMode)
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
  const [dropAddParentFoldersAsRootsOnDrop, setDropAddParentFoldersAsRootsOnDrop] = useState<boolean>(() =>
    readStorage<boolean>(
      STORAGE_KEYS.dropAddParentFoldersAsRootsOnDrop,
      true,
      (value): value is boolean => typeof value === "boolean"
    )
  );
  useEffect(() => {
    if (themePreference === "system") return;
    if (getThemeVariantMode(themeVariantPreference) === themePreference) return;
    setThemeVariantPreference(getDefaultThemeVariantForMode(themePreference));
  }, [themePreference, themeVariantPreference]);

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
  const [resetLibraryDataPending, setResetLibraryDataPending] = useState(false);
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
    catalogLoadingMore,
    hasMoreCatalogItems,
    selectedTrackId,
    setSelectedTrackId,
    selectedTrackDetail,
    setSelectedTrackDetail,
    trackDetailsById,
    setTrackDetailsById,
    selectedTrackLoading,
    loadCatalogTracks,
    loadMoreCatalogTracks
  } = useCatalogSelectionState({
    deferredTrackSearch,
    mapUiError: normalizeWorkspaceUiError,
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
    return rankCatalogTracksBySearch(filtered, deferredTrackSearch, trackSort, trackGroupMode);
  }, [catalogPage.items, deferredTrackSearch, favoriteTrackIdSet, showFavoritesOnly, trackSort, trackGroupMode]);
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

  const selectedTrackAnalysis = selectedTrackDetail ? toWorkspaceQcAnalysis(selectedTrackDetail) : null;

  const rootScanJobs = useMemo(
    () => Object.values(activeScanJobs).sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [activeScanJobs]
  );
  const activeRootScanJobs = useMemo(
    () => rootScanJobs.filter((job) => !["COMPLETED", "FAILED", "CANCELED"].includes(job.status)),
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

  const showNotice = useCallback((notice: AppNotice) => {
    setAppNotice(notice);
  }, []);

  const noteListenQueueAction = useCallback((message: string) => {
    setListenQueueFeedback(message);
  }, []);

  const notePublishSelectionAction = useCallback((message: string) => {
    setPublishSelectionFeedback(message);
  }, []);

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
    nativeTransportEnabled,
    nativeTransportChecked,
    latestPlaybackContext,
    audioOutputTransportHandshake,
    nowPlayingState,
    setNowPlayingVolumeScalar,
    setNowPlayingQueueVisible,
    toggleNowPlayingMute,
    playerAudioRef,
    playerSource,
    playerAudioSrc,
    queueIndex,
    ensureExternalPlayerSource,
    seekPlayer,
    setNativePlaybackPlaying,
    publisherOpsSharedTransportBridge
  } = usePlayerTransportController({
    queue,
    selectedTrackDetail,
    trackDetailsById,
    onNotice: showNotice
  });

  const audioOutputController = useAudioOutputController({
    transport: audioOutputTransportHandshake,
    nativeTransportEnabled,
    nativeTransportChecked,
    latestPlaybackContext,
    onNotice: showNotice
  });

  const setPlayListModeWithQueueSync = useCallback<typeof setPlayListMode>(
    (nextMode) => {
      setPlayListMode((currentMode) => {
        const resolvedMode = typeof nextMode === "function" ? nextMode(currentMode) : nextMode;
        void setNowPlayingQueueVisible(resolvedMode === "queue", { suppressError: true });
        return resolvedMode;
      });
    },
    [setNowPlayingQueueVisible]
  );

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
    mapUiError: normalizeWorkspaceUiError
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
    mapUiError: normalizeWorkspaceUiError
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
  const shortcutConflictActionIdSet = useMemo(
    () => findShortcutBindingConflicts(shortcutBindings),
    [shortcutBindings]
  );

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
    themeVariantPreference,
    compactDensity,
    showFullPaths,
    shortcutBindings,
    trackSort,
    trackGroupMode,
    playListMode,
    showFavoritesOnly,
    dropAddParentFoldersAsRootsOnDrop,
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
    themeVariantPreference,
    albumGroups,
    setSelectedAlbumKey,
    visibleTracksById,
    setSessionQueueTrackIds,
    setBatchSelectedTrackIds,
    setTrackRowContextMenu
  });

  useEffect(() => {
    void setNowPlayingQueueVisible(playListMode === "queue", { suppressError: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  usePlayerTrackDetailPrefetch({
    playerTrackId,
    selectedTrackDetail,
    trackDetailsById,
    setTrackDetailsById
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
    setPlayListMode: setPlayListModeWithQueueSync,
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
    handleScanLibraryRoot: handleScanLibraryRootAction,
    handleCancelIngestJob: handleCancelIngestJobAction,
    handleIngestDroppedPaths: handleIngestDroppedPathsAction
  } = useLibraryIngestActions({
    importPathsInput,
    setImportPathsInput,
    libraryRootPathInput,
    setLibraryRootPathInput,
    trackSearch,
    libraryRootBrowsing,
    addParentFoldersAsRootsOnDrop: dropAddParentFoldersAsRootsOnDrop,
    normalizePathForInput,
    onReloadCatalog: loadCatalogTracks,
    mapUiError: normalizeWorkspaceUiError,
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

  useEffect(() => {
    void refreshLibraryRootsAction();
  }, [refreshLibraryRootsAction]);

  const trackSearchInputRef = useRef<HTMLInputElement | null>(null);
  useDroppedIngestAutoplayController({
    activeScanJobs,
    setActiveScanJobs,
    loadCatalogTracks,
    trackSearch,
    setTrackSearch,
    setShowFavoritesOnly,
    setPlayListModeWithQueueSync,
    appendTracksToSessionQueue,
    playTrackNow,
    handleIngestDroppedPaths: handleIngestDroppedPathsAction,
    enabled: !(activeMode === "Listen" && activeWorkspace === "Video Workspace")
  });

  const { togglePlay, stopPlayer } = usePlayerShellSync({
    shellState: shellFrame ? { eventBus: shellFrame.eventBus } : null,
    playerTrackId,
    selectedTrackDetail,
    setPlayerTrackId,
    setPlayerTimeSec,
    playerIsPlaying,
    setPlayerIsPlaying,
    setNativePlaybackPlaying,
    playerSource,
    queue,
    setPlayerTrackFromQueueIndex,
    setPlayerError,
    seekPlayer,
    onNotice: showNotice
  });
  const {
    qcCodecProfiles,
    qcPreviewProfileAId,
    setQcPreviewProfileAId,
    qcPreviewProfileBId,
    setQcPreviewProfileBId,
    qcPreviewBlindXEnabled,
    setQcPreviewBlindXEnabled,
    qcPreviewSession,
    qcCodecPreviewLoading,
    qcBatchExportOutputDir,
    setQcBatchExportOutputDir,
    qcBatchExportTargetLufs,
    setQcBatchExportTargetLufs,
    qcBatchExportSelectedProfileIds,
    setQcBatchExportSelectedProfileIds,
    qcBatchExportSubmitting,
    qcBatchExportStatusMessage,
    qcCodecPreviewEnabled,
    qcBatchExportEnabled,
    handleSetPreviewVariant,
    handleRevealBlindX,
    handleStartBatchExport
  } = useQcPreviewLifecycle({
    selectedTrackId,
    selectedTrackDetail,
    playerIsPlaying,
    playerSource,
    setPlayerTrackId,
    setPlayerExternalSource,
    setPlayerTimeSec,
    setAutoplayRequestSourceKey,
    ensureExternalPlayerSource,
    setAppNotice,
    mapUiError: normalizeWorkspaceUiError,
    setCatalogError
  });

  const openTracksWorkspace = () => {
    setQualityControlMode("track");
    setActiveWorkspace("Quality Control");
  };
  const pruneStalePersistedTrackState = useCallback(async () => {
    const candidateTrackIds = [
      ...favoriteTrackIds,
      ...sessionQueueTrackIds,
      ...batchSelectedTrackIds,
      ...publishSelectionItems.map((item) => item.trackId),
      selectedTrackId,
      playerTrackId,
      queueDragTrackId ?? "",
      trackRowContextMenu?.trackId ?? ""
    ].filter((trackId): trackId is string => Boolean(trackId));

    if (candidateTrackIds.length === 0) return;

    const uniqueCandidateTrackIds = [...new Set(candidateTrackIds)];
    const existingTrackIdSet = new Set<string>();
    await Promise.all(
      uniqueCandidateTrackIds.map(async (trackId) => {
        try {
          const detail = await tauriClientRef.current.catalogGetTrack(trackId);
          if (detail) {
            existingTrackIdSet.add(trackId);
          }
        } catch {
          // Preserve existing state on transient command failures.
          existingTrackIdSet.add(trackId);
        }
      })
    );

    const favoriteTrackIdsPruned = favoriteTrackIds.filter((trackId) => existingTrackIdSet.has(trackId));
    const sessionQueueTrackIdsPruned = sessionQueueTrackIds.filter((trackId) => existingTrackIdSet.has(trackId));
    const batchSelectedTrackIdsPruned = batchSelectedTrackIds.filter((trackId) => existingTrackIdSet.has(trackId));
    const publishSelectionItemsPruned = publishSelectionItems.filter((item) => existingTrackIdSet.has(item.trackId));
    const selectedTrackStillExists = selectedTrackId ? existingTrackIdSet.has(selectedTrackId) : true;
    const playerTrackStillExists = playerTrackId ? existingTrackIdSet.has(playerTrackId) : true;

    setFavoriteTrackIds(favoriteTrackIdsPruned);
    setSessionQueueTrackIds(sessionQueueTrackIdsPruned);
    setBatchSelectedTrackIds(batchSelectedTrackIdsPruned);
    setPublishSelectionItems(publishSelectionItemsPruned);
    setTrackDetailsById((current) =>
      Object.fromEntries(Object.entries(current).filter(([trackId]) => existingTrackIdSet.has(trackId)))
    );

    if (!selectedTrackStillExists) {
      setSelectedTrackId("");
      setSelectedTrackDetail(null);
    }

    if (!playerTrackStillExists) {
      setPlayerTrackId("");
      setPlayerExternalSource(null);
      setPlayerTimeSec(0);
      setPlayerIsPlaying(false);
    }

    if (queueDragTrackId && !existingTrackIdSet.has(queueDragTrackId)) {
      setQueueDragTrackId(null);
    }

    setTrackRowContextMenu((current) =>
      current && !existingTrackIdSet.has(current.trackId) ? null : current
    );
  }, [
    batchSelectedTrackIds,
    setBatchSelectedTrackIds,
    setFavoriteTrackIds,
    setPlayerExternalSource,
    setPlayerIsPlaying,
    setPlayerTimeSec,
    setPlayerTrackId,
    setPublishSelectionItems,
    setQueueDragTrackId,
    setSelectedTrackDetail,
    setSelectedTrackId,
    setSessionQueueTrackIds,
    setTrackDetailsById,
    setTrackRowContextMenu,
    favoriteTrackIds,
    playerTrackId,
    publishSelectionItems,
    queueDragTrackId,
    selectedTrackId,
    sessionQueueTrackIds,
    trackRowContextMenu
  ]);
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
  const handleCancelIngestJob = (jobId: string) => void handleCancelIngestJobAction(jobId);
  const handleRemoveLibraryRoot = (rootId: string) => {
    void (async () => {
      const removed = await handleRemoveLibraryRootAction(rootId);
      if (!removed) return;
      await pruneStalePersistedTrackState();
    })();
  };
  const handleImportFiles = () => void handleImportAction();
  const handleTrackSortChange = (value: string) => setTrackSort(value as TrackSortKey);
  const handleTrackGroupModeChange = (value: TrackGroupMode) => setTrackGroupMode(value);
  const handleSaveMetadata = () => void handleSaveTrackMetadata();
  const handleOpenPublisherOps = (track: CatalogTrackDetailResponse) => void handleOpenInPublisherOps(track);
  const handleQcPlay = () => {
    void setNativePlaybackPlaying(true).catch(() => {
      setPlayerIsPlaying(false);
    });
  };
  const handleQcPause = () => {
    void setNativePlaybackPlaying(false).catch(() => {
      setPlayerIsPlaying(false);
    });
  };
  const handlePublishShellStepChange = (step: PublisherOpsScreen) => setPublishShellStep(step);
  const toggleShowFavoritesOnly = () => setShowFavoritesOnly((current) => !current);
  const handleRefreshTracks = () => void loadCatalogTracks(trackSearch);
  const handleLoadMoreCatalogItems = () => void loadMoreCatalogTracks();
  const handlePlayListModeChange = (mode: PlayListMode) => setPlayListModeWithQueueSync(mode);
  const handleSharedPlayerQueueToggle = useCallback(
    () => setPlayListModeWithQueueSync((currentMode) => (currentMode === "queue" ? "library" : "queue")),
    [setPlayListModeWithQueueSync]
  );
  const handleSharedPlayerVolumeChange = (value: number) =>
    setNowPlayingVolumeScalar(volumePercentToScalar(value));
  const handleSharedPlayerOutputModeChange = (mode: "shared" | "exclusive") => {
    audioOutputController.requestOutputMode(mode);
  };
  const handleShortcutBindingChange = (actionId: ShortcutActionId, binding: string | null) => {
    setShortcutBindings((current) =>
      sanitizeShortcutBindings({
        ...current,
        [actionId]: binding
      })
    );
  };
  const handleResetShortcutBindings = () => {
    setShortcutBindings({ ...DEFAULT_SHORTCUT_BINDINGS });
    showNotice({ level: "info", message: "Shortcuts reset to defaults." });
  };
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
  const handleResetLibraryData = () => {
    if (resetLibraryDataPending) return;

    setResetLibraryDataPending(true);
    setCatalogError(null);

    void (async () => {
      try {
        await tauriClientRef.current.catalogResetLibraryData();

        setCatalogFailures([]);
        setLibraryRoots([]);
        setActiveScanJobs({});
        setSelectedTrackId("");
        setSelectedTrackDetail(null);
        setTrackDetailsById({});
        setSessionQueueTrackIds([]);
        setBatchSelectedTrackIds([]);
        setFavoriteTrackIds([]);
        setPublishSelectionItems([]);
        setPublisherDraftPrefill(null);
        setPublishSelectionFeedback(null);
        setListenQueueFeedback(null);
        setTrackRowContextMenu(null);
        setQueueDragTrackId(null);
        setPlayerTrackId("");
        setPlayerExternalSource(null);
        setPlayerTimeSec(0);
        setPlayerIsPlaying(false);
        setPlayListModeWithQueueSync("library");
        setSelectedAlbumKey("");

        await Promise.all([
          refreshLibraryRootsAction(),
          loadCatalogTracks(trackSearch)
        ]);
        showNotice({
          level: "success",
          message: "Library data reset."
        });
      } catch (error) {
        setCatalogError(normalizeWorkspaceUiError(error));
      } finally {
        setResetLibraryDataPending(false);
      }
    })();
  };
  const handlePlayerPrev = useCallback(
    () => setPlayerTrackFromQueueIndex(Math.max(0, queueIndex - 1)),
    [queueIndex, setPlayerTrackFromQueueIndex]
  );
  const handlePlayerNext = useCallback(
    () => setPlayerTrackFromQueueIndex(Math.min(queue.length - 1, queueIndex + 1)),
    [queue.length, queueIndex, setPlayerTrackFromQueueIndex]
  );
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (activeMode !== "Listen") return;
      if (event.defaultPrevented || event.repeat) return;
      if (isEditableShortcutTarget(event.target)) return;

      const pressedBinding = keyboardEventToShortcutBinding(event);
      if (!pressedBinding) return;

      const action = (Object.entries(shortcutBindings) as Array<[ShortcutActionId, string | null]>).find(
        ([, binding]) => binding === pressedBinding
      )?.[0];
      if (!action) return;

      event.preventDefault();
      if (action === "toggle_play_pause") {
        togglePlay();
        return;
      }
      if (action === "next_track") {
        handlePlayerNext();
        return;
      }
      if (action === "previous_track") {
        handlePlayerPrev();
        return;
      }
      if (action === "toggle_mute") {
        toggleNowPlayingMute();
        return;
      }
      if (action === "toggle_queue_visibility") {
        handleSharedPlayerQueueToggle();
        return;
      }
      if (action === "focus_track_search") {
        setActiveWorkspace("Playlists");
        window.setTimeout(() => {
          const input = trackSearchInputRef.current;
          if (!input) return;
          input.focus();
          input.select();
        }, 0);
        return;
      }
      if (action === "move_queue_track_up") {
        if (playListMode !== "queue" || !selectedTrackId) return;
        moveTrackInQueue(selectedTrackId, -1);
        return;
      }
      if (action === "move_queue_track_down") {
        if (playListMode !== "queue" || !selectedTrackId) return;
        moveTrackInQueue(selectedTrackId, 1);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    activeMode,
    handlePlayerNext,
    handlePlayerPrev,
    handleSharedPlayerQueueToggle,
    moveTrackInQueue,
    playListMode,
    selectedTrackId,
    setActiveWorkspace,
    shortcutBindings,
    trackSearchInputRef,
    toggleNowPlayingMute,
    togglePlay
  ]);
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
    trackSearchInputRef,
    onTrackSearchChange: setTrackSearch,
    trackSort,
    trackSortOptions,
    onTrackSortChange: handleTrackSortChange,
    trackGroupMode,
    trackGroupOptions,
    onTrackGroupModeChange: handleTrackGroupModeChange,
    onRefreshList: handleRefreshTracks,
    catalogLoading,
    catalogLoadingMore,
    canLoadMoreCatalogItems: hasMoreCatalogItems,
    onLoadMoreCatalogItems: handleLoadMoreCatalogItems,
    isQueueMode,
    onSetMode: handlePlayListModeChange,
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
      data-layout-tier={shellFrame?.layoutTier ?? "standard"}
      data-refresh-tick={shellFrame?.refreshTick ?? 0}
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
          onCancelIngestJob={handleCancelIngestJob}
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
              qcCodecPreviewEnabled={qcCodecPreviewEnabled}
              qcCodecPreviewLoading={qcCodecPreviewLoading}
              qcCodecProfiles={qcCodecProfiles}
              qcPreviewProfileAId={qcPreviewProfileAId}
              qcPreviewProfileBId={qcPreviewProfileBId}
              qcPreviewBlindXEnabled={qcPreviewBlindXEnabled}
              qcPreviewSession={qcPreviewSession}
              onQcPreviewProfileAChange={setQcPreviewProfileAId}
              onQcPreviewProfileBChange={setQcPreviewProfileBId}
              onQcPreviewBlindXEnabledChange={setQcPreviewBlindXEnabled}
              onQcPreviewSetVariant={handleSetPreviewVariant}
              onQcPreviewRevealBlindX={handleRevealBlindX}
              qcBatchExportEnabled={qcBatchExportEnabled}
              qcBatchExportSubmitting={qcBatchExportSubmitting}
              qcBatchExportOutputDir={qcBatchExportOutputDir}
              qcBatchExportTargetLufs={qcBatchExportTargetLufs}
              qcBatchExportSelectedProfileIds={qcBatchExportSelectedProfileIds}
              qcBatchExportStatusMessage={qcBatchExportStatusMessage}
              onQcBatchExportOutputDirChange={setQcBatchExportOutputDir}
              onQcBatchExportTargetLufsChange={setQcBatchExportTargetLufs}
              onQcBatchExportToggleProfile={(profileId) => {
                setQcBatchExportSelectedProfileIds((current) =>
                  current.includes(profileId)
                    ? current.filter((item) => item !== profileId)
                    : [...current, profileId]
                );
              }}
              onQcStartBatchExport={handleStartBatchExport}
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

          <section hidden={activeMode !== "Listen" || activeWorkspace !== "Video Workspace"} className="workspace-section">
            <VideoWorkspaceFeature />
          </section>

          <SettingsPanel
            hidden={activeWorkspace !== "Settings"}
            settingsPreferencesCollapsed={settingsPreferencesCollapsed}
            onToggleSettingsPreferencesCollapsed={toggleSettingsPreferencesCollapsed}
            themePreference={themePreference}
            onThemePreferenceChange={setThemePreference}
            themeVariantPreference={themeVariantPreference}
            onThemeVariantPreferenceChange={setThemeVariantPreference}
            compactDensity={compactDensity}
            onCompactDensityChange={setCompactDensity}
            showFullPaths={showFullPaths}
            onShowFullPathsChange={setShowFullPaths}
            addParentFoldersAsRootsOnDrop={dropAddParentFoldersAsRootsOnDrop}
            onAddParentFoldersAsRootsOnDropChange={setDropAddParentFoldersAsRootsOnDrop}
            shortcutBindings={shortcutBindings}
            shortcutConflictActionIdSet={shortcutConflictActionIdSet}
            onShortcutBindingChange={handleShortcutBindingChange}
            onResetShortcutBindings={handleResetShortcutBindings}
            onClearNotice={clearNotice}
            onClearErrorBanner={clearErrorBanner}
            onResetLibraryData={handleResetLibraryData}
            resetLibraryDataPending={resetLibraryDataPending}
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
            queueVisible={playListMode === "queue"}
            volumePercent={Math.round(nowPlayingState.volume_scalar * 100)}
            isMuted={nowPlayingState.is_volume_muted}
            outputMode={audioOutputController.state.effectiveMode}
            outputModeSwitching={audioOutputController.state.outputModeSwitching}
            bitPerfectEligible={Boolean(audioOutputController.state.status.bit_perfect_eligible)}
            bitPerfectReasons={audioOutputController.state.status.reasons}
            onOutputModeChange={handleSharedPlayerOutputModeChange}
            onPrev={handlePlayerPrev}
            onTogglePlay={togglePlay}
            onStop={stopPlayer}
            onNext={handlePlayerNext}
            onToggleQueueVisibility={handleSharedPlayerQueueToggle}
            onToggleMute={toggleNowPlayingMute}
            onVolumePercentChange={handleSharedPlayerVolumeChange}
            onSeekRatio={seekPlayer}
            formatClock={formatClock}
            renderAudioElement={!nativeTransportEnabled}
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










































