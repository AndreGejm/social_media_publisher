use super::*;

mod runtime;

#[cfg(test)]
pub(crate) use runtime::{
    append_interleaved_to_stereo_f32, resample_stereo_interleaved_frames,
    validate_audio_format_boundary, write_pcm_stereo_frame, AudioFormatBoundary,
    PlaybackControlPlane,
};

pub(crate) fn init_exclusive_device(
    target_rate_hz: u32,
    target_bit_depth: u16,
    prefer_exclusive: Option<bool>,
) -> Result<AudioHardwareState, AppError> {
    runtime::shared_playback_control().acquire_audio_device_lock(
        target_rate_hz,
        target_bit_depth,
        prefer_exclusive.unwrap_or(true),
    )
}

pub(crate) fn acquire_audio_device_lock(
    target_rate_hz: u32,
    target_bit_depth: u16,
    prefer_exclusive: bool,
) -> Result<AudioHardwareState, AppError> {
    runtime::shared_playback_control().acquire_audio_device_lock(
        target_rate_hz,
        target_bit_depth,
        prefer_exclusive,
    )
}

pub(crate) fn release_audio_device_lock() -> Result<(), AppError> {
    runtime::shared_playback_control().release_audio_device_lock()
}

pub(crate) fn get_audio_device_context() -> Result<AudioDeviceContext, AppError> {
    runtime::shared_playback_control().get_audio_device_context()
}

pub(crate) fn set_volume(level: f32) -> Result<(), AppError> {
    runtime::shared_playback_control().set_volume(level)
}

pub(crate) fn set_playback_queue(paths: Vec<String>) -> Result<PlaybackQueueState, AppError> {
    runtime::shared_playback_control().set_playback_queue(paths)
}

pub(crate) fn push_track_change_request(new_index: u32) -> Result<bool, AppError> {
    runtime::shared_playback_control().push_track_change_request(new_index)
}

pub(crate) fn set_playback_playing(is_playing: bool) -> Result<(), AppError> {
    runtime::shared_playback_control().set_playback_playing(is_playing)
}

pub(crate) fn seek_playback_ratio(ratio: f32) -> Result<(), AppError> {
    runtime::shared_playback_control().seek_playback_ratio(ratio)
}

pub(crate) fn toggle_queue_visibility() {
    runtime::shared_playback_control().toggle_queue_visibility();
}

pub(crate) fn get_playback_context() -> PlaybackContextState {
    runtime::shared_playback_control().context_state()
}

pub(crate) fn get_playback_decode_error() -> Option<String> {
    runtime::shared_playback_control().decode_error()
}
