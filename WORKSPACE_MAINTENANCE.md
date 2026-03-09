# WORKSPACE MAINTENANCE

Date: 2026-03-09

## Purpose

Keep the repository lean by preventing generated artifacts, stale reports, and temporary mirrors from accumulating in active source paths.

## Ownership Rules

- Active source: `apps/`, `crates/`
- Active documentation: `docs/`
- Active scripts: `scripts/`
- Windows packaging scripts: `scripts/windows/`
- Historical material only: `archives/`
- Build outputs and caches are never source and must not be committed.

## Cleanup Commands

### PowerShell (Windows)

```powershell
./scripts/clean-workspace.ps1
./scripts/clean-workspace.ps1 -DryRun
```

### Bash

```bash
./scripts/clean-workspace.sh
./scripts/clean-workspace.sh --dry-run
```

## Suggested Routine

- Before opening a PR:
  - run cleanup script (dry-run first)
  - run typecheck/lint/tests/build
- Weekly local hygiene:
  - run cleanup script
  - remove stale local snapshots or mirror folders
- After packaging runs:
  - verify no installer/binary outputs remained in tracked paths
  - clear `scripts/windows/logs/` if local build logs are no longer needed

## Guardrails

- `.gitignore` blocks common generated output paths (`target`, `dist`, `node_modules`, reports, temp mirrors, `scripts/windows/logs`).
- Archive folders are allowed for history, but generated content inside archives is blocked and should be removed by cleanup scripts.
- Avoid adding generic folders like `old`, `backup`, `final`, or ad-hoc temp roots.

## PR Review Checklist

- No `node_modules`, `target`, `dist`, `playwright-report`, `test-results`, or temp output in staged changes.
- No packaged binaries/installers committed into active source tree.
- New docs go in `docs/` (or `archives/` only if historical).
- Scripts are placed under `scripts/` and tied to a current workflow.
