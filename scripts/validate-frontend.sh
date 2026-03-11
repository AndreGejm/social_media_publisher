#!/usr/bin/env bash
set -euo pipefail

show_usage() {
  cat << 'USAGE'
Usage: ./scripts/validate-frontend.sh [--install] [--skip-boundary-check] [--skip-build]
USAGE
}

install="false"
skip_boundary_check="false"
skip_build="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install)
      install="true"
      ;;
    --skip-boundary-check)
      skip_boundary_check="true"
      ;;
    --skip-build)
      skip_build="true"
      ;;
    -h|--help)
      show_usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      show_usage
      exit 1
      ;;
  esac
  shift
done

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

echo "[validate-frontend] repo root: $repo_root"

run_cmd() {
  "$@"
}

run_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    pnpm "$@"
    return
  fi

  if command -v corepack >/dev/null 2>&1; then
    corepack pnpm "$@"
    return
  fi

  echo "pnpm or corepack must be available to run frontend validation" >&2
  exit 1
}

if [[ "$install" == "true" ]]; then
  run_pnpm install
fi

if [[ "$skip_boundary_check" != "true" && -f "scripts/check-boundaries.sh" ]]; then
  run_cmd bash scripts/check-boundaries.sh
fi

run_pnpm typecheck
run_pnpm lint
run_pnpm --filter @release-publisher/desktop test -- --run

if [[ "$skip_build" != "true" ]]; then
  run_pnpm build
fi

echo "[validate-frontend] completed"
