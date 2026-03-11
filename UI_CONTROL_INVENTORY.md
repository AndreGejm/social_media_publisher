# UI Control Inventory

Status: Pass 1 complete.

Scope: Current desktop shell in `apps/desktop/src/features/workspace/WorkspaceRuntime.tsx` and mounted feature surfaces.

Discovery sources:
- Visible React controls in the current workspace shell and feature components.
- Existing frontend/runtime tests that describe intended user flows.
- Legacy UX/spec notes in `archives/documentation-legacy/specs/`.

Assumptions logged for later verification:
- `Release Preview` is the user-facing label for internal `Listen` mode.
- Inline help icons/popovers are informational controls; they are not individually expanded below unless they materially affect workflow.
- Context-menu actions and per-row controls are contextual controls and repeat for each visible row.
- The same `PlayListPanel` control surface is reused in `Quality Control > Track QC` and `Playlists`.

## Shell Map

Top-level shells:
- Left sidebar: brand, workspace navigation, conditional Library ingest sidebar.
- Main content: topbar, notifications, current workspace panel.
- Bottom bar: shared transport in Release Preview workspaces.
- Right dock: release selection dock in Publish mode.

Workspace availability by mode:
- `Release Preview`: `Library`, `Quality Control`, `Playlists`, `Video Workspace`, `Settings`, `About`
- `Publish`: `Publisher Ops`, `Settings`, `About`

## Global Shell Controls

| Area | Navigation path | Control | Type | Appears actionable | Expected purpose | Mode-dependent | Scope |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Topbar | Any workspace | `Release Preview` | Tab | Yes | Enter listening/library workflow mode | Yes | Global |
| Topbar | Any workspace | `Publish` | Tab | Yes | Enter release workflow mode | Yes | Global |
| Sidebar | Any mode | Workspace buttons (`Library`, `Quality Control`, `Playlists`, `Video Workspace`, `Publisher Ops`, `Settings`, `About`) | Button | Yes | Switch active workspace | Yes | Global |
| Top notifications | Any workspace with banner | `Dismiss` on notice/error banners | Button | Yes | Clear current banner only | No | Global |
| Topbar summary | Non-Publisher, non-About workspace | `<n> track(s)` | Button | Yes | Open Track QC / track-oriented workspace context | Yes | Global |
| Topbar summary | Non-Publisher, non-About workspace | `<n> album group(s)` | Button | Yes | Open Album QC | Yes | Global |
| Topbar summary | Non-Publisher, non-About workspace | `<n> favorite(s)` | Button | Yes | Open track-oriented workspace for favorites follow-up | Yes | Global |
| Topbar summary | Non-Publisher, non-About workspace | `<n> queue item(s)` | Button | Yes | Open track-oriented workspace for queue follow-up | Yes | Global |
| Topbar summary | Non-Publisher, non-About workspace | `<n> import error(s)` | Button | Yes | Return to `Library` | Yes | Global |
| Shared player | Any Release Preview workspace except `About` | `Shared` | Button | Yes | Request shared output mode | Yes | Global |
| Shared player | Any Release Preview workspace except `About` | `Exclusive` | Button | Yes | Request exclusive output mode | Yes | Global |
| Shared player | Any Release Preview workspace except `About` | `Playlist` / `Queue` | Button | Yes | Toggle list view between visible library list and session queue | Yes | Global |
| Shared player | Any Release Preview workspace except `About` | `Prev` | Button | Yes | Jump to previous queue item | Yes | Global |
| Shared player | Any Release Preview workspace except `About` | `Play` / `Pause` | Button | Yes | Toggle transport playback | Yes | Global |
| Shared player | Any Release Preview workspace except `About` | `Stop` | Button | Yes | Stop playback and reset current track position | Yes | Global |
| Shared player | Any Release Preview workspace except `About` | `Next` | Button | Yes | Jump to next queue item | Yes | Global |
| Shared player | Any Release Preview workspace except `About` | `Playback volume` | Range input | Yes | Change output volume scalar | Yes | Global |
| Shared player | Any Release Preview workspace except `About` | `Mute` / `Unmute` | Button | Yes | Toggle muted state without losing previous volume | Yes | Global |
| Shared player | Any Release Preview workspace except `About` | `Shared player seek` | Range input | Yes | Seek within the active track | Yes | Global |

## Library Workspace

Navigation path:
- `Release Preview` -> Sidebar `Library`

Panels:
- Left sidebar `Library Ingest`
- Main `Overview`
- Main `Quick Actions`

| Panel | Control | Type | Appears actionable | Expected purpose | Mode-dependent | Scope |
| --- | --- | --- | --- | --- | --- | --- |
| Library Ingest | `Hide Library Ingest` / `Show Library Ingest` | Collapse toggle button | Yes | Collapse or expand ingest sidebar body | Yes | Local |
| Library Ingest | `Scan Folders` | Tab | Yes | Show saved-root scan tools | Yes | Local |
| Library Ingest | `Import Files` | Tab | Yes | Show manual file import tools | Yes | Local |
| Library Ingest > Scan Folders | `Library root path` | Text input | Yes | Enter folder path to add as scan root | Yes | Local |
| Library Ingest > Scan Folders | `Browse...` | Button | Yes | Open native folder picker and populate root path | Yes | Local |
| Library Ingest > Scan Folders | `Add Folder` | Button | Yes | Persist the root path as a library root | Yes | Local |
| Library Ingest > Scan Folders | `Refresh Folders` | Button | Yes | Reload saved library roots and statuses | Yes | Local |
| Library Ingest > Scan Folders | `Scan Folder` (per root) | Button | Yes | Start/resume ingest scan for that root | Yes | Contextual |
| Library Ingest > Scan Folders | `Cancel Scan` (per root) | Button | Yes | Request cancellation for active root ingest job | Yes | Contextual |
| Library Ingest > Scan Folders | `Remove Folder` (per root) | Button | Yes | Remove saved root and prune imported state tied to it | Yes | Contextual |
| Library Ingest > Import Files | `Import file paths` | Textarea | Yes | Accept newline/comma-separated file paths for manual import | Yes | Local |
| Library Ingest > Import Files | `Import Files` | Button | Yes | Import listed files into local catalog | Yes | Local |
| Overview | `Hide Library overview` / `Show Library overview` | Collapse toggle button | Yes | Collapse or expand overview summary | Yes | Local |
| Quick Actions | `Hide Quick actions` / `Show Quick actions` | Collapse toggle button | Yes | Collapse or expand quick actions | Yes | Local |
| Quick Actions | `Open Track QC` | Button | Yes | Open `Quality Control` in Track QC mode | Yes | Local |
| Quick Actions | `Open Album QC` | Button | Yes | Open `Quality Control` in Album QC mode | Yes | Local |
| Quick Actions | `Open Publish Workflow` | Button | Yes | Switch to Publish mode and open `Publisher Ops` | Yes | Local |

## Quality Control Workspace

Navigation path:
- `Release Preview` -> Sidebar `Quality Control`

Workspace-level controls:

| Panel | Control | Type | Appears actionable | Expected purpose | Mode-dependent | Scope |
| --- | --- | --- | --- | --- | --- | --- |
| QC intent shell | `Track QC` | Tab | Yes | Show track list + track detail review layout | Yes | Local |
| QC intent shell | `Album QC` | Tab | Yes | Show album grouping/review layout | Yes | Local |

### Track QC Controls

Visible surfaces:
- `PlayListPanel` on the left
- `TrackDetailPanel` on the right
- Embedded `QcPlayer`
- Codec Preview card
- Batch Export card

| Panel | Control | Type | Appears actionable | Expected purpose | Mode-dependent | Scope |
| --- | --- | --- | --- | --- | --- | --- |
| Track list toolbar | `Search tracks` | Search input | Yes | Filter/search tracks by title, artist, album, or path | Yes | Local |
| Track list toolbar | `Track sort` | Select | Yes | Change visible ordering | Yes | Local |
| Track list toolbar | `Track grouping` | Select | Yes | Group rows by none/artist/album | Yes | Local |
| Track list toolbar | `Refresh List` | Button | Yes | Reload catalog list | Yes | Local |
| Track list toolbar | `Library` | Tab | Yes | Show catalog/library rows | Yes | Local |
| Track list toolbar | `Queue` | Tab | Yes | Show queue/session order rows | Yes | Local |
| Track list toolbar | `All Tracks` / `Favorites Only` | Toggle-like button | Yes | Switch visible library filter between all rows and favorites-only | Yes | Local |
| Track list toolbar | `Album QC View` | Button | Yes | Switch QC intent to album mode | Yes | Local |
| Queue toolbar | `Shuffle` | Button | Yes | Randomize current session queue order | Yes | Local |
| Queue toolbar | `Clear Queue` | Button | Yes | Remove manual queue lock and return to visible list order | Yes | Local |
| Track list batch selection | `Select <track> for batch actions` | Checkbox | Yes | Add/remove row from current batch selection | Yes | Contextual |
| Track list batch selection | `Play Selection` | Button | Yes | Replace queue with selected rows and start playback | Yes | Local |
| Track list batch selection | `Add Selection to Queue` | Button | Yes | Append selected rows to queue | Yes | Local |
| Track list batch selection | `Play Selection Next` | Button | Yes | Insert selected rows after current item | Yes | Local |
| Track list batch selection | `Clear Selection` | Button | Yes | Clear current track batch selection | Yes | Local |
| Track rows | Track row main button | Button | Yes | Select/focus that track in Track Detail | Yes | Contextual |
| Track rows | `Track actions for <track>` | Menu button | Yes | Open row context menu | Yes | Contextual |
| Track list footer | `Load more tracks` | Button | Yes | Request next catalog page | Yes | Local |
| Row context menu | `Play Now` | Menu item | Yes | Start immediate playback for that track | Yes | Contextual |
| Row context menu | `Add to Queue` | Menu item | Yes | Append track to queue | Yes | Contextual |
| Row context menu | `Play Next` | Menu item | Yes | Insert track after current queue item | Yes | Contextual |
| Row context menu | `Add Favorite` / `Remove Favorite` | Menu item | Yes | Toggle session favorite state | Yes | Contextual |
| Row context menu | `Show in Track QC` | Menu item | Yes | Move focus to Track QC and select row | Yes | Contextual |
| Row context menu | `Add to Selection` / `Already in Selection` | Menu item | Yes | Add row to batch selection | Yes | Contextual |
| Row context menu (queue mode) | `Remove from Queue` | Menu item | Yes | Remove queued row | Yes | Contextual |
| Row context menu (queue mode) | `Move Up` | Menu item | Yes | Move queued row earlier | Yes | Contextual |
| Row context menu (queue mode) | `Move Down` | Menu item | Yes | Move queued row later | Yes | Contextual |
| Track Detail | `Play Now` | Button | Yes | Play selected track immediately | Yes | Local |
| Track Detail | `Add to Queue` | Button | Yes | Append selected track to queue | Yes | Local |
| Track Detail | `Play Next` | Button | Yes | Insert selected track after current item | Yes | Local |
| Track Detail | `Favorite` / `Unfavorite` | Button | Yes | Toggle favorite state for selected track | Yes | Local |
| Track Detail | `Edit Metadata` | Button | Yes | Enter metadata edit mode | Yes | Local |
| Track Detail | `Save Metadata` | Button | Yes | Persist edited metadata | Yes | Local |
| Track Detail | `Reset Fields` | Button | Yes | Restore editor values from last saved state without leaving edit mode | Yes | Local |
| Track Detail | `Cancel Edit` | Button | Yes | Exit edit mode and discard unsaved metadata edits | Yes | Local |
| Track Detail | `Prepare for Release...` | Button | Yes | Generate a draft and bridge into Publish workflow | Yes | Local |
| Track Detail | `Visibility` | Select | Yes | Change local visibility policy while editing | Yes | Local |
| Track Detail | `License` | Select | Yes | Change local license policy while editing | Yes | Local |
| Track Detail | `Downloadable in future publish/export workflows` | Checkbox | Yes | Toggle local downloadable flag while editing | Yes | Local |
| Track Detail | `Tags` | Textarea | Yes | Edit tag list while in metadata edit mode | Yes | Local |
| Embedded QC player | `Waveform seek bar` | Clickable waveform/button | Yes | Seek via waveform | Yes | Local |
| Embedded QC player | `Playback position` | Range input | Yes | Fine-grained QC seek | Yes | Local |
| Embedded QC player | `-5%` | Button | Yes | Seek backward by 5% | Yes | Local |
| Embedded QC player | `+5%` | Button | Yes | Seek forward by 5% | Yes | Local |
| Codec Preview | `Codec profile A` | Select | Yes | Choose first preview profile | Yes | Local |
| Codec Preview | `Codec profile B` | Select | Yes | Choose second preview profile | Yes | Local |
| Codec Preview | `Enable Blind-X mode (identity hidden until reveal)` | Checkbox | Yes | Hide A/B identity during comparison | Yes | Local |
| Codec Preview | `Bypass` | Button | Yes | Route preview to unprocessed source | Yes | Local |
| Codec Preview | `Codec A` | Button | Yes | Route preview to profile A output | Yes | Local |
| Codec Preview | `Codec B` | Button | Yes | Route preview to profile B output | Yes | Local |
| Codec Preview | `Blind-X` | Button | Yes | Route preview to hidden blind variant | Yes | Local |
| Codec Preview | `Reveal` | Button | Yes | Reveal which blind variant was mapped | Yes | Local |
| Batch Export | Profile checkboxes | Checkbox | Yes | Choose export profiles for batch job | Yes | Local |
| Batch Export | `Batch export output directory` | Text input | Yes | Set output folder for job artifacts | Yes | Local |
| Batch Export | `Batch export target LUFS` | Text input | Yes | Optional loudness target override | Yes | Local |
| Batch Export | `Start Batch Export` | Button | Yes | Submit background multi-profile export job | Yes | Local |

### Album QC Controls

| Panel | Control | Type | Appears actionable | Expected purpose | Mode-dependent | Scope |
| --- | --- | --- | --- | --- | --- | --- |
| Album list | Album group row | Button | Yes | Select album group for detail view | Yes | Contextual |
| Album detail | `Play Album` | Button | Yes | Start playback from first track and queue album | Yes | Local |
| Album detail | `Add Album to Queue` | Button | Yes | Append full album to queue | Yes | Local |
| Album detail | `Show in Track QC` | Button | Yes | Switch to Track QC and focus first track | Yes | Local |
| Album detail | `Select <track> for album batch actions` | Checkbox | Yes | Add/remove album track from selection | Yes | Contextual |
| Album detail | `Add Selection to Queue` | Button | Yes | Append selected album tracks to queue | Yes | Local |
| Album detail | `Play Selection Next` | Button | Yes | Insert selected album tracks after current item | Yes | Local |
| Album detail | `Clear Selection` | Button | Yes | Clear album-track selection | Yes | Local |
| Album detail | Album track row main button | Button | Yes | Open that track in Track QC | Yes | Contextual |
| Album detail | `Open actions for <track>` | Menu button | Yes | Open row context menu for album track | Yes | Contextual |

## Playlists Workspace

Navigation path:
- `Release Preview` -> Sidebar `Playlists`

Visible surface:
- Reuses the full `PlayListPanel` control surface described under `Quality Control > Track QC`.

Control deltas relative to Track QC:
- No `TrackDetailPanel`, embedded QC player, Codec Preview card, or Batch Export card.
- The list/queue/search/sort/grouping/context-menu controls remain visible and actionable.

## Video Workspace

Navigation path:
- `Release Preview` -> Sidebar `Video Workspace`

Sections:
- Persistence
- Media
- Visual
- Text
- Output
- Preview
- Render

| Section | Control | Type | Appears actionable | Expected purpose | Mode-dependent | Scope |
| --- | --- | --- | --- | --- | --- | --- |
| Persistence | `Save Project` | Button | Yes | Save current project snapshot to local persistence | Yes | Local |
| Persistence | `Load Project` | Button | Yes | Restore saved project snapshot | Yes | Local |
| Persistence | `Save Preset` | Button | Yes | Save reusable workspace preset | Yes | Local |
| Persistence | `Load Preset` | Button | Yes | Restore saved workspace preset | Yes | Local |
| Persistence | `Dismiss Status` | Button | Yes | Clear current persistence status message | Yes | Local |
| Media > Still Image | `Browse Image (Native)` | Button | Yes | Open native file picker/path import for image | Yes | Local |
| Media > Still Image | `Choose Image File` | Button | Yes | Open browser-style file dialog for image | Yes | Local |
| Media > Still Image | `Clear` | Button | Yes | Remove current image asset from project | Yes | Local |
| Media > Still Image | Image drop zone | Drop target / button-like region | Yes | Accept dropped JPG/PNG image file | Yes | Local |
| Media > Audio | `Browse Audio (Native)` | Button | Yes | Open native file picker/path import for WAV | Yes | Local |
| Media > Audio | `Choose Audio File` | Button | Yes | Open browser-style file dialog for WAV | Yes | Local |
| Media > Audio | `Clear` | Button | Yes | Remove current audio asset from project | Yes | Local |
| Media > Audio | Audio drop zone | Drop target / button-like region | Yes | Accept dropped WAV file | Yes | Local |
| Visual | Image fit mode radios | Radio group | Yes | Set preview fit behavior | Yes | Local |
| Visual | `Enable reactive overlay` | Checkbox | Yes | Toggle waveform overlay | Yes | Local |
| Visual | `Overlay position` | Select | Yes | Set overlay top/bottom position | Yes | Local |
| Visual | `Overlay opacity` | Range input | Yes | Set overlay opacity | Yes | Local |
| Visual | `Overlay intensity` | Range input | Yes | Set overlay bar intensity | Yes | Local |
| Visual | `Overlay smoothing` | Range input | Yes | Set overlay smoothing | Yes | Local |
| Visual | `Overlay color` | Color input | Yes | Set overlay accent color | Yes | Local |
| Text | `Enable text layer` | Checkbox | Yes | Toggle text overlay | Yes | Local |
| Text | `Text layout preset` | Select | Yes | Choose title/artist layout style | Yes | Local |
| Text | `Title text` | Text input | Yes | Edit title overlay text | Yes | Local |
| Text | `Artist text` | Text input | Yes | Edit artist overlay text | Yes | Local |
| Text | `Text size` | Range input | Yes | Set font size | Yes | Local |
| Text | `Text color` | Color input | Yes | Set text color | Yes | Local |
| Text | `Reset Text` | Button | Yes | Restore text settings defaults | Yes | Local |
| Output | `Output preset` | Select | Yes | Choose render preset | Yes | Local |
| Output | `Output directory` | Text input | Yes | Set destination folder | Yes | Local |
| Output | `Recent output directories` | Select | Yes | Reuse recently used destination folder | Yes | Local |
| Output | `Output file name` | Text input | Yes | Set output base filename | Yes | Local |
| Output | `Overwrite policy` | Select | Yes | Choose replace/disallow overwrite behavior | Yes | Local |
| Preview | `Play` / `Pause` | Button | Yes | Toggle local preview playback | Yes | Local |
| Preview | `Restart` | Button | Yes | Seek preview back to start | Yes | Local |
| Preview | `Preview position` | Range input | Yes | Seek within preview playback | Yes | Local |
| Render | `Build Render Request` | Button | Yes | Build deterministic request JSON without rendering | Yes | Local |
| Render | `Refresh Diagnostics` | Button | Yes | Re-read render environment diagnostics | Yes | Local |
| Render | `Render MP4` | Button | Yes | Start render if preflight passes | Yes | Local |
| Render | `Cancel Render` | Button | Yes | Cancel active render job | Yes | Local |
| Render | `Reset` | Button | Yes | Reset render controller state | Yes | Local |
| Render success | `Open Output Folder` | Button | Yes | Open output directory after successful render | Yes | Contextual |
| Alerts | `Dismiss import issue` | Button | Yes | Clear current import issue banner | Yes | Contextual |

## Settings Workspace

Navigation path:
- Any mode -> Sidebar `Settings`

| Section | Control | Type | Appears actionable | Expected purpose | Mode-dependent | Scope |
| --- | --- | --- | --- | --- | --- | --- |
| Preferences | `Hide Preferences` / `Show Preferences` | Collapse toggle button | Yes | Collapse or expand settings form | No | Local |
| Preferences | `Theme preference` | Select | Yes | Choose system/light/dark theme mode | No | Local |
| Preferences | `Theme palette variant` | Select | Yes | Choose palette variant compatible with active theme mode | No | Local |
| Preferences | `Compact density (denser lists and controls)` | Checkbox | Yes | Toggle denser layout | No | Local |
| Preferences | `Show full local file paths (disable truncation)` | Checkbox | Yes | Toggle path truncation behavior | No | Local |
| Preferences | `On file drop, also add each file's parent folder as a scan root` | Checkbox | Yes | Toggle drop-to-root behavior | No | Local |
| Shortcuts | `<action> shortcut` inputs for eight actions | Read-only text input with key capture | Yes | Capture and persist custom keyboard shortcut binding | No | Local |
| Shortcuts | `Clear` per shortcut row | Button | Yes | Remove that binding | No | Contextual |
| Shortcuts | `Reset Shortcuts` | Button | Yes | Restore default shortcut map | No | Local |
| Actions | `Clear Notice` | Button | Yes | Clear current app notice banner | No | Local |
| Actions | `Clear Error Banner` | Button | Yes | Clear current catalog error banner | No | Local |
| Actions | `Reset Library Data` | Button | Yes | Clear persisted library/catalog/session state | No | Local |
| Summary | `Hide Summary` / `Show Summary` | Collapse toggle button | Yes | Collapse or expand quick status summary | No | Local |

Shortcut rows currently exposed:
- `Play / Pause`
- `Next Track`
- `Previous Track`
- `Mute / Unmute`
- `Queue / Playlist`
- `Focus Track Search`
- `Move Queue Up`
- `Move Queue Down`

## About Workspace

Navigation path:
- Any mode -> Sidebar `About`

| Section | Control | Type | Appears actionable | Expected purpose | Mode-dependent | Scope |
| --- | --- | --- | --- | --- | --- | --- |
| Resources | `Copy System Info` | Button | Yes | Copy version/platform/diagnostic summary to clipboard | No | Local |
| Resources | `Refresh Diagnostics` | Button | Yes | Re-fetch runtime diagnostics for support/information purposes | No | Local |

## Publish Workflow Shell

Navigation path:
- `Publish` -> Sidebar `Publisher Ops`

Visible shell surfaces:
- Publish step bar
- Embedded `PublisherOpsWorkspace`
- Right-side `Release Selection` dock

| Surface | Control | Type | Appears actionable | Expected purpose | Mode-dependent | Scope |
| --- | --- | --- | --- | --- | --- | --- |
| Publish step shell | `New Release` | Tab | Yes | Show new release setup screen | Yes | Local |
| Publish step shell | `Plan / Preview` | Tab | Yes | Show normalized spec and planned actions | Yes | Local |
| Publish step shell | `Execute` | Tab | Yes | Show execute result view | Yes | Local |
| Publish step shell | `Report / History` | Tab | Yes | Show history/report view | Yes | Local |
| Release Selection dock | `Clear Selection` | Button | Yes | Clear prepared release candidates | Yes | Local |
| Release Selection dock | `Open Track QC` | Button | Yes | Return to Release Preview Track QC to prepare more tracks | Yes | Local |
| Release Selection dock | `Load <track> into Publish workflow` | Button | Yes | Apply prepared draft/spec/media pair into Publisher Ops form | Yes | Contextual |
| Release Selection dock | `Remove <track> from release selection` | Button | Yes | Remove prepared draft from selection list | Yes | Contextual |

### Embedded Publisher Ops Controls

Internal workflow tabs are hidden in the embedded shell, so the step bar above is the visible screen switcher.

#### New Release screen

| Control | Type | Appears actionable | Expected purpose | Scope |
| --- | --- | --- | --- | --- |
| `Spec File Path` | Text input | Yes | Enter release spec path | Local |
| `Media File Path` | Text input | Yes | Enter source media path | Local |
| `Environment` | Select | Yes | Choose TEST/STAGING/PRODUCTION plan label | Local |
| `Mock connector (safe simulation)` | Checkbox | Yes | Include mock publisher platform | Local |
| `Load Spec` | Button | Yes | Parse/validate spec and advance preview state | Local |
| `Plan / Preview` | Submit button | Yes | Build release plan from current inputs | Local |
| `Execute` | Button | Yes | Run execute workflow for current planned release | Local |

#### Report / History screen

| Control | Type | Appears actionable | Expected purpose | Scope |
| --- | --- | --- | --- | --- |
| `Refresh History` | Button | Yes | Reload release history rows | Local |
| `Open Release Report` | Button | Yes | Load report for selected release row | Local |
| `Resume Release` | Button | Yes | Re-run execution using selected release state | Local |
| History radio rows | Radio input | Yes | Select history target for report/resume actions | Contextual |
