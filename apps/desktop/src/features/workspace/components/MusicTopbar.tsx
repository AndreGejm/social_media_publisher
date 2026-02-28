type Workspace = "Library" | "Quality Control" | "Playlists" | "Publisher Ops" | "Settings" | "About";
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
        <h2>{isPublisherOpsWorkspace ? "Publish Workflow" : props.activeWorkspace}</h2>
        <p className="music-topbar-subtitle">
          {isPublisherOpsWorkspace
            ? "You are in Publish mode (release workflow). General library browsing is hidden; use prepared drafts from Release Preview mode."
            : props.activeWorkspace === "Quality Control"
              ? "Run focused QC workflows: Track QC for single-file checks, Album QC for relational checks across tracks."
            : props.activeWorkspace === "Settings"
              ? "Configure local UI behavior, playback preferences, and path display settings."
              : props.activeWorkspace === "About"
                ? "Product information workspace."
              : "Library Summary"}
        </p>
      </div>
      {!isPublisherOpsWorkspace ? (
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
      ) : (
        <div className="publish-mode-banner" role="note" aria-label="Publish mode guidance">
          <span className="topbar-pill">Publish mode</span>
          <span className="publish-mode-banner-copy">
            Use the release workflow steps. Track selection comes from "Prepare for Release..." in Release Preview mode.
          </span>
        </div>
      )}
    </header>
  );
}
