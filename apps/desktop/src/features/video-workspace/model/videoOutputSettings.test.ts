import { describe, expect, it } from "vitest";

import {
  createDefaultVideoOutputSettings,
  deriveVideoOutputFileName,
  deriveVideoOutputFilePreviewPath,
  patchVideoOutputSettings,
  validateVideoOutputSettings
} from "./videoOutputSettings";

describe("videoOutputSettings", () => {
  it("creates default output settings", () => {
    const defaults = createDefaultVideoOutputSettings();

    expect(defaults.presetId).toBe("youtube_1080p_standard");
    expect(defaults.outputBaseFileName).toBe("video-export");
  });

  it("patches and sanitizes output settings", () => {
    const patched = patchVideoOutputSettings(createDefaultVideoOutputSettings(), {
      outputDirectoryPath: "  C:\\Exports  ",
      outputBaseFileName: "  My:Track?  ",
      overwritePolicy: "replace"
    });

    expect(patched.outputDirectoryPath).toBe("C:\\Exports");
    expect(patched.outputBaseFileName).toBe("MyTrack");
    expect(patched.overwritePolicy).toBe("replace");
  });

  it("validates missing output directory", () => {
    const issues = validateVideoOutputSettings(
      patchVideoOutputSettings(createDefaultVideoOutputSettings(), {
        outputDirectoryPath: ""
      })
    );

    expect(issues.map((issue) => issue.code)).toContain("INVALID_OUTPUT_DIRECTORY");
  });

  it("derives deterministic output file preview path", () => {
    const settings = patchVideoOutputSettings(createDefaultVideoOutputSettings(), {
      outputDirectoryPath: "C:\\Exports",
      outputBaseFileName: "session-01"
    });

    expect(deriveVideoOutputFileName(settings.outputBaseFileName)).toBe("session-01.mp4");
    expect(deriveVideoOutputFilePreviewPath(settings)).toBe("C:\\Exports\\session-01.mp4");
  });
});
