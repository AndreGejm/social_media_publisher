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

const CATALOG_PAGE_SIZE = 100;

export function useCatalogSelectionState(args: UseCatalogSelectionStateArgs) {
  const { deferredTrackSearch, mapUiError, setCatalogError } = args;

  const [catalogPage, setCatalogPage] = useState<CatalogListTracksResponse>({
    items: [],
    total: 0,
    limit: 100,
    offset: 0
  });
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false);
  const [catalogActiveSearch, setCatalogActiveSearch] = useState("");
  const [selectedTrackId, setSelectedTrackId] = useState<string>("");
  const [selectedTrackDetail, setSelectedTrackDetail] = useState<CatalogTrackDetailResponse | null>(null);
  const [trackDetailsById, setTrackDetailsById] = useState<Record<string, CatalogTrackDetailResponse>>({});
  const [selectedTrackLoading, setSelectedTrackLoading] = useState(false);

  const loadCatalogTracks = useCallback(async (search: string): Promise<CatalogListTracksResponse | null> => {
    const trimmedSearch = search.trim();
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const response = await catalogListTracks({
        search: trimmedSearch ? trimmedSearch : null,
        limit: CATALOG_PAGE_SIZE,
        offset: 0
      });
      setCatalogPage(response);
      setCatalogActiveSearch(trimmedSearch);
      setSelectedTrackId((current) => {
        if (response.items.length === 0) return "";
        if (current && response.items.some((item) => item.track_id === current)) return current;
        return response.items[0].track_id;
      });
      return response;
    } catch (error) {
      setCatalogError(mapUiError(error));
      return null;
    } finally {
      setCatalogLoading(false);
    }
  }, [mapUiError, setCatalogError]);

  const loadMoreCatalogTracks = useCallback(async (): Promise<CatalogListTracksResponse | null> => {
    if (catalogLoading || catalogLoadingMore) return null;
    if (catalogPage.items.length >= catalogPage.total) return null;

    setCatalogLoadingMore(true);
    setCatalogError(null);
    try {
      const response = await catalogListTracks({
        search: catalogActiveSearch.length > 0 ? catalogActiveSearch : null,
        limit: CATALOG_PAGE_SIZE,
        offset: catalogPage.items.length
      });

      setCatalogPage((current) => {
        const seen = new Set(current.items.map((item) => item.track_id));
        const mergedItems = [...current.items];
        for (const item of response.items) {
          if (seen.has(item.track_id)) continue;
          seen.add(item.track_id);
          mergedItems.push(item);
        }
        return {
          items: mergedItems,
          total: response.total,
          limit: response.limit,
          offset: 0
        };
      });
      return response;
    } catch (error) {
      setCatalogError(mapUiError(error));
      return null;
    } finally {
      setCatalogLoadingMore(false);
    }
  }, [
    catalogActiveSearch,
    catalogLoading,
    catalogLoadingMore,
    catalogPage.items,
    catalogPage.total,
    mapUiError,
    setCatalogError
  ]);

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
    catalogLoadingMore,
    hasMoreCatalogItems: catalogPage.items.length < catalogPage.total,
    selectedTrackId,
    setSelectedTrackId,
    selectedTrackDetail,
    setSelectedTrackDetail,
    trackDetailsById,
    setTrackDetailsById,
    selectedTrackLoading,
    loadCatalogTracks,
    loadMoreCatalogTracks
  };
}
