import { HelpTooltip } from "../../shared/ui/HelpTooltip";

type PublishSelectionItem = {
  trackId: string;
  title: string;
  artistName: string;
  mediaPath: string;
  specPath: string;
  draftId: string;
};

type PublishSelectionDockProps = {
  visible: boolean;
  publishSelectionItems: PublishSelectionItem[];
  activeDraftTrackId: string | null;
  onClearSelection: () => void;
  onShowInTracks: () => void;
  onApplySelectionItem: (item: PublishSelectionItem) => void;
  onRemoveSelectionItem: (trackId: string) => void;
};

export default function PublishSelectionDock(props: PublishSelectionDockProps) {
  if (!props.visible) return null;

  return (
    <aside className="music-right-dock" aria-label="Queue and session state">
      <div className="queue-card queue-card-docked">
        <div className="queue-head">
          <h3>Release Selection</h3>
          <HelpTooltip content="Tracks prepared for the Publish workflow. This list is separate from the Release Preview playback queue.">
            <span className="queue-help-badge">Publish mode</span>
          </HelpTooltip>
        </div>
        <div className="queue-card-controls">
          <HelpTooltip content="Clears the current release selection list used to seed the publish workflow from Library/Quality Control.">
            <button
              type="button"
              className="secondary-action compact"
              onClick={props.onClearSelection}
              disabled={props.publishSelectionItems.length === 0}
            >
              Clear Selection
            </button>
          </HelpTooltip>
          <HelpTooltip content="Return to Track QC in Release Preview mode to prepare more tracks for publishing.">
            <button type="button" className="secondary-action compact" onClick={props.onShowInTracks}>
              Open Track QC
            </button>
          </HelpTooltip>
        </div>
        <div className="queue-summary-strip">
          <span>{props.publishSelectionItems.length} draft(s)</span>
          <span>{props.activeDraftTrackId ? "Draft loaded" : "No draft loaded"}</span>
        </div>
        <div className="queue-list">
          {props.publishSelectionItems.length === 0 ? (
            <p className="empty-state">No tracks prepared yet. Use "Prepare for Release..." from Release Preview mode.</p>
          ) : (
            props.publishSelectionItems.map((item, index) => (
              <div
                key={item.trackId}
                className={`queue-row${props.activeDraftTrackId === item.trackId ? " active" : ""}`}
              >
                <button
                  type="button"
                  className="queue-row-select"
                  onClick={() => props.onApplySelectionItem(item)}
                  aria-label={`Load ${item.title} into Publish workflow`}
                >
                  <span>{index + 1}</span>
                  <span className="queue-row-main">
                    <strong>{item.title}</strong>
                    <small>{item.artistName}</small>
                  </span>
                </button>
                <HelpTooltip content="Remove this prepared track from the release selection list.">
                  <button
                    type="button"
                    className="queue-row-remove"
                    onClick={() => props.onRemoveSelectionItem(item.trackId)}
                    aria-label={`Remove ${item.title} from release selection`}
                  >
                    Remove
                  </button>
                </HelpTooltip>
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}

