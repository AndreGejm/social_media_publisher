# STAGE_7_REPORT

## Goal

Implement a backend-video-render-service skeleton with typed IPC contracts, deterministic request validation/progress/cancel/result flow, and no real encoder complexity leaking into frontend modules.

## Changes made

Added Stage 7 contract artifact:
- `docs/video-workspace/STAGE_7_CONTRACTS.md`

Added frontend Tauri video adapter package and tests:
- `apps/desktop/src/services/tauri/video/types.ts`
- `apps/desktop/src/services/tauri/video/mappers.ts`
- `apps/desktop/src/services/tauri/video/commands.ts`
- `apps/desktop/src/services/tauri/video/index.ts`
- `apps/desktop/src/services/tauri/video/commands.test.ts`

Updated frontend Tauri client barrel:
- `apps/desktop/src/services/tauri/tauriClient.ts`
  - exports video render commands and types

Added backend command boundary and service facade:
- `apps/desktop/src-tauri/src/commands/video_render.rs`
- `apps/desktop/src-tauri/src/commands/backend_video_render_service.rs`

Added backend deterministic mock runtime and tests:
- `apps/desktop/src-tauri/src/commands/backend_video_render_service/runtime.rs`

Updated backend command registration and error codes:
- `apps/desktop/src-tauri/src/commands.rs`
  - added modules `backend_video_render_service` and `video_render`
  - exported `video_render::*`
  - added `VIDEO_RENDER_*` app error codes

Updated Tauri command handler registration:
- `apps/desktop/src-tauri/src/lib.rs`
  - registered `video_render_validate/start/status/cancel/result`

Updated ACL allowlist for new commands:
- `apps/desktop/src-tauri/permissions/default.toml`
  - added default permissions and explicit `allow-video-render-*` entries

## Public contracts added or changed

Added:
- `S7-C001` single IPC adapter ownership contract for video render lifecycle calls
- `S7-C002` typed request/response wire contract for Stage 7 mock backend
- `S7-C003` frontend input validation + response sanitization contract
- `S7-C004` deterministic backend mock runtime lifecycle contract
- `S7-C005` thin command-boundary + typed error ownership contract
- `S7-C006` ACL and command registration discipline contract
- `S7-C007` Stage 7 required validation and test contract

Changed:
- `tauriClient` public surface now includes typed video render APIs for future workspace integration.

## Tests added

Frontend:
- `apps/desktop/src/services/tauri/video/commands.test.ts`
  - IPC routing checks
  - backend error mapping checks
  - input pre-validation rejection checks
  - sanitize + typed state checks for status/cancel/result

Backend (Rust):
- `apps/desktop/src-tauri/src/commands/backend_video_render_service/runtime.rs` tests
  - validation issue reporting
  - invalid request start rejection with structured details
  - deterministic status progression to success
  - cancel transitions to `canceled` with typed failure
  - single active job conflict behavior

## Validation performed

Commands run:
- `cargo test -p release-publisher-desktop --lib video_render`
- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm check:boundaries`
- `corepack pnpm test`
- `corepack pnpm build`
- `cargo test -p release-publisher-desktop --lib`

Result:
- all commands passed.

Notes:
- `corepack pnpm test` initially failed under sandbox with an EPERM access error to Corepack cache path and succeeded when rerun with escalated permissions.
- test output includes one jsdom warning (`HTMLMediaElement.prototype.load not implemented`) from an existing workspace test; suite still passes and this is unrelated to Stage 7 video-render contracts.

## What was deferred

Deferred to Stage 8+:
- real MP4 encoding pipeline (ffmpeg integration)
- real progress streaming from encoder runtime
- real filesystem output writing and output-file verification
- production cancellation semantics tied to real encoder process lifecycle

## Known limitations

- backend runtime is intentionally mock/deterministic for Stage 7 and does not encode media yet.
- timestamps/progress payloads are mock values used for contract stabilization.
- Stage 7 adds lifecycle endpoints but does not yet wire full render UX state flow in `video-workspace` UI.

## Risks before next stage

1. Preview-render parity risk:
- Stage 8 must map request fields (fit/text/overlay) into real renderer semantics without drift.

2. Runtime lifecycle drift risk:
- replacing mock state transitions with real encoder progress must preserve wire contract guarantees.

3. Cancellation behavior risk:
- real process cancellation must maintain deterministic terminal result semantics and avoid orphaned jobs.

## Next stage prerequisites

- finalize Stage 8 backend render architecture against existing request schema.
- keep response schemas and error mapping backward-compatible with Stage 7 adapter contracts.
- add render output verification checks (file exists, non-empty, compatible profile) before exposing success as final.
