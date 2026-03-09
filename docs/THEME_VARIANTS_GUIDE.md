# Theme Variants Guide

## Scope
This update extends the existing theme system without changing theme infrastructure.

Unchanged behavior:
- Theme mode support remains `dark`, `light`, and `system`.
- Existing persistence and mode resolution behavior remains intact.
- Existing runtime hook flow remains the source of truth for applying theme state.

Added behavior:
- Palette variants are now selectable.
- Semantic design tokens are applied per resolved mode and variant.

## Files
- `apps/desktop/src/shared/theme/themeVariants.ts`
- `apps/desktop/src/features/workspace/hooks/useWorkspaceUiEffects.ts`
- `apps/desktop/src/features/workspace/hooks/useWorkspacePersistence.ts`
- `apps/desktop/src/features/workspace/WorkspaceRuntime.tsx`
- `apps/desktop/src/features/settings/SettingsPanel.tsx`
- `apps/desktop/src/styles.css`

## Variant Catalog
### Dark variants
- `Studio Dark` (`studio-dark`) - default dark palette.
- `Nordic Dark` (`nordic-dark`) - cool and low-fatigue.
- `Midnight Studio` (`midnight-studio`) - deeper cinematic contrast.
- `High Contrast Dark` (`high-contrast-dark`) - accessibility-first dark mode.

### Light variants
- `Arctic Light` (`arctic-light`) - default light palette.
- `Minimal Light` (`minimal-light`) - neutral modern light UI.
- `Soft Paper` (`soft-paper`) - warm low-glare light UI.

## Semantic Tokens
Core semantic tokens applied per variant:
- `backgroundPrimary`
- `backgroundPanel`
- `surfaceElevated`
- `textPrimary`
- `textSecondary`
- `accentPrimary`
- `accentSecondary`
- `borderSubtle`
- `borderStrong`
- `success`
- `warning`
- `error`

Runtime also applies:
- `accentPrimaryRgb`
- `accentSecondaryRgb`

These feed CSS variables:
- `--background-primary`
- `--background-panel`
- `--surface-elevated`
- `--text-primary`
- `--text-secondary`
- `--accent-primary`
- `--accent-secondary`
- `--border-subtle`
- `--border-strong`
- `--success`
- `--warning`
- `--error`
- `--accent-primary-rgb`
- `--accent-secondary-rgb`

Legacy aliases are preserved (`--bg`, `--panel`, `--line`, `--text`, `--muted`, `--accent`) to avoid broad CSS breakage.

## Resolution Rules
1. Theme mode is resolved from preference:
   - `system` follows OS
   - explicit `light`/`dark` wins
2. Variant is resolved against active mode:
   - If selected variant matches the active mode, it is applied.
   - If it does not match, fallback is used:
     - dark fallback: `studio-dark`
     - light fallback: `arctic-light`
3. For explicit mode selection (`light` or `dark`), mismatched variants are normalized automatically.

## Settings UI
Settings now includes:
- Theme Mode selector: `System`, `Light`, `Dark`
- Palette Variant selector:
  - Dark-only options when mode is `Dark`
  - Light-only options when mode is `Light`
  - Grouped dark/light options when mode is `System`

## Design Rationale
- Keep existing architecture stable and avoid theme-provider rewrites.
- Improve readability and visual hierarchy through tokenized surfaces, borders, and text contrast.
- Support long editing sessions with restrained accents and non-neon palettes.
- Keep extension simple: add one variant definition in `themeVariants.ts` and reuse existing mode flow.

## Extension Rules
When adding a new variant:
1. Add a typed `ThemeVariantDefinition` in `themeVariants.ts`.
2. Provide all semantic tokens.
3. Set the variant `mode` (`light` or `dark`).
4. Do not add direct color literals to component TSX files.
5. Prefer semantic CSS variables in stylesheet updates.
