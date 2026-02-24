use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExecutionEnvironment {
    Test,
    Staging,
    Production,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlannedAction {
    pub platform: String,
    pub action: String,
    pub simulated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExecutionResult {
    pub platform: String,
    pub external_id: Option<String>,
    pub status: String,
    pub simulated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VerificationResult {
    pub platform: String,
    pub verified: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlanContext {
    pub release_id: String,
    pub env: ExecutionEnvironment,
    pub max_actions_per_platform_per_run: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExecuteContext {
    pub release_id: String,
    pub env: ExecutionEnvironment,
    pub max_actions_per_platform_per_run: u32,
}

#[async_trait]
pub trait Publisher: Send + Sync {
    fn platform_name(&self) -> &'static str;
    async fn plan(&self, ctx: &PlanContext) -> anyhow::Result<Vec<PlannedAction>>;
    async fn execute(
        &self,
        ctx: &ExecuteContext,
        plan: &[PlannedAction],
    ) -> anyhow::Result<Vec<ExecutionResult>>;
    async fn verify(&self, ctx: &ExecuteContext) -> anyhow::Result<Vec<VerificationResult>>;
}
