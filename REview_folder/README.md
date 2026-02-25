# External Review Package

This folder contains a function-level analysis of the maintained code in this repository.

## Scope

Included:
- Rust source and tests under `crates/`
- Tauri desktop backend (`apps/desktop/src-tauri/src/*.rs`)
- React UI source/tests (`apps/desktop/src/*.ts*`)
- Playwright tests (`playwright/**/*.ts`)
- PowerShell operational scripts (`scripts/**/*.ps1`)

Excluded (non-source or generated/vendor):
- `node_modules/`, `target/`, `artifacts/`, `playwright-report/`, `test-results/`, `.runtime-e2e-temp/`
- generated schemas and icons under `apps/desktop/src-tauri/gen/` and `apps/desktop/src-tauri/icons/`
- binary/text fixtures except where referenced by tests
- config/docs files with no functions (`Cargo.toml`, `package.json`, config JSON/TOML/YAML, markdown docs)

## Coverage Rule

The review documents cover:
- Named functions/methods/trait methods
- Top-level handler functions in React (`const` handlers)
- Top-level test callbacks (`test(...)` / `it(...)`) as executable behaviors

Inline anonymous closures inside already-documented functions/tests are summarized under their parent function/test instead of listed separately.

## Files In This Review Package

- `REview_folder/function_index_generated.txt`: machine-generated function/test index (line references)
- `REview_folder/01_rust_runtime_and_db.md`: core runtime, connector, orchestrator, DB layer
- `REview_folder/02_desktop_app_and_frontend.md`: Tauri commands/backend and React UI
- `REview_folder/03_tests_and_testkit.md`: Rust testkit, Rust tests, frontend/Playwright test behaviors
- `REview_folder/04_scripts_and_ops.md`: PowerShell automation scripts
- `REview_folder/CONCLUSION.md`: consolidated external-review conclusions

## Architecture Summary

Primary runtime flow:
1. `spec` parses/normalizes YAML release specs.
2. `idempotency` derives deterministic hashes and `release_id`.
3. `orchestrator` plans per-platform actions, persists state in `db`, executes publishers, verifies, and writes artifacts.
4. Tauri `commands` wraps the core for desktop UI use, adds path validation and UI-friendly error mapping.
5. React UI (`App.tsx`) drives load/plan/execute/report/history via Tauri commands.
6. Rust tests, Vitest tests, Playwright browser/runtime E2E, and PowerShell scripts validate and operationalize the workflow.

## Notes For External Reviewers

- The system intentionally enforces TEST-mode safety (simulation-only) in the core, not just the UI.
- Resume/idempotency behavior is a first-class feature and is validated in both core tests and DB state-machine tests.
- Desktop execution currently depends on an in-memory `planned_releases` map in the app session before `execute_release`.
