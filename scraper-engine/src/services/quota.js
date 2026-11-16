/**
 * Daily quota check — reads storage/quotas/YYYY-MM-DD.json.
 * The Node worker checks quota before saving each record.
 * Actual increment is done by the Python backend when it receives the record;
 * here we just do a lightweight read-only check.
 */

import fs from "fs";
import path from "path";
import { CONFIG } from "../utils/env.js";

const root = path.isAbsolute(CONFIG.storageDir)
  ? CONFIG.storageDir
  : path.resolve(process.cwd(), "..", CONFIG.storageDir);

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function quotaPath(dateKey) {
  const dir = path.join(root, "quotas");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${dateKey}.json`);
}

/**
 * Returns { used, limit, remaining, exhausted }.
 * @param {number} limit  default daily limit from config
 */
export function getTodayQuota(limit = 500) {
  try {
    const raw = fs.readFileSync(quotaPath(todayKey()), "utf8");
    const data = JSON.parse(raw);
    const used = data.used || 0;
    return { used, limit: data.limit || limit, remaining: Math.max((data.limit || limit) - used, 0), exhausted: used >= (data.limit || limit) };
  } catch {
    return { used: 0, limit, remaining: limit, exhausted: false };
  }
}

/**
 * Atomically increment quota by `count` and persist.
 */
export function incrementQuota(count = 1, limit = 500) {
  const dateKey = todayKey();
  const p = quotaPath(dateKey);
  let data = { date: dateKey, used: 0, limit };
  try {
    data = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { /* first write */ }
  data.used = (data.used || 0) + count;
  data.remaining = Math.max((data.limit || limit) - data.used, 0);
  data.exhausted  = data.used >= (data.limit || limit);
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data), "utf8");
  fs.renameSync(tmp, p);
  return data;
}
