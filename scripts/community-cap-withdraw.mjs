// One-off, by Alex's decision (29 Oct 2026, M4.4): withdraw the published Community-tab
// gatherings that are over the new weekly caps — 2 per venue and 2 per organiser — so
// the tab starts inside them. From now on the publisher keeps it there; this only
// clears what was published before the caps existed.
//
// Who stays, in Alex's order: one with pins before one without, then the higher score,
// then the earlier date. A gathering with pins is never withdrawn while one without can
// go; if a week could only be brought inside the cap by withdrawing one with pins, the
// script says so and leaves that week alone for Alex.
//
// Dry by default: it prints what it would do. `--apply` withdraws, through
// admin_withdraw_gathering, so each one is logged and can be undone from the admin.
//
//   node --env-file=.dev.vars scripts/community-cap-withdraw.mjs [--apply]
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const ACTOR = "alex (decision 29 Oct 2026, applied by script)";
const NOTE = "Over the Community tab's new weekly cap (2 per venue, 2 per organiser). Withdrawn once, by Alex's decision of 29 Oct 2026 (M4.4).";
const TZ = "America/Toronto";

const url = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = async (q) => {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
};

const city = await must(db.from("cities").select("community_max_per_venue_weekly, community_max_per_organiser_weekly").eq("slug", "toronto").single());
const venueCap = city.community_max_per_venue_weekly;
const orgCap = city.community_max_per_organiser_weekly;

const rows = await must(
  db
    .from("gatherings")
    .select("id, name, starts_at, venue_id, organiser, venues!inner(name, city), gathering_triage(score)")
    .eq("status", "published")
    .eq("tab", "community")
    .eq("is_seed", false)
    .gt("starts_at", new Date().toISOString())
    .eq("venues.city", "toronto")
    .limit(5000),
);
const counts = await must(db.rpc("gathering_counts", { gathering_ids: rows.map((g) => g.id) }));
const pinned = new Map(counts.map((c) => [c.gathering_id, c.pinned ?? 0]));

const weekOf = (iso) => {
  const d = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso)) + "T00:00:00Z");
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
};
const scoreOf = (g) => (Array.isArray(g.gathering_triage) ? g.gathering_triage[0] : g.gathering_triage)?.score ?? -1;

const byWeek = new Map();
for (const g of rows) byWeek.set(weekOf(g.starts_at), [...(byWeek.get(weekOf(g.starts_at)) ?? []), g]);

const withdraw = [];
const leftForAlex = [];
for (const [week, list] of [...byWeek].sort()) {
  const order = [...list].sort(
    (a, b) =>
      (pinned.get(b.id) > 0) - (pinned.get(a.id) > 0) ||
      scoreOf(b) - scoreOf(a) ||
      a.starts_at.localeCompare(b.starts_at) ||
      a.id.localeCompare(b.id),
  );
  const perVenue = {};
  const perOrg = {};
  for (const g of order) {
    const v = perVenue[g.venue_id] ?? 0;
    const o = g.organiser ? (perOrg[g.organiser] ?? 0) : 0;
    if (v < venueCap && (!g.organiser || o < orgCap)) {
      perVenue[g.venue_id] = v + 1;
      if (g.organiser) perOrg[g.organiser] = o + 1;
      continue;
    }
    const why = v >= venueCap ? `${g.venues.name} already has ${v}` : `${g.organiser} already has ${o}`;
    (pinned.get(g.id) > 0 ? leftForAlex : withdraw).push({ week, g, why, pins: pinned.get(g.id) ?? 0 });
  }
}

for (const x of withdraw) console.log(`${APPLY ? "withdraw" : "would withdraw"} | week of ${x.week} | ${x.g.starts_at.slice(0, 16)} | ${x.g.name} | ${x.why}`);
for (const x of leftForAlex) console.log(`LEFT FOR ALEX (has ${x.pins} pins) | week of ${x.week} | ${x.g.name} | ${x.why}`);
console.log(`${withdraw.length} over the cap without pins, ${leftForAlex.length} over the cap with pins (left alone).`);

if (APPLY) {
  for (const x of withdraw) {
    await must(db.rpc("admin_withdraw_gathering", { p_gathering: x.g.id, p_reason: "other", p_note: NOTE, p_actor: ACTOR }));
  }
  console.log(`withdrew ${withdraw.length}.`);
}
