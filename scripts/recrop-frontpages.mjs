/**
 * Re-derive the quoted passages from OCR already on disk.
 *
 * Snippet selection is a heuristic worth tuning, and tuning it should not cost
 * a twenty-five minute round trip to the Library of Congress. fetch-frontpages
 * keeps each page's OCR in data/frontpages-raw/; this re-crops from that and
 * rewrites only the `snippet` field of the served file.
 *
 *   node scripts/recrop-frontpages.mjs [theater...]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MASTHEAD = 250;   // characters at the top of the page that are boilerplate
const ACCEPT = 0.50;    // below this the passage reads as scanner noise

function quality(s) {
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length < 8) return 0;
  const wordish = tokens.filter((t) => /^[A-Za-z][A-Za-z'-]{2,}$/.test(t)).length / tokens.length;
  const mixed = tokens.filter((t) => /[a-z]/.test(t)).length / tokens.length;
  return wordish * 0.75 + mixed * 0.25;
}

export function crop(ocr, term, length = 260) {
  const clean = (ocr ?? "").replace(/\s+/g, " ").trim();
  if (clean.length < 40) return null;
  const needle = term.toLowerCase().split(/\s+/)[0];
  const hay = clean.toLowerCase();

  let best = null;
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
    const start = Math.max(0, at - Math.floor(length / 3));
    let slice = clean.slice(start, start + length);
    if (start > 0) slice = slice.replace(/^\S*\s/, "");
    slice = slice.replace(/\s\S*$/, "");
    const score = quality(slice) - (start < MASTHEAD ? 0.2 : 0);
    if (!best || score > best.score) best = { text: `${start > 0 ? "…" : ""}${slice}…`, score };
  }
  return best && best.score >= ACCEPT ? best.text : null;
}

// Every bake on disk, including the weekly filler, unless told otherwise.
const dir = join(ROOT, "public/data/frontpages");
const theaters = process.argv.slice(2).length
  ? process.argv.slice(2)
  : existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""))
    : [];

for (const theater of theaters) {
  const servedPath = join(ROOT, "public/data/frontpages", `${theater}.json`);
  const rawPath = join(ROOT, "data/frontpages-raw", `${theater}.json`);
  if (!existsSync(servedPath) || !existsSync(rawPath)) {
    console.log(`${theater}: no baked data, skipping`);
    continue;
  }

  const served = JSON.parse(readFileSync(servedPath, "utf8"));
  const raw = JSON.parse(readFileSync(rawPath, "utf8"));

  let quoted = 0, total = 0;
  for (const [date, day] of Object.entries(served.days)) {
    const byPaper = new Map((raw.days[date] ?? []).map((p) => [p.paper, p.ocr]));
    for (const page of day.pages) {
      page.snippet = crop(byPaper.get(page.paper), day.q);
      total++;
      if (page.snippet) quoted++;
    }
  }

  writeFileSync(servedPath, JSON.stringify(served));
  console.log(`${theater}: ${quoted}/${total} pages quoted (${Math.round((100 * quoted) / total)}%)`);
}
