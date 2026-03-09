use super::*;

#[tauri::command]
pub async fn qc_get_feature_flags() -> Result<QcFeatureFlagsResponse, AppError> {
    Ok(qc_feature_flags_from_env())
}

#[tauri::command]
pub async fn qc_list_codec_profiles() -> Result<Vec<QcCodecProfileResponse>, AppError> {
    let flags = qc_feature_flags_from_env();
    Ok(qc_codec_profile_registry(&flags))
}

#[tauri::command]
pub async fn qc_prepare_preview_session(
    input: QcPreparePreviewSessionInput,
) -> Result<QcPreviewSessionStateResponse, AppError> {
    let flags = qc_feature_flags_from_env();
    if !flags.qc_codec_preview_v1 {
        return Err(
            AppError::feature_disabled("QC codec preview is disabled in this build").with_details(
                serde_json::json!({
                    "flag": ENV_QC_CODEC_PREVIEW_V1,
                    "default": DEFAULT_QC_CODEC_PREVIEW_V1
                }),
            ),
        );
    }

    let source_track_id = validate_catalog_track_id(&input.source_track_id)?;
    let profile_a_id = normalize_qc_profile_id(&input.profile_a_id, "profile_a_id")?;
    let profile_b_id = normalize_qc_profile_id(&input.profile_b_id, "profile_b_id")?;
    if profile_a_id == profile_b_id {
        return Err(AppError::invalid_argument(
            "profile_a_id and profile_b_id must be different",
        ));
    }

    let profiles = qc_codec_profile_registry(&flags);
    ensure_qc_profile_ids_known(&[profile_a_id.clone(), profile_b_id.clone()], &profiles)?;

    let active_variant = if input.blind_x_enabled {
        QcPreviewVariant::BlindX
    } else {
        QcPreviewVariant::Bypass
    };
    let session = QcPreviewSessionStateResponse {
        source_track_id,
        active_variant,
        profile_a_id,
        profile_b_id,
        blind_x_enabled: input.blind_x_enabled,
        blind_x_revealed: !input.blind_x_enabled,
    };
    shared_qc_preview_store().set_state(session)
}

#[tauri::command]
pub async fn qc_get_preview_session() -> Result<Option<QcPreviewSessionStateResponse>, AppError> {
    shared_qc_preview_store().get_state()
}

#[tauri::command]
pub async fn qc_set_preview_variant(
    variant: QcPreviewVariant,
) -> Result<QcPreviewSessionStateResponse, AppError> {
    let flags = qc_feature_flags_from_env();
    if !flags.qc_codec_preview_v1 {
        return Err(
            AppError::feature_disabled("QC codec preview is disabled in this build").with_details(
                serde_json::json!({
                    "flag": ENV_QC_CODEC_PREVIEW_V1,
                    "default": DEFAULT_QC_CODEC_PREVIEW_V1
                }),
            ),
        );
    }
    shared_qc_preview_store().set_active_variant(variant)
}

#[tauri::command]
pub async fn qc_reveal_blind_x() -> Result<QcPreviewSessionStateResponse, AppError> {
    let flags = qc_feature_flags_from_env();
    if !flags.qc_codec_preview_v1 {
        return Err(
            AppError::feature_disabled("QC codec preview is disabled in this build").with_details(
                serde_json::json!({
                    "flag": ENV_QC_CODEC_PREVIEW_V1,
                    "default": DEFAULT_QC_CODEC_PREVIEW_V1
                }),
            ),
        );
    }
    shared_qc_preview_store().reveal_blind_x()
}

#[tauri::command]
pub async fn qc_get_active_preview_media() -> Result<QcPreviewActiveMediaResponse, AppError> {
    let flags = qc_feature_flags_from_env();
    if !flags.qc_codec_preview_v1 {
        return Err(
            AppError::feature_disabled("QC codec preview is disabled in this build").with_details(
                serde_json::json!({
                    "flag": ENV_QC_CODEC_PREVIEW_V1,
                    "default": DEFAULT_QC_CODEC_PREVIEW_V1
                }),
            ),
        );
    }

    let service = shared_service().await?;
    let store = shared_qc_preview_store();
    qc_get_active_preview_media_with_dependencies(service, store.as_ref(), &flags).await
}

pub(super) async fn qc_get_active_preview_media_with_dependencies(
    service: Arc<CommandService>,
    store: &QcPreviewSessionStore,
    flags: &QcFeatureFlagsResponse,
) -> Result<QcPreviewActiveMediaResponse, AppError> {
    let session = store
        .get_state()?
        .ok_or_else(|| AppError::invalid_argument("QC preview session is not prepared"))?;
    let media_state =
        qc_ensure_preview_media_state(service.as_ref(), store, flags, &session).await?;

    let (resolved_variant, media_path) = match session.active_variant {
        QcPreviewVariant::Bypass => (
            QcPreviewVariant::Bypass,
            media_state.source_media_path.clone(),
        ),
        QcPreviewVariant::CodecA => (
            QcPreviewVariant::CodecA,
            media_state.codec_a_media_path.clone(),
        ),
        QcPreviewVariant::CodecB => (
            QcPreviewVariant::CodecB,
            media_state.codec_b_media_path.clone(),
        ),
        QcPreviewVariant::BlindX => match media_state.blind_x_assignment {
            QcPreviewVariant::CodecB => (
                QcPreviewVariant::CodecB,
                media_state.codec_b_media_path.clone(),
            ),
            _ => (
                QcPreviewVariant::CodecA,
                media_state.codec_a_media_path.clone(),
            ),
        },
    };
    let blind_x_resolved_variant =
        if matches!(session.active_variant, QcPreviewVariant::BlindX) && session.blind_x_revealed {
            Some(resolved_variant)
        } else {
            None
        };
    Ok(QcPreviewActiveMediaResponse {
        variant: session.active_variant,
        media_path,
        blind_x_resolved_variant,
    })
}

#[tauri::command]
pub async fn qc_start_batch_export(
    input: QcBatchExportStartInput,
) -> Result<QcBatchExportStartResponse, AppError> {
    let service = shared_service().await?;
    let flags = qc_feature_flags_from_env();
    qc_start_batch_export_with_dependencies(service, &flags, input).await
}

pub(super) async fn qc_start_batch_export_with_dependencies(
    service: Arc<CommandService>,
    flags: &QcFeatureFlagsResponse,
    input: QcBatchExportStartInput,
) -> Result<QcBatchExportStartResponse, AppError> {
    if !flags.qc_batch_export_v1 {
        return Err(
            AppError::feature_disabled("QC batch export is disabled in this build").with_details(
                serde_json::json!({
                    "flag": ENV_QC_BATCH_EXPORT_V1,
                    "default": DEFAULT_QC_BATCH_EXPORT_V1
                }),
            ),
        );
    }

    let source_track_id = validate_catalog_track_id(&input.source_track_id)?;
    let output_dir = input.output_dir.trim().to_string();
    if output_dir.is_empty() {
        return Err(AppError::invalid_argument("output_dir cannot be empty"));
    }
    tokio::fs::create_dir_all(&output_dir)
        .await
        .map_err(|error| {
            AppError::file_write_failed(format!("failed to create output_dir: {error}"))
        })?;
    let output_dir_path = tokio::fs::canonicalize(&output_dir)
        .await
        .map_err(|error| {
            AppError::file_read_failed(format!("failed to canonicalize output_dir: {error}"))
        })?;
    let output_dir_metadata = tokio::fs::metadata(&output_dir_path)
        .await
        .map_err(|error| {
            AppError::file_read_failed(format!("failed to stat output_dir: {error}"))
        })?;
    if !output_dir_metadata.is_dir() {
        return Err(AppError::invalid_argument("output_dir must be a directory"));
    }

    if let Some(target_integrated_lufs) = input.target_integrated_lufs {
        if !target_integrated_lufs.is_finite() {
            return Err(AppError::invalid_argument(
                "target_integrated_lufs must be finite when present",
            ));
        }
    }

    if input.profile_ids.is_empty() {
        return Err(AppError::invalid_argument(
            "profile_ids must include at least one entry",
        ));
    }
    let profile_ids = input
        .profile_ids
        .iter()
        .map(|raw| normalize_qc_profile_id(raw, "profile_ids[]"))
        .collect::<Result<Vec<_>, _>>()?;
    let known_profiles = qc_codec_profile_registry(flags);
    ensure_qc_profile_ids_known(&profile_ids, &known_profiles)?;
    let known_profiles_by_id: HashMap<String, QcCodecProfileResponse> = known_profiles
        .into_iter()
        .map(|profile| (profile.profile_id.clone(), profile))
        .collect();
    let selected_profiles = profile_ids
        .iter()
        .map(|profile_id| {
            known_profiles_by_id
                .get(profile_id)
                .cloned()
                .ok_or_else(|| {
                    AppError::invalid_argument(format!("unknown qc profile_id: {profile_id}"))
                })
        })
        .collect::<Result<Vec<_>, _>>()?;
    if selected_profiles.iter().any(|profile| !profile.available) {
        return Err(AppError::invalid_argument(
            "selected qc profile_ids must be available in this build",
        ));
    }

    let Some(source_track) = service.db.get_catalog_track(&source_track_id).await? else {
        return Err(AppError::invalid_argument(
            "source_track_id must reference a catalog track in the local library",
        ));
    };
    let source_file_input = strip_single_layer_matching_quotes(source_track.file_path.trim());
    let source_file_path = tokio::fs::canonicalize(PathBuf::from(source_file_input))
        .await
        .map_err(|error| {
            AppError::file_read_failed(format!("failed to canonicalize source track file: {error}"))
        })?;
    let source_file_metadata = tokio::fs::metadata(&source_file_path)
        .await
        .map_err(|error| {
            AppError::file_read_failed(format!("failed to stat source track file: {error}"))
        })?;
    if !source_file_metadata.is_file() {
        return Err(AppError::invalid_argument(
            "source track file must be a file",
        ));
    }

    let job_id = next_qc_batch_export_job_id(&source_track_id);
    let job_store = shared_qc_batch_export_job_store();
    let now = current_unix_ms();
    let mut queued_job = QcBatchExportJobStatusResponse {
        job_id: job_id.clone(),
        source_track_id: source_track_id.clone(),
        output_dir: path_to_string(&output_dir_path),
        requested_profile_ids: profile_ids.clone(),
        requested_target_integrated_lufs: input.target_integrated_lufs,
        status: "queued".to_string(),
        progress_percent: 0,
        total_profiles: selected_profiles.len(),
        completed_profiles: 0,
        failed_profiles: 0,
        created_at_unix_ms: now,
        updated_at_unix_ms: now,
        summary_path: None,
        profiles: selected_profiles
            .iter()
            .map(|profile| QcBatchExportProfileStatusResponse {
                profile_id: profile.profile_id.clone(),
                codec_family: profile.codec_family.clone(),
                target_platform: profile.target_platform.clone(),
                target_bitrate_kbps: profile.target_bitrate_kbps,
                status: "queued".to_string(),
                progress_percent: 0,
                output_path: None,
                output_bytes: None,
                message: None,
            })
            .collect(),
    };
    qc_refresh_batch_export_progress(&mut queued_job);
    job_store.insert_job(queued_job);

    let output_dir_for_worker = output_dir_path.clone();
    let source_track_id_for_worker = source_track_id.clone();
    let source_file_path_for_worker = source_file_path.clone();
    let selected_profiles_for_worker = selected_profiles.clone();
    let target_integrated_lufs = input.target_integrated_lufs;
    let job_id_for_worker = job_id.clone();
    let job_store_for_worker = Arc::clone(&job_store);

    tokio::spawn(async move {
        run_qc_batch_export_job(
            job_id_for_worker,
            source_track_id_for_worker,
            source_file_path_for_worker,
            output_dir_for_worker,
            selected_profiles_for_worker,
            target_integrated_lufs,
            job_store_for_worker,
        )
        .await;
    });

    Ok(QcBatchExportStartResponse {
        job_id: job_id.clone(),
        status: "queued".to_string(),
        message: format!(
            "QC batch export queued for {} profile(s); poll qc_get_batch_export_job_status with job_id {}",
            profile_ids.len(),
            job_id
        ),
    })
}

#[tauri::command]
pub async fn qc_get_batch_export_job_status(
    job_id: String,
) -> Result<Option<QcBatchExportJobStatusResponse>, AppError> {
    let job_id = validate_catalog_hex_id(&job_id, "qc batch export job_id")?;
    shared_qc_batch_export_job_store().get_job(&job_id)
}
