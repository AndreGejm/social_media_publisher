# Code Review — Tauri QC Player & Distribution Desktop App

> **Reviewers acting as:** Scrum Master · System Architect · Principal Software Engineer · Principal QA Engineer
>
> **Date:** 2026-03-01
> **Reviewed commits:** current HEAD (post git scrub)
> **Build target:** Windows desktop (Tauri 2.x + React 19 + Rust 2021)

---

## Repo Intake Checklist (answered from what was provided)

| # | Item | Status |
|---|------|--------|
| 1 | Full directory tree | ✅ mapped |
| 2 | `tauri-api.ts` (IPC layer) | ✅ read |
| 3 | All 19 custom hooks | ✅ key hooks read |
| 4 | `ui-sanitize.ts` | ✅ read |
| 5 | `media-url.ts` | ✅ read |
| 6 | `crates/core/src/audio_processor.rs` | ✅ read |
| 7 | `crates/core/src/orchestrator.rs` | ✅ read |
| 8 | `crates/core/src/retry.rs` | ✅ read |
| 9 | `apps/desktop/src-tauri/src/commands.rs` | ⚠️ **not read (290 KB)** — key assumptions listed per section |
| 10 | `crates/db/` migrations + schema | ⚠️ not read — Db abstraction inferred from orchestrator usage |
| 11 | Test output / CI logs | ⚠️ not provided — gaps noted where flakiness risk is identified |

**Assumption risk rating:** MEDIUM. The Tauri command handler (`commands.rs`) is the largest single file and the primary integration boundary. All findings labelled `[CMD?]` may be invalidated once it is reviewed.

---

## B. ARCHITECTURE REVIEW

### Module boundaries and separation of concerns

```
apps/desktop/src/
  tauri-api.ts          ── IPC contract (good boundary)
  services/tauriClient  ── re-export of tauri-api (thin pass-through, adds nothing)
  ui-sanitize.ts        ── output sanitization (good boundary)
  media-url.ts          ── path → URL transformation (good boundary)
  hooks/                ── ALL domain logic lives here (⚠️ too fat)
  features/             ── UI components
  MusicWorkspaceApp.tsx ── 70 KB god-component (⚠️ critical boundary collapse)
  App.tsx               ── 35 KB shell (⚠️ still large)
```

**Issue B-1 (P1): God-component anti-pattern.**
`MusicWorkspaceApp.tsx` (70 KB) and `App.tsx` (35 KB) almost certainly hold state and effect logic that belongs in the hook layer. A 70 KB component file is a clear signal that multiple distinct domains (playback, catalog, QC, publishing, UI layout) are entangled in a single render tree. This makes it impossible to test individual concerns or reason about render boundaries.

**Issue B-2 (P1): `services/tauriClient` is a pointless re-export.**
`services/tauriClient` adds a layer of indirection but no value. Either it should become the real DI seam (with a mock-friendly interface) or it should be removed. Currently, hooks import directly from `tauri-api.ts` in some places and `services/tauriClient` in others — see `usePlayerTransportState.ts` vs. `useIngestJobPolling.ts`.

**Issue B-3 (P2): Hook arguments are raw `Dispatch<SetStateAction<T>>` pairs.**
Many hooks (`useQcPreviewLifecycle`, `useLibraryIngestActions`) accept 10–20 individual state setters. This is a symptom of state fragmentation. Passing setters across boundaries is a soft form of shared mutable state and makes the hooks untestable without composing the full parent.

### Data flow and state invariants

The playback state machine spans at least four interacting concerns:
1. `usePlayerTransportState` — native vs. HTML audio source-of-truth
2. `useQcPreviewLifecycle` — overrides the player source for codec preview
3. `useDroppedIngestAutoplayController` — auto-plays after folder drop
4. `MusicWorkspaceApp` — holds the queue and selected track

**Issue B-4 (P0): No single source of truth for the active player source.**
`playerTrackId` and `playerExternalSource` can be independently set since they model a mutual-exclusion invariant without enforcing it in one place. `useQcPreviewLifecycle` resets them via raw setters. If two effects race (e.g., a scan completes while QC preview is loading), both can call `setPlayerTrackId` and `setPlayerExternalSource` concurrently, producing transient invalid states.

**Issue B-5 (P1): `nowPlayingStateRef` is a stale-closure workaround for a sync problem.**
The ref is updated in an effect: `nowPlayingStateRef.current = nowPlayingState`. This pattern is safe only if the ref is read exclusively in callbacks/effects that fire *after* the sync effect. Currently `setNowPlayingQueueVisible` reads `nowPlayingStateRef.current` before any await. Risk: if React batches the state update and the ref sync effect *after* the callback reads the ref, the value will be one render behind.

### Async patterns and StrictMode safety

**Issue B-6 (P0 — StrictMode): Multiple effects use `let cancelled = false` but the pattern is not applied consistently.**
In `usePlayerTransportState` (line 284–311), the `cancelled` guard is used correctly. However, `useQcPreviewLifecycle` lines 280–331 mix `void promise.then().catch()` with a `cancelled` ref — the `.finally` sets loading to false, but neither `.then` nor `.catch` check `cancelled` before calling `setQcPreviewSession` (they do, line 288 and 308). If the component unmounts *after* the `if (cancelled) return` guard but before a nested async call inside `.then` completes, the nested call (e.g., `applyQcPreviewPlaybackSourceRef.current(session)`) is still live and will set state on an unmounted component.

**Issue B-7 (P1): `useIngestJobPolling` double-fires the first poll.**
The effect at line 74–145 calls `void pollJobs()` immediately and then starts `setInterval`. Under React 18 Strict Mode (double-invoke in dev), this means the first mount runs two polls, the cleanup cancels both, and the second mount starts fresh — the `completedJobStatusesRef` is in a stale state between the double-invoke runs. The fix is to use `setTimeout(pollJobs, 0)` and then reschedule inside the loop, or use a proper polling hook abstraction.

**Issue B-8 (P1): Polling in `useDroppedIngestAutoplayController` has no missing `deps` guard.**
`useIngestJobPolling` is called with an inline `onJobsCompleted` callback (line 85) that closes over `trackSearch`, `loadCatalogTracks` and three other values. These are NOT in the dependency array because `useIngestJobPolling` does not receive them as deps — it captures them at call time via the ref pattern. However, `trackSearch` itself can be stale because `loadCatalogTracks` may use `trackSearch` from the outer closure that was captured on the *first* render only.

### Concurrency and determinism risks

| Risk | Location | Severity |
|------|----------|----------|
| Race between QC session load and track change | `useQcPreviewLifecycle` L157–183 | P1 |
| Volume throttle timer not cancelled on component unmount if `scheduleNativeVolumeSync` fires after unmount | `usePlayerTransportState` L219–226 | P1 |
| Batch export polling loop assigns `timeoutId` before `pollStatus` is awaited, so cleanup may clear the wrong ID | `useQcPreviewLifecycle` L362–416 | P1 |
| `catalogListTracks` pagination in `onJobsCompleted` has no cancellation for slow pages | `useDroppedIngestAutoplayController` L97–106 | P2 |
| `RunReleaseInput.media_bytes: Vec<u8>` — full file in RAM | `orchestrator.rs` L67 | P2 |

---

## C. CODE HEALTH REVIEW (FILE-BY-FILE)

### `apps/desktop/src/tauri-api.ts` (809 lines)

**Purpose:** IPC contract layer. Validates arguments before IPC, sanitizes responses after IPC.

**Correctness:**
- `invokeCommand` (L419–448): the duck-type check for `UiAppError` is duplicated verbatim in 3 places (`invokeCommand`, `usePlayerTransportState.normalizeUiError`, `pickDirectoryDialog`). Should be a single exported type guard.
- `assertHexId` (L69–76) lowercases before checking, but the regex check passes the lowercased form back — this is correct but non-obvious. The returned value is the normalized one; callers must not use the original `value`.
- `qcSetPreviewVariant` (L703–713) validates `variant` with an array-includes check vs. `QcPreviewVariant` union type. TypeScript types are erased at runtime, so the runtime check is correct, but the two lists (type + array) can drift. **Fix:** derive from a const array.

**Maintainability:**
- The 15 `sanitize*` functions are mechanical and correct but untested as a group. No property test checks that every field in the response types is sanitized.
- `MAX_PLAYBACK_QUEUE_TRACKS = 10_000` and `MAX_PLAYBACK_QUEUE_INDEX = 9_999` are coupled constants that can drift.
- `pickDirectoryDialog` (L764) uses a dynamic `import()` inside an async function with a timeout race. The module is never cached. On slow machines, the dynamic import itself could race with the timeout.

**Performance:**
- `sanitizeUiText` iterates the string character by character with `codePointAt`. For path strings (4096 chars), this is fine, but for `peak_data` arrays no sanitization is applied — that's correct but worth a comment.

**Test gaps:**
- No test for `assertHexId` normalization (value trimmed + lowercased before return).
- No test for `pickDirectoryDialog` timeout path.
- No test for `invokeCommand` structural guard — pass an object `{code: 1}` and verify it's re-wrapped.

**TODO:**
- [ ] P0: Extract `isUiAppError(error): error is UiAppError` type guard, used in all three places.
- [ ] P1: Derive `QcPreviewVariant` from a `const PREVIEW_VARIANTS = [...] as const` array.
- [ ] P2: Cache the `@tauri-apps/plugin-dialog` dynamic import.

---

### `apps/desktop/src/hooks/usePlayerTransportState.ts` (638 lines)

**Purpose:** Manages the dual-mode player (native Tauri transport vs. HTML audio element), volume, seek, queue, and publisher bridge.

**Correctness (P0):**
- `scheduleNativeVolumeSync` (L129–148) calls itself recursively if `pending != null`. If `sendVolumeToNativeTransport` throws and `setPlayerError` is called while `volumeSyncThrottleActiveRef.current` is still `true` and `volumeSyncTimerRef.current` fires, the timer is cleared at unmount (L219–226) — **but only in a cleanup effect that closes over no deps**. If the component re-renders with a new `nativeTransportEnabled=true`, the old timer is never cleared (the cleanup ran for the first-render effect, not for subsequent re-renders). This could cause double-fires.
- `normalizeUiError` (L264–279) is defined inline inside the hook on every render. It has no deps and could be defined outside the hook or memoized.
- `setPlayerIsPlaying(current => current ? false : current)` (L345) is equivalent to `setPlayerIsPlaying(false)` with an unnecessary conditional. While harmless (no extra render), it signals cargo-cult patterns.
- The polling effect (L454–494) at 250ms calls both `getPlaybackContext` and `getPlaybackDecodeError` sequentially. If one IPC call takes 200ms, the actual poll period becomes 450ms+ and decode errors lag. These should race or be combined into a single Rust command.

**Correctness (P1):**
- `ensureExternalPlayerSource` (L496–519) compares all fields to determine equality. `durationMs` is a float, and floating-point equality is used. For most practical cases this is fine, but if `durationMs` comes from a computation that varies by epsilon between renders it will cause unnecessary re-sets.
- `ExternalPlayerSource` and `ResolvedPlayerSource` are structurally identical types (L30–44). This is confusing. One should be deleted or renamed.
- `publisherOpsTransportStateRef.current` is assigned **during render** at L576–580. Assigning to a ref during render is safe in React, but this pattern bypasses the normal effect model and can confuse linters and future maintainers.

**Test gaps:**
- The throttle/debounce volume sync logic is completely untested.
- The polling loop error→fallback path (TAURI_UNAVAILABLE → setNativeTransportEnabled(false)) is not tested.
- The autoplay effect with `queueIndex < 0` guard is not tested.

**TODO:**
- [ ] P0: Fix the volume sync timer leak on `nativeTransportEnabled` change.
- [ ] P0: Combine `getPlaybackContext` + `getPlaybackDecodeError` into one Rust command.
- [ ] P1: Extract `normalizeUiError` and `shouldUseLegacyAudioFallback` to `tauri-api.ts`.
- [ ] P1: Delete `ResolvedPlayerSource` — use `ExternalPlayerSource` directly.
- [ ] P2: Replace redundant conditional state updates (`current ? false : current`) with direct value.

---

### `apps/desktop/src/hooks/useQcPreviewLifecycle.ts` (443 lines)

**Purpose:** Manages QC codec-preview session lifecycle, batch export polling, and profile defaults.

**Correctness (P0):**
- The batch export polling loop (L356–424) uses `setTimeout` recursion (`void pollStatus()` → `timeoutId = window.setTimeout(() => { void pollStatus() }, 800)`). On the *first* invocation, `timeoutId` is `undefined`. The cleanup (L420–424) clears `timeoutId`. If `pollStatus` is mid-await when the effect re-runs (e.g., `qcBatchExportActiveJobId` changes), the async in-flight call completes and calls `setQcBatchExportActiveJobId(null)` even though `cancelled=true`... **wait, it checks `if (cancelled) return`.** However: `setQcBatchExportActiveJobId(null)` changes `qcBatchExportActiveJobId` which re-triggers this same effect. If a new job ID is set *while* the old poll is cleaning up, the transition through `null` causes a brief extra effect invocation.

**Correctness (P1):**
- `selectDefaultCodecPreviewPair` (L55–63): when `profiles` is empty, `profileAId = ""` and `profileBId = profileAId = ""`. This produces an identical A/B pair, which `tauri-api.ts:qcPreparePreviewSession` rejects with `INVALID_ARGUMENT. profile_a_id and profile_b_id must be different`. This flows to `setCatalogError` showing an error to the user for a state that should not be reachable.
- `applyQcPreviewPlaybackSource` (L107–151) has `playerIsPlaying` in its dependency array. This means the callback is re-created on every play/pause toggle. Since it is used via a ref, the ref is updated but the actual lambda reference churns unnecessarily. The `playerIsPlaying` value should be read from a ref instead.

**Test gaps:**
- Empty profile list behavior is not tested.
- A/B same ID guard path (`profileAId === profileBId`) is not tested.
- Batch export poll cancellation on job ID change is not tested.

**TODO:**
- [ ] P0: Guard `selectDefaultCodecPreviewPair` against empty profiles, return `null` and skip session preparation.
- [ ] P1: Read `playerIsPlaying` via ref in `applyQcPreviewPlaybackSource` to prevent unnecessary lambda churn.
- [ ] P1: Transition state machine for `qcBatchExportActiveJobId` null→new must not re-arm the old poller.

---

### `apps/desktop/src/hooks/useIngestJobPolling.ts` (147 lines)

**Purpose:** Polls active ingest jobs at 500ms intervals, updates state, fires `onJobsCompleted`.

**Correctness (P1):**
- `activeJobIds` computation (L55–62) and `activeJobIdsKey` (L63) are both in the dep array of the polling effect. The key is derived from the sorted array, which is fine. **But:** if `activeScanJobs` has a job that transitions to a terminal status, `activeJobIds` changes, which tears down and re-starts the effect. On restart, `void pollJobs()` fires immediately — this double-fires a poll within 500ms of the last one.
- `completedJobStatusesRef` cleanup (L65–72) is in a separate effect with `[activeScanJobs]` dep, but `activeScanJobs` changes in the polling effect's `setActiveScanJobs` callback. The two effects can fire in the same batch or in sequence, making the cleanup timing non-deterministic.

**Performance (P2):**
- `MAX_INGEST_JOB_POLL_PARALLELISM = 8` batches IPC calls. For the typical case of 1–3 jobs, the batching adds no value but adds code complexity.

**Test gaps:**
- Deduplicated completion detection (same job/status not re-fired) is tested implicitly by the ref, but there is no unit test for it.
- Error suppression (errored update → job removed from `activeScanJobs`) has no test.

**TODO:**
- [ ] P1: Debounce the immediate poll on effect restart to avoid double-firing.
- [ ] P2: Simplify batch code — use `Promise.all` directly for ≤8 jobs.

---

### `apps/desktop/src/hooks/useLibraryIngestActions.ts` (408 lines)

**Purpose:** Encapsulates all catalog mutation actions (import, root add/remove/scan, cancel, drop-ingest).

**Correctness (P0):**
- All action callbacks (`handleImport`, `handleAddLibraryRoot`, etc.) depend on `[args]` (the entire args object). `args` is constructed inline in the parent component on every render. This means **every callback is recreated on every render**, defeating memoization and causing child components that receive these as props to re-render on every parent render.
- `handleIngestDroppedPaths` (L242–394) is a 150-line sequential async function. Inside it, `queueLibraryRoot` silently swallows errors (`catch { return null }`). Failures from `catalogAddLibraryRoot` are invisible to the user. The catch block should at minimum count the failure.

**Correctness (P1):**
- `parentDirectoryPath` (L58–73) handles Windows drive roots (`C:\`) but not UNC paths (`\\server\share`). A UNC drop will return the server name as a "parent directory", which is not a valid library root.
- The `handleScanLibraryRoot` action creates a synthetic optimistic job record (L191–203) with `created_at: new Date().toISOString()`. The server-side `job_id` is from `CatalogScanRootResponse.job_id`, but the synthetic `CatalogIngestJobResponse` record uses a client-side timestamp. If the polling loop receives the real record before the optimistic update is replaced, it will compute a diff and set state twice.

**Maintainability (P2):**
- `handleIngestDroppedPaths` should be broken into two pure-ish helpers: one that categorizes paths (roots vs. files) and one that executes the mutations. This would make it unit-testable.

**TODO:**
- [ ] P0: Change callbacks to depend on stable refs, not the `args` object identity.
- [ ] P0: Surface `queueLibraryRoot` errors to the user (count them in `scanFailureCount`).
- [ ] P1: Guard `parentDirectoryPath` against UNC paths.
- [ ] P1: Document the optimistic job record as a temporary placeholder; add a comment warning about the polling race.

---

### `apps/desktop/src/hooks/useDroppedIngestAutoplayController.ts` (185 lines)

**Purpose:** Listens for Tauri drag-drop events and wires dropped paths to catalog ingest then autoplay.

**Correctness (P1):**
- `useIngestJobPolling` (L82–135) is called with an inline `onJobsCompleted` callback. `useIngestJobPolling` captures it via `onJobsCompletedRef` — but the dependency array of the polling effect is `[activeJobIds, activeJobIdsKey, setActiveScanJobs]`. The callback ref is updated in an effect before polling, so it's safe when `completedJobs` fire. However: the callback calls `loadCatalogTracks(hasPendingDropAutoplay ? "" : trackSearch)`. `trackSearch` is read from the closure at the time the callback was created, not from a ref. **This value can be stale.** If the user changed the search while a scan was running, the post-scan reload uses the stale search.
- `setPlayListModeWithQueueSync` is called on line 130 using the non-ref version (from `args`), not through `setPlayListModeWithQueueSyncRef`. If the parent re-renders between job completion and the callback firing, this could be the old setter.

**UX Risk (P2):**
- `filePathMatchesRoot` (L38–43) uses `.startsWith` on lowercase-normalized strings. This catches most cases on Windows/case-insensitive filesystems. On Linux, it would be case-sensitive — though since this is a Windows desktop app, the risk is low. Still worth a comment.

**TODO:**
- [ ] P1: Read `trackSearch` via a ref in `onJobsCompleted`.
- [ ] P1: Use `setPlayListModeWithQueueSyncRef.current` consistently.
- [ ] P2: Add `// Windows-only assumption: case-insensitive path comparison` comment.

---

## J. media-url.ts

**Purpose:** Converts filesystem paths to Tauri asset-protocol or `file://` URLs for WebView playback.

**Correctness (P1):**
- `stripWindowsExtendedPathPrefix` handles `\\?\` and `//?/` but not `\\?\UNC\` vs `//?/UNC/`. The UNC handling strips `\\?\UNC\server\share` to `\\server\share` correctly, but `\\?\C:\path` → `C:\path` then normalizeDisplayPath converts `\` to `/` which is correct. However, the `//?/` variant (L12–18) strips to `C:/path` without the `\\?\` prefix stripping, which happens to be fine but for subtly different reasons.
- `encodeURI` (L66–68) does NOT encode `#`, `?`, `%` in the path. A file path containing a literal `#` will have the URL fragment incorrectly set. **Fix:** use `encodeURIComponent` on path segments or a proper URL constructor.

**Test gaps (L904 of `media-url.test.ts` exists):**
- Assuming the test file exists and covers the main cases, but `#` and `%` in path names should be verified.

**TODO:**
- [ ] P1: Fix `#` and `%` encoding in the fallback `file://` URL construction.
- [ ] P2: Add `isLikelyLocalPath` test for paths starting with `//` (Mac network paths).

---

## K. ui-sanitize.ts

**Purpose:** Sanitizes untrusted text from IPC before rendering, blocks bidirectional Unicode overrides and control characters.

**Correctness:**
- The BiDi override block `U+202A–U+202E` and `U+2066–U+2069` is correctly hit-listed. **Missing**: `U+200B` (zero-width space), `U+200C/D` (zero-width non-joiner/joiner), `U+FEFF` (BOM). These can cause display anomalies in paths.
- `sanitizeUiErrorMessage` (L35–54) checks for Rust panic traces but only on the English-cased strings. A localized or partially-redacted message could slip through.

**TODO:**
- [ ] P2: Add zero-width character codepoints to `isUnsafeDisplayCodePoint`.

---

## L. audio_processor.rs

**Purpose:** Pure decode + QC analysis. Explicitly Tauri-free by design.

**Quality assessment: HIGH.** The module is well-designed. The `#![cfg_attr(not(test), deny(clippy::expect_used, clippy::panic, clippy::unwrap_used))]` attribute is excellent practice.

**Correctness (P1):**
- `compute_integrated_lufs` (L382–475) creates two separate `EbuR128` meter instances — one for integrated loudness, one for true peak. For a 30-minute audio file, this means two full linear-scan passes. Memory usage peaks at `2 × sample_count × 4 bytes`. For long-form audio (e.g., 90-min DJ sets), this is potentially 4 GB+ of RAM. The separate pass for true-peak is not avoidable with the current API, but the integrated loudness pass could share the meter.

**Correctness (P2):**
- `amplitude_to_dbfs` (L605–624) clamps `amplitude.abs()` to `[min_linear, 1.0]`. For over-unity signals (`amplitude > 1.0`), this clamps to `1.0` and returns `0.0 dBFS`. This is acoustically correct but might mask clipping. A separate `is_clipping` flag on `TrackAnalysis` would improve usability for the QC use case.

**Performance:**
- `decode_audio_file` accumulates all interleaved samples in `Vec<f32>` before returning. For a 60-min 48 kHz stereo file: 60 × 60 × 48000 × 2 × 4 = ~1.3 GB allocation. The entire contents of the decoded file live in RAM before analysis ends. This is a fundamental architectural constraint from symphonia's API, but a streaming pipeline (analyze on decode loop) would reduce peak memory by ~50%.

**Test quality: EXCELLENT.** The inline tests cover hostile inputs (zero bytes, corrupt headers, bit-flip), edge cases (zero samples, variable rate), and property tests for monotone behavior.

**TODO:**
- [ ] P1: Combine `EbuR128` modes for integrated + sample-peak into a single meter pass; separate true-peak pass remains.
- [ ] P2: Add `is_clipping: bool` to `TrackAnalysis` for samples with `amplitude > 1.0`.
- [ ] P2: Document the peak memory model in the module doc.

---

## M. orchestrator.rs

**Purpose:** Plan/Execute/Verify state machine for platform publishing with SQLite-backed idempotency.

**Quality assessment: HIGH.** The locking, lease renewal, and state-machine transitions are well-designed.

**Correctness (P1):**
- `execute_planned_release` (L352–419): when `result` is `Err` AND `release_lock_result` is `Err`, the function returns the *execution* error and the lock error is silently discarded (L418). This means a stuck lease can go unobserved. The lock error should be logged even if the execution error takes precedence.
- `finalize_report` (L718–787): reads `list_platform_actions` without a transaction. Between the last `upsert_platform_action` (in the loop) and `finalize_report`, another process could theoretically update the action. Given the lease model, this should not happen in practice, but it is a TOCTOU gap for unit tests.

**Correctness (P2):**
- `run_id` is generated with `Uuid::new_v4()` (non-deterministic). This is fine for production but makes integration tests non-deterministic. The `run_id` should be injectable for testing.

**TODO:**
- [ ] P1: Log `lock_err` in the `(Err(err), Err(_lock_err))` arm.
- [ ] P2: Accept an optional `run_id: Option<String>` in `RunReleaseInput` for deterministic test runs.

---

## N. retry.rs

**Purpose:** HTTP retry logic with deterministic jitter, `Retry-After` header support.

**Quality assessment: HIGH.** Deterministic jitter using xorshift is a good call. The `Sleeper` trait enables fake-clock testing.

**Correctness:**
- `retry_delay_for_response` checks `status == 429` before the generic `retry_on_statuses.contains(&status)`. If `429` is also in `retry_on_statuses` (it is, in the default), a `Retry-After` header will correctly override the default backoff — this is the intended behavior. ✅
- The xorshift at L228–231 is not a cryptographic RNG (correct for jitter). It is seeded with `jitter_seed ^ (attempt << 32) ^ salt`. For `attempt=0`, the shift produces `0`, making the seed state `jitter_seed ^ salt`. For `attempt=1`, it is `jitter_seed ^ (1 << 32) ^ salt`. These are distinct. ✅

**Tests:** Good coverage. The deterministic jitter test is particularly valuable.

---

## D. ERROR HANDLING AND CONTRACTS (DEEP DIVE)

### Error taxonomy

```
UiAppError { code: string, message: string, details?: unknown }
  ├─ INVALID_ARGUMENT        (client-side pre-IPC validation failure)
  ├─ TAURI_UNAVAILABLE       (browser preview, not a production error)
  ├─ UNKNOWN_COMMAND         (command not registered — likely dev mismatch)
  ├─ TAURI_DIALOG_TIMEOUT    (10-minute directory picker timeout)
  ├─ TAURI_DIALOG_UNAVAILABLE (dialog plugin not available)
  ├─ PLAYBACK_QUEUE_REQUEST_REJECTED (player queue rejected index)
  └─ (all others from Rust backend)  [CMD?] — not inventoried
```

**Gap D-1 (P1):** There is no canonical list of backend error codes. If the Rust backend introduces a new code, the frontend has no type-safe way to handle it vs. the fallback. A shared `ErrorCode` const object should be defined and exported.

**Gap D-2 (P1):** `sanitizeUiErrorMessage` only looks for `Error.message` or raw strings. If Tauri serializes a Rust error as `{ code, message }` (the `UiAppError` shape), `sanitizeUiErrorMessage` will receive the full object and return the fallback — the message is lost. The IPC layer should normalize this before it reaches sanitization.

### Error handling style guide (proposed)

1. **Pre-IPC validation:** throw `UiAppError` synchronously from `tauri-api.ts` functions. Never invoke IPC with invalid args.
2. **Post-IPC errors:** let Tauri errors propagate as `UiAppError`; wrap unknown shapes in `normalizeUiError` at the IPC boundary, not inside hooks.
3. **Async effect errors:** always use `cancelled` guard; never set state after unmount.
4. **User-facing messages:** always go through `sanitizeUiText` or `sanitizeUiErrorMessage`; never render raw `error.message`.
5. **Silent suppression:** allowed only in cleanup paths (e.g., `setPlaybackPlaying(false)` on track change). All other errors must reach a state setter or be logged.
6. **Backend panic traces:** `sanitizeUiErrorMessage` already blocks these; confirm Rust commands never return `Debug`-formatted panics directly.

### Missing validation

| Function | Missing check |
|----------|--------------|
| `catalogImportFiles` | Zero-length `paths` array permitted (backend may accept it, but UX is unclear) |
| `setPlaybackQueue` | Zero-length `paths` permitted — is an empty queue a valid operation? |
| `qcStartBatchExport` | `target_integrated_lufs` allowed range not validated (e.g., -70 to 0 LUFS) |
| `initExclusiveDevice` | Bit-depth 64 is accepted — realistically no audio hardware supports this |

---

## E. TESTABILITY REVIEW (DEEP DIVE)

### Test pyramid recommendation

```
Unit tests (pure, no IPC):       ~60%
  audio_processor.rs, retry.rs, media-url.ts, ui-sanitize.ts, transportMath

Integration tests (mock IPC):    ~30%
  usePlayerTransportState, useIngestJobPolling, useQcPreviewLifecycle
  — mock tauriClient with vi.fn() or a fake implementation

E2E (Playwright, real Tauri):    ~10%
  Import → play → QC preview flow
  Drop folder → scan → autoplay
  Batch export → file written to disk
```

### Hook testability matrix

| Hook | Pure helpers extractable | Integration test approach | Flakiness risks |
|------|--------------------------|--------------------------|-----------------|
| `usePlayerTransportState` | `normalizeUiError`, `shouldUseLegacyAudioFallback`, `clampVolumeScalar` | Mock `tauriClient` functions; use `vi.useFakeTimers()` for 250ms polling | Polling interval, StrictMode double-invoke |
| `useQcPreviewLifecycle` | `selectDefaultCodecPreviewPair` | Mock all `qc*` API calls; control `Promise` resolution order | Race between QC session load and track selection |
| `useIngestJobPolling` | `pollIngestJobUpdates` (already a free function) | Mock `catalogGetIngestJob`; use fake timers for 500ms interval | StrictMode double-invoke, `completedJobStatusesRef` state |
| `useLibraryIngestActions` | `parentDirectoryPath` (already free), path categorization | Mock all `catalog*` API calls | `args` object identity churn |
| `useDroppedIngestAutoplayController` | `normalizePathForRootMatch`, `filePathMatchesRoot` | Hard to mock `@tauri-apps/api/webview` | Drag-drop event mock complexity |

### Test harness pattern

```typescript
// test/setup/tauriMocks.ts
import { vi } from "vitest";
import * as tauriClient from "../services/tauriClient";

export function mockTauriClient(overrides: Partial<typeof tauriClient>) {
  Object.entries(overrides).forEach(([key, value]) => {
    vi.spyOn(tauriClient, key as keyof typeof tauriClient)
      .mockImplementation(value as never);
  });
}

// Usage:
mockTauriClient({
  catalogListTracks: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 }),
  getPlaybackContext: vi.fn().mockResolvedValue({ volume_scalar: 1.0, is_bit_perfect_bypassed: false, ... })
});
```

**Fake timers policy:**
- Use `vi.useFakeTimers()` for ALL polling hooks (`useIngestJobPolling`, `useQcPreviewLifecycle` batch export, `usePlayerTransportState` 250ms polling).
- Advance time with `vi.advanceTimersByTimeAsync(500)` to avoid flakiness.
- Run timer tests **without** React StrictMode (or explicitly test the double-invoke case separately).

**Testing polling without real timeouts:**
```typescript
it("polls and updates state on job completion", async () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useIngestJobPolling(args));
  await act(() => vi.advanceTimersByTimeAsync(500)); // fire first poll
  expect(args.onJobsCompleted).not.toHaveBeenCalled();
  mockGetIngestJob.mockResolvedValueOnce({ ...job, status: "COMPLETED" });
  await act(() => vi.advanceTimersByTimeAsync(500)); // fire second poll
  expect(args.onJobsCompleted).toHaveBeenCalledWith([expect.objectContaining({ status: "COMPLETED" })]);
  vi.useRealTimers();
});
```

### Flakiness sources

| Source | Hook | Fix |
|--------|------|-----|
| 250ms polling interval | `usePlayerTransportState` | Inject clock / use fake timers |
| 500ms polling interval | `useIngestJobPolling` | Inject clock / use fake timers |
| 800ms batch export poll | `useQcPreviewLifecycle` | Inject clock / use fake timers |
| StrictMode double-invoke | All polling hooks | Test double-invoke explicitly; ensure ref cleanup |
| IPC call ordering | `useQcPreviewLifecycle` | Mock `Promise` with manual `.resolve()` |
| Pagination in drop handler | `useDroppedIngestAutoplayController` | Inject `catalogListTracks` mock with page control |

---

## F. FILE TYPES AND ARGUMENT BREADTH REVIEW

### Supported inputs (inferred from audio_processor.rs)

The decode pipeline uses Symphonia, which supports:

| Format | Codec | Status |
|--------|-------|--------|
| WAV | PCM s16/s24/s32/f32, ADPCM | ✅ |
| FLAC | FLAC | ✅ |
| MP3 | Layer III | ✅ (via symphonia-codec-mp3 if enabled) |
| AAC/M4A | AAC-LC | ✅ (if feature enabled) |
| OGG | Vorbis, Opus | ✅ |
| AIFF | PCM | ✅ |
| CAF | Various | ⚠️ limited support |
| WMA/ASF | WMA | ❌ not supported |
| DSD (DSF/DSDIFF) | DSD | ❌ not supported |

### Identified assumptions reducing usability

| Assumption | Location | Risk |
|-----------|----------|------|
| Extensions guide Symphonia hint but aren't required | `audio_processor.rs:119` | Low — Symphonia probes content |
| Case-insensitive path matching only via `.toLowerCase()` | `useDroppedIngestAutoplayController:35` | Low for Windows, breaks on Linux |
| Only `\` and `/` separators handled | `parentDirectoryPath`, `media-url.ts` | Gaps for UNC, network drives |
| `MAX_IPC_PATH_CHARS = 4096` | `tauri-api.ts:6` | Windows MAX_PATH is 260 by default (32K with extended prefix) |
| `assertHexId` expects 64-char lowercase hex | `tauri-api.ts:69` | Correct for SHA-256, would break if ID format changes |

### Recommended explicit policy

```typescript
// Proposed: src/file-policy.ts
export const ALLOWED_AUDIO_EXTENSIONS = new Set([
  "wav", "flac", "mp3", "aac", "m4a", "ogg", "oga", "opus", "aiff", "aif"
]);

export const BLOCKED_EXTENSIONS = new Set(["exe", "dll", "bat", "ps1", "sh"]);

export function classifyDroppedPath(path: string): "audio" | "directory" | "unknown" | "blocked" {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (BLOCKED_EXTENSIONS.has(ext)) return "blocked";
  if (ALLOWED_AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (!ext || !ext.includes(".")) return "directory"; // no extension → likely folder
  return "unknown"; // extension present but not recognized
}
```

**Behavior for unknown extensions:** pass to backend and let Symphonia probe. Surface `AudioError::Unsupported` as a soft warning, not a blocking error.

**Behavior for missing metadata:** the backend already handles this (title/artist can be empty). UI should display `"Unknown Title"` / `"Unknown Artist"` rather than rendering empty strings.

---

## G. PERFORMANCE AND RELIABILITY

### Render loop risks

| Risk | Location | Likelihood | Fix |
|------|----------|------------|-----|
| `handleImport` recreated every render | `useLibraryIngestActions` (deps on `args`) | HIGH | Stable ref pattern |
| `applyQcPreviewPlaybackSource` recreated on every play/pause | `useQcPreviewLifecycle` | MEDIUM | Read `playerIsPlaying` from ref |
| `queueFilePaths` memo recomputed on any queue change | `usePlayerTransportState:262` | LOW (memoized) | ✅ already memoized |
| `playerTrackDetail` memo depends on `trackDetailsById` ref equality | `usePlayerTransportState:228` | MEDIUM | Stable `trackDetailsById` map required |

### Hot paths

1. **Playback polling (250ms):** two sequential IPC round-trips. Combine into one command.
2. **Queue sync on navigation:** `setPlaybackQueue(queueFilePaths)` sends up to 10,000 file paths via IPC on every queue change. For large libraries, this serialization is expensive. Consider sending diffs instead.
3. **Ingest drop with 200+ files:** `catalogImportFiles` is called with ≤200 files at a time (enforced). Good.

### Measurable acceptance criteria (proposed)

| Metric | Target | Test method |
|--------|--------|-------------|
| Initial library load (1000 tracks) | < 300ms | Playwright timer |
| Track selection → playback start | < 200ms | Playwright timing |
| Catalog search response (cached) | < 100ms | Playwright timing |
| Memory at idle with 10K track library | < 150 MB renderer | `performance.memory` snapshot |
| Peak allocation during 60-min decode | < 1.5 GB | Rust heap profile |
| QC preview session prepare | < 2s | Integration test with mock |

---

## H. SPRINT-READY PLAN

### Definition of done (repo-specific)

- [ ] No `clippy::unwrap_used` or `clippy::expect_used` outside `#[cfg(test)]` in Rust
- [ ] No new `any` types introduced without an explicit justification comment in TypeScript
- [ ] All new hooks have at least 2 unit tests covering the happy path and one error path
- [ ] Polling hooks are tested with `vi.useFakeTimers()`
- [ ] PR passes CI: `cargo test`, `cargo clippy --deny warnings`, `vitest run`, `playwright test`

---

### Sprint 1 — Correctness foundations (risk-driven)

| # | Item | Description | Acceptance criteria | Effort | Deps |
|---|------|-------------|---------------------|--------|------|
| S1-1 | Extract `isUiAppError` type guard | Single function in `tauri-api.ts`, used in `invokeCommand`, `normalizeUiError`, `pickDirectoryDialog` | 3 call sites updated; `tauri-api.test.ts` covers shape guard | S | — |
| S1-2 | Fix volume sync timer leak | Timer ref cleanup in `usePlayerTransportState` must run on every `nativeTransportEnabled` change, not just unmount | Test: enable → disable → enable native transport; verify no double-fire | S | — |
| S1-3 | Fix `selectDefaultCodecPreviewPair` for empty profiles | Return `null` or empty pair; skip `qcPreparePreviewSession` when A=B or empty | Test: 0 profiles, 1 profile; no IPC called | S | — |
| S1-4 | Stabilize `useLibraryIngestActions` callback deps | Replace `[args]` dep with `argsRef` in all exported callbacks | No more callback identity churn; memoization test passes | M | — |
| S1-5 | Combine `getPlaybackContext` + `getPlaybackDecodeError` IPC calls | New Rust command `get_playback_state` returns both fields | Single IPC round-trip in polling loop; latency test | M | [CMD?] |

---

### Sprint 2 — Testability and DI

| # | Item | Description | Acceptance criteria | Effort | Deps |
|---|------|-------------|---------------------|--------|------|
| S2-1 | Fake-timer tests for `useIngestJobPolling` | vitest + fake timers; test: poll → completed → onJobsCompleted fired | 3 tests green, no real timers | M | S1-4 |
| S2-2 | Fake-timer tests for `usePlayerTransportState` polling | Cover polling error → fallback path; volume throttle | 4 tests green | M | S1-2 |
| S2-3 | Fake-timer tests for QC batch export poller | Cover terminal status transitions; cancellation on job ID change | 3 tests green | S | S1-3 |
| S2-4 | `trackSearch` ref in `useDroppedIngestAutoplayController` | Fix stale closure over `trackSearch` in `onJobsCompleted` | Test: search changes mid-scan; reload uses latest search | S | — |
| S2-5 | Extract `parentDirectoryPath` + UNC guard | Add UNC path guard; add unit tests for drive root, UNC, Unix | 5 unit tests green | S | — |

---

### Sprint 3 — Architecture cleanup (boundary hardening)

| # | Item | Description | Acceptance criteria | Effort | Deps |
|---|------|-------------|---------------------|--------|------|
| S3-1 | Make `services/tauriClient` a real DI seam | Define a `TauriClient` interface; provide a real impl and a `MockTauriClient`; all hooks depend on the interface | No hook imports `tauri-api.ts` directly; mock available | L | S1-1 |
| S3-2 | Reduce god-component: extract playback slice from `MusicWorkspaceApp` | Move playback-related state out of `MusicWorkspaceApp.tsx` into a dedicated context or sub-hook | `MusicWorkspaceApp.tsx` < 40 KB; playback slice testable independently | L | S1-4, S2-1 |
| S3-3 | `#` and `%` fix in `media-url.ts` fallback | Use per-segment `encodeURIComponent` instead of `encodeURI` | `media-url.test.ts` covers `#`, `%`, space in path | S | — |
| S3-4 | Inject `run_id` in `RunReleaseInput` | Accept `Option<String>` for deterministic test runs | Orchestrator integration test uses fixed `run_id`; report is deterministic | S | — |

---

### Sprint 4 — Performance and observability

| # | Item | Description | Acceptance criteria | Effort | Deps |
|---|------|-------------|---------------------|--------|------|
| S4-1 | Queue diff sync instead of full resend | Replace `setPlaybackQueue(allPaths)` with diff-based IPC | Queue sync IPC payload < 1 KB for most navigations | L | S3-1 |
| S4-2 | EbuR128 single-pass loudness + peak | Combine `Mode::I | Mode::SAMPLE_PEAK` in one meter pass | Peak memory for 60-min file reduced by ~25% | M | — |
| S4-3 | Catalog large list virtualization audit | Confirm `play-list` feature uses windowed rendering for > 200 items | No jank scrolling 1000-item list in Playwright test | M | — |
| S4-4 | Add performance traces | Add `tracing::instrument` spans to `plan_release`, `execute_planned_release` | Trace visible in `tracing-subscriber` output; timing recorded | S | — |

---

## I. PATCH SET (highest-priority diffs)

### Patch 1 — Extract `isUiAppError` type guard (P0)

```diff
// apps/desktop/src/tauri-api.ts
+export function isUiAppError(error: unknown): error is UiAppError {
+  return (
+    error != null &&
+    typeof error === "object" &&
+    "code" in error &&
+    "message" in error &&
+    typeof (error as { code?: unknown }).code === "string" &&
+    typeof (error as { message?: unknown }).message === "string"
+  );
+}

 export async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
   // ...
   } catch (error) {
-    if (
-      error &&
-      typeof error === "object" &&
-      "code" in error &&
-      "message" in error &&
-      typeof (error as { code?: unknown }).code === "string" &&
-      typeof (error as { message?: unknown }).message === "string"
-    ) {
+    if (isUiAppError(error)) {
       throw error;
     }
```

```diff
// apps/desktop/src/hooks/usePlayerTransportState.ts
-  const normalizeUiError = (error: unknown): UiAppError => {
-    if (
-      error &&
-      typeof error === "object" &&
-      "code" in error &&
-      "message" in error &&
-      typeof (error as { code?: unknown }).code === "string" &&
-      typeof (error as { message?: unknown }).message === "string"
-    ) {
-      return error as UiAppError;
-    }
-    return {
-      code: "UNEXPECTED_UI_ERROR",
-      message: error instanceof Error ? error.message : "Unknown UI error"
-    };
-  };
+  const normalizeUiError = useCallback((error: unknown): UiAppError => {
+    if (isUiAppError(error)) return error;
+    return {
+      code: "UNEXPECTED_UI_ERROR",
+      message: error instanceof Error ? error.message : "Unknown UI error"
+    };
+  }, []);
```

---

### Patch 2 — Fix `selectDefaultCodecPreviewPair` for empty/single profiles (P0)

```diff
// apps/desktop/src/hooks/useQcPreviewLifecycle.ts
-function selectDefaultCodecPreviewPair(
-  profiles: QcCodecProfileResponse[]
-): { profileAId: string; profileBId: string } {
-  const available = profiles.filter((profile) => profile.available);
-  const candidates = available.length >= 2 ? available : profiles;
-  const profileAId = candidates[0]?.profile_id ?? "";
-  const fallbackPool = candidates.length > 1 ? candidates.slice(1) : profiles.slice(1);
-  const profileBId = fallbackPool.find((profile) => profile.profile_id !== profileAId)?.profile_id ?? profileAId;
-  return { profileAId, profileBId };
-}
+function selectDefaultCodecPreviewPair(
+  profiles: QcCodecProfileResponse[]
+): { profileAId: string; profileBId: string } | null {
+  const available = profiles.filter((profile) => profile.available);
+  const candidates = available.length >= 2 ? available : profiles;
+  if (candidates.length < 2) return null;
+  const profileAId = candidates[0].profile_id;
+  const profileBId = candidates.find((p) => p.profile_id !== profileAId)?.profile_id;
+  if (!profileBId) return null;
+  return { profileAId, profileBId };
+}
```

Update caller:
```diff
-        const defaults = selectDefaultCodecPreviewPair(profiles);
-        setQcPreviewProfileAId(defaults.profileAId);
-        setQcPreviewProfileBId(defaults.profileBId);
+        const defaults = selectDefaultCodecPreviewPair(profiles);
+        if (!defaults) {
+          setQcPreviewSession(null);
+          return;  // not enough profiles to form an A/B pair
+        }
+        setQcPreviewProfileAId(defaults.profileAId);
+        setQcPreviewProfileBId(defaults.profileBId);
```

---

### Patch 3 — Fix volume sync timer cleanup (P0)

```diff
// apps/desktop/src/hooks/usePlayerTransportState.ts
   useEffect(
     () => () => {
       if (volumeSyncTimerRef.current != null) {
         window.clearTimeout(volumeSyncTimerRef.current);
+        volumeSyncTimerRef.current = null;
+        volumeSyncThrottleActiveRef.current = false;
+        pendingVolumeScalarRef.current = null;
       }
     },
-    []         // runs only on unmount — insufficient
+    [nativeTransportEnabled]  // also runs when native transport is toggled off
   );
```

---

### Patch 4 — Fix `trackSearch` stale closure in drop autoplay (P1)

```diff
// apps/desktop/src/hooks/useDroppedIngestAutoplayController.ts
+  const trackSearchRef = useRef(trackSearch);
+  useEffect(() => { trackSearchRef.current = trackSearch; }, [trackSearch]);

    useIngestJobPolling({
     activeScanJobs,
     setActiveScanJobs,
     onJobsCompleted: (completedJobs) => {
       void (async () => {
         const pendingDropJobs = pendingDroppedScanAutoplayJobsRef.current;
         const hasPendingDropAutoplay = pendingDropJobs.size > 0;
-        const reloadResponse = await loadCatalogTracks(hasPendingDropAutoplay ? "" : trackSearch);
+        const reloadResponse = await loadCatalogTracks(hasPendingDropAutoplay ? "" : trackSearchRef.current);
```

---

### Patch 5 — Fix `#`/`%` encoding in media URL fallback (P1)

```diff
// apps/desktop/src/media-url.ts
-  const normalized = normalizeDisplayPath(trimmed);
-  if (/^[a-zA-Z]:\//.test(normalized)) return encodeURI(`file:///${normalized}`);
-  if (normalized.startsWith("/")) return encodeURI(`file://${normalized}`);
-  if (normalized.startsWith("file://")) return encodeURI(normalized);
+  const normalized = normalizeDisplayPath(trimmed);
+  if (/^[a-zA-Z]:\//.test(normalized)) {
+    const encoded = normalized.split("/").map((seg, i) => i === 0 ? seg : encodeURIComponent(seg)).join("/");
+    return `file:///${encoded}`;
+  }
+  if (normalized.startsWith("/")) {
+    const encoded = normalized.split("/").map((seg) => encodeURIComponent(seg)).join("/");
+    return `file://${encoded}`;
+  }
+  if (normalized.startsWith("file://")) return normalized; // already a URL
   return "";
```

> **Trade-off:** This will change URLs returned to the WebView for paths containing `#`, `%`, spaces. Existing cached objects (if any) will get different cache keys. Verify with `media-url.test.ts` before merging.

---

## Summary priority matrix

| Code | Priority | Category | Cost |
|------|----------|----------|------|
| Extract `isUiAppError` | P0 | Correctness | S |
| Fix empty profile A/B guard | P0 | Correctness | S |
| Fix volume timer leak | P0 | Correctness | S |
| Combine IPC playback poll calls | P0 | Performance | M |
| Stabilize `useLibraryIngestActions` callback deps | P0 | Correctness | M |
| Fix stale `trackSearch` in drop handler | P1 | Correctness | S |
| Fix `#`/`%` in media URL | P1 | Correctness | S |
| `selectDefaultCodecPreviewPair` null return | P0 | Correctness | S |
| Log `lock_err` in orchestrator | P1 | Observability | S |
| Reduce `MusicWorkspaceApp` god-component | P1 | Architecture | L |
| `TauriClient` DI interface | P1 | Testability | L |
| Fake-timer polling tests | P1 | Testability | M×3 |
| `parentDirectoryPath` UNC guard | P1 | Correctness | S |
| Injectable `run_id` in orchestrator | P2 | Testability | S |
| `is_clipping` in `TrackAnalysis` | P2 | UX | S |
| EbuR128 single-pass | P2 | Performance | M |
