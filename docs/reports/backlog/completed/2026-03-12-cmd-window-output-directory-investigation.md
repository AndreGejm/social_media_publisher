BACKLOG INVESTIGATION TICKET

Title
Output directory input triggers repeated Windows console flashes during diagnostics refresh

Problem Statement
Typing into the Video Workspace output directory field appears to trigger backend environment diagnostics repeatedly, causing visible black CMD flashes on Windows.

User/System Impact
Users see disruptive console-window flashes while typing, which degrades confidence in the app and makes output-path entry high-friction.

Observed Behavior
A console window flashes on each keystroke in the Output directory field.

Expected Behavior
Output directory text entry should not spawn visible console windows and should feel uninterrupted.

Evidence

- `VideoWorkspaceFeature` updates output path on every `onChange` keystroke (`apps/desktop/src/features/video-workspace/VideoWorkspaceFeature.tsx:1043`).

- `refreshDiagnostics` depends on `buildInput.outputSettings.outputDirectoryPath`, so callback identity changes whenever the path changes (`apps/desktop/src/features/video-workspace/hooks/useVideoWorkspaceRenderController.ts:151`).

- A `useEffect` calls `refreshDiagnostics` whenever that callback changes (`apps/desktop/src/features/video-workspace/VideoWorkspaceFeature.tsx:519`).

- Backend diagnostics call FFmpeg via `Command::new(path).arg("-version").output()` (`apps/desktop/src-tauri/src/commands/backend_video_render_service/runtime.rs:809`).

Hypotheses

- Diagnostics are being re-run per keystroke due to callback dependency churn, producing repeated process launches.

- On Windows, FFmpeg/process spawn behavior is surfacing a visible console window for diagnostics probes.

Unknowns / Missing Evidence

- Which exact spawned process causes the visible window (`ffmpeg -version` vs another probe path).

- Whether behavior differs between dev runtime and packaged release build.

- Measured diagnostics call frequency while typing (trace-level confirmation).

Classification

Severity
Medium

Type
Behavioral bug (UI/runtime interaction)

Surface Area
Frontend (Video Workspace) + Tauri Windows runtime

Ownership Suggestion

Primary Module
Video workspace render diagnostics

Primary Directory
apps/desktop/src/features/video-workspace

Likely Files

apps/desktop/src/features/video-workspace/VideoWorkspaceFeature.tsx

apps/desktop/src/features/video-workspace/hooks/useVideoWorkspaceRenderController.ts

apps/desktop/src-tauri/src/commands/backend_video_render_service/runtime.rs

Likely Functions / Entry Points

refreshDiagnostics

video_render_get_environment_diagnostics

read_ffmpeg_version

Investigation Scope
Validate whether diagnostics are fired on each output-path keystroke and identify the exact process spawn path that creates the console window on Windows. Keep scope limited to trigger cadence and process-launch characteristics; do not redesign render diagnostics architecture.

Suggested First Investigation Steps

- Add temporary logging around `refreshDiagnostics` call sites to count invocations during text input.

- Trace backend command invocations in `video_render_get_environment_diagnostics` and `read_ffmpeg_version` on Windows.

- Reproduce in both development and packaged builds to isolate environment-specific behavior.

- Confirm whether deferring diagnostics trigger timing removes console flashing without changing unrelated render flow.

Exit Criteria for Investigation

- Repro path is documented with exact trigger sequence and invocation count.

- The specific process/path causing visible console flashes is identified with evidence.

Priority Recommendation
Soon

Confidence
High

Tags

windows

diagnostics

video-workspace
