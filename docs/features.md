# Features

The frontend application uses a decoupled feature-based architecture.

## Current Major Features

| Feature Name | Primary Responsibility | Directory | Key Dependencies |
| --- | --- | --- | --- |
| **Workspace Shell** | Core UI orchestrator handling resizes, active modes, topbars, and sidebar panels. | `features/workspace/` | Relies on `shared/` UI bindings. |
| **Library Ingest** | Coordinates file drops and deep folder scanning of external roots to import local track metadata. | `features/library-ingest/` | Polling hooks, `services/tauri/`. |
| **Player / Playback** | Governs global player transport UI, playback queue synchronization, native transport controls, and QC sessions. | `features/player/` | `features/publish-selection/` |
| **Playlists & Catalog** | Renders dynamic lists of loaded and grouped catalog tracks based on user filtering. | `features/play-list/` | Core track detail loading models. |
| **Track Details** | Provides dense metadata viewing and editing capabilities for tracks. | `features/track-detail/` | Requires selected active track IDs. |
| **Publisher Ops** | Provides the standalone structured workflow steps for drafting and executing releases. | `features/publisher-ops/` | Standalone; manages its distinct API layer. |

## Feature Dependencies
- Feature silos (`features/publisher-ops/`) inherently operate independently of sibling features (like `features/settings/`).
- Only `app/shell/WorkspaceApp.tsx` actively strings together and mounts different features based on active URL routes or active global state flags.

## Key Extension Points
- **Creating a new View/Workspace**: 
  1. Add the domain logic to a new directory `features/<your-domain>`.
  2. Implement hooks for logic inside `features/<your-domain>/hooks/`.
  3. Wire the visual layout of your feature to the active views registry mapped inside `app/shell/WorkspaceApp.tsx`.
- **Extending Tauri Logic**:
  Map out new endpoints inside `crates/core` or `src-tauri/src/commands/`. Re-export matching types down into `src/services/tauri/TauriClientProvider.tsx` for React to safely consume.
