BACKLOG INVESTIGATION TICKET

Title
QC and Playlists include redundant cross-view shortcut controls

Problem Statement
QC Album view and Playlists include cross-view shortcut buttons that overlap with existing navigation/intent controls, but at least some controls may still represent non-navigation actions.

User/System Impact
Potential UI clutter and control ambiguity; risk of removing useful functional actions if shortcuts are treated uniformly.

Observed Behavior
`Album QC View` appears in Playlists, and `Show in Track QC` appears in Album QC action row; Album QC row also includes `Play Album` and `Add Album to Queue`.

Expected Behavior
Only truly redundant view-switching shortcuts should be removed; non-navigation actions should be evaluated separately.

Evidence

- Playlists toolbar includes `Album QC View` shortcut (`apps/desktop/src/features/play-list/PlayListPanel.tsx:427`).

- Album QC detail actions include `Show in Track QC` (`apps/desktop/src/features/albums/AlbumsPanel.tsx:109`).

- Album QC also includes playback/queue actions (`Play Album`, `Add Album to Queue`) that are operational, not pure navigation (`apps/desktop/src/features/albums/AlbumsPanel.tsx:89`).

- Workspace already exposes QC intent selector tabs (`Track QC` / `Album QC`) (`apps/desktop/src/features/workspace/WorkspaceRuntime.tsx:1694`).

Hypotheses

- `Album QC View` and `Show in Track QC` are likely redundant with primary QC navigation controls.

- Triage note may overreach by grouping operational actions with navigation shortcuts.

Unknowns / Missing Evidence

- Product intent for keeping operational album actions in the Album QC detail card.

- Whether users rely on cross-view shortcuts for speed workflows.

- Accessibility/navigation cost if shortcuts are removed.

Classification

Severity
Low

Type
UX consistency and control taxonomy

Surface Area
Frontend QC and Playlists UI

Ownership Suggestion

Primary Module
QC workspace and playlist action surfaces

Primary Directory
apps/desktop/src/features

Likely Files

apps/desktop/src/features/play-list/PlayListPanel.tsx

apps/desktop/src/features/albums/AlbumsPanel.tsx

apps/desktop/src/features/workspace/WorkspaceRuntime.tsx

Likely Functions / Entry Points

PlayListPanel toolbar action render

AlbumsPanel track-detail action render

Quality control intent selector render

Investigation Scope
Differentiate navigation shortcuts from operational controls, then decide removal candidates with minimal UX regression risk. Keep out of scope any redesign of album playback behavior.

Suggested First Investigation Steps

- Classify each disputed button as navigation, operation, or mixed.

- Validate overlap against existing QC intent/navigation pathways.

- Confirm product decision on which controls are explicitly redundant.

- Review tests that assert disputed controls and note expected behavior changes.

Exit Criteria for Investigation

- A control-by-control keep/remove decision is documented with rationale.

- Redundant-only removal scope is bounded for implementation.

Priority Recommendation
Later

Confidence
High

Tags

quality-control

playlists

ux-cleanup
