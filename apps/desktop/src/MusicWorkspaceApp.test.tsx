import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauriApiMocks = vi.hoisted(() => ({
  catalogAddLibraryRoot: vi.fn(),
  catalogCancelIngestJob: vi.fn(),
  catalogGetIngestJob: vi.fn(),
  catalogGetTrack: vi.fn(),
  catalogImportFiles: vi.fn(),
  catalogListTracks: vi.fn(),
  catalogListLibraryRoots: vi.fn(),
  catalogRemoveLibraryRoot: vi.fn(),
  catalogResetLibraryData: vi.fn(),
  catalogScanRoot: vi.fn(),
  catalogUpdateTrackMetadata: vi.fn(),
  getPlaybackContext: vi.fn(),
  getPlaybackDecodeError: vi.fn(),
  initExclusiveDevice: vi.fn(),
  pickDirectoryDialog: vi.fn(),
  qcGetFeatureFlags: vi.fn(),
  qcGetActivePreviewMedia: vi.fn(),
  qcGetBatchExportJobStatus: vi.fn(),
  qcGetPreviewSession: vi.fn(),
  qcListCodecProfiles: vi.fn(),
  qcPreparePreviewSession: vi.fn(),
  qcRevealBlindX: vi.fn(),
  qcSetPreviewVariant: vi.fn(),
  qcStartBatchExport: vi.fn(),
  pushPlaybackTrackChangeRequest: vi.fn(),
  seekPlaybackRatio: vi.fn(),
  setPlaybackPlaying: vi.fn(),
  setPlaybackQueue: vi.fn(),
  setPlaybackVolume: vi.fn(),
  togglePlaybackQueueVisibility: vi.fn(),
  publisherCreateDraftFromTrack: vi.fn()
}));

const webviewMocks = vi.hoisted(() => {
  let dragDropHandler: ((event: { payload: { type: string; paths: string[] } }) => void) | null = null;
  return {
    getCurrentWebview: vi.fn(() => ({
      onDragDropEvent: vi.fn(async (handler: (event: { payload: { type: string; paths: string[] } }) => void) => {
        dragDropHandler = handler;
        return () => {
          if (dragDropHandler === handler) {
            dragDropHandler = null;
          }
        };
      })
    })),
    emitDrop: (paths: string[]) => {
      dragDropHandler?.({
        payload: {
          type: "drop",
          paths
        }
      });
    }
  };
});

vi.mock("./App", () => ({
  default: (props: {
    prefillMediaPath?: string | null;
    prefillSpecPath?: string | null;
    externalRequestedScreen?: string | null;
    onScreenChange?: ((screen: string) => void) | null;
  }) => (
    <div data-testid="publisher-ops-mock">
      Publisher Ops Mock
      <span data-testid="publisher-ops-prefill-media">{props.prefillMediaPath ?? ""}</span>
      <span data-testid="publisher-ops-prefill-spec">{props.prefillSpecPath ?? ""}</span>
      <span data-testid="publisher-ops-requested-screen">{props.externalRequestedScreen ?? ""}</span>
      <button type="button" onClick={() => props.onScreenChange?.("Execute")}>
        Mock Sync Execute
      </button>
    </div>
  )
}));

vi.mock("./QcPlayer", () => ({
  QcPlayer: () => <div data-testid="qc-player-mock">QC Player Mock</div>
}));

vi.mock("./services/tauriClient", () => tauriApiMocks);
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: webviewMocks.getCurrentWebview
}));

import MusicWorkspaceApp from "./MusicWorkspaceApp";
import { DEFAULT_SHORTCUT_BINDINGS } from "./shortcuts";

const originalConsoleError = console.error.bind(console);

const baseTrackListItem = {
  track_id: "a".repeat(64),
  title: "Authoring Track",
  artist_name: "Artist Editor",
  album_title: null,
  duration_ms: 1500,
  loudness_lufs: -14.2,
  file_path: "C:/Music/Artist Editor - Authoring Track.wav",
  media_fingerprint: "b".repeat(64),
  updated_at: "2026-02-26T12:00:00Z"
};

const baseTrackDetail = {
  track_id: "a".repeat(64),
  media_asset_id: "c".repeat(64),
  title: "Authoring Track",
  artist_id: "d".repeat(64),
  artist_name: "Artist Editor",
  album_id: null,
  album_title: null,
  file_path: "C:/Music/Artist Editor - Authoring Track.wav",
  media_fingerprint: "b".repeat(64),
  track: {
    file_path: "C:/Music/Artist Editor - Authoring Track.wav",
    duration_ms: 1500,
    peak_data: [-12, -8, -6, -7],
    loudness_lufs: -14.2
  },
  sample_rate_hz: 48000,
  channels: 1,
  true_peak_dbfs: -1.2,
  visibility_policy: "LOCAL",
  license_policy: "ALL_RIGHTS_RESERVED",
  downloadable: false,
  tags: ["ambient"],
  created_at: "2026-02-26T12:00:00Z",
  updated_at: "2026-02-26T12:00:00Z"
};

const secondTrackListItem = {
  track_id: "f".repeat(64),
  title: "Queue Candidate",
  artist_name: "Artist Editor",
  album_title: "Night Session",
  duration_ms: 2400,
  loudness_lufs: -12.1,
  file_path: "C:/Music/Artist Editor - Queue Candidate.wav",
  media_fingerprint: "1".repeat(64),
  updated_at: "2026-02-26T12:01:00Z"
};

const secondTrackDetail = {
  ...baseTrackDetail,
  track_id: secondTrackListItem.track_id,
  media_asset_id: "2".repeat(64),
  title: secondTrackListItem.title,
  album_title: secondTrackListItem.album_title,
  file_path: secondTrackListItem.file_path,
  media_fingerprint: secondTrackListItem.media_fingerprint,
  track: {
    ...baseTrackDetail.track,
    file_path: secondTrackListItem.file_path,
    duration_ms: secondTrackListItem.duration_ms,
    loudness_lufs: secondTrackListItem.loudness_lufs
  },
  tags: ["night"],
  updated_at: "2026-02-26T12:01:00Z"
};

function installCatalogApiHappyDefaults() {
  tauriApiMocks.initExclusiveDevice.mockRejectedValue({
    code: "TAURI_UNAVAILABLE",
    message: "Native playback transport unavailable in test runtime."
  });
  tauriApiMocks.setPlaybackVolume.mockResolvedValue(undefined);
  tauriApiMocks.setPlaybackQueue.mockResolvedValue({ total_tracks: 0 });
  tauriApiMocks.pushPlaybackTrackChangeRequest.mockResolvedValue(true);
  tauriApiMocks.setPlaybackPlaying.mockResolvedValue(undefined);
  tauriApiMocks.seekPlaybackRatio.mockResolvedValue(undefined);
  tauriApiMocks.getPlaybackContext.mockResolvedValue({
    volume_scalar: 1,
    is_bit_perfect_bypassed: true,
    active_queue_index: 0,
    is_queue_ui_expanded: false,
    queued_track_change_requests: 0,
    is_playing: false,
    position_seconds: 0,
    track_duration_seconds: 0
  });
  tauriApiMocks.getPlaybackDecodeError.mockResolvedValue(null);
  tauriApiMocks.togglePlaybackQueueVisibility.mockResolvedValue(undefined);
  tauriApiMocks.qcGetFeatureFlags.mockResolvedValue({
    qc_codec_preview_v1: false,
    qc_realtime_meters_v1: false,
    qc_batch_export_v1: false
  });
  tauriApiMocks.qcListCodecProfiles.mockResolvedValue([]);
  tauriApiMocks.qcGetPreviewSession.mockResolvedValue(null);
  tauriApiMocks.qcGetActivePreviewMedia.mockRejectedValue({
    code: "FEATURE_DISABLED",
    message: "QC codec preview is disabled in this build"
  });
  tauriApiMocks.qcGetBatchExportJobStatus.mockResolvedValue(null);
  tauriApiMocks.qcPreparePreviewSession.mockRejectedValue({
    code: "FEATURE_DISABLED",
    message: "QC codec preview is disabled in this build"
  });
  tauriApiMocks.qcSetPreviewVariant.mockRejectedValue({
    code: "FEATURE_DISABLED",
    message: "QC codec preview is disabled in this build"
  });
  tauriApiMocks.qcRevealBlindX.mockRejectedValue({
    code: "FEATURE_DISABLED",
    message: "QC codec preview is disabled in this build"
  });
  tauriApiMocks.qcStartBatchExport.mockRejectedValue({
    code: "FEATURE_DISABLED",
    message: "QC batch export is disabled in this build"
  });
  tauriApiMocks.catalogListLibraryRoots.mockResolvedValue([]);
  tauriApiMocks.catalogListTracks.mockResolvedValue({
    items: [baseTrackListItem],
    total: 1,
    limit: 100,
    offset: 0
  });
  tauriApiMocks.catalogGetTrack.mockImplementation(async (trackId: string) => {
    if (trackId === secondTrackDetail.track_id) return { ...secondTrackDetail };
    return { ...baseTrackDetail };
  });
  tauriApiMocks.catalogGetIngestJob.mockResolvedValue(null);
  tauriApiMocks.catalogCancelIngestJob.mockResolvedValue(true);
  tauriApiMocks.catalogAddLibraryRoot.mockResolvedValue({
    root_id: "e".repeat(64),
    path: "C:/Music",
    enabled: true,
    created_at: "2026-02-26T12:00:00Z",
    updated_at: "2026-02-26T12:00:00Z"
  });
  tauriApiMocks.catalogRemoveLibraryRoot.mockResolvedValue(true);
  tauriApiMocks.catalogResetLibraryData.mockResolvedValue(true);
  tauriApiMocks.catalogScanRoot.mockResolvedValue({
    job_id: "f".repeat(64),
    root_id: "e".repeat(64)
  });
  tauriApiMocks.catalogImportFiles.mockResolvedValue({ imported: [], failed: [] });
  tauriApiMocks.publisherCreateDraftFromTrack.mockResolvedValue({
    draft_id: "1".repeat(64),
    source_track_id: baseTrackDetail.track_id,
    media_path: baseTrackDetail.file_path,
    spec_path: "C:/tmp/release_spec.yaml",
    spec: {
      title: baseTrackDetail.title,
      artist: baseTrackDetail.artist_name,
      description: "Generated",
      tags: ["ambient"]
    },
    spec_yaml: "title: Authoring Track\nartist: Artist Editor\n"
  });
}

function installTwoTrackCatalog() {
  tauriApiMocks.catalogListTracks.mockResolvedValue({
    items: [baseTrackListItem, secondTrackListItem],
    total: 2,
    limit: 100,
    offset: 0
  });
  tauriApiMocks.catalogGetTrack.mockImplementation(async (trackId: string) => {
    if (trackId === secondTrackDetail.track_id) return { ...secondTrackDetail };
    return { ...baseTrackDetail };
  });
}

function installTwoTrackSingleAlbumCatalog() {
  const albumTitle = "Night Session";
  const albumTrackA = {
    ...baseTrackListItem,
    album_title: albumTitle
  };
  const albumTrackB = {
    ...secondTrackListItem,
    album_title: albumTitle
  };
  const albumDetailA = {
    ...baseTrackDetail,
    track_id: albumTrackA.track_id,
    title: albumTrackA.title,
    album_title: albumTitle,
    file_path: albumTrackA.file_path,
    media_fingerprint: albumTrackA.media_fingerprint,
    track: {
      ...baseTrackDetail.track,
      file_path: albumTrackA.file_path,
      duration_ms: albumTrackA.duration_ms,
      loudness_lufs: albumTrackA.loudness_lufs
    }
  };
  const albumDetailB = {
    ...secondTrackDetail,
    album_title: albumTitle
  };
  tauriApiMocks.catalogListTracks.mockResolvedValue({
    items: [albumTrackA, albumTrackB],
    total: 2,
    limit: 100,
    offset: 0
  });
  tauriApiMocks.catalogGetTrack.mockImplementation(async (trackId: string) => {
    if (trackId === albumTrackB.track_id) return { ...albumDetailB };
    return { ...albumDetailA };
  });
}

function createMockDataTransfer(seed?: Record<string, string>): DataTransfer {
  const store = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    setData: (format: string, data: string) => {
      store.set(format, data);
    },
    getData: (format: string) => store.get(format) ?? "",
    effectAllowed: "all",
    dropEffect: "move"
  } as unknown as DataTransfer;
}

async function openTracksAndSelectFirstTrack() {
  fireEvent.click(screen.getByRole("button", { name: "Quality Control" }));
  const trackRow = await screen.findByRole("button", { name: /^Authoring Track/i });
  fireEvent.click(trackRow);
  await screen.findByRole("heading", { name: "Authoring Track" });
}

async function openAlbumQcMode() {
  fireEvent.click(screen.getByRole("button", { name: "Quality Control" }));
  fireEvent.click(await screen.findByRole("tab", { name: "Album QC" }));
}

describe("MusicWorkspaceApp metadata editor", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      const first = String(args[0] ?? "");
      if (first.includes("Maximum update depth exceeded")) {
        originalConsoleError(...args);
        throw new Error(first);
      }
      originalConsoleError(...args);
    });
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    window.localStorage.clear();
    delete window.__TAURI__;
    Object.values(tauriApiMocks).forEach((mockFn) => mockFn.mockReset());
    webviewMocks.getCurrentWebview.mockClear();
    installCatalogApiHappyDefaults();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("saves track metadata and shows a success notice", async () => {
    tauriApiMocks.catalogUpdateTrackMetadata.mockResolvedValue({
      ...baseTrackDetail,
      visibility_policy: "PRIVATE",
      license_policy: "CC_BY",
      downloadable: true,
      tags: ["ambient", "late night"],
      updated_at: "2026-02-26T12:05:00Z"
    });

    render(<MusicWorkspaceApp />);
    await openTracksAndSelectFirstTrack();
    fireEvent.click(screen.getByRole("button", { name: "Edit Metadata" }));

    fireEvent.change(screen.getByLabelText("Tags"), {
      target: { value: "ambient, late night, ambient" }
    });
    fireEvent.change(screen.getByLabelText("Visibility"), {
      target: { value: "PRIVATE" }
    });
    fireEvent.change(screen.getByLabelText("License"), {
      target: { value: "CC_BY" }
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Downloadable in future publish\/export workflows/i
      })
    );

    const saveButton = screen.getByRole("button", { name: "Save Metadata" });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(tauriApiMocks.catalogUpdateTrackMetadata).toHaveBeenCalledWith({
        track_id: baseTrackDetail.track_id,
        visibility_policy: "PRIVATE",
        license_policy: "CC_BY",
        downloadable: true,
        tags: ["ambient", "late night"]
      });
    });

    expect(await screen.findByText("Track metadata saved.")).toBeInTheDocument();
    expect(screen.getAllByText("PRIVATE").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CC_BY").length).toBeGreaterThan(0);
  });

  it("shows a backend error when metadata save fails", async () => {
    tauriApiMocks.catalogUpdateTrackMetadata.mockRejectedValue({
      code: "INVALID_ARGUMENT",
      message: "tag labels exceed maximum length"
    });

    render(<MusicWorkspaceApp />);
    await openTracksAndSelectFirstTrack();
    fireEvent.click(screen.getByRole("button", { name: "Edit Metadata" }));

    fireEvent.change(screen.getByLabelText("Tags"), {
      target: { value: "ambient, this_tag_will_fail" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Metadata" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("INVALID_ARGUMENT");
    expect(alert).toHaveTextContent("tag labels exceed maximum length");
  });

  it("keeps Track Detail metadata editing in a single panel with header save/cancel/reset actions", async () => {
    const view = render(<MusicWorkspaceApp />);
    await openTracksAndSelectFirstTrack();

    fireEvent.click(screen.getByRole("button", { name: "Edit Metadata" }));
    fireEvent.change(screen.getByLabelText("Tags"), {
      target: { value: "ambient, edited" }
    });

    expect(screen.getByText("Edit mode")).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Metadata" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset Fields" })).toBeInTheDocument();

    expect(screen.queryByText(/Inline edit mode \(local catalog only\)/i)).not.toBeInTheDocument();
    expect(view.container.querySelector(".track-detail-inline-reset")).toBeNull();
    expect(view.container.querySelector(".track-meta-grid .track-meta-tags-panel")).not.toBeNull();
  });

  it("supports multi-select batch actions in Tracks", async () => {
    installTwoTrackCatalog();
    render(<MusicWorkspaceApp />);
    fireEvent.click(screen.getByRole("button", { name: "Quality Control" }));

    fireEvent.click(await screen.findByRole("checkbox", { name: `Select ${baseTrackListItem.title} for batch actions` }));
    fireEvent.click(screen.getByRole("checkbox", { name: `Select ${secondTrackListItem.title} for batch actions` }));

    expect(screen.getByRole("button", { name: "Add Selection to Queue" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add Selection to Queue" }));

    const queueNotice = await screen.findByText("Added 2 tracks to queue.");
    const topNotification = queueNotice.closest(".app-notification");
    expect(topNotification).not.toBeNull();
    expect(within(topNotification as HTMLElement).getByText("Success")).toBeInTheDocument();
    const dismissNoticeButton = within(topNotification as HTMLElement).getByRole("button", { name: /Dismiss/i });
    fireEvent.click(dismissNoticeButton);
    await waitFor(() => {
      expect(screen.queryByText("Added 2 tracks to queue.")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("tab", { name: "Queue" }));
    const queueList = screen.getByRole("list", { name: "Queue tracks" });
    expect(within(queueList).getByText(baseTrackListItem.title)).toBeInTheDocument();
    expect(within(queueList).getByText(secondTrackListItem.title)).toBeInTheDocument();
  });

  it("keeps selected-track playback actions in Track Detail instead of duplicating them in the Tracks toolbar", async () => {
    render(<MusicWorkspaceApp />);
    await openTracksAndSelectFirstTrack();

    expect(screen.queryByRole("group", { name: "Selected track actions" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play Now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to Queue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play Next" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Tracks view actions" })).toBeInTheDocument();
  });

  it("shows codec preview panel with disabled-build guidance when feature flag is off", async () => {
    render(<MusicWorkspaceApp />);
    await openTracksAndSelectFirstTrack();

    expect(screen.getByRole("heading", { name: "A/B and Blind-X Session" })).toBeInTheDocument();
    expect(screen.getByText(/Codec preview is disabled in this build/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Multi-Profile Export Queue" })).toBeInTheDocument();
    expect(screen.getByText(/Batch export is disabled in this build/i)).toBeInTheDocument();
  });

  it("keeps blind-x identity hidden until reveal and updates session state on reveal", async () => {
    let blindXEnabled = false;
    let blindXRevealed = true;

    tauriApiMocks.qcGetFeatureFlags.mockResolvedValue({
      qc_codec_preview_v1: true,
      qc_realtime_meters_v1: false,
      qc_batch_export_v1: false
    });
    tauriApiMocks.qcListCodecProfiles.mockResolvedValue([
      {
        profile_id: "spotify_vorbis_320",
        label: "Spotify Vorbis 320 kbps",
        codec_family: "vorbis",
        target_platform: "Spotify",
        target_bitrate_kbps: 320,
        expected_latency_ms: 38,
        available: true
      },
      {
        profile_id: "apple_music_aac_256",
        label: "Apple Music AAC 256 kbps",
        codec_family: "aac",
        target_platform: "Apple Music",
        target_bitrate_kbps: 256,
        expected_latency_ms: 34,
        available: true
      }
    ]);
    tauriApiMocks.qcGetPreviewSession.mockResolvedValue(null);
    tauriApiMocks.qcPreparePreviewSession.mockImplementation(async (input) => {
      blindXEnabled = input.blind_x_enabled;
      blindXRevealed = !input.blind_x_enabled;
      return {
        source_track_id: input.source_track_id,
        active_variant: input.blind_x_enabled ? "blind_x" : "bypass",
        profile_a_id: input.profile_a_id,
        profile_b_id: input.profile_b_id,
        blind_x_enabled: input.blind_x_enabled,
        blind_x_revealed: !input.blind_x_enabled
      };
    });
    tauriApiMocks.qcGetActivePreviewMedia.mockImplementation(async () => {
      if (!blindXEnabled) {
        return {
          variant: "bypass",
          media_path: baseTrackDetail.file_path,
          blind_x_resolved_variant: null
        };
      }
      return {
        variant: "blind_x",
        media_path: blindXRevealed ? "C:/QC/preview-codec-b.m4a" : "C:/QC/preview-codec-a.ogg",
        blind_x_resolved_variant: blindXRevealed ? "codec_b" : null
      };
    });
    tauriApiMocks.qcRevealBlindX.mockImplementation(async () => {
      blindXEnabled = true;
      blindXRevealed = true;
      return {
        source_track_id: baseTrackDetail.track_id,
        active_variant: "blind_x",
        profile_a_id: "spotify_vorbis_320",
        profile_b_id: "apple_music_aac_256",
        blind_x_enabled: true,
        blind_x_revealed: true
      };
    });

    render(<MusicWorkspaceApp />);
    await openTracksAndSelectFirstTrack();

    const blindXToggle = await screen.findByRole("checkbox", {
      name: /Enable Blind-X mode \(identity hidden until reveal\)/i
    });
    fireEvent.click(blindXToggle);

    await waitFor(() => {
      expect(tauriApiMocks.qcPreparePreviewSession).toHaveBeenLastCalledWith(
        expect.objectContaining({
          source_track_id: baseTrackDetail.track_id,
          blind_x_enabled: true
        })
      );
    });
    expect(
      await screen.findByText((content) => content.replace(/\s+/g, " ").includes("Blind-X: hidden"))
    ).toBeInTheDocument();

    const revealButton = screen.getByRole("button", { name: "Reveal" });
    expect(revealButton).toBeEnabled();
    fireEvent.click(revealButton);

    await waitFor(() => {
      expect(tauriApiMocks.qcRevealBlindX).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByText((content) => content.replace(/\s+/g, " ").includes("Blind-X: revealed"))
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reveal" })).toBeDisabled();
    });
  });

  it("submits a batch export request from Track QC when feature flags are enabled", async () => {
    tauriApiMocks.qcGetFeatureFlags.mockResolvedValue({
      qc_codec_preview_v1: true,
      qc_realtime_meters_v1: false,
      qc_batch_export_v1: true
    });
    tauriApiMocks.qcListCodecProfiles.mockResolvedValue([
      {
        profile_id: "spotify_vorbis_320",
        label: "Spotify Vorbis 320 kbps",
        codec_family: "vorbis",
        target_platform: "Spotify",
        target_bitrate_kbps: 320,
        expected_latency_ms: 38,
        available: true
      },
      {
        profile_id: "apple_music_aac_256",
        label: "Apple Music AAC 256 kbps",
        codec_family: "aac",
        target_platform: "Apple Music",
        target_bitrate_kbps: 256,
        expected_latency_ms: 34,
        available: true
      }
    ]);
    tauriApiMocks.qcGetPreviewSession.mockResolvedValue(null);
    tauriApiMocks.qcPreparePreviewSession.mockResolvedValue({
      source_track_id: baseTrackDetail.track_id,
      active_variant: "bypass",
      profile_a_id: "spotify_vorbis_320",
      profile_b_id: "apple_music_aac_256",
      blind_x_enabled: false,
      blind_x_revealed: true
    });
    tauriApiMocks.qcGetActivePreviewMedia.mockResolvedValue({
      variant: "bypass",
      media_path: baseTrackDetail.file_path,
      blind_x_resolved_variant: null
    });
    tauriApiMocks.qcStartBatchExport.mockResolvedValue({
      job_id: "job-export-001",
      status: "QUEUED",
      message: "queued"
    });

    render(<MusicWorkspaceApp />);
    await openTracksAndSelectFirstTrack();

    const outputDirInput = await screen.findByLabelText("Batch export output directory");
    fireEvent.change(outputDirInput, { target: { value: "C:/Exports/TestRun" } });
    const targetLufsInput = screen.getByLabelText("Batch export target LUFS");
    fireEvent.change(targetLufsInput, { target: { value: "-13.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Start Batch Export" }));

    await waitFor(() => {
      expect(tauriApiMocks.qcStartBatchExport).toHaveBeenCalledWith({
        source_track_id: baseTrackDetail.track_id,
        profile_ids: ["spotify_vorbis_320", "apple_music_aac_256"],
        output_dir: "C:/Exports/TestRun",
        target_integrated_lufs: -13.5
      });
    });
    expect(await screen.findByText("Batch export job queued: job-export-001")).toBeInTheDocument();
  });

  it("surfaces explicit failed batch-export status in the UI", async () => {
    tauriApiMocks.qcGetFeatureFlags.mockResolvedValue({
      qc_codec_preview_v1: true,
      qc_realtime_meters_v1: false,
      qc_batch_export_v1: true
    });
    tauriApiMocks.qcListCodecProfiles.mockResolvedValue([
      {
        profile_id: "spotify_vorbis_320",
        label: "Spotify Vorbis 320 kbps",
        codec_family: "vorbis",
        target_platform: "Spotify",
        target_bitrate_kbps: 320,
        expected_latency_ms: 38,
        available: true
      },
      {
        profile_id: "apple_music_aac_256",
        label: "Apple Music AAC 256 kbps",
        codec_family: "aac",
        target_platform: "Apple Music",
        target_bitrate_kbps: 256,
        expected_latency_ms: 34,
        available: true
      }
    ]);
    tauriApiMocks.qcGetPreviewSession.mockResolvedValue(null);
    tauriApiMocks.qcPreparePreviewSession.mockResolvedValue({
      source_track_id: baseTrackDetail.track_id,
      active_variant: "bypass",
      profile_a_id: "spotify_vorbis_320",
      profile_b_id: "apple_music_aac_256",
      blind_x_enabled: false,
      blind_x_revealed: true
    });
    tauriApiMocks.qcGetActivePreviewMedia.mockResolvedValue({
      variant: "bypass",
      media_path: baseTrackDetail.file_path,
      blind_x_resolved_variant: null
    });
    tauriApiMocks.qcStartBatchExport.mockResolvedValue({
      job_id: "job-export-failed-001",
      status: "QUEUED",
      message: "queued"
    });
    tauriApiMocks.qcGetBatchExportJobStatus.mockResolvedValue({
      job_id: "job-export-failed-001",
      source_track_id: baseTrackDetail.track_id,
      output_dir: "C:/Exports/FailedRun",
      requested_profile_ids: ["spotify_vorbis_320", "apple_music_aac_256"],
      requested_target_integrated_lufs: -14,
      status: "failed",
      progress_percent: 100,
      total_profiles: 2,
      completed_profiles: 0,
      failed_profiles: 2,
      created_at_unix_ms: 1,
      updated_at_unix_ms: 2,
      summary_path: "C:/Exports/FailedRun/summary.json",
      profiles: [
        {
          profile_id: "spotify_vorbis_320",
          codec_family: "vorbis",
          target_platform: "Spotify",
          target_bitrate_kbps: 320,
          status: "failed",
          progress_percent: 100,
          output_path: null,
          output_bytes: null,
          message: "ffmpeg executable not found in PATH"
        },
        {
          profile_id: "apple_music_aac_256",
          codec_family: "aac",
          target_platform: "Apple Music",
          target_bitrate_kbps: 256,
          status: "failed",
          progress_percent: 100,
          output_path: null,
          output_bytes: null,
          message: "ffmpeg executable not found in PATH"
        }
      ]
    });

    render(<MusicWorkspaceApp />);
    await openTracksAndSelectFirstTrack();

    fireEvent.change(await screen.findByLabelText("Batch export output directory"), {
      target: { value: "C:/Exports/FailedRun" }
    });
    fireEvent.change(screen.getByLabelText("Batch export target LUFS"), {
      target: { value: "-14.0" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Start Batch Export" }));

    await waitFor(() => {
      expect(tauriApiMocks.qcGetBatchExportJobStatus).toHaveBeenCalledWith("job-export-failed-001");
    });
    expect(await screen.findByText("Batch export failed.")).toBeInTheDocument();
    expect(
      await screen.findByText("Batch export failed: 0/2 completed, 2 failed (100%)")
    ).toBeInTheDocument();
  });

  it("switches shared playback source when codec preview variant changes", async () => {
    let activeVariant: "bypass" | "codec_a" | "codec_b" = "bypass";

    tauriApiMocks.qcGetFeatureFlags.mockResolvedValue({
      qc_codec_preview_v1: true,
      qc_realtime_meters_v1: false,
      qc_batch_export_v1: false
    });
    tauriApiMocks.qcListCodecProfiles.mockResolvedValue([
      {
        profile_id: "spotify_vorbis_320",
        label: "Spotify Vorbis 320 kbps",
        codec_family: "vorbis",
        target_platform: "Spotify",
        target_bitrate_kbps: 320,
        expected_latency_ms: 38,
        available: true
      },
      {
        profile_id: "apple_music_aac_256",
        label: "Apple Music AAC 256 kbps",
        codec_family: "aac",
        target_platform: "Apple Music",
        target_bitrate_kbps: 256,
        expected_latency_ms: 34,
        available: true
      }
    ]);
    tauriApiMocks.qcGetPreviewSession.mockResolvedValue(null);
    tauriApiMocks.qcPreparePreviewSession.mockImplementation(async (input) => ({
      source_track_id: input.source_track_id,
      active_variant: "bypass",
      profile_a_id: input.profile_a_id,
      profile_b_id: input.profile_b_id,
      blind_x_enabled: false,
      blind_x_revealed: true
    }));
    tauriApiMocks.qcSetPreviewVariant.mockImplementation(async (variant) => {
      if (variant === "codec_a" || variant === "codec_b" || variant === "bypass") {
        activeVariant = variant;
      }
      return {
        source_track_id: baseTrackDetail.track_id,
        active_variant: activeVariant,
        profile_a_id: "spotify_vorbis_320",
        profile_b_id: "apple_music_aac_256",
        blind_x_enabled: false,
        blind_x_revealed: true
      };
    });
    tauriApiMocks.qcGetActivePreviewMedia.mockImplementation(async () => {
      if (activeVariant === "codec_a") {
        return {
          variant: "codec_a",
          media_path: "C:/QC/preview-codec-a.ogg",
          blind_x_resolved_variant: null
        };
      }
      if (activeVariant === "codec_b") {
        return {
          variant: "codec_b",
          media_path: "C:/QC/preview-codec-b.m4a",
          blind_x_resolved_variant: null
        };
      }
      return {
        variant: "bypass",
        media_path: baseTrackDetail.file_path,
        blind_x_resolved_variant: null
      };
    });

    render(<MusicWorkspaceApp />);
    await openTracksAndSelectFirstTrack();

    fireEvent.click(screen.getByRole("button", { name: "Codec A" }));
    await waitFor(() => {
      expect(tauriApiMocks.qcSetPreviewVariant).toHaveBeenCalledWith("codec_a");
    });
    await waitFor(() => {
      const audio = document.querySelector(".persistent-player-bar audio");
      expect(audio?.getAttribute("src") ?? "").toContain("C:/QC/preview-codec-a.ogg");
    });

    fireEvent.click(screen.getByRole("button", { name: "Codec B" }));
    await waitFor(() => {
      expect(tauriApiMocks.qcSetPreviewVariant).toHaveBeenCalledWith("codec_b");
    });
    await waitFor(() => {
      const audio = document.querySelector(".persistent-player-bar audio");
      expect(audio?.getAttribute("src") ?? "").toContain("C:/QC/preview-codec-b.m4a");
    });
  });

  it("opens a row context menu and runs Play Now", async () => {
    installTwoTrackCatalog();
    render(<MusicWorkspaceApp />);
    fireEvent.click(screen.getByRole("button", { name: "Quality Control" }));

    const targetRowButton = await screen.findByRole("button", { name: /^Queue Candidate/i });
    fireEvent.contextMenu(targetRowButton);

    const menu = await screen.findByRole("menu", { name: /Actions for Queue Candidate/i });
    expect(within(menu).getByRole("menuitem", { name: "Play Now" })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Play Now" }));

    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: /Actions for Queue Candidate/i })).not.toBeInTheDocument();
    });
    expect(await screen.findByText("Playback started.")).toBeInTheDocument();
  });

  it("opens an album-track row context menu and shows the track in Tracks", async () => {
    installTwoTrackCatalog();
    render(<MusicWorkspaceApp />);
    await openAlbumQcMode();

    const albumRowMenuButton = await screen.findByRole("button", { name: "Open actions for Queue Candidate" });
    fireEvent.click(albumRowMenuButton);

    const menu = await screen.findByRole("menu", { name: /Actions for Queue Candidate/i });
    expect(within(menu).getByRole("menuitem", { name: "Show in Track QC" })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Show in Track QC" }));

    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: /Actions for Queue Candidate/i })).not.toBeInTheDocument();
    });
    expect(await screen.findByRole("heading", { name: "Queue Candidate" })).toBeInTheDocument();
  });

  it("supports album multi-select batch queue actions in Albums detail", async () => {
    installTwoTrackSingleAlbumCatalog();
    render(<MusicWorkspaceApp />);
    await openAlbumQcMode();

    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: `Select ${baseTrackListItem.title} for album batch actions`
      })
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: `Select ${secondTrackListItem.title} for album batch actions`
      })
    );

    const batchActions = screen.getByRole("group", { name: "Batch actions for selected album tracks" });
    expect(within(batchActions).getByText("2 selected")).toBeInTheDocument();
    expect(within(batchActions).getByRole("button", { name: "Add Selection to Queue" })).toBeInTheDocument();
    expect(within(batchActions).getByRole("button", { name: "Play Selection Next" })).toBeInTheDocument();

    fireEvent.click(within(batchActions).getByRole("button", { name: "Add Selection to Queue" }));
    expect(await screen.findByText("Added 2 tracks to queue.")).toBeInTheDocument();

    fireEvent.click(within(batchActions).getByRole("button", { name: "Play Selection Next" }));
    expect(await screen.findByText("Queued 2 selected tracks to play next.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Quality Control" }));
    fireEvent.click(screen.getByRole("tab", { name: "Track QC" }));
    fireEvent.click(screen.getByRole("tab", { name: "Queue" }));
    const queueList = screen.getByRole("list", { name: "Queue tracks" });
    expect(within(queueList).getByText(baseTrackListItem.title)).toBeInTheDocument();
    expect(within(queueList).getByText(secondTrackListItem.title)).toBeInTheDocument();
  });

  it("switches between Listen and Publish modes and filters the sidebar workspaces", async () => {
    render(<MusicWorkspaceApp />);

    expect(screen.getByRole("button", { name: "Library" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publisher Ops" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Publish" }));

    expect(await screen.findByRole("button", { name: "Publisher Ops" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Library" })).not.toBeInTheDocument();
    expect(screen.getByTestId("publisher-ops-mock")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Release Preview" }));

    expect(await screen.findByRole("button", { name: "Library" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publisher Ops" })).not.toBeInTheDocument();
  });

  it("shows a Publish step bar and syncs the requested Publisher Ops screen", async () => {
    render(<MusicWorkspaceApp />);

    fireEvent.click(screen.getByRole("tab", { name: "Publish" }));

    expect(await screen.findByRole("tablist", { name: "Publish workflow steps" })).toBeInTheDocument();
    expect(screen.getByTestId("publisher-ops-requested-screen")).toHaveTextContent("New Release");

    fireEvent.click(screen.getByRole("tab", { name: "Execute" }));
    expect(screen.getByTestId("publisher-ops-requested-screen")).toHaveTextContent("Execute");

    fireEvent.click(screen.getByRole("button", { name: "Mock Sync Execute" }));
    expect(await screen.findByTestId("publisher-ops-requested-screen")).toHaveTextContent("Execute");
  });

  it("splits Library ingest tools into Scan Folders and Import Files tabs with clearer labels", async () => {
    render(<MusicWorkspaceApp />);

    const ingestTabs = screen.getByRole("tablist", { name: "Library ingest sections" });
    expect(within(ingestTabs).getByRole("tab", { name: "Scan Folders" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Indexes files in-place. Does not copy audio files.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Folder" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Refresh Folders" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("textbox", { name: "Import file paths" })).not.toBeInTheDocument();

    fireEvent.click(within(ingestTabs).getByRole("tab", { name: "Import Files" }));

    expect(await screen.findByRole("textbox", { name: "Import file paths" })).toBeInTheDocument();
    expect(
      screen.getByText(/Manual ingest for explicit files only\. No folder root needs to be saved first\./i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/managed file-copy workflow is not enabled in this build/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import Files" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Folder" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Quality Control" }));
    expect(screen.queryByRole("tablist", { name: "Library ingest sections" })).not.toBeInTheDocument();
  });

  it("keeps the Listen queue separate from the Publish release selection dock", async () => {
    installTwoTrackCatalog();
    render(<MusicWorkspaceApp />);
    fireEvent.click(screen.getByRole("button", { name: "Quality Control" }));

    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: `Select ${secondTrackListItem.title} for batch actions`
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Play Selection" }));

    fireEvent.click(screen.getByRole("tab", { name: "Queue" }));
    let queueList = screen.getByRole("list", { name: "Queue tracks" });
    expect(within(queueList).getByText(secondTrackListItem.title)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Publish" }));

    const queueDock = await screen.findByLabelText("Queue and session state");
    expect(await within(queueDock).findByRole("heading", { name: "Release Selection" })).toBeInTheDocument();
    expect(within(queueDock).getByText("0 draft(s)")).toBeInTheDocument();
    expect(within(queueDock).getByText(/No tracks prepared yet\./i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Release Preview" }));
    fireEvent.click(await screen.findByRole("button", { name: "Quality Control" }));
    fireEvent.click(screen.getByRole("tab", { name: "Queue" }));
    queueList = screen.getByRole("list", { name: "Queue tracks" });
    expect(within(queueList).getByText(secondTrackListItem.title)).toBeInTheDocument();
  });

  it("adds prepared tracks to the Publish release selection when opening Publisher Ops", async () => {
    installTwoTrackCatalog();
    render(<MusicWorkspaceApp />);
    await openTracksAndSelectFirstTrack();

    fireEvent.click(
      screen.getByRole("button", {
        name: /Open in Publisher Ops|Prepare for Release|Open in Publish Workflow/i
      })
    );

    expect(await screen.findByTestId("publisher-ops-mock")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Publish" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("publisher-ops-prefill-media")).toHaveTextContent(baseTrackDetail.file_path);
    expect(screen.getByTestId("publisher-ops-prefill-spec")).toHaveTextContent("C:/tmp/release_spec.yaml");

    const queueDock = screen.getByLabelText("Queue and session state");
    expect(within(queueDock).getByRole("heading", { name: "Release Selection" })).toBeInTheDocument();
    expect(within(queueDock).getByText("1 draft(s)")).toBeInTheDocument();
    expect(within(queueDock).getByText(baseTrackListItem.title)).toBeInTheDocument();
    expect(within(queueDock).getByText(baseTrackListItem.artist_name)).toBeInTheDocument();
  });

  it("shows shared transport only in Release Preview mode", async () => {
    render(<MusicWorkspaceApp />);

    const transport = screen.getByRole("region", { name: "Shared transport" });
    expect(transport).toBeInTheDocument();
    expect(within(transport).getByRole("button", { name: "Play" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Quality Control" }));
    expect(screen.getByRole("region", { name: "Shared transport" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Publish" }));
    fireEvent.click(await screen.findByRole("button", { name: "Publisher Ops" }));
    expect(screen.queryByRole("region", { name: "Shared transport" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Release Preview" }));
    expect(await screen.findByRole("region", { name: "Shared transport" })).toBeInTheDocument();
  });

  it("toggles queue mode from the shared transport bar without invoking native queue APIs in fallback mode", async () => {
    render(<MusicWorkspaceApp />);
    fireEvent.click(screen.getByRole("button", { name: "Quality Control" }));

    const queueTab = await screen.findByRole("tab", { name: "Queue" });
    expect(queueTab).toHaveAttribute("aria-selected", "false");

    fireEvent.click(screen.getByRole("button", { name: "Queue" }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Queue" })).toHaveAttribute("aria-selected", "true");
    });
    expect(tauriApiMocks.togglePlaybackQueueVisibility).not.toHaveBeenCalled();
  });

  it("toggles queue mode from the shared transport bar using native queue APIs when native transport is enabled", async () => {
    tauriApiMocks.initExclusiveDevice.mockResolvedValue({
      sample_rate_hz: 48_000,
      bit_depth: 16,
      buffer_size_frames: 256,
      is_exclusive_lock: true
    });
    tauriApiMocks.getPlaybackContext.mockResolvedValue({
      volume_scalar: 1,
      is_bit_perfect_bypassed: true,
      active_queue_index: 0,
      is_queue_ui_expanded: false,
      queued_track_change_requests: 0,
      is_playing: false,
      position_seconds: 0,
      track_duration_seconds: 0
    });

    render(<MusicWorkspaceApp />);
    fireEvent.click(screen.getByRole("button", { name: "Quality Control" }));
    await waitFor(() => {
      expect(tauriApiMocks.initExclusiveDevice).toHaveBeenCalled();
      expect(tauriApiMocks.setPlaybackVolume).toHaveBeenCalled();
    });
    fireEvent.click(await screen.findByRole("button", { name: "Queue" }));

    await waitFor(() => {
      expect(tauriApiMocks.togglePlaybackQueueVisibility).toHaveBeenCalledTimes(1);
    });
  });

  it("sends normalized volume scalar from the shared transport slider", async () => {
    tauriApiMocks.initExclusiveDevice.mockResolvedValue({
      sample_rate_hz: 48_000,
      bit_depth: 16,
      buffer_size_frames: 256,
      is_exclusive_lock: true
    });
    render(<MusicWorkspaceApp />);

    const volumeSlider = screen.getByRole("slider", { name: "Playback volume" });
    fireEvent.change(volumeSlider, { target: { value: "42" } });

    await waitFor(() => {
      expect(tauriApiMocks.setPlaybackVolume).toHaveBeenCalledWith(0.42);
    });
  });

  it("throttles rapid volume slider events in shared transport", async () => {
    tauriApiMocks.initExclusiveDevice.mockResolvedValue({
      sample_rate_hz: 48_000,
      bit_depth: 16,
      buffer_size_frames: 256,
      is_exclusive_lock: true
    });
    render(<MusicWorkspaceApp />);

    await waitFor(() => {
      expect(tauriApiMocks.setPlaybackVolume).toHaveBeenCalled();
    });
    tauriApiMocks.setPlaybackVolume.mockClear();

    const volumeSlider = screen.getByRole("slider", { name: "Playback volume" });
    fireEvent.change(volumeSlider, { target: { value: "10" } });
    fireEvent.change(volumeSlider, { target: { value: "20" } });
    fireEvent.change(volumeSlider, { target: { value: "30" } });

    expect(tauriApiMocks.setPlaybackVolume).toHaveBeenCalledTimes(1);
    expect(tauriApiMocks.setPlaybackVolume).toHaveBeenNthCalledWith(1, 0.1);

    await waitFor(() => {
      expect(tauriApiMocks.setPlaybackVolume).toHaveBeenCalledTimes(2);
    });
    expect(tauriApiMocks.setPlaybackVolume).toHaveBeenLastCalledWith(0.3);
  });

  it("toggles mute and restores pre-mute volume in shared transport", async () => {
    let mockVolumeScalar = 1;
    tauriApiMocks.initExclusiveDevice.mockResolvedValue({
      sample_rate_hz: 48_000,
      bit_depth: 16,
      buffer_size_frames: 256,
      is_exclusive_lock: true
    });
    tauriApiMocks.setPlaybackVolume.mockImplementation(async (level: number) => {
      mockVolumeScalar = level;
    });
    tauriApiMocks.getPlaybackContext.mockImplementation(async () => ({
      volume_scalar: mockVolumeScalar,
      is_bit_perfect_bypassed: mockVolumeScalar === 1,
      active_queue_index: 0,
      is_queue_ui_expanded: false,
      queued_track_change_requests: 0,
      is_playing: false,
      position_seconds: 0,
      track_duration_seconds: 0
    }));
    render(<MusicWorkspaceApp />);

    const volumeSlider = screen.getByRole("slider", { name: "Playback volume" });
    fireEvent.change(volumeSlider, { target: { value: "42" } });
    await waitFor(() => {
      expect(tauriApiMocks.setPlaybackVolume).toHaveBeenCalledWith(0.42);
    });

    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    await waitFor(() => {
      expect(tauriApiMocks.setPlaybackVolume).toHaveBeenCalledWith(0);
    });
    expect((screen.getByRole("slider", { name: "Playback volume" }) as HTMLInputElement).value).toBe("0");

    fireEvent.click(screen.getByRole("button", { name: "Unmute" }));
    await waitFor(() => {
      expect(tauriApiMocks.setPlaybackVolume).toHaveBeenCalledWith(0.42);
    });
    expect((screen.getByRole("slider", { name: "Playback volume" }) as HTMLInputElement).value).toBe("42");
  });

  it("shows searchable list and queue controls inside the Playlists workspace", async () => {
    installTwoTrackCatalog();
    render(<MusicWorkspaceApp />);

    fireEvent.click(screen.getByRole("button", { name: "Playlists" }));

    expect(await screen.findByRole("searchbox", { name: "Search tracks" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Play list mode" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh List" })).toBeInTheDocument();
  });

  it("loads additional catalog pages when requesting more tracks", async () => {
    const pageA = Array.from({ length: 100 }, (_, index) => ({
      ...baseTrackListItem,
      track_id: `${index + 1}`.padStart(64, "a"),
      title: `Paged Track ${index + 1}`,
      file_path: `C:/Music/Paged Track ${index + 1}.wav`,
      media_fingerprint: `${index + 1}`.padStart(64, "b")
    }));
    const pageB = Array.from({ length: 20 }, (_, index) => ({
      ...baseTrackListItem,
      track_id: `${index + 201}`.padStart(64, "c"),
      title: `Paged Track ${index + 101}`,
      file_path: `C:/Music/Paged Track ${index + 101}.wav`,
      media_fingerprint: `${index + 201}`.padStart(64, "d")
    }));
    tauriApiMocks.catalogListTracks.mockImplementation(async (input?: { offset?: number; limit?: number }) => {
      if (input?.offset === 100) {
        return {
          items: pageB,
          total: 120,
          limit: 100,
          offset: 100
        };
      }
      return {
        items: pageA,
        total: 120,
        limit: 100,
        offset: 0
      };
    });

    render(<MusicWorkspaceApp />);
    fireEvent.click(screen.getByRole("button", { name: "Playlists" }));

    const loadMoreButton = await screen.findByRole("button", { name: "Load more tracks" });
    fireEvent.click(loadMoreButton);

    await waitFor(() => {
      const rows = within(screen.getByRole("list", { name: "Library tracks" })).getAllByRole("listitem");
      expect(rows).toHaveLength(120);
    });
  });

  it("groups library rows by album when album group mode is selected", async () => {
    const albumGroupTrackA = {
      ...baseTrackListItem,
      track_id: "3".repeat(64),
      title: "Afterglow Intro",
      artist_name: "Artist One",
      album_title: "Afterglow",
      file_path: "C:/Music/Artist One - Afterglow Intro.wav",
      media_fingerprint: "4".repeat(64),
      updated_at: "2026-02-20T00:00:00Z"
    };
    const albumGroupTrackB = {
      ...baseTrackListItem,
      track_id: "5".repeat(64),
      title: "Afterglow Outro",
      artist_name: "Artist One",
      album_title: "Afterglow",
      file_path: "C:/Music/Artist One - Afterglow Outro.wav",
      media_fingerprint: "6".repeat(64),
      updated_at: "2026-02-21T00:00:00Z"
    };
    const albumGroupTrackC = {
      ...baseTrackListItem,
      track_id: "7".repeat(64),
      title: "Blue Hour Theme",
      artist_name: "Artist Two",
      album_title: "Blue Hour",
      file_path: "C:/Music/Artist Two - Blue Hour Theme.wav",
      media_fingerprint: "8".repeat(64),
      updated_at: "2026-02-22T00:00:00Z"
    };

    tauriApiMocks.catalogListTracks.mockResolvedValue({
      items: [albumGroupTrackC, albumGroupTrackB, albumGroupTrackA],
      total: 3,
      limit: 100,
      offset: 0
    });
    tauriApiMocks.catalogGetTrack.mockImplementation(async (trackId: string) => {
      if (trackId === albumGroupTrackA.track_id) {
        return {
          ...baseTrackDetail,
          track_id: albumGroupTrackA.track_id,
          title: albumGroupTrackA.title,
          artist_name: albumGroupTrackA.artist_name,
          album_title: albumGroupTrackA.album_title,
          file_path: albumGroupTrackA.file_path,
          media_fingerprint: albumGroupTrackA.media_fingerprint
        };
      }
      if (trackId === albumGroupTrackB.track_id) {
        return {
          ...baseTrackDetail,
          track_id: albumGroupTrackB.track_id,
          title: albumGroupTrackB.title,
          artist_name: albumGroupTrackB.artist_name,
          album_title: albumGroupTrackB.album_title,
          file_path: albumGroupTrackB.file_path,
          media_fingerprint: albumGroupTrackB.media_fingerprint
        };
      }
      return {
        ...baseTrackDetail,
        track_id: albumGroupTrackC.track_id,
        title: albumGroupTrackC.title,
        artist_name: albumGroupTrackC.artist_name,
        album_title: albumGroupTrackC.album_title,
        file_path: albumGroupTrackC.file_path,
        media_fingerprint: albumGroupTrackC.media_fingerprint
      };
    });

    render(<MusicWorkspaceApp />);
    fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
    const trackGroupingSelect = await screen.findByRole("combobox", { name: "Track grouping" });
    fireEvent.change(trackGroupingSelect, { target: { value: "album" } });
    const trackSortSelect = await screen.findByRole("combobox", { name: "Track sort" });
    fireEvent.change(trackSortSelect, { target: { value: "album_asc" } });

    await waitFor(() => {
      const list = screen.getByRole("list", { name: "Library tracks" });
      const groupHeaders = list.querySelectorAll(".track-album-group-header");
      expect(groupHeaders).toHaveLength(2);
      expect(groupHeaders[0]).toHaveTextContent("Afterglow");
      expect(groupHeaders[0]).toHaveTextContent("Artist One");
      expect(groupHeaders[1]).toHaveTextContent("Blue Hour");
      expect(groupHeaders[1]).toHaveTextContent("Artist Two");

      const rows = within(list).getAllByRole("listitem");
      expect(within(rows[0]).getByText("Afterglow Intro")).toBeInTheDocument();
      expect(within(rows[1]).getByText("Afterglow Outro")).toBeInTheDocument();
      expect(within(rows[2]).getByText("Blue Hour Theme")).toBeInTheDocument();
    });
  });

  it("groups library rows by artist when artist group mode is selected", async () => {
    const artistGroupTrackA = {
      ...baseTrackListItem,
      track_id: "9".repeat(64),
      title: "A Track",
      artist_name: "Artist A",
      album_title: "Collection 2",
      file_path: "C:/Music/Artist A - A Track.wav",
      media_fingerprint: "a".repeat(64),
      updated_at: "2026-02-20T00:00:00Z"
    };
    const artistGroupTrackB = {
      ...baseTrackListItem,
      track_id: "b".repeat(64),
      title: "B Track",
      artist_name: "Artist B",
      album_title: "Collection 1",
      file_path: "C:/Music/Artist B - B Track.wav",
      media_fingerprint: "c".repeat(64),
      updated_at: "2026-02-21T00:00:00Z"
    };
    const artistGroupTrackC = {
      ...baseTrackListItem,
      track_id: "d".repeat(64),
      title: "C Track",
      artist_name: "Artist A",
      album_title: "Collection 1",
      file_path: "C:/Music/Artist A - C Track.wav",
      media_fingerprint: "e".repeat(64),
      updated_at: "2026-02-22T00:00:00Z"
    };

    tauriApiMocks.catalogListTracks.mockResolvedValue({
      items: [artistGroupTrackB, artistGroupTrackA, artistGroupTrackC],
      total: 3,
      limit: 100,
      offset: 0
    });
    tauriApiMocks.catalogGetTrack.mockImplementation(async (trackId: string) => {
      if (trackId === artistGroupTrackA.track_id) {
        return {
          ...baseTrackDetail,
          track_id: artistGroupTrackA.track_id,
          title: artistGroupTrackA.title,
          artist_name: artistGroupTrackA.artist_name,
          album_title: artistGroupTrackA.album_title,
          file_path: artistGroupTrackA.file_path,
          media_fingerprint: artistGroupTrackA.media_fingerprint
        };
      }
      if (trackId === artistGroupTrackB.track_id) {
        return {
          ...baseTrackDetail,
          track_id: artistGroupTrackB.track_id,
          title: artistGroupTrackB.title,
          artist_name: artistGroupTrackB.artist_name,
          album_title: artistGroupTrackB.album_title,
          file_path: artistGroupTrackB.file_path,
          media_fingerprint: artistGroupTrackB.media_fingerprint
        };
      }
      return {
        ...baseTrackDetail,
        track_id: artistGroupTrackC.track_id,
        title: artistGroupTrackC.title,
        artist_name: artistGroupTrackC.artist_name,
        album_title: artistGroupTrackC.album_title,
        file_path: artistGroupTrackC.file_path,
        media_fingerprint: artistGroupTrackC.media_fingerprint
      };
    });

    render(<MusicWorkspaceApp />);
    fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
    const trackGroupingSelect = await screen.findByRole("combobox", { name: "Track grouping" });
    fireEvent.change(trackGroupingSelect, { target: { value: "artist" } });
    const trackSortSelect = await screen.findByRole("combobox", { name: "Track sort" });
    fireEvent.change(trackSortSelect, { target: { value: "artist_asc" } });

    await waitFor(() => {
      const list = screen.getByRole("list", { name: "Library tracks" });
      const groupHeaders = list.querySelectorAll(".track-album-group-header");
      expect(groupHeaders).toHaveLength(2);
      expect(groupHeaders[0]).toHaveTextContent("Artist A");
      expect(groupHeaders[1]).toHaveTextContent("Artist B");

      const rows = within(list).getAllByRole("listitem");
      expect(within(rows[0]).getByText("A Track")).toBeInTheDocument();
      expect(within(rows[1]).getByText("C Track")).toBeInTheDocument();
      expect(within(rows[2]).getByText("B Track")).toBeInTheDocument();
    });
  });

  it("applies tokenized search ranking with title matches above artist and album matches", async () => {
    const titleMatchTrack = {
      ...baseTrackListItem,
      track_id: "7".repeat(64),
      title: "Queue Anthem",
      artist_name: "Artist One",
      album_title: "Night Session",
      file_path: "C:/Music/Queue Anthem.wav",
      media_fingerprint: "8".repeat(64),
      updated_at: "2026-02-20T00:00:00Z"
    };
    const artistMatchTrack = {
      ...baseTrackListItem,
      track_id: "9".repeat(64),
      title: "Night Runner",
      artist_name: "Queue Artist",
      album_title: "Night Session",
      file_path: "C:/Music/Night Runner.wav",
      media_fingerprint: "a".repeat(64),
      updated_at: "2026-02-27T00:00:00Z"
    };
    const albumMatchTrack = {
      ...baseTrackListItem,
      track_id: "b".repeat(64),
      title: "Ambient Study",
      artist_name: "Artist Two",
      album_title: "Queue Album",
      file_path: "C:/Music/Ambient Study.wav",
      media_fingerprint: "c".repeat(64),
      updated_at: "2026-02-28T00:00:00Z"
    };
    tauriApiMocks.catalogListTracks.mockResolvedValue({
      items: [albumMatchTrack, artistMatchTrack, titleMatchTrack],
      total: 3,
      limit: 100,
      offset: 0
    });
    tauriApiMocks.catalogGetTrack.mockImplementation(async (trackId: string) => {
      if (trackId === titleMatchTrack.track_id) {
        return {
          ...baseTrackDetail,
          track_id: titleMatchTrack.track_id,
          title: titleMatchTrack.title,
          artist_name: titleMatchTrack.artist_name,
          album_title: titleMatchTrack.album_title,
          file_path: titleMatchTrack.file_path,
          media_fingerprint: titleMatchTrack.media_fingerprint
        };
      }
      if (trackId === artistMatchTrack.track_id) {
        return {
          ...baseTrackDetail,
          track_id: artistMatchTrack.track_id,
          title: artistMatchTrack.title,
          artist_name: artistMatchTrack.artist_name,
          album_title: artistMatchTrack.album_title,
          file_path: artistMatchTrack.file_path,
          media_fingerprint: artistMatchTrack.media_fingerprint
        };
      }
      return {
        ...baseTrackDetail,
        track_id: albumMatchTrack.track_id,
        title: albumMatchTrack.title,
        artist_name: albumMatchTrack.artist_name,
        album_title: albumMatchTrack.album_title,
        file_path: albumMatchTrack.file_path,
        media_fingerprint: albumMatchTrack.media_fingerprint
      };
    });

    render(<MusicWorkspaceApp />);
    fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
    const searchbox = await screen.findByRole("searchbox", { name: "Search tracks" });
    fireEvent.change(searchbox, { target: { value: "queue" } });

    await waitFor(() => {
      const rows = within(screen.getByRole("list", { name: "Library tracks" })).getAllByRole("listitem");
      expect(within(rows[0]).getByText("Queue Anthem")).toBeInTheDocument();
      expect(within(rows[1]).getByText("Night Runner")).toBeInTheDocument();
      expect(within(rows[2]).getByText("Ambient Study")).toBeInTheDocument();
    });

    fireEvent.change(searchbox, { target: { value: "queue album" } });
    await waitFor(() => {
      const rows = within(screen.getByRole("list", { name: "Library tracks" })).getAllByRole("listitem");
      expect(rows).toHaveLength(1);
      expect(within(rows[0]).getByText("Ambient Study")).toBeInTheDocument();
    });
  });

  it("matches tracks by file path tokens during search ranking", async () => {
    const pathOnlyMatchTrack = {
      ...baseTrackListItem,
      track_id: "1".repeat(64),
      title: "No Path Keyword",
      artist_name: "No Path Artist",
      album_title: "No Path Album",
      file_path: "C:/Archive Sessions/Folder/No Path Keyword.wav",
      media_fingerprint: "2".repeat(64),
      updated_at: "2026-02-28T00:00:00Z"
    };
    const nonMatchTrack = {
      ...baseTrackListItem,
      track_id: "3".repeat(64),
      title: "Other Track",
      artist_name: "Other Artist",
      album_title: "Other Album",
      file_path: "C:/Music/Other Track.wav",
      media_fingerprint: "4".repeat(64),
      updated_at: "2026-02-27T00:00:00Z"
    };

    tauriApiMocks.catalogListTracks.mockResolvedValue({
      items: [nonMatchTrack, pathOnlyMatchTrack],
      total: 2,
      limit: 100,
      offset: 0
    });

    render(<MusicWorkspaceApp />);
    fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
    const searchbox = await screen.findByRole("searchbox", { name: "Search tracks" });
    fireEvent.change(searchbox, { target: { value: "archive sessions" } });

    await waitFor(() => {
      const rows = within(screen.getByRole("list", { name: "Library tracks" })).getAllByRole("listitem");
      expect(rows).toHaveLength(1);
      expect(within(rows[0]).getByText("No Path Keyword")).toBeInTheDocument();
    });
  });

  it("autoplays a track after dropped-folder scan completes", async () => {
    const droppedRootPath = "C:/Dropped";
    const droppedRootId = "d".repeat(64);
    const droppedJobId = "e".repeat(64);
    const droppedTrack = {
      ...baseTrackListItem,
      track_id: "f".repeat(64),
      title: "Dropped Folder Track",
      file_path: `${droppedRootPath}/Dropped Folder Track.wav`,
      media_fingerprint: "1".repeat(64),
      updated_at: "2026-03-01T00:00:00Z"
    };
    const droppedTrackDetail = {
      ...baseTrackDetail,
      track_id: droppedTrack.track_id,
      title: droppedTrack.title,
      file_path: droppedTrack.file_path,
      media_fingerprint: droppedTrack.media_fingerprint,
      track: {
        ...baseTrackDetail.track,
        file_path: droppedTrack.file_path
      }
    };

    let listCalls = 0;
    tauriApiMocks.catalogListTracks.mockImplementation(async () => {
      listCalls += 1;
      if (listCalls < 2) {
        return {
          items: [baseTrackListItem],
          total: 1,
          limit: 100,
          offset: 0
        };
      }
      return {
        items: [droppedTrack, baseTrackListItem],
        total: 2,
        limit: 100,
        offset: 0
      };
    });
    tauriApiMocks.catalogGetTrack.mockImplementation(async (trackId: string) => {
      if (trackId === droppedTrack.track_id) return { ...droppedTrackDetail };
      return { ...baseTrackDetail };
    });
    tauriApiMocks.catalogAddLibraryRoot.mockResolvedValue({
      root_id: droppedRootId,
      path: droppedRootPath,
      enabled: true,
      created_at: "2026-03-01T00:00:00Z",
      updated_at: "2026-03-01T00:00:00Z"
    });
    tauriApiMocks.catalogScanRoot.mockResolvedValue({
      job_id: droppedJobId,
      root_id: droppedRootId
    });
    let ingestPollCount = 0;
    tauriApiMocks.catalogGetIngestJob.mockImplementation(async (jobId: string) => {
      if (jobId !== droppedJobId) return null;
      ingestPollCount += 1;
      return {
        job_id: droppedJobId,
        status: ingestPollCount < 2 ? "RUNNING" : "COMPLETED",
        scope: `SCAN_ROOT:${droppedRootId}`,
        total_items: 1,
        processed_items: ingestPollCount < 2 ? 0 : 1,
        error_count: 0,
        created_at: "2026-03-01T00:00:00Z",
        updated_at: "2026-03-01T00:00:00Z"
      };
    });
    window.__TAURI__ = {
      core: {
        invoke: vi.fn(async () => null) as NonNullable<NonNullable<typeof window.__TAURI__>["core"]>["invoke"]
      }
    };

    render(<MusicWorkspaceApp />);
    await waitFor(() => {
      expect(webviewMocks.getCurrentWebview).toHaveBeenCalled();
    });
    const playSpy = vi.mocked(HTMLMediaElement.prototype.play);
    playSpy.mockClear();

    webviewMocks.emitDrop([droppedRootPath]);

    await waitFor(() => {
      expect(tauriApiMocks.catalogScanRoot).toHaveBeenCalledWith(droppedRootId);
    });
    await waitFor(() => {
      expect(playSpy).toHaveBeenCalled();
    }, { timeout: 3000 });
  });

  it("autoplays and queues the first imported track after dropping audio files", async () => {
    const droppedFilePath = "C:/Dropped Files/Imported Track.wav";
    const importedTrack = {
      ...baseTrackListItem,
      track_id: "9".repeat(64),
      title: "Dropped Imported Track",
      file_path: droppedFilePath,
      media_fingerprint: "8".repeat(64),
      updated_at: "2026-03-01T00:00:00Z"
    };
    const importedTrackDetail = {
      ...baseTrackDetail,
      track_id: importedTrack.track_id,
      title: importedTrack.title,
      file_path: importedTrack.file_path,
      media_fingerprint: importedTrack.media_fingerprint,
      track: {
        ...baseTrackDetail.track,
        file_path: importedTrack.file_path
      }
    };

    let listCalls = 0;
    tauriApiMocks.catalogListTracks.mockImplementation(async () => {
      listCalls += 1;
      if (listCalls < 2) {
        return {
          items: [baseTrackListItem],
          total: 1,
          limit: 100,
          offset: 0
        };
      }
      return {
        items: [importedTrack, baseTrackListItem],
        total: 2,
        limit: 100,
        offset: 0
      };
    });
    tauriApiMocks.catalogGetTrack.mockImplementation(async (trackId: string) => {
      if (trackId === importedTrack.track_id) return { ...importedTrackDetail };
      return { ...baseTrackDetail };
    });
    tauriApiMocks.catalogAddLibraryRoot.mockRejectedValue({
      code: "INVALID_ARGUMENT",
      message: "Path is not a directory"
    });
    tauriApiMocks.catalogImportFiles.mockResolvedValue({
      imported: [importedTrack],
      failed: []
    });
    window.__TAURI__ = {
      core: {
        invoke: vi.fn(async () => null) as NonNullable<NonNullable<typeof window.__TAURI__>["core"]>["invoke"]
      }
    };

    render(<MusicWorkspaceApp />);
    await waitFor(() => {
      expect(webviewMocks.getCurrentWebview).toHaveBeenCalled();
    });
    const playSpy = vi.mocked(HTMLMediaElement.prototype.play);
    playSpy.mockClear();

    webviewMocks.emitDrop([droppedFilePath]);

    await waitFor(() => {
      expect(tauriApiMocks.catalogImportFiles).toHaveBeenCalledWith([droppedFilePath]);
    });
    await waitFor(() => {
      expect(playSpy).toHaveBeenCalled();
    });
    expect(await screen.findByText("Added track to queue.")).toBeInTheDocument();
  });

  it("adds dropped file parent folder as a scan root when the toggle is enabled", async () => {
    const droppedFilePath = "C:/Drop Parent/track.wav";
    const parentRootPath = "C:/Drop Parent";
    const parentRootId = "7".repeat(64);

    window.localStorage.setItem("rp.music.dropParentRootsOnDrop.v1", JSON.stringify(true));

    tauriApiMocks.catalogAddLibraryRoot.mockImplementation(async (path: string) => {
      if (path === droppedFilePath) {
        throw {
          code: "INVALID_ARGUMENT",
          message: "Path is not a directory"
        };
      }
      if (path === parentRootPath) {
        return {
          root_id: parentRootId,
          path: parentRootPath,
          enabled: true,
          created_at: "2026-03-01T00:00:00Z",
          updated_at: "2026-03-01T00:00:00Z"
        };
      }
      throw {
        code: "INVALID_ARGUMENT",
        message: "Unexpected root path"
      };
    });
    tauriApiMocks.catalogScanRoot.mockResolvedValue({
      job_id: "6".repeat(64),
      root_id: parentRootId
    });
    tauriApiMocks.catalogImportFiles.mockResolvedValue({
      imported: [],
      failed: []
    });
    window.__TAURI__ = {
      core: {
        invoke: vi.fn(async () => null) as NonNullable<NonNullable<typeof window.__TAURI__>["core"]>["invoke"]
      }
    };

    render(<MusicWorkspaceApp />);
    await waitFor(() => {
      expect(webviewMocks.getCurrentWebview).toHaveBeenCalled();
    });

    webviewMocks.emitDrop([droppedFilePath]);

    await waitFor(() => {
      expect(tauriApiMocks.catalogAddLibraryRoot).toHaveBeenCalledWith(droppedFilePath);
      expect(tauriApiMocks.catalogAddLibraryRoot).toHaveBeenCalledWith(parentRootPath);
    });
    await waitFor(() => {
      expect(tauriApiMocks.catalogScanRoot).toHaveBeenCalledWith(parentRootId);
    });
    expect(tauriApiMocks.catalogImportFiles).toHaveBeenCalledWith([droppedFilePath]);
  });

  it("does not show a playback error when playlist queue sync cannot toggle native queue visibility", async () => {
    installTwoTrackCatalog();
    tauriApiMocks.initExclusiveDevice.mockResolvedValue({
      sample_rate_hz: 48000,
      bit_depth: 16,
      buffer_size_frames: 512,
      is_exclusive_lock: true
    });
    tauriApiMocks.togglePlaybackQueueVisibility.mockRejectedValue({
      code: "PLAYBACK_QUEUE_REQUEST_REJECTED",
      message: "queue visibility command unavailable in this runtime"
    });

    render(<MusicWorkspaceApp />);

    fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Queue" }));

    await waitFor(() => {
      expect(tauriApiMocks.togglePlaybackQueueVisibility).toHaveBeenCalled();
    });
    expect(screen.queryByText("Unable to toggle queue visibility.")).not.toBeInTheDocument();
  });

  it("prunes stale persisted queue, favorites, and publish selection after removing a library root", async () => {
    window.localStorage.setItem("rp.music.favorites.v1", JSON.stringify([baseTrackListItem.track_id]));
    window.localStorage.setItem("rp.music.sessionQueue.v1", JSON.stringify([baseTrackListItem.track_id]));
    window.localStorage.setItem("rp.publish.selectionQueue.v1", JSON.stringify([
      {
        trackId: baseTrackListItem.track_id,
        title: baseTrackListItem.title,
        artistName: baseTrackListItem.artist_name,
        mediaPath: baseTrackListItem.file_path,
        specPath: "C:/tmp/release_spec.yaml",
        draftId: "1".repeat(64)
      }
    ]));

    let rootRemoved = false;
    tauriApiMocks.catalogListLibraryRoots.mockResolvedValue([
      {
        root_id: "e".repeat(64),
        path: "C:/Music",
        enabled: true,
        created_at: "2026-02-26T12:00:00Z",
        updated_at: "2026-02-26T12:00:00Z"
      }
    ]);
    tauriApiMocks.catalogListTracks.mockImplementation(async () => {
      if (rootRemoved) {
        return {
          items: [],
          total: 0,
          limit: 100,
          offset: 0
        };
      }
      return {
        items: [baseTrackListItem],
        total: 1,
        limit: 100,
        offset: 0
      };
    });
    tauriApiMocks.catalogGetTrack.mockImplementation(async (trackId: string) => {
      if (trackId !== baseTrackListItem.track_id || rootRemoved) return null;
      return { ...baseTrackDetail };
    });
    tauriApiMocks.catalogRemoveLibraryRoot.mockImplementation(async () => {
      rootRemoved = true;
      return true;
    });

    render(<MusicWorkspaceApp />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove Folder" }));

    await waitFor(() => {
      expect(tauriApiMocks.catalogRemoveLibraryRoot).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(window.localStorage.getItem("rp.music.favorites.v1")).toBe("[]");
      expect(window.localStorage.getItem("rp.music.sessionQueue.v1")).toBe("[]");
      expect(window.localStorage.getItem("rp.publish.selectionQueue.v1")).toBe("[]");
    });
  });

  it("requests ingest cancellation for an active library root scan", async () => {
    const rootId = "e".repeat(64);
    const jobId = "f".repeat(64);
    tauriApiMocks.catalogListLibraryRoots.mockResolvedValue([
      {
        root_id: rootId,
        path: "C:/Music",
        enabled: true,
        created_at: "2026-02-26T12:00:00Z",
        updated_at: "2026-02-26T12:00:00Z"
      }
    ]);
    tauriApiMocks.catalogScanRoot.mockResolvedValue({
      job_id: jobId,
      root_id: rootId
    });
    tauriApiMocks.catalogGetIngestJob.mockImplementation(async (requestedJobId: string) => {
      if (requestedJobId !== jobId) return null;
      return {
        job_id: jobId,
        status: "RUNNING",
        scope: `SCAN_ROOT:${rootId}`,
        total_items: 5,
        processed_items: 1,
        error_count: 0,
        created_at: "2026-03-01T00:00:00Z",
        updated_at: "2026-03-01T00:00:00Z"
      };
    });
    tauriApiMocks.catalogCancelIngestJob.mockResolvedValue(true);

    render(<MusicWorkspaceApp />);

    fireEvent.click(await screen.findByRole("button", { name: "Scan Folder" }));

    const cancelButton = await screen.findByRole("button", { name: "Cancel Scan" });
    await waitFor(() => {
      expect(cancelButton).not.toBeDisabled();
    });
    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(tauriApiMocks.catalogCancelIngestJob).toHaveBeenCalledWith(jobId);
    });
  });

  it("reorders queue tracks by dragging a row onto another row", async () => {
    installTwoTrackCatalog();
    render(<MusicWorkspaceApp />);

    fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Queue" }));

    const queueList = screen.getByRole("list", { name: "Queue tracks" });
    const initialRows = within(queueList).getAllByRole("listitem");
    const dragSourceRow = initialRows[0];
    const dropTargetRow = initialRows[1];
    const initialFirstIsBase = within(initialRows[0]).queryByText(baseTrackListItem.title) != null;
    const dataTransfer = createMockDataTransfer();

    fireEvent.dragStart(dragSourceRow, { dataTransfer });
    fireEvent.dragOver(dropTargetRow, { dataTransfer });
    fireEvent.drop(dropTargetRow, { dataTransfer });

    expect(await screen.findByText("Queue reordered.")).toBeInTheDocument();
    await waitFor(() => {
      const reorderedRows = within(queueList).getAllByRole("listitem");
      if (initialFirstIsBase) {
        expect(within(reorderedRows[0]).getByText(secondTrackListItem.title)).toBeInTheDocument();
        expect(within(reorderedRows[1]).getByText(baseTrackListItem.title)).toBeInTheDocument();
      } else {
        expect(within(reorderedRows[0]).getByText(baseTrackListItem.title)).toBeInTheDocument();
        expect(within(reorderedRows[1]).getByText(secondTrackListItem.title)).toBeInTheDocument();
      }
    });
  });

  it("reorders queue tracks using drop payload fallback when drag state is unavailable", async () => {
    installTwoTrackCatalog();
    render(<MusicWorkspaceApp />);

    fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Queue" }));

    const queueList = screen.getByRole("list", { name: "Queue tracks" });
    const rows = within(queueList).getAllByRole("listitem");
    const dropTargetRow =
      within(rows[0]).queryByText(baseTrackListItem.title) == null ? rows[0] : rows[1];
    const dropTargetIndex = dropTargetRow === rows[0] ? 0 : 1;
    const dataTransfer = createMockDataTransfer({ "text/plain": baseTrackListItem.track_id });

    fireEvent.dragOver(dropTargetRow, { dataTransfer });
    fireEvent.drop(dropTargetRow, { dataTransfer });

    expect(await screen.findByText("Queue reordered.")).toBeInTheDocument();
    await waitFor(() => {
      const reorderedRows = within(queueList).getAllByRole("listitem");
      expect(within(reorderedRows[dropTargetIndex]).getByText(baseTrackListItem.title)).toBeInTheDocument();
      const otherIndex = dropTargetIndex === 0 ? 1 : 0;
      expect(within(reorderedRows[otherIndex]).getByText(secondTrackListItem.title)).toBeInTheDocument();
    });
  });

  it("moves the selected queue track with keyboard reorder shortcuts", async () => {
    installTwoTrackCatalog();
    render(<MusicWorkspaceApp />);

    fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Queue" }));

    const queueList = screen.getByRole("list", { name: "Queue tracks" });
    const initialRows = within(queueList).getAllByRole("listitem");
    const initialFirstIsBase = within(initialRows[0]).queryByText(baseTrackListItem.title) != null;
    const firstMainButton = initialRows[0].querySelector(".track-row-main-button");
    expect(firstMainButton).not.toBeNull();
    fireEvent.click(firstMainButton as HTMLElement);

    fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown", ctrlKey: true });

    expect(await screen.findByText("Moved track down in queue.")).toBeInTheDocument();
    await waitFor(() => {
      const reorderedRows = within(queueList).getAllByRole("listitem");
      if (initialFirstIsBase) {
        expect(within(reorderedRows[0]).getByText(secondTrackListItem.title)).toBeInTheDocument();
        expect(within(reorderedRows[1]).getByText(baseTrackListItem.title)).toBeInTheDocument();
      } else {
        expect(within(reorderedRows[0]).getByText(baseTrackListItem.title)).toBeInTheDocument();
        expect(within(reorderedRows[1]).getByText(secondTrackListItem.title)).toBeInTheDocument();
      }
    });
  });

  it("resets persisted library data from Settings", async () => {
    window.localStorage.setItem("rp.music.favorites.v1", JSON.stringify([baseTrackListItem.track_id]));
    window.localStorage.setItem("rp.music.sessionQueue.v1", JSON.stringify([baseTrackListItem.track_id]));
    window.localStorage.setItem("rp.publish.selectionQueue.v1", JSON.stringify([
      {
        trackId: baseTrackListItem.track_id,
        title: baseTrackListItem.title,
        artistName: baseTrackListItem.artist_name,
        mediaPath: baseTrackListItem.file_path,
        specPath: "C:/tmp/release_spec.yaml",
        draftId: "1".repeat(64)
      }
    ]));

    render(<MusicWorkspaceApp />);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reset Library Data" }));

    await waitFor(() => {
      expect(tauriApiMocks.catalogResetLibraryData).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(window.localStorage.getItem("rp.music.favorites.v1")).toBe("[]");
      expect(window.localStorage.getItem("rp.music.sessionQueue.v1")).toBe("[]");
      expect(window.localStorage.getItem("rp.publish.selectionQueue.v1")).toBe("[]");
    });

    expect(await screen.findByText("Library data reset.")).toBeInTheDocument();
  });

  it("persists collapsed Library and Settings sections across remounts", async () => {
    const firstRender = render(<MusicWorkspaceApp />);

    fireEvent.click(screen.getByRole("button", { name: "Hide Library Ingest" }));
    expect(screen.queryByRole("tablist", { name: "Library ingest sections" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide Library overview" }));
    expect(
      screen.queryByRole("heading", { name: /Music-first workspace, publisher pipeline preserved/i })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Hide Preferences" }));
    expect(screen.queryByRole("combobox", { name: "Theme preference" })).not.toBeInTheDocument();

    expect(window.localStorage.getItem("rp.music.libraryIngestCollapsed.v1")).toBe("true");
    expect(window.localStorage.getItem("rp.music.libraryOverviewCollapsed.v1")).toBe("true");
    expect(window.localStorage.getItem("rp.music.settingsPreferencesCollapsed.v1")).toBe("true");

    firstRender.unmount();

    render(<MusicWorkspaceApp />);
    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    expect(screen.getByRole("button", { name: "Show Library Ingest" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show Library overview" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("button", { name: "Show Preferences" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Theme preference" })).not.toBeInTheDocument();
  });

  it("captures and persists configurable shortcut bindings from Settings", async () => {
    render(<MusicWorkspaceApp />);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const playPauseShortcutInput = await screen.findByLabelText("Play / Pause shortcut");
    fireEvent.focus(playPauseShortcutInput);
    fireEvent.keyDown(playPauseShortcutInput, { key: "p", code: "KeyP" });

    expect((playPauseShortcutInput as HTMLInputElement).value).toBe("P");
    await waitFor(() => {
      expect(window.localStorage.getItem("rp.music.shortcutBindings.v1")).toContain("\"toggle_play_pause\":\"KeyP\"");
    });

    fireEvent.keyDown(playPauseShortcutInput, { key: "Backspace", code: "Backspace" });
    expect((playPauseShortcutInput as HTMLInputElement).value).toBe("Unassigned");
    await waitFor(() => {
      expect(window.localStorage.getItem("rp.music.shortcutBindings.v1")).toContain("\"toggle_play_pause\":null");
    });
  });

  it("runs rebound keyboard shortcuts for shared playback controls", async () => {
    window.localStorage.setItem(
      "rp.music.shortcutBindings.v1",
      JSON.stringify({
        ...DEFAULT_SHORTCUT_BINDINGS,
        toggle_play_pause: "KeyP"
      })
    );

    render(<MusicWorkspaceApp />);
    fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
    const authoringTrackRow = await screen.findByRole("button", { name: /^Authoring Track/i });
    fireEvent.click(authoringTrackRow);
    const playSpy = vi.mocked(HTMLMediaElement.prototype.play);
    playSpy.mockClear();

    fireEvent.keyDown(window, { key: " ", code: "Space" });
    expect(playSpy).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "p", code: "KeyP" });
    await waitFor(() => {
      expect(playSpy).toHaveBeenCalled();
    });
  });

  it("focuses playlist search via configurable shortcut", async () => {
    window.localStorage.setItem(
      "rp.music.shortcutBindings.v1",
      JSON.stringify({
        ...DEFAULT_SHORTCUT_BINDINGS,
        focus_track_search: "KeyF"
      })
    );

    render(<MusicWorkspaceApp />);
    fireEvent.keyDown(window, { key: "f", code: "KeyF" });

    const searchInput = await screen.findByRole("searchbox", { name: "Search tracks" });
    await waitFor(() => {
      expect(searchInput).toHaveFocus();
    });
  });
});
