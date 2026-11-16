/**
 * Job queue processor.
 * Uses p-queue to cap concurrency at MAX_CONCURRENT_JOBS.
 * When Flask calls POST /worker/dispatch, we add the job to this queue.
 */

import PQueue from "p-queue";
import { CONFIG } from "../utils/env.js";
import { runJob } from "../scrapers/googleMapsScraper.js";
import { logger } from "../utils/logger.js";

const queue = new PQueue({ concurrency: CONFIG.maxConcurrentJobs });
const queued = new Set(); // track job IDs already enqueued to avoid duplicates

export function enqueueJob(jobId) {
  if (queued.has(jobId)) {
    logger.warn("Job already enqueued, ignoring duplicate dispatch", { jobId });
    return false;
  }
  queued.add(jobId);
  logger.info("Enqueueing job", {
    jobId,
    queueSize: queue.size,
    pending:   queue.pending,
  });

  queue.add(async () => {
    try {
      await runJob(jobId);
    } catch (err) {
      logger.error("Unhandled error in queue processor", { jobId, error: err.message });
    } finally {
      queued.delete(jobId);
    }
  });
  return true;
}

export function getQueueStats() {
  return {
    queue_length: queue.size,
    running:      queue.pending,
    concurrency:  CONFIG.maxConcurrentJobs,
  };
}
