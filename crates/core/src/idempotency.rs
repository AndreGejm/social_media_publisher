#![cfg_attr(
    not(test),
    deny(clippy::expect_used, clippy::panic, clippy::unwrap_used)
)]

use crate::spec::ReleaseSpec;
use std::path::Path;

const RELEASE_ID_HASH_DOMAIN_V2: &str = "release-publisher.release-id.v2.blake3";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdempotencyKeys {
    pub spec_hash: String,
    pub media_fingerprint: String,
    pub release_id: String,
}

pub fn blake3_hex(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}

pub fn try_spec_hash(spec: &ReleaseSpec) -> Result<String, serde_json::Error> {
    // Use compact JSON (not pretty-printed output) to reduce serializer-format churn in hashes.
    let normalized = spec.normalized_json_compact()?;
    Ok(blake3_hex(normalized.as_bytes()))
}

pub fn media_fingerprint_from_bytes(bytes: &[u8]) -> String {
    blake3_hex(bytes)
}

pub async fn media_fingerprint_from_file(path: impl AsRef<Path>) -> anyhow::Result<String> {
    let bytes = tokio::fs::read(path).await?;
    Ok(media_fingerprint_from_bytes(&bytes))
}

pub fn try_compute_release_id(
    spec: &ReleaseSpec,
    media_fingerprint: &str,
) -> Result<String, serde_json::Error> {
    let spec_hash = try_spec_hash(spec)?;
    Ok(compute_release_id_from_parts(&spec_hash, media_fingerprint))
}

pub fn try_build_idempotency_keys(
    spec: &ReleaseSpec,
    media_bytes: &[u8],
) -> Result<IdempotencyKeys, serde_json::Error> {
    let media_fingerprint = media_fingerprint_from_bytes(media_bytes);
    let spec_hash = try_spec_hash(spec)?;
    let release_id = compute_release_id_from_parts(&spec_hash, &media_fingerprint);
    Ok(IdempotencyKeys {
        spec_hash,
        media_fingerprint,
        release_id,
    })
}

fn compute_release_id_from_parts(spec_hash: &str, media_fingerprint: &str) -> String {
    let mut material = String::with_capacity(
        RELEASE_ID_HASH_DOMAIN_V2.len() + spec_hash.len() + media_fingerprint.len() + 2,
    );
    material.push_str(RELEASE_ID_HASH_DOMAIN_V2);
    material.push('\n');
    material.push_str(spec_hash);
    material.push(':');
    material.push_str(media_fingerprint);
    blake3_hex(material.as_bytes())
}
