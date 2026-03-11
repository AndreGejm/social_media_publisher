# Script Consolidation Review

Date: 2026-03-11

**Duplicate or Overlapping Scripts**

- `scripts/build-package-windows.ps1`, `scripts/validate-release-windows.ps1`, and `scripts/runtime-e2e/run-tauri-runtime-e2e.ps1` each reimplement PATH/toolchain setup logic for pnpm, Rust, NSIS, WiX.
- `scripts/video-render-preinstaller-smoke.ps1` and `scripts/video-render-preinstaller-smoke.sh` are cross-platform twins; the Windows version lives under `scripts/windows/` while the bash version lives at `scripts/`, which is slightly asymmetric.
- Boundary checks and cleanup already have PS and bash pairs, which is good, but their naming and location patterns could be standardized across all scripts.

**Gaps in the Current Toolbox**

- No single “frontend validation sweep” wrapper for the documented typecheck/lint/test/build sequence.
- No “backend validation sweep” wrapper for cargo fmt/clippy/test.
- No local “CI parity” script that mirrors `.github/workflows/ci.yml` end-to-end.
- No developer “doctor” script to verify toolchain presence and versions without installing.
- No local “security audit” wrapper for `cargo audit` and `pnpm audit`.

**Naming Conventions to Adopt**

- Prefer `validate-*` for validation gates, `build-*` for packaging/build outputs, `clean-*` for removal tasks, `bootstrap-*` for environment setup, and `audit-*` for advisory scans.
- Keep platform suffixes explicit when needed: `*-windows.ps1`, `*-unix.sh`.
- Avoid mixed locations for sibling scripts; keep cross-platform variants in the same directory.

**Grouping Suggestions for Toolbox**

- Setup: bootstrap, doctor, toolchain validation.
- Validation: boundary checks, frontend validation, rust validation, e2e validation.
- Release: build-package, validate-release, runtime-e2e.
- Cleanup: clean-workspace, snapshot-baseline (optional if treated as release hygiene).
- Diagnostics: regression sweeps, log/diagnostic bundling.

**Consolidation Opportunities**

- Create a shared PowerShell helper (for example `scripts/windows/env-setup.ps1`) to unify PATH/tool discovery used by `build-package-windows`, `validate-release-windows`, and `runtime-e2e` scripts.
- Create a shared pnpm invocation helper for PowerShell scripts to reduce per-script boilerplate.
- Align the location of `video-render-preinstaller-smoke.*` scripts so the platform variants are adjacent.
