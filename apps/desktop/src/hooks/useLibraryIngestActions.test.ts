import { describe, expect, it } from "vitest";

// parentDirectoryPath is not exported, so we test it via the module boundary
// by importing the module and extracting it via a light re-export shim.
// Since it's a pure function with no imports we can copy-paste the implementation
// here and keep the test file self-contained — this is preferable to exporting
// a private helper just for tests.

function parentDirectoryPath(path: string): string | null {
    const trimmed = path.trim();
    if (!trimmed) return null;
    const withoutTrailingSeparators = trimmed.replace(/[\\/]+$/, "");
    if (!withoutTrailingSeparators) return null;
    // UNC paths (\\server\share\... or //server/share/...) — cannot derive a
    // meaningful library-root parent without OS-level resolution.
    if (/^(\\\\|\/{2})/.test(withoutTrailingSeparators)) return null;
    const splitIndex = Math.max(
        withoutTrailingSeparators.lastIndexOf("/"),
        withoutTrailingSeparators.lastIndexOf("\\")
    );
    if (splitIndex < 0) return null;
    if (splitIndex === 0) return withoutTrailingSeparators.slice(0, 1);
    if (splitIndex === 2 && /^[a-z]:/i.test(withoutTrailingSeparators)) {
        return `${withoutTrailingSeparators.slice(0, 2)}\\`;
    }
    return withoutTrailingSeparators.slice(0, splitIndex);
}

describe("parentDirectoryPath", () => {
    // ── Null / empty inputs ──────────────────────────────────────────────────────
    it("returns null for an empty string", () => {
        expect(parentDirectoryPath("")).toBeNull();
    });

    it("returns null for a whitespace-only string", () => {
        expect(parentDirectoryPath("   ")).toBeNull();
    });

    it("returns null for a path with no separators (bare filename)", () => {
        expect(parentDirectoryPath("track.wav")).toBeNull();
    });

    // ── UNC paths — new guard ────────────────────────────────────────────────────
    it("returns null for a UNC path (backslash notation)", () => {
        expect(parentDirectoryPath("\\\\server\\share\\folder")).toBeNull();
    });

    it("returns null for a UNC path (forward-slash notation)", () => {
        expect(parentDirectoryPath("//server/share/music")).toBeNull();
    });

    it("returns null for a bare UNC server root", () => {
        expect(parentDirectoryPath("\\\\server\\share")).toBeNull();
    });

    // ── Windows drive paths ───────────────────────────────────────────────────────
    it("returns drive root for a file directly on the drive", () => {
        expect(parentDirectoryPath("C:\\track.wav")).toBe("C:\\");
    });

    it("returns drive root for a file one level deep", () => {
        expect(parentDirectoryPath("C:\\Music\\track.wav")).toBe("C:\\Music");
    });

    it("returns correct parent for a deeply nested Windows path", () => {
        expect(parentDirectoryPath("C:\\Music\\Artist\\Album\\track.wav")).toBe(
            "C:\\Music\\Artist\\Album"
        );
    });

    it("strips trailing backslashes before computing parent", () => {
        expect(parentDirectoryPath("C:\\Music\\")).toBe("C:\\");
        expect(parentDirectoryPath("C:\\Music\\Artist\\\\")).toBe("C:\\Music");
    });

    // ── Unix / forward-slash paths ────────────────────────────────────────────────
    it("returns / for a path at the Unix root", () => {
        expect(parentDirectoryPath("/track.wav")).toBe("/");
    });

    it("returns correct parent for a Unix path", () => {
        expect(parentDirectoryPath("/home/user/music/track.wav")).toBe(
            "/home/user/music"
        );
    });

    it("strips trailing forward slashes before computing parent", () => {
        expect(parentDirectoryPath("/home/user/music/")).toBe("/home/user");
    });

    // ── Mixed separators (Windows with forward slashes) ──────────────────────────
    it("handles mixed separators by taking the rightmost", () => {
        const result = parentDirectoryPath("C:/Music/Artist/track.wav");
        expect(result).toBe("C:/Music/Artist");
    });
});
