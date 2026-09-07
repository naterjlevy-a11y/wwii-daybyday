/**
 * Which front pages mention which places.
 *
 * Asking the Library of Congress this at click time was the last live
 * dependency left, and it is the flakiest thing in the project — it rate-limits
 * to a hard stop and answers an honest question with an HTML challenge page.
 * But the OCR of every page we already show is sitting in data/frontpages-raw/,
 * so the question can be answered from disk instead: scan it once for every
 * place in every gazetteer and write out the hits.
 *
 * The result is instant, works offline, and cannot be rate-limited.
 *
 *   node scripts/build-place-index.mjs
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(ROOT, "data/frontpages-raw");
const SERVED = join(ROOT, "public/data/frontpages");
const OUT = join(ROOT, "public/data/place-press.json");

const theaters = JSON.parse(readFileSync(join(ROOT, "data/theaters.json"), "utf8"));

/** Every place name worth looking for, with the local spelling as an alias. */
const places = new Map();
for (const { id } of theaters) {
  const path = join(ROOT, "data", id, "places.json");
  if (!existsSync(path)) continue;
  for (const p of JSON.parse(readFileSync(path, "utf8"))) {
    const names = new Set([p.name]);
    if (p.pl) names.add(p.pl);
    // 1939 papers used the German or anglicised spelling as often as the local
    // one, and the OCR is rarely kind to diacritics.
    for (const n of [...names]) names.add(stripDiacritics(n));
    places.set(p.name, [...names].filter((n) => n.length >= 4));
  }
}

function stripDiacritics(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[łŁ]/g, (c) => (c === "ł" ? "l" : "L"));
}

/** Where each page can be linked and titled from. */
const pageMeta = new Map();
for (const f of readdirSync(SERVED)) {
  if (!f.endsWith(".json")) continue;
  const bake = JSON.parse(readFileSync(join(SERVED, f), "utf8"));
  for (const [date, day] of Object.entries(bake.days ?? {})) {
    for (const p of day.pages ?? []) pageMeta.set(`${date}|${p.paper}`, p);
  }
}

/** The OCR itself. */
const pages = [];
for (const f of readdirSync(RAW)) {
  if (!f.endsWith(".json")) continue;
  const raw = JSON.parse(readFileSync(join(RAW, f), "utf8"));
  for (const [date, list] of Object.entries(raw.days ?? {})) {
    for (const { paper, ocr } of list) {
      if (!ocr || ocr.length < 200) continue;
      pages.push({ date, paper, haystack: stripDiacritics(ocr).toLowerCase() });
    }
  }
}
console.log(`${pages.length} pages of OCR, ${places.size} places`);

const index = {};
for (const [place, aliases] of places) {
  // Whole words only. A substring match has "Uman" inside human and woman and
  // Truman, and "Tula" inside spatula — which put the Ukrainian town of Uman in
  // more American front pages than Warsaw.
  const needles = [...new Set(aliases.map((a) => stripDiacritics(a).toLowerCase()))]
    .map((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`));
  const hits = [];
  for (const page of pages) {
    if (!needles.some((n) => n.test(page.haystack))) continue;
    const meta = pageMeta.get(`${page.date}|${page.paper}`);
    if (!meta) continue;
    hits.push({ date: page.date, paper: page.paper, place: meta.place ?? null, url: meta.link });
  }
  if (hits.length) {
    hits.sort((a, b) => a.date.localeCompare(b.date));
    index[place] = hits;
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(index));
const total = Object.values(index).reduce((n, h) => n + h.length, 0);
console.log(`${Object.keys(index).length} places mentioned, ${total} mentions → ${OUT}`);
console.log(`${(JSON.stringify(index).length / 1024).toFixed(0)} KB`);
