import { useCallback, useMemo, useState } from "react";

import {
  createEmptyVideoWorkspaceProjectState,
  fromVideoWorkspaceProjectSnapshot,
  toVideoWorkspaceMediaAsset,
  toVideoWorkspaceMediaAssetFromNativePath,
  toVideoWorkspaceProjectSnapshot,
  type VideoImportSource,
  type VideoMediaKind,
  type VideoWorkspaceImportIssue,
  type VideoWorkspaceProjectSnapshot,
  type VideoWorkspaceProjectState,
  validateMediaAssetKind
} from "../model/videoWorkspaceProjectState";

type FileListLike = FileList | File[] | null;

function firstFileFromList(files: FileListLike): File | null {
  if (!files || files.length === 0) return null;
  if (typeof (files as FileList).item === "function") {
    return (files as FileList).item(0);
  }
  return files[0] ?? null;
}

export type VideoWorkspaceMediaFiles = {
  imageFile: File | null;
  audioFile: File | null;
};

type VideoWorkspaceRuntimeState = {
  projectState: VideoWorkspaceProjectState;
  mediaFiles: VideoWorkspaceMediaFiles;
};

function createInitialRuntimeState(): VideoWorkspaceRuntimeState {
  return {
    projectState: createEmptyVideoWorkspaceProjectState(),
    mediaFiles: {
      imageFile: null,
      audioFile: null
    }
  };
}

export type VideoWorkspaceProjectController = {
  projectState: VideoWorkspaceProjectState;
  mediaFiles: VideoWorkspaceMediaFiles;
  importImageFromFile: (file: File, source: VideoImportSource) => void;
  importAudioFromFile: (file: File, source: VideoImportSource) => void;
  importImageFromFileWithSourcePath: (file: File, sourcePath: string, source: VideoImportSource) => void;
  importAudioFromFileWithSourcePath: (file: File, sourcePath: string, source: VideoImportSource) => void;
  importImageFromNativePath: (sourcePath: string, source: VideoImportSource) => void;
  importAudioFromNativePath: (sourcePath: string, source: VideoImportSource) => void;
  importImageFromFileList: (files: FileListLike, source: VideoImportSource) => void;
  importAudioFromFileList: (files: FileListLike, source: VideoImportSource) => void;
  clearImage: () => void;
  clearAudio: () => void;
  clearImportIssues: () => void;
  setImportIssue: (issue: VideoWorkspaceImportIssue) => void;
  replaceFromSnapshot: (snapshot: unknown) => void;
  resetProjectState: () => void;
  createSnapshot: () => VideoWorkspaceProjectSnapshot;
};

export function useVideoWorkspaceProjectState(): VideoWorkspaceProjectController {
  const [runtimeState, setRuntimeState] = useState<VideoWorkspaceRuntimeState>(() =>
    createInitialRuntimeState()
  );

  const applyImport = useCallback(
    (
      file: File,
      expectedKind: VideoMediaKind,
      source: VideoImportSource,
      sourcePathOverride?: string | null
    ) => {
    const result = toVideoWorkspaceMediaAsset(file, source, sourcePathOverride);
    setRuntimeState((current) => {
      if (!result.ok) {
        return {
          ...current,
          projectState: {
            ...current.projectState,
            importIssues: [result.issue]
          }
        };
      }

      const kindIssue = validateMediaAssetKind(result.asset, expectedKind);
      if (kindIssue) {
        return {
          ...current,
          projectState: {
            ...current.projectState,
            importIssues: [kindIssue]
          }
        };
      }

      return {
        projectState: {
          imageAsset: expectedKind === "image" ? result.asset : current.projectState.imageAsset,
          audioAsset: expectedKind === "audio" ? result.asset : current.projectState.audioAsset,
          importIssues: []
        },
        mediaFiles: {
          imageFile: expectedKind === "image" ? file : current.mediaFiles.imageFile,
          audioFile: expectedKind === "audio" ? file : current.mediaFiles.audioFile
        }
      };
    });
  }, []);

  const applyNativePathImport = useCallback(
    (sourcePath: string, expectedKind: VideoMediaKind, source: VideoImportSource) => {
      const result = toVideoWorkspaceMediaAssetFromNativePath(sourcePath, source);
      setRuntimeState((current) => {
        if (!result.ok) {
          return {
            ...current,
            projectState: {
              ...current.projectState,
              importIssues: [result.issue]
            }
          };
        }

        const kindIssue = validateMediaAssetKind(result.asset, expectedKind);
        if (kindIssue) {
          return {
            ...current,
            projectState: {
              ...current.projectState,
              importIssues: [kindIssue]
            }
          };
        }

        return {
          projectState: {
            imageAsset: expectedKind === "image" ? result.asset : current.projectState.imageAsset,
            audioAsset: expectedKind === "audio" ? result.asset : current.projectState.audioAsset,
            importIssues: []
          },
          mediaFiles: {
            imageFile: expectedKind === "image" ? null : current.mediaFiles.imageFile,
            audioFile: expectedKind === "audio" ? null : current.mediaFiles.audioFile
          }
        };
      });
    },
    []
  );

  const importImageFromFile = useCallback(
    (file: File, source: VideoImportSource) => {
      applyImport(file, "image", source);
    },
    [applyImport]
  );

  const importAudioFromFile = useCallback(
    (file: File, source: VideoImportSource) => {
      applyImport(file, "audio", source);
    },
    [applyImport]
  );

  const importImageFromFileWithSourcePath = useCallback(
    (file: File, sourcePath: string, source: VideoImportSource) => {
      applyImport(file, "image", source, sourcePath);
    },
    [applyImport]
  );

  const importAudioFromFileWithSourcePath = useCallback(
    (file: File, sourcePath: string, source: VideoImportSource) => {
      applyImport(file, "audio", source, sourcePath);
    },
    [applyImport]
  );

  const importImageFromNativePath = useCallback(
    (sourcePath: string, source: VideoImportSource) => {
      applyNativePathImport(sourcePath, "image", source);
    },
    [applyNativePathImport]
  );

  const importAudioFromNativePath = useCallback(
    (sourcePath: string, source: VideoImportSource) => {
      applyNativePathImport(sourcePath, "audio", source);
    },
    [applyNativePathImport]
  );

  const importFromFileList = useCallback(
    (
      files: FileListLike,
      expectedKind: VideoMediaKind,
      source: VideoImportSource,
      setIssue: (issue: VideoWorkspaceImportIssue) => void
    ) => {
      const file = firstFileFromList(files);
      if (!file) {
        setIssue({
          code: expectedKind === "image" ? "INVALID_IMAGE_FILE" : "INVALID_AUDIO_FILE",
          fileName: "",
          message:
            expectedKind === "image"
              ? "No image file was selected. Choose a JPG or PNG file."
              : "No audio file was selected. Choose a WAV file."
        });
        return;
      }

      if (expectedKind === "image") {
        importImageFromFile(file, source);
        return;
      }
      importAudioFromFile(file, source);
    },
    [importAudioFromFile, importImageFromFile]
  );

  const importImageFromFileList = useCallback(
    (files: FileListLike, source: VideoImportSource) => {
      importFromFileList(files, "image", source, (issue) => {
        setRuntimeState((current) => ({
          ...current,
          projectState: {
            ...current.projectState,
            importIssues: [issue]
          }
        }));
      });
    },
    [importFromFileList]
  );

  const importAudioFromFileList = useCallback(
    (files: FileListLike, source: VideoImportSource) => {
      importFromFileList(files, "audio", source, (issue) => {
        setRuntimeState((current) => ({
          ...current,
          projectState: {
            ...current.projectState,
            importIssues: [issue]
          }
        }));
      });
    },
    [importFromFileList]
  );

  const clearImage = useCallback(() => {
    setRuntimeState((current) => ({
      ...current,
      projectState: {
        ...current.projectState,
        imageAsset: null,
        importIssues: []
      },
      mediaFiles: {
        ...current.mediaFiles,
        imageFile: null
      }
    }));
  }, []);

  const clearAudio = useCallback(() => {
    setRuntimeState((current) => ({
      ...current,
      projectState: {
        ...current.projectState,
        audioAsset: null,
        importIssues: []
      },
      mediaFiles: {
        ...current.mediaFiles,
        audioFile: null
      }
    }));
  }, []);

  const clearImportIssues = useCallback(() => {
    setRuntimeState((current) => ({
      ...current,
      projectState: {
        ...current.projectState,
        importIssues: []
      }
    }));
  }, []);

  const setImportIssue = useCallback((issue: VideoWorkspaceImportIssue) => {
    setRuntimeState((current) => ({
      ...current,
      projectState: {
        ...current.projectState,
        importIssues: [issue]
      }
    }));
  }, []);

  const replaceFromSnapshot = useCallback((snapshot: unknown) => {
    const nextProjectState = fromVideoWorkspaceProjectSnapshot(snapshot);
    setRuntimeState({
      projectState: nextProjectState,
      mediaFiles: {
        imageFile: null,
        audioFile: null
      }
    });
  }, []);

  const resetProjectState = useCallback(() => {
    setRuntimeState(createInitialRuntimeState());
  }, []);

  const createSnapshot = useCallback(() => {
    return toVideoWorkspaceProjectSnapshot(runtimeState.projectState);
  }, [runtimeState.projectState]);

  return useMemo(
    () => ({
      projectState: runtimeState.projectState,
      mediaFiles: runtimeState.mediaFiles,
      importImageFromFile,
      importAudioFromFile,
      importImageFromFileWithSourcePath,
      importAudioFromFileWithSourcePath,
      importImageFromNativePath,
      importAudioFromNativePath,
      importImageFromFileList,
      importAudioFromFileList,
      clearImage,
      clearAudio,
      clearImportIssues,
      setImportIssue,
      replaceFromSnapshot,
      resetProjectState,
      createSnapshot
    }),
    [
      clearAudio,
      clearImage,
      clearImportIssues,
      createSnapshot,
      importAudioFromFile,
      importAudioFromFileList,
      importAudioFromFileWithSourcePath,
      importAudioFromNativePath,
      importImageFromFile,
      importImageFromFileList,
      importImageFromFileWithSourcePath,
      importImageFromNativePath,
      replaceFromSnapshot,
      resetProjectState,
      runtimeState.mediaFiles,
      runtimeState.projectState,
      setImportIssue
    ]
  );
}






