/**
 * Every campaign's authored data, in one place.
 *
 * The timelines themselves are fetched at runtime from /public/data, because
 * they are large and change whenever the build script runs. The hand-authored
 * parts — the border, the day text, the gazetteer — are imported statically so
 * the bundler can see them.
 *
 * Adding a war means: four files under data/<id>/, a line in data/theaters.json,
 * and one entry here.
 */

import type { Day, Place } from "@/lib/theater";

import polandBorder from "@/data/poland1939/border.json";
import polandDays from "@/data/poland1939/days.json";
import polandPlaces from "@/data/poland1939/places.json";

import winterBorder from "@/data/winterwar/border.json";
import winterDays from "@/data/winterwar/days.json";
import winterPlaces from "@/data/winterwar/places.json";

import norwayBorder from "@/data/norway1940/border.json";
import norwayDays from "@/data/norway1940/days.json";
import norwayPlaces from "@/data/norway1940/places.json";

import franceBorder from "@/data/france1940/border.json";
import franceDays from "@/data/france1940/days.json";
import francePlaces from "@/data/france1940/places.json";

import desertBorder from "@/data/desert1940/border.json";
import desertDays from "@/data/desert1940/days.json";
import desertPlaces from "@/data/desert1940/places.json";

import balkansBorder from "@/data/balkans1941/border.json";
import balkansDays from "@/data/balkans1941/days.json";
import balkansPlaces from "@/data/balkans1941/places.json";

import barbarossaBorder from "@/data/barbarossa1941/border.json";
import barbarossaDays from "@/data/barbarossa1941/days.json";
import barbarossaPlaces from "@/data/barbarossa1941/places.json";

import interludeDays from "@/data/interlude/days.json";

export type Campaign = {
  border: GeoJSON.Feature;
  days: Record<string, Day>;
  places: Place[];
};

export const CAMPAIGNS: Record<string, Campaign> = {
  poland1939: { border: polandBorder as GeoJSON.Feature, days: polandDays as Record<string, Day>, places: polandPlaces as Place[] },
  winterwar: { border: winterBorder as GeoJSON.Feature, days: winterDays as Record<string, Day>, places: winterPlaces as Place[] },
  norway1940: { border: norwayBorder as GeoJSON.Feature, days: norwayDays as Record<string, Day>, places: norwayPlaces as Place[] },
  france1940: { border: franceBorder as GeoJSON.Feature, days: franceDays as Record<string, Day>, places: francePlaces as Place[] },
  desert1940: { border: desertBorder as GeoJSON.Feature, days: desertDays as Record<string, Day>, places: desertPlaces as Place[] },
  balkans1941: { border: balkansBorder as GeoJSON.Feature, days: balkansDays as Record<string, Day>, places: balkansPlaces as Place[] },
  barbarossa1941: { border: barbarossaBorder as GeoJSON.Feature, days: barbarossaDays as Record<string, Day>, places: barbarossaPlaces as Place[] },
};

/**
 * The calendar is continuous even when the fighting is not. Campaign days are
 * merged with the interludes — the Phoney War, the Blitz, Pearl Harbor — which
 * belong to no theater and move no front.
 *
 * Each entry is tagged with where it came from, so the panel can name the
 * campaign an entry belongs to rather than whichever front happens to be
 * running that day. On 15 September 1940 the only live front is the Western
 * Desert and the day's entry is about the Battle of Britain; labelling that
 * "The Western Desert" would be wrong.
 */
export const DAYS: Record<string, Day[]> = (() => {
  const all: Record<string, Day[]> = {};
  const push = (date: string, day: Day) => {
    (all[date] ??= []).push(day);
  };

  for (const [date, day] of Object.entries(interludeDays as Record<string, Day>)) {
    push(date, { ...day, from: null });
  }
  // Two campaigns can write the same date once they overlap: 28 May 1940 is
  // both "Narvik is taken" and "Belgium surrenders", and 10 June is both
  // "Norway capitulates" and "Italy declares war". A flat merge dropped one of
  // each — including the first Allied ground victory of the war — so days are
  // kept as a list and the panel shows all of them.
  for (const [id, c] of Object.entries(CAMPAIGNS)) {
    for (const [date, day] of Object.entries(c.days)) push(date, { ...day, from: id });
  }
  return all;
})();

export const BORDERS: Record<string, GeoJSON.Feature> = Object.fromEntries(
  Object.entries(CAMPAIGNS).map(([id, c]) => [id, c.border]),
);

export const PLACES: Record<string, Place[]> = Object.fromEntries(
  Object.entries(CAMPAIGNS).map(([id, c]) => [id, c.places]),
);
