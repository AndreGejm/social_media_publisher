BACKLOG INVESTIGATION TICKET

Title
Library summary duplication and action placement mismatch in workspace layout

Problem Statement
Library information and actions are split across topbar, main pane, and ingest sidebar, resulting in duplicated summary stats and unclear action locality.

User/System Impact
Users face unnecessary visual noise and may need extra navigation/context switching for common library actions.

Observed Behavior
Track/album/favorite/queue counts appear both in topbar pills and Library hero cards; ingest/import actions live in sidebar while main pane carries summary content.

Expected Behavior
Library summary should have a single authoritative presentation, and action placement should follow agreed information architecture.

Evidence

- Topbar summary pills render tracks/albums/favorites/queue counts (`apps/desktop/src/features/workspace/components/MusicTopbar.tsx:72`).

- Library Home also renders hero summary cards with overlapping counts (`apps/desktop/src/features/workspace/components/LibraryHomeSection.tsx:47`).

- Library ingest/import actions are located in sidebar panel (`apps/desktop/src/features/library-ingest/LibraryIngestSidebar.tsx:45`).

- Workspace runtime composes all three surfaces together for Library mode (`apps/desktop/src/features/workspace/WorkspaceRuntime.tsx:1620`, `apps/desktop/src/features/workspace/WorkspaceRuntime.tsx:1671`, `apps/desktop/src/features/workspace/WorkspaceRuntime.tsx:1588`).

Hypotheses

- Incremental UI evolution introduced duplicate summary blocks without a single ownership decision.

- Action placement reflects technical grouping (ingest subsystem) rather than primary user workflow in Library pane.

Unknowns / Missing Evidence

- Product-approved IA for which summary surface is canonical (topbar vs main pane).

- Whether sidebar ingest actions must remain always visible for operational reasons.

- Mobile/small-screen behavior expectations if actions are moved.

Classification

Severity
Low

Type
UX information architecture

Surface Area
Frontend library workspace composition

Ownership Suggestion

Primary Module
Library workspace shell composition

Primary Directory
apps/desktop/src/features/workspace

Likely Files

apps/desktop/src/features/workspace/components/MusicTopbar.tsx

apps/desktop/src/features/workspace/components/LibraryHomeSection.tsx

apps/desktop/src/features/library-ingest/LibraryIngestSidebar.tsx

Likely Functions / Entry Points

LibraryHomeSection render sections

MusicTopbar summary render branch

WorkspaceRuntime library surface composition

Investigation Scope
Establish a canonical ownership model for Library summary data and action placement, then identify which current surfaces are redundant. Keep out of scope any redesign of ingest backend behavior.

Suggested First Investigation Steps

- Inventory all Library summary metrics and where each appears.

- Map all Library actions by location and user intent (navigation vs operation).

- Confirm IA decision for canonical summary location and action placement.

- Identify test assertions currently coupled to existing duplicate surfaces.

Exit Criteria for Investigation

- A non-ambiguous target IA for summary and action placement is documented.

- Redundant surfaces are explicitly identified for implementation follow-up.

Priority Recommendation
Later

Confidence
High

Tags

library

layout

information-architecture
