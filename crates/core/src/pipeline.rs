use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExecutionEnvironment {
    Test,
    Staging,
    Production,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PlannedActionType {
    #[default]
    Unknown,
    Publish,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlannedAction {
    pub platform: String,
    pub action: String,
    #[serde(default)]
    pub action_type: PlannedActionType,
    pub simulated: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExecutionStatus {
    Simulated,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExecutionResult {
    pub platform: String,
    pub external_id: Option<String>,
    pub status: ExecutionStatus,
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

#[cfg(test)]
mod tests {
    use super::{ExecutionResult, ExecutionStatus, PlannedAction, PlannedActionType};
    use serde_json::json;

    #[test]
    fn execution_result_status_serializes_as_legacy_string() {
        let value = serde_json::to_value(ExecutionResult {
            platform: "mock".to_string(),
            external_id: None,
            status: ExecutionStatus::Simulated,
            simulated: true,
        })
        .expect("serialize execution result");

        assert_eq!(
            value,
            json!({
                "platform": "mock",
                "external_id": null,
                "status": "SIMULATED",
                "simulated": true
            })
        );
    }

    #[test]
    fn execution_result_status_deserializes_legacy_string() {
        let parsed: ExecutionResult = serde_json::from_value(json!({
            "platform": "mock",
            "external_id": "id-1",
            "status": "SIMULATED",
            "simulated": true
        }))
        .expect("deserialize execution result");

        assert_eq!(parsed.status, ExecutionStatus::Simulated);
        assert_eq!(parsed.external_id.as_deref(), Some("id-1"));
    }

    #[test]
    fn planned_action_deserializes_without_action_type_for_backward_compat() {
        let parsed: PlannedAction = serde_json::from_value(json!({
            "platform": "mock",
            "action": "Simulate publish for abc123",
            "simulated": true
        }))
        .expect("deserialize planned action without action_type");

        assert_eq!(parsed.action_type, PlannedActionType::Unknown);
    }

    #[test]
    fn planned_action_action_type_serializes_as_string_token() {
        let value = serde_json::to_value(PlannedAction {
            platform: "mock".to_string(),
            action: "Simulate publish".to_string(),
            action_type: PlannedActionType::Publish,
            simulated: true,
        })
        .expect("serialize planned action");

        assert_eq!(
            value,
            json!({
                "platform": "mock",
                "action": "Simulate publish",
                "action_type": "PUBLISH",
                "simulated": true
            })
        );
    }
}
