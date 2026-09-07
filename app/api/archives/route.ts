import { NextRequest, NextResponse } from "next/server";

/**
 * European archive material about a place, from the year it was fought over.
 *
 * The front-page strip is American, because Chronicling America is the one
 * archive that is free, unauthenticated, and digitised down to the individual
 * page for 1939–41. It is also, obviously, a view of the war from four thousand
 * miles away. This is the other half: Europeana aggregates the national and
 * regional libraries of Europe, so a click on Warsaw can return what Warsaw's
 * own libraries hold — in Polish, in German, in Dutch, whatever survives.
 *
 * It is deliberately coarser. Europeana's holdings are reliably dated to the
 * YEAR and not the day, so this answers "what does Europe hold about this place
 * from this year", not "what was printed here that morning". Claiming otherwise
 * would be inventing precision the archive does not have.
 */

// Next requires this to be a literal, not an imported constant.
export const revalidate = 86_400; // a 1939 archive is not going to change

const ENDPOINT = "https://api.europeana.eu/record/v2/search.json";

// Europeana's open demo key. It is rate-limited and shared; a free personal key
// from europeana.eu/en/for-developers lifts that, and is read from the
// environment when one is present.
const KEY = process.env.EUROPEANA_KEY ?? "api2demo";

type Holding = {
  title: string;
  language: string | null;
  country: string | null;
  provider: string | null;
  thumb: string | null;
  link: string;
};

const first = (v: unknown): string | null =>
  Array.isArray(v) ? (typeof v[0] === "string" ? v[0] : null) : typeof v === "string" ? v : null;

/** "pl" reads as noise; the language is worth naming. */
const LANGUAGE: Record<string, string> = {
  pl: "Polish", de: "German", nl: "Dutch", fr: "French", en: "English",
  ru: "Russian", fi: "Finnish", no: "Norwegian", da: "Danish", sv: "Swedish",
  it: "Italian", el: "Greek", sr: "Serbian", hr: "Croatian", cs: "Czech",
  hu: "Hungarian", ro: "Romanian", uk: "Ukrainian", lt: "Lithuanian",
  lv: "Latvian", et: "Estonian", sl: "Slovenian", es: "Spanish", pt: "Portuguese",
};

export async function GET(req: NextRequest) {
  const place = req.nextUrl.searchParams.get("place");
  const alt = req.nextUrl.searchParams.get("alt");
  const year = req.nextUrl.searchParams.get("year");

  if (!place || !/^\d{4}$/.test(year ?? "")) {
    return NextResponse.json({ error: "place and year are required" }, { status: 400 });
  }

  // European libraries catalogue a town under its own name, which is often not
  // the one an English map prints: Warschau and Warszawa between them return
  // more than Warsaw alone. One OR'd query rather than several requests.
  const names = [...new Set([place, alt].filter(Boolean).map((n) => n!.trim()))];
  const query = names.length > 1 ? `(${names.join(" OR ")})` : names[0];

  const url = new URL(ENDPOINT);
  url.searchParams.set("wskey", KEY);
  url.searchParams.set("query", query);
  url.searchParams.set("rows", "24");
  url.searchParams.set("profile", "rich");
  url.searchParams.append("qf", "TYPE:TEXT");
  url.searchParams.append("qf", `YEAR:${year}`);

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "wwii-daybyday/0.1 (historical research prototype)" },
      next: { revalidate },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`europeana responded ${res.status}`);
    const json = await res.json();

    const seen = new Set<string>();
    const holdings: Holding[] = [];

    for (const item of json.items ?? []) {
      const title = first(item.title);
      const link = typeof item.guid === "string" ? item.guid.split("?")[0] : null;
      if (!title || !link || seen.has(title)) continue;
      seen.add(title);

      const lang = first(item.language);
      holdings.push({
        title: title.length > 110 ? `${title.slice(0, 108)}…` : title,
        language: lang ? (LANGUAGE[lang] ?? lang.toUpperCase()) : null,
        country: first(item.country),
        provider: first(item.dataProvider),
        thumb: first(item.edmPreview),
        link,
      });
      if (holdings.length >= 8) break;
    }

    return NextResponse.json({ place, year, total: json.totalResults ?? 0, holdings });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "lookup failed", holdings: [] },
      { status: 502 },
    );
  }
}
