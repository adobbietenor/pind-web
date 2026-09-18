// Ticketmaster import — the decisions, with no I/O (Phase 1 M1.3, decisions Part 5).
//
// This file maps Ticketmaster listings, drops junk, matches venues, and works out what
// one night's import should change. It reads nothing and writes nothing: the runner
// (run.ts) loads the current state, calls planImport, and hands the plan to the
// database function admin_import_apply, which applies it in one transaction.
// Nothing here imports at runtime, so the unit tests load this file directly.
//
// The rules, in plain English:
//   - A draft may change quietly: its date moves, and it is dismissed when Ticketmaster
//     cancels or postpones it or stops listing it for two nights. A draft the importer
//     dismissed comes back by itself when Ticketmaster lists it again with a date.
//     A draft Alex dismissed, or merged away, never comes back.
//   - A published gathering never changes: a new date, a cancellation, a postponement
//     or a disappearance becomes a flag for Alex. Off-sale (usually sold out) is fine.
//   - A withdrawn gathering is left alone.
//   - A listing already cancelled or postponed is never imported as a new draft.

// ---------------------------------------------------------------------------
// Ticketmaster's shape — only the fields we read
// ---------------------------------------------------------------------------

interface TmName {
  name?: string;
}

export interface TmEvent {
  id: string;
  name: string;
  test?: boolean;
  url?: string;
  dates?: {
    start?: {
      localDate?: string;
      localTime?: string;
      dateTime?: string;
      dateTBD?: boolean;
      dateTBA?: boolean;
      timeTBA?: boolean;
      noSpecificTime?: boolean;
    };
    status?: { code?: string };
    spanMultipleDays?: boolean;
  };
  classifications?: { segment?: TmName; genre?: TmName; type?: TmName; subType?: TmName }[];
  _embedded?: {
    venues?: {
      id: string;
      name?: string;
      postalCode?: string;
      city?: TmName;
      address?: { line1?: string };
      location?: { latitude?: string; longitude?: string };
    }[];
  };
}

export type ListingStatus = "onsale" | "offsale" | "cancelled" | "postponed" | "rescheduled" | "unknown";

export interface ListingVenue {
  tmId: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
}

export interface Listing {
  tmId: string;
  name: string;
  url: string | null;
  status: ListingStatus;
  startsAt: string | null; // UTC ISO; null when Ticketmaster has no time yet
  localDate: string | null;
  venue: ListingVenue | null;
  segment: string | null;
  genre: string | null;
  type: string | null;
  subType: string | null;
  test: boolean;
  multiDay: boolean;
}

const STATUSES: Record<string, ListingStatus> = {
  onsale: "onsale",
  offsale: "offsale",
  cancelled: "cancelled",
  canceled: "cancelled",
  postponed: "postponed",
  rescheduled: "rescheduled",
};

function label(x: TmName | undefined): string | null {
  const v = x?.name?.trim();
  return v && v !== "Undefined" ? v : null;
}

function num(v: string | undefined): number | null {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function iso(value: string): string {
  return new Date(value).toISOString();
}

export function toListing(e: TmEvent): Listing {
  const start = e.dates?.start ?? {};
  const noTime = !start.dateTime || start.timeTBA || start.noSpecificTime || start.dateTBD || start.dateTBA;
  const startsAt = noTime || Number.isNaN(Date.parse(start.dateTime!)) ? null : iso(start.dateTime!);
  const c = e.classifications?.[0] ?? {};
  const v = e._embedded?.venues?.[0];
  const venueName = v?.name?.trim();
  return {
    tmId: e.id,
    name: e.name.trim(),
    url: e.url?.startsWith("https://") ? e.url : null,
    status: STATUSES[(e.dates?.status?.code ?? "").toLowerCase()] ?? "unknown",
    startsAt,
    localDate: start.localDate ?? null,
    venue:
      v && venueName
        ? {
            tmId: v.id,
            name: venueName,
            address: [v.address?.line1?.trim(), v.city?.name?.trim(), v.postalCode?.trim()].filter(Boolean).join(", ") || null,
            lat: num(v.location?.latitude),
            lng: num(v.location?.longitude),
          }
        : null,
    segment: label(c.segment),
    genre: label(c.genre),
    type: label(c.type),
    subType: label(c.subType),
    test: e.test === true,
    multiDay: e.dates?.spanMultipleDays === true,
  };
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

// Lower case, accents off, "&" → "and", punctuation → spaces, spaces collapsed.
export function nameKey(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// As nameKey, and a leading "the" dropped: " Horseshoe Tavern" = "The Horseshoe Tavern".
export function venueKey(s: string): string {
  return nameKey(s).replace(/^the /, "");
}

// ---------------------------------------------------------------------------
// Junk filter (decisions Part 5, "Ticketmaster import filter")
// ---------------------------------------------------------------------------

export type SkipReason =
  | "test"
  | "upsell"
  | "sightseeing"
  | "film"
  | "multi_day"
  | "add_on"
  | "timed_series"
  | "not_active"
  | "no_time";

const ADD_ON =
  /\bparking\b|does not include (a )?tickets?|\bupsell\b|\bvip\d*\b|\bupgrades?\b|\bseason (pass|passes|tickets?)\b|\bpackages?\b|\bgift ?cards?\b|\bvouchers?\b|\bplus ups?\b|\bfan access\b/i;
const SCREEN = /\bcinema\b|\bscreening room\b/i;

// Rules that look at one listing on its own.
export function junkReason(l: Listing): SkipReason | null {
  if (l.test) return "test";
  if (l.type === "Upsell") return "upsell";
  if (l.subType === "Sightseeing/Facility") return "sightseeing";
  if (l.segment === "Film" || (l.venue && SCREEN.test(l.venue.name))) return "film";
  if (l.multiDay) return "multi_day";
  if (ADD_ON.test(l.name)) return "add_on";
  return null;
}

// A timed-entry attraction: the same name at the same venue on the same date at 3 or
// more start times (Legends of Horror every 30 minutes). Two shows a night are kept.
const SERIES_MIN = 3;

export function filterListings(listings: Listing[]): { kept: Listing[]; skipped: Partial<Record<SkipReason, number>> } {
  const skipped: Partial<Record<SkipReason, number>> = {};
  const count = (r: SkipReason) => (skipped[r] = (skipped[r] ?? 0) + 1);
  const rest: Listing[] = [];
  for (const l of listings) {
    const r = junkReason(l);
    if (r) count(r);
    else rest.push(l);
  }
  const times = new Map<string, Set<string>>();
  const seriesKey = (l: Listing) => `${l.venue ? venueKey(l.venue.name) : ""}|${l.localDate ?? ""}|${nameKey(l.name)}`;
  for (const l of rest) {
    const k = seriesKey(l);
    if (!times.has(k)) times.set(k, new Set());
    times.get(k)!.add(l.startsAt ?? "");
  }
  const kept: Listing[] = [];
  for (const l of rest) {
    if (times.get(seriesKey(l))!.size >= SERIES_MIN) count("timed_series");
    else kept.push(l);
  }
  return { kept, skipped };
}

// ---------------------------------------------------------------------------
// Distance from the city centre (decisions Part 5, "Distance adjustment")
// ---------------------------------------------------------------------------

export interface CityGeo {
  centreLat: number;
  centreLng: number;
  coreRadiusKm: number;
  penaltyPerKm: number;
  penaltyMax: number;
}

export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const h =
    Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function venueDistanceKm(v: { lat: number | null; lng: number | null }, c: CityGeo): number | null {
  return v.lat === null || v.lng === null ? null : distanceKm(c.centreLat, c.centreLng, v.lat, v.lng);
}

// 0 inside the core radius, then penaltyPerKm per km beyond it, capped at penaltyMax.
export function distanceAdjustment(km: number | null, c: CityGeo): number {
  if (km === null || km <= c.coreRadiusKm) return 0;
  return Math.min(c.penaltyMax, Math.round((km - c.coreRadiusKm) * c.penaltyPerKm));
}

export function adjustedScore(ai: number | null, adjustment: number): number | null {
  return ai === null ? null : Math.max(0, Math.min(100, ai - adjustment));
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

// What we keep about a listing between nights: facts only (decisions Part 5).
export interface Snapshot {
  name: string;
  startsAt: string | null;
  status: ListingStatus;
  url: string | null;
  category?: string | null; // e.g. "Sports / Hockey", for the AI prompt
}

export function categoryOf(l: Listing): string | null {
  return [l.segment, l.genre].filter(Boolean).join(" / ") || null;
}

export interface KnownSource {
  externalId: string;
  gatheringId: string;
  snapshot: Snapshot | null;
  missingSince: string | null;
}

export type GatheringState = "draft" | "published" | "dismissed" | "withdrawn";

export interface KnownGathering {
  id: string;
  name: string;
  status: GatheringState;
  startsAt: string;
  venueId: string | null;
  merged: boolean;
  // The last dismissal was the importer's (moderation_log actor), not Alex's.
  dismissedByImporter: boolean;
}

export interface KnownVenue {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
}

export interface PlanInput {
  listings: Listing[]; // after filterListings
  seenIds: string[]; // every Ticketmaster id fetched this run, before filtering
  complete: boolean; // every page of every week was fetched; otherwise nothing counts as missing
  now: string;
  windowEnd: string;
  sources: KnownSource[]; // Ticketmaster source rows
  gatherings: KnownGathering[]; // every gathering those rows point at, plus gatherings in the window
  venues: KnownVenue[];
  aliases: { venueId: string; alias: string }[];
  externalIds: { externalId: string; venueId: string }[]; // Ticketmaster venue ids
}

export interface NewVenue {
  key: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  externalIds: string[];
  nearVenueId: string | null; // an existing venue within 150 m: maybe the same place
}

export interface SourceWrite {
  externalId: string;
  url: string | null;
  snapshot: Snapshot;
}

export interface NewDraft {
  name: string;
  startsAt: string;
  eventUrl: string | null;
  venueNameRaw: string | null;
  venueId: string | null;
  newVenue: string | null; // NewVenue.key
  sources: SourceWrite[];
}

export type FlagKind = "date_changed" | "rescheduled" | "postponed" | "cancelled" | "missing";

export interface Flag {
  gatheringId: string;
  kind: FlagKind;
  oldStartsAt: string | null;
  newStartsAt: string | null;
  status: string;
}

export interface Plan {
  newVenues: NewVenue[];
  venueExternalIds: { externalId: string; venueId: string }[];
  newDrafts: NewDraft[];
  attach: (SourceWrite & { gatheringId: string })[];
  seen: SourceWrite[];
  missing: string[];
  draftUpdates: { gatheringId: string; startsAt?: string; venueId?: string; newVenue?: string }[];
  dismiss: { gatheringId: string; reason: "cancelled" | "postponed" | "missing" }[];
  restore: { gatheringId: string; startsAt: string }[];
  flags: Flag[];
  skipped: Partial<Record<SkipReason, number>>;
}

// A second night means at least this long after it first went missing, so pressing
// "Run import now" twice in an evening is not two nights.
export const MISSING_AFTER_MS = 20 * 60 * 60 * 1000;
const NEAR_KM = 0.15;

const isActive = (l: Listing) => l.status !== "cancelled" && l.status !== "postponed" && l.startsAt !== null;
const sameTime = (a: string | null, b: string | null) => a !== null && b !== null && Date.parse(a) === Date.parse(b);
const snapshotOf = (l: Listing): Snapshot => ({
  name: l.name,
  startsAt: l.startsAt,
  status: l.status,
  url: l.url,
  category: categoryOf(l),
});
const write = (l: Listing): SourceWrite => ({ externalId: l.tmId, url: l.url, snapshot: snapshotOf(l) });

export function planImport(input: PlanInput): Plan {
  const plan: Plan = {
    newVenues: [],
    venueExternalIds: [],
    newDrafts: [],
    attach: [],
    seen: [],
    missing: [],
    draftUpdates: [],
    dismiss: [],
    restore: [],
    flags: [],
    skipped: {},
  };
  const skip = (r: SkipReason) => (plan.skipped[r] = (plan.skipped[r] ?? 0) + 1);
  const sources = new Map(input.sources.map((s) => [s.externalId, s]));
  const gatherings = new Map(input.gatherings.map((g) => [g.id, g]));
  const now = Date.parse(input.now);

  // --- venues -------------------------------------------------------------
  const byExternal = new Map(input.externalIds.map((x) => [x.externalId, x.venueId]));
  const byName = new Map<string, string>();
  for (const v of [...input.venues].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!byName.has(venueKey(v.name))) byName.set(venueKey(v.name), v.id);
  }
  for (const a of input.aliases) if (!byName.has(venueKey(a.alias))) byName.set(venueKey(a.alias), a.venueId);
  const newVenues = new Map<string, NewVenue>();
  const learned = new Set<string>();

  function resolveVenue(v: ListingVenue | null): { venueId: string | null; newVenue: string | null } {
    if (!v) return { venueId: null, newVenue: null };
    const known = byExternal.get(v.tmId);
    if (known) return { venueId: known, newVenue: null };
    const key = venueKey(v.name);
    const named = byName.get(key);
    if (named) {
      if (!learned.has(v.tmId)) {
        learned.add(v.tmId);
        plan.venueExternalIds.push({ externalId: v.tmId, venueId: named });
      }
      return { venueId: named, newVenue: null };
    }
    let nv = newVenues.get(key);
    if (!nv) {
      const near =
        v.lat === null || v.lng === null
          ? undefined
          : input.venues.find((x) => x.lat !== null && x.lng !== null && distanceKm(v.lat!, v.lng!, x.lat, x.lng) <= NEAR_KM);
      nv = { key, name: v.name, address: v.address, lat: v.lat, lng: v.lng, externalIds: [], nearVenueId: near?.id ?? null };
      newVenues.set(key, nv);
      plan.newVenues.push(nv);
    }
    if (!nv.externalIds.includes(v.tmId)) nv.externalIds.push(v.tmId);
    return { venueId: null, newVenue: key };
  }

  // --- listings we already know --------------------------------------------
  const seenGatherings = new Set<string>();
  const acted = new Set<string>(); // one quiet action or flag per gathering per kind
  const once = (key: string) => (acted.has(key) ? false : (acted.add(key), true));
  const fresh: Listing[] = [];

  for (const l of input.listings) {
    const src = sources.get(l.tmId);
    if (!src) {
      fresh.push(l);
      continue;
    }
    plan.seen.push(write(l));
    const g = gatherings.get(src.gatheringId);
    if (!g) continue;
    seenGatherings.add(g.id);
    const old = src.snapshot;
    const timeChanged = old !== null && l.startsAt !== null && !sameTime(old.startsAt, l.startsAt);
    const statusChanged = old === null || old.status !== l.status;

    if (g.status === "draft") {
      if (l.status === "cancelled" || l.status === "postponed") {
        if (once(`dismiss:${g.id}`)) plan.dismiss.push({ gatheringId: g.id, reason: l.status });
      } else if (timeChanged && once(`update:${g.id}`)) {
        plan.draftUpdates.push({ gatheringId: g.id, startsAt: l.startsAt! });
      }
      if (g.venueId === null && l.venue && once(`venue:${g.id}`)) {
        const r = resolveVenue(l.venue);
        if (r.venueId) plan.draftUpdates.push({ gatheringId: g.id, venueId: r.venueId });
        else if (r.newVenue) plan.draftUpdates.push({ gatheringId: g.id, newVenue: r.newVenue });
      }
    } else if (g.status === "dismissed") {
      if (g.dismissedByImporter && !g.merged && isActive(l) && once(`restore:${g.id}`)) {
        plan.restore.push({ gatheringId: g.id, startsAt: l.startsAt! });
      }
    } else if (g.status === "published") {
      const flag = (kind: FlagKind) => {
        if (once(`flag:${g.id}:${kind}`)) {
          plan.flags.push({ gatheringId: g.id, kind, oldStartsAt: iso(g.startsAt), newStartsAt: l.startsAt, status: l.status });
        }
      };
      if (statusChanged && (l.status === "cancelled" || l.status === "postponed")) flag(l.status);
      else if (timeChanged) flag(l.status === "rescheduled" ? "rescheduled" : "date_changed");
      else if (statusChanged && l.status === "rescheduled" && l.startsAt && !sameTime(l.startsAt, g.startsAt)) flag("rescheduled");
    }
    // withdrawn: left alone
  }

  // --- new listings ----------------------------------------------------------
  const existingByKey = new Map<string, string>();
  for (const g of input.gatherings) {
    if (g.venueId) existingByKey.set(`${g.venueId}|${Date.parse(g.startsAt)}|${nameKey(g.name)}`, g.id);
  }
  const draftByKey = new Map<string, NewDraft>();
  for (const l of fresh) {
    if (!isActive(l)) {
      skip(l.startsAt === null && l.status !== "cancelled" && l.status !== "postponed" ? "no_time" : "not_active");
      continue;
    }
    const venue = resolveVenue(l.venue);
    const where = venue.venueId ?? `new:${venue.newVenue ?? `raw:${l.venue?.name ?? ""}`}`;
    const key = `${where}|${Date.parse(l.startsAt!)}|${nameKey(l.name)}`;
    const existing = existingByKey.get(key);
    if (existing) {
      plan.attach.push({ gatheringId: existing, ...write(l) });
      seenGatherings.add(existing);
      continue;
    }
    const dup = draftByKey.get(key);
    if (dup) {
      dup.sources.push(write(l));
      continue;
    }
    const d: NewDraft = {
      name: l.name,
      startsAt: l.startsAt!,
      eventUrl: l.url,
      venueNameRaw: l.venue?.name ?? null,
      venueId: venue.venueId,
      newVenue: venue.newVenue,
      sources: [write(l)],
    };
    draftByKey.set(key, d);
    plan.newDrafts.push(d);
  }

  // --- listings that have gone -------------------------------------------------
  if (input.complete) {
    const seenIds = new Set(input.seenIds);
    const windowEnd = Date.parse(input.windowEnd);
    for (const src of input.sources) {
      if (seenIds.has(src.externalId)) continue;
      const g = gatherings.get(src.gatheringId);
      if (!g || seenGatherings.has(g.id) || (g.status !== "draft" && g.status !== "published")) continue;
      const start = Date.parse(g.startsAt);
      if (start < now || start > windowEnd) continue;
      if (src.missingSince === null) {
        plan.missing.push(src.externalId);
      } else if (now - Date.parse(src.missingSince) >= MISSING_AFTER_MS) {
        if (g.status === "draft") {
          if (once(`dismiss:${g.id}`)) plan.dismiss.push({ gatheringId: g.id, reason: "missing" });
        } else if (once(`flag:${g.id}:missing`)) {
          plan.flags.push({ gatheringId: g.id, kind: "missing", oldStartsAt: iso(g.startsAt), newStartsAt: null, status: "missing" });
        }
      }
    }
  }

  return plan;
}
