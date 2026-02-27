#!/bin/bash
set -euo pipefail
LOG_FILE="$(dirname "$0")/git_op.log"
TARGET="${1:-}"

if [[ -z "$TARGET" ]]; then
    echo "ERROR [checkout]: Target branch argument required." >&2
    exit 1
fi

if ! git diff-index --quiet HEAD --; then
    echo "ERROR [checkout]: Working tree is dirty. Commit or stash changes first." >&2
    exit 1
fi

if ! git rev-parse --verify "$TARGET" >/dev/null 2>&1; then
    echo "ERROR [checkout]: Branch '$TARGET' does not exist." >&2
    exit 1
fi

git checkout "$TARGET"
echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') | CHECKOUT | Target: $TARGET | Status: SUCCESS" >> "$LOG_FILE"
echo "SUCCESS: Switched to $TARGET"
