#!/bin/bash
set -euo pipefail
LOG_FILE="$(dirname "$0")/git_op.log"
git rev-parse --is-inside-work-tree > /dev/null

SUFFIX="${1:-}"
if [[ -z "$SUFFIX" ]]; then
    echo "ERROR [branch-exp]: Suffix argument required." >&2
    exit 1
fi

DATE=$(date +%Y%m%d)
BRANCH_NAME="exp/${DATE}-${SUFFIX}"

if git rev-parse --verify "$BRANCH_NAME" >/dev/null 2>&1; then
    echo "ERROR [branch-exp]: Branch $BRANCH_NAME already exists." >&2
    exit 1
fi

git checkout -b "$BRANCH_NAME"
echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') | BRANCH | New: $BRANCH_NAME | Status: SUCCESS" >> "$LOG_FILE"
echo "SUCCESS: Active branch is now $BRANCH_NAME."
