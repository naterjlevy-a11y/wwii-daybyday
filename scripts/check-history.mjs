/**
 * Check the reconstruction against dates that are actually known.
 *
 * Each case asks the only question that matters of a map like this: on THIS
 * date, who held THIS place? That is stronger than asking when a cell first
 * changed hands — a cell can begin the theater in enemy hands (Tobruk starts
 * inside Italian Libya), so "the first transition" is not the same thing as
 * "when it fell", and an earlier version of this check asserted a bug because
 * it confused the two.
 *
 *   node scripts/check-history.mjs [toleranceDays]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { latLngToCell } from "h3-js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** [theater, place, lng, lat, [ [date, whoHoldsIt], ... ] ] */
const CASES = [
  ["poland1939", "Warsaw", 21.01, 52.23, [["1939-09-20", "defender"], ["1939-09-30", "axis"]]],
  ["poland1939", "Kraków", 19.94, 50.06, [["1939-09-03", "defender"], ["1939-09-12", "axis"]]],
  ["poland1939", "Lwów", 24.03, 49.84, [["1939-09-15", "defender"], ["1939-09-28", "soviet"]]],
  ["poland1939", "Hel", 18.60, 54.72, [["1939-09-25", "defender"], ["1939-10-06", "axis"]]],
  ["poland1939", "Kock", 22.45, 51.64, [["1939-10-01", "defender"], ["1939-10-06", "axis"]]],
  ["poland1939", "Brest", 23.66, 51.66, [["1939-09-30", "soviet"]]],

  ["winterwar", "Viipuri", 28.75, 60.71, [["1940-02-01", "defender"], ["1940-03-13", "soviet"]]],
  ["winterwar", "Petsamo", 31.20, 69.55, [["1939-12-20", "soviet"]]],
  ["winterwar", "Helsinki", 24.94, 60.17, [["1940-03-13", "defender"]]],
  ["winterwar", "Suomussalmi", 28.90, 64.88, [["1940-02-01", "defender"]]],

  ["norway1940", "Oslo", 10.75, 59.91, [["1940-04-12", "axis"]]],
  ["norway1940", "Copenhagen", 12.57, 55.68, [["1940-04-10", "axis"]]],
  ["norway1940", "Narvik", 17.43, 68.44, [["1940-06-01", "defender"], ["1940-06-10", "axis"]]],
  ["norway1940", "Ålesund", 6.15, 62.47, [["1940-06-10", "axis"]]],
  ["norway1940", "Bergen", 5.32, 60.39, [["1940-04-12", "axis"]]],

  ["france1940", "Sedan", 4.94, 49.70, [["1940-05-11", "defender"], ["1940-05-20", "axis"]]],
  ["france1940", "Abbeville", 1.83, 50.10, [["1940-05-15", "defender"], ["1940-05-25", "axis"]]],
  ["france1940", "Paris", 2.35, 48.85, [["1940-06-05", "defender"], ["1940-06-20", "axis"]]],
  ["france1940", "Rotterdam", 4.48, 51.92, [["1940-06-01", "axis"]]],
  ["france1940", "Dunkirk", 2.38, 51.03, [["1940-06-01", "defender"], ["1940-06-10", "axis"]]],
  ["france1940", "Vichy", 3.43, 46.13, [["1940-06-25", "defender"]]],
  ["france1940", "Marseille", 5.37, 43.30, [["1940-06-25", "defender"]]],

  ["desert1940", "Tobruk", 23.96, 32.07, [["1940-10-01", "axis"], ["1941-06-01", "defender"], ["1941-12-31", "defender"]]],
  ["desert1940", "Sidi Barrani", 25.93, 31.61, [["1940-10-01", "axis"], ["1941-01-05", "defender"]]],
  ["desert1940", "Benghazi", 20.07, 32.12, [["1940-10-01", "axis"], ["1941-02-20", "defender"], ["1941-06-01", "axis"]]],
  ["desert1940", "Alexandria", 29.92, 31.20, [["1941-12-31", "defender"]]],

  ["balkans1941", "Belgrade", 20.46, 44.79, [["1941-04-05", "defender"], ["1941-04-20", "axis"]]],
  ["balkans1941", "Athens", 23.73, 37.98, [["1941-04-20", "defender"], ["1941-05-05", "axis"]]],
  ["balkans1941", "Heraklion", 25.13, 35.34, [["1941-05-15", "defender"], ["1941-06-01", "axis"]]],

  ["barbarossa1941", "Minsk", 27.56, 53.90, [["1941-06-24", "defender"], ["1941-07-05", "axis"]]],
  ["barbarossa1941", "Vilnius", 25.28, 54.69, [["1941-07-01", "axis"], ["1941-10-01", "axis"], ["1941-12-05", "axis"]]],
  ["barbarossa1941", "Riga", 24.11, 56.95, [["1941-07-10", "axis"], ["1941-12-05", "axis"]]],
  ["barbarossa1941", "Smolensk", 32.05, 54.78, [["1941-07-05", "defender"], ["1941-08-05", "axis"]]],
  ["barbarossa1941", "Kiev", 30.52, 50.45, [["1941-09-05", "defender"], ["1941-10-01", "axis"]]],
  ["barbarossa1941", "Kharkov", 36.23, 49.99, [["1941-10-05", "defender"], ["1941-11-05", "axis"]]],
  ["barbarossa1941", "Odessa", 30.73, 46.48, [["1941-10-10", "defender"], ["1941-10-25", "axis"]]],
  ["barbarossa1941", "Moscow", 37.62, 55.75, [["1941-12-05", "defender"]]],
  ["barbarossa1941", "Leningrad", 30.34, 59.93, [["1941-12-05", "defender"]]],
  ["barbarossa1941", "Sevastopol", 33.53, 44.62, [["1941-12-05", "defender"]]],
];

const MAX_TRANSITIONS = 4;
const cache = new Map();
const load = (id) => {
  if (!cache.has(id)) cache.set(id, JSON.parse(readFileSync(join(ROOT, "public/data", `${id}.json`), "utf8")));
  return cache.get(id);
};
const holderOn = (chain, iso) => {
  let side = chain[0][1];
  for (const [d, s] of chain.slice(1)) { if (d <= iso) side = s; else break; }
  return side;
};

const problems = [];
let checked = 0;

for (const [theater, name, lng, lat, expectations] of CASES) {
  const d = load(theater);
  const chain = d.hexes[latLngToCell(lat, lng, d.meta.hexResolution)];
  if (!chain) { problems.push(`${name} (${theater}): outside the theater's grid`); continue; }

  for (const [date, expected] of expectations) {
    checked++;
    const got = holderOn(chain, date);
    if (got !== expected) {
      problems.push(`${name} on ${date}: model says ${got}, should be ${expected}  ${JSON.stringify(chain)}`);
    }
  }
}

// Every cell must fit in the paint expression. A cell with more handovers than
// it can carry renders its stale side for the rest of the war — silently.
let overrun = 0;
for (const id of new Set(CASES.map((c) => c[0]))) {
  for (const chain of Object.values(load(id).hexes)) {
    if (chain.length - 1 > MAX_TRANSITIONS) overrun++;
  }
}
if (overrun) problems.push(`${overrun} cells exceed MAX_TRANSITIONS=${MAX_TRANSITIONS} and would be truncated`);

console.log(`${checked - problems.length}/${checked} holdings match the record`);
for (const p of problems) console.log(`  ✗ ${p}`);
process.exit(problems.length ? 1 : 0);
