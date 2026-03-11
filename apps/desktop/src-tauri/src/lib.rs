#![deny(warnings)]

//! Tauri desktop application bootstrap and command registration.

mod commands;
mod runtime_error_log;

/// Boots the Tauri desktop application and registers the audited IPC command surface.
pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            runtime_error_log::initialize(app.handle());
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::load_spec,
            commands::plan_release,
            commands::execute_release,
            commands::list_history,
            commands::get_report,
            commands::analyze_audio_file,
            commands::analyze_and_persist_release_track,
            commands::get_release_track_analysis,
            commands::runtime_log_error,
            commands::runtime_get_error_log_path,
            commands::init_exclusive_device,
            commands::acquire_audio_device_lock,
            commands::release_audio_device_lock,
            commands::get_audio_device_context,
            commands::set_volume,
            commands::set_playback_queue,
            commands::push_track_change_request,
            commands::set_playback_playing,
            commands::seek_playback_ratio,
            commands::toggle_queue_visibility,
            commands::get_playback_context,
            commands::get_playback_decode_error,
            commands::video_render_validate,
            commands::video_render_start,
            commands::video_render_status,
            commands::video_render_cancel,
            commands::video_render_result,
            commands::video_render_get_environment_diagnostics,
            commands::video_render_check_source_path,
            commands::video_render_open_output_folder,
            commands::qc_get_feature_flags,
            commands::qc_list_codec_profiles,
            commands::qc_prepare_preview_session,
            commands::qc_get_preview_session,
            commands::qc_set_preview_variant,
            commands::qc_reveal_blind_x,
            commands::qc_get_active_preview_media,
            commands::qc_start_batch_export,
            commands::qc_get_batch_export_job_status,
            commands::catalog_import_files,
            commands::catalog_list_tracks,
            commands::catalog_get_track,
            commands::publisher_create_draft_from_track,
            commands::catalog_update_track_metadata,
            commands::catalog_add_library_root,
            commands::catalog_list_library_roots,
            commands::catalog_remove_library_root,
            commands::catalog_reset_library_data,
            commands::catalog_scan_root,
            commands::catalog_get_ingest_job,
            commands::catalog_cancel_ingest_job
        ]);

    if let Err(error) = app.run(tauri::generate_context!()) {
        tracing::error!(target: "desktop", error = %error, "tauri application failed to run");
        std::process::exit(1);
    }
}
