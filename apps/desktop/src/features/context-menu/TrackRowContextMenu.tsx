type TrackRowContextAction =
  | "play_now"
  | "add_queue"
  | "play_next"
  | "select_batch"
  | "toggle_favorite"
  | "show_in_tracks"
  | "remove_queue"
  | "move_up_queue"
  | "move_down_queue";

type TrackRowContextMenuProps = {
  visible: boolean;
  trackTitle: string;
  x: number;
  y: number;
  isFavorite: boolean;
  isBatchSelected: boolean;
  isQueueSource: boolean;
  queueIndex: number;
  queueLength: number;
  onClose: () => void;
  onAction: (action: TrackRowContextAction) => void;
};

export default function TrackRowContextMenu(props: TrackRowContextMenuProps) {
  if (!props.visible) return null;

  return (
    <div
      className="track-row-context-backdrop"
      onClick={props.onClose}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        className="track-row-context-menu"
        role="menu"
        aria-label={`Actions for ${props.trackTitle}`}
        style={{ left: props.x, top: props.y }}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <button type="button" role="menuitem" onClick={() => props.onAction("play_now")}>
          Play Now
        </button>
        <button type="button" role="menuitem" onClick={() => props.onAction("add_queue")}>
          Add to Queue
        </button>
        <button type="button" role="menuitem" onClick={() => props.onAction("play_next")}>
          Play Next
        </button>
        <button type="button" role="menuitem" onClick={() => props.onAction("toggle_favorite")}>
          {props.isFavorite ? "Remove Favorite" : "Add Favorite"}
        </button>
        <button type="button" role="menuitem" onClick={() => props.onAction("show_in_tracks")}>
          Show in Tracks
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => props.onAction("select_batch")}
          disabled={props.isBatchSelected}
        >
          {props.isBatchSelected ? "Already in Selection" : "Add to Selection"}
        </button>
        {props.isQueueSource ? (
          <>
            <button type="button" role="menuitem" onClick={() => props.onAction("remove_queue")}>
              Remove from Queue
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => props.onAction("move_up_queue")}
              disabled={props.queueIndex <= 0}
            >
              Move Up
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => props.onAction("move_down_queue")}
              disabled={props.queueIndex < 0 || props.queueIndex >= props.queueLength - 1}
            >
              Move Down
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
