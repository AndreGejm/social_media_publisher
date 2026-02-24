use crate::transport::{Transport, TransportError, TransportResponse};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RetryPolicy {
    pub max_attempts: u32,
    pub base_delay_ms: u64,
    pub max_delay_ms: u64,
    pub jitter_ratio_pct: u8,
    pub jitter_seed: u64,
    pub retry_on_statuses: Vec<u16>,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_attempts: 3,
            base_delay_ms: 100,
            max_delay_ms: 5_000,
            jitter_ratio_pct: 20,
            jitter_seed: 0x9E37_79B9_7F4A_7C15,
            retry_on_statuses: vec![429, 500, 502, 503, 504],
        }
    }
}

impl RetryPolicy {
    pub fn validate(&self) -> Result<(), TransportError> {
        if self.max_attempts == 0 {
            return Err(TransportError::invalid_request("max_attempts must be >= 1"));
        }
        if self.base_delay_ms == 0 {
            return Err(TransportError::invalid_request(
                "base_delay_ms must be >= 1",
            ));
        }
        if self.max_delay_ms < self.base_delay_ms {
            return Err(TransportError::invalid_request(
                "max_delay_ms must be >= base_delay_ms",
            ));
        }
        if self.jitter_ratio_pct > 100 {
            return Err(TransportError::invalid_request(
                "jitter_ratio_pct must be <= 100",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RetryAttemptRecord {
    pub attempt: u32,
    pub delay_ms: Option<u64>,
    pub outcome: RetryOutcome,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RetryOutcome {
    Response {
        status: u16,
    },
    Error {
        code: crate::transport::TransportErrorCode,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct RetryReport {
    pub attempts: Vec<RetryAttemptRecord>,
}

impl RetryReport {
    pub fn new() -> Self {
        Self {
            attempts: Vec::new(),
        }
    }
}

#[async_trait]
pub trait Sleeper: Send + Sync {
    async fn sleep_ms(&self, duration_ms: u64);
}

#[derive(Debug, Clone, Default)]
pub struct TokioSleeper;

#[async_trait]
impl Sleeper for TokioSleeper {
    async fn sleep_ms(&self, duration_ms: u64) {
        tokio::time::sleep(std::time::Duration::from_millis(duration_ms)).await;
    }
}

pub async fn send_with_retry<T, S>(
    transport: &T,
    request: crate::transport::TransportRequest,
    policy: &RetryPolicy,
    sleeper: &S,
) -> Result<(TransportResponse, RetryReport), TransportError>
where
    T: Transport,
    S: Sleeper,
{
    policy.validate()?;
    let mut report = RetryReport::new();

    for attempt in 1..=policy.max_attempts {
        let response_or_error = transport.send(request.clone()).await;

        match response_or_error {
            Ok(response) => {
                let status = response.status;
                let retry_delay = retry_delay_for_response(policy, status, &response, attempt);
                report.attempts.push(RetryAttemptRecord {
                    attempt,
                    delay_ms: retry_delay,
                    outcome: RetryOutcome::Response { status },
                });

                if let Some(delay_ms) = retry_delay {
                    sleeper.sleep_ms(delay_ms).await;
                    continue;
                }

                return Ok((response, report));
            }
            Err(error) => {
                let retry_delay = retry_delay_for_error(policy, &error, attempt);
                report.attempts.push(RetryAttemptRecord {
                    attempt,
                    delay_ms: retry_delay,
                    outcome: RetryOutcome::Error {
                        code: error.code.clone(),
                    },
                });

                if let Some(delay_ms) = retry_delay {
                    sleeper.sleep_ms(delay_ms).await;
                    continue;
                }

                return Err(error);
            }
        }
    }

    Err(TransportError::new(
        crate::transport::TransportErrorCode::Internal,
        "retry loop exhausted without returning a terminal response",
        false,
    ))
}

pub fn retry_delay_for_response(
    policy: &RetryPolicy,
    status: u16,
    response: &TransportResponse,
    attempt: u32,
) -> Option<u64> {
    if attempt >= policy.max_attempts {
        return None;
    }

    if status == 429 {
        if let Some(retry_after) = parse_retry_after_seconds(response) {
            return Some(retry_after.saturating_mul(1_000));
        }
    }

    if policy.retry_on_statuses.contains(&status) {
        let base = exponential_backoff_ms(policy, attempt);
        return Some(apply_deterministic_jitter_ms(
            policy,
            base,
            attempt,
            status as u64,
        ));
    }

    None
}

pub fn retry_delay_for_error(
    policy: &RetryPolicy,
    error: &TransportError,
    attempt: u32,
) -> Option<u64> {
    if attempt >= policy.max_attempts || !error.retryable {
        return None;
    }
    let base = exponential_backoff_ms(policy, attempt);
    Some(apply_deterministic_jitter_ms(
        policy,
        base,
        attempt,
        transport_error_code_salt(&error.code),
    ))
}

pub fn exponential_backoff_ms(policy: &RetryPolicy, attempt: u32) -> u64 {
    let exp = attempt.saturating_sub(1).min(20);
    let multiplier = 1_u64 << exp;
    let raw = policy.base_delay_ms.saturating_mul(multiplier);
    raw.min(policy.max_delay_ms)
}

pub fn apply_deterministic_jitter_ms(
    policy: &RetryPolicy,
    base_delay_ms: u64,
    attempt: u32,
    salt: u64,
) -> u64 {
    if base_delay_ms == 0 || policy.jitter_ratio_pct == 0 {
        return base_delay_ms;
    }

    let max_jitter = base_delay_ms
        .saturating_mul(policy.jitter_ratio_pct as u64)
        .saturating_div(100);
    if max_jitter == 0 {
        return base_delay_ms;
    }

    let mut x = policy.jitter_seed ^ ((attempt as u64) << 32) ^ salt;
    x ^= x >> 12;
    x ^= x << 25;
    x ^= x >> 27;
    let jitter = x % (max_jitter + 1);

    base_delay_ms
        .saturating_add(jitter)
        .min(policy.max_delay_ms)
}

pub fn parse_retry_after_seconds(response: &TransportResponse) -> Option<u64> {
    response
        .header("retry-after")
        .and_then(|value| value.trim().parse::<u64>().ok())
}

fn transport_error_code_salt(code: &crate::transport::TransportErrorCode) -> u64 {
    match code {
        crate::transport::TransportErrorCode::InvalidRequest => 1,
        crate::transport::TransportErrorCode::Timeout => 2,
        crate::transport::TransportErrorCode::Network => 3,
        crate::transport::TransportErrorCode::CircuitOpen => 4,
        crate::transport::TransportErrorCode::ScriptExhausted => 5,
        crate::transport::TransportErrorCode::SerializationFailed => 6,
        crate::transport::TransportErrorCode::ResponseDecodeFailed => 7,
        crate::transport::TransportErrorCode::Internal => 8,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::{TransportErrorCode, TransportResponse};
    use std::collections::BTreeMap;

    #[test]
    fn backoff_is_capped() {
        let policy = RetryPolicy {
            max_attempts: 5,
            base_delay_ms: 100,
            max_delay_ms: 250,
            jitter_ratio_pct: 0,
            jitter_seed: 1,
            retry_on_statuses: vec![500],
        };

        assert_eq!(exponential_backoff_ms(&policy, 1), 100);
        assert_eq!(exponential_backoff_ms(&policy, 2), 200);
        assert_eq!(exponential_backoff_ms(&policy, 3), 250);
        assert_eq!(exponential_backoff_ms(&policy, 4), 250);
    }

    #[test]
    fn retry_after_header_overrides_default_backoff_for_429() {
        let policy = RetryPolicy::default();
        let mut headers = BTreeMap::new();
        headers.insert("retry-after".to_string(), "7".to_string());
        let response = TransportResponse {
            status: 429,
            headers,
            body: Vec::new(),
        };

        let delay = retry_delay_for_response(&policy, 429, &response, 1).expect("delay");
        assert_eq!(delay, 7_000);
    }

    #[test]
    fn non_retryable_error_returns_no_delay() {
        let policy = RetryPolicy::default();
        let error = TransportError::new(TransportErrorCode::InvalidRequest, "bad request", false);
        assert_eq!(retry_delay_for_error(&policy, &error, 1), None);
    }

    #[test]
    fn deterministic_jitter_is_bounded_and_repeatable() {
        let policy = RetryPolicy {
            max_attempts: 3,
            base_delay_ms: 100,
            max_delay_ms: 1_000,
            jitter_ratio_pct: 25,
            jitter_seed: 42,
            retry_on_statuses: vec![500],
        };

        let a = apply_deterministic_jitter_ms(&policy, 100, 1, 500);
        let b = apply_deterministic_jitter_ms(&policy, 100, 1, 500);
        assert_eq!(a, b);
        assert!((100..=125).contains(&a));
    }
}
