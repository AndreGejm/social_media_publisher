# REFACTOR_LOG

This document tracks the execution of Phase 3 of the architectural refactor.

## Goals Achieved
1. **Frontend Root Cleanup:** Relocated dumping ground root files into explicit domain folders (`app/shell/` and `features/`).
2. **Feature Encapsulation (Hooks):** Moved 22 global/generic hooks from the dumping ground `apps/desktop/src/hooks/` to feature-specific logic folders (`features/*/hooks/`) or `shared/hooks/`.
3. **Tauri Isolation:** Consolidated scattered Tauri API bindings into an explicit `services/tauri/` infrastructure boundary.

---

## Files Moved / Renamed

### Hook Relocations (De-dumping `src/hooks`)
- `useAutoClearString.ts` -> `shared/hooks/`
- `useCatalogSelectionState.ts` -> `features/play-list/hooks/`
- `useDroppedIngestAutoplayController.ts` -> `features/library-ingest/hooks/`
- `useIngestJobPolling.ts` & `.test.ts` -> `features/library-ingest/hooks/`
- `useLibraryIngestActions.ts` & `.test.ts` -> `features/library-ingest/hooks/`
- `usePlayListActions.ts` -> `features/play-list/hooks/`
- `usePlayerShellSync.ts` -> `features/player/hooks/`
- `usePlayerTrackDetailPrefetch.ts` -> `features/player/hooks/`
- `usePlayerTransportState.ts` & `.test.ts` -> `features/player/hooks/`
- `usePublishSelectionState.ts` -> `features/publish-selection/hooks/`
- `usePublisherBridgeActions.ts` -> `features/publisher-ops/hooks/`
- `useQcPreviewLifecycle.ts` -> `features/player/hooks/`
- `useQueueState.ts` -> `features/player/hooks/`
- `useTopNotifications.ts` -> `shared/hooks/`
- `useTrackMetadataEditorState.ts` -> `features/track-detail/hooks/`
- `useTrackRowContextMenuState.ts` -> `features/context-menu/hooks/`
- `useWorkspaceModeState.ts` -> `features/workspace/hooks/`
- `useWorkspacePersistence.ts` -> `features/workspace/hooks/`
- `useWorkspaceUiEffects.ts` -> `features/workspace/hooks/`

### Root Component Extractions
- `src/MusicWorkspaceApp.tsx` renamed/moved to `src/app/shell/WorkspaceApp.tsx`.
- `src/MusicWorkspaceApp.test.tsx` renamed/moved to `src/app/shell/WorkspaceApp.test.tsx`.
- `src/QcPlayer.tsx` & `.test.tsx` moved to `src/features/player/QcPlayer.tsx`.

### Tauri Service Isolation
- `src/tauri-api.ts` -> `src/services/tauri/tauri-api.ts`
- `src/tauri-api-core.d.ts` -> `src/services/tauri/tauri-api-core.d.ts`
- `src/tauri-api.test.ts` -> `src/services/tauri/tauri-api.test.ts`
- `src/tauri-config.test.ts` -> `src/services/tauri/tauri-config.test.ts`
- `src/services/tauriClient.ts` -> `src/services/tauri/tauriClient.ts`
- `src/services/TauriClientProvider.tsx` -> `src/services/tauri/TauriClientProvider.tsx`

---

## Duplicate Logic Consolidated
- Rewrote imports across 100+ files to point to the newly encapsulated feature hooks and services rather than resolving through root contexts.

---

## Architectural Decisions Made
1. **Feature Logic Boundaries:** Hooks represent the primary source of React business logic. By moving them into `features/*`, we enforce the rule that feature code must explicitly expose its API via the feature index rather than exporting generic global hooks.
2. **Explicit Dependency on Tauri:** By gathering all Tauri definitions into `services/tauri/`, we prevent future generic React pure-logic files from accidentally adopting native side-effects by mistakenly importing from the root `tauri-api.ts`.
3. **Preserving Component Closure:** `WorkspaceApp.tsx` remains ~1500 lines long. Rather than attempting to break down the highly coupled `useEffect` chain manually (which carries a massive risk of subtly breaking the global application layout sync), it was structurally encapsulated in `app/shell/`.

---

## Deviations From the Original Plan and Why

1. **Did NOT deeply decompose `WorkspaceApp.tsx` into dozens of smaller React Context files.**
   - *Why:* It relies on a delicate orchestration of global state that spans routing, library metadata fetching, queue mechanics, and Tauri IPC callbacks. Splitting this structurally would require changing hundreds of closure references into `useContext()` dependencies, risking complete application deadlock without 100% test coverage. We opted for the "Prefer small, safe structural improvements over dramatic rewrites" rule, leaving it whole but contained inside `app/shell/`.

2. **Did NOT dismantle `src-tauri/src/commands.rs`.**
   - *Why:* The monolithic 7,600-line Rust file carries deep borrow-checker lifecycles, macro invocations, and trait bound dependencies. Breaking this into 10 smaller files natively via regex or scripts is physically unsafe and inevitably leads to compiler failure via module encapsulation problems. Strict alignment with the "Avoid breaks in working functionality" rule mandated deferring this Rust boundary rewrite to a specialized pass equipped with full Rust Language Server (RLS) refactoring plugins.
