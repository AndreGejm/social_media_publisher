# GUI Button Intended Behavior Reference (Desktop App)

Purpose: This document defines how each major GUI button is intended to behave in the current build. Use it as the source of truth when reporting bugs.

Version context:
- Desktop app: 0.2.0
- Offline-first mode
- Publisher execution transport: MockTransport (test simulation)

## How To Use This For Bug Reports

Include:
- Mode and workspace/screen (`Listen > Tracks`, `Publish > Publisher Ops > Verify / QC`, etc.)
- Exact button label
- Preconditions (selected track, loaded draft, approved QC, and so on)
- Expected behavior (from this document)
- Actual behavior
- Any visible error code/message
- Whether it reproduces after restart

## Global Help `?` Buttons

All help icons are rendered by `HelpTooltip`.

Intended behavior:
- Hover or keyboard focus shows tooltip text.
- Popover-style help opens from `?` icon buttons where used.
- `Escape` closes open tooltip/popover.
- Clicking outside closes pinned popovers.
- Help buttons do not mutate app data.

## Global App Shell

### Top mode tabs (`Listen`, `Publish`)

Intended behavior:
- Switches the app between listening/library workflows and publish workflows.
- Persists mode in local storage key `rp.music.activeMode.v1`.
- Mode switch does not run Rust IPC by itself.

### Global bottom transport (`Shared transport`)

Buttons:
- `Prev`
- `Play` / `Pause`
- `Next`

Intended behavior:
- This is the single global transport for playback.
- Operates on the current queue context.
- Stays visible across all workspaces and scrolling.

Disabled states:
- `Prev`: disabled when queue index is at start.
- `Next`: disabled when no next queue item exists.
- `Play`: disabled if there is no active player source and queue is empty.

Related control:
- `Shared player seek` slider seeks current track position.

### Global right dock (`Queue and session state`)

The dock switches content by app mode:
- `Listen` mode: `Queue`
- `Publish` mode: `Release Selection`

No backend mutation for dock-only queue operations (local state).

## Listen Mode Navigation

Visible left-sidebar workspace buttons:
- `Library`
- `Albums`
- `Tracks`
- `Playlists`
- `Settings`

Intended behavior:
- Switches visible center workspace.
- Persists workspace in `rp.music.activeWorkspace.v1`.

## Publish Mode Navigation

Visible left-sidebar workspace button:
- `Publisher Ops`

Additional shell-level publish step bar (top of content):
- `New Release`
- `Plan / Preview`
- `Verify / QC`
- `Execute`
- `Report / History`

Intended behavior:
- Step buttons control/sync the embedded Publisher Ops screen.
- Persists shell step in `rp.publish.shellStep.v1`.

## Listen > Library

### Collapsible section toggles

Buttons (dynamic labels):
- `Show Library Ingest` / `Hide Library Ingest`
- `Show Library overview` / `Hide Library overview`
- `Show Quick actions` / `Hide Quick actions`

Intended behavior:
- Expands/collapses the corresponding card.
- Persists collapsed state in local storage.

### Quick Actions

Buttons:
- `Open Tracks Workspace`
- `Open Albums Workspace`
- `Open Publish Workflow`

Intended behavior:
- First two switch Listen workspaces.
- `Open Publish Workflow` switches app mode to `Publish`.
- No Rust IPC call by button click itself.

### Library Ingest tabs

Tabs:
- `Scan Folders`
- `Import Files`

Intended behavior:
- Switches ingest sub-panel in the Library card.
- Persists tab in `rp.music.libraryIngestTab.v1`.

#### `Scan Folders` panel

Buttons:
- `Browse...`
- `Add Folder`
- `Refresh Folders`
- Per-root: `Scan Folder`, `Remove Folder`

Intended behavior:
- `Browse...`: opens native folder picker and fills `Library root path` input.
- `Add Folder`: persists folder as a library root.
- `Refresh Folders`: reloads roots from SQLite.
- `Scan Folder`: starts background ingest job for that root.
- `Remove Folder`: removes saved root config only (does not delete files).

Backend calls:
- `catalog_add_library_root`
- `catalog_list_library_roots`
- `catalog_scan_root`
- `catalog_get_ingest_job` (polling)
- `catalog_remove_library_root`

#### `Import Files` panel

Button:
- `Import Files`

Intended behavior:
- Parses newline/comma-separated paths from `Import file paths` textarea.
- Imports those files into catalog analysis flow.
- Updates list + status messages with partial-failure tolerance.

Backend call:
- `catalog_import_files`

## Listen > Tracks

### Tracks header actions

Buttons:
- `Refresh List`
- `All Tracks` / `Favorites Only`
- `Albums View`

Intended behavior:
- `Refresh List`: reloads tracks from SQLite with current search.
- `All Tracks`/`Favorites Only`: toggles local favorites filter (`rp.music.onlyFavorites.v1`).
- `Albums View`: switches workspace to `Albums`.

Related non-button controls:
- `Search tracks` input
- `Track sort` select

### Batch actions for selected tracks

Visible when at least one track checkbox is selected.

Buttons:
- `Play Selection`
- `Add Selection to Queue`
- `Play Selection Next`
- `Clear Selection`

Intended behavior:
- Uses selected tracks in visible-list order.
- `Play Selection`: replaces session queue with selection and starts playback from first selected.
- `Add Selection to Queue`: appends selected tracks.
- `Play Selection Next`: inserts selected tracks after current queue item.
- `Clear Selection`: clears track multi-select.

### Track rows

Controls:
- Row checkbox (`Select <track> for batch actions`)
- Row main button (track title)
- Row menu button (`Track actions for <track>`) and right-click context menu

Row main button behavior:
- Selects track and loads detail panel.

Row context menu actions:
- `Play Now`
- `Add to Queue`
- `Play Next`
- `Add Favorite` / `Remove Favorite`
- `Show in Tracks`
- `Add to Selection` / `Already in Selection`

### Track Detail header actions

Buttons:
- `Play Now`
- `Add to Queue`
- `Play Next`
- `Favorite` / `Unfavorite`
- `Edit Metadata` (view mode)
- `Save Metadata` (edit mode)
- `Reset Fields` (edit mode)
- `Cancel Edit` (edit mode)
- `Prepare for Release...`

Intended behavior:
- Playback/queue buttons dispatch to global shared transport queue state.
- Favorite toggles local favorite set (`rp.music.favorites.v1`).
- Edit buttons mutate local metadata editor state and persist via save.
- `Prepare for Release...` creates a draft release from selected track and switches to Publish mode with Publisher Ops prefilled.

Backend calls:
- `catalog_get_track` (selection/detail load effect)
- `catalog_update_track_metadata` (save)
- `publisher_create_draft_from_track` (bridge)

### Track Detail QC panel

Intended behavior:
- QC panel is inspection/seek/rate oriented in this shell integration.
- Local audio element is not mounted in this panel (`renderAudioElement=false`).
- Playback is controlled by global shared transport.

## Listen > Albums

### Album group list

Control:
- Album row button (dynamic title)

Intended behavior:
- Selects album group for detail panel.

### Album detail header actions

Buttons:
- `Play Album`
- `Add Album to Queue`
- `Show in Tracks`

Intended behavior:
- `Play Album`: seeds queue from album tracks and starts from first track.
- `Add Album to Queue`: appends album tracks to queue.
- `Show in Tracks`: jumps to Tracks workspace, selecting first album track.

### Batch actions for selected album tracks

Visible when one or more album-track checkboxes are selected.

Buttons:
- `Add Selection to Queue`
- `Play Selection Next`
- `Clear Selection`

Intended behavior:
- Works like track batch actions, but uses selected tracks inside the active album detail list.

### Album track rows

Controls:
- Row checkbox (`Select <track> for album batch actions`)
- Row main button
- Row menu button (`Open actions for <track>`) and right-click context menu

Row context menu actions:
- `Play Now`
- `Add to Queue`
- `Play Next`
- `Add Favorite` / `Remove Favorite`
- `Show in Tracks`
- `Add to Selection` / `Already in Selection`

## Listen > Settings

### Collapsible section toggles

Buttons (dynamic labels):
- `Show Preferences` / `Hide Preferences`
- `Show Display summary` / `Hide Display summary`

### Preference controls

Clickable controls:
- `Theme preference` select (`System`, `Light`, `Dark`)
- `Compact density` checkbox
- `Show full file paths in detail panels` checkbox

Intended behavior:
- Updates local UI preferences.
- Persists to local storage:
  - `rp.music.themePreference.v1`
  - `rp.music.compactDensity.v1`
  - `rp.music.showFullPaths.v1`

## Global right dock details

### Listen mode (`Queue`)

Buttons:
- `Shuffle`
- `Clear Queue`
- `Show in Tracks`
- Per-row `Remove` (only when manual session queue is active)
- Per-row main button (select/focus queue item)

Intended behavior:
- `Shuffle`: randomizes current queue order.
- `Clear Queue`: clears manual queue and falls back to visible-list ordering.
- `Show in Tracks`: jumps to Tracks workspace.

### Publish mode (`Release Selection`)

Buttons:
- `Clear Selection`
- `Show in Tracks`
- Per-row `Remove`
- Per-row main button (loads that draft prefill)

Intended behavior:
- This selection list is separate from Listen queue (`rp.publish.selectionQueue.v1`).
- `Show in Tracks` returns to Listen mode for adding more tracks.

## Publish > Publisher Ops (embedded)

The embedded Publisher Ops remains the deterministic plan/execute flow.

### Screen tabs inside Publisher Ops

Buttons:
- `New Release`
- `Plan / Preview`
- `Verify / QC`
- `Execute`
- `Report / History`

Intended behavior:
- Switches active internal Publisher Ops panel.
- Syncs with shell publish step bar.

### New Release actions

Buttons:
- `Load Spec`
- `Plan / Preview`
- `Execute`

Intended behavior:
- `Load Spec`: parse/validate YAML spec.
- `Plan / Preview`: deterministic planning only.
- `Execute`: run mocked pipeline, gated by valid QC + manual approval.

### Verify / QC actions

Buttons:
- `Analyze & Persist QC`
- `Load Saved QC`
- `Approve for Release` / `Approved for Release`
- `Clear Approval`

Intended behavior:
- Runs/loads QC analysis tied to current plan release ID.
- Approval unlocks execute only for matching planned release.
- Clearing approval relocks execute.

QC playback note in shell:
- When embedded in Music shell, Publisher Ops QC delegates playback to shared transport and hides local QC play toggle.

### Report / History actions

Buttons:
- `Refresh History`
- `Open Release Report`
- `Resume Release`

Intended behavior:
- `Refresh History`: reload history rows.
- `Open Release Report`: load report artifact for selected release.
- `Resume Release`: execute selected historical release.

## Other Clickable Controls (Not `<button>`)

Common bug-report sources:
- `Library root path` input
- `Import file paths` textarea
- Track search input
- Track sort select
- Metadata selects (`Visibility`, `License`) and tags textarea
- Publisher Ops `Spec File Path` input
- Publisher Ops `Media File Path` input
- Publisher Ops `Environment` select
- History release radio selection
- `Shared player seek` slider
- QC waveform click-to-seek and QC seek slider

## Bug Report Template

```md
### Bug
- Mode + Workspace / Screen:
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
