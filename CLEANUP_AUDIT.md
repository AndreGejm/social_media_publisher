# CLEANUP AUDIT

Date: 2026-03-09

## Baseline Workspace Metrics

- Total size: **58.89 GB** (`60300.98 MB`)
- Total files: **322,127**
- Total directories: **53,483**

## Top Largest Root Directories

| Directory | Size (MB) | File Count | Notes |
| --- | ---: | ---: | --- |
| `_push_workspace` | 19,938.05 | 133,527 | Full workspace mirror; stale snapshot clone |
| `_push_workspace_20260302` | 19,938.05 | 133,527 | Full workspace mirror; stale snapshot clone |
| `target` | 19,310.31 | 24,846 | Rust build artifacts |
| `.git` | 4,035.68 | 18,334 | Git metadata (keep) |
| `node_modules` | 674.81 | 8,876 | Reproducible dependency install output |
| `inspiration` | 311.05 | 20,512 | Prototype/experiment tree with embedded node_modules |
| `artifacts` | 60.88 | 8 | Packaged binaries/installers |
| `tmp_perm_dir` | 17.06 | 113 | Temporary permission test output |
| `.agent-tmp` | 14.01 | 101 | Agent temp output |
| `target-agent-phase1ZUk1Mk` | 14.01 | 100 | Tool-generated Rust target variant |
| `target-agentvt8gyd` | 9.79 | 103 | Tool-generated Rust target variant |
| `review` | 5.93 | 13 | Historical review bundle assets |

## Top Largest Files (Sample)

All top files are compiled artifacts in Rust build outputs and snapshot clones.

| File | Size (MB) |
| --- | ---: |
| `target/debug/deps/release_publisher_desktop_lib.lib` | 1128.05 |
| `_push_workspace_20260302/target/debug/deps/release_publisher_desktop_lib.lib` | 1121.27 |
| `_push_workspace/target/debug/deps/release_publisher_desktop_lib.lib` | 1121.27 |
| `target/debug/release_publisher_desktop_lib.lib` | 1115.10 |
| `target/debug/deps/librelease_publisher_desktop_lib.rlib` | 381.96 |
| `_push_workspace/target/debug/deps/librelease_publisher_desktop_lib.rlib` | 373.35 |
| `_push_workspace_20260302/target/debug/deps/librelease_publisher_desktop_lib.rlib` | 373.35 |
| `target/debug/release_publisher_desktop.pdb` | 206.37 |
| `target/debug/deps/release_publisher_desktop.pdb` | 206.37 |
| `_push_workspace/target/debug/release_publisher_desktop.pdb` | 204.26 |

## Highest File-Count Directories (Immediate files)

| Directory | Immediate file count |
| --- | ---: |
| `target/debug/deps` | 4,065 |
| `_push_workspace/target/debug/deps` | 4,013 |
| `_push_workspace_20260302/target/debug/deps` | 4,013 |
| `_push_workspace/.../lucide-react/dist/esm/icons` | 3,450 |
| `target/release/deps` | 1,802 |

## Known Generated Artifact / Cache Folders Detected

- Root level:
  - `target/`
  - `target-agent-*`, `target-clippy*`
  - `node_modules/`
  - `playwright-report-runtime/`
  - `test-results/`, `test-results-runtime2/`
  - `.agent-tmp/`
  - `tmp_perm_dir/`
  - `.runtime-e2e-temp/`
- App level:
  - `apps/desktop/dist/`
  - `apps/desktop/node_modules/`
  - `apps/desktop/src-tauri/.tmp-qc-batch-exports-*`
  - `apps/desktop/target-clippyr077lm/`
- Packaging/output:
  - `artifacts/windows/*` (exe, msi, nsis)
  - `build/artifacts_test/*`
  - `build/logs/*`

## Likely Dead Code / Obsolete File Candidates

High-confidence candidates (needs classification + delete/review decision):

- `apps/desktop/src/features/player/hooks/usePlayerTransportState.ts`
  - Compatibility wrapper; no in-repo consumers found.
- `apps/desktop/src/services/tauri/tauri-api.ts`
  - Legacy compatibility surface; no runtime consumers found (test-only references).
- `apps/desktop/src/services/tauri/tauri-api-core.d.ts`
  - Legacy declaration tied to old tauri-api surface.
- `apps/desktop/src/hooks/` (empty directory)
- One-off migration scripts with no references:
  - `scripts/extract_types.js`
  - `scripts/fix_imports.js`
  - `scripts/move_hooks.js`
  - `scripts/move_root_components.js`

## Duplicate / Suspicious Folders

- `_push_workspace/` and `_push_workspace_20260302/` are full duplicated workspace mirrors (major bloat source).
- `docs/` and `documentation/` both contain architecture/review material; ownership is split and inconsistent.
- `review/` duplicates review/report material already represented in docs architecture/refactor artifacts.

## Stale Release / Build Outputs in Active Tree

- `artifacts/windows/20260301/*`
- `artifacts/windows/20260302/*`
- `build/artifacts_test/windows/20260228/*`
- `build/logs/build_20260228.log`

## Initial Risk Notes

- Large cleanup can safely remove generated and snapshot output with no architecture impact.
- Code-file deletions require reference checks and post-clean validation.
- Documentation consolidation should avoid deleting current module-boundary specs in `docs/`.

## Dependency and Tooling Clutter Audit

- Root and app package manifests currently resolve and build cleanly; no obvious runtime break from dependency removal was required for this pass.
- Unreferenced one-off migration scripts were detected (`extract_types.js`, `fix_imports.js`, `move_hooks.js`, `move_root_components.js`) and flagged as dead tooling.
- No Rust crate dependency was removed in this pass to avoid high-risk false positives without dedicated usage tooling.
- Follow-up recommendation: run a dedicated dependency analyzer (`depcheck` for frontend and `cargo-udeps` for Rust) in a focused maintenance PR.
