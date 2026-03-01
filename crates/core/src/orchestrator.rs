//! Deterministic plan/execute/verify orchestration over publishers and SQLite state.

use crate::idempotency::try_build_idempotency_keys;
use crate::pipeline::{
    ExecuteContext, ExecutionEnvironment, PlanContext, PlannedAction, Publisher, VerificationResult,
};
use crate::spec::ReleaseSpec;
use release_publisher_db::{
    db_busy_retry_delay_ms, retry_busy_locked, Db, DbBusyRetryPolicy, DbError, DbErrorCode,
    NewAuditLogEntry, NewReleaseRecord, PlatformActionStatus, ReleaseState, UpsertPlatformAction,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::watch;
use tokio::task::JoinHandle;
use uuid::Uuid;

/// Default per-platform action cap used to prevent accidental mass publishes in one run.
pub const DEFAULT_MAX_ACTIONS_PER_PLATFORM_PER_RUN: u32 = 1;
const RUN_LOCK_LEASE_TTL_MS: i64 = 5 * 60 * 1000;
const RUN_LOCK_LEASE_RENEW_FAILURE_LIMIT: u8 = 3;

/// Errors emitted by the orchestration state machine.
#[derive(Debug, thiserror::Error)]
pub enum OrchestratorError {
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("unknown publisher `{platform}`")]
    UnknownPublisher { platform: String },
    #[error("duplicate publisher registration `{platform}`")]
    DuplicatePublisher { platform: String },
    #[error("per-run action cap exceeded for `{platform}`: {count} > {cap}")]
    CapExceeded {
        platform: String,
        count: usize,
        cap: u32,
    },
    #[error("TEST environment requires simulated actions/results for `{platform}`")]
    TestGuardrailViolation { platform: String },
    #[error("release state does not allow execution: {0}")]
    InvalidReleaseState(String),
    #[error("publisher `{platform}` failed (code={code}, retryable={retryable}): {message}")]
    PublisherFailure {
        platform: String,
        code: String,
        retryable: bool,
        message: String,
    },
    #[error("db error: {0}")]
    Db(#[from] DbError),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

/// Input payload for planning/executing a release run.
#[derive(Debug, Clone)]
pub struct RunReleaseInput {
    pub spec: ReleaseSpec,
    pub media_bytes: Vec<u8>,
    pub env: ExecutionEnvironment,
    pub platforms: Vec<String>,
    pub artifacts_root: PathBuf,
    pub max_actions_per_platform_per_run: u32,
}

impl RunReleaseInput {
    /// Creates a new run input with the default per-platform action cap.
    pub fn new(
        spec: ReleaseSpec,
        media_bytes: Vec<u8>,
        env: ExecutionEnvironment,
        platforms: Vec<String>,
        artifacts_root: impl Into<PathBuf>,
    ) -> Self {
        Self {
            spec,
            media_bytes,
            env,
            platforms,
            artifacts_root: artifacts_root.into(),
            max_actions_per_platform_per_run: DEFAULT_MAX_ACTIONS_PER_PLATFORM_PER_RUN,
        }
    }
}

/// Per-platform execution summary stored in the release report artifact.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlatformExecutionSummary {
    pub platform: String,
    pub status: String,
    pub simulated: bool,
    pub verified: bool,
    pub attempt_count: i64,
    pub external_id: Option<String>,
    pub reused_completed_result: bool,
}

/// Persisted run report artifact written after execution completes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReleaseReportArtifact {
    pub release_id: String,
    pub run_id: String,
    pub env: ExecutionEnvironment,
    pub state: String,
    pub title: String,
    pub spec_hash: String,
    pub media_fingerprint: String,
    pub planned_request_files: BTreeMap<String, String>,
    pub platforms: Vec<PlatformExecutionSummary>,
}

/// Planned release state handed from the plan phase to execution.
#[derive(Debug, Clone)]
pub struct PlannedRelease {
    pub release_id: String,
    pub run_id: String,
    pub env: ExecutionEnvironment,
    pub platforms: Vec<String>,
    pub max_actions_per_platform_per_run: u32,
    pub release_dir: PathBuf,
    pub planned_requests_dir: PathBuf,
    pub planned_actions: BTreeMap<String, Vec<PlannedAction>>,
    pub planned_request_files: BTreeMap<String, PathBuf>,
    pub spec_hash: String,
    pub media_fingerprint: String,
}

/// Successful orchestration result returned by `run_release`/`execute_planned_release`.
#[derive(Debug, Clone)]
pub struct RunReleaseOutput {
    pub report: ReleaseReportArtifact,
    pub release_report_path: PathBuf,
    pub planned_request_files: BTreeMap<String, PathBuf>,
}

/// Coordinates publishers, filesystem artifacts and the SQLite state machine.
pub struct Orchestrator {
    db: Db,
    publishers: HashMap<String, Arc<dyn Publisher>>,
}

impl Orchestrator {
    /// Creates an empty orchestrator with no registered publishers.
    pub fn new(db: Db) -> Self {
        Self {
            db,
            publishers: HashMap::new(),
        }
    }

    /// Creates an orchestrator and registers all provided publishers.
    pub fn with_publishers<I>(db: Db, publishers: I) -> Result<Self, OrchestratorError>
    where
        I: IntoIterator<Item = Arc<dyn Publisher>>,
    {
        let mut orchestrator = Self::new(db);
        for publisher in publishers {
            orchestrator.register_publisher(publisher)?;
        }
        Ok(orchestrator)
    }

    /// Registers a publisher by its platform name.
    pub fn register_publisher(
        &mut self,
        publisher: Arc<dyn Publisher>,
    ) -> Result<(), OrchestratorError> {
        let key = publisher.platform_name().to_string();
        if self.publishers.contains_key(&key) {
            return Err(OrchestratorError::DuplicatePublisher { platform: key });
        }
        self.publishers.insert(key, publisher);
        Ok(())
    }

    /// Returns the backing database handle.
    pub fn db(&self) -> &Db {
        &self.db
    }

    /// Runs the full `Plan -> Execute -> Verify/Commit` pipeline for a release.
    pub async fn run_release(
        &self,
        input: RunReleaseInput,
    ) -> Result<RunReleaseOutput, OrchestratorError> {
        let planned = self.plan_release(input).await?;
        tracing::info!(
            target: "orchestrator",
            release_id = %planned.release_id,
            run_id = %planned.run_id,
            "planned release; starting execute phase"
        );
        self.execute_planned_release(planned).await
    }

    /// Executes only the planning phase and returns a [`PlannedRelease`] for later execution.
    pub async fn plan_release(
        &self,
        input: RunReleaseInput,
    ) -> Result<PlannedRelease, OrchestratorError> {
        validate_run_input(&input)?;
        let platforms = normalize_platforms(input.platforms)?;

        let keys = try_build_idempotency_keys(&input.spec, &input.media_bytes)?;
        let run_id = Uuid::new_v4().to_string();
        let release_dir = input.artifacts_root.join(&keys.release_id);
        let planned_requests_dir = release_dir.join("planned_requests");
        tokio::fs::create_dir_all(&planned_requests_dir).await?;
        tracing::info!(
            target: "orchestrator",
            release_id = %keys.release_id,
            run_id = %run_id,
            env = ?input.env,
            platforms = ?platforms,
            "planning release"
        );

        let new_release = NewReleaseRecord {
            release_id: keys.release_id.clone(),
            title: input.spec.title.clone(),
            state: ReleaseState::Validated,
            spec_hash: keys.spec_hash.clone(),
            media_fingerprint: keys.media_fingerprint.clone(),
            normalized_spec_json: input.spec.try_normalized_json()?,
        };
        let release = self
            .retry_busy_locked_orchestrator(|| async {
                self.db
                    .upsert_release(&new_release)
                    .await
                    .map_err(OrchestratorError::from)
            })
            .await?;

        if release.state != ReleaseState::Committed {
            self.transition_to_planned_if_needed(&keys.release_id, release.state)
                .await?;
        }

        let mut planned_actions_by_platform = BTreeMap::new();
        let mut planned_request_files = BTreeMap::new();

        for platform in &platforms {
            let publisher = self.publisher(platform)?;
            let plan_ctx = PlanContext {
                release_id: keys.release_id.clone(),
                env: input.env.clone(),
                max_actions_per_platform_per_run: input.max_actions_per_platform_per_run,
            };
            let planned_actions = publisher.plan(&plan_ctx).await.map_err(|e| {
                let message = e.to_string();
                OrchestratorError::PublisherFailure {
                    platform: platform.clone(),
                    code: e.code,
                    retryable: e.retryable,
                    message,
                }
            })?;

            enforce_cap(
                platform,
                planned_actions.len(),
                input.max_actions_per_platform_per_run,
            )?;
            if matches!(input.env, ExecutionEnvironment::Test)
                && planned_actions.iter().any(|a| !a.simulated)
            {
                return Err(OrchestratorError::TestGuardrailViolation {
                    platform: platform.clone(),
                });
            }

            let plan_json = serde_json::to_value(&planned_actions)?;
            let existing = self
                .db
                .get_platform_action(&keys.release_id, platform)
                .await?;
            let existing_is_completed = existing
                .as_ref()
                .map(|row| row.status.is_completed())
                .unwrap_or(false);
            self.retry_busy_locked_orchestrator(|| async {
                let mut tx = self.db.begin_tx().await.map_err(OrchestratorError::from)?;
                if !existing_is_completed {
                    tx.upsert_platform_action(&UpsertPlatformAction {
                        release_id: keys.release_id.clone(),
                        platform: platform.clone(),
                        status: PlatformActionStatus::Planned,
                        plan_json: Some(plan_json.clone()),
                        result_json: None,
                        external_id: None,
                        increment_attempt: false,
                        last_error: None,
                    })
                    .await
                    .map_err(OrchestratorError::from)?;
                }

                tx.append_audit_log(&NewAuditLogEntry {
                    release_id: keys.release_id.clone(),
                    stage: "PLAN".to_string(),
                    message: format!(
                        "planned {} action(s) for `{platform}`",
                        planned_actions.len()
                    ),
                    payload_json: Some(serde_json::json!({
                        "platform": platform,
                        "planned_actions": plan_json.clone(),
                        "env": input.env.clone(),
                        "run_id": run_id.clone(),
                    })),
                })
                .await
                .map_err(OrchestratorError::from)?;
                tx.commit().await.map_err(OrchestratorError::from)?;
                Ok(())
            })
            .await?;

            let file_path =
                planned_requests_dir.join(format!("{}.json", sanitize_filename(platform)));
            write_json_pretty(&file_path, &planned_actions).await?;

            planned_request_files.insert(platform.clone(), file_path);
            planned_actions_by_platform.insert(platform.clone(), planned_actions);
        }

        Ok(PlannedRelease {
            release_id: keys.release_id,
            run_id,
            env: input.env,
            platforms,
            max_actions_per_platform_per_run: input.max_actions_per_platform_per_run,
            release_dir,
            planned_requests_dir,
            planned_actions: planned_actions_by_platform,
            planned_request_files,
            spec_hash: keys.spec_hash,
            media_fingerprint: keys.media_fingerprint,
        })
    }

    /// Executes a previously planned release.
    pub async fn execute_planned_release(
        &self,
        planned: PlannedRelease,
    ) -> Result<RunReleaseOutput, OrchestratorError> {
        let lock_owner_epoch = unix_time_ms_now();
        let lock_owner = format!("orchestrator-{}-{}", std::process::id(), Uuid::new_v4());
        tracing::info!(
            target: "orchestrator",
            release_id = %planned.release_id,
            run_id = %planned.run_id,
            "attempting execution lock"
        );
        let acquired = self
            .retry_busy_locked_orchestrator(|| async {
                self.db
                    .acquire_run_lock_lease(
                        &planned.release_id,
                        &lock_owner,
                        lock_owner_epoch,
                        lock_owner_epoch,
                        RUN_LOCK_LEASE_TTL_MS,
                    )
                    .await
                    .map_err(OrchestratorError::from)
            })
            .await?;
        if !acquired {
            return Err(OrchestratorError::InvalidReleaseState(format!(
                "release `{}` is already executing",
                planned.release_id
            )));
        }

        let lease_renewer = if matches!(planned.env, ExecutionEnvironment::Test) {
            None
        } else {
            Some(start_run_lock_lease_renewer(
                self.db.clone(),
                planned.release_id.clone(),
                lock_owner.clone(),
                lock_owner_epoch,
            ))
        };
        let lease_renewal_failed = lease_renewer
            .as_ref()
            .map(|renewer| renewer.failure_flag())
            .unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
        let result = self.execute_locked(&planned, lease_renewal_failed).await;
        if let Some(renewer) = lease_renewer {
            renewer.stop().await;
        }
        let release_lock_result = self
            .retry_busy_locked_orchestrator(|| async {
                self.db
                    .release_run_lock_lease(&planned.release_id, &lock_owner, lock_owner_epoch)
                    .await
                    .map_err(OrchestratorError::from)
            })
            .await
            .map(|_| ());

        match (result, release_lock_result) {
            (Ok(output), Ok(_)) => Ok(output),
            (Err(err), Ok(_)) => Err(err),
            (Ok(_), Err(lock_err)) => Err(lock_err),
            (Err(err), Err(_lock_err)) => Err(err),
        }
    }

    async fn execute_locked(
        &self,
        planned: &PlannedRelease,
        lease_renewal_failed: Arc<AtomicBool>,
    ) -> Result<RunReleaseOutput, OrchestratorError> {
        ensure_lease_healthy(&lease_renewal_failed)?;
        let release = self
            .db
            .get_release(&planned.release_id)
            .await?
            .ok_or_else(|| OrchestratorError::InvalidReleaseState("release missing".to_string()))?;

        let pending_platforms = self
            .db
            .pending_platforms(&planned.release_id, &planned.platforms)
            .await?;
        let pending_platforms_for_run: HashSet<String> =
            pending_platforms.iter().cloned().collect();
        tracing::info!(
            target: "orchestrator",
            release_id = %planned.release_id,
            run_id = %planned.run_id,
            state = %release.state.as_str(),
            pending_platforms = ?pending_platforms,
            "executing planned release"
        );

        match release.state {
            ReleaseState::Validated => {
                return Err(OrchestratorError::InvalidReleaseState(
                    "release must be planned before execution".to_string(),
                ))
            }
            ReleaseState::Planned => {
                let transitioned = self
                    .transition_release_state_with_retry(
                        &planned.release_id,
                        ReleaseState::Planned,
                        ReleaseState::Executing,
                    )
                    .await?;
                if !transitioned {
                    return Err(OrchestratorError::InvalidReleaseState(format!(
                        "failed to transition `{}` PLANNED -> EXECUTING",
                        planned.release_id
                    )));
                }
            }
            ReleaseState::Failed => {
                let transitioned = self
                    .transition_release_state_with_retry(
                        &planned.release_id,
                        ReleaseState::Failed,
                        ReleaseState::Executing,
                    )
                    .await?;
                if !transitioned {
                    return Err(OrchestratorError::InvalidReleaseState(format!(
                        "failed to transition `{}` FAILED -> EXECUTING",
                        planned.release_id
                    )));
                }
            }
            ReleaseState::Executing => {}
            ReleaseState::Verified => {
                let transitioned = self
                    .transition_release_state_with_retry(
                        &planned.release_id,
                        ReleaseState::Verified,
                        ReleaseState::Committed,
                    )
                    .await?;
                if !transitioned {
                    return Err(OrchestratorError::InvalidReleaseState(format!(
                        "failed to transition `{}` VERIFIED -> COMMITTED",
                        planned.release_id
                    )));
                }
                return self
                    .finalize_report(planned, &pending_platforms_for_run)
                    .await;
            }
            ReleaseState::Committed => {
                if pending_platforms.is_empty() {
                    return self
                        .finalize_report(planned, &pending_platforms_for_run)
                        .await;
                }
                let transitioned = self
                    .transition_release_state_with_retry(
                        &planned.release_id,
                        ReleaseState::Committed,
                        ReleaseState::Executing,
                    )
                    .await?;
                if !transitioned {
                    return Err(OrchestratorError::InvalidReleaseState(format!(
                        "failed to transition `{}` COMMITTED -> EXECUTING",
                        planned.release_id
                    )));
                }
            }
        }

        for platform in pending_platforms {
            ensure_lease_healthy(&lease_renewal_failed)?;
            let publisher = self.publisher(&platform)?;
            let plan = planned
                .planned_actions
                .get(&platform)
                .cloned()
                .unwrap_or_default();

            enforce_cap(
                &platform,
                plan.len(),
                planned.max_actions_per_platform_per_run,
            )?;
            self.retry_busy_locked_orchestrator(|| async {
                let planned_actions_value =
                    serde_json::to_value(&plan).map_err(OrchestratorError::from)?;
                let mut tx = self.db.begin_tx().await.map_err(OrchestratorError::from)?;
                tx.upsert_platform_action(&UpsertPlatformAction {
                    release_id: planned.release_id.clone(),
                    platform: platform.clone(),
                    status: PlatformActionStatus::Executing,
                    plan_json: Some(planned_actions_value.clone()),
                    result_json: None,
                    external_id: None,
                    increment_attempt: true,
                    last_error: None,
                })
                .await
                .map_err(OrchestratorError::from)?;

                tx.append_audit_log(&NewAuditLogEntry {
                    release_id: planned.release_id.clone(),
                    stage: "EXECUTE".to_string(),
                    message: format!("executing `{platform}`"),
                    payload_json: Some(serde_json::json!({
                        "platform": platform,
                        "planned_actions": planned_actions_value,
                        "run_id": planned.run_id.clone(),
                    })),
                })
                .await
                .map_err(OrchestratorError::from)?;
                tx.commit().await.map_err(OrchestratorError::from)?;
                Ok(())
            })
            .await?;

            let exec_ctx = ExecuteContext {
                release_id: planned.release_id.clone(),
                env: planned.env.clone(),
                max_actions_per_platform_per_run: planned.max_actions_per_platform_per_run,
            };

            let execution_results = match publisher.execute(&exec_ctx, &plan).await {
                Ok(results) => results,
                Err(error) => {
                    let error_message = error.to_string();
                    self.mark_platform_failed(
                        &planned.release_id,
                        &planned.run_id,
                        &platform,
                        error_message.clone(),
                    )
                    .await?;
                    return Err(OrchestratorError::PublisherFailure {
                        platform: platform.clone(),
                        code: error.code,
                        retryable: error.retryable,
                        message: error_message,
                    });
                }
            };

            enforce_cap(
                &platform,
                execution_results.len(),
                planned.max_actions_per_platform_per_run,
            )?;
            if matches!(planned.env, ExecutionEnvironment::Test)
                && execution_results.iter().any(|r| !r.simulated)
            {
                self.mark_platform_failed(
                    &planned.release_id,
                    &planned.run_id,
                    &platform,
                    "TEST guardrail violation: non-simulated result".to_string(),
                )
                .await?;
                return Err(OrchestratorError::TestGuardrailViolation { platform });
            }

            let verify_results = match publisher.verify(&exec_ctx).await {
                Ok(results) => results,
                Err(error) => {
                    let error_message = error.to_string();
                    self.mark_platform_failed(
                        &planned.release_id,
                        &planned.run_id,
                        &platform,
                        error_message.clone(),
                    )
                    .await?;
                    return Err(OrchestratorError::PublisherFailure {
                        platform: platform.clone(),
                        code: error.code,
                        retryable: error.retryable,
                        message: error_message,
                    });
                }
            };

            require_verified(&platform, &verify_results)?;

            let external_id = execution_results.iter().find_map(|r| r.external_id.clone());
            let result_json = serde_json::json!({
                "execution_results": execution_results,
                "verification_results": verify_results,
            });

            self.retry_busy_locked_orchestrator(|| async {
                let mut tx = self.db.begin_tx().await.map_err(OrchestratorError::from)?;
                tx.upsert_platform_action(&UpsertPlatformAction {
                    release_id: planned.release_id.clone(),
                    platform: platform.clone(),
                    status: PlatformActionStatus::Verified,
                    plan_json: None,
                    result_json: Some(result_json.clone()),
                    external_id: external_id.clone(),
                    increment_attempt: false,
                    last_error: None,
                })
                .await
                .map_err(OrchestratorError::from)?;

                tx.append_audit_log(&NewAuditLogEntry {
                    release_id: planned.release_id.clone(),
                    stage: "VERIFY".to_string(),
                    message: format!("verified `{platform}`"),
                    payload_json: Some(serde_json::json!({
                        "platform": platform,
                        "verified": true,
                        "run_id": planned.run_id.clone()
                    })),
                })
                .await
                .map_err(OrchestratorError::from)?;
                tx.commit().await.map_err(OrchestratorError::from)?;
                Ok(())
            })
            .await?;
        }

        ensure_lease_healthy(&lease_renewal_failed)?;
        self.retry_busy_locked_orchestrator(|| async {
            let mut tx = self.db.begin_tx().await.map_err(OrchestratorError::from)?;
            let transitioned = tx
                .transition_release_state(
                    &planned.release_id,
                    ReleaseState::Executing,
                    ReleaseState::Verified,
                )
                .await
                .map_err(OrchestratorError::from)?;
            if !transitioned {
                return Err(OrchestratorError::InvalidReleaseState(format!(
                    "failed to transition `{}` EXECUTING -> VERIFIED",
                    planned.release_id
                )));
            }
            let transitioned = tx
                .transition_release_state(
                    &planned.release_id,
                    ReleaseState::Verified,
                    ReleaseState::Committed,
                )
                .await
                .map_err(OrchestratorError::from)?;
            if !transitioned {
                return Err(OrchestratorError::InvalidReleaseState(format!(
                    "failed to transition `{}` VERIFIED -> COMMITTED",
                    planned.release_id
                )));
            }
            tx.commit().await.map_err(OrchestratorError::from)?;
            Ok(())
        })
        .await?;

        self.finalize_report(planned, &pending_platforms_for_run)
            .await
    }

    async fn finalize_report(
        &self,
        planned: &PlannedRelease,
        pending_platforms_for_run: &HashSet<String>,
    ) -> Result<RunReleaseOutput, OrchestratorError> {
        let release = self
            .db
            .get_release(&planned.release_id)
            .await?
            .ok_or_else(|| OrchestratorError::InvalidReleaseState("release missing".to_string()))?;
        let actions = self.db.list_platform_actions(&planned.release_id).await?;
        let action_map: HashMap<String, _> = actions
            .iter()
            .cloned()
            .map(|row| (row.platform.clone(), row))
            .collect();
        let mut platforms = Vec::new();
        for platform in &planned.platforms {
            let row = action_map.get(platform).ok_or_else(|| {
                OrchestratorError::InvalidReleaseState(format!(
                    "missing platform action record for `{platform}`"
                ))
            })?;
            let (simulated, verified) = infer_simulated_and_verified(row.result_json.as_ref())?;
            let reused_completed_result =
                row.status.is_completed() && !pending_platforms_for_run.contains(platform);

            platforms.push(PlatformExecutionSummary {
                platform: platform.clone(),
                status: row.status.as_str().to_string(),
                simulated,
                verified,
                attempt_count: row.attempt_count,
                external_id: row.external_id.clone(),
                reused_completed_result,
            });
        }

        let planned_request_files: BTreeMap<String, String> = planned
            .planned_request_files
            .iter()
            .map(|(platform, path)| {
                (
                    platform.clone(),
                    relative_or_full(path, &planned.release_dir),
                )
            })
            .collect();

        let report = ReleaseReportArtifact {
            release_id: planned.release_id.clone(),
            run_id: planned.run_id.clone(),
            env: planned.env.clone(),
            state: release.state.as_str().to_string(),
            title: release.title,
            spec_hash: planned.spec_hash.clone(),
            media_fingerprint: planned.media_fingerprint.clone(),
            planned_request_files,
            platforms,
        };

        let release_report_path = planned.release_dir.join("release_report.json");
        write_json_pretty(&release_report_path, &report).await?;

        Ok(RunReleaseOutput {
            report,
            release_report_path,
            planned_request_files: planned.planned_request_files.clone(),
        })
    }

    async fn transition_to_planned_if_needed(
        &self,
        release_id: &str,
        current_state: ReleaseState,
    ) -> Result<(), OrchestratorError> {
        let expected = match current_state {
            ReleaseState::Validated | ReleaseState::Failed => Some(current_state),
            ReleaseState::Planned
            | ReleaseState::Executing
            | ReleaseState::Verified
            | ReleaseState::Committed => None,
        };

        if let Some(expected) = expected {
            let transitioned = self
                .transition_release_state_with_retry(release_id, expected, ReleaseState::Planned)
                .await?;
            if !transitioned {
                return Err(OrchestratorError::InvalidReleaseState(format!(
                    "failed to transition `{release_id}` {} -> {}",
                    expected.as_str(),
                    ReleaseState::Planned.as_str()
                )));
            }
        }
        Ok(())
    }

    fn publisher(&self, platform: &str) -> Result<Arc<dyn Publisher>, OrchestratorError> {
        self.publishers
            .get(platform)
            .cloned()
            .ok_or_else(|| OrchestratorError::UnknownPublisher {
                platform: platform.to_string(),
            })
    }

    async fn mark_platform_failed(
        &self,
        release_id: &str,
        run_id: &str,
        platform: &str,
        message: String,
    ) -> Result<(), OrchestratorError> {
        self.retry_busy_locked_orchestrator(|| async {
            let mut tx = self.db.begin_tx().await.map_err(OrchestratorError::from)?;
            tx.upsert_platform_action(&UpsertPlatformAction {
                release_id: release_id.to_string(),
                platform: platform.to_string(),
                status: PlatformActionStatus::Failed,
                plan_json: None,
                result_json: None,
                external_id: None,
                increment_attempt: false,
                last_error: Some(message.clone()),
            })
            .await
            .map_err(OrchestratorError::from)?;
            let transitioned = tx
                .set_release_failed(release_id, ReleaseState::Executing, message.clone())
                .await
                .map_err(OrchestratorError::from)?;
            if !transitioned {
                return Err(OrchestratorError::InvalidReleaseState(format!(
                    "failed to transition `{release_id}` EXECUTING -> FAILED"
                )));
            }
            tx.append_audit_log(&NewAuditLogEntry {
                release_id: release_id.to_string(),
                stage: "ERROR".to_string(),
                message: message.clone(),
                payload_json: Some(serde_json::json!({ "run_id": run_id, "platform": platform })),
            })
            .await
            .map_err(OrchestratorError::from)?;
            tx.commit().await.map_err(OrchestratorError::from)?;
            Ok(())
        })
        .await
    }

    async fn transition_release_state_with_retry(
        &self,
        release_id: &str,
        expected: ReleaseState,
        next: ReleaseState,
    ) -> Result<bool, OrchestratorError> {
        self.retry_busy_locked_orchestrator(|| async {
            self.db
                .transition_release_state(release_id, expected, next)
                .await
                .map_err(OrchestratorError::from)
        })
        .await
    }

    /// Retries only DB busy/locked failures while returning other orchestration errors immediately.
    ///
    /// The loop intentionally retries only `Db(BusyLocked)` and reuses the DB
    /// crate's backoff/jitter policy to stay consistent with lower-level retry
    /// behavior.
    async fn retry_busy_locked_orchestrator<T, F, Fut>(
        &self,
        mut op: F,
    ) -> Result<T, OrchestratorError>
    where
        F: FnMut() -> Fut,
        Fut: Future<Output = Result<T, OrchestratorError>>,
    {
        let policy = DbBusyRetryPolicy::default();
        policy.validate().map_err(OrchestratorError::from)?;

        for attempt in 1..=policy.max_attempts {
            match op().await {
                Ok(value) => return Ok(value),
                Err(error)
                    if is_busy_locked_orchestrator_error(&error)
                        && attempt < policy.max_attempts =>
                {
                    let delay_ms = db_busy_retry_delay_ms(&policy, attempt);
                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                }
                Err(error) => return Err(error),
            }
        }

        Err(OrchestratorError::Db(DbError::new(
            DbErrorCode::BusyLocked,
            "orchestrator busy-locked retry loop exhausted",
        )))
    }
}

struct RunLockLeaseRenewer {
    stop_tx: watch::Sender<bool>,
    task: JoinHandle<()>,
    failed: Arc<AtomicBool>,
}

impl RunLockLeaseRenewer {
    fn failure_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.failed)
    }

    async fn stop(self) {
        let _ = self.stop_tx.send(true);
        let _ = self.task.await;
    }
}

fn start_run_lock_lease_renewer(
    db: Db,
    release_id: String,
    owner: String,
    owner_epoch: i64,
) -> RunLockLeaseRenewer {
    let (stop_tx, stop_rx) = watch::channel(false);
    let failed = Arc::new(AtomicBool::new(false));
    let failed_clone = Arc::clone(&failed);
    let task = tokio::spawn(async move {
        let policy = DbBusyRetryPolicy::default();
        let renew_interval_ms = (RUN_LOCK_LEASE_TTL_MS / 3).max(1_000) as u64;
        let mut consecutive_failures: u8 = 0;

        loop {
            if *stop_rx.borrow() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(renew_interval_ms)).await;
            if *stop_rx.borrow() {
                break;
            }

            let now_unix_ms = unix_time_ms_now();
            let renew_result = retry_busy_locked(&policy, || async {
                db.renew_run_lock_lease(
                    &release_id,
                    &owner,
                    owner_epoch,
                    now_unix_ms,
                    RUN_LOCK_LEASE_TTL_MS,
                )
                .await
            })
            .await;

            match renew_result {
                Ok(true) => {
                    consecutive_failures = 0;
                }
                Ok(false) | Err(_) => {
                    consecutive_failures = consecutive_failures.saturating_add(1);
                    tracing::warn!(
                        target: "orchestrator",
                        release_id = %release_id,
                        owner = %owner,
                        owner_epoch,
                        consecutive_failures,
                        "run-lock lease renewal failed"
                    );
                    if consecutive_failures >= RUN_LOCK_LEASE_RENEW_FAILURE_LIMIT {
                        failed_clone.store(true, Ordering::Relaxed);
                        tracing::error!(
                            target: "orchestrator",
                            release_id = %release_id,
                            owner = %owner,
                            owner_epoch,
                            "run-lock lease renewal failure limit reached; execution will fail closed"
                        );
                        break;
                    }
                }
            }
        }
    });

    RunLockLeaseRenewer {
        stop_tx,
        task,
        failed,
    }
}

fn ensure_lease_healthy(lease_renewal_failed: &Arc<AtomicBool>) -> Result<(), OrchestratorError> {
    if lease_renewal_failed.load(Ordering::Relaxed) {
        return Err(OrchestratorError::InvalidReleaseState(
            "run lock lease renewal failed".to_string(),
        ));
    }
    Ok(())
}

/// Returns `true` when the error is a DB busy/locked condition eligible for retry.
fn is_busy_locked_orchestrator_error(error: &OrchestratorError) -> bool {
    matches!(
        error,
        OrchestratorError::Db(db_error) if db_error.code == DbErrorCode::BusyLocked
    )
}

/// Returns the current UNIX time in milliseconds, saturating on overflow and clock skew.
fn unix_time_ms_now() -> i64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => i64::try_from(duration.as_millis()).unwrap_or(i64::MAX),
        Err(_) => 0,
    }
}

/// Validates high-level run inputs before any filesystem or DB work begins.
fn validate_run_input(input: &RunReleaseInput) -> Result<(), OrchestratorError> {
    if input.media_bytes.is_empty() {
        return Err(OrchestratorError::InvalidInput(
            "media_bytes cannot be empty".to_string(),
        ));
    }
    if input.max_actions_per_platform_per_run == 0 {
        return Err(OrchestratorError::InvalidInput(
            "max_actions_per_platform_per_run must be >= 1".to_string(),
        ));
    }
    Ok(())
}

/// Normalizes platform names (trim + lowercase) and rejects duplicates/blanks.
fn normalize_platforms(platforms: Vec<String>) -> Result<Vec<String>, OrchestratorError> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for platform in platforms {
        let normalized = platform.trim().to_ascii_lowercase();
        if normalized.is_empty() {
            continue;
        }
        if seen.insert(normalized.clone()) {
            out.push(normalized);
        }
    }
    if out.is_empty() {
        return Err(OrchestratorError::InvalidInput(
            "at least one platform must be selected".to_string(),
        ));
    }
    Ok(out)
}

fn enforce_cap(platform: &str, count: usize, cap: u32) -> Result<(), OrchestratorError> {
    if (count as u32) > cap {
        return Err(OrchestratorError::CapExceeded {
            platform: platform.to_string(),
            count,
            cap,
        });
    }
    Ok(())
}

fn require_verified(
    platform: &str,
    verify_results: &[VerificationResult],
) -> Result<(), OrchestratorError> {
    if verify_results.is_empty() || verify_results.iter().any(|v| !v.verified) {
        return Err(OrchestratorError::InvalidReleaseState(format!(
            "verification failed for `{platform}`"
        )));
    }
    Ok(())
}

fn sanitize_filename(input: &str) -> String {
    let sanitized: String = input
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if sanitized.is_empty() {
        "platform".to_string()
    } else {
        sanitized
    }
}

fn relative_or_full(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.to_string_lossy().replace('\\', "/"))
}

fn infer_simulated_and_verified(
    result_json: Option<&Value>,
) -> Result<(bool, bool), OrchestratorError> {
    let Some(result_json) = result_json else {
        return Ok((false, false));
    };

    #[derive(Deserialize)]
    struct StoredResultFlags {
        execution_results: Vec<StoredExecutionFlags>,
        verification_results: Vec<StoredVerificationFlags>,
    }

    #[derive(Deserialize)]
    struct StoredExecutionFlags {
        simulated: bool,
    }

    #[derive(Deserialize)]
    struct StoredVerificationFlags {
        verified: bool,
    }

    let stored =
        serde_json::from_value::<StoredResultFlags>(result_json.clone()).map_err(|error| {
            OrchestratorError::InvalidReleaseState(format!(
                "invalid stored platform result_json schema: {error}"
            ))
        })?;

    let simulated = stored.execution_results.iter().all(|entry| entry.simulated);
    let verified = !stored.verification_results.is_empty()
        && stored
            .verification_results
            .iter()
            .all(|entry| entry.verified);

    Ok((simulated, verified))
}

async fn write_json_pretty<T: ?Sized + Serialize>(
    path: &Path,
    value: &T,
) -> Result<(), OrchestratorError> {
    let bytes = serde_json::to_vec_pretty(value)?;
    tokio::fs::write(path, bytes).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{infer_simulated_and_verified, OrchestratorError};
    use serde_json::json;

    #[test]
    fn infer_simulated_and_verified_returns_false_false_when_result_json_missing() {
        let flags =
            infer_simulated_and_verified(None).expect("missing result_json should be allowed");
        assert_eq!(flags, (false, false));
    }

    #[test]
    fn infer_simulated_and_verified_parses_valid_result_json_flags() {
        let value = json!({
            "execution_results": [
                { "simulated": true, "external_id": "x" }
            ],
            "verification_results": [
                { "verified": true, "note": "ok" }
            ],
        });

        let flags = infer_simulated_and_verified(Some(&value)).expect("valid stored result_json");
        assert_eq!(flags, (true, true));
    }

    #[test]
    fn infer_simulated_and_verified_rejects_invalid_result_json_schema() {
        let value = json!({
            "execution_results": [{ "external_id": "missing simulated" }],
            "verification_results": [{ "verified": true }],
        });

        let error =
            infer_simulated_and_verified(Some(&value)).expect_err("invalid schema should fail");
        match error {
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
}
