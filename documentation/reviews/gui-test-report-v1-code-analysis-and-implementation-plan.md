# GUI Test Report v1 Review -> Code Analysis -> Implementation Plan

Source report reviewed:
- `REview_folder/GUI_Test_Report_v1.pdf`
- Extracted text: `REview_folder/GUI_Test_Report_v1.txt`

Date reviewed: February 26, 2026

## Executive Summary

Your report is correct in the main diagnosis: the current build is functional, but the interaction model is fragmented.

The highest-impact issues are not isolated button bugs. They are architecture problems in the frontend:
- playback state is split across `Track Detail`, `Album Detail`, embedded `QcPlayer`, and the bottom shared player
- queue visibility is local to the Tracks workspace
- action placement is inconsistent across views
- window/layout constraints conflict with the acceptance criteria

There are also a few likely direct implementation defects:
- import path handling likely fails for quoted Windows paths (common copy/paste behavior)
- `Play`-labeled actions often only change selection/queue and do not actually start playback
- shared player audio source is coupled to the selected track detail, not the active player track

## Report Findings -> Code Analysis (F1-F12)

## F1: Sidebar workspace buttons initially unresponsive

Report finding:
- `F1: Sidebar workspace buttons initially unresponsive`

Code analysis:
- Workspace buttons are real buttons and do call `setActiveWorkspace(workspace)` directly in `MusicWorkspaceApp`.
- However, all workspaces are mounted simultaneously and only hidden via the `hidden` attribute:
  - `apps/desktop/src/MusicWorkspaceApp.tsx:987`
  - `apps/desktop/src/MusicWorkspaceApp.tsx:1036`
  - `apps/desktop/src/MusicWorkspaceApp.tsx:1460`
  - `apps/desktop/src/MusicWorkspaceApp.tsx:1630`
- This means heavy subtrees (including embedded `Publisher Ops`) still mount and run effects on startup, which can create initial UI lag / perceived unresponsiveness.

Assessment:
- High confidence that startup interaction latency can occur due to hidden-but-mounted workspace trees.
- May also be aggravated by concurrent initial data loads in `MusicWorkspaceApp` and `Publisher Ops`.

Priority:
- `P1`

## F2: Library Roots functions work; folder picker UX requested

Report finding:
- `F2: Library Roots functions work; folder picker UX requested`

Code analysis:
- Current Library Root UX is manual text input only (`MusicWorkspaceApp` sidebar panel).
- Backend path validation is strict and correct; this is a UX gap, not a core defect.
- We previously tightened capability security and intentionally omitted dangerous plugins; adding a folder picker will require a deliberate allowlist update (dialog plugin/capability).

Relevant code:
- root actions UI: `apps/desktop/src/MusicWorkspaceApp.tsx:851`, `:861`, `:894`, `:904`
- root IPC handlers: `apps/desktop/src-tauri/src/commands.rs:878`, `:917`, `:949` (scan prepare/run path vicinity)

Assessment:
- Valid UX request.
- Should be implemented as an additive, secure dialog-based path chooser while keeping manual path entry.

Priority:
- `P2`

## F3: Import Audio returns FILE_READ_FAILED on valid WAV path

Report finding:
- `F3: Import Audio returns FILE_READ_FAILED on valid WAV path`

Code analysis (likely root cause):
- Frontend import parser only `.trim()`s each path token, but does not remove surrounding quotes:
  - `apps/desktop/src/MusicWorkspaceApp.tsx:632`
- Backend canonicalization trims whitespace but also does not strip surrounding quotes:
  - `apps/desktop/src-tauri/src/commands.rs:2059`
  - path construction from raw trimmed input: `apps/desktop/src-tauri/src/commands.rs:2063`
- If a user pastes `"C:\path\file.wav"` (quoted path), `tokio::fs::canonicalize` will fail and map to `FILE_READ_FAILED`, even though the underlying file path is valid.
- This matches your report pattern exactly.

Relevant code:
- import handler: `apps/desktop/src/MusicWorkspaceApp.tsx:632`
- IPC import entry: `apps/desktop/src-tauri/src/commands.rs:901`
- path validation/canonicalization: `apps/desktop/src-tauri/src/commands.rs:2030`, `:2059`

Assessment:
- High-confidence real bug.
- Easy hotfix in both frontend and backend (strip one layer of surrounding quotes safely).

Priority:
- `P0`

## F4: Settings presents KPI/status not configuration surface

Report finding:
- `F4: Settings presents KPI/status not configuration surface`

Code analysis:
- `Settings` is currently still a placeholder workspace:
  - `apps/desktop/src/MusicWorkspaceApp.tsx:1625`
- The app top bar shows global KPIs/status pills regardless of workspace, which likely makes Settings feel like a status-only area rather than configuration.

Assessment:
- Valid product/UI gap.
- Not a defect in existing logic, but a missing implementation.

Priority:
- `P2`

## F5: Filtered track list lacks explicit Play Now / Add to Queue

Report finding:
- `F5: Filtered track list lacks explicit Play Now / Add to Queue`

Code analysis:
- We added these actions in the Track Detail pane, not in the track rows:
  - `Play Now`: `apps/desktop/src/MusicWorkspaceApp.tsx:1146`
  - `Add to Queue`: `apps/desktop/src/MusicWorkspaceApp.tsx:1155`
  - `Play Next`: `apps/desktop/src/MusicWorkspaceApp.tsx:1164`
- Track rows only select the track:
  - `apps/desktop/src/MusicWorkspaceApp.tsx:1103`

Assessment:
- Report is correct from a usability perspective.
- This is an action placement issue, not a missing underlying queue/play implementation.

Priority:
- `P2` (can become `P1` if fast row-context menu is a key workflow)

## F6: Track Detail read-only; metadata editable in separate Authoring panel

Report finding:
- `F6: Track Detail read-only; metadata editable in separate Authoring panel`

Code analysis:
- Correct: metadata is displayed in a read-only `track-meta-grid`, while edits happen in a separate `Track Metadata Editor` (Authoring panel) below it.
- Read-only metadata panel:
  - `apps/desktop/src/MusicWorkspaceApp.tsx:1205` vicinity (`track-meta-grid` section starts earlier around `1170+`)
- Separate editor panel:
  - `apps/desktop/src/MusicWorkspaceApp.tsx:1239` (`Track Metadata Editor`)

Assessment:
- This is exactly how the current code behaves.
- If the target UX is “inspect + edit in place,” this needs a structural refactor, not a minor tweak.

Priority:
- `P1`

## F7: QC panel Play unresponsive

Report finding:
- `F7: QC panel Play unresponsive`

Code analysis (architectural mismatch likely causes this):
- The embedded track-detail QC player (`QcPlayer`) does **not** own an audio element in Music Core:
  - `renderAudioElement={false}` at `apps/desktop/src/MusicWorkspaceApp.tsx:1386`
- Actual playback is handled by a separate bottom `<audio>` element:
  - `apps/desktop/src/MusicWorkspaceApp.tsx:1694`
- The bottom audio source is derived from **selected track detail**, not the current player track:
  - `playerAudioSrc = selectedTrackDetail ? ... : undefined`
  - `apps/desktop/src/MusicWorkspaceApp.tsx:345`

Impact:
- QC/track-detail playback controls can be wired to player state that is not the same as the actual audio source.
- This can present as “Play button does nothing” or controls acting on the wrong track.

Assessment:
- High-confidence architectural bug.

Priority:
- `P0`

## F8: Album Detail Play controls non-responsive

Report finding:
- `F8: Album Detail Play controls non-responsive`

Code analysis:
- `playAlbumGroup(...)` sets queue + selection and navigates to `Tracks`, but does not actually call audio play:
  - `apps/desktop/src/MusicWorkspaceApp.tsx:603`
- `playTrackNow(...)` also sets queue/selection/player state, but does not call `togglePlay()`:
  - `apps/desktop/src/MusicWorkspaceApp.tsx:533`
- Therefore `Play Album` and some `Play` actions are semantically “focus/select” actions, not true play actions.

Assessment:
- Real behavior/label mismatch.
- Likely exactly what users are experiencing.

Priority:
- `P0`

## F9: Add Album to Queue provides no feedback

Report finding:
- `F9: Add Album to Queue provides no feedback`

Code analysis:
- `Add Album to Queue` exists and updates local session queue:
  - button: `apps/desktop/src/MusicWorkspaceApp.tsx:1524`
- But queue UI is only visible in the Tracks workspace, not in Albums:
  - queue panel lives inside `Tracks` workspace section (`apps/desktop/src/MusicWorkspaceApp.tsx:1394`)
- No toast/status message is emitted after queue mutations.

Assessment:
- Valid UX issue.
- Function likely works, but feedback/visibility is missing.

Priority:
- `P1`

## F10: Shared Player transport inactive

Report finding:
- `F10: Shared Player transport inactive`

Code analysis:
- Root cause is likely the same as F7 + F8:
  - shared audio source tied to `selectedTrackDetail`, not `playerTrackId` (`MusicWorkspaceApp.tsx:345`)
  - playback actions often only change state but do not trigger `audio.play()`
- The shared player only renders when `selectedTrackDetail` is present:
  - conditional render around bottom player: `apps/desktop/src/MusicWorkspaceApp.tsx:1638` (section vicinity)

Impact:
- Shared player can be absent or control a stale source when queue/player state diverges from selection state.

Assessment:
- High-confidence architectural defect.

Priority:
- `P0`

## F11: Layout not responsive to resizing (800x600–5120x1440)

Report finding:
- `F11: Layout not responsive to resizing (800x600–5120x1440)`

Code analysis:
- Tauri window minimum size currently blocks part of your target range:
  - `minWidth: 1100` and `minHeight: 760`
  - `apps/desktop/src-tauri/tauri.conf.json:20`
  - `apps/desktop/src-tauri/tauri.conf.json:21`
- This directly conflicts with the report acceptance criteria (`800x600`, `1024x768`).
- Layouts also use fixed multi-column structures that need better collapse behavior:
  - `tracks-layout`: `apps/desktop/src/styles.css:991`
  - `albums-layout`: `apps/desktop/src/styles.css:1327`
  - breakpoints exist, but they are not yet designed around your stated low-end target ergonomics.

Assessment:
- Valid and code-confirmed.
- Requires both configuration changes and layout redesign.

Priority:
- `P0`

## F12: Action placement inconsistent across views

Report finding:
- `F12: Action placement inconsistent across views`

Code analysis:
- Correct. Actions are distributed across:
  - track rows (selection only)
  - track detail action header
  - embedded `QcPlayer`
  - queue panel
  - bottom shared player
  - embedded `Publisher Ops`
- The current layout introduces multiple “transport” concepts and multiple action clusters with different semantics.

Assessment:
- This is the central architecture/UI issue in the current Music Core shell.

Priority:
- `P0` (as a design refactor, but should be split into safe increments)

## What the Report Gets Exactly Right (Architecture)

The strongest part of the report is the interaction model diagnosis:
- multiple playback domains
- fragmented controls
- queue not globally visible
- metadata editing detached from inspection

This aligns directly with the current code structure (`MusicWorkspaceApp` + embedded `QcPlayer` + bottom player + per-view actions).

## Step-by-Step Implementation Plan (Safe, Testable, Incremental)

Goal: fix high-severity behavior bugs first, then refactor toward the report’s target architecture without breaking the existing Publisher Ops pipeline.

## Phase A — Stabilization Hotfixes (P0, low risk)

### Step A1: Fix import path parsing for quoted Windows paths
Changes:
- Frontend: strip one layer of surrounding quotes for import/library-root/spec/media path inputs before IPC.
- Backend: harden `canonicalize_file_path(...)` and `canonicalize_directory_path(...)` to normalize quoted paths safely (single layer only).

Files:
- `apps/desktop/src/MusicWorkspaceApp.tsx`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src-tauri/src/commands.rs`

Tests:
- Add desktop command tests for quoted file paths:
  - `"C:\\...\\track.wav"` accepted
  - mismatched quotes rejected with `INVALID_ARGUMENT`
- Add frontend parser unit tests for import path tokenization + quote stripping

Acceptance:
- `Import to Library` works for quoted WAV paths copied from Explorer/terminal

### Step A2: Make Play-labeled actions actually start playback
Changes:
- `playTrackNow(...)` should schedule actual playback (not just selection/queue updates)
- `playAlbumGroup(...)` should trigger real playback after queue/selection update
- Decide and implement reliable playback-start sequencing after detail/audio source sync

Files:
- `apps/desktop/src/MusicWorkspaceApp.tsx`

Tests:
- `MusicWorkspaceApp` UI tests:
  - `Play Now` calls `audio.play()` (mocked) after selection
  - `Play Album` causes playback start + queue materialization

Acceptance:
- Album/track Play actions are immediately audible (or visibly enter playing state)

### Step A3: Fix shared player source coupling (selection vs player)
Changes:
- Introduce `playerTrackDetail` (or `playerTrackAudio`) derived from `playerTrackId`, separate from `selectedTrackDetail`
- Bind bottom `<audio src>` and transport timeline to `playerTrackId` state, not `selectedTrackDetail`
- Keep selection and playback linkable, but not identical

Files:
- `apps/desktop/src/MusicWorkspaceApp.tsx`

Tests:
- Regression tests:
  - selecting one track while another is playing does not hijack audio source
  - queue navigation updates audio source correctly

Acceptance:
- Shared player always controls the actual active player track

## Phase B — Single Playback Domain Refactor (P0/P1)

This addresses F7/F10/F12 at the architecture level.

### Step B1: Introduce a single global player store/hook
Create a dedicated local player state module:
- `useGlobalPlayer` or `player-session.ts`

State should include:
- `currentTrackId`
- `queueTrackIds`
- `isPlaying`
- `currentTimeSec`
- `playbackIntent` (important for sequencing/races)
- optional `lastActionSource` (`track_detail`, `album_detail`, `queue`, `shared_transport`)

Benefits:
- Removes duplicated transport semantics across panels
- Makes play/queue actions consistent and testable

### Step B2: Convert embedded `QcPlayer` in Music Core to a pure view/controller for the global player
Changes:
- `QcPlayer` remains a waveform/metrics UI
- It delegates all transport actions to the global player store
- It no longer acts as a separate playback domain

Files:
- `apps/desktop/src/QcPlayer.tsx`
- `apps/desktop/src/MusicWorkspaceApp.tsx`

### Step B3: Make bottom transport the authoritative transport
Changes:
- Bottom transport always reflects and controls the global player state
- Track/Album/QC panels become:
  - play initiation surfaces
  - seek/inspect surfaces
  - but not separate audio engines

Acceptance:
- “Playback originates only from global transport” can be implemented either literally (strict) or as “all play actions route through one transport state engine”

## Phase C — Queue Visibility & Feedback (P1)

Addresses F9 and part of F12.

### Step C1: Promote queue to a right-docked panel visible in all workspaces
Changes:
- Move queue panel out of `Tracks`-only section into persistent right dock (`Music Core` shell layout)
- Keep the same queue data source (global player queue)

Files:
- `apps/desktop/src/MusicWorkspaceApp.tsx`
- `apps/desktop/src/styles.css`

### Step C2: Add queue mutation feedback
Changes:
- Add lightweight non-blocking status/toast messages:
  - “Added 8 album tracks to queue”
  - “Queue reset to visible track order”
- Or visible queue badge animation/count bump

Tests:
- UI tests for queue count/status updates after `Add Album to Queue`

Acceptance:
- Queue changes are visible from any workspace without navigation

## Phase D — Track Detail Editing Integration (P1)

Addresses F6 and reduces action fragmentation.

### Step D1: Merge read-only metadata + authoring into a single Track Detail edit mode
Changes:
- Replace separate `Track Metadata Editor` panel with inline edit mode in Track Detail
- Add explicit `Edit` / `Save` / `Cancel`
- Keep current backend IPC `catalog_update_track_metadata(...)`

Files:
- `apps/desktop/src/MusicWorkspaceApp.tsx`
- `apps/desktop/src/styles.css`

Tests:
- Existing metadata save/error tests migrated to new inline edit flow
- New tests for `Cancel` preserving persisted values

### Step D2: Preserve advanced validation/hardening
No backend relaxations:
- keep Rust-side tag/policy validation
- keep `deny_unknown_fields` at IPC boundary

## Phase E — Action Placement Consistency (P1/P2)

Addresses F5 and F12.

### Step E1: Add row-level context menu (instead of many inline buttons)
Target actions for track rows:
- `Play Now`
- `Play Next`
- `Add to Queue`
- `Favorite/Unfavorite`
- `Open Details`
- `Open in Publisher Ops`

Why context menu:
- matches your report recommendation
- prevents list-row visual clutter

### Step E2: Standardize view-header action bars
For `Tracks`, `Albums`, and `Publisher Ops`:
- sticky header area
- primary actions left
- secondary actions grouped
- help `?` consistently placed

## Phase F — Responsiveness & Window Model (P0)

Addresses F11 directly.

### Step F1: Align Tauri window constraints with acceptance criteria
Change:
- Lower `minWidth` / `minHeight` to match supported QA target or define a documented minimum

Current conflict:
- `minWidth: 1100`, `minHeight: 760` in `apps/desktop/src-tauri/tauri.conf.json:20-21`

Decision needed:
- If `800x600` is required, window min size must allow it.

### Step F2: Rework shell layout breakpoints around 800x600 and 1024x768
Changes:
- At smaller widths:
  - stack left nav / content / queue dock
  - collapse topbar pills
  - ensure primary actions remain visible without horizontal scrolling
- At ultrawide:
  - cap content widths / improve spacing to avoid scattered controls

Files:
- `apps/desktop/src/styles.css`
- `apps/desktop/src/MusicWorkspaceApp.tsx` (structure if needed)

Tests:
- Add Playwright/E2E viewport smoke tests for:
  - `800x600`
  - `1024x768`
  - `1920x1080`
  - `3440x1440` (or `5120x1440` if your CI runners support)

## Phase G — Settings UX and Folder Picker (P2)

Addresses F2/F4.

### Step G1: Implement real Settings surface
First slice:
- Library root defaults / import behavior toggles
- UI density / layout preference
- path display mode (`full` vs `shortened`)

### Step G2: Add secure folder picker
Changes:
- Add Tauri dialog capability/plugin with minimal allowlist
- Use picker to populate Library Root input
- Keep manual path entry for power users

Security note:
- Update ACL/capabilities carefully (do not reopen broad filesystem/shell access)

## Phase H — QC Approval Gating UX Alignment (P1)

Report target:
- “QC approval gated on playback session”

Current state:
- approval is gated on valid QC analysis + manual approval, but not on actual listening/playback session
- `Publisher Ops` QC gating is implemented in UI state and is deterministic for current plan

### Step H1: Define policy for “playback session” requirement
Example policy:
- require at least one successful playback start for the current analyzed release
- optional minimum listened duration or seek + playback evidence

### Step H2: Implement playback evidence in UI state (Publisher Ops only)
Changes:
- store per-release QC playback session markers
- approval button remains disabled until evidence exists

Tests:
- `Approve for Release` remains disabled until playback starts
- re-analysis clears approval and resets playback evidence

## Recommended Execution Order (Practical)

1. `P0 hotfixes`: A1 + A2 + A3
2. `P0 layout`: F1 startup mount simplification + F11 window/breakpoints (at least baseline)
3. `P1 architecture`: B1 + B2 + B3 (single global playback transport)
4. `P1 UX`: C1 + C2 (global queue dock + feedback)
5. `P1 editing`: D1 (inline track detail edit mode)
6. `P2 polish`: E1/E2 + G1/G2
7. `P1 policy`: H1/H2 (playback-session QC gate refinement)

## Test Strategy For The Refactor (Required to Avoid Regressions)

## Frontend Unit/Component Tests
- `MusicWorkspaceApp`
  - quoted import path parsing
  - `Play Now` starts playback
  - `Play Album` starts playback + seeds queue
  - queue visible across workspaces
  - inline metadata edit save/cancel
- `QcPlayer`
  - seek controls route through global player callbacks
  - empty peak data still renders safely

## Frontend E2E / GUI Regression
- viewport scenarios (800x600, 1024x768, ultrawide)
- workspace nav responsiveness on startup
- import + play + queue + album + publisher bridge flow

## Tauri/Rust Command Tests
- quoted path acceptance tests for file and directory canonicalization
- import command with quoted WAV path (happy path)
- path normalization rejection tests (malformed quoting still rejected)

## Documentation/QA Support

Use together:
- `docs/GUI_BUTTON_INTENDED_BEHAVIOR.md` (button-by-button intended behavior)
- your PDF report

Suggested workflow:
- Log each bug against the finding ID (`F1..F12`)
- Mark:
  - `Root Cause Confirmed`
  - `Hotfix`
  - `Requires Architecture Refactor`

