import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  resolveVideoPreviewFitPresentation,
  type VideoPreviewFitMode,
  type VideoPreviewFitPresentation
} from "../../video-composition/api";
import { localFilePathToMediaUrl } from "../../../infrastructure/tauri/media-url";

export type VideoWorkspacePreviewPlaybackState = "idle" | "paused" | "playing" | "error";

export type VideoWorkspacePreviewState = {
  playbackState: VideoWorkspacePreviewPlaybackState;
  durationSeconds: number;
  positionSeconds: number;
  errorMessage: string | null;
};

export type VideoWorkspacePreviewController = {
  fitMode: VideoPreviewFitMode;
  fitPresentation: VideoPreviewFitPresentation;
  imagePreviewUrl: string | null;
  audioPreviewUrl: string | null;
  state: VideoWorkspacePreviewState;
  hasMediaReady: boolean;
  canControlPlayback: boolean;
  setFitMode: (mode: VideoPreviewFitMode) => void;
  play: () => Promise<void>;
  pause: () => void;
  seekToRatio: (ratio: number) => void;
  restart: () => Promise<void>;
  bindAudioElement: (element: HTMLAudioElement | null) => void;
  handleAudioLoadedMetadata: () => void;
  handleAudioTimeUpdate: () => void;
  handleAudioEnded: () => void;
  handleAudioError: () => void;
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function sanitizeDuration(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function maybeCreateObjectUrl(file: File | null): string | null {
  if (!file) return null;
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  return URL.createObjectURL(file);
}

function maybeRevokeObjectUrl(url: string | null): void {
  if (!url) return;
  if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
  URL.revokeObjectURL(url);
}

function createIdlePreviewState(): VideoWorkspacePreviewState {
  return {
    playbackState: "idle",
    durationSeconds: 0,
    positionSeconds: 0,
    errorMessage: null
  };
}

function resolveNativePreviewUrl(sourcePath: string | null): string | null {
  if (!sourcePath || sourcePath.trim().length === 0) return null;
  const mediaUrl = localFilePathToMediaUrl(sourcePath);
  return mediaUrl.length > 0 ? mediaUrl : null;
}

export function useVideoWorkspacePreviewController(args: {
  imageFile: File | null;
  imageSourcePath?: string | null;
  audioFile: File | null;
  audioSourcePath?: string | null;
}): VideoWorkspacePreviewController {
  const [fitMode, setFitMode] = useState<VideoPreviewFitMode>("fill_crop");
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [state, setState] = useState<VideoWorkspacePreviewState>(() => createIdlePreviewState());
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const nextImageFileUrl = maybeCreateObjectUrl(args.imageFile);
    const nextImagePathUrl = nextImageFileUrl ? null : resolveNativePreviewUrl(args.imageSourcePath ?? null);
    const nextImageUrl = nextImageFileUrl ?? nextImagePathUrl;
    setImagePreviewUrl(nextImageUrl);

    return () => {
      maybeRevokeObjectUrl(nextImageFileUrl);
    };
  }, [args.imageFile, args.imageSourcePath]);

  useEffect(() => {
    const nextAudioFileUrl = maybeCreateObjectUrl(args.audioFile);
    const nextAudioPathUrl = nextAudioFileUrl ? null : resolveNativePreviewUrl(args.audioSourcePath ?? null);
    const nextAudioUrl = nextAudioFileUrl ?? nextAudioPathUrl;
    setAudioPreviewUrl(nextAudioUrl);

    setState(() => {
      if (!nextAudioUrl) return createIdlePreviewState();
      return {
        playbackState: "paused",
        durationSeconds: 0,
        positionSeconds: 0,
        errorMessage: null
      };
    });

    return () => {
      maybeRevokeObjectUrl(nextAudioFileUrl);
    };
  }, [args.audioFile, args.audioSourcePath]);

  const syncFromAudioElement = useCallback((playbackState: VideoWorkspacePreviewPlaybackState | null) => {
    const audioElement = audioElementRef.current;
    if (!audioElement) return;

    const durationSeconds = sanitizeDuration(audioElement.duration);
    const maxPosition = durationSeconds > 0 ? durationSeconds : 0;
    const positionSeconds = clamp(audioElement.currentTime, 0, maxPosition);

    setState((current) => ({
      ...current,
      playbackState: playbackState ?? current.playbackState,
      durationSeconds,
      positionSeconds,
      errorMessage: playbackState === "error" ? current.errorMessage : null
    }));
  }, []);

  const play = useCallback(async () => {
    if (!audioPreviewUrl) return;

    const audioElement = audioElementRef.current;
    if (!audioElement) return;

    try {
      const playResult = audioElement.play();
      if (playResult && typeof playResult.then === "function") {
        await playResult;
      }
      syncFromAudioElement("playing");
    } catch {
      setState((current) => ({
        ...current,
        playbackState: "error",
        errorMessage: "Unable to start preview audio playback."
      }));
    }
  }, [audioPreviewUrl, syncFromAudioElement]);

  const pause = useCallback(() => {
    const audioElement = audioElementRef.current;
    if (!audioElement) return;
    audioElement.pause();
    syncFromAudioElement("paused");
  }, [syncFromAudioElement]);

  const seekToRatio = useCallback(
    (ratio: number) => {
      const audioElement = audioElementRef.current;
      if (!audioElement) return;

      const durationSeconds = sanitizeDuration(audioElement.duration);
      if (durationSeconds <= 0) {
        setState((current) => ({
          ...current,
          positionSeconds: 0
        }));
        return;
      }

      const targetSeconds = clamp(ratio, 0, 1) * durationSeconds;
      audioElement.currentTime = targetSeconds;
      syncFromAudioElement(null);
    },
    [syncFromAudioElement]
  );

  const restart = useCallback(async () => {
    const audioElement = audioElementRef.current;
    if (!audioElement) return;

    audioElement.currentTime = 0;
    if (state.playbackState === "playing") {
      await play();
      return;
    }

    syncFromAudioElement("paused");
  }, [play, state.playbackState, syncFromAudioElement]);

  const bindAudioElement = useCallback((element: HTMLAudioElement | null) => {
    audioElementRef.current = element;
  }, []);

  const handleAudioLoadedMetadata = useCallback(() => {
    syncFromAudioElement(state.playbackState === "playing" ? "playing" : "paused");
  }, [state.playbackState, syncFromAudioElement]);

  const handleAudioTimeUpdate = useCallback(() => {
    syncFromAudioElement(null);
  }, [syncFromAudioElement]);

  const handleAudioEnded = useCallback(() => {
    const audioElement = audioElementRef.current;
    if (!audioElement) {
      setState((current) => ({
        ...current,
        playbackState: "paused"
      }));
      return;
    }

    const durationSeconds = sanitizeDuration(audioElement.duration);
    setState((current) => ({
      ...current,
      playbackState: "paused",
      durationSeconds,
      positionSeconds: durationSeconds,
      errorMessage: null
    }));
  }, []);

  const handleAudioError = useCallback(() => {
    setState((current) => ({
      ...current,
      playbackState: "error",
      errorMessage: "Preview audio playback failed."
    }));
  }, []);

  const fitPresentation = useMemo(
    () => resolveVideoPreviewFitPresentation(fitMode),
    [fitMode]
  );

  const hasMediaReady = Boolean(imagePreviewUrl && audioPreviewUrl);

  return useMemo(
    () => ({
      fitMode,
      fitPresentation,
      imagePreviewUrl,
      audioPreviewUrl,
      state,
      hasMediaReady,
      canControlPlayback: Boolean(audioPreviewUrl),
      setFitMode,
      play,
      pause,
      seekToRatio,
      restart,
      bindAudioElement,
      handleAudioLoadedMetadata,
      handleAudioTimeUpdate,
      handleAudioEnded,
      handleAudioError
    }),
    [
      audioPreviewUrl,
      bindAudioElement,
      fitMode,
      fitPresentation,
      handleAudioEnded,
      handleAudioError,
      handleAudioLoadedMetadata,
      handleAudioTimeUpdate,
      hasMediaReady,
      imagePreviewUrl,
      pause,
      play,
      restart,
      seekToRatio,
      state
    ]
  );
}
