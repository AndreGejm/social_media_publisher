#!/bin/bash
set -euo pipefail
LOG_FILE="$(git rev-parse --git-dir)/git-toolkit-op.log"

git reset --soft HEAD~1
echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') | UNDO_SOFT | Target: HEAD~1 | Status: SUCCESS" >> "$LOG_FILE"
echo "SUCCESS: Undid last commit. Changes are preserved in the staging area."
