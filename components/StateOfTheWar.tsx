"use client";

import { useMemo, useState } from "react";
import {
  NATION_COLOR, NATION_LABEL, nationStateOn,
  type Nation, type NationState,
} from "@/lib/theater";

/**
 * Who is in the war today, by country.
 *
 * The hex grids show where the fighting is. This shows what the fighting has
 * done: which countries are occupied, which have joined the Axis without ever
 * being invaded, and which are still out of it. Once a country falls it stays
 * on this list — that is the whole point of it.
 */

const ORDER: NationState[] = ["occupied", "axis", "co-belligerent", "allied", "neutral"];

export default function StateOfTheWar({ nations, date }: { nations: Nation[]; date: string }) {
  const [open, setOpen] = useState(false);

  const groups = useMemo(() => {
    const g: Record<NationState, { name: string; note: string }[]> = {
      occupied: [], axis: [], "co-belligerent": [], allied: [], neutral: [],
    };
    for (const n of nations) {
      const { state, note } = nationStateOn(n, date);
      g[state].push({ name: n.name, note });
    }
    for (const k of ORDER) g[k].sort((a, b) => a.name.localeCompare(b.name));
    return g;
  }, [nations, date]);

  // Neutrals are the ones nothing has happened to, so they are only worth
  // counting, not listing.
  const listed = ORDER.filter((s) => s !== "neutral" && groups[s].length > 0);

  return (
    <div className="card pointer-events-auto w-[15.5rem] px-4 pt-3 pb-3.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-baseline justify-between gap-3 text-left"
      >
        <span className="tab whitespace-nowrap">The war so far</span>
        <span className="figures text-[9.5px] text-mark transition hover:text-mark-bright">
          {open ? "LESS" : "MORE"}
        </span>
      </button>

      <ul className="mt-2.5 space-y-1.5">
        {listed.map((state) => (
          <li key={state}>
            <div className="flex items-baseline gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 translate-y-[1px] border border-black/40"
                style={{ background: NATION_COLOR[state] }}
              />
              <span className="font-serif text-[13px] text-paper-dim">{NATION_LABEL[state]}</span>
              <span className="ml-auto h-px flex-1 translate-y-[-3px] bg-rule" />
              <span className="figures text-[11px] text-paper-faint">{groups[state].length}</span>
            </div>
            {open && groups[state].length > 0 && (
              <ul className="mt-1.5 mb-2 ml-4 space-y-1.5 border-l border-rule pl-3">
                {groups[state].map((n) => (
                  <li key={n.name} className="leading-tight">
                    <div className="font-serif text-[12px] text-paper-dim">{n.name}</div>
                    {n.note && (
                      <div className="font-serif text-[11px] italic leading-snug text-paper-ghost">
                        {n.note}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
        <li className="flex items-baseline gap-2">
          <span
            className="h-2.5 w-2.5 shrink-0 translate-y-[1px] border border-rule"
            style={{ background: NATION_COLOR.neutral }}
          />
          <span className="font-serif text-[13px] text-paper-dim">Neutral</span>
          <span className="ml-auto h-px flex-1 translate-y-[-3px] bg-rule" />
          <span className="figures text-[11px] text-paper-faint">{groups.neutral.length}</span>
        </li>
      </ul>
    </div>
  );
}
