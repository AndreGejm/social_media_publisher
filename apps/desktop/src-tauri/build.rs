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
    "catalog_import_files",
    "catalog_list_tracks",
    "catalog_get_track",
    "publisher_create_draft_from_track",
    "catalog_update_track_metadata",
    "catalog_add_library_root",
    "catalog_list_library_roots",
    "catalog_remove_library_root",
    "catalog_scan_root",
    "catalog_get_ingest_job",
];

fn main() {
    let attributes = Attributes::new().app_manifest(AppManifest::new().commands(APP_COMMANDS));

    if let Err(error) = tauri_build::try_build(attributes) {
        println!("{error:#}");
        std::process::exit(1);
    }
}
