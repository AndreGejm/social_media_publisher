import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useTransportQueueLifecycle } from "./useTransportQueueLifecycle";

type HookOverrides = {
  autoplayRequestSourceKey?: string | null;
  playerTrackId?: string;
  queueIndex?: number;
};

function buildHookHarness(overrides: HookOverrides = {}) {
  const setPlaybackQueue = vi.fn(async () => ({ total_tracks: 2 }));
  const setPlayerError = vi.fn();
  const setPlayerTimeSec = vi.fn();
  const setPlayerIsPlaying = vi.fn();
  const setPlaybackPlaying = vi.fn(async () => undefined);
  const pushPlaybackTrackChangeRequest = vi.fn(async () => true);
  const onNotice = vi.fn();

  const playerSource = {
    key: "catalog:track-2",
    filePath: "C:/music/track-2.wav",
    title: "Track 2",
    artist: "Artist",
    durationMs: 120_000
  };
  const playerAudioRef = { current: document.createElement("audio") };

  const initialAutoplayRequestSourceKey = overrides.autoplayRequestSourceKey ?? null;

  const hook = renderHook(() => {
    const [autoplayRequestSourceKey, setAutoplayRequestSourceKey] = React.useState<string | null>(
      initialAutoplayRequestSourceKey
    );

    useTransportQueueLifecycle({
      nativeTransportEnabled: true,
      queueFilePaths: ["C:/music/track-1.wav", "C:/music/track-2.wav"],
      setPlaybackQueue,
      setPlayerError,
      playerSource,
      setPlayerTimeSec,
      setPlayerIsPlaying,
      setPlaybackPlaying,
      playerAudioRef,
      playerTrackId: overrides.playerTrackId ?? "track-2",
      autoplayRequestSourceKey,
      queueIndex: overrides.queueIndex ?? 1,
      pushPlaybackTrackChangeRequest,
      onNotice,
      playerAudioSrc: "blob:track-2",
      setAutoplayRequestSourceKey
    });

    return { autoplayRequestSourceKey };
  });

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
    }
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
    expect(mocks.setPlaybackPlaying.mock.calls).toEqual([[true]]);
  });

  it("still arms native playback without autoplay for manual track selection", async () => {
    const { mocks } = buildHookHarness();

    await waitFor(() => {
      expect(mocks.pushPlaybackTrackChangeRequest).toHaveBeenCalledWith(1);
    });

    expect(mocks.pushPlaybackTrackChangeRequest).toHaveBeenCalledTimes(1);
    expect(mocks.setPlaybackPlaying).not.toHaveBeenCalledWith(true);
  });
});



