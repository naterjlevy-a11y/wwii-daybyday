"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import Timeline from "@/components/Timeline";
import { DayPanel, PlacePanel, type Selection } from "@/components/Sidebar";
import FrontPages, { pressLineFor, warmFrontPages } from "@/components/FrontPages";
import StateOfTheWar from "@/components/StateOfTheWar";
import {
  PALETTE, SIDE_LABEL, boundsOf, cameraFor, describeMove, nearestPlace,
  sideLabels, sidesOf, theatersFor, theatersUpTo, toDay,
  type CameraCue, type Nation, type Side, type TheaterData,
} from "@/lib/theater";
import type { MapView } from "@/components/WarMap";
import { latLngToCell } from "h3-js";

import theaterList from "@/data/theaters.json";
import cameraCues from "@/data/camera.json";
import nationsData from "@/data/nations.json";
import { BORDERS, DAYS, PLACES } from "@/lib/campaigns";


const WarMap = dynamic(() => import("@/components/WarMap"), { ssr: false });

const CUES = cameraCues as CameraCue[];
const NATIONS = nationsData as Nation[];


const FIRST_DAY = "1939-09-01";

// Every set of baked front pages: one per campaign, plus the interludes.
// Merged in order, so later sources win: the weekly filler goes first as the
// floor, and each campaign's richer per-day bake overwrites it.
const PRESS_SOURCES = [
  "filler",
  ...(theaterList as { id: string }[]).map((t) => t.id),
  "interlude",
];

export default function Home() {
  const [theaters, setTheaters] = useState<TheaterData[] | null>(null);
  const [date, setDate] = useState(FIRST_DAY);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(450);
  const [selection, setSelection] = useState<Selection>(null);

  useEffect(() => {
    // The newspapers are wanted the instant the timeline moves, so start them
    // alongside the campaign data rather than when the strip first renders.
    warmFrontPages(PRESS_SOURCES);
    Promise.all(
      (theaterList as { id: string }[]).map((t) =>
        fetch(`/data/${t.id}.json`).then((r) => r.json() as Promise<TheaterData>),
      ),
    ).then((loaded) => {
      loaded.sort((a, b) => a.meta.startDate.localeCompare(b.meta.startDate));
      setTheaters(loaded);
    });
  }, []);

  // Every campaign running today, not just one — from spring 1940 the war is
  // several things at once.
  //
  // Memoised on the SET of live campaigns rather than the date. Stepping a day
  // inside the same campaigns must not produce a new array: the map rebuilds
  // its hex source whenever this changes, and Barbarossa alone is 9,176 cells —
  // doing that on every tick would make playback crawl.
  const activeIds = useMemo(
    () => (theaters ? theatersFor(theaters, date).map((t) => t.meta.id).join("+") : ""),
    [theaters, date],
  );
  const active = useMemo(
    () => (theaters && activeIds ? activeIds.split("+").map((id) => theaters.find((t) => t.meta.id === id)!) : []),
    [theaters, activeIds],
  );

  // Everything that has been fought over BY now, not just what is being fought
  // over today. Conquered ground stays on the map: Poland is still occupied in
  // 1941, and a map that forgot it would be lying about the whole war.
  const drawnIds = useMemo(
    () => (theaters ? theatersUpTo(theaters, date).map((t) => t.meta.id).join("+") : ""),
    [theaters, date],
  );
  const drawn = useMemo(
    () => (theaters && drawnIds ? drawnIds.split("+").map((id) => theaters.find((t) => t.meta.id === id)!) : []),
    [theaters, drawnIds],
  );
  const borders = useMemo(
    () => drawn.map((t) => BORDERS[t.meta.id]).filter(Boolean),
    [drawn],
  );

  // Which front the reader is looking at. Null means "all of them", and a front
  // that ends drops the focus rather than stranding the camera off-map.
  const [focusId, setFocusId] = useState<string | null>(null);
  const focus = active.find((t) => t.meta.id === focusId) ?? null;

  const camera = useMemo(() => cameraFor(CUES, date), [date]);
  // Several campaigns can write the same date; the panel shows all of them.
  const entries = useMemo(() => DAYS[date] ?? [], [date]);
  const events = useMemo(() => entries.flatMap((d) => d.events), [entries]);

  // Panels describe one front at a time: the focused one, or the only one running.
  const subject = focus ?? (active.length === 1 ? active[0] : null);
  // ...but the colour key describes what is ON THE MAP, which is every campaign
  // begun so far. Keying off the live fronts left gold Soviet hexes on screen
  // with no entry for them, and no key at all during an interlude.
  const labels = useMemo(() => sideLabels(subject), [subject]);

  // For days nobody has written an entry for, the timeline still knows what
  // happened. Read it back out as a sentence per front.
  const movements = useMemo(
    () =>
      active.flatMap((t) => {
        const move = t.meta.daily?.[date];
        if (!move) return [];
        const line = describeMove(t, move, sideLabels(t));
        return line ? [{ theater: t.meta.name, line }] : [];
      }),
    [active, date],
  );

  // The camera follows the fighting, not the occupation: it frames the fronts
  // that are live today, while everything taken earlier stays drawn around them.
  //
  // A cue overrides that for the few days around the date it names. Without
  // this they were unreachable — from September 1940 the desert war runs without
  // a gap, so the bounds fit always won and "Pearl Harbor. The war becomes
  // global." framed the Egyptian frontier instead of the globe.
  const view = useMemo<MapView>(() => {
    const cueIsNow = Math.abs(toDay(date) - toDay(camera.date)) <= 2;
    if (!focus && cueIsNow) {
      return { kind: "cue", key: `cue:${camera.date}`, center: camera.center, zoom: camera.zoom };
    }
    const framed = focus
      ? [BORDERS[focus.meta.id]]
      : active.map((t) => BORDERS[t.meta.id]).filter(Boolean);
    const box = boundsOf(framed.filter(Boolean));
    if (box) {
      // Keyed with the date when a front is focused, so scrubbing a focused
      // campaign keeps re-framing it instead of freezing on the first fit.
      return { kind: "bounds", key: focus ? `${focus.meta.id}:${activeIds}` : activeIds, bounds: box };
    }
    return { kind: "cue", key: `cue:${camera.date}`, center: camera.center, zoom: camera.zoom };
  }, [focus, active, activeIds, camera, date]);

  // The scrubber runs from the first shot to the last day authored, straight
  // through the interludes rather than stopping at the end of each campaign.
  const span = useMemo(() => {
    const authored = Object.keys(DAYS).sort();
    const last = authored[authored.length - 1];
    const end = theaters
      ? [...theaters.map((t) => t.meta.endDate), last].sort().pop()!
      : last;
    return { start: FIRST_DAY, end };
  }, [theaters]);

  // Only the campaigns being fought today. Every campaign that had ever begun
  // put sixty-odd ticks on the ruler and rendered whole years as a solid amber
  // block; these are the dated lines behind what is actually on screen.
  const keyframes = useMemo(
    () => (focus ? focus.meta.keyframes : active.flatMap((t) => t.meta.keyframes)),
    [active, focus],
  );

  // A click has to work out which front it landed in, since several are drawn.
  //
  // Reversed, because `drawn` is ascending by start date and the map dedupes
  // overlapping cells in favour of the campaign that started LATEST. Iterating
  // forwards made the panel answer from the Polish campaign for ground the map
  // had already repainted as Barbarossa's.
  const onPick = useCallback(
    ({ lng, lat }: { lng: number; lat: number }) => {
      for (const t of [...drawn].reverse()) {
        const transitions = t.hexes[latLngToCell(lat, lng, t.meta.hexResolution)];
        if (!transitions) continue;
        setSelection({
          theaterId: t.meta.id,
          place: nearestPlace(PLACES[t.meta.id] ?? [], lng, lat),
          lng, lat,
          transitions,
        });
        return;
      }
      setSelection(null);
    },
    [drawn],
  );

  // A selection survives as long as its ground is still drawn, which is now for
  // the rest of the war rather than only while its campaign is being fought.
  const activeSelection =
    selection && drawn.some((t) => t.meta.id === selection.theaterId) ? selection : null;
  const selectionLabels = useMemo(
    () => sideLabels(drawn.find((t) => t.meta.id === activeSelection?.theaterId) ?? null),
    [drawn, activeSelection],
  );

  if (!theaters) {
    return (
      <main className="grid h-dvh place-items-center bg-ink-900">
        <span className="tab animate-pulse text-[11px]">Loading the war…</span>
      </main>
    );
  }

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-ink-900">
      <WarMap
        theaters={drawn}
        borders={borders}
        fighting={active}
        date={date}
        view={view}
        nations={NATIONS}
        events={events}
        onPick={onPick}
      />

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-5">
        <div className="flex items-start justify-between gap-5">
          <div className="flex max-h-[calc(100dvh-9rem)] flex-col overflow-y-auto pr-1">
            <DayPanel
              date={date}
              entries={entries}
              campaignName={(id) => theaters.find((t) => t.meta.id === id)?.meta.name ?? null}
              fallbackName={subject?.meta.name ?? null}
              movements={movements}
              press={entries.length === 0 ? pressLineFor(date) : null}
            />
            <FrontPages
              date={date}
              query={entries.find((d) => d.press)?.press ?? "war"}
              sources={PRESS_SOURCES}
            />
          </div>
          <div className="flex flex-col items-end gap-2.5">
            <Fronts
              active={active}
              focusId={focus?.meta.id ?? null}
              onFocus={setFocusId}
              camera={camera}
            />
            <Legend subject={subject} labels={labels} drawn={drawn} />
            <StateOfTheWar nations={NATIONS} date={date} />
            <PlacePanel
              selection={activeSelection}
              date={date}
              labels={selectionLabels}
              onClose={() => setSelection(null)}
            />
          </div>
        </div>

        <div className="mx-auto w-full max-w-3xl">
          <Timeline
            start={span.start}
            end={span.end}
            date={date}
            playing={playing}
            speed={speed}
            keyframes={keyframes}
            onChange={setDate}
            onPlayToggle={() => setPlaying((p) => !p)}
            onSpeed={setSpeed}
          />
        </div>
      </div>
    </main>
  );
}

/**
 * The fronts running today. Once several campaigns overlap this is the way in:
 * pick one to fly to it, or step back out to see the whole war at once.
 */
function Fronts({
  active, focusId, onFocus, camera,
}: {
  active: TheaterData[];
  focusId: string | null;
  onFocus: (id: string | null) => void;
  camera: CameraCue;
}) {
  if (active.length === 0) {
    return (
      <div className="card pointer-events-auto w-[15.5rem] px-4 pt-3 pb-3.5">
        <div className="tab">Quiet</div>
        <div className="mt-1.5 font-serif text-[13px] leading-snug text-paper-dim">
          No front is moving today.
        </div>
        <div className="mt-1 font-serif text-[11.5px] italic leading-snug text-paper-ghost">
          {camera.reason}
        </div>
      </div>
    );
  }

  return (
    <div className="card pointer-events-auto w-[15.5rem] px-4 pt-3 pb-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="tab whitespace-nowrap">
          {active.length === 1 ? "The front" : `${active.length} fronts`}
        </span>
        {focusId && (
          <button
            onClick={() => onFocus(null)}
            className="figures text-[9.5px] text-mark transition hover:text-mark-bright"
          >
            SEE ALL
          </button>
        )}
      </div>
      <ul className="mt-2 -mx-1.5">
        {active.map((t) => (
          <li key={t.meta.id}>
            <button
              onClick={() => onFocus(focusId === t.meta.id ? null : t.meta.id)}
              className={`w-full px-1.5 py-1 text-left font-serif text-[13px] leading-snug transition ${
                focusId === t.meta.id
                  ? "border-l-2 border-mark bg-mark/10 pl-2 text-paper"
                  : "border-l-2 border-transparent pl-2 text-paper-dim hover:border-rule-strong hover:text-paper"
              }`}
            >
              {t.meta.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Legend({
  subject, labels, drawn,
}: { subject: TheaterData | null; labels: Record<Side, string>; drawn: TheaterData[] }) {
  if (drawn.length === 0) return null;

  // With one front the key names its actual combatants — Polish, Finnish,
  // German. With several the names differ per front while the colours do not,
  // so the key falls back to what the colours mean everywhere.
  const sides = subject
    ? sidesOf(subject)
    : ([...new Set(drawn.flatMap(sidesOf))] as Side[]);
  const naming = subject ? labels : SIDE_LABEL;

  return (
    <div className="card pointer-events-auto w-[15.5rem] px-4 pt-3 pb-3">
      <div className="tab">Ground held</div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
        {sides.map((s) => (
          <span key={s} className="flex items-baseline gap-1.5">
            <span
              className="h-2.5 w-2.5 translate-y-[1px] border border-black/40"
              style={{ background: PALETTE[s] }}
            />
            <span className="font-serif text-[12.5px] text-paper-dim">{naming[s]}</span>
          </span>
        ))}
      </div>
      <div className="mt-2.5 font-serif text-[11.5px] italic text-paper-ghost">
        Click anywhere on the map
      </div>
    </div>
  );
}
