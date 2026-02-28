use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::fmt;

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PublisherError {
    pub code: String,
    pub retryable: bool,
    pub redacted_message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_context: Option<String>,
}

impl PublisherError {
    pub fn new(
        code: impl Into<String>,
        retryable: bool,
        redacted_message: impl Into<String>,
        provider_context: Option<String>,
    ) -> Self {
        Self {
            code: code.into(),
            retryable,
            redacted_message: redacted_message.into(),
            provider_context,
        }
    }

    pub fn non_retryable(code: impl Into<String>, redacted_message: impl Into<String>) -> Self {
        Self::new(code, false, redacted_message, None)
    }
}

impl fmt::Display for PublisherError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(context) = &self.provider_context {
            write!(f, "{} [{}]: {}", self.code, context, self.redacted_message)
        } else {
            write!(f, "{}: {}", self.code, self.redacted_message)
        }
    }
}

impl std::error::Error for PublisherError {}

impl From<anyhow::Error> for PublisherError {
    fn from(value: anyhow::Error) -> Self {
        Self::non_retryable("PUBLISHER_INTERNAL", value.to_string())
    }
}

pub type PublisherResult<T> = Result<T, PublisherError>;

#[async_trait]
pub trait Publisher: Send + Sync {
    fn platform_name(&self) -> &'static str;
    async fn plan(&self, ctx: &PlanContext) -> PublisherResult<Vec<PlannedAction>>;
    async fn execute(
        &self,
        ctx: &ExecuteContext,
        plan: &[PlannedAction],
    ) -> PublisherResult<Vec<ExecutionResult>>;
    async fn verify(&self, ctx: &ExecuteContext) -> PublisherResult<Vec<VerificationResult>>;
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
