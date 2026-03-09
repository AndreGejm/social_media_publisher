# Target Architecture Plan

## 1. Why the Current Structure is Problematic
- **No strict boundaries:** The current React app relies heavily on a single `MusicWorkspaceApp.tsx` and a dumping-ground `hooks/` directory. Features can arbitrarily import from each other, leading to circular dependencies and spaghetti code.
- **Tauri Integration Leaks:** Tauri commands are invoked randomly from UI components and generic hooks rather than from a dedicated backend integration layer.
- **Backend Monolith:** The rust backend relies on a 7,600+ line `commands.rs` file, which creates painful merge conflicts and obscures feature domains. 
- **Implicit Global State:** Side-effect hooks drive global application behavior, making it un-testable and fragile.

## 2. Why the Proposed Structure is Better
- **Feature-Driven:** Code is grouped by domain feature. If you want to change how "Publisher Ops" works, you go to `features/publisher-ops/`, which contains its own components, hooks, and Tauri adapters.
- **Isolated Side-Effects:** The App shell handles global routing and layout, while isolated infrastructure adapters (`services/tauri`) handle all Rust interop. The UI rendering layer will remain pure.
- **Decoupled Rust Commands:** The rust backend will be split strictly into `commands/<domain>.rs`, preventing the monolithic bottleneck.
- **Predictable Discovery:** A standard structure (`app`, `features`, `shared`, `domain`, `services`) ensures new contributors know exactly where code belongs.

## 3. Tradeoffs
- **Duplication of setup:** Some generic UI might appear duplicated if two features can't easily share it without violating the shared-code rule. We accept minor duplication over premature coupling.
- **More files to open:** Decomposing `MusicWorkspaceApp` and `commands.rs` increases the file count, which means navigating via IDE search rather than scrolling through a single file.

## 4. What is Intentionally Not Being Changed
- **Tech Stack:** We are keeping React, Tauri, and Rust. No new monolithic frameworks or state control libraries (like Redux or Zustand) are being added unless absolutely structurally necessary. We are re-organizing, not rebuilding from scratch.
- **Underlying Business Logic:** The core algorithms in the Rust `core` crate are structurally sound and remain untouched.

---

## 5. Proposed Folder Tree

### Frontend (`apps/desktop/src/`)
```text
src/
├── app/                  # App shell, routing, global providers, global styles
├── features/             # Feature modules (domain-driven UI and logic)
│   ├── albums/
│   ├── playback/
│   ├── publish-ops/
│   └── ...
├── domain/               # Pure business logic, core entities, and non-UI models
├── services/             # Infrastructure and API logic (Tauri bindings)
├── shared/               # Truly generic UI components, generic hooks, utils
│   ├── ui/
│   ├── hooks/
│   └── utils/
├── types/                # Global TypeScript types and schemas
├── docs/                 # Application-specific or component-specific documentation
└── tests/                # Global setups, integration test helpers
```

### Backend (`apps/desktop/src-tauri/src/`)
```text
src-tauri/src/
├── commands/             # Granular Tauri command handlers
│   ├── catalog.rs
│   ├── playback.rs
│   ├── release.rs
│   └── ...
├── models/               # Shared Rust models and DTOs (if any remain)
├── core/                 # Instantiation of generic core crate bindings
├── setup.rs              # Tauri initialization logic
├── lib.rs                # Main entrypoint setup
└── main.rs
```

---

## 6. Ownership and Boundary Rules

- **`app/`**: Owns the instantiation of the entire application. It connects features, provides global contexts (like Theme or Layout), and orchestrates the shell. **Rule**: Cannot import from other features' internal sub-folders. Can only import the public interface of a feature.
- **`features/<name>/`**: Owns a distinct slice of user functionality. Must contain its own `components/`, `hooks/`, and `utils/`. **Rule**: Features *cannot* import from other features. If two features need the same logic, it belongs in `domain/` or `shared/`.
- **`shared/`**: Owns reusable, mathematically pure, or purely presentational code (e.g., buttons, formatting utils, standard React hooks). **Rule**: Cannot contain domain-specific logic. Cannot import from `features/` or `domain/`.
- **`domain/`**: Owns pure TypeScript business logic, constants, and pure state functions. **Rule**: Zero React code. Zero Tauri calls. Pure TS only.
- **`services/`**: Owns all asynchronous side-effects, external API definitions, and Tauri IPC bridges. **Rule**: React components must consume services via Dependency Injection or service hooks, never directly invoking `import { invoke } from '@tauri-apps/api/core'` in `features/`.

## 7. Naming Rules
- **Files/Folders:** `kebab-case` for folders. `PascalCase` for React components (`MyComponent.tsx`). `camelCase` for hooks, utils, and services (`useMyHook.ts`, `tauriClient.ts`). Rust files remain `snake_case`.
- **Interfaces:** Prefix with `I` (e.g., `ITrackMetadata`) or simply use distinct model names without prefixes depending on preference, but *remain strict and consistent*. (Opting for `PascalCase` without `I` prefix, representing entities explicitly).
- **Tauri Commands:** Action-oriented, e.g., `cmd_get_track_list`.

## 8. Migration Strategy

1. **Scaffolding:** Create the new missing root directories (`domain/`, `types/`, `shared/hooks/`).
2. **De-dumping `hooks/`:** Move each hook into its destination (either `features/*`, `domain/`, or `shared/`). Fix imports one by one.
3. **Isolating Tauri:** Unify Tauri calls behind a clear `services/tauriClient.ts` facade. Remove direct Tauri imports from UI layers.
4. **Splitting the Frontend Monolith:** Break `MusicWorkspaceApp.tsx` into `AppShell.tsx`, `AppProviders.tsx`, and feature-specific layout containers.
5. **Dismantling the Backend Monolith:** Extract chunks of `commands.rs` into `commands/*.rs` until `commands.rs` is just a registration file.
6. **CSS De-duplication:** Break `styles.css` into smaller feature-specific CSS if time permits, or at least compartmentalize it.

## 9. Refactor Order
1. Rename/move dumping ground files (`hooks/`).
2. Create strict `services/` Tauri boundaries.
3. Split `MusicWorkspaceApp.tsx`.
4. Split `src-tauri/src/commands.rs`.
5. Run tests/lint loop.

## 10. Identified Risks During Migration
- **Loss of Implicit Activity:** The React `hooks/useWorkspaceUiEffects.ts` currently orchestrates behavior invisibly. Moving this might break some workspace synchronizations. We will need to test navigation thoroughly.
- **Rust Tauri Signature Breaks:** Moving Rust commands to multiple files might alter how Tauri macro registers them, especially concerning State payload borrowing.
- **Massive Import Breakage:** Refactoring the folder tree will break hundreds of `import` statements. Rely on TypeScript compiler errors heavily to clean this up.
