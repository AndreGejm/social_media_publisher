import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";

import { useAutoClearString } from "../../../shared/hooks/useAutoClearString";
import {
  getThemeVariantDefinition,
  resolveThemeMode,
  resolveThemeVariantForMode,
  type ThemePreference,
  type ThemeSemanticTokens,
  type ThemeVariantId
} from "../../../shared/theme/themeVariants";
import type { TrackRowContextMenuState } from "../../context-menu/hooks/useTrackRowContextMenuState";

type AppNotice = { level: "info" | "success" | "warning"; message: string };

type AlbumGroup = {
  key: string;
};

type UseWorkspaceUiEffectsArgs = {
  appNotice: AppNotice | null;
  setAppNotice: Dispatch<SetStateAction<AppNotice | null>>;
  listenQueueFeedback: string | null;
  setListenQueueFeedback: Dispatch<SetStateAction<string | null>>;
  publishSelectionFeedback: string | null;
  setPublishSelectionFeedback: Dispatch<SetStateAction<string | null>>;
  playerError: string | null;
  setPlayerError: Dispatch<SetStateAction<string | null>>;
  themePreference: ThemePreference;
  themeVariantPreference: ThemeVariantId;
  albumGroups: AlbumGroup[];
  setSelectedAlbumKey: Dispatch<SetStateAction<string>>;
  catalogTracksById: Map<string, unknown>;
  visibleTracksById: Map<string, unknown>;
  setSessionQueueTrackIds: Dispatch<SetStateAction<string[]>>;
  setBatchSelectedTrackIds: Dispatch<SetStateAction<string[]>>;
  setTrackRowContextMenu: Dispatch<SetStateAction<TrackRowContextMenuState | null>>;
};

function applyThemeTokens(root: HTMLElement, tokens: ThemeSemanticTokens): void {
  Object.entries(tokens).forEach(([tokenName, tokenValue]) => {
    root.style.setProperty(tokenName, tokenValue);
  });
}

export function useWorkspaceUiEffects(args: UseWorkspaceUiEffectsArgs) {
  const {
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
    catalogTracksById,
    visibleTracksById,
    setSessionQueueTrackIds,
    setBatchSelectedTrackIds,
    setTrackRowContextMenu
  } = args;

  useEffect(() => {
    if (!appNotice) return;
    if (appNotice.level === "warning") return;
    const timer = window.setTimeout(() => {
      setAppNotice((current) => (current === appNotice ? null : current));
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [appNotice, setAppNotice]);

  useAutoClearString(listenQueueFeedback, setListenQueueFeedback, 2400);
  useAutoClearString(publishSelectionFeedback, setPublishSelectionFeedback, 2400);
  useAutoClearString(playerError, setPlayerError, 6000);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const resolveTheme = () => {
      const appliedMode = resolveThemeMode(themePreference, Boolean(media?.matches));
      const resolvedVariant = resolveThemeVariantForMode(appliedMode, themeVariantPreference);
      root.dataset.theme = appliedMode;
      root.dataset.themeVariant = resolvedVariant.id;
      root.style.colorScheme = appliedMode;
      applyThemeTokens(root, getThemeVariantDefinition(resolvedVariant.id).tokens);
    };
    resolveTheme();
    if (!media) return;
    media.addEventListener?.("change", resolveTheme);
    return () => {
      media.removeEventListener?.("change", resolveTheme);
    };
  }, [themePreference, themeVariantPreference]);

  useEffect(() => {
    if (albumGroups.length === 0) {
      setSelectedAlbumKey("");
      return;
    }
    setSelectedAlbumKey((current) =>
      current && albumGroups.some((group) => group.key === current) ? current : albumGroups[0].key
    );
  }, [albumGroups, setSelectedAlbumKey]);

  useEffect(() => {
    setSessionQueueTrackIds((current) => current.filter((id) => catalogTracksById.has(id)));
  }, [catalogTracksById, setSessionQueueTrackIds]);

  useEffect(() => {
    setBatchSelectedTrackIds((current) => current.filter((id) => visibleTracksById.has(id)));
    setTrackRowContextMenu((current) =>
      current && !visibleTracksById.has(current.trackId) ? null : current
    );
  }, [setBatchSelectedTrackIds, setTrackRowContextMenu, visibleTracksById]);
}

