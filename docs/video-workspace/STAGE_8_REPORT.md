# STAGE_8_REPORT

## Goal

Implement the real backend render path for Video Workspace so the service can produce a YouTube-compatible MP4 from one still image + one WAV file with optional text and restrained reactive overlay.

## Changes made

Added Stage 8 contract artifact:
- `docs/video-workspace/STAGE_8_CONTRACTS.md`

Replaced Stage 7 mock backend runtime with Stage 8 real ffmpeg pipeline runtime:
- `apps/desktop/src-tauri/src/commands/backend_video_render_service/runtime.rs`
  - real ffmpeg command execution path
  - render preparation (input/output path checks)
  - audio-duration probe for progress baseline
  - fit mode + overlay + text filter-graph mapping
  - progress parsing from ffmpeg `-progress pipe:1`
  - terminal state mapping (`succeeded` / `failed` / `canceled`)
  - typed failure mapping for encoder/preparation/cancel paths

## Public contracts added or changed

Added:
- `S8-C001`: backend runtime owns real render execution
- `S8-C002`: preparation and validation contract for filesystem + media readiness
- `S8-C003`: ffmpeg pipeline contract for MVP output defaults
- `S8-C004`: progress parsing and snapshot contract
- `S8-C005`: cancellation behavior contract
- `S8-C006`: terminal output validity contract
- `S8-C007`: Stage 8 boundary discipline contract
- `S8-C008`: required tests and validation contract

Changed:
- runtime job states now include explicit `failed` terminal state for non-cancel failures.
- Stage 7 synthetic progress transitions were removed in favor of real ffmpeg progress mapping.

## Tests added

Runtime tests in:
- `apps/desktop/src-tauri/src/commands/backend_video_render_service/runtime.rs`

Coverage includes:
- validation failure behavior
- successful terminal behavior (mock runner)
- cancellation terminal behavior (mock runner)
- conflict behavior for single active job policy
- explicit failed terminal behavior (mock runner)
- ffmpeg integration smoke test for real render path (auto-skips if ffmpeg unavailable)

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
- frontend test suite still prints existing jsdom `HTMLMediaElement.prototype.load` warnings from unrelated playback tests; suite outcome is passing.

## What was deferred

Deferred to Stage 9:
- user-facing render lifecycle UX (start/progress/cancel/result panel wiring in `video-workspace` UI)
- explicit completion actions in UI (open output folder, render session summary)
- persistent in-workspace render history presentation

## Known limitations

- current request media fields still use `imageFileName` / `audioFileName`; backend Stage 8 treats these as filesystem paths for actual rendering.
- ffmpeg integration smoke test depends on ffmpeg availability in PATH and skips when absent.
- text rendering relies on ffmpeg drawtext support in the local ffmpeg build.

## Risks before next stage

1. Frontend/backend path handoff risk:
- Stage 9 must provide reliable source file paths from workspace imports when invoking render start.

2. UX parity risk:
- Stage 9 should reflect backend truth exactly and not infer terminal outcomes.

3. Long-render cancellation UX risk:
- Stage 9 must keep user cancellation flow deterministic and avoid stale polling state.

## Next stage prerequisites

- define Stage 9 render panel state machine (idle/starting/running/finalizing/succeeded/failed/canceled).
- wire `videoRenderStart/status/cancel/result` through `video-workspace` module-local orchestration hook.
- preserve backend-as-source-of-truth contract for all render status shown in UI.
