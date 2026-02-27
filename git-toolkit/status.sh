#!/bin/bash
set -euo pipefail
git rev-parse --is-inside-work-tree > /dev/null
echo "Branch: $(git branch --show-current)"
git status --short
