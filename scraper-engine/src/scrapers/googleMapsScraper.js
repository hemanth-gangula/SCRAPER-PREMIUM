/**
 * Google Maps scraper — real Playwright automation, no API key required.
 *
 * Verified working strategy (Oct 2026):
 *   1. Open the search URL in a real Chromium browser
 *   2. Scroll the results feed to collect place URLs
 *   3. Navigate directly to each place URL → extract structured data
 *      (Direct navigation is required; clicking cards in headless mode
 *       does not load the detail panel reliably.)
 *   4. Dedup → quality score → save → checkpoint → log
 */

import { randomUUID } from "crypto";
import { newContext } from "../browser/manager.js";
import { buildSearchUrl, collectPlaceUrls, extractPlaceData } from "../extractors/googleMaps.js";
import { extractEmailFromWebsite } from "../extractors/emailExtractor.js";
import { checkDuplicate, registerRecord } from "../services/dedup.js";
import { qualityScore } from "../services/quality.js";
import { getTodayQuota, incrementQuota } from "../services/quota.js";
import {
  getJob, updateJob, appendActivity, saveCheckpoint, loadCheckpoint, saveBusiness,
} from "../utils/storage.js";
import { CONFIG } from "../utils/env.js";
import { logger } from "../utils/logger.js";

// ── Live progress (read by Flask via /worker/jobs/:id/progress) ───────────────
const liveProgress = new Map();

export function getLiveProgress(jobId) {
  return liveProgress.get(jobId) || null;
}

export function clearLiveProgress(jobId) {
  liveProgress.delete(jobId);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}

function setProgress(jobId, data) {
  liveProgress.set(jobId, { job_id: jobId, ...data });
}

// ── Main job runner ───────────────────────────────────────────────────────────

export async function runJob(jobId) {
  const job = getJob(jobId);
  if (!job) {
    logger.error("runJob: job not found", { jobId });
    return;
  }

  const startIdx = Math.max(1, parseInt(job.start_index || 1, 10));
  const endIdx = parseInt(job.end_index || 100, 10);
  const jobLimit = parseInt(job.job_limit || endIdx, 10);
  const dailyLim = parseInt(job.daily_limit || 500, 10);
  // Effective limit: the most unique records we will ever save.
  // This caps URL collection so we don't load 100 URLs for a 5-record job.
  const effectiveLimit = Math.min(endIdx - startIdx + 1, jobLimit);
  // Over-fetch factor: collect slightly more URLs than needed to account for
  // duplicates and extraction failures, but never load the full endIdx if
  // jobLimit is much smaller. Cap at 3× the limit or endIdx, whichever is smaller.
  const urlFetchTarget = Math.min(endIdx, Math.max(effectiveLimit * 3, effectiveLimit + 10));

  logger.info("Job starting", { jobId, query: job.search_query, effectiveLimit, jobLimit, endIdx });

  // Resume from checkpoint
  const ckpt = loadCheckpoint(jobId);
  let recordsSaved = ckpt?.records_saved ?? 0;
  let dupesSkipped = ckpt?.dupes_skipped ?? 0;
  let failedCount = 0;
  // Which URLs have already been processed (from checkpoint)
  const processedUrls = new Set(ckpt?.processed_urls ?? []);

  updateJob(jobId, {
    status: "running",
    started_at: new Date().toISOString(),
    worker_pid: process.pid,
  });
  appendActivity(jobId, "job_started",
    `Scraping started — target: ${effectiveLimit} unique records (over-fetch up to ${urlFetchTarget})`);
  setProgress(jobId, { status: "running", phase: "loading", records_saved: recordsSaved, dupes_skipped: 0, progress_pct: 0 });

  const searchUrl = buildSearchUrl(job);
  logger.info("Search URL", { jobId, url: searchUrl });
  appendActivity(jobId, "scraper_scrolling", `Search: ${searchUrl}`);

  let context = null;
  let searchPage = null;

  try {
    context = await newContext();
    searchPage = await context.newPage();

    // Block unnecessary resources to speed up loading
    await searchPage.route("**/*.{png,jpg,jpeg,gif,svg,woff,woff2,ttf}", route => route.abort());
    await searchPage.route("**/{analytics,gtag,fbevents,hotjar,clarity,doubleclick}**", route => route.abort());

    searchPage.setDefaultTimeout(CONFIG.pageLoadTimeout);

    logger.info("Loading search page...", { jobId });
    await searchPage.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: CONFIG.pageLoadTimeout });

    // Accept consent popups
    await searchPage.click('button:has-text("Accept all")', { timeout: 4000 }).catch(() => { });
    await searchPage.click('button:has-text("I agree")', { timeout: 2000 }).catch(() => { });
    await searchPage.click('button:has-text("Reject all")', { timeout: 2000 }).catch(() => { });
    await searchPage.waitForTimeout(2000);

    // ── Phase 1: Collect place URLs by scrolling ──────────────────────────
    appendActivity(jobId, "scraper_scrolling", `Loading up to ${urlFetchTarget} listings (need ${effectiveLimit} unique)…`);
    logger.info("Collecting place URLs...", { jobId, urlFetchTarget, effectiveLimit });

    const allUrls = await collectPlaceUrls(searchPage, urlFetchTarget, (count) => {
      setProgress(jobId, {
        status: "running",
        phase: "loading",
        records_saved: recordsSaved,
        dupes_skipped: dupesSkipped,
        current_index: count,
        progress_pct: Math.round((count / urlFetchTarget) * 40),
      });
    });

    const sliceStart = startIdx - 1;
    const targetUrls = allUrls.slice(sliceStart, sliceStart + urlFetchTarget);

    logger.info(`Collected ${allUrls.length} URLs, processing ${targetUrls.length} (need ${effectiveLimit} unique)`, { jobId });
    appendActivity(jobId, "listings_loaded", `${allUrls.length} listings found — processing ${targetUrls.length} (need ${effectiveLimit} unique)`);

    // Close the search page, we'll open fresh pages per place
    await searchPage.close().catch(() => { });
    searchPage = null;

    // ── Phase 2: Extract each place ───────────────────────────────────────
    for (let i = 0; i < targetUrls.length; i++) {
      // Check pause/cancel between each record
      const freshJob = getJob(jobId);
      if (!freshJob || ["paused", "cancelled"].includes(freshJob.status)) {
        const st = freshJob?.status ?? "gone";
        appendActivity(jobId, "job_interrupted", `Job ${st} at index ${i + startIdx}`);
        updateJob(jobId, {
          status: st === "cancelled" ? "cancelled" : "paused",
          records_saved: recordsSaved,
          dupes_skipped: dupesSkipped,
          current_index: i + startIdx,
          finished_at: st === "cancelled" ? new Date().toISOString() : null,
        });
        saveCheckpoint(jobId, {
          current_index: i + startIdx,
          records_saved: recordsSaved,
          dupes_skipped: dupesSkipped,
          processed_urls: [...processedUrls],
        });
        liveProgress.delete(jobId);
        await context.close().catch(() => { });
        return;
      }

      const placeUrl = targetUrls[i];
      const absIdx = i + startIdx;

      // Skip already-processed (resume case)
      const urlKey = placeUrl.split("@")[0].split("?")[0];
      if (processedUrls.has(urlKey)) {
        logger.debug("Skipping already-processed URL", { absIdx });
        continue;
      }

      const pct = Math.round(40 + (Math.min(recordsSaved, effectiveLimit) / effectiveLimit) * 60);
      setProgress(jobId, {
        status: "running",
        phase: "extracting",
        records_saved: recordsSaved,
        dupes_skipped: dupesSkipped,
        failed_records: failedCount,
        current_index: absIdx,
        progress_pct: pct,
      });

      // Open a fresh page for each place (more reliable in headless mode)
      const placePage = await context.newPage();
      await placePage.route("**/*.{png,jpg,jpeg,gif,svg,woff,woff2,ttf}", route => route.abort());

      let raw = null;
      try {
        raw = await extractPlaceData(placePage, placeUrl, CONFIG.pageLoadTimeout);
      } catch (extractErr) {
        logger.warn("Extract error", { jobId, absIdx, error: extractErr.message });
      } finally {
        await placePage.close().catch(() => { });
      }

      if (!raw || !raw.name) {
        failedCount++;
        logger.warn("No data extracted", { jobId, absIdx, url: placeUrl.substring(0, 80) });
        appendActivity(jobId, "extract_failed", `Index ${absIdx}: could not extract data`);
        await sleep(randInt(500, 1000));
        continue;
      }

      logger.info("Extracted", { jobId, absIdx, name: raw.name, phone: raw.phone, addr: raw.full_address });

      // ── Dedup check ───────────────────────────────────────────────────
      const dedupResult = checkDuplicate(raw);
      if (dedupResult.isDuplicate) {
        dupesSkipped++;
        logger.debug("Duplicate skipped", { tier: dedupResult.matchTier, name: raw.name });
        processedUrls.add(urlKey);
        await sleep(randInt(200, 500));
        continue;
      }

      // ── Daily quota check ──────────────────────────────────────────────
      const quota = getTodayQuota(dailyLim);
      if (quota.exhausted) {
        appendActivity(jobId, "quota_exhausted",
          `Daily quota exhausted (${quota.used}/${quota.limit}) — pausing job`);
        updateJob(jobId, {
          status: "paused",
          records_saved: recordsSaved,
          dupes_skipped: dupesSkipped,
          current_index: absIdx,
          last_error: "Daily quota exhausted",
        });
        saveCheckpoint(jobId, {
          current_index: absIdx,
          records_saved: recordsSaved,
          dupes_skipped: dupesSkipped,
          processed_urls: [...processedUrls],
        });
        liveProgress.delete(jobId);
        await context.close().catch(() => { });
        return;
      }

      // ── Save record ────────────────────────────────────────────────────
      const bizId = randomUUID();
      const now = new Date().toISOString();
      const record = {
        ...raw,
        id: bizId,
        job_id: jobId,
        quality_score: qualityScore(raw),
        first_seen_at: now,
        last_scraped_at: now,
      };

      saveBusiness(record);
      registerRecord(raw, bizId);
      incrementQuota(1, dailyLim);
      processedUrls.add(urlKey);
      recordsSaved++;

      appendActivity(jobId, "record_saved",
        `Saved: ${raw.name}${raw.city ? " · " + raw.city : ""}${raw.phone ? " · " + raw.phone : ""}`
      );

      // ── Email extraction (second pass on website) ──────────────────────
      if (raw.website && !raw.email) {
        try {
          const foundEmail = await extractEmailFromWebsite(context, raw.website, 12000);
          if (foundEmail) {
            record.email = foundEmail;
            record.quality_score = qualityScore(record);
            saveBusiness(record);
            appendActivity(jobId, "email_found",
              `Email found for ${raw.name}: ${foundEmail}`);
            logger.info("Email extracted", { jobId, name: raw.name, email: foundEmail });
          }
        } catch (emailErr) {
          logger.debug("Email extraction skipped", { name: raw.name, error: emailErr.message });
        }
      }

      setProgress(jobId, {
        status: "running",
        phase: "extracting",
        records_saved: recordsSaved,
        dupes_skipped: dupesSkipped,
        failed_records: failedCount,
        current_index: absIdx,
        progress_pct: pct,
        current_business: raw.name,
      });

      // Checkpoint every 5 records
      if (recordsSaved % 5 === 0) {
        saveCheckpoint(jobId, {
          current_index: absIdx,
          records_saved: recordsSaved,
          dupes_skipped: dupesSkipped,
          processed_urls: [...processedUrls],
        });
        updateJob(jobId, {
          records_saved: recordsSaved,
          dupes_skipped: dupesSkipped,
          current_index: absIdx,
          progress_pct: pct,
        });
      }

      // Check job limit — stop once we have enough unique records
      if (recordsSaved >= effectiveLimit) {
        appendActivity(jobId, "job_limit_reached",
          `Unique record limit reached: ${recordsSaved}/${effectiveLimit}`);
        break;
      }

      // Polite delay
      await sleep(CONFIG.requestDelayMs + randInt(0, 800));
    }

    // ── Job complete ───────────────────────────────────────────────────────
    updateJob(jobId, {
      status: "completed",
      records_saved: recordsSaved,
      dupes_skipped: dupesSkipped,
      failed_records: failedCount,
      current_index: endIdx,
      progress_pct: 100,
      finished_at: new Date().toISOString(),
    });
    appendActivity(jobId, "job_completed",
      `Done — ${recordsSaved}/${effectiveLimit} unique saved, ${dupesSkipped} dupes skipped, ${failedCount} failed`);
    logger.info("Job completed", { jobId, recordsSaved, effectiveLimit, dupesSkipped, failedCount });

  } catch (err) {
    logger.error("Job failed", { jobId, error: err.message, stack: err.stack });
    updateJob(jobId, {
      status: "failed",
      last_error: err.message,
      finished_at: new Date().toISOString(),
    });
    appendActivity(jobId, "job_failed", `Job failed: ${err.message}`);
  } finally {
    liveProgress.delete(jobId);
    if (searchPage) await searchPage.close().catch(() => { });
    if (context) await context.close().catch(() => { });
  }
}
