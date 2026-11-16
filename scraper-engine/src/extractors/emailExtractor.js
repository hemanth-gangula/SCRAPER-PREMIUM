/**
 * Email extractor — visits a business website and finds contact emails.
 *
 * Strategy (in priority order):
 *   1. Scan all mailto: links on the homepage
 *   2. Scan visible text for email patterns
 *   3. Try /contact, /contact-us, /about pages
 *   4. Score and deduplicate results, prefer info@/contact@/hello@ over noreply@
 *
 * No API key needed — pure Playwright page scraping.
 */

import { logger } from "../utils/logger.js";

// Email regex — handles most real-world formats
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// Emails to skip — generic/system addresses unlikely to be real contacts
const SKIP_PATTERNS = [
  /noreply/i, /no-reply/i, /donotreply/i, /do-not-reply/i,
  /notifications?@/i, /alerts?@/i, /mailer@/i, /bounce/i,
  /support@(gmail|yahoo|hotmail|outlook)/i,
  /example\.com$/i, /test\.com$/i,
  /sentry\.io/i, /google\.com/i, /apple\.com/i,
  /wordpress\.org/i, /gravatar\.com/i,
];

// Priority prefixes — prefer these over generic addresses
const PRIORITY_PREFIXES = [
  "info", "contact", "hello", "hi", "enquiries", "enquiry",
  "mail", "email", "office", "admin", "sales", "bookings",
  "reservations", "reception", "general",
];

const CONTACT_PATHS = ["/contact", "/contact-us", "/contact_us", "/about", "/about-us", "/reach-us"];

function scoreEmail(email) {
  const [local] = email.toLowerCase().split("@");
  // Skip junk
  if (SKIP_PATTERNS.some(p => p.test(email))) return -1;
  // Prefer priority prefixes
  if (PRIORITY_PREFIXES.some(p => local === p || local.startsWith(p + "."))) return 2;
  // Penalise very long locals (likely auto-generated)
  if (local.length > 30) return 0;
  return 1;
}

/**
 * Extract emails from a page via page.evaluate().
 * Returns raw array of unique email strings found.
 */
async function extractEmailsFromPage(page) {
  try {
    const raw = await page.evaluate(() => {
      const found = new Set();
      // 1. mailto: links
      document.querySelectorAll('a[href^="mailto:"]').forEach(a => {
        const m = a.href.replace("mailto:", "").split("?")[0].trim();
        if (m) found.add(m.toLowerCase());
      });
      // 2. Page text — scan body text content
      const text = document.body?.innerText || "";
      const matches = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [];
      matches.forEach(m => found.add(m.toLowerCase()));
      // 3. Meta tags (some sites put email in og:email or similar)
      document.querySelectorAll('meta[content*="@"]').forEach(m => {
        const c = m.getAttribute("content") || "";
        const matches2 = c.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [];
        matches2.forEach(e => found.add(e.toLowerCase()));
      });
      return [...found];
    });
    return raw || [];
  } catch {
    return [];
  }
}

/**
 * Score, filter and rank a list of raw email strings.
 * Returns the best email, or null if none found.
 */
function pickBestEmail(emails) {
  const scored = emails
    .map(e => ({ email: e, score: scoreEmail(e) }))
    .filter(e => e.score >= 0)
    .sort((a, b) => b.score - a.score);

  return scored.length > 0 ? scored[0].email : null;
}

/**
 * Main entry point.
 * Given a business website URL, open it and try to find a contact email.
 *
 * @param {object}  context  — Playwright BrowserContext
 * @param {string}  website  — URL to visit
 * @param {number}  timeout  — ms
 * @returns {string|null}    — best email found, or null
 */
export async function extractEmailFromWebsite(context, website, timeout = 15000) {
  if (!website) return null;

  // Normalise URL
  let url = website.trim();
  if (!url.startsWith("http")) url = "https://" + url;

  const page = await context.newPage();
  // Block heavy resources — we only need HTML
  await page.route("**/*.{png,jpg,jpeg,gif,svg,woff,woff2,ttf,mp4,webm,mp3}", r => r.abort());
  await page.route("**/{analytics,gtag,fbevents,hotjar,clarity,doubleclick}**", r => r.abort());

  const allEmails = new Set();

  try {
    // ── Step 1: homepage ─────────────────────────────────────────────────
    await page.goto(url, { waitUntil: "domcontentloaded", timeout });
    await page.waitForTimeout(800);

    const homeEmails = await extractEmailsFromPage(page);
    homeEmails.forEach(e => allEmails.add(e));

    // If we already found a high-priority email, stop here
    const best = pickBestEmail([...allEmails]);
    if (best && scoreEmail(best) >= 2) {
      return best;
    }

    // ── Step 2: try contact/about pages ──────────────────────────────────
    const origin = new URL(page.url()).origin;

    for (const path of CONTACT_PATHS) {
      if (allEmails.size > 0 && pickBestEmail([...allEmails])?.score >= 2) break;
      try {
        const contactUrl = origin + path;
        await page.goto(contactUrl, { waitUntil: "domcontentloaded", timeout: 8000 });
        await page.waitForTimeout(500);
        const contactEmails = await extractEmailsFromPage(page);
        contactEmails.forEach(e => allEmails.add(e));
        // If we found a good email stop early
        if (pickBestEmail([...allEmails])?.score >= 2) break;
      } catch {
        // Page not found or redirect — skip this path
      }
    }

    return pickBestEmail([...allEmails]);

  } catch (err) {
    logger.debug("Email extraction failed", { website, error: err.message });
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}
