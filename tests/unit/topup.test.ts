// Topping up a confirmed series (M4.4): the pattern is read off the series' own dates,
// never guessed, and only a confirmed series with under three weeks left gets more.
// Run with `npm run test:unit`.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inferCadence, nextDates, planTopUp, TOPUP_BELOW_DAYS } from "../../src/community/topup.ts";
import type { SeriesRow } from "../../src/community/series.ts";

const TZ = "America/Toronto";

describe("the pattern of a series' dates", () => {
  it("TU01 weekly and fortnightly, from at least three dates", () => {
    assert.deepEqual(inferCadence(["2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27"]), { kind: "weekly" });
    assert.deepEqual(inferCadence(["2026-10-06", "2026-10-20", "2026-11-03"]), { kind: "fortnightly" });
    assert.equal(inferCadence(["2026-10-06", "2026-10-13"]), null, "two dates were read as a pattern");
  });

  it("TU02 monthly on the nth weekday, and on the last one", () => {
    // First Tuesdays.
    assert.deepEqual(inferCadence(["2026-09-01", "2026-10-06", "2026-11-03"]), { kind: "monthly", dow: 2, nth: 1 });
    // Last Sundays: 27 Sep, 25 Oct, 29 Nov.
    assert.deepEqual(inferCadence(["2026-09-27", "2026-10-25", "2026-11-29"]), { kind: "monthly", dow: 0, nth: "last" });
  });

  it("TU03 dates that fit no one pattern are not a pattern", () => {
    assert.equal(inferCadence(["2026-10-06", "2026-10-13", "2026-10-22"]), null);
    assert.equal(inferCadence(["2026-09-01", "2026-10-13", "2026-11-03"]), null, "first, second and first Tuesdays");
    assert.equal(inferCadence(["2026-09-01", "2026-11-03", "2026-12-01"]), null, "a skipped month");
  });

  it("TU04 the next dates follow the pattern across month ends", () => {
    assert.deepEqual(nextDates({ kind: "weekly" }, "2026-10-27", "2026-11-17"), ["2026-11-03", "2026-11-10", "2026-11-17"]);
    assert.deepEqual(nextDates({ kind: "monthly", dow: 0, nth: "last" }, "2026-10-25", "2027-01-31"), [
      "2026-11-29",
      "2026-12-27",
      "2027-01-31",
    ]);
    // A fifth Thursday does not exist in every month: the fourth is taken, as the repeat form does.
    assert.deepEqual(nextDates({ kind: "monthly", dow: 4, nth: 5 }, "2026-10-29", "2026-12-31"), ["2026-11-26", "2026-12-31"]);
  });
});

describe("which series are topped up", () => {
  const NOW = "2026-10-29T16:00:00.000Z"; // Thursday, noon in Toronto
  const series = (over: Partial<SeriesRow> = {}): SeriesRow => ({
    id: "s1",
    label: "Tuesday run",
    url: "https://example.org",
    last_checked_at: "2026-10-28T13:00:00Z",
    last_confirmed_at: "2026-10-28T13:00:00Z",
    confirmed_through: null,
    cadence_seen: null,
    strikes: 0,
    unreadable_strikes: 0,
    last_status: "200",
    last_note: null,
    settled_at: null,
    settled_by: null,
    settled_note: null,
    ...over,
  });
  // Tuesdays at 19:15 Toronto (23:15 UTC in October, 00:15 after the clocks go back on
  // 1 November), ending 10 Nov.
  const tuesdays = ["2026-10-20T23:15:00Z", "2026-10-27T23:15:00Z", "2026-11-04T00:15:00Z", "2026-11-11T00:15:00Z"];
  const plan = (s: SeriesRow, starts = tuesdays) => planTopUp({ series: [{ series: s, starts }], now: NOW, tz: TZ, weeksAhead: 8 })[0]!;

  it("TU05 a confirmed series with under three weeks left gets dates to eight weeks out, at its own local time", () => {
    assert.equal(TOPUP_BELOW_DAYS, 21);
    const d = plan(series());
    assert.equal(d.outcome, "add");
    if (d.outcome !== "add") return;
    assert.equal(d.time, "19:15", "the local time drifted across the clock change");
    assert.equal(d.dates[0], "2026-11-17");
    assert.equal(d.dates.at(-1), "2026-12-22", "not up to eight weeks from today");
  });

  it("TU06 three weeks or more left is enough", () => {
    const far = [...tuesdays, "2026-11-18T00:15:00Z", "2026-11-25T00:15:00Z"];
    assert.equal(plan(series(), far).outcome, "enough");
  });

  it("TU07 only a series the check calls confirmed — never unverified, doubtful or unreadable", () => {
    assert.equal(plan(series({ last_confirmed_at: null })).outcome, "not_confirmed");
    assert.equal(plan(series({ strikes: 2 })).outcome, "not_confirmed");
    assert.equal(plan(series({ unreadable_strikes: 3 })).outcome, "not_confirmed");
  });

  it("TU08 dates at different times, or in no pattern, are named and not guessed", () => {
    const times = ["2026-10-20T23:15:00Z", "2026-10-27T22:15:00Z", "2026-11-03T23:15:00Z"];
    const d = plan(series(), times);
    assert.equal(d.outcome, "unclear");
    const odd = ["2026-10-06T23:15:00Z", "2026-10-13T23:15:00Z", "2026-10-22T23:15:00Z"];
    assert.equal(plan(series(), odd).outcome, "unclear");
  });
});
