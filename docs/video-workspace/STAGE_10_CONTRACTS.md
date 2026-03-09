# STAGE_10_CONTRACTS

## Stage

- Stage: 10 (Persistence and presets)
- Status: Active contract for Stage 10 implementation

## Contract S10-C001: Persistence ownership boundary

Provider:
- `apps/desktop/src/features/video-workspace/hooks/useVideoWorkspacePersistence.ts`
- `apps/desktop/src/features/video-workspace/model/videoWorkspacePersistence.ts`

Purpose:
- Keep local project/preset persistence owned by `video-workspace` as a bounded frontend concern.

Rules:
- Persistence logic remains module-local.
- Persistence writes are best-effort and never block interactive flows.
- Render/runtime backend contracts remain unaffected.

## Contract S10-C002: Versioned persistence schemas

Provider:
- `videoWorkspacePersistence` model

Schemas:
- `VideoWorkspaceProjectDocument` (`schemaVersion: 1`)
- `VideoWorkspacePresetDocument` (`schemaVersion: 1`)
- `VideoWorkspacePreferencesDocument` (`schemaVersion: 1`)

Rules:
- Unsupported schema versions return `null` on parse.
- Parsed payloads are sanitized through existing model patchers.
- Unknown/invalid values degrade to deterministic defaults.

## Contract S10-C003: Project snapshot persistence contract

Provider:
- `useVideoWorkspaceProjectState` + `useVideoWorkspacePersistence`

Rules:
- Save captures project snapshot + fit mode + text + overlay + output settings.
- Load applies snapshot/state through controller replace methods only.
- Loading project resets render panel state to avoid stale request/result coupling.

## Contract S10-C004: Preset persistence contract

Provider:
- `useVideoWorkspacePersistence`

Rules:
- Preset save/load covers fit mode, text, overlay, output preset id, and overwrite policy.
- Preset load must not infer or fabricate backend state.
- Preset load resets render panel state for deterministic UX.

## Contract S10-C005: Output preference memory contract

Provider:
- `useVideoWorkspacePersistence`

Rules:
- Last output preset id is persisted automatically.
- Recent output directories are deduplicated and capped.
- On mount, preferences hydrate output state deterministically.

## Contract S10-C006: UI integration contract

Provider:
- `VideoWorkspaceFeature.tsx`

Rules:
- UI exposes explicit actions:
  - Save Project
  - Load Project
  - Save Preset
  - Load Preset
- UI shows persistence status feedback and recent folder affordance.
- Persistence controls do not import or couple to unrelated feature modules.

## Contract S10-C007: Dependency and boundary discipline

Allowed:
- `video-workspace` internal hooks -> `video-workspace` model types
- `video-workspace` -> existing composition/overlay model APIs

Forbidden:
- no raw Tauri API usage for persistence
- no coupling to `player-transport` or `audio-output` internals
- no backend command shape changes for persistence concerns

## Contract S10-C008: Required tests

Must pass:
- `videoWorkspacePersistence` model contract tests
- `VideoWorkspaceFeature` persistence UX tests:
  - save/load project snapshot
  - save/load preset
  - remember last output preset and recent output folder after remount
- workspace gates:
  - `typecheck`
  - `lint --max-warnings=0`
  - boundary checks
  - full desktop test suite
  - desktop build
  - Rust `video_render` tests
