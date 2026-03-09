# Folder Structure

This repository uses explicit architectural boundaries driven by clear ownership rules rather than arbitrary utility groupings.

## Monorepo Layout

```text
/
├── apps/
│   └── desktop/                 # The React-Tauri desktop shell
│       ├── src/                 # The Frontend codebase
│       └── src-tauri/           # The Tauri backend shell & IPC bindings
└── crates/
    ├── core/                    # Rust domain logic: Audio tracking, pipeline orchestrators
    ├── db/                      # Sqlite adapters and database migrations
    ├── connectors/              # External service adapters
    └── testkit/                 # Simulation and boundary integration tests
```

---

## The Frontend (`apps/desktop/src`)

### What Belongs Where?

*   `app/shell/`
    *   **Owns**: The global entry point, layout wrappers, top-level state orchestrators (like `WorkspaceApp.tsx`), layout contexts, and event buses.
    *   **Anti-Pattern**: Using `app/shell/` to construct complex business logic modals like "Artist Release Plans."

*   `features/<feature-name>/`
    *   **Owns**: Cohesive blocks of user functionality like `library-ingest`, `publisher-ops`, or `play-list`. Each folder contains entirely self-sufficient logic (React components, test suites, types, and hooks).
    *   **Anti-Pattern**: Reaching into `<feature-name>` from outside of it to steal a component. If multiple features need it, it goes to `shared/`.

*   `services/tauri/`
    *   **Owns**: Every single invocation of `invoke()` or `listen()` from the Tauri API core. These are wrapped into explicitly typed TypeScript client adapters.
    *   **Anti-Pattern**: Seeing `@tauri-apps/api` imported inside a `features/` component.

*   `shared/`
    *   **Owns**: Dumb, pure components (like generic buttons, tooltip components) and pure mathematical hooks (like formatting libraries, UI sanitizers).
    *   **Anti-Pattern**: Placing logic related to "Downloading Tracks" into the `shared/` folder.

*   `types/`
    *   **Owns**: Universal schema definitions required across the disparate apps/features.
    *   **Anti-Pattern**: Storing explicit feature-local types here. Keep feature logic in `features/`!

---

## Anti-Patterns to Avoid

1.  **Dumping Grounds:** You will not find `utils/`, `helpers/`, `common/`, or `misc/` in the root directories of this codebase. They become unchecked garbage pits of decoupled logic. If a function parses dates, name the folder `datetime/` inside `shared/`.
2.  **Hook Swamps:** The prior `src/hooks/` root directory has been abolished. Hooks belong directly tied to the feature boundary that manages that logic.
3.  **God Objects:** Limit the size of `WorkspaceApp.tsx` and `commands.rs`. 
