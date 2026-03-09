import { useMemo } from "react";

import type { UiAppError } from "../../services/tauri/tauriClient";

type AppNotice = { level: "info" | "success" | "warning"; message: string };

export type TopNotification = {
  id: string;
  level: "info" | "success" | "warning" | "error";
  label: string;
  message: string;
  dismiss: () => void;
};

type UseTopNotificationsArgs = {
  activeMode: "Listen" | "Publish";
  appNotice: AppNotice | null;
  catalogError: UiAppError | null;
  playerError: string | null;
  listenQueueFeedback: string | null;
  publishSelectionFeedback: string | null;
  clearCatalogError: () => void;
  clearPlayerError: () => void;
  clearAppNotice: () => void;
  clearListenQueueFeedback: () => void;
  clearPublishSelectionFeedback: () => void;
};

export function useTopNotifications(args: UseTopNotificationsArgs) {
  const {
    activeMode,
    appNotice,
    catalogError,
    playerError,
    listenQueueFeedback,
    publishSelectionFeedback,
    clearCatalogError,
    clearPlayerError,
    clearAppNotice,
    clearListenQueueFeedback,
    clearPublishSelectionFeedback
  } = args;

  return useMemo<TopNotification[]>(() => {
    const items: TopNotification[] = [];
    if (catalogError) {
      items.push({
        id: "catalog-error",
        level: "error",
        label: catalogError.code,
        message: catalogError.message,
        dismiss: clearCatalogError
      });
    }
    if (playerError) {
      items.push({
        id: "player-error",
        level: "error",
        label: "Playback Error",
        message: playerError,
        dismiss: clearPlayerError
      });
    }
    if (appNotice) {
      items.push({
        id: "app-notice",
        level: appNotice.level,
        label: appNotice.level === "success" ? "Success" : appNotice.level === "warning" ? "Warning" : "Info",
        message: appNotice.message,
        dismiss: () => {
          clearAppNotice();
          if (listenQueueFeedback === appNotice.message) {
            clearListenQueueFeedback();
          }
          if (publishSelectionFeedback === appNotice.message) {
            clearPublishSelectionFeedback();
          }
        }
      });
    }
    if (activeMode === "Listen" && listenQueueFeedback && appNotice?.message !== listenQueueFeedback) {
      items.push({
        id: "listen-queue-feedback",
        level: "info",
        label: "Queue",
        message: listenQueueFeedback,
        dismiss: clearListenQueueFeedback
      });
    }
    if (activeMode === "Publish" && publishSelectionFeedback && appNotice?.message !== publishSelectionFeedback) {
      items.push({
        id: "publish-selection-feedback",
        level: "info",
        label: "Release Selection",
        message: publishSelectionFeedback,
        dismiss: clearPublishSelectionFeedback
      });
    }
    return items;
  }, [
    activeMode,
    appNotice,
    catalogError,
    clearAppNotice,
    clearCatalogError,
    clearListenQueueFeedback,
    clearPlayerError,
    clearPublishSelectionFeedback,
    listenQueueFeedback,
    playerError,
    publishSelectionFeedback
  ]);
}
