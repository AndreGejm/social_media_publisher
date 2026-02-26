import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauriApiMocks = vi.hoisted(() => ({
  catalogAddLibraryRoot: vi.fn(),
  catalogGetIngestJob: vi.fn(),
  catalogGetTrack: vi.fn(),
  catalogImportFiles: vi.fn(),
  catalogListTracks: vi.fn(),
  catalogListLibraryRoots: vi.fn(),
  catalogRemoveLibraryRoot: vi.fn(),
  catalogScanRoot: vi.fn(),
  catalogUpdateTrackMetadata: vi.fn(),
  pickDirectoryDialog: vi.fn(),
  publisherCreateDraftFromTrack: vi.fn()
}));

vi.mock("./App", () => ({
  default: (props: { prefillMediaPath?: string | null; prefillSpecPath?: string | null }) => (
    <div data-testid="publisher-ops-mock">
      Publisher Ops Mock
      <span data-testid="publisher-ops-prefill-media">{props.prefillMediaPath ?? ""}</span>
      <span data-testid="publisher-ops-prefill-spec">{props.prefillSpecPath ?? ""}</span>
    </div>
  )
}));

vi.mock("./QcPlayer", () => ({
  QcPlayer: () => <div data-testid="qc-player-mock">QC Player Mock</div>
}));

vi.mock("./tauri-api", () => tauriApiMocks);

import MusicWorkspaceApp from "./MusicWorkspaceApp";

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
  tauriApiMocks.catalogAddLibraryRoot.mockResolvedValue({
    root_id: "e".repeat(64),
    path: "C:/Music",
    enabled: true,
    created_at: "2026-02-26T12:00:00Z",
    updated_at: "2026-02-26T12:00:00Z"
  });
  tauriApiMocks.catalogRemoveLibraryRoot.mockResolvedValue(true);
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

async function openTracksAndSelectFirstTrack() {
  fireEvent.click(screen.getByRole("button", { name: "Tracks" }));
  const trackRow = await screen.findByRole("button", { name: /^Authoring Track/i });
  fireEvent.click(trackRow);
  await screen.findByRole("heading", { name: "Authoring Track" });
}

describe("MusicWorkspaceApp metadata editor", () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    Object.values(tauriApiMocks).forEach((mockFn) => mockFn.mockReset());
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

  it("supports multi-select batch actions in Tracks", async () => {
    installTwoTrackCatalog();
    render(<MusicWorkspaceApp />);
    fireEvent.click(screen.getByRole("button", { name: "Tracks" }));

    fireEvent.click(await screen.findByRole("checkbox", { name: `Select ${baseTrackListItem.title} for batch actions` }));
    fireEvent.click(screen.getByRole("checkbox", { name: `Select ${secondTrackListItem.title} for batch actions` }));

    expect(screen.getByRole("button", { name: "Add Selection to Queue" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add Selection to Queue" }));

    expect(await screen.findByText("Added 2 tracks to queue.")).toBeInTheDocument();
    const queueDock = screen.getByLabelText("Queue and session state");
    expect(within(queueDock).getByText("2 item(s)")).toBeInTheDocument();
    expect(within(queueDock).getByText(baseTrackListItem.title)).toBeInTheDocument();
    expect(within(queueDock).getByText(secondTrackListItem.title)).toBeInTheDocument();
  });

  it("opens a row context menu and runs Play Now", async () => {
    installTwoTrackCatalog();
    render(<MusicWorkspaceApp />);
    fireEvent.click(screen.getByRole("button", { name: "Tracks" }));

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

  it("keeps the shared transport mounted across workspace navigation", async () => {
    render(<MusicWorkspaceApp />);

    const transport = screen.getByRole("region", { name: "Shared transport" });
    expect(transport).toBeInTheDocument();
    expect(within(transport).getByRole("button", { name: "Play" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Albums" }));
    expect(screen.getByRole("region", { name: "Shared transport" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Publisher Ops" }));
    expect(screen.getByRole("region", { name: "Shared transport" })).toBeInTheDocument();
  });
});
