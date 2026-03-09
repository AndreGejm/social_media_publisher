use super::*;

#[tauri::command]
pub async fn load_spec(path: String) -> Result<LoadSpecResponse, AppError> {
    shared_service().await?.handle_load_spec(&path).await
}

#[tauri::command]
pub async fn plan_release(input: PlanReleaseInput) -> Result<PlanReleaseResponse, AppError> {
    shared_service().await?.handle_plan_release(input).await
}

#[tauri::command]
pub async fn execute_release(release_id: String) -> Result<ExecuteReleaseResponse, AppError> {
    shared_service()
        .await?
        .handle_execute_release(&release_id)
        .await
}

#[tauri::command]
pub async fn list_history() -> Result<Vec<HistoryRow>, AppError> {
    shared_service().await?.handle_list_history().await
}

#[tauri::command]
pub async fn get_report(release_id: String) -> Result<Option<ReleaseReport>, AppError> {
    shared_service().await?.handle_get_report(&release_id).await
}

#[tauri::command]
pub async fn analyze_audio_file(path: String) -> Result<AnalyzeAudioFileResponse, AppError> {
    shared_service()
        .await?
        .handle_analyze_audio_file(&path)
        .await
}

#[tauri::command]
pub async fn analyze_and_persist_release_track(
    release_id: String,
    path: String,
) -> Result<ReleaseTrackAnalysisResponse, AppError> {
    shared_service()
        .await?
        .handle_analyze_and_persist_release_track(&release_id, &path)
        .await
}

#[tauri::command]
pub async fn get_release_track_analysis(
    release_id: String,
) -> Result<Option<ReleaseTrackAnalysisResponse>, AppError> {
    shared_service()
        .await?
        .handle_get_release_track_analysis(&release_id)
        .await
}

impl CommandService {
    pub(super) async fn handle_load_spec(&self, path: &str) -> Result<LoadSpecResponse, AppError> {
        let canonical = canonicalize_file_path(path, "spec file").await?;
        let bytes = tokio::fs::read(&canonical)
            .await
            .map_err(|e| AppError::file_read_failed(format!("failed to read spec file: {e}")))?;
        let raw = String::from_utf8(bytes).map_err(|e| {
            AppError::invalid_encoding(format!("spec file must be valid UTF-8: {e}"))
        })?;

        match parse_release_spec_yaml(&raw) {
            Ok(spec) => Ok(LoadSpecResponse {
                ok: true,
                spec: Some(spec),
                errors: vec![],
                canonical_path: Some(path_to_string(&canonical)),
            }),
            Err(errors) => Ok(LoadSpecResponse {
                ok: false,
                spec: None,
                errors,
                canonical_path: Some(path_to_string(&canonical)),
            }),
        }
    }

    pub(super) async fn handle_plan_release(
        &self,
        input: PlanReleaseInput,
    ) -> Result<PlanReleaseResponse, AppError> {
        let spec_path = canonicalize_file_path(&input.spec_path, "spec file").await?;
        let media_path = canonicalize_file_path(&input.media_path, "media file").await?;
        let platforms = validate_plan_release_platforms(&input.platforms)?;

        let spec_bytes = tokio::fs::read(&spec_path)
            .await
            .map_err(|e| AppError::file_read_failed(format!("failed to read spec file: {e}")))?;
        let media_bytes = tokio::fs::read(&media_path)
            .await
            .map_err(|e| AppError::file_read_failed(format!("failed to read media file: {e}")))?;
        let raw_spec = String::from_utf8(spec_bytes).map_err(|e| {
            AppError::invalid_encoding(format!("spec file must be valid UTF-8: {e}"))
        })?;
        let spec = parse_release_spec_yaml(&raw_spec).map_err(|errors| {
            AppError::new(
                app_error_codes::SPEC_VALIDATION_FAILED,
                "release spec is invalid",
            )
            .with_details(serde_json::json!({ "errors": errors }))
        })?;

        let planned = self
            .orchestrator
            .plan_release(RunReleaseInput::new(
                spec,
                media_bytes,
                input.env.clone().into(),
                platforms,
                &self.artifacts_root,
            ))
            .await?;

        let response = PlanReleaseResponse {
            release_id: planned.release_id.clone(),
            run_id: planned.run_id.clone(),
            env: input.env,
            planned_actions: flatten_planned_actions(&planned),
            planned_request_files: planned
                .planned_request_files
                .iter()
                .map(|(platform, path)| (platform.clone(), path_to_string(path)))
                .collect(),
        };

        persist_planned_release_descriptor(&planned).await?;

        Ok(response)
    }

    pub(super) async fn handle_execute_release(
        &self,
        release_id: &str,
    ) -> Result<ExecuteReleaseResponse, AppError> {
        let release_id = validate_release_id_for_artifact_lookup(release_id)?;
        let planned = self
            .load_persisted_planned_release_descriptor(&release_id)
            .await?
            .ok_or_else(|| {
                AppError::new(
                    app_error_codes::PLANNED_RELEASE_NOT_FOUND,
                    "release must be planned before execution and have a valid persisted descriptor",
                )
            })?;

        let output = self.orchestrator.execute_planned_release(planned).await?;
        Ok(ExecuteReleaseResponse {
            release_id: output.report.release_id.clone(),
            status: output.report.state.clone(),
            message: "Execution completed (TEST mode remains simulation-only).".to_string(),
            report_path: Some(path_to_string(&output.release_report_path)),
        })
    }

    pub(super) async fn handle_list_history(&self) -> Result<Vec<HistoryRow>, AppError> {
        let rows = self.orchestrator.db().list_history().await?;
        Ok(rows
            .into_iter()
            .map(|row| HistoryRow {
                release_id: row.release_id,
                state: row.state,
                title: row.title,
                updated_at: row.updated_at,
            })
            .collect())
    }

    pub(super) async fn handle_get_report(
        &self,
        release_id: &str,
    ) -> Result<Option<ReleaseReport>, AppError> {
        let release_id = validate_release_id_for_artifact_lookup(release_id)?;
        let report_path = self
            .artifacts_root
            .join(&release_id)
            .join("release_report.json");
        let exists = tokio::fs::try_exists(&report_path)
            .await
            .map_err(|e| AppError::file_read_failed(format!("failed to check report file: {e}")))?;
        if !exists {
            return Ok(None);
        }

        let bytes = tokio::fs::read(&report_path)
            .await
            .map_err(|e| AppError::file_read_failed(format!("failed to read report file: {e}")))?;
        let DecodedReleaseReport { parsed, raw } = decode_release_report_artifact(&bytes)?;

        Ok(Some(ReleaseReport {
            release_id: parsed.release_id.clone(),
            summary: format!(
                "{} [{}] {} platform(s)",
                parsed.title,
                parsed.state,
                parsed.platforms.len()
            ),
            actions: parsed
                .platforms
                .iter()
                .map(|platform| PlannedAction {
                    platform: platform.platform.clone(),
                    action: format!(
                        "{} ({})",
                        platform.status,
                        if platform.simulated {
                            "simulated"
                        } else {
                            "live"
                        }
                    ),
                    simulated: platform.simulated,
                })
                .collect(),
            raw: Some(raw),
        }))
    }

    pub(super) async fn handle_analyze_audio_file(
        &self,
        path: &str,
    ) -> Result<AnalyzeAudioFileResponse, AppError> {
        let canonical = canonicalize_file_path(path, "audio file").await?;
        let analyzed = analyze_audio_file_to_track_payload(&canonical).await?;
        Ok(AnalyzeAudioFileResponse {
            canonical_path: path_to_string(&canonical),
            media_fingerprint: analyzed.media_fingerprint,
            track: analyzed.track,
            sample_rate_hz: analyzed.sample_rate_hz,
            channels: analyzed.channels,
        })
    }

    pub(super) async fn handle_analyze_and_persist_release_track(
        &self,
        release_id: &str,
        path: &str,
    ) -> Result<ReleaseTrackAnalysisResponse, AppError> {
        let release_id = validate_release_id_for_artifact_lookup(release_id)?;
        let canonical = canonicalize_file_path(path, "audio file").await?;
        let analyzed = analyze_audio_file_to_track_payload(&canonical).await?;

        let release = self
            .orchestrator
            .db()
            .get_release(&release_id)
            .await?
            .ok_or_else(|| {
                AppError::invalid_argument(
                    "release_id must exist in local history before persisting track analysis",
                )
            })?;

        if release.media_fingerprint != analyzed.media_fingerprint {
            return Err(AppError::new(
                app_error_codes::MEDIA_FINGERPRINT_MISMATCH,
                "audio file does not match the planned release media fingerprint",
            )
            .with_details(serde_json::json!({
                "release_id": release_id,
                "expected_media_fingerprint": release.media_fingerprint,
                "actual_media_fingerprint": analyzed.media_fingerprint,
            })));
        }

        let row = self
            .orchestrator
            .db()
            .upsert_release_track_analysis(&UpsertReleaseTrackAnalysis {
                release_id: release_id.clone(),
                file_path: path_to_string(&canonical),
                media_fingerprint: analyzed.media_fingerprint.clone(),
                duration_ms: analyzed.track.duration_ms(),
                peak_data: analyzed.track.peak_data().to_vec(),
                loudness_lufs: analyzed.track.loudness_lufs(),
                sample_rate_hz: analyzed.sample_rate_hz,
                channels: analyzed.channels,
            })
            .await?;

        self.build_release_track_analysis_response(row).await
    }

    pub(super) async fn handle_get_release_track_analysis(
        &self,
        release_id: &str,
    ) -> Result<Option<ReleaseTrackAnalysisResponse>, AppError> {
        let release_id = validate_release_id_for_artifact_lookup(release_id)?;
        let Some(row) = self
            .orchestrator
            .db()
            .get_release_track_analysis(&release_id)
            .await?
        else {
            return Ok(None);
        };

        Ok(Some(self.build_release_track_analysis_response(row).await?))
    }
}
