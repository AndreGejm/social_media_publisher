#!/bin/bash
set -euo pipefail

cat << 'MATRIX'
=== AI GIT TOOLKIT API MATRIX ===
TYPE       | COMMAND            | INPUT (Type)      | INVARIANT / OUTPUT BEHAVIOR
-----------|--------------------|-------------------|-----------------------------------------------------
MUTATOR    | push.sh            | msg (String)      | Atomic: Stage all -> Commit -> Push. (Exit 0/1)
MUTATOR    | publish.sh         | None              | Push current branch without creating a commit.
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
