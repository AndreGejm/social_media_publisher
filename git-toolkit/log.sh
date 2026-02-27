#!/bin/bash
set -euo pipefail
COUNT="${1:-5}"

if ! [[ "$COUNT" =~ ^[0-9]+$ ]]; then
    echo "ERROR [log]: Count must be an integer." >&2
    exit 1
fi

git log -n "$COUNT" --oneline
