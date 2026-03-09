# Hardened Module Contracts

Date: 2026-03-09  
Status: Proposed-for-refactor (contract hardening pass)  
Scope: C-001 through C-008

## Shared contract primitives

```ts
export type ContractStatus = "PROPOSED" | "ACTIVE" | "DEPRECATED";
export type OutputMode = "shared" | "exclusive";
export type OutputRuntimeMode = OutputMode | "released";

export type AppNotice = {
  level: "info" | "success" | "warning";
  message: string;
};

export type ContractErrorCode =
  | "INVALID_ARGUMENT"
  | "EXCLUSIVE_AUDIO_UNAVAILABLE"
  | "PLAYBACK_INVALID_VOLUME"
  | "PLAYBACK_QUEUE_REQUEST_REJECTED"
  | "FEATURE_DISABLED"
  | "TAURI_UNAVAILABLE"
  | "UNKNOWN_COMMAND"
  | "TAURI_DIALOG_UNAVAILABLE"
  | "TAURI_DIALOG_TIMEOUT"
  | "UNEXPECTED_UI_ERROR"
  | string;

export type ContractError = {
  code: ContractErrorCode;
  message: string;
  details?: unknown;
  retryable?: boolean;
  source: "frontend" | "bridge" | "backend";
};

export type QueueTrackRef = {
  trackId: string;
  filePath: string;
  durationMs: number;
  title: string;
  artist: string;
};

export type QueueIdentity = {
  revision: string; // deterministic hash/version for queue order + track IDs
  size: number;
};

export type AudioHardwareState = {
  sample_rate_hz: number;
  bit_depth: number;
  buffer_size_frames: number;
  is_exclusive_lock: boolean;
};

export type PlaybackOutputStatus = {
  requested_mode: OutputRuntimeMode;
  active_mode: OutputRuntimeMode;
  sample_rate_hz: number | null;
  bit_depth: number | null;
  bit_perfect_eligible: boolean;
  reasons: string[];
};

export type PlaybackContextSnapshot = {
  volume_scalar: number;
  is_bit_perfect_bypassed: boolean;
  output_status: PlaybackOutputStatus;
  active_queue_index: number;
  is_queue_ui_expanded: boolean;
  queued_track_change_requests: number;
  is_playing: boolean;
  position_seconds: number;
  track_duration_seconds: number;
  // Optional forward-compatible fields for freshness tracking.
  snapshot_seq?: number;
  captured_at_iso?: string;
};
```

---

## C-001

- Contract ID: `C-001`
- Version: `1.0.0`
- Status: `PROPOSED`
- Provider: `player-transport`
- Consumer(s): `app/shell`
- Purpose: Shell composes transport state/actions without implementing transport logic.

### Public API surface

```ts
export type UsePlayerTransportControllerArgs = {
  queue: QueueTrackRef[];
  selectedTrackId: string | null;
  onNotice: (notice: AppNotice) => void;
};

export type PlayerSource = {
  key: string;
  filePath: string;
  title: string;
  artist: string;
  durationMs: number;
};

export type PlayerTransportState = {
  playerTrackId: string;
  playerSource: PlayerSource | null;
  queueIndex: number;
  queueIdentity: QueueIdentity;
  playerTimeSec: number;
  playerIsPlaying: boolean;
  nativeTransportEnabled: boolean;
  nativeTransportChecked: boolean;
  playerError: string | null;
};

export type PlayerTransportActions = {
  setPlayerTrack(trackId: string): void;
  togglePlay(): Promise<void>;
  stop(): Promise<void>;
  seekToRatio(ratio: number): Promise<void>;
  setVolumeScalar(level: number): Promise<void>;
  setQueueVisible(visible: boolean): Promise<boolean>;
};

export type PlayerTransportController = {
  state: PlayerTransportState;
  actions: PlayerTransportActions;
  handshake: TransportOutputSwitchHandshake;
  publisherBridge: PublisherSharedTransportBridge;
};

export declare function usePlayerTransportController(
  args: UsePlayerTransportControllerArgs
): PlayerTransportController;
```

### Input schema

- `queue` must be deterministic in order and track ID uniqueness.
- `selectedTrackId` may be `null`.
- `onNotice` must be side-effect safe (must not throw).

### Output schema

- `state` is the single shell-readable transport snapshot.
- `actions` are the only shell-write interface.
- `handshake` and `publisherBridge` are explicit sub-contracts (C-003 and C-008).

### Error schema

- Actions reject with `ContractError`.
- `state.playerError` mirrors latest user-visible error string, sanitized.

### Preconditions

- Queue entries must reference readable local file paths.
- Consumer must not mutate provider internals.

### Postconditions

- All state transitions are reflected in `state` without direct shell mutation.
- `queueIdentity.revision` changes whenever queue order/content changes.

### Failure postconditions

- Failed action does not leave partially mutated transport state.
- `playerIsPlaying` reflects real backend/browser state after failure recovery.

### Forbidden side effects

- No raw Tauri calls from shell.
- No shell writes to internal refs/timers of provider.

### Concurrency/race handling rules

- Provider serializes transport-mutating actions (`togglePlay`, `stop`, `seekToRatio`, queue-arm operations).
- Provider must ignore stale completions from superseded async operations.

### Compatibility notes

- Wraps existing `usePlayerTransportState` behavior during migration.
- Must preserve current user-facing playback controls.

### Required tests

- Provider contract tests for each action pre/postconditions.
- Shell integration test proving no direct transport internals are imported.
- Race test: rapid play/pause/seek with queue changes remains consistent.

---

## C-002

- Contract ID: `C-002`
- Version: `1.0.0`
- Status: `PROPOSED`
- Provider: `audio-output`
- Consumer(s): `app/shell`
- Purpose: Shell reads output mode state and requests mode changes through one controller.

### Public API surface

```ts
export type AudioOutputControllerState = {
  requestedMode: OutputMode;
  activeMode: OutputRuntimeMode;
  switching: boolean;
  status: PlaybackOutputStatus;
};

export type OutputModeSwitchResult = {
  applied: boolean;
  fallbackApplied: boolean;
  finalMode: OutputRuntimeMode;
  warning?: string;
};

export type UseAudioOutputControllerArgs = {
  preferredSampleRateHz: number;
  preferredBitDepth: 16 | 24 | 32;
  transportHandshake: TransportOutputSwitchHandshake;
  onNotice: (notice: AppNotice) => void;
};

export type AudioOutputController = {
  state: AudioOutputControllerState;
  requestOutputMode(mode: OutputMode): Promise<OutputModeSwitchResult>;
  refreshOutputStatus(): Promise<void>;
};

export declare function useAudioOutputController(
  args: UseAudioOutputControllerArgs
): AudioOutputController;
```

### Input schema

- Preferred format must be finite and supported by bridge constraints.
- `transportHandshake` must satisfy C-003.

### Output schema

- `state.activeMode` is backend-truth-driven, not UI-assumed.
- `state.status` mirrors backend output status contract (C-007).

### Error schema

- `requestOutputMode` rejects with `ContractError` only if neither requested mode nor fallback can yield usable output.

### Preconditions

- Startup default mode is `shared`.
- Consumer must not write output status directly.

### Postconditions

- On successful switch, `state.activeMode` equals backend active mode.
- Output status is refreshed after mode transitions.

### Failure postconditions

- If exclusive acquisition fails, provider attempts shared fallback.
- Controller remains usable; app does not remain in indeterminate switching state.

### Forbidden side effects

- No direct queue mutation outside C-003 handshake.
- No frontend fabrication of eligibility status.

### Concurrency/race handling rules

- Only one in-flight mode switch at a time (serialized per controller instance).
- Re-entrant requests while `switching=true` are rejected or coalesced deterministically.

### Compatibility notes

- Must preserve existing UI semantics: explicit exclusive opt-in and warning behavior.

### Required tests

- Shared-by-default startup test.
- Exclusive request failure -> shared fallback test.
- Status fidelity test: UI mode/status always reflects backend context.

---

## C-003

- Contract ID: `C-003`
- Version: `1.0.0`
- Status: `PROPOSED`
- Provider: `player-transport`
- Consumer(s): `audio-output`
- Purpose: Safe stop/re-arm/resume handshake around output mode transitions.

### Public API surface

```ts
export type OutputSwitchReason = "output_mode_change";

export type TransportSnapshot = {
  sourceKey: string | null;
  queueIdentity: QueueIdentity;
  queueIndex: number;
  wasPlaying: boolean;
  positionSec: number;
  volumeScalar: number;
  nativeTransportEnabled: boolean;
};

export type PrepareForOutputSwitchInput = {
  reason: OutputSwitchReason;
  targetMode: OutputMode;
};

export type PrepareForOutputSwitchResult = {
  snapshot: TransportSnapshot;
  stopped: boolean;
  pausedLegacyAudio: boolean;
};

export type RestoreAfterOutputSwitchInput = {
  snapshot: TransportSnapshot;
  modeResult: OutputModeSwitchResult;
};

export type RestoreAfterOutputSwitchResult = {
  resumed: boolean;
  resumedDeterministically: boolean;
  warning?: string;
};

export type TransportOutputSwitchHandshake = {
  prepareForOutputSwitch(
    input: PrepareForOutputSwitchInput
  ): Promise<PrepareForOutputSwitchResult>;
  restoreAfterOutputSwitch(
    input: RestoreAfterOutputSwitchInput
  ): Promise<RestoreAfterOutputSwitchResult>;
};
```

### Input schema

- `prepare` input must include `targetMode` and fixed `reason`.
- `restore` input must include the exact snapshot returned by `prepare`.

### Output schema

- Snapshot is immutable input for restore decisioning.
- Restore result explicitly reports deterministic resume status.

### Error schema

- Methods reject with `ContractError` on unrecoverable transport failures.

### Preconditions

- `prepare` must run before `restore` for a switch transaction.

### Postconditions

- After `prepare`, transport is paused/stopped consistently.
- After `restore`, transport is either deterministically resumed or explicitly paused with warning.

### Failure postconditions

- On restore failure, transport remains paused and stable (no half-playing state).
- Snapshot remains valid for one retry attempt only.

### Forbidden side effects

- No queue reorder during switch transaction.
- No source replacement unrelated to switch recovery.

### Concurrency/race handling rules

- Handshake operations are transaction-serialized by an internal switch token.
- User play/pause/seek actions during active handshake are queued or rejected deterministically.

### Compatibility notes

- Aligns with existing stop/re-arm flow currently embedded in `usePlayerTransportState`.

### Required tests

- Prepare/restore success path with playing source.
- Prepare/restore failure path keeps stable paused state.
- Concurrent play click during switch is deterministically handled.

---

## C-004

- Contract ID: `C-004`
- Version: `1.0.0`
- Status: `PROPOSED`
- Provider: `tauri-audio-bridge`
- Consumer(s): `audio-output`
- Purpose: Typed bridge API for output mode initialization and output status retrieval.

### Public API surface

```ts
export type InitPlaybackOutputModeRequest = {
  targetRateHz: number;
  targetBitDepth: 16 | 24 | 32;
  mode: OutputMode;
};

export type TauriAudioOutputBridge = {
  initPlaybackOutputMode(
    request: InitPlaybackOutputModeRequest
  ): Promise<AudioHardwareState>;
  getPlaybackContext(): Promise<PlaybackContextSnapshot>;
  getPlaybackDecodeError(): Promise<string | null>;
};
```

### Input schema

- `targetRateHz`: integer, 8000..384000.
- `targetBitDepth`: `16 | 24 | 32` for first-wave playback path.
- `mode`: `shared | exclusive`.

### Output schema

- `initPlaybackOutputMode` returns backend-selected hardware parameters.
- `getPlaybackContext` returns sanitized typed snapshot including `output_status`.

### Error schema

- Rejects with `ContractError` from bridge validation or backend command errors.

### Preconditions

- Bridge command availability in runtime (`tauri` commands registered).

### Postconditions

- Returned payloads are validated/sanitized before consumer use.

### Failure postconditions

- Bridge never returns partially typed objects.
- Consumer can safely fall back on contract errors.

### Forbidden side effects

- No UI state mutation inside bridge.
- No raw unsanitized error leakage.

### Concurrency/race handling rules

- Bridge methods are stateless; sequencing responsibility lies with consumer (audio-output controller).

### Compatibility notes

- Maintains compatibility with existing command names in first wave.

### Required tests

- Validation tests for invalid rate/bit-depth/mode.
- Sanitization tests for malformed `output_status` fields.
- Command error passthrough shape tests.

---

## C-005

- Contract ID: `C-005`
- Version: `1.0.0`
- Status: `PROPOSED`
- Provider: `tauri-audio-bridge`
- Consumer(s): `player-transport`
- Purpose: Typed bridge API for playback transport operations.

### Public API surface

```ts
export type SetPlaybackQueueRequest = {
  paths: string[];
  queueIdentity: QueueIdentity;
};

export type TauriPlayerTransportBridge = {
  setPlaybackQueue(request: SetPlaybackQueueRequest): Promise<{ total_tracks: number }>;
  pushPlaybackTrackChangeRequest(newIndex: number): Promise<boolean>;
  setPlaybackPlaying(isPlaying: boolean): Promise<void>;
  seekPlaybackRatio(ratio: number): Promise<void>;
  setPlaybackVolume(level: number): Promise<void>;
  togglePlaybackQueueVisibility(): Promise<void>;
  getPlaybackContext(): Promise<PlaybackContextSnapshot>;
  getPlaybackDecodeError(): Promise<string | null>;
};
```

### Input schema

- Queue `paths` must be normalized, non-empty strings, bounded by max queue size.
- `newIndex` must target current queue bounds.
- `ratio` and `level` must be finite and range-valid.

### Output schema

- Queue sync returns accepted track count.
- Track-change returns acceptance flag.

### Error schema

- Rejects with `ContractError`.
- Expected codes include `INVALID_ARGUMENT`, `PLAYBACK_QUEUE_REQUEST_REJECTED`, `EXCLUSIVE_AUDIO_UNAVAILABLE`.

### Preconditions

- Queue must be synchronized before requesting a new track index.

### Postconditions

- Accepted track-change request eventually appears in context state (`active_queue_index`) after worker application.

### Failure postconditions

- On rejection, transport retains previous active source/index.
- No implicit fallback to arbitrary source.

### Forbidden side effects

- Consumer cannot bypass queue sync and assume backend queue identity.

### Concurrency/race handling rules

- Consumer must serialize queue sync + track-change requests by queue revision.
- Stale operations with mismatched `queueIdentity.revision` must be discarded by consumer.

### Compatibility notes

- First-wave may adapt existing `setPlaybackQueue(paths)` signature internally while externally enforcing queue identity semantics.

### Required tests

- Queue revision mismatch test prevents stale track-change calls.
- Rapid queue updates + track changes remain deterministic.
- Seek/play operations fail safely when no track is armed.

---

## C-006

- Contract ID: `C-006`
- Version: `1.0.0`
- Status: `PROPOSED`
- Provider: `commands/audio_output.rs` and `commands/playback.rs` backed by playback-engine service
- Consumer(s): `tauri-audio-bridge`
- Purpose: Stable IPC command contract between frontend bridge and Rust playback backend.

### Public API surface

```ts
// Command-level wire map (snake_case payload conventions)
type PlaybackIpcContract = {
  init_exclusive_device: {
    args: { targetRateHz: number; targetBitDepth: number; preferExclusive?: boolean };
    returns: AudioHardwareState;
  };
  set_volume: { args: { level: number }; returns: void };
  set_playback_queue: { args: { paths: string[] }; returns: { total_tracks: number } };
  push_track_change_request: { args: { newIndex: number }; returns: boolean };
  set_playback_playing: { args: { isPlaying: boolean }; returns: void };
  seek_playback_ratio: { args: { ratio: number }; returns: void };
  get_playback_context: { args: {}; returns: PlaybackContextSnapshot };
  get_playback_decode_error: { args: {}; returns: string | null };
};
```

### Input schema

- Commands must enforce argument validation at boundary.
- Unknown/malicious fields are rejected where deny-unknown-fields applies.

### Output schema

- Successful responses conform to typed wire shapes.
- Failures return `AppError` wire shape `{ code, message, details? }`.

### Error schema

- Backend returns sanitized `AppError` messages.
- Bridge maps backend error into `ContractError`.

### Preconditions

- Commands registered in Tauri invoke handler.

### Postconditions

- Command responses remain backward compatible for first-wave migration.

### Failure postconditions

- Command errors do not leak unsanitized internals/backtraces.

### Forbidden side effects

- No hidden backend-side state mutation outside explicit command semantics.

### Concurrency/race handling rules

- Backend worker queue handles track-change requests asynchronously; context polling reflects eventual state.
- Bridge/consumers must tolerate eventual consistency window.

### Compatibility notes

- First-wave must preserve existing command names and high-level payload shape.
- Any additive fields must remain optional for prior consumers.

### Required tests

- IPC contract shape tests for each command.
- Backward compatibility tests for command names and payload keys.
- Error wire-shape stability tests.

---

## C-007

- Contract ID: `C-007`
- Version: `1.0.0`
- Status: `PROPOSED`
- Provider: `backend-playback-engine-service`
- Consumer(s): `tauri-audio-bridge`, `audio-output`
- Purpose: Backend is the sole source of truth for output mode and bit-perfect eligibility snapshot.

### Public API surface

```ts
export type PlaybackOutputStatusTruth = PlaybackOutputStatus;

export type PlaybackContextTruth = PlaybackContextSnapshot & {
  output_status: PlaybackOutputStatusTruth;
};
```

### Input schema

- None (read-model contract exposed via `get_playback_context`).

### Output schema

- `output_status` must always be present.
- `reasons` must always be non-empty (includes explanatory note even when eligible).

### Error schema

- Retrieval errors surfaced as `ContractError` through bridge.

### Preconditions

- None for consumers beyond bridge command availability.

### Postconditions

- Consumers render backend-provided `active_mode` and `bit_perfect_eligible` directly.

### Failure postconditions

- If context retrieval fails, consumer must preserve last known valid snapshot and mark stale status.

### Forbidden side effects

- Frontend must not fabricate eligibility truth or active mode.

### Concurrency/race handling rules

- Snapshot is point-in-time and may change between polls; consumers must treat as replaceable immutable snapshot.

### Compatibility notes

- Current schema fields are already present in Rust and TS.
- Optional freshness metadata (`snapshot_seq`, `captured_at_iso`) recommended for v1.1.

### Required tests

- Truth-source test: UI derives status from backend context only.
- Eligibility reason contract tests for edge cases (no hardware, no track, SRC, volume != unity).

---

## C-008

- Contract ID: `C-008`
- Version: `1.0.0`
- Status: `PROPOSED`
- Provider: `player-transport`
- Consumer(s): `publisher-ops`
- Purpose: Publisher preview integration through narrow shared transport bridge.

### Public API surface

```ts
export type SharedTransportSourceForPublisherOps = {
  sourceKey: string;
  filePath: string;
  title: string;
  artist: string;
  durationMs: number;
};

export type PublisherSharedTransportBridgeState = {
  sourceKey: string | null;
  currentTimeSec: number;
  isPlaying: boolean;
};

export type PublisherSharedTransportBridge = {
  readonly state: PublisherSharedTransportBridgeState;
  ensureSource(
    source: SharedTransportSourceForPublisherOps,
    options?: { autoplay?: boolean }
  ): void;
  seekToRatio(sourceKey: string, ratio: number): void;
};
```

### Input schema

- `ensureSource.sourceKey` must be stable for current media variant.
- `seekToRatio.ratio` must be finite in [0,1].

### Output schema

- Bridge methods are side-effect requests; provider updates `state` accordingly.

### Error schema

- Bridge methods are no-throw for source mismatch; mismatches are treated as no-op.
- Unexpected failures should be reported via provider-level notice/error channel.

### Preconditions

- Provider initialized and active in app runtime.

### Postconditions

- `ensureSource` is idempotent for same source key + media path.
- `seekToRatio` only applies when `sourceKey` matches active bridge state.

### Failure postconditions

- Source mismatch seek does not alter playback state.
- Failed source ensure does not clear existing valid source unexpectedly.

### Forbidden side effects

- Consumer must not mutate transport state except via bridge methods.

### Concurrency/race handling rules

- Provider resolves concurrent `ensureSource` calls by last-write-wins based on invocation order.
- Seek calls against stale source keys are ignored.

### Compatibility notes

- Preserves existing shape in `features/publisher-ops/types.ts`.

### Required tests

- Ensure-source idempotency test.
- Seek source mismatch no-op test.
- Concurrent ensure-source ordering test.

---

## Binding refactor guardrails

1. Shell imports only public module entrypoints.
2. No raw Tauri `invoke` outside `tauri-audio-bridge`.
3. Backend is the single source of truth for output mode/status.
4. Frontend must not fabricate eligibility state.
5. No contract consumer may depend on provider internals.
6. All bridge/IPC responses must be typed and sanitized before consumption.
7. Mode switch operations must use C-003 handshake; direct stop/resume orchestration from shell is forbidden.
8. Queue-changing operations must include queue identity/revision semantics.
