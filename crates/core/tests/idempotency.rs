use release_publisher_core::idempotency::{
    blake3_hex, media_fingerprint_from_bytes, try_build_idempotency_keys, try_compute_release_id,
    try_spec_hash,
};
use release_publisher_core::spec::parse_release_spec_yaml;
use std::collections::HashMap;

const RELEASE_ID_HASH_DOMAIN_V2: &str = "release-publisher.release-id.v2.blake3";

fn sample_spec(title: &str) -> release_publisher_core::spec::ReleaseSpec {
    let raw = format!(
        r#"
title: "{title}"
artist: "Example Artist"
description: "Example description"
tags: ["alpha", "beta"]
"#
    );
    parse_release_spec_yaml(&raw).expect("sample spec should parse")
}

fn flip_one_bit(bytes: &[u8], byte_index: usize, bit_index: u8) -> Vec<u8> {
    let mut mutated = bytes.to_vec();
    if byte_index < mutated.len() && bit_index < 8 {
        mutated[byte_index] ^= 1u8 << bit_index;
    }
    mutated
}

#[test]
fn media_fingerprint_uses_blake3_of_raw_audio_bytes() {
    let media = b"synthetic-audio-bytes";
    let expected = blake3::hash(media).to_hex().to_string();
    let actual = media_fingerprint_from_bytes(media);

    assert_eq!(actual, expected);
    assert_eq!(actual.len(), 64);
    assert!(actual
        .chars()
        .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
}

#[test]
fn spec_hash_uses_blake3_of_normalized_compact_json() {
    let spec = sample_spec("Track A");
    let normalized = spec.normalized_json_compact().expect("normalized spec");

    let expected = blake3::hash(normalized.as_bytes()).to_hex().to_string();
    let actual = try_spec_hash(&spec).expect("spec hash");

    assert_eq!(actual, expected);
}

#[test]
fn release_id_is_deterministic_for_same_spec_and_media() {
    let spec = sample_spec("Track A");
    let media = b"fake-media-binary";
    let media_fingerprint = media_fingerprint_from_bytes(media);

    let a = try_compute_release_id(&spec, &media_fingerprint).expect("a");
    let b = try_compute_release_id(&spec, &media_fingerprint).expect("b");

    assert_eq!(a, b);
}

#[test]
fn release_id_uses_domain_separated_blake3_material() {
    let spec = sample_spec("Track A");
    let media_fingerprint = media_fingerprint_from_bytes(b"fake-media-binary");
    let spec_hash = try_spec_hash(&spec).expect("spec hash");

    let material = format!("{RELEASE_ID_HASH_DOMAIN_V2}\n{spec_hash}:{media_fingerprint}");
    let expected = blake3::hash(material.as_bytes()).to_hex().to_string();
    let actual = try_compute_release_id(&spec, &media_fingerprint).expect("release id");

    assert_eq!(actual, expected);
}

#[test]
fn release_id_changes_when_spec_changes() {
    let spec_a = sample_spec("Track A");
    let spec_b = sample_spec("Track B");
    let media_fingerprint = media_fingerprint_from_bytes(b"fake-media-binary");

    assert_ne!(
        try_compute_release_id(&spec_a, &media_fingerprint).expect("a"),
        try_compute_release_id(&spec_b, &media_fingerprint).expect("b")
    );
}

#[test]
fn release_id_changes_when_media_changes() {
    let spec = sample_spec("Track A");
    let media_a = media_fingerprint_from_bytes(b"media-a");
    let media_b = media_fingerprint_from_bytes(b"media-b");

    assert_ne!(
        try_compute_release_id(&spec, &media_a).expect("media_a"),
        try_compute_release_id(&spec, &media_b).expect("media_b")
    );
}

#[test]
fn release_id_changes_when_domain_version_material_changes() {
    let spec = sample_spec("Track A");
    let media_fingerprint = media_fingerprint_from_bytes(b"fake-media-binary");
    let spec_hash = try_spec_hash(&spec).expect("spec hash");

    let v2 = try_compute_release_id(&spec, &media_fingerprint).expect("v2");
    let legacy_material =
        format!("release-publisher.release-id.v1\n{spec_hash}:{media_fingerprint}");
    let legacy_like = blake3::hash(legacy_material.as_bytes())
        .to_hex()
        .to_string();

    assert_ne!(v2, legacy_like);
}

#[test]
fn idempotency_keys_include_consistent_hashes() {
    let spec = sample_spec("Track A");
    let keys_1 = try_build_idempotency_keys(&spec, b"same-media").expect("keys_1");
    let keys_2 = try_build_idempotency_keys(&spec, b"same-media").expect("keys_2");

    assert_eq!(keys_1, keys_2);
    assert_eq!(keys_1.media_fingerprint.len(), 64);
    assert_eq!(keys_1.spec_hash.len(), 64);
    assert_eq!(keys_1.release_id.len(), 64);
}

#[test]
fn single_bit_media_mutation_produces_new_identity_and_prevents_overwrite_collision() {
    let spec = sample_spec("Track A");
    let media = b"audio-payload-0001".to_vec();
    let mutated_media = flip_one_bit(&media, 3, 0);

    let media_a = media_fingerprint_from_bytes(&media);
    let media_b = media_fingerprint_from_bytes(&mutated_media);
    assert_ne!(
        media_a, media_b,
        "1-bit audio mutation must change media fingerprint"
    );

    let release_a = try_compute_release_id(&spec, &media_a).expect("release_a");
    let release_b = try_compute_release_id(&spec, &media_b).expect("release_b");
    assert_ne!(
        release_a, release_b,
        "1-bit audio mutation must change release_id"
    );

    // Simulate a content-addressed store keyed by release_id: the mutated payload must not overwrite.
    let mut store: HashMap<String, String> = HashMap::new();
    assert!(store.insert(release_a.clone(), media_a.clone()).is_none());
    assert!(store.insert(release_b.clone(), media_b.clone()).is_none());
    assert_eq!(store.len(), 2);
    assert_eq!(store.get(&release_a), Some(&media_a));
    assert_eq!(store.get(&release_b), Some(&media_b));
}

#[test]
fn single_bit_json_metadata_mutation_produces_new_hash_and_release_id() {
    let spec_upper = sample_spec("Track A");
    let spec_lower = sample_spec("Track a"); // ASCII A (0x41) -> a (0x61) is a 1-bit flip (0x20).
    let media_fingerprint = media_fingerprint_from_bytes(b"stable-audio");

    let json_upper = spec_upper.normalized_json_compact().expect("json_upper");
    let json_upper_bytes = json_upper.as_bytes();
    let mutation_index = json_upper
        .find("Track A")
        .map(|offset| offset + "Track ".len())
        .expect("normalized JSON should contain title text");
    let json_mutated = flip_one_bit(json_upper_bytes, mutation_index, 5);

    let raw_json_hash_upper = blake3_hex(json_upper_bytes);
    let raw_json_hash_mutated = blake3_hex(&json_mutated);
    assert_ne!(
        raw_json_hash_upper, raw_json_hash_mutated,
        "1-bit JSON mutation must change the metadata hash material"
    );

    let spec_hash_upper = try_spec_hash(&spec_upper).expect("spec_hash_upper");
    let spec_hash_lower = try_spec_hash(&spec_lower).expect("spec_hash_lower");
    assert_ne!(spec_hash_upper, spec_hash_lower);

    let release_upper =
        try_compute_release_id(&spec_upper, &media_fingerprint).expect("release_upper");
    let release_lower =
        try_compute_release_id(&spec_lower, &media_fingerprint).expect("release_lower");
    assert_ne!(release_upper, release_lower);
}
