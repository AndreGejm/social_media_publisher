import { describe, expect, it } from "vitest";

import { createDefaultVideoOverlaySettings, patchVideoOverlaySettings } from "../../overlay-engine/api";
import { createDefaultVideoOutputSettings, patchVideoOutputSettings } from "./videoOutputSettings";
import {
  buildVideoRenderRequest,
  preflightVideoRenderRequest,
  toVideoRenderRequestJson
} from "./videoRenderRequest";
import { createDefaultVideoWorkspaceTextSettings } from "./videoWorkspaceTextSettings";

const IMAGE_ASSET = {
  kind: "image",
  fileName: "cover.png",
  sourcePath: "C:\\Media\\cover.png",
  extension: "png",
  mimeType: "image/png",
  sizeBytes: 1024,
  lastModifiedMs: 1706214400000,
  source: "file_dialog"
} as const;

const AUDIO_ASSET = {
  kind: "audio",
  fileName: "mix.wav",
  sourcePath: "C:\\Media\\mix.wav",
  extension: "wav",
  mimeType: "audio/wav",
  sizeBytes: 2048,
  lastModifiedMs: 1706214400000,
  source: "file_dialog"
} as const;

describe("videoRenderRequest", () => {
  it("returns missing media issues during preflight", () => {
    const issues = preflightVideoRenderRequest({
      imageAsset: null,
      audioAsset: null,
      fitMode: "fill_crop",
      textSettings: createDefaultVideoWorkspaceTextSettings(),
      overlaySettings: createDefaultVideoOverlaySettings(),
      outputSettings: createDefaultVideoOutputSettings()
    });

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["MISSING_IMAGE", "MISSING_AUDIO", "INVALID_OUTPUT_DIRECTORY"])
    );
  });

  it("returns source path issues when selected media has no local path", () => {
    const issues = preflightVideoRenderRequest({
      imageAsset: {
        ...IMAGE_ASSET,
        sourcePath: null
      },
      audioAsset: {
        ...AUDIO_ASSET,
        sourcePath: ""
      },
      fitMode: "fill_crop",
      textSettings: createDefaultVideoWorkspaceTextSettings(),
      overlaySettings: createDefaultVideoOverlaySettings(),
      outputSettings: patchVideoOutputSettings(createDefaultVideoOutputSettings(), {
        outputDirectoryPath: "C:\\Exports",
        outputBaseFileName: "demo"
      })
    });

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["MISSING_IMAGE_PATH", "MISSING_AUDIO_PATH"])
    );
  });

  it("validates output path before request build", () => {
    const result = buildVideoRenderRequest({
      imageAsset: IMAGE_ASSET,
      audioAsset: AUDIO_ASSET,
      fitMode: "fit_bars",
      textSettings: createDefaultVideoWorkspaceTextSettings(),
      overlaySettings: createDefaultVideoOverlaySettings(),
      outputSettings: patchVideoOutputSettings(createDefaultVideoOutputSettings(), {
        outputDirectoryPath: ""
      })
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.issues.map((issue) => issue.code)).toContain("INVALID_OUTPUT_DIRECTORY");
  });

  it("builds deterministic request for same input", () => {
    const input = {
      imageAsset: IMAGE_ASSET,
      audioAsset: AUDIO_ASSET,
      fitMode: "stretch" as const,
      textSettings: createDefaultVideoWorkspaceTextSettings(),
      overlaySettings: createDefaultVideoOverlaySettings(),
      outputSettings: patchVideoOutputSettings(createDefaultVideoOutputSettings(), {
        presetId: "youtube_1440p_standard",
        outputDirectoryPath: "C:\\Exports",
        outputBaseFileName: "session-01"
      })
    };

    const first = buildVideoRenderRequest(input);
    const second = buildVideoRenderRequest(input);

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(first.request.output.presetId).toBe("youtube_1440p_standard");
    expect(first.request.output.outputFilePath).toBe("C:\\Exports\\session-01.mp4");
    expect(first.request.composition.widthPx).toBe(2560);
    expect(first.request.composition.heightPx).toBe(1440);
    expect(first.request.media.imageFileName).toBe("C:\\Media\\cover.png");
    expect(first.request.media.audioFileName).toBe("C:\\Media\\mix.wav");
    expect(first.request.composition.overlay.sizePercent).toBe(100);
  });

  it("serializes request to JSON without preview-only overlay fields and keeps render size", () => {
    const built = buildVideoRenderRequest({
      imageAsset: IMAGE_ASSET,
      audioAsset: AUDIO_ASSET,
      fitMode: "fill_crop",
      textSettings: createDefaultVideoWorkspaceTextSettings(),
      overlaySettings: patchVideoOverlaySettings(createDefaultVideoOverlaySettings(), {
        barCount: 88,
        sizePercent: 140
      }),
      outputSettings: patchVideoOutputSettings(createDefaultVideoOutputSettings(), {
        outputDirectoryPath: "C:\\Exports",
        outputBaseFileName: "demo"
      })
    });

    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const json = toVideoRenderRequestJson(built.request);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const overlay = (parsed.composition as { overlay: Record<string, unknown> }).overlay;

    expect(parsed.requestVersion).toBe(1);
    expect(parsed.output).toBeTruthy();
    expect(overlay.barCount).toBeUndefined();
    expect(overlay.sizePercent).toBe(140);
  });
});
