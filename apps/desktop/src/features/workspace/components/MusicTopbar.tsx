type Workspace = "Library" | "Quality Control" | "Playlists" | "Video Workspace" | "Publisher Ops" | "Settings" | "About";
type AppMode = "Listen" | "Publish";

type MusicTopbarProps = {
  activeMode: AppMode;
  activeWorkspace: Workspace;
  appModes: readonly AppMode[];
  onSwitchAppMode: (mode: AppMode) => void;
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
  const modeLabel = (mode: AppMode): string => (mode === "Listen" ? "Release Preview" : mode);
  const isPublisherOpsWorkspace = props.activeWorkspace === "Publisher Ops";
  const isAboutWorkspace = props.activeWorkspace === "About";

  return (
    <header className="music-topbar">
      <div>
        <p className="eyebrow">Workspace</p>
        <div className="music-mode-tabs" role="tablist" aria-label="Application mode">
          {props.appModes.map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={props.activeMode === mode}
              className={`music-mode-tab${props.activeMode === mode ? " active" : ""}`}
              onClick={() => props.onSwitchAppMode(mode)}
            >
              {modeLabel(mode)}
            </button>
          ))}
        </div>
        <h2>{isPublisherOpsWorkspace ? "Publish Workflow" : isAboutWorkspace ? "Skald QC" : props.activeWorkspace}</h2>
        <p className="music-topbar-subtitle">
          {isPublisherOpsWorkspace
            ? "You are in Publish mode (release workflow). General library browsing is hidden; use prepared drafts from Release Preview mode."
            : isAboutWorkspace
              ? "Static product and runtime diagnostics for support and build verification."
              : props.activeWorkspace === "Quality Control"
                ? "Run focused QC workflows: Track QC for single-file checks, Album QC for relational checks across tracks."
                : props.activeWorkspace === "Video Workspace"
                  ? "Compose one still image and one audio file into a YouTube-ready video render."
                  : props.activeWorkspace === "Settings"
                    ? "Configure local UI behavior, playback preferences, and path display settings."
                    : "Library Summary"}
        </p>
      </div>
      {isPublisherOpsWorkspace ? (
        <div className="publish-mode-banner" role="note" aria-label="Publish mode guidance">
          <span className="topbar-pill">Publish mode</span>
          <span className="publish-mode-banner-copy">
            Use the release workflow steps. Track selection comes from "Prepare for Release..." in Release Preview mode.
          </span>
        </div>
      ) : isAboutWorkspace ? (
        <div className="publish-mode-banner" role="note" aria-label="About workspace guidance">
          <span className="topbar-pill">Informational workspace</span>
          <span className="publish-mode-banner-copy">
            This page is intentionally mode-independent and contains no release workflow controls.
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