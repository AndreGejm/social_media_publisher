use super::*;
use crate::runtime_error_log;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeLogErrorInput {
    pub source: String,
    pub message: String,
    pub details: Option<Value>,
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

    runtime_error_log::append_frontend_runtime_error(
        &app,
        source,
        message,
        entry.details,
    )
    .map(|_| ())
    .map_err(|error| AppError::file_write_failed(error.to_string()))
}

#[tauri::command]
pub async fn runtime_get_error_log_path(app: tauri::AppHandle) -> Result<String, AppError> {
    runtime_error_log::resolve_runtime_error_log_path(&app)
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|error| AppError::file_write_failed(error.to_string()))
}
