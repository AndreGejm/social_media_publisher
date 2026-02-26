use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

const TAG_FIELD_NAME: &str = "tags";
const MAX_TAG_LEN_CHARS: usize = 32;
const MAX_TAG_COUNT: usize = 10;
const INTERNAL_INVARIANT_MESSAGE: &str = "internal validation invariant violated";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SpecErrorCode {
    YamlParse,
    MissingField,
    EmptyField,
    TooManyTags,
    TagTooLong,
    InternalInvariant,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SpecError {
    pub code: SpecErrorCode,
    pub field: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MockOptions {
    pub enabled: bool,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReleaseSpec {
    pub title: String,
    pub artist: String,
    pub description: String,
    pub tags: Vec<String>,
    pub mock: Option<MockOptions>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawMockOptions {
    enabled: Option<bool>,
    note: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawReleaseSpec {
    title: Option<String>,
    artist: Option<String>,
    description: Option<String>,
    tags: Option<Vec<String>>,
    mock: Option<RawMockOptions>,
}

impl ReleaseSpec {
    pub fn try_normalized_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }

    pub fn normalized_json(&self) -> Result<String, serde_json::Error> {
        self.try_normalized_json()
    }

    pub fn normalized_json_compact(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }
}

pub fn parse_release_spec_yaml(raw: &str) -> Result<ReleaseSpec, Vec<SpecError>> {
    let parsed = match serde_yaml::from_str::<RawReleaseSpec>(raw) {
        Ok(value) => value,
        Err(err) => {
            return Err(vec![SpecError {
                code: SpecErrorCode::YamlParse,
                field: None,
                message: err.to_string(),
            }]);
        }
    };

    normalize_and_validate(parsed)
}

fn normalize_and_validate(raw: RawReleaseSpec) -> Result<ReleaseSpec, Vec<SpecError>> {
    let mut errors = Vec::new();

    let title = normalize_required_text("title", raw.title, &mut errors);
    let artist = normalize_required_text("artist", raw.artist, &mut errors);
    let description = raw.description.map(normalize_text).unwrap_or_default();

    let tags = normalize_tags(raw.tags.unwrap_or_default(), &mut errors);

    let mock = raw.mock.map(|m| MockOptions {
        enabled: m.enabled.unwrap_or(true),
        note: m.note.map(normalize_text).filter(|s| !s.is_empty()),
    });

    if !errors.is_empty() {
        return Err(errors);
    }

    debug_assert!(
        title.is_some() && artist.is_some(),
        "normalize_required_text invariant violated: required fields missing without validation errors"
    );

    let (Some(title), Some(artist)) = (title, artist) else {
        return Err(vec![SpecError {
            code: SpecErrorCode::InternalInvariant,
            field: None,
            message: INTERNAL_INVARIANT_MESSAGE.to_string(),
        }]);
    };

    Ok(ReleaseSpec {
        title,
        artist,
        description,
        tags,
        mock,
    })
}

fn normalize_required_text(
    field: &str,
    value: Option<String>,
    errors: &mut Vec<SpecError>,
) -> Option<String> {
    match value {
        None => {
            errors.push(SpecError {
                code: SpecErrorCode::MissingField,
                field: Some(field.to_string()),
                message: format!("`{field}` is required"),
            });
            None
        }
        Some(v) => {
            let normalized = normalize_text(v);
            if normalized.is_empty() {
                errors.push(SpecError {
                    code: SpecErrorCode::EmptyField,
                    field: Some(field.to_string()),
                    message: format!("`{field}` cannot be empty"),
                });
                None
            } else {
                Some(normalized)
            }
        }
    }
}

fn normalize_tags(tags: Vec<String>, errors: &mut Vec<SpecError>) -> Vec<String> {
    let mut set = BTreeSet::new();

    for tag in tags {
        let normalized = normalize_text(tag).to_lowercase();
        if normalized.is_empty() {
            continue;
        }
        if normalized.len() > MAX_TAG_LEN_CHARS {
            errors.push(SpecError {
                code: SpecErrorCode::TagTooLong,
                field: Some(TAG_FIELD_NAME.to_string()),
                message: format!("tag exceeds {MAX_TAG_LEN_CHARS} chars: {normalized}"),
            });
            continue;
        }
        set.insert(normalized);
    }

    if set.len() > MAX_TAG_COUNT {
        errors.push(SpecError {
            code: SpecErrorCode::TooManyTags,
            field: Some(TAG_FIELD_NAME.to_string()),
            message: format!("no more than {MAX_TAG_COUNT} tags are allowed"),
        });
    }

    set.into_iter().take(MAX_TAG_COUNT).collect()
}

fn normalize_text(value: String) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_text_collapses_internal_whitespace() {
        assert_eq!(
            normalize_text("  Hello   world \n from\tRust ".to_string()),
            "Hello world from Rust"
        );
    }
}
