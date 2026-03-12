BACKLOG INVESTIGATION TICKET

Title
Video Workspace navigation placement conflicts with mode-level grouping expectation

Problem Statement
Video Workspace is currently rendered as a sidebar workspace entry, while requested UX groups it with mode-level navigation (alongside Release Preview/Publish concepts).

User/System Impact
Navigation model may feel inconsistent, increasing cognitive load for workspace switching.

Observed Behavior
Video Workspace appears in sidebar workspace list as a peer of Library, Quality Control, and Playlists.

Expected Behavior
Video Workspace should be grouped according to mode-level navigation intent rather than standard sidebar workspace placement.

Evidence

- Listen-mode workspace list includes `"Video Workspace"` (`apps/desktop/src/features/workspace/WorkspaceRuntime.tsx:103`).

- Sidebar navigation renders `[...modeWorkspaces, ...globalWorkspaces]` directly (`apps/desktop/src/features/workspace/WorkspaceRuntime.tsx:1567`).

- Mode-state hook only controls allowed workspace sets; it does not provide separate grouping model (`apps/desktop/src/features/workspace/hooks/useWorkspaceModeState.ts:26`).

Hypotheses

- Current architecture treats all non-global destinations as sidebar workspaces, with no intermediate "mode-level subgroup" concept.

- Requested grouping likely requires navigation IA changes, not just label relocation.

Unknowns / Missing Evidence

- Exact target interaction pattern for mode-level grouping (tab, segmented control, or grouped sidebar section).

- Whether Video Workspace should remain Listen-only under the new grouping.

- Accessibility expectations for the new grouping semantics.

Classification

Severity
Low

Type
Navigation/IA enhancement

Surface Area
Frontend workspace navigation model

Ownership Suggestion

Primary Module
Workspace mode and navigation rendering

Primary Directory
apps/desktop/src/features/workspace

Likely Files

apps/desktop/src/features/workspace/WorkspaceRuntime.tsx

apps/desktop/src/features/workspace/hooks/useWorkspaceModeState.ts

apps/desktop/src/features/workspace/components/MusicTopbar.tsx

Likely Functions / Entry Points

modeWorkspaces derivation

sidebar workspace nav render loop

switchAppMode

Investigation Scope
Define the exact IA target for Video Workspace placement and identify minimal navigation-state changes required to support it. Keep out of scope any unrelated workspace feature behavior.

Suggested First Investigation Steps

- Capture current navigation state machine (mode vs workspace) and identify insertion points for grouping.

- Produce one concrete UX mapping of current vs requested grouping behavior.

- Validate mode constraints (Listen/Publish) for Video Workspace under proposed grouping.

- Audit existing navigation tests for assumptions tied to sidebar placement.

Exit Criteria for Investigation

- A precise target navigation behavior is documented with acceptance scenarios.

- Required state/render touchpoints are identified without implementation detail.

Priority Recommendation
Later

Confidence
High

Tags

navigation

video-workspace

information-architecture
