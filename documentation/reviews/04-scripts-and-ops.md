# Scripts And Ops Function Review

## PowerShell Script Functions

## `scripts/bootstrap-windows.ps1`

- `Invoke-Checked` (`scripts/bootstrap-windows.ps1:10`): shared command wrapper that runs a command and throws on non-zero exit code with command context. This is the script’s primary safety mechanism for fail-fast setup.
- `Test-CommandExists` (`scripts/bootstrap-windows.ps1:24`): checks whether a command is available on PATH via `Get-Command`.
- `Install-WingetPackageIfMissing` (`scripts/bootstrap-windows.ps1:28`): conditional installer that checks command presence or registry path, requires `winget`, installs a package with accepted agreements, and supports extra install args.

Script body behavior (non-function flow):
- Sets strict/fail-fast shell settings.
- Prepares PATH for Rust/npm tools.
- Installs Rust toolchain + components, Node/corepack/pnpm, WebView2 runtime, optional VS Build Tools, NSIS/WiX.
- Optionally installs repo dependencies and Playwright Chromium.

## `scripts/build-package-windows.ps1`

- `Invoke-Checked` (`scripts/build-package-windows.ps1:10`): same fail-fast command wrapper pattern, used for install/build/tauri packaging commands.

Script body behavior:
- Normalizes PATH with Rust/npm/NSIS/WiX locations.
- Optionally installs JS dependencies.
- Builds desktop app and Tauri bundles.
- Copies EXE and bundle outputs into date-stamped artifact directory.
- Writes `build_manifest.json` describing build results and output locations.

## `scripts/snapshot-baseline.ps1`

- `Invoke-Checked` (`scripts/snapshot-baseline.ps1:8`): fail-fast wrapper used for git/tar commands during snapshot creation.

Script body behavior:
- Creates timestamped snapshot tag name and zip archive path.
- Initializes git (if absent) for local snapshots.
- Stages all files and attempts a baseline snapshot commit.
- Creates git tag and archive zip excluding heavy/generated folders (`.git`, `target`, `node_modules`, etc.).

## `scripts/validate-release-windows.ps1`

- `Invoke-Checked` (`scripts/validate-release-windows.ps1:9`): fail-fast wrapper for repo validation/build/test commands.

Script body behavior:
- Prepares PATH for Rust/npm/package tooling.
- Optionally installs dependencies and Playwright browser.
- Runs Rust format/clippy/tests.
- Runs JS lint/typecheck/unit tests/browser e2e.
- Runs packaging script.
- Optionally runs runtime Tauri E2E runner against built executable.

## `scripts/runtime-e2e/run-tauri-runtime-e2e.ps1`

- `Invoke-Checked` (`scripts/runtime-e2e/run-tauri-runtime-e2e.ps1:13`): fail-fast wrapper used for Tauri build and runtime Playwright test commands.

Script body behavior:
- Prepares PATH and optionally builds Tauri app (bundled or no-bundle).
- Resolves app executable path and creates temporary runtime data directory.
- Resolves fixture paths and exports environment variables for runtime E2E suite.
- Starts Tauri app hidden, polls WebView2 CDP endpoint readiness.
- Runs Playwright runtime E2E tests.
- Verifies DB/report artifacts exist after tests.
- Cleans up process and temp data dir (unless `-KeepDataDir`).

## Operational Review Notes

- All scripts consistently use a local `Invoke-Checked` pattern, which improves reliability and error visibility.
- The scripts heavily optimize for Windows developer/CI environments (PATH shaping, WebView2, NSIS/WiX, `winget`).
- `validate-release-windows.ps1` acts as a full gatekeeper pipeline and is the best single entrypoint for external reviewers validating repo readiness on Windows.
