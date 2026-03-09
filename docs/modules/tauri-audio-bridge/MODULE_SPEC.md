# MODULE_SPEC: tauri-audio-bridge

## 1. Module Identity And Architecture Position

- Module name: `tauri-audio-bridge`
- Layer: Frontend infrastructure adapter module
- Architectural role: single typed IPC boundary between frontend runtime modules and Rust playback commands
- Public entrypoint: `apps/desktop/src/services/tauri/audio/index.ts` (or current equivalent export surface)
- Contract version: `1.0.0`
- Ownership boundary: only this module may invoke playback-related Tauri commands from frontend code

Architecture position:

```text
audio-output / player-transport
  -> tauri-audio-bridge
    -> Tauri invoke
      -> commands/playback.rs + backend-audio-service
```

Authority rule:
- Frontend modules depend on bridge abstractions, never on raw Tauri IPC semantics.

## 2. IPC Adapter Responsibilities

Owned responsibilities:
- Define and export stable TypeScript wire models for playback IPC.
- Validate command inputs deterministically before invoking backend commands.
- Sanitize all backend responses before exposing them to consumers.
- Map backend/IPC failures into stable `UiAppError` shape.
- Preserve command-name and payload-key compatibility guarantees.

## 3. Explicit Non-Goals

- Playback policy/orchestration ownership (belongs to `player-transport` and `audio-output`).
- UI state management, notices, or rendering concerns.
- Backend business-logic decisions.
- Cross-domain adapters (catalog/release/qc) in first-wave audio contract scope.

## 4. Complete TypeScript API Definitions

```ts
export type UiAppError = {
  code: string;
  message: string;
  details?: unknown;
};

export declare function isUiAppError(error: unknown): error is UiAppError;

export type AudioHardwareState = {
  sample_rate_hz: number;
  bit_depth: number;
  buffer_size_frames: number;
  is_exclusive_lock: boolean;
};

export type PlaybackOutputMode = "shared" | "exclusive";
export type PlaybackOutputRuntimeMode = PlaybackOutputMode | "released";

export type PlaybackOutputStatus = {
  requested_mode: PlaybackOutputRuntimeMode;
  active_mode: PlaybackOutputRuntimeMode;
  sample_rate_hz: number | null;
  bit_depth: number | null;
  bit_perfect_eligible: boolean;
  reasons: string[];
};

export type PlaybackQueueState = {
  total_tracks: number;
};

export type PlaybackContextState = {
  volume_scalar: number;
  is_bit_perfect_bypassed: boolean;
  output_status?: PlaybackOutputStatus;
  active_queue_index: number;
  is_queue_ui_expanded: boolean;
  queued_track_change_requests: number;
  is_playing?: boolean;
  position_seconds?: number;
  track_duration_seconds?: number;
};

export type PlaybackDecodeError = string | null;

export declare function initPlaybackOutputMode(
  targetRateHz: number,
  targetBitDepth: number,
  mode: PlaybackOutputMode
): Promise<AudioHardwareState>;

export declare function setPlaybackVolume(level: number): Promise<void>;
export declare function setPlaybackQueue(paths: string[]): Promise<PlaybackQueueState>;
export declare function pushPlaybackTrackChangeRequest(newIndex: number): Promise<boolean>;
export declare function setPlaybackPlaying(isPlaying: boolean): Promise<void>;
export declare function seekPlaybackRatio(ratio: number): Promise<void>;
export declare function togglePlaybackQueueVisibility(): Promise<void>;

export declare function getPlaybackContext(): Promise<PlaybackContextState>;
export declare function getPlaybackDecodeError(): Promise<PlaybackDecodeError>;
```

## 5. Wire Contract Models

### 5.1 PlaybackOutputStatus wire model

Normative schema:
- `requested_mode`: `"shared" | "exclusive" | "released"`
- `active_mode`: `"shared" | "exclusive" | "released"`
- `sample_rate_hz`: finite number or `null`
- `bit_depth`: finite number or `null`
- `bit_perfect_eligible`: boolean
- `reasons`: sanitized string array (0..N)

Normalization rules:
- unknown mode values are normalized to `"released"`
- invalid numeric fields normalize to `null`
- `reasons` non-array values normalize to `[]`

### 5.2 PlaybackContextState wire model

Normative schema:
- required: `volume_scalar`, `is_bit_perfect_bypassed`, `active_queue_index`, `is_queue_ui_expanded`, `queued_track_change_requests`
- optional pass-through: `is_playing`, `position_seconds`, `track_duration_seconds`, `output_status`

Sanitization rules:
- `output_status` is sanitized via playback-output sanitizer before exposure
- absent/invalid `output_status` remains `undefined` (consumer must handle)

### 5.3 PlaybackDecodeError wire model

Normative schema:
- `string | null`

Sanitization rules:
- `null` remains `null`
- string is sanitized to UI-safe text (max 512 chars)
- non-string/non-null values map to `null`

## 6. Command Map And Deterministic Input Validation Rules

Command mapping:

| Bridge method | Command name | Request payload keys |
| --- | --- | --- |
| `initPlaybackOutputMode(rate, depth, mode)` | `init_exclusive_device` | `{ targetRateHz, targetBitDepth, preferExclusive }` |
| `setPlaybackVolume(level)` | `set_volume` | `{ level }` |
| `setPlaybackQueue(paths)` | `set_playback_queue` | `{ paths }` |
| `pushPlaybackTrackChangeRequest(newIndex)` | `push_track_change_request` | `{ newIndex }` |
| `setPlaybackPlaying(isPlaying)` | `set_playback_playing` | `{ isPlaying }` |
| `seekPlaybackRatio(ratio)` | `seek_playback_ratio` | `{ ratio }` |
| `togglePlaybackQueueVisibility()` | `toggle_queue_visibility` | `{}` |
| `getPlaybackContext()` | `get_playback_context` | `{}` |
| `getPlaybackDecodeError()` | `get_playback_decode_error` | `{}` |

Validation rules (must be enforced before invoke):
- `targetRateHz`: integer, `8000..384000`
- `targetBitDepth`: integer, `8..64` (first-wave policy callers should pass `16|24|32`)
- `mode`: `"shared" | "exclusive"`
- `level`: finite number in `[0, 1]`
- `paths`: array length `<= 10000`; each path non-empty trimmed string, max `4096` chars
- `newIndex`: integer in `[0, 9999]`
- `isPlaying`: boolean
- `ratio`: finite number in `[0, 1]`

Validation failure behavior:
- Throw `UiAppError` with `code: "INVALID_ARGUMENT"`
- Do not invoke backend command when validation fails

## 7. Response Sanitization Rules

General sanitizer contract:
- Every backend response returned by bridge must be sanitized or normalized before exposure.
- Bridge must never pass through raw backend payload objects to consumers.

Required sanitization behaviors:
- `getPlaybackContext`:
  - sanitize `output_status`
  - preserve required numeric/boolean fields as returned
  - maintain optional fields as optional
- `getPlaybackDecodeError`:
  - sanitize string content
  - normalize invalid shape to `null`
- `AudioHardwareState`:
  - enforce finite numeric fields; otherwise throw `UiAppError(INVALID_ARGUMENT)`

Sanitization safety rules:
- sanitize human-readable strings with bounded length
- coerce invalid union members to safe defaults
- never fabricate transport state from sanitized data

## 8. Error Taxonomy And UiAppError Mapping

### 8.1 Bridge error taxonomy

- `INVALID_ARGUMENT`: local validation failed
- `TAURI_UNAVAILABLE`: runtime invoke unavailable/failed outside backend AppError shape
- backend passthrough codes (examples):
  - `EXCLUSIVE_AUDIO_UNAVAILABLE`
  - `PLAYBACK_INVALID_VOLUME`
  - `PLAYBACK_QUEUE_REQUEST_REJECTED`
  - `FEATURE_DISABLED`
  - `UNKNOWN_COMMAND`

### 8.2 Mapping rules

Mapping algorithm:
1. If thrown value satisfies `isUiAppError`, rethrow as-is after message/details sanitization.
2. Otherwise map to:
   - `{ code: "TAURI_UNAVAILABLE", message: "Tauri runtime is not available in the browser preview.", details: { command } }`

Determinism requirement:
- Same input/error shape always maps to same `UiAppError.code`.

## 9. Versioning And Compatibility Strategy

Contract identifiers:
- Bridge API version: `bridge.audio.playback.v1`
- Wire contract family: `ipc.playback.v1`

Compatibility rules:
- Command names and request key names are stable within major version.
- Additive response fields are allowed (consumers must ignore unknown fields).
- Removing/renaming fields or commands requires major version bump and migration note.
- Behavior-changing validation/sanitization requires minor version bump + changelog update.

Change-control requirements:
- Any backend command signature change must update:
  - bridge type definitions
  - command map table
  - compatibility section
  - contract tests

## 10. Integration Rules With player-transport And audio-output

Consumer access rules:
- `player-transport` may consume:
  - `setPlaybackQueue`, `pushPlaybackTrackChangeRequest`, `setPlaybackPlaying`, `seekPlaybackRatio`, `setPlaybackVolume`, `togglePlaybackQueueVisibility`, `getPlaybackContext`, `getPlaybackDecodeError`
- `audio-output` may consume:
  - `initPlaybackOutputMode`, `getPlaybackContext`, `getPlaybackDecodeError`

Forbidden integration patterns:
- Consumers must not call `invokeCommand` directly.
- Consumers must not infer backend playback/output truth from request intent.
- Consumers must not bypass bridge validation/sanitization.

## 11. IPC Invariants And Behavioral Guarantees

- No raw `invoke` calls outside bridge module for audio playback path.
- Bridge is stateless; it does not cache, derive, or infer playback state.
- Every exposed method is deterministic for same validated input + backend response.
- All backend response payloads are sanitized before consumer access.
- Bridge never mutates UI state and never emits notices.
- Bridge does not reorder or serialize consumer workflows; sequencing is consumer-owned.

## 12. Strict Dependency Boundaries

Allowed dependencies:
- `@tauri-apps/api/core`
- shared sanitization/type-guard utilities
- local bridge type/validator/sanitizer modules

Forbidden dependencies:
- React hooks/components
- feature module internals (`player-transport`, `audio-output`, shell)
- backend Rust implementation internals
- global app state stores

Boundary enforcement:
- audio bridge public API exported only from bridge entrypoint
- no deep imports into private bridge files from consumers

## 13. Refactor Guardrails

- Do not add transport policy logic to bridge.
- Do not expose untyped `unknown` payloads from bridge methods.
- Do not introduce command-specific behavior in consumers that duplicates bridge validation.
- New playback command integration requires:
  - typed request/response model
  - validator
  - sanitizer
  - error-mapping coverage
  - compatibility note update

## 14. Required Tests

Validation tests:
- invalid args for each command method return `UiAppError(INVALID_ARGUMENT)` and do not invoke backend

Sanitization tests:
- `getPlaybackContext` sanitizes malformed `output_status` fields
- `getPlaybackDecodeError` sanitizes string payload and normalizes invalid shapes
- `initPlaybackOutputMode` rejects invalid hardware response shape

Error mapping tests:
- backend `AppError` passthrough preserves `code/message` contract
- non-AppError invocation failure maps to `TAURI_UNAVAILABLE`

Compatibility tests:
- command names and payload key names match command map
- additive response fields do not break consumers

Boundary tests:
- static/lint guard: no raw `invoke` usage outside `services/tauri/audio/*`
- consumer imports restricted to bridge public entrypoint

## 15. Candidate File Scope (First-Wave Target)

- `apps/desktop/src/services/tauri/audio/index.ts`
- `apps/desktop/src/services/tauri/audio/types.ts`
- `apps/desktop/src/services/tauri/audio/validators.ts`
- `apps/desktop/src/services/tauri/audio/sanitizers.ts`
- `apps/desktop/src/services/tauri/audio/commands.ts`
- `apps/desktop/src/services/tauri/audio/errors.ts`
