use release_publisher_db::{
    Db, DbConfig, DbErrorCode, NewAuditLogEntry, NewReleaseRecord, PlatformActionStatus,
    ReleaseState, RunLockLeaseRecord, UpsertPlatformAction,
};
use serde_json::json;
use tempfile::tempdir;

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
