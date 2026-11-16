/**
 * Deduplication check — mirrors the Python dedup.py logic.
 * Reads/writes the same storage/deduplication/index.json file so both
 * the Python backend and Node worker share one consistent index.
 */

import fs from "fs";
import path from "path";
import { CONFIG } from "../utils/env.js";

const root = path.isAbsolute(CONFIG.storageDir)
  ? CONFIG.storageDir
  : path.resolve(process.cwd(), "..", CONFIG.storageDir);

const dedupDir  = path.join(root, "deduplication");
const indexPath = path.join(dedupDir, "index.json");

let _cache = null;

function loadIndex() {
  if (_cache) return _cache;
  try {
    fs.mkdirSync(dedupDir, { recursive: true });
    _cache = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  } catch {
    _cache = {};
  }
  return _cache;
}

function saveIndex() {
  const tmp = indexPath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(_cache || {}), "utf8");
  fs.renameSync(tmp, indexPath);
}

function normPhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return d.length >= 7 ? d : null;
}

function normDomain(url) {
  if (!url) return null;
  try {
    if (!url.includes("://")) url = "http://" + url;
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}

function normText(s) {
  if (!s) return "";
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(llc|ltd|inc|corp|co\.?|company|plc|gmbh|bv|sa|srl|pty|pvt|the)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fingerprints(record) {
  const fps = [];

  for (const field of ["place_id", "source_id", "maps_place_id"]) {
    const val = (record[field] || "").toString().trim();
    if (val && val !== "None") {
      fps.push(["place_id", val]);
      break;
    }
  }

  const srcUrl = (record.source_url || "").trim();
  if (srcUrl) fps.push(["source_url", srcUrl.toLowerCase()]);

  const ph = normPhone(record.phone || "");
  if (ph) fps.push(["phone", ph]);

  const dom = normDomain(record.website || "");
  if (dom) fps.push(["domain", dom]);

  const nameN = normText(record.name || "");
  const addrN = [record.street_address, record.city, record.postal_code]
    .filter(Boolean).map(normText).join(" ");
  if (nameN && addrN) fps.push(["name_addr", `${nameN}||${addrN}`]);

  return fps;
}

export function checkDuplicate(record) {
  const idx = loadIndex();
  for (const [tier, fp] of fingerprints(record)) {
    const key = `${tier}:${fp}`;
    if (key in idx) {
      return { isDuplicate: true, existingId: idx[key], matchTier: tier };
    }
  }
  return { isDuplicate: false };
}

export function registerRecord(record, businessId) {
  loadIndex();
  for (const [tier, fp] of fingerprints(record)) {
    const key = `${tier}:${fp}`;
    if (!(_cache[key])) _cache[key] = businessId;
  }
  saveIndex();
}
