// The nightly City of Toronto feed import (M4.4). The I/O half; the rules are in
// ./cityfeed.ts.
//
//   1. take the run lock (the same one the Ticketmaster import takes: one run at a time)
//   2. stream the feed, parsing only the rows inside the import window
//   3. plan (pure) and apply in one transaction (admin_city_import_apply)
//
// Its own cron at 07:30 UTC, half an hour before the Ticketmaster import, which then
// scores the new drafts and runs the publisher over both — so the City feed goes
// through the same score floor and caps as everything else, and never around them
// (Alex). Its run row's trigger is "city-cron" or "city-manual", never "cron" or
// "manual": the import watchdog and the admin's "last import" read those two as the
// Ticketmaster import, and a City run must not be mistaken for one.
//
// Written with extensions on every import, so the same code runs from node against
// staging (scripts/city-import.mjs) — a module only a deploy can run is a module
// nobody checks.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env";
import { serviceClient } from "../supabase.ts";
import {
  CITY_FEED_URL,
  calendarDateOf,
  ObjectSplitter,
  planCity,
  toCityRow,
  type CityRow,
  type ExistingGathering,
} from "./cityfeed.ts";

export const CITY_IMPORTER = "importer:city";
const TZ = "America/Toronto";
const FETCH_MS = 240_000;

export interface CityRunOutcome {
  status: "ok" | "partial" | "failed" | "busy";
  message: string;
}

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

const localDate = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

// The window's rows, read as a stream. `complete` is true only when the whole file
// arrived: a partial read must not say anything is gone.
export async function readFeed(
  from: Date,
  to: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<{ rows: CityRow[]; complete: boolean; scanned: number; error: string | null }> {
  const rows: CityRow[] = [];
  let scanned = 0;
  try {
    const res = await fetchImpl(CITY_FEED_URL, { signal: AbortSignal.timeout(FETCH_MS) });
    if (!res.ok || !res.body) return { rows, complete: false, scanned, error: `the City feed answered ${res.status}` };
    const splitter = new ObjectSplitter();
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const obj of splitter.push(value)) {
        scanned++;
        const when = calendarDateOf(obj);
        if (!when) continue;
        const t = Date.parse(when);
        if (!(t >= from.getTime() && t <= to.getTime())) continue;
        const row = toCityRow(JSON.parse(obj) as Record<string, unknown>);
        if (row) rows.push(row);
      }
    }
    return { rows, complete: scanned > 0, scanned, error: scanned > 0 ? null : "the City feed had no rows" };
  } catch (err) {
    return { rows, complete: false, scanned, error: err instanceof Error ? err.message : String(err) };
  }
}

async function loadState(db: SupabaseClient, now: string, windowEnd: string) {
  const [venues, aliases, keys, sources, existing] = await Promise.all([
    all<any>((a, b) => db.from("venues").select("id, name, latitude, longitude").range(a, b)),
    all<any>((a, b) => db.from("venue_aliases").select("venue_id, alias").range(a, b)),
    all<any>((a, b) => db.from("venue_external_ids").select("external_id, venue_id").eq("source", "city").range(a, b)),
    all<any>((a, b) => db.from("gathering_sources").select("external_id").eq("source", "city").range(a, b)),
    all<any>((a, b) =>
      db
        .from("gatherings")
        .select("name, starts_at, venue_id, source")
        .neq("source", "city")
        .in("status", ["draft", "published"])
        .gte("starts_at", now)
        .lte("starts_at", windowEnd)
        .range(a, b),
    ),
  ]);
  return {
    venues: venues.map((v) => ({ id: v.id, name: v.name, lat: v.latitude, lng: v.longitude })),
    aliases: aliases.map((a) => ({ venueId: a.venue_id, alias: a.alias })),
    cityKeys: keys.map((k) => ({ key: k.external_id, venueId: k.venue_id })),
    knownIds: sources.map((s) => s.external_id as string),
    existing: existing.map(
      (g): ExistingGathering => ({ venueId: g.venue_id, startsAt: g.starts_at, name: g.name, localDate: localDate(g.starts_at) }),
    ),
  };
}

export async function runCityImport(
  env: Env,
  opts: { trigger: "city-cron" | "city-manual"; actor: string; now?: Date; fetchImpl?: typeof fetch },
): Promise<CityRunOutcome> {
  const db = serviceClient(env);
  const now = opts.now ?? new Date();
  const { data: c, error: cityError } = await db.from("cities").select("slug, import_weeks").eq("slug", "toronto").single();
  if (cityError) return { status: "failed", message: `City feed: ${cityError.message}` };
  const weeks = Number((c as { import_weeks: number | null }).import_weeks ?? 8);
  const windowEnd = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

  // The run row first, so a failure leaves a failed run behind (the M2.2 rule).
  const started = await db.rpc("admin_start_import_run", { p_source: "city", p_trigger: opts.trigger, p_actor: opts.actor, p_city: "toronto" });
  if (started.error) {
    return /already running/.test(started.error.message)
      ? { status: "busy", message: "An import is already running. Try again in a few minutes." }
      : { status: "failed", message: started.error.message };
  }
  const runId = started.data as number;
  const counts: Record<string, unknown> = {};
  const errors: string[] = [];
  let status: CityRunOutcome["status"] = "ok";

  try {
    const feed = await readFeed(now, windowEnd, opts.fetchImpl);
    if (feed.error) errors.push(feed.error);
    if (!feed.complete) status = "partial";
    if (feed.scanned === 0) throw new Error(`City feed: ${feed.error ?? "nothing read"}`);
    const state = await loadState(db, now.toISOString(), windowEnd.toISOString());
    const plan = planCity({ rows: feed.rows, complete: feed.complete, ...state });
    Object.assign(counts, {
      scanned: feed.scanned,
      in_window: feed.rows.length,
      kept: plan.seenIds.length,
      skipped: plan.skipped,
    });
    const { data, error } = await db.rpc("admin_city_import_apply", { p_run: runId, p_plan: plan });
    if (error) throw new Error(error.message);
    counts.applied = data;
  } catch (err) {
    status = "failed";
    errors.push(err instanceof Error ? err.message : String(err));
  }

  counts.errors = errors;
  await db
    .from("import_runs")
    .update({ status, counts, finished_at: new Date().toISOString(), error: errors[0] ?? null })
    .eq("id", runId);
  const a = (counts.applied ?? {}) as Record<string, number>;
  const skipped = Object.entries((counts.skipped ?? {}) as Record<string, number>)
    .map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`)
    .join(", ");
  const message =
    status === "failed"
      ? `City feed import failed: ${errors[0]}`
      : `City feed ${status === "partial" ? "read with problems" : "done"}: ${counts.in_window ?? 0} listing-days in the window, ` +
        `${a.new ?? 0} new, ${a.seen ?? 0} seen again, ${a.dismissed ?? 0} dismissed, ${a.flagged ?? 0} flagged, ` +
        `${a.venues_created ?? 0} new places` +
        (skipped ? `; skipped ${skipped}` : "") +
        ".";
  return { status, message };
}
