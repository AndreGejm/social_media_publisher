# Release Publisher Desktop

This project is a React-Vite front-end bundled with a Tauri-Rust backend. It handles heavy media processing, catalog streaming, and metadata editing efficiently on native desktop hardware.

## Stack Overview
- **Frontend**: React, TypeScript, Vite.
- **Backend / Integration Shell**: Tauri, Rust (cargo), SQLite (`crates/db`).
- **Architectural Style**: Feature-Based Domain Isolation. Layout governed tightly by specific module domains (e.g. `features`, `app/shell`, `services`).

---

## Run Instructions

To install dependencies locally:
```bash
# In the workspace root
pnpm install
```

To run the local development configuration leveraging Tauri bindings:
```bash
# Run the Desktop Desktop + Tauri wrapper concurrently
npm run dev
# OR explicitly:
npm run tauri dev
```

## Build Instructions
Producing full executable releases requires native toolchains:
```bash
npm run tauri build
```
The output executable will land inside the standard platform target directory (`src-tauri/target/release/`).

## Test & Lint Instructions

**Frontend Validation (React/TSX):**
```bash
cd apps/desktop
pnpm typecheck
pnpm lint
pnpm test
```

**Backend Validation (Rust/Tauri):**
```bash
cargo test --all-targets --workspace
cargo clippy --all-targets --workspace
```

---

## High-Level Architecture Overview

1. `apps/desktop/src`: Responsible entirely for layout logic boundaries. Communicates cleanly via `src/services/tauri/` bridges to avoid coupling directly with Rust APIs.
2. `apps/desktop/src-tauri`: Houses the raw Tauri application wrapper. Generates custom capabilities and connects bridging modules mapping the UI inputs back out to the raw `crates/` algorithms.
3. `crates/*`: Purely rust components that dictate deep application logic: sqlite interaction (`crates/db`), file streaming processors (`crates/core`), and mock adapters (`crates/connectors/mock`).

**Where to Add New Functionality?**
If it's UI functionality tied to a new workspace tab, build inside `apps/desktop/src/features/`. Do not pollute `src/shared/`.
If it's a backend operation, add it to `src-tauri/src/commands/<domain>.rs`, and define its API contract inside `apps/desktop/src/services/tauri/tauriClient.ts`.

---

## Detailed Documentation 

Reference the internal `docs/` folder for deeply established architectural rules.
- [Architecture Overview](docs/architecture.md)
- [Folder Structure](docs/folder-structure.md)
- [System Features](docs/features.md)
- [Development Conventions](docs/conventions.md)
- [Cleanup Log Summary](docs/cleanup-summary.md)
