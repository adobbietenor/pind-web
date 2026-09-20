// Auto-publishing v1 — the half that touches the world (spec.md §8, M2.2).
//
// Runs inside the nightly import (src/import/run.ts), after scoring, and from the
// admin's "Run import now" button so it can be watched on a phone. The rules it
// applies are in plan.ts and are pure; this reads the queue, calls
// public.admin_publish_gathering for each pick, and writes down why.
//
// The one invariant worth repeating: publishing is still only ever
// admin_publish_gathering. The publisher has no privilege Alex's button does not,
// mints its slugs the same way, and a gathering that never goes through that
// function has no slug and reaches no public page (M2.1, decisions Part 5).
import type { SupabaseClient } from "@supabase/supabase-js";
import { adjustedScore, distanceAdjustment, venueDistanceKm, type CityGeo } from "../import/ticketmaster.ts";
import {
  addWeeks,
  adjustTarget,
  planPublishing,
  weekStartOf,
  type Candidate,
  type Decision,
  type OutcomeRow,
  type PublishSettings,
  type TargetDecision,
  type WeekState,
} from "./plan.ts";

// Ticketmaster classifies everything as "Segment / Genre" — Music / Rock, Sports /
// Hockey, Music / Dance-Electronic, Arts & Theatre / Comedy. The cap needs a finer
// unit than the segment: capping all of Music at a share would gut the list, because
// Music is 85% of what clears the floor, while a club night and a rock show are not
// the same evening to anyone choosing one.
//
// So: a club night is its own kind, and everything else falls back to its segment.
// Private to the publisher — no reader ever sees these names.
//
// The chips a reader browses by are a different vocabulary doing a different job,
// and merging the two is not free: folding every kind of Music into one bucket takes
// the three upcoming weeks from 23/16/15 published to 6/6/6, measured on the real
// queue (Alex, after the community pass).
//
// Every chip value is named here even where it maps to itself, because the version of
// this table that listed `taking_part` after `taking_part` had already split into
// four had a hole in it: unlisted values fell through `?? stored` and silently became
// cap buckets of their own. That is the shape of the stale FOLD_THRESHOLD — a table
// naming a value nothing uses, and no complaint from anything.
//
// **The five Community chips deliberately do NOT share one bucket.** Folding them was
// measured and changes nothing today (identical weeks, identical refusals), but it
// would sit Community permanently at or above its 40% share — 21 of the 50 rows in
// the week of 21 Sep are community — so the guard would fire in normal weather, which
// is the one thing a guard must never do.
const CAP_BUCKET: Record<string, string> = {
  live_music: "concerts",
  sport: "sports",
  comedy: "arts",
  games: "games",
  cycling: "cycling",
  running: "running",
  outdoors: "outdoors",
  markets: "markets",
};

export function categoryOf(classification: string | null | undefined): string {
  const c = (classification ?? "").toLowerCase();
  if (c.startsWith("sports")) return "sports";
  if (c.includes("dance/electronic") || c.includes("dance/electronic".replace("/", " ")) || c.includes("club")) return "clubs";
  if (c.startsWith("music")) return "concerts";
  if (c.startsWith("arts") || c.startsWith("theatre")) return "arts";
  if (c.startsWith("film")) return "film";
  return "other";
}

// **The listing's own classification wins; the stored chip is used only where there
// is none.** This is the opposite of what it was, and the reversal is M2.3's doing.
//
// Until M2.3 only hand-entered gatherings had a stored category, so "stored wins" and
// "classification wins" were the same rule on different rows. M2.3 gives every
// Ticketmaster gathering a chip, and with the old precedence the cap would have read
// `live_music` for all 189 music candidates and stopped distinguishing a club night
// from a rock show — the distinction the whole cap rests on.
//
// Measured on the real queue the night it was filled in, which is why this is not an
// argument:
//
//   stored wins          tonight publishes  0   weeks end at  4 / 48 / 30
//   classification wins  tonight publishes 12   weeks end at  4 / 50 / 40
//
// A data improvement that silently switches off a rule is the FOLD_THRESHOLD bug
// again: everything looks right, and the list quietly stops growing.
export function capBucket(stored: string | null | undefined, classification: string | null | undefined): string {
  if (classification) return categoryOf(classification);
  return stored ? CAP_BUCKET[stored] ?? stored : categoryOf(classification);
}

// The city-local week containing today, plus the two after it. publish_lead_days_max
// is 21 for exactly this reason: the far end of the third week is at most 20 days
// out, so the lead window always covers every week the job fills (see the migration).
const WEEKS_AHEAD = 3;

const DAY = 24 * 60 * 60 * 1000;

export const PUBLISHER = "publisher:auto";

export interface PublishRunResult {
  published: number;
  considered: number;
  weeks: { weekStart: string; target: number; published: number; shortBy: number; note: string }[];
  adjust: TargetDecision | null;
  errors: string[];
}

// Like the importer's, but typed so a caller can name the row shape it expects:
// PostgREST types `data` as nullable on every builder, and the error check is what
// rules the null out.
async function must<T>(q: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as T;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const SETTING_COLUMNS = [
  "publish_target_weekly",
  "publish_min",
  "publish_max",
  "publish_lead_days_min",
  "publish_lead_days_max",
  "max_per_venue_per_week",
  "max_category_share",
  "min_per_category",
  "min_capacity",
  "community_slots_weekly",
  "score_floor",
  "grow_reach",
  "grow_median_pins",
  "shrink_reach",
  "step_up",
  "step_down",
  "adaptive",
  "adjust_window_days",
  "adjust_min_lead_days",
  "adjust_min_gatherings",
] as const;

export const SETTINGS_SELECT = SETTING_COLUMNS.join(", ");

// The settings form names these, so a column renamed in a migration and not in the
// form is a typecheck failure rather than a field that silently stops saving.
export type SettingColumn = (typeof SETTING_COLUMNS)[number];
export type NumericSetting = Exclude<SettingColumn, "adaptive">;

// Every number comes off the cities row; none of them has a default in code, so a
// setting Alex changes in the admin takes effect on the next run with no deploy.
export function toSettings(row: Record<string, any>): PublishSettings {
  return {
    targetWeekly: Number(row.publish_target_weekly),
    min: Number(row.publish_min),
    max: Number(row.publish_max),
    leadDaysMin: Number(row.publish_lead_days_min),
    leadDaysMax: Number(row.publish_lead_days_max),
    maxPerVenuePerWeek: Number(row.max_per_venue_per_week),
    maxCategoryShare: Number(row.max_category_share),
    minPerCategory: Number(row.min_per_category),
    minCapacity: Number(row.min_capacity),
    communitySlotsWeekly: Number(row.community_slots_weekly),
    scoreFloor: Number(row.score_floor),
    growReach: Number(row.grow_reach),
    growMedianPins: Number(row.grow_median_pins),
    shrinkReach: Number(row.shrink_reach),
    stepUp: Number(row.step_up),
    stepDown: Number(row.step_down),
    adaptive: Boolean(row.adaptive),
    adjustWindowDays: Number(row.adjust_window_days),
    adjustMinLeadDays: Number(row.adjust_min_lead_days),
    adjustMinGatherings: Number(row.adjust_min_gatherings),
  };
}

export async function loadSettings(db: SupabaseClient, city: string): Promise<PublishSettings> {
  return toSettings(await must(db.from("cities").select(SETTINGS_SELECT).eq("slug", city).single()));
}

// ---------------------------------------------------------------------------
// The nightly fill
// ---------------------------------------------------------------------------

export interface PublishContext {
  city: { slug: string; timezone: string } & CityGeo;
  runId: number | null;
  actor: string;
  now?: Date;
}

export async function runPublishing(db: SupabaseClient, ctx: PublishContext): Promise<PublishRunResult> {
  const { city } = ctx;
  const now = ctx.now ?? new Date();
  const settings = await loadSettings(db, city.slug);
  const errors: string[] = [];

  const weekStarts = Array.from({ length: WEEKS_AHEAD }, (_, i) => addWeeks(weekStartOf(now.toISOString(), city.timezone), i));
  // Read a day either side of the weeks in question: a week's boundary in the city's
  // timezone is not a boundary in UTC, and the bucketing below is what decides.
  const spanFrom = new Date(Date.parse(`${weekStarts[0]}T00:00:00Z`) - DAY).toISOString();
  const spanTo = new Date(Date.parse(`${addWeeks(weekStarts[weekStarts.length - 1]!, 1)}T00:00:00Z`) + DAY).toISOString();

  const venues = new Map<string, { id: string; name: string; city: string; latitude: number | null; longitude: number | null }>(
    (await must<any[]>(db.from("venues").select("id, name, city, latitude, longitude"))).map((v) => [v.id, v]),
  );
  const here = (venueId: string | null): boolean => (venueId ? venues.get(venueId)?.city === city.slug : false);

  // What is already on the public web in those weeks. Withdrawn is not published:
  // the gathering is off, so its slot is genuinely empty and the week gets refilled.
  const live = await must<any[]>(
    db
      .from("gatherings")
      .select("id, starts_at, venue_id, category, gathering_sources(snapshot)")
      .eq("status", "published")
      .eq("is_seed", false)
      .gte("starts_at", spanFrom)
      .lte("starts_at", spanTo),
  );

  const weeks: WeekState[] = weekStarts.map((weekStart) => ({ weekStart, publishedLive: 0, perVenue: {}, perCategory: {} }));
  const byWeek = new Map(weeks.map((w) => [w.weekStart, w]));
  for (const g of live) {
    if (!here(g.venue_id)) continue;
    const w = byWeek.get(weekStartOf(g.starts_at, city.timezone));
    if (!w) continue;
    w.publishedLive += 1;
    w.perVenue[g.venue_id] = (w.perVenue[g.venue_id] ?? 0) + 1;
    // What is already published counts against the share too, or a week filled by
    // hand with six concerts would let the run add six more.
    const cat = capBucket(g.category, (g.gathering_sources ?? []).map((x: any) => x.snapshot?.category).find(Boolean));
    w.perCategory[cat] = (w.perCategory[cat] ?? 0) + 1;
  }

  // The queue. Only drafts inside the lead window can be candidates, so that is all
  // this reads — and all that is ever logged.
  const from = new Date(now.getTime() + settings.leadDaysMin * DAY).toISOString();
  const to = new Date(now.getTime() + settings.leadDaysMax * DAY).toISOString();
  const drafts = await must<any[]>(
    db
      .from("gatherings")
      .select("id, name, starts_at, venue_id, slug, publish_mark, source, category, capacity, gathering_triage(score), gathering_sources(snapshot)")
      .eq("status", "draft")
      .eq("is_seed", false)
      .gt("starts_at", now.toISOString())
      // Inside the lead window, OR marked "publish" — a mark outranks the window
      // like every other automatic rule, and a draft that is never fetched cannot be
      // refused visibly either (Alex, M2.2 walk).
      .or(`and(starts_at.gte.${from},starts_at.lte.${to}),publish_mark.eq.publish`)
      .order("starts_at")
      .limit(1000),
  );

  const candidates: Candidate[] = drafts
    .filter((g) => here(g.venue_id) || g.venue_id === null)
    .map((g) => {
      const v = g.venue_id ? venues.get(g.venue_id) : undefined;
      const km = v ? venueDistanceKm({ lat: v.latitude, lng: v.longitude }, city) : null;
      const adjustment = distanceAdjustment(km, city);
      const ai = (Array.isArray(g.gathering_triage) ? g.gathering_triage[0] : g.gathering_triage)?.score ?? null;
      return {
        id: g.id,
        name: g.name,
        startsAt: g.starts_at,
        venueId: g.venue_id,
        venueName: v?.name ?? null,
        aiScore: ai,
        adjustment,
        finalScore: adjustedScore(ai, adjustment),
        distanceKm: km,
        mark: g.publish_mark ?? null,
        hasSlug: g.slug !== null,
        source: g.source,
        capacity: g.capacity ?? null,
        // The listing's own classification, where it has one; the stored chip only
        // for a gathering entered by hand. See capBucket: M2.3 filled the chip in for
        // every Ticketmaster row, and the cap has to keep the finer split.
        category: capBucket(g.category, (g.gathering_sources ?? []).map((x: any) => x.snapshot?.category).find(Boolean)),
      };
    });

  const plan = planPublishing({ now: now.toISOString(), timeZone: city.timezone, settings, weeks, candidates });

  // Publish, in the plan's order. A failure here is a real event — a gathering that
  // started in the seconds since the queue was read, a venue that lost its row —
  // so it replaces that decision's line rather than disappearing from the log.
  const failed = new Map<string, string>();
  for (const id of plan.picks) {
    const { error } = await db.rpc("admin_publish_gathering", { p_gathering: id, p_actor: ctx.actor });
    if (error) {
      failed.set(id, error.message);
      errors.push(`Could not publish ${plan.decisions.find((d) => d.gatheringId === id)?.gatheringName ?? id}: ${error.message}`);
    }
  }

  const rows = plan.decisions.map((d) => decisionRow(d, city.slug, ctx.runId, failed.get(d.gatheringId)));
  if (rows.length) {
    const { error } = await db.from("publish_decisions").insert(rows);
    if (error) errors.push(`Could not write the publishing log: ${error.message}`);
  }

  const published = plan.picks.length - failed.size;
  const summaries = plan.weeks.map((w) => ({
    weekStart: w.weekStart,
    target: w.target,
    published: w.published,
    shortBy: w.shortBy,
    note: w.note,
  }));

  const adjust = await runWeeklyAdjust(db, ctx, settings, now).catch((err) => {
    errors.push(err instanceof Error ? err.message : String(err));
    return null;
  });

  return { published, considered: plan.decisions.length, weeks: summaries, adjust, errors };
}

function decisionRow(d: Decision, city: string, runId: number | null, failure: string | undefined) {
  const failed = failure !== undefined;
  return {
    run_id: runId,
    city,
    week_start: d.weekStart,
    gathering_id: d.gatheringId,
    gathering_name: d.gatheringName,
    starts_at: d.startsAt,
    venue_id: d.venueId,
    venue_name: d.venueName,
    outcome: failed ? "skipped" : d.outcome,
    reason_code: failed ? "publish_failed" : d.reasonCode,
    reason: failed ? `not published — it was chosen, but publishing failed: ${failure}` : d.reason,
    slot: failed ? null : d.slot,
    slot_kind: failed ? null : d.slotKind,
    rank: d.rank,
    candidates: d.candidates,
    ai_score: d.aiScore,
    adjustment: d.adjustment,
    final_score: d.finalScore,
    distance_km: d.distanceKm,
    publish_mark: d.mark,
    category: d.category,
    target: d.target,
    published_before: d.publishedBefore,
  };
}

// ---------------------------------------------------------------------------
// The weekly adjust — Monday, once, and (until M4.5) changing nothing
// ---------------------------------------------------------------------------

// Monday in the city's own week, which is the week the target is counted in.
function isMonday(now: Date, timeZone: string): boolean {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return today === weekStartOf(now.toISOString(), timeZone);
}

export async function runWeeklyAdjust(
  db: SupabaseClient,
  ctx: PublishContext,
  settings: PublishSettings,
  now: Date,
): Promise<TargetDecision | null> {
  const { city } = ctx;
  if (!isMonday(now, city.timezone)) return null;

  const weekStart = weekStartOf(now.toISOString(), city.timezone);
  const already = await must<any[]>(
    db.from("publish_target_log").select("id").eq("city", city.slug).eq("week_start", weekStart).limit(1),
  );
  if (already.length) return null;

  const rows = (await must<OutcomeRow[]>(
    db.rpc("admin_publish_outcomes", { p_city: city.slug, p_days: settings.adjustWindowDays }),
  )) as OutcomeRow[];

  // Throws rather than guesses if the window has grown past pin retention.
  const decision = adjustTarget(settings, rows ?? []);

  if (decision.applied) {
    const { error } = await db.rpc("admin_apply_publish_target", {
      p_city: city.slug,
      p_target: decision.toTarget,
      p_actor: ctx.actor,
    });
    if (error) throw new Error(`Could not move the target: ${error.message}`);
  }

  const { error } = await db.from("publish_target_log").insert({
    run_id: ctx.runId,
    city: city.slug,
    week_start: weekStart,
    decision: decision.decision,
    applied: decision.applied,
    reason: decision.reason,
    from_target: decision.fromTarget,
    to_target: decision.toTarget,
    qualifying: decision.all.qualifying,
    reach_rate: decision.all.reachRate,
    median_pins: decision.all.medianPins,
    seeded_qualifying: decision.seeded.qualifying,
    seeded_reach_rate: decision.seeded.reachRate,
    seeded_median_pins: decision.seeded.medianPins,
    organic_qualifying: decision.organic.qualifying,
    organic_reach_rate: decision.organic.reachRate,
    organic_median_pins: decision.organic.medianPins,
    window_days: settings.adjustWindowDays,
    min_lead_days: settings.adjustMinLeadDays,
    // Every row the arithmetic saw, kept verbatim: M4.5 repoints the same rules at
    // gathering_stats and has to be able to confirm, on these weeks, that the
    // answer did not change (Alex, M2.2).
    inputs: decision.inputs,
  });
  // A unique index makes the once-a-week rule the database's job, so two runs on the
  // same Monday race safely: the second one loses the insert and nothing else.
  if (error && !/duplicate key/i.test(error.message)) throw new Error(`Could not write the target log: ${error.message}`);
  return decision;
}
