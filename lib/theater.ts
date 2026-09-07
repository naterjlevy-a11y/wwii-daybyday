import { cellToBoundary } from "h3-js";
import type { ExpressionSpecification } from "maplibre-gl";

export type Side = "defender" | "axis" | "soviet";
export type Transition = [string, Side];

export type TheaterData = {
  meta: {
    id: string; name: string; startDate: string; endDate: string;
    hexResolution: number; note: string; cells: number;
    sides?: Partial<Record<Side, string>>;
    /** Derived per-date summary: how many cells moved which way, and where. */
    daily?: Record<string, DailyMove>;
    camera: { center: [number, number]; zoom: number };
    keyframes: { date: string; label: string }[];
  };
  hexes: Record<string, Transition[]>;
};

export type Day = {
  headline: string;
  summary: string;
  events: WarEvent[];
  /** What to ask the newspaper archive for on this day. */
  press?: string;
  /** Which campaign wrote this entry; null for an interlude day. */
  from?: string | null;
};
export type DailyMove = {
  axis?: number;
  soviet?: number;
  defender?: number;
  places: string[];
};

/**
 * A plain-language line for a day nobody has written an entry for, built from
 * the timeline itself. Roughly 253 km² per cell at h3 resolution 5, so the
 * count is reported as area rather than as a number of hexes.
 */
export function describeMove(
  theater: TheaterData,
  move: DailyMove,
  labels: Record<Side, string>,
): string | null {
  const parts: string[] = [];
  const areaPerCell = 253;
  for (const side of ["axis", "soviet", "defender"] as Side[]) {
    const n = move[side];
    if (!n) continue;
    const km2 = Math.round((n * areaPerCell) / 100) * 100;
    parts.push(`${labels[side]} forces took about ${km2.toLocaleString()} km²`);
  }
  if (parts.length === 0) return null;

  const where = move.places.length
    ? ` around ${move.places.slice(0, 3).join(", ")}`
    : "";
  return `${parts.join("; ")}${where}.`;
}

export type WarEvent = { name: string; lng: number; lat: number; kind: string; text: string };
export type Place = { name: string; pl?: string; lng: number; lat: number };
export type CameraCue = { date: string; center: [number, number]; zoom: number; reason: string };

export const SIDE_CODE: Record<Side, number> = { defender: 0, axis: 1, soviet: 2 };

export const PALETTE = {
  defender: "#3d7ea6",
  axis: "#a8342a",
  soviet: "#b0802b",
  ink: "#e9e3d7",
  ground: "#0c0b0a",
  land: "#1e1c1a",
  neutral: "#322e29",
} as const;

/** Fallback only. Each theater names its own sides in data/<id>/theater.json. */
export const SIDE_LABEL: Record<Side, string> = {
  defender: "Defending",
  axis: "Axis",
  soviet: "Soviet",
};

export function sideLabels(theater: TheaterData | null): Record<Side, string> {
  return { ...SIDE_LABEL, ...(theater?.meta.sides ?? {}) };
}

/** Which sides this theater actually has, in map order. */
export function sidesOf(theater: TheaterData | null): Side[] {
  const named = theater?.meta.sides;
  if (!named) return ["defender", "axis", "soviet"];
  return (["defender", "axis", "soviet"] as Side[]).filter((s) => s in named);
}

/* ---------- dates as integer day numbers ---------- */

const MS = 86_400_000;
export const toDay = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / MS);
export const toISO = (day: number) => new Date(day * MS).toISOString().slice(0, 10);
export const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });

/* ---------- hex geometry ---------- */

/**
 * One GeoJSON feature per cell, carrying its whole future as properties:
 * s0 is who held it on day one, then (t1,s1)…(t4,s4) are the handovers.
 *
 * Baking the timeline into the features means changing the displayed date is a
 * single paint-property update rather than a re-upload of the source data —
 * which is what lets the playback run smoothly over a thousand-odd cells.
 */
export const MAX_TRANSITIONS = 4;
const NEVER = 1e9;

export function buildHexFeatures(hexes: TheaterData["hexes"]) {
  const features = Object.entries(hexes).map(([cell, transitions]) => {
    const props: Record<string, number | string> = {
      h: cell,
      s0: SIDE_CODE[transitions[0][1]],
    };
    for (let i = 1; i <= MAX_TRANSITIONS; i++) {
      const t = transitions[i];
      props[`t${i}`] = t ? toDay(t[0]) : NEVER;
      props[`s${i}`] = t ? SIDE_CODE[t[1]] : props[`s${i - 1}`];
    }
    return {
      type: "Feature" as const,
      id: hashCell(cell),
      properties: props,
      geometry: {
        type: "Polygon" as const,
        coordinates: [cellToBoundary(cell, true)],
      },
    };
  });
  return { type: "FeatureCollection" as const, features };
}

function hashCell(cell: string) {
  let h = 0;
  for (let i = 0; i < cell.length; i++) h = (Math.imul(31, h) + cell.charCodeAt(i)) | 0;
  return h >>> 0;
}

/* ---------- date-driven paint expressions ---------- */

/** Resolves to the side code (0/1/2) holding a cell on `day`. */
export function sideExpression(day: number): ExpressionSpecification {
  const chain: unknown[] = ["case"];
  for (let i = MAX_TRANSITIONS; i >= 1; i--) {
    chain.push([">=", day, ["get", `t${i}`]], ["get", `s${i}`]);
  }
  chain.push(["get", "s0"]);
  return chain as unknown as ExpressionSpecification;
}

/** Resolves to the day a cell most recently changed hands (or -1e9 if never). */
export function lastFlipExpression(day: number): ExpressionSpecification {
  const chain: unknown[] = ["case"];
  for (let i = MAX_TRANSITIONS; i >= 1; i--) {
    chain.push([">=", day, ["get", `t${i}`]], ["get", `t${i}`]);
  }
  chain.push(-NEVER);
  return chain as unknown as ExpressionSpecification;
}

export function fillColorExpression(day: number): ExpressionSpecification {
  return [
    "match", sideExpression(day),
    SIDE_CODE.axis, PALETTE.axis,
    SIDE_CODE.soviet, PALETTE.soviet,
    PALETTE.defender,
  ] as unknown as ExpressionSpecification;
}

/**
 * Cells taken in the last three days glow. This is what makes the advance
 * legible during playback — without it the map just changes colour and the eye
 * has nothing to follow.
 */
export function recencyOpacityExpression(day: number): ExpressionSpecification {
  return [
    "interpolate", ["linear"],
    ["-", day, lastFlipExpression(day)],
    // Low enough that the cell still reads as its own side. At 0.45 this washed
    // red to pink and invented a fourth colour that meant nothing.
    0, 0.2,
    1, 0.12,
    3, 0,
  ] as unknown as ExpressionSpecification;
}

/* ---------- nations ---------- */

/**
 * `co-belligerent` earns its place. The Soviet Union never joined the Tripartite
 * Pact — the November 1940 talks failed — but it invaded Poland alongside
 * Germany and supplied it until the morning it was invaded itself. Painting
 * that "Axis" made the map claim something the sources do not, and painting it
 * "neutral" would hide the partition of Poland. Finland is the mirror image:
 * a country fighting the same enemy as Germany without being an Axis power,
 * and never an Allied one either.
 */
export type NationState = "axis" | "co-belligerent" | "occupied" | "allied" | "neutral";
export type Nation = {
  name: string;
  status: { date: string; state: NationState; note: string }[];
};

/**
 * The whole world takes a side, not only the ground being fought over. Norway
 * is occupied for five years after its campaign ends; Hungary is an Axis ally
 * without ever being invaded; Sweden is neutral throughout. Colouring every
 * country is the only way the map says any of that.
 */
/**
 * Axis and occupied are not shades of the same thing. One is a country that
 * chose this; the other is a country this was done to. So they differ in
 * lightness and in saturation, not just in tone — and an occupied country is
 * additionally ringed in the occupier's own red, which says the thing the fill
 * cannot: the country is still there, with somebody else's border around it.
 */
export const NATION_COLOR: Record<NationState, string> = {
  // Desaturated well below the hex palette. These are the ground the war is
  // fought over, not the fighting: if a country's fill competes with a captured
  // hex sitting on top of it, the front line stops being visible at all.
  axis: "#6d2f24",
  "co-belligerent": "#5d4526",
  occupied: "#3b2429",
  allied: "#20404f",
  neutral: PALETTE.land,
};

/** Ring drawn around occupied countries, in the colour of who holds them. */
export const OCCUPIED_RING = "#8f3226";

export function occupiedRingExpression(nations: Nation[], iso: string): ExpressionSpecification {
  const occupied = nations
    .filter((n) => nationStateOn(n, iso).state === "occupied")
    .map((n) => n.name);
  if (occupied.length === 0) return ["literal", 0] as unknown as ExpressionSpecification;
  return [
    "case",
    ["in", ["get", "name"], ["literal", occupied]], 0.9,
    0,
  ] as unknown as ExpressionSpecification;
}

export const NATION_LABEL: Record<NationState, string> = {
  axis: "Axis",
  "co-belligerent": "Co-belligerent",
  occupied: "Occupied",
  allied: "Allied",
  neutral: "Neutral",
};

export function nationStateOn(nation: Nation, iso: string): { state: NationState; note: string } {
  const day = toDay(iso);
  let current = { state: "neutral" as NationState, note: "" };
  for (const s of nation.status) {
    if (toDay(s.date) <= day) current = { state: s.state, note: s.note };
    else break;
  }
  return current;
}

/** A MapLibre `match` on country name, so the whole world repaints in one call. */
export function nationFillExpression(nations: Nation[], iso: string): ExpressionSpecification {
  const chain: unknown[] = ["match", ["get", "name"]];
  for (const n of nations) {
    const { state } = nationStateOn(n, iso);
    if (state === "neutral") continue;
    chain.push(n.name, NATION_COLOR[state]);
  }
  chain.push(PALETTE.land);
  return chain as unknown as ExpressionSpecification;
}

/* ---------- lookups ---------- */

export function controllerOn(transitions: Transition[], iso: string): Side {
  const day = toDay(iso);
  let side = transitions[0][1];
  for (const [d, s] of transitions.slice(1)) {
    if (toDay(d) <= day) side = s;
    else break;
  }
  return side;
}

/** Kept in step with the same radius in scripts/build-timeline.mjs. */
export function nearestPlace(places: Place[], lng: number, lat: number, maxKm = 45): Place | null {
  let best: Place | null = null;
  let bestKm = Infinity;
  for (const p of places) {
    const dx = (p.lng - lng) * Math.cos((lat * Math.PI) / 180) * 111.32;
    const dy = (p.lat - lat) * 110.57;
    const km = Math.hypot(dx, dy);
    if (km < bestKm) { bestKm = km; best = p; }
  }
  return bestKm <= maxKm ? best : null;
}

/**
 * Every theater running on a date — plural, because from April 1940 onward the
 * war stops being one thing at a time. Norway is still being fought when France
 * is invaded; the Balkans, the desert and the Atlantic all run at once. The map
 * draws them all and the reader zooms to whichever they want.
 *
 * Empty means an interlude — the Phoney War months when the front genuinely did
 * not move, and the map should say so rather than invent something.
 */
export function theatersFor<T extends { meta: { startDate: string; endDate: string } }>(
  theaters: T[], iso: string,
): T[] {
  const day = toDay(iso);
  return theaters.filter((t) => toDay(t.meta.startDate) <= day && day <= toDay(t.meta.endDate));
}

/**
 * Every campaign that has BEGUN by a date, finished or not.
 *
 * Conquered ground does not disappear when its campaign ends. Poland is still
 * occupied in 1941; drawing it only during September 1939 would say the
 * opposite. The baked timeline already holds each cell's final state for every
 * date past its last transition, so a finished theater simply keeps painting
 * what it ended as.
 */
export function theatersUpTo<T extends { meta: { startDate: string } }>(
  theaters: T[], iso: string,
): T[] {
  const day = toDay(iso);
  return theaters.filter((t) => toDay(t.meta.startDate) <= day);
}

/** Bounding box [w, s, e, n] of a set of border features, padded a little. */
export function boundsOf(features: GeoJSON.Feature[], pad = 1.2): [number, number, number, number] | null {
  let w = 180, s = 90, e = -180, n = -90;
  let seen = false;
  for (const f of features) {
    for (const ring of ringsOf(f)) {
      for (const [lng, lat] of ring) {
        seen = true;
        if (lng < w) w = lng; if (lng > e) e = lng;
        if (lat < s) s = lat; if (lat > n) n = lat;
      }
    }
  }
  return seen ? [w - pad, s - pad, e + pad, n + pad] : null;
}

function ringsOf(f: GeoJSON.Feature): number[][][] {
  const g = f.geometry;
  if (g.type === "Polygon") return g.coordinates as number[][][];
  if (g.type === "MultiPolygon") return (g.coordinates as number[][][][]).flat();
  return [];
}

export function cameraFor(cues: CameraCue[], iso: string): CameraCue {
  const day = toDay(iso);
  let active = cues[0];
  for (const c of cues) if (toDay(c.date) <= day) active = c;
  return active;
}
