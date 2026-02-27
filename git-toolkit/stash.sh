#!/bin/bash
set -euo pipefail
LOG_FILE="$(dirname "$0")/git_op.log"

git stash push -m "AI Agent Auto-stash"
echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') | STASH | Status: SUCCESS" >> "$LOG_FILE"
echo "SUCCESS: Working tree stashed."
