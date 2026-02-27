import { describe, expect, it } from "vitest";
import { localFilePathToMediaUrl } from "./media-url";

describe("media-url", () => {
  it("rejects non-local URL schemes", () => {
    expect(localFilePathToMediaUrl("javascript:alert(1)")).toBe("");
    expect(localFilePathToMediaUrl("https://example.com/a.mp3")).toBe("");
    expect(localFilePathToMediaUrl("data:text/plain,abc")).toBe("");
  });

  it("converts local windows and posix paths to file URLs", () => {
    expect(localFilePathToMediaUrl("C:\\Music\\track.wav")).toContain("file:///");
    expect(localFilePathToMediaUrl("/var/audio/track.wav")).toContain("file://");
  });

  it("normalizes windows extended-length prefixes", () => {
    expect(localFilePathToMediaUrl("\\\\?\\C:\\Music\\track.wav")).toContain("file:///");
    expect(localFilePathToMediaUrl("//?/C:/Music/track.wav")).toContain("file:///");
  });
});
