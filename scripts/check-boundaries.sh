#!/usr/bin/env bash
set -euo pipefail

violations=0

run_check() {
  local name="$1"
  shift

  if output=$(rg --line-number --glob '*.ts' --glob '*.tsx' "$@" 2>&1); then
    echo "[FAIL] ${name}"
    echo "$output"
    violations=$((violations + 1))
  else
    code=$?
    if [ "$code" -eq 1 ]; then
      echo "[PASS] ${name}"
    else
      echo "[ERROR] ${name}"
      echo "$output"
      exit "$code"
    fi
  fi
}

run_check "No raw @tauri-apps/api imports outside adapters" \
  --glob '!apps/desktop/src/services/tauri/**' \
  --glob '!apps/desktop/src/infrastructure/tauri/**' \
  --glob '!**/*.test.ts' \
  --glob '!**/*.test.tsx' \
  '@tauri-apps/api' \
  apps/desktop/src

run_check "player-transport must not import audio-output internals" \
  'features/audio-output/(hooks|model|services|components)/' \
  apps/desktop/src/features/player-transport

run_check "audio-output must not import player-transport internals" \
  'features/player-transport/(hooks|model|services|components)/' \
  apps/desktop/src/features/audio-output

run_check "app shell must not deep-import feature internals" \
  --glob '!**/*.test.ts' \
  --glob '!**/*.test.tsx' \
  'features/.+/(hooks|model|services|components)/' \
  apps/desktop/src/app/shell

if [ "$violations" -gt 0 ]; then
  echo "Boundary checks failed with ${violations} violation set(s)."
  exit 1
fi

echo "Boundary checks passed."
