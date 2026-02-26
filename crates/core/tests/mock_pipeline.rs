use async_trait::async_trait;
use release_publisher_core::orchestrator::{Orchestrator, OrchestratorError, RunReleaseInput};
use release_publisher_core::pipeline::{
    ExecuteContext, ExecutionEnvironment, ExecutionResult, ExecutionStatus, PlanContext,
    PlannedAction, PlannedActionType, Publisher, VerificationResult,
};
use release_publisher_core::spec::parse_release_spec_yaml;
use release_publisher_db::{
    Db, DbConfig, PlatformActionStatus, ReleaseState, UpsertPlatformAction,
};
use release_publisher_mock_connector::MockPublisher;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
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

async fn file_backed_db(db_path: &std::path::Path) -> Db {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).expect("create test DB dir");
    }
    std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(db_path)
        .expect("create test DB file");

    let url = sqlite_file_url(db_path);
    let mut cfg = DbConfig::sqlite(url);
    cfg.max_connections = 1;
    Db::connect(&cfg).await.expect("db connect")
}

fn sample_spec() -> release_publisher_core::spec::ReleaseSpec {
    let raw = r#"
title: "  Test Track  "
artist: " Example Artist "
description: "  Sample description  "
tags: ["Synthwave", " release ", "synthwave"]
mock:
  enabled: true
  note: "  Use mock publisher only  "
"#;
    parse_release_spec_yaml(raw).expect("spec should parse")
}

fn unix_time_ms_now() -> i64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => i64::try_from(duration.as_millis()).unwrap_or(i64::MAX),
        Err(_) => 0,
    }
}

#[tokio::test]
async fn mock_pipeline_runs_end_to_end_and_is_idempotent_on_rerun() {
    let dir = tempdir().expect("tempdir");
    let db = file_backed_db(&dir.path().join("phase5.sqlite")).await;
    let orchestrator = Orchestrator::with_publishers(
        db.clone(),
        vec![Arc::new(MockPublisher) as Arc<dyn release_publisher_core::pipeline::Publisher>],
    )
    .expect("orchestrator");

    let spec = sample_spec();
    let media_bytes = b"phase5-mock-media".to_vec();
    let artifacts_root = dir.path().join("artifacts");

    let first = orchestrator
        .run_release(RunReleaseInput::new(
            spec.clone(),
            media_bytes.clone(),
            ExecutionEnvironment::Test,
            vec!["mock".to_string()],
            &artifacts_root,
        ))
        .await
        .expect("first run should succeed");

    assert_eq!(first.report.state, "COMMITTED");
    assert_eq!(first.report.release_id.len(), 64);
    assert_eq!(first.report.env, ExecutionEnvironment::Test);
    assert_eq!(first.report.platforms.len(), 1);
    assert_eq!(first.report.platforms[0].platform, "mock");
    assert_eq!(
        first.report.platforms[0].status,
        PlatformActionStatus::Verified.as_str()
    );
    assert!(first.report.platforms[0].simulated);
    assert!(first.report.platforms[0].verified);
    assert!(
        !first.report.platforms[0].reused_completed_result,
        "first successful run should not mark results as reused"
    );
    assert!(first.release_report_path.exists());
    assert!(first
        .planned_request_files
        .get("mock")
        .expect("planned file path")
        .exists());

    let release = db
        .get_release(&first.report.release_id)
        .await
        .expect("db read")
        .expect("release exists");
    assert_eq!(release.state, ReleaseState::Committed);

    let action = db
        .get_platform_action(&first.report.release_id, "mock")
        .await
        .expect("action read")
        .expect("platform action exists");
    assert_eq!(action.status, PlatformActionStatus::Verified);
    assert_eq!(action.attempt_count, 1);

    let planned_request_text =
        tokio::fs::read_to_string(first.planned_request_files["mock"].as_path())
            .await
            .unwrap();
    assert!(planned_request_text.contains("\"platform\": \"mock\""));

    let report_text = tokio::fs::read_to_string(&first.release_report_path)
        .await
        .unwrap();
    assert!(report_text.contains("\"state\": \"COMMITTED\""));

    let second = orchestrator
        .run_release(RunReleaseInput::new(
            spec,
            media_bytes,
            ExecutionEnvironment::Test,
            vec!["mock".to_string()],
            &artifacts_root,
        ))
        .await
        .expect("second run should reuse state safely");

    assert_eq!(first.report.release_id, second.report.release_id);
    let action_after = db
        .get_platform_action(&second.report.release_id, "mock")
        .await
        .expect("action read 2")
        .expect("platform action exists");
    assert_eq!(action_after.status, PlatformActionStatus::Verified);
    assert_eq!(
        action_after.attempt_count, 1,
        "rerun should not execute mock publisher again once verified"
    );
    assert!(
        second.report.platforms[0].reused_completed_result,
        "idempotent rerun should report reused completed results"
    );
}

#[tokio::test]
async fn rerun_rejects_corrupted_stored_result_json_schema() {
    let dir = tempdir().expect("tempdir");
    let db = file_backed_db(&dir.path().join("phase5-corrupt-result-json.sqlite")).await;
    let orchestrator = Orchestrator::with_publishers(
        db.clone(),
        vec![Arc::new(MockPublisher) as Arc<dyn release_publisher_core::pipeline::Publisher>],
    )
    .expect("orchestrator");

    let spec = sample_spec();
    let media_bytes = b"phase5-mock-media".to_vec();
    let artifacts_root = dir.path().join("artifacts");

    let first = orchestrator
        .run_release(RunReleaseInput::new(
            spec.clone(),
            media_bytes.clone(),
            ExecutionEnvironment::Test,
            vec!["mock".to_string()],
            &artifacts_root,
        ))
        .await
        .expect("first run should succeed");

    let action = db
        .get_platform_action(&first.report.release_id, "mock")
        .await
        .expect("action read")
        .expect("platform action exists");
    assert_eq!(action.status, PlatformActionStatus::Verified);
    assert_eq!(action.attempt_count, 1);

    db.upsert_platform_action(&UpsertPlatformAction {
        release_id: action.release_id.clone(),
        platform: action.platform.clone(),
        status: action.status,
        plan_json: action.plan_json.clone(),
        result_json: Some(serde_json::json!({
            "execution_results": [{ "external_id": "missing simulated flag" }],
            "verification_results": [{ "verified": true }],
        })),
        external_id: action.external_id.clone(),
        increment_attempt: false,
        last_error: action.last_error.clone(),
    })
    .await
    .expect("tamper stored result_json");

    let rerun_error = orchestrator
        .run_release(RunReleaseInput::new(
            spec,
            media_bytes,
            ExecutionEnvironment::Test,
            vec!["mock".to_string()],
            &artifacts_root,
        ))
        .await
        .expect_err("rerun should fail on corrupted stored result_json");

    match rerun_error {
        OrchestratorError::InvalidReleaseState(message) => {
            assert!(
                message.contains("result_json schema"),
                "unexpected message: {message}"
            );
            assert!(
                message.contains("simulated"),
                "unexpected message: {message}"
            );
        }
        other => panic!("unexpected error variant: {other:?}"),
    }
}

#[derive(Clone, Default)]
struct Counters {
    plans: Arc<Mutex<u32>>,
    executes: Arc<Mutex<u32>>,
    verifies: Arc<Mutex<u32>>,
}

impl Counters {
    fn inc(counter: &Mutex<u32>) {
        let mut guard = counter.lock().expect("poisoned");
        *guard += 1;
    }
    fn executes(&self) -> u32 {
        *self.executes.lock().expect("poisoned")
    }
}

#[derive(Clone)]
struct TestPublisher {
    name: &'static str,
    fail_first_execute: bool,
    counters: Counters,
}

#[async_trait]
impl Publisher for TestPublisher {
    fn platform_name(&self) -> &'static str {
        self.name
    }

    async fn plan(&self, ctx: &PlanContext) -> anyhow::Result<Vec<PlannedAction>> {
        Counters::inc(&self.counters.plans);
        Ok(vec![PlannedAction {
            platform: self.name.to_string(),
            action: format!("plan {}", ctx.release_id),
            action_type: PlannedActionType::Publish,
            simulated: true,
        }])
    }

    async fn execute(
        &self,
        _ctx: &ExecuteContext,
        plan: &[PlannedAction],
    ) -> anyhow::Result<Vec<ExecutionResult>> {
        Counters::inc(&self.counters.executes);
        if self.fail_first_execute && self.counters.executes() == 1 {
            anyhow::bail!("injected execute failure");
        }
        Ok(plan
            .iter()
            .map(|p| ExecutionResult {
                platform: p.platform.clone(),
                external_id: Some(format!("{}-id", self.name)),
                status: ExecutionStatus::Simulated,
                simulated: true,
            })
            .collect())
    }

    async fn verify(&self, _ctx: &ExecuteContext) -> anyhow::Result<Vec<VerificationResult>> {
        Counters::inc(&self.counters.verifies);
        Ok(vec![VerificationResult {
            platform: self.name.to_string(),
            verified: true,
            message: "ok".to_string(),
        }])
    }
}

#[tokio::test]
async fn partial_failure_resume_skips_completed_platform_and_retries_only_failed_one() {
    let dir = tempdir().expect("tempdir");
    let db = file_backed_db(&dir.path().join("phase5-resume.sqlite")).await;

    let alpha_counts = Counters::default();
    let beta_counts = Counters::default();
    let alpha = Arc::new(TestPublisher {
        name: "alpha",
        fail_first_execute: false,
        counters: alpha_counts.clone(),
    }) as Arc<dyn Publisher>;
    let beta = Arc::new(TestPublisher {
        name: "beta",
        fail_first_execute: true,
        counters: beta_counts.clone(),
    }) as Arc<dyn Publisher>;

    let orchestrator =
        Orchestrator::with_publishers(db.clone(), vec![alpha, beta]).expect("orchestrator");
    let spec = sample_spec();
    let media = b"same-media".to_vec();
    let artifacts_root = dir.path().join("artifacts");

    let first_err = orchestrator
        .run_release(RunReleaseInput::new(
            spec.clone(),
            media.clone(),
            ExecutionEnvironment::Test,
            vec!["alpha".to_string(), "beta".to_string()],
            &artifacts_root,
        ))
        .await
        .expect_err("first run should fail on beta");
    assert!(first_err.to_string().contains("execute failed"));

    assert_eq!(alpha_counts.executes(), 1);
    assert_eq!(beta_counts.executes(), 1);

    let release_id = {
        let history = db.list_history().await.expect("history");
        history[0].release_id.clone()
    };
    let alpha_row = db
        .get_platform_action(&release_id, "alpha")
        .await
        .unwrap()
        .unwrap();
    let beta_row = db
        .get_platform_action(&release_id, "beta")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        alpha_row.status,
        release_publisher_db::PlatformActionStatus::Verified
    );
    assert_eq!(
        beta_row.status,
        release_publisher_db::PlatformActionStatus::Failed
    );
    assert_eq!(alpha_row.attempt_count, 1);
    assert_eq!(beta_row.attempt_count, 1);

    let second = orchestrator
        .run_release(RunReleaseInput::new(
            spec,
            media,
            ExecutionEnvironment::Test,
            vec!["alpha".to_string(), "beta".to_string()],
            &artifacts_root,
        ))
        .await
        .expect("resume run should succeed");

    assert_eq!(second.report.state, "COMMITTED");
    let report_platforms: std::collections::HashMap<_, _> = second
        .report
        .platforms
        .iter()
        .map(|p| (p.platform.as_str(), p))
        .collect();
    assert!(
        report_platforms["alpha"].reused_completed_result,
        "previously verified platform should be marked as reused on resume"
    );
    assert!(
        !report_platforms["beta"].reused_completed_result,
        "retried platform should not be marked as reused on resume"
    );
    assert_eq!(
        alpha_counts.executes(),
        1,
        "completed alpha must not re-execute"
    );
    assert_eq!(
        beta_counts.executes(),
        2,
        "failed beta should be retried once"
    );

    let alpha_row = db
        .get_platform_action(&release_id, "alpha")
        .await
        .unwrap()
        .unwrap();
    let beta_row = db
        .get_platform_action(&release_id, "beta")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(alpha_row.attempt_count, 1);
    assert_eq!(beta_row.attempt_count, 2);
}

#[tokio::test]
async fn per_run_cap_is_enforced_in_core_plan_phase() {
    #[derive(Clone)]
    struct TwoActionPublisher;

    #[async_trait]
    impl Publisher for TwoActionPublisher {
        fn platform_name(&self) -> &'static str {
            "multi"
        }

        async fn plan(&self, _ctx: &PlanContext) -> anyhow::Result<Vec<PlannedAction>> {
            Ok(vec![
                PlannedAction {
                    platform: "multi".to_string(),
                    action: "a".to_string(),
                    action_type: PlannedActionType::Publish,
                    simulated: true,
                },
                PlannedAction {
                    platform: "multi".to_string(),
                    action: "b".to_string(),
                    action_type: PlannedActionType::Publish,
                    simulated: true,
                },
            ])
        }

        async fn execute(
            &self,
            _ctx: &ExecuteContext,
            _plan: &[PlannedAction],
        ) -> anyhow::Result<Vec<ExecutionResult>> {
            unreachable!("plan should fail before execute")
        }

        async fn verify(&self, _ctx: &ExecuteContext) -> anyhow::Result<Vec<VerificationResult>> {
            unreachable!("plan should fail before verify")
        }
    }

    let dir = tempdir().expect("tempdir");
    let db = file_backed_db(&dir.path().join("phase5-cap.sqlite")).await;
    let orchestrator =
        Orchestrator::with_publishers(db, vec![Arc::new(TwoActionPublisher) as Arc<dyn Publisher>])
            .expect("orchestrator");
    let mut input = RunReleaseInput::new(
        sample_spec(),
        b"cap-media".to_vec(),
        ExecutionEnvironment::Test,
        vec!["multi".to_string()],
        dir.path().join("artifacts"),
    );
    input.max_actions_per_platform_per_run = 1;

    let err = orchestrator
        .run_release(input)
        .await
        .expect_err("cap must be enforced in core");
    assert!(err.to_string().contains("cap exceeded"));
}

#[tokio::test]
async fn test_env_rejects_non_simulated_actions_in_core() {
    #[derive(Clone)]
    struct UnsafePublisher;

    #[async_trait]
    impl Publisher for UnsafePublisher {
        fn platform_name(&self) -> &'static str {
            "unsafe"
        }

        async fn plan(&self, _ctx: &PlanContext) -> anyhow::Result<Vec<PlannedAction>> {
            Ok(vec![PlannedAction {
                platform: "unsafe".to_string(),
                action: "would-publish-publicly".to_string(),
                action_type: PlannedActionType::Publish,
                simulated: false,
            }])
        }

        async fn execute(
            &self,
            _ctx: &ExecuteContext,
            _plan: &[PlannedAction],
        ) -> anyhow::Result<Vec<ExecutionResult>> {
            Ok(vec![])
        }

        async fn verify(&self, _ctx: &ExecuteContext) -> anyhow::Result<Vec<VerificationResult>> {
            Ok(vec![])
        }
    }

    let dir = tempdir().expect("tempdir");
    let db = file_backed_db(&dir.path().join("phase5-guardrail.sqlite")).await;
    let orchestrator =
        Orchestrator::with_publishers(db, vec![Arc::new(UnsafePublisher) as Arc<dyn Publisher>])
            .expect("orchestrator");

    let err = orchestrator
        .run_release(RunReleaseInput::new(
            sample_spec(),
            b"guardrail-media".to_vec(),
            ExecutionEnvironment::Test,
            vec!["unsafe".to_string()],
            dir.path().join("artifacts"),
        ))
        .await
        .expect_err("TEST mode must reject non-simulated actions");
    assert!(err.to_string().contains("TEST environment"));
}

#[tokio::test]
async fn execute_planned_release_blocks_when_non_expired_lease_lock_exists() {
    let dir = tempdir().expect("tempdir");
    let db_path = dir.path().join("phase5-lease-active.sqlite");
    let db_a = file_backed_db(&db_path).await;
    let db_b = file_backed_db(&db_path).await;
    let orchestrator = Orchestrator::with_publishers(
        db_b.clone(),
        vec![Arc::new(MockPublisher) as Arc<dyn release_publisher_core::pipeline::Publisher>],
    )
    .expect("orchestrator");

    let planned = orchestrator
        .plan_release(RunReleaseInput::new(
            sample_spec(),
            b"lease-active-media".to_vec(),
            ExecutionEnvironment::Test,
            vec!["mock".to_string()],
            dir.path().join("artifacts"),
        ))
        .await
        .expect("plan");
    let release_id = planned.release_id.clone();

    let now_ms = unix_time_ms_now();
    assert!(db_a
        .acquire_run_lock_lease(&release_id, "external-worker", 42, now_ms, 60_000)
        .await
        .expect("seed active lease"));

    let err = orchestrator
        .execute_planned_release(planned)
        .await
        .expect_err("active lease should block execute");
    assert!(err.to_string().contains("already executing"));

    let lock = db_b
        .get_run_lock_lease(&release_id)
        .await
        .expect("read lease")
        .expect("lease should remain held");
    assert_eq!(lock.owner, "external-worker");
    assert_eq!(lock.owner_epoch, 42);
}

#[tokio::test]
async fn execute_planned_release_recovers_from_stale_lease_lock() {
    let dir = tempdir().expect("tempdir");
    let db_path = dir.path().join("phase5-lease-stale.sqlite");
    let db_a = file_backed_db(&db_path).await;
    let db_b = file_backed_db(&db_path).await;
    let orchestrator = Orchestrator::with_publishers(
        db_b.clone(),
        vec![Arc::new(MockPublisher) as Arc<dyn release_publisher_core::pipeline::Publisher>],
    )
    .expect("orchestrator");

    let planned = orchestrator
        .plan_release(RunReleaseInput::new(
            sample_spec(),
            b"lease-stale-media".to_vec(),
            ExecutionEnvironment::Test,
            vec!["mock".to_string()],
            dir.path().join("artifacts"),
        ))
        .await
        .expect("plan");
    let release_id = planned.release_id.clone();

    assert!(db_a
        .acquire_run_lock_lease(&release_id, "crashed-worker", 7, 0, 1)
        .await
        .expect("seed stale lease"));

    let output = orchestrator
        .execute_planned_release(planned)
        .await
        .expect("stale lease should be recoverable");
    assert_eq!(output.report.state, "COMMITTED");
    assert_eq!(output.report.release_id, release_id);

    assert!(
        db_b.get_run_lock_lease(&release_id)
            .await
            .expect("read lease after success")
            .is_none(),
        "orchestrator should release lease after successful execution"
    );
}
