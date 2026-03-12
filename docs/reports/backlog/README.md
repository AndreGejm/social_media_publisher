# Backlog Investigation Tickets

Store architect-reviewed investigation tickets in this directory:

- `docs/reports/backlog/`
- `docs/reports/backlog/_records/` for implementation ledgers and completion records

Use one file per triage note.

## Input source

Backlog tickets in this folder are created from triage notes in:

- `docs/reports/triage/`

The triage note is treated as potentially flawed input.

## File naming

Use:

- `YYYY-MM-DD-short-kebab-title.md`

Example:

- `2026-03-12-export-crash-investigation.md`

## Required format

Each file must use this exact section structure:

1. `BACKLOG INVESTIGATION TICKET`
2. `Title`
3. `Problem Statement`
4. `User/System Impact`
5. `Observed Behavior`
6. `Expected Behavior`
7. `Evidence`
8. `Hypotheses`
9. `Unknowns / Missing Evidence`
10. `Classification`
11. `Severity`
12. `Type`
13. `Surface Area`
14. `Ownership Suggestion`
15. `Primary Module`
16. `Primary Directory`
17. `Likely Files`
18. `Likely Functions / Entry Points`
19. `Investigation Scope`
20. `Suggested First Investigation Steps`
21. `Exit Criteria for Investigation`
22. `Priority Recommendation`
23. `Confidence`
24. `Tags`

## Architect guardrails

- Do not implement fixes.
- Do not modify code.
- Separate evidence, hypotheses, and unknowns.
- Keep scope bounded and investigation-ready.
- Avoid fake certainty.

Copy `TEMPLATE.md` in this folder for new backlog investigation tickets.
