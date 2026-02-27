#!/bin/bash
set -euo pipefail
LOG_FILE="$(dirname "$0")/git_op.log"
COMMIT_MSG="${1:-}"

if [[ -z "$COMMIT_MSG" ]]; then
    echo "ERROR [commit]: Commit message argument is required." >&2
    exit 1
fi

git add .
git commit -m "$COMMIT_MSG" || { echo "ERROR [commit]: Nothing to commit."; exit 1; }

echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') | COMMIT | Msg: $COMMIT_MSG | Status: SUCCESS" >> "$LOG_FILE"
echo "SUCCESS: Changes committed locally."
