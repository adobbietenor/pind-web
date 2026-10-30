// The City of Toronto's Festivals & Events feed (M4.4, Alex, 29 Oct 2026). The pure
// half: reading the file, the rules, and the plan. Nothing here does I/O, so the unit
// tests load it directly; the fetching and applying is in ./cityrun.ts.
//
// **What the feed is.** One JSON file, refreshed in real time, under the Open
// Government Licence – Toronto (attribution required wherever its listings appear —
// CITY_ATTRIBUTION in packages/shared). It is one row per event per day: an event on
// five days is five rows, each carrying the whole event again, which is why the file
// is 235 MB for about 28,000 rows. A Worker cannot hold that, so it is read as a
// stream and only the rows inside the import window are ever parsed (ObjectSplitter).
//
// **The rules, each Alex's call on the diagnosis's recommendations:**
//   - categories that are Events-tab territory (Theatre, Live Performances, Music,
//     Comedy, Dance, Film, Nightlife) or not a place (Virtual/Online, Camp) are left
//     out — but only when *every* category a listing has is one of them, so a food
//     festival that also has music stays;
//   - one gathering per day for anything that runs four days or fewer; longer runs are
//     skipped, except a weekly repeat on one day of the week (a Saturday market), which
//     takes each listed day; a weekly repeat ticked for several weekdays is an exhibition
//     and skipped as `weekly_several_days` (Alex, 30 Oct 2026);
//   - five chips map cleanly (markets, running, games, outdoors ×2); everything else
//     has no chip and is still listed;
//   - the organiser is the listing's own "presented by", or failing that its contact
//     address, or nobody.
//
// And two that follow from the data rather than from a choice, both the shape the
// Ticketmaster import already has: a listing with no time (the feed writes midnight)
// is skipped as `no_time`, and one with no single mappable place is skipped as
// `no_place`, because a gathering needs one venue with coordinates.

import { distanceKm, nameKey, venueKey } from "./ticketmaster.ts";

export const CITY_FEED_URL =
  "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/9201059e-43ed-4369-885e-0b867652feac/resource/8900fdb2-7f6c-4f50-8581-b463311ff05d/download/file.json";

// ---------------------------------------------------------------------------
// Reading a 235 MB file without holding it
// ---------------------------------------------------------------------------

// Hands back each object of the top-level array — `{"value":[ {...}, {...} ]}` — as
// its own string, from text arriving in arbitrary chunks. A plain state machine over
// braces, brackets and strings; nothing is parsed here. The caller decides which
// objects are worth a JSON.parse (most are not: they are outside the window).
export class ObjectSplitter {
  private depth = 0;
  private inString = false;
  private escaped = false;
  private carry = ""; // the start of an object that spans chunks
  private capturing = false;

  // `level` is the depth an element's own opening brace takes the counter to:
  // 1 for the root object, 2 for its array, 3 for an element.
  private readonly level: number;
  constructor(level = 3) {
    this.level = level;
  }

  push(chunk: string): string[] {
    const out: string[] = [];
    let start = this.capturing ? 0 : -1;
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk.charCodeAt(i);
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (c === 92 /* \ */) this.escaped = true;
        else if (c === 34 /* " */) this.inString = false;
        continue;
      }
      if (c === 34) {
        this.inString = true;
      } else if (c === 123 /* { */ || c === 91 /* [ */) {
        this.depth++;
        if (c === 123 && this.depth === this.level && !this.capturing) {
          this.capturing = true;
          start = i;
        }
      } else if (c === 125 /* } */ || c === 93 /* ] */) {
        if (c === 125 && this.depth === this.level && this.capturing) {
          out.push(this.carry + chunk.slice(start, i + 1));
          this.carry = "";
          this.capturing = false;
          start = -1;
        }
        this.depth--;
      }
    }
    if (this.capturing) this.carry += chunk.slice(start);
    return out;
  }
}

// The one field read before deciding to parse: the day this row is for. A cheap
// regex over the object's text, so the 26,000 rows outside the window are never
// parsed at all.
export function calendarDateOf(objectText: string): string | null {
  const m = /"calendar_date"\s*:\s*"([^"]+)"/.exec(objectText);
  return m ? m[1]! : null;
}

// ---------------------------------------------------------------------------
// One row of the feed, reduced to what we use
// ---------------------------------------------------------------------------

export interface CityPlace {
  name: string;
  address: string | null;
  lat: number;
  lng: number;
}

export interface CityRow {
  eventKey: string; // the feed's submission_id: one per event, shared by its days
  startsAt: string; // UTC ISO
  localDate: string; // YYYY-MM-DD in Toronto, from the feed's own date group
  localTime: string; // HH:MM, as the feed wrote it
  name: string;
  categories: string[];
  frequency: string; // "Single Date" | "Multiple" | "Weekly" | "Daily"
  weekdays: number; // how many weekdays a weekly repeat is ticked for; 0 when unreadable
  firstDate: string; // the event's whole run, YYYY-MM-DD
  lastDate: string;
  place: CityPlace | null; // null unless exactly one address with coordinates
  organiser: string | null;
  url: string | null;
  free: boolean;
}

interface RawLocation {
  location_name?: string | null;
  location_address?: string | null;
  location_type?: string | null;
  location_gps?: string | null;
  location_dates?: string | null;
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function placeOf(locations: RawLocation[]): CityPlace | null {
  if (locations.length !== 1) return null;
  const l = locations[0]!;
  if (l.location_type !== "Address") return null;
  const name = text(l.location_name);
  if (!name) return null;
  let gps: { gps_lat?: number; gps_lng?: number }[] = [];
  try {
    gps = JSON.parse(l.location_gps ?? "[]");
  } catch {
    return null;
  }
  const lat = Number(gps[0]?.gps_lat);
  const lng = Number(gps[0]?.gps_lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { name, address: text(l.location_address), lat, lng };
}

// How often, and for a weekly repeat, on how many days of the week: the listing ticks
// them in repeat_weekdays. Nothing readable is 0 days, which the one-weekday rule
// refuses rather than guesses.
function scheduleOf(locations: RawLocation[]): { frequency: string; weekdays: number } {
  for (const l of locations) {
    try {
      const d = JSON.parse(l.location_dates ?? "[]") as { event_frequency?: string; repeat_weekdays?: { checked?: boolean }[] }[];
      const entry = d.find((x) => x.event_frequency);
      if (entry) {
        const days = Array.isArray(entry.repeat_weekdays) ? entry.repeat_weekdays.filter((w) => w?.checked === true).length : 0;
        return { frequency: entry.event_frequency!, weekdays: days };
      }
    } catch {
      // unreadable dates say nothing about how often; fall through
    }
  }
  return { frequency: "Single Date", weekdays: 0 };
}

// "presented by" where the listing names one; otherwise the address people write to,
// which is specific to the group (assembly@toronto.ca is Assembly Hall, not "the
// City"). A whole email domain would have lumped every City-run programme into one
// organiser and capped them all together at two a week.
export function organiserOf(raw: Record<string, unknown>): string | null {
  const partners = Array.isArray(raw.partnerships) ? (raw.partnerships as { text?: string; value?: string }[]) : [];
  const presented = partners.find((p) => p.value === "event_presented_by");
  const byName = text(presented?.text);
  if (byName) return byName;
  const email = text(raw.event_email);
  return email ? email.toLowerCase() : null;
}

// The title a listing shows (Alex, 30 Oct 2026). Some programmes list each session
// under nothing but its place and its time — "Falstaff Park - 11 a.m. to 1 p.m." —
// with the programme's own name, "Play Mobile", only in the City's calendar_name. Those
// take the programme's name: the card shows the park anyway.
//
// Narrow on purpose, because calendar_name is usually a department's calendar
// ("Tourism" for 216 events on 30 Oct): only when everything after " - " is a time,
// and the part before it is the listing's own place (the same first word, so "Heron
// Park" at "Heron Park Community Centre" counts and "Jazz Night" at The Rex does not).
const TIME_ONLY =
  /^(?=.*[ap]\s*\.?\s*m)\d{1,2}(:\d{2})?(\s*[ap]\s*\.?\s*m\s*\.?)?\s*(\.?\s*to\s*\d{1,2}(:\d{2})?\s*[ap]\s*\.?\s*m\s*\.?)?\s*$/i;

const firstWord = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim().split(/\s+/)[0] ?? "";

export function titleOf(raw: Record<string, unknown>): string | null {
  const name = text(raw.event_name);
  if (!name) return null;
  const dash = name.lastIndexOf(" - ");
  const programme = text(raw.calendar_name);
  const place = text(((Array.isArray(raw.event_locations) ? raw.event_locations : [])[0] as RawLocation | undefined)?.location_name);
  if (dash < 0 || !programme || !place) return name;
  const head = name.slice(0, dash).trim();
  const tail = name.slice(dash + 3).trim();
  if (!TIME_ONLY.test(tail) || !firstWord(head) || firstWord(head) !== firstWord(place)) return name;
  return programme;
}

export function toCityRow(raw: Record<string, unknown>): CityRow | null {
  const eventKey = text(raw.submission_id);
  const when = text(raw.calendar_date);
  const name = titleOf(raw);
  if (!eventKey || !when || !name) return null;
  const t = Date.parse(when);
  if (Number.isNaN(t)) return null;
  const locations = (Array.isArray(raw.event_locations) ? raw.event_locations : []) as RawLocation[];
  const categories = (Array.isArray(raw.event_category) ? raw.event_category : [])
    .map((c) => text(typeof c === "string" ? c : (c as { name?: string })?.name))
    .filter((c): c is string => c !== null);
  const schedule = scheduleOf(locations);
  return {
    eventKey,
    startsAt: new Date(t).toISOString(),
    localDate: text(raw.calendar_date_group) ?? when.slice(0, 10),
    localTime: when.slice(11, 16),
    name,
    categories,
    frequency: schedule.frequency,
    weekdays: schedule.weekdays,
    firstDate: (text(raw.event_startdate) ?? when).slice(0, 10),
    lastDate: (text(raw.event_enddate) ?? when).slice(0, 10),
    place: placeOf(locations),
    organiser: organiserOf(raw),
    url: text(raw.event_website) ?? text(raw.ticket_website),
    free: raw.free_event === "Yes",
  };
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

// Events-tab territory, or not somewhere a crowd can meet.
export const EXCLUDED_CATEGORIES = new Set([
  "Theatre",
  "Live Performances",
  "Music",
  "Comedy",
  "Dance",
  "Film",
  "Nightlife",
  "Virtual/Online Event",
  "Camp",
]);

// The chips that map cleanly. First match wins, in this order; everything else has no
// chip and is still listed (unfiltered is the default).
const CHIPS: [string, string][] = [
  ["Farmers' Market", "markets"],
  ["Run/Walk", "running"],
  ["Trivia", "games"],
  ["Environmental", "outdoors"],
  ["Tour", "outdoors"],
];

export function chipFor(categories: string[]): string | null {
  for (const [cat, chip] of CHIPS) if (categories.includes(cat)) return chip;
  return null;
}

// A festival weekend is one gathering a day; a month-long exhibition is not thirty.
export const MAX_RUN_DAYS = 4;

export function runDays(firstDate: string, lastDate: string): number {
  return Math.round((Date.parse(`${lastDate}T00:00:00Z`) - Date.parse(`${firstDate}T00:00:00Z`)) / 86_400_000) + 1;
}

export type CitySkip = "excluded_category" | "long_run" | "weekly_several_days" | "no_time" | "no_place" | "duplicate";

export function citySkipReason(r: CityRow): CitySkip | null {
  if (r.categories.length > 0 && r.categories.every((c) => EXCLUDED_CATEGORIES.has(c))) return "excluded_category";
  // Past four days, only a weekly repeat on one day of the week is a series (a Saturday
  // market). An exhibition the feed calls weekly because it opens most days is a long
  // run by another name (Alex, 30 Oct 2026).
  if (runDays(r.firstDate, r.lastDate) > MAX_RUN_DAYS) {
    if (r.frequency !== "Weekly") return "long_run";
    if (r.weekdays !== 1) return "weekly_several_days";
  }
  if (r.localTime === "00:00") return "no_time";
  if (!r.place) return "no_place";
  return null;
}

// One gathering per listed day: the feed's own key for the event, and the moment.
export function cityExternalId(r: CityRow): string {
  return `${r.eventKey}|${r.startsAt}`;
}

// The event a listing-day belongs to, back from its external id: every date of one
// event shares a score (shareScores).
export function cityEventKey(externalId: string): string {
  const bar = externalId.lastIndexOf("|");
  return bar < 0 ? externalId : externalId.slice(0, bar);
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export interface KnownVenue {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
}

// Something already on our list that a City row could be a second copy of: any
// source, not dismissed. Hand-entered markets and run clubs are also in the City feed.
export interface ExistingGathering {
  venueId: string | null;
  startsAt: string;
  name: string;
  localDate: string;
}

export interface CityPlanInput {
  rows: CityRow[]; // already inside the window
  venues: KnownVenue[];
  aliases: { venueId: string; alias: string }[];
  cityKeys: { key: string; venueId: string }[]; // venue_external_ids, source 'city'
  knownIds: string[]; // gathering_sources external ids for 'city'
  existing: ExistingGathering[];
  complete: boolean;
}

export interface CityDraft {
  externalId: string;
  name: string;
  startsAt: string;
  endsAt: null;
  venueId: string | null;
  venueKey: string | null;
  eventUrl: string | null;
  category: string | null;
  entry: "free" | "ticketed";
  organiser: string | null;
  snapshot: Record<string, unknown>;
}

export interface CityPlan {
  complete: boolean;
  newVenues: { key: string; name: string; address: string | null; lat: number; lng: number }[];
  venueKeys: { key: string; venueId: string }[];
  newDrafts: CityDraft[];
  seen: { externalId: string; snapshot: Record<string, unknown> }[];
  seenIds: string[];
  skipped: Partial<Record<CitySkip, number>>;
}

// A name match is trusted only when the two places are near each other: two rooms in
// a city can share a name ("Main Hall"), and a venue with no coordinates of its own
// is the one case where the name is all there is.
export const SAME_PLACE_KM = 1;
// A City row starting this close to an existing gathering at the same venue is the
// same thing listed twice.
export const SAME_TIME_MS = 90 * 60 * 1000;

export function placeKey(p: CityPlace): string {
  return `${venueKey(p.name)}|${nameKey(p.address ?? "")}`;
}

function snapshotOf(r: CityRow): Record<string, unknown> {
  return {
    name: r.name,
    startsAt: r.startsAt,
    url: r.url,
    // What the scoring prompt reads as the kind of thing this is.
    category: r.categories.join(", ") || null,
    frequency: r.frequency,
    free: r.free,
    organiser: r.organiser,
    place: r.place?.name ?? null,
  };
}

export function planCity(input: CityPlanInput): CityPlan {
  const plan: CityPlan = {
    complete: input.complete,
    newVenues: [],
    venueKeys: [],
    newDrafts: [],
    seen: [],
    seenIds: [],
    skipped: {},
  };
  const skip = (r: CitySkip) => (plan.skipped[r] = (plan.skipped[r] ?? 0) + 1);
  const known = new Set(input.knownIds);
  const byKey = new Map(input.cityKeys.map((k) => [k.key, k.venueId]));
  const byName = new Map<string, KnownVenue[]>();
  const venueById = new Map(input.venues.map((v) => [v.id, v]));
  for (const v of input.venues) byName.set(venueKey(v.name), [...(byName.get(venueKey(v.name)) ?? []), v]);
  for (const a of input.aliases) {
    const v = venueById.get(a.venueId);
    if (v) byName.set(venueKey(a.alias), [...(byName.get(venueKey(a.alias)) ?? []), v]);
  }
  const newVenueKeys = new Set<string>();

  function resolve(p: CityPlace): { venueId: string | null; venueKey: string | null } {
    const key = placeKey(p);
    const keyed = byKey.get(key);
    if (keyed) return { venueId: keyed, venueKey: null };
    const near = (byName.get(venueKey(p.name)) ?? []).find(
      (v) => v.lat === null || v.lng === null || distanceKm(v.lat, v.lng, p.lat, p.lng) <= SAME_PLACE_KM,
    );
    if (near) {
      byKey.set(key, near.id);
      plan.venueKeys.push({ key, venueId: near.id });
      return { venueId: near.id, venueKey: null };
    }
    if (!newVenueKeys.has(key)) {
      newVenueKeys.add(key);
      plan.newVenues.push({ key, name: p.name, address: p.address, lat: p.lat, lng: p.lng });
    }
    return { venueId: null, venueKey: key };
  }

  // Second copies: anything at the same venue within 90 minutes, or the same name on
  // the same day anywhere.
  const sameNameDay = new Set(input.existing.map((g) => `${nameKey(g.name)}|${g.localDate}`));
  const atVenue = new Map<string, number[]>();
  for (const g of input.existing) {
    if (!g.venueId) continue;
    atVenue.set(g.venueId, [...(atVenue.get(g.venueId) ?? []), Date.parse(g.startsAt)]);
  }
  const takenTonight = new Set<string>();

  // And second copies inside the feed itself (Alex, 30 Oct 2026): the same rule between
  // two City listings — one venue, within 90 minutes, different events. Toronto Sunday
  // Market is two listings of one market. The lower event key keeps it, the same way
  // every night, and the other is not seen, so a complete read dismisses its drafts.
  const ordered = [...input.rows].sort((a, b) => a.eventKey.localeCompare(b.eventKey) || a.startsAt.localeCompare(b.startsAt));
  const cityAt = new Map<string, { t: number; eventKey: string }[]>();

  for (const r of ordered) {
    const id = cityExternalId(r);
    const reason = citySkipReason(r);
    if (reason) {
      skip(reason);
      continue;
    }
    const { venueId, venueKey: newKey } = resolve(r.place!);
    const t = Date.parse(r.startsAt);
    const place = venueId ?? `new:${newKey}`;
    const here = cityAt.get(place) ?? [];
    if (here.some((x) => x.eventKey !== r.eventKey && Math.abs(x.t - t) <= SAME_TIME_MS)) {
      skip("duplicate");
      continue;
    }
    cityAt.set(place, [...here, { t, eventKey: r.eventKey }]);
    // Every row that passes the rules is "seen", including ones we already have:
    // that is what keeps them from being dismissed as gone.
    plan.seenIds.push(id);
    if (known.has(id)) {
      plan.seen.push({ externalId: id, snapshot: snapshotOf(r) });
      continue;
    }
    if (takenTonight.has(id)) continue; // the feed listing the same day twice
    const clash =
      sameNameDay.has(`${nameKey(r.name)}|${r.localDate}`) ||
      (venueId !== null && (atVenue.get(venueId) ?? []).some((x) => Math.abs(x - t) <= SAME_TIME_MS));
    if (clash) {
      skip("duplicate");
      continue;
    }
    takenTonight.add(id);
    plan.newDrafts.push({
      externalId: id,
      name: r.name,
      startsAt: r.startsAt,
      endsAt: null,
      venueId,
      venueKey: newKey,
      eventUrl: r.url && /^https?:\/\//.test(r.url) ? r.url : r.url ? `https://${r.url}` : null,
      category: chipFor(r.categories),
      entry: r.free ? "free" : "ticketed",
      organiser: r.organiser,
      snapshot: snapshotOf(r),
    });
  }
  return plan;
}
