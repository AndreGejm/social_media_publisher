#!/bin/bash
set -euo pipefail
LOG_FILE="$(dirname "$0")/git_op.log"

COMMIT_MSG="${1:-}"
if [[ -z "$COMMIT_MSG" ]]; then
    echo "ERROR [push]: Commit message argument is required." >&2
    exit 1
fi

git rev-parse --is-inside-work-tree > /dev/null
BRANCH="$(git branch --show-current)"

git add .
git commit -m "$COMMIT_MSG" || { echo "ERROR [push]: Commit failed or nothing to commit."; exit 1; }
git push origin "$BRANCH" || { echo "ERROR [push]: Push failed."; exit 1; }

echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') | PUSH | Branch: $BRANCH | Msg: $COMMIT_MSG | Status: SUCCESS" >> "$LOG_FILE"
echo "SUCCESS: Changes pushed to $BRANCH."
