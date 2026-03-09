import { describe, expect, it } from "vitest";

import { createDefaultVideoOverlaySettings } from "../../overlay-engine/api";
import { createDefaultVideoOutputSettings } from "./videoOutputSettings";
import { createDefaultVideoWorkspaceTextSettings } from "./videoWorkspaceTextSettings";
import {
  createVideoWorkspacePreferencesDocument,
  createVideoWorkspaceProjectDocument,
  parseVideoWorkspacePreferencesDocument,
  parseVideoWorkspaceProjectDocument,
  pushRecentOutputDirectory
} from "./videoWorkspacePersistence";

const PROJECT_SNAPSHOT = {
  schemaVersion: 1,
  imageAsset: {
    kind: "image",
    fileName: "cover.png",
    sourcePath: "C:\\Media\\cover.png",
    extension: "png",
    mimeType: "image/png",
    sizeBytes: 1234,
    lastModifiedMs: 1706214400000,
    source: "file_dialog"
  },
  audioAsset: {
    kind: "audio",
    fileName: "mix.wav",
    sourcePath: "C:\\Media\\mix.wav",
    extension: "wav",
    mimeType: "audio/wav",
    sizeBytes: 2345,
    lastModifiedMs: 1706214400000,
    source: "file_dialog"
  }
} as const;

describe("videoWorkspacePersistence", () => {
  it("creates and parses a project document deterministically", () => {
    const document = createVideoWorkspaceProjectDocument({
      savedAtUtc: "2026-03-09T12:00:00.000Z",
      projectSnapshot: PROJECT_SNAPSHOT,
      fitMode: "fit_bars",
      textSettings: createDefaultVideoWorkspaceTextSettings(),
      overlaySettings: createDefaultVideoOverlaySettings(),
      outputSettings: {
        ...createDefaultVideoOutputSettings(),
        presetId: "youtube_1440p_standard",
        outputDirectoryPath: "C:\\Exports",
        outputBaseFileName: "session-01"
      }
    });

    const parsed = parseVideoWorkspaceProjectDocument(document);
    expect(parsed).not.toBeNull();
    if (!parsed) return;

    expect(parsed.fitMode).toBe("fit_bars");
    expect(parsed.outputSettings.presetId).toBe("youtube_1440p_standard");
    expect(parsed.projectSnapshot.imageAsset?.sourcePath).toBe("C:\\Media\\cover.png");
    expect(parsed.projectSnapshot.audioAsset?.sourcePath).toBe("C:\\Media\\mix.wav");
  });

  it("returns null when parsing unsupported project schema", () => {
    const parsed = parseVideoWorkspaceProjectDocument({ schemaVersion: 999 });
    expect(parsed).toBeNull();
  });

  it("deduplicates recent output directories and keeps newest first", () => {
    const recent = pushRecentOutputDirectory(
      ["C:\\Exports\\A", "C:\\Exports\\B"],
      "C:\\Exports\\A"
    );

    expect(recent).toEqual(["C:\\Exports\\A", "C:\\Exports\\B"]);

    const withNew = pushRecentOutputDirectory(recent, "C:\\Exports\\C");
    expect(withNew).toEqual(["C:\\Exports\\C", "C:\\Exports\\A", "C:\\Exports\\B"]);
  });

  it("parses preferences and sanitizes invalid entries", () => {
    const created = createVideoWorkspacePreferencesDocument({
      lastOutputPresetId: "youtube_1440p_standard",
      recentOutputDirectories: [
        "C:\\Exports\\A",
        "C:\\Exports\\B",
        "C:\\Exports\\A",
        ""
      ]
    });

    const parsed = parseVideoWorkspacePreferencesDocument(created);
    expect(parsed).not.toBeNull();
    if (!parsed) return;

    expect(parsed.lastOutputPresetId).toBe("youtube_1440p_standard");
    expect(parsed.recentOutputDirectories).toEqual(["C:\\Exports\\A", "C:\\Exports\\B"]);
  });
});
