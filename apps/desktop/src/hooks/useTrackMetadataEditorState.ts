import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  type CatalogListTracksResponse,
  type CatalogTrackDetailResponse,
  type UiAppError
} from "../services/tauriClient";
import { useTauriClient } from "../services/TauriClientProvider";

export type TrackMetadataEditorState = {
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

type UseTrackMetadataEditorStateArgs = {
  selectedTrackDetail: CatalogTrackDetailResponse | null;
  setSelectedTrackDetail: Dispatch<SetStateAction<CatalogTrackDetailResponse | null>>;
  setTrackDetailsById: Dispatch<SetStateAction<Record<string, CatalogTrackDetailResponse>>>;
  setCatalogPage: Dispatch<SetStateAction<CatalogListTracksResponse>>;
  setTrackDetailEditMode: Dispatch<SetStateAction<boolean>>;
  mapUiError: (error: unknown) => UiAppError;
};

export function useTrackMetadataEditorState(args: UseTrackMetadataEditorStateArgs) {
  const {
    selectedTrackDetail,
    setSelectedTrackDetail,
    setTrackDetailsById,
    setCatalogPage,
    setTrackDetailEditMode,
    mapUiError
  } = args;
  const { catalogUpdateTrackMetadata } = useTauriClient();
  const [trackEditor, setTrackEditor] = useState<TrackMetadataEditorState>(EMPTY_TRACK_EDITOR_STATE);
  const [trackEditorDirty, setTrackEditorDirty] = useState(false);
  const [trackEditorSaving, setTrackEditorSaving] = useState(false);
  const [trackEditorError, setTrackEditorError] = useState<UiAppError | null>(null);
  const [trackEditorNotice, setTrackEditorNotice] = useState<string | null>(null);
  const previousSelectedTrackIdRef = useRef<string>("");

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
  }, [selectedTrackDetail, setTrackDetailEditMode]);

  const handleSaveTrackMetadata = useCallback(async () => {
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
      setTrackEditorError(mapUiError(error));
    } finally {
      setTrackEditorSaving(false);
    }
  }, [
    catalogUpdateTrackMetadata,
    selectedTrackDetail,
    trackEditor,
    setSelectedTrackDetail,
    setTrackDetailsById,
    setCatalogPage,
    setTrackDetailEditMode,
    mapUiError
  ]);

  const trackEditorTagsPreview = useMemo(() => parseTagEditorInput(trackEditor.tagsInput), [trackEditor.tagsInput]);
  const trackEditorBoundToSelection = Boolean(
    selectedTrackDetail && trackEditor.trackId === selectedTrackDetail.track_id
  );
  const canSaveTrackMetadata = !trackEditorSaving && trackEditorBoundToSelection && trackEditorDirty;
  const canResetTrackMetadata = !trackEditorSaving && Boolean(selectedTrackDetail) && trackEditorDirty;

  const patchTrackEditor = useCallback((patch: Partial<TrackMetadataEditorState>) => {
    setTrackEditor((current) => ({ ...current, ...patch }));
    setTrackEditorDirty(true);
    setTrackEditorNotice(null);
  }, []);

  const resetTrackEditorFromSelectedDetail = useCallback(() => {
    if (!selectedTrackDetail) return;
    setTrackEditor(trackEditorStateFromDetail(selectedTrackDetail));
    setTrackEditorDirty(false);
    setTrackEditorError(null);
    setTrackEditorNotice(null);
  }, [selectedTrackDetail]);

  const clearTrackEditorMessages = useCallback(() => {
    setTrackEditorError(null);
    setTrackEditorNotice(null);
  }, []);

  return {
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
  };
}
