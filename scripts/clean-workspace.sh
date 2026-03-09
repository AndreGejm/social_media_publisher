#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

remove_entry() {
  local path="$1"
  [[ -e "$path" ]] || return 0
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] remove $path"
    return 0
  fi
  rm -rf "$path"
  echo "removed $path"
}

direct_paths=(
  "node_modules"
  "apps/desktop/node_modules"
  "target"
  "apps/desktop/dist"
  "playwright-report"
  "playwright-report-runtime"
  "test-results"
  "test-results-runtime2"
  ".runtime-e2e-temp"
  ".agent-tmp"
  "tmp_perm_dir"
  "build/artifacts_test"
  "scripts/windows/logs"
  "artifacts/windows"
)

for p in "${direct_paths[@]}"; do
  remove_entry "$p"
done

shopt -s nullglob
for p in _tmp_*; do
  remove_entry "$p"
done

for p in target-* target_agent* target-agent* target-clippy* _push_workspace*; do
  [[ -e "$p" ]] && remove_entry "$p"
done

for p in apps/desktop/target-*; do
  [[ -e "$p" ]] && remove_entry "$p"
done

for p in apps/desktop/src-tauri/.tmp-*; do
  [[ -e "$p" ]] && remove_entry "$p"
done
shopt -u nullglob

if [[ -d "archives" ]]; then
  while IFS= read -r -d '' d; do
    base="$(basename "$d")"
    case "$base" in
      node_modules|dist|target|build|.cache|.turbo|.vite|test-results|playwright-report)
        remove_entry "$d"
        ;;
      target-*|.tmp-*)
        remove_entry "$d"
        ;;
    esac
  done < <(find archives -type d -print0 | sort -rz)
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] cleanup scan complete"
else
  echo "cleanup complete"
fi



