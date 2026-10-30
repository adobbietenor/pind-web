// Topping up a series that is still running (M4.4, Alex, 29 Oct 2026).
//
// The repeat form wrote each series' dates once, and nothing wrote more: "a cap
// without a top-up is a decay mechanism" (spec, M2.3b), and by 29 Oct thirteen of the
// 28 series had no dates left. Now, nightly, a series the liveness check currently
// calls **confirmed** with **fewer than three weeks** of dates left gets dates up to
// the city's generating horizon (community_weeks, 8), as **drafts** — which the
// publisher then publishes under the Community tab's caps. Nothing here publishes.
//
// **There is still no recurrence in the database** (the M2.3b decision). The pattern
// is read off the series' own dates: same weekday, same local time, every 7 or 14
// days, or the same weekday of every month ("the first Tuesday", "the last Sunday").
// When the dates do not fit one pattern, nothing is added and the series is named in
// the run's counts for Alex — a guess at a run club's calendar is worse than a gap.
//
// Pure functions first (tests/unit/topup.test.ts); the database half at the bottom.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fromLocalInput, localDate, toLocalInput } from "../../packages/shared/src/time.ts";
import { stateOf, type SeriesRow } from "./series.ts";

export const TOPUP_BELOW_DAYS = 21; // "fewer than three weeks of dates left"
const PATTERN_DATES = 4; // how many of the latest dates the pattern is read from
const MIN_DATES = 3; // fewer than this is not a pattern

export type Cadence =
  | { kind: "weekly" }
  | { kind: "fortnightly" }
  | { kind: "monthly"; dow: number; nth: number | "last" };

const DAY = 86_400_000;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);
const dowOf = (d: string) => new Date(utc(d)).getUTCDay();
const daysInMonth = (d: string) => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).getUTCDate();
const nthOf = (d: string) => Math.floor((Number(d.slice(8, 10)) - 1) / 7) + 1;
const isLast = (d: string) => Number(d.slice(8, 10)) + 7 > daysInMonth(d);
const monthIndex = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;

// The pattern of a series' latest dates (local YYYY-MM-DD, ascending), or null.
export function inferCadence(dates: string[]): Cadence | null {
  const last = [...new Set(dates)].sort().slice(-PATTERN_DATES);
  if (last.length < MIN_DATES) return null;
  const gaps = last.slice(1).map((d, i) => Math.round((utc(d) - utc(last[i]!)) / DAY));
  if (gaps.every((g) => g === 7)) return { kind: "weekly" };
  if (gaps.every((g) => g === 14)) return { kind: "fortnightly" };
  // Monthly: one a month, consecutive months, the same weekday, and the same "which
  // one" — read as "last" when every date is in its month's last seven days, which is
  // what "the last Sunday" means in a month with five of them.
  const dow = dowOf(last[0]!);
  const months = last.map(monthIndex);
  const consecutive = months.slice(1).every((m, i) => m === months[i]! + 1);
  if (!consecutive || !last.every((d) => dowOf(d) === dow)) return null;
  if (last.every(isLast)) return { kind: "monthly", dow, nth: "last" };
  const nth = nthOf(last[0]!);
  return last.every((d) => nthOf(d) === nth) ? { kind: "monthly", dow, nth } : null;
}

// The dates after `after` (exclusive), up to `until` (inclusive), on that pattern.
export function nextDates(c: Cadence, after: string, until: string): string[] {
  const out: string[] = [];
  if (c.kind !== "monthly") {
    const step = c.kind === "weekly" ? 7 : 14;
    for (let t = utc(after) + step * DAY; t <= utc(until); t += step * DAY) out.push(ymd(t));
    return out;
  }
  for (let m = monthIndex(after) + 1; ; m++) {
    const y = Math.floor(m / 12);
    const mo = m % 12;
    let day: number;
    if (c.nth === "last") {
      const lastDay = new Date(Date.UTC(y, mo + 1, 0));
      day = lastDay.getUTCDate() - ((lastDay.getUTCDay() - c.dow + 7) % 7);
    } else {
      const first = new Date(Date.UTC(y, mo, 1)).getUTCDay();
      day = 1 + ((c.dow - first + 7) % 7) + 7 * (c.nth - 1);
      // A month with only four of that weekday takes the fourth, as the repeat form does.
      if (day > new Date(Date.UTC(y, mo + 1, 0)).getUTCDate()) day -= 7;
    }
    const d = ymd(Date.UTC(y, mo, day));
    if (d > until) return out;
    out.push(d);
  }
}

export interface SeriesDates {
  series: SeriesRow;
  // Every dated row the series has ever had, whatever became of it. A date that was
  // withdrawn or dismissed still "exists": counting only live rows would make the
  // top-up re-create, every night, a date Alex or the cap took away.
  starts: string[]; // ISO
}

export type TopUpDecision =
  | { seriesId: string; label: string; outcome: "add"; dates: string[]; time: string }
  | { seriesId: string; label: string; outcome: "enough" | "not_confirmed" | "no_dates" }
  | { seriesId: string; label: string; outcome: "unclear"; why: string };

export function planTopUp(input: { series: SeriesDates[]; now: string; tz: string; weeksAhead: number }): TopUpDecision[] {
  const today = localDate(input.now, input.tz);
  const until = ymd(utc(today) + input.weeksAhead * 7 * DAY);
  const below = ymd(utc(today) + TOPUP_BELOW_DAYS * DAY);
  return input.series.map(({ series: s, starts }): TopUpDecision => {
    const base = { seriesId: s.id, label: s.label };
    if (stateOf(s) !== "confirmed") return { ...base, outcome: "not_confirmed" };
    if (starts.length === 0) return { ...base, outcome: "no_dates" };
    const sorted = [...starts].sort();
    const lastLocal = localDate(sorted.at(-1)!, input.tz);
    if (lastLocal >= below) return { ...base, outcome: "enough" };
    const recent = sorted.slice(-PATTERN_DATES);
    const cadence = inferCadence(recent.map((x) => localDate(x, input.tz)));
    if (!cadence) return { ...base, outcome: "unclear", why: "its dates do not follow one weekly, fortnightly or monthly pattern" };
    const times = new Set(recent.map((x) => toLocalInput(x, input.tz).slice(11, 16)));
    if (times.size !== 1) return { ...base, outcome: "unclear", why: "its dates are not all at one time of day" };
    const dates = nextDates(cadence, lastLocal, until).filter((d) => d > today);
    if (!dates.length) return { ...base, outcome: "enough" };
    return { ...base, outcome: "add", dates, time: [...times][0]! };
  });
}

// ---------------------------------------------------------------------------
// The database half: called by the nightly import, before scoring and publishing
// ---------------------------------------------------------------------------

// What a new date copies from the series' latest one. Everything that describes the
// gathering; nothing that describes one night of it (its slug, its counts, its state).
const TEMPLATE =
  "id, name, starts_at, ends_at, venue_id, venue_name_raw, event_url, entry, door_price_cents, entry_note, category, " +
  "signup_url, signup_required, capacity, room_size, convening, blurb, blurb_why, blurb_source, blurb_at, organiser, " +
  "gathering_spots(spot_id, meet_at)";

export async function topUpSeries(
  db: SupabaseClient,
  opts: { now: Date; tz: string },
): Promise<{ added: number; series: number; unclear: { label: string; why: string }[] }> {
  const must = <T>(r: { data: T | null; error: { message: string } | null }): T => {
    if (r.error) throw new Error(r.error.message);
    return r.data as T;
  };
  const city = must(await db.from("cities").select("community_weeks").eq("slug", "toronto").single()) as { community_weeks: number };
  const series = must(await db.from("community_series").select("*")) as (SeriesRow & { organiser: string | null })[];
  // Paged: PostgREST answers at most 1,000 rows, and a series' dates read short would
  // make its last date look earlier than it is — and the top-up would re-create dates
  // that already exist.
  const rows: { series_id: string; starts_at: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const page = must(
      await db.from("gatherings").select("series_id, starts_at").not("series_id", "is", null).order("id").range(from, from + 999),
    ) as { series_id: string; starts_at: string }[];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  const starts = new Map<string, string[]>();
  for (const r of rows) starts.set(r.series_id, [...(starts.get(r.series_id) ?? []), r.starts_at]);

  const decisions = planTopUp({
    series: series.map((s) => ({ series: s, starts: starts.get(s.id) ?? [] })),
    now: opts.now.toISOString(),
    tz: opts.tz,
    weeksAhead: Number(city.community_weeks ?? 8),
  });

  let added = 0;
  let touched = 0;
  const unclear: { label: string; why: string }[] = [];
  for (const d of decisions) {
    if (d.outcome === "unclear") unclear.push({ label: d.label, why: d.why });
    if (d.outcome !== "add") continue;
    const s = series.find((x) => x.id === d.seriesId)!;
    const t = must(
      await db.from("gatherings").select(TEMPLATE).eq("series_id", d.seriesId).order("starts_at", { ascending: false }).limit(1).single(),
    ) as any;
    for (const date of d.dates) {
      const startsAt = fromLocalInput(`${date}T${d.time}`, opts.tz);
      if (!startsAt) continue;
      const shift = Date.parse(startsAt) - Date.parse(t.starts_at);
      const moved = (iso: string | null) => (iso ? new Date(Date.parse(iso) + shift).toISOString() : null);
      const made = must(
        await db
          .from("gatherings")
          .insert({
            name: t.name,
            starts_at: startsAt,
            ends_at: moved(t.ends_at),
            venue_id: t.venue_id,
            venue_name_raw: t.venue_name_raw,
            event_url: t.event_url,
            entry: t.entry,
            door_price_cents: t.door_price_cents,
            entry_note: t.entry_note,
            category: t.category,
            signup_url: t.signup_url,
            signup_required: t.signup_required,
            capacity: t.capacity,
            room_size: t.room_size,
            convening: t.convening,
            blurb: t.blurb,
            blurb_why: t.blurb_why,
            blurb_source: t.blurb_source,
            blurb_at: t.blurb_at,
            organiser: s.organiser ?? t.organiser,
            series_id: d.seriesId,
            source: "manual",
            tab: "community",
          })
          .select("id")
          .single(),
      ) as { id: string };
      const spots = (t.gathering_spots ?? []) as { spot_id: string; meet_at: string }[];
      if (spots.length) {
        must(await db.from("gathering_spots").insert(spots.map((x) => ({ gathering_id: made.id, spot_id: x.spot_id, meet_at: moved(x.meet_at) }))));
      }
      added++;
    }
    touched++;
    await db.from("moderation_log").insert({
      actor: "importer:topup",
      action: "series_create",
      note: `${d.label} — ${d.dates.length} drafts topped up, to ${d.dates.at(-1)}`,
    });
  }
  return { added, series: touched, unclear };
}
