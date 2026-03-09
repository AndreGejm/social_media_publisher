# STAGE_7_CONTRACTS

## Stage

- Stage: 7 (Backend render service skeleton)
- Status: Active contract for Stage 7 implementation

## Contract S7-C001: Single IPC adapter ownership for video render lifecycle

Provider:
- `services/tauri/video/*`

Consumers:
- `services/tauri/tauriClient.ts`
- future `video-workspace` render orchestration hook/UI actions

Purpose:
- Keep all Stage 7 video render IPC calls behind one typed adapter boundary.

Commands covered:
- `video_render_validate`
- `video_render_start`
- `video_render_status`
- `video_render_cancel`
- `video_render_result`

Rules:
- No raw `@tauri-apps/api/*` usage outside the Tauri adapter layer.
- All requests are validated in adapter before IPC.
- All responses are sanitized before leaving adapter.

## Contract S7-C002: Typed wire schema contract

Provider:
- frontend: `services/tauri/video/types.ts`
- backend: `src-tauri/src/commands/backend_video_render_service/runtime.rs`

Purpose:
- Define stable, serializable request/response models for Stage 7 mock backend.

Primary schemas:
- `VideoRenderRequest`
- `VideoRenderValidateResponse`
- `VideoRenderStartResponse`
- `VideoRenderProgressSnapshot`
- `VideoRenderCancelResponse`
- `VideoRenderResultResponse`
- `VideoRenderFailure`

Rules:
- Request version is fixed to `1` for Stage 7.
- Output format is restricted to `mp4/h264/aac/yuv420p`.
- Responses remain explicit and shape-stable for contract tests.

## Contract S7-C003: Frontend validation and sanitization behavior

Provider:
- `services/tauri/video/commands.ts`
- `services/tauri/video/mappers.ts`

Purpose:
- Reject malformed render commands before IPC and sanitize backend payloads deterministically.

Rules:
- Request validation enforces required media/composition/output fields and bounded lengths.
- Job ID validation is deterministic (`non-empty`, bounded length).
- Backend errors map into `UiAppError` surface with stable codes/messages.
- Invalid backend payload shape fails sanitization, never leaks unknown unsafe data as trusted state.

## Contract S7-C004: Backend skeleton runtime behavior

Provider:
- `src-tauri/src/commands/backend_video_render_service/runtime.rs`

Purpose:
- Provide a deterministic mock render lifecycle suitable for typed contract adoption before real encoding.

State rules:
- At most one active non-terminal render job at a time.
- Start validates request first; invalid payload returns structured error.
- Status polling advances deterministic mock states:
  - `validating -> starting -> running -> finalizing -> succeeded`
- Cancel transitions non-terminal jobs to `canceled` with typed failure payload.
- Result endpoint returns terminal payload for `succeeded` or `canceled` states.

## Contract S7-C005: Command boundary and error ownership

Providers:
- Tauri command wrapper: `src-tauri/src/commands/video_render.rs`
- service facade: `src-tauri/src/commands/backend_video_render_service.rs`

Purpose:
- Keep command handlers thin and delegate runtime behavior to backend service owner.

Rules:
- command layer is boundary glue only (no runtime orchestration logic).
- typed app error codes are emitted for video-render contract:
  - `VIDEO_RENDER_INVALID_REQUEST`
  - `VIDEO_RENDER_JOB_CONFLICT`
  - `VIDEO_RENDER_JOB_NOT_FOUND`
  - `VIDEO_RENDER_INTERNAL_ERROR`

## Contract S7-C006: ACL and registration discipline

Providers:
- `src-tauri/src/lib.rs`
- `src-tauri/permissions/default.toml`

Purpose:
- Ensure each new command has explicit registration and allowlist coverage.

Rules:
- all Stage 7 commands are present in `generate_handler!`.
- default ACL set includes corresponding `allow-video-render-*` permissions.
- command access remains explicit and auditable.

## Contract S7-C007: Required tests

Must pass:
- Frontend adapter contract tests:
  - `services/tauri/video/commands.test.ts`
- Backend runtime tests:
  - request validation issues
  - invalid request start rejection with structured error details
  - deterministic status progression to success
  - cancel path transitions to typed failure state
  - single-active-job conflict behavior
- Workspace quality gates:
  - `typecheck`
  - `lint --max-warnings=0`
  - boundary check script
  - desktop test suite
  - desktop build
  - Rust desktop library tests
