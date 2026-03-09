# GUI Button Intended Behavior Reference (Desktop)

Document ID: RP-GUI-BUTTONS-2026-03-01
Date: 2026-03-01
Status: Active

Purpose:

- Define intended behavior for clickable controls in Listen/QC workspaces.
- Provide pass/fail expectations for stability-focused implementation.
- Serve as a bug triage reference.

Scope:

- In scope: Listen mode workspaces (`Library`, `Quality Control`, `Playlists`, `Settings`, `About`) and shared transport.
- Out of scope: Publish workflow button semantics beyond shell-level navigation.

## 1. Global Rules

Rule G1: Buttons must be idempotent where repeated clicks are expected.

Rule G2: Buttons must expose deterministic disabled states based on prerequisites.

Rule G3: Buttons must not report false-positive errors for healthy fallback paths.

Rule G4: Any backend failure path must surface actionable status text.

Rule G5: UI state changes that imply backend truth must be backed by command success.

## 2. App Shell Buttons

### 2.1 Mode Tabs

Buttons:

- `Listen`
- `Publish`

Intended behavior:

- Switches top-level mode.
- Persists mode selection.
- Does not trigger publish execution by itself.

Pass:
- Mode switches without stale workspace state corruption.

Fail:
- Mode switch triggers unrelated command side effects.

### 2.2 Shared Transport

Buttons:

- `Prev`
- `Play` or `Pause`
- `Next`
- `Mute`
- Queue visibility toggle (`Playlist` or equivalent queue toggle button)

Intended behavior:

- Controls active playback source from shared transport state.
- `Prev` and `Next` navigate queue deterministically.
- Queue visibility toggle must use native transport when available and local fallback when unavailable.

Pass:
- Queue visibility toggle does not emit playback error banner on healthy fallback path.

Fail:
- Toggle operation reports "Unable to toggle queue visibility" while behavior remains healthy.

## 3. Library Workspace Buttons

### 3.1 Ingest Panel Buttons

Buttons:

- `Browse...`
- `Add Root`
- `Refresh Roots`
- Per-root `Scan`
- Per-root `Remove`
- `Import Files`

Intended behavior:

- `Browse...` selects folder path.
- `Add Root` persists root path.
- `Scan` creates and tracks ingest job.
- `Remove` removes root and prunes root-matched tracks/references.
- `Import Files` imports file paths directly.

Pass:
- Removing a root updates visible track count and prunes stale queue/favorite/selection IDs.

Fail:
- Removed-root tracks remain visible or continue in queue/favorites.

### 3.2 Quick Navigation Buttons

Buttons:

- `Open Quality Control`
- `Open Playlists`
- `Open Publish Workflow` (if shown)

Intended behavior:

- Workspace navigation only.
- No hidden ingest/playback mutation.

## 4. Playlists Workspace Buttons

### 4.1 Toolbar Buttons

Buttons:

- `Refresh List`
- `Library` (mode tab)
- `Queue` (mode tab)
- `Shuffle`
- `Clear Queue`
- `Album QC View`

Intended behavior:

- `Refresh List` reloads catalog list with active search context.
- `Library` and `Queue` tabs switch list mode.
- `Shuffle` randomizes queue order.
- `Clear Queue` clears session queue lock and reverts to visible-list ordering.

Pass:
- Mode switching and queue actions do not trigger infinite update loops.

Fail:
- Repeated tab switching causes render-depth warnings or stale mode mismatch.

### 4.2 Batch Selection Buttons (Library mode)

Buttons:

- `Play Selection`
- `Add Selection to Queue`
- `Play Selection Next`
- `Clear Selection`

Intended behavior:

- Operates in visible-order deterministic sequence.
- `Play Selection` sets queue from selection and starts first selected track.

Pass:
- Queue order matches selected list order.

Fail:
- Selection playback starts on wrong track or wrong queue ordering.

### 4.3 Row Buttons and Context Actions

Controls:

- Row main button (arm/select)
- Row menu button
- Context actions: `Play Now`, `Add to Queue`, `Play Next`, `Favorite`, `Show in Tracks`, `Remove from Queue`, `Move Up`, `Move Down`

Intended behavior:

- `Play Now` starts immediate playback and updates queue ordering accordingly.
- `Move Up` and `Move Down` are queue-only operations.

Pass:
- Queue reorder works for both drag-drop and keyboard shortcuts.

Fail:
- Drag-drop reorder appears to work in UI but does not persist queue order.

## 5. Quality Control Workspace Buttons

## 5.1 Track-Level Buttons

Buttons:

- `Play Now`
- `Add to Queue`
- `Play Next`
- `Favorite` or `Unfavorite`
- Metadata edit controls: `Edit`, `Save`, `Reset`, `Cancel`
- `Prepare for Release...`

Intended behavior:

- Playback buttons route through shared transport state.
- Metadata save persists validated fields and shows explicit success/failure notice.

Pass:
- Save updates persisted track metadata and survives reload.

Fail:
- Save claims success without persisted field changes.

## 5.2 Codec Preview Buttons

Buttons:

- Variant buttons: `Bypass`, `Codec A`, `Codec B`, `Blind-X`, `Reveal`
- Profile selectors: `Profile A`, `Profile B`
- Blind-X toggle: `Enable Blind-X mode`

Intended behavior (stability release target):

- Variant switch changes actual playback source path for selected codec variant.
- Blind-X maps deterministically to A or B until reveal.
- Invalid or unavailable profile selection returns explicit error and keeps prior valid state.

Pass:
- Audible/source-path behavior changes with variant selection.

Fail:
- Variant state changes in UI with no actual source change.

## 5.3 Batch Export Buttons

Buttons:

- Profile checkboxes
- `Start Batch Export`

Intended behavior:

- Starts background export job for selected profiles.
- Job status panel updates with truthful profile outcomes.
- Missing encoder or encode failure must show failed status, not completed.

Pass:
- Per-profile failures are explicit and reflected in status summary.

Fail:
- Failed encode path reported as completed.

## 6. Settings Workspace Buttons

Buttons:

- `Reset Shortcuts`
- `Clear Notice`
- `Clear Error Banner`
- `Reset Library Data`

Intended behavior:

- `Reset Shortcuts` restores default bindings.
- `Reset Library Data` clears local catalog roots, tracks, ingest jobs, queue/favorites/selection state.

Pass:
- Reset leaves app in clean local-library state with zero stale tracks.

Fail:
- Reset completes while stale state remains visible.

## 7. Keyboard Shortcut Behavior

Configurable actions:

- play/pause
- next
- previous
- mute
- queue visibility toggle
- focus search
- queue track move up/down

Intended behavior:

- Editable and persisted in settings.
- Conflict warning shown when bindings collide.

Pass:
- Rebound shortcut remains active after remount.

Fail:
- Binding is persisted but action does not execute.

## 8. Error Display Rules

Rule E1:
- Use warning/info banner only when user action requires intervention.

Rule E2:
- Suppressed fallback-path errors must not produce top-level playback error banners.

Rule E3:
- Error messages must include clear action guidance where possible.

## 9. Pass/Fail Quick Matrix

- Queue toggle fallback: pass if no false error banner, fail otherwise.
- Root removal pruning: pass if no stale tracks/references, fail otherwise.
- Drop folder autoplay: pass if first scanned track autoplays once, fail on repeated loop or no autoplay.
- Queue reorder: pass if drag and keyboard both reorder deterministically, fail otherwise.
- Codec preview variant truth: pass if real source changes, fail if UI-only.
- Batch export semantics: pass if failed encode is failed state, fail if reported completed.

## 10. Bug Report Template

Include the following fields:

- Mode and workspace
- Button label
- Preconditions
- Expected behavior (quote from this document)
- Actual behavior
- Error code/message
- Repro rate (always, intermittent, one-off)
- Build and test context

## 11. Change Log

- 2026-03-01: Full update for stability-first backlog alignment and pass/fail button contracts.
