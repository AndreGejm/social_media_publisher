import React, { type PropsWithChildren } from "react";
import { renderHook, act } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { useIngestJobPolling } from "./useIngestJobPolling";
import { TauriClientProvider, type TauriClient } from "../../../services/tauri/TauriClientProvider";
import type { CatalogIngestJobResponse } from "../../../services/tauri/tauriClient";

// ---------------------------------------------------------------------------
// Setup Mock Tauri Client
// ---------------------------------------------------------------------------
const mockGetIngestJob = vi.fn();
const mockClient = {
    catalogGetIngestJob: mockGetIngestJob
} as unknown as TauriClient;

function renderHookWithProvider<Result, Props>(renderCallback: (initialProps: Props) => Result) {
    return renderHook(renderCallback, {
        wrapper: ({ children }: PropsWithChildren) => React.createElement(TauriClientProvider, { client: mockClient, children })
    });
}

// ---------------------------------------------------------------------------
// Drain the microtask queue — compatible with vitest 2/3 and fake timers.
// ---------------------------------------------------------------------------// Drain microtask queue — works correctly with vi.useFakeTimers().
// Each `await` yields a microtask tick; chaining 5 is enough for the
// async promise chains in these hooks.
async function flushPromises() {
    for (let i = 0; i < 5; i++) {

        await Promise.resolve();
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const JOB_ID_A = "a".repeat(64);
const JOB_ID_B = "b".repeat(64);

function makeJob(
    jobId: string,
    status: string,
    overrides: Partial<{ total_items: number; processed_items: number; error_count: number }> = {}
): CatalogIngestJobResponse {
    return {
        job_id: jobId,
        status,
        scope: "SCAN_ROOT:root-1",
        total_items: overrides.total_items ?? 10,
        processed_items: overrides.processed_items ?? 0,
        error_count: overrides.error_count ?? 0,
        created_at: "2026-03-01T00:00:00Z",
        updated_at: "2026-03-01T00:00:00Z"
    };
}

function makeActiveJobs(jobId = JOB_ID_A, status = "PENDING") {
    return { [jobId]: makeJob(jobId, status) };
}

function makeSetActiveScanJobsMock<State extends Record<string, CatalogIngestJobResponse>>(state: State) {
    return vi.fn<React.Dispatch<React.SetStateAction<State>>>((next) => {
        if (typeof next === "function") {
            (next as (current: State) => State)(state);
        }
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("useIngestJobPolling", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mockGetIngestJob.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // ── 1. Happy path ──────────────────────────────────────────────────────────
    it("fires an immediate poll and then polls every 500 ms", async () => {
        mockGetIngestJob.mockResolvedValue(makeJob(JOB_ID_A, "PENDING"));

        renderHookWithProvider(() =>
            useIngestJobPolling({
                activeScanJobs: makeActiveJobs(),
                setActiveScanJobs: vi.fn(),
                onJobsCompleted: vi.fn()
            })
        );

        // Immediate poll
        await flushPromises();
        expect(mockGetIngestJob).toHaveBeenCalledTimes(1);

        // 500ms interval → second poll
        await act(async () => { vi.advanceTimersByTime(500); });
        await flushPromises();
        expect(mockGetIngestJob).toHaveBeenCalledTimes(2);

        // 1000ms → third poll
        await act(async () => { vi.advanceTimersByTime(500); });
        await flushPromises();
        expect(mockGetIngestJob).toHaveBeenCalledTimes(3);
    });

    // ── 2. onJobsCompleted fires when job reaches terminal status ───────────────
    it("calls onJobsCompleted when a job transitions to COMPLETED", async () => {
        mockGetIngestJob
            .mockResolvedValueOnce(makeJob(JOB_ID_A, "PENDING"))
            .mockResolvedValueOnce(makeJob(JOB_ID_A, "COMPLETED", { processed_items: 5 }));

        const jobs: Record<string, ReturnType<typeof makeJob>> = makeActiveJobs();
        const setActiveScanJobs = makeSetActiveScanJobsMock(jobs);
        const onJobsCompleted = vi.fn();

        renderHookWithProvider(() =>
            useIngestJobPolling({ activeScanJobs: jobs, setActiveScanJobs, onJobsCompleted })
        );

        // Poll 1 (PENDING)
        await flushPromises();
        expect(onJobsCompleted).not.toHaveBeenCalled();

        // Poll 2 (COMPLETED)
        await act(async () => { vi.advanceTimersByTime(500); });
        await flushPromises();
        expect(onJobsCompleted).toHaveBeenCalledOnce();
        expect(onJobsCompleted).toHaveBeenCalledWith([
            expect.objectContaining({ job_id: JOB_ID_A, status: "COMPLETED" })
        ]);
    });

    // ── 3. Deduplication: same terminal status does not re-fire the callback ────
    it("does not re-fire onJobsCompleted for the same terminal status", async () => {
        mockGetIngestJob.mockResolvedValue(
            makeJob(JOB_ID_A, "COMPLETED", { processed_items: 3 })
        );

        const jobs = makeActiveJobs();
        const setActiveScanJobs = makeSetActiveScanJobsMock(jobs);
        const onJobsCompleted = vi.fn();

        renderHookWithProvider(() =>
            useIngestJobPolling({ activeScanJobs: jobs, setActiveScanJobs, onJobsCompleted })
        );

        await flushPromises();
        expect(onJobsCompleted).toHaveBeenCalledTimes(1);

        // Second poll — same status → must NOT re-fire
        await act(async () => { vi.advanceTimersByTime(500); });
        await flushPromises();
        expect(onJobsCompleted).toHaveBeenCalledTimes(1);
    });

    // ── 4. Error path: failed IPC poll is suppressed, does not fire callback ────
    it("suppresses individual IPC errors and does not fire onJobsCompleted", async () => {
        mockGetIngestJob
            .mockRejectedValueOnce(new Error("network error"))
            .mockResolvedValueOnce(makeJob(JOB_ID_A, "PENDING"));

        const onJobsCompleted = vi.fn();

        renderHookWithProvider(() =>
            useIngestJobPolling({
                activeScanJobs: makeActiveJobs(),
                setActiveScanJobs: vi.fn(),
                onJobsCompleted
            })
        );

        // Poll 1 errors
        await flushPromises();
        expect(onJobsCompleted).not.toHaveBeenCalled();

        // Poll 2 recovers to PENDING — still no completion
        await act(async () => { vi.advanceTimersByTime(500); });
        await flushPromises();
        expect(onJobsCompleted).not.toHaveBeenCalled();
    });

    // ── 5. Cleanup: interval cleared when component unmounts ────────────────────
    it("clears the interval on unmount and stops polling", async () => {
        mockGetIngestJob.mockResolvedValue(makeJob(JOB_ID_A, "PENDING"));

        const { unmount } = renderHookWithProvider(() =>
            useIngestJobPolling({
                activeScanJobs: makeActiveJobs(),
                setActiveScanJobs: vi.fn(),
                onJobsCompleted: vi.fn()
            })
        );

        await flushPromises();
        expect(mockGetIngestJob).toHaveBeenCalledTimes(1);

        unmount();

        await act(async () => { vi.advanceTimersByTime(2000); });
        await flushPromises();
        // Still only 1 call from before unmount
        expect(mockGetIngestJob).toHaveBeenCalledTimes(1);
    });

    // ── 6. Multiple jobs polled in the same batch ────────────────────────────────
    it("polls multiple active jobs and fires onJobsCompleted for each that completes", async () => {
        mockGetIngestJob.mockImplementation((jobId: string) => {
            if (jobId === JOB_ID_A) return Promise.resolve(makeJob(JOB_ID_A, "COMPLETED", { processed_items: 1 }));
            if (jobId === JOB_ID_B) return Promise.resolve(makeJob(JOB_ID_B, "FAILED"));
            return Promise.resolve(null);
        });

        const jobs = {
            [JOB_ID_A]: makeJob(JOB_ID_A, "PENDING"),
            [JOB_ID_B]: makeJob(JOB_ID_B, "PENDING")
        };
        const setActiveScanJobs = makeSetActiveScanJobsMock(jobs);
        const onJobsCompleted = vi.fn();

        renderHookWithProvider(() =>
            useIngestJobPolling({ activeScanJobs: jobs, setActiveScanJobs, onJobsCompleted })
        );

        await flushPromises();
        expect(onJobsCompleted).toHaveBeenCalledOnce();
        const completedArg: ReturnType<typeof makeJob>[] = onJobsCompleted.mock.calls[0][0];
        expect(completedArg).toHaveLength(2);
        expect(completedArg.map((j) => j.status).sort()).toEqual(["COMPLETED", "FAILED"]);
    });

    // ── 7. No poll when there are no active jobs ─────────────────────────────────
    it("does not start polling when activeScanJobs is empty", async () => {
        renderHookWithProvider(() =>
            useIngestJobPolling({
                activeScanJobs: {},
                setActiveScanJobs: vi.fn(),
                onJobsCompleted: vi.fn()
            })
        );

        await act(async () => { vi.advanceTimersByTime(1000); });
        await flushPromises();
        expect(mockGetIngestJob).not.toHaveBeenCalled();
    });
});



