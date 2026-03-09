# VIDEO_WORKSPACE_IMPLEMENTATION_PLAN

## 1. Stage execution model

Execution rules:
- Work stage by stage. Do not merge stages.
- Keep repository buildable and testable after each stage.
- Define or revise contracts before code when ambiguity appears.
- Prefer small reversible changes.

Gate for advancing each stage:
1. Stage scope complete.
2. Tests for that scope added and passing.
3. Stage report written.
4. Known risks for next stage listed.

## 2. Dependency boundaries (must remain true in all stages)

Allowed direction:
- `app/shell` -> `features/video-workspace/api`
- `video-workspace` -> `video-composition/api`
- `video-workspace` -> `overlay-engine/api`
- `video-workspace` -> `services/tauri/video`
- `services/tauri/video` -> Tauri invoke
- `commands/video_render.rs` -> `backend-video-render-service`

Forbidden direction:
- `video-workspace` -> `player-transport`
- `video-workspace` -> `audio-output`
- any feature -> raw `@tauri-apps/api/*` except adapter boundary
- command layer owning render business logic

## 3. Planned module/file map

Frontend planned owners:
- `apps/desktop/src/features/video-workspace/api/index.ts`
- `apps/desktop/src/features/video-workspace/model/*`
- `apps/desktop/src/features/video-workspace/hooks/*`
- `apps/desktop/src/features/video-workspace/ui/*`

Frontend support modules:
- `apps/desktop/src/features/video-composition/api/index.ts`
- `apps/desktop/src/features/video-composition/model/*`
- `apps/desktop/src/features/overlay-engine/api/index.ts`
- `apps/desktop/src/features/overlay-engine/model/*`

Bridge module:
- `apps/desktop/src/services/tauri/video/index.ts`
- `apps/desktop/src/services/tauri/video/types.ts`
- `apps/desktop/src/services/tauri/video/commands.ts`
- `apps/desktop/src/services/tauri/video/mappers.ts`

Backend planned owners:
- `apps/desktop/src-tauri/src/commands/video_render.rs`
- `apps/desktop/src-tauri/src/commands/backend_video_render_service.rs`
- `apps/desktop/src-tauri/src/commands/backend_video_render_service/runtime/*`

## 4. Stage-by-stage plan

### Stage 0: Architecture and contracts first

Goal:
- Define contracts, models, boundaries, and implementation order.

Files created/updated:
- `VIDEO_WORKSPACE_MODULE_SPEC.md`
- `BACKEND_VIDEO_RENDER_SERVICE_SPEC.md`
- `VIDEO_WORKSPACE_DATA_MODELS.md`
- `VIDEO_WORKSPACE_IMPLEMENTATION_PLAN.md`
- `STAGE_0_REPORT.md`

Contracts:
- `VW-C001..VW-C004` defined at spec level.

Tests:
- none required beyond optional schema/type checks.

### Stage 1: Workspace shell and static UI

Goal:
- Add Video Workspace shell and sections only.

Expected files:
- create `features/video-workspace/*` scaffold
- update workspace navigation/composition entrypoint(s)

Contracts to use:
- `video-workspace` public API only.

Tests:
- workspace visibility test
- section presence test

### Stage 2: File import and project state

Goal:
- Add image/audio import and deterministic project state.

Expected files:
- `video-workspace/model` + import hook(s)
- optional shared validators in module-local model

Contracts to use:
- project-state model from Stage 0.

Tests:
- image/audio import happy paths
- unsupported type rejection
- drag-drop update behavior

### Stage 3: Static composition preview

Goal:
- Preview image + audio playback (no reactive overlay).

Expected files:
- `video-composition` pure layout logic
- preview runtime in `video-workspace/hooks`

Rules:
- keep preview transport isolated from global player transport.

Tests:
- fit mode behavior
- preview play/pause/seek transitions

### Stage 4: Simple text layer

Goal:
- Add bounded text settings and preview application.

Expected files:
- text model and preset mapper
- preview composition updates

Tests:
- text enable/disable
- preset and bounds validation

### Stage 5: Reactive overlay engine MVP

Goal:
- Add one restrained overlay style (`waveform_strip`).

Expected files:
- `overlay-engine` pure logic
- preview integration adapter

Tests:
- overlay on/off
- parameter updates
- deterministic audio analysis output

### Stage 6: Output preset and render intent construction

Goal:
- Build validated serializable render intent.

Expected files:
- output preset catalog
- preflight validator
- render intent builder

Tests:
- missing input validation
- preset selection
- render-intent snapshot tests

### Stage 7: Backend render service skeleton

Goal:
- Add typed command and service skeleton with mocked/minimal path.

Expected files:
- `commands/video_render.rs`
- backend video render runtime scaffolding
- bridge module `services/tauri/video`

Tests:
- IPC contract tests
- backend validation tests

### Stage 8: Real rendering path

Goal:
- Implement ffmpeg-based render pipeline for MVP output.

Expected files:
- backend runtime pipeline and encoder adapter

Tests:
- happy path file output
- failure path
- basic compatibility assertions

### Stage 9: Progress, cancellation, completion UX

Goal:
- Harden run-time UX for long-running renders.

Expected files:
- render panel UX state and actions
- cancel wiring and final status UX

Tests:
- progress visibility
- cancel path
- success/failure messaging

### Stage 10: Persistence and presets

Goal:
- Add save/load for project and preference defaults.

Expected files:
- persistence adapter + schema guards

Tests:
- save/load roundtrip
- schema compatibility parsing

## 5. Verification checklist per stage

Use this checklist after each stage:
- `corepack pnpm lint`
- `corepack pnpm typecheck`
- targeted tests for changed module(s)
- `corepack pnpm check:boundaries`

## 6. Rollback-safe strategy

- One stage per PR/commit sequence.
- Avoid mixed concerns in a single stage.
- Keep new module public APIs minimal and explicit.
- If Stage N introduces unstable behavior, revert Stage N without touching prior stage contracts.

## 7. Risk register (pre-implementation)

1. Preview-render mismatch risk:
- Mitigation: derive both from the same `VideoRenderIntent` and composition model.

2. Hidden coupling to existing playback modules:
- Mitigation: enforce import guardrails and explicit no-dependency rule.

3. Backend scope creep into editor features:
- Mitigation: enforce strict non-goals and request validator rejecting unsupported fields.

4. Rendering complexity destabilizing integration:
- Mitigation: Stage 7 mock/skeleton before Stage 8 real pipeline.


