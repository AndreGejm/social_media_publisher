export type PublisherOpsScreen = "New Release" | "Plan / Preview" | "Execute" | "Report / History";

export type SharedTransportSourceForPublisherOps = {
  sourceKey: string;
  filePath: string;
  title: string;
  artist: string;
  durationMs: number;
};

export type SharedTransportBridgeForPublisherOps = {
  state: {
    sourceKey: string | null;
    currentTimeSec: number;
    isPlaying: boolean;
  };
  ensureSource: (
    source: SharedTransportSourceForPublisherOps,
    options?: { autoplay?: boolean }
  ) => void;
  seekToRatio: (sourceKey: string, ratio: number) => void;
};
