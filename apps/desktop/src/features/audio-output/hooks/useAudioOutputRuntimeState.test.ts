import React, { type PropsWithChildren } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TauriClientProvider, type TauriClient } from "../../../services/tauri/TauriClientProvider";
import type { PlaybackContextState } from "../../../services/tauri/tauriClient";
import type { AudioOutputTransportHandshake } from "../../player-transport/api";
import { useAudioOutputRuntimeState } from "./useAudioOutputRuntimeState";

const mockInitExclusiveDevice = vi.fn();
const mockSetPlaybackVolume = vi.fn();
const mockSetPlaybackQueue = vi.fn();
const mockGetPlaybackContext = vi.fn();
const mockIsUiAppError = vi.fn((value: unknown) => {
  return Boolean(
    value &&
      typeof value === "object" &&
      "code" in (value as Record<string, unknown>) &&
      "message" in (value as Record<string, unknown>)
  );
});

const mockClient = {
  initExclusiveDevice: mockInitExclusiveDevice,
  setPlaybackVolume: mockSetPlaybackVolume,
  setPlaybackQueue: mockSetPlaybackQueue,
  getPlaybackContext: mockGetPlaybackContext,
  isUiAppError: mockIsUiAppError
} as unknown as TauriClient;

function wrapper({ children }: PropsWithChildren) {
  return React.createElement(TauriClientProvider, { client: mockClient, children });
}

async function flushPromises() {
  for (let i = 0; i < 6; i += 1) {    await Promise.resolve();
  }
}

function makePlaybackContext(overrides: Partial<PlaybackContextState> = {}): PlaybackContextState {
  return {
    volume_scalar: 1,
    is_bit_perfect_bypassed: true,
    output_status: {
      requested_mode: "shared",
      active_mode: "shared",
      sample_rate_hz: 48000,
      bit_depth: 24,
      bit_perfect_eligible: false,
      reasons: ["Exclusive output mode is not active."]
    },
    active_queue_index: 0,
    is_queue_ui_expanded: false,
    queued_track_change_requests: 0,
    is_playing: false,
    position_seconds: 0,
    track_duration_seconds: 0,
    ...overrides
  };
}

function makeHandshake(overrides: Partial<AudioOutputTransportHandshake> = {}): AudioOutputTransportHandshake {
  return {
    getDesiredOutputConfig: () => ({ sampleRateHz: 48000, bitDepth: 24 }),
    getQueueSnapshot: () => ({ paths: ["C:/music/a.wav"], activeIndex: 0, hasPlayerSource: true }),
    getNowPlayingVolumeScalar: () => 0.8,
    getIsPlaying: () => false,
    pauseForModeSwitch: vi.fn(async () => undefined),
    rearmCurrentTrackForNativePlayback: vi.fn(async () => false),
    resumeNativePlayback: vi.fn(async () => undefined),
    applyPlaybackContext: vi.fn(),
    setNativeTransportEnabled: vi.fn(),
    setNativeTransportChecked: vi.fn(),
    fallbackToBrowserShared: vi.fn(),
    setPlayerError: vi.fn(),
    ...overrides
  };
}

describe("useAudioOutputRuntimeState handshake contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitExclusiveDevice.mockResolvedValue({
      sample_rate_hz: 48000,
      bit_depth: 24,
      buffer_size_frames: 1024,
      is_exclusive_lock: false
    });
    mockSetPlaybackVolume.mockResolvedValue(undefined);
    mockSetPlaybackQueue.mockResolvedValue({ total_tracks: 1 });
    mockGetPlaybackContext.mockResolvedValue(makePlaybackContext());
  });

  it("boots in shared mode and uses transport handshake snapshot for init", async () => {
    const handshake = makeHandshake();

    renderHook(
      () =>
        useAudioOutputRuntimeState({
          transport: handshake,
          nativeTransportEnabled: false,
          nativeTransportChecked: false,
          latestPlaybackContext: null,
          onNotice: vi.fn()
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(handshake.setNativeTransportChecked).toHaveBeenCalledWith(true);
    });

    expect(mockInitExclusiveDevice).toHaveBeenCalledWith(48000, 24, false);
    expect(mockSetPlaybackVolume).toHaveBeenCalledWith(0.8);
    expect(mockSetPlaybackQueue).toHaveBeenCalledWith(["C:/music/a.wav"]);
    expect(handshake.setNativeTransportEnabled).toHaveBeenCalledWith(true);
  });

  it("falls back to shared when explicit exclusive acquisition fails", async () => {
    const handshake = makeHandshake();
    const onNotice = vi.fn();

    mockInitExclusiveDevice
      .mockResolvedValueOnce({
        sample_rate_hz: 48000,
        bit_depth: 24,
        buffer_size_frames: 1024,
        is_exclusive_lock: false
      })
      .mockRejectedValueOnce({ code: "EXCLUSIVE_AUDIO_UNAVAILABLE", message: "exclusive denied" })
      .mockResolvedValueOnce({
        sample_rate_hz: 48000,
        bit_depth: 24,
        buffer_size_frames: 1024,
        is_exclusive_lock: false
      });

    const { result } = renderHook(
      () =>
        useAudioOutputRuntimeState({
          transport: handshake,
          nativeTransportEnabled: false,
          nativeTransportChecked: false,
          latestPlaybackContext: null,
          onNotice
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(handshake.setNativeTransportChecked).toHaveBeenCalled();
    });

    await act(async () => {
      result.current.requestPlaybackOutputMode("exclusive");
      await flushPromises();
    });

    await waitFor(() => {
      expect(onNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warning",
        message: expect.stringContaining("Exclusive mode could not be acquired")
      })
      );
    });
    expect(mockInitExclusiveDevice).toHaveBeenNthCalledWith(2, 48000, 24, true);
    expect(mockInitExclusiveDevice).toHaveBeenNthCalledWith(3, 48000, 24, false);
  });
  it("does not emit exclusive-acquire warning when post-init queue sync fails", async () => {
    const setPlayerError = vi.fn();
    const handshake = makeHandshake({ setPlayerError });
    const onNotice = vi.fn();

    mockInitExclusiveDevice
      .mockResolvedValueOnce({
        sample_rate_hz: 48000,
        bit_depth: 24,
        buffer_size_frames: 1024,
        is_exclusive_lock: false
      })
      .mockResolvedValueOnce({
        sample_rate_hz: 48000,
        bit_depth: 24,
        buffer_size_frames: 1024,
        is_exclusive_lock: true
      });
    mockSetPlaybackQueue
      .mockResolvedValueOnce({ total_tracks: 1 })
      .mockRejectedValueOnce({
        code: "PLAYBACK_QUEUE_REQUEST_REJECTED",
        message: "queue sync failed"
      });

    const { result } = renderHook(
      () =>
        useAudioOutputRuntimeState({
          transport: handshake,
          nativeTransportEnabled: false,
          nativeTransportChecked: false,
          latestPlaybackContext: null,
          onNotice
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(handshake.setNativeTransportChecked).toHaveBeenCalled();
    });

    await act(async () => {
      result.current.requestPlaybackOutputMode("exclusive");
      await flushPromises();
    });

    const messages = onNotice.mock.calls.map(([notice]) => notice?.message ?? "");
    expect(messages.some((message) => String(message).includes("could not be acquired"))).toBe(false);
    expect(setPlayerError).toHaveBeenCalledWith(
      expect.stringContaining("synchronization failed")
    );
    expect(mockInitExclusiveDevice).toHaveBeenCalledTimes(2);
    expect(mockInitExclusiveDevice).toHaveBeenNthCalledWith(2, 48000, 24, true);
  });
});


