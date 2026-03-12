BACKLOG INVESTIGATION TICKET

Title
Video preview fit mode appears non-responsive despite fit-mode state changes

Problem Statement
Users report no visible change when switching image fit mode in Video Workspace preview, even though fit mode state wiring exists in preview and render-request paths.

User/System Impact
Video composition controls feel unreliable, reducing confidence in preview fidelity before render.

Observed Behavior
Switching between Fill/Crop, Fit/Bars, and Stretch may not produce noticeable preview change.

Expected Behavior
Preview should visibly reflect selected fit mode for non-matching source aspect ratios.

Evidence

- Fit mode controls update `previewController.fitMode` via radio buttons (`apps/desktop/src/features/video-workspace/VideoWorkspaceFeature.tsx:745`).

- Preview image style uses `objectFit` from fit presentation mapping (`apps/desktop/src/features/video-workspace/VideoWorkspaceFeature.tsx:1135`).

- Fit mode mapping exists for `fill_crop`, `fit_bars`, and `stretch` (`apps/desktop/src/features/video-composition/model/videoPreviewFitMode.ts:1`).

- Render request includes fit mode and backend validates fit mode values (`apps/desktop/src/features/video-workspace/model/videoRenderRequest.ts:195`, `apps/desktop/src-tauri/src/commands/backend_video_render_service/runtime.rs:1916`).

- Existing tests assert deterministic fit-mode updates in preview metadata (`apps/desktop/src/features/video-workspace/VideoWorkspaceFeature.test.tsx:394`).

Hypotheses

- Reported test media likely matches preview aspect ratio closely, making visual differences subtle.

- Preview frame/background treatment may not make `fit_bars` changes obvious for certain image types.

- Potential gap may be perceptual/UX feedback rather than raw state propagation.

Unknowns / Missing Evidence

- Source media dimensions used during repro.

- Whether rendered output differs from preview for the same fit mode.

- Whether issue reproduces consistently across all three modes.

Classification

Severity
Medium

Type
Preview behavior validation gap

Surface Area
Frontend video preview + render request bridge

Ownership Suggestion

Primary Module
Video workspace preview/composition controls

Primary Directory
apps/desktop/src/features/video-workspace

Likely Files

apps/desktop/src/features/video-workspace/VideoWorkspaceFeature.tsx

apps/desktop/src/features/video-workspace/hooks/useVideoWorkspacePreviewController.ts

apps/desktop/src/features/video-composition/model/videoPreviewFitMode.ts

Likely Functions / Entry Points

setFitMode

resolveVideoPreviewFitPresentation

buildVideoRenderRequest

Investigation Scope
Verify whether this is a true propagation bug or a perceptual UX issue by reproducing with known non-16:9 media and comparing preview vs final render behavior. Keep out of scope broader video composition redesign.

Suggested First Investigation Steps

- Reproduce with fixed test images in clearly different aspect ratios (e.g., 1:1 and 9:16).

- Capture preview screenshots for each fit mode with identical source media.

- Compare generated render request payload fitMode values against selected controls.

- Validate rendered output behavior separately from preview behavior.

Exit Criteria for Investigation

- Determination is made: state propagation bug vs perceptual/UX-only issue.

- A reproducible media set and expected visual outcomes are documented.

Priority Recommendation
Unknown

Confidence
Medium

Tags

video-preview

fit-mode

composition
