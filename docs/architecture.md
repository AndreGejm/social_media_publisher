# Architecture

## Overview
This application is composed of two primary layers:
1. **Frontend (App Shell + Features)**: A React/Vite/TypeScript frontend that strictly isolates domain state from infrastructure interactions.
2. **Backend (Tauri + Rust)**: A high-performance Rust core that provides hardware-level playback, precise audio analysis, database operations, and platform integrations via Tauri IPC commands.

## Module Boundaries
To keep this project maintainable and scaleable, boundaries are explicitly defined across features:

- **Strict Feature Modules**: Components within `apps/desktop/src/features/*` represent discrete business functionalities (like `publisher-ops` or `library-ingest`). They own their distinct set of React hooks and local types.
- **Isolated Side Effects (Tauri)**: Invoking backend commands directly from React UI components is strongly discouraged. All invocations of Tauri pass through explicit service adapters inside `src/services/tauri/`.
- **Pure Domain Definitions**: Cross-feature data structures reside in `src/types/` or `src/domain/` to avoid massive file coupling.
- **Shared Primitives**: Purely functional or stylistic components (like buttons or sanitizers) without business context live in `src/shared/`.

## Dependency Direction
1. **UI Components** -> **Feature Logic (Hooks)** -> **Services (Tauri API)**.
2. **Features** -> **Domain Models/Types** -> **(Nothing)**.
3. Feature components *never* import from other Feature components. If two features share a UI abstraction, it must be extracted to `src/shared/`.

## State & Data Flow
Global layout orchestrations and shell data are bound together inside `app/shell/WorkspaceApp.tsx`, which serves as the highest-level orchestrator of React Contexts, routing, and persistent browser storage flags. 
Lower-level business logic lives exclusively within isolated custom hooks specific to each feature (e.g., `usePlayListActions.ts` governs playlist mutations and queue interactions).

## Frontend / Native Interaction Model
The React frontend is structurally unaware of Rust. All IPC (Inter-Process Communication) and event listening occurs via the bridge interface defined by `apps/desktop/src/services/tauri/TauriClientProvider.tsx` and implemented by `tauriClient.ts`.
On the backend, incoming commands are handled by domain-specific handlers (e.g., `src-tauri/src/commands/catalog.rs`, `<domain>.rs`) that map to the generic capability structures in `crates/core`.
