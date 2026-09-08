# WWII, day by day

An interactive map of the Second World War that advances one day at a time.
Territory is drawn as a hex grid that changes hands as the war moves; a panel in
the top left carries the day's summary and events; clicking anywhere reports who
held that ground, when it changed hands, and what the American press was printing
about the nearest named place that week.

Currently scaffolded from **1 September 1939 to 31 December 1941** — from the
invasion of Poland to the German high-water mark outside Moscow, three weeks
after Pearl Harbor.

```bash
npm run dev                            # http://localhost:3000
npm run build-timeline <theater>       # rebuild a campaign's hex timeline
npm run fetch-frontpages <theater>     # re-bake its newspaper front pages
npm run recrop-frontpages              # re-quote passages offline, no network
npm run fill-frontpages                # fill every remaining day, weekly windows
npm run build-place-index              # index which pages mention which places
npm run crawl [days]                   # walk the whole war looking for errors
npm run shots DIR                      # screenshot the war into DIR
npm run perf-check                     # assert playback does not rebuild the hex source
npm run check-fronts                   # assert the front picker zooms
npm run check-history                  # assert the model matches dates we know
```

## Campaigns

| Theater | Dates | Cells | Outcome on the map |
|---|---|---|---|
| `poland1939` | 1 Sep – 6 Oct 1939 | 1,722 | 50.8% German / 49.2% Soviet |
| `winterwar` | 30 Nov 1939 – 13 Mar 1940 | 1,855 | ~9% of Finland occupied |
| `norway1940` | 9 Apr – 10 Jun 1940 | 2,069 | Denmark in a day, Norway in two months |
| `france1940` | 10 May – 25 Jun 1940 | 2,633 | 62% occupied, the rest left to Vichy |
| `desert1940` | 13 Sep 1940 – 31 Dec 1941 | 1,552 | 1,500 km each way; ends where it began |
| `balkans1941` | 6 Apr – 1 Jun 1941 | 1,316 | Wholly occupied, Crete included |
| `barbarossa1941` | 22 Jun – 5 Dec 1941 | 9,328 | Stopped 30 km short of Moscow |

Adding a campaign means five files in `data/<id>/` — `theater.json`,
`border.json`, `keyframes.json`, `days.json`, `places.json` — plus a line in
`data/theaters.json` and one entry in `lib/campaigns.ts`. Nothing in the engine
is Poland-specific.

**Several campaigns run at once**, which is the point from spring 1940 onward:
Norway is still being fought when France is invaded, and the desert war runs
under everything else for fifteen months. `theatersFor()` returns all of them,
the map merges their hex grids (cells are keyed by H3 index, so no two
campaigns can claim the same ground), and the camera fits whatever is live.
The front picker in the corner zooms to one of them.

The interludes matter too. Between 7 October and 30 November 1939 nothing on
the map changes, because nothing on the ground did: that is the Phoney War, and
a map that invented movement there would be lying about the most characteristic
thing about those two months. The Blitz, Lend-Lease and Pearl Harbor are
interlude days for the same reason — they move no ground.

## How the front line moves

Front lines on any given day are not a matter of record — the sources give dated
positions every few days, not every day. So the pipeline stores what is actually
known and interpolates between it, and says so on screen.

`data/poland1939/keyframes.json` holds **eight dated control lines**. For every
hex between two keyframes, `scripts/build-timeline.mjs` measures the cell's
distance to the front at the earlier keyframe (`d0`) and to the front at the
later one (`d1`), and flips it at

```
f = d0 / (d0 + d1)
```

through the interval. A cell hard against the old line falls almost immediately;
one just short of the new line falls at the end. The useful consequence is that
spearheads run ahead of their flanks on their own, out of the geometry, with no
extra authoring — which is what an advance actually looks like.

Ground given back works the same way. When the Finns retake Suomussalmi the
winning side has no front there to measure against, so the retreating side's
line is used instead — a cell out at the old high-water mark is uncovered first,
one just short of the new line last. Without that, Tolvajarvi and the Raate Road
collapse into a single lurch on the keyframe date.

**Keyframes too far apart produce a filament.** If two dated lines are three
weeks and 200 km apart, the cells sitting closest to the earlier line all flip
on the first day of the interval, and they draw a one-cell-wide thread running
far out ahead of the advance. It is not a rendering bug — it is what
`d0 / (d0 + d1)` means when `d0` is near zero over a long stretch — but it reads
as one, and no army advances in a filament. The fix is a keyframe in the middle,
which is usually also a date worth having: the thread across the Dnieper bend
disappeared when 16 September 1941 was added for the Kiev pocket closing at
Lokhvitsa. If a front looks threadbare, the interval is too long.

Sieges are the exception, because they are exactly the places where the front
line lies about what is happening. `holdouts` in the same file pin Westerplatte,
Warsaw, Modlin, Hel, Kock and Lwów to their real surrender dates, overwriting the
interpolation.

The output is `public/data/poland1939.json`: 1,682 cells, each carrying its whole
future as `s0/t1..t4/s1..s4`. The date control therefore changes one paint
expression rather than re-uploading a source, which is what keeps playback smooth.

## Days nobody wrote up

There are 853 days in the span and nothing like 853 written entries, and an
empty panel makes the map look broken on the very days it is quietly working.
So the build script also derives a per-date summary straight from the timeline —
how much ground moved, which way, and the nearest named places to it — and the
panel falls back to that:

> **The line moves.** Yugoslavia and Greece: Axis forces took about 6,800 km²
> around Ioannina, Volos, Larissa.

Derived, not authored, and true. On days when nothing moved anywhere it says so,
and the newspapers below are what people had instead.

## Checking it against the record

Interpolation is allowed to be a few days out. It is not allowed to say Moscow
fell. `scripts/check-history.mjs` asks the only question that matters of a map
like this — *on this date, who held this place?* — for 66 holdings across all
seven campaigns, and refuses to pass if any cell has more handovers than the
paint expression can carry.

Asking it that way matters. An earlier version asked *when did this cell first
change hands*, which is not the same question: a cell can begin a theater in
enemy hands, so for Tobruk — Italian on day one, taken in January 1941 — the
old check returned the theater's start date and asserted the bug was correct.

It has earned its keep repeatedly. It has caught Moscow falling on 23 November
1941; Kiev falling seven weeks early; Hel, Petsamo and Sidi Barrani sitting
outside their own theaters' grids; Vilnius changing hands five times when it
changed once; Rotterdam returning to Allied control three weeks after the Dutch
surrender; Dunkirk holding out eleven days past its capture; and a 21-cell
Allied pocket surviving on the Norwegian coast until the end of 1941.

## What is approximate, and where it says so

- Control polygons are reconstructions authored for this scaffold, not surveyed
  positions. Refine them against Stanford's *Building the New Order, 1938–1945*.
- The coarseness varies enormously by campaign. Poland gets eight dated lines
  over 36 days; Barbarossa gets nine over a 1,600 km front and 166 days. Each
  theater's `note` says what its own reconstruction is worth.
- Barbarossa's theater is cut off at 45°E. It shows the ground that changed
  hands, not the Soviet Union.
- The border is an approximation of the 1921 Riga line. The resulting partition
  comes out 51.7% German / 48.3% Soviet against a real ~48/52.
- Ground truth is `historical-basemaps` **1938** — the repository has no 1939 or
  1940 file. The attribution control names the year.
- The timeline caption states outright that only the keyframes are dated and
  everything between them is interpolated.

No basemap tile provider is used anywhere: modern tiles would draw modern
borders, which is the one thing this map exists to contradict. `npm run
build-basemap` fetches the 1938 world, dissolves it to one feature per country
(the source splits them across 254 polygons, and a symbol layer over polygons
repeats a label once per tile — which wrote USSR across the map three times),
and emits a label anchor at each country's largest landmass.

## Conquest persists

Ground that has been taken stays taken. Poland is still occupied in 1941, and a
map that drew it only during September 1939 would be lying about the whole war.
So `theatersUpTo()` draws every campaign that has *begun* by the current date,
while `theatersFor()` returns only the ones still being fought — the first set
is what gets painted, the second is what the camera follows and what the front
picker lists. Nothing extra is needed to make a finished campaign hold its final
state: the baked timeline already answers for any date past a cell's last
transition.

Campaigns can overlap on the ground — eastern Poland is fought over in 1939 and
again in 1941 — so the merge dedupes on H3 index and lets the campaign that
started latest win. Without that the two grids disagree and leave a seam.

## Control polygons accumulate

A keyframe is a line drawn by hand for one date, and hand-drawn lines do not
perfectly re-enclose every square kilometre already taken. Comparing consecutive
keyframes as independent regions therefore reads every omission as a
*recapture*: Vilnius changed hands five times when it changed once, and
Amsterdam went back to Allied control three weeks after the Netherlands
surrendered.

So each keyframe's control region is unioned with the one before it. A theater
whose ground genuinely changes hands both ways sets `"cumulative": false` — the
Western Desert, where Compass, Rommel and Crusader really do hand the same
1,500 km back and forth twice, and the Winter War, where Tolvajarvi and the
Raate Road are Finnish counterattacks that take ground back.

This also removed the reason the paint expression was overflowing. Each cell
carries a fixed number of handovers, and anything past it would be silently
dropped and render its stale side for the rest of the war — 840 Barbarossa
cells were doing exactly that, leaving 213,000 km² painted Soviet blue behind
the German lines. Accumulation cut the worst chain from six handovers to three,
and the build now refuses to emit at all if any cell exceeds the limit.

## Holdouts have a shape

A besieged pocket is: from `from` (default the theater's first day) until
`until` (`"never"` if it outlives the theater), this ground is held by `side`
(default the defender). All three earn their place. Tobruk begins inside Italian
Libya, is taken in January 1941 and only *then* holds, so it needs `from`;
asserting "defender from day one" handed it to the Commonwealth four months
early. Leningrad never falls, so it needs `"never"` rather than a date that
happens to equal the theater's end. Kock surrenders on the theater's own last
day, which is a surrender and not an outlasting.

When a pocket does fall it falls on the day it surrendered, to whoever is around
it — not whenever the interpolated front line happens to arrive, which held
Dunkirk eleven days past its capture.

## The whole world takes a side

The hex grids show where the fighting is; `data/nations.json` shows what the
fighting has done. Every country carries a dated allegiance — Axis, occupied,
Allied, neutral — and the basemap is painted from it through a `match`
expression on country name, repainted in a single call as the date changes.

This is the only way the map can say that Hungary joined the Axis without ever
being invaded, that Norway stayed occupied for five years after its campaign
ended, or that Sweden sat out the entire war.

`co-belligerent` is a state of its own because neither of the alternatives is
true. The Soviet Union never joined the Tripartite Pact — the November 1940
talks failed — but it invaded Poland alongside Germany and supplied it until the
morning it was invaded itself; painting that "Axis" makes a claim the sources do
not support, and painting it "neutral" hides the partition of Poland. Finland is
the mirror image: invaded by the USSR in 1939 without ever being an Allied
power, then fighting the USSR again in 1941 without ever being an Axis one.

The basemap is cleaned at build time for the same reason. The source file
carries present-day names — Israel, Jordan, Botswana, Malaysia — and a 1941 map
that prints them is drawing the wrong century.

## The camera widens as the war does

`data/camera.json` schedules the viewport against the calendar — tight on Poland
in September 1939, opening for Norway, France, North Africa and Barbarossa, and
pulling back to the whole globe at Pearl Harbor. Only the first cue has a theater
behind it so far; the rest are scaffolding for the theaters to come.

## The front line

Drawn from the ground rather than authored. The hex grid says who holds what,
so the front is simply the seam between two different holders — every edge
shared by two hexes in different hands, on this date. Deriving it means it
cannot disagree with the fill it is drawn over, and it closes around pockets
(Warsaw, Tobruk, the Kiev encirclement) without being told they exist.

Which hexes touch which never changes; only who holds them does. So the
adjacency graph and each pair's shared edge are built once per campaign and
reused for every date after — deriving them afresh each day cost 150ms on
Barbarossa's 9,328 cells, most of a frame at playback speed.

Only campaigns still being fought get one. A finished campaign has no front; its
seam is a border now.

## Newspapers

Three archives, and none of them is queried while you wait.

**The day's front pages** are the ones you see without asking: page one of the
American papers that printed that date, as scans, from the Library of Congress
Chronicling America collection. 834 of 853 days have them. Nearly every
remaining gap is a **Sunday** — most American dailies of 1939–41 did not print
one, and the Sunday editions that exist are the least digitised — so the panel
says that rather than implying the archive failed.

**Clicking a place** answers from disk. `scripts/build-place-index.mjs` scans
the OCR of every page already held for all 352 places in the gazetteers and
writes out the mentions, so the lookup needs no network at all. That matters:
the loc.gov search was the flakiest thing in this project, rate-limiting to a
hard stop and answering with an HTML challenge page. It also has to match whole
words — a substring search finds "Uman" inside *human*, *woman* and *Truman*,
which put a Ukrainian town in more American front pages than Warsaw.

**Europe's own libraries** are the other half, through Europeana
(`app/api/archives/route.ts`) — the only live call left, cached for a day.
Chronicling America is free and complete but it is a view of the war from four
thousand miles away; this returns what the national and regional collections of
Europe hold, in Polish, German, Dutch, whatever survives. It queries the local
name alongside the English one, because Warschau and Warszawa between them
return far more than Warsaw does.

It is deliberately coarser, and labelled as such: Europeana dates reliably to
the year, not the day. **Its coverage is also very uneven** — Warsaw returns
4,594 items and Paris 496, while Kiev and Narvik return zero in any spelling.
Soviet and Norwegian material is barely digitised. The panel says so rather than
implying nothing survived.

Three things worth knowing before touching this:

- The legacy `chroniclingamerica.loc.gov` endpoint is dead. The working query is
  `loc.gov/collections/chronicling-america/?q=…&fa=partof:chronicling america&start_date=…&end_date=…&searchType=advanced&fo=json`.
- **Use single-word search terms.** Multi-word queries are ANDed and return
  almost nothing; `Russia` finds the Soviet invasion, `Russia invades Poland`
  finds nothing at all.
- **The search is too slow to query live** — the same request takes anywhere
  from 300ms to a hard timeout, and `c=100` returns 2MB and kills the socket.
  So `scripts/fetch-frontpages.mjs` bakes the whole campaign into
  `public/data/frontpages/<theater>.json` with retries and backoff, and the UI
  reads that.
- **It rate-limits hard**, and returns an HTML challenge page rather than JSON
  when it does, so a 429 has to be caught on the status rather than at the
  parse. A per-day sweep of 850 days is enough traffic to trip it. That is why
  `scripts/fill-frontpages.mjs` asks in **weekly windows** — a seventh of the
  requests — and buckets the dated results back out across the week. It saves
  after every window, because an hour-long sweep that is interrupted must not
  throw away what it already has.

Scans are served over IIIF, so any size can be constructed directly from the
service identifier rather than picking from whatever derivatives the search
happened to list: `…/full/400,/0/default.jpg` for the strip, `!1400,2000` for
the reader.

Choosing which passage to quote is a heuristic — 1939 newsprint OCRs badly, and
the first hit for a term is usually the masthead, which gives you the price of
the paper and nothing about the war. So every occurrence is scored on how much
of its surroundings are real words, with a penalty for sitting in the top of the
page, and the best one wins; below a threshold nothing is quoted at all, which
is why roughly a quarter of pages carry a passage rather than all of them. The
scan is the artefact, the quote is a bonus.

Tuning that heuristic must not cost another twenty-five minutes of fetching, so
the bake also writes each page's OCR to `data/frontpages-raw/` (not served — it
is megabytes and nothing at runtime reads it), and `npm run recrop-frontpages`
re-derives every passage from disk with no network at all.

## The MapLibre worker

MapLibre v6 resolves its worker from `import.meta.url`. Turbopack rewrites that
to a chunk path where the worker file does not exist, so the worker never boots,
no source ever finishes parsing, and the map renders black **with no error
raised**. `scripts/copy-maplibre-worker.mjs` stages the worker into
`public/maplibre/` (it runs ahead of `dev` and `build`) and `WarMap.tsx` points
MapLibre at it with `setWorkerUrl`. Don't remove either half.

## Running it

```bash
npm install
npm run dev
```

Nothing needs configuring. The newspaper data is committed and the map runs in
the browser. The one optional setting is `EUROPEANA_KEY`, which lifts the rate
limit on the European archive sidebar; without it the app falls back to
Europeana's shared demo key. Copy `.env.example` to `.env.local` if you want to
set one.

## Deploying

It is a stock Next.js app, so a host that runs Node needs no configuration from
you. On Vercel: import the repository, accept the detected framework, and add
`EUROPEANA_KEY` under Settings → Environment Variables if you have one.

It cannot be hosted on GitHub Pages. `/api/archives` queries Europeana at
request time, and a static export has nowhere to run it.
