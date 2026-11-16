/**
 * Minimal read/write interface for the shared flat-file JSON storage.
 * Mirrors the Python storage.py atomic write pattern:
 *   write to .tmp → rename (atomic on Windows via fs.renameSync after close).
 *
 * The Node worker only needs to:
 *   - read/update job files            (storage/jobs/<id>.json)
 *   - append to activity logs          (storage/logs/<id>.jsonl)
 *   - save/read checkpoints            (storage/checkpoints/<id>.json)
 *   - save business records            (storage/businesses/<shard>/<id>.json)
 */

import fs from "fs";
import path from "path";
import { CONFIG } from "./env.js";

function storageRoot() {
  const raw = CONFIG.storageDir || "./storage";
  const p = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), "..", raw);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function dir(sub) {
  const d = path.join(storageRoot(), sub);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function atomicWrite(filePath, data) {
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 0), "utf8");
  fs.renameSync(tmp, filePath);
}

function safeRead(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

// ── Jobs ──────────────────────────────────────────────────────────────────────

export function getJob(jobId) {
  return safeRead(path.join(dir("jobs"), `${jobId}.json`));
}

export function updateJob(jobId, updates) {
  const p = path.join(dir("jobs"), `${jobId}.json`);
  const job = safeRead(p);
  if (!job) return null;
  Object.assign(job, updates);
  job.updated_at = new Date().toISOString();
  atomicWrite(p, job);
  return job;
}

// ── Activity log ──────────────────────────────────────────────────────────────

export function appendActivity(jobId, eventType, message) {
  const logDir = dir("logs");
  const logPath = path.join(logDir, `${jobId}.jsonl`);
  const line = JSON.stringify({
    job_id:     jobId,
    event_type: eventType,
    message,
    ts:         new Date().toISOString(),
  }) + "\n";
  fs.appendFileSync(logPath, line, "utf8");
}

// ── Checkpoints ───────────────────────────────────────────────────────────────

export function saveCheckpoint(jobId, data) {
  const p = path.join(dir("checkpoints"), `${jobId}.json`);
  atomicWrite(p, { job_id: jobId, ...data, saved_at: new Date().toISOString() });
}

export function loadCheckpoint(jobId) {
  return safeRead(path.join(dir("checkpoints"), `${jobId}.json`));
}

// ── Businesses ────────────────────────────────────────────────────────────────

export function saveBusiness(record) {
  const bizId = record.id;
  const shard = bizId.slice(0, 2);
  const shardDir = path.join(dir("businesses"), shard);
  fs.mkdirSync(shardDir, { recursive: true });
  const p = path.join(shardDir, `${bizId}.json`);
  atomicWrite(p, record);
}

export function getBusiness(bizId) {
  const shard = bizId.slice(0, 2);
  return safeRead(path.join(dir("businesses"), shard, `${bizId}.json`));
}
