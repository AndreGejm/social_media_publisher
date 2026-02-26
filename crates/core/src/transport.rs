use async_trait::async_trait;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::str::FromStr;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HttpMethod {
    Get,
    Post,
    Put,
    Patch,
    Delete,
    Head,
}

impl From<&HttpMethod> for reqwest::Method {
    fn from(value: &HttpMethod) -> Self {
        match value {
            HttpMethod::Get => reqwest::Method::GET,
            HttpMethod::Post => reqwest::Method::POST,
            HttpMethod::Put => reqwest::Method::PUT,
            HttpMethod::Patch => reqwest::Method::PATCH,
            HttpMethod::Delete => reqwest::Method::DELETE,
            HttpMethod::Head => reqwest::Method::HEAD,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TransportLogCorrelation {
    pub release_id: String,
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TransportRequest {
    pub method: HttpMethod,
    pub url: String,
    pub headers: BTreeMap<String, String>,
    pub body: Vec<u8>,
    pub timeout_ms: Option<u64>,
    pub operation: Option<String>,
    pub log_correlation: Option<TransportLogCorrelation>,
}

impl TransportRequest {
    pub fn new(method: HttpMethod, url: impl Into<String>) -> Self {
        Self {
            method,
            url: url.into(),
            headers: BTreeMap::new(),
            body: Vec::new(),
            timeout_ms: None,
            operation: None,
            log_correlation: None,
        }
    }

    pub fn with_log_correlation(
        mut self,
        release_id: impl Into<String>,
        run_id: impl Into<String>,
    ) -> Self {
        self.log_correlation = Some(TransportLogCorrelation {
            release_id: release_id.into(),
            run_id: run_id.into(),
        });
        self
    }

    pub fn with_json_body(mut self, json: &serde_json::Value) -> Result<Self, TransportError> {
        self.headers
            .insert("content-type".to_string(), "application/json".to_string());
        self.body = serde_json::to_vec(json).map_err(|e| {
            TransportError::new(
                TransportErrorCode::SerializationFailed,
                format!("failed to serialize JSON body: {e}"),
                false,
            )
        })?;
        Ok(self)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TransportResponse {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub body: Vec<u8>,
}

impl TransportResponse {
    pub fn is_success(&self) -> bool {
        (200..=299).contains(&self.status)
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .get(&name.to_ascii_lowercase())
            .map(std::string::String::as_str)
    }

    pub fn body_text(&self) -> Result<String, TransportError> {
        String::from_utf8(self.body.clone()).map_err(|e| {
            TransportError::new(
                TransportErrorCode::ResponseDecodeFailed,
                format!("response body is not valid UTF-8: {e}"),
                false,
            )
        })
    }

    pub fn json<T: serde::de::DeserializeOwned>(&self) -> Result<T, TransportError> {
        serde_json::from_slice(&self.body).map_err(|e| {
            TransportError::new(
                TransportErrorCode::ResponseDecodeFailed,
                format!("failed to decode JSON response: {e}"),
                false,
            )
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TransportErrorCode {
    InvalidRequest,
    Timeout,
    Network,
    CircuitOpen,
    ScriptExhausted,
    SerializationFailed,
    ResponseDecodeFailed,
    Internal,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct TransportError {
    pub code: TransportErrorCode,
    pub message: String,
    pub retryable: bool,
}

impl TransportError {
    pub fn new(code: TransportErrorCode, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code,
            message: message.into(),
            retryable,
        }
    }

    pub fn timeout(message: impl Into<String>) -> Self {
        Self::new(TransportErrorCode::Timeout, message, true)
    }

    pub fn network(message: impl Into<String>, retryable: bool) -> Self {
        Self::new(TransportErrorCode::Network, message, retryable)
    }

    pub fn invalid_request(message: impl Into<String>) -> Self {
        Self::new(TransportErrorCode::InvalidRequest, message, false)
    }

    pub fn circuit_open(message: impl Into<String>) -> Self {
        Self::new(TransportErrorCode::CircuitOpen, message, true)
    }

    pub fn script_exhausted(message: impl Into<String>) -> Self {
        Self::new(TransportErrorCode::ScriptExhausted, message, false)
    }
}

#[async_trait]
pub trait Transport: Send + Sync {
    async fn send(&self, request: TransportRequest) -> Result<TransportResponse, TransportError>;
}

#[derive(Debug, Clone)]
pub struct RealTransport {
    client: reqwest::Client,
}

impl RealTransport {
    pub fn new(client: reqwest::Client) -> Self {
        Self { client }
    }

    pub fn try_default() -> Result<Self, TransportError> {
        let client = reqwest::Client::builder().build().map_err(|e| {
            TransportError::network(format!("failed to build reqwest client: {e}"), false)
        })?;
        Ok(Self { client })
    }
}

#[async_trait]
impl Transport for RealTransport {
    async fn send(&self, request: TransportRequest) -> Result<TransportResponse, TransportError> {
        let method: reqwest::Method = (&request.method).into();
        let mut req = self.client.request(method, &request.url);

        let header_map = build_header_map(&request.headers)?;
        req = req.headers(header_map);

        if let Some(timeout_ms) = request.timeout_ms {
            req = req.timeout(std::time::Duration::from_millis(timeout_ms));
        }

        if !request.body.is_empty() {
            req = req.body(request.body.clone());
        }

        let correlation = request.log_correlation.as_ref();

        tracing::debug!(
            target: "transport",
            operation = request.operation.as_deref().unwrap_or("unknown"),
            release_id = correlation
                .map(|value| value.release_id.as_str())
                .unwrap_or("n/a"),
            run_id = correlation
                .map(|value| value.run_id.as_str())
                .unwrap_or("n/a"),
            method = ?request.method,
            url = %request.url,
            headers = ?redact_headers(&request.headers),
            "sending HTTP request"
        );

        let response = req.send().await.map_err(map_reqwest_error)?;
        let status = response.status().as_u16();
        let headers = normalize_header_map(response.headers());
        let body = response
            .bytes()
            .await
            .map_err(|e| {
                TransportError::network(format!("failed to read response body: {e}"), true)
            })?
            .to_vec();

        Ok(TransportResponse {
            status,
            headers,
            body,
        })
    }
}

pub fn redact_headers(headers: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    headers
        .iter()
        .map(|(k, v)| {
            if is_sensitive_header(k) {
                (k.clone(), "<redacted>".to_string())
            } else {
                (k.clone(), v.clone())
            }
        })
        .collect()
}

pub fn is_sensitive_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "authorization"
            | "proxy-authorization"
            | "x-api-key"
            | "api-key"
            | "cookie"
            | "set-cookie"
            | "x-client-secret"
            | "client-secret"
    )
}

fn build_header_map(headers: &BTreeMap<String, String>) -> Result<HeaderMap, TransportError> {
    let mut header_map = HeaderMap::new();
    for (name, value) in headers {
        let header_name = HeaderName::from_str(name).map_err(|e| {
            TransportError::invalid_request(format!("invalid header name `{name}`: {e}"))
        })?;
        let header_value = HeaderValue::from_str(value).map_err(|e| {
            TransportError::invalid_request(format!("invalid header value for `{name}`: {e}"))
        })?;
        header_map.insert(header_name, header_value);
    }
    Ok(header_map)
}

fn normalize_header_map(headers: &HeaderMap) -> BTreeMap<String, String> {
    headers
        .iter()
        .filter_map(|(k, v)| {
            v.to_str()
                .ok()
                .map(|value| (k.as_str().to_ascii_lowercase(), value.to_string()))
        })
        .collect()
}

fn map_reqwest_error(error: reqwest::Error) -> TransportError {
    if error.is_timeout() {
        return TransportError::timeout(format!("HTTP timeout: {error}"));
    }

    if error.is_builder() {
        return TransportError::invalid_request(format!("invalid HTTP request: {error}"));
    }

    if error.is_request() || error.is_connect() || error.is_body() {
        return TransportError::network(format!("network transport error: {error}"), true);
    }

    TransportError::new(
        TransportErrorCode::Internal,
        format!("unexpected reqwest error: {error}"),
        false,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_sensitive_headers() {
        let mut headers = BTreeMap::new();
        headers.insert("authorization".to_string(), "Bearer secret".to_string());
        headers.insert("x-api-key".to_string(), "key".to_string());
        headers.insert("cookie".to_string(), "session=secret".to_string());
        headers.insert("x-client-secret".to_string(), "shh".to_string());
        headers.insert("content-type".to_string(), "application/json".to_string());

        let redacted = redact_headers(&headers);
        assert_eq!(
            redacted.get("authorization").map(String::as_str),
            Some("<redacted>")
        );
        assert_eq!(
            redacted.get("x-api-key").map(String::as_str),
            Some("<redacted>")
        );
        assert_eq!(
            redacted.get("cookie").map(String::as_str),
            Some("<redacted>")
        );
        assert_eq!(
            redacted.get("x-client-secret").map(String::as_str),
            Some("<redacted>")
        );
        assert_eq!(
            redacted.get("content-type").map(String::as_str),
            Some("application/json")
        );
    }

    #[test]
    fn response_json_decode_returns_typed_error() {
        let response = TransportResponse {
            status: 200,
            headers: BTreeMap::new(),
            body: b"{invalid-json".to_vec(),
        };

        let err = response
            .json::<serde_json::Value>()
            .expect_err("decode should fail");
        assert_eq!(err.code, TransportErrorCode::ResponseDecodeFailed);
    }

    #[test]
    fn transport_request_correlation_context_round_trips_and_clones() {
        let request = TransportRequest::new(HttpMethod::Post, "https://example.test/upload")
            .with_log_correlation("release-123", "run-456");
        let cloned = request.clone();

        let wire = serde_json::to_value(&request).expect("serialize TransportRequest");
        assert_eq!(wire["log_correlation"]["release_id"], "release-123");
        assert_eq!(wire["log_correlation"]["run_id"], "run-456");

        let decoded: TransportRequest =
            serde_json::from_value(wire).expect("deserialize TransportRequest");
        let correlation = decoded
            .log_correlation
            .expect("correlation should deserialize");
        assert_eq!(correlation.release_id, "release-123");
        assert_eq!(correlation.run_id, "run-456");

        let cloned_correlation = cloned.log_correlation.expect("cloned correlation");
        assert_eq!(cloned_correlation.release_id, "release-123");
        assert_eq!(cloned_correlation.run_id, "run-456");
    }
}
