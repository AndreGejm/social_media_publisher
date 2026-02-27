# UI Navigation Refactor Step Plan (Listen vs Publish)

## Goal
Reduce UI clutter and confusion by separating general listening/library workflows from the release publishing workflow, while preserving the existing Rust/Tauri backend and deterministic publisher pipeline.

## Constraints
- Keep the bottom shared transport global.
- Keep the right dock queue global, but allow mode-specific queue context later.
- Do not change core Rust publisher state machine behavior.
- Ship in small UI-only slices with tests after each slice.

## Step 1 (Current)
### Deliverable
- Add top-level `Listen` / `Publish` mode switch in the shell.
- Filter sidebar workspaces by active mode.
- Persist mode selection in local storage.
- Ensure `Open in Publisher Ops` / bridge flows switch to `Publish` mode automatically.

### Acceptance Criteria
- `Listen` mode only shows music library workspaces (`Library`, `Tracks`, `Albums`, `Playlists`, `Settings`).
- `Publish` mode only shows `Publisher Ops`.
- Switching modes updates visible workspace panel predictably.
- Existing Publisher Ops functionality is unchanged.

### Test Coverage
- Mode switch toggles visible workspace buttons.
- Publisher Ops remains reachable and mounted correctly after mode switch.

## Step 2
### Deliverable
- Add a Publish step bar (`New Release`, `Plan`, `Verify/QC`, `Execute`, `History`) above the Publisher Ops host.
- Hide non-active publish panels in constrained layouts (delegate to existing `App.tsx` internal screen state initially).

### Acceptance Criteria
- Publish mode clearly reads as a workflow, not general browsing.
- Vertical clutter in Publish area is reduced.

## Step 3
### Deliverable
- Split queue context by mode:
  - `Listen` queue (music listening queue)
  - `Publish` queue/selection (release candidates or release track context)
- Preserve global transport UI, but prevent accidental queue mixing.

### Acceptance Criteria
- Queue content changes when switching modes (context-aware).
- No hidden coupling between listening queue and publishing selections.

## Step 4
### Deliverable
- Refactor `Library` workspace into sub-tabs:
  - `Scan Folders` (Library Roots)
  - `Import (Copy into Library)`
- Clarify labels and hints (“Indexes in place / does not copy” vs managed import).

### Acceptance Criteria
- Users can immediately distinguish scan-vs-import behavior without reading docs.

## Step 5
### Deliverable
- Standardize center-panel action placement:
  - sticky view headers for object-level actions
  - row actions moved to hover/context menu where possible
- Reduce duplicated action rows.

### Acceptance Criteria
- Action locations feel predictable across `Tracks`, `Albums`, `Publisher Ops`.

## Step 6
### Deliverable
- Make `Track Detail` a fully self-contained edit surface (single-panel edit mode).
- Keep `Save` / `Cancel` in the sticky detail header.

### Acceptance Criteria
- No visual split between read-only detail and editable metadata for base fields.
- Save/cancel flow is obvious and test-covered.

## Step 7
### Deliverable
- Global feedback consistency pass:
  - standardized toast/notice outcomes
  - queue badge updates
  - action state labels (`Added`, disabled states)
  - in-place long-running progress

### Acceptance Criteria
- Every user action has an observable outcome within 1 interaction step.

## Step 8
### Deliverable
- Responsive and ultrawide layout polish:
  - constrain center content width
  - collapsible sections
  - preserve access at `800x600`, `1024x768`

### Acceptance Criteria
- No critical control occlusion or horizontal overflow at target minimum viewports.

## Implementation Practice (applies to every step)
1. Make the smallest UI change that improves the mental model.
2. Add/adjust tests in `MusicWorkspaceApp.test.tsx` and/or `App.test.tsx`.
3. Run `lint`, targeted `vitest`, then full frontend `vitest`, then `build`.
4. Only proceed to the next step when all checks pass.
