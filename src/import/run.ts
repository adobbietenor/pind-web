// The nightly Ticketmaster import (Phase 1 M1.3, decisions Part 5). Runs from the
// Worker's cron trigger and from the admin's "Run import now" button.
//
//   1. take the run lock (admin_start_import_run — one run at a time)
//   2. fetch 8 weeks of listings around the city centre
//   3. drop junk, then plan the changes (pure: ticketmaster.ts)
//   4. apply the plan in one transaction (admin_import_apply — the database refuses
//      anything the importer may not do)
//   5. purge Ticketmaster data 30 days after each gathering's end
//   6. score new drafts with Claude, within the $3 daily cap
//   7. nightly only: suggest 3 meeting spots for up to 10 venues that need them
//   8. fill each of the next three weeks to the publishing target (M2.2)
//   9. write the run summary Alex sees in the admin
//
// Service key throughout: this is the importer, not a visitor (decisions Part 5).
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatLocal } from "../admin/time";
import type { Env } from "../env";
import { importFailedAlert, sendAlert } from "../ops/alert";
import { PUBLISHER, runPublishing } from "../publish/run";
import { serviceClient } from "../supabase";
import { canSpend, ESTIMATE, MODEL, type ScoreInput } from "./ai";
import { claudeClient, scoreBatch, SPOTS_CALL_MS, suggestSpots } from "./claude";
import { fetchWindow } from "./tmclient";
import {
  adjustedScore,
  distanceAdjustment,
  filterListings,
  planImport,
  toListing,
  venueDistanceKm,
  type CityGeo,
  type GatheringState,
  type KnownGathering,
  type KnownSource,
  type SkipReason,
} from "./ticketmaster";

export const IMPORTER = "importer:ticketmaster";
// The draft queue folds low scores away at the publisher's own floor, read from the
// cities row (src/admin/gatherings.ts). It used to be a constant here, set to 70;
// when M2.2 moved the floor to 60 the queue went on hiding drafts the publisher was
// about to publish, under a label naming the old number. One threshold, one home.
// SCORE_THRESHOLD is a different question — which venues count as needing spots — and
// stays a constant until something needs it not to be.
export const SCORE_THRESHOLD = 40;
const SCORE_BATCH = 25;
const SCORE_PARALLEL = 4;
const SPOT_VENUES_PER_NIGHT = 10;
const SPOT_PARALLEL = 3; // about 45 s and $0.20 per venue (measured)
const SPOT_RETRY_DAYS = 30; // a venue whose suggestions were all rejected waits for "Suggest again"
const RETENTION_DAYS = 30;
const DEFAULT_CAP_USD = 3;

export interface City extends CityGeo {
  slug: string;
  timezone: string;
  searchRadiusKm: number;
  importWeeks: number;
}

export interface RunOptions {
  trigger: "cron" | "manual";
  actor: string;
  deadline: number; // stop starting AI calls after this (ms since epoch)
  spots: boolean;
}

export interface RunOutcome {
  status: "ok" | "partial" | "failed" | "busy";
  message: string;
}

// ---------------------------------------------------------------------------
// Reading everything (PostgREST returns at most 1,000 rows per request)
// ---------------------------------------------------------------------------

type Rows<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

async function all<T>(page: (from: number, to: number) => Rows<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

async function byIds<T>(ids: string[], query: (chunk: string[]) => Rows<T>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await query(ids.slice(i, i + 150));
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
  }
  return out;
}

async function must<T>(q: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}

export async function loadCity(db: SupabaseClient, slug = "toronto"): Promise<City> {
  const c = await must(db.from("cities").select("*").eq("slug", slug).single());
  const row = c as Record<string, any>;
  if (row.centre_lat === null || row.search_radius_km === null) throw new Error(`City ${slug} has no import area`);
  return {
    slug,
    timezone: row.timezone,
    centreLat: Number(row.centre_lat),
    centreLng: Number(row.centre_lng),
    searchRadiusKm: Number(row.search_radius_km),
    coreRadiusKm: Number(row.core_radius_km),
    penaltyPerKm: Number(row.distance_penalty_per_km),
    penaltyMax: Number(row.distance_penalty_max),
    importWeeks: Number(row.import_weeks ?? 8),
  };
}

function capOf(env: Env): number {
  const n = Number(env.AI_DAILY_CAP_USD ?? DEFAULT_CAP_USD);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_CAP_USD;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export async function runImport(env: Env, opts: RunOptions): Promise<RunOutcome> {
  const db = serviceClient(env);
  const city = await loadCity(db);

  // The run row is opened BEFORE anything that can fail, which is the whole point of
  // this ordering (Alex, M2.2). It used to check the Ticketmaster key first and
  // return early, so a night that failed on a missing credential wrote no row at
  // all: the admin went on showing the last good run and two nights passed with
  // nothing saying the city's list had stopped refreshing. A failed run must leave
  // a failed run behind.

  const started = await db.rpc("admin_start_import_run", {
    p_source: "ticketmaster",
    p_trigger: opts.trigger,
    p_actor: opts.actor,
    p_city: city.slug,
  });
  if (started.error) {
    return /already running/.test(started.error.message)
      ? { status: "busy", message: "An import is already running. Try again in a few minutes." }
      : { status: "failed", message: started.error.message };
  }
  const runId = started.data as number;
  const counts: Record<string, unknown> = {};
  const errors: string[] = [];
  let tmCalls = 0;
  let aiCost = 0;
  let status: RunOutcome["status"] = "ok";

  const saveCost = () => db.from("import_runs").update({ ai_cost_usd: aiCost.toFixed(6) }).eq("id", runId);

  try {
    // 1b. Now the credentials, inside the try, so a missing one is recorded as a
    // failed run and alerted on rather than vanishing. Unset is named as unset.
    const tmKey = env.TICKETMASTER_CONSUMER_KEY?.trim();
    if (!tmKey) {
      throw new Error(
        "TICKETMASTER_CONSUMER_KEY is not set on the Worker, so the nightly import cannot run. " +
          "Set it with `npx wrangler secret put TICKETMASTER_CONSUMER_KEY`.",
      );
    }

    // 2–3. Fetch, filter, plan.
    const now = new Date();
    const windowEnd = new Date(now.getTime() + city.importWeeks * 7 * 24 * 60 * 60 * 1000);
    const fetched = await fetchWindow(tmKey, { lat: city.centreLat, lng: city.centreLng, radiusKm: city.searchRadiusKm, weeks: city.importWeeks }, now);
    tmCalls = fetched.calls;
    errors.push(...fetched.errors);
    if (!fetched.complete) status = "partial";
    if (fetched.calls > 0 && fetched.events.length === 0 && fetched.errors.length) throw new Error(`Ticketmaster: ${fetched.errors[0]}`);

    const listings = fetched.events.map(toListing);
    const { kept, skipped } = filterListings(listings);
    const state = await loadState(db, now.toISOString(), windowEnd.toISOString());
    const plan = planImport({
      listings: kept,
      seenIds: listings.map((l) => l.tmId),
      complete: fetched.complete,
      now: now.toISOString(),
      windowEnd: windowEnd.toISOString(),
      ...state,
    });
    const allSkipped: Partial<Record<SkipReason, number>> = { ...skipped };
    for (const [k, n] of Object.entries(plan.skipped)) allSkipped[k as SkipReason] = (allSkipped[k as SkipReason] ?? 0) + (n ?? 0);
    Object.assign(counts, { fetched: listings.length, kept: kept.length, skipped: allSkipped });

    // 4. Apply, in one transaction.
    counts.applied = await must(db.rpc("admin_import_apply", { p_run: runId, p_plan: plan }));

    // 4b. The chip a reader filters by, from each listing's own classification
    // (M2.3). In the same run the draft is created in, so "set once at draft" is
    // true, and only where nobody has said — an admin edit is never overwritten and
    // a genre Ticketmaster changes later never silently re-tags anything. The rule
    // itself is public.chip_category, one copy, in the database.
    counts.categorised = await must(db.rpc("admin_categorise_gatherings"));

    // 5. Retention.
    counts.purged = await must(db.rpc("admin_purge_ticketmaster_data", { p_days: RETENTION_DAYS }));

    // 6. Scores.
    const apiKey = env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      errors.push("ANTHROPIC_API_KEY is missing: new drafts stay unscored");
      status = "partial";
    } else {
      const claude = claudeClient(apiKey);
      const cap = capOf(env);
      const spentBefore = Number(await must(db.rpc("admin_ai_spend_today", { p_city: city.slug })));
      const allowed = (estimate: number) => canSpend(spentBefore + aiCost, estimate, cap);

      const scoring = await scoreDrafts(db, city, claude, {
        allowed,
        deadline: opts.deadline,
        spend: async (usd) => {
          aiCost += usd;
          await saveCost();
        },
      });
      Object.assign(counts, scoring.counts);
      if (scoring.failures) status = "partial";

      // 7. Spot suggestions (nightly).
      if (opts.spots) {
        const spots = await suggestForVenues(db, city, claude, {
          allowed,
          deadline: opts.deadline,
          spend: async (usd) => {
            aiCost += usd;
            await saveCost();
          },
          venueIds: null,
        });
        Object.assign(counts, spots.counts);
        if (spots.failures) status = "partial";
      }
    }

    // 8. Publishing (M2.2). Deliberately outside the AI branch: a missing Anthropic
    // key leaves new drafts unscored, but the ones already scored still deserve
    // their week filled, and the daily cap must never quietly stop the city's list
    // from refreshing.
    // The actor is the publisher even on a manual run: the rule chose these, not
    // the click that started the run. The moderation log has to keep "Alex pressed
    // Publish" and "a run filled a slot" apart, and import_runs already records who
    // triggered the run.
    const publishing = await runPublishing(db, { city, runId, actor: PUBLISHER });
    Object.assign(counts, {
      published: publishing.published,
      publish_considered: publishing.considered,
      publish_weeks: publishing.weeks,
      publish_adjust: publishing.adjust ? { decision: publishing.adjust.decision, applied: publishing.adjust.applied, reason: publishing.adjust.reason } : null,
    });
    if (publishing.errors.length) {
      errors.push(...publishing.errors);
      status = "partial";
    }
  } catch (err) {
    status = "failed";
    errors.push(err instanceof Error ? err.message : String(err));
  }

  counts.errors = errors;
  await db
    .from("import_runs")
    .update({ status, counts, tm_calls: tmCalls, ai_cost_usd: aiCost.toFixed(6), finished_at: new Date().toISOString(), error: errors[0] ?? null })
    .eq("id", runId);
  const a = (counts.applied ?? {}) as Record<string, number>;
  const summary =
    status === "failed"
      ? `Import failed: ${errors[0]}`
      : `Import ${status === "partial" ? "finished with problems" : "done"}: ${a.new ?? 0} new, ${a.updated ?? 0} updated, ` +
        `${a.dismissed ?? 0} dismissed, ${a.flagged ?? 0} flagged; ${counts.scored ?? 0} scored` +
        (counts.unscored_left ? `, ${counts.unscored_left} still unscored` : "") +
        (counts.categorised ? `; ${counts.categorised} given a chip` : "") +
        `; ${counts.published ?? 0} published; AI $${aiCost.toFixed(2)}.`;

  // A failed run tells somebody. M2.2's premise is that the city's list refreshes
  // without anyone watching, so a failure nobody hears about means pind.social
  // quietly stops updating and starts looking abandoned — which is worse than
  // whatever broke. At most one of these a day, and if no alert channel is
  // configured the run says so in its own summary rather than failing twice over.
  if (status === "failed") {
    const alert = importFailedAlert(summary, errors);
    const outcome = await sendAlert(env, db, "import_failed", alert.subject, alert.body).catch((err) => ({
      sent: false,
      why: err instanceof Error ? err.message : String(err),
    }));
    if (!outcome.sent) return { status, message: `${summary} (alert not sent: ${outcome.why})` };
  }

  return { status, message: summary };
}

// ---------------------------------------------------------------------------
// State for the plan
// ---------------------------------------------------------------------------

async function loadState(db: SupabaseClient, now: string, windowEnd: string) {
  const cols = "id, name, status, starts_at, venue_id, merged_into_id";
  const sourceRows = await all<any>((a, b) =>
    db.from("gathering_sources").select("external_id, gathering_id, snapshot, missing_since").eq("source", "ticketmaster").not("external_id", "is", null).range(a, b),
  );
  const inWindow = await all<any>((a, b) =>
    db.from("gatherings").select(cols).gte("starts_at", now).lte("starts_at", windowEnd).in("status", ["draft", "published"]).range(a, b),
  );
  const known = new Map<string, any>(inWindow.map((g) => [g.id, g]));
  const missingIds = [...new Set(sourceRows.map((s) => s.gathering_id as string))].filter((id) => !known.has(id));
  for (const g of await byIds<any>(missingIds, (ids) => db.from("gatherings").select(cols).in("id", ids))) known.set(g.id, g);

  // Who dismissed each dismissed gathering last: the importer, or Alex.
  const dismissedIds = [...known.values()].filter((g) => g.status === "dismissed").map((g) => g.id as string);
  const log = await byIds<any>(dismissedIds, (ids) =>
    db.from("moderation_log").select("gathering_id, actor, action, at, id").in("gathering_id", ids).in("action", ["dismiss", "restore", "merge"]),
  );
  const last = new Map<string, any>();
  for (const l of log) {
    const cur = last.get(l.gathering_id);
    if (!cur || l.at > cur.at || (l.at === cur.at && l.id > cur.id)) last.set(l.gathering_id, l);
  }

  const gatherings: KnownGathering[] = [...known.values()].map((g) => ({
    id: g.id,
    name: g.name,
    status: g.status as GatheringState,
    startsAt: g.starts_at,
    venueId: g.venue_id,
    merged: g.merged_into_id !== null,
    dismissedByImporter: last.get(g.id)?.actor === IMPORTER && last.get(g.id)?.action === "dismiss",
  }));
  const sources: KnownSource[] = sourceRows.map((s) => ({
    externalId: s.external_id,
    gatheringId: s.gathering_id,
    snapshot: s.snapshot ?? null,
    missingSince: s.missing_since ?? null,
  }));

  const [venues, aliases, externalIds] = await Promise.all([
    all<any>((a, b) => db.from("venues").select("id, name, latitude, longitude").range(a, b)),
    all<any>((a, b) => db.from("venue_aliases").select("venue_id, alias").range(a, b)),
    all<any>((a, b) => db.from("venue_external_ids").select("external_id, venue_id").eq("source", "ticketmaster").range(a, b)),
  ]);
  return {
    sources,
    gatherings,
    venues: venues.map((v) => ({ id: v.id, name: v.name, lat: v.latitude, lng: v.longitude })),
    aliases: aliases.map((a) => ({ venueId: a.venue_id, alias: a.alias })),
    externalIds: externalIds.map((x) => ({ externalId: x.external_id, venueId: x.venue_id })),
  };
}

// ---------------------------------------------------------------------------
// AI: scores and spot suggestions
// ---------------------------------------------------------------------------

interface Spending {
  allowed: (estimate: number) => boolean;
  deadline: number;
  spend: (usd: number) => Promise<void>;
}

// Every upcoming draft without a score, soonest first, 25 per call, 4 calls at a time.
async function scoreDrafts(db: SupabaseClient, city: City, claude: ReturnType<typeof claudeClient>, s: Spending) {
  const drafts = (
    await all<any>((a, b) =>
      db
        .from("gatherings")
        .select("id, name, starts_at, venue_id, venue_name_raw, gathering_triage(gathering_id), gathering_sources(snapshot)")
        .eq("status", "draft")
        .gt("starts_at", new Date().toISOString())
        .order("starts_at")
        .range(a, b),
    )
  ).filter((g) => !(Array.isArray(g.gathering_triage) ? g.gathering_triage.length : g.gathering_triage));

  const venueIds = [...new Set(drafts.map((g) => g.venue_id).filter(Boolean))] as string[];
  const venues = new Map<string, any>(
    (await byIds<any>(venueIds, (ids) => db.from("venues").select("id, name, latitude, longitude").in("id", ids))).map((v) => [v.id, v]),
  );
  const inputs: ScoreInput[] = drafts.map((g) => {
    const v = g.venue_id ? venues.get(g.venue_id) : null;
    const category = (g.gathering_sources ?? []).map((x: any) => x.snapshot?.category).find(Boolean) ?? "unknown";
    return {
      id: g.id,
      name: g.name,
      when: formatLocal(g.starts_at, city.timezone),
      venue: v?.name ?? g.venue_name_raw ?? "unknown",
      category,
      distanceKm: v ? venueDistanceKm({ lat: v.latitude, lng: v.longitude }, city) : null,
    };
  });

  const batches: ScoreInput[][] = [];
  for (let i = 0; i < inputs.length; i += SCORE_BATCH) batches.push(inputs.slice(i, i + SCORE_BATCH));
  let scored = 0;
  let failures = 0;
  let capped = false;
  let next = 0;

  async function worker() {
    while (next < batches.length) {
      if (Date.now() > s.deadline) return;
      if (!s.allowed(ESTIMATE.scoringBatch * SCORE_PARALLEL)) {
        capped = true;
        return;
      }
      const batch = batches[next++]!;
      try {
        const { scores, cost } = await scoreBatch(claude, batch);
        await s.spend(cost);
        const rows = [...scores].map(([id, v]) => ({ gathering_id: id, score: v.score, reason: v.reason, model: MODEL, scored_at: new Date().toISOString() }));
        if (rows.length) await must(db.from("gathering_triage").upsert(rows, { onConflict: "gathering_id" }));
        scored += rows.length;
        if (rows.length < batch.length) failures++;
      } catch (err) {
        failures++;
        console.error("scoring batch failed:", err instanceof Error ? err.message : err);
      }
    }
  }
  await Promise.all(Array.from({ length: SCORE_PARALLEL }, worker));
  return { counts: { to_score: inputs.length, scored, unscored_left: inputs.length - scored, ai_capped: capped }, failures };
}

// Venues with fewer than 3 approved spots and no pending suggestions, that have an
// upcoming draft scoring 40+ (after the distance adjustment). Nightly: at most 10, and
// not a venue suggested for in the last 30 days. "Suggest again" names the venue.
export async function suggestForVenues(
  db: SupabaseClient,
  city: City,
  claude: ReturnType<typeof claudeClient>,
  s: Spending & { venueIds: string[] | null },
) {
  let venueIds = s.venueIds;
  if (!venueIds) {
    const windowEnd = new Date(Date.now() + city.importWeeks * 7 * 24 * 60 * 60 * 1000).toISOString();
    const [drafts, spots, suggestions, venues] = await Promise.all([
      all<any>((a, b) =>
        db.from("gatherings").select("venue_id, starts_at, gathering_triage(score)").eq("status", "draft").not("venue_id", "is", null)
          .gt("starts_at", new Date().toISOString()).lte("starts_at", windowEnd).order("starts_at").range(a, b),
      ),
      all<any>((a, b) => db.from("meeting_spots").select("venue_id").eq("active", true).range(a, b)),
      all<any>((a, b) => db.from("spot_suggestions").select("venue_id, status, created_at").range(a, b)),
      all<any>((a, b) => db.from("venues").select("id, latitude, longitude").range(a, b)),
    ]);
    const coords = new Map<string, any>(venues.map((v) => [v.id, v]));
    const active = new Map<string, number>();
    for (const x of spots) active.set(x.venue_id, (active.get(x.venue_id) ?? 0) + 1);
    const recent = Date.now() - SPOT_RETRY_DAYS * 24 * 60 * 60 * 1000;
    const blocked = new Set(
      suggestions.filter((x) => x.status === "pending" || Date.parse(x.created_at) > recent).map((x) => x.venue_id as string),
    );
    const chosen: string[] = [];
    for (const d of drafts) {
      if (chosen.length >= SPOT_VENUES_PER_NIGHT) break;
      if (chosen.includes(d.venue_id) || blocked.has(d.venue_id) || (active.get(d.venue_id) ?? 0) >= 3) continue;
      const ai = (Array.isArray(d.gathering_triage) ? d.gathering_triage[0] : d.gathering_triage)?.score ?? null;
      const v = coords.get(d.venue_id);
      const score = adjustedScore(ai, distanceAdjustment(v ? venueDistanceKm({ lat: v.latitude, lng: v.longitude }, city) : null, city));
      if (score !== null && score >= SCORE_THRESHOLD) chosen.push(d.venue_id);
    }
    venueIds = chosen;
  }

  let added = 0;
  let venuesDone = 0;
  let failures = 0;
  let capped = false;
  const queue = [...venueIds];
  async function worker() {
    while (queue.length) {
      // Start a venue only if its call can finish before the deadline.
      if (Date.now() + SPOTS_CALL_MS > s.deadline) return;
      if (!s.allowed(ESTIMATE.spotsVenue * SPOT_PARALLEL)) {
        capped = true;
        return;
      }
      const id = queue.shift()!;
      try {
        const v = await must(db.from("venues").select("name, address").eq("id", id).single());
        const { spots, cost } = await suggestSpots(claude, v as { name: string; address: string | null });
        await s.spend(cost);
        if (!spots.length) {
          failures++;
          continue;
        }
        await must(
          db.from("spot_suggestions").insert(
            spots.map((x) => ({ venue_id: id, name: x.name, description: x.address, address: x.address, reason: x.reason, evidence_url: x.evidenceUrl })),
          ),
        );
        added += spots.length;
        venuesDone++;
      } catch (err) {
        failures++;
        console.error("spot suggestion failed:", err instanceof Error ? err.message : err);
      }
    }
  }
  await Promise.all(Array.from({ length: SPOT_PARALLEL }, worker));
  return { counts: { spot_venues: venuesDone, spots_suggested: added, spots_capped: capped }, failures };
}

// "Suggest again" for one venue, from the admin. Its own run row, for the lock and the
// day's spend.
export async function suggestForOneVenue(env: Env, venueId: string, actor: string): Promise<RunOutcome> {
  const db = serviceClient(env);
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { status: "failed", message: "ANTHROPIC_API_KEY is missing" };
  const city = await loadCity(db);
  const started = await db.rpc("admin_start_import_run", { p_source: "ticketmaster", p_trigger: "suggest", p_actor: actor, p_city: city.slug });
  if (started.error) return { status: "busy", message: started.error.message };
  const runId = started.data as number;
  let aiCost = 0;
  const spentBefore = Number(await must(db.rpc("admin_ai_spend_today", { p_city: city.slug })));
  const result = await suggestForVenues(db, city, claudeClient(apiKey), {
    allowed: (estimate) => canSpend(spentBefore + aiCost, estimate, capOf(env)),
    deadline: Date.now() + SPOTS_CALL_MS + 10_000,
    spend: async (usd) => {
      aiCost += usd;
    },
    venueIds: [venueId],
  }).catch((err) => ({ counts: { error: err instanceof Error ? err.message : String(err) }, failures: 1 }));
  const status = result.failures ? "partial" : "ok";
  await db
    .from("import_runs")
    .update({ status, counts: result.counts, ai_cost_usd: aiCost.toFixed(6), finished_at: new Date().toISOString() })
    .eq("id", runId);
  const n = (result.counts as Record<string, unknown>).spots_suggested ?? 0;
  if ((result.counts as Record<string, unknown>).spots_capped) return { status: "partial", message: "Daily AI cap reached: try tomorrow." };
  return { status, message: n ? `${n} spots suggested (AI $${aiCost.toFixed(2)}).` : "No usable suggestions came back; try again." };
}
