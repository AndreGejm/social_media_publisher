#!/bin/bash
set -euo pipefail
LOG_FILE="$(git rev-parse --git-dir)/git-toolkit-op.log"
SOURCE="${1:-}"

if [[ -z "$SOURCE" ]]; then
    echo "ERROR [merge]: Source branch argument required." >&2
    exit 1
fi

if ! git merge "$SOURCE"; then
    echo "ERROR [merge]: Conflict detected. Aborting merge automatically to preserve state." >&2
    git merge --abort
    echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') | MERGE | Source: $SOURCE | Status: CONFLICT_ABORTED" >> "$LOG_FILE"
    exit 1
fi

echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') | MERGE | Source: $SOURCE | Status: SUCCESS" >> "$LOG_FILE"
echo "SUCCESS: Merged $SOURCE cleanly."
