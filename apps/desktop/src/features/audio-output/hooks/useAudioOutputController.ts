import type { PlaybackContextState, PlaybackOutputMode, PlaybackOutputStatus } from "../../../services/tauri/tauriClient";
import type { AudioOutputTransportHandshake } from "../../player-transport/api";
import { useAudioOutputRuntimeState } from "./useAudioOutputRuntimeState";

type AppNotice = { level: "info" | "success" | "warning"; message: string };

export type UseAudioOutputControllerArgs = {
  transport: AudioOutputTransportHandshake;
  nativeTransportEnabled: boolean;
  nativeTransportChecked: boolean;
  latestPlaybackContext: PlaybackContextState | null;
  onNotice: (notice: AppNotice) => void;
};

export type AudioOutputControllerState = {
  requestedMode: PlaybackOutputMode;
  activeMode: PlaybackOutputMode;
  effectiveMode: PlaybackOutputMode;
  outputModeSwitching: boolean;
  status: PlaybackOutputStatus;
};

export type AudioOutputController = {
  state: AudioOutputControllerState;
  requestOutputMode: (mode: PlaybackOutputMode) => void;
};

export function useAudioOutputController(
  args: UseAudioOutputControllerArgs
): AudioOutputController {
  const runtime = useAudioOutputRuntimeState(args);

  const state: AudioOutputControllerState = {
    requestedMode: runtime.requestedOutputMode,
    activeMode: runtime.activeOutputMode,
    effectiveMode: runtime.outputModeSwitching
      ? runtime.requestedOutputMode
      : runtime.activeOutputMode,
    outputModeSwitching: runtime.outputModeSwitching,
    status: runtime.playbackOutputStatus
  };

  return {
    state,
    requestOutputMode: runtime.requestPlaybackOutputMode
  };
}
