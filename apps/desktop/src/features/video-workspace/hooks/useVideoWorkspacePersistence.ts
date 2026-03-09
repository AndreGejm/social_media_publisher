import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { videoRenderCheckSourcePath } from "../../../services/tauri/tauriClient";
import type { VideoMediaKind, VideoWorkspaceProjectSnapshot } from "../model/videoWorkspaceProjectState";
import type { VideoWorkspaceTextSettings } from "../model/videoWorkspaceTextSettings";
import type { VideoOverlaySettings } from "../../overlay-engine/api";
import type { VideoPreviewFitMode } from "../../video-composition/api";
import type { VideoOutputSettings } from "../model/videoOutputSettings";
import {
  createVideoWorkspacePreferencesDocument,
  createVideoWorkspacePresetDocument,
  createVideoWorkspaceProjectDocument,
  parseVideoWorkspacePreferencesDocument,
  parseVideoWorkspacePresetDocument,
  parseVideoWorkspaceProjectDocument,
  pushRecentOutputDirectory,
  VIDEO_WORKSPACE_STORAGE_KEYS
} from "../model/videoWorkspacePersistence";

type VideoWorkspaceProjectPersistencePort = {
  createSnapshot: () => VideoWorkspaceProjectSnapshot;
  replaceFromSnapshot: (snapshot: unknown) => void;
};

type VideoWorkspaceTextPersistencePort = {
  state: VideoWorkspaceTextSettings;
  replaceState: (nextState: VideoWorkspaceTextSettings) => void;
};

type VideoWorkspaceOverlayPersistencePort = {
  settings: VideoOverlaySettings;
  replaceSettings: (nextSettings: VideoOverlaySettings) => void;
};

type VideoWorkspaceOutputPersistencePort = {
  state: VideoOutputSettings;
  replaceState: (nextState: VideoOutputSettings) => void;
};

export type VideoWorkspacePersistenceStatusKind = "idle" | "success" | "error";

export type VideoWorkspaceMissingSource = {
  kind: VideoMediaKind;
  fileName: string;
  sourcePath: string | null;
};

export type VideoWorkspacePersistenceController = {
  hasSavedProject: boolean;
  hasSavedPreset: boolean;
  recentOutputDirectories: readonly string[];
  missingSources: readonly VideoWorkspaceMissingSource[];
  statusKind: VideoWorkspacePersistenceStatusKind;
  statusMessage: string | null;
  saveProject: () => void;
  loadProject: () => Promise<void>;
  savePreset: () => void;
  loadPreset: () => void;
  clearMissingSource: (kind: VideoMediaKind) => void;
  clearStatus: () => void;
};

export type UseVideoWorkspacePersistenceArgs = {
  project: VideoWorkspaceProjectPersistencePort;
  fitMode: VideoPreviewFitMode;
  setFitMode: (mode: VideoPreviewFitMode) => void;
  text: VideoWorkspaceTextPersistencePort;
  overlay: VideoWorkspaceOverlayPersistencePort;
  output: VideoWorkspaceOutputPersistencePort;
  resetRenderState: () => void;
};

function readStorageJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function writeStorageJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // best-effort persistence only
  }
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function collectMissingSourcePaths(
  snapshot: VideoWorkspaceProjectSnapshot
): Promise<VideoWorkspaceMissingSource[]> {
  const candidates: VideoWorkspaceMissingSource[] = [];

  if (snapshot.imageAsset) {
    candidates.push({
      kind: "image",
      fileName: snapshot.imageAsset.fileName,
      sourcePath: snapshot.imageAsset.sourcePath
    });
  }

  if (snapshot.audioAsset) {
    candidates.push({
      kind: "audio",
      fileName: snapshot.audioAsset.fileName,
      sourcePath: snapshot.audioAsset.sourcePath
    });
  }

  const unresolved: VideoWorkspaceMissingSource[] = [];
  for (const candidate of candidates) {
    const sourcePath = candidate.sourcePath?.trim() ?? "";
    if (sourcePath.length === 0) {
      unresolved.push(candidate);
      continue;
    }

    try {
      const check = await videoRenderCheckSourcePath(sourcePath);
      if (!check.exists || !check.isFile) {
        unresolved.push(candidate);
      }
    } catch {
      unresolved.push(candidate);
    }
  }

  return unresolved;
}

export function useVideoWorkspacePersistence(
  args: UseVideoWorkspacePersistenceArgs
): VideoWorkspacePersistenceController {
  const [hasSavedProject, setHasSavedProject] = useState(false);
  const [hasSavedPreset, setHasSavedPreset] = useState(false);
  const [recentOutputDirectories, setRecentOutputDirectories] = useState<string[]>([]);
  const [missingSources, setMissingSources] = useState<VideoWorkspaceMissingSource[]>([]);
  const [statusKind, setStatusKind] = useState<VideoWorkspacePersistenceStatusKind>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current) return;

    const projectDocument = parseVideoWorkspaceProjectDocument(
      readStorageJson(VIDEO_WORKSPACE_STORAGE_KEYS.projectDocument)
    );
    const presetDocument = parseVideoWorkspacePresetDocument(
      readStorageJson(VIDEO_WORKSPACE_STORAGE_KEYS.presetDocument)
    );
    const preferencesDocument = parseVideoWorkspacePreferencesDocument(
      readStorageJson(VIDEO_WORKSPACE_STORAGE_KEYS.preferencesDocument)
    );

    setHasSavedProject(projectDocument !== null);
    setHasSavedPreset(presetDocument !== null);

    if (preferencesDocument) {
      setRecentOutputDirectories(preferencesDocument.recentOutputDirectories);
      args.output.replaceState({
        ...args.output.state,
        presetId: preferencesDocument.lastOutputPresetId,
        outputDirectoryPath:
          args.output.state.outputDirectoryPath.trim().length > 0
            ? args.output.state.outputDirectoryPath
            : preferencesDocument.recentOutputDirectories[0] ?? ""
      });
    }

    hydratedRef.current = true;
  }, [args.output]);

  useEffect(() => {
    if (!hydratedRef.current) return;

    const nextRecentOutputDirectories = pushRecentOutputDirectory(
      recentOutputDirectories,
      args.output.state.outputDirectoryPath
    );

    if (!arraysEqual(nextRecentOutputDirectories, recentOutputDirectories)) {
      setRecentOutputDirectories(nextRecentOutputDirectories);
    }

    writeStorageJson(
      VIDEO_WORKSPACE_STORAGE_KEYS.preferencesDocument,
      createVideoWorkspacePreferencesDocument({
        lastOutputPresetId: args.output.state.presetId,
        recentOutputDirectories: nextRecentOutputDirectories
      })
    );
  }, [args.output.state.outputDirectoryPath, args.output.state.presetId, recentOutputDirectories]);

  const clearStatus = useCallback(() => {
    setStatusKind("idle");
    setStatusMessage(null);
  }, []);

  const clearMissingSource = useCallback((kind: VideoMediaKind) => {
    setMissingSources((current) => current.filter((source) => source.kind !== kind));
  }, []);

  const saveProject = useCallback(() => {
    const document = createVideoWorkspaceProjectDocument({
      projectSnapshot: args.project.createSnapshot(),
      fitMode: args.fitMode,
      textSettings: args.text.state,
      overlaySettings: args.overlay.settings,
      outputSettings: args.output.state
    });

    writeStorageJson(VIDEO_WORKSPACE_STORAGE_KEYS.projectDocument, document);
    setHasSavedProject(true);
    setStatusKind("success");
    setStatusMessage("Project snapshot saved locally.");
  }, [args.fitMode, args.overlay.settings, args.output.state, args.project, args.text.state]);

  const loadProject = useCallback(async () => {
    const document = parseVideoWorkspaceProjectDocument(
      readStorageJson(VIDEO_WORKSPACE_STORAGE_KEYS.projectDocument)
    );

    if (!document) {
      setStatusKind("error");
      setStatusMessage("No valid saved project snapshot was found.");
      return;
    }

    args.project.replaceFromSnapshot(document.projectSnapshot);
    args.setFitMode(document.fitMode);
    args.text.replaceState(document.textSettings);
    args.overlay.replaceSettings(document.overlaySettings);
    args.output.replaceState(document.outputSettings);
    args.resetRenderState();

    const unresolved = await collectMissingSourcePaths(document.projectSnapshot);
    setMissingSources(unresolved);

    if (unresolved.length > 0) {
      setStatusKind("error");
      setStatusMessage(
        "Saved project loaded, but one or more source paths are missing. Re-link missing media before rendering."
      );
      return;
    }

    setStatusKind("success");
    setStatusMessage("Saved project snapshot loaded.");
  }, [args]);

  const savePreset = useCallback(() => {
    const document = createVideoWorkspacePresetDocument({
      fitMode: args.fitMode,
      textSettings: args.text.state,
      overlaySettings: args.overlay.settings,
      outputPresetId: args.output.state.presetId,
      overwritePolicy: args.output.state.overwritePolicy
    });

    writeStorageJson(VIDEO_WORKSPACE_STORAGE_KEYS.presetDocument, document);
    setHasSavedPreset(true);
    setStatusKind("success");
    setStatusMessage("Workspace preset saved locally.");
  }, [args.fitMode, args.overlay.settings, args.output.state, args.text.state]);

  const loadPreset = useCallback(() => {
    const document = parseVideoWorkspacePresetDocument(
      readStorageJson(VIDEO_WORKSPACE_STORAGE_KEYS.presetDocument)
    );

    if (!document) {
      setStatusKind("error");
      setStatusMessage("No valid saved preset was found.");
      return;
    }

    args.setFitMode(document.fitMode);
    args.text.replaceState(document.textSettings);
    args.overlay.replaceSettings(document.overlaySettings);
    args.output.replaceState({
      ...args.output.state,
      presetId: document.outputPresetId,
      overwritePolicy: document.overwritePolicy
    });
    args.resetRenderState();

    setStatusKind("success");
    setStatusMessage("Saved workspace preset loaded.");
  }, [args]);

  return useMemo(
    () => ({
      hasSavedProject,
      hasSavedPreset,
      recentOutputDirectories,
      missingSources,
      statusKind,
      statusMessage,
      saveProject,
      loadProject,
      savePreset,
      loadPreset,
      clearMissingSource,
      clearStatus
    }),
    [
      clearMissingSource,
      clearStatus,
      hasSavedPreset,
      hasSavedProject,
      loadPreset,
      loadProject,
      missingSources,
      recentOutputDirectories,
      savePreset,
      saveProject,
      statusKind,
      statusMessage
    ]
  );
}
