import type { CatalogListTracksResponse, CatalogTrackDetailResponse } from "../../../services/tauri/tauriClient";

export type AppNotice = { level: "info" | "success" | "warning"; message: string };

export type ExternalPlayerSource = {
  key: string;
  filePath: string;
  title: string;
  artist: string;
  durationMs: number;
};

export type ResolvedPlayerSource = {
  key: string;
  filePath: string;
  title: string;
  artist: string;
  durationMs: number;
};

export type NowPlayingState = {
  volume_scalar: number;
  is_queue_visible: boolean;
  is_volume_muted: boolean;
};

export type SetNowPlayingQueueVisibleOptions = {
  suppressError?: boolean;
};

export type UsePlayerTransportStateArgs = {
  queue: CatalogListTracksResponse["items"];
  selectedTrackDetail: CatalogTrackDetailResponse | null;
  trackDetailsById: Record<string, CatalogTrackDetailResponse>;
  onNotice: (notice: AppNotice) => void;
};