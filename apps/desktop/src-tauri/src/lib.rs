#![deny(warnings)]

//! Tauri desktop application bootstrap and command registration.

mod commands;

use tracing_subscriber::{fmt, EnvFilter};

/// Boots the Tauri desktop application and registers the audited IPC command surface.
pub fn run() {
    let _ = fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_target(false)
        .try_init();

    let app = tauri::Builder::default()
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
        commands::init_exclusive_device,
        commands::set_volume,
        commands::set_playback_queue,
        commands::push_track_change_request,
        commands::toggle_queue_visibility,
        commands::get_playback_context,
        commands::get_playback_decode_error,
        commands::catalog_import_files,
        commands::catalog_list_tracks,
        commands::catalog_get_track,
        commands::publisher_create_draft_from_track,
        commands::catalog_update_track_metadata,
        commands::catalog_add_library_root,
        commands::catalog_list_library_roots,
        commands::catalog_remove_library_root,
        commands::catalog_scan_root,
        commands::catalog_get_ingest_job
    ]);

    if let Err(error) = app.run(tauri::generate_context!()) {
        tracing::error!(target: "desktop", error = %error, "tauri application failed to run");
        std::process::exit(1);
    }
}
