import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SharedTransportBridgeForPublisherOps } from "../App";
import { localFilePathToMediaUrl } from "../media-url";
import type { CatalogListTracksResponse, CatalogTrackDetailResponse } from "../services/tauriClient";
import { sanitizeUiErrorMessage, sanitizeUiText } from "../ui-sanitize";

type AppNotice = { level: "info" | "success" | "warning"; message: string };

export type ExternalPlayerSource = {
  key: string;
  filePath: string;
  title: string;
  artist: string;
  durationMs: number;
};

type ResolvedPlayerSource = {
  key: string;
  filePath: string;
  title: string;
  artist: string;
  durationMs: number;
};

type UsePlayerTransportStateArgs = {
  queue: CatalogListTracksResponse["items"];
  selectedTrackDetail: CatalogTrackDetailResponse | null;
  trackDetailsById: Record<string, CatalogTrackDetailResponse>;
  onNotice: (notice: AppNotice) => void;
};

export function usePlayerTransportState(args: UsePlayerTransportStateArgs) {
  const { queue, selectedTrackDetail, trackDetailsById, onNotice } = args;
  const [playerTrackId, setPlayerTrackId] = useState<string>("");
  const [playerExternalSource, setPlayerExternalSource] = useState<ExternalPlayerSource | null>(null);
  const [autoplayRequestSourceKey, setAutoplayRequestSourceKey] = useState<string | null>(null);
  const [playerTimeSec, setPlayerTimeSec] = useState(0);
  const [playerIsPlaying, setPlayerIsPlaying] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const playerAudioRef = useRef<HTMLAudioElement>(null);

  const publisherOpsTransportStateRef = useRef<SharedTransportBridgeForPublisherOps["state"]>({
    sourceKey: null,
    currentTimeSec: 0,
    isPlaying: false
  });

  const playerTrackDetail = useMemo(() => {
    if (!playerTrackId) return null;
    if (selectedTrackDetail?.track_id === playerTrackId) return selectedTrackDetail;
    return trackDetailsById[playerTrackId] ?? null;
  }, [playerTrackId, selectedTrackDetail, trackDetailsById]);

  const playerSource = useMemo<ResolvedPlayerSource | null>(() => {
    if (playerExternalSource) {
      return {
        key: sanitizeUiText(playerExternalSource.key, 256),
        filePath: sanitizeUiText(playerExternalSource.filePath, 4096),
        title: sanitizeUiText(playerExternalSource.title, 256),
        artist: sanitizeUiText(playerExternalSource.artist, 256),
        durationMs: playerExternalSource.durationMs
      };
    }
    if (!playerTrackDetail) return null;
    return {
      key: `catalog:${playerTrackDetail.track_id}`,
      filePath: playerTrackDetail.file_path,
      title: sanitizeUiText(playerTrackDetail.title, 256),
      artist: sanitizeUiText(playerTrackDetail.artist_name, 256),
      durationMs: playerTrackDetail.track.duration_ms
    };
  }, [playerExternalSource, playerTrackDetail]);

  const playerAudioSrc = playerSource ? localFilePathToMediaUrl(playerSource.filePath) : undefined;

  useEffect(() => {
    if (!playerSource) return;
    const audio = playerAudioRef.current;
    if (!audio) return;
    audio.load();
    try {
      audio.currentTime = 0;
    } catch {
      // unsupported media runtime
    }
    setPlayerTimeSec(0);
    setPlayerIsPlaying(false);
  }, [playerSource]);

  useEffect(() => {
    if (!autoplayRequestSourceKey) return;
    if (!playerSource || autoplayRequestSourceKey !== playerSource.key) return;
    if (!playerAudioSrc) return;
    const audio = playerAudioRef.current;
    if (!audio) return;
    const run = async () => {
      try {
        const maybePromise = audio.play();
        if (maybePromise && typeof maybePromise.then === "function") {
          await maybePromise;
        }
        setPlayerError(null);
        onNotice({ level: "success", message: "Playback started." });
      } catch (error) {
        const message = sanitizeUiErrorMessage(error, "Unable to start playback for this file.");
        setPlayerError(message);
        onNotice({ level: "warning", message: "Playback failed to start. Check file format support or file access." });
      } finally {
        setAutoplayRequestSourceKey((current) => (current === playerSource.key ? null : current));
      }
    };
    void run();
  }, [autoplayRequestSourceKey, onNotice, playerAudioSrc, playerSource]);

  const queueIndex = useMemo(
    () => queue.findIndex((item) => item.track_id === playerTrackId),
    [queue, playerTrackId]
  );

  const ensureExternalPlayerSource = useCallback(
    (source: ExternalPlayerSource, options?: { autoplay?: boolean }) => {
      const { autoplay = false } = options ?? {};
      setPlayerExternalSource((current) => {
        if (
          current &&
          current.key === source.key &&
          current.filePath === source.filePath &&
          current.title === source.title &&
          current.artist === source.artist &&
          current.durationMs === source.durationMs
        ) {
          return current;
        }
        return source;
      });
      setPlayerTrackId("");
      setPlayerError(null);
      if (autoplay) {
        setAutoplayRequestSourceKey(source.key);
      }
    },
    []
  );

  const seekPlayer = useCallback(
    (ratio: number) => {
      const audio = playerAudioRef.current;
      const source = playerSource;
      if (!audio || !source) return;
      const durationSec = Math.max(source.durationMs / 1000, 0.001);
      const nextTime = Math.max(0, Math.min(durationSec, durationSec * ratio));
      try {
        audio.currentTime = nextTime;
      } catch {
        setPlayerError("Unable to seek the current track.");
        return;
      }
      setPlayerTimeSec(nextTime);
    },
    [playerSource]
  );

  publisherOpsTransportStateRef.current = {
    sourceKey: playerSource?.key ?? null,
    currentTimeSec: playerTimeSec,
    isPlaying: playerIsPlaying
  };

  const publisherOpsSharedTransportBridge = useMemo<SharedTransportBridgeForPublisherOps>(
    () => ({
      get state() {
        return publisherOpsTransportStateRef.current;
      },
      ensureSource: (source, options) => {
        ensureExternalPlayerSource(
          {
            key: source.sourceKey,
            filePath: source.filePath,
            title: source.title,
            artist: source.artist,
            durationMs: source.durationMs
          },
          options
        );
      },
      seekToRatio: (sourceKey, ratio) => {
        if (!playerSource || playerSource.key !== sourceKey) return;
        seekPlayer(ratio);
      }
    }),
    [ensureExternalPlayerSource, playerSource, seekPlayer]
  );

  return {
    playerTrackId,
    setPlayerTrackId,
    playerExternalSource,
    setPlayerExternalSource,
    autoplayRequestSourceKey,
    setAutoplayRequestSourceKey,
    playerTimeSec,
    setPlayerTimeSec,
    playerIsPlaying,
    setPlayerIsPlaying,
    playerError,
    setPlayerError,
    playerAudioRef,
    playerTrackDetail,
    playerSource,
    playerAudioSrc,
    queueIndex,
    ensureExternalPlayerSource,
    seekPlayer,
    publisherOpsSharedTransportBridge
  };
}
