/**
 * Bake the day-by-day front pages into a static file.
 *
 * The Library of Congress search is slow and unreliable — anywhere from 300ms
 * to a hard timeout for the same query — which makes it unusable on the click
 * path. But the 1939 archive does not change, so there is no reason to ask it
 * more than once. This walks the campaign, retries until each day answers, and
 * writes the result next to the timeline.
 *
 *   node scripts/fetch-frontpages.mjs [theaterId]
 *
 * Re-run only when days.json gains days or its `press` terms change; the output
 * is committed.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const FORCE = args.includes("--force"); // re-fetch days already cached, e.g. after changing how snippets are cropped
const THEATER = args.find((a) => !a.startsWith("--")) ?? "poland1939";
const OUT = join(ROOT, "public/data/frontpages", `${THEATER}.json`);
// The OCR text of each page, kept out of /public because it is megabytes and
// nothing at runtime reads it. scripts/recrop-frontpages.mjs re-derives the
// quoted passages from this without touching the network.
const RAW_OUT = join(ROOT, "data/frontpages-raw", `${THEATER}.json`);
const RAW_CHARS = 6000;

const ENDPOINT = "https://www.loc.gov/collections/chronicling-america/";
const PER_DAY = 8;
const ATTEMPTS = 5;

const days = JSON.parse(readFileSync(join(ROOT, "data", THEATER, "days.json"), "utf8"));

const firstString = (v) => (typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : null);
const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function splitTitle(raw) {
  if (!raw) return { paper: "Unknown paper", place: null };
  const m = raw.match(/^(.*?)\s*\(([^)]+)\)/);
  return m
    ? { paper: titleCase(m[1].trim()), place: titleCase(m[2].trim()) }
    : { paper: titleCase(raw.replace(/\s*\d{4}-\d{4}.*$/, "").trim()), place: null };
}

function iiif(imageUrls, size) {
  for (const u of Array.isArray(imageUrls) ? imageUrls : [imageUrls]) {
    if (typeof u !== "string") continue;
    const m = u.match(/^(https:\/\/tile\.loc\.gov\/image-services\/iiif\/[^/]+)\//);
    if (m) return `${m[1]}/full/${size}/0/default.jpg`;
  }
  return null;
}

/**
 * Score every occurrence of the term and quote the best-reading one, rather
 * than the first — the first is usually the masthead, which tells you the price
 * of the paper and nothing about the war. Mirrored in recrop-frontpages.mjs,
 * which re-derives passages from the same OCR without going back to the network.
 */
function quality(s) {
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length < 8) return 0;
  const wordish = tokens.filter((t) => /^[A-Za-z][A-Za-z'-]{2,}$/.test(t)).length / tokens.length;
  const mixed = tokens.filter((t) => /[a-z]/.test(t)).length / tokens.length;
  return wordish * 0.75 + mixed * 0.25;
}

function ocrSnippet(description, term, length = 260) {
  const text = firstString(description);
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length < 40) return null;

  const needle = term.toLowerCase().split(/\s+/)[0];
  const hay = clean.toLowerCase();

  let best = null;
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
    const start = Math.max(0, at - Math.floor(length / 3));
    let slice = clean.slice(start, start + length);
    if (start > 0) slice = slice.replace(/^\S*\s/, "");
    slice = slice.replace(/\s\S*$/, "");
    const score = quality(slice) - (start < 140 ? 0.25 : 0);
    if (!best || score > best.score) best = { text: `${start > 0 ? "…" : ""}${slice}…`, score };
  }
  return best && best.score >= 0.55 ? best.text : null;
}

async function fetchDay(date, q) {
  const url = new URL(ENDPOINT);
  for (const [k, v] of Object.entries({
    q, start_date: date, end_date: date,
    searchType: "advanced", fa: "partof:chronicling america", fo: "json", c: "25",
  })) url.searchParams.set(k, v);

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "wwii-daybyday/0.1 (historical research prototype)" },
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      const seen = new Set();
      const pages = [];
      for (const r of json.results ?? []) {
        const pageNo = Number(firstString(r.number_page) ?? NaN);
        const link = firstString(r.id) ?? firstString(r.url) ?? "";
        const sp = Number(link.match(/[?&]sp=(\d+)/)?.[1] ?? NaN);
        if (pageNo !== 1 && sp !== 1) continue;

        const thumb = iiif(r.image_url, "400,");
        const full = iiif(r.image_url, "!1400,2000");
        if (!thumb || !full) continue;

        const { paper, place } = splitTitle(firstString(r.partof_title) ?? firstString(r.title));
        if (seen.has(paper)) continue;
        seen.add(paper);

        const ocr = (firstString(r.description) ?? "").replace(/\s+/g, " ").trim().slice(0, RAW_CHARS);
        pages.push({ paper, place, date: firstString(r.date) ?? date, thumb, full, link, snippet: ocrSnippet(ocr, q), ocr });
        if (pages.length >= PER_DAY) break;
      }
      return pages;
    } catch (err) {
      if (attempt === ATTEMPTS) {
        console.log(`  ${date} gave up after ${ATTEMPTS} attempts: ${err.message}`);
        return null;
      }
      await sleep(attempt * 2500); // loc.gov rate-limits under load; back off
    }
  }
  return null;
}

// Keep whatever a previous run already got, so a partial re-run is cheap.
const existing = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { days: {} };
const out = { generatedAt: new Date().toISOString(), theater: THEATER, days: existing.days ?? {} };

// The served file carries no OCR, so a partial re-run must merge the previous
// raw file rather than rebuild it from `out` — otherwise fetching one missing
// day silently blanks the OCR for every day that was already cached.
const priorRaw = existsSync(RAW_OUT) ? JSON.parse(readFileSync(RAW_OUT, "utf8")).days ?? {} : {};

const dates = Object.keys(days).sort();
let fetched = 0, kept = 0, failed = 0;

for (const date of dates) {
  const q = days[date].press ?? "Poland";
  const prior = out.days[date];
  if (!FORCE && prior && prior.q === q && prior.pages.length > 0) { kept++; continue; }

  const pages = await fetchDay(date, q);
  if (pages === null) { failed++; continue; }
  out.days[date] = { q, pages };
  fetched++;
  console.log(`  ${date} "${q}" → ${pages.length} front pages`);
  await sleep(600); // be a considerate client
}

// Split the OCR out of the served file before writing it, keeping what earlier
// runs already fetched for days we did not touch this time.
const raw = { ...priorRaw };
for (const [date, d] of Object.entries(out.days)) {
  const fetchedNow = d.pages.some((p) => typeof p.ocr === "string");
  if (!fetchedNow && raw[date]) continue;
  raw[date] = d.pages.map((p) => ({ paper: p.paper, ocr: p.ocr ?? "" }));
  d.pages = d.pages.map((p) => {
    const served = { ...p };
    delete served.ocr;
    return served;
  });
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
mkdirSync(dirname(RAW_OUT), { recursive: true });
writeFileSync(RAW_OUT, JSON.stringify({ theater: THEATER, days: raw }));
const total = Object.values(out.days).reduce((n, d) => n + d.pages.length, 0);
console.log(`\n${fetched} days fetched, ${kept} already cached, ${failed} failed`);
console.log(`${total} front pages across ${Object.keys(out.days).length}/${dates.length} days → ${OUT}`);
