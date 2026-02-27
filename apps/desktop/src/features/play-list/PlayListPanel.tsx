import type { MouseEvent as ReactMouseEvent } from "react";

import { HelpTooltip } from "../../HelpTooltip";
import type { CatalogListTracksResponse } from "../../services/tauriClient";

type PlayListRowSource = "tracks" | "queue";

type TrackContextPayload = {
  source: PlayListRowSource;
  queueIndex?: number;
};

type PlayListPanelProps = {
  trackSearch: string;
  onTrackSearchChange: (value: string) => void;
  trackSort: string;
  trackSortOptions: Array<{ value: string; label: string }>;
  onTrackSortChange: (value: string) => void;
  onRefreshList: () => void;
  catalogLoading: boolean;
  isQueueMode: boolean;
  onSetMode: (mode: "library" | "queue") => void;
  queueUsesSessionOrder: boolean;
  queueLength: number;
  onShuffleQueue: () => void;
  onClearQueue: () => void;
  showFavoritesOnly: boolean;
  onToggleFavoritesOnly: () => void;
  onOpenAlbumsView: () => void;
  orderedBatchSelectionIds: string[];
  onPlaySelectionNow: () => void;
  onAddSelectionToQueue: (trackIds: string[]) => void;
  onPlaySelectionNext: (trackIds: string[]) => void;
  onClearBatchSelection: () => void;
  activePlayListItems: CatalogListTracksResponse["items"];
  catalogItemsCount: number;
  selectedTrackId: string;
  batchSelectedTrackIdSet: Set<string>;
  onToggleTrackBatchSelection: (trackId: string, selected: boolean) => void;
  onArmTrackFromPlayList: (trackId: string, options?: { queueIndex?: number }) => void;
  onPlayTrackNow: (trackId: string) => void;
  favoriteTrackIdSet: Set<string>;
  contextMenuTrackId: string | null;
  onTrackRowContextMenu: (event: ReactMouseEvent<HTMLElement>, trackId: string, options: TrackContextPayload) => void;
  onTrackRowMenuButtonClick: (
    event: ReactMouseEvent<HTMLButtonElement>,
    trackId: string,
    options: TrackContextPayload
  ) => void;
  queueDragTrackId: string | null;
  onQueueDragStart: (trackId: string) => void;
  onQueueReorderDrop: (dragTrackId: string, dropTargetTrackId: string) => void;
  onQueueDragEnd: () => void;
};

export default function PlayListPanel(props: PlayListPanelProps) {
  return (
    <div className="tracks-column tracks-list-column">
      <div className="tracks-view-head" role="region" aria-label="Tracks view actions">
        <div className="tracks-toolbar">
          <HelpTooltip content="Search local tracks by title, artist, or album.">
            <input
              type="search"
              className="tracks-search"
              value={props.trackSearch}
              onChange={(event) => props.onTrackSearchChange(event.target.value)}
              placeholder="Search tracks, artists, albums..."
              aria-label="Search tracks"
            />
          </HelpTooltip>
          <HelpTooltip content="Sorts the visible track list locally (search and favorites filters still apply).">
            <select
              className="tracks-toolbar-select"
              value={props.trackSort}
              onChange={(event) => props.onTrackSortChange(event.target.value)}
              aria-label="Track sort"
            >
              {props.trackSortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </HelpTooltip>
          <HelpTooltip content="Reload the local track list from SQLite.">
            <button type="button" className="secondary-action" onClick={props.onRefreshList} disabled={props.catalogLoading}>
              {props.catalogLoading ? "Refreshing List..." : "Refresh List"}
            </button>
          </HelpTooltip>
        </div>
        <div className="tracks-subtoolbar">
          <div className="play-list-mode-toggle" role="tablist" aria-label="Play list mode">
            <button
              type="button"
              role="tab"
              aria-selected={!props.isQueueMode}
              className={`play-list-mode-tab${!props.isQueueMode ? " active" : ""}`}
              onClick={() => props.onSetMode("library")}
            >
              Library
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={props.isQueueMode}
              className={`play-list-mode-tab${props.isQueueMode ? " active" : ""}`}
              onClick={() => props.onSetMode("queue")}
            >
              Queue
            </button>
          </div>
          <span className={`queue-mode-pill${props.queueUsesSessionOrder ? "" : " subtle"}`}>
            {props.queueUsesSessionOrder ? "Queue locked" : "Queue follows visible list"}
          </span>
          {props.isQueueMode ? (
            <>
              <HelpTooltip content="Randomizes the current local queue order for this app session.">
                <button
                  type="button"
                  className="secondary-action compact"
                  onClick={props.onShuffleQueue}
                  disabled={props.queueLength < 2}
                >
                  Shuffle
                </button>
              </HelpTooltip>
              <HelpTooltip content="Clears the manual queue so playback follows the visible library list again.">
                <button
                  type="button"
                  className="secondary-action compact"
                  onClick={props.onClearQueue}
                  disabled={!props.queueUsesSessionOrder}
                >
                  Clear Queue
                </button>
              </HelpTooltip>
            </>
          ) : (
            <>
              <HelpTooltip content="Toggle a favorites-only view using local session favorites.">
                <button
                  type="button"
                  className={`filter-chip${props.showFavoritesOnly ? " active" : ""}`}
                  onClick={props.onToggleFavoritesOnly}
                >
                  {props.showFavoritesOnly ? "Favorites Only" : "All Tracks"}
                </button>
              </HelpTooltip>
              <HelpTooltip content="Opens the album grouping view for the current visible tracks.">
                <button type="button" className="secondary-action compact" onClick={props.onOpenAlbumsView}>
                  Albums View
                </button>
              </HelpTooltip>
            </>
          )}
          {!props.isQueueMode && props.orderedBatchSelectionIds.length > 0 ? (
            <div className="tracks-batch-actions" role="group" aria-label="Batch actions for selected tracks">
              <span className="queue-mode-pill">{props.orderedBatchSelectionIds.length} selected</span>
              <HelpTooltip content="Replace the session queue with the selected tracks (visible-list order) and start playback from the first selected track.">
                <button type="button" className="secondary-action compact" onClick={props.onPlaySelectionNow}>
                  Play Selection
                </button>
              </HelpTooltip>
              <HelpTooltip content="Add the selected tracks to the end of the session queue in visible-list order.">
                <button
                  type="button"
                  className="secondary-action compact"
                  onClick={() => props.onAddSelectionToQueue(props.orderedBatchSelectionIds)}
                >
                  Add Selection to Queue
                </button>
              </HelpTooltip>
              <HelpTooltip content="Insert the selected tracks immediately after the current queue item in visible-list order.">
                <button
                  type="button"
                  className="secondary-action compact"
                  onClick={() => props.onPlaySelectionNext(props.orderedBatchSelectionIds)}
                >
                  Play Selection Next
                </button>
              </HelpTooltip>
              <HelpTooltip content="Clear the current multi-selection in the track list.">
                <button type="button" className="secondary-action compact" onClick={props.onClearBatchSelection}>
                  Clear Selection
                </button>
              </HelpTooltip>
            </div>
          ) : null}
        </div>
      </div>

      <div className="tracks-list-shell" role="list" aria-label={props.isQueueMode ? "Queue tracks" : "Library tracks"}>
        {props.activePlayListItems.length === 0 ? (
          <p className="empty-state">
            {props.isQueueMode
              ? "Queue is empty. Add tracks from Library mode or Play Selection."
              : props.catalogItemsCount === 0
                ? "No tracks imported yet. Use Library > Import Files in the sidebar."
                : "No tracks match the current filters. Try clearing search or turning off Favorites Only."}
          </p>
        ) : (
          props.activePlayListItems.map((item, index) => (
            <div
              key={item.track_id}
              role="listitem"
              className={`track-row-shell${props.selectedTrackId === item.track_id ? " selected" : ""}${props.batchSelectedTrackIdSet.has(item.track_id) ? " batch-selected" : ""}${props.isQueueMode ? " queue-row-shell" : ""}${props.queueDragTrackId === item.track_id ? " queue-dragging" : ""}`}
              onContextMenu={(event) =>
                props.onTrackRowContextMenu(event, item.track_id, {
                  source: props.isQueueMode ? "queue" : "tracks",
                  queueIndex: props.isQueueMode ? index : undefined
                })
              }
              draggable={props.isQueueMode}
              onDragStart={() => {
                if (!props.isQueueMode) return;
                props.onQueueDragStart(item.track_id);
              }}
              onDragOver={(event) => {
                if (!props.isQueueMode || !props.queueDragTrackId) return;
                event.preventDefault();
              }}
              onDrop={() => {
                if (!props.isQueueMode || !props.queueDragTrackId || props.queueDragTrackId === item.track_id) return;
                props.onQueueReorderDrop(props.queueDragTrackId, item.track_id);
                props.onQueueDragEnd();
              }}
              onDragEnd={props.onQueueDragEnd}
            >
              <label className="track-row-batch-checkbox">
                <input
                  type="checkbox"
                  checked={props.batchSelectedTrackIdSet.has(item.track_id)}
                  onChange={(event) => props.onToggleTrackBatchSelection(item.track_id, event.target.checked)}
                  aria-label={`Select ${item.title} for batch actions`}
                  onClick={(event) => event.stopPropagation()}
                />
              </label>
              <button
                type="button"
                className="track-row track-row-main-button"
                onClick={() =>
                  props.onArmTrackFromPlayList(
                    item.track_id,
                    props.isQueueMode ? { queueIndex: index } : undefined
                  )
                }
                onDoubleClick={() => props.onPlayTrackNow(item.track_id)}
                aria-current={props.selectedTrackId === item.track_id ? "true" : undefined}
              >
                <span className="track-row-title">
                  {props.isQueueMode ? <span className="track-row-queue-index">{index + 1}. </span> : null}
                  {props.favoriteTrackIdSet.has(item.track_id) ? <span className="track-row-favorite">*</span> : null}
                  {item.title}
                </span>
                <span className="track-row-subtitle">
                  {item.artist_name}
                  {item.album_title ? ` | ${item.album_title}` : ""}
                </span>
                <span className="track-row-meta">
                  {Math.max(1, Math.round(item.duration_ms / 1000))}s | {item.loudness_lufs.toFixed(1)} LUFS
                </span>
              </button>
              <HelpTooltip content="Open track row actions (Play Now, Add to Queue, Play Next, Add to Selection)." side="bottom">
                <button
                  type="button"
                  className="track-row-menu-button"
                  aria-label={`Track actions for ${item.title}`}
                  aria-haspopup="menu"
                  aria-expanded={props.contextMenuTrackId === item.track_id}
                  onClick={(event) =>
                    props.onTrackRowMenuButtonClick(event, item.track_id, {
                      source: props.isQueueMode ? "queue" : "tracks",
                      queueIndex: props.isQueueMode ? index : undefined
                    })
                  }
                >
                  ...
                </button>
              </HelpTooltip>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
