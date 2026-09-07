import { cellToBoundary, gridDisk } from "h3-js";
import { controllerOn, type Side, type TheaterData } from "@/lib/theater";

/**
 * The front line, derived from the ground.
 *
 * The hex grid says who holds what. The front is simply the seam between two
 * different holders — so rather than authoring it separately (and risking it
 * disagreeing with the fill it is drawn over), it is read back out of the same
 * cells: every edge shared by two hexes in different hands, on this date.
 *
 * That also makes it honest about shape. A hand-drawn line would be a smooth
 * curve; this one is as ragged as the reconstruction actually is, and it closes
 * around pockets — Warsaw, Tobruk, the Kiev encirclement — without being told
 * they exist.
 *
 * WHICH HEXES TOUCH WHICH NEVER CHANGES. Only who holds them does. So the
 * adjacency graph and the shared edge for every neighbouring pair are built
 * once per campaign and reused for every date after that; deriving them afresh
 * each day cost 150ms on Barbarossa's 9,328 cells, which is most of a frame at
 * playback speed.
 */

type Seam = { a: string; b: string; edge: [number, number][] };

const graphs = new Map<string, Seam[]>();

/** Vertices rounded to ~1m, so two hexes agree on the edge they share. */
const key = (lng: number, lat: number) => `${lng.toFixed(5)},${lat.toFixed(5)}`;

function seamsOf(theater: TheaterData): Seam[] {
  const cached = graphs.get(theater.meta.id);
  if (cached) return cached;

  const cells = Object.keys(theater.hexes);
  const present = new Set(cells);
  const boundaries = new Map<string, [number, number][]>();
  const boundaryOf = (cell: string) => {
    let b = boundaries.get(cell);
    if (!b) {
      b = cellToBoundary(cell, true) as [number, number][];
      boundaries.set(cell, b);
    }
    return b;
  };

  const seams: Seam[] = [];
  const seen = new Set<string>();

  for (const cell of cells) {
    for (const neighbour of gridDisk(cell, 1)) {
      if (neighbour === cell) continue;
      // A cell at the theater's own edge has neighbours we know nothing about.
      // That is the edge of the reconstruction, not a front.
      if (!present.has(neighbour)) continue;

      const pair = cell < neighbour ? `${cell}|${neighbour}` : `${neighbour}|${cell}`;
      if (seen.has(pair)) continue;
      seen.add(pair);

      const mine = boundaryOf(cell);
      const theirs = new Set(boundaryOf(neighbour).map(([lng, lat]) => key(lng, lat)));
      const edge = mine.filter(([lng, lat]) => theirs.has(key(lng, lat)));
      if (edge.length === 2) seams.push({ a: cell, b: neighbour, edge });
    }
  }

  graphs.set(theater.meta.id, seams);
  return seams;
}

export function frontLines(theater: TheaterData, iso: string): GeoJSON.FeatureCollection {
  const seams = seamsOf(theater);

  const held = new Map<string, Side>();
  for (const [cell, transitions] of Object.entries(theater.hexes)) {
    held.set(cell, controllerOn(transitions, iso));
  }

  const features: GeoJSON.Feature[] = [];
  for (const { a, b, edge } of seams) {
    if (held.get(a) === held.get(b)) continue;
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: edge },
    });
  }

  return { type: "FeatureCollection", features };
}
