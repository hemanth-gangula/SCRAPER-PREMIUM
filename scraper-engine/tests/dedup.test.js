/**
 * Unit tests for the deduplication service.
 * Run with: node --test tests/dedup.test.js
 * (Node.js built-in test runner — no test framework needed)
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";

// Point storage at a temp dir before importing dedup
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dedup-test-"));
process.env.SCRAPER_STORAGE_DIR = TMP;

const { checkDuplicate, registerRecord } = await import("../src/services/dedup.js");

describe("checkDuplicate", () => {
  it("returns isDuplicate=false for a fresh record", () => {
    const record = {
      name: "Acme Corp",
      phone: "+1 555-100-0001",
      city: "Austin",
      country: "US",
    };
    const result = checkDuplicate(record);
    assert.equal(result.isDuplicate, false);
  });

  it("detects a duplicate by phone (tier 3)", () => {
    const record = { name: "Acme Corp", phone: "5550010001", city: "Austin", country: "US" };
    registerRecord(record, "biz-001");

    // Same phone, different name
    const dup = { name: "Acme Different Name", phone: "555-001-0001" };
    const result = checkDuplicate(dup);
    assert.equal(result.isDuplicate, true);
    assert.equal(result.matchTier, "phone");
    assert.equal(result.existingId, "biz-001");
  });

  it("detects a duplicate by place_id (tier 1)", () => {
    const record = { name: "Pizza Palace", place_id: "ChIJxyz123", city: "Dallas" };
    registerRecord(record, "biz-002");

    const dup = { name: "Pizza Palace", place_id: "ChIJxyz123", city: "Houston" };
    const result = checkDuplicate(dup);
    assert.equal(result.isDuplicate, true);
    assert.equal(result.matchTier, "place_id");
  });

  it("detects duplicate by website domain (tier 4)", () => {
    const record = { name: "Tech Co", website: "https://www.techco.com", city: "NYC" };
    registerRecord(record, "biz-003");

    const dup = { name: "Tech Co LLC", website: "http://techco.com/about" };
    const result = checkDuplicate(dup);
    assert.equal(result.isDuplicate, true);
    assert.equal(result.matchTier, "domain");
  });

  it("does not flag as duplicate when only name matches (no address)", () => {
    const record = { name: "Generic Store" };
    registerRecord(record, "biz-004");

    // Same name but no address — tier-5 requires both name AND address
    const other = { name: "Generic Store" };
    const result = checkDuplicate(other);
    // With no address, tier-5 won't fire; phone/domain/place_id not set either
    assert.equal(result.isDuplicate, false);
  });
});

describe("normalization", () => {
  it("strips country code from phone", () => {
    const r1 = { phone: "+1 (555) 200-0001", place_id: "uniq-ph-1" };
    const r2 = { phone: "555-200-0001",       place_id: "uniq-ph-2" };
    registerRecord(r1, "ph-biz-1");
    const result = checkDuplicate(r2);
    assert.equal(result.isDuplicate, true, "E.164 and local format should match");
  });
});

after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});
