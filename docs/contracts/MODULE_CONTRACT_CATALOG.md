# Module Contract Catalog

Phase: 2 (Design contracts before refactor)

## Contract policy

- Every cross-module dependency must use a declared public contract.
- Contracts are versioned by module API, not by internal file path.
- Consumers cannot import module internals.

## Contract list

### C-001: Shell -> Player Transport Controller

- Provider: `player-transport`
- Consumer: `app/shell`
- Purpose: shell composes transport state/actions without owning transport logic.
- Surface (planned):
  - `usePlayerTransportController(args)`
  - returns `TransportState`, `TransportActions`, `SharedTransportBridge`
- Inputs:
  - selected track identity/context
  - queue snapshot
  - notice/error callbacks
- Outputs:
  - playback state, source, queue index, play/pause/seek actions
- Invariants:
  - no raw Tauri calls from shell
  - deterministic stop behavior

### C-002: Shell -> Audio Output Controller

- Provider: `audio-output`
- Consumer: `app/shell`
- Purpose: shell renders output mode controls and status without owning mode policy.
- Surface (planned):
  - `useAudioOutputController(args)`
  - returns `requestedMode`, `activeMode`, `status`, `requestMode`, `switching`
- Inputs:
  - transport handshake callbacks (stop/resume-safe)
- Outputs:
  - output status for UI
- Invariants:
  - startup defaults to `shared`
  - exclusive mode only by explicit user request

### C-003: Audio Output -> Player Transport Handshake

- Provider: `player-transport`
- Consumer: `audio-output`
- Purpose: output mode switch can safely stop, re-arm, and resume playback.
- Surface (planned):
  - `prepareForOutputSwitch()`
  - `restoreAfterOutputSwitch(result)`
- Invariants:
  - no half-initialized stream state
  - resume only when source and queue arming are valid

### C-004: Audio Output -> Tauri Audio Bridge

- Provider: `tauri-audio-bridge`
- Consumer: `audio-output`
- Purpose: typed command access for output mode init/switch/status.
- Surface (planned):
  - `initPlaybackOutputMode(rateHz, bitDepth, mode)`
  - `getPlaybackContext()` (must include output status)
- Error contract:
  - structured `UiAppError` with stable `code` and `message`
- Invariants:
  - bridge returns sanitized and typed output status

### C-005: Player Transport -> Tauri Audio Bridge

- Provider: `tauri-audio-bridge`
- Consumer: `player-transport`
- Purpose: typed playback transport command access.
- Surface (planned):
  - `setPlaybackQueue(paths)`
  - `pushPlaybackTrackChangeRequest(index)`
  - `setPlaybackPlaying(bool)`
  - `seekPlaybackRatio(ratio)`
  - `getPlaybackDecodeError()`
- Invariants:
  - consumer never imports raw `invoke`

### C-006: Tauri Audio Bridge -> Backend Audio Service (IPC)

- Provider: Rust `commands/playback.rs` + `backend-audio-service`
- Consumer: `tauri-audio-bridge`
- Purpose: stable wire contract between frontend and Rust playback backend.
- Surface (existing/planned compatible):
  - `init_exclusive_device`
  - `set_volume`
  - `set_playback_queue`
  - `push_track_change_request`
  - `set_playback_playing`
  - `seek_playback_ratio`
  - `get_playback_context`
  - `get_playback_decode_error`
- Invariants:
  - backward-compatible command naming during first wave
  - output status wire shape stable for UI

### C-007: Backend Audio Status Truth Contract

- Provider: `backend-audio-service`
- Consumers: `tauri-audio-bridge`, `audio-output`
- Purpose: backend is source of truth for active mode and eligibility reasons.
- Wire model:
  - `requested_mode`
  - `active_mode`
  - `sample_rate_hz`
  - `bit_depth`
  - `bit_perfect_eligible`
  - `reasons[]`
- Invariants:
  - backend computes status; frontend does not fabricate eligibility
  - `eligible` is not equivalent to guaranteed passthrough

### C-008: Publisher Shared Transport Bridge

- Provider: `player-transport`
- Consumer: `publisher-ops`
- Purpose: publisher workflow can preview/seek through shared transport without transport internals.
- Surface (existing intent, planned explicit contract):
  - `state { sourceKey, currentTimeSec, isPlaying }`
  - `ensureSource(source, options)`
  - `seekToRatio(sourceKey, ratio)`
- Invariants:
  - publisher module does not mutate transport internals directly

## Contract ownership map

- `audio-output` owns: C-002, C-004 consumer side behavior.
- `player-transport` owns: C-001 provider behavior, C-003 provider behavior, C-008 provider behavior.
- `tauri-audio-bridge` owns: C-004/C-005 provider behavior and command mapping.
- `backend-audio-service` owns: C-006 and C-007 backend truth model.

## Validation checkpoints for contract adoption

- Shell imports only module entrypoints, not module internals.
- No feature-level raw Tauri `invoke` usage.
- Output status and mode labels derive from backend context.
- Playback mode switch behavior can be tested within module-level tests.
