use super::*;

#[tauri::command]
pub async fn set_volume(level: f32) -> Result<(), AppError> {
    if !level.is_finite() || level < 0.0 {
        return Err(AppError::invalid_argument("volume level must be finite and >= 0.0"));
    }
    backend_audio_service::set_volume(level)
}

#[tauri::command]
pub async fn set_playback_queue(paths: Vec<String>) -> Result<PlaybackQueueState, AppError> {
    backend_audio_service::set_playback_queue(paths)
}

#[tauri::command]
pub async fn push_track_change_request(new_index: u32) -> Result<bool, AppError> {
    backend_audio_service::push_track_change_request(new_index)
}

#[tauri::command]
pub async fn set_playback_playing(is_playing: bool) -> Result<(), AppError> {
    backend_audio_service::set_playback_playing(is_playing)
}

#[tauri::command]
pub async fn seek_playback_ratio(ratio: f32) -> Result<(), AppError> {
    if !ratio.is_finite() || ratio < 0.0 || ratio > 1.0 {
        return Err(AppError::invalid_argument("seek ratio must be finite and between 0.0 and 1.0"));
    }
    backend_audio_service::seek_playback_ratio(ratio)
}

#[tauri::command]
pub async fn toggle_queue_visibility() -> Result<(), AppError> {
    backend_audio_service::toggle_queue_visibility();
    Ok(())
}

#[tauri::command]
pub async fn init_exclusive_device(
    target_rate_hz: u32,
    target_bit_depth: u16,
    prefer_exclusive: Option<bool>,
) -> Result<AudioHardwareState, AppError> {
    backend_audio_service::init_exclusive_device(target_rate_hz, target_bit_depth, prefer_exclusive)
}

#[tauri::command]
pub async fn acquire_audio_device_lock(
    target_rate_hz: u32,
    target_bit_depth: u16,
    prefer_exclusive: bool,
) -> Result<AudioHardwareState, AppError> {
    backend_audio_service::acquire_audio_device_lock(
        target_rate_hz,
        target_bit_depth,
        prefer_exclusive,
    )
}

#[tauri::command]
pub async fn release_audio_device_lock() -> Result<(), AppError> {
    backend_audio_service::release_audio_device_lock()
}

#[tauri::command]
pub async fn get_audio_device_context() -> Result<AudioDeviceContext, AppError> {
    backend_audio_service::get_audio_device_context()
}

#[tauri::command]
pub async fn get_playback_context() -> Result<PlaybackContextState, AppError> {
    Ok(backend_audio_service::get_playback_context())
}

#[tauri::command]
pub async fn get_playback_decode_error() -> Result<Option<String>, AppError> {
    Ok(backend_audio_service::get_playback_decode_error())
}
