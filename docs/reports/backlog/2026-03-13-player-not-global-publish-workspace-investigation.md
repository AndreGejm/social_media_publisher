BACKLOG INVESTIGATION TICKET

Title
Shared bottom player is gated to Listen mode and not global in Publish workspace

Problem Statement
The persistent bottom player is currently conditionally rendered only in Listen mode, so it is absent in Publish workspace despite expectation that it should be globally available.

User/System Impact
Users lose persistent transport visibility and playback control context when switching to Publish, breaking continuity of the "global player" mental model.

Observed Behavior
Bottom player is visible in Listen-mode workspaces and hidden in Publish workspace.

Expected Behavior
Bottom player should remain globally visible (or behavior should be explicitly defined) across both Listen and Publish surfaces.

Evidence

- `SharedPlayerBar` render block is wrapped in `activeMode === "Listen"` condition (`apps/desktop/src/features/workspace/WorkspaceRuntime.tsx:1968`).

- Publish workspace host (`PublisherOps`) is rendered separately in main content (`apps/desktop/src/features/workspace/WorkspaceRuntime.tsx:1953`).

- The player is mounted under `music-main` content block rather than mode-agnostic root-level composition, reinforcing mode coupling (`apps/desktop/src/features/workspace/WorkspaceRuntime.tsx:1619`, `apps/desktop/src/features/workspace/WorkspaceRuntime.tsx:1968`).

Hypotheses

- Original product intent likely scoped shared transport to Release Preview/Listen workflows only.

- Recent UX expectation changed toward a truly global player, but render guard was not updated.

Unknowns / Missing Evidence

- Product decision on whether global player in Publish is required vs intentionally hidden.

- If shown in Publish, which controls should remain active (full transport vs limited context).

- Interaction expectations with PublisherOps embedded shared transport bridge.

Classification

Severity
Medium

Type
Navigation/layout behavior mismatch

Surface Area
Frontend workspace shell and transport visibility

Ownership Suggestion

Primary Module
Workspace runtime shell composition

Primary Directory
apps/desktop/src/features/workspace

Likely Files

apps/desktop/src/features/workspace/WorkspaceRuntime.tsx

apps/desktop/src/features/player/SharedPlayerBar.tsx

apps/desktop/src/features/publisher-ops/PublisherOpsWorkspace.tsx

Likely Functions / Entry Points

WorkspaceRuntime conditional SharedPlayerBar render

PublisherOps shared transport integration boundary

Investigation Scope
Confirm product intent for global transport visibility across modes and evaluate the minimal composition boundary changes needed to support that intent. Keep out of scope transport engine behavior changes unless visibility rules depend on them.

Suggested First Investigation Steps

- Validate requirement with product: global player in Publish required or not.

- Trace existing mode guards around player render and related controls.

- Identify conflicts between global player UI and PublisherOps-specific transport surfaces.

- Define acceptance states for player visibility and control availability per mode/workspace.

Exit Criteria for Investigation

- Visibility requirement for shared player across modes is explicitly documented.

- Concrete render/state boundaries to change are identified for implementation follow-up.

Priority Recommendation
Soon

Confidence
High

Tags

global-player

publish-workspace

workspace-shell
