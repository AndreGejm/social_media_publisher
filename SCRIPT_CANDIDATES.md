# Script Candidates

Date: 2026-03-11

**Strong Script Candidates**

1. Frontend validation sweep (typecheck + lint + tests + build + boundary)
Current location or workflow source: `README.md`, `BOUNDARY_GUARDRAILS.md`, `POST_CLEANUP_VALIDATION.md`, CI frontend job.
Why it should be scripted: repeated multi-step sequence; reduces omissions and mismatched flags.
Expected users: developer, CI.
Risk level: Low.
Estimated implementation size: Small.
Recommended script name: `scripts/validate-frontend.ps1`, `scripts/validate-frontend.sh`.
Recommended platform: PowerShell + bash.
Wrap or real logic: wrap existing commands.

2. Backend validation sweep (fmt + clippy + tests)
Current location or workflow source: `README.md`, CI rust job.
Why it should be scripted: common multi-step safety check; ensures consistent lint/test gates.
Expected users: developer, CI.
Risk level: Low.
Estimated implementation size: Small.
Recommended script name: `scripts/validate-rust.ps1`, `scripts/validate-rust.sh`.
Recommended platform: PowerShell + bash.
Wrap or real logic: wrap existing cargo commands.

3. Pre-PR hygiene sweep (cleanup dry-run + core validation)
Current location or workflow source: `WORKSPACE_MAINTENANCE.md`, `POST_CLEANUP_VALIDATION.md`.
Why it should be scripted: explicit “run these in order” guidance; reduces missing cleanup or accidental commit of artifacts.
Expected users: developer, release engineer.
Risk level: Low.
Estimated implementation size: Small.
Recommended script name: `scripts/prepr-check.ps1`, `scripts/prepr-check.sh`.
Recommended platform: PowerShell + bash.
Wrap or real logic: wrap `clean-workspace` (dry-run) + validation scripts.

4. Playwright install + browser smoke
Current location or workflow source: CI frontend job (`playwright install` + `pnpm test:e2e`).
Why it should be scripted: e2e smoke often fails locally without browser install; deterministic sequence.
Expected users: developer, CI.
Risk level: Low.
Estimated implementation size: Small.
Recommended script name: `scripts/validate-e2e.sh` / `scripts/validate-e2e.ps1`.
Recommended platform: PowerShell + bash.
Wrap or real logic: wrap `pnpm exec playwright install` + `pnpm test:e2e`.

5. Full local CI parity (frontend + rust + e2e)
Current location or workflow source: `.github/workflows/ci.yml` + validation docs.
Why it should be scripted: single command to reproduce CI gates; reduces drift.
Expected users: developer, CI, release engineer.
Risk level: Medium (time-consuming, cross-platform dependencies).
Estimated implementation size: Medium.
Recommended script name: `scripts/validate-ci-local.ps1`, `scripts/validate-ci-local.sh`.
Recommended platform: PowerShell + bash.
Wrap or real logic: wrap existing commands with clear opt-out flags.

**Maybe Script Candidates**

1. Security audit sweep (cargo audit + pnpm audit)
Current location or workflow source: CI security-audit job.
Why it should be scripted: aligns local audits with CI; useful before release.
Expected users: release engineer, CI.
Risk level: Medium (installs cargo-audit, network dependency).
Estimated implementation size: Small.
Recommended script name: `scripts/audit-deps.ps1`, `scripts/audit-deps.sh`.
Recommended platform: PowerShell + bash.
Wrap or real logic: wrap `cargo audit` + `pnpm audit`, optionally install `cargo-audit`.

2. Runtime E2E launcher with artifact selection
Current location or workflow source: `REGRESSION_REPORT.md` and `scripts/runtime-e2e/run-tauri-runtime-e2e.ps1`.
Why it should be scripted: repeated flags and exe selection are error-prone; could add wrapper for “latest artifact”.
Expected users: developer, CI.
Risk level: Medium.
Estimated implementation size: Small to medium.
Recommended script name: `scripts/runtime-e2e/launch-latest.ps1`.
Recommended platform: PowerShell.
Wrap or real logic: wrapper that resolves latest `artifacts/windows/<date>/Skald.exe` and calls existing script.

3. Regression sweep (targeted test groups)
Current location or workflow source: `REGRESSION_REPORT.md`.
Why it should be scripted: repeated targeted test commands and runtime-e2e flags.
Expected users: developer, release engineer.
Risk level: Medium (test selection changes often).
Estimated implementation size: Medium.
Recommended script name: `scripts/run-regression.ps1`.
Recommended platform: PowerShell.
Wrap or real logic: wrapper around test commands with a centralized test list.

4. Cross-platform bootstrap
Current location or workflow source: `scripts/bootstrap-windows.ps1` only.
Why it should be scripted: Linux/macOS onboarding not standardized.
Expected users: developer.
Risk level: Medium (tooling variations across OS).
Estimated implementation size: Medium.
Recommended script name: `scripts/bootstrap-unix.sh`.
Recommended platform: bash.
Wrap or real logic: real logic with OS-specific tool install steps.

**Keep As Code/Function (Not a Script)**

1. Tauri runtime behavior and command contracts
Current location or workflow source: `apps/desktop/src-tauri/src/commands/*` + `apps/desktop/src/services/tauri/*`.
Why it should not be scripted: core product logic; scripting would risk divergence from runtime behavior.
Expected users: developer.
Risk level: High if extracted.
Estimated implementation size: Large.
Recommended script name: none.
Recommended platform: none.
Wrap or real logic: keep in codebase.

2. Backend audio service policy and output switching
Current location or workflow source: `docs/modules/backend-audio-service`, `apps/desktop/src-tauri/src/backend_audio_service`.
Why it should not be scripted: domain logic with strict runtime invariants.
Expected users: developer.
Risk level: High if extracted.
Estimated implementation size: Large.
Recommended script name: none.
Recommended platform: none.
Wrap or real logic: keep in codebase.

3. Feature-specific UI interaction logic
Current location or workflow source: `apps/desktop/src/features/*`.
Why it should not be scripted: product behavior and UI logic should stay in app/test code, not scripts.
Expected users: developer.
Risk level: High if extracted.
Estimated implementation size: Large.
Recommended script name: none.
Recommended platform: none.
Wrap or real logic: keep in codebase.
