import { useEffect, useMemo, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";

import { catalogGetIngestJob, type CatalogIngestJobResponse } from "../services/tauriClient";

const INGEST_TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELED"]);
const MAX_INGEST_JOB_POLL_PARALLELISM = 8;

type UseIngestJobPollingArgs = {
  activeScanJobs: Record<string, CatalogIngestJobResponse>;
  setActiveScanJobs: Dispatch<SetStateAction<Record<string, CatalogIngestJobResponse>>>;
  onJobsCompleted: (jobs: CatalogIngestJobResponse[]) => void;
};

type PollUpdate =
  | { trackedJobId: string; job: CatalogIngestJobResponse | null; errored: false }
  | { trackedJobId: string; job: null; errored: true };

async function pollIngestJobUpdate(jobId: string): Promise<PollUpdate> {
  try {
    const job = await catalogGetIngestJob(jobId);
    return {
      trackedJobId: jobId,
      job,
      errored: false
    };
  } catch {
    return {
      trackedJobId: jobId,
      job: null,
      errored: true
    };
  }
}

async function pollIngestJobUpdates(jobIds: string[]): Promise<PollUpdate[]> {
  const updates: PollUpdate[] = [];
  for (let offset = 0; offset < jobIds.length; offset += MAX_INGEST_JOB_POLL_PARALLELISM) {
    const chunk = jobIds.slice(offset, offset + MAX_INGEST_JOB_POLL_PARALLELISM);
    const chunkUpdates = await Promise.all(chunk.map((jobId) => pollIngestJobUpdate(jobId)));
    updates.push(...chunkUpdates);
  }
  return updates;
}

export function useIngestJobPolling(args: UseIngestJobPollingArgs) {
  const { activeScanJobs, setActiveScanJobs, onJobsCompleted } = args;
  const onJobsCompletedRef = useRef(onJobsCompleted);
  const completedJobStatusesRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    onJobsCompletedRef.current = onJobsCompleted;
  }, [onJobsCompleted]);

  const activeJobIds = useMemo(
    () =>
      Object.values(activeScanJobs)
        .filter((job) => !INGEST_TERMINAL_STATUSES.has(job.status))
        .map((job) => job.job_id)
        .sort(),
    [activeScanJobs]
  );
  const activeJobIdsKey = activeJobIds.join("|");

  useEffect(() => {
    const trackedIds = new Set(Object.keys(activeScanJobs));
    completedJobStatusesRef.current.forEach((_status, jobId) => {
      if (!trackedIds.has(jobId)) {
        completedJobStatusesRef.current.delete(jobId);
      }
    });
  }, [activeScanJobs]);

  useEffect(() => {
    if (activeJobIds.length === 0) return;

    let cancelled = false;
    const pollJobs = async () => {
      const updates = await pollIngestJobUpdates(activeJobIds);
      if (cancelled) return;

      setActiveScanJobs((current) => {
        let changed = false;
        const next = { ...current };
        for (const update of updates) {
          const { trackedJobId, job, errored } = update;
          if (errored) continue;
          if (!job && trackedJobId && trackedJobId in next) {
            delete next[trackedJobId];
            changed = true;
            continue;
          }
          if (!job) continue;
          const previous = current[job.job_id];
          if (
            previous &&
            previous.status === job.status &&
            previous.total_items === job.total_items &&
            previous.processed_items === job.processed_items &&
            previous.error_count === job.error_count
          ) {
            continue;
          }
          next[job.job_id] = job;
          changed = true;
        }
        return changed ? next : current;
      });

      const completedJobs: CatalogIngestJobResponse[] = [];
      for (const update of updates) {
        const { trackedJobId, job } = update;
        if (!job) {
          completedJobStatusesRef.current.delete(trackedJobId);
          continue;
        }

        if (!INGEST_TERMINAL_STATUSES.has(job.status)) {
          completedJobStatusesRef.current.delete(job.job_id);
          continue;
        }

        const previousStatus = completedJobStatusesRef.current.get(job.job_id);
        if (previousStatus === job.status) {
          continue;
        }
        completedJobStatusesRef.current.set(job.job_id, job.status);
        completedJobs.push(job);
      }

      if (completedJobs.length > 0) {
        onJobsCompletedRef.current(completedJobs);
      }
    };

    void pollJobs();
    const timer = window.setInterval(() => {
      void pollJobs();
    }, 500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeJobIds, activeJobIdsKey, setActiveScanJobs]);
}
