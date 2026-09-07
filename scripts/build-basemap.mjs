/**
 * Build the ground the war is drawn on: the world as it was in 1938.
 *
 * No tile provider is used anywhere in this project — modern basemap tiles
 * would draw modern borders, which is the one thing the map exists to
 * contradict. The ground comes from aourednik/historical-basemaps instead.
 * That repository has no 1939 or 1940 file; 1938 is the nearest, and the
 * attribution control says so.
 *
 *   node scripts/build-basemap.mjs
 */
import * as turf from "@turf/turf";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The source file carries some present-day names, which is precisely the thing
 * this project exists not to do: a 1941 map that says ISRAEL or BOTSWANA is
 * drawing the wrong century. It also writes the governing power as a suffix —
 * "ALGERIA (FRANCE)" — which is information, but not a country's name.
 */
const RENAME = {
  "Israel": "Palestine",
  "Mandatory Palestine (GB)": "Palestine",
  "Jordan": "Transjordan",
  "Mesopotamia (GB)": "Iraq",
  "Botswana": "Bechuanaland",
  "Malawi": "Nyasaland",
  "Lesotho": "Basutoland",
  "Swaziland": "Swaziland",
  "Tanzania, United Republic of": "Tanganyika",
  "Malaysia": "Malaya",
  "Guinea-Bissau": "Portuguese Guinea",
  "Belize": "British Honduras",
  "Armenia": "Armenian SSR",
  "Chinese warlords": "China",
  "Empire of Japan": "Japan",
  "United Kingdom": "United Kingdom",
};

/** "ALGERIA (FRANCE)" is a name plus an owner; keep the name. */
const stripOwner = (n) => n.replace(/\s*\([^)]*\)\s*$/, "").trim();

function properName(raw) {
  if (!raw) return null;
  if (RENAME[raw]) return RENAME[raw];
  const bare = stripOwner(raw);
  return RENAME[bare] ?? bare;
}

/**
 * Countries with distant dependencies get their label anchored at the largest
 * landmass, which for Denmark is the middle of Greenland. Pin those by hand.
 */
const LABEL_AT = {
  Denmark: [9.5, 56.0],
  France: [2.5, 46.6],
  Netherlands: [5.5, 52.2],
  Portugal: [-8.2, 39.7],
  Norway: [9.5, 61.5],
  "United Kingdom": [-2.0, 53.5],
  Spain: [-3.7, 40.2],
  Italy: [12.5, 42.8],
  USSR: [45.0, 57.0],
};
const SRC = "https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson/world_1938.geojson";
const OUT = join(ROOT, "public/data/world_1938.geojson");

console.log("fetching", SRC);
const res = await fetch(SRC, { signal: AbortSignal.timeout(120_000) });
if (!res.ok) throw new Error(`source responded ${res.status}`);
const world = await res.json();
console.log(`${world.features.length} features`);

// One feature per country. The source file splits countries across many
// polygons — islands, exclaves, the parts of a coastline — and a symbol layer
// labels every feature it is given, so leaving them apart writes USSR across
// the map three times.
const byName = new Map();
for (const f of world.features) {
  if (!f.geometry) continue;
  const name = properName(f.properties?.NAME ?? f.properties?.SUBJECTO ?? null);
  if (!name) continue;

  // Simplify hard: this is a backdrop at continental zoom, not a survey. The
  // hex grids carry all the precision that matters.
  let g;
  try {
    g = turf.simplify(turf.truncate(f, { precision: 2 }), { tolerance: 0.05, highQuality: false });
  } catch {
    g = turf.truncate(f, { precision: 2 });
  }

  const polys =
    g.geometry.type === "MultiPolygon" ? g.geometry.coordinates : [g.geometry.coordinates];
  const entry = byName.get(name) ?? { subject: f.properties?.SUBJECTO ?? name, polys: [] };
  entry.polys.push(...polys);
  byName.set(name, entry);
}

const features = [...byName].map(([name, { subject, polys }]) => ({
  type: "Feature",
  properties: {
    name,
    subject,
    // Label at the country's largest landmass — except where that lands in a
    // colony rather than the country: Denmark's biggest polygon is Greenland,
    // which had DENMARK written across the Arctic in occupied red.
    labelAt: LABEL_AT[name] ?? largestCentroid(polys),
  },
  geometry: { type: "MultiPolygon", coordinates: polys },
}));

function largestCentroid(polys) {
  let best = null, bestArea = -1;
  for (const poly of polys) {
    try {
      const f = turf.polygon(poly);
      const a = turf.area(f);
      if (a > bestArea) { bestArea = a; best = turf.centroid(f).geometry.coordinates; }
    } catch { /* a degenerate ring; skip it */ }
  }
  return best ? best.map((n) => Math.round(n * 100) / 100) : null;
}

const out = { type: "FeatureCollection", features };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote ${features.length} countries (from ${world.features.length} polygons) → ${OUT}`);
console.log(`${(JSON.stringify(out).length / 1024 / 1024).toFixed(2)} MB`);
