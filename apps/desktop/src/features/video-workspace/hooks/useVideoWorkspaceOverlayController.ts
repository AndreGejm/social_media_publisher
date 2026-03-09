import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  analyzeAudioFileToEnvelope,
  createDefaultVideoOverlaySettings,
  deriveWaveformStripBars,
  patchVideoOverlaySettings,
  type AudioWaveformAnalysis,
  type OverlayAnalysisStatus,
  type VideoOverlaySettings
} from "../../overlay-engine/api";

export type VideoWorkspaceOverlayAnalysisState = {
  status: OverlayAnalysisStatus;
  analysis: AudioWaveformAnalysis | null;
  errorMessage: string | null;
};

export type VideoWorkspaceOverlayController = {
  settings: VideoOverlaySettings;
  analysis: VideoWorkspaceOverlayAnalysisState;
  bars: readonly number[];
  setEnabled: (enabled: boolean) => void;
  setOpacity: (opacity: number) => void;
  setIntensity: (intensity: number) => void;
  setSmoothing: (smoothing: number) => void;
  setPosition: (position: "top" | "bottom") => void;
  setThemeColorHex: (hex: string) => void;
  replaceSettings: (nextSettings: VideoOverlaySettings) => void;
};

export function useVideoWorkspaceOverlayController(args: {
  audioFile: File | null;
  progressRatio: number;
  initialSettings?: VideoOverlaySettings;
  analyzeAudioFile?: typeof analyzeAudioFileToEnvelope;
}): VideoWorkspaceOverlayController {
  const [settings, setSettings] = useState<VideoOverlaySettings>(() =>
    patchVideoOverlaySettings(createDefaultVideoOverlaySettings(), args.initialSettings ?? {})
  );
  const [analysisState, setAnalysisState] = useState<VideoWorkspaceOverlayAnalysisState>({
    status: "idle",
    analysis: null,
    errorMessage: null
  });
  const requestIdRef = useRef(0);

  const analyzeAudioFile = args.analyzeAudioFile ?? analyzeAudioFileToEnvelope;

  useEffect(() => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    if (!args.audioFile) {
      setAnalysisState({
        status: "idle",
        analysis: null,
        errorMessage: null
      });
      return;
    }

    let canceled = false;
    setAnalysisState({
      status: "loading",
      analysis: null,
      errorMessage: null
    });

    void analyzeAudioFile(args.audioFile, { envelopeBins: 640 })
      .then((analysis) => {
        if (canceled || requestId !== requestIdRef.current) return;

        setAnalysisState({
          status: "ready",
          analysis,
          errorMessage: null
        });
      })
      .catch((error) => {
        if (canceled || requestId !== requestIdRef.current) return;

        const fallbackMessage =
          error instanceof Error
            ? error.message
            : "Failed to analyze audio for overlay preview.";

        setAnalysisState({
          status: "error",
          analysis: null,
          errorMessage: fallbackMessage
        });
      });

    return () => {
      canceled = true;
    };
  }, [args.audioFile, analyzeAudioFile]);

  const bars = useMemo(() => {
    if (!settings.enabled) return [];
    if (analysisState.status !== "ready") return [];

    return deriveWaveformStripBars({
      analysis: analysisState.analysis,
      progressRatio: args.progressRatio,
      settings
    });
  }, [analysisState.analysis, analysisState.status, args.progressRatio, settings]);

  const patchSettings = useCallback((patch: Partial<VideoOverlaySettings>) => {
    setSettings((current) => patchVideoOverlaySettings(current, patch));
  }, []);

  const replaceSettings = useCallback((nextSettings: VideoOverlaySettings) => {
    setSettings(patchVideoOverlaySettings(createDefaultVideoOverlaySettings(), nextSettings));
  }, []);

  return useMemo(
    () => ({
      settings,
      analysis: analysisState,
      bars,
      setEnabled: (enabled) => {
        patchSettings({ enabled });
      },
      setOpacity: (opacity) => {
        patchSettings({ opacity });
      },
      setIntensity: (intensity) => {
        patchSettings({ intensity });
      },
      setSmoothing: (smoothing) => {
        patchSettings({ smoothing });
      },
      setPosition: (position) => {
        patchSettings({ position });
      },
      setThemeColorHex: (themeColorHex) => {
        patchSettings({ themeColorHex });
      },
      replaceSettings
    }),
    [analysisState, bars, patchSettings, replaceSettings, settings]
  );
}
