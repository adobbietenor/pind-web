// Auto-publishing v1 — the rules, as arithmetic over a queue (spec.md §8,
// docs/build-plan.md §6). Pure: no database, no clock beyond what it is handed, no
// @pind/shared (these run under plain `node --test`). Everything that touches the
// world is in run.ts.
//
// Two jobs live here.
//
//   planPublishing — the nightly fill. For the city-local week containing today and
//   the two after it: if the week has fewer published gatherings than the target,
//   rank the eligible drafts and publish down the list until it is full.
//
//   adjustTarget — the weekly adjust. What the trailing fortnight says the target
//   should be. Written now, gated by `adaptive` off, switched on in M4.5.
//
// Both explain themselves in one line per decision, because a publishing choice Alex
// cannot read back is a rule he cannot tell is working (Alex, M2.2). The sentences
// are here, next to the arithmetic that produced them, and are covered by the unit
// tests — not assembled in the admin from codes.

// ---------------------------------------------------------------------------
// Settings — every one of them a column on the cities row, never a literal here
// ---------------------------------------------------------------------------

export interface PublishSettings {
  targetWeekly: number;
  min: number;
  max: number;
  leadDaysMin: number;
  leadDaysMax: number;
  maxPerVenuePerWeek: number;
  communitySlotsWeekly: number;
  scoreFloor: number;
  growReach: number;
  growMedianPins: number;
  shrinkReach: number;
  stepUp: number;
  stepDown: number;
  adaptive: boolean;
  adjustWindowDays: number;
  adjustMinLeadDays: number;
  adjustMinGatherings: number;
}

// Pins are deleted 30 days after a gathering's effective end (decisions.md Part 3).
// The weekly adjust reads live pins, which is exact only while its trailing window
// is shorter than that. If the two ever cross, the adjust would read gatherings
// whose pins had already gone, find few pins, and return a confident shrink — the
// worst kind of wrong, because it looks like evidence. So it refuses to compute
// instead (Alex, M2.2). The database says the same thing as a check constraint on
// cities.adjust_window_days; this is the half that fails loudly at the till.
export const PIN_RETENTION_DAYS = 30;

// ---------------------------------------------------------------------------
// The nightly fill
// ---------------------------------------------------------------------------

export interface Candidate {
  id: string;
  name: string;
  startsAt: string; // ISO
  venueId: string | null;
  venueName: string | null;
  aiScore: number | null;
  adjustment: number;
  finalScore: number | null; // AI score minus the distance adjustment
  distanceKm: number | null;
  mark: "publish" | "never" | null;
  // A slug is minted at publish and the schema refuses to remove one, so carrying a
  // slug is the database's own record that this gathering has been public before.
  hasSlug: boolean;
  source: string;
}

// A week of the calendar, as it stands before this run.
export interface WeekState {
  weekStart: string; // city-local Monday, YYYY-MM-DD
  publishedLive: number; // published, not withdrawn, not seed, starting that week
  perVenue: Record<string, number>; // the same, by venue
}

export type ReasonCode =
  | "published"
  | "marked_never"
  | "previously_published"
  | "no_venue"
  | "unscored"
  | "below_floor"
  | "venue_cap"
  | "community_slot_held"
  | "week_full";

export interface Decision {
  weekStart: string;
  gatheringId: string;
  gatheringName: string;
  startsAt: string;
  venueId: string | null;
  venueName: string | null;
  outcome: "published" | "skipped";
  reasonCode: ReasonCode;
  reason: string;
  slot: number | null;
  slotKind: "marked" | "target" | "community" | null;
  rank: number | null;
  candidates: number | null;
  aiScore: number | null;
  adjustment: number | null;
  finalScore: number | null;
  distanceKm: number | null;
  mark: "publish" | "never" | null;
  target: number;
  publishedBefore: number;
}

export interface WeekSummary {
  weekStart: string;
  target: number;
  publishedBefore: number;
  published: number;
  shortBy: number;
  note: string;
}

export interface PublishPlan {
  decisions: Decision[];
  weeks: WeekSummary[];
  // In the order they must be published: nearest week first, best first within it.
  picks: string[];
}

const DAY = 24 * 60 * 60 * 1000;

// Monday of the city-local week a moment falls in, as YYYY-MM-DD. Weeks are the
// unit the target is expressed in, so they have to be the city's weeks: a Sunday
// night show in Toronto belongs to the week that is ending, not the one starting in
// UTC three hours earlier.
export function weekStartOf(iso: string, timeZone: string): string {
  const parts = localParts(iso, timeZone);
  const date = Date.UTC(parts.year, parts.month - 1, parts.day);
  // getUTCDay: 0 is Sunday. Monday-based weeks, so Sunday is 6 days into its week.
  const back = (new Date(date).getUTCDay() + 6) % 7;
  return new Date(date - back * DAY).toISOString().slice(0, 10);
}

export function addWeeks(weekStart: string, n: number): string {
  return new Date(Date.parse(`${weekStart}T00:00:00Z`) + n * 7 * DAY).toISOString().slice(0, 10);
}

function localParts(iso: string, timeZone: string): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const [year, month, day] = fmt.format(new Date(iso)).split("-").map(Number);
  return { year: year!, month: month!, day: day! };
}

// "13 Oct", for the one-line reasons.
function shortDate(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00Z`);
  return `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}`;
}

function scoreText(c: Candidate): string {
  if (c.finalScore === null) return "no score yet";
  const parts = [`score ${c.finalScore}`];
  if (c.adjustment) parts.push(`AI ${c.aiScore} − ${c.adjustment}`);
  if (c.distanceKm !== null) parts.push(`${c.distanceKm.toFixed(1)} km`);
  return parts.length > 1 ? `${parts[0]} (${parts.slice(1).join(", ")})` : parts[0]!;
}

// Marked drafts first, then the best final score, then the sooner start. The last
// tiebreak is what "nearer first" means once two drafts score the same: the closer
// gathering is the one a reader can still buy a ticket for.
function rankCandidates(a: Candidate, b: Candidate): number {
  const marked = (c: Candidate) => (c.mark === "publish" ? 0 : 1);
  return (
    marked(a) - marked(b) ||
    (b.finalScore ?? -1) - (a.finalScore ?? -1) ||
    a.startsAt.localeCompare(b.startsAt) ||
    a.id.localeCompare(b.id)
  );
}

export interface PlanInput {
  now: string; // ISO
  timeZone: string;
  settings: PublishSettings;
  weeks: WeekState[]; // the weeks to fill, nearest first
  candidates: Candidate[]; // every draft; this filters to the lead window itself
}

export function planPublishing(input: PlanInput): PublishPlan {
  const { settings: s, timeZone, now } = input;
  const t = Date.parse(now);
  const from = t + s.leadDaysMin * DAY;
  const to = t + s.leadDaysMax * DAY;
  const decisions: Decision[] = [];
  const summaries: WeekSummary[] = [];
  const picks: string[] = [];

  for (const week of input.weeks) {
    const target = s.targetWeekly;
    const publishedBefore = week.publishedLive;
    const perVenue: Record<string, number> = { ...week.perVenue };
    let filled = publishedBefore;

    // Inside the lead window, starting in this week. A draft outside the window is
    // not a candidate and is not logged: that is the whole 8-week import queue, and
    // a log nobody can read is not a log.
    const pool = input.candidates
      .filter((c) => {
        const at = Date.parse(c.startsAt);
        return at >= from && at <= to && weekStartOf(c.startsAt, timeZone) === week.weekStart;
      })
      .sort(rankCandidates);

    const base = {
      weekStart: week.weekStart,
      target,
      publishedBefore,
    };
    const record = (c: Candidate, d: Partial<Decision> & { outcome: Decision["outcome"]; reasonCode: ReasonCode; reason: string }) =>
      decisions.push({
        ...base,
        gatheringId: c.id,
        gatheringName: c.name,
        startsAt: c.startsAt,
        venueId: c.venueId,
        venueName: c.venueName,
        slot: null,
        slotKind: null,
        rank: null,
        candidates: null,
        aiScore: c.aiScore,
        adjustment: c.adjustment,
        finalScore: c.finalScore,
        distanceKm: c.distanceKm,
        mark: c.mark,
        ...d,
      });

    // The hard skips, in the order Alex would give them. A draft he marked "never"
    // is reported as marked, not as previously published: his instruction is the
    // reason it was skipped, whatever else is also true of it.
    const ranked: Candidate[] = [];
    for (const c of pool) {
      if (c.mark === "never") {
        record(c, { outcome: "skipped", reasonCode: "marked_never", reason: `not published — you marked it "never"` });
      } else if (c.hasSlug) {
        record(c, {
          outcome: "skipped",
          reasonCode: "previously_published",
          reason: `skipped, previously published — it has been on the public web before, so only you can publish it again`,
        });
      } else if (!c.venueId) {
        record(c, { outcome: "skipped", reasonCode: "no_venue", reason: `not published — no venue yet` });
      } else if (c.finalScore === null && c.mark !== "publish") {
        record(c, { outcome: "skipped", reasonCode: "unscored", reason: `not published — not scored yet, so it has no final score` });
      } else if (c.finalScore !== null && c.finalScore < s.scoreFloor && c.mark !== "publish") {
        record(c, {
          outcome: "skipped",
          reasonCode: "below_floor",
          reason: `not published — ${scoreText(c)}, below the floor of ${s.scoreFloor}`,
        });
      } else {
        ranked.push(c);
      }
    }

    // A community slot is only held when there is something to hold it for: holding
    // an empty slot would publish four where the target says five. Nothing sources
    // community gatherings until M4.4, so this reserves nothing today.
    const isCommunity = (c: Candidate) => c.source === "community";
    const communityWaiting = ranked.filter(isCommunity).length;
    const reserved = Math.min(s.communitySlotsWeekly, communityWaiting);

    ranked.forEach((c, i) => {
      const rank = i + 1;
      const common = { rank, candidates: ranked.length };
      const remaining = target - filled;

      if (remaining <= 0) {
        record(c, {
          ...common,
          outcome: "skipped",
          reasonCode: "week_full",
          reason: `not published — the week of ${shortDate(week.weekStart)} was already full at ${target}; ranked ${ordinal(rank)} of ${ranked.length} with ${scoreText(c)}`,
        });
        return;
      }

      const venueSoFar = perVenue[c.venueId!] ?? 0;
      if (venueSoFar >= s.maxPerVenuePerWeek) {
        record(c, {
          ...common,
          outcome: "skipped",
          reasonCode: "venue_cap",
          reason: `not published — ${c.venueName ?? "that venue"} already has ${venueSoFar} that week, which is the cap; ranked ${ordinal(rank)} of ${ranked.length} with ${scoreText(c)}`,
        });
        return;
      }

      // The last slots belong to community gatherings while any are waiting.
      const communityStillWaiting = ranked.slice(i).filter(isCommunity).length;
      if (!isCommunity(c) && remaining <= Math.min(reserved, communityStillWaiting)) {
        record(c, {
          ...common,
          outcome: "skipped",
          reasonCode: "community_slot_held",
          reason: `not published — the last slot of the week of ${shortDate(week.weekStart)} is held for a community gathering; ranked ${ordinal(rank)} of ${ranked.length} with ${scoreText(c)}`,
        });
        return;
      }

      filled += 1;
      perVenue[c.venueId!] = venueSoFar + 1;
      picks.push(c.id);
      const next = ranked[i + 1];
      const slotKind = c.mark === "publish" ? "marked" : isCommunity(c) ? "community" : "target";
      const how =
        c.mark === "publish"
          ? `you marked it "publish", so it went first`
          : `ranked ${ordinal(rank)} of ${ranked.length} with ${scoreText(c)}`;
      const beat = next ? `; next down was ${next.name} (${next.finalScore ?? "unscored"})` : "";
      record(c, {
        ...common,
        outcome: "published",
        reasonCode: "published",
        reason: `filled slot ${filled} of ${target} for the week of ${shortDate(week.weekStart)} — ${how}${beat}`,
        slot: filled,
        slotKind,
      });
    });

    const shortBy = Math.max(0, target - filled);
    summaries.push({
      weekStart: week.weekStart,
      target,
      publishedBefore,
      published: filled - publishedBefore,
      shortBy,
      note: weekNote({ target, filled, publishedBefore, shortBy, ranked: ranked.length, pool: pool.length, week: week.weekStart }),
    });
  }

  return { decisions, weeks: summaries, picks };
}

function weekNote(x: {
  target: number;
  filled: number;
  publishedBefore: number;
  shortBy: number;
  ranked: number;
  pool: number;
  week: string;
}): string {
  const of = `week of ${shortDate(x.week)}`;
  if (x.publishedBefore >= x.target && x.filled === x.publishedBefore) {
    return `${of}: already at ${x.publishedBefore} of ${x.target} — nothing to fill.`;
  }
  if (x.shortBy === 0) {
    return `${of}: ${x.filled} of ${x.target} published (${x.publishedBefore} already there, ${x.filled - x.publishedBefore} tonight).`;
  }
  if (x.pool === 0) {
    return `${of}: ${x.filled} of ${x.target} — no drafts start that week inside the lead window.`;
  }
  if (x.ranked === 0) {
    return `${of}: ${x.filled} of ${x.target} — ${x.pool} draft${x.pool === 1 ? "" : "s"} in the window, none eligible. Short by ${x.shortBy}.`;
  }
  return `${of}: ${x.filled} of ${x.target} — the queue ran out of eligible drafts. Short by ${x.shortBy}.`;
}

function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

// ---------------------------------------------------------------------------
// The weekly adjust — written now, applied from M4.5
// ---------------------------------------------------------------------------

export interface OutcomeRow {
  id: string;
  name: string;
  starts_at: string;
  ended_at: string;
  published_at: string;
  pinned: number;
  open_to_meeting: number;
  reached: boolean; // open_to_meeting >= 5, decided in the database
  promoted: boolean; // has at least one gathering_promotions row
}

export interface Split {
  qualifying: number;
  reachRate: number | null;
  medianPins: number | null;
}

export interface TargetDecision {
  decision: "grow" | "shrink" | "hold";
  fromTarget: number;
  toTarget: number;
  applied: boolean;
  reason: string;
  all: Split;
  seeded: Split;
  organic: Split;
  inputs: OutcomeRow[];
}

function split(rows: OutcomeRow[]): Split {
  if (!rows.length) return { qualifying: 0, reachRate: null, medianPins: null };
  const reached = rows.filter((r) => r.reached).length;
  return {
    qualifying: rows.length,
    reachRate: round3(reached / rows.length),
    medianPins: median(rows.map((r) => r.pinned)),
  };
}

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

// A gathering counts only if it was published at least `adjustMinLeadDays` before it
// started: a gathering published two days out had no chance to gather anyone, and
// counting it would let a late publish look like a failed one (spec §8).
export function qualifies(r: OutcomeRow, s: PublishSettings): boolean {
  return Date.parse(r.starts_at) - Date.parse(r.published_at) >= s.adjustMinLeadDays * DAY;
}

export function adjustTarget(s: PublishSettings, rows: OutcomeRow[]): TargetDecision {
  if (s.adjustWindowDays >= PIN_RETENTION_DAYS) {
    throw new Error(
      `The weekly adjust reads live pins, and pins are deleted ${PIN_RETENTION_DAYS} days after a gathering ` +
        `(decisions Part 3). A trailing window of ${s.adjustWindowDays} days would read gatherings whose pins had ` +
        `already gone and return a confident answer from incomplete data. Shorten adjust_window_days, or repoint ` +
        `the adjust at gathering_stats (M4.5).`,
    );
  }

  const qualifying = rows.filter((r) => qualifies(r, s));
  const all = split(qualifying);
  const seeded = split(qualifying.filter((r) => r.promoted));
  const organic = split(qualifying.filter((r) => !r.promoted));
  const from = s.targetWeekly;
  const hold = (reason: string): TargetDecision => ({
    decision: "hold",
    fromTarget: from,
    toTarget: from,
    applied: false,
    reason,
    all,
    seeded,
    organic,
    inputs: qualifying,
  });

  if (all.qualifying < s.adjustMinGatherings) {
    return hold(
      `hold — only ${all.qualifying} gathering${all.qualifying === 1 ? "" : "s"} in the last ${s.adjustWindowDays} days ` +
        `qualified (${s.adjustMinGatherings} needed), so there is no evidence yet. The target stays at ${from}.`,
    );
  }

  const reach = all.reachRate!;
  const pins = all.medianPins!;
  const evidence = `reach rate ${reach.toFixed(2)} and median pins ${fmt(pins)} across ${all.qualifying} gatherings`;

  let decision: TargetDecision["decision"] = "hold";
  let wanted = from;
  let reason: string;
  if (reach >= s.growReach && pins >= s.growMedianPins) {
    decision = "grow";
    wanted = from + s.stepUp;
    reason = `grow — ${evidence} both clear ${s.growReach.toFixed(2)} and ${s.growMedianPins}`;
  } else if (reach < s.shrinkReach) {
    decision = "shrink";
    wanted = from - s.stepDown;
    reason = `shrink — ${evidence}; the reach rate is under ${s.shrinkReach.toFixed(2)}`;
  } else {
    reason = `hold — ${evidence}; neither the grow nor the shrink rule fires`;
  }

  const to = Math.max(s.min, Math.min(s.max, wanted));
  const clamped = to !== wanted ? `, clamped to the ${to === s.min ? `floor of ${s.min}` : `ceiling of ${s.max}`}` : "";
  const move = to === from ? `the target stays at ${from}` : `the target moves ${from} → ${to}`;
  const gate = s.adaptive ? "" : ` Not applied: adaptive is off until M4.5.`;

  // toTarget is always what the rule worked out, so a run with adaptive off records
  // what it would have done; `applied` is the separate question of whether the
  // cities row actually moved. M4.5 needs both to check the loop against its log.
  return {
    decision,
    fromTarget: from,
    toTarget: to,
    applied: s.adaptive && to !== from,
    reason: `${reason}${clamped}, so ${move}.${gate}`,
    all,
    seeded,
    organic,
    inputs: qualifying,
  };
}

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));
