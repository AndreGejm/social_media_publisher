import type { RefObject } from "react";

import { HelpTooltip } from "../../shared/ui/HelpTooltip";
import { QcPlayer, type QcPlayerAnalysis } from "../player/QcPlayer";
import type {
  CatalogTrackDetailResponse,
  QcCodecProfileResponse,
  QcPreviewSessionStateResponse,
  QcPreviewVariant,
  UiAppError
} from "../../services/tauri/tauriClient";

type TrackEditorState = {
  trackId: string;
  visibilityPolicy: string;
  licensePolicy: string;
  downloadable: boolean;
  tagsInput: string;
};

type TrackDetailPanelProps = {
  selectedTrackLoading: boolean;
  selectedTrackDetail: CatalogTrackDetailResponse | null;
  selectedTrackAnalysis: QcPlayerAnalysis | null;
  trackDetailEditMode: boolean;
  trackEditorDirty: boolean;
  isSelectedTrackFavorite: boolean;
  onPlayNow: (trackId: string) => void;
  onAddToQueue: (trackId: string) => void;
  onPlayNext: (trackId: string) => void;
  onToggleFavorite: (trackId: string) => void;
  onEnterEditMode: () => void;
  onSaveMetadata: () => void;
  canSaveTrackMetadata: boolean;
  trackEditorSaving: boolean;
  canResetTrackMetadata: boolean;
  onResetFields: () => void;
  onCancelEdit: () => void;
  onOpenPublisherOps: (track: CatalogTrackDetailResponse) => void;
  publisherBridgeLoadingTrackId: string | null;
  showFullPaths: boolean;
  formatDisplayPath: (path: string, options: { showFullPaths: boolean }) => string;
  trackEditor: TrackEditorState;
  onPatchTrackEditor: (patch: Partial<TrackEditorState>) => void;
  trackVisibilityOptions: readonly string[];
  trackLicenseOptions: readonly string[];
  trackEditorTagsPreviewCount: number;
  trackEditorError: UiAppError | null;
  trackEditorNotice: string | null;
  qcCurrentTimeSec: number;
  qcIsPlaying: boolean;
  onQcTogglePlay: () => void;
  onQcSeek: (ratio: number) => void;
  onQcTimeUpdate: (seconds: number) => void;
  onQcPlay: () => void;
  onQcPause: () => void;
  playerAudioRef: RefObject<HTMLAudioElement>;
  playerAudioSrc?: string;
  qcCodecPreviewEnabled: boolean;
  qcCodecPreviewLoading: boolean;
  qcCodecProfiles: QcCodecProfileResponse[];
  qcPreviewProfileAId: string;
  qcPreviewProfileBId: string;
  qcPreviewBlindXEnabled: boolean;
  qcPreviewSession: QcPreviewSessionStateResponse | null;
  onQcPreviewProfileAChange: (profileId: string) => void;
  onQcPreviewProfileBChange: (profileId: string) => void;
  onQcPreviewBlindXEnabledChange: (enabled: boolean) => void;
  onQcPreviewSetVariant: (variant: QcPreviewVariant) => void;
  onQcPreviewRevealBlindX: () => void;
  qcBatchExportEnabled: boolean;
  qcBatchExportSubmitting: boolean;
  qcBatchExportOutputDir: string;
  qcBatchExportTargetLufs: string;
  qcBatchExportSelectedProfileIds: string[];
  qcBatchExportStatusMessage: string | null;
  onQcBatchExportOutputDirChange: (value: string) => void;
  onQcBatchExportTargetLufsChange: (value: string) => void;
  onQcBatchExportToggleProfile: (profileId: string) => void;
  onQcStartBatchExport: () => void;
};

export default function TrackDetailPanel(props: TrackDetailPanelProps) {
  return (
    <div className="tracks-column tracks-detail-column">
      {props.selectedTrackLoading ? <p className="empty-state">Loading track detail...</p> : null}
      {!props.selectedTrackLoading && !props.selectedTrackDetail ? (
        <p className="empty-state">Select a track to view waveform, QC metrics, and metadata.</p>
      ) : null}
      {props.selectedTrackDetail && props.selectedTrackAnalysis ? (
        <div className="track-detail-stack">
          <div className="track-detail-card">
            <div className="track-detail-head">
              <div>
                <p className="eyebrow">Track Detail</p>
                <h3>{props.selectedTrackDetail.title}</h3>
                <p className="track-detail-subtitle">
                  {props.selectedTrackDetail.artist_name}
                  {props.selectedTrackDetail.album_title ? ` | ${props.selectedTrackDetail.album_title}` : ""}
                </p>
                <div className="track-detail-mode-row">
                  <span className={`track-detail-mode-pill${props.trackDetailEditMode ? " editing" : ""}`}>
                    {props.trackDetailEditMode ? "Edit mode" : "View mode"}
                  </span>
                  {props.trackDetailEditMode ? (
                    <span className="track-detail-mode-hint">
                      {props.trackEditorDirty ? "Unsaved changes" : "Editing (no unsaved changes)"}
                    </span>
                  ) : (
                    <span className="track-detail-mode-hint">Use Edit Metadata to modify local catalog fields.</span>
                  )}
                </div>
              </div>
              <div className="track-detail-actions">
                <HelpTooltip content="Play this track now and move it to the front of the current local session queue.">
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => props.onPlayNow(props.selectedTrackDetail!.track_id)}
                  >
                    Play Now
                  </button>
                </HelpTooltip>
                <HelpTooltip content="Adds this track to the end of the local session queue without changing playback.">
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => props.onAddToQueue(props.selectedTrackDetail!.track_id)}
                  >
                    Add to Queue
                  </button>
                </HelpTooltip>
                <HelpTooltip content="Places this track immediately after the currently playing track in the local queue.">
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => props.onPlayNext(props.selectedTrackDetail!.track_id)}
                  >
                    Play Next
                  </button>
                </HelpTooltip>
                <HelpTooltip content="Marks this track as a local session favorite for quick filtering and browsing.">
                  <button
                    type="button"
                    className={`secondary-action${props.isSelectedTrackFavorite ? " active" : ""}`}
                    onClick={() => props.onToggleFavorite(props.selectedTrackDetail!.track_id)}
                    aria-pressed={props.isSelectedTrackFavorite}
                  >
                    {props.isSelectedTrackFavorite ? "Unfavorite" : "Favorite"}
                  </button>
                </HelpTooltip>
                {!props.trackDetailEditMode ? (
                  <HelpTooltip content="Enables inline metadata editing for this track detail view.">
                    <button type="button" className="secondary-action" onClick={props.onEnterEditMode}>
                      Edit Metadata
                    </button>
                  </HelpTooltip>
                ) : (
                  <>
                    <HelpTooltip content="Saves tags, rights, and visibility to the local SQLite catalog for this track.">
                      <button
                        type="button"
                        className="primary-action"
                        onClick={props.onSaveMetadata}
                        disabled={!props.canSaveTrackMetadata}
                      >
                        {props.trackEditorSaving ? "Saving..." : "Save Metadata"}
                      </button>
                    </HelpTooltip>
                    {props.canResetTrackMetadata ? (
                      <HelpTooltip content="Restores editor fields to the last saved metadata without leaving edit mode.">
                        <button
                          type="button"
                          className="secondary-action"
                          onClick={props.onResetFields}
                          disabled={props.trackEditorSaving}
                        >
                          Reset Fields
                        </button>
                      </HelpTooltip>
                    ) : null}
                    <HelpTooltip content="Cancels edit mode and restores the last saved metadata for this track.">
                      <button
                        type="button"
                        className="secondary-action"
                        onClick={props.onCancelEdit}
                        disabled={props.trackEditorSaving}
                      >
                        Cancel Edit
                      </button>
                    </HelpTooltip>
                  </>
                )}
                <HelpTooltip
                  variant="popover"
                  iconLabel="How the Publisher Ops bridge works"
                  title="Bridge to Publisher Ops"
                  side="bottom"
                  content={
                    <>
                      <p>
                        This generates a draft release spec from the selected catalog track and loads both spec and media paths into Publisher Ops.
                      </p>
                      <p>
                        The deterministic plan/execute state machine stays unchanged and still requires spec input and manual QC approval.
                      </p>
                    </>
                  }
                />
                <HelpTooltip content="Generates a catalog-backed draft spec, then opens Publisher Ops with both spec and media paths prefilled.">
                  <button
                    type="button"
                    className="primary-action"
                    onClick={() => props.onOpenPublisherOps(props.selectedTrackDetail!)}
                    disabled={props.publisherBridgeLoadingTrackId === props.selectedTrackDetail!.track_id}
                  >
                    {props.publisherBridgeLoadingTrackId === props.selectedTrackDetail!.track_id
                      ? "Preparing Draft..."
                      : "Prepare for Release..."}
                  </button>
                </HelpTooltip>
              </div>
            </div>

            <div className="track-meta-grid">
              <div>
                <span className="track-meta-label">File</span>
                <code className="track-meta-value">
                  {props.formatDisplayPath(props.selectedTrackDetail.file_path, { showFullPaths: props.showFullPaths })}
                </code>
              </div>

              <div>
                <span className="track-meta-label">Visibility</span>
                {props.trackDetailEditMode ? (
                  <HelpTooltip content="Controls how this track should be treated in local catalog workflows and future export/share features.">
                    <select
                      aria-label="Visibility"
                      value={props.trackEditor.visibilityPolicy}
                      onChange={(event) => props.onPatchTrackEditor({ visibilityPolicy: event.target.value })}
                      disabled={props.trackEditorSaving}
                      className="track-meta-inline-select"
                    >
                      {props.trackVisibilityOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </HelpTooltip>
                ) : (
                  <span className="track-meta-value">{props.selectedTrackDetail.visibility_policy}</span>
                )}
              </div>

              <div>
                <span className="track-meta-label">License</span>
                {props.trackDetailEditMode ? (
                  <HelpTooltip content="Sets the local rights/license policy used for future publish adapters and export mappings.">
                    <select
                      aria-label="License"
                      value={props.trackEditor.licensePolicy}
                      onChange={(event) => props.onPatchTrackEditor({ licensePolicy: event.target.value })}
                      disabled={props.trackEditorSaving}
                      className="track-meta-inline-select"
                    >
                      {props.trackLicenseOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </HelpTooltip>
                ) : (
                  <span className="track-meta-value">{props.selectedTrackDetail.license_policy}</span>
                )}
              </div>

              <div>
                <span className="track-meta-label">Downloadable</span>
                {props.trackDetailEditMode ? (
                  <label className="track-editor-checkbox inline">
                    <input
                      type="checkbox"
                      checked={props.trackEditor.downloadable}
                      onChange={(event) => props.onPatchTrackEditor({ downloadable: event.target.checked })}
                      disabled={props.trackEditorSaving}
                    />
                    <span>Downloadable in future publish/export workflows</span>
                  </label>
                ) : (
                  <span className="track-meta-value">{props.selectedTrackDetail.downloadable ? "Yes" : "No"}</span>
                )}
              </div>
              <div className="track-meta-grid-span-2 track-meta-tags-panel">
                <div className="track-meta-tags-head">
                  <div>
                    <span className="track-meta-label">Tags</span>
                    <div className="track-meta-value subtle">
                      {props.trackDetailEditMode
                        ? "Edit tags directly in Track Detail (local catalog only)"
                        : "Read-only tags. Click Edit Metadata to modify and save."}
                    </div>
                  </div>
                  <HelpTooltip
                    variant="popover"
                    iconLabel="How track metadata editing works"
                    title="Track Metadata"
                    side="bottom"
                    content={
                      <>
                        <p>These fields update the local catalog only (SQLite) and do not run Publisher Ops by themselves.</p>
                        <p>Use tags, rights, and visibility to prepare a track before bridging it into the deterministic publish pipeline.</p>
                      </>
                    }
                  />
                </div>

                {props.trackDetailEditMode ? (
                  <label className="track-editor-field">
                    <span className="sr-only">Tags</span>
                    <HelpTooltip content="Comma or newline separated tags. Duplicate tags are collapsed locally and revalidated by Rust IPC before saving.">
                      <textarea
                        aria-label="Tags"
                        className="track-editor-tags"
                        rows={3}
                        value={props.trackEditor.tagsInput}
                        onChange={(event) => props.onPatchTrackEditor({ tagsInput: event.target.value })}
                        placeholder="ambient, downtempo, late night"
                        disabled={props.trackEditorSaving}
                      />
                    </HelpTooltip>
                    <small className="track-editor-help-text">
                      {props.trackEditorTagsPreviewCount} tag(s) prepared for save
                      {props.trackEditorDirty ? " | unsaved changes" : ""}
                    </small>
                  </label>
                ) : (
                  <div className="track-chip-row" aria-label="Track tags">
                    {props.selectedTrackDetail.tags.length > 0 ? (
                      props.selectedTrackDetail.tags.map((tag) => (
                        <span key={tag} className="track-chip">
                          #{tag}
                        </span>
                      ))
                    ) : (
                      <span className="track-chip empty">No tags yet</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {props.trackEditorError ? (
              <div className="track-editor-error" role="alert">
                <strong>{props.trackEditorError.code}</strong>: {props.trackEditorError.message}
              </div>
            ) : null}
            {props.trackEditorNotice ? (
              <div className="track-editor-notice" role="status" aria-live="polite">
                {props.trackEditorNotice}
              </div>
            ) : null}
          </div>

          <QcPlayer
            analysis={props.selectedTrackAnalysis}
            currentTimeSec={props.qcCurrentTimeSec}
            isPlaying={props.qcIsPlaying}
            onTogglePlay={props.onQcTogglePlay}
            onSeek={props.onQcSeek}
            onTimeUpdate={props.onQcTimeUpdate}
            onPlay={props.onQcPlay}
            onPause={props.onQcPause}
            audioRef={props.playerAudioRef}
            renderAudioElement={false}
            audioSrc={props.playerAudioSrc}
            showPlayToggle={false}
          />

          <div className="qc-actions-card qc-codec-preview-card" aria-label="Codec preview controls">
            <div className="qc-header-row">
              <div>
                <p className="eyebrow">Codec Preview</p>
                <h4 className="qc-approval-title">A/B and Blind-X Session</h4>
                <p className="helper-text">
                  Configure comparison profiles and switch preview variants while keeping shared transport playback.
                </p>
              </div>
            </div>
            {!props.qcCodecPreviewEnabled ? (
              <p className="helper-text">
                Codec preview is disabled in this build. Enable backend flag <code>RELEASE_PUBLISHER_QC_CODEC_PREVIEW_V1</code> to use this panel.
              </p>
            ) : (
              <>
                <div className="qc-codec-grid">
                  <label className="track-editor-field">
                    <span>Profile A</span>
                    <select
                      aria-label="Codec profile A"
                      value={props.qcPreviewProfileAId}
                      onChange={(event) => props.onQcPreviewProfileAChange(event.target.value)}
                      disabled={props.qcCodecPreviewLoading || props.qcCodecProfiles.length === 0}
                    >
                      {props.qcCodecProfiles.map((profile) => (
                        <option key={profile.profile_id} value={profile.profile_id} disabled={!profile.available}>
                          {profile.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="track-editor-field">
                    <span>Profile B</span>
                    <select
                      aria-label="Codec profile B"
                      value={props.qcPreviewProfileBId}
                      onChange={(event) => props.onQcPreviewProfileBChange(event.target.value)}
                      disabled={props.qcCodecPreviewLoading || props.qcCodecProfiles.length === 0}
                    >
                      {props.qcCodecProfiles.map((profile) => (
                        <option key={profile.profile_id} value={profile.profile_id} disabled={!profile.available}>
                          {profile.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="track-editor-checkbox inline qc-preview-blindx-toggle">
                  <input
                    type="checkbox"
                    checked={props.qcPreviewBlindXEnabled}
                    onChange={(event) => props.onQcPreviewBlindXEnabledChange(event.target.checked)}
                    disabled={props.qcCodecPreviewLoading}
                  />
                  <span>Enable Blind-X mode (identity hidden until reveal)</span>
                </label>
                <div className="qc-controls qc-variant-row">
                  <button
                    type="button"
                    className={`media-button ghost${props.qcPreviewSession?.active_variant === "bypass" ? " active" : ""}`}
                    onClick={() => props.onQcPreviewSetVariant("bypass")}
                    disabled={props.qcCodecPreviewLoading || !props.qcPreviewSession}
                  >
                    Bypass
                  </button>
                  <button
                    type="button"
                    className={`media-button ghost${props.qcPreviewSession?.active_variant === "codec_a" ? " active" : ""}`}
                    onClick={() => props.onQcPreviewSetVariant("codec_a")}
                    disabled={props.qcCodecPreviewLoading || !props.qcPreviewSession}
                  >
                    Codec A
                  </button>
                  <button
                    type="button"
                    className={`media-button ghost${props.qcPreviewSession?.active_variant === "codec_b" ? " active" : ""}`}
                    onClick={() => props.onQcPreviewSetVariant("codec_b")}
                    disabled={props.qcCodecPreviewLoading || !props.qcPreviewSession}
                  >
                    Codec B
                  </button>
                  <button
                    type="button"
                    className={`media-button ghost${props.qcPreviewSession?.active_variant === "blind_x" ? " active" : ""}`}
                    onClick={() => props.onQcPreviewSetVariant("blind_x")}
                    disabled={
                      props.qcCodecPreviewLoading ||
                      !props.qcPreviewSession ||
                      !props.qcPreviewSession.blind_x_enabled
                    }
                  >
                    Blind-X
                  </button>
                  <button
                    type="button"
                    className="media-button ghost"
                    onClick={props.onQcPreviewRevealBlindX}
                    disabled={
                      props.qcCodecPreviewLoading ||
                      !props.qcPreviewSession?.blind_x_enabled ||
                      Boolean(props.qcPreviewSession?.blind_x_revealed)
                    }
                  >
                    Reveal
                  </button>
                </div>
                <div className="qc-preview-status" role="status" aria-live="polite">
                  {props.qcCodecPreviewLoading ? (
                    <span>Preparing codec preview session...</span>
                  ) : props.qcPreviewSession ? (
                    <>
                      <span>Active variant: {props.qcPreviewSession.active_variant}</span>
                      <span>Profile A: {props.qcPreviewSession.profile_a_id}</span>
                      <span>Profile B: {props.qcPreviewSession.profile_b_id}</span>
                      <span>
                        Blind-X:{" "}
                        {props.qcPreviewSession.blind_x_enabled
                          ? props.qcPreviewSession.blind_x_revealed
                            ? "revealed"
                            : "hidden"
                          : "off"}
                      </span>
                    </>
                  ) : (
                    <span>Select distinct profiles to initialize codec preview.</span>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="qc-actions-card qc-batch-export-card" aria-label="Batch export controls">
            <div className="qc-header-row">
              <div>
                <p className="eyebrow">Batch Export</p>
                <h4 className="qc-approval-title">Multi-Profile Export Queue</h4>
                <p className="helper-text">
                  Export the selected source track through multiple codec profiles in a single job request.
                </p>
              </div>
            </div>
            {!props.qcBatchExportEnabled ? (
              <p className="helper-text">
                Batch export is disabled in this build. Enable backend flag <code>RELEASE_PUBLISHER_QC_BATCH_EXPORT_V1</code> to use this panel.
              </p>
            ) : (
              <>
                <fieldset className="qc-batch-profile-list">
                  <legend>Profiles</legend>
                  {props.qcCodecProfiles.length > 0 ? (
                    props.qcCodecProfiles.map((profile) => (
                      <label key={profile.profile_id} className="track-editor-checkbox inline">
                        <input
                          type="checkbox"
                          checked={props.qcBatchExportSelectedProfileIds.includes(profile.profile_id)}
                          onChange={() => props.onQcBatchExportToggleProfile(profile.profile_id)}
                          disabled={props.qcBatchExportSubmitting || !profile.available}
                        />
                        <span>
                          {profile.label}
                          {!profile.available ? " (unavailable)" : ""}
                        </span>
                      </label>
                    ))
                  ) : (
                    <p className="helper-text">No codec profiles available for batch export.</p>
                  )}
                </fieldset>

                <div className="qc-codec-grid">
                  <label className="track-editor-field">
                    <span>Output Directory</span>
                    <input
                      aria-label="Batch export output directory"
                      value={props.qcBatchExportOutputDir}
                      onChange={(event) => props.onQcBatchExportOutputDirChange(event.target.value)}
                      placeholder="C:/Exports"
                      disabled={props.qcBatchExportSubmitting}
                    />
                  </label>
                  <label className="track-editor-field">
                    <span>Target Integrated LUFS (optional)</span>
                    <input
                      aria-label="Batch export target LUFS"
                      value={props.qcBatchExportTargetLufs}
                      onChange={(event) => props.onQcBatchExportTargetLufsChange(event.target.value)}
                      placeholder="-14.0"
                      disabled={props.qcBatchExportSubmitting}
                    />
                  </label>
                </div>

                <div className="qc-controls">
                  <button
                    type="button"
                    className="primary-action"
                    onClick={props.onQcStartBatchExport}
                    disabled={props.qcBatchExportSubmitting}
                  >
                    {props.qcBatchExportSubmitting ? "Starting Batch Export..." : "Start Batch Export"}
                  </button>
                </div>

                {props.qcBatchExportStatusMessage ? (
                  <div className="qc-preview-status" role="status" aria-live="polite">
                    <span>{props.qcBatchExportStatusMessage}</span>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

