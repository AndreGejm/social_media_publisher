use release_publisher_db::{
    Db, DbConfig, DbErrorCode, NewAuditLogEntry, NewReleaseRecord, PlatformActionStatus,
    ReleaseState, UpsertPlatformAction,
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
