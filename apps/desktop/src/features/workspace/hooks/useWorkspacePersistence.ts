import { useEffect } from "react";

import { writeStorage } from "../../../app/state/localStorage";

type StorageKeys = {
  activeMode: string;
  activeWorkspace: string;
  qualityControlMode: string;
  publishShellStep: string;
  libraryIngestTab: string;
  libraryIngestCollapsed: string;
  libraryOverviewCollapsed: string;
  settingsPreferencesCollapsed: string;
  themePreference: string;
  themeVariantPreference: string;
  compactDensity: string;
  showFullPaths: string;
  shortcutBindings: string;
  trackSort: string;
  trackGroupMode: string;
  playListMode: string;
  onlyFavorites: string;
  dropAddParentFoldersAsRootsOnDrop: string;
  favorites: string;
  sessionQueue: string;
  publishSelectionQueue: string;
};

type UseWorkspacePersistenceArgs = {
  storageKeys: StorageKeys;
  activeMode: string;
  activeWorkspace: string;
  qualityControlMode: string;
  publishShellStep: string;
  libraryIngestTab: string;
  libraryIngestCollapsed: boolean;
  libraryOverviewCollapsed: boolean;
  settingsPreferencesCollapsed: boolean;
  themePreference: string;
  themeVariantPreference: string;
  compactDensity: boolean;
  showFullPaths: boolean;
  shortcutBindings: unknown;
  trackSort: string;
  trackGroupMode: string;
  playListMode: string;
  showFavoritesOnly: boolean;
  dropAddParentFoldersAsRootsOnDrop: boolean;
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
    writeStorage(args.storageKeys.qualityControlMode, args.qualityControlMode);
  }, [args.qualityControlMode, args.storageKeys.qualityControlMode]);

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
    writeStorage(args.storageKeys.settingsPreferencesCollapsed, args.settingsPreferencesCollapsed);
  }, [args.settingsPreferencesCollapsed, args.storageKeys.settingsPreferencesCollapsed]);


  useEffect(() => {
    writeStorage(args.storageKeys.themePreference, args.themePreference);
  }, [args.storageKeys.themePreference, args.themePreference]);

  useEffect(() => {
    writeStorage(args.storageKeys.themeVariantPreference, args.themeVariantPreference);
  }, [args.storageKeys.themeVariantPreference, args.themeVariantPreference]);

  useEffect(() => {
    writeStorage(args.storageKeys.compactDensity, args.compactDensity);
  }, [args.compactDensity, args.storageKeys.compactDensity]);

  useEffect(() => {
    writeStorage(args.storageKeys.showFullPaths, args.showFullPaths);
  }, [args.showFullPaths, args.storageKeys.showFullPaths]);

  useEffect(() => {
    writeStorage(args.storageKeys.shortcutBindings, args.shortcutBindings);
  }, [args.shortcutBindings, args.storageKeys.shortcutBindings]);

  useEffect(() => {
    writeStorage(args.storageKeys.trackSort, args.trackSort);
  }, [args.storageKeys.trackSort, args.trackSort]);

  useEffect(() => {
    writeStorage(args.storageKeys.trackGroupMode, args.trackGroupMode);
  }, [args.storageKeys.trackGroupMode, args.trackGroupMode]);

  useEffect(() => {
    writeStorage(args.storageKeys.playListMode, args.playListMode);
  }, [args.playListMode, args.storageKeys.playListMode]);

  useEffect(() => {
    writeStorage(args.storageKeys.onlyFavorites, args.showFavoritesOnly);
  }, [args.showFavoritesOnly, args.storageKeys.onlyFavorites]);

  useEffect(() => {
    writeStorage(args.storageKeys.dropAddParentFoldersAsRootsOnDrop, args.dropAddParentFoldersAsRootsOnDrop);
  }, [args.dropAddParentFoldersAsRootsOnDrop, args.storageKeys.dropAddParentFoldersAsRootsOnDrop]);

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