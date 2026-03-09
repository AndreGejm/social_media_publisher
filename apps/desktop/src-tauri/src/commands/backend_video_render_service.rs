use super::*;

mod runtime;

pub(crate) use runtime::{
    VideoRenderCancelResponse, VideoRenderDiagnosticsResponse, VideoRenderOpenOutputFolderResponse,
    VideoRenderProgressSnapshot, VideoRenderRequest, VideoRenderResultResponse,
    VideoRenderSourcePathCheckResponse, VideoRenderStartResponse, VideoRenderValidateResponse,
};

pub(crate) fn video_render_validate(
    request: VideoRenderRequest,
) -> Result<VideoRenderValidateResponse, AppError> {
    runtime::shared_video_render_runtime().validate_request(request)
}

pub(crate) fn video_render_start(
    request: VideoRenderRequest,
) -> Result<VideoRenderStartResponse, AppError> {
    runtime::shared_video_render_runtime().start_render(request)
}

pub(crate) fn video_render_status(job_id: String) -> Result<VideoRenderProgressSnapshot, AppError> {
    runtime::shared_video_render_runtime().get_render_status(&job_id)
}

pub(crate) fn video_render_cancel(job_id: String) -> Result<VideoRenderCancelResponse, AppError> {
    runtime::shared_video_render_runtime().cancel_render(&job_id)
}

pub(crate) fn video_render_result(job_id: String) -> Result<VideoRenderResultResponse, AppError> {
    runtime::shared_video_render_runtime().get_render_result(&job_id)
}

pub(crate) fn video_render_get_environment_diagnostics(
    output_directory_path: Option<String>,
) -> Result<VideoRenderDiagnosticsResponse, AppError> {
    runtime::shared_video_render_runtime().get_environment_diagnostics(output_directory_path.as_deref())
}

pub(crate) fn video_render_check_source_path(
    source_path: String,
) -> Result<VideoRenderSourcePathCheckResponse, AppError> {
    runtime::shared_video_render_runtime().check_source_path(&source_path)
}

pub(crate) fn video_render_open_output_folder(
    output_file_path: String,
) -> Result<VideoRenderOpenOutputFolderResponse, AppError> {
    runtime::shared_video_render_runtime().open_output_folder(&output_file_path)
}
