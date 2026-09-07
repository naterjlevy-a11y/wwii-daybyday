"use client";

import { useEffect, useRef, useState } from "react";
import {
  Map as MlMap, NavigationControl, AttributionControl, setWorkerUrl,
  type GeoJSONSource, type MapMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { frontLines } from "@/lib/front";
import {
  OCCUPIED_RING, PALETTE, buildHexFeatures, fillColorExpression,
  nationFillExpression, occupiedRingExpression, recencyOpacityExpression, toDay,
  type Nation, type TheaterData, type WarEvent,
} from "@/lib/theater";

export type MapView =
  | { kind: "bounds"; key: string; bounds: [number, number, number, number] }
  | { kind: "cue"; key: string; center: [number, number]; zoom: number };

type Props = {
  /** Every campaign running today. The map draws them all at once. */
  theaters: TheaterData[];
  /** The campaigns still being fought — the ones that have a front line. */
  fighting: TheaterData[];
  borders: GeoJSON.Feature[];
  date: string;
  /** Where to look: a box to fit around the live fronts, or a cue's fixed framing. */
  view: MapView;
  /** Allegiance of every country, so the whole world takes a side. */
  nations: Nation[];
  events: WarEvent[];
  onPick: (pick: { lng: number; lat: number }) => void;
};

const EVENT_COLOR: Record<string, string> = {
  battle: "#e8d9a0", siege: "#e8a05a", bombing: "#e05a4a",
  capture: "#cfc6b4", political: "#8fb8cf", invasion: "#e05a4a",
};

// MapLibre v6 derives its worker URL from import.meta.url, which Turbopack
// rewrites to a chunk path where the worker file does not exist. The worker
// then never boots, no source ever parses, and the map renders nothing with no
// error raised. `scripts/copy-maplibre-worker.mjs` stages the worker under
// /public and we point MapLibre at it directly.
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

export default function WarMap({ theaters, borders, fighting, date, view, nations, events, onPick }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const ready = useRef(false);
  // Bumped once the style is up, so the data effects below re-run against a map
  // that is actually ready to receive them.
  const [tick, setTick] = useState(0);
  const pick = useRef(onPick);
  // The map is created once and its click handler closes over this ref, so the
  // latest callback has to be parked here — after render, not during it.
  useEffect(() => { pick.current = onPick; }, [onPick]);

  /* ---- create the map once ---- */
  useEffect(() => {
    if (!container.current || map.current) return;

    const m = new MlMap({
      container: container.current,
      // No tile provider: modern basemap tiles would draw modern borders, which
      // are exactly the thing this map exists to contradict. The ground is
      // drawn from 1938 boundary data instead.
      style: {
        version: 8,
        sources: {},
        layers: [{ id: "ground", type: "background", paint: { "background-color": PALETTE.ground } }],
      },
      center: view.kind === "cue" ? view.center : [14, 52],
      zoom: view.kind === "cue" ? view.zoom : 4,
      minZoom: 1.5,
      maxZoom: 9,
      attributionControl: false,
    });
    map.current = m;
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __map?: MlMap }).__map = m;
    }

    m.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    m.addControl(
      new AttributionControl({
        customAttribution:
          "Boundaries: historical-basemaps (1938) · Control lines: approximate reconstruction",
      }),
      "bottom-left",
    );

    m.on("load", async () => {
      const world = await fetch("/data/world_1938.geojson").then((r) => r.json());

      m.addSource("world", { type: "geojson", data: world });
      m.addLayer({
        id: "world-fill", type: "fill", source: "world",
        paint: { "fill-color": nationFillExpression(nations, date), "fill-opacity": 0.85 },
      });
      // Every country separable from its neighbours, even when they are the
      // same colour: without this the Axis bloc reads as one shape.
      m.addLayer({
        id: "world-line", type: "line", source: "world",
        paint: {
          "line-color": "#39352f",
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.5, 5, 0.9, 8, 1.2],
        },
      });

      // Occupied countries keep their own outline, drawn in the colour of
      // whoever holds them.
      m.addLayer({
        id: "world-occupied", type: "line", source: "world",
        paint: {
          "line-color": OCCUPIED_RING,
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 1, 5, 1.6, 8, 2.2],
          "line-opacity": occupiedRingExpression(nations, date),
        },
      });

      m.addSource("hexes", { type: "geojson", data: emptyCollection() });
      m.addLayer({
        id: "hex-fill", type: "fill", source: "hexes",
        paint: { "fill-color": fillColorExpression(toDay(date)), "fill-opacity": 0.75 },
      });
      // Ground taken in the last few days, lightened just enough to follow
      // during playback. Kept as a faint wash rather than an outline now that
      // the front line owns the bone colour — two bright strokes along the same
      // seam read as one confused thing.
      m.addLayer({
        id: "hex-recent", type: "fill", source: "hexes",
        paint: { "fill-color": PALETTE.ink, "fill-opacity": recencyOpacityExpression(toDay(date)) },
      });
      m.addLayer({
        id: "hex-line", type: "line", source: "hexes",
        paint: { "line-color": PALETTE.ground, "line-width": 0.4, "line-opacity": 0.5 },
      });

      // The edge of the fought-over ground, drawn in bone.
      //
      // Without it the Axis hex fill and the Axis nation fill are the same red
      // and the front line dissolves into the countries it runs through — on
      // 30 June 1941 the whole western half of the map was one flat red. This
      // gives the grid an outline so it reads as a separate object.
      m.addLayer({
        id: "hex-edge", type: "line", source: "hexes",
        paint: {
          "line-color": PALETTE.ink,
          "line-opacity": 0.16,
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 6, 1.1],
        },
      });

      m.addSource("front", { type: "geojson", data: emptyCollection() });
      // Drawn twice: a soft wide pass underneath for weight, and a hard thin
      // pass on top for the line itself.
      m.addLayer({
        id: "front-glow", type: "line", source: "front",
        paint: {
          "line-color": PALETTE.ink,
          "line-opacity": 0.16,
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 5, 6, 11],
          "line-blur": ["interpolate", ["linear"], ["zoom"], 3, 3, 6, 7],
        },
      });
      m.addLayer({
        id: "front-line", type: "line", source: "front",
        paint: {
          "line-color": PALETTE.ink,
          "line-opacity": 0.92,
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 1.4, 6, 2.6],
        },
      });

      m.addSource("border", { type: "geojson", data: emptyCollection() });
      m.addLayer({
        id: "border-line", type: "line", source: "border",
        paint: { "line-color": PALETTE.ink, "line-width": 1.4, "line-opacity": 0.55, "line-dasharray": [3, 2] },
      });

      m.addSource("events", { type: "geojson", data: eventCollection(events) });
      m.addLayer({
        id: "event-halo", type: "circle", source: "events",
        paint: {
          "circle-radius": 11, "circle-color": ["get", "color"],
          "circle-opacity": 0.18, "circle-blur": 0.6,
        },
      });
      m.addLayer({
        id: "event-dot", type: "circle", source: "events",
        paint: {
          "circle-radius": 4, "circle-color": ["get", "color"],
          "circle-stroke-width": 1.2, "circle-stroke-color": PALETTE.ground,
        },
      });
      // Country names, from one point per country rather than from the polygons
      // themselves: a symbol layer over a polygon source repeats the label once
      // per tile, which writes USSR across the map three times.
      m.addSource("world-labels", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: (world.features as GeoJSON.Feature[])
            .filter((f) => f.properties?.labelAt)
            .map((f) => ({
              type: "Feature" as const,
              properties: { name: f.properties!.name },
              geometry: { type: "Point" as const, coordinates: f.properties!.labelAt },
            })),
        },
      });

      m.addLayer({
        id: "world-label", type: "symbol", source: "world-labels",
        layout: {
          "text-field": ["coalesce", ["get", "name"], ""],
          "text-size": ["interpolate", ["linear"], ["zoom"], 2, 9, 4, 10.5, 6, 12],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.16,
          "text-padding": 6,
          "text-allow-overlap": false,
          "symbol-placement": "point",
        },
        paint: {
          // Foreground, from the type ramp — not the fill colour of neutral
          // countries pressed into service, which left every name over occupied
          // red or Axis red effectively unreadable.
          "text-color": "#a79d8c",
          "text-halo-color": PALETTE.ground,
          "text-halo-width": 1.8,
          "text-halo-blur": 0.4,
          "text-opacity": ["interpolate", ["linear"], ["zoom"], 1.5, 0, 2.5, 0.85, 6, 1],
        },
      }, "hex-fill");

      m.addLayer({
        id: "event-label", type: "symbol", source: "events",
        layout: {
          "text-field": ["get", "name"], "text-size": 11,
          "text-offset": [0, 1.1], "text-anchor": "top", "text-allow-overlap": false,
        },
        paint: { "text-color": PALETTE.ink, "text-halo-color": PALETTE.ground, "text-halo-width": 1.4 },
      });

      ready.current = true;
      setTick((t) => t + 1);
    });

    m.on("click", (e: MapMouseEvent) => pick.current({ lng: e.lngLat.lng, lat: e.lngLat.lat }));
    m.on("mouseenter", "hex-fill", () => (m.getCanvas().style.cursor = "crosshair"));
    m.on("mouseleave", "hex-fill", () => (m.getCanvas().style.cursor = ""));

    return () => { m.remove(); map.current = null; ready.current = false; };
    // Created once; subsequent prop changes are handled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- swap the theater's ground when the calendar moves between campaigns ---- */
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    // Campaigns can overlap on the ground: eastern Poland is fought over in
    // 1939 and again in 1941, and Barbarossa's grid covers the same cells the
    // Polish campaign left Soviet. Cells are keyed by H3 index, so dedupe on it
    // and let the campaign that STARTED LATEST win — its account of that ground
    // is the more recent one, and drawing both leaves a seam where the two
    // grids disagree.
    const byCell = new Map<string, GeoJSON.Feature>();
    const ordered = [...theaters].sort((a, b) =>
      a.meta.startDate.localeCompare(b.meta.startDate),
    );
    for (const t of ordered) {
      for (const f of buildHexFeatures(t.hexes).features) {
        byCell.set(String(f.properties.h), f);
      }
    }
    (m.getSource("hexes") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: [...byCell.values()],
    });
    (m.getSource("border") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: borders,
    });
  }, [theaters, borders, tick]);

  /* ---- the front line, re-derived as the day moves ---- */
  //
  // Only for campaigns still being fought. A finished campaign has no front —
  // its seam is a border now — and deriving one for all seven would cost the
  // same work every day for lines that cannot move.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    const features = fighting.flatMap((t) => frontLines(t, date).features);
    (m.getSource("front") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features,
    });
  }, [fighting, date, tick]);

  /* ---- repaint on date change (one paint update, no data re-upload) ---- */
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    const day = toDay(date);
    m.setPaintProperty("hex-fill", "fill-color", fillColorExpression(day));
    m.setPaintProperty("hex-recent", "fill-opacity", recencyOpacityExpression(day));
    m.setPaintProperty("world-fill", "fill-color", nationFillExpression(nations, date));
    m.setPaintProperty("world-occupied", "line-opacity", occupiedRingExpression(nations, date));
  }, [date, nations, tick]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    (m.getSource("events") as GeoJSONSource | undefined)?.setData(eventCollection(events));
  }, [events, tick]);

  /* ---- the camera widens as the war does ---- */
  //
  // Keyed on `view.key` rather than the object, so panning and zooming by hand
  // is never yanked back: the map only moves itself when the day actually
  // changes which fronts are running, or the reader picks one to look at.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (view.kind === "bounds") {
      m.fitBounds(view.bounds, { padding: fitPadding(m), duration: 2200, maxZoom: 6.5, essential: true });
    } else {
      m.flyTo({ center: view.center, zoom: view.zoom, duration: 2200, essential: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.key]);

  return (
    <div
      ref={container}
      // MapLibre's own stylesheet sets .maplibregl-map { position: relative },
      // which beats the Tailwind utility and collapses the div to zero height.
      style={{ position: "absolute", inset: 0 }}
    />
  );
}

/** Keep the fronts clear of the reading panels, which float over the map. */
function fitPadding(m: MlMap) {
  const w = m.getCanvas().clientWidth;
  return { top: 70, bottom: 130, left: w > 900 ? 420 : 40, right: w > 900 ? 300 : 40 };
}

function emptyCollection(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function eventCollection(events: WarEvent[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: events.map((e) => ({
      type: "Feature",
      properties: { name: e.name, kind: e.kind, color: EVENT_COLOR[e.kind] ?? PALETTE.ink },
      geometry: { type: "Point", coordinates: [e.lng, e.lat] },
    })),
  };
}
