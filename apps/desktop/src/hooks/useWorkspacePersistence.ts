import { useEffect } from "react";

import { writeStorage } from "../app/state/localStorage";

type StorageKeys = {
  activeMode: string;
  activeWorkspace: string;
  publishShellStep: string;
  libraryIngestTab: string;
  libraryIngestCollapsed: string;
  libraryOverviewCollapsed: string;
  libraryQuickActionsCollapsed: string;
  settingsPreferencesCollapsed: string;
  settingsSummaryCollapsed: string;
  themePreference: string;
  compactDensity: string;
  showFullPaths: string;
  trackSort: string;
  playListMode: string;
  onlyFavorites: string;
  favorites: string;
  sessionQueue: string;
  publishSelectionQueue: string;
};

type UseWorkspacePersistenceArgs = {
  storageKeys: StorageKeys;
  activeMode: string;
  activeWorkspace: string;
  publishShellStep: string;
  libraryIngestTab: string;
  libraryIngestCollapsed: boolean;
  libraryOverviewCollapsed: boolean;
  libraryQuickActionsCollapsed: boolean;
  settingsPreferencesCollapsed: boolean;
  settingsSummaryCollapsed: boolean;
  themePreference: string;
  compactDensity: boolean;
  showFullPaths: boolean;
  trackSort: string;
  playListMode: string;
  showFavoritesOnly: boolean;
  favoriteTrackIds: string[];
  sessionQueueTrackIds: string[];
  publishSelectionItems: unknown[];
};

export function useWorkspacePersistence(args: UseWorkspacePersistenceArgs) {
  useEffect(() => {
    writeStorage(args.storageKeys.activeMode, args.activeMode);
  }, [args.activeMode, args.storageKeys.activeMode]);

  useEffect(() => {
    writeStorage(args.storageKeys.activeWorkspace, args.activeWorkspace);
  }, [args.activeWorkspace, args.storageKeys.activeWorkspace]);

  useEffect(() => {
    writeStorage(args.storageKeys.publishShellStep, args.publishShellStep);
  }, [args.publishShellStep, args.storageKeys.publishShellStep]);

  useEffect(() => {
    writeStorage(args.storageKeys.libraryIngestTab, args.libraryIngestTab);
  }, [args.libraryIngestTab, args.storageKeys.libraryIngestTab]);

  useEffect(() => {
    writeStorage(args.storageKeys.libraryIngestCollapsed, args.libraryIngestCollapsed);
  }, [args.libraryIngestCollapsed, args.storageKeys.libraryIngestCollapsed]);

  useEffect(() => {
    writeStorage(args.storageKeys.libraryOverviewCollapsed, args.libraryOverviewCollapsed);
  }, [args.libraryOverviewCollapsed, args.storageKeys.libraryOverviewCollapsed]);

  useEffect(() => {
    writeStorage(args.storageKeys.libraryQuickActionsCollapsed, args.libraryQuickActionsCollapsed);
  }, [args.libraryQuickActionsCollapsed, args.storageKeys.libraryQuickActionsCollapsed]);

  useEffect(() => {
    writeStorage(args.storageKeys.settingsPreferencesCollapsed, args.settingsPreferencesCollapsed);
  }, [args.settingsPreferencesCollapsed, args.storageKeys.settingsPreferencesCollapsed]);

  useEffect(() => {
    writeStorage(args.storageKeys.settingsSummaryCollapsed, args.settingsSummaryCollapsed);
  }, [args.settingsSummaryCollapsed, args.storageKeys.settingsSummaryCollapsed]);

  useEffect(() => {
    writeStorage(args.storageKeys.themePreference, args.themePreference);
  }, [args.storageKeys.themePreference, args.themePreference]);

  useEffect(() => {
    writeStorage(args.storageKeys.compactDensity, args.compactDensity);
  }, [args.compactDensity, args.storageKeys.compactDensity]);

  useEffect(() => {
    writeStorage(args.storageKeys.showFullPaths, args.showFullPaths);
  }, [args.showFullPaths, args.storageKeys.showFullPaths]);

  useEffect(() => {
    writeStorage(args.storageKeys.trackSort, args.trackSort);
  }, [args.storageKeys.trackSort, args.trackSort]);

  useEffect(() => {
    writeStorage(args.storageKeys.playListMode, args.playListMode);
  }, [args.playListMode, args.storageKeys.playListMode]);

  useEffect(() => {
    writeStorage(args.storageKeys.onlyFavorites, args.showFavoritesOnly);
  }, [args.showFavoritesOnly, args.storageKeys.onlyFavorites]);

  useEffect(() => {
    writeStorage(args.storageKeys.favorites, args.favoriteTrackIds);
  }, [args.favoriteTrackIds, args.storageKeys.favorites]);

  useEffect(() => {
    writeStorage(args.storageKeys.sessionQueue, args.sessionQueueTrackIds);
  }, [args.sessionQueueTrackIds, args.storageKeys.sessionQueue]);

  useEffect(() => {
    writeStorage(args.storageKeys.publishSelectionQueue, args.publishSelectionItems);
  }, [args.publishSelectionItems, args.storageKeys.publishSelectionQueue]);
}
