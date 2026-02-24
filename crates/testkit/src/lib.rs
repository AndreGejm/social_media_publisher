use async_trait::async_trait;
use release_publisher_core::transport::{
    HttpMethod, Transport, TransportError, TransportErrorCode, TransportRequest, TransportResponse,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};
use std::sync::{Arc, Mutex, MutexGuard};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ScriptedResponse {
    pub status: u16,
    pub body: Vec<u8>,
    pub headers: BTreeMap<String, String>,
    pub label: String,
}

impl ScriptedResponse {
    pub fn text(status: u16, body: impl Into<String>, label: impl Into<String>) -> Self {
        Self {
            status,
            body: body.into().into_bytes(),
            headers: BTreeMap::new(),
            label: label.into(),
        }
    }

    pub fn try_json(
        status: u16,
        body: serde_json::Value,
        label: impl Into<String>,
    ) -> Result<Self, serde_json::Error> {
        Ok(Self {
            status,
            body: serde_json::to_vec(&body)?,
            headers: BTreeMap::from([("content-type".to_string(), "application/json".to_string())]),
            label: label.into(),
        })
    }

    pub fn with_header(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.headers
            .insert(name.into().to_ascii_lowercase(), value.into());
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ScriptedTransportErrorKind {
    Timeout,
    Network,
    InvalidRequest,
    Internal,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ScriptedTransportError {
    pub kind: ScriptedTransportErrorKind,
    pub message: String,
    pub retryable: bool,
}

impl ScriptedTransportError {
    pub fn timeout(message: impl Into<String>) -> Self {
        Self {
            kind: ScriptedTransportErrorKind::Timeout,
            message: message.into(),
            retryable: true,
        }
    }

    pub fn network(message: impl Into<String>, retryable: bool) -> Self {
        Self {
            kind: ScriptedTransportErrorKind::Network,
            message: message.into(),
            retryable,
        }
    }
}

impl From<ScriptedTransportError> for TransportError {
    fn from(value: ScriptedTransportError) -> Self {
        match value.kind {
            ScriptedTransportErrorKind::Timeout => TransportError::timeout(value.message),
            ScriptedTransportErrorKind::Network => {
                TransportError::network(value.message, value.retryable)
            }
            ScriptedTransportErrorKind::InvalidRequest => {
                TransportError::invalid_request(value.message)
            }
            ScriptedTransportErrorKind::Internal => {
                TransportError::new(TransportErrorCode::Internal, value.message, value.retryable)
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "step", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ScriptedStep {
    Response { response: ScriptedResponse },
    Error { error: ScriptedTransportError },
}

impl ScriptedStep {
    pub fn response(response: ScriptedResponse) -> Self {
        Self::Response { response }
    }

    pub fn error(error: ScriptedTransportError) -> Self {
        Self::Error { error }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct RequestExpectation {
    pub method: Option<HttpMethod>,
    pub url_contains: Option<String>,
    /// Zero-based request index across the lifetime of this TestTransport.
    pub call_index: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ScriptedStepSpec {
    pub expectation: Option<RequestExpectation>,
    pub step: ScriptedStep,
}

impl ScriptedStepSpec {
    pub fn new(step: ScriptedStep) -> Self {
        Self {
            expectation: None,
            step,
        }
    }

    pub fn expect(mut self, expectation: RequestExpectation) -> Self {
        self.expectation = Some(expectation);
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum FaultScenario {
    Timeout,
    Http429 { retry_after_secs: u64 },
    Http500Burst { count: u32 },
    MalformedJson,
    PartialBody,
    TokenExpired401,
    PartialFailure,
}

pub fn fault_script(scenario: FaultScenario) -> Vec<ScriptedStep> {
    match scenario {
        FaultScenario::Timeout => vec![ScriptedStep::error(ScriptedTransportError::timeout(
            "scripted timeout",
        ))],
        FaultScenario::Http429 { retry_after_secs } => vec![ScriptedStep::response(
            ScriptedResponse::text(429, "rate limited", "http-429")
                .with_header("retry-after", retry_after_secs.to_string()),
        )],
        FaultScenario::Http500Burst { count } => (0..count)
            .map(|idx| {
                ScriptedStep::response(ScriptedResponse::text(
                    500,
                    format!("server error {idx}"),
                    format!("http-500-{idx}"),
                ))
            })
            .collect(),
        FaultScenario::MalformedJson => vec![ScriptedStep::response(ScriptedResponse {
            status: 200,
            body: b"{not-json".to_vec(),
            headers: BTreeMap::from([("content-type".to_string(), "application/json".to_string())]),
            label: "malformed-json".to_string(),
        })],
        FaultScenario::PartialBody => vec![ScriptedStep::response(ScriptedResponse {
            status: 200,
            body: br#"{"token":"abc","status":"ok""#.to_vec(),
            headers: BTreeMap::from([("content-type".to_string(), "application/json".to_string())]),
            label: "partial-body".to_string(),
        })],
        FaultScenario::TokenExpired401 => vec![ScriptedStep::response(
            ScriptedResponse::text(
                401,
                r#"{"error":"token_expired","message":"access token expired"}"#,
                "token-expired-401",
            )
            .with_header("content-type", "application/json"),
        )],
        FaultScenario::PartialFailure => vec![
            match ScriptedResponse::try_json(
                202,
                serde_json::json!({"upload_id":"part-1","received":1}),
                "partial-accepted",
            ) {
                Ok(response) => ScriptedStep::response(response),
                Err(error) => ScriptedStep::error(ScriptedTransportError {
                    kind: ScriptedTransportErrorKind::Internal,
                    message: format!("failed to build partial failure fixture JSON: {error}"),
                    retryable: false,
                }),
            },
            ScriptedStep::error(ScriptedTransportError::network(
                "connection dropped mid-sequence",
                true,
            )),
        ],
    }
}

#[derive(Debug, Clone)]
pub struct RecordedRequest {
    pub request: TransportRequest,
}

#[derive(Default)]
struct Inner {
    queue: VecDeque<ScriptedStepSpec>,
    requests: Vec<RecordedRequest>,
}

#[derive(Clone, Default)]
pub struct TestTransport {
    inner: Arc<Mutex<Inner>>,
}

impl TestTransport {
    pub fn with_steps(steps: Vec<ScriptedStep>) -> Self {
        let specs = steps.into_iter().map(ScriptedStepSpec::new).collect();
        Self::with_step_specs(specs)
    }

    pub fn with_step_specs(step_specs: Vec<ScriptedStepSpec>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                queue: VecDeque::from(step_specs),
                requests: Vec::new(),
            })),
        }
    }

    pub fn with_fault(scenario: FaultScenario) -> Self {
        Self::with_steps(fault_script(scenario))
    }

    pub fn push_step(&self, step: ScriptedStep) -> Result<(), TransportError> {
        self.push_step_spec(ScriptedStepSpec::new(step))
    }

    pub fn push_step_spec(&self, step_spec: ScriptedStepSpec) -> Result<(), TransportError> {
        let mut inner = self.lock_inner()?;
        inner.queue.push_back(step_spec);
        Ok(())
    }

    pub fn recorded_requests(&self) -> Result<Vec<RecordedRequest>, TransportError> {
        let inner = self.lock_inner()?;
        Ok(inner.requests.clone())
    }

    pub fn remaining_steps(&self) -> Result<usize, TransportError> {
        let inner = self.lock_inner()?;
        Ok(inner.queue.len())
    }

    fn lock_inner(&self) -> Result<MutexGuard<'_, Inner>, TransportError> {
        self.inner.lock().map_err(|_| {
            TransportError::new(
                TransportErrorCode::Internal,
                "scripted transport mutex poisoned",
                false,
            )
        })
    }
}

#[async_trait]
impl Transport for TestTransport {
    async fn send(&self, request: TransportRequest) -> Result<TransportResponse, TransportError> {
        let mut inner = self.lock_inner()?;
        let call_index = inner.requests.len();
        inner.requests.push(RecordedRequest {
            request: request.clone(),
        });

        let step_spec = inner.queue.pop_front().ok_or_else(|| {
            TransportError::script_exhausted("no scripted transport steps remaining")
        })?;
        if let Some(expectation) = step_spec.expectation.as_ref() {
            validate_request_expectation(expectation, &request, call_index)?;
        }
        drop(inner);

        match step_spec.step {
            ScriptedStep::Response { response } => Ok(TransportResponse {
                status: response.status,
                headers: response.headers,
                body: response.body,
            }),
            ScriptedStep::Error { error } => Err(error.into()),
        }
    }
}

fn validate_request_expectation(
    expectation: &RequestExpectation,
    request: &TransportRequest,
    call_index: usize,
) -> Result<(), TransportError> {
    if let Some(expected_index) = expectation.call_index {
        if expected_index != call_index {
            return Err(TransportError::new(
                TransportErrorCode::InvalidRequest,
                format!(
                    "scripted request call index mismatch: expected {expected_index}, got {call_index}"
                ),
                false,
            ));
        }
    }
    if let Some(expected_method) = &expectation.method {
        if expected_method != &request.method {
            return Err(TransportError::new(
                TransportErrorCode::InvalidRequest,
                format!(
                    "scripted request method mismatch: expected {:?}, got {:?}",
                    expected_method, request.method
                ),
                false,
            ));
        }
    }
    if let Some(url_contains) = expectation.url_contains.as_deref() {
        if !request.url.contains(url_contains) {
            return Err(TransportError::new(
                TransportErrorCode::InvalidRequest,
                format!("scripted request URL mismatch: expected substring `{url_contains}`"),
                false,
            ));
        }
    }
    Ok(())
}
