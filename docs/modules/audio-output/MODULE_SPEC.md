# MODULE_SPEC: audio-output

## Module identity

- Name: `audio-output`
- Layer: Frontend bounded module
- Spec version: `1.0.0`
- Spec status: `REFACTOR_READY`
- Primary owner: Desktop Audio UX + Playback Integration
- Canonical public entrypoint (target): `apps/desktop/src/modules/audio-output/index.ts`

## Purpose

Provide a deterministic, shell-consumable controller for playback output mode policy and output status projection.

This module owns:
- shared vs exclusive mode request policy
- safe mode-switch orchestration through declared contracts
- backend-truth status projection (including bit-perfect eligibility as reported, not inferred)

This module does not own playback transport internals or raw IPC invocation.

## Owned responsibilities

- Default startup output intent to `shared` (no implicit exclusive acquisition).
- Expose one public hook (`useAudioOutputController`) for shell composition.
- Execute output mode switches via:
  - `player-transport` handshake contract (prepare/restore)
  - `tauri-audio-bridge` output commands
- Maintain deterministic transition state for UI and testability.
- Normalize backend output status into typed, machine-readable UI status.
- Guarantee safe fallback behavior when exclusive acquisition fails.
- Publish user-safe warnings/notices without mutating shell state directly.

## Explicit non-goals

- Queue ownership, queue selection, and queue synchronization logic.
- Play/pause/seek implementation details.
- Any direct imports of provider internals from `player-transport` or `tauri-audio-bridge`.
- Any direct `@tauri-apps/api/*` usage.
- Claiming guaranteed bitstream passthrough from exclusive mode.

## Public entrypoint(s)

- `apps/desktop/src/modules/audio-output/index.ts` (single entrypoint; no deep imports allowed)
- Exported API symbols:
  - `useAudioOutputController`
  - `AudioOutputMode`
  - `AudioOutputControllerState`
  - `AudioOutputStatusView`
  - `AudioOutputReasonCode`
  - `AudioOutputControllerError`
  - `OutputModeRequestResult`

## Full TypeScript API surface

```ts
export type AudioOutputMode = "shared" | "exclusive";
export type AudioOutputRuntimeMode = AudioOutputMode | "released";

export type AudioOutputTransitionState =
  | "idle"
  | "switching_prepare_transport"
  | "switching_apply_backend_mode"
  | "switching_restore_transport"
  | "recovering_to_shared"
  | "terminal_error";

export type AudioOutputReasonCode =
  | "NOT_EXCLUSIVE_MODE"
  | "EXCLUSIVE_LOCK_NOT_ACTIVE"
  | "VOLUME_NOT_UNITY"
  | "DSP_OR_SCALING_ACTIVE"
  | "SAMPLE_RATE_CONVERSION_ACTIVE"
  | "BIT_DEPTH_MISMATCH"
  | "SOFTWARE_PCM_PATH"
  | "STATUS_UNAVAILABLE"
  | "BACKEND_REASON_UNMAPPED";

export type AudioOutputReason = {
  code: AudioOutputReasonCode;
  message: string; // sanitized, user-facing, max 512 chars
  source: "backend" | "frontend-mapper";
  backendKey?: string; // set only when code === BACKEND_REASON_UNMAPPED
};

export type AudioFormatProvenance =
  | "backend_reported_active_stream"
  | "backend_reported_unavailable";

export type AudioOutputStatusView = {
  requestedMode: AudioOutputMode;
  activeMode: AudioOutputRuntimeMode;
  bitPerfectEligible: boolean;
  reasons: AudioOutputReason[];
  sampleRateHz: number | null;
  bitDepth: number | null;
  formatProvenance: AudioFormatProvenance;
  observedAtIso: string; // ISO-8601, update on each accepted backend snapshot
};

export type AudioOutputControllerErrorCode =
  | "INVALID_ARGUMENT"
  | "SWITCH_IN_PROGRESS"
  | "EXCLUSIVE_AUDIO_UNAVAILABLE"
  | "TRANSPORT_PREPARE_FAILED"
  | "TRANSPORT_RESTORE_FAILED"
  | "BACKEND_OUTPUT_INIT_FAILED"
  | "BACKEND_STATUS_UNAVAILABLE"
  | "TAURI_UNAVAILABLE"
  | "UNKNOWN_COMMAND"
  | "UNEXPECTED_UI_ERROR";

export type AudioOutputControllerError = {
  code: AudioOutputControllerErrorCode;
  message: string;
  details?: unknown;
  retryable: boolean;
  source: "audio-output" | "tauri-audio-bridge" | "player-transport" | "backend";
};

export type OutputModeRequestResult = {
  accepted: boolean;
  applied: boolean;
  requestedMode: AudioOutputMode;
  finalRequestedMode: AudioOutputMode;
  finalActiveMode: AudioOutputRuntimeMode;
  fallbackApplied: boolean;
  noOp: boolean;
  warningCode?:
    | "EXCLUSIVE_MAY_BLOCK_OTHER_APPS"
    | "EXCLUSIVE_FALLBACK_TO_SHARED"
    | "RESTORE_PAUSED_FOR_SAFETY";
};

export type TransportOutputSwitchHandshake = {
  prepareForOutputSwitch(input: {
    reason: "output_mode_change";
    targetMode: AudioOutputMode;
  }): Promise<{
    token: string;
    wasPlaying: boolean;
    sourceKey: string | null;
    queueRevision: string;
    queueIndex: number;
    positionSec: number;
    capturedAtIso: string;
  }>;
  restoreAfterOutputSwitch(input: {
    token: string;
    outcome: "applied" | "fallback_shared" | "failed";
    finalMode: AudioOutputRuntimeMode;
    resumeAllowed: boolean;
  }): Promise<{
    resumed: boolean;
    pausedForSafety: boolean;
  }>;
};

export type UseAudioOutputControllerArgs = {
  targetSampleRateHz: number;
  targetBitDepth: 16 | 24 | 32;
  transportHandshake: TransportOutputSwitchHandshake;
  onNotice: (notice: { level: "info" | "success" | "warning"; message: string }) => void;
};

export type AudioOutputControllerState = {
  requestedMode: AudioOutputMode;
  activeMode: AudioOutputRuntimeMode;
  transitionState: AudioOutputTransitionState;
  switching: boolean; // derived: transitionState !== "idle" && transitionState !== "terminal_error"
  status: AudioOutputStatusView;
  lastError: AudioOutputControllerError | null;
  hasShownExclusiveWarning: boolean;
};

export type AudioOutputController = {
  state: AudioOutputControllerState;
  requestOutputMode(mode: AudioOutputMode): Promise<OutputModeRequestResult>;
  refreshStatus(): Promise<void>;
};

export declare function useAudioOutputController(
  args: UseAudioOutputControllerArgs
): AudioOutputController;
```

## Exact input/output/status/error types

- Input validation:
  - `targetSampleRateHz` must be finite integer in `[8000, 384000]`.
  - `targetBitDepth` must be `16 | 24 | 32`.
  - `transportHandshake` methods must exist and return promised typed results.
  - `onNotice` must be non-throwing (throws are swallowed and logged by provider).
- Output mode request semantics:
  - `requestOutputMode(mode)` is `async`.
  - Calls are serialized per controller instance.
  - Same-mode requests are idempotent:
    - If `mode === state.requestedMode` and no transition in progress, resolve with `noOp: true`.
  - Not cancellable once started.
  - Rapid repeated toggles are coalesced by last-write-wins queue of depth `1`:
    - while one switch is active, latest requested mode replaces pending queued request.
    - after active switch settles, queued request executes if it differs from settled `requestedMode`.
- Error type:
  - Provider methods reject only `AudioOutputControllerError`.
  - Backend/bridge/provider errors must be mapped to defined `AudioOutputControllerErrorCode`.

## State machine definition for output mode transitions

### States

- `idle`: stable, backend-confirmed status available or explicitly unavailable.
- `switching_prepare_transport`: acquiring deterministic transport snapshot and pause boundary.
- `switching_apply_backend_mode`: attempting backend output init for target mode.
- `switching_restore_transport`: restoring transport based on switch outcome.
- `recovering_to_shared`: exclusive failed; shared fallback path running.
- `terminal_error`: both requested switch and required fallback failed; module remains usable but reports hard failure.

### Transition rules

1. `idle -> switching_prepare_transport`
   - Trigger: accepted `requestOutputMode(mode)` with non-noop mode.
2. `switching_prepare_transport -> switching_apply_backend_mode`
   - Condition: handshake prepare succeeded.
3. `switching_apply_backend_mode -> switching_restore_transport`
   - Condition: backend init succeeded for requested mode.
4. `switching_apply_backend_mode -> recovering_to_shared`
   - Condition: requested mode is `exclusive` and backend init failed with recoverable error.
5. `recovering_to_shared -> switching_restore_transport`
   - Condition: shared fallback init succeeded.
6. `recovering_to_shared -> terminal_error`
   - Condition: shared fallback init failed.
7. `switching_restore_transport -> idle`
   - Condition: restore completed and state snapshot refreshed.
8. `switching_prepare_transport -> terminal_error`
   - Condition: prepare failed (no backend changes allowed).

### Terminal error handling

- `terminal_error` does not freeze the module.
- Next explicit `requestOutputMode("shared")` must be accepted as recovery attempt.
- `state.lastError` must be populated with typed code/message.

## Normative meaning of requestedMode vs activeMode

- `requestedMode`:
  - The currently adopted controller intent after applying fallback policy.
  - On exclusive failure with successful shared fallback, `requestedMode` MUST become `shared`.
- `activeMode`:
  - Backend-confirmed effective runtime mode from latest accepted status snapshot.
  - Never inferred from user intent or optimistic UI.
- During transition:
  - `requestedMode` may differ from `activeMode`.
  - UI must render `activeMode` as truth and may show pending intent via transition state.

## Nullability and provenance for sampleRateHz and bitDepth

- `sampleRateHz` and `bitDepth` come only from backend status.
- They MUST be `null` when:
  - backend reports no active output stream (`activeMode === "released"`), or
  - backend status omits/invalidates format fields.
- `formatProvenance` rules:
  - `"backend_reported_active_stream"` when both fields are non-null and backend-sourced.
  - `"backend_reported_unavailable"` when one or both fields are `null`.

## Preconditions

- Module initialized with valid args.
- Shell imports only public entrypoint exports.
- Bridge contract (`C-004`) and handshake contract (`C-003`) are available.
- Startup flow calls `requestOutputMode("shared")` or equivalent default bootstrap path.

## Postconditions

- After successful switch:
  - `state.transitionState === "idle"`.
  - `state.activeMode` equals backend-confirmed mode.
  - `state.requestedMode` equals final adopted intent.
  - `state.status.observedAtIso` updated.
- After any switch attempt:
  - `switching === false`.
  - stale async updates from superseded requests are ignored.

## Failure postconditions

- If exclusive acquisition fails after transport prepare succeeds:
  - Module MUST attempt shared fallback (`recovering_to_shared`).
  - On successful fallback:
    - `finalRequestedMode === "shared"`
    - `finalActiveMode` backend-confirmed (`"shared"` or `"released"` if backend indicates release)
    - `fallbackApplied === true`
    - transport restore MUST run with `outcome: "fallback_shared"`.
  - On fallback failure:
    - enter `terminal_error`
    - call transport restore with `outcome: "failed"` and `resumeAllowed: false`
    - surface typed `lastError`
- Module must remain callable after failures; no permanent lock state.

## Concurrency and race-handling rules

- Single active switch transaction per controller instance.
- Requests are serialized; pending queue depth is exactly `1` (last-write-wins).
- Transaction tokening:
  - each accepted switch gets a monotonically increasing `txnId`.
  - async completions with stale `txnId` MUST be discarded.
- `refreshStatus()` during switch:
  - allowed, but status updates are ignored if older than current transaction snapshot.
- Non-cancellable execution:
  - once transaction starts, it must run to completion (success, fallback success, or terminal error).

## Allowed dependencies (public-entrypoint-only rule)

- `player-transport`:
  - allowed only through its exported handshake contract type and methods.
- `tauri-audio-bridge`:
  - allowed only through exported audio-output command/status API.
- `shared/lib`:
  - safe pure helpers (sanitize, type guards, formatting).
- React runtime primitives.

Rule:
- Imports from dependency internals are forbidden. Only each module's public entrypoint is allowed.

## Forbidden dependencies

- `app/shell/*` internals.
- `features/*` internals outside declared contracts.
- Direct `@tauri-apps/api/*` calls.
- Any backend command names or wire-shape constants outside bridge exports.
- `player-transport` state/actions beyond handshake surface.

## Integration sequence with player-transport handshake and tauri-audio-bridge

Normative sequence for `requestOutputMode(targetMode)`:

1. Validate input and idempotency shortcut.
2. Enter `switching_prepare_transport`.
3. Call `transportHandshake.prepareForOutputSwitch(...)`.
4. Enter `switching_apply_backend_mode`.
5. Call bridge init for `targetMode`.
6. If step 5 fails and `targetMode === "exclusive"`:
   - emit warning notice
   - enter `recovering_to_shared`
   - call bridge init for `shared`
7. Enter `switching_restore_transport`.
8. Call `transportHandshake.restoreAfterOutputSwitch(...)` with exact outcome.
9. Refresh backend status.
10. Commit state atomically and return result.

Forbidden integration shortcuts:
- no direct transport action calls (`play/pause/seek`) from this module
- no backend status fabrication in frontend

## Invariants

- Shared mode is the startup default intent.
- Exclusive mode requires explicit user invocation.
- Backend-confirmed status is source of truth for `activeMode` and eligibility fields.
- `bitPerfectEligible === true` is never interpreted as guaranteed encoded-bitstream passthrough.
- Every status reason is machine-readable (`AudioOutputReasonCode`) and sanitized.
- Transition state is always one of declared enum values; no implicit transient state.

## Required tests

Provider contract tests:
- shared default bootstrap path
- idempotent same-mode request returns `noOp: true`
- exclusive success path with prepare/apply/restore ordering assertions
- exclusive failure -> shared fallback -> restore sequence
- fallback failure -> `terminal_error` with typed error
- stale async completion is ignored (txnId race test)
- rapid toggle burst coalesces to final queued mode deterministically

Consumer integration tests:
- shell consumes only public entrypoint symbols
- shell displays active mode from backend-truth state
- shell warning behavior for first exclusive request

Bridge/contract tests:
- typed reason-code mapping from backend reasons
- nullability/provenance behavior for `sampleRateHz` and `bitDepth`
- no raw invoke usage inside module (static check)

## Refactor guardrails

- No broad transport refactor inside audio-output migration.
- Keep controller API stable once adopted; version bump required for breaking changes.
- Do not reintroduce output-mode logic into shell or transport internals.
- Do not expose internal refs/timers/state machine internals through public API.
- Do not convert reason codes back to free-form untyped strings in public status.
- Any new dependency requires explicit module-spec update and contract review.

## Candidate file scope (first-wave target)

- `apps/desktop/src/modules/audio-output/index.ts` (public API only)
- `apps/desktop/src/modules/audio-output/controller/*`
- `apps/desktop/src/modules/audio-output/state/*`
- `apps/desktop/src/modules/audio-output/mappers/*`
- `apps/desktop/src/modules/audio-output/test/*`
