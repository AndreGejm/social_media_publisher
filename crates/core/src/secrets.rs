use std::collections::BTreeMap;
use std::fmt;
use std::sync::{Arc, RwLock};

#[derive(Clone, PartialEq, Eq)]
pub struct SecretValue(String);

impl SecretValue {
    pub fn new(value: impl Into<String>) -> Result<Self, SecretStoreError> {
        let value = value.into();
        if value.is_empty() {
            return Err(SecretStoreError::invalid_argument(
                "secret value must not be empty",
            ));
        }
        Ok(Self(value))
    }

    pub fn expose(&self) -> &str {
        &self.0
    }

    pub fn into_inner(self) -> String {
        self.0
    }
}

impl fmt::Debug for SecretValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SecretValue(<redacted>)")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecretRecord {
    pub key: String,
    pub value: SecretValue,
}

impl SecretRecord {
    pub fn new(key: impl Into<String>, value: SecretValue) -> Result<Self, SecretStoreError> {
        let key = validate_secret_key(key.into())?;
        Ok(Self { key, value })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SecretStoreErrorCode {
    InvalidArgument,
    NotFound,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, thiserror::Error)]
#[error("{message}")]
pub struct SecretStoreError {
    pub code: SecretStoreErrorCode,
    pub message: String,
}

impl SecretStoreError {
    pub fn new(code: SecretStoreErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn invalid_argument(message: impl Into<String>) -> Self {
        Self::new(SecretStoreErrorCode::InvalidArgument, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(SecretStoreErrorCode::NotFound, message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(SecretStoreErrorCode::Internal, message)
    }
}

pub trait SecretStore: Send + Sync {
    fn put(&self, record: SecretRecord) -> Result<(), SecretStoreError>;
    fn get(&self, key: &str) -> Result<SecretValue, SecretStoreError>;
    fn delete(&self, key: &str) -> Result<(), SecretStoreError>;
}

#[derive(Clone, Default)]
pub struct InMemorySecretStore {
    inner: Arc<RwLock<BTreeMap<String, SecretValue>>>,
}

impl InMemorySecretStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> Result<usize, SecretStoreError> {
        let map = self
            .inner
            .read()
            .map_err(|_| SecretStoreError::internal("secret store lock poisoned"))?;
        Ok(map.len())
    }

    pub fn is_empty(&self) -> Result<bool, SecretStoreError> {
        Ok(self.len()? == 0)
    }
}

impl fmt::Debug for InMemorySecretStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let len = self.len().unwrap_or(0);
        f.debug_struct("InMemorySecretStore")
            .field("count", &len)
            .finish()
    }
}

impl SecretStore for InMemorySecretStore {
    fn put(&self, record: SecretRecord) -> Result<(), SecretStoreError> {
        let mut map = self
            .inner
            .write()
            .map_err(|_| SecretStoreError::internal("secret store lock poisoned"))?;
        map.insert(record.key, record.value);
        Ok(())
    }

    fn get(&self, key: &str) -> Result<SecretValue, SecretStoreError> {
        let key = validate_secret_key(key.to_string())?;
        let map = self
            .inner
            .read()
            .map_err(|_| SecretStoreError::internal("secret store lock poisoned"))?;
        map.get(&key)
            .cloned()
            .ok_or_else(|| SecretStoreError::not_found(format!("secret not found for key `{key}`")))
    }

    fn delete(&self, key: &str) -> Result<(), SecretStoreError> {
        let key = validate_secret_key(key.to_string())?;
        let mut map = self
            .inner
            .write()
            .map_err(|_| SecretStoreError::internal("secret store lock poisoned"))?;
        if map.remove(&key).is_none() {
            return Err(SecretStoreError::not_found(format!(
                "secret not found for key `{key}`"
            )));
        }
        Ok(())
    }
}

fn validate_secret_key(key: String) -> Result<String, SecretStoreError> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err(SecretStoreError::invalid_argument(
            "secret key must not be empty",
        ));
    }
    if trimmed.len() > 128 {
        return Err(SecretStoreError::invalid_argument(
            "secret key must be at most 128 characters",
        ));
    }
    if key != trimmed {
        return Err(SecretStoreError::invalid_argument(
            "secret key must not have leading or trailing whitespace",
        ));
    }
    if !key
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.' | b':' | b'/'))
    {
        return Err(SecretStoreError::invalid_argument(
            "secret key contains unsupported characters",
        ));
    }
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::{
        InMemorySecretStore, SecretRecord, SecretStore, SecretStoreErrorCode, SecretValue,
    };

    #[test]
    fn in_memory_secret_store_put_get_delete_round_trip() {
        let store = InMemorySecretStore::new();
        assert!(store.is_empty().expect("initial empty"));
        let value = SecretValue::new("secret-token-123").expect("value");
        let record = SecretRecord::new("platform/mock/token", value.clone()).expect("record");

        store.put(record).expect("put");
        assert_eq!(store.len().expect("len after put"), 1);
        assert!(!store.is_empty().expect("non-empty after put"));

        let fetched = store.get("platform/mock/token").expect("get");
        assert_eq!(fetched, value);
        assert_eq!(fetched.expose(), "secret-token-123");

        store.delete("platform/mock/token").expect("delete");
        assert_eq!(store.len().expect("len after delete"), 0);
        assert!(store.is_empty().expect("empty after delete"));
    }

    #[test]
    fn in_memory_secret_store_returns_not_found_for_missing_key() {
        let store = InMemorySecretStore::new();

        let err = store
            .get("platform/mock/missing")
            .expect_err("missing key should error");
        assert_eq!(err.code, SecretStoreErrorCode::NotFound);

        let err = store
            .delete("platform/mock/missing")
            .expect_err("delete missing key should error");
        assert_eq!(err.code, SecretStoreErrorCode::NotFound);
    }

    #[test]
    fn secret_key_validation_rejects_invalid_inputs() {
        let store = InMemorySecretStore::new();
        let value = SecretValue::new("ok").expect("value");

        for key in ["", "  ", " bad", "bad ", "bad key", "bad\\key", "bad\nkey"] {
            let err =
                SecretRecord::new(key, value.clone()).expect_err("record key should be rejected");
            assert_eq!(err.code, SecretStoreErrorCode::InvalidArgument);
        }

        let err = store
            .get("bad key")
            .expect_err("get key should be rejected");
        assert_eq!(err.code, SecretStoreErrorCode::InvalidArgument);
    }

    #[test]
    fn secret_value_debug_is_redacted() {
        let value = SecretValue::new("super-secret").expect("value");
        let debug = format!("{value:?}");
        assert_eq!(debug, "SecretValue(<redacted>)");
        assert!(!debug.contains("super-secret"));
    }

    #[test]
    fn in_memory_store_debug_reports_count_only() {
        let store = InMemorySecretStore::new();
        store
            .put(
                SecretRecord::new(
                    "platform/mock/token",
                    SecretValue::new("super-secret").expect("value"),
                )
                .expect("record"),
            )
            .expect("put");

        let debug = format!("{store:?}");
        assert!(debug.contains("InMemorySecretStore"));
        assert!(debug.contains("count"));
        assert!(debug.contains("1"));
        assert!(!debug.contains("super-secret"));
    }

    #[test]
    fn secret_value_rejects_empty_values() {
        let err = SecretValue::new("").expect_err("empty value should be rejected");
        assert_eq!(err.code, SecretStoreErrorCode::InvalidArgument);
    }
}
