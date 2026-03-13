TRIAGE NOTE

Title
Player not global in Publish workspace

Bug Report Summary
Request to investigate a case where the player is not global/visible in Publish workspace.

Observed Behavior
Unknown (needs report details).

Expected Behavior
Player should remain global/visible across workspaces including Publish.

Severity
Unknown

Bug Type
Unknown

Surface Area
Frontend

Initial Root-Cause Hypothesis
Low-confidence: workspace layout or visibility rules hide the shared player in Publish workspace.

Likely Investigation Start Points

Module
Workspace shell / shared player container

Directory
apps/desktop/src/app/shell

Candidate Files

apps/desktop/src/app/shell/WorkspaceApp.tsx

apps/desktop/src/features/workspace/WorkspaceRuntime.tsx

Candidate Functions

Unknown

Evidence Used

Filename-only request: 2026-03-13-player-not-global-publish-workspace-investigation.md

Missing Information

Repro steps

What “not global” means (hidden, disabled, not persistent, layout shift)

Screenshots or logs

Severity and frequency

Triage Confidence
Low

Recommended Next Step
Collect minimal repro details and confirm whether shared player should be visible in Publish workspace by design.