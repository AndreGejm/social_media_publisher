# FFmpeg Bundled Binary Slot

Place platform-specific FFmpeg binaries under this folder for installer builds.

Expected paths:
- `apps/desktop/src-tauri/resources/ffmpeg/win32/ffmpeg.exe`
- `apps/desktop/src-tauri/resources/ffmpeg/windows/ffmpeg.exe`

The runtime resolver checks bundled resource locations first and falls back to PATH only when no bundled binary is found.

Do not commit proprietary or unlicensed FFmpeg binaries.
