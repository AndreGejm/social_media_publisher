# MODULE_SPEC: player-transport

## 1. Module Identity And Architecture Position

- Module name: `player-transport`
- Layer: Frontend bounded runtime module
- Architectural role: single authority for transport lifecycle, queue execution, and source arming in frontend runtime
- Public entrypoint: `apps/desktop/src/modules/player-transport/index.ts`
- Ownership boundary: this module is the only frontend module allowed to mutate transport state

Architecture position:

```text
app/shell + feature UIs
  -> player-transport (state + actions + bridges)
    -> tauri-audio-bridge (native transport commands)
    -> browser audio element fallback
```

Cross-module contracts:
- Provides transport API to shell (`C-001`).
- Provides output-switch handshake to `audio-output` (`C-003`).
- Provides shared transport bridge to `publisher-ops` (`C-008`).
- Consumes transport IPC from `tauri-audio-bridge` (`C-005`).

## 2. Transport Runtime Responsibilities

Owned responsibilities:
- Deterministic play/pause/stop/seek lifecycle.
- Queue execution and queue-index reconciliation.
- Source arming lifecycle for catalog and external sources.
- Runtime engine selection and fallback (`native` vs `browser`).
- Native polling and context synchronization.
- Error normalization and transport-safe recovery.
- Shared bridge exposure for publisher preview workflows.

## 3. Explicit Non-Goals

- Output mode policy ownership (shared/exclusive selection and warning UX).
- Raw Tauri invoke details or IPC schema ownership.
- Catalog/library data ownership.
- UI rendering concerns (buttons, labels, layout decisions).
- Backend state fabrication.

## 4. Public API Definitions

```ts
export type AppNotice = {
  level: "info" | "success" | "warning";
  message: string;
};

export type QueueTrackRef = {
  trackId: string;
  filePath: string;
  durationMs: number;
  title: string;
  artist: string;
};

export type QueueIdentity = {
  revision: string;
  size: number;
};

export type TransportRuntimeEngine = "native" | "browser";

export type TransportLifecycleState =
  | "idle_no_source"
  | "ready_source_armed"
  | "playing"
  | "paused"
  | "seeking"
  | "switch_handshake"
  | "recovering"
  | "error";

export type PlayerSourceKind = "catalog" | "external";

export type PlayerSource = {
  key: string; // catalog:<trackId> or external stable key
  kind: PlayerSourceKind;
  filePath: string;
  title: string;
  artist: string;
  durationMs: number;
  queueTrackId: string | null;
};

export type TransportErrorCode =
  | "INVALID_ARGUMENT"
  | "PLAYBACK_QUEUE_REQUEST_REJECTED"
  | "PLAYBACK_INVALID_VOLUME"
  | "TAURI_UNAVAILABLE"
  | "UNKNOWN_COMMAND"
  | "NATIVE_CONTEXT_UNAVAILABLE"
  | "ARMING_FAILED"
  | "PLAYBACK_START_FAILED"
  | "SEEK_FAILED"
  | "OUTPUT_SWITCH_CONFLICT"
  | "UNEXPECTED_UI_ERROR";

export type TransportError = {
  code: TransportErrorCode;
  message: string;
  retryable: boolean;
  source: "player-transport" | "tauri-audio-bridge" | "browser-audio";
};

export type PlayerTransportState = {
  lifecycleState: TransportLifecycleState;
  runtimeEngine: TransportRuntimeEngine;
  queueIdentity: QueueIdentity;
  queueIndex: number;
  playerTrackId: string;
  playerSource: PlayerSource | null;
  playerTimeSec: number;
  playerIsPlaying: boolean;
  volumeScalar: number;
  isQueueVisible: boolean;
  isVolumeMuted: boolean;
  nativeTransportChecked: boolean;
  nativeTransportEnabled: boolean;
  pendingActionCount: number;
  lastContextSeq: number;
  lastError: TransportError | null;
};

export type PlayerTransportActions = {
  setPlayerTrack(trackId: string): void;
  togglePlay(): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seekToRatio(ratio: number): Promise<void>;
  setVolumeScalar(level: number): Promise<void>;
  setQueueVisible(visible: boolean): Promise<boolean>;
  toggleMute(): Promise<void>;
};

export type TransportOutputSwitchHandshake = {
  prepareForOutputSwitch(input: {
    reason: "output_mode_change";
    targetMode: "shared" | "exclusive";
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
    finalMode: "shared" | "exclusive" | "released";
    resumeAllowed: boolean;
  }): Promise<{
    resumed: boolean;
    pausedForSafety: boolean;
  }>;
};

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

export type UsePlayerTransportControllerArgs = {
  queue: QueueTrackRef[];
  selectedTrackId: string | null;
  onNotice: (notice: AppNotice) => void;
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

## 5. Transport State Model

Authoritative state rules:
- `state` is the only shell-consumable transport snapshot.
- No consumer may mutate state directly.
- All state writes are performed by serialized transport actions or polling commits.

State field guarantees:
- `queueIdentity.revision` changes only when queue content/order changes.
- `queueIndex` is `-1` when source is external or no matching queue track exists.
- `playerSource` is `null` when unarmed.
- `playerIsPlaying=true` implies `playerSource !== null`.
- `nativeTransportEnabled=true` implies runtime engine `native`.

## 6. Playback Lifecycle State Machine

States:
- `idle_no_source`
- `ready_source_armed`
- `playing`
- `paused`
- `seeking`
- `switch_handshake`
- `recovering`
- `error`

Allowed transitions:
- `idle_no_source -> ready_source_armed` (source armed)
- `ready_source_armed -> playing` (play)
- `playing -> paused` (pause)
- `playing|paused|ready_source_armed -> seeking -> prior stable state`
- `playing|paused|ready_source_armed -> switch_handshake -> paused|ready_source_armed`
- `any stable state -> recovering -> paused|ready_source_armed|idle_no_source`
- `any state -> error` (unrecoverable operation failure)

Forbidden transitions:
- `idle_no_source -> playing` without successful arming
- `switch_handshake -> playing` directly
- `error -> playing` without explicit successful recovery action

Behavior in `error`:
- transport remains callable
- next successful deterministic action transitions to a stable non-error state

## 7. Queue Semantics And Mutation Rules

Queue contract:
- Input queue is authoritative and treated as immutable by consumers.
- Queue normalization removes invalid entries and preserves deterministic order.

Atomic queue mutation rules:
1. Compute next `QueueIdentity` from normalized `trackId + order`.
2. Apply queue snapshot and identity in one commit.
3. Reconcile active source/index in same commit.
4. If active catalog source no longer exists, unarm source and pause playback.

Deterministic reconciliation priority:
1. `selectedTrackId` if present in queue.
2. Existing armed catalog source if still present.
3. Unarmed (`idle_no_source`).

No partial queue application is allowed.

## 8. Source Arming Lifecycle And Invariants

Arming states:
- `unarmed`
- `arming`
- `armed`

Rules:
- Exactly one source may be armed at a time.
- Source arming is transaction-based with monotonic `armTxnId`.
- Stale arming completions (`armTxnId` older than latest) are discarded.
- Arming catalog source must resolve to queue index when possible.
- Arming external source never mutates queue contents.

Arming invariants:
- `playerSource.key` is unique per active source instance.
- Arming failure never clears a previously valid armed source unless explicitly replacing source.
- Autoplay requests are bound to source key and cleared only when resolved.

## 9. Native Vs Browser Fallback Policy

Runtime engine selection:
- Preferred: `native` when bridge is available and healthy.
- Fallback: `browser` when native path is unavailable or explicitly degraded.

Fallback triggers:
- bridge errors with `TAURI_UNAVAILABLE` or `UNKNOWN_COMMAND`
- repeated native context poll failures
- explicit native initialization failure from output-switch flow

Fallback behavior guarantees:
- queue identity and selected source intent are preserved.
- playback is moved to paused-safe state before switching engine.
- no queue corruption or source duplication.
- fallback does not fabricate backend status.

## 10. Shared Transport Bridge Interface And Constraints

Publisher bridge ownership:
- `player-transport` owns implementation and lifecycle.
- `publisher-ops` is a consumer only.

Constraints:
- `ensureSource` is idempotent for same source fields.
- concurrent `ensureSource` calls resolve last-write-wins.
- `ensureSource` may arm external source and optional autoplay request only.
- `seekToRatio` is a no-op if `sourceKey` does not match active source.
- bridge methods must not mutate queue ordering or transport internals outside declared surface.

## 11. Polling And Backend Update Integration

Polling policy:
- Polling is active only when `runtimeEngine === "native"`.
- Interval: 250 ms.
- Poll source: bridge `getPlaybackContext()` then `getPlaybackDecodeError()`.

Commit model:
- Each poll cycle gets incrementing `contextSeq`.
- Only latest `contextSeq` may commit state.
- Out-of-order poll completions are ignored.

Polling failure handling:
- recoverable transient error: set `lastError`, keep runtime engine unchanged.
- fallback-class error (`TAURI_UNAVAILABLE`, `UNKNOWN_COMMAND`): trigger safe browser fallback.

## 12. Error Taxonomy

Error classes:
- Validation: bad input (`INVALID_ARGUMENT`).
- Queue/source: rejected arming or queue operation (`PLAYBACK_QUEUE_REQUEST_REJECTED`, `ARMING_FAILED`).
- Native runtime: bridge/context failures (`NATIVE_CONTEXT_UNAVAILABLE`, `TAURI_UNAVAILABLE`, `UNKNOWN_COMMAND`).
- Playback operations: play/seek/volume failures (`PLAYBACK_START_FAILED`, `SEEK_FAILED`, `PLAYBACK_INVALID_VOLUME`).
- Internal: unexpected runtime exceptions (`UNEXPECTED_UI_ERROR`, `OUTPUT_SWITCH_CONFLICT`).

Error handling rules:
- All async actions reject with `TransportError`.
- User-facing error strings are sanitized.
- Retryable errors must not leave half-applied state.

## 13. Invariants And Behavioral Guarantees

- Transport actions are serialized through one action executor.
- Queue mutation is atomic and deterministic.
- Only one source is armed at any time.
- `togglePlay/play/pause/seek/stop` never execute concurrently.
- Fallback never mutates queue order or `queueIdentity`.
- Output switch handshake cannot bypass transport ownership.
- Publisher bridge cannot directly mutate queue/transport internals.
- UI consumes state only; no playback logic in UI components.

## 14. Dependency Rules And Module Boundaries

Allowed dependencies:
- `tauri-audio-bridge` public transport API only.
- shared pure helpers (`sanitize`, transport math, media-url utilities).
- React primitives.

Forbidden dependencies:
- `app/shell/*` internals.
- `audio-output` internals (audio-output depends on handshake contract, not vice versa).
- direct `@tauri-apps/api/*` usage.
- backend command names or raw invoke calls.

Boundary rule:
- Consumers import only `player-transport` public entrypoint.

## 15. Refactor Guardrails

- Do not reintroduce transport logic into shell/components.
- Do not expose internal refs/timers/queues on public API.
- Keep public action signatures stable; breaking changes require version bump.
- No hidden cross-module deep imports.
- Keep publisher bridge narrow; do not add queue mutation methods to it.
- Mode switching must use handshake contract only.

## 16. Required Tests

Provider contract tests:
- action serialization under rapid play/pause/seek input
- deterministic lifecycle transitions and forbidden transition rejection
- queue mutation atomicity with reconciliation edge cases
- single-source-armed invariant under concurrent arming requests
- native-to-browser fallback preserving queue/source state
- stale poll update rejection by `contextSeq`
- handshake prepare/restore deterministic behavior

Consumer integration tests:
- shell consumes only `state` + `actions` from public entrypoint
- UI never calls transport internals or backend APIs directly
- publisher bridge idempotency and source-key mismatch no-op behavior

Regression tests:
- queue update during active playback
- autoplay request against changing source
- fallback during active playback with subsequent resume attempt
- decode error reporting without transport crash

## 17. Candidate File Scope (First-Wave Target)

- `apps/desktop/src/modules/player-transport/index.ts`
- `apps/desktop/src/modules/player-transport/controller/*`
- `apps/desktop/src/modules/player-transport/state/*`
- `apps/desktop/src/modules/player-transport/bridges/*`
- `apps/desktop/src/modules/player-transport/test/*`
