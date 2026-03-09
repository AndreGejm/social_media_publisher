import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";

import { type CatalogTrackDetailResponse } from "../../../services/tauri/tauriClient";
import { useTauriClient } from "../../../services/tauri/TauriClientProvider";

type UsePlayerTrackDetailPrefetchArgs = {
  playerTrackId: string;
  selectedTrackDetail: CatalogTrackDetailResponse | null;
  trackDetailsById: Record<string, CatalogTrackDetailResponse>;
  setTrackDetailsById: Dispatch<SetStateAction<Record<string, CatalogTrackDetailResponse>>>;
};

export function usePlayerTrackDetailPrefetch(args: UsePlayerTrackDetailPrefetchArgs) {
  const { playerTrackId, selectedTrackDetail, trackDetailsById, setTrackDetailsById } = args;
  const { catalogGetTrack } = useTauriClient();

  useEffect(() => {
    if (!playerTrackId) return;
    if (selectedTrackDetail?.track_id === playerTrackId) return;
    if (trackDetailsById[playerTrackId]) return;
    let cancelled = false;
    void (async () => {
      try {
        const detail = await catalogGetTrack(playerTrackId);
        if (cancelled || !detail) return;
        setTrackDetailsById((current) => ({ ...current, [detail.track_id]: detail }));
      } catch {
        // Non-blocking; selection and queue should remain usable even if detail fetch fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalogGetTrack, playerTrackId, selectedTrackDetail, setTrackDetailsById, trackDetailsById]);
}
