# Cleanup Report

## Scope
Workspace cleanup and maintainability reorganization with no backend behavior or application logic changes.

## A) Inventory
### Top-Level Folders And Purpose
- `.github/`: CI workflow definitions.
- `apps/`: Desktop UI and Tauri app.
- `crates/`: Rust backend/domain crates.
- `fixtures/`: test/runtime fixtures.
- `playwright/`: E2E runtime tests.
- `scripts/`: bootstrap/build/validation scripts.
- `documentation/`: centralized markdown/spec/review docs (new).
- `review/`: workspace review, QA artifact hub, quarantine (new).
- `tests/`: currently empty after doc migration.

### Build/Packaging Config That Must Remain
- `Cargo.toml`, `Cargo.lock`
- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/tauri.conf.json`
- `package.json`
- `pnpm-workspace.yaml`, `pnpm-lock.yaml`
- `playwright.config.ts`, `playwright.runtime.config.ts`
- `.github/workflows/ci.yml`

## B) Files Deleted (with reason)
All deletions below were non-source generated or duplicate workspace artifacts and are not referenced by runtime/build paths:

- `node_modules/`: generated dependency install output.
- `playwright-report/`, `test-results/`: generated E2E outputs.
- `.runtime-e2e-temp/`: temporary runtime E2E output.
- `target/` and `target-*` folders: Rust build outputs and temporary target dirs.
- `artifacts/`, `revisions/`: generated/revision output folders ignored by `.gitignore`.
- `_audit_feature/`, `_audit_main/`: duplicate audit repo copies, not runtime/build inputs.
- `_tmp_24648_3acaf90fe38ff27eff8850002788f5a1`, `_tmp_24648_4518ee417c07b176ff8a57f140b3b0c6`: temporary files.
- Removed empty legacy containers after migration: `REview_folder/`, `docs/`, `requirements/`.

## C) Files Moved/Renamed
### Markdown Documentation -> `documentation/`
- `FIX_NOW_BACKLOG.md` -> `documentation/root/fix-now-backlog.md`
- `HARDENING.md` -> `documentation/root/hardening.md`
- `HARDENING_REPORT.md` -> `documentation/root/hardening-report.md`
- `IPC_THREAT_MODEL.md` -> `documentation/root/ipc-threat-model.md`
- `SECURITY.md` -> `documentation/root/security.md`
- `THEORY_OF_OPERATION.md` -> `documentation/root/theory-of-operation.md`
- `docs/GUI_BUTTON_INTENDED_BEHAVIOR.md` -> `documentation/specs/gui-button-intended-behavior.md`
- `docs/ui_navigation_refactor_step_plan.md` -> `documentation/specs/ui-navigation-refactor-step-plan.md`
- `requirements/2026-02-26-rauversion-qc-ui-gap-analysis-and-plan.md` -> `documentation/specs/2026-02-26-rauversion-qc-ui-gap-analysis-and-plan.md`
- `tests/README.md` -> `documentation/testing/tests-readme.md`
- `REview_folder/01_rust_runtime_and_db.md` -> `documentation/reviews/01-rust-runtime-and-db.md`
- `REview_folder/02_desktop_app_and_frontend.md` -> `documentation/reviews/02-desktop-app-and-frontend.md`
- `REview_folder/03_tests_and_testkit.md` -> `documentation/reviews/03-tests-and-testkit.md`
- `REview_folder/04_scripts_and_ops.md` -> `documentation/reviews/04-scripts-and-ops.md`
- `REview_folder/05_complete_code_review.md` -> `documentation/reviews/05-complete-code-review.md`
- `REview_folder/06_external_review_comment_triage.md` -> `documentation/reviews/06-external-review-comment-triage.md`
- `REview_folder/CONCLUSION.md` -> `documentation/reviews/conclusion.md`
- `REview_folder/GUI_Test_Report_v1_Code_Analysis_and_Implementation_Plan.md` -> `documentation/reviews/gui-test-report-v1-code-analysis-and-implementation-plan.md`
- `REview_folder/README.md` -> `documentation/reviews/review-folder-readme.md`

### QA/Review Artifacts -> `review/assets/qa-findings/`
- `REview_folder/GUI_Test_Report_v1.pdf` -> `review/assets/qa-findings/gui-test-report-v1.pdf`
- `REview_folder/GUI_Test_Report_v1.txt` -> `review/assets/qa-findings/gui-test-report-v1.txt`
- `REview_folder/Theory of Operation & GUI Feedback.docx` -> `review/assets/qa-findings/theory-of-operation-and-gui-feedback.docx`
- `REview_folder/function_index_generated.txt` -> `review/assets/qa-findings/function-index-generated.txt`
- `REview_folder/review comments/Executive Summary (1).docx` -> `review/assets/qa-findings/executive-summary-1.docx`
- `REview_folder/review comments/review comments.txt` -> `review/assets/qa-findings/review-comments.txt`
- `REview_folder/review comments/Tauri App Code Review & Roadmap.docx` -> `review/assets/qa-findings/tauri-app-code-review-and-roadmap.docx`

### Requirements Source Artifacts -> `documentation/assets/requirements/`
- `requirements/Studio-Release-Orchestrator_ Architectural Blueprint and Implementation Plan - Google Dokument.pdf`
  -> `documentation/assets/requirements/studio-release-orchestrator-architectural-blueprint-and-implementation-plan.pdf`
- `requirements/Studio-Release-Orchestrator_ Architectural Blueprint and Implementation Plan - Google Dokument.txt`
  -> `documentation/assets/requirements/studio-release-orchestrator-architectural-blueprint-and-implementation-plan.txt`

## D) Files Quarantined
- None. No uncertain files required quarantine after evidence review.

## E) Final Directory Tree
```text
.
|-- .github/
|-- apps/
|   `-- desktop/
|       |-- src/
|       `-- src-tauri/
|-- crates/
|   |-- connectors/
|   |-- core/
|   |-- db/
|   `-- testkit/
|-- documentation/
|   |-- README.md
|   |-- root/
|   |-- specs/
|   |-- reviews/
|   |-- testing/
|   `-- assets/
|       `-- requirements/
|-- fixtures/
|-- playwright/
|-- review/
|   |-- WORKSPACE_REVIEW.md
|   |-- CLEANUP_REPORT.md
|   |-- assets/
|   |   `-- qa-findings/
|   `-- quarantine/
|-- scripts/
|-- tests/
|-- Cargo.toml
|-- Cargo.lock
|-- package.json
|-- pnpm-workspace.yaml
|-- pnpm-lock.yaml
|-- playwright.config.ts
`-- playwright.runtime.config.ts
```

