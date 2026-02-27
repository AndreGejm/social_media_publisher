#!/bin/bash
# Description: Generates a unified, deterministic Git wrapper API for AI agent use.
# Execution: Run once at project root.
set -euo pipefail

GIT_DIR="./git-toolkit"
LOG_FILE="$(git rev-parse --git-dir)/git-toolkit-op.log"

echo "Initializing Unified Git Toolkit in $GIT_DIR..."
mkdir -p "$GIT_DIR"
touch "$LOG_FILE"

# ---------------------------------------------------------
# 1. HELP / API SURFACE MATRIX
# ---------------------------------------------------------
cat << 'EOF' > "$GIT_DIR/help.sh"
#!/bin/bash
set -euo pipefail

cat << 'MATRIX'
=== AI GIT TOOLKIT API MATRIX ===
TYPE       | COMMAND            | INPUT (Type)      | INVARIANT / OUTPUT BEHAVIOR
-----------|--------------------|-------------------|-----------------------------------------------------
MUTATOR    | push.sh            | msg (String)      | Atomic: Stage all -> Commit -> Push. (Exit 0/1)
MUTATOR    | pull.sh            | None              | Atomic: Fetch -> Rebase. Aborts on conflict.
MUTATOR    | commit.sh          | msg (String)      | Atomic: Stage all -> Commit locally. No push.
MUTATOR    | merge.sh           | branch (String)   | Atomic: Merge branch to HEAD. Auto-aborts conflict.
MUTATOR    | stash.sh           | None              | Atomic: Pushes dirty working tree to stash.
MUTATOR    | stash-pop.sh       | None              | Atomic: Applies latest stash. Fails if conflict.
MUTATOR    | undo-soft.sh       | None              | Rollback: Moves HEAD~1. Working tree remains dirty.
LOGIC      | branch-exp.sh      | suffix (String)   | Creates/switches to branch: exp/YYYYMMDD-<suffix>.
LOGIC      | sync-main.sh       | None              | Fetches main -> Rebases current branch against it.
LOGIC      | checkout.sh        | branch (String)   | Switches branch. Fails if working tree is dirty.
INSPECTION | status.sh          | None              | Outputs short status and current branch name.
INSPECTION | log.sh             | [count] (Integer) | Outputs last N commits (Default: 5). Token-capped.
INSPECTION | diff-stat.sh       | None              | Outputs changed files/line counts. Token-capped.

Execution Rules:
1. Always run from project root.
2. Check exit codes ($?). 0 = Success, 1 = Failure/Abort.
3. NEVER use raw 'git' commands. Use this API exclusively.
MATRIX
EOF

# ---------------------------------------------------------
# 2. STATUS (Diagnostic)
# ---------------------------------------------------------
cat << 'EOF' > "$GIT_DIR/status.sh"
#!/bin/bash
set -euo pipefail
git rev-parse --is-inside-work-tree > /dev/null
echo "Branch: $(git branch --show-current)"
git status --short
EOF

# ---------------------------------------------------------
# 3. PUSH (State Mutator)
# ---------------------------------------------------------
cat << 'EOF' > "$GIT_DIR/push.sh"
#!/bin/bash
set -euo pipefail
LOG_FILE="$(git rev-parse --git-dir)/git-toolkit-op.log"

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
EOF

# ---------------------------------------------------------
# 4. PULL (State Mutator)
# ---------------------------------------------------------
cat << 'EOF' > "$GIT_DIR/pull.sh"
#!/bin/bash
set -euo pipefail
LOG_FILE="$(git rev-parse --git-dir)/git-toolkit-op.log"
git rev-parse --is-inside-work-tree > /dev/null

BRANCH="$(git branch --show-current)"

if ! git pull --rebase origin "$BRANCH"; then
    echo "ERROR [pull]: Rebase conflict detected. Manual intervention required. Aborting rebase." >&2
    git rebase --abort
    echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') | PULL | Branch: $BRANCH | Status: CONFLICT_ABORTED" >> "$LOG_FILE"
    exit 1
fi

echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') | PULL | Branch: $BRANCH | Status: SUCCESS" >> "$LOG_FILE"
echo "SUCCESS: Branch $BRANCH is up to date."
EOF

# ---------------------------------------------------------
# 5. BRANCH EXPERIMENTAL (Logic)
# ---------------------------------------------------------
cat << 'EOF' > "$GIT_DIR/branch-exp.sh"
#!/bin/bash
set -euo pipefail
LOG_FILE="$(git rev-parse --git-dir)/git-toolkit-op.log"
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
EOF

# ---------------------------------------------------------
# 6. SYNC MAIN (Logic)
# ---------------------------------------------------------
cat << 'EOF' > "$GIT_DIR/sync-main.sh"
#!/bin/bash
set -euo pipefail
LOG_FILE="$(git rev-parse --git-dir)/git-toolkit-op.log"
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
EOF

# ---------------------------------------------------------
# 7. CHECKOUT (Logic)
# ---------------------------------------------------------
cat << 'EOF' > "$GIT_DIR/checkout.sh"
#!/bin/bash
set -euo pipefail
LOG_FILE="$(git rev-parse --git-dir)/git-toolkit-op.log"
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
EOF

# ---------------------------------------------------------
# 8. COMMIT (State Mutator - No Push)
# ---------------------------------------------------------
cat << 'EOF' > "$GIT_DIR/commit.sh"
#!/bin/bash
set -euo pipefail
LOG_FILE="$(git rev-parse --git-dir)/git-toolkit-op.log"
COMMIT_MSG="${1:-}"

if [[ -z "$COMMIT_MSG" ]]; then
    echo "ERROR [commit]: Commit message argument is required." >&2
    exit 1
fi

git add .
git commit -m "$COMMIT_MSG" || { echo "ERROR [commit]: Nothing to commit."; exit 1; }

echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') | COMMIT | Msg: $COMMIT_MSG | Status: SUCCESS" >> "$LOG_FILE"
echo "SUCCESS: Changes committed locally."
EOF

# ---------------------------------------------------------
# 9. MERGE (State Mutator - Auto-abort)
# ---------------------------------------------------------
cat << 'EOF' > "$GIT_DIR/merge.sh"
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
EOF

# ---------------------------------------------------------
# 10. STASH & STASH-POP (State Mutator)
# ---------------------------------------------------------
cat << 'EOF' > "$GIT_DIR/stash.sh"
#!/bin/bash
set -euo pipefail
LOG_FILE="$(git rev-parse --git-dir)/git-toolkit-op.log"

git stash push -m "AI Agent Auto-stash"
echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') | STASH | Status: SUCCESS" >> "$LOG_FILE"
echo "SUCCESS: Working tree stashed."
EOF

cat << 'EOF' > "$GIT_DIR/stash-pop.sh"
#!/bin/bash
set -euo pipefail
LOG_FILE="$(git rev-parse --git-dir)/git-toolkit-op.log"

if ! git stash pop; then
    echo "ERROR [stash-pop]: Conflict during stash pop. Stash remains intact, but working tree requires manual resolution." >&2
    echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') | STASH_POP | Status: CONFLICT" >> "$LOG_FILE"
    exit 1
fi

echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') | STASH_POP | Status: SUCCESS" >> "$LOG_FILE"
echo "SUCCESS: Stash applied and dropped."
EOF

# ---------------------------------------------------------
# 11. UNDO-SOFT (State Mutator - Safe rollback)
# ---------------------------------------------------------
cat << 'EOF' > "$GIT_DIR/undo-soft.sh"
#!/bin/bash
set -euo pipefail
LOG_FILE="$(git rev-parse --git-dir)/git-toolkit-op.log"

git reset --soft HEAD~1
echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') | UNDO_SOFT | Target: HEAD~1 | Status: SUCCESS" >> "$LOG_FILE"
echo "SUCCESS: Undid last commit. Changes are preserved in the staging area."
EOF

# ---------------------------------------------------------
# 12. LOG & DIFF (Inspection - Token Optimized)
# ---------------------------------------------------------
cat << 'EOF' > "$GIT_DIR/log.sh"
#!/bin/bash
set -euo pipefail
COUNT="${1:-5}"

if ! [[ "$COUNT" =~ ^[0-9]+$ ]]; then
    echo "ERROR [log]: Count must be an integer." >&2
    exit 1
fi

git log -n "$COUNT" --oneline
EOF

cat << 'EOF' > "$GIT_DIR/diff-stat.sh"
#!/bin/bash
set -euo pipefail
git diff --stat
EOF

# ---------------------------------------------------------
# PERMISSIONS & FINALIZATION
# ---------------------------------------------------------
chmod +x "$GIT_DIR"/*.sh
echo "Unified Toolkit deployment complete. View API with: ./git-toolkit/help.sh"
