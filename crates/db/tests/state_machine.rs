use release_publisher_db::{
    retry_busy_locked_with_sleep, CatalogListTracksQuery, CatalogTrackTagAssignment, Db,
    DbBusyRetryPolicy, DbConfig, DbErrorCode, IngestJobStatus, NewAuditLogEntry, NewIngestEvent,
    NewIngestJob, NewReleaseRecord, PlatformActionStatus, ReleaseState, ReleaseTrackAnalysisRecord,
    RunLockLeaseRecord, UpdateCatalogTrackMetadata, UpdateIngestJob, UpsertCatalogTrackImport,
    UpsertLibraryRoot, UpsertPlatformAction, UpsertReleaseTrackAnalysis,
};
use serde_json::json;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use std::time::Duration;
use tempfile::tempdir;
use tokio::sync::oneshot;

fn sqlite_file_url(db_path: &std::path::Path) -> String {
    let mut normalized = db_path.to_string_lossy().replace('\\', "/");
    if normalized.len() >= 2 {
        let bytes = normalized.as_bytes();
        if bytes[1] == b':' && bytes[0].is_ascii_alphabetic() && !normalized.starts_with('/') {
            normalized.insert(0, '/');
        }
    }
    format!("sqlite://{normalized}")
}

async fn new_test_db() -> Db {
    let mut cfg = DbConfig::sqlite("sqlite::memory:");
    cfg.max_connections = 1;
    Db::connect(&cfg).await.expect("test DB should connect")
}

async fn new_file_backed_pair() -> (Db, Db) {
    let dir = tempdir().expect("tempdir");
    let db_path = dir.path().join("locktest.sqlite");
    // Keep the tempdir alive for the duration of this helper by leaking it in test scope.
    let _leaked = Box::leak(Box::new(dir));
    std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(&db_path)
        .expect("create lock test DB file");
    let url = sqlite_file_url(&db_path);

    let mut cfg_a = DbConfig::sqlite(url.clone());
    cfg_a.max_connections = 1;
    let mut cfg_b = DbConfig::sqlite(url);
    cfg_b.max_connections = 1;

    let a = Db::connect(&cfg_a).await.expect("db a");
    let b = Db::connect(&cfg_b).await.expect("db b");
    (a, b)
}

async fn set_sqlite_busy_timeout_ms(db: &Db, timeout_ms: i64) {
    assert!(timeout_ms >= 0, "busy_timeout must be non-negative");
    sqlx::query(&format!("PRAGMA busy_timeout = {timeout_ms};"))
        .execute(db.pool())
        .await
        .expect("set sqlite busy_timeout");
}

fn sample_release(release_id: &str) -> NewReleaseRecord {
    NewReleaseRecord {
        release_id: release_id.to_string(),
        title: "Test Track".to_string(),
        state: ReleaseState::Validated,
        spec_hash: "a".repeat(64),
        media_fingerprint: "b".repeat(64),
        normalized_spec_json: "{\"title\":\"Test Track\"}".to_string(),
    }
}

fn sample_catalog_track_import(track_id_suffix: &str, file_path: &str) -> UpsertCatalogTrackImport {
    UpsertCatalogTrackImport {
        track_id: format!("{track_id_suffix:0<64}")
            .chars()
            .map(|c| if c.is_ascii_hexdigit() { c } else { 'a' })
            .collect(),
        media_asset_id: "b".repeat(64),
        artist_id: "a".repeat(64),
        album_id: Some("c".repeat(64)),
        file_path: file_path.to_string(),
        media_fingerprint: "d".repeat(64),
        title: "Imported Track".to_string(),
        artist_name: "Example Artist".to_string(),
        album_title: Some("Singles".to_string()),
        duration_ms: 2_500,
        peak_data: vec![-12.0, -9.0, -6.0, -3.0],
        loudness_lufs: -14.4,
        true_peak_dbfs: Some(-1.2),
        sample_rate_hz: 44_100,
        channels: 2,
        visibility_policy: "LOCAL".to_string(),
        license_policy: "ALL_RIGHTS_RESERVED".to_string(),
        downloadable: false,
    }
}

#[tokio::test]
async fn state_machine_happy_path_transitions() {
    let db = new_test_db().await;
    db.upsert_release(&sample_release("r1")).await.unwrap();

    assert!(db
        .transition_release_state("r1", ReleaseState::Validated, ReleaseState::Planned)
        .await
        .unwrap());
    assert!(db
        .transition_release_state("r1", ReleaseState::Planned, ReleaseState::Executing)
        .await
        .unwrap());
    assert!(db
        .transition_release_state("r1", ReleaseState::Executing, ReleaseState::Verified)
        .await
        .unwrap());
    assert!(db
        .transition_release_state("r1", ReleaseState::Verified, ReleaseState::Committed)
        .await
        .unwrap());

    let stored = db.get_release("r1").await.unwrap().unwrap();
    assert_eq!(stored.state, ReleaseState::Committed);
}

#[tokio::test]
async fn invalid_transition_is_rejected() {
    let db = new_test_db().await;
    db.upsert_release(&sample_release("r2")).await.unwrap();

    let err = db
        .transition_release_state("r2", ReleaseState::Validated, ReleaseState::Verified)
        .await
        .expect_err("VALIDATED -> VERIFIED should be rejected");

    assert_eq!(err.code, DbErrorCode::InvalidStateTransition);
}

#[tokio::test]
async fn run_lock_prevents_duplicate_run() {
    let db = new_test_db().await;
    db.upsert_release(&sample_release("r3")).await.unwrap();

    assert!(db.acquire_run_lock("r3", "worker-a").await.unwrap());
    assert!(!db.acquire_run_lock("r3", "worker-b").await.unwrap());
    assert!(db.release_run_lock("r3", "worker-a").await.unwrap());
    assert!(db.acquire_run_lock("r3", "worker-b").await.unwrap());
}

#[tokio::test]
async fn run_lock_prevents_parallel_acquire_across_connections() {
    let (db_a, db_b) = new_file_backed_pair().await;
    db_a.upsert_release(&sample_release("r3b")).await.unwrap();

    let (a_lock, b_lock) = tokio::join!(
        db_a.acquire_run_lock("r3b", "worker-a"),
        db_b.acquire_run_lock("r3b", "worker-b")
    );

    let a_lock = a_lock.unwrap();
    let b_lock = b_lock.unwrap();
    assert_ne!(
        a_lock, b_lock,
        "exactly one worker should acquire the run lock"
    );
}

#[tokio::test]
async fn lease_run_lock_blocks_takeover_before_expiry() {
    let db = new_test_db().await;
    db.upsert_release(&sample_release("r3c")).await.unwrap();

    assert!(db
        .acquire_run_lock_lease("r3c", "worker-a", 1, 1_000, 500)
        .await
        .unwrap());
    assert!(!db
        .acquire_run_lock_lease("r3c", "worker-b", 1, 1_200, 500)
        .await
        .unwrap());

    let lock = db
        .get_run_lock_lease("r3c")
        .await
        .unwrap()
        .expect("lock row should exist");
    assert_eq!(
        lock,
        RunLockLeaseRecord {
            release_id: "r3c".to_string(),
            owner: "worker-a".to_string(),
            owner_epoch: 1,
            lease_expires_at_unix_ms: 1_500,
            created_at: lock.created_at.clone(),
        }
    );
}

#[tokio::test]
async fn lease_run_lock_allows_takeover_after_expiry() {
    let db = new_test_db().await;
    db.upsert_release(&sample_release("r3d")).await.unwrap();

    assert!(db
        .acquire_run_lock_lease("r3d", "worker-a", 1, 10_000, 100)
        .await
        .unwrap());
    assert!(db
        .acquire_run_lock_lease("r3d", "worker-b", 7, 10_101, 250)
        .await
        .unwrap());

    let lock = db
        .get_run_lock_lease("r3d")
        .await
        .unwrap()
        .expect("lock row should exist after takeover");
    assert_eq!(lock.owner, "worker-b");
    assert_eq!(lock.owner_epoch, 7);
    assert_eq!(lock.lease_expires_at_unix_ms, 10_351);
}

#[tokio::test]
async fn lease_run_lock_renew_and_release_require_matching_owner_epoch() {
    let db = new_test_db().await;
    db.upsert_release(&sample_release("r3e")).await.unwrap();

    assert!(db
        .acquire_run_lock_lease("r3e", "worker-a", 11, 20_000, 100)
        .await
        .unwrap());

    assert!(!db
        .renew_run_lock_lease("r3e", "worker-a", 12, 20_050, 300)
        .await
        .unwrap());
    assert!(db
        .renew_run_lock_lease("r3e", "worker-a", 11, 20_050, 300)
        .await
        .unwrap());

    let lock = db
        .get_run_lock_lease("r3e")
        .await
        .unwrap()
        .expect("lock row should exist after renew");
    assert_eq!(lock.owner, "worker-a");
    assert_eq!(lock.owner_epoch, 11);
    assert_eq!(lock.lease_expires_at_unix_ms, 20_350);

    assert!(!db
        .release_run_lock_lease("r3e", "worker-a", 12)
        .await
        .unwrap());
    assert!(db
        .release_run_lock_lease("r3e", "worker-a", 11)
        .await
        .unwrap());
    assert!(db.get_run_lock_lease("r3e").await.unwrap().is_none());
}

#[tokio::test]
async fn resume_semantics_skip_completed_platforms() {
    let db = new_test_db().await;
    db.upsert_release(&sample_release("r4")).await.unwrap();

    db.upsert_platform_action(&UpsertPlatformAction {
        release_id: "r4".to_string(),
        platform: "mock".to_string(),
        status: PlatformActionStatus::Verified,
        plan_json: Some(json!({"action": "mock-publish"})),
        result_json: Some(json!({"status": "SIMULATED"})),
        external_id: None,
        increment_attempt: true,
        last_error: None,
    })
    .await
    .unwrap();

    db.upsert_platform_action(&UpsertPlatformAction {
        release_id: "r4".to_string(),
        platform: "secondary".to_string(),
        status: PlatformActionStatus::Failed,
        plan_json: Some(json!({"action": "secondary-publish"})),
        result_json: None,
        external_id: None,
        increment_attempt: true,
        last_error: Some("timeout".to_string()),
    })
    .await
    .unwrap();

    let pending = db
        .pending_platforms(
            "r4",
            &[
                "mock".to_string(),
                "secondary".to_string(),
                "tertiary".to_string(),
            ],
        )
        .await
        .unwrap();

    assert_eq!(
        pending,
        vec!["secondary".to_string(), "tertiary".to_string()]
    );
}

#[tokio::test]
async fn audit_logs_and_history_are_persisted() {
    let db = new_test_db().await;
    db.upsert_release(&sample_release("r5")).await.unwrap();
    db.append_audit_log(&NewAuditLogEntry {
        release_id: "r5".to_string(),
        stage: "PLAN".to_string(),
        message: "Planned mock action".to_string(),
        payload_json: Some(json!({"platform": "mock"})),
    })
    .await
    .unwrap();

    let history = db.list_history().await.unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].release_id, "r5");
    assert_eq!(history[0].state, "VALIDATED");
}

#[tokio::test]
async fn schema_constraints_reject_invalid_hash_lengths() {
    let db = new_test_db().await;
    let err = db
        .upsert_release(&NewReleaseRecord {
            release_id: "r6".to_string(),
            title: "Bad Hashes".to_string(),
            state: ReleaseState::Validated,
            spec_hash: "short".to_string(),
            media_fingerprint: "also-short".to_string(),
            normalized_spec_json: "{}".to_string(),
        })
        .await
        .expect_err("schema should reject invalid hash lengths");

    assert_eq!(
        err.code,
        DbErrorCode::ConstraintViolation,
        "unexpected sqlite error: {err}"
    );
}

#[tokio::test]
async fn upsert_release_rejects_invariant_mismatch_on_release_id_collision() {
    let db = new_test_db().await;
    let original = sample_release("r6b");
    db.upsert_release(&original).await.unwrap();

    let mut renamed_same_invariants = original.clone();
    renamed_same_invariants.title = "Renamed Track".to_string();
    let updated = db.upsert_release(&renamed_same_invariants).await.unwrap();
    assert_eq!(updated.title, "Renamed Track");
    assert_eq!(updated.spec_hash, original.spec_hash);
    assert_eq!(updated.media_fingerprint, original.media_fingerprint);
    assert_eq!(updated.normalized_spec_json, original.normalized_spec_json);

    let mut conflicting = original.clone();
    conflicting.title = "Should Not Persist".to_string();
    conflicting.spec_hash = "c".repeat(64);

    let err = db
        .upsert_release(&conflicting)
        .await
        .expect_err("release_id collision with mismatched invariants should fail");
    assert_eq!(err.code, DbErrorCode::ConstraintViolation);
    assert!(
        err.message.contains("invariant mismatch"),
        "unexpected error: {err}"
    );
    assert!(err.message.contains("spec_hash"), "unexpected error: {err}");

    let stored = db.get_release("r6b").await.unwrap().unwrap();
    assert_eq!(stored.title, "Renamed Track");
    assert_eq!(stored.spec_hash, original.spec_hash);
    assert_eq!(stored.media_fingerprint, original.media_fingerprint);
    assert_eq!(stored.normalized_spec_json, original.normalized_spec_json);
}

#[tokio::test]
async fn tx_upsert_release_rejects_invariant_mismatch_on_release_id_collision() {
    let db = new_test_db().await;
    let original = sample_release("r6c");
    db.upsert_release(&original).await.unwrap();

    let mut conflicting = original.clone();
    conflicting.media_fingerprint = "d".repeat(64);
    conflicting.normalized_spec_json = "{\"title\":\"Changed\"}".to_string();

    let mut tx = db.begin_tx().await.expect("begin tx");
    let err = tx
        .upsert_release(&conflicting)
        .await
        .expect_err("tx upsert should reject invariant mismatch");
    assert_eq!(err.code, DbErrorCode::ConstraintViolation);
    assert!(
        err.message.contains("invariant mismatch"),
        "unexpected error: {err}"
    );
    assert!(
        err.message.contains("media_fingerprint"),
        "unexpected error: {err}"
    );
    tx.rollback().await.expect("rollback tx");

    let stored = db.get_release("r6c").await.unwrap().unwrap();
    assert_eq!(stored.spec_hash, original.spec_hash);
    assert_eq!(stored.media_fingerprint, original.media_fingerprint);
    assert_eq!(stored.normalized_spec_json, original.normalized_spec_json);
}

#[tokio::test]
async fn transaction_rolls_back_when_second_write_fails() {
    let db = new_test_db().await;

    let mut tx = db.begin_tx().await.expect("begin tx");
    tx.upsert_release(&sample_release("r7"))
        .await
        .expect("first write in tx");
    let err = tx
        .upsert_platform_action(&UpsertPlatformAction {
            release_id: "missing-release".to_string(),
            platform: "mock".to_string(),
            status: PlatformActionStatus::Planned,
            plan_json: Some(json!({"action": "mock"})),
            result_json: None,
            external_id: None,
            increment_attempt: false,
            last_error: None,
        })
        .await
        .expect_err("foreign key violation should fail second write");
    assert_eq!(err.code, DbErrorCode::ConstraintViolation);
    tx.rollback().await.expect("rollback");

    let release = db.get_release("r7").await.expect("query after rollback");
    assert!(release.is_none(), "first write must be rolled back");
}

#[tokio::test]
async fn release_track_analysis_round_trips_and_updates() {
    let db = new_test_db().await;
    db.upsert_release(&sample_release("r8")).await.unwrap();

    let inserted = db
        .upsert_release_track_analysis(&UpsertReleaseTrackAnalysis {
            release_id: "r8".to_string(),
            file_path: "C:/audio/test.wav".to_string(),
            media_fingerprint: "f".repeat(64),
            duration_ms: 1_250,
            peak_data: vec![-12.0, -6.0, 0.0],
            loudness_lufs: -14.1,
            sample_rate_hz: 48_000,
            channels: 2,
        })
        .await
        .unwrap();

    assert_eq!(inserted.release_id, "r8");
    assert_eq!(inserted.duration_ms, 1_250);
    assert_eq!(inserted.peak_data, vec![-12.0, -6.0, 0.0]);
    assert_eq!(inserted.sample_rate_hz, 48_000);
    assert_eq!(inserted.channels, 2);

    let updated = db
        .upsert_release_track_analysis(&UpsertReleaseTrackAnalysis {
            release_id: "r8".to_string(),
            file_path: "C:/audio/test-renamed.wav".to_string(),
            media_fingerprint: "e".repeat(64),
            duration_ms: 1_300,
            peak_data: vec![-9.0, -3.0, 0.0],
            loudness_lufs: -13.5,
            sample_rate_hz: 44_100,
            channels: 1,
        })
        .await
        .unwrap();

    assert_eq!(
        updated,
        ReleaseTrackAnalysisRecord {
            release_id: "r8".to_string(),
            file_path: "C:/audio/test-renamed.wav".to_string(),
            media_fingerprint: "e".repeat(64),
            duration_ms: 1_300,
            peak_data: vec![-9.0, -3.0, 0.0],
            loudness_lufs: -13.5,
            sample_rate_hz: 44_100,
            channels: 1,
            created_at: updated.created_at.clone(),
            updated_at: updated.updated_at.clone(),
        }
    );

    let fetched = db.get_release_track_analysis("r8").await.unwrap();
    assert_eq!(fetched, Some(updated));
}

#[tokio::test]
async fn release_track_analysis_requires_existing_release_foreign_key() {
    let db = new_test_db().await;

    let err = db
        .upsert_release_track_analysis(&UpsertReleaseTrackAnalysis {
            release_id: "missing".to_string(),
            file_path: "C:/audio/test.wav".to_string(),
            media_fingerprint: "f".repeat(64),
            duration_ms: 1_000,
            peak_data: vec![-12.0],
            loudness_lufs: -14.0,
            sample_rate_hz: 48_000,
            channels: 1,
        })
        .await
        .expect_err("foreign key should reject orphan analysis");

    assert_eq!(err.code, DbErrorCode::ConstraintViolation);
}

#[tokio::test]
async fn file_backed_db_uses_wal_journal_mode() {
    let dir = tempdir().expect("tempdir");
    let db_path = dir.path().join("wal-check.sqlite");
    std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(&db_path)
        .expect("create wal check db");
    let url = sqlite_file_url(&db_path);

    let mut cfg = DbConfig::sqlite(url);
    cfg.max_connections = 1;
    let db = Db::connect(&cfg).await.expect("db connect");

    let mode: String = sqlx::query_scalar("PRAGMA journal_mode;")
        .fetch_one(db.pool())
        .await
        .expect("read journal_mode");
    assert_eq!(mode.to_ascii_lowercase(), "wal");
}

#[tokio::test]
async fn dropping_commit_future_before_poll_rolls_back_cleanly_on_wal_db() {
    let (writer, reader) = new_file_backed_pair().await;

    let mut tx = writer.begin_tx().await.expect("begin tx");
    tx.upsert_release(&sample_release("r9-phase2-drop-future"))
        .await
        .expect("write inside tx");

    // Simulate an application crash right before commit by constructing the commit future
    // and dropping it without polling.
    let commit_future = tx.commit();
    drop(commit_future);
    tokio::task::yield_now().await;

    let observed = reader
        .get_release("r9-phase2-drop-future")
        .await
        .expect("query after dropped commit future");
    assert!(
        observed.is_none(),
        "uncommitted transaction must not be persisted after dropped commit future"
    );

    let inserted = writer
        .upsert_release(&sample_release("r9-phase2-drop-future"))
        .await
        .expect("db should remain writable after implicit rollback");
    assert_eq!(inserted.release_id, "r9-phase2-drop-future");
}

#[tokio::test]
async fn busy_locked_retry_backoff_recovers_after_lock_release() {
    let (db_lock_holder, db_writer) = new_file_backed_pair().await;
    set_sqlite_busy_timeout_ms(&db_lock_holder, 1).await;
    set_sqlite_busy_timeout_ms(&db_writer, 1).await;

    db_lock_holder
        .upsert_release(&sample_release("r10-phase2-busy"))
        .await
        .expect("seed release");

    let (lock_held_tx, lock_held_rx) = oneshot::channel::<()>();
    let (release_lock_tx, release_lock_rx) = oneshot::channel::<()>();
    let holder_db = db_lock_holder.clone();

    let holder_task = tokio::spawn(async move {
        let mut tx = holder_db.begin_tx().await.expect("holder begin tx");
        let transitioned = tx
            .transition_release_state(
                "r10-phase2-busy",
                ReleaseState::Validated,
                ReleaseState::Planned,
            )
            .await
            .expect("holder state transition");
        assert!(transitioned, "holder should transition to PLANNED");

        let _ = lock_held_tx.send(());
        let _ = release_lock_rx.await;

        tx.commit().await.expect("holder commit");
    });

    lock_held_rx.await.expect("wait for held write lock");

    let releaser_task = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(40)).await;
        let _ = release_lock_tx.send(());
    });

    let attempts = Arc::new(AtomicUsize::new(0));
    let sleep_calls = Arc::new(AtomicUsize::new(0));
    let retry_policy = DbBusyRetryPolicy {
        max_attempts: 6,
        base_delay_ms: 5,
        max_delay_ms: 20,
        jitter_ratio_pct: 0,
        jitter_seed: 0,
    };

    let analysis_input = UpsertReleaseTrackAnalysis {
        release_id: "r10-phase2-busy".to_string(),
        file_path: "C:/audio/phase2-lock.wav".to_string(),
        media_fingerprint: "a".repeat(64),
        duration_ms: 1_000,
        peak_data: vec![-12.0, -6.0, 0.0],
        loudness_lufs: -14.0,
        sample_rate_hz: 48_000,
        channels: 2,
    };

    let attempts_for_op = Arc::clone(&attempts);
    let sleep_calls_for_hook = Arc::clone(&sleep_calls);
    let result = tokio::time::timeout(
        Duration::from_secs(2),
        retry_busy_locked_with_sleep(
            &retry_policy,
            || {
                attempts_for_op.fetch_add(1, Ordering::SeqCst);
                db_writer.upsert_release_track_analysis(&analysis_input)
            },
            |delay_ms| {
                sleep_calls_for_hook.fetch_add(1, Ordering::SeqCst);
                async move {
                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                }
            },
        ),
    )
    .await
    .expect("retry loop timeout")
    .expect("busy retry should eventually succeed");

    assert_eq!(result.release_id, "r10-phase2-busy");
    assert!(
        attempts.load(Ordering::SeqCst) >= 2,
        "expected at least one BusyLocked retry attempt"
    );
    assert!(
        sleep_calls.load(Ordering::SeqCst) >= 1,
        "expected retry backoff hook to be invoked"
    );

    releaser_task.await.expect("releaser join");
    holder_task.await.expect("holder join");

    let stored_release = db_writer
        .get_release("r10-phase2-busy")
        .await
        .expect("fetch release after contention")
        .expect("release row should exist");
    assert_eq!(stored_release.state, ReleaseState::Planned);

    let stored_analysis = db_writer
        .get_release_track_analysis("r10-phase2-busy")
        .await
        .expect("fetch track analysis after contention")
        .expect("track analysis should exist");
    assert_eq!(stored_analysis.file_path, "C:/audio/phase2-lock.wav");
}

#[tokio::test]
async fn catalog_track_import_round_trips_and_dedupes_by_track_id() {
    let db = new_test_db().await;

    let mut first = sample_catalog_track_import("ab", "C:/music/example-a.wav");
    first.track_id = "a".repeat(64);
    first.media_asset_id = "b".repeat(64);
    first.artist_id = "c".repeat(64);
    first.album_id = Some("d".repeat(64));
    first.media_fingerprint = "e".repeat(64);

    let inserted = db
        .upsert_catalog_track_import(&first)
        .await
        .expect("insert catalog track");
    assert_eq!(inserted.track_id, first.track_id);
    assert_eq!(inserted.file_path, first.file_path);
    assert_eq!(inserted.artist_name, "Example Artist");
    assert_eq!(inserted.album_title.as_deref(), Some("Singles"));

    let list = db
        .list_catalog_tracks(&CatalogListTracksQuery {
            search: None,
            limit: 50,
            offset: 0,
        })
        .await
        .expect("list catalog tracks");
    assert_eq!(list.total, 1);
    assert_eq!(list.items.len(), 1);
    assert_eq!(list.items[0].track_id, first.track_id);

    let mut updated = first.clone();
    updated.file_path = "C:/music/example-a-renamed.wav".to_string();
    updated.title = "Imported Track (Renamed)".to_string();
    updated.peak_data = vec![-8.0, -4.0, -2.0];
    updated.true_peak_dbfs = Some(-0.5);

    let upserted = db
        .upsert_catalog_track_import(&updated)
        .await
        .expect("upsert catalog track");
    assert_eq!(upserted.track_id, first.track_id);
    assert_eq!(upserted.file_path, updated.file_path);
    assert_eq!(upserted.title, updated.title);
    assert_eq!(upserted.peak_data, updated.peak_data);

    let fetched = db
        .get_catalog_track(&first.track_id)
        .await
        .expect("get catalog track")
        .expect("catalog track should exist");
    assert_eq!(fetched.file_path, updated.file_path);
    assert_eq!(fetched.title, updated.title);
    assert_eq!(fetched.media_fingerprint, first.media_fingerprint);
    assert!(
        fetched.loudness_lufs.is_finite() && fetched.loudness_lufs <= 0.0,
        "persisted catalog loudness_lufs must remain finite and non-positive"
    );
    assert!(
        fetched
            .true_peak_dbfs
            .is_some_and(|value| value.is_finite() && value <= 0.0),
        "persisted catalog true_peak_dbfs must remain finite and non-positive when present"
    );
}

#[tokio::test]
async fn catalog_track_listing_search_filters_by_title_or_artist() {
    let db = new_test_db().await;

    let mut alpha = sample_catalog_track_import("11", "C:/music/alpha.wav");
    alpha.track_id = "1".repeat(64);
    alpha.media_asset_id = "2".repeat(64);
    alpha.artist_id = "3".repeat(64);
    alpha.album_id = Some("9".repeat(64));
    alpha.media_fingerprint = "4".repeat(64);
    alpha.title = "Sunset Demo".to_string();
    alpha.artist_name = "Rau Artist".to_string();
    alpha.album_title = Some("Night Session".to_string());

    let mut beta = sample_catalog_track_import("22", "C:/music/beta.wav");
    beta.track_id = "5".repeat(64);
    beta.media_asset_id = "6".repeat(64);
    beta.artist_id = "7".repeat(64);
    beta.album_id = None;
    beta.media_fingerprint = "8".repeat(64);
    beta.title = "Midnight Sketch".to_string();
    beta.artist_name = "Other Artist".to_string();
    beta.album_title = None;

    let mut gamma = sample_catalog_track_import("23", "C:/music/ambient/folder-only.wav");
    gamma.track_id = "9".repeat(64);
    gamma.media_asset_id = "a".repeat(64);
    gamma.artist_id = "b".repeat(64);
    gamma.album_id = None;
    gamma.media_fingerprint = "c".repeat(64);
    gamma.title = "Nocturne".to_string();
    gamma.artist_name = "Sunset Voices".to_string();
    gamma.album_title = None;

    db.upsert_catalog_track_import(&alpha)
        .await
        .expect("insert alpha");
    db.upsert_catalog_track_import(&beta)
        .await
        .expect("insert beta");
    db.upsert_catalog_track_import(&gamma)
        .await
        .expect("insert gamma");

    let by_title = db
        .list_catalog_tracks(&CatalogListTracksQuery {
            search: Some("sunset".to_string()),
            limit: 50,
            offset: 0,
        })
        .await
        .expect("list by title");
    assert_eq!(by_title.total, 2);
    assert_eq!(by_title.items[0].title, "Sunset Demo");
    assert_eq!(by_title.items[1].artist_name, "Sunset Voices");

    let by_artist = db
        .list_catalog_tracks(&CatalogListTracksQuery {
            search: Some("rau".to_string()),
            limit: 50,
            offset: 0,
        })
        .await
        .expect("list by artist");
    assert_eq!(by_artist.total, 1);
    assert_eq!(by_artist.items[0].artist_name, "Rau Artist");

    let by_album = db
        .list_catalog_tracks(&CatalogListTracksQuery {
            search: Some("session".to_string()),
            limit: 50,
            offset: 0,
        })
        .await
        .expect("list by album");
    assert_eq!(by_album.total, 1);
    assert_eq!(
        by_album.items[0].album_title.as_deref(),
        Some("Night Session")
    );

    let by_multi_term = db
        .list_catalog_tracks(&CatalogListTracksQuery {
            search: Some("sunset rau".to_string()),
            limit: 50,
            offset: 0,
        })
        .await
        .expect("list by multi-term query");
    assert_eq!(by_multi_term.total, 1);
    assert_eq!(by_multi_term.items[0].title, "Sunset Demo");

    let no_match_multi_term = db
        .list_catalog_tracks(&CatalogListTracksQuery {
            search: Some("sunset other".to_string()),
            limit: 50,
            offset: 0,
        })
        .await
        .expect("list by mismatched multi-term query");
    assert_eq!(no_match_multi_term.total, 0);
    assert!(no_match_multi_term.items.is_empty());

    let by_file_path = db
        .list_catalog_tracks(&CatalogListTracksQuery {
            search: Some("folder-only.wav".to_string()),
            limit: 50,
            offset: 0,
        })
        .await
        .expect("list by file path tokenized query");
    assert_eq!(by_file_path.total, 1);
    assert_eq!(by_file_path.items[0].track_id, gamma.track_id);
}

#[tokio::test]
async fn catalog_track_listing_search_pagination_is_stable() {
    let db = new_test_db().await;

    let mut first = sample_catalog_track_import("71", "C:/music/page-first.wav");
    first.track_id = "1".repeat(64);
    first.media_asset_id = "2".repeat(64);
    first.artist_id = "3".repeat(64);
    first.album_id = None;
    first.media_fingerprint = "4".repeat(64);
    first.title = "Sunset Grid A".to_string();
    first.artist_name = "Stable Order".to_string();

    let mut second = sample_catalog_track_import("72", "C:/music/page-second.wav");
    second.track_id = "5".repeat(64);
    second.media_asset_id = "6".repeat(64);
    second.artist_id = first.artist_id.clone();
    second.album_id = None;
    second.media_fingerprint = "8".repeat(64);
    second.title = "Sunset Grid B".to_string();
    second.artist_name = "Stable Order".to_string();

    let mut third = sample_catalog_track_import("73", "C:/music/page-third.wav");
    third.track_id = "9".repeat(64);
    third.media_asset_id = "a".repeat(64);
    third.artist_id = first.artist_id.clone();
    third.album_id = None;
    third.media_fingerprint = "c".repeat(64);
    third.title = "Sunset Grid C".to_string();
    third.artist_name = "Stable Order".to_string();

    db.upsert_catalog_track_import(&first)
        .await
        .expect("insert first track");
    db.upsert_catalog_track_import(&second)
        .await
        .expect("insert second track");
    db.upsert_catalog_track_import(&third)
        .await
        .expect("insert third track");

    let page_one = db
        .list_catalog_tracks(&CatalogListTracksQuery {
            search: Some("sunset grid".to_string()),
            limit: 2,
            offset: 0,
        })
        .await
        .expect("list first page");
    let page_one_repeat = db
        .list_catalog_tracks(&CatalogListTracksQuery {
            search: Some("sunset grid".to_string()),
            limit: 2,
            offset: 0,
        })
        .await
        .expect("list first page repeat");
    let page_two = db
        .list_catalog_tracks(&CatalogListTracksQuery {
            search: Some("sunset grid".to_string()),
            limit: 2,
            offset: 2,
        })
        .await
        .expect("list second page");

    assert_eq!(page_one.total, 3);
    assert_eq!(page_one_repeat.total, 3);
    assert_eq!(page_two.total, 3);
    assert_eq!(page_one.items.len(), 2);
    assert_eq!(page_one_repeat.items.len(), 2);
    assert_eq!(page_two.items.len(), 1);

    let page_one_ids = page_one
        .items
        .iter()
        .map(|item| item.track_id.clone())
        .collect::<Vec<_>>();
    let page_one_repeat_ids = page_one_repeat
        .items
        .iter()
        .map(|item| item.track_id.clone())
        .collect::<Vec<_>>();
    assert_eq!(page_one_ids, page_one_repeat_ids);

    let page_two_ids = page_two
        .items
        .iter()
        .map(|item| item.track_id.clone())
        .collect::<Vec<_>>();
    assert!(!page_one_ids.contains(&page_two_ids[0]));
}

#[tokio::test]
async fn catalog_track_import_rejects_positive_loudness_and_true_peak_values() {
    let db = new_test_db().await;

    let mut loudness_invalid = sample_catalog_track_import("55", "C:/music/invalid-loudness.wav");
    loudness_invalid.track_id = "a".repeat(64);
    loudness_invalid.media_asset_id = "b".repeat(64);
    loudness_invalid.artist_id = "c".repeat(64);
    loudness_invalid.album_id = None;
    loudness_invalid.media_fingerprint = "d".repeat(64);
    loudness_invalid.loudness_lufs = 0.1;
    let loudness_err = db
        .upsert_catalog_track_import(&loudness_invalid)
        .await
        .expect_err("positive loudness_lufs must be rejected");
    assert_eq!(loudness_err.code, DbErrorCode::Query);
    assert!(
        loudness_err.message.contains("loudness_lufs"),
        "unexpected message: {}",
        loudness_err.message
    );

    let mut true_peak_invalid = sample_catalog_track_import("66", "C:/music/invalid-true-peak.wav");
    true_peak_invalid.track_id = "e".repeat(64);
    true_peak_invalid.media_asset_id = "f".repeat(64);
    true_peak_invalid.artist_id = "1".repeat(64);
    true_peak_invalid.album_id = None;
    true_peak_invalid.media_fingerprint = "2".repeat(64);
    true_peak_invalid.true_peak_dbfs = Some(0.25);
    let true_peak_err = db
        .upsert_catalog_track_import(&true_peak_invalid)
        .await
        .expect_err("positive true_peak_dbfs must be rejected");
    assert_eq!(true_peak_err.code, DbErrorCode::Query);
    assert!(
        true_peak_err.message.contains("true_peak_dbfs"),
        "unexpected message: {}",
        true_peak_err.message
    );
}

#[tokio::test]
async fn catalog_track_metadata_update_round_trips_rights_visibility_and_tags() {
    let db = new_test_db().await;

    let mut track = sample_catalog_track_import("33", "C:/music/authoring.wav");
    track.track_id = "a".repeat(64);
    track.media_asset_id = "b".repeat(64);
    track.artist_id = "c".repeat(64);
    track.album_id = None;
    track.media_fingerprint = "d".repeat(64);
    db.upsert_catalog_track_import(&track)
        .await
        .expect("insert track");

    let updated = db
        .update_catalog_track_metadata(&UpdateCatalogTrackMetadata {
            track_id: track.track_id.clone(),
            visibility_policy: "PRIVATE".to_string(),
            license_policy: "CC_BY".to_string(),
            downloadable: true,
            tags: vec![
                CatalogTrackTagAssignment {
                    tag_id: "e".repeat(64),
                    label: "Lo-Fi".to_string(),
                },
                CatalogTrackTagAssignment {
                    tag_id: "f".repeat(64),
                    label: "Night Drive".to_string(),
                },
            ],
        })
        .await
        .expect("update track metadata");

    assert_eq!(updated.track_id, track.track_id);
    assert_eq!(updated.visibility_policy, "PRIVATE");
    assert_eq!(updated.license_policy, "CC_BY");
    assert!(updated.downloadable);

    let tags = db
        .list_catalog_track_tags(&track.track_id)
        .await
        .expect("list track tags");
    assert_eq!(tags, vec!["Lo-Fi".to_string(), "Night Drive".to_string()]);

    // Replacing tags should remove old joins and preserve unique normalized-label semantics.
    db.update_catalog_track_metadata(&UpdateCatalogTrackMetadata {
        track_id: track.track_id.clone(),
        visibility_policy: "LOCAL".to_string(),
        license_policy: "ALL_RIGHTS_RESERVED".to_string(),
        downloadable: false,
        tags: vec![CatalogTrackTagAssignment {
            tag_id: "e".repeat(64),
            label: "lo fi".to_string(),
        }],
    })
    .await
    .expect("replace tags");

    let tags_after = db
        .list_catalog_track_tags(&track.track_id)
        .await
        .expect("list tags after replace");
    assert_eq!(tags_after, vec!["lo fi".to_string()]);
}

#[tokio::test]
async fn catalog_track_metadata_update_rejects_duplicate_or_blank_tags() {
    let db = new_test_db().await;

    let mut track = sample_catalog_track_import("44", "C:/music/authoring-invalid.wav");
    track.track_id = "1".repeat(64);
    track.media_asset_id = "2".repeat(64);
    track.artist_id = "3".repeat(64);
    track.album_id = None;
    track.media_fingerprint = "4".repeat(64);
    db.upsert_catalog_track_import(&track)
        .await
        .expect("insert track");

    let duplicate_err = db
        .update_catalog_track_metadata(&UpdateCatalogTrackMetadata {
            track_id: track.track_id.clone(),
            visibility_policy: "LOCAL".to_string(),
            license_policy: "ALL_RIGHTS_RESERVED".to_string(),
            downloadable: false,
            tags: vec![
                CatalogTrackTagAssignment {
                    tag_id: "5".repeat(64),
                    label: "Synth Wave".to_string(),
                },
                CatalogTrackTagAssignment {
                    tag_id: "6".repeat(64),
                    label: "synth   wave".to_string(),
                },
            ],
        })
        .await
        .expect_err("duplicate normalized tags should be rejected");
    assert_eq!(duplicate_err.code, DbErrorCode::Query);

    let blank_err = db
        .update_catalog_track_metadata(&UpdateCatalogTrackMetadata {
            track_id: track.track_id.clone(),
            visibility_policy: "LOCAL".to_string(),
            license_policy: "ALL_RIGHTS_RESERVED".to_string(),
            downloadable: false,
            tags: vec![CatalogTrackTagAssignment {
                tag_id: "7".repeat(64),
                label: "   ".to_string(),
            }],
        })
        .await
        .expect_err("blank tag should be rejected");
    assert_eq!(blank_err.code, DbErrorCode::Query);
}

#[tokio::test]
async fn library_roots_round_trip_and_delete() {
    let db = new_test_db().await;
    let root = db
        .upsert_library_root(&UpsertLibraryRoot {
            root_id: "9".repeat(64),
            path: "C:/Music".to_string(),
            enabled: true,
        })
        .await
        .expect("upsert library root");
    assert_eq!(root.path, "C:/Music");
    assert!(root.enabled);

    let listed = db.list_library_roots().await.expect("list library roots");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].root_id, root.root_id);

    let fetched = db
        .get_library_root(&root.root_id)
        .await
        .expect("get library root")
        .expect("library root exists");
    assert_eq!(fetched.path, "C:/Music");

    let deleted = db
        .delete_library_root(&root.root_id)
        .await
        .expect("delete library root");
    assert!(deleted);
    assert!(db
        .get_library_root(&root.root_id)
        .await
        .expect("get after delete")
        .is_none());
}

#[tokio::test]
async fn reset_catalog_library_data_clears_roots_tracks_and_ingest_jobs() {
    let db = new_test_db().await;

    db.upsert_library_root(&UpsertLibraryRoot {
        root_id: "a".repeat(64),
        path: "C:/Music".to_string(),
        enabled: true,
    })
    .await
    .expect("upsert library root");

    let mut track = sample_catalog_track_import("55", "C:/Music/reset-me.wav");
    track.track_id = "1".repeat(64);
    track.media_asset_id = "2".repeat(64);
    track.artist_id = "3".repeat(64);
    track.album_id = None;
    track.media_fingerprint = "4".repeat(64);
    db.upsert_catalog_track_import(&track)
        .await
        .expect("insert catalog track");

    let job_id = "5".repeat(64);
    db.create_ingest_job(&NewIngestJob {
        job_id: job_id.clone(),
        status: IngestJobStatus::Pending,
        scope: "scan-root:reset".to_string(),
        total_items: 0,
        processed_items: 0,
        error_count: 0,
    })
    .await
    .expect("create ingest job");

    db.reset_catalog_library_data()
        .await
        .expect("reset catalog data");

    let roots = db.list_library_roots().await.expect("list roots");
    assert!(roots.is_empty());

    let tracks = db
        .list_catalog_tracks(&CatalogListTracksQuery {
            search: None,
            limit: 50,
            offset: 0,
        })
        .await
        .expect("list tracks after reset");
    assert_eq!(tracks.total, 0);
    assert!(tracks.items.is_empty());

    assert!(db
        .get_ingest_job(&job_id)
        .await
        .expect("fetch ingest job after reset")
        .is_none());
}

#[tokio::test]
async fn ingest_job_progress_and_events_round_trip() {
    let db = new_test_db().await;
    let job_id = "a".repeat(64);

    let created = db
        .create_ingest_job(&NewIngestJob {
            job_id: job_id.clone(),
            status: IngestJobStatus::Pending,
            scope: "scan-root:demo".to_string(),
            total_items: 0,
            processed_items: 0,
            error_count: 0,
        })
        .await
        .expect("create ingest job");
    assert_eq!(created.status, IngestJobStatus::Pending);

    let running = db
        .update_ingest_job(&UpdateIngestJob {
            job_id: job_id.clone(),
            status: IngestJobStatus::Running,
            total_items: 3,
            processed_items: 1,
            error_count: 0,
        })
        .await
        .expect("update ingest job");
    assert_eq!(running.status, IngestJobStatus::Running);
    assert_eq!(running.total_items, 3);
    assert_eq!(running.processed_items, 1);

    let event = db
        .append_ingest_event(&NewIngestEvent {
            job_id: job_id.clone(),
            level: "INFO".to_string(),
            message: "imported file".to_string(),
            payload_json: Some(json!({"path":"C:/Music/test.wav"})),
        })
        .await
        .expect("append ingest event");
    assert_eq!(event.job_id, job_id);
    assert_eq!(event.level, "INFO");

    let done = db
        .update_ingest_job(&UpdateIngestJob {
            job_id: job_id.clone(),
            status: IngestJobStatus::Completed,
            total_items: 3,
            processed_items: 3,
            error_count: 1,
        })
        .await
        .expect("complete ingest job");
    assert_eq!(done.status, IngestJobStatus::Completed);
    assert_eq!(done.error_count, 1);

    let fetched = db
        .get_ingest_job(&job_id)
        .await
        .expect("fetch ingest job")
        .expect("job should exist");
    assert_eq!(fetched.status, IngestJobStatus::Completed);
    assert_eq!(fetched.processed_items, 3);
}
