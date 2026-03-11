# Script Backlog

Date: 2026-03-11

1. Backend validation sweep (fmt + clippy + tests)
Problem statement: Backend validation steps are repeated in README and CI but lack a single local wrapper.
Why scripting would help: consistent command ordering and flags; reduces manual errors.
Why it is deferred: not implemented in this pass to keep changes minimal.
Recommended next step: add `scripts/validate-rust.ps1` and `scripts/validate-rust.sh` mirroring CI rust job.
Estimated difficulty: Small.
Dependencies or blockers: rustfmt/clippy availability.

2. Local CI parity script
Problem statement: Developers have to manually stitch together CI steps to reproduce failures.
Why scripting would help: one command to mirror CI gates; faster feedback and less drift.
Why it is deferred: medium scope and platform differences; should be designed with skip flags.
Recommended next step: define `scripts/validate-ci-local.*` with explicit opt-out switches.
Estimated difficulty: Medium.
Dependencies or blockers: Playwright browser install, Rust toolchain.

3. Security audit wrapper
Problem statement: `cargo audit` and `pnpm audit` run only in CI, not locally.
Why scripting would help: simplifies pre-release security checks.
Why it is deferred: requires installing `cargo-audit` and network access.
Recommended next step: add `scripts/audit-deps.*` with an optional `--install` flag.
Estimated difficulty: Small.
Dependencies or blockers: network access; tool availability.

4. Regression sweep wrapper
Problem statement: Regression report lists targeted commands but no single executable script.
Why scripting would help: repeatable regression runs with consistent selection.
Why it is deferred: test selection is still evolving; needs a stable list first.
Recommended next step: extract a fixed regression test list and add `scripts/run-regression.ps1`.
Estimated difficulty: Medium.
Dependencies or blockers: stable test selection criteria.

5. Cross-platform bootstrap
Problem statement: only Windows bootstrap script exists; Linux/macOS setup is manual.
Why scripting would help: consistent onboarding for non-Windows developers.
Why it is deferred: platform-specific package managers and prerequisites need alignment.
Recommended next step: draft `scripts/bootstrap-unix.sh` with OS detection and tool checks.
Estimated difficulty: Medium.
Dependencies or blockers: standardized tooling across OSes.

6. Doctor / environment sanity check
Problem statement: no quick way to verify toolchain versions and required binaries.
Why scripting would help: faster troubleshooting and support diagnostics.
Why it is deferred: must define canonical version policy.
Recommended next step: add `scripts/doctor.*` that reports tool presence and versions.
Estimated difficulty: Small to medium.
Dependencies or blockers: agreement on required versions.
