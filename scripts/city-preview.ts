// What the City of Toronto feed would publish if the hold were off (M4.4, Alex, 30 Oct
// 2026: "send me the exact list before I switch it on").
//
// It plans from exactly what tonight's run reads (readPublishInput), with one setting
// changed in memory — city_feed_publishing on — and writes nothing: no publishing, no
// decision log, no setting. Hand-entered series are in the same plan, so the caps
// they share with the City rows bite here as they would tonight.
//
// The plan covers the run's three weeks. A City date further out is listed after it,
// as what would follow once it comes inside the lead window, caps permitting then.
//
// Usage, from the repo root:
//   node --env-file=.dev.vars scripts/city-preview.ts

import { createClient } from "@supabase/supabase-js";
import { addWeeks, planPublishing } from "../src/publish/plan.ts";
import { readPublishInput } from "../src/publish/run.ts";
import { adjustedScore, distanceAdjustment, venueDistanceKm } from "../src/import/ticketmaster.ts";

const db = createClient(process.env.SUPABASE_URL!.trim().replace(/\/rest\/v1\/?$/, ""), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), {
  auth: { persistSession: false },
});

// The run's city context, as loadCity builds it in src/import/run.ts (which node cannot
// load: its imports have no extensions). Only the distance adjustment reads these.
const { data: c, error } = await db.from("cities").select("*").eq("slug", "toronto").single();
if (error) throw new Error(error.message);
const city = {
  slug: "toronto",
  timezone: c.timezone as string,
  centreLat: Number(c.centre_lat),
  centreLng: Number(c.centre_lng),
  coreRadiusKm: Number(c.core_radius_km),
  penaltyPerKm: Number(c.distance_penalty_per_km),
  penaltyMax: Number(c.distance_penalty_max),
};

const input = await readPublishInput(db, { city, runId: null, actor: "preview" });
console.log(`City feed held: ${!input.settings.cityFeedPublishing}; previewing as if it were on. City floor ${input.settings.cityScoreFloor}.`);
const plan = planPublishing({ ...input, settings: { ...input.settings, cityFeedPublishing: true } });

const cityIds = new Set(input.candidates.filter((x) => x.source === "city").map((x) => x.id));
const day = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: city.timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

const mine = plan.decisions.filter((d) => cityIds.has(d.gatheringId)).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
const published = mine.filter((d) => d.outcome === "published");
console.log(`\nWould publish in the next three weeks: ${published.length} City dates`);
for (const d of published) console.log(`PUBLISH\t${day(d.startsAt)}\t${d.finalScore}\t${d.gatheringName}\t${d.venueName ?? "?"}`);
console.log(`\nAt or over the floor but refused by a cap:`);
for (const d of mine.filter((x) => x.outcome !== "published" && x.reasonCode !== "below_floor"))
  console.log(`REFUSED\t${day(d.startsAt)}\t${d.finalScore}\t${d.gatheringName}\t${d.reasonCode}\t${d.reason}`);

// Further out: drafts over the floor after the lead window, by the same final score
// (the AI score plus the distance adjustment) the plan uses.
// The plan fills whole calendar weeks (Monday to Sunday), so "later" starts where its
// last week ends — not at the lead window's day count, which left a gap between them.
const lastWeek = plan.weeks[plan.weeks.length - 1]!.weekStart;
const lastPlanned = new Date(Date.parse(`${addWeeks(lastWeek, 1)}T00:00:00Z`) - 86_400_000 + 1).toISOString();
const weekEnd = new Intl.DateTimeFormat("en-CA", { timeZone: city.timezone, year: "numeric", month: "2-digit", day: "2-digit" });
const afterPlan = (iso: string) => weekEnd.format(new Date(iso)) >= addWeeks(lastWeek, 1);
const later: any[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error: e2 } = await db
    .from("gatherings")
    .select("name, starts_at, venues(name, latitude, longitude), gathering_triage(score)")
    .eq("source", "city")
    .eq("status", "draft")
    .is("dismissed_at", null)
    .gt("starts_at", lastPlanned)
    .order("starts_at")
    .range(from, from + 999);
  if (e2) throw new Error(e2.message);
  later.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}
const finalOf = (g: any): number | null => {
  const ai = (Array.isArray(g.gathering_triage) ? g.gathering_triage[0] : g.gathering_triage)?.score ?? null;
  const km = g.venues ? venueDistanceKm({ lat: g.venues.latitude, lng: g.venues.longitude }, city) : null;
  return adjustedScore(ai, distanceAdjustment(km, city));
};
const over = later.filter((g) => afterPlan(g.starts_at) && (finalOf(g) ?? -1) >= input.settings.cityScoreFloor);
console.log(`\nFrom Monday ${addWeeks(lastWeek, 1)}, over the floor (publish as they come within three weeks, caps permitting): ${over.length} dates`);
for (const g of over) console.log(`LATER\t${day(g.starts_at)}\t${finalOf(g)}\t${g.name}\t${g.venues?.name ?? "?"}`);
