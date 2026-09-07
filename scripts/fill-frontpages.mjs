/**
 * Fill in front pages for every day the campaign bakes did not cover.
 *
 * The per-day bake (fetch-frontpages.mjs) only walks the days that have written
 * entries, which left most of the calendar blank — scrub to an ordinary Tuesday
 * and there was nothing there at all. This covers the rest.
 *
 * It asks in WEEKLY windows rather than per day. That is roughly a seventh of
 * the requests, which matters: the Library of Congress rate-limits hard (HTTP
 * 429 with an HTML body, not JSON), and a per-day sweep of the whole war is
 * enough traffic to trip it. Results come back dated, so one request fills
 * seven days.
 *
 *   node scripts/fill-frontpages.mjs [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 *
 * Writes public/data/frontpages/filler.json, which the UI reads last — anything
 * a campaign already baked per-day wins over what lands here.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public/data/frontpages", "filler.json");
const RAW_OUT = join(ROOT, "data/frontpages-raw", "filler.json");
const ENDPOINT = "https://www.loc.gov/collections/chronicling-america/";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const FROM = arg("--from", "1939-09-01");
/**
 * Override the period term for a second sweep. A window that came back with
 * nothing usually means the term was too narrow for that week, not that the
 * papers were silent — "Africa" finds far less than "war" does.
 */
const Q_OVERRIDE = arg("--q", null);
const TO = arg("--to", "1941-12-31");
const WINDOW = 7;
const PER_REQUEST = "40";
const PER_DAY = 6;
const RAW_CHARS = 6000;
const POLITE_MS = 12_000;   // between successful requests
const BACKOFF_MS = 180_000; // after a 429, before trying again
const ATTEMPTS = 4;

/**
 * What to search for, by period. A single word: the archive ANDs multiple
 * terms and a phrase like "Russia invades Poland" matches nothing at all.
 */
const CALENDAR = [
  { from: "1939-09-01", q: "Poland" },
  { from: "1939-10-07", q: "Hitler" },
  { from: "1939-11-30", q: "Finland" },
  { from: "1940-03-14", q: "Hitler" },
  { from: "1940-04-09", q: "Norway" },
  { from: "1940-05-10", q: "France" },
  { from: "1940-06-26", q: "Britain" },
  { from: "1940-07-10", q: "London" },
  { from: "1940-11-01", q: "Greece" },
  { from: "1940-12-09", q: "Egypt" },
  { from: "1941-03-01", q: "Africa" },
  { from: "1941-04-06", q: "Greece" },
  { from: "1941-06-01", q: "Britain" },
  { from: "1941-06-22", q: "Russia" },
  { from: "1941-12-08", q: "Japan" },
];

const DAY = 86_400_000;
const toDay = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);
const toISO = (d) => new Date(d * DAY).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const termFor = (iso) => {
  if (Q_OVERRIDE) return Q_OVERRIDE;
  let q = CALENDAR[0].q;
  for (const c of CALENDAR) if (c.from <= iso) q = c.q;
  return q;
};

const firstString = (v) => (typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : null);
const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

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

/** Days a campaign already baked per-day, which are better than anything here. */
function alreadyCovered() {
  const dir = join(ROOT, "public/data/frontpages");
  const covered = new Set();
  if (!existsSync(dir)) return covered;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || f === "filler.json") continue;
    const b = JSON.parse(readFileSync(join(dir, f), "utf8"));
    for (const [date, d] of Object.entries(b.days ?? {})) {
      if (d.pages?.length) covered.add(date);
    }
  }
  return covered;
}

async function fetchWindow(from, to, q) {
  const url = new URL(ENDPOINT);
  for (const [k, v] of Object.entries({
    q, start_date: from, end_date: to,
    searchType: "advanced", fa: "partof:chronicling america", fo: "json", c: PER_REQUEST,
  })) url.searchParams.set(k, v);

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "wwii-daybyday/0.1 (historical research prototype)" },
        signal: AbortSignal.timeout(60_000),
      });
      // A rate-limited response is an HTML challenge page, not JSON, so it has
      // to be caught here rather than at the parse.
      if (res.status === 429 || res.status === 403) {
        const wait = BACKOFF_MS * attempt;
        console.log(`  rate-limited (${res.status}); waiting ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()).results ?? [];
    } catch (err) {
      if (attempt === ATTEMPTS) {
        console.log(`  ${from}..${to} gave up: ${err.message}`);
        return null;
      }
      await sleep(20_000 * attempt);
    }
  }
  return null;
}

const existing = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { days: {} };
const existingRaw = existsSync(RAW_OUT) ? JSON.parse(readFileSync(RAW_OUT, "utf8")).days ?? {} : {};
const out = { generatedAt: new Date().toISOString(), days: existing.days ?? {} };
const raw = { ...existingRaw };

function save() {
  out.generatedAt = new Date().toISOString();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out));
  mkdirSync(dirname(RAW_OUT), { recursive: true });
  writeFileSync(RAW_OUT, JSON.stringify({ theater: "filler", days: raw }));
}

const covered = alreadyCovered();
console.log(`${covered.size} days already covered by the per-day bakes`);

let windows = 0, filled = 0;
for (let d = toDay(FROM); d <= toDay(TO); d += WINDOW) {
  const from = toISO(d);
  const to = toISO(Math.min(d + WINDOW - 1, toDay(TO)));

  // Skip the window entirely if every day in it is already answered.
  const needed = [];
  for (let x = d; x <= Math.min(d + WINDOW - 1, toDay(TO)); x++) {
    const iso = toISO(x);
    if (!covered.has(iso) && !(out.days[iso]?.pages?.length)) needed.push(iso);
  }
  if (needed.length === 0) continue;

  const q = termFor(from);
  const results = await fetchWindow(from, to, q);
  windows++;
  if (!results) continue;

  const byDate = {};
  for (const r of results) {
    const date = firstString(r.date);
    if (!date || !needed.includes(date)) continue;

    const pageNo = Number(firstString(r.number_page) ?? NaN);
    const link = firstString(r.id) ?? firstString(r.url) ?? "";
    const sp = Number(link.match(/[?&]sp=(\d+)/)?.[1] ?? NaN);
    if (pageNo !== 1 && sp !== 1) continue;

    const thumb = iiif(r.image_url, "400,");
    const full = iiif(r.image_url, "!1400,2000");
    if (!thumb || !full) continue;

    const { paper, place } = splitTitle(firstString(r.partof_title) ?? firstString(r.title));
    byDate[date] ??= [];
    if (byDate[date].some((p) => p.paper === paper) || byDate[date].length >= PER_DAY) continue;

    const ocr = (firstString(r.description) ?? "").replace(/\s+/g, " ").trim().slice(0, RAW_CHARS);
    byDate[date].push({ paper, place, date, thumb, full, link, ocr });
  }

  for (const [date, pages] of Object.entries(byDate)) {
    raw[date] = pages.map((p) => ({ paper: p.paper, ocr: p.ocr }));
    out.days[date] = {
      q,
      pages: pages.map((p) => {
        const served = { ...p, snippet: null };
        delete served.ocr;
        return served;
      }),
    };
    filled++;
  }
  console.log(`  ${from}..${to} "${q}" → ${Object.keys(byDate).length} days filled`);
  // Write after every window. The whole sweep takes the better part of an hour
  // against a rate-limited archive, and a run that is interrupted must not
  // throw away everything it already fetched.
  save();
  await sleep(POLITE_MS);
}

save();
console.log(`\n${windows} windows requested, ${filled} days filled`);
console.log(`${Object.keys(out.days).length} days in ${OUT}`);
