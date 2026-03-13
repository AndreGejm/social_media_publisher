# Full Clean Report

- Run date: 2026-03-13T11:49:52
- Workspace: `C:\Dev\testing chtgpt`
- Size before clean: **22.03 GB**
- Size after clean: **4.40 GB**
- Space reclaimed: **17.63 GB**

## Why The Workspace Grew To ~21 GB

- Rust/Tauri build outputs in `target/` were the dominant source (debug + release artifacts, PDBs, incremental caches).
- A second Rust build tree `target-runtime-e2e/` duplicated many release artifacts for runtime E2E flows.
- Dependency install output (`node_modules/`) and nested workspace package copies consumed additional space.
- Packaging artifacts, Playwright reports, and temporary lint/test files accumulated between runs.

## Removed Items (For Uninstaller/Cleanup Logic)

| Path | Category | Removed Size |
|---|---|---:|
| `target` | Rust build output | 14.33 GB |
| `target-runtime-e2e` | Auxiliary Rust target/build output | 2.18 GB |
| `node_modules` | Node dependency install output | 884.21 MB |
| `artifacts` | Packaging/build artifacts | 204.77 MB |
| `apps\desktop\node_modules` | Node dependency install output | 42.93 MB |
| `.disk_usage_raw.json` | Temporary audit data file | 22.09 MB |
| `playwright-report` | Playwright HTML report | 557.83 KB |
| `apps\desktop\dist` | Frontend production bundle output | 542.49 KB |
| `playwright-report-runtime` | Runtime Playwright HTML report | 452.04 KB |
| `_lint_initial.json` | Temporary lint output file | 145.10 KB |
| `test-results` | Playwright raw test output | 82.89 KB |
| `scripts\windows\logs` | Known generated logs/artifact directory | 67.81 KB |
| `_lint_postfix.json` | Temporary lint output file | 44.65 KB |
| `_tmp_css_colors.txt` | Temporary scratch file | 3.33 KB |
| `_lint_initial.txt` | Temporary lint output file | 474.00 B |
| `.runtime-e2e-temp` | Runtime E2E temp workspace | 0.00 B |

## Reclaimed Space By Category

| Category | Reclaimed |
|---|---:|
| Rust build output | 14.33 GB |
| Auxiliary Rust target/build output | 2.18 GB |
| Node dependency install output | 927.14 MB |
| Packaging/build artifacts | 204.77 MB |
| Temporary audit data file | 22.09 MB |
| Playwright HTML report | 557.83 KB |
| Frontend production bundle output | 542.49 KB |
| Runtime Playwright HTML report | 452.04 KB |
| Temporary lint output file | 190.21 KB |
| Playwright raw test output | 82.89 KB |
| Known generated logs/artifact directory | 67.81 KB |
| Temporary scratch file | 3.33 KB |
| Runtime E2E temp workspace | 0.00 B |

## Remaining Largest Directories

| Type | Path | Size |
|---|---|---:|
| Dir | `.git` | 4.04 GB |
| Dir | `apps` | 191.39 MB |
| Dir | `archives` | 120.90 MB |
| Dir | `releases` | 54.62 MB |
| Dir | `crates` | 380.92 KB |
| Dir | `docs` | 355.74 KB |
| File | `Cargo.lock` | 165.29 KB |
| File | `pnpm-lock.yaml` | 102.51 KB |
| Dir | `playwright` | 77.56 KB |
| Dir | `scripts` | 52.64 KB |
| File | `EXPECTED_BEHAVIOR_MATRIX.md` | 36.32 KB |
| File | `UI_CONTROL_INVENTORY.md` | 25.87 KB |

## Notes

- No deletion failures occurred.
- `node_modules/` was removed as part of this full clean to get below 5 GB. Reinstall with `pnpm install` when needed.
- `.git/` now dominates remaining usage; this is repository history/object storage rather than build output.