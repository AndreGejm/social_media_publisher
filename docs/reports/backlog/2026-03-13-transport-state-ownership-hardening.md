BACKLOG INVESTIGATION TICKET

Title
Transport state ownership remains split across queue lifecycle, runtime polling, and workspace shell state

Severity
Medium

User Impact
Rapid source switching, autoplay handoffs, queue mutation during playback, and fallback/native transport transitions can still produce edge cases that are difficult to reason about and expensive to verify. The current release-hardening pass fixed two concrete stale-async paths, but broader state drift risk remains if we keep adding behavior on top of the split ownership model.

Root Cause Hypothesis
Transport state is owned by multiple cooperating hooks rather than one bounded coordinator. Queue advancement, autoplay intent, native runtime polling, browser-audio fallback state, and workspace-level selected-source state are updated in different modules with asynchronous side effects and only partial invariant coverage.

Affected Modules
- apps/desktop/src/features/player-transport/hooks/usePlayerTransportRuntimeState.ts
- apps/desktop/src/features/player-transport/hooks/useTransportQueueLifecycle.ts
- apps/desktop/src/features/player-transport/hooks/useTransportPlaybackActions.ts
- apps/desktop/src/features/workspace/WorkspaceRuntime.tsx

Why It Is Risky
A broader fix would be cross-cutting and could destabilize core playback workflows without stronger regression coverage. The current code is shippable, but ownership boundaries are still diffuse enough that a larger cleanup would effectively be a transport-system redesign rather than a safe hardening patch.

Recommended Next Step
Define a narrow transport ownership contract first: which module is authoritative for selected source, queue index, playing state, and autoplay intent in native and browser-fallback modes. Then add rapid-switch regression coverage before changing production coordination logic.

Minimum Test Coverage Needed Before Implementation
- Rapid switching between library, playlists, QC, and video workspace while playback is active
- Queue mutation during playback, including removal of the current and next items
- Native transport to browser fallback handoff and recovery
- Repeated Next/Prev/autoplay transitions with async backend delays injected
- Stale-response protection around selected track, queue index, and playing state updates
