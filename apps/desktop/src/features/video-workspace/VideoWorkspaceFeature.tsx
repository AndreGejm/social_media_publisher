import { useCallback, useEffect, useRef, type ChangeEvent, type DragEvent } from "react";

import {
  resolveVideoTextLayoutPreset,
  VIDEO_PREVIEW_FIT_MODE_OPTIONS,
  VIDEO_TEXT_LAYOUT_PRESETS
} from "../video-composition/api";
import { deriveWaveformStripHeightRatio } from "../overlay-engine/api";
import {
  formatFileSize,
  type VideoWorkspaceMediaAsset
} from "./model/videoWorkspaceProjectState";
import { toVideoRenderRequestJson } from "./model/videoRenderRequest";
import { VIDEO_WORKSPACE_TEXT_BOUNDS } from "./model/videoWorkspaceTextSettings";
import { useVideoWorkspaceOverlayController } from "./hooks/useVideoWorkspaceOverlayController";
import { useVideoWorkspaceOutputSettings } from "./hooks/useVideoWorkspaceOutputSettings";
import { useVideoWorkspacePreviewController } from "./hooks/useVideoWorkspacePreviewController";
import { useVideoWorkspaceRenderController } from "./hooks/useVideoWorkspaceRenderController";
import { useVideoWorkspaceProjectState } from "./hooks/useVideoWorkspaceProjectState";
import { useVideoWorkspaceTextSettings } from "./hooks/useVideoWorkspaceTextSettings";
import { useVideoWorkspacePersistence } from "./hooks/useVideoWorkspacePersistence";
import { VIDEO_WORKSPACE_SECTIONS } from "./types";
import {
  isUiAppError,
  loadFileFromNativePath,
  pickFileDialog
} from "../../services/tauri/tauriClient";
import { subscribeToFileDropEvents } from "../../infrastructure/tauri/dragDrop";

export type VideoWorkspaceFeatureProps = {
  className?: string;
  nativeDropEventsEnabled?: boolean;
};

function formatClockSeconds(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

const SUPPORTED_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png"]);
const SUPPORTED_AUDIO_EXTENSIONS = new Set(["wav"]);

function normalizeDroppedPathCandidate(candidate: string): string | null {
  const trimmed = candidate.trim().replace(/^['"]|['"]$/g, "");
  if (trimmed.length === 0) return null;

  if (trimmed.startsWith("file://")) {
    try {
      const parsedUrl = new URL(trimmed);
      const decodedPath = decodeURIComponent(parsedUrl.pathname);
      if (/^\/[a-zA-Z]:\//.test(decodedPath)) {
        return decodedPath.slice(1).replace(/\//g, "\\");
      }
      if (parsedUrl.hostname.length > 0) {
        return `\\\\${parsedUrl.hostname}${decodedPath.replace(/\//g, "\\")}`;
      }
      return decodedPath;
    } catch {
      return null;
    }
  }

  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith("\\\\") || trimmed.startsWith("/")) {
    return trimmed;
  }

  return null;
}

function extractDroppedPaths(event: DragEvent<HTMLDivElement>): string[] {
  const paths = new Set<string>();
  const getData =
    event.dataTransfer && typeof event.dataTransfer.getData === "function"
      ? event.dataTransfer.getData.bind(event.dataTransfer)
      : () => "";

  const uriList = getData("text/uri-list");
  const textPlain = getData("text/plain");

  for (const payload of [uriList, textPlain]) {
    if (!payload) continue;
    for (const line of payload.split(/\r?\n/)) {
      const normalized = normalizeDroppedPathCandidate(line);
      if (normalized) {
        paths.add(normalized);
      }
    }
  }

  return [...paths];
}
function extractDroppedPathsFromFiles(files: FileList): string[] {
  const paths = new Set<string>();

  for (const file of Array.from(files)) {
    const candidate = (file as File & { path?: unknown }).path;
    if (typeof candidate !== "string") continue;
    const normalized = normalizeDroppedPathCandidate(candidate);
    if (normalized) {
      paths.add(normalized);
    }
  }

  return [...paths];
}

function inferMediaKindFromPath(path: string): "image" | "audio" | null {
  const normalized = path.replace(/\\/g, "/");
  const fileName = normalized.split("/").pop() ?? "";
  const extension = fileName.includes(".")
    ? fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase()
    : "";

  if (SUPPORTED_IMAGE_EXTENSIONS.has(extension)) return "image";
  if (SUPPORTED_AUDIO_EXTENSIONS.has(extension)) return "audio";
  return null;
}

function MediaAssetSummary(props: {
  kind: "image" | "audio";
  asset: VideoWorkspaceMediaAsset | null;
  onChooseFile: () => void;
  onChooseNativeFile: () => void;
  onClear: () => void;
  dropHint: string;
  dropLabel: string;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  showRelinkPrompt?: boolean;
}) {
  const {
    kind,
    asset,
    onChooseFile,
    onChooseNativeFile,
    onClear,
    dropHint,
    dropLabel,
    onDrop,
    onDragOver,
    showRelinkPrompt
  } = props;
  const isImage = kind === "image";

  return (
    <article className="video-media-card" aria-label={isImage ? "Image media" : "Audio media"}>
      <div className="video-media-card-head">
        <h5>{isImage ? "Still Image" : "Audio"}</h5>
        <div className="video-media-card-actions">
          <button type="button" onClick={onChooseNativeFile}>
            {isImage ? "Browse Image (Native)" : "Browse Audio (Native)"}
          </button>
          <button type="button" onClick={onChooseFile}>
            {isImage ? "Choose Image File" : "Choose Audio File"}
          </button>
          <button type="button" onClick={onClear} disabled={!asset}>
            Clear
          </button>
        </div>
      </div>

      <div
        className="video-media-dropzone"
        role="button"
        tabIndex={0}
        aria-label={dropLabel}
        onDrop={onDrop}
        onDragOver={onDragOver}
      >
        <p>{dropHint}</p>
      </div>

      {showRelinkPrompt ? (
        <p className="helper-text" role="alert">
          Saved source path is missing. Re-link this media file before rendering.
        </p>
      ) : null}


      {asset ? (
        <dl
          className="video-media-meta"
          aria-label={isImage ? "Image metadata" : "Audio metadata"}
          data-testid={isImage ? "image-metadata" : "audio-metadata"}
        >
          <div>
            <dt>File</dt>
            <dd>{asset.fileName}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{asset.extension.toUpperCase()}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{formatFileSize(asset.sizeBytes)}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{asset.source === "file_dialog" ? "File dialog" : "Drag and drop"}</dd>
          </div>
        </dl>
      ) : (
        <p className="helper-text">No {isImage ? "image" : "audio"} selected.</p>
      )}
    </article>
  );
}

export default function VideoWorkspaceFeature(props: VideoWorkspaceFeatureProps) {
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const nativeDropEventsEnabled = props.nativeDropEventsEnabled ?? true;
  const audioInputRef = useRef<HTMLInputElement | null>(null);

  const {
    projectState,
    mediaFiles,
    importImageFromFileList,
    importAudioFromFileList,
    importImageFromFileWithSourcePath,
    importAudioFromFileWithSourcePath,
    importImageFromNativePath,
    importAudioFromNativePath,
    clearImage,
    clearAudio,
    clearImportIssues,
    setImportIssue,
    replaceFromSnapshot,
    createSnapshot
  } = useVideoWorkspaceProjectState();

  const textSettingsController = useVideoWorkspaceTextSettings();
  const outputSettingsController = useVideoWorkspaceOutputSettings();

  const previewController = useVideoWorkspacePreviewController({
    imageFile: mediaFiles.imageFile,
    imageSourcePath: projectState.imageAsset?.sourcePath ?? null,
    audioFile: mediaFiles.audioFile,
    audioSourcePath: projectState.audioAsset?.sourcePath ?? null
  });

  const previewProgressRatio =
    previewController.state.durationSeconds > 0
      ? previewController.state.positionSeconds / previewController.state.durationSeconds
      : 0;

  const overlayController = useVideoWorkspaceOverlayController({
    audioFile: mediaFiles.audioFile,
    progressRatio: previewProgressRatio
  });

  const renderController = useVideoWorkspaceRenderController({
    imageAsset: projectState.imageAsset,
    audioAsset: projectState.audioAsset,
    fitMode: previewController.fitMode,
    textSettings: textSettingsController.state,
    overlaySettings: overlayController.settings,
    outputSettings: outputSettingsController.state
  });

  const persistenceController = useVideoWorkspacePersistence({
    project: {
      createSnapshot,
      replaceFromSnapshot
    },
    fitMode: previewController.fitMode,
    setFitMode: previewController.setFitMode,
    text: {
      state: textSettingsController.state,
      replaceState: textSettingsController.replaceState
    },
    overlay: {
      settings: overlayController.settings,
      replaceSettings: overlayController.replaceSettings
    },
    output: {
      state: outputSettingsController.state,
      replaceState: outputSettingsController.replaceState
    },
    resetRenderState: renderController.resetRenderState
  });

  const clearMissingSource = persistenceController.clearMissingSource;

  const activeTextLayoutPreset = resolveVideoTextLayoutPreset(textSettingsController.state.preset);
  const trimmedTitleText = textSettingsController.state.titleText.trim();
  const trimmedArtistText = textSettingsController.state.artistText.trim();

  const shouldRenderTextOverlay =
    textSettingsController.state.enabled &&
    activeTextLayoutPreset.id !== "none" &&
    (trimmedTitleText.length > 0 ||
      (activeTextLayoutPreset.supportsArtist && trimmedArtistText.length > 0));

  const missingImageSource = persistenceController.missingSources.some(
    (source) => source.kind === "image"
  );
  const missingAudioSource = persistenceController.missingSources.some(
    (source) => source.kind === "audio"
  );

  const setMediaImportIssue = (kind: "image" | "audio", message: string, fileName = "") => {
    setImportIssue({
      code: "SOURCE_PATH_READ_FAILED",
      fileName,
      message:
        kind === "image"
          ? `Image import failed: ${message}`
          : `Audio import failed: ${message}`
    });
  };

  const importNativePathForKind = useCallback(
    (kind: "image" | "audio", sourcePath: string, source: "file_dialog" | "drag_drop") => {
      if (kind === "image") {
        importImageFromNativePath(sourcePath, source);
        clearMissingSource("image");
        return;
      }

      importAudioFromNativePath(sourcePath, source);
      clearMissingSource("audio");
    },
    [clearMissingSource, importAudioFromNativePath, importImageFromNativePath]
  );

  const importFirstMatchingDroppedPath = (
    kind: "image" | "audio",
    droppedPaths: string[],
    options?: { reportMissingPathIssue?: boolean }
  ) => {
    const matchingPath = droppedPaths.find((path) => inferMediaKindFromPath(path) === kind);
    if (!matchingPath) {
      if (options?.reportMissingPathIssue ?? true) {
        setMediaImportIssue(
          kind,
          kind === "image"
            ? "Drop did not include a JPG or PNG path."
            : "Drop did not include a WAV path."
        );
      }
      return false;
    }

    importNativePathForKind(kind, matchingPath, "drag_drop");
    return true;
  };

  const handleNativeFilePick = async (kind: "image" | "audio") => {
    const selectedPath = await pickFileDialog({
      title: kind === "image" ? "Select Image File" : "Select WAV Audio File",
      filters:
        kind === "image"
          ? [{ name: "Image", extensions: ["jpg", "jpeg", "png"] }]
          : [{ name: "Audio", extensions: ["wav"] }]
    });

    if (!selectedPath) return;

    try {
      const file = await loadFileFromNativePath(selectedPath);
      if (kind === "image") {
        importImageFromFileWithSourcePath(file, selectedPath, "file_dialog");
      } else {
        importAudioFromFileWithSourcePath(file, selectedPath, "file_dialog");
      }
      persistenceController.clearMissingSource(kind);
      return;
    } catch (error) {
      try {
        importNativePathForKind(kind, selectedPath, "file_dialog");
        return;
      } catch (fallbackError) {
        const primaryMessage = isUiAppError(error)
          ? error.message
          : error instanceof Error
            ? error.message
            : "Native file dialog could not import the selected file.";

        const fallbackMessage = isUiAppError(fallbackError)
          ? fallbackError.message
          : fallbackError instanceof Error
            ? fallbackError.message
            : "Native path fallback could not import the selected file.";

        setMediaImportIssue(kind, `${primaryMessage} (${fallbackMessage})`);
      }
    }
  };

  const handleImageInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    importImageFromFileList(event.currentTarget.files, "file_dialog");
    persistenceController.clearMissingSource("image");
    event.currentTarget.value = "";
  };

  const handleAudioInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    importAudioFromFileList(event.currentTarget.files, "file_dialog");
    persistenceController.clearMissingSource("audio");
    event.currentTarget.value = "";
  };

  const handleImageDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();

    const droppedPaths = [
      ...extractDroppedPaths(event),
      ...extractDroppedPathsFromFiles(event.dataTransfer.files)
    ];

    if (importFirstMatchingDroppedPath("image", droppedPaths, { reportMissingPathIssue: false })) {
      return;
    }

    if (event.dataTransfer.files.length > 0) {
      importImageFromFileList(event.dataTransfer.files, "drag_drop");
      persistenceController.clearMissingSource("image");
      return;
    }

    if (droppedPaths.length === 0) {
      setMediaImportIssue("image", "Drop payload did not include file paths.");
      return;
    }

    importFirstMatchingDroppedPath("image", droppedPaths, { reportMissingPathIssue: true });
  };

  const handleAudioDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();

    const droppedPaths = [
      ...extractDroppedPaths(event),
      ...extractDroppedPathsFromFiles(event.dataTransfer.files)
    ];

    if (importFirstMatchingDroppedPath("audio", droppedPaths, { reportMissingPathIssue: false })) {
      return;
    }

    if (event.dataTransfer.files.length > 0) {
      importAudioFromFileList(event.dataTransfer.files, "drag_drop");
      persistenceController.clearMissingSource("audio");
      return;
    }

    if (droppedPaths.length === 0) {
      setMediaImportIssue("audio", "Drop payload did not include file paths.");
      return;
    }

    importFirstMatchingDroppedPath("audio", droppedPaths, { reportMissingPathIssue: true });
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const handlePreviewTogglePlay = () => {
    if (previewController.state.playbackState === "playing") {
      previewController.pause();
      return;
    }

    void previewController.play();
  };

  const handlePreviewRestart = () => {
    void previewController.restart();
  };

  const handleBuildRenderRequest = () => {
    renderController.buildRenderRequest();
  };

  const handleRefreshDiagnostics = () => {
    void renderController.refreshDiagnostics();
  };

  const handleRenderMp4 = () => {
    void renderController.startRender();
  };

  const handleCancelRender = () => {
    void renderController.cancelRender();
  };

  const handleOpenOutputFolder = () => {
    void renderController.openOutputFolder();
  };

  const handleResetRenderState = () => {
    renderController.resetRenderState();
  };

  const handleSaveProjectSnapshot = () => {
    persistenceController.saveProject();
  };

  const handleLoadProjectSnapshot = () => {
    void persistenceController.loadProject();
  };

  const handleSaveWorkspacePreset = () => {
    persistenceController.savePreset();
  };

  const handleLoadWorkspacePreset = () => {
    persistenceController.loadPreset();
  };

  const refreshRenderDiagnostics = renderController.refreshDiagnostics;

  useEffect(() => {
    void refreshRenderDiagnostics();
  }, [refreshRenderDiagnostics]);

  useEffect(() => {
    if (!nativeDropEventsEnabled) return;

    let canceled = false;
    let unlisten: (() => void) | null = null;

    const attachDropListener = async () => {
      const maybeUnlisten = await subscribeToFileDropEvents((droppedPaths) => {
        if (!Array.isArray(droppedPaths) || droppedPaths.length === 0) return;

        const imagePath = droppedPaths.find((path) => inferMediaKindFromPath(path) === "image");
        const audioPath = droppedPaths.find((path) => inferMediaKindFromPath(path) === "audio");

        if (imagePath) {
          importNativePathForKind("image", imagePath, "drag_drop");
        }

        if (audioPath) {
          importNativePathForKind("audio", audioPath, "drag_drop");
        }
      });

      if (canceled) {
        maybeUnlisten?.();
        return;
      }

      unlisten = maybeUnlisten;
    };

    void attachDropListener();

    return () => {
      canceled = true;
      unlisten?.();
    };
  }, [importNativePathForKind, nativeDropEventsEnabled]);

  const previewStateLabel =
    previewController.state.playbackState === "idle"
      ? "Idle"
      : previewController.state.playbackState === "playing"
        ? "Playing"
        : previewController.state.playbackState === "paused"
          ? "Paused"
          : "Error";

  const overlayStateLabel =
    overlayController.analysis.status === "idle"
      ? "Idle"
      : overlayController.analysis.status === "loading"
        ? "Analyzing"
        : overlayController.analysis.status === "ready"
          ? "Ready"
          : "Error";
  const overlayPreviewHeightPercent =
    Math.round(deriveWaveformStripHeightRatio(overlayController.settings) * 1000) / 10;

  return (
    <div className={props.className ?? ""} data-testid="video-workspace-shell">
      <header className="placeholder-workspace">
        <p className="eyebrow">Video Rendering</p>
        <h3>Image + Audio to YouTube MP4</h3>
        <p className="helper-text">
          Stage 10: local project and preset persistence is active with save/load flows and remembered output preferences.
        </p>
      </header>

      <section className="placeholder-workspace" aria-label="Workspace persistence controls">
        <h4>Persistence</h4>
        <p className="helper-text">
          Save or restore a local project snapshot and reusable preset. Last output preset and recent directories are remembered automatically.
        </p>
        <div className="video-render-actions">
          <button
            type="button"
            onClick={handleSaveProjectSnapshot}
            aria-label="Save project snapshot"
          >
            Save Project
          </button>
          <button
            type="button"
            onClick={handleLoadProjectSnapshot}
            aria-label="Load saved project snapshot"
            disabled={!persistenceController.hasSavedProject}
          >
            Load Project
          </button>
          <button
            type="button"
            onClick={handleSaveWorkspacePreset}
            aria-label="Save workspace preset"
          >
            Save Preset
          </button>
          <button
            type="button"
            onClick={handleLoadWorkspacePreset}
            aria-label="Load saved workspace preset"
            disabled={!persistenceController.hasSavedPreset}
          >
            Load Preset
          </button>
        </div>
        <p className="helper-text" data-testid="video-persistence-status">
          {persistenceController.statusMessage ?? "No persistence action yet."}
        </p>
        {persistenceController.statusMessage ? (
          <button
            type="button"
            onClick={persistenceController.clearStatus}
            aria-label="Dismiss persistence status"
          >
            Dismiss Status
          </button>
        ) : null}
      </section>

      {persistenceController.missingSources.length > 0 ? (
        <div className="app-notification warning" role="alert" data-testid="video-missing-source-warning">
          <div className="app-notification-main">
            <strong className="app-notification-label">Missing Source Files</strong>
            <span>Re-link missing media files before rendering.</span>
          </div>
          <ul className="video-render-issues">
            {persistenceController.missingSources.map((source) => (
              <li key={`${source.kind}-${source.fileName}`}>
                {source.kind === "image" ? "Image" : "Audio"}: {source.fileName || "Unknown file"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}


      {projectState.importIssues.length > 0 ? (
        <div className="app-notification warning" role="alert">
          <div className="app-notification-main">
            <strong className="app-notification-label">Import Issue</strong>
            <span>{projectState.importIssues[0].message}</span>
          </div>
          <button
            type="button"
            className="app-notification-dismiss"
            onClick={clearImportIssues}
            aria-label="Dismiss import issue"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="video-workspace-sections" role="list" aria-label="Video rendering sections">
        {VIDEO_WORKSPACE_SECTIONS.map((section) => {
          if (section.id === "media") {
            return (
              <section key={section.id} role="region" aria-label={section.label} className="placeholder-workspace">
                <h4>{section.label}</h4>
                <p>{section.description}</p>

                <input
                  ref={imageInputRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                  onChange={handleImageInputChange}
                  className="video-file-input"
                  aria-label="Image file dialog"
                />
                <input
                  ref={audioInputRef}
                  type="file"
                  accept=".wav,audio/wav,audio/x-wav"
                  onChange={handleAudioInputChange}
                  className="video-file-input"
                  aria-label="Audio file dialog"
                />

                <div className="video-media-grid">
                  <MediaAssetSummary
                    kind="image"
                    asset={projectState.imageAsset}
                    onChooseFile={() => imageInputRef.current?.click()}
                    onChooseNativeFile={() => {
                      void handleNativeFilePick("image");
                    }}
                    showRelinkPrompt={missingImageSource}
                    onClear={clearImage}
                    dropHint="Drop a JPG or PNG image file here"
                    dropLabel="Drop image file"
                    onDrop={handleImageDrop}
                    onDragOver={handleDragOver}
                  />
                  <MediaAssetSummary
                    kind="audio"
                    asset={projectState.audioAsset}
                    onChooseFile={() => audioInputRef.current?.click()}
                    onChooseNativeFile={() => {
                      void handleNativeFilePick("audio");
                    }}
                    showRelinkPrompt={missingAudioSource}
                    onClear={clearAudio}
                    dropHint="Drop a WAV audio file here"
                    dropLabel="Drop audio file"
                    onDrop={handleAudioDrop}
                    onDragOver={handleDragOver}
                  />
                </div>

                <p className="helper-text" aria-label="Project media readiness">
                  {projectState.imageAsset && projectState.audioAsset
                    ? "Project media is ready for static composition in the preview stage."
                    : "Select one image and one WAV audio file to complete media setup."}
                </p>
              </section>
            );
          }

          if (section.id === "visual") {
            return (
              <section key={section.id} role="region" aria-label={section.label} className="placeholder-workspace">
                <h4>{section.label}</h4>
                <p>{section.description}</p>

                <fieldset className="video-fit-mode-group" aria-label="Image fit mode controls">
                  <legend>Image fit mode</legend>
                  {VIDEO_PREVIEW_FIT_MODE_OPTIONS.map((option) => (
                    <label key={option.mode} className="video-fit-option">
                      <input
                        type="radio"
                        name="video-image-fit-mode"
                        value={option.mode}
                        checked={previewController.fitMode === option.mode}
                        onChange={() => previewController.setFitMode(option.mode)}
                      />
                      <span>
                        <strong>{option.label}</strong>
                        <small>{option.description}</small>
                      </span>
                    </label>
                  ))}
                </fieldset>

                <div className="video-overlay-controls">
                  <label className="video-overlay-row checkbox-row">
                    <input
                      type="checkbox"
                      checked={overlayController.settings.enabled}
                      onChange={(event) => {
                        overlayController.setEnabled(event.currentTarget.checked);
                      }}
                      aria-label="Enable reactive overlay"
                    />
                    <span>Enable reactive overlay</span>
                  </label>

                  <label className="video-overlay-row">
                    <span>Overlay position</span>
                    <select
                      value={overlayController.settings.position}
                      onChange={(event) => {
                        if (!overlayController.settings.enabled) {
                          overlayController.setEnabled(true);
                        }
                        overlayController.setPosition(event.currentTarget.value as "top" | "bottom");
                      }}
                      aria-label="Overlay position"
                    >
                      <option value="bottom">Bottom</option>
                      <option value="top">Top</option>
                    </select>
                  </label>

                  <label className="video-overlay-row">
                    <span>Overlay opacity</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={overlayController.settings.opacity}
                      onChange={(event) => {
                        if (!overlayController.settings.enabled) {
                          overlayController.setEnabled(true);
                        }
                        overlayController.setOpacity(Number(event.currentTarget.value));
                      }}
                      aria-label="Overlay opacity"
                    />
                  </label>

                  <label className="video-overlay-row">
                    <span>Overlay intensity</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={overlayController.settings.intensity}
                      onChange={(event) => {
                        if (!overlayController.settings.enabled) {
                          overlayController.setEnabled(true);
                        }
                        overlayController.setIntensity(Number(event.currentTarget.value));
                      }}
                      aria-label="Overlay intensity"
                    />
                  </label>

                  <label className="video-overlay-row">
                    <span>Overlay smoothing</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={overlayController.settings.smoothing}
                      onChange={(event) => {
                        if (!overlayController.settings.enabled) {
                          overlayController.setEnabled(true);
                        }
                        overlayController.setSmoothing(Number(event.currentTarget.value));
                      }}
                      aria-label="Overlay smoothing"
                    />
                  </label>

                  <label className="video-overlay-row">
                    <span>Overlay size ({overlayController.settings.sizePercent}%)</span>
                    <input
                      type="range"
                      min={0}
                      max={200}
                      step={1}
                      value={overlayController.settings.sizePercent}
                      onChange={(event) => {
                        if (!overlayController.settings.enabled) {
                          overlayController.setEnabled(true);
                        }
                        overlayController.setSizePercent(Number(event.currentTarget.value));
                      }}
                      aria-label="Overlay size"
                    />
                  </label>

                  <label className="video-overlay-row">
                    <span>Overlay color</span>
                    <input
                      type="color"
                      value={overlayController.settings.themeColorHex}
                      onChange={(event) => {
                        if (!overlayController.settings.enabled) {
                          overlayController.setEnabled(true);
                        }
                        overlayController.setThemeColorHex(event.currentTarget.value);
                      }}
                      aria-label="Overlay color"
                    />
                  </label>

                  <p className="helper-text" data-testid="video-overlay-status">
                    Overlay analysis: {overlayStateLabel}
                  </p>
                  {overlayController.analysis.errorMessage ? (
                    <p className="helper-text" role="alert">
                      {overlayController.analysis.errorMessage}
                    </p>
                  ) : null}
                </div>
              </section>
            );
          }

          if (section.id === "text") {
            return (
              <section key={section.id} role="region" aria-label={section.label} className="placeholder-workspace">
                <h4>{section.label}</h4>
                <p>{section.description}</p>

                <div className="video-text-controls">
                  <label className="video-text-row checkbox-row">
                    <input
                      type="checkbox"
                      checked={textSettingsController.state.enabled}
                      onChange={(event) => {
                        textSettingsController.setEnabled(event.currentTarget.checked);
                      }}
                      aria-label="Enable text layer"
                    />
                    <span>Enable text layer</span>
                  </label>

                  <label className="video-text-row">
                    <span>Text layout preset</span>
                    <select
                      value={textSettingsController.state.preset}
                      onChange={(event) => {
                        const nextPreset = event.currentTarget.value as typeof textSettingsController.state.preset;
                        textSettingsController.setPreset(nextPreset);
                        if (nextPreset !== "none" && !textSettingsController.state.enabled) {
                          textSettingsController.setEnabled(true);
                        }
                      }}
                      aria-label="Text layout preset"
                    >
                      {VIDEO_TEXT_LAYOUT_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="video-text-row">
                    <span>Title text</span>
                    <input
                      type="text"
                      value={textSettingsController.state.titleText}
                      onChange={(event) => {
                        const nextValue = event.currentTarget.value;
                        textSettingsController.setTitleText(nextValue);
                        if (nextValue.trim().length > 0 && !textSettingsController.state.enabled) {
                          textSettingsController.setEnabled(true);
                        }
                      }}
                      maxLength={VIDEO_WORKSPACE_TEXT_BOUNDS.titleMaxLength}
                      aria-label="Title text"
                      placeholder="Optional title"
                    />
                  </label>

                  <label className="video-text-row">
                    <span>Artist text</span>
                    <input
                      type="text"
                      value={textSettingsController.state.artistText}
                      onChange={(event) => {
                        const nextValue = event.currentTarget.value;
                        textSettingsController.setArtistText(nextValue);
                        if (nextValue.trim().length > 0 && !textSettingsController.state.enabled) {
                          textSettingsController.setEnabled(true);
                        }
                      }}
                      maxLength={VIDEO_WORKSPACE_TEXT_BOUNDS.artistMaxLength}
                      aria-label="Artist text"
                      placeholder="Optional artist"
                    />
                  </label>
                  {!activeTextLayoutPreset.supportsArtist ? (
                    <p className="helper-text">
                      This layout hides artist text. Switch to a "Title + Artist" preset to display it.
                    </p>
                  ) : null}

                  <label className="video-text-row">
                    <span>Text size</span>
                    <input
                      type="range"
                      min={VIDEO_WORKSPACE_TEXT_BOUNDS.minFontSizePx}
                      max={VIDEO_WORKSPACE_TEXT_BOUNDS.maxFontSizePx}
                      step={1}
                      value={textSettingsController.state.fontSizePx}
                      onChange={(event) => {
                        textSettingsController.setFontSizePx(Number(event.currentTarget.value));
                      }}
                      aria-label="Text size"
                    />
                  </label>

                  <label className="video-text-row">
                    <span>Text color</span>
                    <input
                      type="color"
                      value={textSettingsController.state.colorHex}
                      onChange={(event) => {
                        textSettingsController.setColorHex(event.currentTarget.value);
                      }}
                      aria-label="Text color"
                    />
                  </label>

                  <div className="video-text-actions">
                    <button
                      type="button"
                      onClick={textSettingsController.reset}
                      aria-label="Reset text settings"
                    >
                      Reset Text
                    </button>
                    <span className="helper-text" aria-label="Title character count">
                      Title: {textSettingsController.state.titleText.length}/{VIDEO_WORKSPACE_TEXT_BOUNDS.titleMaxLength}
                    </span>
                  </div>
                </div>

                {textSettingsController.issues.length > 0 ? (
                  <div className="app-notification warning" role="alert">
                    <div className="app-notification-main">
                      <strong className="app-notification-label">Text Settings Issue</strong>
                      <span>{textSettingsController.issues[0].message}</span>
                    </div>
                  </div>
                ) : null}
              </section>
            );
          }

          if (section.id === "output") {
            return (
              <section key={section.id} role="region" aria-label={section.label} className="placeholder-workspace">
                <h4>{section.label}</h4>
                <p>{section.description}</p>

                <div className="video-output-controls">
                  <label className="video-output-row">
                    <span>Output preset</span>
                    <select
                      value={outputSettingsController.state.presetId}
                      onChange={(event) => {
                        outputSettingsController.setPresetId(event.currentTarget.value as typeof outputSettingsController.state.presetId);
                      }}
                      aria-label="Output preset"
                    >
                      {outputSettingsController.availablePresets.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <p className="helper-text" data-testid="video-output-preset-summary">
                    {outputSettingsController.selectedPreset.widthPx} x {outputSettingsController.selectedPreset.heightPx} @ {outputSettingsController.selectedPreset.frameRate}fps | {outputSettingsController.selectedPreset.videoCodec.toUpperCase()} / {outputSettingsController.selectedPreset.audioCodec.toUpperCase()}
                  </p>

                  <label className="video-output-row">
                    <span>Output directory</span>
                    <input
                      type="text"
                      value={outputSettingsController.state.outputDirectoryPath}
                      onChange={(event) => {
                        outputSettingsController.setOutputDirectoryPath(event.currentTarget.value);
                      }}
                      aria-label="Output directory"
                      placeholder="C:\\Exports"
                    />
                  </label>

                  {persistenceController.recentOutputDirectories.length > 0 ? (
                    <label className="video-output-row">
                      <span>Recent output folders</span>
                      <select
                        value=""
                        onChange={(event) => {
                          const nextPath = event.currentTarget.value;
                          if (nextPath.trim().length === 0) return;
                          outputSettingsController.setOutputDirectoryPath(nextPath);
                        }}
                        aria-label="Recent output directories"
                      >
                        <option value="">Select recent folder</option>
                        {persistenceController.recentOutputDirectories.map((directoryPath) => (
                          <option key={directoryPath} value={directoryPath}>
                            {directoryPath}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  <label className="video-output-row">
                    <span>Output file name</span>
                    <input
                      type="text"
                      value={outputSettingsController.state.outputBaseFileName}
                      onChange={(event) => {
                        outputSettingsController.setOutputBaseFileName(event.currentTarget.value);
                      }}
                      aria-label="Output file name"
                      placeholder="video-export"
                    />
                  </label>

                  <label className="video-output-row">
                    <span>Overwrite policy</span>
                    <select
                      value={outputSettingsController.state.overwritePolicy}
                      onChange={(event) => {
                        outputSettingsController.setOverwritePolicy(event.currentTarget.value as "disallow" | "replace");
                      }}
                      aria-label="Overwrite policy"
                    >
                      <option value="disallow">Do not overwrite</option>
                      <option value="replace">Replace existing file</option>
                    </select>
                  </label>

                  <p className="helper-text" data-testid="video-output-file-preview">
                    Output file preview: {outputSettingsController.outputFilePreviewPath}
                  </p>

                  {outputSettingsController.issues.length > 0 && (
                    outputSettingsController.state.outputDirectoryPath.trim().length > 0 ||
                    renderController.state.phase === "preflight_invalid" ||
                    renderController.state.phase === "failed"
                  ) ? (
                    <p className="helper-text" role="alert">
                      {outputSettingsController.issues[0].message}
                    </p>
                  ) : null}
                </div>
              </section>
            );
          }

          if (section.id === "preview") {
            return (
              <section key={section.id} role="region" aria-label={section.label} className="placeholder-workspace">
                <h4>{section.label}</h4>
                <p>{section.description}</p>

                <div
                  className={`video-preview-frame${previewController.fitPresentation.showsBars ? " with-bars" : ""}`}
                  data-testid="video-preview-frame"
                  data-fit-mode={previewController.fitMode}
                  data-object-fit={previewController.fitPresentation.cssObjectFit}
                >
                  {previewController.imagePreviewUrl ? (
                    <img
                      src={previewController.imagePreviewUrl}
                      alt="Video preview artwork"
                      data-testid="video-preview-image"
                      style={{ objectFit: previewController.fitPresentation.cssObjectFit }}
                    />
                  ) : (
                    <p className="helper-text">Import an image to see the composition preview.</p>
                  )}

                  {overlayController.settings.enabled ? (
                    <div
                      className={`video-overlay-waveform position-${overlayController.settings.position}`}
                      data-testid="video-overlay-waveform"
                      data-overlay-status={overlayController.analysis.status}
                      data-overlay-position={overlayController.settings.position}
                      data-overlay-opacity={overlayController.settings.opacity.toFixed(2)}
                      data-overlay-intensity={overlayController.settings.intensity.toFixed(2)}
                      data-overlay-smoothing={overlayController.settings.smoothing.toFixed(2)}
                      data-overlay-size={overlayController.settings.sizePercent.toString()}
                      data-overlay-preview-mode="static"
                      style={{ height: `${overlayPreviewHeightPercent}%` }}
                    >
                      {overlayController.bars.map((bar, index) => (
                        <span
                          key={`overlay-bar-${index}`}
                          className="video-overlay-bar"
                          style={{
                            height: `${Math.max(1, Math.round(bar * 100))}%`,
                            backgroundColor: overlayController.settings.themeColorHex,
                            opacity: overlayController.settings.opacity
                          }}
                        />
                      ))}
                    </div>
                  ) : null}

                  {shouldRenderTextOverlay ? (
                    <div
                      className={`video-preview-text-overlay ${activeTextLayoutPreset.overlayClassName}`}
                      style={{
                        color: textSettingsController.state.colorHex,
                        fontSize: `${textSettingsController.state.fontSizePx}px`
                      }}
                      data-testid="video-preview-text-overlay"
                      data-layout-preset={activeTextLayoutPreset.id}
                    >
                      {trimmedTitleText.length > 0 ? (
                        <p className="video-preview-text-title" data-testid="video-preview-text-title">
                          {trimmedTitleText}
                        </p>
                      ) : null}
                      {activeTextLayoutPreset.supportsArtist && trimmedArtistText.length > 0 ? (
                        <p className="video-preview-text-artist" data-testid="video-preview-text-artist">
                          {trimmedArtistText}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <audio
                  ref={previewController.bindAudioElement}
                  src={previewController.audioPreviewUrl ?? undefined}
                  preload="metadata"
                  onLoadedMetadata={previewController.handleAudioLoadedMetadata}
                  onTimeUpdate={previewController.handleAudioTimeUpdate}
                  onEnded={previewController.handleAudioEnded}
                  onError={previewController.handleAudioError}
                  data-testid="video-preview-audio-element"
                />

                <div className="video-preview-controls" aria-label="Preview transport controls">
                  <button
                    type="button"
                    onClick={handlePreviewTogglePlay}
                    disabled={!previewController.canControlPlayback}
                  >
                    {previewController.state.playbackState === "playing" ? "Pause" : "Play"}
                  </button>
                  <button
                    type="button"
                    onClick={handlePreviewRestart}
                    disabled={!previewController.canControlPlayback}
                  >
                    Restart
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.001}
                    value={previewProgressRatio}
                    onChange={(event) => {
                      previewController.seekToRatio(Number(event.currentTarget.value));
                    }}
                    aria-label="Preview position"
                    disabled={!previewController.canControlPlayback}
                  />
                </div>

                <p className="helper-text" data-testid="video-preview-status">
                  Playback: {previewStateLabel}
                </p>
                <p className="helper-text" aria-label="Preview progress">
                  {formatClockSeconds(previewController.state.positionSeconds)} / {formatClockSeconds(previewController.state.durationSeconds)}
                </p>
                {previewController.state.errorMessage ? (
                  <p className="helper-text" role="alert">
                    {previewController.state.errorMessage}
                  </p>
                ) : null}
                <p className="helper-text" data-testid="video-preview-readiness">
                  {previewController.hasMediaReady
                    ? "Preview is ready for static image + audio review."
                    : "Import both image and audio to unlock full preview behavior."}
                </p>
              </section>
            );
          }

          if (section.id === "render") {
            const requestJson = renderController.state.request
              ? toVideoRenderRequestJson(renderController.state.request)
              : "";
            const progressPercent =
              renderController.state.progress?.percent !== undefined
                ? Math.round(renderController.state.progress.percent)
                : 0;
            const phaseLabel =
              renderController.state.phase === "preflight_invalid"
                ? "Preflight invalid"
                : renderController.state.phase.charAt(0).toUpperCase() +
                  renderController.state.phase.slice(1);

            return (
              <section key={section.id} role="region" aria-label={section.label} className="placeholder-workspace">
                <h4>{section.label}</h4>
                <p>{section.description}</p>

                <div className="video-render-panel">
                  <div className="video-render-actions">
                    <button
                      type="button"
                      onClick={handleBuildRenderRequest}
                      aria-label="Build render request"
                      disabled={renderController.isBusy}
                    >
                      Build Render Request
                    </button>
                    <button
                      type="button"
                      onClick={handleRefreshDiagnostics}
                      aria-label="Refresh render diagnostics"
                      disabled={renderController.isBusy}
                    >
                      Refresh Diagnostics
                    </button>
                    <button
                      type="button"
                      onClick={handleRenderMp4}
                      aria-label="Render MP4"
                      disabled={!renderController.canStartRender}
                    >
                      Render MP4
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelRender}
                      aria-label="Cancel render"
                      disabled={!renderController.canCancelRender}
                    >
                      Cancel Render
                    </button>
                    <button
                      type="button"
                      onClick={handleResetRenderState}
                      aria-label="Reset render state"
                      disabled={renderController.isBusy}
                    >
                      Reset
                    </button>
                  </div>

                  <p className="helper-text" data-testid="video-render-runtime-status">
                    Render status: {phaseLabel}
                    {renderController.state.progress ? ` (${progressPercent}%)` : ""}
                  </p>

                  <p className="helper-text" data-testid="video-render-diagnostics-status">
                    Diagnostics: {renderController.state.diagnostics?.renderCapable ? "Ready" : "Pending or blocked"}
                  </p>

                  {renderController.state.diagnosticsErrorMessage ? (
                    <p className="helper-text" role="alert" data-testid="video-render-diagnostics-error">
                      {renderController.state.diagnosticsErrorMessage}
                    </p>
                  ) : null}


                  {renderController.state.phase === "idle" ? (
                    <p className="helper-text">
                      Build a render request or start rendering directly. Render start runs preflight validation automatically.
                    </p>
                  ) : null}

                  {renderController.state.preflightIssues.length > 0 ? (
                    <>
                      <p className="helper-text" role="alert">
                        Render preflight failed. Resolve the issues below.
                      </p>
                      <ul data-testid="video-render-preflight-issues" className="video-render-issues">
                        {renderController.state.preflightIssues.map((issue, index) => (
                          <li key={`${issue.code}-${index}`}>{issue.message}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}

                  {renderController.state.errorMessage ? (
                    <p className="helper-text" role="alert" data-testid="video-render-error">
                      {renderController.state.errorMessage}
                    </p>
                  ) : null}

                  {renderController.state.result?.success ? (
                    <div className="video-render-summary" data-testid="video-render-success-summary">
                      <p>
                        <strong>Output:</strong> {renderController.state.result.success.outputPath}
                      </p>
                      <p>
                        <strong>Size:</strong> {formatFileSize(renderController.state.result.success.fileSizeBytes)}
                      </p>
                      <button
                        type="button"
                        onClick={handleOpenOutputFolder}
                        aria-label="Open output folder"
                        disabled={!renderController.canOpenOutputFolder}
                      >
                        Open Output Folder
                      </button>
                    </div>
                  ) : null}

                  {renderController.state.openOutputFolderMessage ? (
                    <p className="helper-text" data-testid="video-open-output-folder-status">
                      {renderController.state.openOutputFolderMessage}
                    </p>
                  ) : null}

                  {renderController.state.request ? (
                    <>
                      <div className="video-render-summary" data-testid="video-render-request-summary">
                        <p>
                          <strong>Request:</strong> {renderController.state.request.requestId}
                        </p>
                        <p>
                          <strong>Output:</strong> {renderController.state.request.output.outputFilePath}
                        </p>
                      </div>
                      <pre className="video-render-request-json" data-testid="video-render-request-json">
                        {requestJson}
                      </pre>
                    </>
                  ) : null}
                </div>
              </section>
            );
          }

          return (
            <section key={section.id} role="region" aria-label={section.label} className="placeholder-workspace">
              <h4>{section.label}</h4>
              <p>{section.description}</p>
              <p className="helper-text">This section remains intentionally static until its planned stage.</p>
            </section>
          );
        })}
      </div>
    </div>
  );
}


