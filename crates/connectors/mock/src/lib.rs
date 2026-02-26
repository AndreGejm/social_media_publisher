use async_trait::async_trait;
use release_publisher_core::pipeline::{
    ExecuteContext, ExecutionResult, ExecutionStatus, PlanContext, PlannedAction,
    PlannedActionType, Publisher, VerificationResult,
};

#[derive(Debug, Default)]
pub struct MockPublisher;

#[async_trait]
impl Publisher for MockPublisher {
    fn platform_name(&self) -> &'static str {
        "mock"
    }

    async fn plan(&self, ctx: &PlanContext) -> anyhow::Result<Vec<PlannedAction>> {
        Ok(vec![PlannedAction {
            platform: self.platform_name().to_string(),
            action: format!("Simulate publish for {}", ctx.release_id),
            action_type: PlannedActionType::Publish,
            simulated: true,
        }])
    }

    async fn execute(
        &self,
        _ctx: &ExecuteContext,
        plan: &[PlannedAction],
    ) -> anyhow::Result<Vec<ExecutionResult>> {
        Ok(plan
            .iter()
            .map(|action| ExecutionResult {
                platform: action.platform.clone(),
                external_id: None,
                status: ExecutionStatus::Simulated,
                simulated: true,
            })
            .collect())
    }

    async fn verify(&self, _ctx: &ExecuteContext) -> anyhow::Result<Vec<VerificationResult>> {
        Ok(vec![VerificationResult {
            platform: self.platform_name().to_string(),
            verified: true,
            message: "Mock verify always succeeds in TEST mode".to_string(),
        }])
    }
}
