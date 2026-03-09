# DEAD CODE REMOVAL REPORT

Date: 2026-03-09

## Method

- Static text reference scan (`rg`) across workspace for candidate filenames/import paths.
- Manual ownership review against current bounded modules (`audio-output`, `player-transport`, `tauri-* bridge`, backend service splits).
- Conservative deletion policy: medium-confidence compatibility files removed only after no in-repo consumer evidence.

## Removed

| Path | Reason | Evidence | Confidence | Outcome |
| --- | --- | --- | --- | --- |
| `apps/desktop/src/features/player/hooks/usePlayerTransportState.ts` | Legacy compatibility wrapper superseded by `player-transport` API surface | No in-repo import consumers; wrapper only forwarded to runtime state hook | High | Deleted |
| `apps/desktop/src/services/tauri/tauri-api.ts` | Compatibility shim superseded by domain bridge modules + `tauriClient` | No in-repo runtime consumer imports | Medium | Deleted |
| `apps/desktop/src/services/tauri/tauri-api-core.d.ts` | Legacy declaration coupled to removed `tauri-api.ts` shim | No in-repo usage after shim retirement | Medium | Deleted |
| `apps/desktop/src/services/tauri/tauri-api.test.ts` | Tests only the removed compatibility shim surface | Test imported removed shim exclusively | Medium | Deleted |
| `scripts/extract_types.js` | One-off migration utility | No package script or repo references | High | Deleted |
| `scripts/fix_imports.js` | One-off migration utility | No package script or repo references | High | Deleted |
| `scripts/move_hooks.js` | One-off migration utility | No package script or repo references | High | Deleted |
| `scripts/move_root_components.js` | One-off migration utility | No package script or repo references | High | Deleted |
| `apps/desktop/src/hooks/` (empty dir) | Legacy location after hook migration | Directory empty; no file ownership | High | Deleted |

## Left For Manual Review

None in this pass.

## Notes

- Compatibility-layer retirement is now complete for `tauri-api*` files.
- Active Tauri frontend access remains through `apps/desktop/src/services/tauri/tauriClient.ts` and domain bridge modules.
