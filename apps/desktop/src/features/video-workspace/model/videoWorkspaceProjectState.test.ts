import { describe, expect, it } from "vitest";

import {
  createEmptyVideoWorkspaceProjectState,
  formatFileSize,
  fromVideoWorkspaceProjectSnapshot,
  toVideoWorkspaceMediaAsset,
  toVideoWorkspaceMediaAssetFromNativePath,
  toVideoWorkspaceProjectSnapshot,
  validateMediaAssetKind
} from "./videoWorkspaceProjectState";

function createFile(name: string, type: string, body = "stub"): File {
  return new File([body], name, {
    type,
    lastModified: 1_706_214_400_000
  });
}

describe("videoWorkspaceProjectState", () => {
  it("creates an image asset for supported JPG input", () => {
    const file = createFile("cover.jpg", "image/jpeg");
    const result = toVideoWorkspaceMediaAsset(file, "file_dialog");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.asset.kind).toBe("image");
    expect(result.asset.extension).toBe("jpg");
  });

  it("creates an audio asset for supported WAV input", () => {
    const file = createFile("master.wav", "audio/wav");
    const result = toVideoWorkspaceMediaAsset(file, "drag_drop");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.asset.kind).toBe("audio");
    expect(result.asset.source).toBe("drag_drop");
  });

  it("creates an audio asset from a native WAV path", () => {
    const result = toVideoWorkspaceMediaAssetFromNativePath(
      "C:\\Media\\native-master.wav",
      "file_dialog"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.asset.kind).toBe("audio");
    expect(result.asset.sourcePath).toBe("C:\\Media\\native-master.wav");
    expect(result.asset.source).toBe("file_dialog");
  });

  it("rejects unsupported native path extension", () => {
    const result = toVideoWorkspaceMediaAssetFromNativePath(
      "C:\\Media\\notes.txt",
      "drag_drop"
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("rejects unsupported media type", () => {
    const file = createFile("notes.txt", "text/plain");
    const result = toVideoWorkspaceMediaAsset(file, "file_dialog");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("returns mismatch issue when expected kind differs", () => {
    const file = createFile("cover.png", "image/png");
    const result = toVideoWorkspaceMediaAsset(file, "file_dialog");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const mismatch = validateMediaAssetKind(result.asset, "audio");
    expect(mismatch).not.toBeNull();
    expect(mismatch?.code).toBe("INVALID_AUDIO_FILE");
  });

  it("serializes and hydrates project state deterministically", () => {
    const image = toVideoWorkspaceMediaAsset(createFile("cover.png", "image/png"), "file_dialog");
    const audio = toVideoWorkspaceMediaAsset(createFile("mix.wav", "audio/wav"), "drag_drop");

    expect(image.ok).toBe(true);
    expect(audio.ok).toBe(true);
    if (!image.ok || !audio.ok) return;

    const state = {
      imageAsset: image.asset,
      audioAsset: audio.asset,
      importIssues: []
    };

    const snapshot = toVideoWorkspaceProjectSnapshot(state);
    const hydrated = fromVideoWorkspaceProjectSnapshot(snapshot);

    expect(hydrated).toEqual(state);

    const json = JSON.stringify(snapshot);
    expect(JSON.parse(json)).toEqual(snapshot);
  });

  it("returns empty state for invalid snapshot", () => {
    const hydrated = fromVideoWorkspaceProjectSnapshot({ schemaVersion: 999 });
    expect(hydrated).toEqual(createEmptyVideoWorkspaceProjectState());
  });

  it("formats file size labels", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(2_097_152)).toBe("2.00 MB");
  });
});

