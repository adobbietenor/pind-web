// Auto-publishing v1 — the fill rules and the weekly adjust (Phase 2 M2.2,
// spec.md §8). Pure arithmetic, so no database and no network: the planner is
// handed a queue and a clock and asked what it would do.
// Run with `npm run test:unit`.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addWeeks,
  adjustTarget,
  planPublishing,
  weekStartOf,
  PIN_RETENTION_DAYS,
  type Candidate,
  type OutcomeRow,
  type PublishSettings,
  type WeekState,
} from "../../src/publish/plan.ts";

const TZ = "America/Toronto";

// The spec §8 starting values, so a test that fails says the rule changed rather
// than that a fixture drifted.
const SETTINGS: PublishSettings = {
  targetWeekly: 5,
  min: 3,
  max: 20,
  leadDaysMin: 4,
  leadDaysMax: 21,
  maxPerVenuePerWeek: 2,
  maxCategoryShare: 0.4,
  minPerCategory: 3,
  communitySlotsWeekly: 1,
  scoreFloor: 70,
  growReach: 0.6,
  growMedianPins: 8,
  shrinkReach: 0.3,
  stepUp: 2,
  stepDown: 1,
  adaptive: false,
  adjustWindowDays: 14,
  adjustMinLeadDays: 7,
  adjustMinGatherings: 3,
};

// A Monday, 09:00 Toronto time. The week it starts is 2026-10-12.
const NOW = "2026-10-12T13:00:00.000Z";
const WEEK0 = "2026-10-12";
const WEEK1 = "2026-10-19";
const WEEK2 = "2026-10-26";

let seq = 0;
function draft(over: Partial<Candidate> = {}): Candidate {
  seq += 1;
  return {
    id: `g${seq}`,
    name: `Gathering ${seq}`,
    startsAt: `${WEEK1}T23:00:00.000Z`,
    venueId: "v1",
    venueName: "Scotiabank Arena",
    aiScore: 80,
    adjustment: 0,
    finalScore: 80,
    distanceKm: 1.2,
    mark: null,
    hasSlug: false,
    source: "ticketmaster",
    // Most cases are about the target, the floor or the venue cap; giving each draft
    // its own category keeps the share rule out of their way. The cases that mean to
    // exercise it set it deliberately.
    category: `cat${seq}`,
    ...over,
  };
}

function weeks(state: Partial<Record<string, Partial<WeekState>>> = {}): WeekState[] {
  return [WEEK0, WEEK1, WEEK2].map((weekStart) => ({
    weekStart,
    publishedLive: 0,
    perVenue: {},
    perCategory: {},
    ...(state[weekStart] ?? {}),
  }));
}

const plan = (candidates: Candidate[], over: Partial<PublishSettings> = {}, state = weeks()) =>
  planPublishing({ now: NOW, timeZone: TZ, settings: { ...SETTINGS, ...over }, weeks: state, candidates });

const reasonFor = (p: ReturnType<typeof plan>, id: string) => p.decisions.find((d) => d.gatheringId === id)!;

// ---------------------------------------------------------------------------

describe("weeks are the city's weeks", () => {
  it("puts a late Sunday show in the week that is ending, not the next one in UTC", () => {
    // 22:00 Sunday 18 October in Toronto is 02:00 Monday 19 October UTC.
    assert.equal(weekStartOf("2026-10-19T02:00:00.000Z", TZ), WEEK0);
    assert.equal(weekStartOf("2026-10-19T05:00:00.000Z", TZ), WEEK1);
  });

  it("starts weeks on Monday", () => {
    assert.equal(weekStartOf("2026-10-12T13:00:00.000Z", TZ), WEEK0);
    assert.equal(weekStartOf("2026-10-18T13:00:00.000Z", TZ), WEEK0);
    assert.equal(addWeeks(WEEK0, 2), WEEK2);
  });
});

describe("the lead window", () => {
  it("leaves out anything nearer than the minimum or further than the maximum", () => {
    const soon = draft({ startsAt: "2026-10-14T23:00:00.000Z" }); // 2 days out
    const far = draft({ startsAt: "2026-11-20T23:00:00.000Z" }); // past the window
    const fine = draft();
    const p = plan([soon, far, fine]);
    assert.deepEqual(p.picks, [fine.id]);
    // Out of the window is not a candidate, so it is not logged at all: the log is
    // the three weeks in play, not the whole 8-week import queue.
    assert.equal(p.decisions.length, 1);
  });
});

describe("the target", () => {
  it("fills a week to the target and no further", () => {
    const pool = Array.from({ length: 9 }, (_, i) => draft({ venueId: `v${i}`, finalScore: 90 - i }));
    const p = plan(pool);
    assert.equal(p.picks.length, 5);
    assert.deepEqual(
      p.picks,
      pool.slice(0, 5).map((c) => c.id),
    );
    assert.match(reasonFor(p, pool[5]!.id).reason, /already full at 5/);
  });

  it("counts what is already published that week", () => {
    const pool = Array.from({ length: 4 }, (_, i) => draft({ venueId: `v${i}` }));
    const p = plan(pool, {}, weeks({ [WEEK1]: { publishedLive: 3, perVenue: { other: 3 } } }));
    assert.equal(p.picks.length, 2);
    assert.equal(reasonFor(p, pool[0]!.id).slot, 4);
    assert.equal(reasonFor(p, pool[1]!.id).slot, 5);
  });

  it("publishes nothing into a week that is already at or over the target", () => {
    const p = plan([draft()], {}, weeks({ [WEEK1]: { publishedLive: 6, perVenue: { other: 6 } } }));
    assert.deepEqual(p.picks, []);
    assert.match(p.weeks.find((w) => w.weekStart === WEEK1)!.note, /already at 6 of 5/);
  });

  it("says so when the queue is short rather than pretending the week is full", () => {
    const p = plan([draft()]);
    const week = p.weeks.find((w) => w.weekStart === WEEK1)!;
    assert.equal(week.published, 1);
    assert.equal(week.shortBy, 4);
    assert.match(week.note, /ran out of eligible drafts. Short by 4/);
  });
});

describe("ranking", () => {
  it("takes the highest final score, and the sooner start when scores tie", () => {
    const low = draft({ finalScore: 71, name: "Low" });
    const highLate = draft({ finalScore: 88, startsAt: `${WEEK1}T23:00:00.000Z`, name: "High, later" });
    const highEarly = draft({ finalScore: 88, startsAt: `${WEEK1}T18:00:00.000Z`, name: "High, sooner" });
    const p = plan([low, highLate, highEarly], { targetWeekly: 2 }, weeks());
    assert.deepEqual(p.picks, [highEarly.id, highLate.id]);
  });

  it("ranks on the final score, so distance can cost a draft its slot", () => {
    const suburban = draft({ aiScore: 88, adjustment: 15, finalScore: 73, distanceKm: 27 });
    const downtown = draft({ aiScore: 80, adjustment: 0, finalScore: 80, venueId: "v2" });
    const p = plan([suburban, downtown], { targetWeekly: 1 });
    assert.deepEqual(p.picks, [downtown.id]);
    assert.match(reasonFor(p, downtown.id).reason, /score 80/);
  });

  it("names what a published draft beat, so the choice reads back", () => {
    const winner = draft({ finalScore: 90, name: "Leafs vs Bruins" });
    const runnerUp = draft({ finalScore: 84, name: "Raptors vs Heat", venueId: "v2" });
    const p = plan([winner, runnerUp], { targetWeekly: 1 });
    assert.match(
      reasonFor(p, winner.id).reason,
      /filled slot 1 of 1 for the week of 19 Oct — ranked 1st of 2 with score 90 \(1.2 km\); next down was Raptors vs Heat \(84\)/,
    );
  });
});

describe("the score floor", () => {
  it("never auto-publishes below it", () => {
    const weak = draft({ finalScore: 69 });
    const p = plan([weak]);
    assert.deepEqual(p.picks, []);
    assert.equal(reasonFor(p, weak.id).reasonCode, "below_floor");
    assert.match(reasonFor(p, weak.id).reason, /below the floor of 70/);
  });

  it("does not auto-publish an unscored draft", () => {
    const unscored = draft({ aiScore: null, finalScore: null });
    const p = plan([unscored]);
    assert.deepEqual(p.picks, []);
    assert.equal(reasonFor(p, unscored.id).reasonCode, "unscored");
  });
});

describe("Alex's marks", () => {
  it("publishes a marked draft first, whatever it scores", () => {
    const marked = draft({ finalScore: 20, mark: "publish", name: "The seeded one" });
    const best = draft({ finalScore: 95, venueId: "v2" });
    const p = plan([marked, best], { targetWeekly: 2 });
    assert.deepEqual(p.picks, [marked.id, best.id]);
    const d = reasonFor(p, marked.id);
    assert.equal(d.slotKind, "marked");
    assert.match(d.reason, /you marked it "publish", so it went first/);
  });

  it("keeps a marked draft inside the target and the venue cap", () => {
    const marked = Array.from({ length: 3 }, () => draft({ mark: "publish", finalScore: 10 }));
    const p = plan(marked, { targetWeekly: 5 });
    // Same venue, cap of two: the third is held back even though it is marked.
    assert.equal(p.picks.length, 2);
    assert.equal(reasonFor(p, marked[2]!.id).reasonCode, "venue_cap");
  });

  it("never publishes a draft marked never, and says that is why", () => {
    const banned = draft({ mark: "never", finalScore: 99 });
    const p = plan([banned]);
    assert.deepEqual(p.picks, []);
    assert.equal(reasonFor(p, banned.id).reasonCode, "marked_never");
    assert.match(reasonFor(p, banned.id).reason, /you marked it "never"/);
  });

  it("reports the mark rather than the slug when a draft is both marked never and previously published", () => {
    const both = draft({ mark: "never", hasSlug: true });
    assert.equal(reasonFor(plan([both]), both.id).reasonCode, "marked_never");
  });
});

describe("a gathering that has been public before", () => {
  // Alex's unpublish click means "not this one", and a rule that could silently undo
  // it is not a control (Alex, M2.2). A slug is minted at publish and can never be
  // removed, so carrying one is the database's own record of having been public.
  it("is never picked up again by a run", () => {
    const wasPublished = draft({ hasSlug: true, finalScore: 99 });
    const p = plan([wasPublished]);
    assert.deepEqual(p.picks, []);
    assert.equal(reasonFor(p, wasPublished.id).reasonCode, "previously_published");
  });

  it("says so in the log instead of quietly vanishing from it", () => {
    const wasPublished = draft({ hasSlug: true });
    assert.match(reasonFor(plan([wasPublished]), wasPublished.id).reason, /skipped, previously published/);
  });
});

describe("the per-venue cap", () => {
  it("stops a homestand filling the week", () => {
    const homestand = Array.from({ length: 4 }, (_, i) => draft({ finalScore: 95 - i, venueId: "rogers" }));
    const other = draft({ finalScore: 71, venueId: "v9" });
    const p = plan([...homestand, other]);
    assert.deepEqual(p.picks, [homestand[0]!.id, homestand[1]!.id, other.id]);
    assert.equal(reasonFor(p, homestand[2]!.id).reasonCode, "venue_cap");
    assert.match(reasonFor(p, homestand[2]!.id).reason, /already has 2 that week, which is the cap/);
  });

  it("counts gatherings already published at that venue this week", () => {
    const one = draft({ venueId: "rogers" });
    const p = plan([one], {}, weeks({ [WEEK1]: { publishedLive: 2, perVenue: { rogers: 2 } } }));
    assert.deepEqual(p.picks, []);
    assert.equal(reasonFor(p, one.id).reasonCode, "venue_cap");
  });

  it("counts by week, so the same venue can take two more the following week", () => {
    const thisWeek = Array.from({ length: 2 }, () => draft({ venueId: "rogers" }));
    const nextWeek = Array.from({ length: 2 }, () => draft({ venueId: "rogers", startsAt: `${WEEK2}T23:00:00.000Z` }));
    const p = plan([...thisWeek, ...nextWeek]);
    assert.equal(p.picks.length, 4);
  });
});

describe("the category cap", () => {
  // Alex, M2.2: lowering the score floor is the only lever that widens the list, and
  // on its own it turns a list meant to say "going out in Toronto" into a concert
  // listing. "28 a week with a real mix beats 53 a week of concerts."
  const many = (category: string, n: number, from = 95) =>
    Array.from({ length: n }, (_, i) => draft({ category, venueId: `${category}-v${i}`, finalScore: from - i }));

  it("lets one category through until it has its allowance, then holds it to its share", () => {
    const concerts = many("concerts", 20);
    const p = plan(concerts, { targetWeekly: 50 });
    // Nothing else is published, so the share can only ever be met by the allowance:
    // three, and then no more, because every further one would be 100% of the week.
    assert.equal(p.picks.length, 3);
    assert.equal(reasonFor(p, concerts[3]!.id).reasonCode, "category_cap");
    assert.match(reasonFor(p, concerts[3]!.id).reason, /concerts already has 3 of the 3 published that week, which is its share \(40%\)/);
  });

  it("lets a category grow as the rest of the week grows around it", () => {
    // Three kinds, which is the real shape of the queue. The share lets concerts rise
    // with the total instead of stopping dead at the allowance — and holds them to
    // roughly their share once it does.
    const p = plan([...many("concerts", 12), ...many("clubs", 8, 94), ...many("sports", 8, 93)], { targetWeekly: 50 });
    const published = p.decisions.filter((d) => d.outcome === "published");
    const concerts = published.filter((d) => d.category === "concerts").length;
    assert.ok(concerts > 3, `the share never let concerts past the allowance (${concerts})`);
    assert.ok(concerts / published.length <= 0.45, `concerts took ${concerts} of ${published.length}`);
    assert.ok(published.length >= 15, `only ${published.length} published from a queue of 28`);
  });

  // The arithmetic worth knowing before choosing a share: with a cap of s, a week can
  // only reach (everything that is not the dominant category) / (1 - s). Two
  // categories at 40% each cannot fill a week between them, because 80% is not 100%.
  it("cannot fill a week from two categories alone, which is the cap working", () => {
    const p = plan([...many("concerts", 10), ...many("sports", 10, 94)], { targetWeekly: 50 });
    const published = p.decisions.filter((d) => d.outcome === "published").length;
    assert.ok(published < 10, `two categories filled ${published} slots under a 40% share`);
  });

  it("is a share of what is published, not of the target, so it still binds on a short queue", () => {
    // Eight drafts against a target of 50: a cap worked out from the target (40% of
    // 50 = 20) would never bind here, which is exactly when crowding happens.
    const p = plan([...many("concerts", 6), ...many("sports", 2, 80)], { targetWeekly: 50 });
    const published = p.decisions.filter((d) => d.outcome === "published");
    assert.ok(published.length < 8, "every draft published, so the cap never bound");
    assert.ok(published.some((d) => d.reasonCode === "published" && d.category === "sports"));
  });

  it("counts what is already published that week, so a week filled by hand is not doubled", () => {
    const p = plan(many("concerts", 5), { targetWeekly: 50 }, weeks({ [WEEK1]: { publishedLive: 6, perVenue: {}, perCategory: { concerts: 6 } } }));
    assert.deepEqual(p.picks, [], "the run added concerts to a week already full of them");
  });

  it("does not stop a category nobody else is competing with", () => {
    const p = plan(many("sports", 3), { targetWeekly: 50 });
    assert.equal(p.picks.length, 3);
  });
});

describe("the community slot", () => {
  // Nothing sources community gatherings until M4.4, so this must reserve nothing
  // today: holding an empty slot would publish four where the target says five.
  it("holds nothing when no community gathering is waiting", () => {
    const pool = Array.from({ length: 5 }, (_, i) => draft({ venueId: `v${i}` }));
    assert.equal(plan(pool).picks.length, 5);
  });

  it("keeps the last slot for a community gathering when one is waiting", () => {
    const ticketed = Array.from({ length: 5 }, (_, i) => draft({ venueId: `v${i}`, finalScore: 95 - i }));
    const community = draft({ source: "community", finalScore: 72, venueId: "park" });
    const p = plan([...ticketed, community]);
    assert.equal(p.picks.length, 5);
    assert.ok(p.picks.includes(community.id));
    assert.equal(reasonFor(p, ticketed[4]!.id).reasonCode, "community_slot_held");
    assert.equal(reasonFor(p, community.id).slotKind, "community");
  });
});

describe("the weeks it looks at", () => {
  it("fills the current week and the two after it, nearest first", () => {
    // Saturday of this week — the first day of WEEK0 that clears the 4-day minimum.
    const here = draft({ startsAt: "2026-10-17T23:00:00.000Z" });
    const next = draft({ startsAt: `${WEEK1}T23:00:00.000Z`, venueId: "v2" });
    const after = draft({ startsAt: `${WEEK2}T23:00:00.000Z`, venueId: "v3" });
    const p = plan([after, next, here]);
    assert.deepEqual(p.picks, [here.id, next.id, after.id]);
    assert.deepEqual(
      p.weeks.map((w) => w.weekStart),
      [WEEK0, WEEK1, WEEK2],
    );
  });
});

// ---------------------------------------------------------------------------
// The weekly adjust
// ---------------------------------------------------------------------------

let outSeq = 0;
function ended(over: Partial<OutcomeRow> = {}): OutcomeRow {
  outSeq += 1;
  return {
    id: `e${outSeq}`,
    name: `Ended ${outSeq}`,
    starts_at: "2026-10-05T23:00:00.000Z",
    ended_at: "2026-10-06T02:00:00.000Z",
    published_at: "2026-09-20T12:00:00.000Z", // 15 days of lead
    pinned: 10,
    open_to_meeting: 6,
    reached: true,
    promoted: false,
    ...over,
  };
}

describe("the weekly adjust", () => {
  it("holds when fewer than three gatherings qualify", () => {
    const d = adjustTarget(SETTINGS, [ended(), ended()]);
    assert.equal(d.decision, "hold");
    assert.equal(d.toTarget, 5);
    assert.match(d.reason, /only 2 gatherings .* qualified \(3 needed\)/);
  });

  it("does not count a gathering published too late to have gathered anyone", () => {
    const late = ended({ published_at: "2026-10-03T12:00:00.000Z" }); // 2 days of lead
    const d = adjustTarget(SETTINGS, [ended(), ended(), late]);
    assert.equal(d.all.qualifying, 2);
    assert.equal(d.decision, "hold");
  });

  it("grows by the step when both rules clear", () => {
    const rows = [ended(), ended(), ended(), ended({ reached: false, pinned: 8 })];
    const d = adjustTarget(SETTINGS, rows);
    assert.equal(d.decision, "grow");
    assert.equal(d.toTarget, 7);
    assert.equal(d.all.reachRate, 0.75);
    assert.match(d.reason, /both clear 0.60 and 8/);
  });

  it("holds when reach clears but the median does not", () => {
    const rows = [ended({ pinned: 4 }), ended({ pinned: 4 }), ended({ pinned: 4 })];
    const d = adjustTarget(SETTINGS, rows);
    assert.equal(d.decision, "hold");
    assert.equal(d.toTarget, 5);
    assert.match(d.reason, /neither the grow nor the shrink rule fires/);
  });

  it("shrinks by the step when reach falls under the shrink line", () => {
    const rows = [ended({ reached: true }), ...Array.from({ length: 4 }, () => ended({ reached: false }))];
    const d = adjustTarget(SETTINGS, rows);
    assert.equal(d.decision, "shrink");
    assert.equal(d.toTarget, 4);
  });

  it("never falls below the floor, which is what keeps the city's list from emptying", () => {
    const rows = Array.from({ length: 4 }, () => ended({ reached: false }));
    const d = adjustTarget({ ...SETTINGS, targetWeekly: 3 }, rows);
    assert.equal(d.decision, "shrink");
    assert.equal(d.toTarget, 3);
    assert.match(d.reason, /clamped to the floor of 3/);
  });

  it("never rises above the ceiling", () => {
    const rows = Array.from({ length: 4 }, () => ended());
    const d = adjustTarget({ ...SETTINGS, targetWeekly: 19 }, rows);
    assert.equal(d.toTarget, 20);
    assert.match(d.reason, /clamped to the ceiling of 20/);
  });

  it("works out the move but applies nothing while adaptive is off", () => {
    const rows = Array.from({ length: 4 }, () => ended());
    const off = adjustTarget(SETTINGS, rows);
    assert.equal(off.applied, false);
    assert.equal(off.toTarget, 7, "the log records what it would have done");
    assert.match(off.reason, /Not applied: adaptive is off until M4.5/);

    const on = adjustTarget({ ...SETTINGS, adaptive: true }, rows);
    assert.equal(on.applied, true);
    assert.equal(on.toTarget, 7);
    assert.doesNotMatch(on.reason, /Not applied/);
  });

  it("reports seeded and organic side by side without letting either decide", () => {
    const rows = [
      ended({ promoted: true, reached: true }),
      ended({ promoted: true, reached: true }),
      ended({ promoted: false, reached: false }),
      ended({ promoted: false, reached: false }),
    ];
    const d = adjustTarget(SETTINGS, rows);
    assert.equal(d.seeded.reachRate, 1);
    assert.equal(d.organic.reachRate, 0);
    assert.equal(d.all.reachRate, 0.5);
    assert.equal(d.decision, "hold"); // decided on all, which is neither 1 nor 0
  });

  it("keeps every row it counted, for M4.5 to check the repoint against", () => {
    const rows = [ended(), ended(), ended()];
    assert.deepEqual(adjustTarget(SETTINGS, rows).inputs, rows);
  });

  // Alex, M2.2: the dependency goes in the code, not only in a note. Reading live
  // pins is exact only while the window is shorter than pin retention; past that it
  // would return a confident answer from incomplete data.
  it("refuses to compute if the window ever reaches pin retention", () => {
    const rows = Array.from({ length: 4 }, () => ended());
    assert.throws(
      () => adjustTarget({ ...SETTINGS, adjustWindowDays: PIN_RETENTION_DAYS }, rows),
      /pins are deleted 30 days after a gathering/,
    );
    assert.doesNotThrow(() => adjustTarget({ ...SETTINGS, adjustWindowDays: PIN_RETENTION_DAYS - 1 }, rows));
  });
});
