# Workspace Review

## 1) Project Overview
This repository is a desktop release-publishing application built with:
- Frontend: React + TypeScript (`apps/desktop/src`)
- Desktop shell: Tauri v2 (`apps/desktop/src-tauri`)
- Backend/domain: Rust workspace crates (`crates/core`, `crates/db`, `crates/testkit`, `crates/connectors/mock`)
- Tooling: pnpm, Playwright, Rust test/clippy pipelines

The codebase has grown from a single workflow into multi-workspace functionality (catalog ingest, playback/QC, release planning/execution, and history/reporting), so maintainability depends on clearer structure and centralized docs.

## 2) Architecture Summary
### Frontend / Backend Split
- UI state and views live in `apps/desktop/src`.
- IPC client lives in `apps/desktop/src/tauri-api.ts`.
- Tauri command registration and command handlers live in `apps/desktop/src-tauri/src/lib.rs` and `apps/desktop/src-tauri/src/commands.rs`.
- Backend business logic and persistence is implemented in Rust crates:
  - `crates/core`: domain logic and orchestration
  - `crates/db`: migrations and SQLite persistence
  - `crates/connectors/mock`: connector simulation
  - `crates/testkit`: integration testing utilities

### Core Flows
1. Spec workflow: `load_spec` -> `plan_release` -> `execute_release`
2. Audio/QC workflow: `analyze_audio_file` + `analyze_and_persist_release_track` + `get_release_track_analysis`
3. Catalog workflow: import/list/get/update tracks; manage library roots; scan roots; poll ingest jobs

## 3) Key Command Surface (Tauri IPC)
Registered commands in `apps/desktop/src-tauri/src/lib.rs`:
- `load_spec`
- `plan_release`
- `execute_release`
- `list_history`
- `get_report`
- `analyze_audio_file`
- `analyze_and_persist_release_track`
- `get_release_track_analysis`
- `catalog_import_files`
- `catalog_list_tracks`
- `catalog_get_track`
- `publisher_create_draft_from_track`
- `catalog_update_track_metadata`
- `catalog_add_library_root`
- `catalog_list_library_roots`
- `catalog_remove_library_root`
- `catalog_scan_root`
- `catalog_get_ingest_job`

## 4) Known Issues / TODOs
- Frontend complexity remains high in large UI components, especially workspace views and mixed mode logic.
- Maintainability risk from command concentration in a single Tauri command module.
- Existing docs indicate prior ingest timeout/dialog regressions and dark-theme contrast issues that require continuous regression coverage.
- Operational/report artifacts had accumulated in root-level ad-hoc folders before this cleanup.

## 5) Existing QA Findings (Preserved)
QA and review artifacts were preserved and reorganized:
- Markdown review reports: `documentation/reviews/`
- QA documents and exports: `review/assets/qa-findings/`
- Requirements source files: `documentation/assets/requirements/`

