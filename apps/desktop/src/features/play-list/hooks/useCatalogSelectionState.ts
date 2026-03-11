import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  type CatalogListTracksResponse,
  type CatalogTrackDetailResponse,
  type UiAppError
} from "../../../services/tauri/tauriClient";
import { useTauriClient } from "../../../services/tauri/TauriClientProvider";

type UseCatalogSelectionStateArgs = {
  deferredTrackSearch: string;
  mapUiError: (error: unknown) => UiAppError;
  setCatalogError: Dispatch<SetStateAction<UiAppError | null>>;
};

const CATALOG_PAGE_SIZE = 100;
const EMPTY_CATALOG_PAGE: CatalogListTracksResponse = {
  items: [],
  total: 0,
  limit: CATALOG_PAGE_SIZE,
  offset: 0
};

function isBrowserPreviewRuntimeUnavailable(error: UiAppError): boolean {
  return error.code === "TAURI_UNAVAILABLE" || error.code === "UNKNOWN_COMMAND";
}

export function useCatalogSelectionState(args: UseCatalogSelectionStateArgs) {
  const { deferredTrackSearch, mapUiError, setCatalogError } = args;
  const { catalogListTracks, catalogGetTrack } = useTauriClient();

  const [catalogPage, setCatalogPage] = useState<CatalogListTracksResponse>(EMPTY_CATALOG_PAGE);
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
        if (response.items.length === 0) {
          if (trimmedSearch.length > 0 && current) return current;
          return "";
        }
        if (current && response.items.some((item) => item.track_id === current)) return current;
        if (trimmedSearch.length > 0 && current) return current;
        return response.items[0].track_id;
      });
      return response;
    } catch (error) {
      const normalized = mapUiError(error);
      if (isBrowserPreviewRuntimeUnavailable(normalized)) {
        const emptyResponse = {
          ...EMPTY_CATALOG_PAGE,
          limit: CATALOG_PAGE_SIZE
        };
        setCatalogPage(emptyResponse);
        setCatalogActiveSearch(trimmedSearch);
        setSelectedTrackId("");
        setSelectedTrackDetail(null);
        return emptyResponse;
      }
      setCatalogError(normalized);
      return null;
    } finally {
      setCatalogLoading(false);
    }
  }, [catalogListTracks, mapUiError, setCatalogError]);

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
      const normalized = mapUiError(error);
      if (isBrowserPreviewRuntimeUnavailable(normalized)) {
        return catalogPage;
      }
      setCatalogError(normalized);
      return null;
    } finally {
      setCatalogLoadingMore(false);
    }
  }, [
    catalogActiveSearch,
    catalogListTracks,
    catalogLoading,
    catalogLoadingMore,
    catalogPage,
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
        if (!cancelled) {
          const normalized = mapUiError(error);
          if (isBrowserPreviewRuntimeUnavailable(normalized)) {
            setSelectedTrackDetail(null);
          } else {
            setCatalogError(normalized);
          }
        }
      } finally {
        if (!cancelled) setSelectedTrackLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalogGetTrack, mapUiError, selectedTrackId, setCatalogError]);

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


