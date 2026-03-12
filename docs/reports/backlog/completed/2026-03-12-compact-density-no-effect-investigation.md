BACKLOG INVESTIGATION TICKET

Title
Compact density toggle has limited or imperceptible UI effect

Problem Statement
The Compact density setting is persisted and applied at shell level, but visible density changes appear limited to a narrow subset of selectors, making the feature seem non-functional.

User/System Impact
Users cannot reliably perceive a benefit from the setting and may lose trust in preferences behavior.

Observed Behavior
Toggling Compact density often shows little or no visible change.

Expected Behavior
Compact density should produce clear, consistent reductions in spacing/sizing across intended list/control surfaces.

Evidence

- Compact density state is persisted and wired to shell class toggling (`apps/desktop/src/features/workspace/WorkspaceRuntime.tsx:312`, `apps/desktop/src/features/workspace/WorkspaceRuntime.tsx:1555`).

- Compact CSS rules currently target only nav/list row classes and list-shell gap (`apps/desktop/src/styles.css:2778`, `apps/desktop/src/styles.css:2785`).

- Setting label promises denser lists and controls (`apps/desktop/src/features/settings/SettingsPanel.tsx:148`).

- No explicit compact selectors are present for many high-visibility surfaces (e.g., topbar cards, library hero blocks), making effect context-dependent.

Hypotheses

- Scope of compact selectors is too narrow relative to user expectation and settings copy.

- Users testing primarily in Library/overview surfaces encounter almost no compact-targeted elements.

Unknowns / Missing Evidence

- Product definition of which components must respond to compact mode.

- Quantitative density targets (spacing/font-size deltas) for acceptance.

- Whether behavior differs by workspace or layout tier.

Classification

Severity
Medium

Type
Settings behavior / UX mismatch

Surface Area
Frontend shell layout and styles

Ownership Suggestion

Primary Module
Workspace shell density mode

Primary Directory
apps/desktop/src

Likely Files

apps/desktop/src/features/workspace/WorkspaceRuntime.tsx

apps/desktop/src/features/settings/SettingsPanel.tsx

apps/desktop/src/styles.css

Likely Functions / Entry Points

compactDensity state wiring

music-shell compact class selectors

Investigation Scope
Validate whether compact density is functioning as implemented but under-scoped, or failing to target intended surfaces. Keep out of scope any redesign of unrelated theming or responsive layout.

Suggested First Investigation Steps

- Capture before/after screenshots for each workspace with compact mode on/off.

- Map all `.music-shell.compact` selectors to rendered DOM surfaces.

- Compare current selector coverage against setting promise text and UX expectation.

- Define a minimal acceptance checklist for visible compact deltas per workspace.

Exit Criteria for Investigation

- A coverage map shows exactly where compact mode applies and where it does not.

- Requirement-aligned list of missing compact targets is documented.

Priority Recommendation
Soon

Confidence
High

Tags

settings

layout-density

frontend
