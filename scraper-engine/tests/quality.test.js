/**
 * Unit tests for the quality scoring service.
 * Run with: node --test tests/quality.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { qualityScore } from "../src/services/quality.js";

describe("qualityScore", () => {
  it("returns 0 for an empty record", () => {
    assert.equal(qualityScore({}), 0);
  });

  it("gives 20 for name only", () => {
    assert.equal(qualityScore({ name: "Acme" }), 20);
  });

  it("gives full 100 for a complete record", () => {
    const full = {
      name:           "Acme Co",
      phone:          "555-000-0000",
      email:          "hi@acme.com",
      website:        "https://acme.com",
      category:       "Plumber",
      street_address: "123 Main St",
      city:           "Springfield",
      postal_code:    "62701",
      country:        "US",
      rating:         4.5,
      review_count:   200,
      lat:            39.7,
      lng:            -89.6,
    };
    assert.equal(qualityScore(full), 100);
  });

  it("scores 0 for fields that are null or empty string", () => {
    assert.equal(qualityScore({ name: null, phone: "" }), 0);
  });

  it("does not exceed 100", () => {
    const over = {
      name: "X", phone: "Y", email: "Z", website: "W",
      category: "C", street_address: "S", city: "C2",
      postal_code: "P", country: "Co", rating: 5,
      review_count: 100, lat: 1, lng: 2,
      extra_bonus_field: "should not add points",
    };
    assert.ok(qualityScore(over) <= 100);
  });
});
