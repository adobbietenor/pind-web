// M2.3b — the liveness check's pure half: what a series' counters mean, how a page is
// reduced to the part that might mention it, and how an answer is read.
//
// The case that matters most is the one Alex named: **no evidence is not evidence.**
// Four of the twenty-eight real pages say "every Tuesday, 6:30pm" and name no dates at
// all, so a design where vagueness accumulates into doubt would have flagged four live
// run clubs in its first fortnight.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DOUBT_AT,
  GIVE_UP_AT,
  excerpt,
  needsAlex,
  pageText,
  readAnswer,
  runningOut,
  RUNNING_OUT_DAYS,
  saysWhat,
  stateOf,
  type SeriesRow,
} from "../../src/community/series.ts";

const series = (over: Partial<SeriesRow> = {}): SeriesRow => ({
  id: "s1",
  label: "Frontrunners Toronto — Tuesday run",
  url: "https://www.the519.org/programs",
  last_checked_at: null,
  last_confirmed_at: null,
  confirmed_through: null,
  cadence_seen: null,
  strikes: 0,
  unreadable_strikes: 0,
  last_status: null,
  last_note: null,
  settled_at: null,
  settled_by: null,
  settled_note: null,
  ...over,
});

describe("what a series' counters mean", () => {
  it("starts unverified, with nothing claimed either way", () => {
    assert.equal(stateOf(series()), "unverified");
    assert.match(saysWhat(series()), /Not read yet/);
    assert.equal(needsAlex(series()), false);
  });

  it("is confirmed by a read that found it, with or without dates", () => {
    const withDates = series({ last_confirmed_at: "2026-09-20T13:00:00Z", confirmed_through: "2026-10-18" });
    assert.equal(stateOf(withDates), "confirmed");
    assert.match(saysWhat(withDates), /names dates up to 2026-10-18/);

    // Running Rats and all three Frontrunners runs: the page says it happens and never
    // says when. That is a confirmation, and the wording says so rather than hedging.
    const noDates = series({ last_confirmed_at: "2026-09-20T13:00:00Z" });
    assert.equal(stateOf(noDates), "confirmed");
    assert.match(saysWhat(noDates), /without naming dates/);
    assert.equal(needsAlex(noDates), false);
  });

  it("needs two consecutive absences before it is doubtful", () => {
    assert.equal(stateOf(series({ strikes: 1, last_confirmed_at: "2026-09-13T13:00:00Z" })), "confirmed");
    assert.equal(stateOf(series({ strikes: DOUBT_AT })), "doubtful");
    assert.equal(needsAlex(series({ strikes: DOUBT_AT })), true);
  });

  it("**never turns a page it cannot read into a gathering that has stopped**", () => {
    // The Kensington Market page timed out on the first real pass. However many times
    // that happens, it is not evidence about the gathering.
    for (const n of [1, 3, 10, 50]) {
      const s = series({ unreadable_strikes: n });
      assert.notEqual(stateOf(s), "doubtful", `${n} unreadable reads became doubt`);
      assert.equal(needsAlex(s), false, `${n} unreadable reads asked Alex to decide something`);
    }
    assert.equal(stateOf(series({ unreadable_strikes: GIVE_UP_AT })), "unverifiable");
  });

  it("says those two things in visibly different sentences", () => {
    const cannot = saysWhat(series({ unreadable_strikes: GIVE_UP_AT }));
    const stopped = saysWhat(series({ strikes: DOUBT_AT }));
    assert.match(cannot, /cannot tell/);
    assert.match(cannot, /not the same as the gathering having stopped/);
    assert.match(stopped, /did not mention this gathering/);
    assert.notEqual(cannot, stopped);
  });

  it("treats a page that is gone as doubt on the first read, because that is unambiguous", () => {
    // admin_record_series_check writes strikes = 2 for 'gone' rather than incrementing.
    const gone = series({ strikes: 2, last_status: "gone" });
    assert.equal(stateOf(gone), "doubtful");
    assert.match(saysWhat(gone), /page is gone/);
  });

  it("clears when Alex says he looked, and speaks up again if the page changes after that", () => {
    const settled = series({ settled_at: "2026-09-20T14:00:00Z", settled_by: "alex", settled_note: "asked the organiser, still on", last_confirmed_at: "2026-09-20T14:00:00Z" });
    assert.equal(stateOf(settled), "settled");
    assert.equal(needsAlex(settled), false);
    assert.match(saysWhat(settled), /asked the organiser/);

    // A flag that cannot be cleared becomes a flag nobody reads — but a settling must
    // not silence the next real change either.
    const changedSince = { ...settled, strikes: DOUBT_AT };
    assert.equal(stateOf(changedSince), "doubtful");
    assert.equal(needsAlex(changedSince), true);
  });
});

describe("reading the answer", () => {
  const today = "2026-09-20";

  it("takes yes with a future horizon", () => {
    const a = readAnswer({ still_on: "yes", cadence: "every Tuesday 6:30pm", furthest_date: "2026-11-03", note: "Listed as ongoing." }, today);
    assert.deepEqual(a, {
      outcome: "confirmed",
      confirmedThrough: "2026-11-03",
      cadence: "every Tuesday 6:30pm",
      note: "Listed as ongoing.",
    });
  });

  it("**reads unclear as no evidence, never as absence**", () => {
    const a = readAnswer({ still_on: "unclear", cadence: null, furthest_date: null, note: "Page is mostly navigation." }, today);
    assert.equal(a?.outcome, "unreadable");
  });

  it("only takes absence when the model actually said no", () => {
    assert.equal(readAnswer({ still_on: "no", cadence: null, furthest_date: null, note: "Says the club has wound up." }, today)?.outcome, "absent");
  });

  it("drops a horizon that has already gone by, rather than storing a stale one", () => {
    const a = readAnswer({ still_on: "yes", cadence: null, furthest_date: "2026-08-01", note: "Old listing." }, today);
    assert.equal(a?.outcome, "confirmed");
    assert.equal(a?.confirmedThrough, null);
  });

  it("refuses anything malformed rather than guessing", () => {
    for (const bad of [null, {}, "yes", { still_on: "probably" }, { still_on: true }]) {
      assert.equal(readAnswer(bad, today), null, `${JSON.stringify(bad)} was accepted`);
    }
  });
});

describe("reducing a page to the part that might mention the series", () => {
  it("strips scripts, styles and tags and keeps the words", () => {
    const html = `<head><style>.a{color:red}</style></head><body><script>var x=1</script>
      <div>Pub Chess Liberty</div><p>Every Wednesday, 7&nbsp;pm &amp; free</p><!-- hidden --></body>`;
    const text = pageText(html);
    assert.doesNotMatch(text, /color:red|var x/);
    assert.match(text, /Pub Chess Liberty/);
    assert.match(text, /Every Wednesday, 7 pm & free/);
  });

  it("centres the excerpt on the series, because seven of them share one page", () => {
    // The real Snakes & Lattes page is 582 KB and carries seven series. Truncating from
    // the top would send the model a page of navigation and no game night.
    const noise = "navigation ".repeat(4000);
    const text = `${noise}Blood on the Clocktower runs every Thursday at 7pm.${noise}`;
    const out = excerpt(text, "Blood on the Clocktower — College", 2000);
    assert.ok(out.length <= 2100, `excerpt was ${out.length}`);
    assert.match(out, /Blood on the Clocktower runs every Thursday/);
  });

  it("falls back to the top of the page when the series is not mentioned at all", () => {
    const text = `${"x".repeat(50)}nothing about it here${"y".repeat(5000)}`;
    const out = excerpt(text, "Some Other Club", 500);
    assert.ok(out.startsWith("x"), "an unmentioned series did not fall back to the start");
    assert.ok(out.length <= 600);
  });

  it("leaves a short page alone", () => {
    assert.equal(excerpt("short page", "anything", 2000), "short page");
  });
});

describe("running out of dates", () => {
  it("counts a series with less than three weeks left as running out", () => {
    assert.equal(RUNNING_OUT_DAYS, 21);
    assert.equal(runningOut("2026-10-25", "2026-09-20"), false);
    assert.equal(runningOut("2026-10-01", "2026-09-20"), true);
    // A cap without a top-up is a decay mechanism, so no dates at all is the loudest
    // version of the same thing rather than a quiet one.
    assert.equal(runningOut(null, "2026-09-20"), true);
  });
});
