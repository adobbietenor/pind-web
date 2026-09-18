// Ticketmaster import: mapping, filtering, venue matching, dedupe and change detection
// (Phase 1 M1.3, decisions Part 5). Saved real listings only — no live API calls.
// Run with `npm run test:unit`.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  adjustedScore,
  distanceAdjustment,
  distanceKm,
  filterListings,
  junkReason,
  nameKey,
  planImport,
  toListing,
  venueKey,
  type KnownGathering,
  type KnownSource,
  type Listing,
  type Plan,
  type PlanInput,
  type TmEvent,
} from "../../src/import/ticketmaster.ts";

const RAW: TmEvent[] = JSON.parse(readFileSync(new URL("./fixtures/ticketmaster-toronto.json", import.meta.url), "utf8")).events;
const byId = (id: string): TmEvent => structuredClone(RAW.find((e) => e.id === id)!);
const all = (): Listing[] => RAW.map(toListing);

const LEAFS = "177Zv0G6CMpWoFq";
const RAPTORS = "1A8ZkffGkdCpb1S";
const SHOE_A = "rZ7HnEZ1Af-N_d"; // "The Horseshoe Tavern", venue id rZ7HnEZae-Z
const SHOE_B = "177Zv0G6ClCBdOK"; // " Horseshoe Tavern", venue id KovZpZAdt7JA
const OFFSALE = "rZ7HnEZ1Af-NbS";
const MOEIN = "1A8ZkuvGkdseTS1"; // rescheduled
const DUA = "1AvZZ_kGkXiAFJK"; // cancelled
const RBC = "1AvZZ_7GkizBcn4";
const BEN = ["1A8ZkoAGkdNmejf", "1A8ZkoVGkeSl5Ja"]; // two shows, same night
const LEGENDS = ["1AtZkfEGkd6uvQE", "1AtZkfEGkd6Gs9E", "1AtZkfEGkd6uvho", "1AtZkfEGkd6uohj", "1AtZkfEGkd6uohP"];

const NOW = "2026-09-18T12:00:00.000Z";
const WINDOW_END = "2026-11-13T12:00:00.000Z";
const ARENA = "11111111-1111-4111-8111-111111111111"; // existing venue, Ticketmaster id known
const BUD = "22222222-2222-4222-8222-222222222222"; // "Budweiser Stage", alias "RBC Amphitheatre"

function input(listings: Listing[], extra: Partial<PlanInput> = {}): PlanInput {
  return {
    listings,
    seenIds: listings.map((l) => l.tmId),
    complete: true,
    now: NOW,
    windowEnd: WINDOW_END,
    sources: [],
    gatherings: [],
    venues: [
      { id: ARENA, name: "Scotiabank Arena", lat: 43.643466, lng: -79.379099 },
      { id: BUD, name: "Budweiser Stage", lat: 43.629, lng: -79.415 },
    ],
    aliases: [{ venueId: BUD, alias: "RBC Amphitheatre" }],
    externalIds: [{ externalId: "KovZpZAFFE1A", venueId: ARENA }], // Scotiabank Arena
    ...extra,
  };
}

// The database side of a plan, simulated: every new draft becomes a known draft,
// every source seen is stored with its snapshot. Venue ids for new venues are faked.
function applied(prev: PlanInput, plan: Plan): PlanInput {
  const sources = new Map<string, KnownSource>(prev.sources.map((s) => [s.externalId, { ...s }]));
  const gatherings = new Map<string, KnownGathering>(prev.gatherings.map((g) => [g.id, { ...g }]));
  const venues = [...prev.venues];
  const externalIds = [...prev.externalIds, ...plan.venueExternalIds];
  const newVenueId = new Map<string, string>();
  for (const v of plan.newVenues) {
    const id = `venue-${v.key}`;
    newVenueId.set(v.key, id);
    venues.push({ id, name: v.name, lat: v.lat, lng: v.lng });
    for (const x of v.externalIds) externalIds.push({ externalId: x, venueId: id });
  }
  plan.newDrafts.forEach((d, i) => {
    const id = `draft-${gatherings.size}-${i}`;
    gatherings.set(id, {
      id,
      name: d.name,
      status: "draft",
      startsAt: d.startsAt,
      venueId: d.venueId ?? (d.newVenue ? newVenueId.get(d.newVenue)! : null),
      merged: false,
      dismissedByImporter: false,
    });
    for (const s of d.sources) sources.set(s.externalId, { externalId: s.externalId, gatheringId: id, snapshot: s.snapshot, missingSince: null });
  });
  for (const a of plan.attach) sources.set(a.externalId, { externalId: a.externalId, gatheringId: a.gatheringId, snapshot: a.snapshot, missingSince: null });
  for (const s of plan.seen) Object.assign(sources.get(s.externalId)!, { snapshot: s.snapshot, missingSince: null });
  for (const x of plan.missing) sources.get(x)!.missingSince = prev.now;
  for (const u of plan.draftUpdates) if (u.startsAt) gatherings.get(u.gatheringId)!.startsAt = u.startsAt;
  for (const d of plan.dismiss) Object.assign(gatherings.get(d.gatheringId)!, { status: "dismissed", dismissedByImporter: true });
  for (const r of plan.restore) Object.assign(gatherings.get(r.gatheringId)!, { status: "draft", startsAt: r.startsAt, dismissedByImporter: false });
  return { ...prev, sources: [...sources.values()], gatherings: [...gatherings.values()], venues, externalIds };
}

function gatheringFor(state: PlanInput, tmId: string): KnownGathering {
  const s = state.sources.find((x) => x.externalId === tmId)!;
  return state.gatherings.find((g) => g.id === s.gatheringId)!;
}

// One listing, as Ticketmaster might send it on a later night.
function changed(id: string, patch: { status?: string; dateTime?: string }): Listing {
  const e = byId(id);
  if (patch.status) e.dates!.status = { code: patch.status };
  if (patch.dateTime) e.dates!.start!.dateTime = patch.dateTime;
  return toListing(e);
}

// A state holding one gathering with one Ticketmaster source, seen as it is now.
function holding(id: string, status: KnownGathering["status"], extra: Partial<KnownGathering> = {}): PlanInput {
  const l = toListing(byId(id));
  return input([], {
    gatherings: [{ id: "g1", name: l.name, status, startsAt: l.startsAt!, venueId: ARENA, merged: false, dismissedByImporter: false, ...extra }],
    sources: [{ externalId: id, gatheringId: "g1", snapshot: { name: l.name, startsAt: l.startsAt, status: l.status, url: l.url }, missingSince: null }],
  });
}

function rerun(state: PlanInput, listings: Listing[], extra: Partial<PlanInput> = {}): Plan {
  return planImport({ ...state, listings, seenIds: listings.map((l) => l.tmId), ...extra });
}

describe("Mapping a Ticketmaster listing", () => {
  it("I01 a Leafs game becomes a UTC start, a status, a link and a venue with coordinates", () => {
    const l = toListing(byId(LEAFS));
    assert.equal(l.name, "Toronto Maple Leafs vs. Montreal Canadiens");
    assert.equal(l.startsAt, "2026-09-19T23:00:00.000Z"); // 7pm EDT
    assert.equal(l.status, "onsale");
    assert.match(l.url ?? "", /^https:\/\/www\.ticketmaster\.ca\//);
    assert.equal(l.venue?.name, "Scotiabank Arena");
    assert.ok(Math.abs(l.venue!.lat! - 43.643) < 0.01 && Math.abs(l.venue!.lng! + 79.379) < 0.01);
    assert.match(l.venue!.address ?? "", /Bay St/);
  });

  it("I02 no start time yet means no start; 'canceled' and 'cancelled' read the same", () => {
    assert.equal(toListing(byId("1k7Zv0GwGA5C2qn")).startsAt, null); // Ballpark Tours, no time
    assert.equal(changed(LEAFS, { status: "canceled" }).status, "cancelled");
    assert.equal(toListing(byId(DUA)).status, "cancelled");
    assert.equal(toListing(byId(MOEIN)).status, "rescheduled");
    assert.equal(toListing(byId(OFFSALE)).status, "offsale");
  });

  it("I03 a venue name with a stray leading space is trimmed", () => {
    assert.equal(toListing(byId(SHOE_B)).venue?.name, "Horseshoe Tavern");
  });
});

describe("Filtering junk before AI sees it", () => {
  it("I04 add-ons, tours, screenings, season tickets and timed slots are dropped / real events are kept", () => {
    const { kept, skipped } = filterListings(all());
    const keptIds = new Set(kept.map((l) => l.tmId));
    const junk = [
      "1k7ZvP78GA5d5fQ", // Leafs Fan Access Plus Ups (Upsell)
      "1AvZZ_8Gkl589-5", // Guided Tours of Scotiabank Arena (Sightseeing)
      "1k7Zv0GwGA5C2qn", // Rogers Centre Ballpark Tours
      "1718v0G6CBHh8EL", // Casa Loma General Admission
      "1AvZZ_8GkcAcRp1", // screening at Scotiabank Theatre Cinema 9
      "1AvZZ_3GkRdo-SD", // film festival screening
      "177Zv0G6u7eg2f1", // VIP2 … UPGRADE [DOES NOT INCLUDE TICKET]
      "1AvZZ_8GkiOfpI7", // Special Stuff Package
      "168ZkokjUZA2da5k", // AFC Toronto Season Tickets
      "rZ7HnEZ1AfGKxf", // TMU season pass
      ...LEGENDS,
    ];
    for (const id of junk) assert.ok(!keptIds.has(id), `${id} should have been dropped`);
    const real = [LEAFS, RAPTORS, SHOE_A, SHOE_B, OFFSALE, MOEIN, DUA, RBC, ...BEN, "rZ7HnEZ1AfkoGf", "1AvZZ_kGkmJanvt"];
    for (const id of real) assert.ok(keptIds.has(id), `${id} should have been kept`);
    assert.equal(skipped.timed_series, 5);
    assert.equal(kept.length + Object.values(skipped).reduce((a, b) => a + b, 0), RAW.length);
  });

  it("I05 name rules: parking and 'does not include a ticket' are add-ons / a band called VIPERBLOND is not", () => {
    const base = toListing(byId(LEAFS));
    const named = (name: string): Listing => ({ ...base, name, segment: "Music", type: null, subType: null });
    assert.equal(junkReason(named("Parking — Leafs vs. Bruins")), "add_on");
    assert.equal(junkReason(named("Meet & Greet - DOES NOT INCLUDE A TICKET")), "add_on");
    assert.equal(junkReason(named("VIP Upgrade Package")), "add_on");
    assert.equal(junkReason(named("Kontravoid & Buzz Kull w/ VIPERBLOND")), null);
    assert.equal(junkReason(named("Toronto Maple Leafs vs. Boston Bruins")), null);
    assert.equal(junkReason({ ...base, test: true }), "test");
  });

  it("I06 two shows on one night stay two events; five timed entries are a series", () => {
    const { kept } = filterListings(all());
    assert.equal(kept.filter((l) => BEN.includes(l.tmId)).length, 2);
  });
});

describe("Venue names", () => {
  it("I07 normalising: spaces, case, punctuation, '&', a leading 'the' and accents", () => {
    assert.equal(venueKey(" Horseshoe Tavern"), venueKey("The Horseshoe Tavern"));
    assert.equal(venueKey("Coca-Cola Coliseum"), "coca cola coliseum");
    assert.equal(venueKey("The Elgin & Winter Garden Theatres"), "elgin and winter garden theatres");
    assert.equal(nameKey("Toronto FC v CF Montréal"), "toronto fc v cf montreal");
    assert.notEqual(venueKey("Budweiser Stage"), venueKey("RBC Amphitheatre")); // a rename needs an alias
  });
});

describe("Distance adjustment (calculated, not AI)", () => {
  const toronto = { centreLat: 43.6453, centreLng: -79.3806, coreRadiusKm: 12, penaltyPerKm: 1, penaltyMax: 15 };
  it("I08 none inside 12 km; −1 per km beyond; capped at 15; unknown distance is not penalised", () => {
    assert.ok(distanceKm(43.6453, -79.3806, 43.643466, -79.379099) < 0.5);
    assert.equal(distanceAdjustment(0.2, toronto), 0);
    assert.equal(distanceAdjustment(12, toronto), 0);
    assert.equal(distanceAdjustment(13.7, toronto), 2);
    assert.equal(distanceAdjustment(22.2, toronto), 10);
    assert.equal(distanceAdjustment(26.7, toronto), 15);
    assert.equal(distanceAdjustment(40, toronto), 15);
    assert.equal(distanceAdjustment(null, toronto), 0);
    assert.equal(adjustedScore(80, 15), 65);
    assert.equal(adjustedScore(5, 15), 0);
    assert.equal(adjustedScore(null, 15), null);
  });
});

describe("Import plan — new events and venues", () => {
  it("I10 first run: drafts for real events; Horseshoe's two Ticketmaster ids become ONE new venue; the arena and the renamed amphitheatre are matched", () => {
    const { kept } = filterListings(all());
    const plan = planImport(input(kept));
    const shoe = plan.newVenues.filter((v) => v.name.includes("Horseshoe"));
    assert.equal(shoe.length, 1);
    assert.deepEqual(new Set(shoe[0]!.externalIds), new Set(["rZ7HnEZae-Z", "KovZpZAdt7JA"]));
    assert.ok(shoe[0]!.lat !== null && shoe[0]!.address);
    const leafs = plan.newDrafts.find((d) => d.sources.some((s) => s.externalId === LEAFS))!;
    assert.equal(leafs.venueId, ARENA);
    const rbc = plan.newDrafts.find((d) => d.sources.some((s) => s.externalId === RBC))!;
    assert.equal(rbc.venueId, BUD);
    assert.ok(plan.venueExternalIds.some((x) => x.venueId === BUD)); // matched by alias, id remembered
    assert.ok(!plan.newVenues.some((v) => /scotiabank arena|rbc/i.test(v.name)));
  });

  it("I11 a listing already cancelled is never imported / a rescheduled one is (it has a valid date)", () => {
    const { kept } = filterListings(all());
    const plan = planImport(input(kept));
    const ids = plan.newDrafts.flatMap((d) => d.sources.map((s) => s.externalId));
    assert.ok(!ids.includes(DUA));
    assert.ok(ids.includes(MOEIN));
    assert.equal(plan.skipped.not_active, 1);
  });

  it("I12 the same game listed twice (same venue, time, name) becomes one draft with both ids", () => {
    const dup = toListing({ ...byId(LEAFS), id: "DUPLICATE1" });
    const plan = planImport(input([toListing(byId(LEAFS)), dup]));
    assert.equal(plan.newDrafts.length, 1);
    assert.deepEqual(plan.newDrafts[0]!.sources.map((s) => s.externalId).sort(), ["DUPLICATE1", LEAFS].sort());
  });

  it("I13 running again creates no duplicates and changes nothing", () => {
    const { kept } = filterListings(all());
    const first = input(kept);
    const second = planImport(applied(first, planImport(first)));
    assert.equal(second.newDrafts.length, 0);
    assert.equal(second.newVenues.length, 0);
    assert.equal(second.attach.length, 0);
    assert.deepEqual([second.draftUpdates, second.dismiss, second.restore, second.flags], [[], [], [], []]);
    assert.equal(second.seen.length, kept.length - 1); // everything but the cancelled listing
  });

  it("I14 a draft Alex dismissed, or merged away, is never re-created and never restored", () => {
    for (const extra of [{ dismissedByImporter: false }, { merged: true }]) {
      const plan = rerun(holding(LEAFS, "dismissed", extra), [toListing(byId(LEAFS))]);
      assert.equal(plan.newDrafts.length, 0);
      assert.equal(plan.restore.length, 0);
      assert.equal(plan.seen.length, 1);
    }
  });

  it("I15 a new Ticketmaster id for a gathering we already have (same venue, time, name) is attached to it", () => {
    const plan = rerun(holding(LEAFS, "published"), [toListing({ ...byId(LEAFS), id: "RELISTED1" })]);
    assert.equal(plan.newDrafts.length, 0);
    assert.deepEqual(plan.attach.map((a) => [a.gatheringId, a.externalId]), [["g1", "RELISTED1"]]);
  });
});

describe("Change detection — drafts change quietly, published gatherings are flagged", () => {
  const LATER = "2026-09-20T23:00:00.000Z";

  it("I20 a new date: a draft's start moves / a published gathering is flagged 'date_changed', unchanged", () => {
    const draft = rerun(holding(LEAFS, "draft"), [changed(LEAFS, { dateTime: LATER })]);
    assert.deepEqual(draft.draftUpdates, [{ gatheringId: "g1", startsAt: LATER }]);
    assert.equal(draft.flags.length, 0);
    const pub = rerun(holding(LEAFS, "published"), [changed(LEAFS, { dateTime: LATER })]);
    assert.equal(pub.draftUpdates.length, 0);
    assert.deepEqual(pub.flags, [{ gatheringId: "g1", kind: "date_changed", oldStartsAt: "2026-09-19T23:00:00.000Z", newStartsAt: LATER, status: "onsale" }]);
  });

  it("I21 cancelled: a draft is dismissed quietly / a published gathering is flagged, never changed", () => {
    const draft = rerun(holding(LEAFS, "draft"), [changed(LEAFS, { status: "cancelled" })]);
    assert.deepEqual(draft.dismiss, [{ gatheringId: "g1", reason: "cancelled" }]);
    assert.equal(draft.flags.length, 0);
    const pub = rerun(holding(LEAFS, "published"), [changed(LEAFS, { status: "cancelled" })]);
    assert.equal(pub.dismiss.length, 0);
    assert.equal(pub.flags[0]?.kind, "cancelled");
  });

  it("I22 postponed: a draft is dismissed quietly / a published gathering is flagged", () => {
    assert.deepEqual(rerun(holding(LEAFS, "draft"), [changed(LEAFS, { status: "postponed" })]).dismiss, [{ gatheringId: "g1", reason: "postponed" }]);
    assert.equal(rerun(holding(LEAFS, "published"), [changed(LEAFS, { status: "postponed" })]).flags[0]?.kind, "postponed");
  });

  it("I23 rescheduled to a new date: a published gathering is flagged 'rescheduled' with old and new", () => {
    const pub = rerun(holding(LEAFS, "published"), [changed(LEAFS, { status: "rescheduled", dateTime: LATER })]);
    assert.equal(pub.flags.length, 1);
    assert.equal(pub.flags[0]!.kind, "rescheduled");
    assert.equal(pub.flags[0]!.newStartsAt, LATER);
  });

  it("I24 off sale (usually sold out) raises nothing and changes nothing", () => {
    for (const status of ["draft", "published"] as const) {
      const plan = rerun(holding(LEAFS, status), [changed(LEAFS, { status: "offsale" })]);
      assert.deepEqual([plan.flags, plan.dismiss, plan.draftUpdates], [[], [], []]);
    }
  });

  it("I25 a withdrawn gathering is left alone", () => {
    const plan = rerun(holding(LEAFS, "withdrawn"), [changed(LEAFS, { status: "cancelled", dateTime: LATER })]);
    assert.deepEqual([plan.flags, plan.dismiss, plan.draftUpdates, plan.restore], [[], [], [], []]);
  });

  it("I26 a postponed draft comes back with a new date: restored automatically at the new date / one Alex dismissed stays dismissed", () => {
    const night1 = holding(LEAFS, "draft");
    const p1 = rerun(night1, [changed(LEAFS, { status: "postponed" })]);
    const night2 = applied(night1, p1);
    assert.equal(gatheringFor(night2, LEAFS).status, "dismissed");
    const p2 = rerun(night2, [changed(LEAFS, { status: "rescheduled", dateTime: LATER })]);
    assert.deepEqual(p2.restore, [{ gatheringId: "g1", startsAt: LATER }]);
    const byAlex = rerun(holding(LEAFS, "dismissed", { dismissedByImporter: false }), [changed(LEAFS, { dateTime: LATER })]);
    assert.equal(byAlex.restore.length, 0);
  });

  it("I27 missing two nights running: a draft is dismissed, a published gathering flagged / not after an incomplete fetch, outside the window, or while a duplicate id is still listed", () => {
    for (const [status, expect] of [["draft", "dismiss"], ["published", "flag"]] as const) {
      const night1 = rerun(holding(LEAFS, status), []);
      assert.deepEqual(night1.missing, [LEAFS]);
      assert.deepEqual([night1.dismiss, night1.flags], [[], []]);
      const state2 = applied(holding(LEAFS, status), night1);
      const night2 = rerun(state2, [], { now: "2026-09-19T09:00:00.000Z" });
      if (expect === "dismiss") assert.deepEqual(night2.dismiss, [{ gatheringId: "g1", reason: "missing" }]);
      else assert.equal(night2.flags[0]?.kind, "missing");
      // The button pressed an hour later is not a second night.
      assert.deepEqual(rerun(state2, [], { now: "2026-09-18T13:00:00.000Z" }).dismiss, []);
    }
    assert.deepEqual(rerun(holding(LEAFS, "draft"), [], { complete: false }).missing, []);
    assert.deepEqual(rerun(holding(LEAFS, "draft"), [], { windowEnd: "2026-09-19T00:00:00.000Z", now: "2026-09-19T01:00:00.000Z" }).missing, []);
    const twoIds = holding(LEAFS, "draft");
    twoIds.sources.push({ externalId: "OTHER", gatheringId: "g1", snapshot: null, missingSince: null });
    const listed = { ...toListing(byId(LEAFS)), tmId: "OTHER" };
    assert.deepEqual(rerun(twoIds, [listed]).missing, []);
  });

  it("I28 an ignored flag is not raised again the next night when nothing new has changed", () => {
    const night1 = holding(LEAFS, "published");
    const later = changed(LEAFS, { dateTime: LATER });
    const p1 = rerun(night1, [later]);
    assert.equal(p1.flags.length, 1);
    assert.equal(rerun(applied(night1, p1), [later]).flags.length, 0);
  });
});
