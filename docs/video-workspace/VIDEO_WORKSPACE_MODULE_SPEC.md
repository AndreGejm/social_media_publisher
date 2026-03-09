# VIDEO_WORKSPACE_MODULE_SPEC

## 1. Module identity

- Module name: `video-workspace`
- Layer: Frontend bounded module
- Spec version: `1.0.0`
- Spec status: `DESIGN_READY`
- Primary owner: Desktop Video Workspace team
- Planned public entrypoint: `apps/desktop/src/features/video-workspace/api/index.ts`

Ownership rule:
- `video-workspace` is the only frontend owner of Video Workspace UI state, media import state, preview orchestration, and render-request assembly.

## 2. Architectural position

```text
app/shell
  -> features/video-workspace (UI + state + orchestration)
    -> features/video-composition (pure layout/composition rules)
    -> features/overlay-engine (pure overlay parameter and frame model)
    -> services/tauri/video (typed IPC adapter)
      -> commands/video_render.rs
        -> commands/backend_video_render_service.rs
```

Boundary requirement:
- `video-workspace` composes and orchestrates. It does not own low-level codec/render execution.

## 3. Purpose

Provide a deterministic, narrow workflow for:
- import one still image
- import one audio file
- preview composition
- optional restrained overlay
- optional simple text
- output preset selection
- render request submission and status UX

## 4. Owned responsibilities

- Workspace UI sections: Media, Visual, Text, Output, Preview, Render.
- Project state lifecycle for media, text, overlay, output settings.
- Input validation and user-safe error presentation.
- Preview runtime state and controls (play/pause/seek/restart) owned locally to this module.
- Render preflight validation and deterministic render request creation.
- Render job UX state (idle, validating, rendering, success, failure, canceled).

## 5. Explicit non-goals

- General video editor behavior.
- Timeline, keyframes, arbitrary multi-layer stack editing.
- Batch renders.
- YouTube upload.
- Reusing `player-transport` runtime for workspace preview.
- Raw Tauri IPC calls.

## 6. Public entrypoint(s)

- `apps/desktop/src/features/video-workspace/api/index.ts`

Planned exports:
- `useVideoWorkspaceController`
- `VideoWorkspaceViewModel`
- `VideoWorkspaceActions`
- `VideoWorkspaceError`
- `VideoRenderIntent`

## 7. Public TypeScript API contract (Stage 0 target)

```ts
export type VideoWorkspaceSection =
  | "media"
  | "visual"
  | "text"
  | "output"
  | "preview"
  | "render";

export type VideoWorkspaceLifecycleState =
  | "idle"
  | "project_invalid"
  | "project_ready"
  | "preview_ready"
  | "render_preflight"
  | "render_submitting"
  | "render_in_progress"
  | "render_succeeded"
  | "render_failed"
  | "render_canceled";

export type VideoWorkspaceErrorCode =
  | "INVALID_IMAGE_FILE"
  | "INVALID_AUDIO_FILE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "MISSING_REQUIRED_INPUT"
  | "INVALID_OUTPUT_PATH"
  | "PREVIEW_INIT_FAILED"
  | "RENDER_PRECHECK_FAILED"
  | "RENDER_START_FAILED"
  | "RENDER_RUNTIME_FAILED"
  | "RENDER_CANCELED"
  | "TAURI_UNAVAILABLE"
  | "UNKNOWN_COMMAND"
  | "UNEXPECTED_UI_ERROR";

export type VideoWorkspaceError = {
  code: VideoWorkspaceErrorCode;
  message: string;
  retryable: boolean;
  source: "video-workspace" | "video-bridge" | "backend-video-render-service";
};

export type VideoWorkspaceViewModel = {
  lifecycle: VideoWorkspaceLifecycleState;
  sections: VideoWorkspaceSection[];
  canPreview: boolean;
  canRender: boolean;
  lastError: VideoWorkspaceError | null;
  project: VideoProjectState;
  preview: VideoPreviewState;
  render: VideoRenderRuntimeState;
};

export type VideoWorkspaceActions = {
  importImage(input: File | string): Promise<void>;
  importAudio(input: File | string): Promise<void>;
  clearImage(): void;
  clearAudio(): void;

  setFitMode(mode: VideoImageFitMode): void;
  setOverlaySettings(next: Partial<VideoOverlaySettings>): void;
  setTextSettings(next: Partial<VideoTextSettings>): void;
  setOutputPreset(presetId: VideoOutputPresetId): void;
  setOutputPath(path: string): void;

  previewPlay(): Promise<void>;
  previewPause(): Promise<void>;
  previewSeek(seconds: number): Promise<void>;
  previewRestart(): Promise<void>;

  buildRenderIntent(): VideoRenderIntentResult;
  startRender(): Promise<void>;
  cancelRender(): Promise<void>;
  refreshRenderStatus(): Promise<void>;
};

export type VideoWorkspaceController = {
  view: VideoWorkspaceViewModel;
  actions: VideoWorkspaceActions;
};

export declare function useVideoWorkspaceController(args: {
  onNotice: (notice: { level: "info" | "success" | "warning"; message: string }) => void;
}): VideoWorkspaceController;
```

Notes:
- `VideoProjectState`, `VideoPreviewState`, and render types are specified in `VIDEO_WORKSPACE_DATA_MODELS.md`.
- Actions are serialized per concern:
  - import actions serialize by media kind.
  - render actions serialize globally (single active render).

## 8. State and transition rules

Normative states:
1. `idle`
2. `project_invalid`
3. `project_ready`
4. `preview_ready`
5. `render_preflight`
6. `render_submitting`
7. `render_in_progress`
8. `render_succeeded`
9. `render_failed`
10. `render_canceled`

Rules:
- `project_ready` requires valid image + valid audio + valid output preset.
- `canRender` is true only in `project_ready`, `preview_ready`, or `render_failed`.
- At most one render job may be active from this module.
- Render lifecycle updates are backend-truth only; frontend cannot fabricate success/progress.

## 9. Dependency rules

Allowed dependencies:
- `features/video-composition/api` (pure composition rules)
- `features/overlay-engine/api` (pure overlay parameter and frame model)
- `services/tauri/video/index.ts` (video IPC adapter)
- `shared/lib/*` pure helpers
- React primitives

Forbidden dependencies:
- `features/player-transport/*`
- `features/audio-output/*`
- direct `@tauri-apps/api/*`
- backend command names/constants outside typed bridge
- shell internals beyond consumed props

Public-entrypoint-only rule:
- Consumers must import only `features/video-workspace/api/index.ts`.

## 10. Integration contracts consumed

- Contract `VW-C001`: video render bridge API (`services/tauri/video`)
- Contract `VW-C002`: composition evaluator API (`features/video-composition/api`)
- Contract `VW-C003`: overlay evaluator API (`features/overlay-engine/api`)
- Contract `VW-C004`: preview transport API (module-local, isolated from player-transport)

## 11. Invariants

- Exactly one image and one audio source define the project media pair for MVP.
- Preview and render request are derived from the same project snapshot type.
- Preview playback is isolated from global playback modules.
- Overlay defaults are restrained (disabled or low-intensity safe default).
- Output preset selection is required; free-form codec controls are out of scope for MVP.
- No mode in this module exposes timeline/keyframe editing primitives.

## 12. Required tests (future stages)

Provider tests:
- deterministic project-state transitions
- import validation and error mapping
- render preflight and request generation determinism
- render status lifecycle mapping

Consumer tests:
- shell imports only `video-workspace` public API
- section visibility and UI state contract

Boundary tests:
- no `@tauri-apps/api/*` usage in `features/video-workspace/*`
- no imports from `player-transport` or `audio-output` internals

## 13. Candidate file scope (planned)

- `apps/desktop/src/features/video-workspace/api/index.ts`
- `apps/desktop/src/features/video-workspace/model/*`
- `apps/desktop/src/features/video-workspace/hooks/*`
- `apps/desktop/src/features/video-workspace/ui/*`
- `apps/desktop/src/features/video-workspace/test/*`


