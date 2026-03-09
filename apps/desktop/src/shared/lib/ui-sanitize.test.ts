import { describe, expect, it } from "vitest";
import { sanitizeUiErrorMessage, sanitizeUiText } from "./ui-sanitize";

describe("ui-sanitize", () => {
  it("removes control and bidi characters from display text", () => {
    const raw = "Track\u0000 Name \u202E Hidden";
    expect(sanitizeUiText(raw)).toBe("Track Name Hidden");
  });

  it("truncates long text with an ellipsis", () => {
    const raw = "x".repeat(300);
    const out = sanitizeUiText(raw, 32);
    expect(out.length).toBe(35);
    expect(out.endsWith("...")).toBe(true);
  });

  it("maps panic-like errors to fallback message", () => {
    const panic = new Error("thread 'main' panicked at src/main.rs:10:3");
    expect(sanitizeUiErrorMessage(panic, "Playback failed")).toBe("Playback failed");
  });
});



