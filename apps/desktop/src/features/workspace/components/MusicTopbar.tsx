type Workspace = "Library" | "Quality Control" | "Playlists" | "Video Workspace" | "Publisher Ops" | "Settings" | "About";
type AppMode = "Listen" | "Publish";

const VIDEO_WORKSPACE_LABEL = "Video Rendering";

type MusicTopbarProps = {
  activeMode: AppMode;
  activeWorkspace: Workspace;
  onSwitchAppMode: (mode: AppMode) => void;
  onOpenVideoWorkspace: () => void;
  tracksCount: number;
  albumGroupsCount: number;
  favoritesCount: number;
  queueCount: number;
  importErrorsCount: number;
  onOpenTracksWorkspace: () => void;
  onOpenAlbumsWorkspace: () => void;
  onOpenLibraryWorkspace: () => void;
};

export default function MusicTopbar(props: MusicTopbarProps) {
  const isPublisherOpsWorkspace = props.activeWorkspace === "Publisher Ops";
  const isAboutWorkspace = props.activeWorkspace === "About";
  const isVideoWorkspace = props.activeWorkspace === "Video Workspace";
  const isReleasePreviewWorkspace = props.activeMode === "Listen" && !isVideoWorkspace;
  const activeWorkspaceLabel = isPublisherOpsWorkspace
    ? "Publish Workflow"
    : isAboutWorkspace
      ? "About"
      : isVideoWorkspace
        ? VIDEO_WORKSPACE_LABEL
        : props.activeWorkspace;
  const subtitle = isPublisherOpsWorkspace
    ? "You are in Publish mode (release workflow). General library browsing is hidden; use prepared drafts from Release Preview mode."
    : isAboutWorkspace
      ? null
      : props.activeWorkspace === "Quality Control"
        ? "Run focused QC workflows: Track QC for single-file checks, Album QC for relational checks across tracks."
        : props.activeWorkspace === "Video Workspace"
          ? "Compose one still image and one audio file into a YouTube-ready video render."
          : props.activeWorkspace === "Settings"
            ? "Configure local UI behavior, playback preferences, and path display settings."
            : "Library Summary";

  return (
    <header className="music-topbar">
      <div>
        <p className="eyebrow">Workspace</p>
        <div className="music-mode-tabs" role="tablist" aria-label="Application mode">
          <button
            type="button"
            role="tab"
            aria-selected={isReleasePreviewWorkspace}
            className={`music-mode-tab${isReleasePreviewWorkspace ? " active" : ""}`}
            onClick={() => props.onSwitchAppMode("Listen")}
          >
            Release Preview
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isVideoWorkspace}
            className={`music-mode-tab${isVideoWorkspace ? " active" : ""}`}
            onClick={props.onOpenVideoWorkspace}
          >
            {VIDEO_WORKSPACE_LABEL}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={props.activeMode === "Publish"}
            className={`music-mode-tab${props.activeMode === "Publish" ? " active" : ""}`}
            onClick={() => props.onSwitchAppMode("Publish")}
          >
            Publish
          </button>
        </div>
        <h2>{activeWorkspaceLabel}</h2>
        {subtitle ? <p className="music-topbar-subtitle">{subtitle}</p> : null}
      </div>
      {isPublisherOpsWorkspace ? (
        <div className="publish-mode-banner" role="note" aria-label="Publish mode guidance">
          <span className="topbar-pill">Publish mode</span>
          <span className="publish-mode-banner-copy">
            Use the release workflow steps. Track selection comes from "Prepare for Release..." in Release Preview mode.
          </span>
        </div>
      ) : (
        <div className="topbar-stats" aria-label="Library summary quick links">
          <button type="button" className="topbar-pill button" onClick={props.onOpenTracksWorkspace}>
            {props.tracksCount.toLocaleString()} track(s)
          </button>
          <button type="button" className="topbar-pill button" onClick={props.onOpenAlbumsWorkspace}>
            {props.albumGroupsCount.toLocaleString()} album group(s)
          </button>
          <button type="button" className="topbar-pill button" onClick={props.onOpenTracksWorkspace}>
            {props.favoritesCount.toLocaleString()} favorite(s)
          </button>
          <button type="button" className="topbar-pill button" onClick={props.onOpenTracksWorkspace}>
            {props.queueCount.toLocaleString()} queue item(s)
          </button>
          <button
            type="button"
            className={`topbar-pill button${props.importErrorsCount > 0 ? " warning" : ""}`}
            onClick={props.onOpenLibraryWorkspace}
          >
            {props.importErrorsCount} import error(s)
          </button>
        </div>
      )}
    </header>
  );
}