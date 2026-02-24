use crate::transport::TransportError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CircuitBreakerConfig {
    pub failure_threshold: u32,
    pub open_duration_ms: u64,
}

impl Default for CircuitBreakerConfig {
    fn default() -> Self {
        Self {
            failure_threshold: 3,
            open_duration_ms: 30_000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CircuitState {
    Closed,
    Open { until_ms: u64 },
    HalfOpen,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CircuitBreaker {
    config: CircuitBreakerConfig,
    consecutive_failures: u32,
    state: CircuitState,
}

impl CircuitBreaker {
    pub fn new(config: CircuitBreakerConfig) -> Self {
        Self {
            config,
            consecutive_failures: 0,
            state: CircuitState::Closed,
        }
    }

    pub fn state(&self, now_ms: u64) -> CircuitState {
        match self.state {
            CircuitState::Open { until_ms } if now_ms >= until_ms => CircuitState::HalfOpen,
            _ => self.state.clone(),
        }
    }

    pub fn before_request(&mut self, now_ms: u64) -> Result<(), TransportError> {
        match self.state(now_ms) {
            CircuitState::Closed | CircuitState::HalfOpen => {
                if matches!(self.state, CircuitState::Open { .. }) {
                    self.state = CircuitState::HalfOpen;
                }
                Ok(())
            }
            CircuitState::Open { until_ms } => Err(TransportError::circuit_open(format!(
                "circuit breaker open until {until_ms}"
            ))),
        }
    }

    pub fn record_success(&mut self) {
        self.consecutive_failures = 0;
        self.state = CircuitState::Closed;
    }

    pub fn record_failure(&mut self, now_ms: u64) {
        match self.state {
            CircuitState::HalfOpen => {
                self.state = CircuitState::Open {
                    until_ms: now_ms.saturating_add(self.config.open_duration_ms),
                };
                self.consecutive_failures = self.config.failure_threshold;
                return;
            }
            CircuitState::Open { .. } => {
                self.state = CircuitState::Open {
                    until_ms: now_ms.saturating_add(self.config.open_duration_ms),
                };
                return;
            }
            CircuitState::Closed => {}
        }

        self.consecutive_failures = self.consecutive_failures.saturating_add(1);
        if self.consecutive_failures >= self.config.failure_threshold {
            self.state = CircuitState::Open {
                until_ms: now_ms.saturating_add(self.config.open_duration_ms),
            };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::TransportErrorCode;

    #[test]
    fn opens_after_threshold_failures_and_recovers_to_half_open() {
        let mut cb = CircuitBreaker::new(CircuitBreakerConfig {
            failure_threshold: 2,
            open_duration_ms: 1000,
        });

        cb.record_failure(100);
        assert_eq!(cb.state(100), CircuitState::Closed);

        cb.record_failure(150);
        assert_eq!(cb.state(151), CircuitState::Open { until_ms: 1150 });

        let err = cb.before_request(200).expect_err("circuit should be open");
        assert_eq!(err.code, TransportErrorCode::CircuitOpen);

        assert_eq!(cb.state(1150), CircuitState::HalfOpen);
        cb.before_request(1150)
            .expect("half-open should allow one request");
        cb.record_success();
        assert_eq!(cb.state(1151), CircuitState::Closed);
    }

    #[test]
    fn half_open_failure_reopens_circuit() {
        let mut cb = CircuitBreaker::new(CircuitBreakerConfig {
            failure_threshold: 1,
            open_duration_ms: 500,
        });
        cb.record_failure(10);
        assert_eq!(cb.state(20), CircuitState::Open { until_ms: 510 });
        cb.before_request(510).expect("half-open should allow");
        cb.record_failure(520);
        assert_eq!(cb.state(521), CircuitState::Open { until_ms: 1020 });
    }
}
