export type VideoImportSource = "file_dialog" | "drag_drop";

export type VideoMediaKind = "image" | "audio";

export type VideoWorkspaceMediaAsset = {
  kind: VideoMediaKind;
  fileName: string;
  sourcePath: string | null;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  lastModifiedMs: number;
  source: VideoImportSource;
};

export type VideoWorkspaceImportIssueCode =
  | "INVALID_IMAGE_FILE"
  | "INVALID_AUDIO_FILE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "SOURCE_PATH_READ_FAILED"
  | "SOURCE_PATH_MISSING";

export type VideoWorkspaceImportIssue = {
  code: VideoWorkspaceImportIssueCode;
  message: string;
  fileName: string;
};

export type VideoWorkspaceProjectState = {
  imageAsset: VideoWorkspaceMediaAsset | null;
  audioAsset: VideoWorkspaceMediaAsset | null;
  importIssues: VideoWorkspaceImportIssue[];
};

export type VideoWorkspaceProjectSnapshot = {
  schemaVersion: 1;
  imageAsset: VideoWorkspaceMediaAsset | null;
  audioAsset: VideoWorkspaceMediaAsset | null;
};

const SUPPORTED_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png"]);
const SUPPORTED_AUDIO_EXTENSIONS = new Set(["wav"]);

const FILE_SIZE_KB = 1024;
const FILE_SIZE_MB = FILE_SIZE_KB * 1024;

function normalizeExtension(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf(".");
  if (lastDotIndex < 0) return "";
  return fileName.slice(lastDotIndex + 1).trim().toLowerCase();
}

function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").trim();
  if (normalized.length === 0) return "";
  const pieces = normalized.split("/").filter((piece) => piece.length > 0);
  return pieces[pieces.length - 1] ?? "";
}

function normalizeSourcePath(sourcePath: string | null | undefined): string | null {
  if (typeof sourcePath !== "string") return null;
  const normalized = sourcePath.trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveFileSystemPath(file: File): string | null {
  const candidate = (file as File & { path?: unknown }).path;
  return normalizeSourcePath(typeof candidate === "string" ? candidate : null);
}

function inferMediaKindFromMime(mimeType: string): VideoMediaKind | null {
  const normalizedMime = mimeType.trim().toLowerCase();
  if (normalizedMime.startsWith("image/")) return "image";
  if (normalizedMime.startsWith("audio/")) return "audio";
  return null;
}

function inferMediaKindFromExtension(extension: string): VideoMediaKind | null {
  if (SUPPORTED_IMAGE_EXTENSIONS.has(extension)) return "image";
  if (SUPPORTED_AUDIO_EXTENSIONS.has(extension)) return "audio";
  return null;
}

function inferMediaKind(file: File): VideoMediaKind | null {
  const extension = normalizeExtension(file.name);
  const mimeKind = inferMediaKindFromMime(file.type);
  const extensionKind = inferMediaKindFromExtension(extension);

  if (!mimeKind) return extensionKind;
  if (!extensionKind) return mimeKind;
  return mimeKind === extensionKind ? mimeKind : null;
}

function mimeTypeFromExtension(kind: VideoMediaKind, extension: string): string {
  if (kind === "image") {
    if (extension === "png") return "image/png";
    return "image/jpeg";
  }

  return "audio/wav";
}

export function createEmptyVideoWorkspaceProjectState(): VideoWorkspaceProjectState {
  return {
    imageAsset: null,
    audioAsset: null,
    importIssues: []
  };
}

export function formatFileSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return "Unknown size";
  if (sizeBytes < FILE_SIZE_KB) return `${sizeBytes} B`;
  if (sizeBytes < FILE_SIZE_MB) return `${(sizeBytes / FILE_SIZE_KB).toFixed(1)} KB`;
  return `${(sizeBytes / FILE_SIZE_MB).toFixed(2)} MB`;
}

function createImportIssue(
  code: VideoWorkspaceImportIssueCode,
  fileName: string,
  message: string
): VideoWorkspaceImportIssue {
  return {
    code,
    fileName,
    message
  };
}

export function toVideoWorkspaceMediaAsset(
  file: File,
  source: VideoImportSource,
  sourcePathOverride?: string | null
):
  | { ok: true; asset: VideoWorkspaceMediaAsset }
  | { ok: false; issue: VideoWorkspaceImportIssue } {
  const extension = normalizeExtension(file.name);
  const kind = inferMediaKind(file);

  if (!kind) {
    return {
      ok: false,
      issue: createImportIssue(
        "UNSUPPORTED_MEDIA_TYPE",
        file.name,
        "Unsupported file type. Stage 2 supports JPG/PNG images and WAV audio files."
      )
    };
  }

  if (kind === "image" && !SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
    return {
      ok: false,
      issue: createImportIssue(
        "INVALID_IMAGE_FILE",
        file.name,
        "Invalid image file. Supported image formats are JPG and PNG."
      )
    };
  }

  if (kind === "audio" && !SUPPORTED_AUDIO_EXTENSIONS.has(extension)) {
    return {
      ok: false,
      issue: createImportIssue(
        "INVALID_AUDIO_FILE",
        file.name,
        "Invalid audio file. Stage 2 supports WAV audio only."
      )
    };
  }

  return {
    ok: true,
    asset: {
      kind,
      fileName: file.name,
      sourcePath: normalizeSourcePath(sourcePathOverride) ?? resolveFileSystemPath(file),
      extension,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      lastModifiedMs: file.lastModified,
      source
    }
  };
}

export function toVideoWorkspaceMediaAssetFromNativePath(
  sourcePath: string,
  source: VideoImportSource
):
  | { ok: true; asset: VideoWorkspaceMediaAsset }
  | { ok: false; issue: VideoWorkspaceImportIssue } {
  const normalizedPath = sourcePath.trim();
  if (normalizedPath.length === 0) {
    return {
      ok: false,
      issue: createImportIssue(
        "SOURCE_PATH_MISSING",
        "",
        "Selected media path is unavailable. Choose a local file again."
      )
    };
  }

  const fileName = fileNameFromPath(normalizedPath);
  const extension = normalizeExtension(fileName);
  const kind = inferMediaKindFromExtension(extension);

  if (!kind) {
    return {
      ok: false,
      issue: createImportIssue(
        "UNSUPPORTED_MEDIA_TYPE",
        fileName,
        "Unsupported file type. Stage 2 supports JPG/PNG images and WAV audio files."
      )
    };
  }

  if (kind === "image" && !SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
    return {
      ok: false,
      issue: createImportIssue(
        "INVALID_IMAGE_FILE",
        fileName,
        "Invalid image file. Supported image formats are JPG and PNG."
      )
    };
  }

  if (kind === "audio" && !SUPPORTED_AUDIO_EXTENSIONS.has(extension)) {
    return {
      ok: false,
      issue: createImportIssue(
        "INVALID_AUDIO_FILE",
        fileName,
        "Invalid audio file. Stage 2 supports WAV audio only."
      )
    };
  }

  return {
    ok: true,
    asset: {
      kind,
      fileName,
      sourcePath: normalizedPath,
      extension,
      mimeType: mimeTypeFromExtension(kind, extension),
      sizeBytes: 0,
      lastModifiedMs: Date.now(),
      source
    }
  };
}

export function validateMediaAssetKind(
  asset: VideoWorkspaceMediaAsset,
  expectedKind: VideoMediaKind
): VideoWorkspaceImportIssue | null {
  if (asset.kind === expectedKind) return null;

  if (expectedKind === "image") {
    return createImportIssue(
      "INVALID_IMAGE_FILE",
      asset.fileName,
      "Selected file is not a supported image. Choose a JPG or PNG file."
    );
  }

  return createImportIssue(
    "INVALID_AUDIO_FILE",
    asset.fileName,
    "Selected file is not a supported WAV audio file."
  );
}

export function toVideoWorkspaceProjectSnapshot(
  state: VideoWorkspaceProjectState
): VideoWorkspaceProjectSnapshot {
  return {
    schemaVersion: 1,
    imageAsset: state.imageAsset,
    audioAsset: state.audioAsset
  };
}

function isVideoWorkspaceMediaAsset(value: unknown): value is VideoWorkspaceMediaAsset {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.kind === "image" || candidate.kind === "audio") &&
    typeof candidate.fileName === "string" &&
    (candidate.sourcePath === null || typeof candidate.sourcePath === "string") &&
    typeof candidate.extension === "string" &&
    typeof candidate.mimeType === "string" &&
    typeof candidate.sizeBytes === "number" &&
    typeof candidate.lastModifiedMs === "number" &&
    (candidate.source === "file_dialog" || candidate.source === "drag_drop")
  );
}

export function fromVideoWorkspaceProjectSnapshot(
  snapshot: unknown
): VideoWorkspaceProjectState {
  if (!snapshot || typeof snapshot !== "object") return createEmptyVideoWorkspaceProjectState();

  const candidate = snapshot as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) return createEmptyVideoWorkspaceProjectState();

  return {
    imageAsset: isVideoWorkspaceMediaAsset(candidate.imageAsset) ? candidate.imageAsset : null,
    audioAsset: isVideoWorkspaceMediaAsset(candidate.audioAsset) ? candidate.audioAsset : null,
    importIssues: []
  };
}





