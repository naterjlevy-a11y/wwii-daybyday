"use client";

import { useEffect, useRef } from "react";
import { formatDate, toDay, toISO } from "@/lib/theater";

/** Year gridlines, so the scrubber reads as a calendar rather than a slider. */
function yearsBetween(first: number, last: number) {
  const out: { year: number; day: number }[] = [];
  const from = new Date(first * 86_400_000).getUTCFullYear();
  const to = new Date(last * 86_400_000).getUTCFullYear();
  for (let y = from; y <= to; y++) {
    const day = toDay(`${y}-01-01`);
    if (day > first && day < last) out.push({ year: y, day });
  }
  return out;
}

type Props = {
  start: string; end: string; date: string;
  playing: boolean; speed: number;
  keyframes: { date: string; label: string }[];
  onChange: (iso: string) => void;
  onPlayToggle: () => void;
  onSpeed: (ms: number) => void;
};

const SPEEDS = [
  { label: "1×", ms: 900 },
  { label: "2×", ms: 450 },
  { label: "4×", ms: 220 },
];

export default function Timeline({
  start, end, date, playing, speed, keyframes, onChange, onPlayToggle, onSpeed,
}: Props) {
  const first = toDay(start);
  const last = toDay(end);
  const current = toDay(date);
  const total = last - first;

  /* advance one day per tick while playing, then stop at the end */
  //
  // The date is parked in a ref so the interval is not torn down and rebuilt on
  // every tick — doing that made 4× run at 245ms rather than 220, so the speeds
  // did not mean what they said.
  const cursor = useRef(current);
  useEffect(() => { cursor.current = current; }, [current]);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      onChange(toISO(Math.min(last, cursor.current + 1)));
    }, speed);
    return () => clearInterval(id);
  }, [playing, speed, last, onChange]);

  useEffect(() => {
    if (playing && current >= last) onPlayToggle();
  }, [playing, current, last, onPlayToggle]);

  /* arrow keys step a day, shift steps a week */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type === "text") return;
      const step = e.shiftKey ? 7 : 1;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        // The range input handles its own arrows, so without this a shifted
        // press moved seven days here and one more there: eight in total.
        e.preventDefault();
        const to = e.key === "ArrowLeft"
          ? Math.max(first, current - step)
          : Math.min(last, current + step);
        onChange(toISO(to));
      } else if (e.key === " ") {
        e.preventDefault();
        onPlayToggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, first, last, onChange, onPlayToggle]);

  const years = yearsBetween(first, last);
  const pct = (day: number) => ((day - first) / total) * 100;

  return (
    <div className="card pointer-events-auto px-5 pt-3.5 pb-4">
      <div className="mb-3.5 flex items-center gap-5">
        <button
          onClick={onPlayToggle}
          aria-label={playing ? "Pause" : "Play"}
          className="figures border border-rule-strong px-3.5 py-1.5 text-[10.5px] tracking-[0.16em] text-paper transition hover:border-mark hover:text-mark-bright"
        >
          {playing ? "❚❚ PAUSE" : "▶ SIMULATE"}
        </button>

        <div className="flex items-baseline gap-3">
          {SPEEDS.map((s) => (
            <button
              key={s.ms}
              onClick={() => onSpeed(s.ms)}
              className={`figures text-[10.5px] transition ${
                speed === s.ms
                  ? "text-mark underline decoration-mark/60 underline-offset-[5px]"
                  : "text-paper-ghost hover:text-paper-dim"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <span className="ml-auto figures text-[10.5px] tracking-[0.1em] text-paper-faint">
          DAY {current - first + 1} / {total + 1}
        </span>
      </div>

      {/*
        A ruler, not a form control. The native input is kept for keyboard and
        pointer behaviour but made invisible; everything visible below is drawn,
        so the ticks can carry meaning — amber where a control line is actually
        dated, and a year gridline where the calendar turns over.
      */}
      <div className="relative h-9">
        <div className="pointer-events-none absolute inset-x-0 top-3 h-px bg-rule-strong" />

        {years.map((y) => (
          <div
            key={y.year}
            className="pointer-events-none absolute top-0 -translate-x-1/2"
            style={{ left: `${pct(y.day)}%` }}
          >
            <div className="mx-auto h-6 w-px bg-rule-strong" />
            <div className="figures mt-1 text-[9.5px] text-paper-ghost">{y.year}</div>
          </div>
        ))}

        {/* Two campaigns can share a date once fronts overlap, so the label
            disambiguates the key as well as the tooltip. */}
        {keyframes.map((k) => (
          <span
            key={`${k.date}|${k.label}`}
            title={`${formatDate(k.date)} — ${k.label}`}
            className="pointer-events-none absolute top-0 h-3 w-px bg-mark/80"
            style={{ left: `${pct(toDay(k.date))}%` }}
          />
        ))}

        {/* Ground covered so far, and the day itself. */}
        <div
          className="pointer-events-none absolute top-3 h-px bg-paper-dim"
          style={{ left: 0, width: `${pct(current)}%` }}
        />
        <div
          className="pointer-events-none absolute top-3 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${pct(current)}%` }}
        >
          <div className="h-3.5 w-[3px] bg-paper" />
        </div>

        {/*
          The native input carries pointer and keyboard behaviour; everything
          visible is drawn above. Its thumb is collapsed to zero width so the
          value and the drawn marker cannot drift apart at the ends, and it keeps
          a focus ring of its own since opacity-0 would have removed it.
        */}
        <input
          type="range"
          min={first}
          max={last}
          value={current}
          onChange={(e) => onChange(toISO(Number(e.target.value)))}
          className="timeline-input absolute inset-x-0 top-0 h-7 w-full cursor-pointer"
          aria-label="Date"
        />
      </div>

      <div className="mt-1 flex items-baseline justify-between gap-4">
        <span className="figures text-[9.5px] text-paper-ghost">{start}</span>
        <span className="figures text-[9.5px] tracking-[0.1em] text-paper-ghost">
          <span className="text-mark">▲</span> DATED CONTROL LINES · EVERYTHING BETWEEN IS INTERPOLATED
        </span>
        <span className="figures text-[9.5px] text-paper-ghost">{end}</span>
      </div>
    </div>
  );
}
