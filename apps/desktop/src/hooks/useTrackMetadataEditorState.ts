import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  catalogUpdateTrackMetadata,
  type CatalogListTracksResponse,
  type CatalogTrackDetailResponse,
  type UiAppError
} from "../services/tauriClient";

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
  const [trackEditor, setTrackEditor] = useState<TrackMetadataEditorState>(EMPTY_TRACK_EDITOR_STATE);
  const [trackEditorDirty, setTrackEditorDirty] = useState(false);
  const [trackEditorSaving, setTrackEditorSaving] = useState(false);
  const [trackEditorError, setTrackEditorError] = useState<UiAppError | null>(null);
  const [trackEditorNotice, setTrackEditorNotice] = useState<string | null>(null);
  const previousSelectedTrackIdRef = useRef<string>("");

  useEffect(() => {
    if (!args.selectedTrackDetail) {
      setTrackEditor(EMPTY_TRACK_EDITOR_STATE);
      setTrackEditorDirty(false);
      setTrackEditorError(null);
      setTrackEditorNotice(null);
      args.setTrackDetailEditMode(false);
      previousSelectedTrackIdRef.current = "";
      return;
    }
    const isSameTrackRefresh = previousSelectedTrackIdRef.current === args.selectedTrackDetail.track_id;
    setTrackEditor(trackEditorStateFromDetail(args.selectedTrackDetail));
    setTrackEditorDirty(false);
    setTrackEditorError(null);
    if (!isSameTrackRefresh) {
      setTrackEditorNotice(null);
      args.setTrackDetailEditMode(false);
    }
    previousSelectedTrackIdRef.current = args.selectedTrackDetail.track_id;
  }, [args.selectedTrackDetail, args.setTrackDetailEditMode]);

  const handleSaveTrackMetadata = useCallback(async () => {
    if (!args.selectedTrackDetail) return;
    if (trackEditor.trackId !== args.selectedTrackDetail.track_id) return;

    setTrackEditorSaving(true);
    setTrackEditorError(null);
    setTrackEditorNotice(null);
    try {
      const updated = await catalogUpdateTrackMetadata({
        track_id: args.selectedTrackDetail.track_id,
        visibility_policy: trackEditor.visibilityPolicy,
        license_policy: trackEditor.licensePolicy,
        downloadable: trackEditor.downloadable,
        tags: parseTagEditorInput(trackEditor.tagsInput)
      });
      args.setSelectedTrackDetail(updated);
      args.setTrackDetailsById((current) => ({ ...current, [updated.track_id]: updated }));
      args.setCatalogPage((current) => ({
        ...current,
        items: current.items.map((item) =>
          item.track_id === updated.track_id ? { ...item, updated_at: updated.updated_at } : item
        )
      }));
      setTrackEditorDirty(false);
      setTrackEditorNotice("Track metadata saved.");
      args.setTrackDetailEditMode(false);
    } catch (error) {
      setTrackEditorError(args.mapUiError(error));
    } finally {
      setTrackEditorSaving(false);
    }
  }, [args, trackEditor]);

  const trackEditorTagsPreview = useMemo(() => parseTagEditorInput(trackEditor.tagsInput), [trackEditor.tagsInput]);
  const trackEditorBoundToSelection = Boolean(
    args.selectedTrackDetail && trackEditor.trackId === args.selectedTrackDetail.track_id
  );
  const canSaveTrackMetadata = !trackEditorSaving && trackEditorBoundToSelection && trackEditorDirty;
  const canResetTrackMetadata = !trackEditorSaving && Boolean(args.selectedTrackDetail) && trackEditorDirty;

  const patchTrackEditor = useCallback((patch: Partial<TrackMetadataEditorState>) => {
    setTrackEditor((current) => ({ ...current, ...patch }));
    setTrackEditorDirty(true);
    setTrackEditorNotice(null);
  }, []);

  const resetTrackEditorFromSelectedDetail = useCallback(() => {
    if (!args.selectedTrackDetail) return;
    setTrackEditor(trackEditorStateFromDetail(args.selectedTrackDetail));
    setTrackEditorDirty(false);
    setTrackEditorError(null);
    setTrackEditorNotice(null);
  }, [args.selectedTrackDetail]);

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
