# STAGE_5_CONTRACTS

## Stage

- Stage: 5 (Reactive overlay engine MVP)
- Status: Active contract for Stage 5 implementation

## Contract S5-C001: Overlay engine ownership

Provider:
- `features/overlay-engine/api/index.ts`

Consumer:
- `features/video-workspace/hooks/useVideoWorkspaceOverlayController.ts`
- `features/video-workspace/VideoWorkspaceFeature.tsx`

Purpose:
- Provide one restrained overlay style (`waveform_strip`) with deterministic analysis and bounded rendering parameters.

MVP scope:
- `waveform_strip` only.
- No additional overlay engines in Stage 5.

## Contract S5-C002: Overlay settings contract

Settings shape:

```ts
type VideoOverlaySettings = {
  enabled: boolean;
  style: "waveform_strip";
  opacity: number;     // 0..1
  intensity: number;   // 0..1
  smoothing: number;   // 0..1
  position: "top" | "bottom";
  themeColorHex: string; // #RRGGBB
  barCount: number;    // bounded, deterministic
};
```

Rules:
- Defaults must be visually safe (`enabled=false`, restrained opacity/intensity).
- All settings are normalized and clamped at patch-time.
- Invalid color input normalizes to a safe default.

## Contract S5-C003: Deterministic audio analysis contract

Provider API (pure):
- parse/analyze WAV bytes into normalized energy envelope.

Rules:
- Same input bytes + same analysis options -> byte-equivalent envelope output.
- Analysis must not mutate global state.
- Unsupported WAV formats return typed analysis errors (no silent fallback to random values).

## Contract S5-C004: Overlay rendering derivation contract

Provider API (pure):
- derive waveform strip bars from:
  - analysis envelope
  - playback progress ratio
  - overlay settings

Rules:
- Output bars are deterministic for same inputs.
- `smoothing` influences local averaging only.
- `intensity` scales amplitude but remains bounded `[0,1]`.
- Disabled overlay does not render bars.

## Contract S5-C005: Runtime integration and concurrency

Provider:
- `useVideoWorkspaceOverlayController`

Rules:
- Analysis is re-run only when audio source changes.
- Rapid source changes must ignore stale async completions (latest request wins).
- Overlay settings updates must not restart analysis.
- Preview remains usable if analysis fails; failure is surfaced as bounded status text.

## Contract S5-C006: Boundary discipline

Allowed:
- `video-workspace` -> `overlay-engine/api`
- `video-workspace` -> local hooks/models

Forbidden:
- `overlay-engine` -> UI components
- `overlay-engine` -> `player-transport/*`
- `overlay-engine` -> direct Tauri APIs

## Contract S5-C007: Required tests

Must pass:
- overlay defaults are safe and bounded
- overlay on/off preview behavior
- overlay parameter changes affect rendered output deterministically
- audio analysis deterministic for identical WAV input
- stale analysis completion is ignored when source changes (hook-level behavior)
