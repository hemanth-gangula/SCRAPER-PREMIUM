/**
 * Load .env from the project root (one level above scraper-engine/).
 * Must be imported before anything else.
 */
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..", "..");
const envPath = path.join(root, ".env");

if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

export const CONFIG = {
  port:              parseInt(process.env.SCRAPER_WORKER_PORT  || "4001", 10),
  token:             process.env.SCRAPER_WORKER_TOKEN          || "dev-token",
  storageDir:        process.env.SCRAPER_STORAGE_DIR           || "./storage",
  chromiumPath:      process.env.CHROMIUM_EXECUTABLE_PATH      || "",
  headless:          (process.env.HEADLESS || "true") !== "false",
  requestDelayMs:    parseInt(process.env.REQUEST_DELAY_MS     || "1500", 10),
  pageLoadTimeout:   parseInt(process.env.PAGE_LOAD_TIMEOUT_MS || "30000", 10),
  maxConcurrentJobs: parseInt(process.env.MAX_CONCURRENT_JOBS  || "2", 10),
};
