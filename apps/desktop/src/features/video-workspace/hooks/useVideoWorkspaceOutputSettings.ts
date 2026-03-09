import { useCallback, useMemo, useState } from "react";

import {
  createDefaultVideoOutputSettings,
  deriveVideoOutputFilePreviewPath,
  patchVideoOutputSettings,
  validateVideoOutputSettings,
  type VideoOutputSettings
} from "../model/videoOutputSettings";
import {
  resolveVideoOutputPreset,
  VIDEO_OUTPUT_PRESETS,
  type VideoOutputPreset,
  type VideoOutputPresetId
} from "../model/videoOutputPresets";

export type VideoWorkspaceOutputSettingsController = {
  state: VideoOutputSettings;
  selectedPreset: VideoOutputPreset;
  availablePresets: readonly VideoOutputPreset[];
  issues: ReturnType<typeof validateVideoOutputSettings>;
  outputFilePreviewPath: string;
  setPresetId: (presetId: VideoOutputPresetId) => void;
  setOutputDirectoryPath: (path: string) => void;
  setOutputBaseFileName: (name: string) => void;
  setOverwritePolicy: (policy: VideoOutputSettings["overwritePolicy"]) => void;
  replaceState: (nextState: VideoOutputSettings) => void;
};

export function useVideoWorkspaceOutputSettings(args?: {
  initialState?: VideoOutputSettings;
}): VideoWorkspaceOutputSettingsController {
  const [state, setState] = useState<VideoOutputSettings>(() =>
    patchVideoOutputSettings(createDefaultVideoOutputSettings(), args?.initialState ?? {})
  );

  const patchState = useCallback((patch: Partial<VideoOutputSettings>) => {
    setState((current) => patchVideoOutputSettings(current, patch));
  }, []);

  const replaceState = useCallback((nextState: VideoOutputSettings) => {
    setState(patchVideoOutputSettings(createDefaultVideoOutputSettings(), nextState));
  }, []);

  const selectedPreset = useMemo(
    () => resolveVideoOutputPreset(state.presetId),
    [state.presetId]
  );
  const issues = useMemo(() => validateVideoOutputSettings(state), [state]);
  const outputFilePreviewPath = useMemo(
    () => deriveVideoOutputFilePreviewPath(state),
    [state]
  );

  return useMemo(
    () => ({
      state,
      selectedPreset,
      availablePresets: VIDEO_OUTPUT_PRESETS,
      issues,
      outputFilePreviewPath,
      setPresetId: (presetId) => {
        patchState({ presetId });
      },
      setOutputDirectoryPath: (outputDirectoryPath) => {
        patchState({ outputDirectoryPath });
      },
      setOutputBaseFileName: (outputBaseFileName) => {
        patchState({ outputBaseFileName });
      },
      setOverwritePolicy: (overwritePolicy) => {
        patchState({ overwritePolicy });
      },
      replaceState
    }),
    [issues, outputFilePreviewPath, patchState, replaceState, selectedPreset, state]
  );
}
