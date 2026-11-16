/**
 * Internal HTTP API server — Flask backend calls these endpoints.
 *
 * Endpoints:
 *   GET  /worker/health
 *   POST /worker/dispatch          body: { job_id }
 *   GET  /worker/jobs/:id/progress
 *
 * All requests require: Authorization: Bearer <SCRAPER_WORKER_TOKEN>
 */

import express from "express";
import { CONFIG } from "../utils/env.js";
import { enqueueJob, getQueueStats } from "../queue/processor.js";
import { getLiveProgress } from "../scrapers/googleMapsScraper.js";
import { getJob } from "../utils/storage.js";
import { logger } from "../utils/logger.js";

const app = express();
app.use(express.json());

// ── Auth middleware ───────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const auth = req.headers["authorization"] || "";
  const token = auth.replace("Bearer ", "").trim();
  if (token !== CONFIG.token) {
    logger.warn("Unauthorized request", { ip: req.ip, path: req.path });
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/worker/health", (req, res) => {
  const stats = getQueueStats();
  res.json({
    status:       "ok",
    queue_length: stats.queue_length,
    running:      stats.running,
    concurrency:  stats.concurrency,
    pid:          process.pid,
    uptime_s:     Math.round(process.uptime()),
  });
});

// ── Dispatch ──────────────────────────────────────────────────────────────────
app.post("/worker/dispatch", (req, res) => {
  const { job_id } = req.body || {};
  if (!job_id) {
    return res.status(400).json({ error: "job_id is required" });
  }

  const job = getJob(job_id);
  if (!job) {
    return res.status(404).json({ error: "Job not found in storage" });
  }
  if (!["queued", "interrupted"].includes(job.status)) {
    return res.status(422).json({ error: `Job is ${job.status}, cannot dispatch` });
  }

  const enqueued = enqueueJob(job_id);
  logger.info("Dispatch request", { job_id, enqueued });
  res.json({ ok: true, job_id, enqueued });
});

// ── Progress ──────────────────────────────────────────────────────────────────
app.get("/worker/jobs/:jobId/progress", (req, res) => {
  const { jobId } = req.params;
  const live = getLiveProgress(jobId);
  if (live) return res.json(live);

  // Fall back to persisted job data
  const job = getJob(jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });

  res.json({
    job_id:        jobId,
    status:        job.status,
    records_saved: job.records_saved  || 0,
    dupes_skipped: job.dupes_skipped  || 0,
    progress_pct:  job.progress_pct   || 0,
    current_index: job.current_index  || 0,
  });
});

export function startApiServer() {
  return new Promise((resolve) => {
    const server = app.listen(CONFIG.port, "127.0.0.1", () => {
      logger.info(`Worker API listening on http://127.0.0.1:${CONFIG.port}`);
      resolve(server);
    });
  });
}
