import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  catalogCancelIngestJob,
  catalogUpdateTrackMetadata,
  catalogListTracks,
  initExclusiveDevice,
  qcPreparePreviewSession,
  qcStartBatchExport,
  seekPlaybackRatio,
  setPlaybackQueue,
  setPlaybackVolume
} from "./tauri-api";

const invokeMock = vi.fn();

describe("tauri-api boundary validation", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    window.__TAURI__ = {
      core: {
        invoke: invokeMock
      }
    };
  });

  it("rejects invalid playback volume range before invoke", async () => {
    await expect(setPlaybackVolume(1.5)).rejects.toMatchObject({
      code: "INVALID_ARGUMENT"
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rejects invalid seek ratio before invoke", async () => {
    await expect(seekPlaybackRatio(-0.1)).rejects.toMatchObject({
      code: "INVALID_ARGUMENT"
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rejects oversized playback queue payload before invoke", async () => {
    const oversized = Array.from({ length: 10_001 }, (_, index) => `C:/Music/Track-${index}.wav`);
    await expect(setPlaybackQueue(oversized)).rejects.toMatchObject({
      code: "INVALID_ARGUMENT"
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rejects invalid preview session input before invoke", async () => {
    await expect(
      qcPreparePreviewSession({
        source_track_id: "a".repeat(64),
        profile_a_id: "spotify_vorbis_320",
        profile_b_id: "spotify_vorbis_320",
        blind_x_enabled: false
      })
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT"
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rejects invalid batch export payload before invoke", async () => {
    await expect(
      qcStartBatchExport({
        source_track_id: "a".repeat(64),
        profile_ids: ["spotify_vorbis_320"],
        output_dir: " ",
        target_integrated_lufs: -14
      })
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT"
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rejects oversized catalog search text before invoke", async () => {
    await expect(
      catalogListTracks({
        search: "x".repeat(513),
        limit: 100,
        offset: 0
      })
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT"
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rejects invalid catalog metadata payload before invoke", async () => {
    await expect(
      catalogUpdateTrackMetadata({
        track_id: "a".repeat(64),
        visibility_policy: "LOCAL",
        license_policy: "CC_BY",
        downloadable: true,
        tags: ["valid", ""]
      })
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT"
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rejects invalid ingest job id before cancel invoke", async () => {
    await expect(catalogCancelIngestJob("not-a-job-id")).rejects.toMatchObject({
      code: "INVALID_ARGUMENT"
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("invokes runtime for valid exclusive device input", async () => {
    invokeMock.mockResolvedValue({
      sample_rate_hz: 48_000,
      bit_depth: 16,
      buffer_size_frames: 256,
      is_exclusive_lock: true
    });

    const state = await initExclusiveDevice(48_000, 16);
    expect(invokeMock).toHaveBeenCalledWith("init_exclusive_device", {
      targetRateHz: 48_000,
      targetBitDepth: 16
    });
    expect(state.sample_rate_hz).toBe(48_000);
  });

  it("invokes runtime for valid catalog metadata payload", async () => {
    invokeMock.mockResolvedValue({
      track_id: "a".repeat(64),
      media_asset_id: "b".repeat(64),
      title: "Track",
      artist_id: "c".repeat(64),
      artist_name: "Artist",
      album_id: null,
      album_title: null,
      file_path: "C:/Music/Track.wav",
      media_fingerprint: "d".repeat(64),
      track: {
        file_path: "C:/Music/Track.wav",
        duration_ms: 1000,
        peak_data: [-1, -2],
        loudness_lufs: -14
      },
      sample_rate_hz: 48000,
      channels: 2,
      true_peak_dbfs: -1,
      visibility_policy: "LOCAL",
      license_policy: "CC_BY",
      downloadable: true,
      tags: ["tag_a"],
      created_at: "2026-03-01T00:00:00Z",
      updated_at: "2026-03-01T00:00:00Z"
    });

    await catalogUpdateTrackMetadata({
      track_id: "A".repeat(64),
      visibility_policy: "LOCAL",
      license_policy: "CC_BY",
      downloadable: true,
      tags: [" tag_a "]
    });

    expect(invokeMock).toHaveBeenCalledWith("catalog_update_track_metadata", {
      input: {
        track_id: "a".repeat(64),
        visibility_policy: "LOCAL",
        license_policy: "CC_BY",
        downloadable: true,
        tags: ["tag_a"]
      }
    });
  });

  it("invokes runtime for valid ingest job cancellation", async () => {
    invokeMock.mockResolvedValue(true);
    await catalogCancelIngestJob("A".repeat(64));
    expect(invokeMock).toHaveBeenCalledWith("catalog_cancel_ingest_job", {
      jobId: "a".repeat(64)
    });
  });
});
