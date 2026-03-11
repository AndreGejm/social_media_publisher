# Script Automation Inventory

Date: 2026-03-11

This inventory covers existing scripts, package.json commands, CI jobs, and documented manual workflows that function as repeatable automation.

**Package Scripts (root `package.json`)**

| Name | Path | Purpose | Inputs | Outputs | Platform | Usage / Overlap |
| --- | --- | --- | --- | --- | --- | --- |
| `dev` | `package.json` | Run desktop dev server via workspace filter. | none | local dev server | cross-platform | Overlaps with `apps/desktop` `dev`. Used in README run instructions. |
| `build` | `package.json` | Build desktop web UI via workspace filter. | none | `apps/desktop/dist` | cross-platform | Overlaps with `apps/desktop` `build`. Used in docs/validation. |
| `typecheck` | `package.json` | TypeScript build for desktop. | none | typecheck diagnostics | cross-platform | Repeated in docs/validation. |
| `test` | `package.json` | Desktop unit tests via workspace filter. | none | test output | cross-platform | Overlaps with `apps/desktop` `test`. |
| `test:e2e` | `package.json` | Playwright e2e (browser). | none | Playwright report, test results | cross-platform | Used in CI frontend job. |
| `test:e2e:headed` | `package.json` | Playwright e2e with headed browser. | none | Playwright report | cross-platform | Local debug. |
| `test:e2e:runtime` | `package.json` | Playwright runtime config. | none | Playwright report runtime | cross-platform | Used by runtime e2e script. |
| `lint` | `package.json` | ESLint for desktop app. | none | lint diagnostics | cross-platform | Repeated in docs/validation. |
| `check:boundaries` | `package.json` | Runs boundary check script (PS). | none | violations list | Windows | Overlaps with `scripts/check-boundaries.sh` for Unix. |
| `validate:frontend` | `package.json` | Wrapper for frontend validation (typecheck/lint/tests/build + boundary). | optional flags (via script) | lint/test/build outputs | Windows | New wrapper to reduce repeated manual sequences. |
| `tauri:dev` | `package.json` | Run Tauri dev (desktop). | none | dev runtime | cross-platform | Used in README. |
| `tauri:build` | `package.json` | Build Tauri app. | none | native bundles | cross-platform | Used in README, packaging. |
| `bootstrap:windows` | `package.json` | Windows bootstrap toolchain install. | optional flags | installed tools, pnpm deps | Windows | Runs `scripts/bootstrap-windows.ps1`. |
| `snapshot:baseline` | `package.json` | Create baseline git snapshot and archive. | optional prefix | git tag, zip in `revisions/` | Windows | Wraps `scripts/snapshot-baseline.ps1`. |
| `validate:release:windows` | `package.json` | Full release validation (lint/tests/build/package + runtime e2e). | optional flags | build outputs, artifacts, test logs | Windows | Wraps `scripts/validate-release-windows.ps1`. |
| `build:package:windows` | `package.json` | Build Tauri bundles + copy artifacts. | optional flags | `artifacts/windows/...` | Windows | Wraps `scripts/build-package-windows.ps1`. |
| `e2e:runtime:windows` | `package.json` | Runtime E2E on packaged exe. | optional flags | Playwright runtime report | Windows | Wraps `scripts/runtime-e2e/run-tauri-runtime-e2e.ps1`. |

**Package Scripts (`apps/desktop/package.json`)**

| Name | Path | Purpose | Inputs | Outputs | Platform | Usage / Overlap |
| --- | --- | --- | --- | --- | --- | --- |
| `dev` | `apps/desktop/package.json` | Vite dev server. | none | dev server | cross-platform | Called by root `dev`. |
| `build` | `apps/desktop/package.json` | TypeScript build + Vite build. | none | `apps/desktop/dist` | cross-platform | Called by root `build`. |
| `preview` | `apps/desktop/package.json` | Preview built Vite app. | none | preview server | cross-platform | No wrapper in root. |
| `typecheck` | `apps/desktop/package.json` | TS build with no emit. | none | diagnostics | cross-platform | Called by root `typecheck`. |
| `test` | `apps/desktop/package.json` | Vitest. | none | test output | cross-platform | Called by root `test`. |
| `lint` | `apps/desktop/package.json` | ESLint. | none | lint diagnostics | cross-platform | Called by root `lint`. |
| `tauri` | `apps/desktop/package.json` | Raw Tauri CLI. | args | Tauri outputs | cross-platform | Used by wrappers (build/dev). |

**Repo Scripts (`scripts/`, `scripts/windows/`, `scripts/runtime-e2e/`)**

| Name | Path | Purpose | Inputs | Outputs | Platform | Usage / Overlap |
| --- | --- | --- | --- | --- | --- | --- |
| `bootstrap-windows` | `scripts/bootstrap-windows.ps1` | Install toolchain + deps on Windows. | `-PnpmVersion`, `-SkipRepoInstall`, `-InstallVsBuildTools` | tool installs, pnpm deps, Playwright browsers | Windows | Primary setup for Windows. |
| `build-package-windows` | `scripts/build-package-windows.ps1` | Build Tauri bundle and collect artifacts. | `-SkipInstall`, `-BundleTargets`, `-ArtifactsRoot` | `artifacts/windows/<date>`, `build_manifest.json` | Windows | Overlaps with `validate-release-windows` build step. |
| `check-boundaries` | `scripts/check-boundaries.ps1` | Boundary guard checks (rg fallback). | none | console violations | Windows | Mirrors `scripts/check-boundaries.sh`. |
| `check-boundaries` | `scripts/check-boundaries.sh` | Boundary guard checks (rg). | none | console violations | Linux/macOS | Mirrors PS version. |
| `clean-workspace` | `scripts/clean-workspace.ps1` | Remove generated artifacts + temp dirs. | `-DryRun` | workspace cleanup | Windows | Mirrors `scripts/clean-workspace.sh`. |
| `clean-workspace` | `scripts/clean-workspace.sh` | Remove generated artifacts + temp dirs. | `--dry-run` | workspace cleanup | Linux/macOS | Mirrors PS version. |
| `snapshot-baseline` | `scripts/snapshot-baseline.ps1` | Create git tag + zip snapshot. | `-Prefix` | git tag, `revisions/<tag>.zip` | Windows | Uses git + tar.exe. |
| `validate-release-windows` | `scripts/validate-release-windows.ps1` | Full release validation pipeline. | `-SkipInstall`, `-SkipRuntimeE2E` | tests, bundle artifacts, runtime E2E results | Windows | Wraps lint/typecheck/tests/build, package, runtime E2E. |
| `build-package-windows` | `scripts/build-package-windows.ps1` | Build Tauri bundles and copy artifacts. | `-SkipInstall`, `-BundleTargets`, `-ArtifactsRoot` | `artifacts/windows/...` | Windows | Used by validate-release. |
| `runtime-e2e` | `scripts/runtime-e2e/run-tauri-runtime-e2e.ps1` | Launch packaged app + run Playwright runtime suite. | exe path, flags, env vars | Playwright runtime report, temp data dir | Windows | Used in CI `runtime-e2e-windows` job. |
| `video-preinstaller-smoke` | `scripts/windows/video-render-preinstaller-smoke.ps1` | Validate video render preinstaller readiness. | `-SkipBoundaryCheck`, `-SkipFrontend`, `-SkipRust` | console report + manual checklist pointer | Windows | Mirrors `scripts/video-render-preinstaller-smoke.sh`. |
| `video-preinstaller-smoke` | `scripts/video-render-preinstaller-smoke.sh` | Validate video render preinstaller readiness. | `--skip-*` flags | console report + manual checklist pointer | Linux/macOS | Mirrors PS version. |
| `make-exe` | `scripts/windows/make-exe.ps1` | Build Tauri exe/installer and log output. | `-Mode release|debug` | log file, exe/installer path | Windows | Called by `create-installer.bat`. |
| `create-installer` | `scripts/windows/create-installer.bat` | Wrapper to run `make-exe.ps1`. | none | installer/exe | Windows | Legacy entrypoint. |
| `validate-frontend` | `scripts/validate-frontend.ps1` | Frontend validation sweep. | `-Install`, `-SkipBoundaryCheck`, `-SkipBuild` | lint/test/build outputs | Windows | New wrapper for doc-defined sequences. |
| `validate-frontend` | `scripts/validate-frontend.sh` | Frontend validation sweep. | `--install`, `--skip-boundary-check`, `--skip-build` | lint/test/build outputs | Linux/macOS | New wrapper for doc-defined sequences. |

**Git Toolkit (`git-toolkit/`)**

| Name | Path | Purpose | Inputs | Outputs | Platform | Usage / Overlap |
| --- | --- | --- | --- | --- | --- | --- |
| `deploy_git_toolkit` | `deploy_git_toolkit.sh` | Generates git-toolkit wrapper scripts. | none | `git-toolkit/*.sh` | Linux/macOS | One-time setup script. |
| `git-toolkit` scripts | `git-toolkit/*.sh` | Wrapper around git operations. | per script | git changes, logs | Linux/macOS | Not tied to app build; overlaps raw git usage. |

**CI Workflows**

| Name | Path | Purpose | Inputs | Outputs | Platform | Usage / Overlap |
| --- | --- | --- | --- | --- | --- | --- |
| `CI: security-audit` | `.github/workflows/ci.yml` | Run cargo + pnpm audits. | network, registries | audit logs | ubuntu-latest | No local wrapper script. |
| `CI: frontend` | `.github/workflows/ci.yml` | Install deps, lint/typecheck/tests/build, Playwright smoke. | pnpm lock, playwright install | test + build logs | ubuntu-latest | Overlaps README + validation docs. |
| `CI: rust` | `.github/workflows/ci.yml` | fmt, clippy, cargo tests. | rust toolchain | test logs | ubuntu-latest | No local wrapper script. |
| `CI: runtime-e2e-windows` | `.github/workflows/ci.yml` | Build Tauri and run runtime E2E. | Windows toolchain | runtime test logs | windows-latest | Uses `scripts/runtime-e2e/run-tauri-runtime-e2e.ps1`. |

**Documented Manual Workflows (non-scripted automation)**

| Name | Path | Purpose | Inputs | Outputs | Platform | Usage / Overlap |
| --- | --- | --- | --- | --- | --- | --- |
| Run instructions | `README.md` | Install deps + run dev server. | pnpm install, npm run dev | dev server | cross-platform | Duplicates package.json scripts. |
| Build instructions | `README.md` | Tauri build and output location. | `npm run tauri build` | native bundles | cross-platform | Overlaps `tauri:build`. |
| Test & lint instructions | `README.md` | Frontend + backend validation sequences. | pnpm/cargo commands | lint/test logs | cross-platform | Repeated in other docs. |
| Boundary validation evidence | `BOUNDARY_GUARDRAILS.md` | Record of validation commands. | pnpm/cargo/script commands | logs | cross-platform | Repeats same sequence as cleanup validation. |
| Post-cleanup validation | `POST_CLEANUP_VALIDATION.md` | Full validation sequence with cleanup. | pnpm/cargo/script commands | logs | cross-platform | Candidate for scripted sweep. |
| Workspace maintenance | `WORKSPACE_MAINTENANCE.md` | Cleanup + PR hygiene steps. | cleanup scripts + validation cmds | clean workspace | cross-platform | Suggests pre-PR sequences. |
| Regression runbook | `REGRESSION_REPORT.md` | Targeted test commands + runtime E2E. | pnpm/cargo/playwright | test logs | Windows + cross-platform | Candidate for scripted regression sweep. |
| Preinstaller checklist | `docs/video-workspace/PREINSTALLER_READINESS_CHECKLIST.md` | Manual readiness checklist. | manual steps | readiness signals | Windows + cross-platform | Partially automated by video preinstaller smoke scripts. |
