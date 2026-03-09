# System Module Map

Phase: 1 (Boundary discovery update pass only)  
Status: Audit clarified, no refactor started

## Scope and method

- Discovery scope remains unchanged:
  - `apps/desktop/src/app/shell`
  - `apps/desktop/src/features`
  - `apps/desktop/src/services/tauri`
  - `apps/desktop/src-tauri/src`
- This document is a refinement pass only.
- No files were moved, renamed, split, or rewritten in code.

## Boundary strength scale

- `Strong`: clear ownership and low cross-module leakage.
- `Likely`: mostly coherent but with moderate coupling.
- `Weak`: behavior requires broad cross-repo tracing.

## Subsystem overview (current host vs target owner)

| Subsystem | Current host files | Target owning module | Migration target module | Boundary strength (current) | Minimal integration points (post-Phase-3 intent) | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| App shell and composition | `apps/desktop/src/app/shell/AppShell.tsx`<br>`apps/desktop/src/app/shell/WorkspaceApp.tsx`<br>`apps/desktop/src/features/workspace/WorkspaceFeature.tsx` | `app-shell` composition layer | `app-shell` | Weak | `WorkspaceApp.tsx` (composition-only)<br>`player-transport` public API<br>`audio-output` public API<br>`TauriClientProvider.tsx` | `WorkspaceApp.tsx` (1490 lines) still mixes composition + behavior wiring. |
| Player transport (frontend runtime) | `apps/desktop/src/features/player/hooks/usePlayerTransportState.ts`<br>`apps/desktop/src/features/player/hooks/usePlayerShellSync.ts`<br>`apps/desktop/src/features/player/hooks/useQueueState.ts`<br>`apps/desktop/src/features/player/hooks/usePlayerTrackDetailPrefetch.ts` | `player-transport` | `player-transport` | Weak | `WorkspaceApp.tsx` -> transport facade<br>`audio-output` switch handshake contract<br>`tauri-audio-bridge` transport API<br>publisher shared-transport contract | Boundary tightened in this revision: transport currently hosts non-transport concerns that must move out (listed below). |
| Audio output (mode + eligibility + status) | Frontend host: `apps/desktop/src/features/player/SharedPlayerBar.tsx` + output-related slices in `usePlayerTransportState.ts`<br>Bridge host: playback calls in `apps/desktop/src/services/tauri/tauri-api.ts`<br>Backend host: `apps/desktop/src-tauri/src/commands/playback.rs` + playback sections in `apps/desktop/src-tauri/src/commands.rs` | `audio-output` | `audio-output` | Weak | Output status line/UI render point<br>`player-transport` switch lifecycle handshake<br>audio Tauri adapter boundary<br>backend output-status contract | Converted from “cross-cutting concern” to first-class target module in this update. |
| Tauri audio IPC adapter | Audio commands currently embedded in `apps/desktop/src/services/tauri/tauri-api.ts` and re-exported via `tauriClient.ts` | `tauri-audio-bridge` | `tauri-audio-bridge` | Likely | `audio-output` module<br>`player-transport` module<br>Rust audio command boundary (`audio_output.rs` + playback command wrappers) | Current file-level adapter exists, but audio contracts are mixed into a broad multi-domain API file. |
| Backend audio runtime and playback lifecycle | Playback implementation concentrated in `apps/desktop/src-tauri/src/commands.rs` + wrappers in `apps/desktop/src-tauri/src/commands/playback.rs` | `backend-audio-service` + `backend-player-transport-service` | `backend-audio-service` | Weak | `src-tauri/src/commands/audio_output.rs` (mode/status command entry)<br>`src-tauri/src/commands/playback.rs` (transport command entry)<br>typed TS bridge contracts | Renamed to responsibility-based service ownership (no more file-centric “core” naming). |
| Catalog and library metadata | Frontend: `features/play-list`, `features/library-ingest`, `features/track-detail`<br>Backend: `commands/catalog.rs` + catalog handlers in `commands.rs` | `backend-catalog-service` (+ aligned frontend catalog modules) | `backend-catalog-service` | Likely | Catalog list/get/update contracts via Tauri adapter<br>track-selection API to player transport | Domain is coherent but still orchestrated heavily by shell-level state wiring. |
| QC preview and batch export | Frontend: `apps/desktop/src/features/player/hooks/useQcPreviewLifecycle.ts`<br>Backend: `apps/desktop/src-tauri/src/commands/qc.rs` + QC internals in `commands.rs` | `qc-preview` frontend module + backend service split (`backend-audio-service` integration + qc service) | `qc-preview` | Likely | QC session API<br>player-transport source bridge contract<br>audio artifact generation service contract | Coupling persists because QC lifecycle mutates shared transport state directly. |
| Publishing workflow | Frontend: `features/publisher-ops`, `features/publish-selection`<br>Backend: `commands/release.rs` + release handlers in `commands.rs` | `backend-publishing-service` (+ frontend publishing modules) | `backend-publishing-service` | Likely | Publish selection contract<br>publisher shared transport bridge<br>release plan/execute/report commands | Domain boundary exists but handoff from listen mode still crosses shell and transport concerns. |
| Shared primitives and infrastructure | `apps/desktop/src/shared/*`<br>`apps/desktop/src/app/state/localStorage.ts`<br>`apps/desktop/src/infrastructure/tauri/dragDrop.ts` | `shared-primitives` + `platform-integration` | `shared-primitives` | Strong (shared), Likely (infra) | shared UI + sanitize functions<br>feature modules consume via public utilities only | Keep shared scope narrow; avoid re-introducing dumping-ground behavior. |

## Player-transport boundary cleanup (required before Phase 3)

### Responsibilities that stay in `player-transport`

- Playback transport lifecycle: play/pause/stop/seek.
- Queue arming and track-change request flow.
- Source activation and deterministic resume behavior.
- Native-vs-legacy playback execution mechanics.
- Publisher shared transport bridge state projection.

### Responsibilities that must leave `player-transport`

- Output mode selection policy (`shared` default + exclusive opt-in policy).
- Output mode warning UX policy and user messaging.
- Requested vs active output mode state ownership.
- Bit-perfect eligibility interpretation and reasons presentation policy.
- Exclusive acquisition fallback policy framing (as output-policy concern).

### Destination for moved responsibilities

- Target owner: `audio-output`.
- Integration contract between modules: explicit switch handshake (`prepareForOutputSwitch` / `restoreAfterOutputSwitch` style contract).

## First-class audio-output module (clarified ownership)

### Current host files

- Frontend:
  - `apps/desktop/src/features/player/SharedPlayerBar.tsx`
  - output-related portions of `apps/desktop/src/features/player/hooks/usePlayerTransportState.ts`
- Bridge:
  - playback output command calls inside `apps/desktop/src/services/tauri/tauri-api.ts`
- Backend:
  - `apps/desktop/src-tauri/src/commands/playback.rs`
  - playback output sections in `apps/desktop/src-tauri/src/commands.rs`

### Target ownership

- `apps/desktop/src/features/audio-output/*`
- `apps/desktop/src/integrations/tauri/audio/*`
- `apps/desktop/src-tauri/src/commands/audio_output.rs`
- `apps/desktop/src-tauri/src/services/audio_output/*`

### Minimal integration points after Phase 3

- Shell composes only `audio-output` public API.
- `player-transport` exposes switch lifecycle handshake API only.
- Tauri adapter exports typed audio-output contract only (no deep imports).
- Backend exposes output status truth contract to the adapter boundary.

## Responsibility-based backend owners (replacing file-central naming)

- `backend-audio-service`
  - owns output mode runtime behavior and output status derivation.
- `backend-player-transport-service`
  - owns queue/playback transport lifecycle semantics.
- `backend-catalog-service`
  - owns catalog/library root/ingest metadata command behavior.
- `backend-publishing-service`
  - owns release plan/execute/report workflow command behavior.

Note: these are ownership targets for migration planning; current code is still concentrated in `commands.rs`.

## Dependency direction (current observed)

- `app/shell` -> `features/* hooks + UI` -> `services/tauri/*` -> `src-tauri commands/*` -> backend service logic in `commands.rs`.

## Dependency direction (target enforcement intent)

- `app/shell` -> module public APIs only (`player-transport`, `audio-output`, publishing/catalog modules).
- `player-transport` -> `tauri-audio-bridge` (transport contracts) and `audio-output` handshake only.
- `audio-output` -> `tauri-audio-bridge` (output contracts) + transport handshake only.
- TS bridge -> Rust command entrypoints only.
- Rust command entrypoints -> responsibility-owned backend services.

## Boundary strength summary (updated)

- Strong: shared primitives.
- Likely: catalog, publishing, QC wrappers.
- Weak: app shell composition, player-transport (current overloaded state), audio-output ownership (currently cross-hosted), backend audio runtime concentration.

## Assumptions and unknowns

- Assumption: this refinement keeps the prior audit conclusions and tightens ownership semantics only.
- Unknown: exact internal split between `backend-audio-service` and `backend-player-transport-service` may depend on low-level state-sharing constraints in current Rust playback control-plane code.
- Unknown: broad shell tests may require restructuring to module-focused integration tests once shell is thinned.
