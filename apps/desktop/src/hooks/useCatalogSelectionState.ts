import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  catalogGetTrack,
  catalogListTracks,
  type CatalogListTracksResponse,
  type CatalogTrackDetailResponse,
  type UiAppError
} from "../services/tauriClient";

type UseCatalogSelectionStateArgs = {
  deferredTrackSearch: string;
  mapUiError: (error: unknown) => UiAppError;
  setCatalogError: Dispatch<SetStateAction<UiAppError | null>>;
};

export function useCatalogSelectionState(args: UseCatalogSelectionStateArgs) {
  const { deferredTrackSearch, mapUiError, setCatalogError } = args;

  const [catalogPage, setCatalogPage] = useState<CatalogListTracksResponse>({
    items: [],
    total: 0,
    limit: 100,
    offset: 0
  });
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [selectedTrackId, setSelectedTrackId] = useState<string>("");
  const [selectedTrackDetail, setSelectedTrackDetail] = useState<CatalogTrackDetailResponse | null>(null);
  const [trackDetailsById, setTrackDetailsById] = useState<Record<string, CatalogTrackDetailResponse>>({});
  const [selectedTrackLoading, setSelectedTrackLoading] = useState(false);

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
      setCatalogError(mapUiError(error));
    } finally {
      setCatalogLoading(false);
    }
  }, [mapUiError, setCatalogError]);

  useEffect(() => {
    void loadCatalogTracks(deferredTrackSearch);
  }, [deferredTrackSearch, loadCatalogTracks]);

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
      } catch (error) {
        if (!cancelled) setCatalogError(mapUiError(error));
      } finally {
        if (!cancelled) setSelectedTrackLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mapUiError, selectedTrackId, setCatalogError]);

  return {
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
  };
}
