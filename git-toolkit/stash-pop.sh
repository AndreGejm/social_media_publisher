#!/bin/bash
set -euo pipefail
LOG_FILE="$(dirname "$0")/git_op.log"

if ! git stash pop; then
    echo "ERROR [stash-pop]: Conflict during stash pop. Stash remains intact, but working tree requires manual resolution." >&2
    echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') | STASH_POP | Status: CONFLICT" >> "$LOG_FILE"
    exit 1
fi

echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') | STASH_POP | Status: SUCCESS" >> "$LOG_FILE"
echo "SUCCESS: Stash applied and dropped."
