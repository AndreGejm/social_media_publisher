import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";

import { catalogGetIngestJob, type CatalogIngestJobResponse } from "../services/tauriClient";

type UseIngestJobPollingArgs = {
  activeScanJobs: Record<string, CatalogIngestJobResponse>;
  setActiveScanJobs: Dispatch<SetStateAction<Record<string, CatalogIngestJobResponse>>>;
  onAnyJobCompleted: () => void;
};

export function useIngestJobPolling(args: UseIngestJobPollingArgs) {
  const { activeScanJobs, setActiveScanJobs, onAnyJobCompleted } = args;

  useEffect(() => {
    const activeJobIds = Object.values(activeScanJobs)
      .filter((job) => !["COMPLETED", "FAILED"].includes(job.status))
      .map((job) => job.job_id);
    if (activeJobIds.length === 0) return;

    const timer = window.setInterval(() => {
      void (async () => {
        const updates = await Promise.all(
          activeJobIds.map(async (jobId) => {
            try {
              const job = await catalogGetIngestJob(jobId);
              return job;
            } catch {
              return null;
            }
          })
        );
        setActiveScanJobs((current) => {
          const next = { ...current };
          for (const job of updates) {
            if (job) next[job.job_id] = job;
          }
          return next;
        });
        if (updates.some((job) => job?.status === "COMPLETED")) {
          onAnyJobCompleted();
        }
      })();
    }, 500);

    return () => window.clearInterval(timer);
  }, [activeScanJobs, onAnyJobCompleted, setActiveScanJobs]);
}
