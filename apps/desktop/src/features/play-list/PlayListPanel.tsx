import { Fragment, useState } from "react";
import type { CSSProperties, HTMLAttributes, MouseEvent as ReactMouseEvent, Ref, UIEvent } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragOverEvent,
  type DragEndEvent,
  type DragStartEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { HelpTooltip } from "../../shared/ui/HelpTooltip";
import type { CatalogListTracksResponse } from "../../services/tauri/tauriClient";

type PlayListRowSource = "tracks" | "queue";
type TrackGroupMode = "none" | "artist" | "album";

type TrackContextPayload = {
  source: PlayListRowSource;
  queueIndex?: number;
};

type PlayListPanelProps = {
  trackSearch: string;
  trackSearchInputRef?: Ref<HTMLInputElement>;
  onTrackSearchChange: (value: string) => void;
  trackSort: string;
  trackSortOptions: Array<{ value: string; label: string }>;
  onTrackSortChange: (value: string) => void;
  trackGroupMode: TrackGroupMode;
  trackGroupOptions: Array<{ value: TrackGroupMode; label: string }>;
  onTrackGroupModeChange: (value: TrackGroupMode) => void;
  onRefreshList: () => void;
  catalogLoading: boolean;
  catalogLoadingMore: boolean;
  canLoadMoreCatalogItems: boolean;
  onLoadMoreCatalogItems: () => void;
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

type SortableBindings = {
  setNodeRef: (element: HTMLElement | null) => void;
  style: CSSProperties;
  attributes: Record<string, unknown>;
  listeners: Record<string, unknown>;
  isDragging: boolean;
  isOver: boolean;
};

function albumTitleLabel(item: CatalogListTracksResponse["items"][number]): string {
  const albumTitle = item.album_title?.trim();
  return albumTitle && albumTitle.length > 0 ? albumTitle : "Singles / Unassigned";
}

function artistNameLabel(item: CatalogListTracksResponse["items"][number]): string {
  const artistName = item.artist_name?.trim();
  return artistName && artistName.length > 0 ? artistName : "Unknown Artist";
}

function albumGroupKey(item: CatalogListTracksResponse["items"][number]): string {
  return `${artistNameLabel(item).toLowerCase()}::${albumTitleLabel(item).toLowerCase()}`;
}

function SortableQueueTrackShell(props: {
  id: string;
  children: (bindings: SortableBindings) => JSX.Element;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id: props.id
  });
  return props.children({
    setNodeRef,
    style: {
      transform: CSS.Transform.toString(transform),
      transition
    },
    attributes: attributes as unknown as Record<string, unknown>,
    listeners: listeners as unknown as Record<string, unknown>,
    isDragging,
    isOver
  });
}

export default function PlayListPanel(props: PlayListPanelProps) {
  const [queueDropTargetTrackId, setQueueDropTargetTrackId] = useState<string | null>(null);
  const showAlbumGrouping = !props.isQueueMode && props.trackGroupMode === "album";
  const showArtistGrouping = !props.isQueueMode && props.trackGroupMode === "artist";

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleQueueDndDragStart = (event: DragStartEvent) => {
    const dragTrackId = String(event.active.id);
    setQueueDropTargetTrackId(null);
    props.onQueueDragStart(dragTrackId);
  };

  const handleQueueDndDragOver = (event: DragOverEvent) => {
    if (!event.over) return;
    setQueueDropTargetTrackId(String(event.over.id));
  };

  const handleQueueDndDragEnd = (event: DragEndEvent) => {
    const dragTrackId = String(event.active.id);
    const dropTargetTrackId = event.over ? String(event.over.id) : null;
    if (dropTargetTrackId && dropTargetTrackId !== dragTrackId) {
      props.onQueueReorderDrop(dragTrackId, dropTargetTrackId);
    }
    setQueueDropTargetTrackId(null);
    props.onQueueDragEnd();
  };

  const handleQueueDndDragCancel = () => {
    setQueueDropTargetTrackId(null);
    props.onQueueDragEnd();
  };

  const handleTrackListScroll = (event: UIEvent<HTMLDivElement>) => {
    if (!props.canLoadMoreCatalogItems || props.catalogLoading || props.catalogLoadingMore) return;
    const element = event.currentTarget;
    const nearBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 96;
    if (nearBottom) {
      props.onLoadMoreCatalogItems();
    }
  };

  const renderTrackRow = (
    item: CatalogListTracksResponse["items"][number],
    index: number,
    sortable: SortableBindings | null
  ) => {
    const previousItem = index > 0 ? props.activePlayListItems[index - 1] : null;
    let showGroupHeader = false;
    let groupHeaderTitle = "";
    let groupHeaderSubtitle = "";

    if (showAlbumGrouping) {
      showGroupHeader = !previousItem || albumGroupKey(previousItem) !== albumGroupKey(item);
      groupHeaderTitle = albumTitleLabel(item);
      groupHeaderSubtitle = artistNameLabel(item);
    } else if (showArtistGrouping) {
      showGroupHeader =
        !previousItem || artistNameLabel(previousItem).toLowerCase() !== artistNameLabel(item).toLowerCase();
      groupHeaderTitle = artistNameLabel(item);
      groupHeaderSubtitle = "Artist";
    }

    const isSortableDragging = Boolean(sortable?.isDragging);
    const isSortableOver = Boolean(sortable?.isOver);

    return (
      <Fragment key={item.track_id}>
        {showGroupHeader ? (
          <div className="track-album-group-header" role="presentation" aria-hidden="true">
            <strong>{groupHeaderTitle}</strong>
            <span>{groupHeaderSubtitle}</span>
          </div>
        ) : null}
        <div
          ref={sortable ? sortable.setNodeRef : undefined}
          style={sortable ? sortable.style : undefined}
          role="listitem"
          className={`track-row-shell${props.selectedTrackId === item.track_id ? " selected" : ""}${props.batchSelectedTrackIdSet.has(item.track_id) ? " batch-selected" : ""}${props.isQueueMode ? " queue-row-shell" : ""}${props.queueDragTrackId === item.track_id || isSortableDragging ? " queue-dragging" : ""}${props.isQueueMode && (queueDropTargetTrackId === item.track_id || isSortableOver) ? " queue-drop-target" : ""}`}
          onContextMenu={(event) =>
            props.onTrackRowContextMenu(event, item.track_id, {
              source: props.isQueueMode ? "queue" : "tracks",
              queueIndex: props.isQueueMode ? index : undefined
            })
          }
          draggable={props.isQueueMode}
          onDragStart={(event) => {
            if (!props.isQueueMode) return;
            event.dataTransfer.setData("text/plain", item.track_id);
            event.dataTransfer.effectAllowed = "move";
            setQueueDropTargetTrackId(null);
            props.onQueueDragStart(item.track_id);
          }}
          onDragEnter={() => {
            if (!props.isQueueMode) return;
            if (props.queueDragTrackId === item.track_id) return;
            setQueueDropTargetTrackId(item.track_id);
          }}
          onDragOver={(event) => {
            if (!props.isQueueMode) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            if (props.queueDragTrackId === item.track_id) return;
            if (queueDropTargetTrackId !== item.track_id) {
              setQueueDropTargetTrackId(item.track_id);
            }
          }}
          onDrop={(event) => {
            if (!props.isQueueMode) return;
            event.preventDefault();
            const dragTrackId = props.queueDragTrackId || event.dataTransfer.getData("text/plain");
            if (!dragTrackId || dragTrackId === item.track_id) {
              setQueueDropTargetTrackId(null);
              return;
            }
            props.onQueueReorderDrop(dragTrackId, item.track_id);
            setQueueDropTargetTrackId(null);
            props.onQueueDragEnd();
          }}
          onDragEnd={() => {
            setQueueDropTargetTrackId(null);
            props.onQueueDragEnd();
          }}
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
              props.onArmTrackFromPlayList(item.track_id, props.isQueueMode ? { queueIndex: index } : undefined)
            }
            onDoubleClick={() => props.onPlayTrackNow(item.track_id)}
            aria-current={props.selectedTrackId === item.track_id ? "true" : undefined}
            {...(props.isQueueMode && sortable
              ? ({ ...sortable.attributes, ...sortable.listeners } as HTMLAttributes<HTMLButtonElement>)
              : {})}
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
      </Fragment>
    );
  };

  const renderedRows = props.activePlayListItems.map((item, index) => {
    if (props.isQueueMode) {
      return (
        <SortableQueueTrackShell key={item.track_id} id={item.track_id}>
          {(sortable) => renderTrackRow(item, index, sortable)}
        </SortableQueueTrackShell>
      );
    }
    return renderTrackRow(item, index, null);
  });

  return (
    <div className="tracks-column tracks-list-column">
      <div className="tracks-view-head" role="region" aria-label="Tracks view actions">
        <div className="tracks-toolbar">
          <HelpTooltip content="Search local tracks by title, artist, album, or path.">
            <input
              ref={props.trackSearchInputRef}
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
          <HelpTooltip content="Controls local list grouping independently from sort mode.">
            <select
              className="tracks-toolbar-select"
              value={props.trackGroupMode}
              onChange={(event) => props.onTrackGroupModeChange(event.target.value as TrackGroupMode)}
              aria-label="Track grouping"
            >
              {props.trackGroupOptions.map((option) => (
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
              <HelpTooltip content="Switch Quality Control to Album QC mode for grouped, cross-track review.">
                <button type="button" className="secondary-action compact" onClick={props.onOpenAlbumsView}>
                  Album QC View
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

      <div
        className="tracks-list-shell"
        role="list"
        aria-label={props.isQueueMode ? "Queue tracks" : "Library tracks"}
        onScroll={handleTrackListScroll}
      >
        {props.activePlayListItems.length === 0 ? (
          <p className="empty-state">
            {props.isQueueMode
              ? "Queue is empty. Add tracks from Library mode or Play Selection."
              : props.catalogItemsCount === 0
                ? "No tracks imported yet. Use Library > Import Files in the sidebar."
                : "No tracks match the current filters. Try clearing search or turning off Favorites Only."}
          </p>
        ) : props.isQueueMode ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleQueueDndDragStart}
            onDragOver={handleQueueDndDragOver}
            onDragEnd={handleQueueDndDragEnd}
            onDragCancel={handleQueueDndDragCancel}
          >
            <SortableContext
              items={props.activePlayListItems.map((item) => item.track_id)}
              strategy={verticalListSortingStrategy}
            >
              {renderedRows}
            </SortableContext>
          </DndContext>
        ) : (
          renderedRows
        )}
        {!props.isQueueMode && props.canLoadMoreCatalogItems ? (
          <button
            type="button"
            className="secondary-action compact load-more-button"
            onClick={props.onLoadMoreCatalogItems}
            disabled={props.catalogLoading || props.catalogLoadingMore}
          >
            {props.catalogLoadingMore ? "Loading more..." : "Load more tracks"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

