#!/usr/bin/env bash
set -euo pipefail

skip_boundary_check="false"
skip_frontend="false"
skip_rust="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-boundary-check)
      skip_boundary_check="true"
      ;;
    --skip-frontend)
      skip_frontend="true"
      ;;
    --skip-rust)
      skip_rust="true"
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
  shift
done

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

echo "[video-preinstaller-smoke] repo root: $repo_root"

bundled_found=0
for candidate in \
  "apps/desktop/src-tauri/resources/ffmpeg/win32/ffmpeg" \
  "apps/desktop/src-tauri/resources/ffmpeg/win32/ffmpeg.exe" \
  "apps/desktop/src-tauri/resources/ffmpeg/linux/ffmpeg" \
  "apps/desktop/src-tauri/resources/ffmpeg/macos/ffmpeg"; do
  if [[ -f "$candidate" ]]; then
    echo "[video-preinstaller-smoke] bundled ffmpeg candidate: $candidate"
    bundled_found=1
  fi
done

if [[ "$bundled_found" -eq 0 ]]; then
  echo "[video-preinstaller-smoke] WARNING: no bundled ffmpeg executable found under apps/desktop/src-tauri/resources/ffmpeg." >&2
  echo "[video-preinstaller-smoke] WARNING: runtime can still use PATH ffmpeg, but installer validation should bundle a pinned ffmpeg binary." >&2
fi

run_cmd() {
  "$@"
}

run_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    pnpm "$@"
    return
  fi

  corepack pnpm "$@"
}

if [[ "$skip_boundary_check" != "true" && -f "scripts/check-boundaries.sh" ]]; then
  run_cmd bash scripts/check-boundaries.sh
fi

if [[ "$skip_frontend" != "true" ]]; then
  run_pnpm typecheck
  run_pnpm lint
  run_pnpm --filter @release-publisher/desktop test -- --run
  run_pnpm build
fi

if [[ "$skip_rust" != "true" ]]; then
  run_cmd cargo test -p release-publisher-desktop --lib
  run_cmd cargo test -p release-publisher-desktop backend_video_render_service::runtime::tests::ffmpeg_runner_integration_renders_mp4_when_ffmpeg_available -- --nocapture
fi

echo "[video-preinstaller-smoke] automated checks completed"
echo "[video-preinstaller-smoke] continue with manual checklist: docs/video-workspace/PREINSTALLER_READINESS_CHECKLIST.md"
