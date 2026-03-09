# CLEANUP CLASSIFICATION

Date: 2026-03-09

## A. Safe To Delete Immediately

| Path / Pattern | Why safe | Action taken |
| --- | --- | --- |
| `target/` | Rust build output | Deleted |
| `target-agent-*`, `target-clippy*`, `target_agent*` | Tool-generated Rust target variants | Deleted |
| `.agent-tmp/` | Agent temp workspace output | Deleted |
| `node_modules/` | Reproducible dependency install output | Deleted |
| `apps/desktop/node_modules/` | Workspace-level duplicate install output | Deleted |
| `apps/desktop/dist/` | Frontend build output | Deleted |
| `playwright-report-runtime/`, `playwright-report/` | Test report output | Deleted |
| `test-results/`, `test-results-runtime*` | Test output artifacts | Deleted |
| `.runtime-e2e-temp/` | Runtime test temp folder | Deleted |
| `tmp_perm_dir/`, `tmp_perm_check.txt` | Temporary permission test artifacts | Deleted |
| `_tmp_*` (root temp files) | Transient temp markers | Deleted |
| `apps/desktop/src-tauri/.tmp-qc-batch-exports-*` | Temporary export output | Deleted |
| `apps/desktop/target-*` | App-local target scratch output | Deleted |
| `build/artifacts_test/` | Old build output snapshot | Deleted |
| `build/logs/` | Legacy build run logs | Deleted |
| `artifacts/windows/*` | Previously packaged binaries/installers | Deleted |
| `_push_workspace/`, `_push_workspace_20260302/` | Full stale workspace mirrors | Deleted |
| `index.alt.lock` | Alternate lock scratch artifact | Deleted |
| `.snapshot_tag_name` | Snapshot bookkeeping marker | Deleted |
| `tree.txt` | Exported tree snapshot | Deleted |

## B. Dead/Obsolete Code And Files

| Path | Evidence | Confidence | Action taken |
| --- | --- | --- | --- |
| `apps/desktop/src/features/player/hooks/usePlayerTransportState.ts` | No in-repo consumers; thin compatibility wrapper to `player-transport` | High | Deleted |
| `apps/desktop/src/services/tauri/tauri-api.ts` | No in-repo runtime consumers; superseded by domain bridges + `tauriClient` | Medium | Deleted |
| `apps/desktop/src/services/tauri/tauri-api-core.d.ts` | Legacy declaration tied to removed compatibility surface | Medium | Deleted |
| `apps/desktop/src/services/tauri/tauri-api.test.ts` | Compatibility-boundary tests only for removed shim | Medium | Deleted |
| `scripts/extract_types.js` | No script/package references; one-off migration utility | High | Deleted |
| `scripts/fix_imports.js` | No script/package references; one-off migration utility | High | Deleted |
| `scripts/move_hooks.js` | No script/package references; one-off migration utility | High | Deleted |
| `scripts/move_root_components.js` | No script/package references; one-off migration utility | High | Deleted |
| `apps/desktop/src/hooks/` | Empty directory | High | Deleted |

## C. Move Out Of Active Repo / Archive

| Path | Why not active | Action taken |
| --- | --- | --- |
| `review/` | Historical review bundle assets (docx/pdf/txt) | Moved to `archives/review/` |
| `documentation/` | Legacy doc tree duplicated by active `docs/` direction | Moved to `archives/documentation-legacy/` |
| `inspiration/` | External prototype/experiment tree, not part of active bounded modules | Moved to `archives/inspiration/` |
| `Temporary Workspace for a excel search program/` | Legacy experiment workspace | Moved to `archives/experimental/temporary-workspace-excel-search/` |
| Root phase docs (`ARCHITECTURE_AUDIT.md`, `TARGET_ARCHITECTURE_PLAN.md`, `REFACTOR_LOG.md`, `VALIDATION_REPORT.md`) | Active docs should be centralized | Moved to `docs/reports/` |
| `RUNTIME_PATH_BREAK_REPORT.md` | Historical issue report | Moved to `archives/reports/` |

## D. Keep

| Path / Area | Why kept |
| --- | --- |
| `apps/desktop/src/**` (except removed dead candidates) | Active frontend source with bounded-module architecture |
| `apps/desktop/src-tauri/src/**` | Active backend source and runtime ownership boundaries |
| `crates/**` | Active Rust workspace crates |
| `docs/architecture`, `docs/contracts`, `docs/modules`, `docs/refactor`, `docs/validation` | Current architecture and contract set |
| `scripts/bootstrap-windows.ps1`, `scripts/build-package-windows.ps1`, `scripts/validate-release-windows.ps1`, `scripts/runtime-e2e/run-tauri-runtime-e2e.ps1`, `scripts/windows/{create-installer.bat,make-exe.ps1}` | Active operational scripts |
| `.github/`, workspace manifests (`Cargo.toml`, `package.json`, lockfiles) | Required project metadata and CI config |
