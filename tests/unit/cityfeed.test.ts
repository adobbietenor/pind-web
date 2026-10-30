// The City of Toronto feed (M4.4): reading the 235 MB file in pieces, the rules Alex
// chose, and the plan. Every rule is proved from both sides — the row refused, and the
// row that fits. The fixture is seven real rows from the feed (29 Oct 2026), trimmed
// of their long descriptions. Run with `npm run test:unit`.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  calendarDateOf,
  chipFor,
  cityEventKey,
  cityExternalId,
  citySkipReason,
  MAX_RUN_DAYS,
  ObjectSplitter,
  organiserOf,
  placeKey,
  planCity,
  runDays,
  titleOf,
  toCityRow,
  type CityPlanInput,
  type CityRow,
} from "../../src/import/cityfeed.ts";

const FILE = readFileSync(new URL("./fixtures/city-feed-sample.json", import.meta.url), "utf8");
const RAW = JSON.parse(FILE).value as Record<string, unknown>[];
const byName = (n: string) => toCityRow(RAW.find((r) => String(r.event_name).startsWith(n))!)!;

describe("reading the feed in pieces", () => {
  it("CY01 hands back exactly the array's objects, whatever size the pieces arrive in", () => {
    for (const size of [1, 7, 113, 4096, FILE.length]) {
      const s = new ObjectSplitter();
      const out: string[] = [];
      for (let i = 0; i < FILE.length; i += size) out.push(...s.push(FILE.slice(i, i + size)));
      assert.equal(out.length, RAW.length, `piece size ${size}`);
      assert.deepEqual(out.map((o) => JSON.parse(o)), RAW, `piece size ${size}`);
    }
  });

  it("CY02 is not fooled by braces, brackets and escaped quotes inside strings", () => {
    const text = JSON.stringify({ value: [{ a: 'he said "{[" and }', b: "\\" }, { c: "]}" }] });
    const out = new ObjectSplitter().push(text);
    assert.deepEqual(out.map((o) => JSON.parse(o)), [{ a: 'he said "{[" and }', b: "\\" }, { c: "]}" }]);
  });

  it("CY03 reads the day off an object without parsing it", () => {
    assert.equal(calendarDateOf('{"x":1,"calendar_date":"2026-11-21T10:00:00-05:00","y":2}'), "2026-11-21T10:00:00-05:00");
    assert.equal(calendarDateOf('{"x":1}'), null);
  });
});

describe("one row, reduced", () => {
  it("CY04 maps a real weekly market: its place, its pattern, its moment", () => {
    const r = byName("Downsview Park Merchants Market");
    assert.equal(r.frequency, "Weekly");
    assert.ok(r.place && Number.isFinite(r.place.lat) && Number.isFinite(r.place.lng));
    assert.equal(r.startsAt, new Date(String(RAW.find((x) => x.event_name === r.name)!.calendar_date)).toISOString());
    assert.equal(r.localTime, "10:00");
    assert.equal(r.free, true);
  });

  it("CY05 the organiser is 'presented by' when named, then the contact address, then nobody", () => {
    assert.equal(organiserOf({ partnerships: [{ text: " DEAFest Toronto Inc.", value: "event_presented_by" }], event_email: "x@y.ca" }), "DEAFest Toronto Inc.");
    assert.equal(organiserOf({ partnerships: [{ text: "City of Toronto", value: "event_funded_by" }], event_email: "Assembly@Toronto.ca" }), "assembly@toronto.ca");
    assert.equal(organiserOf({ partnerships: [] }), null);
  });
});

describe("the rules (Alex, 29 Oct 2026)", () => {
  const base: CityRow = {
    eventKey: "k",
    startsAt: "2026-11-07T15:00:00.000Z",
    localDate: "2026-11-07",
    localTime: "10:00",
    name: "A thing",
    categories: ["Food/Culinary"],
    frequency: "Single Date",
    weekdays: 0,
    firstDate: "2026-11-07",
    lastDate: "2026-11-07",
    place: { name: "Somewhere", address: "1 Front St", lat: 43.65, lng: -79.38 },
    organiser: null,
    url: null,
    free: true,
  };

  it("CY06 leaves out a listing whose every category is Events territory, and keeps one with any other", () => {
    assert.equal(citySkipReason(byName("Jazz at the Columbus Centre")), "excluded_category");
    assert.equal(citySkipReason({ ...base, categories: ["Music", "Live Performances"] }), "excluded_category");
    assert.equal(citySkipReason({ ...base, categories: ["Music", "Food/Culinary"] }), null, "a food festival with music was dropped");
    assert.equal(citySkipReason({ ...base, categories: ["Virtual/Online Event"] }), "excluded_category");
  });

  it("CY07 a run of four days or fewer is one gathering a day; a fifth day makes it a long run", () => {
    assert.equal(MAX_RUN_DAYS, 4);
    assert.equal(runDays("2026-11-07", "2026-11-10"), 4);
    assert.equal(citySkipReason({ ...base, lastDate: "2026-11-10" }), null);
    assert.equal(citySkipReason({ ...base, lastDate: "2026-11-11" }), "long_run");
    assert.equal(citySkipReason(byName("First Wednesday Night Free at the AGO")), "long_run");
    assert.equal(citySkipReason(byName("2026 Hockey Hall of Fame Induction")), null);
  });

  it("CY08 except a weekly repeat on one day of the week, which takes each listed day however long the season", () => {
    const season = { ...base, frequency: "Weekly", lastDate: "2027-05-01" };
    assert.ok(runDays(season.firstDate, season.lastDate) > MAX_RUN_DAYS);
    assert.equal(citySkipReason({ ...season, weekdays: 1 }), null, "a Saturday market was dropped");
    assert.equal(citySkipReason({ ...base, frequency: "Daily", lastDate: "2026-12-07" }), "long_run", "a daily exhibition got in");
  });

  it("CY16 a weekly repeat ticked for several weekdays is an exhibition, not a series (Alex, 30 Oct 2026)", () => {
    // A real one: Downsview's market is ticked for Saturday and Sunday.
    const market = byName("Downsview Park Merchants Market");
    assert.equal(market.frequency, "Weekly");
    assert.equal(market.weekdays, 2);
    assert.equal(citySkipReason(market), "weekly_several_days");
    const season = { ...base, frequency: "Weekly", lastDate: "2027-05-01" };
    assert.equal(citySkipReason({ ...season, weekdays: 6 }), "weekly_several_days", "a six-day exhibition got in");
    assert.equal(citySkipReason({ ...season, weekdays: 0 }), "weekly_several_days", "unreadable weekdays were guessed");
    assert.equal(citySkipReason({ ...season, weekdays: 1 }), null);
    // Inside four days the run rule already allows one a day, whatever the weekdays.
    assert.equal(citySkipReason({ ...base, frequency: "Weekly", weekdays: 3, lastDate: "2026-11-09" }), null);
  });

  it("CY09 a midnight start is no time at all; any other time is a time", () => {
    // A real one: Arts/Exhibits keeps it past the category rule, and its midnight start stops it.
    assert.equal(citySkipReason(byName("Lakeshore Dance Series")), "no_time");
    assert.equal(citySkipReason({ ...base, localTime: "00:00" }), "no_time");
    assert.equal(citySkipReason({ ...base, localTime: "00:30" }), null);
  });

  it("CY10 needs exactly one address with coordinates", () => {
    assert.equal(byName("Winter Wings").place, null);
    assert.equal(citySkipReason({ ...base, place: null }), "no_place");
    assert.equal(citySkipReason(base), null);
    const two = toCityRow({
      ...RAW[0]!,
      event_locations: [...(RAW[0]!.event_locations as unknown[]), ...(RAW[0]!.event_locations as unknown[])],
    })!;
    assert.equal(two.place, null, "a listing at two places was given one of them");
  });

  it("CY11 the chips that map cleanly, and nothing for the rest", () => {
    assert.equal(chipFor(["Farmers' Market", "Food/Culinary"]), "markets");
    assert.equal(chipFor(["Run/Walk"]), "running");
    assert.equal(chipFor(["Trivia"]), "games");
    assert.equal(chipFor(["Environmental"]), "outdoors");
    assert.equal(chipFor(["Tour", "History"]), "outdoors");
    assert.equal(chipFor(["Cultural", "Celebrations"]), null);
  });
});

describe("the plan", () => {
  const row = (over: Partial<CityRow> = {}): CityRow => ({
    eventKey: "e1",
    startsAt: "2026-11-07T15:00:00.000Z",
    localDate: "2026-11-07",
    localTime: "10:00",
    name: "Harvest Fair",
    categories: ["Food/Culinary"],
    frequency: "Single Date",
    weekdays: 0,
    firstDate: "2026-11-07",
    lastDate: "2026-11-07",
    place: { name: "Wychwood Barns", address: "601 Christie St", lat: 43.68, lng: -79.424 },
    organiser: "The Stop",
    url: "thestop.org",
    free: true,
    ...over,
  });
  const input = (over: Partial<CityPlanInput> = {}): CityPlanInput => ({
    rows: [row()],
    venues: [],
    aliases: [],
    cityKeys: [],
    knownIds: [],
    existing: [],
    complete: true,
    ...over,
  });

  it("CY12 a new place becomes a new venue, once, however many days it has", () => {
    const p = planCity(input({ rows: [row(), row({ startsAt: "2026-11-08T15:00:00.000Z", localDate: "2026-11-08" })] }));
    assert.equal(p.newVenues.length, 1);
    assert.equal(p.newDrafts.length, 2);
    assert.equal(p.newDrafts[0]!.venueKey, placeKey(row().place!));
    assert.equal(p.newDrafts[0]!.eventUrl, "https://thestop.org");
    assert.equal(p.newDrafts[0]!.organiser, "The Stop");
  });

  it("CY13 a known venue of the same name is used only when it is the same place", () => {
    const near = { id: "v-near", name: "Wychwood Barns", lat: 43.6801, lng: -79.4241 };
    const far = { id: "v-far", name: "Wychwood Barns", lat: 43.75, lng: -79.3 };
    const a = planCity(input({ venues: [near] }));
    assert.equal(a.newDrafts[0]!.venueId, "v-near");
    assert.deepEqual(a.venueKeys, [{ key: placeKey(row().place!), venueId: "v-near" }]);
    const b = planCity(input({ venues: [far] }));
    assert.equal(b.newDrafts[0]!.venueId, null, "a namesake 10 km away was taken for the same place");
    assert.equal(b.newVenues.length, 1);
  });

  it("CY14 a second copy of something already listed is skipped; something else at the venue is not", () => {
    const venue = { id: "v1", name: "Wychwood Barns", lat: 43.68, lng: -79.424 };
    const sameTime = { venueId: "v1", startsAt: "2026-11-07T16:00:00.000Z", name: "Saturday market", localDate: "2026-11-07" };
    const later = { venueId: "v1", startsAt: "2026-11-07T18:00:00.000Z", name: "Saturday market", localDate: "2026-11-07" };
    assert.equal(planCity(input({ venues: [venue], existing: [sameTime] })).skipped.duplicate, 1);
    assert.equal(planCity(input({ venues: [venue], existing: [later] })).newDrafts.length, 1);
    const sameName = { venueId: "elsewhere", startsAt: "2026-11-07T23:00:00.000Z", name: "Harvest Fair", localDate: "2026-11-07" };
    assert.equal(planCity(input({ existing: [sameName] })).skipped.duplicate, 1);
    const otherDay = { ...sameName, startsAt: "2026-11-08T23:00:00.000Z", localDate: "2026-11-08" };
    assert.equal(planCity(input({ existing: [otherDay] })).newDrafts.length, 1);
  });

  it("CY15 a listing-day already known is seen, not created again; a refused row is not seen", () => {
    const known = cityExternalId(row());
    const p = planCity(input({ knownIds: [known], rows: [row(), row({ eventKey: "e2", localTime: "00:00" })] }));
    assert.equal(p.newDrafts.length, 0);
    assert.deepEqual(p.seen.map((s) => s.externalId), [known]);
    assert.deepEqual(p.seenIds, [known]);
    assert.equal(p.skipped.no_time, 1);
  });

  it("CY20 two City listings at one venue within 90 minutes are one gathering; two hours apart, or one event's own dates, are not (Alex, 30 Oct 2026)", () => {
    // Toronto Sunday Market's shape: two listings, same hall, same time. Fed in either order,
    // the lower event key keeps it.
    const a = row({ eventKey: "aaa", name: "Toronto Sunday Market" });
    const b = row({ eventKey: "bbb", name: "Toronto Sunday Market", startsAt: "2026-11-07T15:30:00.000Z" });
    for (const rows of [[a, b], [b, a]]) {
      const p = planCity(input({ rows }));
      assert.deepEqual(p.newDrafts.map((d) => d.externalId), [cityExternalId(a)], "the second copy was made");
      assert.equal(p.skipped.duplicate, 1);
      assert.ok(!p.seenIds.includes(cityExternalId(b)), "the second copy was seen, so it would never be dismissed");
    }
    // Both already drafts: the second is not seen, so a complete read dismisses it.
    const both = planCity(input({ rows: [b, a], knownIds: [cityExternalId(a), cityExternalId(b)] }));
    assert.deepEqual(both.seenIds, [cityExternalId(a)]);
    // Two hours apart at the same venue: two gatherings.
    const later = row({ eventKey: "ccc", startsAt: "2026-11-07T17:00:00.000Z" });
    assert.equal(planCity(input({ rows: [a, later] })).newDrafts.length, 2);
    // A different venue at the same time: two gatherings.
    const elsewhere = row({ eventKey: "ddd", place: { name: "Allan Gardens", address: "160 Gerrard St E", lat: 43.6619, lng: -79.3747 } });
    assert.equal(planCity(input({ rows: [a, elsewhere] })).newDrafts.length, 2);
    // One event's two dates are never each other's copy.
    const nextWeek = row({ eventKey: "aaa", name: "Toronto Sunday Market", startsAt: "2026-11-14T15:00:00.000Z", localDate: "2026-11-14" });
    assert.equal(planCity(input({ rows: [a, nextWeek] })).newDrafts.length, 2);
  });
});

describe("titles and events (Alex, 30 Oct 2026)", () => {
  const listing = (name: string, place: string, calendar: string | null = "Play Mobile") => ({
    event_name: name,
    calendar_name: calendar,
    event_locations: [{ location_name: place }],
  });

  it("CY17 a session named only by its place and time takes the programme's name", () => {
    // Real names from the feed, odd spacing and all.
    assert.equal(titleOf(listing("Falstaff Park - 11 a.m. to 1 p.m.", "Falstaff Park")), "Play Mobile");
    assert.equal(titleOf(listing("Moore Park - 2:30 to 4:30 p.m.", "Moore Park")), "Play Mobile");
    assert.equal(titleOf(listing("Trinity Bellwoods Park - 11 a.m .to 1 p.m.", "Trinity Bellwoods Park")), "Play Mobile");
    assert.equal(titleOf(listing("Marie Curtis Park - 11a.m. to 1p.m.", "Marie Curtis Park")), "Play Mobile");
    assert.equal(titleOf(listing("Heron Park - 2:30 to 4:30 p.m.", "Heron Park Community Centre")), "Play Mobile");
    assert.equal(titleOf(listing("R.V. Burgess Park - 2:30 to 4:30 p.m.", "RV Burgess Park")), "Play Mobile");
    const row = toCityRow({ ...RAW[0]!, ...listing("Falstaff Park - 11 a.m. to 1 p.m.", "Falstaff Park") , event_locations: [{ ...(RAW[0]!.event_locations as any[])[0], location_name: "Falstaff Park" }] });
    assert.equal(row?.name, "Play Mobile", "the row did not use the title");
  });

  it("CY18 and nothing else does: a real name with a dash, a time after a name that is not the place, or no programme", () => {
    assert.equal(titleOf(listing("Jazz Night - 7 p.m.", "The Rex", "Tourism")), "Jazz Night - 7 p.m.");
    assert.equal(titleOf(listing("Pasta Making Classes: Taste of Italy - 8 Session Series", "Joseph D. Carrier Art Gallery", "Tourism")), "Pasta Making Classes: Taste of Italy - 8 Session Series");
    assert.equal(titleOf(listing("Toronto Postcard Club - 45th Annual Sale", "Japanese Canadian Cultural Centre", "Tourism")), "Toronto Postcard Club - 45th Annual Sale");
    assert.equal(titleOf(listing("Rosalie Favell | Belonging (1982 - 2024)", "Onsite Gallery", "Tourism")), "Rosalie Favell | Belonging (1982 - 2024)");
    assert.equal(titleOf(listing("Falstaff Park - 11", "Falstaff Park")), "Falstaff Park - 11", "a bare number is not a time");
    assert.equal(titleOf(listing("Falstaff Park - 11 a.m. to 1 p.m.", "Falstaff Park", null)), "Falstaff Park - 11 a.m. to 1 p.m.", "no programme to name it by");
    assert.equal(titleOf(listing("Harvest Fair", "Falstaff Park")), "Harvest Fair");
  });

  it("CY19 every date of one event has the same event key, and two events do not", () => {
    const a = { ...byName("Downsview Park Merchants Market") };
    const one = cityExternalId(a);
    const two = cityExternalId({ ...a, startsAt: "2026-11-08T15:00:00.000Z" });
    assert.notEqual(one, two);
    assert.equal(cityEventKey(one), cityEventKey(two));
    assert.equal(cityEventKey(one), a.eventKey);
    assert.notEqual(cityEventKey(cityExternalId({ ...a, eventKey: "other" })), cityEventKey(one));
  });
});
