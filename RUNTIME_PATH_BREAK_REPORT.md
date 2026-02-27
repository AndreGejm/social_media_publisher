# RUNTIME_PATH_BREAK_REPORT

## Step 0 - Baseline and Diff

- Last known good baseline: `main` at `3f808bd`
- Broken state analyzed: current branch `Experimental` at `3f808bd` **plus uncommitted cleanup workspace changes**

Command used:
- `git diff --name-status --find-renames 3f808bd`

Result summary:
- Only documentation/review/requirements markdown and review assets were moved/deleted from old locations.
- No runtime code files changed in:
  - `apps/desktop/src-tauri/**`
  - `apps/desktop/src/**`
  - `crates/**`
  - `scripts/**`
  - `.github/**`

Verification command:
- `git diff --name-only 3f808bd -- apps/desktop/src-tauri apps/desktop/src crates scripts .github`
- Result: no changed files.

---

## Step 1 - Stale Path Grep Sweep (with classification)

Search patterns (exactly requested) were run for:
- `"requirements/"`
- `"docs/"`
- `"REview_folder/"`
- `"review_folder/"`
- `"GUI_Test_Report"`
- `"THEORY_OF_OPERATION"`
- `"GUI_BUTTON_INTENDED_BEHAVIOR"`
- `"/documentation"`
- `"/review"`
- `"tests/fixtures"`
- `"assets/"`
- `"planned_requests"`
- `"release_spec"`
- `"publisher_catalog"`
- `"artifacts/"`
- `"AppData/Local"`

### Findings

1. `requirements/`, `docs/`, `REview_folder/`, `GUI_Test_Report`, `THEORY_OF_OPERATION`, `GUI_BUTTON_INTENDED_BEHAVIOR`
- Matches found only in:
  - `documentation/**` (migrated docs)
  - `review/**` (cleanup report/review summaries)
- Classification: `SAFE` (non-runtime docs only)

2. Runtime-critical code/directories (`apps/**`, `crates/**`, `scripts/**`, `playwright/**`, `.github/**`)
- No active runtime references to moved doc folders:
  - no `requirements/` usage
  - no `docs/` usage
  - no `REview_folder/` usage
- Classification: `MUST FIX = none`

3. `planned_requests`, `release_spec`, `publisher_catalog`, `artifacts/`, `AppData/Local`
- Matches are expected and valid:
  - backend artifact pipeline (`planned_requests`, `release_spec.yaml`, `publisher_catalog_drafts`)
  - test assertions (`App.test.tsx`, Playwright)
- Classification: `SAFE`

4. `tests/fixtures`
- No matches.
- Classification: `SAFE`

### Conclusion of stale path sweep
- No stale runtime path reference was introduced by documentation/review folder moves.

---

## Step 2 - Tauri Command Registration vs Frontend Invoke

## A) Backend command functions (`#[tauri::command]`)
From `apps/desktop/src-tauri/src/commands.rs`:
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

## B) Registered in `invoke_handler![]`
From `apps/desktop/src-tauri/src/lib.rs`:
- all 18 commands above are present in `tauri::generate_handler![ ... ]`.

## C) Frontend invoke command names
From:
- `apps/desktop/src/tauri-api.ts`
- `apps/desktop/src/App.tsx`

Invoked command set exactly matches backend registered set.

### Command mismatch table
- Frontend command missing in backend: `none`
- Backend command unreferenced in frontend: `none`

## D) Timed-out command mapping requested by issue
- Folder picker:
  - Not a Tauri backend command in this codebase.
  - Implemented in frontend via `@tauri-apps/plugin-dialog` (`pickDirectoryDialog`).
- Add library root:
  - Frontend: `catalog_add_library_root`
  - Backend: `catalog_add_library_root` (registered)
- Import files:
  - Frontend: `catalog_import_files`
  - Backend: `catalog_import_files` (registered)
- Scan folders:
  - Frontend: `catalog_scan_root`
  - Backend: `catalog_scan_root` (registered)

---

## Step 3 - Deadlock / Event Loop Blocking Audit

Searches run for:
- `std::sync::Mutex`, `RwLock`, `tokio::sync::Mutex`, `.lock().unwrap()`
- blocking I/O patterns (`std::fs`, `walkdir`, etc.)
- lock usage across await

### Findings

1. Mutex/RwLock in production command paths
- No problematic mutex usage in desktop runtime command paths.
- `.lock()` usage found only in tests/testkit.

2. Blocking filesystem operations
- `collect_supported_audio_files_recursive` uses `std::fs::read_dir`, but it is called through:
  - `tokio::task::spawn_blocking(...)`
- This is correct and does not block the async runtime thread.

3. Command response guarantees
- `catalog_scan_root` returns immediately with `job_id` and spawns background job (`tokio::spawn`).
- `catalog_add_library_root` and `catalog_import_files` are direct async handlers with explicit return paths.
- No handler found that spawns work and forgets to return IPC response.

### Deadlock/blocking suspects
- `none` found attributable to cleanup diff.

---

## Step 4 - Tauri Dialog Capabilities and Plugin Wiring

Checked files:
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/capabilities/default.json`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/package.json`
- `apps/desktop/src-tauri/Cargo.toml`

### Findings
- Dialog plugin is initialized: `.plugin(tauri_plugin_dialog::init())`
- Frontend has dependency: `@tauri-apps/plugin-dialog`
- Rust has dependency: `tauri-plugin-dialog = "2"`
- Capability includes dialog permission: `"dialog:default"`

Result:
- No dialog permission regression was introduced by the docs/review cleanup.

---

## Step 5 - Runtime Path Resolution Checks

Checked for runtime loaders of moved folders/docs:
- `include_str!`, `include_bytes!`
- `read_to_string` / file reads using hardcoded moved paths
- spec loader, planned request templates, onboarding/help loaders

### Findings
- No runtime path resolution logic references old moved folders (`docs/`, `requirements/`, `REview_folder/`).
- Runtime uses:
  - user-provided file paths (spec/media import)
  - app data dir (`LOCALAPPDATA/ReleasePublisher`)
  - artifacts folder under runtime base dir
- No broken old->new runtime path mapping found.

Broken runtime paths:
- `none found`

---

## Step 6 - Minimal Fix List

## A) Command mismatch list
- `none`

## B) Broken runtime paths
- `none`

## C) Deadlock/blocking suspects
- `none caused by cleanup`

## D) Proposed minimal patches (no refactor)
1. **No path/registration patch required** for cleanup changes.
2. Add a runtime smoke gate (recommended) to catch future regressions:
   - verify `pickDirectoryDialog` resolves quickly
   - verify `catalog_add_library_root` returns
   - verify `catalog_import_files` returns
   - verify `catalog_scan_root` returns a job id
3. If running binary still reports `BACKEND_TIMEOUT` strings:
   - rebuild from clean state; those strings are not present in current source tree.

---

## Step 7 - Validation

What was validated:
- `cargo test -p release-publisher-desktop --lib` executed successfully.
- 46/46 tests passed, including catalog command tests:
  - import/list/get/update
  - add/remove roots
  - scan root job dispatch/progress

GUI click smoke (`Browse`, `Add Root`, `Import`) could not be performed in this terminal-only environment.

---

## Root Cause (short)

The docs/review cleanup did **not** introduce runtime path or IPC binding breaks. No backend command registrations changed, no frontend invoke names mismatched, and no runtime code references the moved `docs/`/`requirements/`/`REview_folder/` paths. The observed `BACKEND_TIMEOUT` behavior is therefore not caused by these folder moves; it is more consistent with running a stale build/runtime binary or an external runtime environment issue outside this cleanup diff.

