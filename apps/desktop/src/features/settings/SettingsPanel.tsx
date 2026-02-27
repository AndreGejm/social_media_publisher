import { HelpTooltip } from "../../HelpTooltip";
import SectionCollapseToggle from "../workspace/components/SectionCollapseToggle";

type ThemePreference = "system" | "light" | "dark";

type SettingsPanelProps = {
  hidden: boolean;
  settingsPreferencesCollapsed: boolean;
  onToggleSettingsPreferencesCollapsed: () => void;
  themePreference: ThemePreference;
  onThemePreferenceChange: (value: ThemePreference) => void;
  compactDensity: boolean;
  onCompactDensityChange: (value: boolean) => void;
  showFullPaths: boolean;
  onShowFullPathsChange: (value: boolean) => void;
  onClearNotice: () => void;
  onClearErrorBanner: () => void;
  settingsSummaryCollapsed: boolean;
  onToggleSettingsSummaryCollapsed: () => void;
  summary: {
    tracksCount: number;
    albumGroupsCount: number;
    favoritesCount: number;
    queueCount: number;
    releaseSelectionsCount: number;
    importFailuresCount: number;
    libraryRootsCount: number;
  };
};

export default function SettingsPanel(props: SettingsPanelProps) {
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
              <span>Theme</span>
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
          </div>

          <div className="settings-actions">
            <HelpTooltip content="Clears the current UI notice banner.">
              <button type="button" className="secondary-action" onClick={props.onClearNotice}>
                Clear Notice
              </button>
            </HelpTooltip>
            <HelpTooltip content="Clears the current catalog error banner shown in the music shell.">
              <button type="button" className="secondary-action" onClick={props.onClearErrorBanner}>
                Clear Error Banner
              </button>
            </HelpTooltip>
          </div>
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-card-head">
          <div>
            <p className="eyebrow">Library Status</p>
            <h3>Quick Summary</h3>
          </div>
          <SectionCollapseToggle
            expanded={!props.settingsSummaryCollapsed}
            onToggle={props.onToggleSettingsSummaryCollapsed}
            label="Summary"
            controlsId="settings-summary-panel"
          />
        </div>
        <div id="settings-summary-panel" hidden={props.settingsSummaryCollapsed} className="collapsible-panel-body">
          <ul className="compact-list settings-summary-list">
            <li>Tracks in current view: {props.summary.tracksCount}</li>
            <li>Album groups: {props.summary.albumGroupsCount}</li>
            <li>Favorites: {props.summary.favoritesCount}</li>
            <li>Queue items: {props.summary.queueCount}</li>
            <li>Release selections: {props.summary.releaseSelectionsCount}</li>
            <li>Import failures (session): {props.summary.importFailuresCount}</li>
            <li>Library roots: {props.summary.libraryRootsCount}</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
