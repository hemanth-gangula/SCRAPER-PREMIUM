/**
 * Google Maps extractor — selectors verified against live Google Maps (Oct 2026).
 *
 * Strategy:
 *   1. Search URL → load the results feed
 *   2. Collect all place hrefs from the feed (scroll to load more)
 *   3. For each place: navigate directly to its URL → extract from the detail page
 *      (Direct navigation is required in headless mode — clicking cards in the list
 *       does not reliably render the detail panel.)
 */

import { logger } from "../utils/logger.js";

const MAPS_SEARCH_BASE = "https://www.google.com/maps/search/";

// ── Search URL builder ────────────────────────────────────────────────────────

export function buildSearchUrl(config) {
  const parts = [];
  if (config.search_query) parts.push(config.search_query);
  if (config.category && config.category !== config.search_query) parts.push(config.category);
  if (config.city) parts.push(config.city);
  if (config.state_region) parts.push(config.state_region);
  if (config.country) parts.push(config.country);
  if (config.postal_code) parts.push(config.postal_code);
  const query = parts.filter(Boolean).join(" ").trim();
  return `${MAPS_SEARCH_BASE}${encodeURIComponent(query)}/?hl=en`;
}

// ── Results feed: scroll & collect hrefs ─────────────────────────────────────

/**
 * Load the search results page and scroll until we have `targetCount` place hrefs.
 * Returns an array of absolute place URLs (strings, not elements).
 */
export async function collectPlaceUrls(page, targetCount, onProgress) {
  const FEED_SEL = 'div[role="feed"]';
  const CARD_SEL = 'a[href*="/maps/place/"]';

  // Wait for the results panel
  await page.waitForSelector(CARD_SEL, { timeout: 20000 });
  await page.waitForTimeout(1000);

  const seenUrls = new Set();
  let stall = 0;
  const maxScrolls = Math.ceil(targetCount / 5) + 30;

  for (let i = 0; i < maxScrolls; i++) {
    // Collect all hrefs currently in DOM
    const hrefs = await page.$$eval(CARD_SEL, els =>
      els.map(el => el.href).filter(h => h && h.includes("/maps/place/"))
    );

    let newFound = 0;
    for (const href of hrefs) {
      // Deduplicate by place path (strip query params for dedup key)
      const key = href.split("@")[0].split("?")[0];
      if (!seenUrls.has(key)) {
        seenUrls.add(key);
        newFound++;
      }
    }

    onProgress?.(seenUrls.size);

    if (seenUrls.size >= targetCount) break;

    // Check end-of-results sentinel
    const endText = await page.evaluate(() => {
      const spans = [...document.querySelectorAll("span, p")];
      for (const s of spans) {
        const t = s.textContent || "";
        if (t.includes("end of list") || t.includes("You've reached the end")) return t;
      }
      return "";
    }).catch(() => "");
    if (endText) { logger.info("End of results reached"); break; }

    if (newFound === 0) {
      stall++;
      if (stall >= 6) break;
    } else {
      stall = 0;
    }

    // Scroll the feed
    await page.evaluate((sel) => {
      const feed = document.querySelector(sel);
      if (feed) feed.scrollBy(0, 800);
      else window.scrollBy(0, 800);
    }, FEED_SEL).catch(() => page.mouse.wheel(0, 800));

    await page.waitForTimeout(1200 + Math.random() * 600);
  }

  // Return all unique hrefs, preserving original full URL
  const allHrefs = await page.$$eval(CARD_SEL, els =>
    [...new Map(
      els.map(el => [el.href.split("@")[0].split("?")[0], el.href])
    ).values()]
  );

  return allHrefs.slice(0, targetCount);
}

// ── Detail page extractor ─────────────────────────────────────────────────────

/**
 * Navigate to a place URL and extract all structured data.
 * Returns a record object or null on failure.
 */
export async function extractPlaceData(page, placeUrl, timeout = 25000) {
  try {
    await page.goto(placeUrl, { waitUntil: "domcontentloaded", timeout });

    // Wait for the business name heading to appear
    await page.waitForSelector("h1", { timeout: 12000 }).catch(() => { });
    await page.waitForTimeout(1500);

    return await page.evaluate(() => {
      // ── Helpers ────────────────────────────────────────────────────────────
      const $text = (sel) => document.querySelector(sel)?.textContent?.trim() || "";
      const $attr = (sel, a) => document.querySelector(sel)?.getAttribute(a) || "";

      // ── Name ───────────────────────────────────────────────────────────────
      // h1.DUwDvf is the confirmed class as of Oct 2026
      const name =
        $text("h1.DUwDvf") ||
        $text("h1.fontHeadlineLarge") ||
        $text("h1") ||
        "";

      // ── Category ───────────────────────────────────────────────────────────
      // The category sits in a button right below the name, or as the second button text
      const categoryEl =
        document.querySelector('button[jsaction*="category"]') ||
        document.querySelector(".DkEaL") ||
        // fallback: find a button whose text matches typical category patterns
        [...document.querySelectorAll("button")].find(b => {
          const t = b.textContent.trim();
          return t.length > 2 && t.length < 40 && !t.match(/^\d/) &&
            !["Directions", "Save", "Share", "Nearby", "Overview", "Reviews", "About"].includes(t);
        });
      const category = categoryEl?.textContent?.trim() || "";

      // ── Rating & review count ──────────────────────────────────────────────
      // aria-label="4.5 stars 1,234 reviews"  OR  aria-label="Rated 4.5 out of 5"
      let rating = null;
      let reviewCount = null;
      const ratingEl = document.querySelector('[aria-label*=" stars"]') ||
        document.querySelector('[aria-label*="stars"]') ||
        document.querySelector('[aria-label*="Rated"]');
      if (ratingEl) {
        const lbl = ratingEl.getAttribute("aria-label") || "";
        const rMatch = lbl.match(/(\d+\.?\d*)\s*star/i);
        if (rMatch) rating = parseFloat(rMatch[1]);
        const rvMatch = lbl.match(/([\d,]+)\s+review/i);
        if (rvMatch) reviewCount = parseInt(rvMatch[1].replace(/,/g, ""));
      }
      // Fallback: visible rating text
      if (!rating) {
        const visRating = document.querySelector(".F7nice span[aria-hidden]")?.textContent?.trim() ||
          document.querySelector("span.MW4etd")?.textContent?.trim();
        if (visRating) rating = parseFloat(visRating) || null;
      }
      if (!reviewCount) {
        const visReviews = document.querySelector(".F7nice span:last-child")?.textContent?.trim() ||
          document.querySelector("span.UY7F9")?.textContent?.trim() || "";
        const m = visReviews.replace(/[()]/g, "").replace(/,/g, "").match(/(\d+)/);
        if (m) reviewCount = parseInt(m[1]);
      }

      // ── Address ────────────────────────────────────────────────────────────
      // data-item-id="address" is confirmed working
      const addrEl = document.querySelector('button[data-item-id="address"]') ||
        document.querySelector('[aria-label^="Address:"]');
      const fullAddress = addrEl?.textContent?.trim() ||
        addrEl?.getAttribute("aria-label")?.replace("Address: ", "").trim() || "";

      // Parse "123 Main St, City, ST 12345, Country"
      const addrParts = fullAddress.split(",").map(s => s.trim()).filter(Boolean);
      let streetAddress = "", city = "", stateRegion = "", postalCode = "", country = "";
      if (addrParts.length >= 2) {
        streetAddress = addrParts[0];
        if (addrParts.length === 2) {
          city = addrParts[1];
        } else if (addrParts.length === 3) {
          city = addrParts[1];
          country = addrParts[2];
        } else if (addrParts.length === 4) {
          city = addrParts[1];
          // "NY 10014" or "NY" only
          const sp = addrParts[2].trim().split(/\s+/);
          stateRegion = sp[0] || "";
          postalCode = sp[1] || "";
          country = addrParts[3];
        } else if (addrParts.length >= 5) {
          city = addrParts[1];
          stateRegion = addrParts[2];
          postalCode = addrParts[3];
          country = addrParts[4];
        }
      }

      // ── Phone ──────────────────────────────────────────────────────────────
      // data-item-id starts with "phone:" e.g. "phone:tel:+12122436546"
      const phoneEl = document.querySelector('button[data-item-id^="phone:"]') ||
        document.querySelector('[aria-label^="Phone:"]');
      const phone = phoneEl?.textContent?.trim() ||
        phoneEl?.getAttribute("aria-label")?.replace(/^Phone:\s*/, "").trim() || "";

      // ── Website ────────────────────────────────────────────────────────────
      // data-item-id="authority" is the website link
      const websiteEl = document.querySelector('a[data-item-id="authority"]') ||
        document.querySelector('[aria-label^="Website:"]');
      const websiteText = websiteEl?.textContent?.trim() || "";
      const websiteHref = websiteEl?.href || "";
      // Prefer the href; if it's a google redirect, use the label text
      let website = "";
      if (websiteHref && !websiteHref.includes("google.com/url")) {
        website = websiteHref;
      } else if (websiteText) {
        website = websiteText.startsWith("http") ? websiteText : "https://" + websiteText;
      }

      // ── Place ID from URL ──────────────────────────────────────────────────
      const urlStr = window.location.href;
      // /maps/place/NAME/data=...!1s0xPLACEID...
      const placeIdMatch = urlStr.match(/!1s([^!]+)/);
      const placeId = placeIdMatch ? decodeURIComponent(placeIdMatch[1]) : "";

      // ── Lat/Lng from URL ───────────────────────────────────────────────────
      // The @ coordinate appears in the URL after Maps loads the place
      // e.g. /maps/place/NAME/@40.7302,-73.9995,17z/data=...
      const coordMatch = urlStr.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
      let lat = coordMatch ? parseFloat(coordMatch[1]) : null;
      let lng = coordMatch ? parseFloat(coordMatch[2]) : null;
      // Fallback: some place URLs encode coords in the data= blob differently
      if (!lat) {
        const llMatch = urlStr.match(/3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
        if (llMatch) { lat = parseFloat(llMatch[1]); lng = parseFloat(llMatch[2]); }
      }

      // ── Price level ───────────────────────────────────────────────────────
      const priceEl = document.querySelector('[aria-label*="Price"]') ||
        [...document.querySelectorAll("span")].find(s => /^\$+$/.test(s.textContent.trim()));
      const priceLevel = priceEl?.getAttribute("aria-label") || priceEl?.textContent?.trim() || "";

      // ── Opening hours ─────────────────────────────────────────────────────
      const hoursEls = document.querySelectorAll('[aria-label*=", Copy open hours"]');
      const hours = {};
      hoursEls.forEach(el => {
        const lbl = el.getAttribute("aria-label") || "";
        // "Monday, 11am to 12am, Copy open hours"
        const parts = lbl.split(", Copy")[0].split(/, (.+)/);
        if (parts.length >= 2) hours[parts[0]] = parts[1];
      });

      return {
        name,
        category,
        rating,
        review_count: reviewCount,
        phone,
        website,
        street_address: streetAddress,
        city,
        state_region: stateRegion,
        postal_code: postalCode,
        country,
        full_address: fullAddress,
        place_id: placeId,
        source_url: urlStr,
        source: "google_maps",
        lat,
        lng,
        hours,
        price_level: priceLevel,
      };
    });
  } catch (err) {
    logger.warn("extractPlaceData failed", { url: placeUrl.substring(0, 80), error: err.message });
    return null;
  }
}
