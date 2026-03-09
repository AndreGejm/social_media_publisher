# PROPOSED STRUCTURE

Date: 2026-03-09

## Objective

Normalize the workspace so active development lives in a small, obvious set of roots, while historical/experimental material is isolated from day-to-day work.

## Target Layout (Applied)

```text
/
  apps/
    desktop/
      src/
      src-tauri/
  crates/
  docs/
    architecture/
    contracts/
    modules/
    refactor/
    validation/
    reports/
  scripts/
    runtime-e2e/
    windows/
    Toolkit/
  fixtures/
  archives/
    documentation-legacy/
    review/
    inspiration/
    experimental/
    reports/
  .github/
  README.md
  CLEANUP_*.md
  DEAD_CODE_REMOVAL_REPORT.md
  PROPOSED_STRUCTURE.md
  POST_CLEANUP_VALIDATION.md
  WORKSPACE_MAINTENANCE.md
```

## Ownership Rules

- `apps/desktop/**`: active product code only.
- `crates/**`: active Rust libraries and tests only.
- `docs/**`: current architecture/contracts/refactor/validation references.
- `docs/reports/**`: active project-level reports previously scattered at root.
- `scripts/**`: active operational and maintenance scripts.
- `scripts/windows/**`: Windows packaging/installer scripts.
- `archives/**`: non-active historical material; must not contain generated caches/build outputs.

## What Was Normalized

- Root report files moved into `docs/reports/`.
- Legacy documentation, review bundles, and experiments moved under `archives/`.
- Generated outputs removed from active paths (and from archived inspiration snapshot).
- `build/create-installer.bat` and `build/make-exe.ps1` moved into `scripts/windows/`.
- Root now presents a reduced, clearer active surface.

## Explicit Non-Goals in This Pass

- No architecture redesign.
- No bounded-module ownership rewrite.
- No runtime behavior changes.

## Follow-up Structure Improvements (Optional)

1. If archives are not needed in-repo, relocate `archives/` outside repo root.
2. Add a lightweight CI check to run `scripts/clean-workspace.ps1 -DryRun` and fail on generated clutter.
