# Test Matrix

Status: Pass 1 complete.

## Preferred Test Stack

Use the repo's existing layers rather than introducing a new stack:
- `Vitest` + React Testing Library for shell and component interaction tests.
- `Playwright` for browser-shell and Tauri-runtime end-to-end flows.
- Existing Rust/unit/integration tests for queue restoration, ingest lifecycle, transport contracts, and persistence logic.

Current coverage anchors already in repo:
- `apps/desktop/src/app/shell/WorkspaceApp.test.tsx`
- `apps/desktop/src/features/video-workspace/VideoWorkspaceFeature.test.tsx`
- `apps/desktop/src/features/publisher-ops/PublisherOpsWorkspace.test.tsx`
- `apps/desktop/src/features/audio-output/hooks/useAudioOutputRuntimeState.test.ts`
- `playwright/tests/smoke.spec.ts`
- `playwright/runtime/desktop-runtime.spec.ts`

## Required Reusable Helpers

### 1. Visible Control Audit Helper

Proposed helper: `assertVisibleActionableControls(container, options)`

Purpose:
- Enumerate visible buttons, inputs, selects, tabs, menuitems, and button-like regions.
- Fail when a control appears enabled/actionable but has no observable action, no disabled state, and no explicit no-op rationale.

Expected behavior:
- Records control label, role, selector/test id, page/workspace context.
- Verifies one of the following is true for each visible actionable control:
  - It is disabled.
  - It causes a state/DOM/event-side-effect observable in the test.
  - It is explicitly annotated as intentional no-op with rationale metadata.
- Logs the control name in failures so dead buttons are easy to triage.

Suggested initial placements:
- Shell-level interaction tests in `WorkspaceApp.test.tsx`.
- Video workspace interaction tests.
- Publish workflow tests.

### 2. UI Signal Recorder Helper

Proposed helper: `withUiSignalRecorder(pageOrRenderResult, scenarioName)`

Purpose:
- Capture unexpected console errors, page errors, dialogs, warning toasts, and alert/status banners during each scenario.
- Fail fast or attach structured diagnostics when a scenario produces unrelated UI noise.

Expected behavior:
- Playwright: subscribe to `console`, `pageerror`, `dialog`; capture screenshot on failure.
- RTL/Vitest: spy on `console.error`/`console.warn`, query for unexpected `role="alert"` or top notifications after the action.
- Tag each captured error with the active scenario and the control under test.

## Matrix

### Smoke Tests

| ID | Target | Preferred layer | Core assertions | Current coverage | Gap / next action |
| --- | --- | --- | --- | --- | --- |
| SMK-001 | App launches to current shell | Playwright + runtime Playwright | Main shell renders, no fatal startup errors, sidebar and topbar visible | Partial, but current browser smoke targets legacy publisher shell | Replace legacy smoke expectations with current `WorkspaceFeature` shell and fail on startup console/page errors |
| SMK-002 | Release Preview workspaces render | Vitest + RTL | `Library`, `Quality Control`, `Playlists`, `Video Workspace`, `Settings`, `About` buttons visible in Release Preview | Partial in `WorkspaceApp.test.tsx` | Expand to assert all major workspaces render without unrelated banners |
| SMK-003 | Publish workspace renders | Vitest + RTL | `Publisher Ops`, step shell, release dock, no missing-shell errors | Partial | Add explicit publish-shell smoke scenario |
| SMK-004 | Core controls visible | Vitest + RTL | Mode tabs, sidebar nav, shared player or publish dock, workspace body all present | Partial | Add one shell-level visibility contract per workspace |
| SMK-005 | No fatal startup console/runtime errors | Playwright + Vitest helper | Fail on unexpected console/page errors during first render | Missing | Add `withUiSignalRecorder` to smoke harness |

### UI Interaction Tests

| ID | Target | Preferred layer | Core assertions | Current coverage | Gap / next action |
| --- | --- | --- | --- | --- | --- |
| UI-001 | Every sidebar workspace button clickable | Vitest + RTL | Click each visible workspace button, assert target panel title/landmark changes | Partial | Add table-driven sidebar sweep |
| UI-002 | Every top-level tab and toggle clickable | Vitest + RTL | Mode tabs, QC intent tabs, ingest tabs, playlist tabs, publish-step tabs switch visible state | Partial | Add unified tab/toggle sweep using helper |
| UI-003 | Every dropdown/select changes state | Vitest + RTL | Sort, grouping, theme, palette, env, codec profiles, output selects, overwrite policy update state and dependent UI only | Partial | Add parameterized select suite |
| UI-004 | Every search field accepts input | Vitest + RTL | Track search updates visible rows and does not mutate unrelated state | Partial | Add explicit search-isolation assertions |
| UI-005 | Every visible button is actionable or clearly disabled | Vitest + RTL | Run `assertVisibleActionableControls` per workspace | Missing | New helper required |
| UI-006 | Context menus open and expose valid actions | Vitest + RTL | Track row and album row menus open at correct row and every menu item is actionable or disabled correctly | Partial | Expand to full item sweep including queue-only items |
| UI-007 | Settings shortcut capture fields are interactive | Vitest + RTL | Focus input, capture key combo, clear, reset, conflict warning | Partial | Broaden to all eight actions |
| UI-008 | Video workspace interactive controls | Vitest + RTL | Media, visual, text, output, preview, render controls all respond deterministically | Strong partial | Add `assertVisibleActionableControls` to video shell |

### Behavior Tests

| ID | Target | Preferred layer | Core assertions | Current coverage | Gap / next action |
| --- | --- | --- | --- | --- | --- |
| BEH-001 | Mode switch isolates workspace sets | Vitest + RTL | Publish hides listen-only workspaces; Release Preview restores them without corrupting current state | Covered | Keep and extend with persisted-state restore assertions |
| BEH-002 | Search isolation | Vitest + RTL | Typing search only changes search results/pageing; no queue mutation, no playback restart, no codec prep reset, no publish mutation | Partial | Add explicit unrelated-state assertions |
| BEH-003 | About is informational only | Vitest + RTL | Copy/refresh diagnostics work; no workflow controls leak in; mode-independent | Missing | Add dedicated About contract test |
| BEH-004 | Settings change preferences only | Vitest + RTL | Theme/path/density/shortcut changes do not mutate queue, mode, publish form, or catalog unless explicitly labeled | Partial | Add isolation assertions for each settings control family |
| BEH-005 | Release selection stays separate from listening queue | Vitest + RTL | Queue changes do not mutate release dock, and dock changes do not mutate listen queue | Covered | Keep and add removal/clear-selection edge cases |
| BEH-006 | Prepare-for-Release bridge | Vitest + RTL | Draft creation moves to Publish, populates dock/form, keeps queue intact | Covered | Add duplicate-draft and stale-draft scenarios |
| BEH-007 | No dead buttons or fake placeholders | Vitest + RTL | Every enabled visible control yields meaningful effect or explicit rationale | Missing | New audit helper required |
| BEH-008 | About/Settings/workflow labels match actual behavior | Vitest + RTL | Labels like `Reset Library Data`, `Refresh Diagnostics`, `Open Track QC` do what they say and nothing more | Missing | Add label-to-behavior contract tests |

### Playback Tests

| ID | Target | Preferred layer | Core assertions | Current coverage | Gap / next action |
| --- | --- | --- | --- | --- | --- |
| PLY-001 | `Play`, `Pause`, `Prev`, `Next`, `Stop` | Vitest + RTL + runtime Playwright | State transitions are immediate, truthful, and free of success toasts | Strong partial | Add `Stop` assertions and runtime smoke for actual transport |
| PLY-002 | Automatic advance on track end | Vitest + RTL + runtime Playwright | End-of-track advances to next queued item and keeps playback active | Covered in component layer | Add runtime verification if feasible |
| PLY-003 | Queue/playlist toggle fallback vs native | Vitest + RTL | Healthy fallback path does not emit false playback error; native path calls correct API | Covered | Add console/toast recorder to ensure silence |
| PLY-004 | Volume, mute, seek | Vitest + RTL | Correct normalization, mute restore, seek isolation, no unrelated state mutation | Covered partial | Add runtime seek/volume smoke |
| PLY-005 | Exclusive/shared mode transitions | Vitest + RTL + runtime Playwright | Shared default, explicit exclusive entry, clean fallback on failure, visible active state | Covered partial | Add first-run warning/indicator expectations if intended |
| PLY-006 | Player persistence across workspaces | Vitest + RTL | Shared player remains consistent when moving across Release Preview workspaces; ambiguity in Publish/About logged separately | Partial | Add cross-workspace sweep and mark Publish/About behavior as expectation under review |
| PLY-007 | Invalid queue recovery | Vitest + RTL + Rust integration | Removing roots/resetting library prunes stale queue/favorite/publish references cleanly | Covered partial | Add restart/restore regression cases |
| PLY-008 | Repeated transport actions | Vitest + RTL | Rapid `Play/Next/Pause` sequences remain deterministic and noise-free | Missing | Add stress-style transport test |

### Library and Scan Tests

| ID | Target | Preferred layer | Core assertions | Current coverage | Gap / next action |
| --- | --- | --- | --- | --- | --- |
| LIB-001 | Add folder / browse / refresh | Vitest + RTL + runtime Playwright | Root picker populates input, add persists root, refresh reloads list only | Partial | Add browse-path + duplicate-root scenarios |
| LIB-002 | Scan and cancel root ingest | Vitest + RTL + runtime Playwright | Scan starts correct root job, cancel produces truthful terminal state | Covered partial | Add interrupted-scan restart scenario |
| LIB-003 | Manual file import | Vitest + RTL + runtime Playwright | Import succeeds for valid paths and surfaces explicit failures for broken files | Partial | Add broken-file and mixed-valid-invalid payload cases |
| LIB-004 | Dropped-folder and dropped-file autoplay | Vitest + RTL | Completed scan/import queues first valid track once and only once | Covered | Add repeated-drop and canceled-drop cases |
| LIB-005 | Search/filter during and after scan | Vitest + RTL | Search remains isolated while ingest job status changes | Missing | Add async ingest + search concurrency case |
| LIB-006 | Broken file handling | Vitest + RTL + Rust integration | Failed imports remain visible as failures, not phantom tracks | Partial | Add explicit malformed/unsupported media scenarios |
| LIB-007 | Root removal pruning | Vitest + RTL | Catalog, queue, favorites, and release selections prune stale ids | Covered | Add restart persistence check |
| LIB-008 | Reset Library Data | Vitest + RTL + runtime Playwright | App returns to clean local-library state with no stale rows or roots | Covered partial | Add post-reset restart/restore test |

### Layout and Responsive Tests

| ID | Target | Preferred layer | Core assertions | Current coverage | Gap / next action |
| --- | --- | --- | --- | --- | --- |
| LAY-001 | Wide window | Playwright screenshot/assertions | No detached panels, empty layout gaps, or unintended overflow | Missing | Add desktop-wide viewport baseline |
| LAY-002 | Normal window | Playwright screenshot/assertions | Core controls remain visible and aligned | Missing | Add baseline viewport contract |
| LAY-003 | Reduced width window | Playwright screenshot/assertions | No critical control occlusion, collapses behave, no hidden empty regions | Missing | Add narrow viewport shell sweep |
| LAY-004 | Publish mode right panel behavior | Playwright | Release dock remains visible/usable and main publish panel keeps context | Missing | Add publish viewport contract |
| LAY-005 | No horizontal scroll unless intended | Playwright | Shell and major workspaces avoid unintended horizontal overflow | Missing | Add scroll-width assertion helper |
| LAY-006 | Collapsed sections do not leave layout gaps | Vitest + RTL + Playwright | Library/Settings collapses hide content cleanly and persist across remounts | Partial | Add layout assertions in addition to persistence assertions |

### Video Workspace Tests

| ID | Target | Preferred layer | Core assertions | Current coverage | Gap / next action |
| --- | --- | --- | --- | --- | --- |
| VID-001 | Media import and drag/drop | Vitest + RTL | Correct asset slot assignment, metadata display, unsupported-file rejection | Covered | Add runtime/native picker smoke |
| VID-002 | Visual/text/output controls | Vitest + RTL | Deterministic preview updates, no render side effects from edit-only changes | Strong partial | Add no-side-effect assertions |
| VID-003 | Preview transport isolation | Vitest + RTL | Video preview play/pause/seek does not mutate shared music player state | Missing | Add explicit isolation test |
| VID-004 | Render request/preflight/start/cancel/success/error | Vitest + RTL + runtime Playwright | Truthful diagnostics, preflight gating, runtime status, cancel, open folder | Strong partial | Add runtime shell scenario and console recorder |
| VID-005 | Persistence and restore | Vitest + RTL | Save/load project and preset restore state exactly and surface missing-source relink warnings | Covered | Add restart persistence via Playwright/local storage |

### Publish Workflow Tests

| ID | Target | Preferred layer | Core assertions | Current coverage | Gap / next action |
| --- | --- | --- | --- | --- | --- |
| PUB-001 | Step-bar navigation | Vitest + RTL | Shell tabs and embedded Publisher Ops stay in sync | Partial | Add full tab sweep including stale-screen protection |
| PUB-002 | Draft selection dock | Vitest + RTL | Clear, load, remove, and return-to-Track-QC actions behave independently from listen queue | Covered partial | Add duplicate/removal edge cases |
| PUB-003 | New Release form controls | Vitest + RTL | Inputs/select/checkbox only mutate form state until action buttons are pressed | Partial | Add no-side-effect assertions |
| PUB-004 | Load spec / plan / execute / history / report | Vitest + RTL + runtime Playwright | Outcomes are asserted, not just clicks; errors are structured and truthful | Strong partial | Update legacy Playwright smoke to current embedded shell |
| PUB-005 | Resume flow | Vitest + RTL + runtime Playwright | Resumes selected release only and updates history/report consistently | Partial | Add explicit selected-row contract |

### Negative and Monkey Tests

| ID | Target | Preferred layer | Core assertions | Current coverage | Gap / next action |
| --- | --- | --- | --- | --- | --- |
| NEG-001 | Random typing into inputs | Playwright + Vitest | Inputs tolerate noise without cross-system side effects | Missing | Add fuzz-lite form/input sweep |
| NEG-002 | Switching pages during playback | Playwright + Vitest | Playback remains stable, no stale layout or error banners | Missing | Add navigation-under-playback scenario |
| NEG-003 | Repeated tab switching | Vitest + RTL | No render loops, stale state mismatches, or maximum-depth warnings | Partial via prior regressions | Add generic repeated-tab stress harness |
| NEG-004 | Repeated `Play/Next/Pause` actions | Vitest + RTL | No race-induced invalid transport state or unrelated notifications | Missing | Add deterministic transport monkey test |
| NEG-005 | Safe interruption of noncritical flows | Playwright + Vitest | Cancel scan/render safely, intermediate UI remains truthful | Partial | Add scan/render interruption matrix |
| NEG-006 | Invalid state restore on restart | Playwright + runtime + Rust integration | Persisted invalid queue/selection/root/render state is pruned or warned on restart | Missing | Add restart-corruption regression suite |

## Highest-Value Pass 2 Targets

1. Replace legacy Playwright browser smoke assertions so they target the current shell instead of the old standalone publisher prototype.
2. Add `withUiSignalRecorder` and make smoke/playback scenarios fail on unrelated console/page errors.
3. Add `assertVisibleActionableControls` and run it across `Library`, `Quality Control`, `Playlists`, `Video Workspace`, `Settings`, `About`, and `Publisher Ops`.
4. Add explicit isolation tests for `Search`, `Settings`, `About`, and video-preview transport so side effects are caught early.
5. Add first-pass responsive Playwright checks for wide, normal, and reduced-width layouts, including Publish mode dock behavior.
