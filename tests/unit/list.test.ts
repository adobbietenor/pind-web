// M2.3 — W1's arithmetic: the window, the tabs, the chips, the days and the links.
//
// What the database decides — which gatherings are on the public web at all — is
// proved in the policy harness (P55–P61, and P66 for the new fields), never here.
// Everything below is handed rows that are already public and decides only how a
// reader browses them.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  applyChips,
  belowTheBar,
  chipsFor,
  dayGroups,
  href,
  parseChips,
  rowsInTab,
  tabForSource,
  tabHref,
  toggle,
  windowFor,
  WINDOW_DAYS,
  type ListRow,
} from "../../src/public/list.ts";

const TZ = "America/Toronto";

// A row as public_gatherings returns it, reduced to what the arithmetic reads.
let seq = 0;
const row = (over: Partial<ListRow> & { starts_at: string }): ListRow => ({
  name: `Gathering ${++seq}`,
  source: "ticketmaster",
  category: null,
  venue_id: "v1",
  city_timezone: TZ,
  ...over,
});

// Toronto is UTC-4 in September, so 03:00 UTC is the night before, locally.
const at = (local: string) => `${local}:00:00.000Z`;

describe("the week W1 shows", () => {
  const now = new Date("2026-09-20T18:00:00Z"); // Sunday 20 September, 2pm in Toronto

  it("starts on today in the city and runs seven days", () => {
    const w = windowFor(now, TZ, null);
    assert.equal(w.today, "2026-09-20");
    assert.equal(w.start, "2026-09-20");
    assert.equal(w.end, "2026-09-27");
    assert.equal(w.asked, null);
    assert.equal(WINDOW_DAYS, 7);
  });

  it("takes a ?from= in the future and treats anything else as this week", () => {
    assert.equal(windowFor(now, TZ, "2026-09-27").start, "2026-09-27");
    // A link somebody kept: it opens on this week rather than on a week that has been.
    assert.equal(windowFor(now, TZ, "2026-09-06").start, "2026-09-20", "a past week was honoured");
    assert.equal(windowFor(now, TZ, "2026-09-20").start, "2026-09-20", "today is not a page of its own");
    for (const junk of ["", "yesterday", "2026-9-1", "2026-09-27T00:00", "../etc"]) {
      assert.equal(windowFor(now, TZ, junk).asked, null, `${junk} was taken as a date`);
    }
  });

  it("counts days across a month end without drifting", () => {
    assert.equal(addDays("2026-09-27", 7), "2026-10-04");
    assert.equal(addDays("2026-10-04", -7), "2026-09-27");
    assert.equal(addDays("2026-12-29", 7), "2027-01-05");
    // Toronto's clocks go back on 1 November 2026; a calendar date must not care.
    assert.equal(addDays("2026-10-31", 1), "2026-11-01");
    assert.equal(addDays("2026-11-01", 1), "2026-11-02");
  });
});

describe("which tab a gathering is in", () => {
  it("is its source, so nobody decides it per gathering", () => {
    assert.equal(tabForSource("ticketmaster"), "events");
    assert.equal(tabForSource("manual"), "community");
    // The AI discovery run (M4.4) is the community half's own source.
    assert.equal(tabForSource("ai"), "community");
  });

  it("splits the rows and leaves their order alone", () => {
    const rows = [
      row({ starts_at: at("2026-09-21T23"), source: "manual" }),
      row({ starts_at: at("2026-09-22T23"), source: "ticketmaster" }),
      row({ starts_at: at("2026-09-23T23"), source: "manual" }),
    ];
    assert.deepEqual(
      rowsInTab(rows, "community").map((r) => r.starts_at),
      [rows[0]!.starts_at, rows[2]!.starts_at],
    );
    assert.equal(rowsInTab(rows, "events").length, 1);
  });
});

describe("which chips are offered", () => {
  // Three gatherings, in at least two places. Both halves of that bar exist because
  // one alone was wrong: venues alone would have hidden running, which is four clubs
  // meeting constantly at two venues (Alex, after the wider community pass).
  const community = (over: Partial<ListRow>) => row({ starts_at: at("2026-09-21T23"), source: "manual", ...over });

  it("offers a chip for three gatherings in two places", () => {
    const rows = [
      community({ name: "Frontrunners Thursday", category: "running", venue_id: "v1" }),
      community({ name: "Frontrunners Saturday", category: "running", venue_id: "v1" }),
      community({ name: "Running Rats", category: "running", venue_id: "v2" }),
    ];
    assert.deepEqual(chipsFor(rows, "community").map((c) => c.value), ["running"]);
  });

  it("withholds one for three gatherings in a single place", () => {
    const rows = [
      community({ name: "Book club", category: "games", venue_id: "v1" }),
      community({ name: "Knitting", category: "games", venue_id: "v1" }),
      community({ name: "Chess", category: "games", venue_id: "v1" }),
    ];
    assert.deepEqual(chipsFor(rows, "community"), [], "a chip that shows one library or nothing");
    // The rows are still there: unfiltered is the default, and only a chip can hide
    // a row. The admin is told they are below the bar.
    assert.deepEqual(belowTheBar(rows, "community").map((c) => `${c.label} ${c.gatherings}/${c.venues}`), ["Games 3/1"]);
  });

  it("counts gatherings, not rows, so one recurring fixture cannot conjure a chip", () => {
    // A run club with fifty-nine dated rows is one thing to choose between.
    const rows = Array.from({ length: 20 }, (_, i) =>
      community({ name: "Frontrunners Thursday", category: "running", venue_id: i % 2 ? "v1" : "v2", starts_at: at("2026-09-21T23") }),
    );
    assert.deepEqual(chipsFor(rows, "community"), []);
  });

  it("counts within the tab, never across it", () => {
    const rows = [
      community({ name: "A", category: "running", venue_id: "v1" }),
      community({ name: "B", category: "running", venue_id: "v2" }),
      row({ starts_at: at("2026-09-21T23"), name: "C", category: "running", venue_id: "v3" }),
    ];
    assert.deepEqual(chipsFor(rows, "community"), [], "an Events row helped a Community chip over the bar");
  });

  it("offers a chip in whichever tab has the rows for it", () => {
    // An open mic entered by hand is Community and is music. If three of them turn up
    // in two places, a Music chip on Community is the right answer.
    const rows = [
      community({ name: "Open mic at the Cameron", category: "live_music", venue_id: "v1" }),
      community({ name: "Open mic at Free Times", category: "live_music", venue_id: "v2" }),
      community({ name: "Songwriters' circle", category: "live_music", venue_id: "v2" }),
    ];
    assert.deepEqual(chipsFor(rows, "community").map((c) => c.label), ["Music"]);
  });

  it("puts them in the shared list's order, with the shared list's labels", () => {
    const rows = [
      row({ starts_at: at("2026-09-21T23"), name: "S1", category: "sport", venue_id: "v1" }),
      row({ starts_at: at("2026-09-21T23"), name: "S2", category: "sport", venue_id: "v2" }),
      row({ starts_at: at("2026-09-21T23"), name: "S3", category: "sport", venue_id: "v3" }),
      row({ starts_at: at("2026-09-21T23"), name: "M1", category: "live_music", venue_id: "v1" }),
      row({ starts_at: at("2026-09-21T23"), name: "M2", category: "live_music", venue_id: "v2" }),
      row({ starts_at: at("2026-09-21T23"), name: "M3", category: "live_music", venue_id: "v3" }),
    ];
    // Music before Sport, because that is the order in packages/shared — not the
    // order they happen to appear in, and never by size.
    assert.deepEqual(chipsFor(rows, "events").map((c) => c.label), ["Music", "Sport"]);
  });
});

describe("what a chip does", () => {
  const rows = [
    row({ starts_at: at("2026-09-21T23"), name: "A", category: "sport" }),
    row({ starts_at: at("2026-09-22T23"), name: "B", category: "live_music" }),
    row({ starts_at: at("2026-09-23T23"), name: "C", category: null }),
    row({ starts_at: at("2026-09-24T23"), name: "D", category: "sport" }),
  ];

  it("shows the union of two chips, and nothing else", () => {
    assert.deepEqual(applyChips(rows, ["sport", "live_music"]).map((r) => r.name), ["A", "B", "D"]);
  });

  it("leaves the order of what remains exactly as it was", () => {
    // A filter that narrows, never a sort that reorders (Alex, M2.2): the dates are
    // still ascending, and nothing has moved up for being more popular.
    const filtered = applyChips(rows, ["sport"]);
    assert.deepEqual(filtered.map((r) => r.name), ["A", "D"]);
    assert.deepEqual(filtered.map((r) => r.starts_at), [rows[0]!.starts_at, rows[3]!.starts_at]);
  });

  it("shows everything, including the unclassified, when nothing is chosen", () => {
    assert.deepEqual(applyChips(rows, []).map((r) => r.name), ["A", "B", "C", "D"]);
  });

  it("drops a chip the page is not offering, so no URL can produce an empty list", () => {
    const offered = [{ value: "sport", label: "Sport", gatherings: 3, venues: 2 }];
    assert.deepEqual(parseChips("sport", offered), ["sport"]);
    assert.deepEqual(parseChips("running", offered), [], "a chip from the other tab was honoured");
    assert.deepEqual(parseChips("sport,nonsense,sport", offered), ["sport"], "junk or a repeat got through");
    assert.deepEqual(parseChips(null, offered), []);
  });

  it("does not quietly turn every chip into no chips", () => {
    // They look like the same list and are not: unfiltered also shows the rows nobody
    // has classified. Collapsing would add rows a reader had filtered out.
    const offered = [
      { value: "sport", label: "Sport", gatherings: 3, venues: 2 },
      { value: "live_music", label: "Music", gatherings: 3, venues: 2 },
    ];
    const both = parseChips("sport,live_music", offered);
    assert.deepEqual(both, ["sport", "live_music"]);
    assert.equal(applyChips(rows, both).length, 3, "the unclassified row came back");
  });
});

describe("the days", () => {
  const today = "2026-09-20";

  it("names today and tomorrow, and dates the rest", () => {
    const groups = dayGroups(
      [
        row({ starts_at: at("2026-09-20T23") }), // 7pm Sunday in Toronto
        row({ starts_at: at("2026-09-21T23") }),
        row({ starts_at: at("2026-09-23T18") }),
      ],
      TZ,
      today,
    );
    assert.deepEqual(groups.map((g) => g.label), ["Today", "Tomorrow", "Wednesday 23 September"]);
    // Today and tomorrow still say which day they are, for a tab left open an hour.
    assert.equal(groups[0]!.sub, "Sunday 20 September");
    assert.equal(groups[2]!.sub, null);
  });

  it("buckets by the venue's own day, not by UTC", () => {
    // 1am UTC on the 21st is 9pm on the 20th in Toronto, and belongs to Sunday.
    const groups = dayGroups([row({ starts_at: at("2026-09-21T01") })], TZ, today);
    assert.deepEqual(groups.map((g) => g.label), ["Today"]);
  });

  it("prints no heading for a day with nothing on", () => {
    const groups = dayGroups([row({ starts_at: at("2026-09-24T23") })], TZ, today);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.label, "Thursday 24 September");
  });

  it("keeps the rows in the order they arrived", () => {
    const rows = [
      row({ starts_at: at("2026-09-20T22"), name: "six" }),
      row({ starts_at: at("2026-09-20T23"), name: "seven" }),
    ];
    assert.deepEqual(dayGroups(rows, TZ, today)[0]!.rows.map((r) => r.name), ["six", "seven"]);
  });
});

describe("the links every control is made of", () => {
  it("writes the shortest honest URL", () => {
    assert.equal(href("/", [], null), "/");
    assert.equal(href("/community", ["running"], null), "/community?c=running");
    assert.equal(href("/", ["sport", "live_music"], "2026-09-27"), "/?c=sport,live_music&from=2026-09-27");
  });

  it("toggles a chip on and off", () => {
    assert.deepEqual(toggle([], "sport"), ["sport"]);
    assert.deepEqual(toggle(["sport"], "live_music"), ["sport", "live_music"]);
    assert.deepEqual(toggle(["sport", "live_music"], "sport"), ["live_music"]);
  });

  it("keeps the week when switching tabs and drops the chips", () => {
    // Chips are counted per tab and mean different things in each, so carrying
    // "Running" into Events would filter for something that tab does not have.
    assert.equal(tabHref("community", "2026-09-27"), "/community?from=2026-09-27");
    assert.equal(tabHref("events", null), "/");
  });
});
