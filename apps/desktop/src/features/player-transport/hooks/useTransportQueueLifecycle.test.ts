import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";

import type { ResolvedPlayerSource } from "./playerTransportTypes";
import { useTransportQueueLifecycle } from "./useTransportQueueLifecycle";

type HookOverrides = {
  autoplayRequestSourceKey?: string | null;
  playerTrackId?: string;
  queueIndex?: number;
  playerSource?: ResolvedPlayerSource;
  nativeTransportEnabled?: boolean;
  setPlaybackQueue?: (paths: string[]) => Promise<{ total_tracks: number }>;
  setPlaybackPlaying?: (isPlaying: boolean) => Promise<void>;
  pushPlaybackTrackChangeRequest?: (newIndex: number) => Promise<boolean>;
};

type HarnessProps = {
  autoplayRequestSourceKey: string | null;
  playerTrackId: string;
  queueIndex: number;
  playerSource: ResolvedPlayerSource;
  nativeTransportEnabled: boolean;
  playerAudioSrc: string;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {
    promise,
    resolve,
    reject
  };
}

function createPlayerSource(trackId: string, trackNumber: number): ResolvedPlayerSource {
  return {
    key: `catalog:${trackId}`,
    filePath: `C:/music/${trackId}.wav`,
    title: `Track ${trackNumber}`,
    artist: "Artist",
    durationMs: 120_000
  };
}

function buildHookHarness(overrides: HookOverrides = {}) {
  const setPlaybackQueue = overrides.setPlaybackQueue ?? vi.fn(async () => ({ total_tracks: 2 }));
  const setPlayerError = vi.fn();
  const setPlayerTimeSec = vi.fn();
  const setPlayerIsPlaying = vi.fn();
  const setPlaybackPlaying = overrides.setPlaybackPlaying ?? vi.fn(async () => undefined);
  const pushPlaybackTrackChangeRequest =
    overrides.pushPlaybackTrackChangeRequest ?? vi.fn(async () => true);
  const onNotice = vi.fn();

  const playerAudioRef = { current: document.createElement("audio") };
  const initialProps: HarnessProps = {
    autoplayRequestSourceKey: overrides.autoplayRequestSourceKey ?? null,
    playerTrackId: overrides.playerTrackId ?? "track-2",
    queueIndex: overrides.queueIndex ?? 1,
    playerSource: overrides.playerSource ?? createPlayerSource("track-2", 2),
    nativeTransportEnabled: overrides.nativeTransportEnabled ?? true,
    playerAudioSrc: "blob:track"
  };

  const hook = renderHook(
    (props: HarnessProps) => {
      const [autoplayRequestSourceKey, setAutoplayRequestSourceKey] = React.useState<string | null>(
        props.autoplayRequestSourceKey
      );

      React.useEffect(() => {
        setAutoplayRequestSourceKey(props.autoplayRequestSourceKey);
      }, [props.autoplayRequestSourceKey]);

      useTransportQueueLifecycle({
        nativeTransportEnabled: props.nativeTransportEnabled,
        queueFilePaths: ["C:/music/track-1.wav", "C:/music/track-2.wav"],
        setPlaybackQueue,
        setPlayerError,
        playerSource: props.playerSource,
        setPlayerTimeSec,
        setPlayerIsPlaying,
        setPlaybackPlaying,
        playerAudioRef,
        playerTrackId: props.playerTrackId,
        autoplayRequestSourceKey,
        queueIndex: props.queueIndex,
        pushPlaybackTrackChangeRequest,
        onNotice,
        playerAudioSrc: props.playerAudioSrc,
        setAutoplayRequestSourceKey
      });

      return { autoplayRequestSourceKey };
    },
    {
      initialProps
    }
  );

  return {
    ...hook,
    mocks: {
      setPlaybackQueue,
      setPlayerError,
      setPlayerTimeSec,
      setPlayerIsPlaying,
      setPlaybackPlaying,
      pushPlaybackTrackChangeRequest,
      onNotice
    },
    initialProps
  };
}

describe("useTransportQueueLifecycle", () => {
  it("does not pause native playback again after autoplay request completion", async () => {
    const { result, mocks } = buildHookHarness({
      autoplayRequestSourceKey: "catalog:track-2"
    });

    await waitFor(() => {
      expect(result.current.autoplayRequestSourceKey).toBeNull();
    });
    await waitFor(() => {
      expect(mocks.pushPlaybackTrackChangeRequest).toHaveBeenCalledTimes(1);
    });

    expect(mocks.pushPlaybackTrackChangeRequest).toHaveBeenCalledWith(1);
    expect(mocks.setPlaybackPlaying).toHaveBeenCalledTimes(1);
    expect(mocks.setPlaybackPlaying).toHaveBeenCalledWith(true);
  });

  it("still arms native playback without autoplay for manual track selection", async () => {
    const { mocks } = buildHookHarness();

    await waitFor(() => {
      expect(mocks.pushPlaybackTrackChangeRequest).toHaveBeenCalledWith(1);
    });

    expect(mocks.pushPlaybackTrackChangeRequest).toHaveBeenCalledTimes(1);
    expect(mocks.setPlaybackPlaying).not.toHaveBeenCalledWith(true);
  });

  it("ignores stale autoplay completion when the selected source changes mid-flight", async () => {
    const firstAutoplay = deferred<boolean>();
    const secondAutoplay = deferred<boolean>();
    const pushPlaybackTrackChangeRequest = vi.fn((newIndex: number) => {
      if (newIndex === 1) {
        return firstAutoplay.promise;
      }
      return secondAutoplay.promise;
    });

    const { result, rerender, mocks, initialProps } = buildHookHarness({
      autoplayRequestSourceKey: "catalog:track-2",
      pushPlaybackTrackChangeRequest
    });

    await waitFor(() => {
      expect(mocks.pushPlaybackTrackChangeRequest).toHaveBeenCalledWith(1);
    });

    rerender({
      ...initialProps,
      autoplayRequestSourceKey: "catalog:track-1",
      playerTrackId: "track-1",
      queueIndex: 0,
      playerSource: createPlayerSource("track-1", 1),
      playerAudioSrc: "blob:track-1"
    });

    await act(async () => {
      firstAutoplay.resolve(true);
      await Promise.resolve();
    });

    expect(result.current.autoplayRequestSourceKey).toBe("catalog:track-1");
    expect(mocks.setPlaybackPlaying).not.toHaveBeenCalledWith(true);

    await waitFor(() => {
      expect(mocks.pushPlaybackTrackChangeRequest).toHaveBeenCalledWith(0);
    });

    await act(async () => {
      secondAutoplay.resolve(true);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.autoplayRequestSourceKey).toBeNull();
    });

    const playbackCalls = (mocks.setPlaybackPlaying as Mock).mock.calls as [boolean][];

    expect(mocks.pushPlaybackTrackChangeRequest).toHaveBeenNthCalledWith(1, 1);
    expect(mocks.pushPlaybackTrackChangeRequest).toHaveBeenNthCalledWith(2, 0);
    expect(playbackCalls.filter(([isPlaying]) => isPlaying)).toHaveLength(1);
  });
});
