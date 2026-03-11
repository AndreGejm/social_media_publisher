use super::*;
use crate::runtime_error_log;
use tauri::Emitter;

const RUNTIME_TEST_FILE_DROP_EVENT: &str = "skald://test-file-drop";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeLogErrorInput {
    pub source: String,
    pub message: String,
    pub details: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RuntimeTestFileDropPayload {
    paths: Vec<String>,
}

fn runtime_e2e_enabled() -> bool {
    std::env::var("RUN_TAURI_E2E")
        .map(|value| value.trim() == "1")
        .unwrap_or(false)
}

#[tauri::command]
pub async fn runtime_log_error(
    app: tauri::AppHandle,
    entry: RuntimeLogErrorInput,
) -> Result<(), AppError> {
    let source = entry.source.trim();
    let message = entry.message.trim();

    if source.is_empty() {
        return Err(AppError::invalid_argument(
            "runtime log source is required.",
        ));
    }

    if message.is_empty() {
        return Err(AppError::invalid_argument(
            "runtime log message is required.",
        ));
    }

    runtime_error_log::append_frontend_runtime_error(&app, source, message, entry.details)
        .map(|_| ())
        .map_err(|error| AppError::file_write_failed(error.to_string()))
}

#[tauri::command]
pub async fn runtime_get_error_log_path(app: tauri::AppHandle) -> Result<String, AppError> {
    runtime_error_log::resolve_runtime_error_log_path(&app)
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|error| AppError::file_write_failed(error.to_string()))
}

#[tauri::command]
pub async fn runtime_read_error_log_tail(
    app: tauri::AppHandle,
    max_bytes: Option<usize>,
) -> Result<String, AppError> {
    if !runtime_e2e_enabled() {
        return Err(AppError::feature_disabled(
            "runtime log tail access is available only during Tauri E2E runs.",
        ));
    }

    let path = runtime_error_log::resolve_runtime_error_log_path(&app)
        .map_err(|error| AppError::file_read_failed(error.to_string()))?;
    runtime_error_log::read_runtime_error_log_tail(&path, max_bytes)
        .map_err(|error| AppError::file_read_failed(error.to_string()))
}

#[tauri::command]
pub async fn runtime_emit_test_file_drop(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<(), AppError> {
    if !runtime_e2e_enabled() {
        return Err(AppError::feature_disabled(
            "runtime test file-drop bridge is available only during Tauri E2E runs.",
        ));
    }

    let sanitized_paths = paths
        .into_iter()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
        .collect::<Vec<_>>();
    if sanitized_paths.is_empty() {
        return Err(AppError::invalid_argument(
            "paths must include at least one dropped file path.",
        ));
    }

    app.emit(
        RUNTIME_TEST_FILE_DROP_EVENT,
        RuntimeTestFileDropPayload {
            paths: sanitized_paths,
        },
    )
    .map_err(|error| AppError::file_write_failed(error.to_string()))
}
