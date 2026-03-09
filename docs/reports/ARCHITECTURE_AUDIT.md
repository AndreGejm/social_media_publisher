# Architecture Audit

## Current Workspace Map

The workspace is organized as a monorepo with `apps/` for the frontend/Tauri app and `crates/` for the Rust backend capabilities.

### `apps/desktop/`
- **`src/`:** Contains the React frontend.
  - `app/`: Shell, layout, events.
  - `features/`: Module folders containing UI components (e.g., `albums`, `play-list`, `player`, `workspace`).
  - `hooks/`: A flat dumping ground for 20+ hooks managing state, side-effects, and Tauri calls.
  - `infrastructure/` & `services/`: Tauri clients and drag-and-drop.
  - `shared/`: Shared UI, input, media libraries.
  - Base level: `MusicWorkspaceApp.tsx` (~1,500 lines), `tauri-api.ts` (giant single API file), `styles.css` (72KB massive stylesheet).
- **`src-tauri/`:** Tauri application shell and Rust commands.
  - `src/commands.rs` (7,600+ lines): A colossal file containing the bulk of the command and data model definitions.
  - `src/commands/`: A newer attempt at modularizing commands by domain (`catalog.rs`, `playback.rs`, etc.), overlapping with `commands.rs`.

### `crates/`
- **`core/`:** Domain logic for the Rust backend (audio processing, orchestrator, pipeline, circuit breaker).
- **`db/`:** Database migrations and SQLite access logic.
- **`connectors/` & `testkit/`:** Infrastructure adapters and testing utilities.

---

## Findings by Severity

### Critical
- **Giant File (Backend):** `apps/desktop/src-tauri/src/commands.rs` is over 7,600 lines long. It is a massive dumping ground for types, traits, and command handlers.
- **Giant File (Frontend):** `apps/desktop/src/MusicWorkspaceApp.tsx` is over 1,500 lines, mixing routing, state definitions, business logic, global shortcuts, and UI rendering.
- **Frontend/Backend Boundary Confusion:** Tauri bindings are scattered. There is `tauri-api.ts` (a 26KB monolith), `services/tauriClient.ts`, and feature-specific clients like `features/publisher-ops/api/publisherOpsClient.ts`.
- **Poor State Organization:** The `src/hooks/` folder contains 22 disparate hooks (`useAutoClearString`, `usePublishSelectionState`, `useWorkspaceUiEffects`, etc.). It mixes pure React state, complex domain state, and side-effects.

### High
- **Hidden Coupling:** Hooks like `usePlayerShellSync` and `useWorkspaceUiEffects` indicate implicit coupling where side-effects synchronize global UI state instead of an explicit state manager or finite state machine.
- **Overlapping Modules:** The Rust backend has both `src-tauri/src/commands.rs` (monolithic) and `src-tauri/src/commands/` (domain-specific). Same on the frontend with varied Tauri API integration approaches.
- **UI Mixed with Business Logic:** `MusicWorkspaceApp.tsx` handles everything from displaying notices to coordinating publish workflows.

### Medium
- **Giant Shared Styles:** `src/styles.css` is over 72KB, making it difficult to maintain and track unused CSS.
- **Weak Feature Modularity:** While a `features/` directory exists, feature states and logic are heavily coupled to `MusicWorkspaceApp.tsx` and the `hooks/` folder, violating strict module boundaries.
- **Weak Documentation:** Missing high-level architectural documentation outlining how state flows or how Tauri and React coordinate.

---

## Findings by Category

### Safe to Remove / Dead Code
- Legacy unused types/exports inside the massive `commands.rs` as it migrated to `commands/`.
- Unused unified API clients if the feature-specific clients superseded them (requires manual review to delete safely).

### Safe to Move
- Domain-specific hooks from `src/hooks/` to their respective `src/features/` folders.
- Extracted generic UI hooks from `src/hooks/` to `src/shared/hooks/`.

### Should be Split
- `MusicWorkspaceApp.tsx` must be split by responsibility: routing, global state provider, main layout renderer.
- `commands.rs` must be completely dismantled into domain-specific modules inside `crates/core` or `src-tauri/src/commands/`.
- `styles.css` should be decomposed into feature-specific CSS modules or styled-components.
- `tauri-api.ts` should be broken down into domain-specific API files.

### Should be Merged
- The various Tauri clients (`tauri-api.ts`, `tauriClient.ts`, `publisherOpsClient.ts`) should be unified under a consistent factory or domain-driven structure.

### Should be Isolated Behind an Interface
- Tauri side-effects and API calls should be isolated from React components using a clear adapter pattern, avoiding direct `invoke` scattered across UI logic.

### Risky / Needs Manual Review
- Consolidating the implicit effect chains (`useWorkspaceUiEffects`) into an explicit state machine. Breaking this could cause regressions in UI responsiveness.

---

## Top 10 Maintainability Risks

1. **`commands.rs` Monolith:** 7,600+ lines make concurrent backend development nearly impossible without merge conflicts.
2. **`MusicWorkspaceApp.tsx` God Object:** Any change to any feature risks breaking the global app.
3. **Implicit State Sync via Effects:** Debugging state issues is difficult when states update via disconnected `useEffect` hooks across `src/hooks/`.
4. **Scattered Tauri Bindings:** Without a single source of truth for the Tauri boundary, API misuse and type desync are highly likely.
5. **Dumping-Ground `hooks/`:** Promotes code reuse by proximity rather than strict boundaries; hooks are doing too many things.
6. **Bloated Global CSS:** 72KB of global CSS increases the risk of regression when changing any class name.
7. **Business Logic in React UI:** Complex logic directly living inside views makes unit testing difficult and ties domain rules to rendering.
8. **Inconsistent Rust Modularity:** Overlapping structures between `src-tauri/commands.rs` and the decoupled `crates/core` bounds limit code reuse.
9. **Lack of Enforceable Boundaries:** Features can import from any other feature indiscriminately.
10. **Zero Architecture Documentation:** New contributors have no map for where to place logic, extending the unstructured dumping grounds.

---

## Quick Wins

1. Move feature-specific files from `hooks/` to `features/*/`.
2. Move generic files from `hooks/` to `shared/hooks/`.
3. Split `MusicWorkspaceApp.tsx` into smaller provider and layout components.
4. Eliminate `infrastructure/` and `services/` if they just wrap Tauri in redundant ways, consolidating into a single `lib/api/` folder.

## Assumptions and Unknowns
- We assume `src-tauri/src/commands/` is the preferred target structure and `commands.rs` is a legacy monolith that was partially refactored.
- We assume `tauri-api.ts` is a legacy generated or monolithic file that should be decomposed.
- Validation bounds for "working functionality" might be tricky if tests don't cover all implicit effect chains. Proceed carefully when splitting `MusicWorkspaceApp.tsx`.
