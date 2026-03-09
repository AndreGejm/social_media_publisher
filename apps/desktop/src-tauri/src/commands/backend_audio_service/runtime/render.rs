use super::*;

#[derive(Debug)]
pub(crate) struct AudioEngineContext {
    stop_requested: Arc<AtomicBool>,
    join_handle: Option<std::thread::JoinHandle<()>>,
}

impl AudioEngineContext {
    pub(crate) fn shutdown(mut self) {
        self.stop_requested.store(true, Ordering::Release);
        if let Some(handle) = self.join_handle.take() {
            if let Err(error) = handle.join() {
                tracing::warn!(
                    target: "desktop.player",
                    error = ?error,
                    "audio thread join failed"
                );
            }
        }
    }
}

#[cfg(target_os = "windows")]
#[derive(Debug)]
struct CoInitGuard;

#[cfg(target_os = "windows")]
impl Drop for CoInitGuard {
    fn drop(&mut self) {
        // SAFETY: CoInitializeEx/CoUninitialize are paired on the same thread in this guard.
        unsafe { CoUninitialize() };
    }
}

#[cfg(target_os = "windows")]
#[derive(Debug)]
struct WasapiExclusiveThreadContext {
    _co_init_guard: CoInitGuard,
    audio_client: IAudioClient,
    render_client: IAudioRenderClient,
    buffer_size_frames: u32,
    block_align_bytes: usize,
    bit_depth: u16,
}

#[cfg(target_os = "windows")]
pub(crate) fn start_wasapi_engine(
    target_rate_hz: u32,
    target_bit_depth: u16,
    prefer_exclusive: bool,
) -> Result<(AudioEngineContext, u32), AppError> {
    let stop_requested = Arc::new(AtomicBool::new(false));
    let stop_for_thread = Arc::clone(&stop_requested);
    let (startup_tx, startup_rx) = std::sync::mpsc::sync_channel::<Result<u32, String>>(1);

    let join_handle = std::thread::Builder::new()
        .name("rp-wasapi-render".to_string())
        .spawn(move || {
            match create_wasapi_context(target_rate_hz, target_bit_depth, prefer_exclusive) {
                Ok(context) => {
                    let _ = startup_tx.send(Ok(context.buffer_size_frames));
                    run_wasapi_render_loop(context, stop_for_thread);
                }
                Err(message) => {
                    let _ = startup_tx.send(Err(message));
                }
            }
        })
        .map_err(|error| {
            AppError::new(
                app_error_codes::EXCLUSIVE_AUDIO_UNAVAILABLE,
                format!("failed to spawn WASAPI render thread: {error}"),
            )
        })?;

    match startup_rx.recv_timeout(Duration::from_secs(3)) {
        Ok(Ok(buffer_size_frames)) => Ok((
            AudioEngineContext {
                stop_requested,
                join_handle: Some(join_handle),
            },
            buffer_size_frames,
        )),
        Ok(Err(message)) => {
            let _ = join_handle.join();
            Err(AppError::new(
                app_error_codes::EXCLUSIVE_AUDIO_UNAVAILABLE,
                message,
            ))
        }
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            stop_requested.store(true, Ordering::Release);
            let _ = join_handle.join();
            Err(AppError::new(
                app_error_codes::EXCLUSIVE_AUDIO_UNAVAILABLE,
                "timed out while initializing WASAPI output",
            ))
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            let _ = join_handle.join();
            Err(AppError::new(
                app_error_codes::EXCLUSIVE_AUDIO_UNAVAILABLE,
                "WASAPI render thread exited unexpectedly during startup",
            ))
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WasapiShareMode {
    Exclusive,
    Shared,
}

#[cfg(target_os = "windows")]
fn create_wasapi_context(
    target_rate_hz: u32,
    target_bit_depth: u16,
    prefer_exclusive: bool,
) -> Result<WasapiExclusiveThreadContext, String> {
    // SAFETY: COM initialization is required before any WASAPI calls in this thread.
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
        .ok()
        .map_err(|error| format!("CoInitializeEx failed: {error}"))?;
    let co_init_guard = CoInitGuard;

    // SAFETY: CoCreateInstance is called with a valid COM class on an initialized COM thread.
    let enumerator: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
            .map_err(|error| format!("IMMDeviceEnumerator init failed: {error}"))?;

    // SAFETY: endpoint query is valid for default render endpoint role.
    let device = unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) }
        .map_err(|error| format!("default render endpoint unavailable: {error}"))?;

    // SAFETY: Activate obtains IAudioClient on a valid endpoint.
    let audio_client: IAudioClient = unsafe { device.Activate(CLSCTX_ALL, None) }
        .map_err(|error| format!("IAudioClient activation failed: {error}"))?;

    let channels: u16 = 2;
    let bytes_per_sample = target_bit_depth / 8;
    let block_align = channels
        .checked_mul(bytes_per_sample)
        .ok_or_else(|| "invalid block alignment".to_string())?;
    let avg_bytes_per_sec = target_rate_hz
        .checked_mul(u32::from(block_align))
        .ok_or_else(|| "invalid average bytes per second".to_string())?;
    let wave_format = WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_PCM as u16,
        nChannels: channels,
        nSamplesPerSec: target_rate_hz,
        nAvgBytesPerSec: avg_bytes_per_sec,
        nBlockAlign: block_align,
        wBitsPerSample: target_bit_depth,
        cbSize: 0,
    };

    let share_mode = if prefer_exclusive {
        WasapiShareMode::Exclusive
    } else {
        WasapiShareMode::Shared
    };

    tracing::info!(
        target: "desktop.player",
        sample_rate_hz = target_rate_hz,
        channels = channels,
        bit_depth = target_bit_depth,
        block_align = block_align,
        avg_bytes_per_sec = avg_bytes_per_sec,
        share_mode = ?share_mode,
        "requesting WASAPI format"
    );

    let hns_buffer_duration: i64 = if share_mode == WasapiShareMode::Exclusive {
        500_000 // 50ms exclusive
    } else {
        0 // Default shared buffer
    };

    let init_result = unsafe {
        if share_mode == WasapiShareMode::Exclusive {
            // SAFETY: Parameters match WASAPI exclusive-mode requirements and valid WAVEFORMATEX data.
            audio_client.Initialize(
                AUDCLNT_SHAREMODE_EXCLUSIVE,
                Default::default(),
                hns_buffer_duration,
                hns_buffer_duration,
                &wave_format,
                None,
            )
        } else {
            // Use AUTOCONVERTPCM to allow Windows to natively SRC the mix format to match our wave_format
            let flags =
                AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
            audio_client.Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                flags,
                hns_buffer_duration,
                0,
                &wave_format,
                None,
            )
        }
    };

    init_result.map_err(|error| {
        format!(
            "WASAPI {} Initialize failed: {error}",
            if share_mode == WasapiShareMode::Exclusive {
                "exclusive"
            } else {
                "shared"
            }
        )
    })?;

    // SAFETY: queried after successful Initialize.
    let buffer_size_frames = unsafe { audio_client.GetBufferSize() }
        .map_err(|error| format!("GetBufferSize failed: {error}"))?;
    if buffer_size_frames == 0 {
        return Err("WASAPI buffer size is zero".to_string());
    }

    // SAFETY: render service available for render-mode IAudioClient.
    let render_client: IAudioRenderClient = unsafe { audio_client.GetService() }
        .map_err(|error| format!("IAudioRenderClient service unavailable: {error}"))?;

    // SAFETY: Start called on initialized client.
    unsafe { audio_client.Start() }.map_err(|error| format!("WASAPI Start failed: {error}"))?;

    Ok(WasapiExclusiveThreadContext {
        _co_init_guard: co_init_guard,
        audio_client,
        render_client,
        buffer_size_frames,
        block_align_bytes: usize::from(block_align),
        bit_depth: target_bit_depth,
    })
}

#[cfg(target_os = "windows")]
fn run_wasapi_render_loop(context: WasapiExclusiveThreadContext, stop_requested: Arc<AtomicBool>) {
    let control = shared_playback_control();
    while !stop_requested.load(Ordering::Acquire) {
        // SAFETY: render loop operates on initialized and started WASAPI interfaces.
        let step_result: windows::core::Result<()> = unsafe {
            match context.audio_client.GetCurrentPadding() {
                Ok(padding) => {
                    let available_frames = context.buffer_size_frames.saturating_sub(padding);
                    if available_frames > 0 {
                        match context.render_client.GetBuffer(available_frames) {
                            Ok(buffer) => {
                                let bytes = available_frames as usize * context.block_align_bytes;
                                fill_wasapi_output_buffer(
                                    buffer,
                                    bytes,
                                    available_frames as usize,
                                    context.bit_depth,
                                    &control,
                                );
                                match context.render_client.ReleaseBuffer(available_frames, 0) {
                                    Ok(_) => Ok(()),
                                    Err(error) => Err(error),
                                }
                            }
                            Err(error) => Err(error),
                        }
                    } else {
                        Ok(())
                    }
                }
                Err(error) => Err(error),
            }
        };

        if let Err(error) = step_result {
            tracing::warn!(
                target: "desktop.player",
                error = %error,
                "WASAPI exclusive render loop error; stopping stream"
            );
            break;
        }

        std::thread::sleep(Duration::from_millis(2));
    }

    // SAFETY: stopping a started client is valid during shutdown.
    if let Err(error) = unsafe { context.audio_client.Stop() } {
        tracing::warn!(
            target: "desktop.player",
            error = %error,
            "WASAPI exclusive Stop failed during shutdown"
        );
    }
}

#[cfg(target_os = "windows")]
fn fill_wasapi_output_buffer(
    buffer_ptr: *mut u8,
    bytes: usize,
    frame_count: usize,
    bit_depth: u16,
    control: &PlaybackControlPlane,
) {
    // SAFETY: buffer_ptr points to a valid WASAPI render buffer with `bytes` writable bytes.
    let output = unsafe { std::slice::from_raw_parts_mut(buffer_ptr, bytes) };
    output.fill(0);

    if !control.transport_playing.load(Ordering::Acquire) {
        return;
    }

    let track = match control.current_decoded_track() {
        Some(track) => track,
        None => return,
    };
    if track.total_frames == 0 {
        return;
    }

    let mut cursor = control.playback_frame_cursor.load(Ordering::Acquire) as usize;
    let volume_scalar = f32::from_bits(control.volume_scalar_bits.load(Ordering::Acquire));
    let bypass_volume = control.is_bit_perfect_bypassed.load(Ordering::Acquire);

    for frame_idx in 0..frame_count {
        if cursor >= track.total_frames {
            break;
        }

        let left = track.samples_stereo_f32[cursor * 2];
        let right = track.samples_stereo_f32[cursor * 2 + 1];
        let (left, right) = if bypass_volume {
            (left, right)
        } else {
            (
                apply_volume_scalar_to_sample(left, volume_scalar),
                apply_volume_scalar_to_sample(right, volume_scalar),
            )
        };

        if !write_pcm_stereo_frame(output, frame_idx, bit_depth, left, right) {
            break;
        }

        cursor += 1;
    }

    control
        .playback_frame_cursor
        .store(cursor as u64, Ordering::Release);
}

pub(crate) fn write_pcm_stereo_frame(
    output: &mut [u8],
    frame_idx: usize,
    bit_depth: u16,
    left_sample: f32,
    right_sample: f32,
) -> bool {
    match bit_depth {
        16 => {
            let base = frame_idx * 4;
            if base + 4 > output.len() {
                return false;
            }
            let left = quantize_sample_to_i16(left_sample);
            let right = quantize_sample_to_i16(right_sample);
            output[base..base + 2].copy_from_slice(&left.to_le_bytes());
            output[base + 2..base + 4].copy_from_slice(&right.to_le_bytes());
        }
        24 => {
            let base = frame_idx * 6;
            if base + 6 > output.len() {
                return false;
            }
            let left = quantize_sample_to_i24_i32(left_sample);
            let right = quantize_sample_to_i24_i32(right_sample);
            let left_bytes = left.to_le_bytes();
            let right_bytes = right.to_le_bytes();
            output[base..base + 3].copy_from_slice(&left_bytes[..3]);
            output[base + 3..base + 6].copy_from_slice(&right_bytes[..3]);
        }
        32 => {
            let base = frame_idx * 8;
            if base + 8 > output.len() {
                return false;
            }
            let left = quantize_sample_to_i32(left_sample);
            let right = quantize_sample_to_i32(right_sample);
            output[base..base + 4].copy_from_slice(&left.to_le_bytes());
            output[base + 4..base + 8].copy_from_slice(&right.to_le_bytes());
        }
        _ => return false,
    }
    true
}

fn apply_volume_scalar_to_sample(sample: f32, scalar: f32) -> f32 {
    (sample * scalar).clamp(-1.0, 1.0)
}

fn quantize_sample_to_i16(sample: f32) -> i16 {
    let clamped = sample.clamp(-1.0, 1.0);
    (clamped * i16::MAX as f32).round() as i16
}

fn quantize_sample_to_i24_i32(sample: f32) -> i32 {
    const I24_MAX: f32 = 8_388_607.0;
    let clamped = sample.clamp(-1.0, 1.0);
    (clamped * I24_MAX).round() as i32
}

fn quantize_sample_to_i32(sample: f32) -> i32 {
    let clamped = sample.clamp(-1.0, 1.0);
    (clamped * i32::MAX as f32).round() as i32
}
