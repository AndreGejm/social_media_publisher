use proptest::prelude::*;
use release_publisher_core::spec::parse_release_spec_yaml;

fn yaml_escape(input: &str) -> String {
    input.replace('\\', "\\\\").replace('"', "\\\"")
}

proptest! {
    #[test]
    fn normalization_is_deterministic_for_equivalent_whitespace(
        title in "[A-Za-z0-9 ]{1,32}",
        artist in "[A-Za-z0-9 ]{1,32}",
        tag in "[A-Za-z0-9 ]{1,16}"
    ) {
        let title_trimmed = title.trim();
        let artist_trimmed = artist.trim();
        let tag_trimmed = tag.trim();

        prop_assume!(!title_trimmed.is_empty());
        prop_assume!(!artist_trimmed.is_empty());
        prop_assume!(!tag_trimmed.is_empty());

        let variant_a = format!(
            "title: \"{}\"\nartist: \"{}\"\ndescription: \"desc\"\ntags: [\"{}\"]\n",
            yaml_escape(&format!("  {title_trimmed}  ")),
            yaml_escape(artist_trimmed),
            yaml_escape(&format!(" {tag_trimmed} "))
        );

        let variant_b = format!(
            "title: \"{}\"\nartist: \"{}\"\ndescription: \"desc\"\ntags:\n  - \"{}\"\n  - \"{}\"\n",
            yaml_escape(&title_trimmed.split_whitespace().collect::<Vec<_>>().join("   ")),
            yaml_escape(&format!("  {}  ", artist_trimmed.split_whitespace().collect::<Vec<_>>().join("\t"))),
            yaml_escape(tag_trimmed),
            yaml_escape(&tag_trimmed.to_uppercase())
        );

        let spec_a = parse_release_spec_yaml(&variant_a).expect("variant a should parse");
        let spec_b = parse_release_spec_yaml(&variant_b).expect("variant b should parse");

        prop_assert_eq!(&spec_a, &spec_b);
        prop_assert_eq!(
            spec_a.normalized_json().expect("spec_a json"),
            spec_b.normalized_json().expect("spec_b json")
        );
    }
}
