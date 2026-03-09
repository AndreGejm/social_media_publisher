# Conventions

When modifying this repository, adhere strictly to the conventions outlined to preserve architecture sanity.

---

## 1. Naming Rules

- **Files/Folders:**
  - `kebab-case` for folders (e.g., `play-list`, `publisher-ops`).
  - `PascalCase` for React components (e.g., `MyComponent.tsx`).
  - `camelCase` for hooks, utility functions, and API clients (e.g., `useMyHook.ts`, `tauriClient.ts`).
  - `snake_case` for all Rust files (`crates`, `src-tauri/src/commands/`).

- **Tauri Commands:**
  - Action-oriented naming. Avoid passive names. Stick to structures like `cmd_get_track_list` or `qc_reveal_blind_x`.

---

## 2. File Organization Rules

- Put logic where it belongs: Domain state lives with the Feature (inside `hooks/`). UI rendering components live in `features/<domain>/`.
- **Imports:** Try to avoid circular React importing. React components should consume logic linearly from `hooks/` to the Feature index layout.
- The `WorkspaceApp.tsx` file handles routing and context allocation. Modals specific to a flow should be nested locally rather than injected universally.

---

## 3. Code Placement Rules

- **Strict isolation:** Business logic goes entirely into pure functions, pure models (`Types/Models`) or bounded Hooks (`features/*/hooks/*`). Do not build pure complex JS inside the return function of the component (`return <div ... />`).
- **Data Flow:** Extracting specific props through generic components (drilling). Use custom UI properties to enforce encapsulation layout (i.e. spacing utilities or generic React containers).

---

## 4. Shared Code Rules

- The `shared/` folder contains truly generic constructs that have no knowledge of the application rules or domain logic, such as a reusable `HelpTooltip.tsx` or `shortcuts.ts`.

---

## 5. Refactor Guardrails for Future Contributors

If you feel the urge to do this, step back:
1. "Adding a `utils` folder to the root project."
2. "Creating a 2,000 line React component because prop drilling is annoying."
3. "Invoking an raw Tauri function inside an deeply nested form UI button."
4. Use the explicit structural locations for your capabilities!
