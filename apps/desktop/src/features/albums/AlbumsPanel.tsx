import type { MouseEvent as ReactMouseEvent } from "react";

import { HelpTooltip } from "../../shared/ui/HelpTooltip";
import type { CatalogListTracksResponse } from "../../services/tauri/tauriClient";

export type AlbumGroup = {
  key: string;
  albumTitle: string;
  artistName: string;
  trackIds: string[];
  trackCount: number;
  totalDurationMs: number;
  avgLoudnessLufs: number | null;
};

type AlbumsPanelProps = {
  hidden: boolean;
  albumGroups: AlbumGroup[];
  selectedAlbumGroup: AlbumGroup | null;
  onSelectAlbumGroup: (key: string) => void;
  formatClock: (seconds: number) => string;
  onPlayAlbumGroup: (group: AlbumGroup) => void;
  onAddAlbumToQueue: (trackIds: string[]) => void;
  onShowFirstAlbumTrackInTracks: (group: AlbumGroup) => void;
  selectedAlbumTracks: CatalogListTracksResponse["items"];
  favoriteTrackIdSet: Set<string>;
  selectedAlbumBatchTrackIds: string[];
  onAddSelectionToQueue: (trackIds: string[]) => void;
  onPlaySelectionNext: (trackIds: string[]) => void;
  onClearAlbumBatchSelection: () => void;
  onAlbumTrackContextMenu: (event: ReactMouseEvent<HTMLElement>, trackId: string) => void;
  batchSelectedTrackIdSet: Set<string>;
  onToggleTrackBatchSelection: (trackId: string, selected: boolean) => void;
  onShowTrackInTracks: (trackId: string) => void;
  trackRowContextMenuTrackId: string | null;
  trackRowContextMenuSource: "tracks" | "albums" | "queue" | null;
  onAlbumTrackRowMenuButtonClick: (event: ReactMouseEvent<HTMLButtonElement>, trackId: string) => void;
};

export default function AlbumsPanel(props: AlbumsPanelProps) {
  return (
    <section hidden={props.hidden} className="workspace-section albums-layout">
      <div className="albums-column albums-list-column">
        <div className="albums-head">
          <div>
            <p className="eyebrow">Album QC</p>
            <h3>Grouped, Cross-Track Review</h3>
          </div>
          <HelpTooltip content="Album groups are generated from track metadata in the local catalog. Unassigned tracks appear under Singles / Unassigned.">
            <span className="queue-help-badge">{props.albumGroups.length} groups</span>
          </HelpTooltip>
        </div>
        <div className="albums-list-shell" role="list" aria-label="Album groups">
          {props.albumGroups.length === 0 ? (
            <p className="empty-state">Import tracks to populate album groups.</p>
          ) : (
            props.albumGroups.map((group) => (
              <button
                key={group.key}
                type="button"
                role="listitem"
                className={`album-row${props.selectedAlbumGroup?.key === group.key ? " selected" : ""}`}
                onClick={() => props.onSelectAlbumGroup(group.key)}
              >
                <span className="album-row-title">{group.albumTitle}</span>
                <span className="album-row-subtitle">{group.artistName}</span>
                <span className="album-row-meta">
                  {group.trackCount} track(s) | {props.formatClock(group.totalDurationMs / 1000)}
                  {group.avgLoudnessLufs != null ? ` | ${group.avgLoudnessLufs.toFixed(1)} LUFS avg` : ""}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="albums-column albums-detail-column">
        {!props.selectedAlbumGroup ? (
          <p className="empty-state">Select an album group to inspect tracks and queue playback.</p>
        ) : (
          <div className="album-detail-card">
            <div className="album-detail-head">
              <div>
                <p className="eyebrow">Album Detail</p>
                <h3>{props.selectedAlbumGroup.albumTitle}</h3>
                <p className="track-detail-subtitle">{props.selectedAlbumGroup.artistName}</p>
              </div>
              <div className="track-detail-actions">
                <HelpTooltip content="Start playback with this album group's first track and load the album into the local session queue.">
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => props.onPlayAlbumGroup(props.selectedAlbumGroup!)}
                    disabled={props.selectedAlbumGroup.trackIds.length === 0}
                  >
                    Play Album
                  </button>
                </HelpTooltip>
                <HelpTooltip content="Append all album tracks to the end of the local session queue.">
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => props.onAddAlbumToQueue(props.selectedAlbumGroup!.trackIds)}
                    disabled={props.selectedAlbumGroup.trackIds.length === 0}
                  >
                    Add Album to Queue
                  </button>
                </HelpTooltip>
                <HelpTooltip content="Switch to Track QC mode and focus the first track in this album group.">
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => props.onShowFirstAlbumTrackInTracks(props.selectedAlbumGroup!)}
                    disabled={props.selectedAlbumGroup.trackIds.length === 0}
                  >
                    Show in Track QC
                  </button>
                </HelpTooltip>
              </div>
            </div>

            <div className="album-summary-grid">
              <div>
                <span className="track-meta-label">Tracks</span>
                <span className="track-meta-value">{props.selectedAlbumGroup.trackCount}</span>
              </div>
              <div>
                <span className="track-meta-label">Total Duration</span>
                <span className="track-meta-value">{props.formatClock(props.selectedAlbumGroup.totalDurationMs / 1000)}</span>
              </div>
              <div>
                <span className="track-meta-label">Average Loudness</span>
                <span className="track-meta-value">
                  {props.selectedAlbumGroup.avgLoudnessLufs != null
                    ? `${props.selectedAlbumGroup.avgLoudnessLufs.toFixed(1)} LUFS`
                    : "n/a"}
                </span>
              </div>
              <div>
                <span className="track-meta-label">Favorites in Album</span>
                <span className="track-meta-value">
                  {props.selectedAlbumTracks.filter((track) => props.favoriteTrackIdSet.has(track.track_id)).length}
                </span>
              </div>
            </div>

            {props.selectedAlbumBatchTrackIds.length > 0 ? (
              <div className="album-batch-actions tracks-batch-actions" role="group" aria-label="Batch actions for selected album tracks">
                <span className="queue-mode-pill">{props.selectedAlbumBatchTrackIds.length} selected</span>
                <HelpTooltip content="Add the selected album tracks to the end of the session queue in album order.">
                  <button
                    type="button"
                    className="secondary-action compact"
                    onClick={() => props.onAddSelectionToQueue(props.selectedAlbumBatchTrackIds)}
                  >
                    Add Selection to Queue
                  </button>
                </HelpTooltip>
                <HelpTooltip content="Insert the selected album tracks immediately after the current queue item in album order.">
                  <button
                    type="button"
                    className="secondary-action compact"
                    onClick={() => props.onPlaySelectionNext(props.selectedAlbumBatchTrackIds)}
                  >
                    Play Selection Next
                  </button>
                </HelpTooltip>
                <HelpTooltip content="Clear the current album track multi-selection.">
                  <button type="button" className="secondary-action compact" onClick={props.onClearAlbumBatchSelection}>
                    Clear Selection
                  </button>
                </HelpTooltip>
              </div>
            ) : null}

            <div className="album-track-list" role="list" aria-label={`${props.selectedAlbumGroup.albumTitle} tracks`}>
              {props.selectedAlbumTracks.map((track, index) => (
                <div
                  key={track.track_id}
                  className="album-track-row"
                  role="listitem"
                  onContextMenu={(event) => props.onAlbumTrackContextMenu(event, track.track_id)}
                >
                  <label className="track-row-batch-checkbox album-track-batch-checkbox">
                    <input
                      type="checkbox"
                      checked={props.batchSelectedTrackIdSet.has(track.track_id)}
                      onChange={(event) => props.onToggleTrackBatchSelection(track.track_id, event.target.checked)}
                      aria-label={`Select ${track.title} for album batch actions`}
                      onClick={(event) => event.stopPropagation()}
                    />
                  </label>
                  <button
                    type="button"
                    className="album-track-row-main"
                    onClick={() => props.onShowTrackInTracks(track.track_id)}
                  >
                    <span className="album-track-index">{index + 1}</span>
                    <span className="album-track-text">
                      <strong>
                        {props.favoriteTrackIdSet.has(track.track_id) ? "* " : ""}
                        {track.title}
                      </strong>
                      <small>
                        {Math.max(1, Math.round(track.duration_ms / 1000))}s | {track.loudness_lufs.toFixed(1)} LUFS
                      </small>
                    </span>
                  </button>
                  <div className="album-track-actions">
                    <HelpTooltip content="Open row actions (play, queue, favorite, or show in Track QC) for this album track.">
                      <button
                        type="button"
                        className="track-row-menu-button"
                        aria-label={`Open actions for ${track.title}`}
                        aria-haspopup="menu"
                        aria-expanded={props.trackRowContextMenuTrackId === track.track_id && props.trackRowContextMenuSource === "albums"}
                        onClick={(event) => props.onAlbumTrackRowMenuButtonClick(event, track.track_id)}
                      >
                        ...
                      </button>
                    </HelpTooltip>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

