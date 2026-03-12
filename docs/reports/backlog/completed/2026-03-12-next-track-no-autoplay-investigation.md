BACKLOG INVESTIGATION TICKET

Title
Native transport autoplay is cancelled after track-change requests

Problem Statement
After track end or Play Now, the next track can be selected but playback does not continue automatically, suggesting autoplay intent is being overridden in transport lifecycle effects.

User/System Impact
Core listening flow is interrupted; users must manually press Play after transitions that are expected to autoplay.

Observed Behavior
Next track is loaded after track end or Play Now, but playback does not reliably continue.

Expected Behavior
When autoplay is requested, track selection should transition directly into active playback.

Evidence

- Autoplay path explicitly starts playback and then clears `autoplayRequestSourceKey` (`apps/desktop/src/features/player-transport/hooks/useTransportQueueLifecycle.ts:169`, `apps/desktop/src/features/player-transport/hooks/useTransportQueueLifecycle.ts:191`).

- A separate native effect runs when `autoplayRequestSourceKey` is null and forces `setPlaybackPlaying(false)` while arming track state (`apps/desktop/src/features/player-transport/hooks/useTransportQueueLifecycle.ts:110`, `apps/desktop/src/features/player-transport/hooks/useTransportQueueLifecycle.ts:121`).

- Another effect resets playback to stopped on `playerSource` changes in native mode (`apps/desktop/src/features/player-transport/hooks/useTransportQueueLifecycle.ts:69`, `apps/desktop/src/features/player-transport/hooks/useTransportQueueLifecycle.ts:75`).

- Track-end and Next handlers request autoplay via `setPlayerTrackFromQueueIndex(..., { autoplay: true })` (`apps/desktop/src/features/workspace/WorkspaceRuntime.tsx:1247`, `apps/desktop/src/features/workspace/WorkspaceRuntime.tsx:1297`).

Hypotheses

- Post-autoplay state cleanup (`autoplayRequestSourceKey -> null`) re-enables the arm-only effect, which immediately pauses playback.

- Native player-source reset effect races with autoplay startup and intermittently cancels play state.

Unknowns / Missing Evidence

- Which pause path wins in real runtime ordering (arm effect vs source-change reset effect).

- Whether issue reproduces only in native transport mode or also browser fallback mode.

- Whether both triggers (track-end and Play Now) fail through identical call sequencing.

Classification

Severity
High

Type
Logic/race condition

Surface Area
Frontend transport lifecycle (native playback)

Ownership Suggestion

Primary Module
Player transport lifecycle hooks

Primary Directory
apps/desktop/src/features/player-transport/hooks

Likely Files

apps/desktop/src/features/player-transport/hooks/useTransportQueueLifecycle.ts

apps/desktop/src/features/workspace/WorkspaceRuntime.tsx

apps/desktop/src/features/play-list/hooks/usePlayListActions.ts

Likely Functions / Entry Points

useTransportQueueLifecycle (autoplay + arm effects)

setPlayerTrackFromQueueIndex

handlePlayerAudioEnded

Investigation Scope
Focus on autoplay state transitions in native transport only: identify why playback is stopped after autoplay request completion. Keep out of scope any broader queue-feature redesign or unrelated transport refactors.

Suggested First Investigation Steps

- Instrument `useTransportQueueLifecycle` effects with ordered logs for `autoplayRequestSourceKey`, `queueIndex`, and `setPlaybackPlaying` calls.

- Reproduce using both Play Now and natural track-end transitions and capture call order.

- Verify whether `setPlaybackPlaying(false)` is invoked immediately after successful autoplay start.

- Confirm expected behavior with a targeted test covering autoplay request completion and subsequent effect runs.

Exit Criteria for Investigation

- Exact effect/call sequence that cancels autoplay is documented.

- A deterministic repro case exists in test or trace form for both trigger paths.

Priority Recommendation
Now

Confidence
High

Tags

autoplay

transport

playback
