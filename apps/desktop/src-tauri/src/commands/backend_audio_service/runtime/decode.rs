use super::*;

pub(crate) fn decode_track_to_stereo_f32_pcm(
    path: &Path,
    expected_sample_rate_hz: u32,
    bit_depth: u16,
) -> Result<DecodedPcmTrack, String> {
    if !matches!(bit_depth, 16 | 24 | 32) {
        return Err("playback decode supports only 16/24/32-bit DAC output targets".to_string());
    }

    let file = File::open(path).map_err(|error| {
        format!(
            "failed to open playback track `{}`: {error}",
            path.display()
        )
    })?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|ext| ext.to_str()) {
        hint.with_extension(extension);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|error| format!("failed to probe playback track format: {error}"))?;
    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| "no default audio track found for playback".to_string())?;

    let sample_rate_hz = track
        .codec_params
        .sample_rate
        .ok_or_else(|| "playback track is missing sample-rate metadata".to_string())?;
    let decoder_channels = track
        .codec_params
        .channels
        .map(|channels| channels.count() as u16)
        .unwrap_or(2);
    let source_bit_depth = track
        .codec_params
        .bits_per_sample
        .and_then(|bits| u16::try_from(bits).ok());
    let boundary = AudioFormatBoundary {
        decoder_sample_rate: sample_rate_hz,
        decoder_channels,
        decoder_is_interleaved: true,
        decoder_bit_depth: source_bit_depth.unwrap_or(32),
        dac_sample_rate: expected_sample_rate_hz,
        dac_channels: 2,
        dac_requires_interleaved: true,
        dac_bit_depth: bit_depth,
    };
    validate_audio_format_boundary(&boundary)?;
    tracing::info!(
        target: "desktop.player",
        decoder_sample_rate = boundary.decoder_sample_rate,
        decoder_channels = boundary.decoder_channels,
        decoder_interleaved = boundary.decoder_is_interleaved,
        decoder_bit_depth = boundary.decoder_bit_depth,
        dac_sample_rate = boundary.dac_sample_rate,
        dac_channels = boundary.dac_channels,
        dac_interleaved = boundary.dac_requires_interleaved,
        dac_bit_depth = boundary.dac_bit_depth,
        "audio format boundary negotiated"
    );

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|error| format!("failed to initialize playback decoder: {error}"))?;

    let mut interleaved_stereo_f32 = Vec::<f32>::new();
    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(symphonia::core::errors::Error::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(symphonia::core::errors::Error::ResetRequired) => {
                return Err(
                    "playback decode reset required; unsupported stream transition".to_string(),
                );
            }
            Err(error) => {
                return Err(format!("failed reading playback packet stream: {error}"));
            }
        };

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(symphonia::core::errors::Error::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(symphonia::core::errors::Error::DecodeError(_)) => {
                continue;
            }
            Err(error) => {
                return Err(format!("failed decoding playback packet: {error}"));
            }
        };

        let channel_count = decoded.spec().channels.count();
        let frame_count = decoded.frames();
        if frame_count == 0 {
            continue;
        }
        let mut sample_buffer = SampleBuffer::<f32>::new(frame_count as u64, *decoded.spec());
        sample_buffer.copy_interleaved_ref(decoded);
        let expected_samples = frame_count.saturating_mul(channel_count);
        let interleaved_samples = sample_buffer.samples();
        if interleaved_samples.len() < expected_samples {
            return Err(format!(
                "decoder produced undersized interleaved buffer: expected at least {expected_samples} samples, got {}",
                interleaved_samples.len()
            ));
        }
        append_interleaved_to_stereo_f32(
            &interleaved_samples[..expected_samples],
            channel_count,
            &mut interleaved_stereo_f32,
        );
    }

    if interleaved_stereo_f32.is_empty() {
        return Err("decoded playback track has no PCM frames".to_string());
    }

    let used_software_resampler = sample_rate_hz != expected_sample_rate_hz;
    if used_software_resampler {
        tracing::info!(
            target: "desktop.player",
            source_hz = sample_rate_hz,
            target_hz = expected_sample_rate_hz,
            "sample rates differ, performing high-quality software SRC (Resampling)"
        );
        interleaved_stereo_f32 = resample_stereo_interleaved_frames(
            &interleaved_stereo_f32,
            sample_rate_hz,
            expected_sample_rate_hz,
        )?;
    }

    let total_frames = interleaved_stereo_f32.len() / 2;
    Ok(DecodedPcmTrack {
        samples_stereo_f32: Arc::new(interleaved_stereo_f32),
        total_frames,
        sample_rate_hz: expected_sample_rate_hz,
        source_bit_depth,
        used_software_resampler,
    })
}

pub(crate) fn resample_stereo_interleaved_frames(
    interleaved: &[f32],
    source_rate_hz: u32,
    target_rate_hz: u32,
) -> Result<Vec<f32>, String> {
    use rubato::{
        Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
    };

    let params = SincInterpolationParameters {
        sinc_len: 256,
        f_cutoff: 0.95,
        interpolation: SincInterpolationType::Linear,
        oversampling_factor: 256,
        window: WindowFunction::BlackmanHarris2,
    };

    let frames = interleaved.len() / 2;
    let mut resampler = SincFixedIn::<f32>::new(
        target_rate_hz as f64 / source_rate_hz as f64,
        2.0,
        params,
        frames,
        2,
    )
    .map_err(|e| format!("failed to initialize resampler: {e}"))?;

    let mut left = Vec::with_capacity(frames);
    let mut right = Vec::with_capacity(frames);

    for chunk in interleaved.chunks_exact(2) {
        left.push(chunk[0]);
        right.push(chunk[1]);
    }

    let waves_in = vec![left, right];
    let waves_out = resampler
        .process(&waves_in, None)
        .map_err(|e| format!("resampling failed: {e}"))?;

    if waves_out.len() != 2 {
        return Err("resampler returned unexpected number of channels".to_string());
    }

    let left = &waves_out[0];
    let right = &waves_out[1];
    if left.len() != right.len() {
        return Err("resampler returned mismatched channel frame counts".to_string());
    }

    let mut out_interleaved = Vec::with_capacity(left.len() * 2);
    for (&left_sample, &right_sample) in left.iter().zip(right.iter()) {
        out_interleaved.push(left_sample);
        out_interleaved.push(right_sample);
    }

    Ok(out_interleaved)
}

pub(crate) fn append_interleaved_to_stereo_f32(
    interleaved: &[f32],
    channel_count: usize,
    out: &mut Vec<f32>,
) {
    if channel_count == 0 {
        return;
    }

    if channel_count == 1 {
        for &mono in interleaved {
            out.push(mono);
            out.push(mono);
        }
        return;
    }

    for frame in interleaved.chunks(channel_count) {
        if frame.len() < 2 {
            continue;
        }
        out.push(frame[0]);
        out.push(frame[1]);
    }
}

#[derive(Debug, Clone)]
pub(crate) struct DecodedPcmTrack {
    pub(crate) samples_stereo_f32: Arc<Vec<f32>>,
    pub(crate) total_frames: usize,
    pub(crate) sample_rate_hz: u32,
    pub(crate) source_bit_depth: Option<u16>,
    pub(crate) used_software_resampler: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct AudioFormatBoundary {
    pub(crate) decoder_sample_rate: u32,
    pub(crate) decoder_channels: u16,
    pub(crate) decoder_is_interleaved: bool,
    pub(crate) decoder_bit_depth: u16,
    pub(crate) dac_sample_rate: u32,
    pub(crate) dac_channels: u16,
    pub(crate) dac_requires_interleaved: bool,
    pub(crate) dac_bit_depth: u16,
}

pub(crate) fn validate_audio_format_boundary(boundary: &AudioFormatBoundary) -> Result<(), String> {
    if boundary.decoder_sample_rate == 0 || boundary.dac_sample_rate == 0 {
        return Err("audio boundary sample-rate cannot be zero".to_string());
    }
    if boundary.decoder_sample_rate != boundary.dac_sample_rate {
        tracing::info!(
            target: "desktop.player",
            "audio boundary sample-rates do not match (decoder={}Hz dac={}Hz), will employ software SRC",
            boundary.decoder_sample_rate, boundary.dac_sample_rate
        );
    }
    if boundary.decoder_channels == 0 || boundary.dac_channels == 0 {
        return Err("audio boundary channel count cannot be zero".to_string());
    }
    if boundary.dac_channels != 2 {
        return Err(format!(
            "exclusive playback currently supports exactly 2 DAC channels, got {}",
            boundary.dac_channels
        ));
    }
    if !boundary.decoder_is_interleaved || !boundary.dac_requires_interleaved {
        return Err("audio boundary requires interleaved decoder and DAC buffers".to_string());
    }
    if !matches!(boundary.dac_bit_depth, 16 | 24 | 32) {
        return Err(format!(
            "unsupported DAC bit depth {} (expected 16/24/32)",
            boundary.dac_bit_depth
        ));
    }
    Ok(())
}
