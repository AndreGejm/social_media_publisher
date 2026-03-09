use super::*;

#[tauri::command]
pub async fn video_render_validate(
    request: backend_video_render_service::VideoRenderRequest,
) -> Result<backend_video_render_service::VideoRenderValidateResponse, AppError> {
    backend_video_render_service::video_render_validate(request)
}

#[tauri::command]
pub async fn video_render_start(
    request: backend_video_render_service::VideoRenderRequest,
) -> Result<backend_video_render_service::VideoRenderStartResponse, AppError> {
    backend_video_render_service::video_render_start(request)
}

#[tauri::command]
pub async fn video_render_status(
    job_id: String,
) -> Result<backend_video_render_service::VideoRenderProgressSnapshot, AppError> {
    backend_video_render_service::video_render_status(job_id)
}

#[tauri::command]
pub async fn video_render_cancel(
    job_id: String,
) -> Result<backend_video_render_service::VideoRenderCancelResponse, AppError> {
    backend_video_render_service::video_render_cancel(job_id)
}

#[tauri::command]
pub async fn video_render_result(
    job_id: String,
) -> Result<backend_video_render_service::VideoRenderResultResponse, AppError> {
    backend_video_render_service::video_render_result(job_id)
}

#[tauri::command]
pub async fn video_render_get_environment_diagnostics(
    output_directory_path: Option<String>,
) -> Result<backend_video_render_service::VideoRenderDiagnosticsResponse, AppError> {
    backend_video_render_service::video_render_get_environment_diagnostics(output_directory_path)
}

#[tauri::command]
pub async fn video_render_check_source_path(
    source_path: String,
) -> Result<backend_video_render_service::VideoRenderSourcePathCheckResponse, AppError> {
    backend_video_render_service::video_render_check_source_path(source_path)
}

#[tauri::command]
pub async fn video_render_open_output_folder(
    output_file_path: String,
) -> Result<backend_video_render_service::VideoRenderOpenOutputFolderResponse, AppError> {
    backend_video_render_service::video_render_open_output_folder(output_file_path)
}
