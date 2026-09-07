"use client";

import { useEffect, useState } from "react";
import {
  PALETTE, controllerOn, formatDate, toDay,
  type Day, type Place, type Side, type Transition,
} from "@/lib/theater";

export type Selection = {
  /** Which campaign the click landed in — several may be drawn at once. */
  theaterId: string;
  place: Place | null;
  lng: number;
  lat: number;
  transitions: Transition[];
} | null;

type Clipping = { date: string; paper: string; place: string | null; url: string };
/**
 * Which front pages mention which places, built offline from the OCR we already
 * have. Fetched once per session and then answered synchronously.
 */
let pressIndex: Record<string, Clipping[]> | null = null;
let pressPromise: Promise<void> | null = null;

function loadPressIndex(): Promise<void> {
  pressPromise ??= fetch("/data/place-press.json")
    .then((r) => (r.ok ? r.json() : {}))
    .then((j) => { pressIndex = j; })
    .catch(() => { pressIndex = {}; });
  return pressPromise;
}

/** Mentions within a few days either side of the date being viewed. */
function mentionsOf(place: string | undefined, date: string, windowDays = 3): Clipping[] {
  if (!place || !pressIndex) return [];
  const day = toDay(date);
  return (pressIndex[place] ?? [])
    .filter((c) => Math.abs(toDay(c.date) - day) <= windowDays)
    .slice(0, 6);
}

type Holding = {
  title: string; language: string | null; country: string | null;
  provider: string | null; thumb: string | null; link: string;
};

const DOT: Record<Side, string> = {
  defender: PALETTE.defender, axis: PALETTE.axis, soviet: PALETTE.soviet,
};

export function DayPanel({
  date, entries, campaignName, fallbackName, movements, press,
}: {
  date: string;
  /** Every entry written for this date — several campaigns can share one. */
  entries: Day[];
  campaignName: (id: string) => string | null;
  fallbackName: string | null;
  /** One derived line per front that moved today, for days with no entry. */
  movements: { theater: string; line: string }[];
  /** What the day's own papers said, for a day nobody wrote up. */
  press: { paper: string; passage: string } | null;
}) {
  const lead = entries[0];
  const rest = entries.slice(1);
  const theaterName = lead
    ? (lead.from ? campaignName(lead.from) : null)
    : fallbackName;
  return (
    <div className="card pointer-events-auto w-[23rem] px-5 pt-4 pb-5">
      {/* The dateline, set like the top of a column: campaign, then date, then
          the rule the headline hangs from. */}
      <div className="flex items-baseline justify-between gap-3">
        <span className="figures text-[10.5px] tracking-[0.14em] text-paper-faint">
          {formatDate(date).toUpperCase()}
        </span>
        {theaterName && (
          <span className="tab shrink-0 text-mark">{theaterName}</span>
        )}
      </div>

      <div className="mt-3 h-px bg-rule-strong" />

      <h1 className="mt-3 font-serif text-[26px] font-normal leading-[1.12] tracking-[-0.01em] text-paper">
        {lead?.headline ?? (movements.length > 0 ? "The line moves" : "A quiet day")}
      </h1>
      {lead && (
        <p className="mt-2.5 font-serif text-[13.5px] leading-[1.62] text-paper-dim">
          {lead.summary}
        </p>
      )}

      {/* The same day can belong to more than one campaign. */}
      {rest.map((d) => (
        <div key={d.headline} className="mt-3.5 border-t border-rule pt-3">
          {d.from && campaignName(d.from) && (
            <div className="tab mb-1 text-mark">{campaignName(d.from)}</div>
          )}
          <h2 className="font-serif text-[18px] leading-tight text-paper">{d.headline}</h2>
          <p className="mt-1.5 font-serif text-[13px] leading-[1.6] text-paper-dim">{d.summary}</p>
        </div>
      ))}

      {/* Most days of a long war were never written up. Rather than show an
          empty panel, say what the map itself recorded. */}
      {!lead && movements.length > 0 && (
        <ul className="mt-2.5 space-y-2">
          {movements.map((m) => (
            <li key={m.theater} className="font-serif text-[13.5px] leading-[1.62] text-paper-dim">
              <span className="tab mr-1.5 align-[1px] text-paper-ghost">{m.theater}</span>
              {m.line}
            </li>
          ))}
        </ul>
      )}
      {!lead && movements.length === 0 && !press && (
        <p className="mt-2.5 font-serif text-[13.5px] leading-[1.62] text-paper-faint">
          No ground changed hands on any front today. Most days of the war looked
          like this one; the papers below are what people had instead.
        </p>
      )}

      {/* On a day with no written entry, let the day's own papers speak. */}
      {!lead && press && (
        <figure className="mt-3">
          <blockquote className="border-l border-mark/50 pl-3.5 font-serif text-[13.5px] leading-[1.6] text-paper-dim">
            {press.passage}
          </blockquote>
          <figcaption className="figures mt-1.5 pl-3.5 text-[9.5px] text-paper-ghost">
            {press.paper.toUpperCase()}
          </figcaption>
        </figure>
      )}
      {entries.flatMap((d) => d.events).length > 0 && (
        <ul className="mt-4 space-y-3 border-t border-rule pt-3.5">
          {entries.flatMap((d) => d.events).map((e) => (
            <li key={e.name + e.kind} className="leading-relaxed">
              <div className="flex items-baseline gap-2">
                <span className="font-serif text-[13px] text-paper">{e.name}</span>
                <span className="tab">{e.kind}</span>
              </div>
              <div className="mt-0.5 font-serif text-[12.5px] leading-[1.55] text-paper-faint">
                {e.text}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PlacePanel({
  selection, date, labels, onClose,
}: { selection: Selection; date: string; labels: Record<Side, string>; onClose: () => void }) {
  const name = selection?.place?.name;
  // One piece of state, tagged with the lookup it answers. Anything whose tag
  // does not match the current place-and-date is by definition still in flight,
  // so "loading" is derived rather than set — no synchronous state writes here.
  const [result, setResult] = useState<{ key: string; clippings: Clipping[]; failed?: boolean } | null>(
    () => (pressIndex ? { key: `${name}|${date}`, clippings: mentionsOf(name, date) } : null),
  );
  const key = name ? `${name}|${date}` : null;

  useEffect(() => {
    if (!name || !key) return;
    let cancelled = false;
    // Answered from disk. scripts/build-place-index.mjs scans the OCR of every
    // front page we already hold for every place in every gazetteer, so this
    // needs no network at all — which matters, because the Library of Congress
    // search rate-limits to a hard stop and was the flakiest thing here.
    (async () => {
      await loadPressIndex();
      if (!cancelled) setResult({ key, clippings: mentionsOf(name, date) });
    })();
    return () => { cancelled = true; };
  }, [name, date, key]);

  // What Europe's own libraries hold about this place, in whatever language
  // they hold it in. Coarser than the American front pages — Europeana dates
  // reliably to the year, not the day — so it is asked and labelled as a
  // different question rather than blended into the same list.
  const year = date.slice(0, 4);
  const localName = selection?.place?.pl ?? null;
  const euKey = name ? `${name}|${localName ?? ""}|${year}` : null;
  const [euro, setEuro] = useState<{ key: string; holdings: Holding[]; total: number; failed?: boolean } | null>(null);

  useEffect(() => {
    if (!name || !euKey) return;
    let cancelled = false;
    const q = new URLSearchParams({ place: name, year });
    if (localName && localName !== name) q.set("alt", localName);
    fetch(`/api/archives?${q}`)
      .then(async (r) => ({ ok: r.ok, body: await r.json() }))
      .then(({ ok, body }) => {
        if (cancelled) return;
        setEuro({ key: euKey, holdings: body.holdings ?? [], total: body.total ?? 0, failed: !ok });
      })
      .catch(() => { if (!cancelled) setEuro({ key: euKey, holdings: [], total: 0, failed: true }); });
    return () => { cancelled = true; };
  }, [name, localName, year, euKey]);

  const european = euro && euro.key === euKey ? euro : null;

  const current = result && result.key === key ? result : null;
  const clippings = current?.clippings ?? null;
  const loading = key !== null && current === null;

  if (!selection) return null;

  // Who holds the cell is derived from the date, never stored: the panel then
  // stays correct on its own as the timeline runs underneath it.
  const holder = controllerOn(selection.transitions, date);
  const held = selection.transitions.filter(([d]) => toDay(d) <= toDay(date));
  const since = held[held.length - 1]?.[0];
  const next = selection.transitions.find(([d]) => toDay(d) > toDay(date));

  return (
    <div className="card pointer-events-auto w-[21.5rem] px-5 pt-4 pb-5">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className="tab">Selected</div>
          <h2 className="mt-1 font-serif text-[19px] leading-tight text-paper">
            {selection.place?.name ?? "Open country"}
          </h2>
          {selection.place?.pl && selection.place.pl !== selection.place.name && (
            <div className="font-serif text-[12px] italic text-paper-ghost">{selection.place.pl}</div>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 -mt-1 px-1.5 py-1 text-[13px] text-paper-ghost transition hover:text-paper"
        >
          ✕
        </button>
      </div>

      <div className="mt-3.5 border-t border-rule pt-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0" style={{ background: DOT[holder] }} />
          <span className="font-serif text-[14px] text-paper">{labels[holder]} held</span>
        </div>
        {since && held.length > 1 && (
          <div className="figures mt-1 text-[10.5px] text-paper-faint">
            SINCE {formatDate(since).replace(/^\w+, /, "").toUpperCase()}
          </div>
        )}
        {next && (
          <div className="mt-1.5 font-serif text-[12.5px] leading-snug text-paper-faint">
            Changes hands to {labels[next[1]]} on{" "}
            <span className="figures text-[11px]">
              {formatDate(next[0]).replace(/^\w+, /, "").toUpperCase()}
            </span>
          </div>
        )}
        <div className="figures mt-2 text-[10px] text-paper-ghost">
          {selection.lat.toFixed(2)}°N {selection.lng.toFixed(2)}°E
        </div>
      </div>

      {selection.place && (
        <div className="mt-4 border-t border-rule pt-3.5">
          <div className="ruled">
            <span className="tab whitespace-nowrap">In the American press</span>
          </div>
          <div className="mt-1.5 font-serif text-[11.5px] italic leading-snug text-paper-ghost">
            Papers printed within three days mentioning {selection.place.name}
          </div>

          {loading && (
            <div className="mt-2 font-serif text-[12.5px] italic text-paper-ghost">
              Reading the archive…
            </div>
          )}
          {!loading && clippings?.length === 0 && (
            <div className="mt-2 font-serif text-[12.5px] leading-[1.55] text-paper-ghost">
              No mention of {selection.place.name} on the front pages we hold for
              these days. Only page one is indexed, so an inside-page report
              would not show here.
            </div>
          )}

          <ul className="mt-2.5 space-y-2">
            {clippings?.slice(0, 6).map((c) => (
              <li key={c.url + c.date} className="leading-tight">
                <a
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-serif text-[13px] text-paper-dim underline decoration-rule-strong underline-offset-[3px] transition hover:text-paper hover:decoration-mark"
                >
                  {c.paper}
                </a>
                <div className="figures mt-0.5 text-[9.5px] text-paper-ghost">
                  {c.place ? `${c.place.toUpperCase()} · ` : ""}{c.date}
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-4 border-t border-rule pt-3.5">
            <div className="ruled">
              <span className="tab whitespace-nowrap">In Europe&rsquo;s own libraries</span>
            </div>
            <div className="mt-1.5 font-serif text-[11.5px] italic leading-snug text-paper-ghost">
              Held by national and regional collections, catalogued to the year
              rather than the day
              {european && european.total > 0 && (
                <span className="not-italic"> · <span className="figures text-[10px]">{european.total.toLocaleString()}</span> items from {year}</span>
              )}
            </div>

            {!european && (
              <div className="mt-2 font-serif text-[12.5px] italic text-paper-ghost">
                Searching Europeana…
              </div>
            )}
            {european?.failed && (
              <div className="mt-2 font-serif text-[12.5px] leading-[1.55] text-paper-ghost">
                Europeana did not answer. This says nothing about what survives.
              </div>
            )}
            {european && !european.failed && european.holdings.length === 0 && (
              <div className="mt-2 font-serif text-[12.5px] leading-[1.55] text-paper-ghost">
                Nothing catalogued for {selection.place.name} in {year}. European
                digitisation is very uneven — Warsaw and Paris are rich, the
                Soviet Union and northern Norway close to empty.
              </div>
            )}

            <ul className="mt-2.5 space-y-2">
              {european?.holdings.slice(0, 5).map((h) => (
                <li key={h.link} className="flex gap-2.5 leading-tight">
                  {h.thumb && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={h.thumb}
                      alt=""
                      loading="lazy"
                      className="h-[34px] w-[26px] shrink-0 border border-rule bg-ink-700 object-cover object-top"
                    />
                  )}
                  <div className="min-w-0">
                    <a
                      href={h.link}
                      target="_blank"
                      rel="noreferrer"
                      className="font-serif text-[12.5px] leading-snug text-paper-dim underline decoration-rule-strong underline-offset-[3px] transition hover:text-paper hover:decoration-mark"
                    >
                      {h.title}
                    </a>
                    <div className="figures mt-0.5 text-[9px] text-paper-ghost">
                      {[h.language, h.provider].filter(Boolean).join(" · ").toUpperCase()}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
