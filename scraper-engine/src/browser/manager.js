/**
 * Browser lifecycle manager.
 * Keeps a single Playwright Chromium instance alive for the duration of the
 * worker process; vends reusable browser contexts per scrape session.
 */

import { chromium } from "playwright";
import { CONFIG } from "../utils/env.js";
import { logger } from "../utils/logger.js";

let _browser = null;

export async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  logger.info("Launching Chromium browser", {
    headless: CONFIG.headless,
    executablePath: CONFIG.chromiumPath || "(playwright bundled)",
  });

  const launchOptions = {
    headless: CONFIG.headless,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
      "--lang=en-US,en",
    ],
  };

  if (CONFIG.chromiumPath) {
    launchOptions.executablePath = CONFIG.chromiumPath;
  }

  _browser = await chromium.launch(launchOptions);
  _browser.on("disconnected", () => {
    logger.warn("Browser disconnected");
    _browser = null;
  });
  return _browser;
}

export async function newContext() {
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    locale: "en-US",
    timezoneId: "America/New_York",
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  return ctx;
}

export async function closeBrowser() {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
  }
}
