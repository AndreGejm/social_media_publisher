import {
  DARK_THEME_VARIANTS,
  LIGHT_THEME_VARIANTS,
  getDefaultThemeVariantForMode,
  getThemeVariantMode,
  type ThemePreference,
  type ThemeVariantId
} from "../../shared/theme/themeVariants";
import { HelpTooltip } from "../../shared/ui/HelpTooltip";
import {
  SHORTCUT_ACTIONS,
  formatShortcutBinding,
  keyboardEventToShortcutBinding,
  type ShortcutActionId,
  type ShortcutBindings
} from "../../shared/input/shortcuts";
import SectionCollapseToggle from "../workspace/components/SectionCollapseToggle";

type SettingsPanelProps = {
  hidden: boolean;
  settingsPreferencesCollapsed: boolean;
  onToggleSettingsPreferencesCollapsed: () => void;
  themePreference: ThemePreference;
  onThemePreferenceChange: (value: ThemePreference) => void;
  themeVariantPreference: ThemeVariantId;
  onThemeVariantPreferenceChange: (value: ThemeVariantId) => void;
  compactDensity: boolean;
  onCompactDensityChange: (value: boolean) => void;
  showFullPaths: boolean;
  onShowFullPathsChange: (value: boolean) => void;
  addParentFoldersAsRootsOnDrop: boolean;
  onAddParentFoldersAsRootsOnDropChange: (value: boolean) => void;
  shortcutBindings: ShortcutBindings;
  shortcutConflictActionIdSet: Set<ShortcutActionId>;
  onShortcutBindingChange: (actionId: ShortcutActionId, binding: string | null) => void;
  onResetShortcutBindings: () => void;
  onClearNotice: () => void;
  hasNotice: boolean;
  onClearErrorBanner: () => void;
  hasErrorBanner: boolean;
  onResetLibraryData: () => void;
  resetLibraryDataPending: boolean;
};

export default function SettingsPanel(props: SettingsPanelProps) {
  const resolvedThemeVariantPreference =
    props.themePreference === "system"
      ? props.themeVariantPreference
      : getThemeVariantMode(props.themeVariantPreference) === props.themePreference
        ? props.themeVariantPreference
        : getDefaultThemeVariantForMode(props.themePreference);

  return (
    <section hidden={props.hidden} className="workspace-section settings-layout">
      <div className="settings-card">
        <div className="settings-card-head">
          <div>
            <p className="eyebrow">Settings</p>
            <h3>UI & Playback Preferences</h3>
            <p className="helper-text">
              Local-only preferences stored in browser/Tauri webview storage. They do not change publisher pipeline semantics.
            </p>
          </div>
          <SectionCollapseToggle
            expanded={!props.settingsPreferencesCollapsed}
            onToggle={props.onToggleSettingsPreferencesCollapsed}
            label="Preferences"
            controlsId="settings-preferences-panel"
          />
        </div>

        <div id="settings-preferences-panel" hidden={props.settingsPreferencesCollapsed} className="collapsible-panel-body">
          <div className="settings-grid">
            <label className="settings-field">
              <span>Theme Mode</span>
              <HelpTooltip content="Choose light, dark, or follow the operating system theme.">
                <select
                  aria-label="Theme preference"
                  value={props.themePreference}
                  onChange={(event) => props.onThemePreferenceChange(event.target.value as ThemePreference)}
                >
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </HelpTooltip>
            </label>

            <label className="settings-field">
              <span>Palette Variant</span>
              <HelpTooltip content="Choose a curated palette. In System mode, Skald applies the closest variant for the active OS light/dark state.">
                <select
                  aria-label="Theme palette variant"
                  value={resolvedThemeVariantPreference}
                  onChange={(event) => props.onThemeVariantPreferenceChange(event.target.value as ThemeVariantId)}
                >
                  {props.themePreference === "system" ? (
                    <>
                      <optgroup label="Dark variants">
                        {DARK_THEME_VARIANTS.map((variant) => (
                          <option key={variant.id} value={variant.id}>
                            {variant.label}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Light variants">
                        {LIGHT_THEME_VARIANTS.map((variant) => (
                          <option key={variant.id} value={variant.id}>
                            {variant.label}
                          </option>
                        ))}
                      </optgroup>
                    </>
                  ) : props.themePreference === "dark" ? (
                    DARK_THEME_VARIANTS.map((variant) => (
                      <option key={variant.id} value={variant.id}>
                        {variant.label}
                      </option>
                    ))
                  ) : (
                    LIGHT_THEME_VARIANTS.map((variant) => (
                      <option key={variant.id} value={variant.id}>
                        {variant.label}
                      </option>
                    ))
                  )}
                </select>
              </HelpTooltip>
            </label>

            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={props.compactDensity}
                onChange={(event) => props.onCompactDensityChange(event.target.checked)}
              />
              <span>Compact density (denser lists and controls)</span>
            </label>

            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={props.showFullPaths}
                onChange={(event) => props.onShowFullPathsChange(event.target.checked)}
              />
              <span>Show full local file paths (disable truncation)</span>
            </label>

            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={props.addParentFoldersAsRootsOnDrop}
                onChange={(event) => props.onAddParentFoldersAsRootsOnDropChange(event.target.checked)}
              />
              <span>On file drop, also add each file's parent folder as a scan root</span>
            </label>
          </div>

          <div className="settings-shortcuts-section">
            <div className="settings-shortcuts-head">
              <h4>Shortcuts</h4>
              <p className="helper-text">
                Click a shortcut field and press a key (or key combo). Use Backspace/Delete to clear a binding.
              </p>
            </div>
            <div className="settings-shortcuts-grid">
              {SHORTCUT_ACTIONS.map((shortcut) => {
                const hasConflict = props.shortcutConflictActionIdSet.has(shortcut.id);
                const displayValue = formatShortcutBinding(props.shortcutBindings[shortcut.id]);
                return (
                  <div
                    key={shortcut.id}
                    className={`settings-shortcut-row${hasConflict ? " conflict" : ""}`}
                  >
                    <div className="settings-shortcut-meta">
                      <strong>{shortcut.label}</strong>
                      <span>{shortcut.description}</span>
                    </div>
                    <HelpTooltip content="Focus this field and press a key combination to set the shortcut.">
                      <input
                        type="text"
                        readOnly
                        value={displayValue}
                        aria-label={`${shortcut.label} shortcut`}
                        className="settings-shortcut-input"
                        onKeyDown={(event) => {
                          if (event.key === "Backspace" || event.key === "Delete") {
                            event.preventDefault();
                            props.onShortcutBindingChange(shortcut.id, null);
                            return;
                          }
                          const binding = keyboardEventToShortcutBinding(event);
                          if (!binding) return;
                          event.preventDefault();
                          props.onShortcutBindingChange(shortcut.id, binding);
                        }}
                      />
                    </HelpTooltip>
                    <button
                      type="button"
                      className="secondary-action compact"
                      onClick={() => props.onShortcutBindingChange(shortcut.id, null)}
                    >
                      Clear
                    </button>
                  </div>
                );
              })}
            </div>
            {props.shortcutConflictActionIdSet.size > 0 ? (
              <p className="settings-shortcut-warning" role="alert">
                Two or more shortcuts use the same binding. Only the first matching action will run.
              </p>
            ) : null}
            <div className="settings-actions">
              <button type="button" className="secondary-action" onClick={props.onResetShortcutBindings}>
                Reset Shortcuts
              </button>
            </div>
          </div>

          <div className="settings-actions">
            <HelpTooltip content="Clears the current UI notice banner.">
              <button
                type="button"
                className="secondary-action"
                onClick={props.onClearNotice}
                disabled={!props.hasNotice}
              >
                Clear Notice
              </button>
            </HelpTooltip>
            <HelpTooltip content="Clears the current catalog error banner shown in the music shell.">
              <button
                type="button"
                className="secondary-action"
                onClick={props.onClearErrorBanner}
                disabled={!props.hasErrorBanner}
              >
                Clear Error Banner
              </button>
            </HelpTooltip>
            <HelpTooltip content="Clears persisted local library roots, imported catalog tracks, ingest jobs, queue/favorites, and session selections. Local media files on disk are not deleted.">
              <button
                type="button"
                className="secondary-action"
                onClick={props.onResetLibraryData}
                disabled={props.resetLibraryDataPending}
              >
                {props.resetLibraryDataPending ? "Resetting..." : "Reset Library Data"}
              </button>
            </HelpTooltip>
          </div>
        </div>
      </div>
    </section>
  );
}

