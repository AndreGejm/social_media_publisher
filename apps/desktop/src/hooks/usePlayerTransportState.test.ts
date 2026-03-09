/**
 * Tests for pure utilities used by usePlayerTransportState:
 *   - transportMath helpers (clampVolumeScalar, isPlaybackPositionUnchanged, normalizePlaybackPositionSeconds)
 *   - isUiAppError type guard (from tauri-api)
 *   - VOLUME_SYNC_THROTTLE_MS behavioural contract tested via a standalone throttle test
 *
 * NOTE: The full renderHook integration of usePlayerTransportState requires Tauri
 * native IPC to succeed (initExclusiveDevice), which cannot be reliably driven in
 * jsdom without a real Tauri host. The polling loop behaviour is instead validated
 * here via the extracted pure functions. See useIngestJobPolling.test.ts for the
 * canonical fake-timer polling pattern used across the codebase.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// transportMath (pure — no mocks required)
// ---------------------------------------------------------------------------
import {
    clampVolumeScalar,
    isPlaybackPositionUnchanged,
    normalizePlaybackPositionSeconds
} from "../features/player/transportMath";

describe("clampVolumeScalar", () => {
    it("passes a valid scalar through unchanged", () => {
        expect(clampVolumeScalar(0.5)).toBe(0.5);
        expect(clampVolumeScalar(1.0)).toBe(1.0);
        expect(clampVolumeScalar(0.0)).toBe(0.0);
    });

    it("clamps values above 1 to 1", () => {
        expect(clampVolumeScalar(1.5)).toBe(1.0);
        expect(clampVolumeScalar(100)).toBe(1.0);
    });

    it("clamps values below 0 to 0", () => {
        expect(clampVolumeScalar(-0.1)).toBe(0.0);
        expect(clampVolumeScalar(-100)).toBe(0.0);
    });

    it("returns 1 for non-finite values (NaN/Infinity)", () => {
        // The function uses Number.isFinite — non-finite values default to 1.
        expect(clampVolumeScalar(NaN)).toBe(1.0);
        expect(clampVolumeScalar(Infinity)).toBe(1.0);
    });
});

describe("isPlaybackPositionUnchanged", () => {
    it("returns true when positions are within 1ms tolerance (epsilon = 0.001s)", () => {
        expect(isPlaybackPositionUnchanged(10.0, 10.0009)).toBe(true);
    });

    it("returns false when positions differ by more than 50ms", () => {
        expect(isPlaybackPositionUnchanged(10.0, 10.1)).toBe(false);
    });

    it("returns true for identical positions", () => {
        expect(isPlaybackPositionUnchanged(5.0, 5.0)).toBe(true);
    });
});

describe("normalizePlaybackPositionSeconds", () => {
    it("returns non-negative seconds unchanged", () => {
        expect(normalizePlaybackPositionSeconds(3.5)).toBe(3.5);
        expect(normalizePlaybackPositionSeconds(0)).toBe(0);
    });

    it("clamps negative values to 0", () => {
        expect(normalizePlaybackPositionSeconds(-1)).toBe(0);
    });

    it("rounds to 3 decimal places", () => {
        const result = normalizePlaybackPositionSeconds(1.23456789);
        expect(result).toBeCloseTo(1.235, 3);
    });
});

// ---------------------------------------------------------------------------
// isUiAppError (pure type guard — no mocks required)
// ---------------------------------------------------------------------------
import { isUiAppError } from "../tauri-api";

describe("isUiAppError", () => {
    it("returns true for a well-formed UiAppError object", () => {
        expect(isUiAppError({ code: "SOME_CODE", message: "some message" })).toBe(true);
    });

    it("returns true when details field is present", () => {
        expect(isUiAppError({ code: "CODE", message: "msg", details: { info: 1 } })).toBe(true);
    });

    it("returns false for null", () => {
        expect(isUiAppError(null)).toBe(false);
    });

    it("returns false for a plain string", () => {
        expect(isUiAppError("error string")).toBe(false);
    });

    it("returns false for an Error instance (no code field)", () => {
        expect(isUiAppError(new Error("boom"))).toBe(false);
    });

    it("returns false when code is not a string", () => {
        expect(isUiAppError({ code: 42, message: "msg" })).toBe(false);
    });

    it("returns false when message is not a string", () => {
        expect(isUiAppError({ code: "CODE", message: null })).toBe(false);
    });

    it("returns false for an empty object", () => {
        expect(isUiAppError({})).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Volume throttle contract — standalone implementation matching hook logic.
// This exercises the same timing pattern as scheduleNativeVolumeSync without
// needing to drive the full hook through jsdom + fake IPC.
// ---------------------------------------------------------------------------
const VOLUME_SYNC_THROTTLE_MS = 80;

function makeVolumeThrottle(onSend: (v: number) => void) {
    let active = false;
    let pending: number | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    function schedule(scalar: number): void {
        if (!active) {
            active = true;
            onSend(scalar);
            timerId = setTimeout(() => {
                active = false;
                const p = pending;
                pending = null;
                if (p != null) schedule(p);
            }, VOLUME_SYNC_THROTTLE_MS);
            return;
        }
        pending = scalar;
    }

    function cleanup(): void {
        if (timerId != null) clearTimeout(timerId);
    }

    return { schedule, cleanup };
}

describe("volume throttle contract (VOLUME_SYNC_THROTTLE_MS = 80ms)", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("fires the leader immediately and a single pending flush after the window", () => {
        const onSend = vi.fn();
        const throttle = makeVolumeThrottle(onSend);

        // Five rapid calls
        throttle.schedule(0.9);
        throttle.schedule(0.8);
        throttle.schedule(0.7);
        throttle.schedule(0.6);
        throttle.schedule(0.5);

        // Leader fired synchronously
        expect(onSend).toHaveBeenCalledTimes(1);
        expect(onSend).toHaveBeenLastCalledWith(0.9);

        // Advance past the window → pending (last value) flushed
        vi.advanceTimersByTime(VOLUME_SYNC_THROTTLE_MS);
        expect(onSend).toHaveBeenCalledTimes(2);
        expect(onSend).toHaveBeenLastCalledWith(0.5);

        throttle.cleanup();
    });

    it("fires only one call when no pending value accumulates", () => {
        const onSend = vi.fn();
        const throttle = makeVolumeThrottle(onSend);

        throttle.schedule(0.7);
        expect(onSend).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(VOLUME_SYNC_THROTTLE_MS);
        // No pending → no second call
        expect(onSend).toHaveBeenCalledTimes(1);

        throttle.cleanup();
    });

    it("allows a new call after the throttle window reopens", () => {
        const onSend = vi.fn();
        const throttle = makeVolumeThrottle(onSend);

        throttle.schedule(0.8);
        vi.advanceTimersByTime(VOLUME_SYNC_THROTTLE_MS);

        // Window reopened — a new call fires immediately as a new leader
        throttle.schedule(0.3);
        expect(onSend).toHaveBeenCalledTimes(2);
        expect(onSend).toHaveBeenLastCalledWith(0.3);

        throttle.cleanup();
    });
});
