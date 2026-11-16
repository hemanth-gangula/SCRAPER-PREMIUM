/**
 * Unit tests for the quota service.
 * Run with: node --test tests/quota.test.js
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "quota-test-"));
process.env.SCRAPER_STORAGE_DIR = TMP;

const { getTodayQuota, incrementQuota } = await import("../src/services/quota.js");

describe("getTodayQuota", () => {
  it("returns full remaining when no quota file exists", () => {
    const q = getTodayQuota(100);
    assert.equal(q.used, 0);
    assert.equal(q.limit, 100);
    assert.equal(q.remaining, 100);
    assert.equal(q.exhausted, false);
  });
});

describe("incrementQuota", () => {
  it("increments used count and persists", () => {
    incrementQuota(10, 100);
    const q = getTodayQuota(100);
    assert.equal(q.used, 10);
    assert.equal(q.remaining, 90);
  });

  it("marks exhausted when limit reached", () => {
    incrementQuota(90, 100); // 10 + 90 = 100
    const q = getTodayQuota(100);
    assert.equal(q.exhausted, true);
    assert.equal(q.remaining, 0);
  });
});

after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});
