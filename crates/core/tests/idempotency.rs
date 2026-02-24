use release_publisher_core::idempotency::{
    media_fingerprint_from_bytes, try_build_idempotency_keys, try_compute_release_id,
};
use release_publisher_core::spec::parse_release_spec_yaml;

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
fn idempotency_keys_include_consistent_hashes() {
    let spec = sample_spec("Track A");
    let keys_1 = try_build_idempotency_keys(&spec, b"same-media").expect("keys_1");
    let keys_2 = try_build_idempotency_keys(&spec, b"same-media").expect("keys_2");

    assert_eq!(keys_1, keys_2);
    assert_eq!(keys_1.media_fingerprint.len(), 64);
    assert_eq!(keys_1.spec_hash.len(), 64);
    assert_eq!(keys_1.release_id.len(), 64);
}
