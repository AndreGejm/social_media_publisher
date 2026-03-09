# Pre-Publish Hardening: Backlog & Implementation Plan

This plan focuses on immediate, high-value stability and correctness items before publishing. It explicitly filters out broad architectural refactoring (e.g., God-component teardowns) and downgrades speculative lifecycle issues in favor of concrete bug fixes and testability improvements.

---

## 📋 Prioritized Backlog

### P0: Critical Stability & Correctness (Immediate Action)
These items address explicit bugs, unhandled errors, and render-churn that actively degrade stability.

1. **Centralize UI Error Checking (`tauri-api.ts`, `usePlayerTransportState.ts`)**
   - **Context:** The duck-typed `UiAppError` structural check is duplicated in multiple places. It is risky if the backend error shape evolves.
   - **Task:** Extract an `isUiAppError` type guard into `tauri-api.ts` and refactor existing callers (`invokeCommand`, `normalizeUiError`, `pickDirectoryDialog`) to use it.

2. **Fix Empty/Single Codec Profile Handling (`useQcPreviewLifecycle.ts`)**
   - **Context:** If a user has < 2 codec profiles available, the default selection logic creates an invalid A/B pair (`"" === ""`), causing a backend `INVALID_ARGUMENT` error.
   - **Task:** Update `selectDefaultCodecPreviewPair` to safely return `null` when sufficient profiles are not available, and gracefully short-circuit the QC session preparation.

3. **Harden `useLibraryIngestActions.ts` (Callback Churn & Swallowed Errors)**
   - **Context:** Action callbacks are recreated on every render due to depending on the inline `[args]` object constraint. Furthermore, `queueLibraryRoot` entirely swallows `catalogAddLibraryRoot` failures, rendering them invisible.
   - **Task 1:** Stabilize callback dependencies using stable refs (`argsRef.current`).
   - **Task 2:** Update the `catch` blocks in `handleIngestDroppedPaths` to increment `scanFailureCount` or surface root-add errors explicitly instead of returning `null` silently.

4. **Fix Edge-Case Media URL Encoding (`media-url.ts`)**
   - **Context:** `encodeURI` does not encode `#` or `%`. Local paths containing these characters will fail to load in the Tauri WebView because they are misinterpreted as URL fragments.
   - **Task:** Replace `encodeURI` with segment-by-segment `encodeURIComponent` for the `file://` fallback construction.

5. **Establish Fake Timer Unit Tests for Polling Hooks**
   - **Context:** Hard-to-reproduce bugs and flakiness often stem from polling loops (`useIngestJobPolling.ts` at 500ms, `usePlayerTransportState.ts` at 250ms). 
   - **Task:** Write robust unit tests utilizing `vi.useFakeTimers()` to validate polling intervals, terminal states, and cleanup behavior correctly without flaky timeouts.

### P1: Minor Tightening (Low/Medium Risk)
These items are low risk but offer incremental durability.

6. **Tighten `trackSearch` Closure in Drop Autoplay (`useDroppedIngestAutoplayController.ts`)**
   - **Context:** The captured `trackSearch` string could theoretically be stale if the user types a new search while an ingest job is finishing (though the completion ref-refresh mitigates this heavily).
   - **Task:** Add a `trackSearchRef` to ensure the post-ingest track listing always uses the absolute latest search query.

### P2: Deferred / Backlog (Refactoring & Speculative)
*(To be addressed post-publish or skipped)*
- Teardown of `MusicWorkspaceApp.tsx` God-component.
- Transformation of `services/tauriClient.ts` into a mockable DI boundary.
- `orchestrator.rs` and other backend Rust recommendations (pending targeted backend review).
- Dropped path `setPlayListModeWithQueueSync` setter refactoring (assumed safe since it's a memoized callback).

---

## 🚀 Implementation Plan

The followings steps represent the execution sequence for the **P0** and **P1** items. 

### Phase 1: Core Utilities & API 
*Focus on pure functions and isolated utilities.*

- **Step 1:** Edit `apps/desktop/src/tauri-api.ts`
  - Export `isUiAppError(error: unknown): error is UiAppError`.
  - Update `invokeCommand` and `pickDirectoryDialog` to utilize it.
- **Step 2:** Edit `apps/desktop/src/hooks/usePlayerTransportState.ts`
  - Update `normalizeUiError` to utilize `isUiAppError`.
- **Step 3:** Edit `apps/desktop/src/media-url.ts`
  - Refactor `localFilePathToMediaUrl`'s fallback paths to use `encodeURIComponent` correctly on path segments to protect against `#` and `%`.

### Phase 2: State Management & Hook Hardening
*Focus on correcting React lifecycles, memory churn, and logical bugs.*

- **Step 4:** Edit `apps/desktop/src/hooks/useQcPreviewLifecycle.ts`
  - Modify `selectDefaultCodecPreviewPair()` to return `null` if the available profiles are `< 2`. 
  - Update exactly one invocation to handle `null` by clearing the active preview session and returning early.
- **Step 5:** Edit `apps/desktop/src/hooks/useLibraryIngestActions.ts`
  - Introduce `const argsRef = useRef(args); useEffect(() => { argsRef.current = args; }, [args]);`.
  - Remove `args` from the dependency arrays of all exported callbacks (`handleImport`, `handleAddLibraryRoot`, etc.) and replace usage with `argsRef.current`.
  - Fix the `catch` block around `queueLibraryRoot` to correctly aggregate failures.
- **Step 6:** Edit `apps/desktop/src/hooks/useDroppedIngestAutoplayController.ts`
  - Add `trackSearchRef` synchronized via `useEffect`.
  - Replace `trackSearch` with `trackSearchRef.current` inside the `useIngestJobPolling` completion callback.

### Phase 3: Test Coverage (Polling Integrity)
*Focus on test infra for timing-sensitive hooks.*

- **Step 7:** Create/Edit tests for `useIngestJobPolling.ts`
  - Implement a `useFakeTimers()` vitest suite.
  - Assert that 500ms advances trigger status checks.
- **Step 8:** Create/Edit tests for `usePlayerTransportState.ts`
  - Implement fake-timer assertions for the 250ms transport polling loop.

---
*If you are aligned with this scoped plan, we can begin executing **Phase 1**.*
