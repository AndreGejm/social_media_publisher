BACKLOG INVESTIGATION TICKET

Title
Ultra-wide layouts cause shared player bar growth that obscures workspace content

Problem Statement
On ultra-wide setups, the bottom shared player bar can grow vertically and overlap effective content area, while shell padding assumes a relatively fixed bar height.

User/System Impact
Main workspace content can be obscured, reducing usability in a common desktop monitor class.

Observed Behavior
Bottom player appears excessively tall and encroaches on content on ultra-wide displays.

Expected Behavior
Player controls should remain dimensionally stable and extra horizontal space should not translate into obstructive vertical growth.

Evidence

- Shared player bar reserves content offset using fixed `--shared-player-height` (default 78px) in shell padding calculations (`apps/desktop/src/styles.css:884`, `apps/desktop/src/styles.css:889`).

- Actual player bar content includes multiple text rows and action groups without explicit single-row constraints (`apps/desktop/src/features/player/SharedPlayerBar.tsx:51`).

- Player bar layout uses flexible containers (`display: flex`) with no hard cap on resulting content height (`apps/desktop/src/styles.css:2790`, `apps/desktop/src/styles.css:2831`).

- Ultra-wide layout tier increases shell side columns via CSS variables from layout snapshot (`apps/desktop/src/app/layout/layoutManager.ts:30`, `apps/desktop/src/app/shell/AppShell.tsx:102`).

Hypotheses

- At specific width/DPI/zoom combinations, metadata/actions wrap into extra rows, making actual bar height exceed the reserved `--shared-player-height` space.

- Wide-tier sidebar/right-dock geometry can reduce center width enough to trigger wrapping despite large viewport width.

Unknowns / Missing Evidence

- Exact monitor resolution, zoom level, and DPI used in repro.

- Whether issue requires specific player states (e.g., exclusive warning line visible).

- Whether overlap is due to height growth, z-index stacking, or both.

Classification

Severity
Medium

Type
Responsive layout defect

Surface Area
Frontend shell layout + shared player component

Ownership Suggestion

Primary Module
Shared player bar and shell spacing contract

Primary Directory
apps/desktop/src

Likely Files

apps/desktop/src/styles.css

apps/desktop/src/features/player/SharedPlayerBar.tsx

apps/desktop/src/app/layout/layoutManager.ts

apps/desktop/src/app/shell/AppShell.tsx

Likely Functions / Entry Points

SharedPlayerBar render structure

music-shell/persistent-player-bar CSS contract

buildLayoutSnapshot

Investigation Scope
Reproduce ultra-wide overlap with controlled viewport/DPI combinations and determine whether player content wrapping violates the fixed shell offset contract. Keep out of scope unrelated theming or non-player responsiveness.

Suggested First Investigation Steps

- Reproduce with scripted viewport sizes (including >= 1680px width) and multiple zoom levels.

- Measure computed player bar height vs `--shared-player-height` at repro conditions.

- Capture which player sub-elements wrap when height growth occurs.

- Validate whether overlap persists when output warning/status lines are reduced.

Exit Criteria for Investigation

- A deterministic repro matrix (viewport/DPI/state) is documented.

- Root cause is narrowed to contract mismatch, wrapping behavior, or another specific layout path.

Priority Recommendation
Soon

Confidence
Medium

Tags

responsive-layout

player-bar

ultrawide
