use tauri_build::{AppManifest, Attributes};

const APP_COMMANDS: &[&str] = &[
    "load_spec",
    "plan_release",
    "execute_release",
    "list_history",
    "get_report",
    "analyze_audio_file",
    "analyze_and_persist_release_track",
    "get_release_track_analysis",
    "init_exclusive_device",
    "set_volume",
    "set_playback_queue",
    "push_track_change_request",
    "set_playback_playing",
    "seek_playback_ratio",
    "toggle_queue_visibility",
    "get_playback_context",
    "get_playback_decode_error",
    "qc_get_feature_flags",
    "qc_list_codec_profiles",
    "qc_prepare_preview_session",
    "qc_get_preview_session",
    "qc_set_preview_variant",
    "qc_reveal_blind_x",
    "qc_get_active_preview_media",
    "qc_start_batch_export",
    "qc_get_batch_export_job_status",
    "catalog_import_files",
    "catalog_list_tracks",
    "catalog_get_track",
    "publisher_create_draft_from_track",
    "catalog_update_track_metadata",
    "catalog_add_library_root",
    "catalog_list_library_roots",
    "catalog_remove_library_root",
    "catalog_reset_library_data",
    "catalog_scan_root",
    "catalog_get_ingest_job",
    "catalog_cancel_ingest_job",
];

fn main() {
    let attributes = Attributes::new().app_manifest(AppManifest::new().commands(APP_COMMANDS));

    if let Err(error) = tauri_build::try_build(attributes) {
        println!("{error:#}");
        std::process::exit(1);
    }
}
