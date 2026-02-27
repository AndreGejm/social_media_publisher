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
      <button type="button" onClick={() => props.onScreenChange?.("Verify / QC")}>
        Mock Sync Verify
      </button>
    </div>
  )
}));

vi.mock("./QcPlayer", () => ({
  QcPlayer: () => <div data-testid="qc-player-mock">QC Player Mock</div>
}));

vi.mock("./services/tauriClient", () => tauriApiMocks);

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
    window.localStorage.clear();
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
    fireEvent.click(screen.getByRole("button", { name: "Tracks" }));

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

  it("opens an album-track row context menu and shows the track in Tracks", async () => {
    installTwoTrackCatalog();
    render(<MusicWorkspaceApp />);
    fireEvent.click(screen.getByRole("button", { name: "Albums" }));

    const albumRowMenuButton = await screen.findByRole("button", { name: "Open actions for Queue Candidate" });
    fireEvent.click(albumRowMenuButton);

    const menu = await screen.findByRole("menu", { name: /Actions for Queue Candidate/i });
    expect(within(menu).getByRole("menuitem", { name: "Show in Tracks" })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Show in Tracks" }));

    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: /Actions for Queue Candidate/i })).not.toBeInTheDocument();
    });
    expect(await screen.findByRole("heading", { name: "Queue Candidate" })).toBeInTheDocument();
  });

  it("supports album multi-select batch queue actions in Albums detail", async () => {
    installTwoTrackSingleAlbumCatalog();
    render(<MusicWorkspaceApp />);
    fireEvent.click(screen.getByRole("button", { name: "Albums" }));

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

    fireEvent.click(screen.getByRole("button", { name: "Tracks" }));
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

    fireEvent.click(screen.getByRole("tab", { name: "Listen" }));

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

    fireEvent.click(screen.getByRole("button", { name: "Mock Sync Verify" }));
    expect(await screen.findByTestId("publisher-ops-requested-screen")).toHaveTextContent("Verify / QC");
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

    fireEvent.click(screen.getByRole("button", { name: "Tracks" }));
    expect(screen.queryByRole("tablist", { name: "Library ingest sections" })).not.toBeInTheDocument();
  });

  it("keeps the Listen queue separate from the Publish release selection dock", async () => {
    installTwoTrackCatalog();
    render(<MusicWorkspaceApp />);
    fireEvent.click(screen.getByRole("button", { name: "Tracks" }));

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

    fireEvent.click(screen.getByRole("tab", { name: "Listen" }));
    fireEvent.click(await screen.findByRole("button", { name: "Tracks" }));
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

  it("keeps the shared transport mounted across workspace navigation", async () => {
    render(<MusicWorkspaceApp />);

    const transport = screen.getByRole("region", { name: "Shared transport" });
    expect(transport).toBeInTheDocument();
    expect(within(transport).getByRole("button", { name: "Play" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Albums" }));
    expect(screen.getByRole("region", { name: "Shared transport" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Publish" }));
    fireEvent.click(await screen.findByRole("button", { name: "Publisher Ops" }));
    expect(screen.getByRole("region", { name: "Shared transport" })).toBeInTheDocument();
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
});
