// A6/A7 — a city's list, in the app (M3.3c; Alex, 6 Oct 2026).
//
// **The same query as W1, no copy** (Alex: "native, using the same shared 'what is
// public' query W1 uses"). It reads public_gatherings — the database's one definition of
// "on the public web" (H11) — for ONE city, the one picked from packages/shared's
// CITIES, and does W1's arithmetic from packages/shared/src/list.ts on what comes back:
// the week from today in the city, the tabs, the chips, the days. Nothing here decides
// what is public; it can only narrow.
//
// **This is the one place in the app that reads the public list** — every other screen
// reads gatherings under RLS, where the testers exception applies (S22). So a tester sees
// exactly what W1 shows here: never the test crowd or the walk gathering, which are seed
// (V18); those are reached by their links.
import {
  addDays,
  applyChips,
  chipsFor,
  cityOpens,
  CITIES,
  dayGroups,
  fromLocalInput,
  localDate,
  readerFloor,
  rowsInTab,
  SEARCH_DAYS,
  WINDOW_DAYS,
  type Chip,
  type DayGroup,
  type TabValue,
} from "@pind/shared";
import { supabase } from "./supabase";

export interface ListGathering {
  slug: string;
  name: string;
  starts_at: string;
  ends_at: string | null;
  entry: "free" | "door" | "ticketed";
  door_price_cents: number | null;
  entry_note: string | null;
  category: string | null;
  signup_required: boolean;
  blurb: string | null;
  source: string;
  venue_id: string;
  venue_name: string;
  city_name: string;
  city_timezone: string;
  pinned: number;
  open_to_meeting: number;
  crews_open: boolean;
}

export interface CityWeek {
  city: string;
  today: string;
  // Both tabs' rows this week, before any chip: what the chips and counts are drawn from.
  thisWeek: ListGathering[];
}

// The week from today in the city, read through the door for that city only.
export async function loadCityWeek(slug: string, now = new Date()): Promise<CityWeek> {
  const city = CITIES.find((c) => c.slug === slug);
  // A city that is not live is never asked for: the picker cannot open it, and neither
  // can a hand-typed /city/<slug> (cityOpens is the one rule for both).
  if (!city || !cityOpens(slug)) throw new Error(`${slug} is not live`);
  const today = localDate(now.toISOString(), city.timezone);
  const end = addDays(today, WINDOW_DAYS);
  const { data, error } = await supabase().rpc("public_gatherings", {
    p_from: readerFloor(now, city.timezone).toISOString(),
    p_to: new Date(fromLocalInput(`${end}T00:00`, city.timezone)!).toISOString(),
    p_city: city.slug,
    p_query: null,
  });
  if (error) throw error;
  return { city: city.slug, today, thisWeek: (data ?? []) as ListGathering[] };
}

// Search (M3.2b): the same door with a query — the database narrows by name and venue,
// so a search can never return what the list would not (P191–P192). Everything
// published ahead, not one week (Alex, 10 Oct 2026), grouped by day like the list.
export async function searchCity(slug: string, query: string, now = new Date()): Promise<{ count: number; days: DayGroup<ListGathering>[] }> {
  const city = CITIES.find((c) => c.slug === slug);
  if (!city || !cityOpens(slug)) throw new Error(`${slug} is not live`);
  const today = localDate(now.toISOString(), city.timezone);
  const { data, error } = await supabase().rpc("public_gatherings", {
    p_from: readerFloor(now, city.timezone).toISOString(),
    p_to: new Date(fromLocalInput(`${addDays(today, SEARCH_DAYS)}T00:00`, city.timezone)!).toISOString(),
    p_city: city.slug,
    p_query: query,
  });
  if (error) throw error;
  const found = (data ?? []) as ListGathering[];
  return { count: found.length, days: dayGroups(found, city.timezone, today) };
}

export interface CityView {
  offered: Chip[];
  days: DayGroup<ListGathering>[];
  otherTabCount: number;
}

// What a tab shows with some chips on: W1's arithmetic, unchanged.
export function viewOf(week: CityWeek, tab: TabValue, chips: string[]): CityView {
  const city = CITIES.find((c) => c.slug === week.city)!;
  const offered = chipsFor(week.thisWeek, tab);
  const on = chips.filter((c) => offered.some((o) => o.value === c));
  const shown = applyChips(rowsInTab(week.thisWeek, tab), on);
  const other: TabValue = tab === "events" ? "community" : "events";
  return {
    offered,
    days: dayGroups(shown, city.timezone, week.today),
    otherTabCount: rowsInTab(week.thisWeek, other).length,
  };
}
