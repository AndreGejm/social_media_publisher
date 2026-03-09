import { useCallback, useMemo, useState } from "react";

import {
  createDefaultVideoWorkspaceTextSettings,
  patchVideoWorkspaceTextSettings,
  validateVideoWorkspaceTextSettings,
  type VideoWorkspaceTextSettings
} from "../model/videoWorkspaceTextSettings";
import type { VideoTextLayoutPresetId } from "../../video-composition/api";

export type VideoWorkspaceTextSettingsController = {
  state: VideoWorkspaceTextSettings;
  issues: ReturnType<typeof validateVideoWorkspaceTextSettings>;
  setEnabled: (enabled: boolean) => void;
  setPreset: (preset: VideoTextLayoutPresetId) => void;
  setTitleText: (value: string) => void;
  setArtistText: (value: string) => void;
  setFontSizePx: (value: number) => void;
  setColorHex: (value: string) => void;
  replaceState: (nextState: VideoWorkspaceTextSettings) => void;
  reset: () => void;
};

export function useVideoWorkspaceTextSettings(args?: {
  initialState?: VideoWorkspaceTextSettings;
}): VideoWorkspaceTextSettingsController {
  const [state, setState] = useState<VideoWorkspaceTextSettings>(() =>
    patchVideoWorkspaceTextSettings(createDefaultVideoWorkspaceTextSettings(), args?.initialState ?? {})
  );

  const patchState = useCallback((patch: Partial<VideoWorkspaceTextSettings>) => {
    setState((current) => patchVideoWorkspaceTextSettings(current, patch));
  }, []);

  const replaceState = useCallback((nextState: VideoWorkspaceTextSettings) => {
    setState(patchVideoWorkspaceTextSettings(createDefaultVideoWorkspaceTextSettings(), nextState));
  }, []);

  const reset = useCallback(() => {
    setState(createDefaultVideoWorkspaceTextSettings());
  }, []);

  const issues = useMemo(() => validateVideoWorkspaceTextSettings(state), [state]);

  return useMemo(
    () => ({
      state,
      issues,
      setEnabled: (enabled) => {
        patchState({ enabled });
      },
      setPreset: (preset) => {
        patchState({ preset });
      },
      setTitleText: (value) => {
        patchState({ titleText: value });
      },
      setArtistText: (value) => {
        patchState({ artistText: value });
      },
      setFontSizePx: (value) => {
        patchState({ fontSizePx: value });
      },
      setColorHex: (value) => {
        patchState({ colorHex: value });
      },
      replaceState,
      reset
    }),
    [issues, patchState, replaceState, reset, state]
  );
}
