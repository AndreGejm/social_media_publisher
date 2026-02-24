use async_trait::async_trait;
use release_publisher_core::retry::{send_with_retry, RetryPolicy, Sleeper};
use release_publisher_core::transport::{
    HttpMethod, Transport, TransportErrorCode, TransportRequest,
};
use release_publisher_testkit::{
    fault_script, FaultScenario, RequestExpectation, ScriptedResponse, ScriptedStep,
    ScriptedStepSpec, ScriptedTransportError, TestTransport,
};
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
struct RecordingSleeper {
    delays: Arc<Mutex<Vec<u64>>>,
}

impl RecordingSleeper {
    fn delays(&self) -> Vec<u64> {
        self.delays.lock().expect("poisoned").clone()
    }
}

#[async_trait]
impl Sleeper for RecordingSleeper {
    async fn sleep_ms(&self, duration_ms: u64) {
        self.delays.lock().expect("poisoned").push(duration_ms);
    }
}

fn request() -> TransportRequest {
    let mut req = TransportRequest::new(HttpMethod::Post, "https://example.test/upload");
    req.operation = Some("mock-upload".to_string());
    req
}

#[tokio::test]
async fn retries_on_timeout_then_succeeds() {
    let transport = TestTransport::with_steps(vec![
        ScriptedStep::error(ScriptedTransportError::timeout("first timeout")),
        ScriptedStep::response(
            ScriptedResponse::try_json(200, serde_json::json!({"ok": true}), "success")
                .expect("test fixture json"),
        ),
    ]);
    let sleeper = RecordingSleeper::default();
    let policy = RetryPolicy {
        max_attempts: 3,
        base_delay_ms: 10,
        max_delay_ms: 100,
        jitter_ratio_pct: 0,
        jitter_seed: 1,
        ..RetryPolicy::default()
    };

    let (response, report) = send_with_retry(&transport, request(), &policy, &sleeper)
        .await
        .expect("request should retry and succeed");

    assert_eq!(response.status, 200);
    assert_eq!(report.attempts.len(), 2);
    assert_eq!(sleeper.delays(), vec![10]);
    assert_eq!(transport.recorded_requests().unwrap().len(), 2);
}

#[tokio::test]
async fn retries_on_500_burst_then_succeeds_with_exponential_backoff() {
    let mut steps = fault_script(FaultScenario::Http500Burst { count: 2 });
    steps.push(ScriptedStep::response(
        ScriptedResponse::try_json(200, serde_json::json!({"ok": true}), "success")
            .expect("test fixture json"),
    ));
    let transport = TestTransport::with_steps(steps);
    let sleeper = RecordingSleeper::default();
    let policy = RetryPolicy {
        max_attempts: 4,
        base_delay_ms: 25,
        max_delay_ms: 1000,
        jitter_ratio_pct: 0,
        jitter_seed: 1,
        ..RetryPolicy::default()
    };

    let (response, report) = send_with_retry(&transport, request(), &policy, &sleeper)
        .await
        .expect("500 burst should be retried");

    assert_eq!(response.status, 200);
    assert_eq!(report.attempts.len(), 3);
    assert_eq!(sleeper.delays(), vec![25, 50]);
}

#[tokio::test]
async fn honors_retry_after_for_429() {
    let mut steps = fault_script(FaultScenario::Http429 {
        retry_after_secs: 2,
    });
    steps.push(ScriptedStep::response(ScriptedResponse::text(
        204,
        "",
        "no-content",
    )));
    let transport = TestTransport::with_steps(steps);
    let sleeper = RecordingSleeper::default();

    let policy = RetryPolicy {
        jitter_ratio_pct: 0,
        jitter_seed: 1,
        ..RetryPolicy::default()
    };
    let (response, _report) = send_with_retry(&transport, request(), &policy, &sleeper)
        .await
        .expect("429 should retry");

    assert_eq!(response.status, 204);
    assert_eq!(sleeper.delays(), vec![2_000]);
}

#[tokio::test]
async fn malformed_json_fault_returns_typed_decode_error() {
    let transport = TestTransport::with_fault(FaultScenario::MalformedJson);
    let response = transport.send(request()).await.expect("scripted response");
    let err = response
        .json::<serde_json::Value>()
        .expect_err("malformed JSON should fail decode");

    assert_eq!(err.code, TransportErrorCode::ResponseDecodeFailed);
}

#[tokio::test]
async fn partial_body_fault_returns_typed_decode_error() {
    let transport = TestTransport::with_fault(FaultScenario::PartialBody);
    let response = transport.send(request()).await.expect("scripted response");
    let err = response
        .json::<serde_json::Value>()
        .expect_err("partial body should fail decode");

    assert_eq!(err.code, TransportErrorCode::ResponseDecodeFailed);
}

#[tokio::test]
async fn token_expired_401_is_not_retried_by_default_policy() {
    let transport = TestTransport::with_fault(FaultScenario::TokenExpired401);
    let sleeper = RecordingSleeper::default();
    let policy = RetryPolicy {
        jitter_ratio_pct: 0,
        jitter_seed: 1,
        ..RetryPolicy::default()
    };

    let (response, report) = send_with_retry(&transport, request(), &policy, &sleeper)
        .await
        .expect("401 is a terminal HTTP response in current policy");

    assert_eq!(response.status, 401);
    assert_eq!(report.attempts.len(), 1);
    assert!(sleeper.delays().is_empty());
    assert_eq!(transport.recorded_requests().unwrap().len(), 1);
}

#[tokio::test]
async fn partial_failure_script_preserves_order_and_request_recording() {
    let transport = TestTransport::with_fault(FaultScenario::PartialFailure);

    let first = transport
        .send(request())
        .await
        .expect("first scripted step is response");
    assert_eq!(first.status, 202);

    let second = transport
        .send(request())
        .await
        .expect_err("second scripted step is error");
    assert_eq!(second.code, TransportErrorCode::Network);
    assert!(second.retryable);

    assert_eq!(transport.recorded_requests().unwrap().len(), 2);
    assert_eq!(transport.remaining_steps().unwrap(), 0);
}

#[tokio::test]
async fn never_exceeds_max_attempts_on_repeated_timeouts() {
    let transport = TestTransport::with_steps(vec![
        ScriptedStep::error(ScriptedTransportError::timeout("timeout-1")),
        ScriptedStep::error(ScriptedTransportError::timeout("timeout-2")),
        ScriptedStep::error(ScriptedTransportError::timeout("timeout-3")),
    ]);
    let sleeper = RecordingSleeper::default();
    let policy = RetryPolicy {
        max_attempts: 2,
        base_delay_ms: 10,
        max_delay_ms: 100,
        jitter_ratio_pct: 0,
        jitter_seed: 1,
        ..RetryPolicy::default()
    };

    let err = send_with_retry(&transport, request(), &policy, &sleeper)
        .await
        .expect_err("timeouts should fail after max attempts");
    assert_eq!(err.code, TransportErrorCode::Timeout);
    assert_eq!(transport.recorded_requests().unwrap().len(), 2);
    assert_eq!(sleeper.delays(), vec![10]);
}

#[tokio::test]
async fn never_retries_permanent_400_by_default() {
    let transport = TestTransport::with_steps(vec![
        ScriptedStep::response(ScriptedResponse::text(400, "bad request", "http-400")),
        ScriptedStep::response(ScriptedResponse::text(
            200,
            "should-not-be-used",
            "late-success",
        )),
    ]);
    let sleeper = RecordingSleeper::default();
    let policy = RetryPolicy {
        jitter_ratio_pct: 0,
        jitter_seed: 1,
        ..RetryPolicy::default()
    };

    let (response, report) = send_with_retry(&transport, request(), &policy, &sleeper)
        .await
        .expect("400 is terminal response under current policy");
    assert_eq!(response.status, 400);
    assert_eq!(report.attempts.len(), 1);
    assert!(sleeper.delays().is_empty());
    assert_eq!(transport.recorded_requests().unwrap().len(), 1);
}

#[tokio::test]
async fn scripted_step_expectations_match_method_url_and_call_index() {
    let transport = TestTransport::with_step_specs(vec![
        ScriptedStepSpec::new(ScriptedStep::response(ScriptedResponse::text(
            202, "", "accepted",
        )))
        .expect(RequestExpectation {
            method: Some(HttpMethod::Post),
            url_contains: Some("/upload".to_string()),
            call_index: Some(0),
        }),
        ScriptedStepSpec::new(ScriptedStep::response(ScriptedResponse::text(
            204, "", "done",
        )))
        .expect(RequestExpectation {
            method: Some(HttpMethod::Post),
            url_contains: Some("example.test".to_string()),
            call_index: Some(1),
        }),
    ]);

    let _ = transport.send(request()).await.expect("first matches");
    let _ = transport.send(request()).await.expect("second matches");
    assert_eq!(transport.remaining_steps().unwrap(), 0);
}
