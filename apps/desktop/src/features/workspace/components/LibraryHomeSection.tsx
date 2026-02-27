import { HelpTooltip } from "../../../HelpTooltip";
import SectionCollapseToggle from "./SectionCollapseToggle";

type LibraryHomeSectionProps = {
  hidden: boolean;
  libraryOverviewCollapsed: boolean;
  onToggleLibraryOverviewCollapsed: () => void;
  tracksCount: number;
  queueCount: number;
  albumGroupsCount: number;
  favoritesCount: number;
  libraryQuickActionsCollapsed: boolean;
  onToggleLibraryQuickActionsCollapsed: () => void;
  onOpenTracksWorkspace: () => void;
  onOpenAlbumsWorkspace: () => void;
  onShowPublishMode: () => void;
};

export default function LibraryHomeSection(props: LibraryHomeSectionProps) {
  return (
    <section hidden={props.hidden} className="workspace-section">
      <div className="collapsible-card">
        <div className="collapsible-card-head">
          <div>
            <p className="eyebrow">Library</p>
            <h3>Overview</h3>
            <p className="helper-text">Collapse summary cards on smaller screens or ultrawide layouts to reduce noise.</p>
          </div>
          <SectionCollapseToggle
            expanded={!props.libraryOverviewCollapsed}
            onToggle={props.onToggleLibraryOverviewCollapsed}
            label="Library overview"
            controlsId="library-overview-panel"
          />
        </div>
        <div id="library-overview-panel" hidden={props.libraryOverviewCollapsed} className="collapsible-panel-body">
          <div className="library-hero">
            <div className="library-hero-copy">
              <p className="eyebrow">Library</p>
              <h3>Music-first workspace, publisher pipeline preserved</h3>
              <p>
                This app now starts in a Rauversion-style music catalog shell. Import local audio, inspect metadata and waveform metrics,
                then bridge selected tracks into <strong>Publisher Ops</strong> when you are ready to run the deterministic publish
                pipeline.
              </p>
            </div>
            <div className="library-hero-cards">
              <div className="hero-card">
                <span className="hero-card-label">Tracks</span>
                <strong>{props.tracksCount.toLocaleString()}</strong>
              </div>
              <div className="hero-card">
                <span className="hero-card-label">Queue</span>
                <strong>{props.queueCount.toLocaleString()}</strong>
              </div>
              <div className="hero-card">
                <span className="hero-card-label">Albums</span>
                <strong>{props.albumGroupsCount.toLocaleString()}</strong>
              </div>
              <div className="hero-card">
                <span className="hero-card-label">Favorites</span>
                <strong>{props.favoritesCount.toLocaleString()}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="collapsible-card">
        <div className="collapsible-card-head">
          <div>
            <p className="eyebrow">Library</p>
            <h3>Quick Actions</h3>
          </div>
          <SectionCollapseToggle
            expanded={!props.libraryQuickActionsCollapsed}
            onToggle={props.onToggleLibraryQuickActionsCollapsed}
            label="Quick actions"
            controlsId="library-quick-actions-panel"
          />
        </div>
        <div id="library-quick-actions-panel" hidden={props.libraryQuickActionsCollapsed} className="collapsible-panel-body">
          <div className="library-quick-links">
            <HelpTooltip content="Open the detailed tracks browser with list + player detail panel.">
              <button type="button" className="secondary-action" onClick={props.onOpenTracksWorkspace}>
                Open Tracks Workspace
              </button>
            </HelpTooltip>
            <HelpTooltip content="Open the grouped album browser generated from imported catalog tracks.">
              <button type="button" className="secondary-action" onClick={props.onOpenAlbumsWorkspace}>
                Open Albums Workspace
              </button>
            </HelpTooltip>
            <HelpTooltip content="Open the existing publisher pipeline workflow (plan/verify/execute/report).">
              <button type="button" className="secondary-action" onClick={props.onShowPublishMode}>
                Open Publish Workflow
              </button>
            </HelpTooltip>
          </div>
        </div>
      </div>
    </section>
  );
}
