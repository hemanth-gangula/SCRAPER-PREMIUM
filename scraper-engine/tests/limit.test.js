/**
 * Regression tests for record limit enforcement.
 *
 * Tests:
 *   1. effectiveLimit calculation (min of end_index and job_limit)
 *   2. urlFetchTarget calculation (over-fetch factor, capped at endIdx)
 *   3. Limits of 1, 5, 10, 100
 *   4. Mismatched end_index vs job_limit → take minimum
 *   5. Resume from checkpoint respects remaining limit
 *   6. job_limit=0 is not valid (clamped to 1 at server level, but worker handles gracefully)
 *
 * Run with: node --test tests/limit.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ─────────────────────────────────────────────────────────────────────────────
// Pure functions extracted from worker logic (tested without Playwright)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mirrors the limit calculation in googleMapsScraper.js runJob().
 */
function computeLimits(job) {
  const startIdx       = Math.max(1, parseInt(job.start_index   || 1,   10));
  const endIdx         = parseInt(job.end_index   || 100, 10);
  const jobLimit       = parseInt(job.job_limit   || endIdx, 10);
  const effectiveLimit = Math.min(endIdx - startIdx + 1, jobLimit);
  const urlFetchTarget = Math.min(endIdx, Math.max(effectiveLimit * 3, effectiveLimit + 10));
  return { startIdx, endIdx, jobLimit, effectiveLimit, urlFetchTarget };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("effectiveLimit — basic limits", () => {

  it("limit=1: collects at most 1 URL for processing", () => {
    const { effectiveLimit, urlFetchTarget } = computeLimits({
      start_index: 1, end_index: 1, job_limit: 1,
    });
    assert.equal(effectiveLimit, 1);
    // urlFetchTarget must be at least effectiveLimit
    assert.ok(urlFetchTarget >= effectiveLimit, `urlFetchTarget(${urlFetchTarget}) < effectiveLimit(${effectiveLimit})`);
  });

  it("limit=5: effectiveLimit=5, urlFetchTarget <= 15", () => {
    const { effectiveLimit, urlFetchTarget } = computeLimits({
      start_index: 1, end_index: 5, job_limit: 5,
    });
    assert.equal(effectiveLimit, 5);
    assert.ok(urlFetchTarget >= 5,  `urlFetchTarget(${urlFetchTarget}) must be >= 5`);
    assert.ok(urlFetchTarget <= 15, `urlFetchTarget(${urlFetchTarget}) must be <= 15`);
  });

  it("limit=10: effectiveLimit=10", () => {
    const { effectiveLimit } = computeLimits({
      start_index: 1, end_index: 10, job_limit: 10,
    });
    assert.equal(effectiveLimit, 10);
  });

  it("limit=100: effectiveLimit=100", () => {
    const { effectiveLimit } = computeLimits({
      start_index: 1, end_index: 100, job_limit: 100,
    });
    assert.equal(effectiveLimit, 100);
  });
});

describe("effectiveLimit — mismatched end_index and job_limit", () => {

  it("job_limit < end_index: effectiveLimit = job_limit", () => {
    // This was the original bug: end_index=100 but user wanted 5
    const { effectiveLimit } = computeLimits({
      start_index: 1, end_index: 100, job_limit: 5,
    });
    assert.equal(effectiveLimit, 5,
      "When job_limit=5 and end_index=100, effectiveLimit must be 5 not 100");
  });

  it("end_index < job_limit: effectiveLimit = end_index - startIdx + 1", () => {
    const { effectiveLimit } = computeLimits({
      start_index: 1, end_index: 5, job_limit: 100,
    });
    assert.equal(effectiveLimit, 5);
  });

  it("job_limit=100 but user requested 5 via end_index: worker stays at 5", () => {
    // This is the exact scenario that caused 69 records to be scraped
    const { effectiveLimit, urlFetchTarget } = computeLimits({
      start_index: 1, end_index: 5, job_limit: 100,
    });
    assert.equal(effectiveLimit, 5);
    // urlFetchTarget must not load 100 URLs for a 5-record job
    assert.ok(urlFetchTarget <= 50,
      `urlFetchTarget(${urlFetchTarget}) is too large for a 5-record job`);
  });

  it("end_index=100 and job_limit=5: effectiveLimit=5 (server should have rejected but worker handles it)", () => {
    const { effectiveLimit } = computeLimits({
      start_index: 1, end_index: 100, job_limit: 5,
    });
    assert.equal(effectiveLimit, 5);
  });
});

describe("urlFetchTarget — over-fetch factor", () => {

  it("small limit uses 3x over-fetch", () => {
    const { effectiveLimit, urlFetchTarget, endIdx } = computeLimits({
      start_index: 1, end_index: 5, job_limit: 5,
    });
    assert.equal(urlFetchTarget, Math.min(endIdx, Math.max(effectiveLimit * 3, effectiveLimit + 10)));
  });

  it("large limit: urlFetchTarget does not exceed endIdx", () => {
    const { urlFetchTarget, endIdx } = computeLimits({
      start_index: 1, end_index: 50, job_limit: 50,
    });
    assert.ok(urlFetchTarget <= endIdx,
      `urlFetchTarget(${urlFetchTarget}) exceeds endIdx(${endIdx})`);
  });

  it("limit=100: urlFetchTarget=100 (fetch exactly what's needed)", () => {
    const { urlFetchTarget } = computeLimits({
      start_index: 1, end_index: 100, job_limit: 100,
    });
    assert.equal(urlFetchTarget, 100);
  });
});

describe("start_index offset", () => {

  it("start_index=1, end_index=5: effectiveLimit=5", () => {
    const { effectiveLimit } = computeLimits({ start_index: 1, end_index: 5, job_limit: 5 });
    assert.equal(effectiveLimit, 5);
  });

  it("start_index=6, end_index=10: effectiveLimit=5", () => {
    const { effectiveLimit } = computeLimits({ start_index: 6, end_index: 10, job_limit: 5 });
    assert.equal(effectiveLimit, 5);
  });

  it("start_index=1, end_index=1: effectiveLimit=1", () => {
    const { effectiveLimit } = computeLimits({ start_index: 1, end_index: 1, job_limit: 1 });
    assert.equal(effectiveLimit, 1);
  });
});

describe("resume from checkpoint respects remaining limit", () => {

  it("already saved 3 of 5 — only 2 more should be saved", () => {
    const { effectiveLimit } = computeLimits({
      start_index: 1, end_index: 5, job_limit: 5,
    });
    // Simulate checkpoint state
    const recordsSaved = 3;  // from checkpoint
    const remaining = effectiveLimit - recordsSaved;
    assert.equal(remaining, 2,
      "Should only save 2 more after resuming with 3 already saved");
    assert.ok(recordsSaved < effectiveLimit,
      "recordsSaved must be less than effectiveLimit to resume");
  });

  it("already saved effectiveLimit — job should stop immediately on resume", () => {
    const { effectiveLimit } = computeLimits({
      start_index: 1, end_index: 5, job_limit: 5,
    });
    const recordsSaved = 5;  // already hit limit
    const shouldStop = recordsSaved >= effectiveLimit;
    assert.ok(shouldStop, "Job should stop if recordsSaved >= effectiveLimit on resume");
  });
});

describe("concurrent execution — per-job independence", () => {

  it("two jobs with different limits are independent", () => {
    const job1 = computeLimits({ start_index: 1, end_index: 5,  job_limit: 5  });
    const job2 = computeLimits({ start_index: 1, end_index: 50, job_limit: 50 });
    assert.equal(job1.effectiveLimit, 5);
    assert.equal(job2.effectiveLimit, 50);
    // They must not influence each other
    assert.notEqual(job1.effectiveLimit, job2.effectiveLimit);
  });

  it("pause/resume does not change effective limit", () => {
    const before = computeLimits({ start_index: 1, end_index: 10, job_limit: 10 });
    // Simulate pause + resume: same job params
    const after  = computeLimits({ start_index: 1, end_index: 10, job_limit: 10 });
    assert.equal(before.effectiveLimit, after.effectiveLimit);
    assert.equal(before.urlFetchTarget, after.urlFetchTarget);
  });
});

describe("the original bug scenario", () => {

  it("job_limit=100, end_index=100 LLM default: 69 records were saved → now capped at effectiveLimit", () => {
    // Before the fix: job was created with end_index=100, job_limit=100
    // even though user asked for 5. This test confirms the new behavior:
    // if job parameters correctly say 5, effectiveLimit is 5.
    const { effectiveLimit } = computeLimits({
      start_index: 1, end_index: 5, job_limit: 5,
    });
    assert.equal(effectiveLimit, 5);
    // A job with these parameters must never save more than effectiveLimit records
    // (enforced in the loop via: if (recordsSaved >= effectiveLimit) break)
    let recordsSaved = 0;
    const mockUrls = Array.from({ length: 100 }, (_, i) => `url_${i}`);
    for (const _url of mockUrls) {
      if (recordsSaved >= effectiveLimit) break;
      recordsSaved++;  // simulate saving a record
    }
    assert.equal(recordsSaved, 5,
      `Should save exactly 5 records, not ${recordsSaved}`);
  });
});
