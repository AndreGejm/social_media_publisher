//! Native audio decoding and QC analysis helpers.
//!
//! This module intentionally stays pure and Tauri-free so it can be tested in
//! isolation with synthetic sample buffers and hostile/corrupt file fixtures.

#![cfg_attr(
    not(test),
    deny(clippy::expect_used, clippy::panic, clippy::unwrap_used)
)]

use ebur128::{EbuR128, Mode};
use std::fs::File;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use thiserror::Error;

const DEFAULT_TARGET_PEAK_BINS: usize = 2_048;
const DEFAULT_DBFS_FLOOR: f32 = -96.0;
/// Accept tiny positive LUFS values from floating-point noise and clamp to `0.0`.
const LOUDNESS_POSITIVE_EPSILON: f32 = 1e-6;
/// True-peak threshold above which a track is considered clipping (inclusive).
const TRUE_PEAK_CLIPPING_DBFS: f32 = -0.5;
const NO_DECODABLE_PACKETS_MSG: &str = "no decodable audio packets were produced";

/// Computed QC metrics for a decoded track.
#[derive(Debug, Clone, PartialEq)]
pub struct TrackAnalysis {
    /// Total decoded duration in milliseconds.
    pub duration_ms: u32,
    /// Downsampled waveform peak bins in dBFS for fast UI rendering/seek previews.
    pub peak_data: Vec<f32>,
    /// Integrated loudness (EBU R128) in LUFS.
    pub loudness_lufs: f32,
    /// Maximum true peak across channels in dBFS-equivalent scale (clamped to `<= 0.0`).
    pub true_peak_dbfs: f32,
    /// Whether any channel's true peak meets or exceeds the clipping threshold (-0.5 dBFS).
    pub is_clipping: bool,
    /// Decoded sample rate.
    pub sample_rate_hz: u32,
    /// Decoded channel count.
    pub channels: u16,
}

/// Raw decoded PCM data produced by [`decode_audio_file`].
#[derive(Debug, Clone, PartialEq)]
pub struct DecodedAudio {
    /// Decoded sample rate.
    pub sample_rate_hz: u32,
    /// Decoded channel count.
    pub channels: u16,
    /// Interleaved `f32` PCM samples normalized to the decoder's output range.
    pub interleaved_samples: Vec<f32>,
}

/// Errors emitted by decode and analysis helpers.
#[derive(Debug, Error)]
pub enum AudioError {
    #[error("failed to open audio file `{path}`: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("invalid audio input: {0}")]
    InvalidInput(String),
    #[error("unsupported audio file: {0}")]
    Unsupported(String),
    #[error("audio decode failed: {0}")]
    Decode(String),
    #[error("audio analysis failed: {0}")]
    Analysis(String),
}

/// Internal knobs for deterministic peak extraction during analysis/tests.
#[derive(Debug, Clone, Copy)]
struct AnalysisConfig {
    target_peak_bins: usize,
    dbfs_floor: f32,
}

impl Default for AnalysisConfig {
    fn default() -> Self {
        Self {
            target_peak_bins: DEFAULT_TARGET_PEAK_BINS,
            dbfs_floor: DEFAULT_DBFS_FLOOR,
        }
    }
}

/// Decodes and analyzes a track file into duration, waveform peaks and loudness.
///
/// This composes [`decode_audio_file`] and [`analyze_interleaved_samples`] so
/// callers get a single error-returning entry point for file-based analysis.
pub fn analyze_track(file_path: impl AsRef<Path>) -> Result<TrackAnalysis, AudioError> {
    let decoded = decode_audio_file(file_path)?;
    analyze_interleaved_samples(
        &decoded.interleaved_samples,
        decoded.sample_rate_hz,
        decoded.channels,
    )
}

/// Decodes an audio file into interleaved `f32` PCM samples using `symphonia`.
///
/// The decoder rejects variable-rate/channel streams to keep downstream QC
/// analysis deterministic and simple.
pub fn decode_audio_file(file_path: impl AsRef<Path>) -> Result<DecodedAudio, AudioError> {
    let file_path = file_path.as_ref();
    let file = File::open(file_path).map_err(|source| AudioError::Io {
        path: file_path.to_path_buf(),
        source,
    })?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = file_path.extension().and_then(|ext| ext.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|error| AudioError::Unsupported(format!("{error}")))?;

    let mut format = probed.format;
    let (track_id, codec_params) = {
        let track = format
            .default_track()
            .ok_or_else(|| AudioError::Unsupported("no default audio track found".to_string()))?;
        (track.id, track.codec_params.clone())
    };

    let mut decoder = symphonia::default::get_codecs()
        .make(&codec_params, &DecoderOptions::default())
        .map_err(|error| AudioError::Decode(format!("failed to create decoder: {error}")))?;

    let mut interleaved_samples = Vec::<f32>::new();
    let mut sample_rate_hz: Option<u32> = None;
    let mut channels: Option<u16> = None;

    loop {
        let packet =
            match format.next_packet() {
                Ok(packet) => packet,
                Err(SymphoniaError::IoError(error)) if error.kind() == ErrorKind::UnexpectedEof => {
                    break;
                }
                Err(SymphoniaError::ResetRequired) => return Err(AudioError::Decode(
                    "stream reset required during demux; dynamic stream changes are not supported"
                        .to_string(),
                )),
                Err(error) => {
                    return Err(AudioError::Decode(format!(
                        "failed to read demux packet: {error}"
                    )))
                }
            };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(SymphoniaError::DecodeError(_)) => {
                // Skip corrupt frames and continue decoding remaining packets.
                continue;
            }
            Err(SymphoniaError::IoError(error)) if error.kind() == ErrorKind::UnexpectedEof => {
                break;
            }
            Err(SymphoniaError::ResetRequired) => {
                return Err(AudioError::Decode(
                    "decoder reset required; mid-stream format changes are not supported"
                        .to_string(),
                ))
            }
            Err(error) => return Err(AudioError::Decode(format!("decoder error: {error}"))),
        };

        let spec = *decoded.spec();
        if spec.rate == 0 {
            return Err(AudioError::Decode(
                "decoded packet reported sample rate 0".to_string(),
            ));
        }

        let channel_count = spec.channels.count();
        let channel_count_u16 = u16::try_from(channel_count).map_err(|_| {
            AudioError::Decode(format!(
                "channel count {channel_count} exceeds supported range"
            ))
        })?;
        if channel_count_u16 == 0 {
            return Err(AudioError::Decode(
                "decoded packet reported zero channels".to_string(),
            ));
        }

        match sample_rate_hz {
            None => sample_rate_hz = Some(spec.rate),
            Some(rate) if rate != spec.rate => {
                return Err(AudioError::Decode(format!(
                    "variable sample rate stream is not supported ({rate} -> {})",
                    spec.rate
                )))
            }
            Some(_) => {}
        }

        match channels {
            None => channels = Some(channel_count_u16),
            Some(existing) if existing != channel_count_u16 => {
                return Err(AudioError::Decode(format!(
                    "variable channel-count stream is not supported ({existing} -> {channel_count_u16})"
                )))
            }
            Some(_) => {}
        }

        let mut sample_buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
        sample_buf.copy_interleaved_ref(decoded);
        interleaved_samples.extend_from_slice(sample_buf.samples());
    }

    let (sample_rate_hz, channels) = match (sample_rate_hz, channels) {
        (Some(sample_rate_hz), Some(channels)) => (sample_rate_hz, channels),
        _ => return Err(AudioError::Decode(NO_DECODABLE_PACKETS_MSG.to_string())),
    };

    if interleaved_samples.is_empty() {
        return Err(AudioError::Decode(
            "decoded audio contained zero samples".to_string(),
        ));
    }
    if !interleaved_samples
        .len()
        .is_multiple_of(usize::from(channels))
    {
        return Err(AudioError::Decode(
            "decoded sample buffer is not aligned to channel count".to_string(),
        ));
    }
    if interleaved_samples.iter().any(|sample| !sample.is_finite()) {
        return Err(AudioError::Decode(
            "decoded samples contain non-finite values".to_string(),
        ));
    }

    Ok(DecodedAudio {
        sample_rate_hz,
        channels,
        interleaved_samples,
    })
}

/// Computes QC metrics from an already-decoded interleaved PCM buffer.
///
/// This is the preferred entry point for unit tests and any future in-memory
/// decode pipeline because it avoids file I/O.
pub fn analyze_interleaved_samples(
    interleaved_samples: &[f32],
    sample_rate_hz: u32,
    channels: u16,
) -> Result<TrackAnalysis, AudioError> {
    analyze_interleaved_samples_with_config(
        interleaved_samples,
        sample_rate_hz,
        channels,
        AnalysisConfig::default(),
    )
}

/// Shared analyzer implementation with configurable peak downsampling settings.
fn analyze_interleaved_samples_with_config(
    interleaved_samples: &[f32],
    sample_rate_hz: u32,
    channels: u16,
    config: AnalysisConfig,
) -> Result<TrackAnalysis, AudioError> {
    validate_analysis_input(interleaved_samples, sample_rate_hz, channels, config)?;

    let channels_usize = usize::from(channels);
    let total_frames = interleaved_samples.len() / channels_usize;
    let duration_ms = duration_ms_from_frames(total_frames, sample_rate_hz)?;
    let peak_data = compute_peak_data_dbfs(
        interleaved_samples,
        channels_usize,
        config.target_peak_bins,
        config.dbfs_floor,
    )?;
    // Single EBU R128 pass for both integrated LUFS and true peak.
    let (loudness_lufs, true_peak_linear) =
        compute_loudness_and_true_peak_from_chunks(
            std::iter::once(Ok(interleaved_samples)),
            sample_rate_hz,
            channels,
        )?;
    let true_peak_dbfs = amplitude_to_dbfs(true_peak_linear as f32, config.dbfs_floor);
    let is_clipping = true_peak_dbfs >= TRUE_PEAK_CLIPPING_DBFS;

    Ok(TrackAnalysis {
        duration_ms,
        peak_data,
        loudness_lufs,
        true_peak_dbfs,
        is_clipping,
        sample_rate_hz,
        channels,
    })
}

/// Validates analysis inputs before expensive DSP/loudness work begins.
fn validate_analysis_input(
    interleaved_samples: &[f32],
    sample_rate_hz: u32,
    channels: u16,
    config: AnalysisConfig,
) -> Result<(), AudioError> {
    if sample_rate_hz == 0 {
        return Err(AudioError::InvalidInput(
            "sample_rate_hz must be > 0".to_string(),
        ));
    }
    if channels == 0 {
        return Err(AudioError::InvalidInput("channels must be > 0".to_string()));
    }
    if interleaved_samples.is_empty() {
        return Err(AudioError::InvalidInput(
            "interleaved_samples must not be empty".to_string(),
        ));
    }
    if !interleaved_samples
        .len()
        .is_multiple_of(usize::from(channels))
    {
        return Err(AudioError::InvalidInput(
            "interleaved_samples length must be divisible by channels".to_string(),
        ));
    }
    if interleaved_samples.iter().any(|value| !value.is_finite()) {
        return Err(AudioError::InvalidInput(
            "interleaved_samples must contain only finite values".to_string(),
        ));
    }
    if config.target_peak_bins == 0 {
        return Err(AudioError::InvalidInput(
            "target_peak_bins must be > 0".to_string(),
        ));
    }
    if !config.dbfs_floor.is_finite() || config.dbfs_floor > 0.0 {
        return Err(AudioError::InvalidInput(
            "dbfs_floor must be finite and <= 0.0".to_string(),
        ));
    }
    Ok(())
}

/// Converts frame count and sample rate into a bounded, non-zero millisecond duration.
fn duration_ms_from_frames(total_frames: usize, sample_rate_hz: u32) -> Result<u32, AudioError> {
    if total_frames == 0 {
        return Err(AudioError::Analysis(
            "cannot compute duration for zero frames".to_string(),
        ));
    }
    let millis = ((total_frames as u128) * 1_000u128) / u128::from(sample_rate_hz);
    let duration_ms = u32::try_from(millis).map_err(|_| {
        AudioError::Analysis("audio duration exceeds u32::MAX milliseconds".to_string())
    })?;
    if duration_ms == 0 {
        return Err(AudioError::Analysis(
            "audio duration rounded to 0 ms; provide more than one frame of audio".to_string(),
        ));
    }
    Ok(duration_ms)
}

/// Computes EBU R128 integrated loudness and maximum true peak in a **single pass**
/// over the sample buffer, using `Mode::I | Mode::SAMPLE_PEAK | Mode::TRUE_PEAK`.
///
/// Returns `(loudness_lufs, max_true_peak_linear)` where `max_true_peak_linear` is the
/// maximum linear true-peak value across all channels (raw, not converted to dBFS).
/// The caller is responsible for converting to dBFS via [`amplitude_to_dbfs`].
fn compute_loudness_and_true_peak_from_chunks<T, I>(
    chunks: I,
    sample_rate_hz: u32,
    channels: u16,
) -> Result<(f32, f64), AudioError>
where
    T: AsRef<[f32]>,
    I: IntoIterator<Item = Result<T, AudioError>>,
{
    if sample_rate_hz == 0 {
        return Err(AudioError::Analysis(
            "ebur128 sample_rate_hz must be > 0".to_string(),
        ));
    }
    if channels == 0 {
        return Err(AudioError::Analysis(
            "ebur128 channels must be > 0".to_string(),
        ));
    }

    // Single meter for both integrated loudness and true peak.
    let mode = Mode::I | Mode::SAMPLE_PEAK | Mode::TRUE_PEAK;
    let mut meter = EbuR128::new(u32::from(channels), sample_rate_hz, mode)
        .map_err(|error| AudioError::Analysis(format!("ebur128 init failed: {error}")))?;
    let channels_usize = usize::from(channels);
    let mut any_frames = false;

    for chunk in chunks {
        let chunk = chunk?;
        let chunk = chunk.as_ref();
        if chunk.is_empty() {
            continue;
        }
        if chunk.len() % channels_usize != 0 {
            return Err(AudioError::Analysis(
                "ebur128 chunk length must be divisible by channels".to_string(),
            ));
        }
        if chunk.iter().any(|sample| !sample.is_finite()) {
            return Err(AudioError::Analysis(
                "ebur128 chunk contains non-finite samples".to_string(),
            ));
        }

        meter.add_frames_f32(chunk).map_err(|error| {
            AudioError::Analysis(format!("ebur128 add_frames_f32 failed: {error}"))
        })?;
        any_frames = true;
    }

    if !any_frames {
        return Err(AudioError::Analysis(
            "ebur128 received zero frames".to_string(),
        ));
    }

    let loudness = meter
        .loudness_global()
        .map_err(|error| AudioError::Analysis(format!("ebur128 loudness_global failed: {error}")))?
        as f32;

    if !loudness.is_finite() {
        return Err(AudioError::Analysis(
            "integrated loudness is not finite".to_string(),
        ));
    }
    let loudness = if loudness > 0.0 && loudness <= LOUDNESS_POSITIVE_EPSILON {
        0.0
    } else if loudness > 0.0 {
        return Err(AudioError::Analysis(format!(
            "integrated loudness must be <= 0.0 LUFS (got {loudness})"
        )));
    } else {
        loudness
    };

    let mut max_true_peak_linear = 0.0f64;
    for channel_idx in 0..u32::from(channels) {
        let peak_linear = meter.true_peak(channel_idx).map_err(|error| {
            AudioError::Analysis(format!(
                "ebur128 true_peak failed for channel {channel_idx}: {error}"
            ))
        })?;
        if !peak_linear.is_finite() || peak_linear < 0.0 {
            return Err(AudioError::Analysis(
                "ebur128 true peak is not a finite non-negative value".to_string(),
            ));
        }
        if peak_linear > max_true_peak_linear {
            max_true_peak_linear = peak_linear;
        }
    }

    Ok((loudness, max_true_peak_linear))
}

/// Computes integrated LUFS from a stream of interleaved chunks.
///
/// This is the public streaming entry point used for fault-injection tests
/// (mid-stream I/O failures). True peak is computed internally but discarded;
/// use [`analyze_interleaved_samples`] to obtain both metrics in a single pass.
// Only called from #[cfg(test)] — suppress dead_code in release builds.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn compute_integrated_lufs_from_chunks<T, I>(
    chunks: I,
    sample_rate_hz: u32,
    channels: u16,
) -> Result<f32, AudioError>
where
    T: AsRef<[f32]>,
    I: IntoIterator<Item = Result<T, AudioError>>,
{
    let (loudness, _true_peak_linear) =
        compute_loudness_and_true_peak_from_chunks(chunks, sample_rate_hz, channels)?;
    Ok(loudness)
}

/// Extracts a fixed-size dBFS peak envelope by taking max absolute sample per bin.
///
/// Each bin spans a contiguous frame window and considers all channels to make
/// the UI waveform safe for quick visual inspection.
fn compute_peak_data_dbfs(
    interleaved_samples: &[f32],
    channels: usize,
    target_peak_bins: usize,
    dbfs_floor: f32,
) -> Result<Vec<f32>, AudioError> {
    if channels == 0 {
        return Err(AudioError::InvalidInput("channels must be > 0".to_string()));
    }
    if target_peak_bins == 0 {
        return Err(AudioError::InvalidInput(
            "target_peak_bins must be > 0".to_string(),
        ));
    }
    if !interleaved_samples.len().is_multiple_of(channels) {
        return Err(AudioError::InvalidInput(
            "interleaved_samples length must be divisible by channels".to_string(),
        ));
    }

    let total_frames = interleaved_samples.len() / channels;
    if total_frames == 0 {
        return Err(AudioError::InvalidInput(
            "interleaved_samples must not be empty".to_string(),
        ));
    }

    let bins = total_frames.min(target_peak_bins).max(1);
    let frames_per_bin = total_frames.div_ceil(bins);

    let mut peaks = Vec::with_capacity(bins);
    for bin_index in 0..bins {
        let frame_start = bin_index * frames_per_bin;
        if frame_start >= total_frames {
            break;
        }
        let frame_end = ((bin_index + 1) * frames_per_bin).min(total_frames);
        let mut max_abs = 0.0f32;

        for frame in frame_start..frame_end {
            let base = frame * channels;
            for sample in &interleaved_samples[base..base + channels] {
                let abs = sample.abs();
                if abs > max_abs {
                    max_abs = abs;
                }
            }
        }

        peaks.push(amplitude_to_dbfs(max_abs, dbfs_floor));
    }

    if peaks.is_empty() {
        return Err(AudioError::Analysis(
            "peak extraction produced no bins".to_string(),
        ));
    }

    Ok(peaks)
}

/// Converts a linear amplitude to dBFS and clamps it to a configured floor.
fn amplitude_to_dbfs(amplitude: f32, dbfs_floor: f32) -> f32 {
    let floor = if dbfs_floor.is_finite() && dbfs_floor <= 0.0 {
        dbfs_floor
    } else {
        DEFAULT_DBFS_FLOOR
    };
    let min_linear = 10f32.powf(floor / 20.0);

    let normalized = if amplitude.is_finite() {
        amplitude.abs()
    } else {
        0.0
    };
    let clamped_linear = normalized.clamp(min_linear, 1.0);
    let dbfs = 20.0 * clamped_linear.log10();
    if dbfs > 0.0 {
        0.0
    } else {
        dbfs.max(floor)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        amplitude_to_dbfs, analyze_interleaved_samples, analyze_interleaved_samples_with_config,
        compute_integrated_lufs_from_chunks, compute_peak_data_dbfs, decode_audio_file,
        AnalysisConfig, AudioError, TRUE_PEAK_CLIPPING_DBFS,
    };
    use std::f32::consts::TAU;
    use std::fs::{self, File};
    use std::io::Write;
    use std::panic;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    const TEST_SAMPLE_RATE: u32 = 48_000;
    const TEST_CHANNELS_MONO: u16 = 1;
    const TEST_SECONDS: f32 = 4.0;
    static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

    struct TempTestFile {
        path: PathBuf,
    }

    impl TempTestFile {
        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempTestFile {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.path);
        }
    }

    fn create_temp_file_with_bytes(extension: &str, bytes: &[u8]) -> TempTestFile {
        let mut path = std::env::temp_dir();
        let ts = match SystemTime::now().duration_since(UNIX_EPOCH) {
            Ok(duration) => duration.as_nanos(),
            Err(error) => panic!("system clock error creating temp file name: {error}"),
        };
        let seq = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let ext = extension.trim_start_matches('.');
        path.push(format!(
            "release_publisher_audio_test_{}_{}_{}.{}",
            std::process::id(),
            ts,
            seq,
            ext
        ));

        let mut file = match File::create(&path) {
            Ok(file) => file,
            Err(error) => panic!(
                "failed to create temp test file `{}`: {error}",
                path.display()
            ),
        };
        if let Err(error) = file.write_all(bytes) {
            panic!(
                "failed to write temp test file `{}`: {error}",
                path.display()
            );
        }
        if let Err(error) = file.flush() {
            panic!(
                "failed to flush temp test file `{}`: {error}",
                path.display()
            );
        }

        TempTestFile { path }
    }

    fn append_u16_le(out: &mut Vec<u8>, value: u16) {
        out.extend_from_slice(&value.to_le_bytes());
    }

    fn append_u32_le(out: &mut Vec<u8>, value: u32) {
        out.extend_from_slice(&value.to_le_bytes());
    }

    fn pcm_s16_wav_bytes(samples: &[i16], sample_rate_hz: u32, channels: u16) -> Vec<u8> {
        wav_bytes_with_format_tag(0x0001, samples, sample_rate_hz, channels)
    }

    fn wav_bytes_with_format_tag(
        format_tag: u16,
        samples: &[i16],
        sample_rate_hz: u32,
        channels: u16,
    ) -> Vec<u8> {
        let bytes_per_sample: u16 = 2;
        let bits_per_sample: u16 = 16;
        let block_align = channels.saturating_mul(bytes_per_sample);
        let byte_rate = sample_rate_hz.saturating_mul(u32::from(block_align));
        let data_len_u32 = match u32::try_from(samples.len().saturating_mul(2)) {
            Ok(v) => v,
            Err(error) => panic!("sample payload too large for test WAV: {error}"),
        };
        let riff_size = 4u32 + (8 + 16) + (8 + data_len_u32);

        let mut out = Vec::with_capacity((riff_size as usize) + 8);
        out.extend_from_slice(b"RIFF");
        append_u32_le(&mut out, riff_size);
        out.extend_from_slice(b"WAVE");

        out.extend_from_slice(b"fmt ");
        append_u32_le(&mut out, 16);
        append_u16_le(&mut out, format_tag);
        append_u16_le(&mut out, channels);
        append_u32_le(&mut out, sample_rate_hz);
        append_u32_le(&mut out, byte_rate);
        append_u16_le(&mut out, block_align);
        append_u16_le(&mut out, bits_per_sample);

        out.extend_from_slice(b"data");
        append_u32_le(&mut out, data_len_u32);
        for sample in samples {
            append_u16_le(&mut out, *sample as u16);
        }

        out
    }

    fn flip_single_bit(mut bytes: Vec<u8>, byte_index: usize, bit_index: u8) -> Vec<u8> {
        if byte_index >= bytes.len() || bit_index > 7 {
            return bytes;
        }
        bytes[byte_index] ^= 1u8 << bit_index;
        bytes
    }

    fn assert_decode_fails_without_panic(path: &Path) {
        let result = panic::catch_unwind(|| decode_audio_file(path));
        match result {
            Ok(Err(AudioError::Unsupported(_)))
            | Ok(Err(AudioError::Decode(_)))
            | Ok(Err(AudioError::Io { .. })) => {}
            Ok(Err(other)) => panic!("unexpected error variant for corrupt input: {other}"),
            Ok(Ok(decoded)) => panic!(
                "expected decode failure for corrupt input, got {} samples",
                decoded.interleaved_samples.len()
            ),
            Err(_) => panic!("decoder panicked on hostile input"),
        }
    }

    fn generate_sine_wave_interleaved(
        sample_rate_hz: u32,
        seconds: f32,
        frequency_hz: f32,
        amplitude: f32,
        channels: u16,
    ) -> Vec<f32> {
        let frame_count = (sample_rate_hz as f32 * seconds).round() as usize;
        let channels_usize = usize::from(channels);
        let mut out = Vec::with_capacity(frame_count * channels_usize);

        for n in 0..frame_count {
            let t = n as f32 / sample_rate_hz as f32;
            let sample = (TAU * frequency_hz * t).sin() * amplitude;
            for _ in 0..channels_usize {
                out.push(sample);
            }
        }

        out
    }

    fn max_abs_sample(samples: &[f32]) -> f32 {
        let mut max_val = 0.0f32;
        for sample in samples {
            let abs = sample.abs();
            if abs > max_val {
                max_val = abs;
            }
        }
        max_val
    }

    #[test]
    fn analyze_interleaved_samples_produces_valid_metrics_for_440hz_sine() {
        let samples = generate_sine_wave_interleaved(
            TEST_SAMPLE_RATE,
            TEST_SECONDS,
            440.0,
            0.5,
            TEST_CHANNELS_MONO,
        );
        let total_frames = samples.len() / usize::from(TEST_CHANNELS_MONO);
        let config = AnalysisConfig {
            target_peak_bins: total_frames,
            dbfs_floor: -96.0,
        };

        let analysis = analyze_interleaved_samples_with_config(
            &samples,
            TEST_SAMPLE_RATE,
            TEST_CHANNELS_MONO,
            config,
        );

        let analysis = match analysis {
            Ok(value) => value,
            Err(error) => panic!("unexpected analysis error: {error}"),
        };

        assert_eq!(analysis.sample_rate_hz, TEST_SAMPLE_RATE);
        assert_eq!(analysis.channels, TEST_CHANNELS_MONO);
        assert_eq!(analysis.duration_ms, 4_000);
        assert_eq!(analysis.peak_data.len(), total_frames);
        assert!(analysis.loudness_lufs.is_finite());
        assert!(analysis.loudness_lufs <= 0.0);
        assert!(analysis.true_peak_dbfs.is_finite());
        assert!(analysis.true_peak_dbfs <= 0.0);
        assert!(analysis
            .peak_data
            .iter()
            .all(|peak| peak.is_finite() && *peak <= 0.0));

        let expected_peak_dbfs = amplitude_to_dbfs(max_abs_sample(&samples), -96.0);
        let mut observed_peak_dbfs = f32::NEG_INFINITY;
        for peak in &analysis.peak_data {
            if *peak > observed_peak_dbfs {
                observed_peak_dbfs = *peak;
            }
        }

        assert!(
            (observed_peak_dbfs - expected_peak_dbfs).abs() < 1e-4,
            "observed_peak_dbfs={observed_peak_dbfs}, expected_peak_dbfs={expected_peak_dbfs}"
        );
        assert!(
            analysis.true_peak_dbfs + 1e-4 >= observed_peak_dbfs,
            "true_peak_dbfs should be >= sampled envelope peak (true={}, sampled={observed_peak_dbfs})",
            analysis.true_peak_dbfs
        );
    }

    #[test]
    fn integrated_lufs_increases_by_approximately_6db_when_amplitude_doubles() {
        let quiet = generate_sine_wave_interleaved(TEST_SAMPLE_RATE, TEST_SECONDS, 440.0, 0.25, 1);
        let loud = generate_sine_wave_interleaved(TEST_SAMPLE_RATE, TEST_SECONDS, 440.0, 0.5, 1);

        let quiet_analysis = match analyze_interleaved_samples(&quiet, TEST_SAMPLE_RATE, 1) {
            Ok(value) => value,
            Err(error) => panic!("unexpected quiet analysis error: {error}"),
        };
        let loud_analysis = match analyze_interleaved_samples(&loud, TEST_SAMPLE_RATE, 1) {
            Ok(value) => value,
            Err(error) => panic!("unexpected loud analysis error: {error}"),
        };

        let delta_lufs = loud_analysis.loudness_lufs - quiet_analysis.loudness_lufs;
        assert!(
            (delta_lufs - 6.0206).abs() < 0.35,
            "delta_lufs={delta_lufs}, quiet={}, loud={}",
            quiet_analysis.loudness_lufs,
            loud_analysis.loudness_lufs
        );
    }

    #[test]
    fn peak_downsampling_uses_dbfs_floor_for_silence() {
        let silence = vec![0.0f32; 4_800];
        let peaks = compute_peak_data_dbfs(&silence, 1, 32, -90.0);

        let peaks = match peaks {
            Ok(value) => value,
            Err(error) => panic!("unexpected peak extraction error: {error}"),
        };

        assert_eq!(peaks.len(), 32);
        assert!(peaks.iter().all(|peak| (*peak - (-90.0)).abs() < 1e-6));
    }

    #[test]
    fn true_peak_reported_around_minus_6_dbfs_for_half_amplitude_signal() {
        // Previously tested via compute_true_peak_dbfs directly; now validated
        // through the public analyze_interleaved_samples surface.
        // 1.0s at 48 kHz gives EBU R128 integrated gating enough data and
        // a nominal -6 dBFS true peak for amplitude=0.5.
        let samples =
            generate_sine_wave_interleaved(TEST_SAMPLE_RATE, 1.0, 440.0, 0.5, TEST_CHANNELS_MONO);
        let analysis = analyze_interleaved_samples(&samples, TEST_SAMPLE_RATE, TEST_CHANNELS_MONO)
            .expect("analysis should succeed");
        assert!(analysis.true_peak_dbfs <= 0.0);
        assert!(
            analysis.true_peak_dbfs > -7.0 && analysis.true_peak_dbfs < -5.0,
            "expected around -6 dBFS for amplitude=0.5, got {}",
            analysis.true_peak_dbfs
        );
        // A half-amplitude signal is well below the -0.5 dBFS clipping threshold.
        assert!(!analysis.is_clipping);
    }

    #[test]
    fn is_clipping_true_for_full_scale_sine() {
        // A 0 dBFS (amplitude 1.0) sine wave oversampled by EBU R128 true-peak
        // will typically read >= -0.5 dBFS and must be flagged as clipping.
        let samples = generate_sine_wave_interleaved(TEST_SAMPLE_RATE, 1.0, 440.0, 1.0, 1);
        let analysis = analyze_interleaved_samples(&samples, TEST_SAMPLE_RATE, 1)
            .expect("analysis should succeed");
        assert!(
            analysis.is_clipping,
            "full-scale sine should be flagged as clipping (true_peak_dbfs={})",
            analysis.true_peak_dbfs
        );
    }

    #[test]
    fn is_clipping_false_for_low_amplitude_sine() {
        // A -6 dBFS sine (amplitude 0.5) is safely below the clipping threshold.
        let samples = generate_sine_wave_interleaved(TEST_SAMPLE_RATE, 1.0, 440.0, 0.5, 1);
        let analysis = analyze_interleaved_samples(&samples, TEST_SAMPLE_RATE, 1)
            .expect("analysis should succeed");
        assert!(
            !analysis.is_clipping,
            "half-amplitude sine should NOT be flagged as clipping (true_peak_dbfs={})",
            analysis.true_peak_dbfs
        );
    }

    #[test]
    fn is_clipping_threshold_is_minus_half_dbfs() {
        // Exported constant must match the documented -0.5 dBFS threshold.
        assert!(
            (TRUE_PEAK_CLIPPING_DBFS - (-0.5)).abs() < 1e-6,
            "clipping threshold should be -0.5 dBFS, got {TRUE_PEAK_CLIPPING_DBFS}"
        );
    }

    #[test]
    fn analyze_interleaved_samples_rejects_invalid_inputs() {
        let empty = analyze_interleaved_samples(&[], TEST_SAMPLE_RATE, 1);
        assert!(matches!(empty, Err(AudioError::InvalidInput(_))));

        let zero_rate = analyze_interleaved_samples(&[0.0, 0.0], 0, 1);
        assert!(matches!(zero_rate, Err(AudioError::InvalidInput(_))));

        let zero_channels = analyze_interleaved_samples(&[0.0, 0.0], TEST_SAMPLE_RATE, 0);
        assert!(matches!(zero_channels, Err(AudioError::InvalidInput(_))));

        let unaligned = analyze_interleaved_samples(&[0.0, 0.1, 0.2], TEST_SAMPLE_RATE, 2);
        assert!(matches!(unaligned, Err(AudioError::InvalidInput(_))));
    }

    #[test]
    fn analyze_track_returns_io_error_for_missing_file() {
        let result = super::analyze_track(Path::new("Z:/this/path/should/not/exist.wav"));
        assert!(matches!(result, Err(AudioError::Io { .. })));
    }

    #[test]
    fn amplitude_to_dbfs_clamps_to_zero_and_floor() {
        assert!((amplitude_to_dbfs(1.0, -96.0) - 0.0).abs() < 1e-6);
        assert!((amplitude_to_dbfs(2.0, -96.0) - 0.0).abs() < 1e-6);
        assert!((amplitude_to_dbfs(0.0, -80.0) - (-80.0)).abs() < 1e-6);
    }

    #[test]
    fn decode_audio_file_rejects_zero_byte_file_without_panicking() {
        let file = create_temp_file_with_bytes("wav", &[]);
        assert_decode_fails_without_panic(file.path());
    }

    #[test]
    fn decode_audio_file_rejects_corrupted_byte_corpus_without_panicking() {
        let pcm = pcm_s16_wav_bytes(&[0, 10_000, -10_000, 0], 48_000, 1);
        let truncated = pcm[..20].to_vec();
        let header_bitflip = flip_single_bit(pcm.clone(), 12, 0); // "fmt " -> likely invalid chunk id
        let riff_magic_bitflip = flip_single_bit(pcm.clone(), 0, 0); // "RIFF" magic corruption
        let randomish = (0..257)
            .map(|i| ((i * 73) & 0xff) as u8)
            .collect::<Vec<u8>>();

        let corpus = [
            ("bin", b"not audio".to_vec()),
            ("wav", vec![0u8; 128]),
            ("wav", truncated),
            ("wav", header_bitflip),
            ("wav", riff_magic_bitflip),
            ("dat", randomish),
        ];

        for (index, (ext, bytes)) in corpus.into_iter().enumerate() {
            let file = create_temp_file_with_bytes(ext, &bytes);
            let result = panic::catch_unwind(|| decode_audio_file(file.path()));
            match result {
                Ok(Err(_)) => {}
                Ok(Ok(decoded)) => panic!(
                    "corrupt corpus item {index} decoded unexpectedly ({} samples)",
                    decoded.interleaved_samples.len()
                ),
                Err(_) => panic!("decoder panicked on corrupt corpus item {index}"),
            }
        }
    }

    #[test]
    fn decode_audio_file_rejects_unsupported_wav_codec_format_tag() {
        // RIFF/WAVE container is valid, but the format tag is intentionally bogus and unsupported.
        let unsupported_wav = wav_bytes_with_format_tag(0x1337, &[0, 1000, -1000, 0], 48_000, 1);
        let file = create_temp_file_with_bytes("wav", &unsupported_wav);

        let result = decode_audio_file(file.path());
        assert!(matches!(
            result,
            Err(AudioError::Decode(_)) | Err(AudioError::Unsupported(_))
        ));
    }

    #[test]
    fn integrated_lufs_streaming_bubbles_io_error_midstream() {
        let chunk_a = generate_sine_wave_interleaved(TEST_SAMPLE_RATE, 1.0, 440.0, 0.5, 1);
        let chunk_b = generate_sine_wave_interleaved(TEST_SAMPLE_RATE, 1.0, 440.0, 0.5, 1);
        let simulated_path = PathBuf::from("C:/synthetic/failing-stream.raw");
        let simulated_error = AudioError::Io {
            path: simulated_path.clone(),
            source: std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                "simulated mid-stream read failure",
            ),
        };

        let chunks = vec![Ok(chunk_a), Err(simulated_error), Ok(chunk_b)];
        let result = compute_integrated_lufs_from_chunks(chunks, TEST_SAMPLE_RATE, 1);

        match result {
            Err(AudioError::Io { path, source }) => {
                assert_eq!(path, simulated_path);
                assert_eq!(source.kind(), std::io::ErrorKind::Interrupted);
            }
            Err(other) => panic!("unexpected error variant: {other}"),
            Ok(value) => panic!("expected io failure to bubble, got loudness {value}"),
        }
    }

    #[test]
    fn integrated_lufs_streaming_rejects_misaligned_chunk() {
        let result = compute_integrated_lufs_from_chunks(
            std::iter::once(Ok(vec![0.0f32, 0.1, 0.2])),
            TEST_SAMPLE_RATE,
            2,
        );

        assert!(
            matches!(result, Err(AudioError::Analysis(message)) if message.contains("divisible by channels"))
        );
    }

    #[test]
    fn integrated_lufs_streaming_rejects_zero_sample_rate() {
        let chunk = generate_sine_wave_interleaved(TEST_SAMPLE_RATE, 0.25, 440.0, 0.5, 1);
        let result = compute_integrated_lufs_from_chunks(std::iter::once(Ok(chunk)), 0, 1);

        assert!(
            matches!(result, Err(AudioError::Analysis(message)) if message.contains("sample_rate_hz must be > 0"))
        );
    }

    #[test]
    fn integrated_lufs_streaming_rejects_zero_channels() {
        let chunk = generate_sine_wave_interleaved(TEST_SAMPLE_RATE, 0.25, 440.0, 0.5, 1);
        let result =
            compute_integrated_lufs_from_chunks(std::iter::once(Ok(chunk)), TEST_SAMPLE_RATE, 0);

        assert!(
            matches!(result, Err(AudioError::Analysis(message)) if message.contains("channels must be > 0"))
        );
    }

    #[test]
    fn integrated_lufs_streaming_rejects_non_finite_samples() {
        let result = compute_integrated_lufs_from_chunks(
            std::iter::once(Ok(vec![0.0f32, f32::NAN, 0.2, 0.3])),
            TEST_SAMPLE_RATE,
            1,
        );

        assert!(
            matches!(result, Err(AudioError::Analysis(message)) if message.contains("non-finite"))
        );
    }

    #[test]
    fn integrated_lufs_streaming_rejects_zero_frames_when_chunks_are_empty() {
        let result = compute_integrated_lufs_from_chunks(
            vec![Ok(Vec::<f32>::new()), Ok(Vec::<f32>::new())],
            TEST_SAMPLE_RATE,
            1,
        );

        assert!(
            matches!(result, Err(AudioError::Analysis(message)) if message.contains("zero frames"))
        );
    }
}
