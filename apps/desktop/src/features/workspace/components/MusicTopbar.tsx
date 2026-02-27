type Workspace = "Library" | "Albums" | "Tracks" | "Playlists" | "Publisher Ops" | "Settings";
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
              {mode}
            </button>
          ))}
        </div>
        <h2>{props.activeMode === "Publish" ? "Publish Workflow" : props.activeWorkspace}</h2>
        <p className="music-topbar-subtitle">
          {props.activeMode === "Publish"
            ? "You are in Publish mode (release workflow). General library browsing is hidden; use prepared drafts from Listen mode."
            : props.activeWorkspace === "Settings"
              ? "Configure local UI behavior, playback preferences, and path display settings."
              : "Library Summary"}
        </p>
      </div>
      {props.activeMode === "Listen" ? (
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
            Use the release workflow steps. Track selection comes from "Prepare for Release..." in Listen mode.
          </span>
        </div>
      )}
    </header>
  );
}
