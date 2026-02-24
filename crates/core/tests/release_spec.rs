use release_publisher_core::spec::{parse_release_spec_yaml, SpecErrorCode};

#[test]
fn parses_and_normalizes_valid_yaml() {
    let raw = r#"
title: "  Test Track  "
artist: " Example Artist "
description: "  Sample description for plan/preview.  "
tags:
  - "Synthwave"
  - " release "
  - "synthwave"
mock:
  enabled: true
  note: "  Use mock publisher only  "
"#;

    let spec = parse_release_spec_yaml(raw).expect("valid spec should parse");

    assert_eq!(spec.title, "Test Track");
    assert_eq!(spec.artist, "Example Artist");
    assert_eq!(spec.description, "Sample description for plan/preview.");
    assert_eq!(spec.tags, vec!["release", "synthwave"]);
    assert_eq!(
        spec.normalized_json().expect("normalized JSON"),
        include_str!("snapshots/release_spec_normalized.json").trim()
    );
}

#[test]
fn rejects_missing_required_fields_with_structured_errors() {
    let raw = r#"
artist: "Only Artist"
"#;

    let err = parse_release_spec_yaml(raw).expect_err("missing title should fail");
    assert!(err
        .iter()
        .any(|e| e.code == SpecErrorCode::MissingField && e.field.as_deref() == Some("title")));
}

#[test]
fn rejects_unknown_fields_as_yaml_parse_error() {
    let raw = r#"
title: "Known"
artist: "Artist"
unknown_field: true
"#;

    let err = parse_release_spec_yaml(raw).expect_err("unknown field should fail");
    assert_eq!(err.len(), 1);
    assert_eq!(err[0].code, SpecErrorCode::YamlParse);
}

#[test]
fn fuzz_like_malformed_yaml_inputs_do_not_panic() {
    let cases = [
        "",
        ":::",
        "{ title: [1,2",
        "title: 123\nartist: true",
        "title:\n  - list\nartist: x",
        "---\n- not\n- a\n- mapping",
        "title: ok\nartist: ok\ntags: [\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"]",
    ];

    for raw in cases {
        let result = parse_release_spec_yaml(raw);
        if let Err(errors) = result {
            assert!(
                !errors.is_empty(),
                "parser errors should be structured and non-empty"
            );
            assert!(
                errors
                    .iter()
                    .all(|e| e.code != SpecErrorCode::InternalInvariant),
                "fuzz-like input should not trigger internal invariant errors"
            );
        }
    }
}
