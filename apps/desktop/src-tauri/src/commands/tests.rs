
use super::*;
use release_publisher_core::secrets::{
    InMemorySecretStore, SecretRecord, SecretStore, SecretValue,
};
use tempfile::tempdir;

async fn new_service() -> (CommandService, tempfile::TempDir) {
    let dir = tempdir().expect("tempdir");
    let service = CommandService::for_base_dir(dir.path().join("runtime"))
        .await
        .expect("service");
    (service, dir)
}

async fn write_fixture_files(dir: &Path) -> (String, String) {
    let spec_path = dir.join("spec.yaml");
    let media_path = dir.join("media.bin");
    tokio::fs::write(
        &spec_path,
        br#"title: "Test"
artist: "Artist"
description: "Desc"
tags: ["mock"]"#,
    )
    .await
    .expect("write spec");
    tokio::fs::write(&media_path, b"media-bytes")
        .await
        .expect("write media");
    (
        spec_path.to_string_lossy().to_string(),
        media_path.to_string_lossy().to_string(),
    )
}

#[test]
fn playback_control_volume_unity_enables_bit_perfect_bypass() {
    let control = PlaybackControlPlane::new();
    control
        .set_volume(UNITY_GAIN_LEVEL)
        .expect("set unity gain");
    let state = control.context_state();
    assert_eq!(state.volume_scalar, UNITY_GAIN_LEVEL);
    assert!(state.is_bit_perfect_bypassed);
}

#[test]
fn playback_control_volume_attenuation_disables_bit_perfect_bypass() {
    let control = PlaybackControlPlane::new();
    control.set_volume(0.5).expect("set attenuated volume");
    let state = control.context_state();
    assert_eq!(state.volume_scalar, 0.5);
    assert!(!state.is_bit_perfect_bypassed);
}

#[test]
fn playback_control_rejects_invalid_volume_values() {
    let control = PlaybackControlPlane::new();
    let err = control
        .set_volume(f32::NAN)
        .expect_err("NaN volume must be rejected");
    assert_eq!(err.code, app_error_codes::PLAYBACK_INVALID_VOLUME);
}

#[test]
fn playback_control_invalid_volume_error_wire_shape_is_stable() {
    let control = PlaybackControlPlane::new();
    let err = control
        .set_volume(1.5)
        .expect_err("out-of-range volume must be rejected");
    assert_eq!(err.code, app_error_codes::PLAYBACK_INVALID_VOLUME);
    assert_eq!(
        err.message,
        "volume level must be a finite float between 0.0 and 1.0"
    );

    let wire = serde_json::to_value(&err).expect("serialize AppError");
    assert_app_error_wire_top_level_shape(&wire);
    assert_eq!(wire["code"], app_error_codes::PLAYBACK_INVALID_VOLUME);
    assert_eq!(
        wire["message"],
        "volume level must be a finite float between 0.0 and 1.0"
    );
    assert!(wire["details"].is_null());
}

#[test]
fn playback_control_requires_armed_track_before_playing() {
    let control = PlaybackControlPlane::new();
    let err = control
        .set_playback_playing(true)
        .expect_err("playing without armed track must fail");
    assert_eq!(err.code, app_error_codes::PLAYBACK_QUEUE_REQUEST_REJECTED);
}

#[test]
fn playback_control_start_playing_arms_pending_track_change_inline() {
    let control = PlaybackControlPlane::new();
    let dir = tempdir().expect("tempdir");
    let wav_path = dir.path().join("inline-arm.wav");
    std::fs::write(&wav_path, pcm16_wav_sine_bytes(48_000, 250, 440.0, 0.25))
        .expect("write wav fixture");

    {
        let mut guard = control
            .hardware_state
            .write()
            .expect("hardware_state write lock");
        *guard = Some(AudioHardwareState {
            sample_rate_hz: 48_000,
            bit_depth: 16,
            buffer_size_frames: 480,
            is_exclusive_lock: false,
        });
    }
    control
        .set_playback_queue(vec![wav_path.to_string_lossy().to_string()])
        .expect("set playback queue");
    assert!(
        control
            .push_track_change_request(0)
            .expect("queue request should succeed"),
        "track-change request should be accepted"
    );

    control
        .set_playback_playing(true)
        .expect("playing should arm and start from pending track-change");
    assert!(control.context_state().is_playing);
    assert!(control.current_decoded_track().is_some());
}

#[test]
fn playback_control_seek_ratio_rejects_out_of_range_values() {
    let control = PlaybackControlPlane::new();
    let err = control
        .seek_playback_ratio(1.5)
        .expect_err("seek ratio above 1.0 must fail");
    assert_eq!(err.code, app_error_codes::INVALID_ARGUMENT);
}

#[test]
fn playback_control_invalid_seek_ratio_error_wire_shape_is_stable() {
    let control = PlaybackControlPlane::new();
    let err = control
        .seek_playback_ratio(f32::NAN)
        .expect_err("non-finite seek ratio must fail");
    assert_eq!(err.code, app_error_codes::INVALID_ARGUMENT);
    assert_eq!(
        err.message,
        "seek ratio must be a finite float between 0.0 and 1.0"
    );

    let wire = serde_json::to_value(&err).expect("serialize AppError");
    assert_app_error_wire_top_level_shape(&wire);
    assert_eq!(wire["code"], app_error_codes::INVALID_ARGUMENT);
    assert_eq!(
        wire["message"],
        "seek ratio must be a finite float between 0.0 and 1.0"
    );
    assert!(wire["details"].is_null());
}

#[test]
fn playback_control_applies_track_change_requests_on_worker_thread() {
    let control = PlaybackControlPlane::new();
    assert!(
        control
            .push_track_change_request(4)
            .expect("queue request should be accepted"),
        "track-change queue should accept request"
    );

    for _ in 0..100 {
        if control.context_state().active_queue_index == 4 {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(2));
    }

    panic!("worker did not apply track-change request in time");
}

#[test]
fn playback_control_toggle_queue_visibility_flips_ui_state() {
    let control = PlaybackControlPlane::new();
    assert!(!control.context_state().is_queue_ui_expanded);
    control.toggle_queue_visibility();
    assert!(control.context_state().is_queue_ui_expanded);
}

#[test]
fn playback_control_set_playback_queue_stores_non_empty_paths() {
    let control = PlaybackControlPlane::new();
    let state = control
        .set_playback_queue(vec![
            "\"C:\\\\audio\\\\one.wav\"".to_string(),
            "C:\\audio\\two.wav".to_string(),
            "   ".to_string(),
        ])
        .expect("queue set should succeed");
    assert_eq!(state.total_tracks, 2);
}

#[test]
fn playback_control_set_playback_queue_empty_clears_decode_error() {
    let control = PlaybackControlPlane::new();

    let _ = control
        .set_playback_queue(vec!["C:\\audio\\one.wav".to_string()])
        .expect("queue set should succeed");
    assert!(control.decode_error().is_none());

    let state = control
        .set_playback_queue(Vec::new())
        .expect("empty queue set should succeed");

    assert_eq!(state.total_tracks, 0);
    assert!(
        control.decode_error().is_none(),
        "empty queue should remain an idle non-error state"
    );
}

#[test]
fn playback_control_set_playback_queue_rejects_oversized_queue() {
    let control = PlaybackControlPlane::new();
    let oversized = (0..(MAX_PLAYBACK_QUEUE_TRACKS + 1))
        .map(|idx| format!("C:\\audio\\track-{idx}.wav"))
        .collect::<Vec<_>>();
    let error = control
        .set_playback_queue(oversized)
        .expect_err("oversized queue should fail");
    assert_eq!(error.code, app_error_codes::INVALID_ARGUMENT);
}

#[test]
fn append_interleaved_to_stereo_f32_preserves_left_right_order() {
    let mut out = Vec::new();
    append_interleaved_to_stereo_f32(&[1.0, -1.0, 0.5, -0.5], 2, &mut out);
    assert_eq!(out.len(), 4);
    assert_eq!(out[0], 1.0, "left sample should stay on left channel");
    assert_eq!(out[1], -1.0, "right sample should stay on right channel");
    assert_eq!(out[2], 0.5, "second frame left should stay on left channel");
    assert_eq!(
        out[3], -0.5,
        "second frame right should stay on right channel"
    );
}

#[test]
fn append_interleaved_to_stereo_f32_duplicates_mono_to_lr() {
    let mut out = Vec::new();
    append_interleaved_to_stereo_f32(&[0.25, -0.25], 1, &mut out);
    assert_eq!(out.len(), 4);
    assert_eq!(out[0], out[1], "mono frame must duplicate to L/R");
    assert_eq!(out[2], out[3], "mono frame must duplicate to L/R");
}

#[test]
fn write_pcm_stereo_frame_packs_16bit_little_endian() {
    let mut out = [0u8; 4];
    assert!(write_pcm_stereo_frame(&mut out, 0, 16, 0.5, -0.5));
    assert_eq!(out, [0x00, 0x40, 0x00, 0xC0]);
}

#[test]
fn write_pcm_stereo_frame_packs_24bit_little_endian() {
    let mut out = [0u8; 6];
    assert!(write_pcm_stereo_frame(&mut out, 0, 24, 0.5, -0.5));
    assert_eq!(out, [0x00, 0x00, 0x40, 0x00, 0x00, 0xC0]);
}

#[test]
fn write_pcm_stereo_frame_packs_32bit_little_endian() {
    let mut out = [0u8; 8];
    assert!(write_pcm_stereo_frame(&mut out, 0, 32, 0.5, -0.5));
    assert_eq!(out, [0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0xC0]);
}

#[test]
fn validate_audio_format_boundary_accepts_sample_rate_mismatch_for_src() {
    let boundary = AudioFormatBoundary {
        decoder_sample_rate: 44_100,
        decoder_channels: 2,
        decoder_is_interleaved: true,
        decoder_bit_depth: 32,
        dac_sample_rate: 48_000,
        dac_channels: 2,
        dac_requires_interleaved: true,
        dac_bit_depth: 16,
    };
    validate_audio_format_boundary(&boundary)
        .expect("sample-rate mismatch is now accepted for software SRC");
}

fn decode_plan_release_input_from_ipc_value_for_test(
    value: serde_json::Value,
) -> Result<PlanReleaseInput, AppError> {
    serde_json::from_value(value).map_err(|error| {
        AppError::invalid_argument(format!("invalid plan_release payload: {error}"))
    })
}

fn decode_catalog_list_tracks_input_from_ipc_value_for_test(
    value: serde_json::Value,
) -> Result<CatalogListTracksInput, AppError> {
    serde_json::from_value(value).map_err(|error| {
        AppError::invalid_argument(format!("invalid catalog_list_tracks payload: {error}"))
    })
}

fn decode_catalog_update_track_metadata_input_from_ipc_value_for_test(
    value: serde_json::Value,
) -> Result<CatalogUpdateTrackMetadataInput, AppError> {
    serde_json::from_value(value).map_err(|error| {
        AppError::invalid_argument(format!(
            "invalid catalog_update_track_metadata payload: {error}"
        ))
    })
}

#[test]
fn parse_env_flag_bool_supports_expected_tokens() {
    assert_eq!(parse_env_flag_bool("1"), Some(true));
    assert_eq!(parse_env_flag_bool("TRUE"), Some(true));
    assert_eq!(parse_env_flag_bool(" yes "), Some(true));
    assert_eq!(parse_env_flag_bool("on"), Some(true));
    assert_eq!(parse_env_flag_bool("0"), Some(false));
    assert_eq!(parse_env_flag_bool("False"), Some(false));
    assert_eq!(parse_env_flag_bool(" no "), Some(false));
    assert_eq!(parse_env_flag_bool("off"), Some(false));
    assert_eq!(parse_env_flag_bool("maybe"), None);
}

#[test]
fn qc_codec_profile_registry_marks_profiles_unavailable_when_preview_disabled() {
    let flags = QcFeatureFlagsResponse {
        qc_codec_preview_v1: false,
        qc_realtime_meters_v1: false,
        qc_batch_export_v1: false,
    };
    let profiles = qc_codec_profile_registry(&flags);
    assert!(
        !profiles.is_empty(),
        "codec profile registry should not be empty"
    );
    assert!(
        profiles.iter().all(|profile| !profile.available),
        "profiles should be unavailable when preview feature is disabled"
    );
}

#[tokio::test]
async fn qc_prepare_preview_session_succeeds_with_default_feature_flags() {
    let session = qc_prepare_preview_session(QcPreparePreviewSessionInput {
        source_track_id: "a".repeat(64),
        profile_a_id: "spotify_vorbis_320".to_string(),
        profile_b_id: "apple_music_aac_256".to_string(),
        blind_x_enabled: false,
    })
    .await
    .expect("preview session should be enabled by default");
    assert_eq!(session.active_variant, QcPreviewVariant::Bypass);
    assert!(!session.blind_x_enabled);
    assert!(session.blind_x_revealed);
}

#[tokio::test]
async fn qc_get_active_preview_media_contract_success_wire_shape_is_stable() {
    let (service, dir) = new_service().await;
    let store = QcPreviewSessionStore::new();
    let source_path = dir.path().join("preview-source.wav");
    let codec_a_path = dir.path().join("preview-codec-a.ogg");
    let codec_b_path = dir.path().join("preview-codec-b.m4a");
    tokio::fs::write(&source_path, b"source")
        .await
        .expect("write source preview fixture");
    tokio::fs::write(&codec_a_path, b"codec-a")
        .await
        .expect("write codec-a preview fixture");
    tokio::fs::write(&codec_b_path, b"codec-b")
        .await
        .expect("write codec-b preview fixture");

    let session = QcPreviewSessionStateResponse {
        source_track_id: "b".repeat(64),
        active_variant: QcPreviewVariant::BlindX,
        profile_a_id: "spotify_vorbis_320".to_string(),
        profile_b_id: "apple_music_aac_256".to_string(),
        blind_x_enabled: true,
        blind_x_revealed: true,
    };
    let session_cache_key = qc_preview_session_cache_key(&session);
    store
        .set_state(session)
        .expect("store preview session state");
    store
        .set_media_state(QcPreviewSessionMediaState {
            session_cache_key,
            source_media_path: path_to_string(&source_path),
            codec_a_media_path: path_to_string(&codec_a_path),
            codec_b_media_path: path_to_string(&codec_b_path),
            blind_x_assignment: QcPreviewVariant::CodecB,
        })
        .expect("store reusable preview media state");

    let flags = QcFeatureFlagsResponse {
        qc_codec_preview_v1: true,
        qc_realtime_meters_v1: false,
        qc_batch_export_v1: true,
    };
    let response =
        qc_get_active_preview_media_with_dependencies(Arc::new(service), store.as_ref(), &flags)
            .await
            .expect("active preview media should resolve");
    assert_eq!(response.variant, QcPreviewVariant::BlindX);
    assert_eq!(response.media_path, path_to_string(&codec_b_path));
    assert_eq!(
        response.blind_x_resolved_variant,
        Some(QcPreviewVariant::CodecB)
    );

    let wire = serde_json::to_value(&response).expect("serialize preview media response");
    let object = wire
        .as_object()
        .expect("preview media response should serialize to object");
    let mut keys: Vec<_> = object.keys().cloned().collect();
    keys.sort();
    assert_eq!(
        keys,
        vec!["blind_x_resolved_variant", "media_path", "variant"]
    );
    assert_eq!(wire["variant"], "blind_x");
    assert_eq!(wire["blind_x_resolved_variant"], "codec_b");
}

#[tokio::test]
async fn qc_get_active_preview_media_contract_blind_x_hidden_masks_resolved_variant() {
    let (service, dir) = new_service().await;
    let store = QcPreviewSessionStore::new();
    let source_path = dir.path().join("preview-hidden-source.wav");
    let codec_a_path = dir.path().join("preview-hidden-codec-a.ogg");
    let codec_b_path = dir.path().join("preview-hidden-codec-b.m4a");
    tokio::fs::write(&source_path, b"source")
        .await
        .expect("write source preview fixture");
    tokio::fs::write(&codec_a_path, b"codec-a")
        .await
        .expect("write codec-a preview fixture");
    tokio::fs::write(&codec_b_path, b"codec-b")
        .await
        .expect("write codec-b preview fixture");

    let session = QcPreviewSessionStateResponse {
        source_track_id: "c".repeat(64),
        active_variant: QcPreviewVariant::BlindX,
        profile_a_id: "spotify_vorbis_320".to_string(),
        profile_b_id: "apple_music_aac_256".to_string(),
        blind_x_enabled: true,
        blind_x_revealed: false,
    };
    let session_cache_key = qc_preview_session_cache_key(&session);
    store
        .set_state(session)
        .expect("store preview session state");
    store
        .set_media_state(QcPreviewSessionMediaState {
            session_cache_key,
            source_media_path: path_to_string(&source_path),
            codec_a_media_path: path_to_string(&codec_a_path),
            codec_b_media_path: path_to_string(&codec_b_path),
            blind_x_assignment: QcPreviewVariant::CodecA,
        })
        .expect("store reusable preview media state");

    let flags = QcFeatureFlagsResponse {
        qc_codec_preview_v1: true,
        qc_realtime_meters_v1: false,
        qc_batch_export_v1: true,
    };
    let response =
        qc_get_active_preview_media_with_dependencies(Arc::new(service), store.as_ref(), &flags)
            .await
            .expect("active preview media should resolve");
    assert_eq!(response.variant, QcPreviewVariant::BlindX);
    assert_eq!(response.media_path, path_to_string(&codec_a_path));
    assert_eq!(response.blind_x_resolved_variant, None);
}

#[tokio::test]
async fn qc_get_active_preview_media_contract_missing_track_wire_shape_is_stable() {
    let (service, _dir) = new_service().await;
    let store = QcPreviewSessionStore::new();
    store
        .set_state(QcPreviewSessionStateResponse {
            source_track_id: "f".repeat(64),
            active_variant: QcPreviewVariant::Bypass,
            profile_a_id: "spotify_vorbis_320".to_string(),
            profile_b_id: "apple_music_aac_256".to_string(),
            blind_x_enabled: false,
            blind_x_revealed: true,
        })
        .expect("store preview session state");

    let flags = QcFeatureFlagsResponse {
        qc_codec_preview_v1: true,
        qc_realtime_meters_v1: false,
        qc_batch_export_v1: true,
    };
    let err =
        qc_get_active_preview_media_with_dependencies(Arc::new(service), store.as_ref(), &flags)
            .await
            .expect_err("missing catalog track should fail");
    assert_eq!(err.code, app_error_codes::INVALID_ARGUMENT);
    assert_eq!(err.message, "catalog source_track_id not found");

    let wire = serde_json::to_value(&err).expect("serialize AppError");
    assert_app_error_wire_top_level_shape(&wire);
    assert_eq!(wire["code"], "INVALID_ARGUMENT");
    assert_eq!(wire["message"], "catalog source_track_id not found");
    assert!(wire["details"].is_null());
}

#[test]
fn qc_feature_flag_defaults_enable_preview_and_batch_export() {
    let preview_default = std::hint::black_box(DEFAULT_QC_CODEC_PREVIEW_V1);
    let batch_export_default = std::hint::black_box(DEFAULT_QC_BATCH_EXPORT_V1);
    let realtime_default = std::hint::black_box(DEFAULT_QC_REALTIME_METERS_V1);
    assert!(
        preview_default,
        "codec preview should be enabled by default"
    );
    assert!(
        batch_export_default,
        "batch export should be enabled by default"
    );
    assert!(
        !realtime_default,
        "realtime meters should remain disabled by default"
    );
}

#[tokio::test]
async fn qc_start_batch_export_never_reports_passthrough_copy_as_success() {
    let (service, dir) = new_service().await;
    let source_wav = write_wav_fixture_file(dir.path(), "batch-source.wav").await;
    let imported = service
        .handle_catalog_import_files(vec![source_wav])
        .await
        .expect("import source track");
    let source_track_id = imported
        .imported
        .first()
        .expect("import should contain one track")
        .track_id
        .clone();

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after epoch")
        .as_millis();
    let output_dir = std::env::current_dir()
        .expect("cwd")
        .join(format!(".tmp-qc-batch-exports-{now_ms}"));
    let output_dir_input = output_dir
        .to_string_lossy()
        .to_string()
        .replace(r"\\?\", "")
        .replace("//?/", "");
    let flags = QcFeatureFlagsResponse {
        qc_codec_preview_v1: true,
        qc_realtime_meters_v1: false,
        qc_batch_export_v1: true,
    };

    let response = qc_start_batch_export_with_dependencies(
        Arc::new(service),
        &flags,
        QcBatchExportStartInput {
            source_track_id: source_track_id.clone(),
            profile_ids: vec![
                "spotify_vorbis_320".to_string(),
                "legacy_mp3_320".to_string(),
            ],
            output_dir: output_dir_input,
            target_integrated_lufs: Some(-14.0),
        },
    )
    .await
    .expect("batch export should queue");
    assert_eq!(response.status, "queued");
    assert_eq!(response.job_id.len(), 64);

    let summary_path = qc_batch_export_summary_path(&output_dir, &response.job_id);
    for _ in 0..100 {
        if tokio::fs::try_exists(&summary_path)
            .await
            .expect("check summary path")
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }

    assert!(
        tokio::fs::try_exists(&summary_path)
            .await
            .expect("check summary path"),
        "summary artifact should exist"
    );

    let summary_bytes = tokio::fs::read(&summary_path)
        .await
        .expect("read summary artifact");
    let summary: QcBatchExportSummary =
        serde_json::from_slice(&summary_bytes).expect("decode summary artifact");
    assert_eq!(summary.job_id, response.job_id);
    assert_eq!(summary.source_track_id, source_track_id);
    assert_eq!(summary.profile_results.len(), 2);
    assert_eq!(
        summary.completed_profiles + summary.failed_profiles,
        summary.profile_results.len()
    );
    assert_eq!(
        summary.completed_profiles,
        summary
            .profile_results
            .iter()
            .filter(|entry| entry.status == "completed")
            .count()
    );
    assert_eq!(
        summary.failed_profiles,
        summary
            .profile_results
            .iter()
            .filter(|entry| entry.status == "failed")
            .count()
    );
    assert!(
        summary
            .profile_results
            .iter()
            .all(|entry| entry.status == "completed" || entry.status == "failed"),
        "profile results should only report explicit completed or failed outcomes"
    );
    assert!(
        summary
            .profile_results
            .iter()
            .all(|entry| !entry.message.to_ascii_lowercase().contains("passthrough")),
        "passthrough fallback messaging should not be emitted"
    );

    let _ = tokio::fs::remove_dir_all(&output_dir).await;
}

#[tokio::test]
async fn qc_get_batch_export_job_status_tracks_progress_until_terminal_state() {
    let (service, dir) = new_service().await;
    let source_wav = write_wav_fixture_file(dir.path(), "batch-status-source.wav").await;
    let imported = service
        .handle_catalog_import_files(vec![source_wav])
        .await
        .expect("import source track");
    let source_track_id = imported
        .imported
        .first()
        .expect("import should contain one track")
        .track_id
        .clone();

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after epoch")
        .as_millis();
    let output_dir = std::env::current_dir()
        .expect("cwd")
        .join(format!(".tmp-qc-batch-status-{now_ms}"));
    let output_dir_input = output_dir
        .to_string_lossy()
        .to_string()
        .replace(r"\\?\", "")
        .replace("//?/", "");
    let flags = QcFeatureFlagsResponse {
        qc_codec_preview_v1: true,
        qc_realtime_meters_v1: false,
        qc_batch_export_v1: true,
    };

    let response = qc_start_batch_export_with_dependencies(
        Arc::new(service),
        &flags,
        QcBatchExportStartInput {
            source_track_id,
            profile_ids: vec!["legacy_mp3_320".to_string()],
            output_dir: output_dir_input,
            target_integrated_lufs: Some(-14.0),
        },
    )
    .await
    .expect("batch export should queue");

    let initial = qc_get_batch_export_job_status(response.job_id.clone())
        .await
        .expect("status query should succeed")
        .expect("job should exist");
    assert_eq!(initial.total_profiles, 1);
    assert!([
        "queued",
        "running",
        "completed",
        "completed_with_errors",
        "failed"
    ]
    .contains(&initial.status.as_str()));

    let mut terminal = initial.clone();
    for _ in 0..120 {
        if ["completed", "completed_with_errors", "failed"].contains(&terminal.status.as_str()) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        terminal = qc_get_batch_export_job_status(response.job_id.clone())
            .await
            .expect("status query should succeed")
            .expect("job should exist");
    }

    assert!(
        ["completed", "completed_with_errors", "failed"].contains(&terminal.status.as_str()),
        "job should eventually reach a terminal status"
    );
    assert_eq!(terminal.progress_percent, 100);

    let _ = tokio::fs::remove_dir_all(&output_dir).await;
}

#[tokio::test]
async fn qc_get_feature_flags_reports_enabled_defaults_for_preview_and_batch_export() {
    let flags = qc_get_feature_flags()
        .await
        .expect("qc_get_feature_flags should succeed");
    assert!(flags.qc_codec_preview_v1);
    assert!(flags.qc_batch_export_v1);
    assert!(!flags.qc_realtime_meters_v1);
}

#[test]
fn qc_preview_session_store_round_trip_and_variant_updates() {
    let store = QcPreviewSessionStore::new();
    let session = QcPreviewSessionStateResponse {
        source_track_id: "a".repeat(64),
        active_variant: QcPreviewVariant::BlindX,
        profile_a_id: "spotify_vorbis_320".to_string(),
        profile_b_id: "apple_music_aac_256".to_string(),
        blind_x_enabled: true,
        blind_x_revealed: false,
    };

    let stored = store.set_state(session).expect("store preview session");
    assert_eq!(stored.active_variant, QcPreviewVariant::BlindX);
    assert!(!stored.blind_x_revealed);

    let revealed = store.reveal_blind_x().expect("reveal blind-x");
    assert!(revealed.blind_x_revealed);
    assert_eq!(revealed.active_variant, QcPreviewVariant::BlindX);

    let switched = store
        .set_active_variant(QcPreviewVariant::CodecA)
        .expect("set codec_a variant");
    assert_eq!(switched.active_variant, QcPreviewVariant::CodecA);
    assert!(switched.blind_x_revealed);
}

#[test]
fn qc_preview_session_store_rejects_invalid_state_transitions() {
    let store = QcPreviewSessionStore::new();

    let missing_err = store
        .set_active_variant(QcPreviewVariant::CodecA)
        .expect_err("variant update without session must fail");
    assert_eq!(missing_err.code, app_error_codes::INVALID_ARGUMENT);

    store
        .set_state(QcPreviewSessionStateResponse {
            source_track_id: "b".repeat(64),
            active_variant: QcPreviewVariant::Bypass,
            profile_a_id: "spotify_vorbis_320".to_string(),
            profile_b_id: "apple_music_aac_256".to_string(),
            blind_x_enabled: false,
            blind_x_revealed: true,
        })
        .expect("store non-blind session");

    let blind_variant_err = store
        .set_active_variant(QcPreviewVariant::BlindX)
        .expect_err("blind-x variant should fail when blind mode disabled");
    assert_eq!(blind_variant_err.code, app_error_codes::INVALID_ARGUMENT);

    let reveal_err = store
        .reveal_blind_x()
        .expect_err("blind-x reveal should fail when blind mode disabled");
    assert_eq!(reveal_err.code, app_error_codes::INVALID_ARGUMENT);
}

#[test]
fn qc_preview_session_store_set_state_clears_cached_media_state() {
    let store = QcPreviewSessionStore::new();
    store
        .set_media_state(QcPreviewSessionMediaState {
            session_cache_key: "cache-key".to_string(),
            source_media_path: "C:/media/source.wav".to_string(),
            codec_a_media_path: "C:/media/codec_a.ogg".to_string(),
            codec_b_media_path: "C:/media/codec_b.m4a".to_string(),
            blind_x_assignment: QcPreviewVariant::CodecA,
        })
        .expect("store preview media state");

    store
        .set_state(QcPreviewSessionStateResponse {
            source_track_id: "f".repeat(64),
            active_variant: QcPreviewVariant::Bypass,
            profile_a_id: "spotify_vorbis_320".to_string(),
            profile_b_id: "apple_music_aac_256".to_string(),
            blind_x_enabled: false,
            blind_x_revealed: true,
        })
        .expect("store preview session state");

    assert!(
        store.get_media_state().expect("read media state").is_none(),
        "preview media cache should reset when session changes"
    );
}

#[test]
fn qc_preview_blind_assignment_is_deterministic() {
    assert_eq!(
        qc_preview_blind_assignment("0abc1234"),
        QcPreviewVariant::CodecA
    );
    assert_eq!(
        qc_preview_blind_assignment("fabc1234"),
        QcPreviewVariant::CodecB
    );
    assert_eq!(
        qc_preview_blind_assignment("0abc1234"),
        QcPreviewVariant::CodecA
    );
}

async fn write_spec_file(dir: &Path, title: &str, artist: &str) -> String {
    let spec_path = dir.join("spec-audio.yaml");
    let spec = format!(
            "title: \"{title}\"\nartist: \"{artist}\"\ndescription: \"QC\"\ntags: [\"qc\", \"audio\"]\n"
        );
    tokio::fs::write(&spec_path, spec)
        .await
        .expect("write spec file");
    spec_path.to_string_lossy().to_string()
}

fn pcm16_wav_sine_bytes(
    sample_rate_hz: u32,
    duration_ms: u32,
    frequency_hz: f32,
    amplitude: f32,
) -> Vec<u8> {
    let channels: u16 = 1;
    let bits_per_sample: u16 = 16;
    let bytes_per_sample = (bits_per_sample / 8) as u32;
    let total_frames = ((u64::from(sample_rate_hz) * u64::from(duration_ms)) / 1_000) as u32;
    let data_size = total_frames * u32::from(channels) * bytes_per_sample;
    let byte_rate = sample_rate_hz * u32::from(channels) * bytes_per_sample;
    let block_align = channels * (bits_per_sample / 8);
    let riff_size = 36u32 + data_size;

    let mut out = Vec::with_capacity((44 + data_size) as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&riff_size.to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // PCM fmt chunk size
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM format
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate_hz.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&bits_per_sample.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_size.to_le_bytes());

    let amp = amplitude.clamp(0.0, 0.999);
    for frame_idx in 0..total_frames {
        let t = frame_idx as f32 / sample_rate_hz as f32;
        let sample = (std::f32::consts::TAU * frequency_hz * t).sin() * amp;
        let pcm = (sample * i16::MAX as f32).round() as i16;
        out.extend_from_slice(&pcm.to_le_bytes());
    }

    out
}

async fn write_wav_fixture_file(dir: &Path, file_name: &str) -> String {
    let path = dir.join(file_name);
    let wav = pcm16_wav_sine_bytes(48_000, 1_500, 440.0, 0.4);
    tokio::fs::write(&path, wav)
        .await
        .expect("write wav fixture");
    path.to_string_lossy().to_string()
}

async fn wait_for_ingest_job_terminal(
    service: &CommandService,
    job_id: &str,
) -> CatalogIngestJobResponse {
    for _ in 0..100 {
        let job = service
            .handle_catalog_get_ingest_job(job_id)
            .await
            .expect("get ingest job")
            .expect("ingest job exists");
        if matches!(job.status.as_str(), "COMPLETED" | "FAILED" | "CANCELED") {
            return job;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    panic!("ingest job did not reach terminal state in time");
}

fn assert_app_error_wire_top_level_shape(wire: &serde_json::Value) {
    let object = wire
        .as_object()
        .expect("AppError should serialize to a JSON object");
    let mut keys: Vec<_> = object.keys().cloned().collect();
    keys.sort();
    assert_eq!(keys, vec!["code", "details", "message"]);
}

#[tokio::test]
async fn command_service_plan_execute_history_report_happy_path() {
    let (service, dir) = new_service().await;
    let (spec_path, media_path) = write_fixture_files(dir.path()).await;

    let plan = service
        .handle_plan_release(PlanReleaseInput {
            media_path,
            spec_path,
            platforms: vec!["mock".to_string()],
            env: AppEnv::Test,
        })
        .await
        .expect("plan");
    assert_eq!(plan.release_id.len(), 64);
    assert_eq!(plan.env, AppEnv::Test);
    assert_eq!(plan.planned_actions.len(), 1);
    assert!(plan.planned_actions[0].simulated);

    let exec = service
        .handle_execute_release(&plan.release_id)
        .await
        .expect("execute");
    assert_eq!(exec.release_id, plan.release_id);
    assert_eq!(exec.status, "COMMITTED");
    assert!(exec.report_path.is_some());

    let history = service.handle_list_history().await.expect("history");
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].release_id, plan.release_id);

    let report = service
        .handle_get_report(&plan.release_id)
        .await
        .expect("report")
        .expect("report exists");
    assert_eq!(report.release_id, plan.release_id);
    assert!(report.summary.contains("COMMITTED"));
}

#[tokio::test]
async fn command_service_analyze_audio_file_returns_track_model_and_metrics() {
    let (service, dir) = new_service().await;
    let wav_path = write_wav_fixture_file(dir.path(), "analysis.wav").await;

    let analyzed = service
        .handle_analyze_audio_file(&wav_path)
        .await
        .expect("analyze audio file");

    assert!(analyzed.canonical_path.ends_with("/analysis.wav"));
    assert_eq!(analyzed.media_fingerprint.len(), 64);
    assert_eq!(analyzed.sample_rate_hz, 48_000);
    assert_eq!(analyzed.channels, 1);
    assert_eq!(analyzed.track.file_path(), analyzed.canonical_path);
    assert!(analyzed.track.duration_ms() >= 1_499 && analyzed.track.duration_ms() <= 1_500);
    assert!(!analyzed.track.peak_data().is_empty());
    assert!(analyzed.track.peak_data().iter().all(|peak| *peak <= 0.0));
    assert!(analyzed.track.loudness_lufs() <= 0.0);
}

#[tokio::test]
async fn catalog_import_list_and_get_track_round_trip() {
    let (service, dir) = new_service().await;
    let wav_a = write_wav_fixture_file(dir.path(), "Artist A - Sunset.wav").await;
    let wav_b_path = dir.path().join("Midnight.wav");
    tokio::fs::write(
        &wav_b_path,
        pcm16_wav_sine_bytes(48_000, 1_500, 880.0, 0.25),
    )
    .await
    .expect("write second wav");
    let wav_b = wav_b_path.to_string_lossy().to_string();

    let imported = service
        .handle_catalog_import_files(vec![wav_a.clone(), wav_b.clone()])
        .await
        .expect("catalog import");
    assert_eq!(imported.failed.len(), 0);
    assert_eq!(imported.imported.len(), 2);

    let list = service
        .handle_catalog_list_tracks(Some(CatalogListTracksInput {
            search: Some("sunset".to_string()),
            limit: Some(20),
            offset: Some(0),
        }))
        .await
        .expect("catalog list");
    assert_eq!(list.total, 1);
    assert_eq!(list.items.len(), 1);
    assert_eq!(list.items[0].artist_name, "Artist A");
    assert!(list.items[0].title.contains("Sunset"));

    let detail = service
        .handle_catalog_get_track(&list.items[0].track_id)
        .await
        .expect("catalog get")
        .expect("track should exist");
    assert_eq!(detail.artist_name, "Artist A");
    assert!(detail.title.contains("Sunset"));
    assert!(detail.file_path.ends_with("Sunset.wav"));
    assert_eq!(detail.sample_rate_hz, 48_000);
    assert_eq!(detail.channels, 1);
    assert!(!detail.track.peak_data().is_empty());
    assert!(
        detail
            .track
            .peak_data()
            .iter()
            .all(|peak| peak.is_finite() && *peak <= 0.0),
        "catalog peak_data should remain finite and non-positive"
    );
    assert!(
        detail.track.loudness_lufs().is_finite() && detail.track.loudness_lufs() <= 0.0,
        "catalog loudness_lufs should remain finite and non-positive"
    );
    assert!(
        detail.true_peak_dbfs.is_some(),
        "catalog true_peak_dbfs should be populated from analysis"
    );
}

#[tokio::test]
async fn catalog_get_track_rejects_tampered_positive_true_peak_dbfs() {
    let (service, dir) = new_service().await;
    let wav = write_wav_fixture_file(dir.path(), "Artist TP - Tamper.wav").await;
    let imported = service
        .handle_catalog_import_files(vec![wav])
        .await
        .expect("catalog import");
    let track_id = imported.imported[0].track_id.clone();

    sqlx::query("UPDATE catalog_tracks SET true_peak_dbfs = ? WHERE track_id = ?")
        .bind(0.5f64)
        .bind(&track_id)
        .execute(service.orchestrator.db().pool())
        .await
        .expect("tamper catalog true_peak_dbfs");

    let err = service
        .handle_catalog_get_track(&track_id)
        .await
        .expect_err("tampered true_peak_dbfs should be rejected");
    assert!(err.code.starts_with(app_error_codes::DB_PREFIX));
    assert!(
        err.message.contains("true_peak_dbfs"),
        "expected decode error to reference true_peak_dbfs, got: {}",
        err.message
    );
}

#[tokio::test]
async fn catalog_track_tamper_positive_loudness_lufs_is_blocked_by_sqlite_check() {
    let (service, dir) = new_service().await;
    let wav = write_wav_fixture_file(dir.path(), "Artist LUFS - Tamper.wav").await;
    let imported = service
        .handle_catalog_import_files(vec![wav])
        .await
        .expect("catalog import");
    let track_id = imported.imported[0].track_id.clone();

    let err = sqlx::query("UPDATE catalog_tracks SET loudness_lufs = ? WHERE track_id = ?")
        .bind(0.25f64)
        .bind(&track_id)
        .execute(service.orchestrator.db().pool())
        .await
        .expect_err("positive loudness_lufs tamper should be blocked by CHECK constraint");
    let message = err.to_string();
    assert!(
        message.contains("CHECK constraint failed") && message.contains("loudness_lufs <= 0"),
        "unexpected sqlite error: {message}"
    );
}

#[tokio::test]
async fn catalog_get_track_rejects_tampered_peak_data_json() {
    let (service, dir) = new_service().await;
    let wav = write_wav_fixture_file(dir.path(), "Artist Peak - Tamper.wav").await;
    let imported = service
        .handle_catalog_import_files(vec![wav])
        .await
        .expect("catalog import");
    let track_id = imported.imported[0].track_id.clone();

    sqlx::query("UPDATE catalog_tracks SET peak_data_json = ? WHERE track_id = ?")
        .bind("[0.0, 1.0, -3.0]")
        .bind(&track_id)
        .execute(service.orchestrator.db().pool())
        .await
        .expect("tamper catalog peak_data_json");

    let err = service
        .handle_catalog_get_track(&track_id)
        .await
        .expect_err("tampered peak_data_json should be rejected");
    assert!(err.code.starts_with(app_error_codes::DB_PREFIX));
    assert!(
        err.message.contains("peak_data"),
        "expected decode error to reference peak_data, got: {}",
        err.message
    );
}

#[tokio::test]
async fn catalog_update_track_metadata_round_trips_tags_and_policies() {
    let (service, dir) = new_service().await;
    let wav = write_wav_fixture_file(dir.path(), "Artist B - Authoring.wav").await;
    let imported = service
        .handle_catalog_import_files(vec![wav])
        .await
        .expect("catalog import");
    let track_id = imported.imported[0].track_id.clone();

    let updated = service
        .handle_catalog_update_track_metadata(CatalogUpdateTrackMetadataInput {
            track_id: track_id.clone(),
            visibility_policy: "private".to_string(),
            license_policy: "cc_by".to_string(),
            downloadable: true,
            tags: vec!["Indie Rock".to_string(), "  Sunset  Vibes  ".to_string()],
        })
        .await
        .expect("update metadata");

    assert_eq!(updated.track_id, track_id);
    assert_eq!(updated.visibility_policy, "PRIVATE");
    assert_eq!(updated.license_policy, "CC_BY");
    assert!(updated.downloadable);
    assert_eq!(
        updated.tags,
        vec!["Indie Rock".to_string(), "Sunset Vibes".to_string()]
    );

    let fetched = service
        .handle_catalog_get_track(&updated.track_id)
        .await
        .expect("get track")
        .expect("track should exist");
    assert_eq!(fetched.visibility_policy, "PRIVATE");
    assert_eq!(fetched.license_policy, "CC_BY");
    assert!(fetched.downloadable);
    assert_eq!(
        fetched.tags,
        vec!["Indie Rock".to_string(), "Sunset Vibes".to_string()]
    );
}

#[tokio::test]
async fn catalog_update_track_metadata_rejects_duplicate_or_invalid_tags_and_policies() {
    let (service, dir) = new_service().await;
    let wav = write_wav_fixture_file(dir.path(), "Artist C - Tags.wav").await;
    let imported = service
        .handle_catalog_import_files(vec![wav])
        .await
        .expect("catalog import");
    let track_id = imported.imported[0].track_id.clone();

    let duplicate_err = service
        .handle_catalog_update_track_metadata(CatalogUpdateTrackMetadataInput {
            track_id: track_id.clone(),
            visibility_policy: "LOCAL".to_string(),
            license_policy: "ALL_RIGHTS_RESERVED".to_string(),
            downloadable: false,
            tags: vec!["Dream Pop".to_string(), " dream   pop ".to_string()],
        })
        .await
        .expect_err("duplicate normalized tags must be rejected");
    assert_eq!(duplicate_err.code, "INVALID_ARGUMENT");
    assert!(duplicate_err.message.contains("duplicate tag"));

    let policy_err = service
        .handle_catalog_update_track_metadata(CatalogUpdateTrackMetadataInput {
            track_id,
            visibility_policy: "PUBLIC_WEB".to_string(),
            license_policy: "ALL_RIGHTS_RESERVED".to_string(),
            downloadable: false,
            tags: vec![],
        })
        .await
        .expect_err("unknown visibility policy must be rejected");
    assert_eq!(policy_err.code, "INVALID_ARGUMENT");
    assert!(policy_err.message.contains("visibility_policy"));
}

#[tokio::test]
async fn publisher_create_draft_from_track_generates_valid_spec_file_and_prefill_paths() {
    let (service, dir) = new_service().await;
    let wav = write_wav_fixture_file(dir.path(), "Artist D - Bridge Me.wav").await;
    let imported = service
        .handle_catalog_import_files(vec![wav.clone()])
        .await
        .expect("catalog import");
    let track_id = imported.imported[0].track_id.clone();

    let _updated = service
        .handle_catalog_update_track_metadata(CatalogUpdateTrackMetadataInput {
            track_id: track_id.clone(),
            visibility_policy: "PRIVATE".to_string(),
            license_policy: "CC_BY".to_string(),
            downloadable: true,
            tags: vec![
                "Dream Pop".to_string(),
                "Late Night".to_string(),
                "this-tag-is-way-too-long-for-release-spec-and-should-be-dropped".to_string(),
            ],
        })
        .await
        .expect("update catalog metadata");

    let draft = service
        .handle_publisher_create_draft_from_track(&track_id)
        .await
        .expect("create publisher draft");

    assert_eq!(draft.source_track_id, track_id);
    let draft_media_path = draft.media_path.replace('\\', "/");
    let wav_path = wav.replace('\\', "/");
    assert!(
        draft_media_path == wav_path || draft_media_path.ends_with(&wav_path),
        "unexpected media path: draft={draft_media_path} wav={wav_path}"
    );
    assert!(draft.spec_path.contains("/publisher_catalog_drafts/"));
    assert!(draft.spec_path.ends_with("/release_spec.yaml"));
    assert_eq!(draft.spec.title, "Bridge Me");
    assert_eq!(draft.spec.artist, "Artist D");
    assert!(draft.spec.description.contains("visibility: PRIVATE"));
    assert!(draft.spec.description.contains("license: CC_BY"));
    assert_eq!(
        draft.spec.tags,
        vec!["dream pop".to_string(), "late night".to_string()]
    );
    assert!(draft.spec_yaml.contains("title: Bridge Me"));

    let spec_path_fs = PathBuf::from(draft.spec_path.replace('/', "\\"));
    let bytes = tokio::fs::read(&spec_path_fs)
        .await
        .expect("read generated draft spec");
    let yaml = String::from_utf8(bytes).expect("utf8 yaml");
    let parsed = parse_release_spec_yaml(&yaml).expect("generated yaml should parse");
    assert_eq!(parsed.title, "Bridge Me");
    assert_eq!(parsed.artist, "Artist D");
    assert_eq!(
        parsed.tags,
        vec!["dream pop".to_string(), "late night".to_string()]
    );
}

#[tokio::test]
async fn publisher_create_draft_from_track_rejects_invalid_or_missing_track_id() {
    let (service, _dir) = new_service().await;

    let invalid = service
        .handle_publisher_create_draft_from_track("not-a-track-id")
        .await
        .expect_err("invalid track id must be rejected");
    assert_eq!(invalid.code, "INVALID_ARGUMENT");

    let missing = service
        .handle_publisher_create_draft_from_track(&"a".repeat(64))
        .await
        .expect_err("missing track id must be rejected");
    assert_eq!(missing.code, "INVALID_ARGUMENT");
    assert!(missing.message.contains("not found"));
}

#[tokio::test]
async fn catalog_import_files_collects_per_file_failures_and_keeps_successes() {
    let (service, dir) = new_service().await;
    let good_wav = write_wav_fixture_file(dir.path(), "Good.wav").await;
    let bad_path = dir.path().join("missing.wav").to_string_lossy().to_string();

    let response = service
        .handle_catalog_import_files(vec![good_wav, bad_path.clone()])
        .await
        .expect("catalog import should return partial results");
    assert_eq!(response.imported.len(), 1);
    assert_eq!(response.failed.len(), 1);
    assert_eq!(response.failed[0].path, bad_path);
    assert!(!response.failed[0].code.is_empty());
    assert!(!response.failed[0].message.is_empty());
}

#[tokio::test]
async fn catalog_import_files_rejects_oversized_aggregate_path_payload() {
    let (service, _dir) = new_service().await;
    let oversized = "a".repeat((MAX_CATALOG_IMPORT_TOTAL_PATH_CHARS / 2) + 1024);
    let err = service
        .handle_catalog_import_files(vec![format!("C:/{oversized}"), format!("D:/{oversized}")])
        .await
        .expect_err("oversized import payload must be rejected");
    assert_eq!(err.code, "INVALID_ARGUMENT");
    assert!(err
        .message
        .contains("payload exceeds maximum aggregate path length"));
}

#[tokio::test]
async fn catalog_library_root_round_trip_and_remove() {
    let (service, dir) = new_service().await;
    let root_dir = dir.path().join("library-root");
    tokio::fs::create_dir_all(&root_dir)
        .await
        .expect("create library root");
    let wav = write_wav_fixture_file(&root_dir, "Artist Root - Root Track.wav").await;

    let added = service
        .handle_catalog_add_library_root(&root_dir.to_string_lossy())
        .await
        .expect("add library root");
    assert_eq!(added.root_id.len(), 64);
    assert!(added.path.ends_with("/library-root"));
    assert!(added.enabled);

    let listed = service
        .handle_catalog_list_library_roots()
        .await
        .expect("list roots");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].root_id, added.root_id);

    let imported = service
        .handle_catalog_import_files(vec![wav])
        .await
        .expect("import catalog track under root");
    assert_eq!(imported.failed.len(), 0);
    assert_eq!(imported.imported.len(), 1);

    let tracks_before_remove = service
        .handle_catalog_list_tracks(Some(CatalogListTracksInput {
            search: None,
            limit: Some(50),
            offset: Some(0),
        }))
        .await
        .expect("list tracks before remove");
    assert_eq!(tracks_before_remove.total, 1);

    let removed = service
        .handle_catalog_remove_library_root(&added.root_id)
        .await
        .expect("remove root");
    assert!(removed);
    let listed_after = service
        .handle_catalog_list_library_roots()
        .await
        .expect("list roots after remove");
    assert!(listed_after.is_empty());

    let tracks_after_remove = service
        .handle_catalog_list_tracks(Some(CatalogListTracksInput {
            search: None,
            limit: Some(50),
            offset: Some(0),
        }))
        .await
        .expect("list tracks after remove");
    assert_eq!(tracks_after_remove.total, 0);
}

#[tokio::test]
async fn catalog_reset_library_data_clears_tracks_and_roots() {
    let (service, dir) = new_service().await;
    let root_dir = dir.path().join("reset-root");
    tokio::fs::create_dir_all(&root_dir)
        .await
        .expect("create reset root");
    let wav = write_wav_fixture_file(&root_dir, "Artist Reset - Track.wav").await;

    let added = service
        .handle_catalog_add_library_root(&root_dir.to_string_lossy())
        .await
        .expect("add root for reset");
    assert_eq!(added.root_id.len(), 64);

    let imported = service
        .handle_catalog_import_files(vec![wav])
        .await
        .expect("import before reset");
    assert_eq!(imported.imported.len(), 1);
    assert!(imported.failed.is_empty());

    let reset = service
        .handle_catalog_reset_library_data()
        .await
        .expect("reset catalog library data");
    assert!(reset);

    let listed_roots = service
        .handle_catalog_list_library_roots()
        .await
        .expect("list roots after reset");
    assert!(listed_roots.is_empty());

    let listed_tracks = service
        .handle_catalog_list_tracks(Some(CatalogListTracksInput {
            search: None,
            limit: Some(50),
            offset: Some(0),
        }))
        .await
        .expect("list tracks after reset");
    assert_eq!(listed_tracks.total, 0);
    assert!(listed_tracks.items.is_empty());
}

#[tokio::test]
async fn catalog_remove_library_root_only_prunes_matching_root_prefix() {
    let (service, dir) = new_service().await;
    let root_a = dir.path().join("library-root");
    let root_b = dir.path().join("library-root-2");
    tokio::fs::create_dir_all(&root_a)
        .await
        .expect("create root A");
    tokio::fs::create_dir_all(&root_b)
        .await
        .expect("create root B");

    let wav_a = write_wav_fixture_file(&root_a, "Artist Root A - Keep Out.wav").await;
    let wav_b = write_wav_fixture_file(&root_b, "Artist Root B - Keep In.wav").await;

    let added_a = service
        .handle_catalog_add_library_root(&root_a.to_string_lossy())
        .await
        .expect("add root A");
    let _added_b = service
        .handle_catalog_add_library_root(&root_b.to_string_lossy())
        .await
        .expect("add root B");

    let imported = service
        .handle_catalog_import_files(vec![wav_a, wav_b])
        .await
        .expect("import tracks for both roots");
    assert_eq!(imported.failed.len(), 0);
    assert_eq!(imported.imported.len(), 2);

    let removed = service
        .handle_catalog_remove_library_root(&added_a.root_id)
        .await
        .expect("remove root A");
    assert!(removed);

    let tracks_after_remove = service
        .handle_catalog_list_tracks(Some(CatalogListTracksInput {
            search: None,
            limit: Some(50),
            offset: Some(0),
        }))
        .await
        .expect("list tracks after removing root A");
    assert_eq!(tracks_after_remove.total, 1);
    assert_eq!(tracks_after_remove.items.len(), 1);
    assert!(tracks_after_remove.items[0]
        .file_path
        .ends_with("Artist Root B - Keep In.wav"));
}

#[tokio::test]
async fn catalog_scan_root_creates_ingest_job_updates_progress_and_imports_tracks() {
    let (service, dir) = new_service().await;
    let service = Arc::new(service);
    let root_dir = dir.path().join("scan-root");
    tokio::fs::create_dir_all(&root_dir)
        .await
        .expect("create scan root");
    let _wav1 = write_wav_fixture_file(&root_dir, "Artist X - Track One.wav").await;
    tokio::fs::write(
        root_dir.join("Track Two.wav"),
        pcm16_wav_sine_bytes(48_000, 1_500, 880.0, 0.25),
    )
    .await
    .expect("write second wav fixture");
    tokio::fs::write(root_dir.join("notes.txt"), b"ignore-me")
        .await
        .expect("write non-audio file");

    let root = service
        .handle_catalog_add_library_root(&root_dir.to_string_lossy())
        .await
        .expect("add root");
    let prepared = service
        .handle_catalog_scan_root_prepare(&root.root_id)
        .await
        .expect("prepare scan");
    let job_id = prepared.job.job_id.clone();

    run_catalog_scan_job_inner(Arc::clone(&service), prepared.root, job_id.clone())
        .await
        .expect("run scan job");

    let job = wait_for_ingest_job_terminal(service.as_ref(), &job_id).await;
    assert_eq!(job.status, "COMPLETED");
    assert_eq!(job.total_items, 2);
    assert_eq!(job.processed_items, 2);
    assert_eq!(job.error_count, 0);

    let listed = service
        .handle_catalog_list_tracks(Some(CatalogListTracksInput {
            search: None,
            limit: Some(10),
            offset: Some(0),
        }))
        .await
        .expect("list imported tracks");
    assert_eq!(listed.total, 2);
}

#[tokio::test]
async fn catalog_scan_root_records_failures_without_aborting_successful_imports() {
    let (service, dir) = new_service().await;
    let service = Arc::new(service);
    let root_dir = dir.path().join("scan-root-errors");
    tokio::fs::create_dir_all(&root_dir)
        .await
        .expect("create scan root");
    let _good = write_wav_fixture_file(&root_dir, "Good Track.wav").await;
    tokio::fs::write(root_dir.join("Broken.wav"), b"not-a-real-wav")
        .await
        .expect("write corrupt wav");

    let root = service
        .handle_catalog_add_library_root(&root_dir.to_string_lossy())
        .await
        .expect("add root");
    let prepared = service
        .handle_catalog_scan_root_prepare(&root.root_id)
        .await
        .expect("prepare scan");
    let job_id = prepared.job.job_id.clone();

    run_catalog_scan_job_inner(Arc::clone(&service), prepared.root, job_id.clone())
        .await
        .expect("run scan job");

    let job = wait_for_ingest_job_terminal(service.as_ref(), &job_id).await;
    assert_eq!(job.status, "COMPLETED");
    assert_eq!(job.total_items, 2);
    assert_eq!(job.processed_items, 2);
    assert_eq!(job.error_count, 1);

    let listed = service
        .handle_catalog_list_tracks(Some(CatalogListTracksInput {
            search: None,
            limit: Some(10),
            offset: Some(0),
        }))
        .await
        .expect("list imported tracks");
    assert_eq!(listed.total, 1);
}

#[tokio::test]
async fn catalog_cancel_ingest_job_marks_job_canceled_and_prevents_scan_run() {
    let (service, dir) = new_service().await;
    let service = Arc::new(service);
    let root_dir = dir.path().join("scan-cancel");
    tokio::fs::create_dir_all(&root_dir)
        .await
        .expect("create scan root");
    let _wav = write_wav_fixture_file(&root_dir, "Cancel Me.wav").await;

    let root = service
        .handle_catalog_add_library_root(&root_dir.to_string_lossy())
        .await
        .expect("add root");
    let prepared = service
        .handle_catalog_scan_root_prepare(&root.root_id)
        .await
        .expect("prepare scan");
    let job_id = prepared.job.job_id.clone();

    let canceled = service
        .handle_catalog_cancel_ingest_job(&job_id)
        .await
        .expect("cancel ingest job");
    assert!(canceled);

    run_catalog_scan_job_inner(Arc::clone(&service), prepared.root, job_id.clone())
        .await
        .expect("canceled scan job should short-circuit cleanly");

    let job = wait_for_ingest_job_terminal(service.as_ref(), &job_id).await;
    assert_eq!(job.status, "CANCELED");

    let canceled_again = service
        .handle_catalog_cancel_ingest_job(&job_id)
        .await
        .expect("repeat cancel");
    assert!(!canceled_again);
}

#[tokio::test]
async fn command_service_analyze_and_persist_release_track_round_trips_release_model() {
    let (service, dir) = new_service().await;
    let spec_path = write_spec_file(dir.path(), "QC Track", "QC Artist").await;
    let wav_path = write_wav_fixture_file(dir.path(), "release-media.wav").await;

    let plan = service
        .handle_plan_release(PlanReleaseInput {
            media_path: wav_path.clone(),
            spec_path,
            platforms: vec!["mock".to_string()],
            env: AppEnv::Test,
        })
        .await
        .expect("plan");

    let persisted = service
        .handle_analyze_and_persist_release_track(&plan.release_id, &wav_path)
        .await
        .expect("analyze+persist");

    assert_eq!(persisted.release.id(), plan.release_id);
    assert_eq!(persisted.release.title(), "QC Track");
    assert_eq!(persisted.release.artist(), "QC Artist");
    assert_eq!(persisted.release.tracks().len(), 1);
    assert!(persisted.release.tracks()[0]
        .file_path()
        .ends_with("/release-media.wav"));
    assert_eq!(persisted.media_fingerprint.len(), 64);
    assert_eq!(persisted.sample_rate_hz, 48_000);
    assert_eq!(persisted.channels, 1);

    let fetched = service
        .handle_get_release_track_analysis(&plan.release_id)
        .await
        .expect("get persisted analysis")
        .expect("analysis should exist");

    assert_eq!(fetched.release.id(), persisted.release.id());
    assert_eq!(fetched.release.title(), persisted.release.title());
    assert_eq!(fetched.release.artist(), persisted.release.artist());
    assert_eq!(fetched.release.tracks(), persisted.release.tracks());
    assert_eq!(fetched.media_fingerprint, persisted.media_fingerprint);
    assert_eq!(fetched.sample_rate_hz, persisted.sample_rate_hz);
    assert_eq!(fetched.channels, persisted.channels);
}

#[tokio::test]
async fn analyze_and_persist_release_track_rejects_media_fingerprint_mismatch() {
    let (service, dir) = new_service().await;
    let spec_path = write_spec_file(dir.path(), "QC Track", "QC Artist").await;
    let planned_media_path = dir.path().join("planned-media.bin");
    tokio::fs::write(&planned_media_path, b"not-audio-but-valid-bytes")
        .await
        .expect("write planned media");
    let wav_path = write_wav_fixture_file(dir.path(), "different-audio.wav").await;

    let plan = service
        .handle_plan_release(PlanReleaseInput {
            media_path: planned_media_path.to_string_lossy().to_string(),
            spec_path,
            platforms: vec!["mock".to_string()],
            env: AppEnv::Test,
        })
        .await
        .expect("plan");

    let err = service
        .handle_analyze_and_persist_release_track(&plan.release_id, &wav_path)
        .await
        .expect_err("mismatched file should be rejected");
    assert_eq!(err.code, "MEDIA_FINGERPRINT_MISMATCH");
}

#[test]
fn plan_release_input_ipc_payload_rejects_missing_unknown_and_malicious_fields() {
    let valid = serde_json::json!({
        "media_path": "C:/tmp/media.wav",
        "spec_path": "C:/tmp/spec.yaml",
        "platforms": ["mock"],
        "env": "TEST"
    });
    let parsed = decode_plan_release_input_from_ipc_value_for_test(valid).expect("valid payload");
    assert_eq!(parsed.platforms, vec!["mock".to_string()]);
    assert_eq!(parsed.env, AppEnv::Test);

    let missing_fields = serde_json::json!({
        "media_path": "C:/tmp/media.wav",
        "platforms": ["mock"],
        "env": "TEST"
    });
    let err = decode_plan_release_input_from_ipc_value_for_test(missing_fields)
        .expect_err("missing spec_path must be rejected");
    assert_eq!(err.code, "INVALID_ARGUMENT");
    assert!(err.message.contains("invalid plan_release payload"));

    let malicious_unknown_fields = serde_json::json!({
        "media_path": "C:/tmp/media.wav",
        "spec_path": "C:/tmp/spec.yaml",
        "platforms": ["mock"],
        "env": "TEST",
        "duration_ms": -1,
        "peak_index": 999999999usize,
        "peak_data": [0.0, -1.0, -6.0],
        "qc_override": {
            "peak_index": 18446744073709551615u64,
            "duration_ms": -123
        }
    });
    let err = decode_plan_release_input_from_ipc_value_for_test(malicious_unknown_fields)
        .expect_err("unknown/malicious fields must be rejected at IPC boundary");
    assert_eq!(err.code, "INVALID_ARGUMENT");
    assert!(
        err.message.contains("unknown field"),
        "unexpected message: {}",
        err.message
    );

    let invalid_env = serde_json::json!({
        "media_path": "C:/tmp/media.wav",
        "spec_path": "C:/tmp/spec.yaml",
        "platforms": ["mock"],
        "env": "ROOTKIT"
    });
    let err = decode_plan_release_input_from_ipc_value_for_test(invalid_env)
        .expect_err("invalid env enum must be rejected");
    assert_eq!(err.code, "INVALID_ARGUMENT");
}

#[tokio::test]
async fn qc_commands_reject_invalid_release_id_and_path_inputs() {
    let (service, dir) = new_service().await;
    let invalid_release_id = "short".to_string();

    let err = service
        .handle_analyze_and_persist_release_track(&invalid_release_id, "x.wav")
        .await
        .expect_err("invalid release_id must be rejected");
    assert_eq!(err.code, "INVALID_ARGUMENT");

    let err = service
        .handle_get_release_track_analysis(&invalid_release_id)
        .await
        .expect_err("invalid release_id must be rejected");
    assert_eq!(err.code, "INVALID_ARGUMENT");

    let err = service
        .handle_analyze_audio_file(&dir.path().to_string_lossy())
        .await
        .expect_err("directory path must be rejected for audio analysis");
    assert_eq!(err.code, "INVALID_ARGUMENT");

    let err = service
        .handle_analyze_audio_file("file:///tmp/audio.wav")
        .await
        .expect_err("file:// path must be rejected");
    assert_eq!(err.code, "INVALID_ARGUMENT");

    let missing_file = dir.path().join("missing.wav");
    let err = service
        .handle_analyze_audio_file(&missing_file.to_string_lossy())
        .await
        .expect_err("missing file path must be rejected");
    assert_eq!(err.code, "FILE_READ_FAILED");
}

#[tokio::test]
async fn qc_commands_reject_overlong_audio_path_inputs_before_fs_access() {
    let (service, _dir) = new_service().await;
    let overlong_path = format!("C:/{}", "a".repeat(MAX_IPC_PATH_CHARS + 64));

    let err = service
        .handle_analyze_audio_file(&overlong_path)
        .await
        .expect_err("overlong path should be rejected at IPC boundary");
    assert_eq!(err.code, "INVALID_ARGUMENT");
    assert!(err.message.contains("maximum length"));
}

#[tokio::test]
async fn catalog_list_tracks_rejects_overlong_search_payload() {
    let (service, _dir) = new_service().await;
    let err = service
        .handle_catalog_list_tracks(Some(CatalogListTracksInput {
            search: Some("x".repeat(MAX_CATALOG_TRACK_SEARCH_CHARS + 1)),
            limit: Some(20),
            offset: Some(0),
        }))
        .await
        .expect_err("overlong search payload must be rejected");
    assert_eq!(err.code, "INVALID_ARGUMENT");
    assert!(err.message.contains("maximum length"));
}

#[test]
fn catalog_list_tracks_input_ipc_payload_rejects_unknown_malicious_fields() {
    let malicious = serde_json::json!({
        "search": "sunset",
        "limit": 25,
        "offset": 0,
        "peak_data": [0.0, -3.0],
        "loudness_lufs": -14.0
    });

    let err = decode_catalog_list_tracks_input_from_ipc_value_for_test(malicious)
        .expect_err("unknown fields should be rejected at IPC boundary");
    assert_eq!(err.code, "INVALID_ARGUMENT");
    assert!(
        err.message.contains("unknown field"),
        "unexpected message: {}",
        err.message
    );
}

#[test]
fn catalog_update_track_metadata_input_ipc_payload_rejects_unknown_fields() {
    let malicious = serde_json::json!({
        "track_id": "a".repeat(64),
        "visibility_policy": "LOCAL",
        "license_policy": "ALL_RIGHTS_RESERVED",
        "downloadable": false,
        "tags": ["ambient"],
        "peak_data": [0.0, -3.0],
        "duration_ms": -1
    });

    let err = decode_catalog_update_track_metadata_input_from_ipc_value_for_test(malicious)
        .expect_err("unknown fields should be rejected at IPC boundary");
    assert_eq!(err.code, "INVALID_ARGUMENT");
    assert!(
        err.message.contains("unknown field"),
        "unexpected message: {}",
        err.message
    );
}

#[tokio::test]
async fn release_track_analysis_negative_duration_tamper_is_blocked_by_sqlite_check() {
    let (service, dir) = new_service().await;
    let spec_path = write_spec_file(dir.path(), "Tamper Duration", "QC Artist").await;
    let wav_path = write_wav_fixture_file(dir.path(), "tamper-duration.wav").await;

    let plan = service
        .handle_plan_release(PlanReleaseInput {
            media_path: wav_path.clone(),
            spec_path,
            platforms: vec!["mock".to_string()],
            env: AppEnv::Test,
        })
        .await
        .expect("plan");

    service
        .handle_analyze_and_persist_release_track(&plan.release_id, &wav_path)
        .await
        .expect("persist valid analysis");

    let error =
        sqlx::query("UPDATE release_track_analysis SET duration_ms = -1 WHERE release_id = ?")
            .bind(plan.release_id.clone())
            .execute(service.orchestrator.db().pool())
            .await
            .expect_err("negative duration tamper should be blocked by sqlite CHECK");
    let message = error.to_string();
    assert!(
        message.contains("CHECK constraint failed") && message.contains("duration_ms > 0"),
        "unexpected sqlite error: {message}"
    );
}

#[tokio::test]
async fn get_release_track_analysis_rejects_tampered_extreme_duration_row() {
    let (service, dir) = new_service().await;
    let spec_path = write_spec_file(dir.path(), "Tamper Huge Duration", "QC Artist").await;
    let wav_path = write_wav_fixture_file(dir.path(), "tamper-huge-duration.wav").await;

    let plan = service
        .handle_plan_release(PlanReleaseInput {
            media_path: wav_path.clone(),
            spec_path,
            platforms: vec!["mock".to_string()],
            env: AppEnv::Test,
        })
        .await
        .expect("plan");

    service
        .handle_analyze_and_persist_release_track(&plan.release_id, &wav_path)
        .await
        .expect("persist valid analysis");

    sqlx::query(
        "UPDATE release_track_analysis SET duration_ms = 9223372036854775807 WHERE release_id = ?",
    )
    .bind(plan.release_id.clone())
    .execute(service.orchestrator.db().pool())
    .await
    .expect("tamper duration to extreme out-of-range integer");

    let err = service
        .handle_get_release_track_analysis(&plan.release_id)
        .await
        .expect_err("out-of-range duration row must be rejected");
    assert_eq!(err.code, "DB_ROW_DECODE");
    assert!(err.message.contains("duration_ms"));
}

#[tokio::test]
async fn get_release_track_analysis_rejects_tampered_peak_data_json() {
    let (service, dir) = new_service().await;
    let spec_path = write_spec_file(dir.path(), "Tamper Peaks", "QC Artist").await;
    let wav_path = write_wav_fixture_file(dir.path(), "tamper-peaks.wav").await;

    let plan = service
        .handle_plan_release(PlanReleaseInput {
            media_path: wav_path.clone(),
            spec_path,
            platforms: vec!["mock".to_string()],
            env: AppEnv::Test,
        })
        .await
        .expect("plan");

    service
        .handle_analyze_and_persist_release_track(&plan.release_id, &wav_path)
        .await
        .expect("persist valid analysis");

    sqlx::query("UPDATE release_track_analysis SET peak_data_json = ? WHERE release_id = ?")
        .bind("[0.0, 1.0, -3.0]")
        .bind(plan.release_id.clone())
        .execute(service.orchestrator.db().pool())
        .await
        .expect("tamper peak_data_json");

    let err = service
        .handle_get_release_track_analysis(&plan.release_id)
        .await
        .expect_err("invalid peak_data values must be rejected");
    assert_eq!(err.code, "DB_DESERIALIZATION");
    assert!(err.message.contains("peak_data"));
}

#[tokio::test]
async fn get_release_track_analysis_rejects_tampered_excessive_peak_data_json() {
    let (service, dir) = new_service().await;
    let spec_path = write_spec_file(dir.path(), "Tamper Huge Peaks", "QC Artist").await;
    let wav_path = write_wav_fixture_file(dir.path(), "tamper-huge-peaks.wav").await;

    let plan = service
        .handle_plan_release(PlanReleaseInput {
            media_path: wav_path.clone(),
            spec_path,
            platforms: vec!["mock".to_string()],
            env: AppEnv::Test,
        })
        .await
        .expect("plan");

    service
        .handle_analyze_and_persist_release_track(&plan.release_id, &wav_path)
        .await
        .expect("persist valid analysis");

    let oversized_peaks = serde_json::to_string(&vec![-6.0f32; MAX_IPC_PEAK_BINS + 1])
        .expect("serialize oversized peak array");
    sqlx::query("UPDATE release_track_analysis SET peak_data_json = ? WHERE release_id = ?")
        .bind(oversized_peaks)
        .bind(plan.release_id.clone())
        .execute(service.orchestrator.db().pool())
        .await
        .expect("tamper peak_data_json to oversized array");

    let err = service
        .handle_get_release_track_analysis(&plan.release_id)
        .await
        .expect_err("oversized peak array must be rejected before IPC serialization");
    assert_eq!(err.code, "AUDIO_MODEL_INVALID");
    assert!(err.message.contains("IPC safety limit"));
}

#[tokio::test]
async fn release_track_analysis_zero_sample_rate_and_channels_tamper_is_blocked_by_sqlite_check() {
    let (service, dir) = new_service().await;
    let spec_path = write_spec_file(dir.path(), "Tamper Rates", "QC Artist").await;
    let wav_path = write_wav_fixture_file(dir.path(), "tamper-rates.wav").await;

    let plan = service
        .handle_plan_release(PlanReleaseInput {
            media_path: wav_path.clone(),
            spec_path,
            platforms: vec!["mock".to_string()],
            env: AppEnv::Test,
        })
        .await
        .expect("plan");

    service
        .handle_analyze_and_persist_release_track(&plan.release_id, &wav_path)
        .await
        .expect("persist valid analysis");

    let error = sqlx::query(
        "UPDATE release_track_analysis SET sample_rate_hz = 0, channels = 0 WHERE release_id = ?",
    )
    .bind(plan.release_id.clone())
    .execute(service.orchestrator.db().pool())
    .await
    .expect_err("zero sample rate/channels tamper should be blocked by sqlite CHECK");
    let message = error.to_string();
    assert!(
        message.contains("CHECK constraint failed")
            && (message.contains("sample_rate_hz > 0") || message.contains("channels > 0")),
        "unexpected sqlite error: {message}"
    );
}

#[tokio::test]
async fn build_release_track_analysis_response_rejects_zero_sample_rate_and_channels() {
    let (service, dir) = new_service().await;
    let (spec_path, media_path) = write_fixture_files(dir.path()).await;
    let plan = service
        .handle_plan_release(PlanReleaseInput {
            media_path,
            spec_path,
            platforms: vec!["mock".to_string()],
            env: AppEnv::Test,
        })
        .await
        .expect("plan");

    let err = service
        .build_release_track_analysis_response(ReleaseTrackAnalysisRecord {
            release_id: plan.release_id,
            file_path: "C:/tmp/fake.wav".to_string(),
            media_fingerprint: "a".repeat(64),
            duration_ms: 1_000,
            peak_data: vec![0.0, -6.0],
            loudness_lufs: -14.0,
            sample_rate_hz: 0,
            channels: 0,
            created_at: "2026-02-26T00:00:00Z".to_string(),
            updated_at: "2026-02-26T00:00:00Z".to_string(),
        })
        .await
        .expect_err("command-layer IPC validator should reject zero sample rate/channels");
    assert_eq!(err.code, "AUDIO_MODEL_INVALID");
    assert!(
        err.message.contains("sample_rate_hz") || err.message.contains("channels"),
        "unexpected message: {}",
        err.message
    );
}

#[test]
fn build_catalog_track_detail_response_rejects_excessive_peak_data() {
    let err = build_catalog_track_detail_response_with_tags(
        DbCatalogTrackRecord {
            track_id: "b".repeat(64),
            media_asset_id: "c".repeat(64),
            media_fingerprint: "d".repeat(64),
            file_path: "C:/tmp/catalog.wav".to_string(),
            title: "Catalog Track".to_string(),
            artist_id: "e".repeat(64),
            artist_name: "Artist".to_string(),
            album_id: None,
            album_title: None,
            duration_ms: 1_000,
            peak_data: vec![-6.0; MAX_IPC_PEAK_BINS + 1],
            loudness_lufs: -14.0,
            true_peak_dbfs: Some(-1.0),
            sample_rate_hz: 48_000,
            channels: 1,
            visibility_policy: "LOCAL".to_string(),
            license_policy: "ALL_RIGHTS_RESERVED".to_string(),
            downloadable: false,
            created_at: "2026-02-26T00:00:00Z".to_string(),
            updated_at: "2026-02-26T00:00:00Z".to_string(),
        },
        Vec::new(),
    )
    .expect_err("oversized catalog peak array must be rejected");

    assert_eq!(err.code, "AUDIO_MODEL_INVALID");
    assert!(err.message.contains("IPC safety limit"));
}

#[tokio::test]
async fn plan_release_persists_descriptor_artifact_with_integrity_fields() {
    let (service, dir) = new_service().await;
    let (spec_path, media_path) = write_fixture_files(dir.path()).await;

    let plan = service
        .handle_plan_release(PlanReleaseInput {
            media_path,
            spec_path,
            platforms: vec!["mock".to_string()],
            env: AppEnv::Test,
        })
        .await
        .expect("plan");

    let release_dir = service.artifacts_root.join(&plan.release_id);
    let descriptor_path = planned_release_descriptor_path(&release_dir);
    assert!(
        tokio::fs::try_exists(&descriptor_path)
            .await
            .expect("descriptor existence check"),
        "planned descriptor should exist at {}",
        descriptor_path.display()
    );

    let bytes = tokio::fs::read(&descriptor_path)
        .await
        .expect("read planned descriptor");
    let descriptor: PersistedPlannedReleaseDescriptor =
        serde_json::from_slice(&bytes).expect("decode planned descriptor");

    assert_eq!(
        descriptor.schema_version,
        PLANNED_RELEASE_DESCRIPTOR_SCHEMA_VERSION
    );
    assert_eq!(descriptor.release_id, plan.release_id);
    assert_eq!(descriptor.run_id, plan.run_id);
    assert_eq!(descriptor.env, ExecutionEnvironment::Test);
    assert_eq!(descriptor.platforms, vec!["mock".to_string()]);
    assert_eq!(descriptor.max_actions_per_platform_per_run, 1);
    assert_eq!(descriptor.spec_hash.len(), 64);
    assert_eq!(descriptor.media_fingerprint.len(), 64);

    let actions = descriptor
        .planned_actions
        .get("mock")
        .expect("planned actions for mock");
    assert_eq!(actions.len(), 1);
    assert!(actions[0].simulated);

    let planned_request_path = descriptor
        .planned_request_files
        .get("mock")
        .expect("planned request file for mock");
    assert!(planned_request_path.ends_with("/planned_requests/mock.json"));
}

#[tokio::test]
async fn execute_release_hydrates_persisted_descriptor_after_service_restart() {
    let dir = tempdir().expect("tempdir");
    let runtime_dir = dir.path().join("runtime");
    let service1 = CommandService::for_base_dir(runtime_dir.clone())
        .await
        .expect("service1");
    let (spec_path, media_path) = write_fixture_files(dir.path()).await;

    let plan = service1
        .handle_plan_release(PlanReleaseInput {
            media_path,
            spec_path,
            platforms: vec!["mock".to_string()],
            env: AppEnv::Test,
        })
        .await
        .expect("plan");

    drop(service1);

    let service2 = CommandService::for_base_dir(runtime_dir)
        .await
        .expect("service2");

    let exec = service2
        .handle_execute_release(&plan.release_id)
        .await
        .expect("execute from persisted descriptor after restart");
    assert_eq!(exec.release_id, plan.release_id);
    assert_eq!(exec.status, "COMMITTED");
    assert!(exec.report_path.is_some());
}

#[tokio::test]
async fn execute_release_rejects_persisted_descriptor_integrity_mismatch() {
    let dir = tempdir().expect("tempdir");
    let runtime_dir = dir.path().join("runtime");
    let service1 = CommandService::for_base_dir(runtime_dir.clone())
        .await
        .expect("service1");
    let (spec_path, media_path) = write_fixture_files(dir.path()).await;

    let plan = service1
        .handle_plan_release(PlanReleaseInput {
            media_path,
            spec_path,
            platforms: vec!["mock".to_string()],
            env: AppEnv::Test,
        })
        .await
        .expect("plan");

    let descriptor_path =
        planned_release_descriptor_path(&service1.artifacts_root.join(&plan.release_id));
    let bytes = tokio::fs::read(&descriptor_path)
        .await
        .expect("read descriptor");
    let mut descriptor: PersistedPlannedReleaseDescriptor =
        serde_json::from_slice(&bytes).expect("decode descriptor");
    descriptor.spec_hash = if descriptor.spec_hash == "0".repeat(64) {
        "1".repeat(64)
    } else {
        "0".repeat(64)
    };
    let tampered = serde_json::to_vec_pretty(&descriptor).expect("encode tampered descriptor");
    tokio::fs::write(&descriptor_path, tampered)
        .await
        .expect("write tampered descriptor");

    drop(service1);

    let service2 = CommandService::for_base_dir(runtime_dir)
        .await
        .expect("service2");
    let err = service2
        .handle_execute_release(&plan.release_id)
        .await
        .expect_err("tampered descriptor should fail safely");
    assert_eq!(err.code, "PLANNED_RELEASE_DESCRIPTOR_INTEGRITY_MISMATCH");
}

#[tokio::test]
async fn execute_release_returns_not_found_when_persisted_descriptor_missing() {
    let dir = tempdir().expect("tempdir");
    let runtime_dir = dir.path().join("runtime");
    let service1 = CommandService::for_base_dir(runtime_dir.clone())
        .await
        .expect("service1");
    let (spec_path, media_path) = write_fixture_files(dir.path()).await;

    let plan = service1
        .handle_plan_release(PlanReleaseInput {
            media_path,
            spec_path,
            platforms: vec!["mock".to_string()],
            env: AppEnv::Test,
        })
        .await
        .expect("plan");

    let descriptor_path =
        planned_release_descriptor_path(&service1.artifacts_root.join(&plan.release_id));
    tokio::fs::remove_file(&descriptor_path)
        .await
        .expect("remove descriptor");
    drop(service1);

    let service2 = CommandService::for_base_dir(runtime_dir)
        .await
        .expect("service2");
    let err = service2
        .handle_execute_release(&plan.release_id)
        .await
        .expect_err("missing descriptor should fail");
    assert_eq!(err.code, "PLANNED_RELEASE_NOT_FOUND");
}

#[tokio::test]
async fn execute_release_rejects_corrupted_persisted_descriptor() {
    let dir = tempdir().expect("tempdir");
    let runtime_dir = dir.path().join("runtime");
    let service1 = CommandService::for_base_dir(runtime_dir.clone())
        .await
        .expect("service1");
    let (spec_path, media_path) = write_fixture_files(dir.path()).await;

    let plan = service1
        .handle_plan_release(PlanReleaseInput {
            media_path,
            spec_path,
            platforms: vec!["mock".to_string()],
            env: AppEnv::Test,
        })
        .await
        .expect("plan");

    let descriptor_path =
        planned_release_descriptor_path(&service1.artifacts_root.join(&plan.release_id));
    tokio::fs::write(&descriptor_path, b"{not-json")
        .await
        .expect("write corrupt descriptor");
    drop(service1);

    let service2 = CommandService::for_base_dir(runtime_dir)
        .await
        .expect("service2");
    let err = service2
        .handle_execute_release(&plan.release_id)
        .await
        .expect_err("corrupt descriptor should fail");
    assert_eq!(err.code, "PLANNED_RELEASE_DESCRIPTOR_DECODE_FAILED");
}

#[tokio::test]
async fn rejects_odd_prefix_paths() {
    let (service, _dir) = new_service().await;
    let err = service
        .handle_load_spec("\\\\?\\C:\\temp\\x.yaml")
        .await
        .expect_err("odd prefix must be rejected");
    assert_eq!(err.code, "INVALID_ARGUMENT");
}

#[test]
fn reject_odd_prefixes_allows_unc_and_network_style_paths() {
    reject_odd_prefixes("\\\\server\\share\\music\\track.wav")
        .expect("UNC path should not be rejected by odd-prefix guard");
    reject_odd_prefixes("//server/share/music/track.wav")
        .expect("network-style path should not be rejected by odd-prefix guard");
}

#[test]
fn validate_release_id_for_artifact_lookup_accepts_hex_and_normalizes_case() {
    let upper = "A".repeat(64);
    let normalized = validate_release_id_for_artifact_lookup(&upper).expect("valid release id");
    assert_eq!(normalized, "a".repeat(64));
}

#[test]
fn validate_release_id_for_artifact_lookup_rejects_invalid_inputs() {
    let invalid = vec![
        "".to_string(),
        "   ".to_string(),
        "abc".to_string(),
        "../report".to_string(),
        "g".repeat(64),
        "a/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string(),
    ];

    for input in invalid {
        let err = validate_release_id_for_artifact_lookup(&input)
            .expect_err("invalid release id must be rejected");
        assert_eq!(err.code, "INVALID_ARGUMENT", "input: {input}");
    }
}

#[test]
fn validate_plan_release_platforms_accepts_normalized_unique_labels() {
    let normalized = validate_plan_release_platforms(&[
        " Mock ".to_string(),
        "spotify-live".to_string(),
        "you_tube.v2".to_string(),
    ])
    .expect("valid platform labels should pass");

    assert_eq!(
        normalized,
        vec![
            "mock".to_string(),
            "spotify-live".to_string(),
            "you_tube.v2".to_string()
        ]
    );
}

#[test]
fn validate_plan_release_platforms_rejects_invalid_cases() {
    let cases = vec![
        vec![],
        vec!["   ".to_string()],
        vec!["mock".to_string(), "MOCK".to_string()],
        vec!["mock/platform".to_string()],
        vec!["a".repeat(MAX_PLATFORM_LABEL_CHARS + 1)],
        (0..(MAX_PLAN_RELEASE_PLATFORMS + 1))
            .map(|idx| format!("p-{idx}"))
            .collect::<Vec<_>>(),
    ];

    for case in cases {
        let err = validate_plan_release_platforms(&case)
            .expect_err("invalid platform labels must be rejected");
        assert_eq!(err.code, "INVALID_ARGUMENT");
    }
}

#[tokio::test]
async fn get_report_rejects_invalid_release_id_inputs() {
    let (service, _dir) = new_service().await;

    let invalid = vec![
        "../bad".to_string(),
        "..\\bad".to_string(),
        "short".to_string(),
        "g".repeat(64),
    ];

    for input in invalid {
        let err = service
            .handle_get_report(&input)
            .await
            .expect_err("invalid release_id must be rejected");
        assert_eq!(err.code, "INVALID_ARGUMENT");
    }
}

#[tokio::test]
async fn get_report_accepts_uppercase_hex_release_id_lookup() {
    let (service, _dir) = new_service().await;
    let result = service
        .handle_get_report(&"A".repeat(64))
        .await
        .expect("uppercase hex release_id should validate");
    assert!(result.is_none());
}

#[tokio::test]
async fn get_report_handles_large_payload_and_preserves_raw_unknown_fields() {
    let (service, _dir) = new_service().await;
    let release_id = "c".repeat(64);
    let report_dir = service.artifacts_root.join(&release_id);
    tokio::fs::create_dir_all(&report_dir)
        .await
        .expect("create report dir");

    let large_blob = "x".repeat(256 * 1024);
    let platform_count = 256usize;
    let platforms: Vec<Value> = (0..platform_count)
        .map(|idx| {
            serde_json::json!({
                "platform": format!("mock-{idx:03}"),
                "status": "VERIFIED",
                "simulated": true,
                "verified": true,
                "attempt_count": 1,
                "external_id": serde_json::Value::Null,
                "reused_completed_result": idx % 2 == 0
            })
        })
        .collect();

    let report_json = serde_json::json!({
        "release_id": release_id,
        "run_id": "run-large",
        "env": "TEST",
        "state": "COMMITTED",
        "title": "Large Report Track",
        "spec_hash": "d".repeat(64),
        "media_fingerprint": "e".repeat(64),
        "planned_request_files": {
            "mock": "artifacts/planned_requests/mock.json"
        },
        "platforms": platforms,
        "diagnostics": {
            "blob": large_blob,
            "note": "preserve unknown fields in raw"
        }
    });
    let bytes = serde_json::to_vec(&report_json).expect("serialize large report fixture");
    tokio::fs::write(report_dir.join("release_report.json"), bytes)
        .await
        .expect("write large report fixture");

    let report = service
        .handle_get_report(&release_id)
        .await
        .expect("large report should decode")
        .expect("report should exist");

    assert_eq!(report.release_id.len(), 64);
    assert!(report.summary.contains("COMMITTED"));
    assert!(report
        .summary
        .contains(&format!("{platform_count} platform(s)")));
    assert_eq!(report.actions.len(), platform_count);
    let raw = report.raw.expect("raw report payload should be included");
    assert_eq!(
        raw["diagnostics"]["blob"]
            .as_str()
            .map(str::len)
            .expect("diagnostics blob string"),
        256 * 1024
    );
    assert_eq!(raw["diagnostics"]["note"], "preserve unknown fields in raw");
}

#[tokio::test]
async fn command_error_contract_invalid_release_id_wire_shape_is_stable() {
    let (service, _dir) = new_service().await;

    let err = service
        .handle_get_report("short")
        .await
        .expect_err("invalid release_id should fail");
    assert_eq!(err.code, "INVALID_ARGUMENT");
    assert_eq!(err.message, "release_id must be a 64-character hex string");
    assert!(err.details.is_none());

    let wire = serde_json::to_value(&err).expect("serialize AppError");
    assert_app_error_wire_top_level_shape(&wire);
    assert_eq!(wire["code"], "INVALID_ARGUMENT");
    assert_eq!(
        wire["message"],
        "release_id must be a 64-character hex string"
    );
    assert!(wire["details"].is_null());
}

#[tokio::test]
async fn command_error_contract_spec_validation_failed_wire_shape_is_stable() {
    let (service, dir) = new_service().await;
    let (spec_path, media_path) = write_fixture_files(dir.path()).await;
    tokio::fs::write(&spec_path, b"title: [unterminated\n")
        .await
        .expect("overwrite invalid spec");

    let err = service
        .handle_plan_release(PlanReleaseInput {
            media_path,
            spec_path,
            platforms: vec!["mock".to_string()],
            env: AppEnv::Test,
        })
        .await
        .expect_err("invalid spec should fail planning");
    assert_eq!(err.code, "SPEC_VALIDATION_FAILED");
    assert_eq!(err.message, "release spec is invalid");

    let wire = serde_json::to_value(&err).expect("serialize AppError");
    assert_app_error_wire_top_level_shape(&wire);
    assert_eq!(wire["code"], "SPEC_VALIDATION_FAILED");
    assert_eq!(wire["message"], "release spec is invalid");
    let errors = wire["details"]["errors"]
        .as_array()
        .expect("validation errors should be an array");
    assert!(
        !errors.is_empty(),
        "validation details.errors should include at least one item"
    );
}

fn command_error_redaction_probe_for_test() -> Result<(), AppError> {
    Err(AppError::new(
        app_error_codes::TEST_REDACTION_PROBE,
        "synthetic command error",
    )
    .with_details(serde_json::json!({
        "authorization": "Bearer should-not-cross-boundary",
        "nested": {
            "cookie": "session=secret",
            "safe": "keep"
        },
        "items": [
            {"client_secret": "shh"},
            {"safe": "ok"}
        ]
    })))
}

fn command_error_secret_store_probe_for_test() -> Result<(), AppError> {
    let store = InMemorySecretStore::new();
    store
        .put(
            SecretRecord::new(
                "connectors/mock/api-key",
                SecretValue::new("store-secret-123").expect("secret value"),
            )
            .expect("secret record"),
        )
        .expect("seed secret store");

    let secret = store
        .get("connectors/mock/api-key")
        .expect("stored secret should exist");

    Err(AppError::new(
        app_error_codes::TEST_SECRET_STORE_REDACTION,
        "synthetic secret-store command error",
    )
    .with_details(serde_json::json!({
        "api_key": secret.expose(),
        "nested": {
            "client_secret": secret.expose(),
            "debug": format!("{secret:?}")
        },
        "safe": "keep"
    })))
}

#[test]
fn app_error_with_details_redacts_sensitive_keys_recursively() {
    let err = AppError::new("TEST", "test").with_details(serde_json::json!({
        "authorization": "Bearer abc",
        "nested": {
            "client_secret": "top-secret",
            "refresh-token": "refresh-secret",
            "safe": "ok"
        },
        "items": [
            {"cookie": "session=abc"},
            {"api_key": "key-123"},
            {"safe": "value"}
        ],
        "safe": "keep"
    }));

    let details = err.details.expect("details should exist");
    assert_eq!(details["authorization"], "<redacted>");
    assert_eq!(details["nested"]["client_secret"], "<redacted>");
    assert_eq!(details["nested"]["refresh-token"], "<redacted>");
    assert_eq!(details["nested"]["safe"], "ok");
    assert_eq!(details["items"][0]["cookie"], "<redacted>");
    assert_eq!(details["items"][1]["api_key"], "<redacted>");
    assert_eq!(details["items"][2]["safe"], "value");
    assert_eq!(details["safe"], "keep");
}

#[test]
fn app_error_new_sanitizes_sensitive_or_oversized_messages() {
    let panic_like = AppError::new(
        "TEST",
        "thread 'main' panicked at src/main.rs:10:3\nstack backtrace: ...",
    );
    assert_eq!(panic_like.message, "internal error");

    let long = AppError::new("TEST", "x".repeat(MAX_IPC_ERROR_MESSAGE_CHARS + 64));
    assert!(long.message.ends_with("..."));
    assert!(long.message.chars().count() <= MAX_IPC_ERROR_MESSAGE_CHARS + 3);
}

#[test]
fn command_error_boundary_serialization_keeps_details_redacted() {
    let err =
        command_error_redaction_probe_for_test().expect_err("probe should return command error");

    let wire = serde_json::to_value(&err).expect("serialize AppError");
    assert_eq!(wire["code"], "TEST_REDACTION_PROBE");
    assert_eq!(wire["message"], "synthetic command error");
    assert_eq!(wire["details"]["authorization"], "<redacted>");
    assert_eq!(wire["details"]["nested"]["cookie"], "<redacted>");
    assert_eq!(wire["details"]["nested"]["safe"], "keep");
    assert_eq!(wire["details"]["items"][0]["client_secret"], "<redacted>");
    assert_eq!(wire["details"]["items"][1]["safe"], "ok");

    let round_trip: AppError = serde_json::from_value(wire).expect("deserialize AppError");
    let details = round_trip.details.expect("round-tripped details");
    assert_eq!(details["authorization"], "<redacted>");
    assert_eq!(details["nested"]["cookie"], "<redacted>");
    assert_eq!(details["items"][0]["client_secret"], "<redacted>");
}

#[test]
fn command_error_boundary_never_serializes_secret_store_values() {
    let err =
        command_error_secret_store_probe_for_test().expect_err("probe should return command error");

    let wire = serde_json::to_value(&err).expect("serialize AppError");
    let wire_text = serde_json::to_string(&wire).expect("stringify AppError payload");
    assert_eq!(wire["code"], "TEST_SECRET_STORE_REDACTION");
    assert_eq!(wire["details"]["api_key"], "<redacted>");
    assert_eq!(wire["details"]["nested"]["client_secret"], "<redacted>");
    assert_eq!(
        wire["details"]["nested"]["debug"],
        "SecretValue(<redacted>)"
    );
    assert_eq!(wire["details"]["safe"], "keep");
    assert!(!wire_text.contains("store-secret-123"));
}
#[test]
fn resample_stereo_interleaved_frames_converts_44100_to_48000() {
    let source_rate = 44100;
    let target_rate = 48000;
    let mut interleaved = Vec::with_capacity(source_rate * 2);
    for i in 0..source_rate {
        let t = i as f32 / source_rate as f32;
        let sample = (t * 440.0 * 2.0 * std::f32::consts::PI).sin();
        interleaved.push(sample); // Left
        interleaved.push(sample); // Right
    }

    let resampled = super::resample_stereo_interleaved_frames(
        &interleaved,
        source_rate as u32,
        target_rate as u32,
    )
    .expect("resampling should succeed");

    // Should be roughly 48000 frames (96000 samples)
    // Note: SincFixedIn has ~140 frames of algorithmic filter delay retained in the buffer.
    let resampled_frames = resampled.len() / 2;
    assert!(
        (resampled_frames as isize - target_rate as isize).abs() < 300,
        "expected roughly {} frames, got {}",
        target_rate,
        resampled_frames
    );
}

