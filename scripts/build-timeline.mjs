/**
 * Precomputes, for every hex cell in a theater, the exact day it changes hands.
 *
 * The input is a handful of control keyframes (see data/<theater>/keyframes.json).
 * Between two keyframes we know a cell was taken, but not when. Rather than
 * spreading the advance uniformly over the interval, we let the geometry decide:
 *
 *     f = d0 / (d0 + d1)
 *
 * where d0 is the cell's distance to the front line as it stood at the earlier
 * keyframe and d1 is its distance to the line at the later one. A cell sitting
 * just beyond the old line falls on the first day of the interval; one sitting
 * against the new line falls on the last. Spearheads therefore run ahead of the
 * flanks for free, because their geometry says they should.
 */
import * as turf from "@turf/turf";
import { polygonToCells, cellToLatLng } from "h3-js";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const THEATER = process.argv[2] ?? "poland1939";
const read = (f) => JSON.parse(readFileSync(join(ROOT, "data", THEATER, f), "utf8"));

const theater = read("theater.json");
const border = read("border.json");
const { keyframes, holdouts } = read("keyframes.json");
let places = [];
try { places = read("places.json"); } catch { /* a theater may have no gazetteer yet */ }

const DAY = 86_400_000;
const toDay = (iso) => Math.round(Date.parse(iso + "T00:00:00Z") / DAY);
const toISO = (day) => new Date(day * DAY).toISOString().slice(0, 10);

const START = toDay(theater.startDate);
const END = toDay(theater.endDate);

/* ---------- geometry helpers ---------- */

const ring = (coords) => turf.polygon([closeRing(coords)]);
function closeRing(c) {
  const [a, b] = [c[0], c[c.length - 1]];
  return a[0] === b[0] && a[1] === b[1] ? c : [...c, a];
}

/** Union a keyframe's polygon list into one (possibly multi-) polygon. */
function union(polys) {
  if (!polys.length) return null;
  return polys
    .map(ring)
    .reduce((acc, p) => (acc ? turf.union(turf.featureCollection([acc, p])) : p), null);
}

/**
 * The front line: the parts of a control region's outline that actually run
 * through the theater. Keyframe polygons are drawn far past the border so they
 * are easy to author by hand; those distant closing edges must not be mistaken
 * for a front when measuring distances, so we keep only segments that touch
 * the theater itself.
 */
function frontLine(region) {
  if (!region) return null;
  const segments = [];
  for (const line of turf.flatten(turf.polygonToLine(region)).features) {
    const c = turf.getCoords(line);
    for (let i = 0; i < c.length - 1; i++) {
      const seg = turf.lineString([c[i], c[i + 1]]);
      if (turf.booleanIntersects(seg, border)) segments.push(seg);
    }
  }
  return segments.length ? turf.featureCollection(segments) : null;
}

const distanceToFront = (pt, front) =>
  front
    ? Math.min(...front.features.map((s) => turf.pointToLineDistance(pt, s, { units: "kilometers" })))
    : null;

/* ---------- resolve each keyframe ----------
 *
 * Control polygons are ACCUMULATED by default. A keyframe is drawn by hand as
 * the line on that date, and hand-drawn lines do not perfectly re-enclose every
 * square kilometre taken earlier — so comparing them independently reads those
 * omissions as recaptures. Vilnius fell once, in June 1941; comparing raw
 * polygons had it change hands five times.
 *
 * A theater whose ground genuinely changes hands both ways sets
 * `"cumulative": false` — the Western Desert, where Compass, Rommel and
 * Crusader really do hand the same 1,500 km back and forth twice.
 */
const CUMULATIVE = theater.cumulative !== false;

const frames = [];
for (const kf of keyframes) {
  const prev = frames[frames.length - 1];
  let axis = union(kf.axis);
  let soviet = union(kf.soviet);

  if (CUMULATIVE && prev) {
    axis = mergeWith(axis, prev.regions.axis);
    soviet = mergeWith(soviet, prev.regions.soviet);
  }

  frames.push({
    day: toDay(kf.date),
    date: kf.date,
    label: kf.label,
    regions: { axis, soviet },
    fronts: { axis: frontLine(axis), soviet: frontLine(soviet) },
  });
}

function mergeWith(current, earlier) {
  if (!earlier) return current;
  if (!current) return earlier;
  return turf.union(turf.featureCollection([current, earlier]));
}

/** Who holds a point at a given keyframe. Soviet claims win over Axis ones. */
function controllerAt(frame, pt) {
  for (const side of ["soviet", "axis"]) {
    const r = frame.regions[side];
    if (r && turf.booleanPointInPolygon(pt, r)) return side;
  }
  return "defender";
}

/* ---------- build the hex grid ---------- */

// A theater may be several disjoint landmasses — Norway and Denmark, or an
// island chain — so grid every polygon in the border, not just the first.
const outerRings =
  border.geometry.type === "MultiPolygon"
    ? border.geometry.coordinates.map((poly) => poly[0])
    : [border.geometry.coordinates[0]];
const cells = [
  ...new Set(
    outerRings.flatMap((r) => polygonToCells(r.map(([x, y]) => [y, x]), theater.hexResolution)),
  ),
];
console.log(`grid: ${cells.length} cells at h3 resolution ${theater.hexResolution}`);

const hexes = {};
let interpolated = 0;

for (const cell of cells) {
  const [lat, lng] = cellToLatLng(cell);
  const pt = turf.point([lng, lat]);

  const states = frames.map((f) => controllerAt(f, pt));
  const transitions = [[toISO(START), states[0]]];

  for (let i = 1; i < frames.length; i++) {
    const [from, to] = [states[i - 1], states[i]];
    if (from === to) continue;

    const prev = frames[i - 1];
    const next = frames[i];
    const span = next.day - prev.day;

    // Where in the interval did the line sweep past this cell?
    //
    // Normally that is the advancing side's own front. When ground is being
    // GIVEN BACK — Tolvajarvi, Suomussalmi, the Raate Road — the winning side
    // has no front here to measure against, so measure the retreating side's
    // instead. The formula is unchanged: a cell out at the old high-water mark
    // is uncovered first, one just short of the new line is uncovered last.
    const side = prev.fronts[to] && next.fronts[to] ? to : from;
    const d0 = distanceToFront(pt, prev.fronts[side]);
    const d1 = distanceToFront(pt, next.fronts[side]);
    let f = 1; // no front for either side (e.g. an invasion that opens mid-interval)
    if (d0 !== null && d1 !== null && d0 + d1 > 0) {
      f = d0 / (d0 + d1);
      interpolated++;
    }

    const day = Math.min(next.day, Math.max(prev.day + 1, prev.day + Math.round(f * span)));
    transitions.push([toISO(day), to]);
  }

  hexes[cell] = dedupe(transitions);
}

function dedupe(t) {
  const out = [];
  for (const [date, side] of t) {
    if (out.length && out[out.length - 1][1] === side) continue;
    if (out.length && out[out.length - 1][0] === date) out.pop();
    out.push([date, side]);
  }
  return out;
}

/* ---------- holdouts ----------
 * Interpolation cannot know that a surrounded garrison kept fighting, so
 * besieged places are stated outright and overwrite whatever the geometry
 * decided. A holdout is: from `from` (default the theater's first day) until
 * `until` ("never" if it outlives the theater), this pocket is held by `side`
 * (default the defender). Outside that window the cell follows the front again.
 *
 * The three parameters all earn their place. Tobruk starts inside Italian
 * Libya, is taken in January 1941 and only then holds — so it needs `from`.
 * Leningrad never falls at all — so it needs `until: "never"`. Kock surrenders
 * on the theater's last day, which is a surrender and not an outlasting.
 */
for (const h of holdouts) {
  const centre = turf.point([h.lng, h.lat]);
  const side = h.side ?? "defender";
  const from = h.from ? toDay(h.from) : START;
  const never = h.heldUntil === "never";
  const until = never ? Infinity : toDay(h.heldUntil);
  let touched = 0;

  for (const cell of cells) {
    const [lat, lng] = cellToLatLng(cell);
    if (turf.distance(centre, turf.point([lng, lat]), { units: "kilometers" }) > h.radiusKm) continue;

    const chain = hexes[cell];
    const before = chain.filter(([d]) => toDay(d) < from);
    const after = never ? [] : chain.filter(([d]) => toDay(d) > until);

    hexes[cell] = dedupe([
      // whatever it was before the pocket forms
      ...(before.length ? before : [[toISO(START), chain[0][1]]]),
      // the pocket itself
      [toISO(from), side],
      // and then it falls, on the day it surrendered. Dunkirk's perimeter was
      // taken on 4 June; deferring to the interpolated front line would have
      // held it to the 15th, because the front had not reached it yet.
      ...(never
        ? []
        : [
            [toISO(Math.min(until + 1, END)), lastSide(cell)],
            ...after.filter(([d]) => toDay(d) > until + 1),
          ]),
    ]);
    touched++;
  }
  const holds = never ? "to the end" : `until ${h.heldUntil}`;
  console.log(`holdout: ${h.name} held ${touched} cells ${holds}`);
}

function lastSide(cell) {
  const t = hexes[cell];
  return t[t.length - 1][1];
}

/* ---------- what changed, day by day ----------
 * Most days of a long war have no written entry, and a blank panel makes the
 * map look broken on the very days it is quietly working. So summarise every
 * date from the timeline itself: how much ground moved, which way, and the
 * nearest named places to it. It is derived, not authored, and it is true.
 */
const daily = {};
for (const [cell, transitions] of Object.entries(hexes)) {
  for (const [date, side] of transitions.slice(1)) {
    daily[date] ??= { axis: 0, soviet: 0, defender: 0, cells: [] };
    daily[date][side]++;
    daily[date].cells.push(cell);
  }
}

// Kept at the same radius as nearestPlace() in lib/theater.ts. When these two
// disagreed, clicking a cell and reading the day's derived summary could name
// two different towns for the same ground.
const NEAREST_PLACE_KM = 45;

function nearestPlace(lng, lat) {
  let best = null, bestKm = Infinity;
  for (const p of places) {
    const dx = (p.lng - lng) * Math.cos((lat * Math.PI) / 180) * 111.32;
    const dy = (p.lat - lat) * 110.57;
    const km = Math.hypot(dx, dy);
    if (km < bestKm) { bestKm = km; best = p; }
  }
  return bestKm <= NEAREST_PLACE_KM ? best.name : null;
}

for (const d of Object.values(daily)) {
  // Name where it happened, using the cells that moved furthest apart so the
  // places listed are spread along the front rather than three neighbours.
  const named = [];
  const step = Math.max(1, Math.floor(d.cells.length / 12));
  for (let i = 0; i < d.cells.length; i += step) {
    const [lat, lng] = cellToLatLng(d.cells[i]);
    const name = nearestPlace(lng, lat);
    if (name && !named.includes(name)) named.push(name);
    if (named.length >= 3) break;
  }
  d.places = named;
  delete d.cells;
  for (const k of ["axis", "soviet", "defender"]) if (!d[k]) delete d[k];
}

/* ---------- emit ---------- */

const out = {
  meta: {
    ...theater,
    generatedAt: new Date().toISOString(),
    cells: cells.length,
    keyframes: keyframes.map(({ date, label }) => ({ date, label })),
    daily,
  },
  hexes,
};

// The paint expression carries a fixed number of handovers per cell (see
// MAX_TRANSITIONS in lib/theater.ts). Anything beyond it would be silently
// dropped and the cell would render its stale side for the rest of the war, so
// refuse to emit rather than quietly lie.
const MAX_TRANSITIONS = 4;
const overrun = Object.entries(hexes).filter(([, t]) => t.length - 1 > MAX_TRANSITIONS);
if (overrun.length) {
  const worst = Math.max(...overrun.map(([, t]) => t.length - 1));
  throw new Error(
    `${overrun.length} cells have more than ${MAX_TRANSITIONS} handovers (worst: ${worst}). ` +
    `The paint expression cannot carry them and they would render their stale side forever. ` +
    `Raise MAX_TRANSITIONS in lib/theater.ts and here, or add keyframes so the chain is shorter.`,
  );
}

const dest = join(ROOT, "public", "data", `${THEATER}.json`);
writeFileSync(dest, JSON.stringify(out));
console.log(`interpolated ${interpolated} cell captures from ${keyframes.length} keyframes`);
console.log(`wrote ${dest}`);
