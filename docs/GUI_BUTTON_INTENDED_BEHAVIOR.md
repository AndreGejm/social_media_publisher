# GUI Button Intended Behavior Reference (Desktop App)

Purpose: This document describes what each visible button in the current desktop GUI is intended to do, including key preconditions/disabled states. Use this as the baseline when reporting bugs.

Scope:
- `Music Core` shell (`Library`, `Albums`, `Tracks`, `Playlists`, `Publisher Ops`, `Settings`)
- Embedded `Publisher Ops` workflow UI
- Shared/QC player controls
- Contextual help `?` buttons

Version context:
- Desktop app `0.2.0`
- Offline-first mode
- Publisher transport is still `MockTransport` (simulation/test publishing pipeline)

## How To Use This For Bug Reports

When reporting a bug, include:
- Workspace / screen (`Music Core > Tracks`, `Publisher Ops > Verify / QC`, etc.)
- Button label (exact text shown)
- Preconditions (what was selected / loaded / approved)
- Expected behavior (from this document)
- Actual behavior
- Any error banner text/code shown in the UI
- Whether the issue happens after app restart or only in the current session

## Help `?` Buttons (Global Behavior)

All contextual help icon buttons are rendered by `HelpTooltip`.

Intended behavior:
- Hover or keyboard focus shows help text.
- `?` icon buttons toggle richer popovers (where used).
- `Escape` closes the tooltip/popover.
- Clicking outside a pinned popover closes it.
- Help buttons do not mutate business data or trigger pipeline/catalog operations.

## Music Core Shell (Sidebar Workspace Buttons)

These are the left-sidebar workspace navigation buttons.

Buttons:
- `Library`
- `Albums`
- `Tracks`
- `Playlists`
- `Publisher Ops`
- `Settings`

Intended behavior:
- Changes the visible workspace panel in the main content area.
- Persists selected workspace in local storage (`rp.music.activeWorkspace.v1`).
- Does not call Rust IPC by itself (except effects in the destination workspace may load data if needed).

## Music Core Sidebar: Library Roots Panel

### `Add Root`
Intended behavior:
- Adds the folder path from the `Library root path` text input as a persisted library root in SQLite.
- On success:
  - Clears the input field
  - Adds/updates the root in the list immediately

Disabled when:
- A library root mutation is already in progress (`libraryRootMutating`)

Backend side effect:
- Calls Tauri IPC `catalog_add_library_root(path)`

### `Refresh Roots`
Intended behavior:
- Reloads the library roots list from SQLite.

Disabled when:
- Root list is already loading (`libraryRootsLoading`)

Backend side effect:
- Calls Tauri IPC `catalog_list_library_roots()`

### Per-root `Scan`
Intended behavior:
- Starts a background ingest scan job for that root (recursive local file scan).
- Adds a pending job to the UI and polling begins.
- Completed jobs refresh the track list automatically.

Disabled when:
- A root mutation/scan action is already in progress (`libraryRootMutating`)

Backend side effect:
- Calls Tauri IPC `catalog_scan_root(root_id)` (job creation)
- UI then polls `catalog_get_ingest_job(job_id)`

### Per-root `Remove`
Intended behavior:
- Removes the saved library root configuration only.
- Does not delete local files.
- Does not delete imported tracks already in the catalog.

Disabled when:
- A root mutation action is already in progress (`libraryRootMutating`)

Backend side effect:
- Calls Tauri IPC `catalog_remove_library_root(root_id)`

### Library Roots panel `?` help button
Intended behavior:
- Explains how root scanning works (background ingest jobs + SQLite-backed progress).
- No data mutation.

## Music Core Sidebar: Import Audio Panel

### `Import to Library`
Intended behavior:
- Parses file paths from the textarea (newline/comma separated).
- Imports supported local audio files into the catalog.
- Rust performs audio decode + LUFS + waveform peak analysis + BLAKE3 fingerprinting.
- Updates imported track list and selects the first imported track (if any).
- Shows per-file failures without failing the whole batch.

Disabled when:
- Import operation is currently running (`catalogImporting`)

Backend side effect:
- Calls Tauri IPC `catalog_import_files(paths[])`

### Catalog Import panel `?` help button
Intended behavior:
- Explains Rust-native analysis + SQLite catalog persistence.
- No data mutation.

## Music Core: Library Workspace

### `Open Tracks Workspace`
Intended behavior:
- Switches active workspace to `Tracks`.
- No backend call by itself.

### `Open Albums Workspace`
Intended behavior:
- Switches active workspace to `Albums`.
- No backend call by itself.

### `Open Publisher Ops`
Intended behavior:
- Switches active workspace to embedded `Publisher Ops`.
- No backend call by itself.

## Music Core: Tracks Workspace

## Tracks Toolbar

### `Refresh`
Intended behavior:
- Reloads the local track list from SQLite using the current search text.
- Keeps current local sort/favorites filter logic in the UI.

Disabled when:
- Track list is loading (`catalogLoading`)

Backend side effect:
- Calls Tauri IPC `catalog_list_tracks({ search, limit, offset })`

### `All Tracks` / `Favorites Only` (toggle chip button)
Intended behavior:
- Toggles local favorites filtering in the visible track list.
- Text changes:
  - `All Tracks` means clicking enables favorites-only view
  - `Favorites Only` means clicking returns to all visible tracks
- Persists toggle state in local storage (`rp.music.onlyFavorites.v1`)

Backend side effect:
- None (local UI/session state only)

### `Albums View`
Intended behavior:
- Switches to `Albums` workspace using the currently visible track data context.
- No backend call by itself.

## Track List (Dynamic Buttons)

### Per-track row button (label is the track title)
Intended behavior:
- Selects the track and loads the track detail panel.
- If detail is fetched successfully, detail pane/QC player updates.

Backend side effect:
- Calls Tauri IPC `catalog_get_track(track_id)` after selection effect runs

Notes:
- A leading `*` marker indicates local favorite status in the list row.

## Track Detail Actions

### `Play Now`
Intended behavior:
- Sets this track as the active player track.
- Resets playback time to start.
- Moves the track to the front of the local session queue (or materializes a session queue from current visible order and promotes it).
- Keeps/opens the current workspace context (does not force Publisher Ops).

Backend side effect:
- None (local player/session state only)

### `Add to Queue`
Intended behavior:
- Appends the selected track to the end of the local session queue.
- Does not start playback.

Backend side effect:
- None (local player/session state only)

### `Play Next`
Intended behavior:
- Inserts the selected track immediately after the currently playing queue item.
- If nothing is actively in queue focus, inserts near the start (per current queue index logic).
- Does not immediately switch playback.

Backend side effect:
- None (local player/session state only)

### `Favorite` / `Unfavorite`
Intended behavior:
- Toggles local favorite status for the selected track.
- Updates local favorites set used by:
  - Tracks list star markers
  - Favorites-only filter
  - Albums workspace favorites counts/labels
- Persists favorites in local storage (`rp.music.favorites.v1`)

Backend side effect:
- None (local UI/session preference only)

### `Open in Publisher Ops`
Intended behavior:
- Generates a catalog-backed draft release spec from the selected track.
- Writes the generated spec YAML to the local artifacts folder.
- Switches to `Publisher Ops` workspace.
- Prefills `Publisher Ops` with:
  - media file path
  - generated spec path

Disabled when:
- Draft generation is already in progress for that selected track (`publisherBridgeLoadingTrackId === selectedTrackDetail.track_id`)

Backend side effect:
- Calls Tauri IPC `publisher_create_draft_from_track(track_id)`

### Track detail “Bridge to Publisher Ops” `?` button
Intended behavior:
- Explains draft generation + Publisher Ops bridge behavior.
- No data mutation.

## Track Metadata Editor (Authoring)

### `Save Metadata`
Intended behavior:
- Saves local catalog metadata for the selected track:
  - `visibility_policy`
  - `license_policy`
  - `downloadable`
  - normalized/deduplicated `tags`
- Updates track detail panel immediately.
- Updates `updated_at` in the track list row for the same track.
- Shows success notice `Track metadata saved.`

Disabled when:
- Editor is saving (`trackEditorSaving`)
- Editor is not bound to the currently selected track
- No unsaved changes (`!trackEditorDirty`)

Backend side effect:
- Calls Tauri IPC `catalog_update_track_metadata(...)`

### `Reset`
Intended behavior:
- Resets the metadata editor fields back to the currently saved values for the selected track.
- Clears editor error and notice.

Disabled when:
- Editor is saving (`trackEditorSaving`)
- No selected track
- No unsaved changes (`!trackEditorDirty`)

Backend side effect:
- None (local editor state reset only)

### Track Metadata editor `?` button
Intended behavior:
- Explains local-only authoring fields and later publish adapter usage.
- No data mutation.

## Tracks Workspace: Embedded QC Player (Track Detail)

This is `QcPlayer` reused inside Music Core track detail.

### `Play` / `Pause`
Intended behavior:
- Controls playback of the selected track in the QC-style player area.
- If a different track was selected than the current player track, the selected track becomes the current player track first.

Backend side effect:
- None (frontend `HTMLAudioElement` playback)

### `-5%`
Intended behavior:
- Seeks playback backward by 5% of the selected track’s duration.

### `+5%`
Intended behavior:
- Seeks playback forward by 5% of the selected track’s duration.

### QC Metrics `?` button
Intended behavior:
- Explains LUFS / waveform peak / peak bin meanings.
- No data mutation.

Related non-button controls (important for bug reports):
- Waveform click/keyboard left-right: seek within track
- Seek slider (`Playback position`): fine seek

## Tracks Workspace: Queue Panel

### `Shuffle`
Intended behavior:
- Randomizes the current local queue order.
- If no manual session queue exists, it materializes from the current visible queue basis first.

Disabled when:
- Fewer than 2 items are available in the queue

Backend side effect:
- None (local session queue only)

### `Reset Queue`
Intended behavior:
- Clears manual session queue ordering.
- Queue falls back to following the current visible track list order.

Disabled when:
- No manual session queue is active (`!queueUsesSessionOrder`)

Backend side effect:
- None

### Per-queue row main button (dynamic; row title/artist)
Intended behavior:
- Selects and starts queue focus for that track in the shared player context (sets player track / selected track via queue index).
- Does not remove/reorder queue items.

Backend side effect:
- None

### Per-queue row `Remove` (shown only when manual session queue is active)
Intended behavior:
- Removes that item from the local session queue.
- If queue reverts to empty, visible list fallback queue behavior resumes.

Backend side effect:
- None

## Music Core: Albums Workspace

Album groups are derived from catalog track metadata and are not separate authored album entities yet.

## Album Group List (Dynamic Buttons)

### Per-album row button (dynamic title)
Intended behavior:
- Selects the album group for the right-side album detail panel.

Backend side effect:
- None (uses already loaded track list data)

## Album Detail Actions

### `Play Album`
Intended behavior:
- Loads the selected album group track IDs into the local session queue.
- Starts playback from the first track.
- Opens the `Tracks` workspace.

Disabled when:
- Selected album group has zero tracks

Backend side effect:
- None (local player/session state)

### `Add Album to Queue`
Intended behavior:
- Appends all tracks in the selected album group to the local session queue.
- Does not immediately start playback.

Disabled when:
- Selected album group has zero tracks

Backend side effect:
- None

### `Open in Tracks`
Intended behavior:
- Switches to `Tracks` workspace and selects the first track in the selected album group.

Disabled when:
- Selected album group has zero tracks

Backend side effect:
- None

## Album Track Rows (Dynamic Buttons)

### Album track row main button (dynamic track title)
Intended behavior:
- Opens `Tracks` workspace and selects that track in the track detail panel.
- Does not start playback automatically.

Backend side effect:
- Triggers track detail load effect (`catalog_get_track(track_id)`) after selection

### Album track `Play`
Intended behavior:
- Plays that track now and promotes it to the front of the local session queue.
- Opens `Tracks` workspace.

Backend side effect:
- None

### Album track `Fav` / `Unfav`
Intended behavior:
- Toggles local favorite status for that track.

Backend side effect:
- None

## Music Core: Persistent Shared Player Bar (Bottom)

### `Prev`
Intended behavior:
- Moves to the previous track in the current queue order.
- Selects/focuses that track.

Disabled when:
- Current queue index is at the first item or invalid (`queueIndex <= 0`)

Backend side effect:
- None (frontend/local player state)

### `Play` / `Pause`
Intended behavior:
- Starts or pauses local playback of the currently selected/shared player track.

Backend side effect:
- None (`HTMLAudioElement`)

### `Next`
Intended behavior:
- Moves to the next track in the current queue order.
- Selects/focuses that track.

Disabled when:
- No valid next track exists (`queueIndex < 0 || queueIndex >= queue.length - 1`)

Backend side effect:
- None

Related non-button control:
- Shared player seek slider (`Shared player seek`) changes current playback position.

## Publisher Ops Workspace (Embedded Release Publisher UI)

This is the existing deterministic pipeline UI embedded inside the `Publisher Ops` workspace.

## Workflow Screen Tabs

Buttons:
- `New Release`
- `Plan / Preview`
- `Verify / QC`
- `Execute`
- `Report / History`

Intended behavior:
- Switches the active tab/screen within Publisher Ops.
- Does not run backend actions by itself.

## New Release Screen Actions

### `Load Spec`
Intended behavior:
- Loads and validates the YAML spec file from the `Spec File Path`.
- Updates normalized spec summary / validation feedback.

Disabled when:
- Spec is currently loading
- Planning is running
- Execute is running

Backend side effect:
- Calls Tauri IPC `load_spec`

### `Plan / Preview`
Intended behavior:
- Plans the release (no publish execution).
- Parses/normalizes spec and computes deterministic BLAKE3 release identity.
- Persists planned release + action rows and planned artifacts in SQLite/WAL.
- Prepares QC step.

Disabled when:
- Planning is running
- Execute is running

Backend side effect:
- Calls Tauri IPC `plan_release`

### `Execute`
Intended behavior:
- Runs the persisted deterministic pipeline for the currently planned release.
- In `TEST`, uses mock/simulated execution only.
- Refreshes history/report state after execute.

Disabled when:
- Execute is running
- No planned release exists
- QC approval gate is not valid for the current planned release

Important gate conditions (must all be true):
- A planned `release_id` exists
- QC analysis exists and matches the current planned `release_id`
- QC analysis passes client-side validity checks
- Manual approval has been recorded for the current plan
- QC analysis is not currently running

Backend side effect:
- Calls Tauri IPC `execute_release`

### `Plan / Preview` `?` button
Intended behavior:
- Explains deterministic planning, BLAKE3 identity generation, and SQLite/WAL persistence.
- No data mutation.

### `Execute` `?` button
Intended behavior:
- Explains execute/verify state-machine behavior, run locks, and TEST/MockTransport behavior.
- No data mutation.

## Verify / QC Screen Actions (Publisher Ops)

### `Analyze & Persist QC`
Intended behavior:
- Runs Rust audio analysis for the current planned release media.
- Computes waveform peaks + LUFS and stores them in SQLite tied to the planned release.
- Displays QC player and metrics.
- Re-locks approval gate during reanalysis and on failure.

Disabled when:
- QC analysis is running
- Planning is running
- Execute is running
- No planned release exists

Backend side effect:
- Calls Tauri IPC QC analysis commands (analyze + persist/get flows)

### `Load Saved QC`
Intended behavior:
- Loads previously saved QC metrics for the selected history release.
- Useful for re-inspection without rerunning analysis.

Disabled when:
- QC lookup is running
- No history release is selected

Backend side effect:
- Calls Tauri IPC `get_release_track_analysis` (through UI wrapper)

### `Approve for Release` / `Approved for Release`
Intended behavior:
- Records a local manual approval gate for the currently planned release after listening + waveform inspection.
- Enables `Execute` only for that matching `release_id`.
- Does not publish by itself.

Disabled when:
- No planned release exists
- QC analysis belongs to a different release than the current plan
- QC analysis is invalid/incomplete
- QC analysis is currently running

Backend side effect:
- None (UI-local approval gate state)

### `Clear Approval`
Intended behavior:
- Removes the local QC approval gate for the current plan.
- Re-locks `Execute`.

Disabled when:
- Current plan is not approved (`!qcApprovedForCurrentPlan`)

Backend side effect:
- None

### `Verify / QC` `?` button
Intended behavior:
- Explains Rust symphonia/EBU R128 analysis and persisted QC metrics.
- No data mutation.

### `Approve for Release` `?` button
Intended behavior:
- Explains that approval is local gating only (not publishing).
- No data mutation.

## Embedded QC Player in Publisher Ops (same component behavior)

Buttons:
- `Play` / `Pause`
- `-5%`
- `+5%`

Intended behavior:
- Same as the `QcPlayer` behavior described in the Music Core Tracks workspace section.

## Report / History Screen Actions (Publisher Ops)

### `Refresh History`
Intended behavior:
- Reloads release history rows from local SQLite.

Disabled when:
- History refresh is in progress (`refreshingHistory`)

Backend side effect:
- Calls Tauri IPC `list_history`

### `Open Report`
Intended behavior:
- Loads the saved report artifact for the currently selected history release.
- Switches/updates report summary and report actions list.

Disabled when:
- Report load is in progress (`loadingReport`)
- No history release is selected

Backend side effect:
- Calls Tauri IPC `get_report`

### `Resume`
Intended behavior:
- Resumes execution for the selected history release by reusing persisted plan/report state.
- Internally routes to the same execute path used by `Execute`.

Disabled when:
- Execute is currently running
- No history release is selected

Backend side effect:
- Calls the same execute path / Tauri IPC `execute_release` for the selected release ID

## Publisher Ops Help `?` Buttons (Non-mutating)

These buttons only show help text/popovers and do not change app data:
- `Spec File Path` label help icon
- `Media File Path` label help icon
- `Environment` help icon
- `Platforms` legend help icon
- `Plan / Preview` help popover icon
- `Execute` help popover icon
- `Verify / QC` help popover icon
- `Approve for Release` help popover icon

## Other Important Clickable Controls (Not Buttons)

These are common bug-report sources even though they are not rendered as `<button>`:

- `Spec File Path` text input
- `Media File Path` text input
- `Environment` select
- `Mock connector` checkbox
- History row radio selection (selects release for `Open Report` / `Load Saved QC` / `Resume`)
- `QcPlayer` waveform click area (seek)
- `QcPlayer` seek slider
- Shared player seek slider
- Music Core:
  - library root path input
  - import paths textarea
  - track search input
  - track sort select
  - metadata editor selects/textarea/checkbox

## Bug Report Template (Copy/Paste)

```md
### Bug
- Workspace / Screen:
- Button label:
- Preconditions:
- Expected behavior:
- Actual behavior:
- Error message/banner (if any):
- Repro steps:
1.
2.
3.

- Happens after restart? (Yes/No):
- Sample file path / release_id (if relevant):
```

