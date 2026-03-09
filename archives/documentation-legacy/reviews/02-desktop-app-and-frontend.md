# Desktop App And Frontend Function Review

## Tauri Entrypoints

### `apps/desktop/src-tauri/src/lib.rs`

- `run` (`apps/desktop/src-tauri/src/lib.rs:5`): initializes tracing subscriber (best-effort), builds Tauri app with command handler allowlist (`load_spec`, `plan_release`, `execute_release`, `list_history`, `get_report`), and exits process on fatal runtime startup error.

### `apps/desktop/src-tauri/src/main.rs`

- `main` (`apps/desktop/src-tauri/src/main.rs:1`): thin binary entrypoint delegating to `release_publisher_desktop_lib::run()`.

### `apps/desktop/src-tauri/build.rs`

- `main` (`apps/desktop/src-tauri/build.rs:1`): build-script entrypoint invoking `tauri_build::build()`.

## Tauri Command Layer (`apps/desktop/src-tauri/src/commands.rs`)

### `AppError` constructors and conversions

- `AppError::new` (`apps/desktop/src-tauri/src/commands.rs:87`): base UI-facing error constructor with optional `details` defaulting to `None`.
- `AppError::with_details` (`apps/desktop/src-tauri/src/commands.rs:95`): builder-style setter for structured `details`.
- `AppError::invalid_argument` (`apps/desktop/src-tauri/src/commands.rs:100`): standardized invalid-input error code.
- `AppError::file_read_failed` (`apps/desktop/src-tauri/src/commands.rs:104`): standardized filesystem read/stat/canonicalize failure code.
- `AppError::invalid_encoding` (`apps/desktop/src-tauri/src/commands.rs:108`): standardized UTF-8 decode failure code.
- `From<DbError> for AppError::from` (`apps/desktop/src-tauri/src/commands.rs:114`): maps typed DB errors to namespaced UI error codes and carries DB error code in `details`.
- `From<OrchestratorError> for AppError::from` (`apps/desktop/src-tauri/src/commands.rs:126`): converts core orchestration errors into UI-stable codes/messages and preserves cap metadata details when relevant.

### `CommandService` lifecycle and handlers

- `CommandService::from_default_location` (`apps/desktop/src-tauri/src/commands.rs:171`): resolves runtime data directory and delegates to `for_base_dir`.
- `CommandService::for_base_dir` (`apps/desktop/src-tauri/src/commands.rs:176`): creates runtime/artifacts directories and sqlite DB file, initializes DB + orchestrator (registering `MockPublisher`), and prepares in-memory planned-release cache.
- `CommandService::handle_load_spec` (`apps/desktop/src-tauri/src/commands.rs:212`): canonicalizes/validates spec path, reads UTF-8 file, parses YAML spec, and returns success or structured validation errors while still reporting canonical path.
- `CommandService::handle_plan_release` (`apps/desktop/src-tauri/src/commands.rs:237`): canonicalizes spec/media paths, reads files, validates spec, calls orchestrator plan phase, flattens planned actions for UI, stores planned release in session cache keyed by `release_id`.
- `CommandService::handle_execute_release` (`apps/desktop/src-tauri/src/commands.rs:289`): requires non-empty release ID and a previously planned release in current app session, executes via orchestrator, and returns status/report path summary.
- `CommandService::handle_list_history` (`apps/desktop/src-tauri/src/commands.rs:317`): converts DB history rows into UI DTOs.
- `CommandService::handle_get_report` (`apps/desktop/src-tauri/src/commands.rs:330`): loads release report artifact JSON if present, decodes both typed and raw forms, and returns a UI-oriented summary/action list plus raw JSON.

### Command-layer helpers

- `resolve_runtime_base_dir` (`apps/desktop/src-tauri/src/commands.rs:386`): selects runtime data root using `RELEASE_PUBLISHER_DATA_DIR`, Windows `LOCALAPPDATA`, or cwd fallback, memoized with `OnceLock`.
- `sqlite_url_for_path` (`apps/desktop/src-tauri/src/commands.rs:404`): converts a filesystem path into a sqlite URL with Windows drive normalization.
- `db_error_code_name` (`apps/desktop/src-tauri/src/commands.rs:415`): maps DB error enum to lowercase stable name used in `AppError` codes.
- `shared_service` (`apps/desktop/src-tauri/src/commands.rs:432`): lazily initializes a process-wide `CommandService` singleton via `tokio::sync::OnceCell`.
- `path_to_string` (`apps/desktop/src-tauri/src/commands.rs:440`): normalizes path separators for UI strings.
- `reject_odd_prefixes` (`apps/desktop/src-tauri/src/commands.rs:444`): blocks unsafe/unsupported path prefixes (`file://`, extended/device paths, UNC/network paths) and empty input.
- `canonicalize_file_path` (`apps/desktop/src-tauri/src/commands.rs:468`): path canonicalization + metadata check wrapper that enforces “must be file” and maps fs errors to `AppError`.
- `flatten_planned_actions` (`apps/desktop/src-tauri/src/commands.rs:485`): converts orchestrator per-platform action map into a flat UI list.
- `From<AppEnv> for ExecutionEnvironment::from` (`apps/desktop/src-tauri/src/commands.rs:499`): converts UI env enum to core env enum.

### Tauri command exports

- `load_spec` (`apps/desktop/src-tauri/src/commands.rs:509`): Tauri command wrapper forwarding to shared `CommandService`.
- `plan_release` (`apps/desktop/src-tauri/src/commands.rs:514`): Tauri command wrapper forwarding plan requests.
- `execute_release` (`apps/desktop/src-tauri/src/commands.rs:519`): Tauri command wrapper forwarding execute requests.
- `list_history` (`apps/desktop/src-tauri/src/commands.rs:527`): Tauri command wrapper forwarding history query.
- `get_report` (`apps/desktop/src-tauri/src/commands.rs:532`): Tauri command wrapper forwarding report query.

### Notes for external review (Tauri command layer)

- The execute endpoint currently depends on `planned_releases` in-memory session cache, meaning app restart invalidates pending plans by design (`PLANNED_RELEASE_NOT_FOUND` path).
- Path hardening is explicit and Windows-focused (`reject_odd_prefixes`) before filesystem canonicalization.
- Error mapping preserves typed DB/core semantics while presenting UI-stable string codes.

## React Frontend (`apps/desktop/src/App.tsx`)

### Utility and error helpers

- `invokeCommand` (`apps/desktop/src/App.tsx:53`): runtime bridge wrapper. Prefers injected `window.__TAURI__.core.invoke` (test/browser mocks), falls back to `@tauri-apps/api/core`, and normalizes non-Tauri failures into a structured `TAURI_UNAVAILABLE` UI error.
- `redactErrorDetails` (`apps/desktop/src/App.tsx:83`): recursive redactor for common secret-bearing keys before console logging backend error details.
- `normalizeAppError` (`apps/desktop/src/App.tsx:106`): converts unknown thrown values into `UiAppError`, preserving code/message/details only when shape matches expected contract.
- `formatSpecErrors` (`apps/desktop/src/App.tsx:116`): joins structured spec validation errors into compact human-readable status text.

### Main component and handlers

- `App` (`apps/desktop/src/App.tsx:122`): stateful workflow UI orchestrating load/plan/execute/history/report screens and delegating operations to Tauri commands.
- `setStructuredError` (local handler, `apps/desktop/src/App.tsx:148`): normalizes backend error, updates UI status, stores backend error state, and logs redacted details when present.
- `validatePathsAndPlatforms` (local handler, `apps/desktop/src/App.tsx:157`): synchronous form validation for required spec/media paths and at least one selected platform.
- `refreshHistory` (local handler, `apps/desktop/src/App.tsx:175`): loads history rows from backend, updates selection default, and manages loading state.
- `loadReportFor` (local handler, `apps/desktop/src/App.tsx:189`): fetches and stores report for a selected release ID (or clears report when empty).
- `onLoadSpec` (local handler, `apps/desktop/src/App.tsx:204`): validates spec path presence, invokes `load_spec`, stores normalized spec response, advances UI to plan screen, and updates status text.
- `onPlanPreview` (local handler, `apps/desktop/src/App.tsx:225`): validates form, invokes `plan_release`, stores plan result, resets execute result, updates status, and opportunistically refreshes history.
- `onExecute` (local handler, `apps/desktop/src/App.tsx:251`): chooses release ID from explicit arg/plan/history selection, calls `execute_release`, refreshes history/report, and navigates to report screen on success.
- `onRefreshHistory` (local handler, `apps/desktop/src/App.tsx:276`): explicit history refresh action with user-facing status/error handling.
- `onOpenReport` (local handler, `apps/desktop/src/App.tsx:288`): validates selected history item, loads report, and updates status with “found/not found” message.
- `onResume` (local handler, `apps/desktop/src/App.tsx:305`): resume shortcut that reuses `onExecute` for selected history release.

### UI behavior observations

- The UI correctly treats core/backend as source of truth for safety (messages repeatedly remind TEST mode is simulation-only).
- `selectedPlatforms` is derived from one checkbox (`mock`) and memoized; current UI intentionally limits available publishers.
- Backend errors and UI validation errors are kept separate (`uiError` vs `backendError`), which helps external reviewers evaluate failure-path clarity.

## Frontend Bootstrapping And Type Declarations

### `apps/desktop/src/main.tsx`

- No user-defined functions. The file mounts `<App />` into `#root` via `ReactDOM.createRoot`.

### `apps/desktop/src/tauri-api-core.d.ts`

- `invoke<T = unknown>` declaration (`apps/desktop/src/tauri-api-core.d.ts:2`): ambient type declaration for Tauri core `invoke` API used by TypeScript compile-time checking.

### `apps/desktop/src/test/setup.ts`

- No named functions. File is test harness setup (imports/bootstrapping only).
