#!/bin/bash
set -euo pipefail
LOG_FILE="$(git rev-parse --git-dir)/git-toolkit-op.log"

git rev-parse --is-inside-work-tree > /dev/null
BRANCH="$(git branch --show-current)"

git push origin "$BRANCH" || { echo "ERROR [publish]: Push failed."; exit 1; }

echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') | PUBLISH | Branch: $BRANCH | Status: SUCCESS" >> "$LOG_FILE"
echo "SUCCESS: Branch $BRANCH pushed."
