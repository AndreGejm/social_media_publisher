use proptest::prelude::*;
use release_publisher_core::idempotency::try_build_idempotency_keys;
use release_publisher_core::spec::parse_release_spec_yaml;

fn yaml_escape(input: &str) -> String {
    input.replace('\\', "\\\\").replace('"', "\\\"")
}

proptest! {
    #[test]
    fn release_id_is_stable_for_semantically_equivalent_specs(
        title in "[A-Za-z0-9 ]{1,32}",
        artist in "[A-Za-z0-9 ]{1,32}",
        description in "[A-Za-z0-9 ]{1,64}",
        tag in "[A-Za-z0-9 ]{1,16}",
        media in prop::collection::vec(any::<u8>(), 1..64),
    ) {
        let t = title.trim();
        let a = artist.trim();
        let d = description.trim();
        let g = tag.trim();

        prop_assume!(!t.is_empty());
        prop_assume!(!a.is_empty());
        prop_assume!(!d.is_empty());
        prop_assume!(!g.is_empty());

        let spec_a_raw = format!(
            "title: \"{}\"\nartist: \"{}\"\ndescription: \"{}\"\ntags: [\"{}\"]\n",
            yaml_escape(&format!("  {t}  ")),
            yaml_escape(a),
            yaml_escape(&format!(" {d} ")),
            yaml_escape(&format!(" {g} "))
        );
        let spec_b_raw = format!(
            "title: \"{}\"\nartist: \"{}\"\ndescription: \"{}\"\ntags:\n  - \"{}\"\n  - \"{}\"\n",
            yaml_escape(&t.split_whitespace().collect::<Vec<_>>().join("   ")),
            yaml_escape(&format!("  {}  ", a.split_whitespace().collect::<Vec<_>>().join("\t"))),
            yaml_escape(&d.split_whitespace().collect::<Vec<_>>().join(" \n ")),
            yaml_escape(g),
            yaml_escape(&g.to_uppercase())
        );

        let spec_a = parse_release_spec_yaml(&spec_a_raw).expect("spec A parse");
        let spec_b = parse_release_spec_yaml(&spec_b_raw).expect("spec B parse");

        let keys_a = try_build_idempotency_keys(&spec_a, &media).expect("keys_a");
        let keys_b = try_build_idempotency_keys(&spec_b, &media).expect("keys_b");

        prop_assert_eq!(spec_a, spec_b);
        prop_assert_eq!(keys_a, keys_b);
    }
}
