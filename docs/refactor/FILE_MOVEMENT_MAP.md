# File Movement Map

Date: 2026-03-09

## New boundary entrypoints

| Legacy host area | New boundary path | Movement type | Notes |
| --- | --- | --- | --- |
| `services/tauri/tauri-api.ts` invoke/error ownership | `services/tauri/core/{commands,types,validation}.ts` | implementation extraction | Core invoke path, UI error model, and argument guards now live in `core` |
| `services/tauri/tauri-api.ts` audio ownership | `services/tauri/audio/{commands,types,mappers}.ts` | implementation extraction | Audio IPC calls, validation, and output-status sanitization moved to `audio` |
| `services/tauri/tauri-api.ts` catalog ownership | `services/tauri/catalog/{commands,types}.ts` | implementation extraction | Catalog command validation/sanitization owned by catalog bridge |
| `services/tauri/tauri-api.ts` QC ownership | `services/tauri/qc/{commands,types}.ts` | implementation extraction | QC command validation/sanitization owned by QC bridge |
| `services/tauri/tauri-api.ts` publisher ownership | `services/tauri/publisher/{commands,types}.ts` | implementation extraction | Publisher draft IPC call and response type owned by publisher bridge |
| `services/tauri/tauri-api.ts` dialog ownership | `services/tauri/dialog/commands.ts` | implementation extraction | Native folder picker runtime/timeout/error handling owned by dialog bridge |
| monolithic TS bridge implementation host | `services/tauri/tauri-api.ts` (compatibility exports only) | host reduction | `tauri-api.ts` remains compatibility surface, not implementation owner |
| playback command calls embedded in `commands/playback.rs` | `commands/backend_audio_service.rs` | backend service boundary intro | Playback command handlers delegate through backend audio service facade |
| playback runtime block in `commands.rs` | `commands/backend_audio_service/runtime.rs` | runtime extraction | Runtime ownership moved under `backend-audio-service` entrypoint |
| mixed playback runtime concerns in `commands.rs`/single `runtime.rs` file | `commands/backend_audio_service/runtime/{control_plane,decode,render,status}.rs` | internal module split | Runtime concerns split by ownership for deterministic maintenance scope |

## Compatibility shims

| Shim path | Delegates to | Purpose |
| --- | --- | --- |
| `apps/desktop/src/features/player/hooks/usePlayerTransportState.ts` | `apps/desktop/src/features/player-transport/hooks/usePlayerTransportRuntimeState.ts` | Preserve legacy import compatibility while ownership migrates |
| `apps/desktop/src/services/tauri/tauri-api.ts` | domain bridge modules (`core/audio/catalog/qc/publisher/dialog`) | Preserve legacy TS import path while implementation ownership migrates |
| `apps/desktop/src-tauri/src/commands.rs` test-only re-exports | `backend_audio_service::runtime` helper surface | Preserve command-adjacent tests while runtime ownership migrates |

## Import rewires completed

- `tauriClient.ts` routes audio IPC exports/types through `services/tauri/audio/index.ts`.
- `tauriClient.ts` routes non-audio exports/types through `services/tauri/{catalog,qc,publisher,dialog,core}`.
- Domain bridge files no longer import implementation from `tauri-api.ts`; ownership is local to each bridge domain.
- `commands/playback.rs` routes playback/output operations through `backend_audio_service`.
- `backend_audio_service/runtime.rs` exports production runtime surface only; helper exports are test-gated.

## Remaining legacy hosts (intentional)

| Legacy host | Reason retained in this pass | Planned destination |
| --- | --- | --- |
| `apps/desktop/src-tauri/src/commands.rs` non-playback orchestration and shared command-adjacent tests | First-wave focused on audio/output pilot path and bridge boundaries | Future domain service extraction (`backend-catalog-service`, `backend-publishing-service`, etc.) |

## Guardrails added

- ESLint `no-restricted-imports` blocks `services/tauri/tauri-api` imports outside `src/services/tauri/*`.
- Frontend modules consume Tauri calls through `tauriClient` public entrypoint, which now composes domain bridge modules.
- Playback command handlers no longer own runtime internals directly; runtime state mutations occur under `backend_audio_service` ownership.
