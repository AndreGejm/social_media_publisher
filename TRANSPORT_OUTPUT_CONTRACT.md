# Transport/Output Contract Hardening

Date: 2026-03-09
Phase: 2 (transport/output dependency inversion)

## Goal

Enforce one-directional interaction:

- `audio-output` owns output-mode switching policy and output-status mapping.
- `player-transport` owns playback transport lifecycle and exposes only a narrow public handshake.
- `app/shell` composes both through public APIs only.

## Implemented Contract

Public contract added:

- `apps/desktop/src/features/player-transport/api/contracts.ts`
- `AudioOutputTransportHandshake`

Contract responsibilities:

- read desired output configuration
- read queue snapshot and armed-source state
- read now-playing volume scalar
- pause/re-arm/resume transport around mode switch
- apply backend playback context
- set native transport flags and fallback state
- surface player error

## Dependency Changes

Implemented:

- Removed `player-transport -> audio-output` runtime dependency.
- `audio-output` now consumes `AudioOutputTransportHandshake` from `player-transport/api`.
- `player-transport` no longer imports `audio-output` internals.

Updated files:

- `apps/desktop/src/features/player-transport/hooks/usePlayerTransportRuntimeState.ts`
- `apps/desktop/src/features/player-transport/hooks/useTransportPolling.ts`
- `apps/desktop/src/features/player-transport/api/index.ts`
- `apps/desktop/src/features/audio-output/hooks/useAudioOutputRuntimeState.ts`
- `apps/desktop/src/features/audio-output/hooks/useAudioOutputController.ts`
- `apps/desktop/src/app/shell/WorkspaceApp.tsx` (composition wiring)

## Deterministic Switch/Recovery Behavior

Current switch path in `audio-output`:

1. request mode
2. pause transport via handshake
3. initialize backend output with explicit mode
4. restore queue + volume
5. re-arm track and resume only when deterministic
6. fetch/apply backend playback context
7. on exclusive failure, warn and fallback to shared init
8. on shared init failure, fallback to browser-shared transport

## Validation

- Contract tests added/updated:
  - `apps/desktop/src/features/audio-output/hooks/useAudioOutputRuntimeState.test.ts`
- Import-boundary checks pass via `scripts/check-boundaries.ps1`.
- Full desktop test suite passes.

Command evidence:

- `corepack pnpm --filter @release-publisher/desktop test -- --run` -> pass
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-boundaries.ps1` -> pass
