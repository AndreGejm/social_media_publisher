# STAGE_8_CONTRACTS

## Stage

- Stage: 8 (Real rendering path)
- Status: Active contract for Stage 8 implementation

## Contract S8-C001: Backend render ownership

Provider:
- `src-tauri/src/commands/backend_video_render_service/runtime.rs`

Purpose:
- Own the real backend render pipeline for still-image + WAV -> YouTube-compatible MP4.

Rules:
- Frontend remains orchestration-only and does not encode media.
- Command handlers remain thin glue (`commands/video_render.rs`).
- Runtime is the source of truth for render status/result.

## Contract S8-C002: Render preparation and validation contract

Provider:
- `backend_video_render_service/runtime.rs`

Rules:
- Start request still enforces schema/format validation.
- Render worker resolves and validates source and output filesystem paths before launching encoder.
- Audio is probed/decoded via core audio analysis to derive deterministic duration and frame targets.
- Failure during preparation maps to typed failure codes (`missing_input`, `input_read_failed`, `output_path_invalid`, `unsupported_media_type`).

## Contract S8-C003: Real ffmpeg pipeline contract

Provider:
- `FfmpegVideoRenderJobRunner` in runtime module

Pipeline requirements:
- Inputs: one still image + one WAV audio
- Output: MP4 (`libx264` video, `aac` audio, `yuv420p`, `+faststart`, 30 fps)
- Fit modes supported: `fill_crop`, `fit_bars`, `stretch`
- Overlay style supported: `waveform_strip` only
- Optional text presets supported:
  - `title_bottom_center`
  - `title_artist_bottom_left`
  - `title_artist_center_stack`

## Contract S8-C004: Progress reporting contract

Provider:
- backend runtime + ffmpeg progress parser

Rules:
- ffmpeg progress is consumed via `-progress pipe:1`.
- `out_time_*` fields are mapped to monotonic progress snapshots.
- Progress snapshots include state, percent, stage, frame index, total frames, encoded seconds.
- Finalizing state is emitted before terminal success when possible.

## Contract S8-C005: Cancellation contract

Provider:
- `video_render_cancel` path through runtime

Rules:
- Cancel request marks the job token.
- Runner observes cancel token and terminates ffmpeg process.
- Terminal canceled jobs return `canceled_by_user` failure payload and `state=canceled`.
- Cancel on terminal jobs is idempotent (`canceled=false`).

## Contract S8-C006: Terminal result validity contract

Provider:
- backend runtime

Rules:
- Success is returned only when output file exists and file size > 0.
- Non-zero ffmpeg exit or missing/empty output maps to failed terminal state.
- Failure payload is typed and machine-readable.

## Contract S8-C007: Boundary discipline

Allowed:
- `commands/video_render.rs` -> backend service facade
- backend runtime -> ffmpeg process + core audio analysis

Forbidden:
- no UI logic in backend runtime
- no ffmpeg command assembly in command handlers
- no raw Tauri API use in frontend feature modules

## Contract S8-C008: Required tests

Must pass:
- runtime contract tests with mock runner:
  - validation failures
  - success terminal path
  - conflict handling
  - cancellation handling
  - failed terminal path
- ffmpeg integration smoke test (runs only when ffmpeg is available in PATH)
- workspace gates:
  - `typecheck`
  - `lint`
  - boundary checks
  - frontend tests
  - frontend build
  - Rust desktop lib tests
