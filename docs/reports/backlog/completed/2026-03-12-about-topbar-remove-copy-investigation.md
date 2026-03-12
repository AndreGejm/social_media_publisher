BACKLOG INVESTIGATION TICKET

Title
About workspace topbar contains redundant informational copy

Problem Statement
About workspace currently shows both subtitle text and an informational banner copy that were requested to be removed as redundant.

User/System Impact
Minor UX clutter in About view; reduced information clarity.

Observed Behavior
About topbar shows "Informational workspace" pill, mode-independence sentence, and About subtitle copy.

Expected Behavior
Redundant About-specific topbar copy should be removed per product direction.

Evidence

- About subtitle text is hard-coded in `MusicTopbar` when `activeWorkspace === "About"` (`apps/desktop/src/features/workspace/components/MusicTopbar.tsx:46`).

- About guidance banner and "Informational workspace" pill are hard-coded in About branch (`apps/desktop/src/features/workspace/components/MusicTopbar.tsx:65`).

- Triage request specifically targets these About-only strings.

Hypotheses

- About copy was intentionally added for onboarding/support context and is now no longer desired.

- Removal is isolated to topbar content and should not require routing/state changes.

Unknowns / Missing Evidence

- Whether any About copy must remain for support workflows/compliance.

- Final approved copy baseline for About workspace after removal.

Classification

Severity
Low

Type
Content/UX cleanup

Surface Area
Frontend workspace topbar

Ownership Suggestion

Primary Module
Workspace topbar content rendering

Primary Directory
apps/desktop/src/features/workspace/components

Likely Files

apps/desktop/src/features/workspace/components/MusicTopbar.tsx

apps/desktop/src/features/workspace/components/MusicTopbar.test.tsx

Likely Functions / Entry Points

MusicTopbar render branches for About workspace

Investigation Scope
Confirm exact copy elements to remove from About topbar and validate no dependency on those strings in tests or support flows. Keep out of scope broader topbar redesign.

Suggested First Investigation Steps

- Enumerate About-specific topbar elements currently rendered.

- Confirm intended remaining content with product owner.

- Identify tests asserting About copy and update investigation notes accordingly.

- Validate that removing text does not affect accessibility labels unexpectedly.

Exit Criteria for Investigation

- Exact About topbar content delta is documented and approved.

- Impacted component and tests are identified for implementation follow-up.

Priority Recommendation
Later

Confidence
High

Tags

about-workspace

content

topbar
