#!/bin/bash
set -euo pipefail
LOG_FILE="$(dirname "$0")/git_op.log"
git rev-parse --is-inside-work-tree > /dev/null

CURRENT_BRANCH="$(git branch --show-current)"
if [[ "$CURRENT_BRANCH" == "main" || "$CURRENT_BRANCH" == "master" ]]; then
    echo "ERROR [sync-main]: Already on main branch. Use pull.sh instead." >&2
    exit 1
fi

git fetch origin main

if ! git rebase origin/main; then
    echo "ERROR [sync-main]: Rebase conflict detected with origin/main. Aborting rebase." >&2
    git rebase --abort
    echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') | SYNC_MAIN | Branch: $CURRENT_BRANCH | Status: CONFLICT_ABORTED" >> "$LOG_FILE"
    exit 1
fi

echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') | SYNC_MAIN | Branch: $CURRENT_BRANCH | Status: SUCCESS" >> "$LOG_FILE"
echo "SUCCESS: $CURRENT_BRANCH synchronized with origin/main."
