# Bug Audit

Status: Pass 2 reproduction complete for the defects listed below. Additional defects may be added during Pass 3 fix and regression work.

## Classification Legend

- `dead control`
- `incorrect behavior`
- `misleading label`
- `invalid state transition`
- `layout/responsive defect`
- `persistence/recovery defect`
- `spurious notification`
- `unrelated side effect`
- `placeholder UI exposed to user`
- `regression`

## Reproduced Defects

| Title | Classification | Severity | Reproduction steps | Observed behavior | Expected behavior | Probable cause | Covered by automated test after fix |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Shared player bar disappears on About workspace | `incorrect behavior` | `P1` | 1. Launch the shell in `Listen` mode. 2. Confirm the bottom player region `Shared transport` is visible. 3. Click `About`. | The persistent player bar disappears as soon as `About` becomes active, removing transport and playback context from the shell. Reproduced in Vitest shell integration coverage. | The shared player should remain visible across workspaces, including `About`, so playback context is preserved while the page stays informational. | `WorkspaceRuntime.tsx` gates `SharedPlayerBar` behind `activeMode === "Listen" && activeWorkspace !== "About"`, so the shell intentionally unmounts the player on `About`. | `Yes - apps/desktop/src/app/shell/WorkspaceApp.pass2.test.tsx` currently captures this with `it.fails(...)`; convert it to a normal assertion in Pass 3 after the fix. |
| Settings clear-banner controls stay enabled when nothing can be cleared | `dead control` | `P2` | 1. Launch the shell with no active notice banner and no active catalog error banner. 2. Open `Settings`. 3. Observe `Clear Notice` and `Clear Error Banner`. | Both buttons render as enabled and clickable even when there is no notice or error banner to clear, so they present as actionable controls with no meaningful result. Reproduced in Vitest shell integration coverage. | These controls should be disabled when there is no matching banner state to clear, or removed from the active action row until they apply. | `SettingsPanel.tsx` receives callbacks for both clear actions but no boolean state describing whether a notice or error is currently present, so the buttons are always rendered enabled. | `Yes - apps/desktop/src/app/shell/WorkspaceApp.pass2.test.tsx` currently captures this with `it.fails(...)`; convert it to a normal assertion in Pass 3 after the fix. |

## Notes

- `apps/desktop/src/app/shell/WorkspaceApp.pass2.test.tsx` also verifies two non-defect contracts in Pass 2: search isolation from playback/preview/publish side effects, and About workspace mode-independence for its visible resource controls.
- The reusable helpers added in Pass 2 live in `apps/desktop/src/test/uiSignalRecorder.ts` and `apps/desktop/src/test/visibleControlAudit.ts`.
- Runtime-only reproduction is still pending for a later end-to-end sweep; the defects above are currently reproduced in deterministic Vitest shell integration coverage.
