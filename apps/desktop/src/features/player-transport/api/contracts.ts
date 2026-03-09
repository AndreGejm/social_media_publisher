import type { PlaybackContextState } from "../../../services/tauri/tauriClient";

export type AudioOutputTransportHandshake = {
  getDesiredOutputConfig: () => { sampleRateHz: number; bitDepth: number };
  getQueueSnapshot: () => {
    paths: string[];
    activeIndex: number;
    hasPlayerSource: boolean;
  };
  getNowPlayingVolumeScalar: () => number;
  getIsPlaying: () => boolean;
  pauseForModeSwitch: () => Promise<void>;
  rearmCurrentTrackForNativePlayback: () => Promise<boolean>;
  resumeNativePlayback: () => Promise<void>;
  applyPlaybackContext: (context: PlaybackContextState) => void;
  setNativeTransportEnabled: (enabled: boolean) => void;
  setNativeTransportChecked: (checked: boolean) => void;
  fallbackToBrowserShared: (reason: string) => void;
  setPlayerError: (message: string | null) => void;
};
