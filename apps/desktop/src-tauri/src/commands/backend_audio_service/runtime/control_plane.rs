use super::*;
use crossbeam_queue::ArrayQueue;
use std::sync::atomic::AtomicU32;

#[derive(Debug, Clone)]
struct TrackChangeRequest {
    request_id: u64,
    new_index: u32,
}

#[derive(Debug)]
pub(crate) struct PlaybackControlPlane {
    pub(crate) hardware_state: RwLock<Option<AudioHardwareState>>,
    audio_engine: RwLock<Option<AudioEngineContext>>,
    pub(crate) volume_scalar_bits: AtomicU32,
    pub(crate) is_bit_perfect_bypassed: AtomicBool,
    requested_exclusive_mode: AtomicBool,
    pub(crate) transport_playing: AtomicBool,
    active_queue_index: AtomicU32,
    is_queue_ui_expanded: AtomicBool,
    playback_queue_paths: RwLock<Vec<String>>,
    decoded_track: RwLock<Option<DecodedPcmTrack>>,
    pub(crate) playback_frame_cursor: AtomicU64,
    decode_error: RwLock<Option<String>>,
    worker_running: AtomicBool,
    next_track_change_request_id: AtomicU64,
    last_applied_track_change_request_id: AtomicU64,
    track_change_queue: ArrayQueue<TrackChangeRequest>,
}

impl PlaybackControlPlane {
    pub(crate) fn new() -> Arc<Self> {
        let control = Arc::new(Self {
            hardware_state: RwLock::new(None),
            audio_engine: RwLock::new(None),
            volume_scalar_bits: AtomicU32::new(UNITY_GAIN_LEVEL.to_bits()),
            is_bit_perfect_bypassed: AtomicBool::new(true),
            requested_exclusive_mode: AtomicBool::new(false),
            transport_playing: AtomicBool::new(false),
            active_queue_index: AtomicU32::new(0),
            is_queue_ui_expanded: AtomicBool::new(false),
            playback_queue_paths: RwLock::new(Vec::new()),
            decoded_track: RwLock::new(None),
            playback_frame_cursor: AtomicU64::new(0),
            decode_error: RwLock::new(None),
            worker_running: AtomicBool::new(false),
            next_track_change_request_id: AtomicU64::new(0),
            last_applied_track_change_request_id: AtomicU64::new(0),
            track_change_queue: ArrayQueue::new(PLAYBACK_COMMAND_QUEUE_CAPACITY),
        });
        Self::spawn_track_change_worker(&control);
        control
    }

    fn spawn_track_change_worker(control: &Arc<Self>) {
        let worker = Arc::clone(control);
        control.worker_running.store(true, Ordering::Release);
        match std::thread::Builder::new()
            .name("rp-playback-track-change-worker".to_string())
            .spawn(move || loop {
                let mut drained_any = false;
                while let Some(request) = worker.track_change_queue.pop() {
                    drained_any = true;
                    worker.try_prepare_track_for_queue_index(request.new_index);
                    worker
                        .active_queue_index
                        .store(request.new_index, Ordering::Release);
                    worker
                        .last_applied_track_change_request_id
                        .store(request.request_id, Ordering::Release);
                }

                if !drained_any {
                    std::thread::sleep(Duration::from_millis(PLAYBACK_COMMAND_THREAD_IDLE_MS));
                }
            }) {
            Ok(_) => {}
            Err(error) => {
                control.worker_running.store(false, Ordering::Release);
                tracing::error!(
                    target: "desktop.player",
                    error = %error,
                    "failed to start playback track-change worker"
                );
            }
        }
    }

    pub(crate) fn acquire_audio_device_lock(
        &self,
        target_rate_hz: u32,
        target_bit_depth: u16,
        prefer_exclusive: bool,
    ) -> Result<AudioHardwareState, AppError> {
        if target_rate_hz == 0 {
            return Err(AppError::invalid_argument(
                "target_rate_hz must be greater than zero",
            ));
        }
        if !matches!(target_bit_depth, 16 | 24 | 32) {
            return Err(AppError::invalid_argument(
                "target_bit_depth must be one of: 16, 24, 32",
            ));
        }
        if !self.worker_running.load(Ordering::Acquire) {
            return Err(AppError::new(
                app_error_codes::EXCLUSIVE_AUDIO_UNAVAILABLE,
                "playback control plane worker is not running",
            ));
        }
        self.requested_exclusive_mode
            .store(prefer_exclusive, Ordering::Release);

        #[cfg(not(target_os = "windows"))]
        {
            return Err(AppError::new(
                app_error_codes::EXCLUSIVE_AUDIO_UNAVAILABLE,
                "audio device lock initialization is currently supported only on Windows",
            ));
        }

        #[cfg(target_os = "windows")]
        {
            let previous_engine = {
                let mut guard = self.audio_engine.write().map_err(|_| {
                    AppError::new(
                        app_error_codes::EXCLUSIVE_AUDIO_UNAVAILABLE,
                        "failed to update audio playback engine state",
                    )
                })?;
                guard.take()
            };
            if let Some(previous) = previous_engine {
                previous.shutdown();
            }

            {
                let mut guard = self.hardware_state.write().map_err(|_| {
                    AppError::new(
                        app_error_codes::EXCLUSIVE_AUDIO_UNAVAILABLE,
                        "failed to clear playback hardware state",
                    )
                })?;
                *guard = None;
            }

            let candidates = wasapi_exclusive_fallback_candidates(target_rate_hz, target_bit_depth);
            let mut startup_attempt_errors: Vec<String> = Vec::new();
            let mut selected_config: Option<(AudioEngineContext, u32, u32, u16, usize)> = None;

            for (attempt_index, (sample_rate_hz, bit_depth)) in candidates.into_iter().enumerate() {
                match start_wasapi_engine(sample_rate_hz, bit_depth, prefer_exclusive) {
                    Ok((engine, buffer_size_frames)) => {
                        selected_config = Some((
                            engine,
                            buffer_size_frames,
                            sample_rate_hz,
                            bit_depth,
                            attempt_index,
                        ));
                        break;
                    }
                    Err(error) => {
                        if attempt_index == 0 && !is_wasapi_unsupported_format_error(&error.message)
                        {
                            return Err(error);
                        }
                        startup_attempt_errors.push(format!(
                            "{sample_rate_hz}Hz/{bit_depth}-bit: {}",
                            error.message
                        ));
                    }
                }
            }

            let Some((engine, buffer_size_frames, selected_rate_hz, selected_bit_depth, attempt)) =
                selected_config
            else {
                return Err(AppError::new(
                    app_error_codes::EXCLUSIVE_AUDIO_UNAVAILABLE,
                    format!(
                        "failed to acquire WASAPI audio lock for all attempted formats: {}",
                        startup_attempt_errors.join(" | ")
                    ),
                ));
            };

            if attempt > 0 {
                tracing::warn!(
                    target: "desktop.player",
                    requested_sample_rate_hz = target_rate_hz,
                    requested_bit_depth = target_bit_depth,
                    selected_sample_rate_hz = selected_rate_hz,
                    selected_bit_depth = selected_bit_depth,
                    "WASAPI requested format unsupported; using fallback format"
                );
            }

            {
                let mut guard = self.audio_engine.write().map_err(|_| {
                    AppError::new(
                        app_error_codes::EXCLUSIVE_AUDIO_UNAVAILABLE,
                        "failed to update audio playback engine state",
                    )
                })?;
                *guard = Some(engine);
            }

            let hardware = AudioHardwareState {
                sample_rate_hz: selected_rate_hz,
                bit_depth: selected_bit_depth,
                buffer_size_frames,
                is_exclusive_lock: prefer_exclusive,
            };

            let mut guard = self.hardware_state.write().map_err(|_| {
                AppError::new(
                    app_error_codes::EXCLUSIVE_AUDIO_UNAVAILABLE,
                    "failed to update playback hardware state",
                )
            })?;
            *guard = Some(hardware.clone());

            Ok(hardware)
        }
    }
    pub(crate) fn release_audio_device_lock(&self) -> Result<(), AppError> {
        let previous_engine = {
            let mut guard = self.audio_engine.write().map_err(|_| {
                AppError::new(
                    app_error_codes::EXCLUSIVE_AUDIO_UNAVAILABLE,
                    "failed to update audio playback engine state during release",
                )
            })?;
            guard.take()
        };

        if let Some(engine) = previous_engine {
            engine.shutdown();
        }

        {
            let mut guard = self.hardware_state.write().map_err(|_| {
                AppError::new(
                    app_error_codes::EXCLUSIVE_AUDIO_UNAVAILABLE,
                    "failed to clear playback hardware state during release",
                )
            })?;
            *guard = None;
        }

        tracing::info!(target: "desktop.player", "audio device lock released");
        Ok(())
    }

    pub(crate) fn get_audio_device_context(&self) -> Result<AudioDeviceContext, AppError> {
        let hardware = {
            let guard = self.hardware_state.read().map_err(|_| {
                AppError::new(
                    app_error_codes::EXCLUSIVE_AUDIO_UNAVAILABLE,
                    "failed to read playback hardware state",
                )
            })?;
            guard.clone()
        };

        let current_lock_state = match hardware {
            Some(hw) => {
                if hw.is_exclusive_lock {
                    AudioLockState::ExclusiveMode
                } else {
                    AudioLockState::SharedMode
                }
            }
            None => AudioLockState::Released,
        };

        let is_playing = self.transport_playing.load(Ordering::Acquire);
        // Note: is_app_in_focus is a UI concept, so we will stub it here
        // The React frontend track window focus
        Ok(AudioDeviceContext {
            current_lock_state,
            user_prefers_exclusive: self.requested_exclusive_mode.load(Ordering::Acquire),
            is_app_in_focus: true,
            is_playing,
        })
    }

    pub(crate) fn set_volume(&self, level: f32) -> Result<(), AppError> {
        if !level.is_finite() || !(0.0..=1.0).contains(&level) {
            return Err(AppError::new(
                app_error_codes::PLAYBACK_INVALID_VOLUME,
                "volume level must be a finite float between 0.0 and 1.0",
            ));
        }

        self.volume_scalar_bits
            .store(level.to_bits(), Ordering::Release);
        self.is_bit_perfect_bypassed
            .store(level == UNITY_GAIN_LEVEL, Ordering::Release);
        Ok(())
    }

    pub(crate) fn set_playback_queue(
        &self,
        paths: Vec<String>,
    ) -> Result<PlaybackQueueState, AppError> {
        if paths.len() > MAX_PLAYBACK_QUEUE_TRACKS {
            return Err(AppError::invalid_argument(format!(
                "playback queue accepts at most {MAX_PLAYBACK_QUEUE_TRACKS} tracks"
            )));
        }

        let normalized: Vec<String> = paths
            .into_iter()
            .map(|item| strip_single_layer_matching_quotes(item.trim()).to_string())
            .filter(|item| !item.trim().is_empty())
            .collect();

        {
            let mut queue_guard = self.playback_queue_paths.write().map_err(|_| {
                AppError::new(
                    app_error_codes::PLAYBACK_QUEUE_REQUEST_REJECTED,
                    "failed to update playback queue",
                )
            })?;
            *queue_guard = normalized.clone();
        }

        // Queue sync is a recovery boundary: clear stale decode errors that might refer
        // to previous queue/index combinations.
        self.set_decode_error(None);

        if normalized.is_empty() {
            if let Ok(mut decoded_guard) = self.decoded_track.write() {
                *decoded_guard = None;
            }
            self.playback_frame_cursor.store(0, Ordering::Release);
            self.transport_playing.store(false, Ordering::Release);
            self.active_queue_index.store(0, Ordering::Release);
        } else {
            let current_index = self.active_queue_index.load(Ordering::Acquire) as usize;
            let clamped_index = current_index.min(normalized.len().saturating_sub(1)) as u32;
            self.active_queue_index
                .store(clamped_index, Ordering::Release);
        }

        Ok(PlaybackQueueState {
            total_tracks: normalized.len(),
        })
    }

    pub(crate) fn push_track_change_request(&self, new_index: u32) -> Result<bool, AppError> {
        if !self.worker_running.load(Ordering::Acquire) {
            return Err(AppError::new(
                app_error_codes::PLAYBACK_QUEUE_REQUEST_REJECTED,
                "track-change queue worker is unavailable",
            ));
        }

        let request_id = self
            .next_track_change_request_id
            .fetch_add(1, Ordering::AcqRel)
            + 1;
        let request = TrackChangeRequest {
            request_id,
            new_index,
        };

        Ok(self.track_change_queue.push(request).is_ok())
    }

    fn apply_pending_track_change_requests_inline(&self) {
        let mut latest_request: Option<TrackChangeRequest> = None;
        while let Some(request) = self.track_change_queue.pop() {
            latest_request = Some(request);
        }
        let Some(request) = latest_request else {
            return;
        };

        self.try_prepare_track_for_queue_index(request.new_index);
        self.active_queue_index
            .store(request.new_index, Ordering::Release);
        self.last_applied_track_change_request_id
            .store(request.request_id, Ordering::Release);
    }

    pub(crate) fn set_playback_playing(&self, is_playing: bool) -> Result<(), AppError> {
        if is_playing {
            if self.current_decoded_track().is_none() {
                self.apply_pending_track_change_requests_inline();
            }
            if self.current_decoded_track().is_none() {
                let active_queue_index = self.active_queue_index.load(Ordering::Acquire);
                self.try_prepare_track_for_queue_index(active_queue_index);
            }
            if self.current_decoded_track().is_none() {
                let message = self
                    .decode_error()
                    .unwrap_or_else(|| "no decoded playback track is armed".to_string());
                return Err(AppError::new(
                    app_error_codes::PLAYBACK_QUEUE_REQUEST_REJECTED,
                    message,
                ));
            }
        }

        self.transport_playing.store(is_playing, Ordering::Release);
        Ok(())
    }

    pub(crate) fn seek_playback_ratio(&self, ratio: f32) -> Result<(), AppError> {
        if !ratio.is_finite() || !(0.0..=1.0).contains(&ratio) {
            return Err(AppError::invalid_argument(
                "seek ratio must be a finite float between 0.0 and 1.0",
            ));
        }

        let Some(track) = self.current_decoded_track() else {
            return Err(AppError::new(
                app_error_codes::PLAYBACK_QUEUE_REQUEST_REJECTED,
                "no decoded playback track is armed",
            ));
        };

        let total_frames = track.total_frames as u64;
        let target_frame = ((total_frames as f64) * (ratio as f64))
            .round()
            .clamp(0.0, total_frames as f64) as u64;
        self.playback_frame_cursor
            .store(target_frame, Ordering::Release);
        Ok(())
    }

    pub(crate) fn toggle_queue_visibility(&self) {
        let previous = self.is_queue_ui_expanded.load(Ordering::Acquire);
        self.is_queue_ui_expanded
            .store(!previous, Ordering::Release);
    }

    pub(crate) fn context_state(&self) -> PlaybackContextState {
        let decoded = self.current_decoded_track();
        let hardware = self
            .hardware_state
            .read()
            .ok()
            .and_then(|guard| guard.clone());
        let output_status = self.derive_output_status(hardware.as_ref(), decoded.as_ref());
        let (position_seconds, track_duration_seconds) = match decoded {
            Some(track) if track.sample_rate_hz > 0 => {
                let cursor_frames = self.playback_frame_cursor.load(Ordering::Acquire) as f64;
                let duration = track.total_frames as f64 / track.sample_rate_hz as f64;
                let position = (cursor_frames / track.sample_rate_hz as f64).clamp(0.0, duration);
                (position, duration)
            }
            _ => (0.0, 0.0),
        };

        PlaybackContextState {
            volume_scalar: f32::from_bits(self.volume_scalar_bits.load(Ordering::Acquire)),
            is_bit_perfect_bypassed: self.is_bit_perfect_bypassed.load(Ordering::Acquire),
            output_status,
            active_queue_index: self.active_queue_index.load(Ordering::Acquire),
            is_queue_ui_expanded: self.is_queue_ui_expanded.load(Ordering::Acquire),
            queued_track_change_requests: self.track_change_queue.len(),
            is_playing: self.transport_playing.load(Ordering::Acquire),
            position_seconds,
            track_duration_seconds,
        }
    }

    fn derive_output_status(
        &self,
        hardware: Option<&AudioHardwareState>,
        decoded: Option<&DecodedPcmTrack>,
    ) -> PlaybackOutputStatus {
        let requested_mode = if self.requested_exclusive_mode.load(Ordering::Acquire) {
            PlaybackOutputMode::Exclusive
        } else {
            PlaybackOutputMode::Shared
        };
        let active_mode = match hardware {
            Some(hw) if hw.is_exclusive_lock => PlaybackOutputMode::Exclusive,
            Some(_) => PlaybackOutputMode::Shared,
            None => PlaybackOutputMode::Released,
        };

        let volume_scalar = f32::from_bits(self.volume_scalar_bits.load(Ordering::Acquire));
        let bypass_volume = self.is_bit_perfect_bypassed.load(Ordering::Acquire);
        let mut reasons = Vec::new();

        if active_mode != PlaybackOutputMode::Exclusive {
            reasons.push("Exclusive output mode is not active.".to_string());
        }

        if volume_scalar != UNITY_GAIN_LEVEL || !bypass_volume {
            reasons.push("Volume is not set to 100%, so software gain is active.".to_string());
        }

        match decoded {
            Some(track) => {
                if track.used_software_resampler {
                    reasons.push(
                        "Sample-rate conversion is active for the current track.".to_string(),
                    );
                }

                match (track.source_bit_depth, hardware) {
                    (Some(source_bits), Some(hw)) if source_bits == hw.bit_depth => {}
                    (Some(source_bits), Some(hw)) => reasons.push(format!(
                        "Source bit depth ({source_bits}-bit) does not match output bit depth ({}-bit).",
                        hw.bit_depth
                    )),
                    (None, Some(_)) => reasons.push(
                        "Source bit depth is unknown, so bit-depth parity cannot be verified."
                            .to_string(),
                    ),
                    _ => {}
                }
            }
            None => {
                reasons.push("No decoded track is armed for playback yet.".to_string());
            }
        }

        if hardware.is_none() {
            reasons.push("No native output stream is currently initialized.".to_string());
        }

        let bit_perfect_eligible = reasons.is_empty();
        reasons.push(
            "Eligibility reflects output-path conditions only; Skald decodes to PCM in software and does not provide encoded bitstream passthrough."
                .to_string(),
        );

        PlaybackOutputStatus {
            requested_mode,
            active_mode,
            sample_rate_hz: hardware.map(|hw| hw.sample_rate_hz),
            bit_depth: hardware.map(|hw| hw.bit_depth),
            bit_perfect_eligible,
            reasons,
        }
    }

    pub(crate) fn decode_error(&self) -> Option<String> {
        self.decode_error
            .read()
            .ok()
            .and_then(|guard| guard.clone())
    }

    pub(crate) fn current_decoded_track(&self) -> Option<DecodedPcmTrack> {
        self.decoded_track
            .read()
            .ok()
            .and_then(|guard| guard.clone())
    }

    fn set_decode_error(&self, message: Option<String>) {
        if let Ok(mut guard) = self.decode_error.write() {
            *guard = message;
        }
    }

    fn try_prepare_track_for_queue_index(&self, queue_index: u32) {
        let path = {
            let queue_guard = match self.playback_queue_paths.read() {
                Ok(guard) => guard,
                Err(_) => {
                    self.set_decode_error(Some(
                        "failed to read playback queue for track-change request".to_string(),
                    ));
                    return;
                }
            };

            if queue_guard.is_empty() {
                // Empty queue is a valid idle state (common during startup/recovery).
                self.set_decode_error(None);
                return;
            }

            match queue_guard.get(queue_index as usize) {
                Some(item) => item.clone(),
                None => {
                    self.set_decode_error(Some(format!(
                        "requested queue index {queue_index} is out of range"
                    )));
                    return;
                }
            }
        };

        let hardware = match self.hardware_state.read() {
            Ok(guard) => guard.clone(),
            Err(_) => {
                self.set_decode_error(Some(
                    "failed to read playback hardware state for decode".to_string(),
                ));
                return;
            }
        };

        let Some(hardware) = hardware else {
            self.set_decode_error(Some(
                "playback output device is not initialized; cannot decode queue track".to_string(),
            ));
            return;
        };

        match decode_track_to_stereo_f32_pcm(
            Path::new(&path),
            hardware.sample_rate_hz,
            hardware.bit_depth,
        ) {
            Ok(track) => {
                if let Ok(mut decoded_guard) = self.decoded_track.write() {
                    *decoded_guard = Some(track);
                    self.playback_frame_cursor.store(0, Ordering::Release);
                    self.set_decode_error(None);
                } else {
                    self.set_decode_error(Some(
                        "failed to update decoded playback track state".to_string(),
                    ));
                }
            }
            Err(message) => {
                self.set_decode_error(Some(message));
            }
        }
    }
}

pub(crate) fn shared_playback_control() -> Arc<PlaybackControlPlane> {
    static CONTROL: OnceLock<Arc<PlaybackControlPlane>> = OnceLock::new();
    Arc::clone(CONTROL.get_or_init(PlaybackControlPlane::new))
}
