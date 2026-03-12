BACKLOG INVESTIGATION TICKET

Title
Library quick-action buttons duplicate existing workspace navigation

Problem Statement
Library Home includes quick-action buttons that route to destinations already available in primary workspace navigation, creating duplicate navigation affordances.

User/System Impact
UI clutter and potential confusion from redundant pathways.

Observed Behavior
Library quick actions show `Open Track QC`, `Open Album QC`, and `Open Publish Workflow` in addition to sidebar/mode navigation.

Expected Behavior
Redundant quick-action shortcuts should be removed or justified by unique behavior.

Evidence

- Library quick-action buttons are rendered in `LibraryHomeSection` (`apps/desktop/src/features/workspace/components/LibraryHomeSection.tsx:83`).

- Sidebar already lists workspaces through nav button loop (`apps/desktop/src/features/workspace/WorkspaceRuntime.tsx:1567`).

- UI control tests currently assert presence and click behavior of these quick-action buttons (`apps/desktop/src/test/ui-controls.spec.tsx:477`).

Hypotheses

- Quick actions are legacy onboarding shortcuts that became redundant as navigation matured.

- Removal likely impacts tests and possibly user flow expectations but not core routing mechanics.

Unknowns / Missing Evidence

- Whether product still wants these shortcuts for first-time discoverability.

- Any telemetry indicating heavy usage of quick actions vs sidebar navigation.

Classification

Severity
Low

Type
UX simplification

Surface Area
Frontend library home workspace

Ownership Suggestion

Primary Module
Library home section and workspace navigation

Primary Directory
apps/desktop/src/features/workspace/components

Likely Files

apps/desktop/src/features/workspace/components/LibraryHomeSection.tsx

apps/desktop/src/features/workspace/WorkspaceRuntime.tsx

apps/desktop/src/test/ui-controls.spec.tsx

Likely Functions / Entry Points

LibraryHomeSection quick action render block

openTracksWorkspace/openAlbumsWorkspace/showPublishMode handlers

Investigation Scope
Confirm whether quick actions are truly redundant from product perspective and document downstream test/UX impacts of removal. Keep out of scope broader library workflow redesign.

Suggested First Investigation Steps

- Compare quick-action destinations against existing sidebar/mode navigation routes.

- Validate whether quick actions add unique side effects beyond navigation.

- Review test coverage tied to quick-action presence.

- Confirm product decision on removal vs conditional visibility.

Exit Criteria for Investigation

- Decision is documented on whether quick actions are retained, removed, or gated.

- Affected components/tests are identified for follow-up implementation.

Priority Recommendation
Later

Confidence
High

Tags

library

navigation

ux-cleanup
