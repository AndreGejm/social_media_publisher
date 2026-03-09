# Video Render Pre-Installer Readiness Checklist

Use this checklist before generating an installer build for the video workspace pipeline.

## 1. Automated gate

Run one of:

- Windows PowerShell:
  - `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/video-render-preinstaller-smoke.ps1`
- Bash:
  - `./scripts/video-render-preinstaller-smoke.sh`

Expected result:

- typecheck, lint, tests, and build complete successfully
- Rust backend tests complete successfully
- ffmpeg integration test either:
  - passes with ffmpeg available, or
  - cleanly skips when ffmpeg is intentionally unavailable in that environment

## 2. Bundled ffmpeg packaging checks

- Confirm at least one pinned ffmpeg binary is present for installer packaging, e.g.:
  - `apps/desktop/src-tauri/resources/ffmpeg/win32/ffmpeg.exe`
- Confirm Tauri bundle resource glob includes ffmpeg assets:
  - `apps/desktop/src-tauri/tauri.conf.json`
  - `bundle.resources` includes `resources/ffmpeg/**/*`
- If no bundled ffmpeg binary is present, decide explicitly whether installer relies on PATH ffmpeg (not recommended for production installer builds).

## 3. Runtime diagnostics checks (manual)

In Video Workspace:

- set a valid output directory
- click `Refresh Diagnostics`
- confirm diagnostics state updates and is not stale
- if diagnostics fail, confirm render is blocked with a clear error

## 4. Source relink checks (manual)

- save a project snapshot with valid image + audio
- move or rename one source file outside the app
- load the project snapshot
- confirm missing-source prompt appears and user is asked to re-link media
- confirm selecting a replacement file clears the missing-source prompt

## 5. Render and completion checks (manual)

- run a successful render from valid media
- confirm status transitions reach `Succeeded`
- confirm success summary shows output path/size
- click `Open Output Folder` and confirm expected directory opens

## 6. Failure-path checks (manual)

- simulate unavailable ffmpeg or invalid output path
- confirm failure is surfaced with actionable message
- confirm app remains usable for retry without restart

## 7. Release decision

Only generate installer when all items above pass for the target environment and target ffmpeg packaging strategy.
