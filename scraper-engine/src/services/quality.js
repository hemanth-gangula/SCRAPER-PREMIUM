/**
 * Quality score — mirrors Python quality.py.
 * Returns 0–100 completeness score.
 */

const WEIGHTS = {
  name:           20,
  phone:          15,
  email:          10,
  website:        10,
  category:        8,
  street_address:  8,
  city:            6,
  postal_code:     6,
  country:         4,
  rating:          5,
  review_count:    4,
  lat:             2,
  lng:             2,
};

export function qualityScore(record) {
  let total = 0;
  for (const [field, weight] of Object.entries(WEIGHTS)) {
    const val = record[field];
    if (val !== null && val !== undefined && val !== "" && val !== 0) {
      total += weight;
    }
  }
  return Math.min(100, total);
}
