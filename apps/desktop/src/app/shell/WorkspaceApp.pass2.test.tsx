import React from "react";
import {
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
  type RenderOptions
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TauriClientProvider } from "../../services/tauri/TauriClientProvider";
import type { TauriClient } from "../../services/tauri/TauriClientProvider";
import WorkspaceApp from "./WorkspaceApp";
import { createUiSignalRecorder } from "../../test/uiSignalRecorder";
import { assertVisibleActionableControls } from "../../test/visibleControlAudit";

function render(ui: React.ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return rtlRender(ui, {
    wrapper: ({ children }: React.PropsWithChildren) => (
      <TauriClientProvider client={tauriApiMocks as unknown as TauriClient}>{children}</TauriClientProvider>
    ),
    ...options
  });
}

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
  isUiAppError: (error: unknown): boolean =>
    error != null &&
    typeof error === "object" &&
    "code" in (error as object) &&
    "message" in (error as object) &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string",
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
  publisherCreateDraftFromTrack: vi.fn(),
  videoRenderGetEnvironmentDiagnostics: vi.fn()
}));

const webviewMocks = vi.hoisted(() => ({
  getCurrentWebview: vi.fn(() => ({
    onDragDropEvent: vi.fn(async () => () => undefined)
  }))
}));

vi.mock("../../features/publisher-ops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../features/publisher-ops")>();
  return {
    ...actual,
    PublisherOpsWorkspace: () => <div data-testid="publisher-ops-mock">Publisher Ops Mock</div>
  };
});

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: webviewMocks.getCurrentWebview
}));

const firstTrack = {
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

const secondTrack = {
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

const firstTrackDetail = {
  track_id: firstTrack.track_id,
  media_asset_id: "c".repeat(64),
  title: firstTrack.title,
  artist_id: "d".repeat(64),
  artist_name: firstTrack.artist_name,
  album_id: null,
  album_title: null,
  file_path: firstTrack.file_path,
  media_fingerprint: firstTrack.media_fingerprint,
  track: {
    file_path: firstTrack.file_path,
    duration_ms: firstTrack.duration_ms,
    peak_data: [-12, -8, -6, -7],
    loudness_lufs: firstTrack.loudness_lufs
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

function installHappyDefaults() {
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
    items: [firstTrack, secondTrack],
    total: 2,
    limit: 100,
    offset: 0
  });
  tauriApiMocks.catalogGetTrack.mockResolvedValue({ ...firstTrackDetail });
  tauriApiMocks.catalogGetIngestJob.mockResolvedValue(null);
  tauriApiMocks.catalogCancelIngestJob.mockResolvedValue(true);
  tauriApiMocks.catalogAddLibraryRoot.mockResolvedValue({
    root_id: "e".repeat(64),
    path: "C:/Music",
    created_at: "2026-02-26T12:00:00Z",
    updated_at: "2026-02-26T12:00:00Z"
  });
  tauriApiMocks.catalogRemoveLibraryRoot.mockResolvedValue(true);
  tauriApiMocks.catalogResetLibraryData.mockResolvedValue(true);
  tauriApiMocks.catalogScanRoot.mockResolvedValue({
    job_id: "scan-job-1",
    root_id: "e".repeat(64)
  });
  tauriApiMocks.catalogImportFiles.mockResolvedValue({ imported: [], failed: [] });
  tauriApiMocks.catalogUpdateTrackMetadata.mockResolvedValue({ ...firstTrackDetail });
  tauriApiMocks.publisherCreateDraftFromTrack.mockResolvedValue({
    draft_id: "draft-1",
    source_track_id: firstTrack.track_id,
    media_path: firstTrack.file_path,
    spec_path: "C:/Drafts/authoring-track.yaml"
  });
  tauriApiMocks.pickDirectoryDialog.mockResolvedValue(null);
  tauriApiMocks.videoRenderGetEnvironmentDiagnostics.mockResolvedValue({
    ffmpeg: {
      available: true,
      source: "bundled",
      executablePath: "C:/ffmpeg/ffmpeg.exe",
      version: "ffmpeg version n7.0",
      message: null
    },
    outputDirectory: {
      directoryPath: "C:/Exports",
      exists: true,
      writable: true,
      message: null
    },
    renderCapable: true,
    blockingReasons: []
  });
}

function openPlaylistsWorkspace() {
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
}

describe("WorkspaceApp Pass 2 coverage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    delete window.__TAURI__;
    Object.values(tauriApiMocks).forEach((fn) => {
      if (typeof (fn as { mockReset?: unknown }).mockReset === "function") {
        (fn as { mockReset: () => void }).mockReset();
      }
    });
    webviewMocks.getCurrentWebview.mockClear();
    installHappyDefaults();

    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("keeps About informational and mode-independent while its visible controls remain actionable", async () => {
    const clipboardWrite = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWrite }
    });

    const uiSignals = createUiSignalRecorder({
      ignoreConsole: [/Not implemented: HTMLMediaElement\.prototype\.load/i]
    });

    try {
      render(<WorkspaceApp />);
      fireEvent.click(screen.getByRole("button", { name: "About" }));

      await waitFor(() => {
        expect(tauriApiMocks.videoRenderGetEnvironmentDiagnostics).toHaveBeenCalledTimes(1);
      });

      expect(screen.getByRole("heading", { level: 3, name: "Skald QC" })).toBeInTheDocument();
      expect(screen.queryByRole("tablist", { name: "Publish workflow steps" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reset Library Data" })).not.toBeInTheDocument();

      const aboutResources = screen.getByRole("region", { name: "Resources" });
      await assertVisibleActionableControls(
        [
          {
            role: "button",
            name: "Copy System Info",
            expectation: "action",
            assertAfter: async () => {
              await waitFor(() => {
                expect(clipboardWrite).toHaveBeenCalledTimes(1);
              });
              expect(screen.getByText("System info copied.")).toBeInTheDocument();
            }
          },
          {
            role: "button",
            name: "Refresh Diagnostics",
            expectation: "disabled"
          }
        ],
        "About workspace resources",
        { root: aboutResources }
      );

      fireEvent.click(screen.getByRole("tab", { name: "Publish" }));
      expect(await screen.findByRole("button", { name: "Copy System Info" })).toBeInTheDocument();
      expect(screen.queryByRole("tablist", { name: "Publish workflow steps" })).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Queue and session state")).not.toBeInTheDocument();

      uiSignals.expectClean();
    } finally {
      uiSignals.restore();
    }
  });

  it("keeps track search isolated from queue, preview, and publish side effects", async () => {
    const uiSignals = createUiSignalRecorder({
      ignoreConsole: [/Not implemented: HTMLMediaElement\.prototype\.load/i]
    });

    try {
      render(<WorkspaceApp />);
      openPlaylistsWorkspace();

      const setPlaybackQueueCallsBefore = tauriApiMocks.setPlaybackQueue.mock.calls.length;
      const playbackChangeCallsBefore = tauriApiMocks.pushPlaybackTrackChangeRequest.mock.calls.length;
      const setPlaybackPlayingCallsBefore = tauriApiMocks.setPlaybackPlaying.mock.calls.length;
      const seekCallsBefore = tauriApiMocks.seekPlaybackRatio.mock.calls.length;
      const previewPrepareCallsBefore = tauriApiMocks.qcPreparePreviewSession.mock.calls.length;
      const previewVariantCallsBefore = tauriApiMocks.qcSetPreviewVariant.mock.calls.length;
      const previewMediaCallsBefore = tauriApiMocks.qcGetActivePreviewMedia.mock.calls.length;
      const publisherDraftCallsBefore = tauriApiMocks.publisherCreateDraftFromTrack.mock.calls.length;

      fireEvent.change(screen.getByRole("searchbox", { name: "Search tracks" }), {
        target: { value: "Queue Candidate" }
      });

      await waitFor(() => {
        expect(screen.getByRole("list", { name: "Library tracks" })).toHaveTextContent("Queue Candidate");
      });

      expect(tauriApiMocks.setPlaybackQueue.mock.calls.length).toBe(setPlaybackQueueCallsBefore);
      expect(tauriApiMocks.pushPlaybackTrackChangeRequest.mock.calls.length).toBe(playbackChangeCallsBefore);
      expect(tauriApiMocks.setPlaybackPlaying.mock.calls.length).toBe(setPlaybackPlayingCallsBefore);
      expect(tauriApiMocks.seekPlaybackRatio.mock.calls.length).toBe(seekCallsBefore);
      expect(tauriApiMocks.qcPreparePreviewSession.mock.calls.length).toBe(previewPrepareCallsBefore);
      expect(tauriApiMocks.qcSetPreviewVariant.mock.calls.length).toBe(previewVariantCallsBefore);
      expect(tauriApiMocks.qcGetActivePreviewMedia.mock.calls.length).toBe(previewMediaCallsBefore);
      expect(tauriApiMocks.publisherCreateDraftFromTrack.mock.calls.length).toBe(publisherDraftCallsBefore);

      uiSignals.expectClean();
    } finally {
      uiSignals.restore();
    }
  });

  it.fails("keeps the shared player visible when navigating to About", async () => {
    render(<WorkspaceApp />);

    expect(screen.getByRole("region", { name: "Shared transport" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "About" }));
    expect(screen.getByRole("region", { name: "Shared transport" })).toBeInTheDocument();
  });

  it.fails("disables Settings banner-clear controls when there is nothing to clear", async () => {
    render(<WorkspaceApp />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    const maintenanceActions = screen.getByRole("button", { name: "Clear Notice" }).parentElement as HTMLElement;

    await assertVisibleActionableControls(
      [
        {
          role: "button",
          name: "Clear Notice",
          expectation: "disabled"
        },
        {
          role: "button",
          name: "Clear Error Banner",
          expectation: "disabled"
        },
        {
          role: "button",
          name: "Reset Library Data",
          expectation: "action"
        }
      ],
      "Settings maintenance actions",
      { root: maintenanceActions }
    );
  });
});



