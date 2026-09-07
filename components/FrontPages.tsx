"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDate } from "@/lib/theater";

/**
 * The day's front pages, as scans.
 *
 * The map says where the line was. This says what people were told it meant,
 * on the morning it happened, by writers who had no idea what came next — which
 * is the part a finished history can never give you back.
 */

export type FrontPage = {
  paper: string;
  place: string | null;
  date: string;
  thumb: string;
  full: string;
  link: string;
  snippet: string | null;
};

type BakedDay = { q: string; pages: FrontPage[] };
type Baked = { days: Record<string, BakedDay> };

const bakes = new Map<string, Promise<Baked | null>>();

/**
 * The merged index, kept in a plain variable once it has arrived.
 *
 * Every day of the war is already on disk, so after the first load there is
 * nothing to wait for — and going through a promise anyway would flash
 * "searching…" on every step of the timeline for data the browser already has.
 * Once this is set, the strip renders straight from it during render.
 */
let index: Record<string, BakedDay> | null = null;

/**
 * Each campaign bakes its own file; the calendar merges them. Fetched once per
 * source per session, then shared by every day that lands in it.
 */
function loadBaked(sources: string[]): Promise<Record<string, BakedDay>> {
  for (const id of sources) {
    if (!bakes.has(id)) {
      bakes.set(
        id,
        fetch(`/data/frontpages/${id}.json`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      );
    }
  }
  // Later sources overwrite earlier ones, so pass the coarse filler first and
  // the campaigns' own per-day bakes after it.
  return Promise.all(sources.map((id) => bakes.get(id)!)).then((loaded) => {
    index = Object.assign({}, ...loaded.map((b) => b?.days ?? {}));
    return index!;
  });
}

/**
 * Warm the browser cache for the scans a reader is about to reach.
 *
 * The thumbnails come from the Library of Congress IIIF service, and fetching
 * them only when a day is displayed means every step of the timeline waits on
 * the network. Asking for the next few days ahead of time means they are
 * already decoded by the time the reader gets there.
 */
const warmed = new Set<string>();
let warmTimer: ReturnType<typeof setTimeout> | undefined;

function prefetchAround(days: Record<string, BakedDay>, iso: string, span = 2) {
  // Only once the reader has settled on a day. Dragging the scrubber crosses
  // hundreds of dates, and warming every one of them fired thousands of
  // requests at the Library of Congress, which answered by refusing them.
  clearTimeout(warmTimer);
  warmTimer = setTimeout(() => {
    const day = Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
    for (let i = 0; i <= span; i++) {
      const at = new Date((day + i) * 86_400_000).toISOString().slice(0, 10);
      for (const p of days[at]?.pages ?? []) {
        if (warmed.has(p.thumb)) continue;
        warmed.add(p.thumb);
        const img = new Image();
        img.decoding = "async";
        img.src = p.thumb;
      }
    }
  }, 400);
}

/**
 * Begin loading the moment the app boots, rather than when the strip first
 * renders — by the time anyone touches the timeline the index is already here.
 */
export function warmFrontPages(sources: string[]) {
  if (typeof window === "undefined" || index) return;
  void loadBaked(sources);
}

/**
 * The best passage the day's own papers carry, for a day nobody wrote up.
 *
 * The map can already say how much ground moved. This says what people were
 * being told about it, in the words they were told it in — which is usually
 * more interesting than the acreage. Longest quoted passage wins: the crop
 * scorer has already thrown out the ones that are mastheads and scanner noise,
 * so among what survives, more text is more substance.
 */
export function pressLineFor(date: string): { paper: string; passage: string } | null {
  const pages = index?.[date]?.pages ?? [];
  let best: { paper: string; passage: string } | null = null;
  for (const p of pages) {
    if (!p.snippet) continue;
    if (!best || p.snippet.length > best.passage.length) {
      best = { paper: p.paper, passage: p.snippet };
    }
  }
  return best;
}

/** Almost every remaining gap in the archive is a Sunday, or Christmas Day. */
const isSunday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay() === 0;

export default function FrontPages({
  date, query, sources,
}: { date: string; query: string; sources: string[] }) {
  const key = `${date}|${query}`;
  const sourceKey = sources.join(",");
  // Seeded from the index if it is already here, so a day that is on disk
  // never renders a loading state at all.
  const [result, setResult] = useState<{ key: string; pages: FrontPage[] } | null>(
    () => (index ? { key: `${date}|${query}`, pages: index[date]?.pages ?? [] } : null),
  );
  // Tagged with the day it was opened from, so moving the timeline closes the
  // reader by derivation rather than by a state write inside an effect.
  const [opened, setOpened] = useState<{ date: string; page: FrontPage } | null>(null);
  const open = opened && opened.date === date ? opened.page : null;
  const setOpen = useCallback(
    (page: FrontPage | null) => setOpened(page ? { date, page } : null),
    [date],
  );

  useEffect(() => {
    let cancelled = false;
    // The whole span's front pages are baked by scripts/fetch-frontpages.mjs and
    // scripts/fill-frontpages.mjs, because the Library of Congress search takes
    // anywhere from 300ms to a hard timeout and rate-limits on top of that.
    // Nothing here ever touches the network for the day's own data.
    (async () => {
      const days = index ?? (await loadBaked(sources));
      if (cancelled) return;
      setResult({ key, pages: days[date]?.pages ?? [] });
      prefetchAround(days, date);
    })();
    return () => { cancelled = true; };
  }, [date, key, sourceKey, sources]);

  // Once the index is in memory the answer is synchronous; the state above only
  // catches the very first render of the session.
  const pages = index
    ? (index[date]?.pages ?? [])
    : result && result.key === key
      ? result.pages
      : null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpened(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <section className="card pointer-events-auto mt-2.5 w-[23rem] px-5 pt-3.5 pb-4">
        <header className="flex items-baseline justify-between gap-3">
          <h2 className="tab whitespace-nowrap">The morning papers</h2>
          <span className="figures text-[9.5px] text-paper-ghost">
            {pages === null
              ? "SEARCHING…"
              : `${pages.length} FRONT PAGE${pages.length === 1 ? "" : "S"}`}
          </span>
        </header>

        {pages === null && <Skeleton />}

        {pages !== null && pages.length === 0 && (
          <p className="mt-2.5 font-serif text-[12px] leading-[1.55] text-paper-ghost">
            {isSunday(date)
              ? "A Sunday. Most American dailies of 1939–41 did not print one, and the Sunday editions that exist are the least digitised — nearly every gap left in this archive falls on one."
              : "Nothing in the digitised American press for this date."}
          </p>
        )}

        {pages !== null && pages.length > 0 && (
          <ul className="mt-3 flex gap-2.5 overflow-x-auto pb-1">
            {pages.map((p) => (
              <li key={p.paper} className="shrink-0">
                <button
                  onClick={() => setOpen(p)}
                  title={`${p.paper}${p.place ? ` · ${p.place}` : ""}`}
                  className="group block w-[76px] text-left focus:outline-none"
                >
                  {/* Scans come straight from the Library of Congress IIIF
                      service; next/image would only proxy them for no gain. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.thumb}
                    alt={`Front page of ${p.paper}, ${p.date}`}
                    loading="lazy"
                    className="h-[104px] w-[76px] border border-rule bg-ink-700 object-cover object-top opacity-80 transition duration-200 group-hover:opacity-100 group-hover:border-rule-strong group-focus-visible:border-mark"
                  />
                  <span className="mt-1.5 block truncate font-serif text-[10px] leading-tight text-paper-ghost transition group-hover:text-paper-dim">
                    {p.paper}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {open && <Reader page={open} date={date} onClose={() => setOpen(null)} />}
    </>
  );
}

function Skeleton() {
  return (
    <div className="mt-3 flex gap-2.5">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-[104px] w-[76px] animate-pulse border border-rule bg-ink-700" />
      ))}
    </div>
  );
}

function Reader({ page, date, onClose }: { page: FrontPage; date: string; onClose: () => void }) {
  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-ink-900/92 p-6"
      onClick={onClose}
    >
      <div
        className="card flex max-h-full w-full max-w-5xl gap-7 overflow-hidden p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={page.full}
          alt={`Front page of ${page.paper}, ${page.date}`}
          className="max-h-[80vh] shrink-0 border border-rule bg-ink-700 object-contain"
        />
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-serif text-[30px] leading-[1.1] text-paper">{page.paper}</h3>
              {page.place && (
                <div className="mt-1 font-serif text-[13px] italic text-paper-faint">{page.place}</div>
              )}
              <div className="figures mt-2 text-[10.5px] tracking-[0.14em] text-paper-ghost">
                {formatDate(date).toUpperCase()}
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="px-2 py-1 text-paper-ghost transition hover:text-paper"
            >
              ✕
            </button>
          </div>

          {page.snippet && (
            <blockquote className="mt-5 border-l border-mark/60 pl-4 font-serif text-[16px] leading-[1.6] text-paper-dim">
              {page.snippet}
            </blockquote>
          )}
          <p className="mt-3 font-serif text-[11.5px] italic leading-[1.55] text-paper-ghost">
            Transcribed by optical character recognition from the scan, so the
            wording is approximate where the newsprint has faded.
          </p>

          <a
            href={page.link}
            target="_blank"
            rel="noreferrer"
            className="figures mt-5 inline-block text-[10.5px] tracking-[0.1em] text-mark underline decoration-mark/40 underline-offset-[5px] transition hover:text-mark-bright hover:decoration-mark"
          >
            Read the full page at the Library of Congress →
          </a>
        </div>
      </div>
    </div>
  );
}
