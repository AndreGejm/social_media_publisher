use super::*;

#[tauri::command]
pub async fn catalog_import_files(
    paths: Vec<String>,
) -> Result<CatalogImportFilesResponse, AppError> {
    let started = Instant::now();
    tracing::info!(
        target: "desktop.catalog",
        command = "catalog_import_files",
        path_count = paths.len(),
        "command started"
    );
    let result = shared_service()
        .await?
        .handle_catalog_import_files(paths)
        .await;
    match &result {
        Ok(response) => tracing::info!(
            target: "desktop.catalog",
            command = "catalog_import_files",
            elapsed_ms = started.elapsed().as_millis() as u64,
            imported = response.imported.len(),
            failed = response.failed.len(),
            "command completed"
        ),
        Err(error) => tracing::warn!(
            target: "desktop.catalog",
            command = "catalog_import_files",
            elapsed_ms = started.elapsed().as_millis() as u64,
            error_code = %error.code,
            error = %error.message,
            "command failed"
        ),
    }
    result
}

#[tauri::command]
pub async fn catalog_list_tracks(
    query: Option<CatalogListTracksInput>,
) -> Result<CatalogListTracksResponse, AppError> {
    let started = Instant::now();
    tracing::info!(
        target: "desktop.catalog",
        command = "catalog_list_tracks",
        has_search = query
            .as_ref()
            .and_then(|item| item.search.as_ref())
            .map(|item| !item.trim().is_empty())
            .unwrap_or(false),
        limit = query.as_ref().and_then(|item| item.limit).unwrap_or(100),
        offset = query.as_ref().and_then(|item| item.offset).unwrap_or(0),
        "command started"
    );
    let result = shared_service()
        .await?
        .handle_catalog_list_tracks(query)
        .await;
    match &result {
        Ok(response) => tracing::info!(
            target: "desktop.catalog",
            command = "catalog_list_tracks",
            elapsed_ms = started.elapsed().as_millis() as u64,
            returned = response.items.len(),
            total = response.total,
            "command completed"
        ),
        Err(error) => tracing::warn!(
            target: "desktop.catalog",
            command = "catalog_list_tracks",
            elapsed_ms = started.elapsed().as_millis() as u64,
            error_code = %error.code,
            error = %error.message,
            "command failed"
        ),
    }
    result
}

#[tauri::command]
pub async fn catalog_get_track(
    track_id: String,
) -> Result<Option<CatalogTrackDetailResponse>, AppError> {
    shared_service()
        .await?
        .handle_catalog_get_track(&track_id)
        .await
}

#[tauri::command]
pub async fn publisher_create_draft_from_track(
    track_id: String,
) -> Result<PublisherCreateDraftFromTrackResponse, AppError> {
    shared_service()
        .await?
        .handle_publisher_create_draft_from_track(&track_id)
        .await
}

#[tauri::command]
pub async fn catalog_update_track_metadata(
    input: CatalogUpdateTrackMetadataInput,
) -> Result<CatalogTrackDetailResponse, AppError> {
    shared_service()
        .await?
        .handle_catalog_update_track_metadata(input)
        .await
}

#[tauri::command]
pub async fn catalog_add_library_root(path: String) -> Result<LibraryRootResponse, AppError> {
    let started = Instant::now();
    tracing::info!(
        target: "desktop.catalog",
        command = "catalog_add_library_root",
        path_len = path.len(),
        "command started"
    );
    let result = shared_service()
        .await?
        .handle_catalog_add_library_root(&path)
        .await;
    match &result {
        Ok(response) => tracing::info!(
            target: "desktop.catalog",
            command = "catalog_add_library_root",
            elapsed_ms = started.elapsed().as_millis() as u64,
            root_id = %response.root_id,
            "command completed"
        ),
        Err(error) => tracing::warn!(
            target: "desktop.catalog",
            command = "catalog_add_library_root",
            elapsed_ms = started.elapsed().as_millis() as u64,
            error_code = %error.code,
            error = %error.message,
            "command failed"
        ),
    }
    result
}

#[tauri::command]
pub async fn catalog_list_library_roots() -> Result<Vec<LibraryRootResponse>, AppError> {
    let started = Instant::now();
    tracing::info!(
        target: "desktop.catalog",
        command = "catalog_list_library_roots",
        "command started"
    );
    let result = shared_service()
        .await?
        .handle_catalog_list_library_roots()
        .await;
    match &result {
        Ok(response) => tracing::info!(
            target: "desktop.catalog",
            command = "catalog_list_library_roots",
            elapsed_ms = started.elapsed().as_millis() as u64,
            roots = response.len(),
            "command completed"
        ),
        Err(error) => tracing::warn!(
            target: "desktop.catalog",
            command = "catalog_list_library_roots",
            elapsed_ms = started.elapsed().as_millis() as u64,
            error_code = %error.code,
            error = %error.message,
            "command failed"
        ),
    }
    result
}

#[tauri::command]
pub async fn catalog_remove_library_root(root_id: String) -> Result<bool, AppError> {
    shared_service()
        .await?
        .handle_catalog_remove_library_root(&root_id)
        .await
}

#[tauri::command]
pub async fn catalog_reset_library_data() -> Result<bool, AppError> {
    let started = Instant::now();
    tracing::info!(
        target: "desktop.catalog",
        command = "catalog_reset_library_data",
        "command started"
    );
    let result = shared_service()
        .await?
        .handle_catalog_reset_library_data()
        .await;
    match &result {
        Ok(_) => tracing::info!(
            target: "desktop.catalog",
            command = "catalog_reset_library_data",
            elapsed_ms = started.elapsed().as_millis() as u64,
            "command completed"
        ),
        Err(error) => tracing::warn!(
            target: "desktop.catalog",
            command = "catalog_reset_library_data",
            elapsed_ms = started.elapsed().as_millis() as u64,
            error_code = %error.code,
            error = %error.message,
            "command failed"
        ),
    }
    result
}

#[tauri::command]
pub async fn catalog_scan_root(root_id: String) -> Result<CatalogScanRootResponse, AppError> {
    let started = Instant::now();
    tracing::info!(
        target: "desktop.catalog",
        command = "catalog_scan_root",
        root_id = %root_id,
        "command started"
    );
    let service = shared_service().await?;
    let prepared = service
        .handle_catalog_scan_root_prepare(&root_id)
        .await
        .inspect_err(|error| {
            tracing::warn!(
                target: "desktop.catalog",
                command = "catalog_scan_root",
                root_id = %root_id,
                elapsed_ms = started.elapsed().as_millis() as u64,
                error_code = %error.code,
                error = %error.message,
                "command failed before dispatch"
            );
        })?;
    let response = CatalogScanRootResponse {
        job_id: prepared.job.job_id.clone(),
        root_id: prepared.root.root_id.clone(),
    };
    tracing::info!(
        target: "desktop.catalog",
        command = "catalog_scan_root",
        root_id = %response.root_id,
        job_id = %response.job_id,
        elapsed_ms = started.elapsed().as_millis() as u64,
        "command dispatched background job"
    );
    let service_clone = Arc::clone(&service);
    tokio::spawn(async move {
        run_catalog_scan_job(service_clone, prepared.root, prepared.job.job_id).await;
    });
    Ok(response)
}

#[tauri::command]
pub async fn catalog_get_ingest_job(
    job_id: String,
) -> Result<Option<CatalogIngestJobResponse>, AppError> {
    shared_service()
        .await?
        .handle_catalog_get_ingest_job(&job_id)
        .await
}

#[tauri::command]
pub async fn catalog_cancel_ingest_job(job_id: String) -> Result<bool, AppError> {
    let started = Instant::now();
    tracing::info!(
        target: "desktop.catalog",
        command = "catalog_cancel_ingest_job",
        job_id = %job_id,
        "command started"
    );
    let result = shared_service()
        .await?
        .handle_catalog_cancel_ingest_job(&job_id)
        .await;
    match &result {
        Ok(canceled) => tracing::info!(
            target: "desktop.catalog",
            command = "catalog_cancel_ingest_job",
            job_id = %job_id,
            canceled = *canceled,
            elapsed_ms = started.elapsed().as_millis() as u64,
            "command completed"
        ),
        Err(error) => tracing::warn!(
            target: "desktop.catalog",
            command = "catalog_cancel_ingest_job",
            job_id = %job_id,
            elapsed_ms = started.elapsed().as_millis() as u64,
            error_code = %error.code,
            error = %error.message,
            "command failed"
        ),
    }
    result
}
