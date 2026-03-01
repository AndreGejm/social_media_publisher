import { HelpTooltip } from "../../HelpTooltip";
import SectionCollapseToggle from "../workspace/components/SectionCollapseToggle";
import type {
  CatalogImportFailure,
  CatalogIngestJobResponse,
  LibraryRootResponse
} from "../../services/tauriClient";

export type LibraryIngestTab = "scan_folders" | "import_files";

type LibraryIngestSidebarProps = {
  visible: boolean;
  libraryIngestCollapsed: boolean;
  onToggleCollapsed: () => void;
  libraryIngestTab: LibraryIngestTab;
  tabs: Array<{ value: LibraryIngestTab; label: string }>;
  onSelectTab: (tab: LibraryIngestTab) => void;
  statusItems: string[];
  libraryRootPathInput: string;
  onChangeLibraryRootPathInput: (value: string) => void;
  onBrowseLibraryRoot: () => void;
  libraryRootMutating: boolean;
  libraryRootBrowsing: boolean;
  onAddLibraryRoot: () => void;
  onRefreshLibraryRoots: () => void;
  libraryRootsLoading: boolean;
  libraryRoots: LibraryRootResponse[];
  rootScanJobs: CatalogIngestJobResponse[];
  showFullPaths: boolean;
  formatDisplayPath: (path: string, options: { showFullPaths: boolean }) => string;
  onScanLibraryRoot: (rootId: string) => void;
  onCancelIngestJob: (jobId: string) => void;
  onRemoveLibraryRoot: (rootId: string) => void;
  importPathsInput: string;
  onChangeImportPathsInput: (value: string) => void;
  onImportFiles: () => void;
  catalogImporting: boolean;
  catalogFailures: CatalogImportFailure[];
};

export default function LibraryIngestSidebar(props: LibraryIngestSidebarProps) {
  if (!props.visible) return null;

  return (
    <section className="sidebar-panel" aria-label="Library ingest tools">
      <div className="sidebar-panel-head">
        <div className="sidebar-panel-head-main">
          <h2>Library Ingest</h2>
          <SectionCollapseToggle
            expanded={!props.libraryIngestCollapsed}
            onToggle={props.onToggleCollapsed}
            label="Library Ingest"
            controlsId="library-ingest-panel-body"
          />
        </div>
        <HelpTooltip
          variant="popover"
          iconLabel="How library ingest tools work"
          title="Library Ingest"
          side="bottom"
          content={
            <>
              <p>
                <strong>Scan Folders</strong> indexes files recursively from saved roots in-place (no copying).
              </p>
              <p>
                <strong>Import Files</strong> ingests only the file paths you paste manually in the current build.
              </p>
            </>
          }
        />
      </div>

      <div id="library-ingest-panel-body" hidden={props.libraryIngestCollapsed} className="collapsible-panel-body">
        <div className="library-ingest-tabs" role="tablist" aria-label="Library ingest sections">
          {props.tabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={props.libraryIngestTab === tab.value}
              className={`library-ingest-tab${props.libraryIngestTab === tab.value ? " active" : ""}`}
              onClick={() => props.onSelectTab(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {props.statusItems.length > 0 ? (
          <div className="library-ingest-status" role="status" aria-live="polite">
            {props.statusItems.map((item) => (
              <span key={item} className="library-ingest-status-item">
                {item}
              </span>
            ))}
          </div>
        ) : null}

        {props.libraryIngestTab === "scan_folders" ? (
          <div className="library-ingest-panel" role="tabpanel" aria-label="Scan folders">
            <p className="sidebar-inline-note">Indexes files in-place. Does not copy audio files.</p>
            <HelpTooltip content="Directory path to scan recursively for audio files. Local and UNC/network share paths are supported.">
              <input
                className="tracks-search"
                type="text"
                value={props.libraryRootPathInput}
                onChange={(event) => props.onChangeLibraryRootPathInput(event.target.value)}
                placeholder={"C:\\Music"}
                aria-label="Library root path"
              />
            </HelpTooltip>
            <div className="library-root-actions">
              <HelpTooltip content="Opens a native folder picker to populate the library root path input.">
                <button
                  type="button"
                  className="secondary-action"
                  onClick={props.onBrowseLibraryRoot}
                  disabled={props.libraryRootMutating || props.libraryRootBrowsing}
                >
                  {props.libraryRootBrowsing ? "Opening..." : "Browse..."}
                </button>
              </HelpTooltip>
              <HelpTooltip content="Adds this folder as a persisted local library root.">
                <button
                  type="button"
                  className="secondary-action"
                  onClick={props.onAddLibraryRoot}
                  disabled={props.libraryRootMutating}
                >
                  Add Folder
                </button>
              </HelpTooltip>
              <HelpTooltip content="Reloads the saved library root list from SQLite.">
                <button
                  type="button"
                  className="secondary-action"
                  onClick={props.onRefreshLibraryRoots}
                  disabled={props.libraryRootsLoading}
                >
                  {props.libraryRootsLoading ? "Loading..." : "Refresh Folders"}
                </button>
              </HelpTooltip>
            </div>

            <div className="library-roots-list">
              {props.libraryRoots.length === 0 ? (
                <p className="sidebar-inline-note">No scan folders added yet.</p>
              ) : (
                props.libraryRoots.map((root) => {
                  const latestJob = props.rootScanJobs.find((job) => job.scope === `SCAN_ROOT:${root.root_id}`);
                  const canCancelJob = latestJob ? ["PENDING", "RUNNING"].includes(latestJob.status) : false;
                  const progress =
                    latestJob && latestJob.total_items > 0
                      ? `${latestJob.processed_items}/${latestJob.total_items}`
                      : latestJob
                        ? `${latestJob.processed_items}`
                        : "Idle";
                  return (
                    <div key={root.root_id} className="library-root-row">
                      <div className="library-root-meta">
                        <strong>{props.formatDisplayPath(root.path, { showFullPaths: props.showFullPaths })}</strong>
                        <span>
                          {latestJob ? `${latestJob.status} | ${progress} | errors ${latestJob.error_count}` : "No scans yet"}
                        </span>
                      </div>
                      <div className="library-root-row-actions">
                        <HelpTooltip content="Scans this saved folder recursively and imports supported audio files into the local catalog.">
                          <button
                            type="button"
                            className="secondary-action"
                            onClick={() => props.onScanLibraryRoot(root.root_id)}
                            disabled={props.libraryRootMutating}
                          >
                            Scan Folder
                          </button>
                        </HelpTooltip>
                        <HelpTooltip content="Requests cancellation for the currently running scan job for this folder.">
                          <button
                            type="button"
                            className="secondary-action"
                            onClick={() => {
                              if (!latestJob) return;
                              props.onCancelIngestJob(latestJob.job_id);
                            }}
                            disabled={props.libraryRootMutating || !canCancelJob}
                          >
                            Cancel Scan
                          </button>
                        </HelpTooltip>
                        <HelpTooltip content="Removes the saved library root and prunes imported catalog tracks from that root (local files on disk are untouched).">
                          <button
                            type="button"
                            className="secondary-action"
                            onClick={() => props.onRemoveLibraryRoot(root.root_id)}
                            disabled={props.libraryRootMutating}
                          >
                            Remove Folder
                          </button>
                        </HelpTooltip>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <div className="library-ingest-panel" role="tabpanel" aria-label="Import files">
            <p className="sidebar-inline-note">
              Manual ingest for explicit files only. No folder root needs to be saved first.
            </p>
            <HelpTooltip content="Paste one or more local file paths (newline or comma separated) to import them into the local music catalog.">
              <textarea
                className="catalog-import-textarea"
                rows={5}
                value={props.importPathsInput}
                onChange={(event) => props.onChangeImportPathsInput(event.target.value)}
                placeholder={"C:\\Music\\Artist - Track.wav\nC:\\Music\\Another\\Song.flac"}
                aria-label="Import file paths"
              />
            </HelpTooltip>
            <p className="sidebar-inline-note subtle">
              Destination: Local catalog index (managed file-copy workflow is not enabled in this build).
            </p>
            <HelpTooltip content="Runs native Rust analysis and stores imported tracks in the local catalog.">
              <button type="button" className="primary-action" onClick={props.onImportFiles} disabled={props.catalogImporting}>
                {props.catalogImporting ? "Importing..." : "Import Files"}
              </button>
            </HelpTooltip>
            {props.catalogFailures.length > 0 ? (
              <div className="import-failures" role="status" aria-live="polite">
                <strong>Import failures ({props.catalogFailures.length})</strong>
                <ul>
                  {props.catalogFailures.slice(0, 3).map((failure) => (
                    <li key={`${failure.path}-${failure.code}`}>
                      <code>{failure.code}</code>: {props.formatDisplayPath(failure.path, { showFullPaths: props.showFullPaths })}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
