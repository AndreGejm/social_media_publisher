#!/bin/bash
set -euo pipefail
LOG_FILE="$(git rev-parse --git-dir)/git-toolkit-op.log"
git rev-parse --is-inside-work-tree > /dev/null

BRANCH="$(git branch --show-current)"

if ! git pull --rebase origin "$BRANCH"; then
    echo "ERROR [pull]: Rebase conflict detected. Manual intervention required. Aborting rebase." >&2
    git rebase --abort
    echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') | PULL | Branch: $BRANCH | Status: CONFLICT_ABORTED" >> "$LOG_FILE"
    exit 1
fi

echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') | PULL | Branch: $BRANCH | Status: SUCCESS" >> "$LOG_FILE"
echo "SUCCESS: Branch $BRANCH is up to date."
