//! Domain models for release QC metadata persisted and exchanged over IPC.
//!
//! These constructors enforce basic audio/QC invariants early so downstream
//! pipeline stages and UI rendering can assume sane values.

#![cfg_attr(
    not(test),
    deny(clippy::expect_used, clippy::panic, clippy::unwrap_used)
)]

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Release {
    id: String,
    title: String,
    artist: String,
    tracks: Vec<Track>,
}

impl Release {
    /// Creates a validated [`Release`] and normalizes string fields by trimming whitespace.
    pub fn new(
        id: impl Into<String>,
        title: impl Into<String>,
        artist: impl Into<String>,
        tracks: Vec<Track>,
    ) -> Result<Self, ModelError> {
        let id = normalize_non_empty(id, "id")?;
        let title = normalize_non_empty(title, "title")?;
        let artist = normalize_non_empty(artist, "artist")?;

        Ok(Self {
            id,
            title,
            artist,
            tracks,
        })
    }

    /// Returns the stable release identifier.
    pub fn id(&self) -> &str {
        &self.id
    }

    /// Returns the human-readable release title.
    pub fn title(&self) -> &str {
        &self.title
    }

    /// Returns the primary artist name.
    pub fn artist(&self) -> &str {
        &self.artist
    }

    /// Returns the tracks belonging to the release.
    pub fn tracks(&self) -> &[Track] {
        &self.tracks
    }
}

/// A single analyzed audio track used by the QC UI and persistence layer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Track {
    file_path: String,
    duration_ms: u32,
    peak_data: Vec<f32>,
    loudness_lufs: f32,
}

impl Track {
    /// Creates a validated [`Track`].
    ///
    /// The constructor enforces:
    /// - `duration_ms > 0`
    /// - `peak_data` is non-empty and each value is finite and `<= 0.0 dBFS`
    /// - `loudness_lufs` is finite and `<= 0.0 LUFS`
    pub fn new(
        file_path: impl Into<String>,
        duration_ms: u32,
        peak_data: Vec<f32>,
        loudness_lufs: f32,
    ) -> Result<Self, ModelError> {
        let file_path = normalize_non_empty(file_path, "file_path")?;

        if duration_ms == 0 {
            return Err(ModelError::InvalidDurationMs);
        }

        if peak_data.is_empty() {
            return Err(ModelError::EmptyPeakData);
        }

        if let Some((index, value)) = peak_data
            .iter()
            .copied()
            .enumerate()
            .find(|(_, value)| !value.is_finite() || *value > 0.0)
        {
            return Err(ModelError::InvalidPeakValue { index, value });
        }

        if !loudness_lufs.is_finite() || loudness_lufs > 0.0 {
            return Err(ModelError::InvalidLoudnessLufs(loudness_lufs));
        }

        Ok(Self {
            file_path,
            duration_ms,
            peak_data,
            loudness_lufs,
        })
    }

    /// Returns the original source file path string as provided by the caller.
    pub fn file_path(&self) -> &str {
        &self.file_path
    }

    /// Returns the analyzed duration in milliseconds.
    pub fn duration_ms(&self) -> u32 {
        self.duration_ms
    }

    /// Returns the downsampled waveform peak bins in dBFS.
    pub fn peak_data(&self) -> &[f32] {
        &self.peak_data
    }

    /// Returns the integrated loudness in LUFS.
    pub fn loudness_lufs(&self) -> f32 {
        self.loudness_lufs
    }
}

/// Validation errors for [`Release`] and [`Track`] constructors.
#[derive(Debug, Error, Clone, PartialEq)]
pub enum ModelError {
    #[error("field `{field}` cannot be empty")]
    EmptyField { field: &'static str },
    #[error("track duration_ms must be > 0")]
    InvalidDurationMs,
    #[error("track peak_data must not be empty")]
    EmptyPeakData,
    #[error("track peak_data[{index}] must be finite and <= 0.0 dBFS (got {value})")]
    InvalidPeakValue { index: usize, value: f32 },
    #[error("track loudness_lufs must be finite and <= 0.0 LUFS (got {0})")]
    InvalidLoudnessLufs(f32),
}

/// Trims a string field and rejects empty values to prevent invalid identifiers/labels.
fn normalize_non_empty(
    value: impl Into<String>,
    field: &'static str,
) -> Result<String, ModelError> {
    let normalized = value.into().trim().to_string();
    if normalized.is_empty() {
        return Err(ModelError::EmptyField { field });
    }
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::{ModelError, Release, Track};

    #[test]
    fn track_new_accepts_valid_values() {
        let result = Track::new("C:/audio.wav", 1200, vec![-12.0, -6.0, 0.0], -14.2);
        assert!(result.is_ok());
    }

    #[test]
    fn track_new_rejects_invalid_values() {
        let invalid_duration = Track::new("C:/audio.wav", 0, vec![-1.0], -14.0);
        assert!(matches!(
            invalid_duration,
            Err(ModelError::InvalidDurationMs)
        ));

        let invalid_peak = Track::new("C:/audio.wav", 1000, vec![-1.0, 0.1], -14.0);
        assert!(matches!(
            invalid_peak,
            Err(ModelError::InvalidPeakValue { .. })
        ));

        let invalid_loudness = Track::new("C:/audio.wav", 1000, vec![-1.0], 0.1);
        assert!(matches!(
            invalid_loudness,
            Err(ModelError::InvalidLoudnessLufs(_))
        ));
    }

    #[test]
    fn release_new_normalizes_and_validates_text_fields() {
        let track = match Track::new("C:/audio.wav", 1000, vec![-1.0], -14.0) {
            Ok(track) => track,
            Err(error) => panic!("unexpected track error: {error}"),
        };
        let release = Release::new("  id-1  ", "  Song  ", "  Artist  ", vec![track]);

        match release {
            Ok(release) => {
                assert_eq!(release.id(), "id-1");
                assert_eq!(release.title(), "Song");
                assert_eq!(release.artist(), "Artist");
            }
            Err(error) => panic!("unexpected release error: {error}"),
        }
    }

    #[test]
    fn track_new_rejects_non_finite_audio_metrics() {
        let nan_peak = Track::new("C:/audio.wav", 1000, vec![-1.0, f32::NAN], -14.0);
        assert!(matches!(nan_peak, Err(ModelError::InvalidPeakValue { .. })));

        let inf_peak = Track::new("C:/audio.wav", 1000, vec![-1.0, f32::INFINITY], -14.0);
        assert!(matches!(inf_peak, Err(ModelError::InvalidPeakValue { .. })));

        let nan_loudness = Track::new("C:/audio.wav", 1000, vec![-1.0], f32::NAN);
        assert!(matches!(
            nan_loudness,
            Err(ModelError::InvalidLoudnessLufs(value)) if value.is_nan()
        ));
    }

    #[test]
    fn release_new_rejects_blank_text_fields_after_trim() {
        let track = match Track::new("C:/audio.wav", 1000, vec![-1.0], -14.0) {
            Ok(track) => track,
            Err(error) => panic!("unexpected track error: {error}"),
        };

        let invalid = Release::new("   ", "Song", "Artist", vec![track]);
        assert!(matches!(
            invalid,
            Err(ModelError::EmptyField { field: "id" })
        ));
    }
}
