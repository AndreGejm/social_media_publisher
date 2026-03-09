# Coupling Hotspots

Phase: 1 (Boundary discovery only)

## Hotspots that force broad repository scanning today

| Hotspot | Why this is cross-cutting today | Files involved | Suggested single ownership candidate |
| --- | --- | --- | --- |
| 1. Output mode lifecycle (Shared vs Exclusive) | One behavior spans UI controls, transport orchestration, IPC adapter, command wrapper, and WASAPI implementation. | `apps/desktop/src/features/player/SharedPlayerBar.tsx`, `apps/desktop/src/features/player/hooks/usePlayerTransportState.ts`, `apps/desktop/src/services/tauri/tauri-api.ts`, `apps/desktop/src-tauri/src/commands/playback.rs`, `apps/desktop/src-tauri/src/commands.rs` | `audio-output` module |
| 2. Playback transport state and fallback policy | Playback state, output switching, legacy HTML audio fallback, queue sync, and polling live in one hook that also exposes bridge APIs to other domains. | `apps/desktop/src/features/player/hooks/usePlayerTransportState.ts`, `apps/desktop/src/features/player/hooks/usePlayerShellSync.ts`, `apps/desktop/src/app/shell/WorkspaceApp.tsx` | `player-transport` module |
| 3. Shell-level orchestration | `WorkspaceApp.tsx` wires most features directly and handles many mutations itself, so feature updates require reading shell internals. The architectural goal is for shell ownership to be composition only. | `apps/desktop/src/app/shell/WorkspaceApp.tsx`, `apps/desktop/src/features/*/hooks/*` | `app-shell` (composition-only owner) |
| 4. Monolithic TS IPC contract surface | Domain APIs for catalog, playback, QC, release, and dialogs are mixed in one bridge file, increasing cognitive load and contract drift risk. First-wave scope should isolate the audio pilot path behind a dedicated audio bridge boundary first. | `apps/desktop/src/services/tauri/tauri-api.ts`, `apps/desktop/src/services/tauri/tauriClient.ts` | First-wave: `tauri-audio-bridge` (audio pilot path). Later evolution: broader domain-sliced bridge modules. |
| 5. Monolithic Rust command core | Playback, catalog, QC, release services, models, and tests are concentrated in one large source file, blurring backend domain ownership. First-wave extraction should target playback/output-related ownership only; full `commands.rs` domain extraction is later work. | `apps/desktop/src-tauri/src/commands.rs` (7018 lines), `apps/desktop/src-tauri/src/commands/*.rs`, `apps/desktop/src-tauri/src/lib.rs` | First-wave: `backend-audio-service` (playback/output path only). Later evolution: domain-specific backend slices. |
| 6. QC preview to player source coupling | QC session changes mutate shared player source and autoplay behavior through transport internals, requiring multi-file tracing. Player transport remains the owner candidate; QC should interact through a narrow transport-facing contract instead of transport internals. | `apps/desktop/src/features/player/hooks/useQcPreviewLifecycle.ts`, `usePlayerTransportState.ts`, `apps/desktop/src-tauri/src/commands/qc.rs`, `commands.rs` | `player-transport` owner with explicit narrow QC-facing transport contract |
| 7. Library ingest autoplay chain | Drag/drop ingestion triggers scan jobs, polling, catalog reload, queue mutation, and autoplay across several hooks and infrastructure adapter files. | `apps/desktop/src/features/library-ingest/hooks/useDroppedIngestAutoplayController.ts`, `useLibraryIngestActions.ts`, `useIngestJobPolling.ts`, `apps/desktop/src/infrastructure/tauri/dragDrop.ts` | `library-ingest` module with explicit transport adapter |
| 8. Publish bridge handoff from listen mode | Track-to-publisher handoff currently crosses shell state, publish selection state, and player bridge state. | `apps/desktop/src/features/publisher-ops/hooks/usePublisherBridgeActions.ts`, `apps/desktop/src/features/publish-selection/hooks/usePublishSelectionState.ts`, `apps/desktop/src/app/shell/WorkspaceApp.tsx` | `publisher-ops` module with single handoff API |
| 9. Type ownership leakage from UI to domain helper | Workspace model helper imports a UI component type (`QcPlayerAnalysis`) instead of a stable domain contract type. | `apps/desktop/src/features/workspace/model/workspaceRuntimeUtils.ts`, `apps/desktop/src/features/player/QcPlayer.tsx` | shared domain type contract owned outside UI component files |
| 10. Broad shell test coupling | Large shell tests encode many feature behaviors, so architectural change in one feature can break unrelated tests. | `apps/desktop/src/app/shell/WorkspaceApp.test.tsx`, multiple feature mocks | test ownership by module with focused integration tests |

## Most cross-cutting concerns

1. Playback output mode and stream lifecycle control.
2. Global transport state and queue/source orchestration.
3. IPC contract definition and command surface drift.
4. Rust backend command ownership concentration.

## Why broad inspection is required now

- There is no single frontend module that owns output mode, transport lifecycle, and status truth.
- Playback behavior spans at least five ownership areas (UI, hook, TS bridge, Rust command wrapper, Rust runtime code).
- Shell composition contains behavior logic, not only module composition.
- Backend playback code is not isolated in a dedicated Rust audio service module yet.

## Priority focus for first-wave boundaries

- First owner to isolate: `audio-output`.
- Second owner to isolate: `player-transport`.
- Third owner to isolate: `tauri-audio-bridge`.
- Backend pair owner: `backend-audio-service`.

Sequence rationale:
- This order starts with the pilot concern owner (`audio-output`), then removes adjacent frontend coupling in `player-transport`, then stabilizes frontend/backend command contracts through `tauri-audio-bridge`, and finally performs backend extraction paired directly to the same playback/output pilot path.
