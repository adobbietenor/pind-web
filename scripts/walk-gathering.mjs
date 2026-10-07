// The walk gathering (M3.3b, Alex, 6 Oct 2026): a testers-only gathering on Alex's own
// clock, for walking the whole loop on the phone — link → pin → room → group → plan →
// "I'm here" → the next morning's tick.
//
//   node --env-file=.dev.vars scripts/walk-gathering.mjs "2026-10-07 22:00"
//
// The time is wall-clock time in Vancouver. Every time in the chain is worked out from
// the gathering's own time zone, which is its venue's city's: staging had only Toronto,
// so a 10pm Pacific walk would have had its next-morning tick at 9am Eastern — 6am
// Pacific — and its notifications printing Eastern times. So the walk's venue is in a
// staging-only Vancouver city (America/Vancouver), seed (testers only, never public), and
// nothing else reads that city: the import, publishing and the public list all name
// Toronto. Running it again deletes the old walk gathering — its pins, room, groups and
// messages with it — and makes a fresh one.
import { fixture, needEnv } from "./fixture.mjs";

needEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
const TZ = "America/Vancouver";
const NAME = "Walk — the whole loop";
const VENUE = "Walk venue — testers only";
const at = process.argv[2];
if (!/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(at ?? "")) fixture(`give the start as "YYYY-MM-DD HH:MM" in Vancouver time, e.g. "2026-10-07 22:00"`);

const base = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
if (!base.includes("mxuajvlrkggrqpntekqt")) fixture("SUPABASE_URL is not pind-staging — this script only ever touches staging.");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const rest = async (path, init = {}) => {
  const r = await fetch(`${base}${path}`, { ...init, headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers ?? {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
};

// Wall-clock time in a zone → the instant.
function instant(local, tz) {
  const [d, t] = local.split(" ");
  const guess = new Date(`${d}T${t}:00Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(guess).map((p) => [p.type, p.value]));
  const shown = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess.getTime() - (shown - guess.getTime()));
}
const pacific = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);

const start = instant(at, TZ);
if (start.getTime() < Date.now() + 30 * 60_000) fixture(`${at} Pacific is in the past or under half an hour away.`);

// The city, once.
const [city] = await rest(`/rest/v1/cities?slug=eq.vancouver&select=slug,timezone`);
if (!city) await rest("/rest/v1/cities", { method: "POST", body: JSON.stringify({ slug: "vancouver", name: "Vancouver", timezone: TZ, centre_lat: 49.2827, centre_lng: -123.1207, country: "Canada", country_code: "CA" }) });
else if (city.timezone !== TZ) fixture(`the staging city "vancouver" has time zone ${city.timezone}, not ${TZ}.`);

// The venue, once: seed, so the gathering is seed too and only testers can see it.
let [venue] = await rest(`/rest/v1/venues?name=eq.${encodeURIComponent(VENUE)}&select=id,is_seed`);
if (!venue) {
  [venue] = await rest("/rest/v1/venues", { method: "POST", body: JSON.stringify({ name: VENUE, address: "1 Walk Street, Vancouver", city: "vancouver", is_seed: true }) });
  await rest("/rest/v1/meeting_spots", { method: "POST", body: JSON.stringify([{ venue_id: venue.id, name: "The north doors" }, { venue_id: venue.id, name: "The bar on the corner" }]) });
}
if (!venue.is_seed) fixture("the walk venue is not seed — it would be public. Fix it before walking.");

// The gathering: the old one goes, a fresh one comes.
await rest(`/rest/v1/gatherings?name=eq.${encodeURIComponent(NAME)}&venue_id=eq.${venue.id}`, { method: "DELETE" });
const [g] = await rest("/rest/v1/gatherings", {
  method: "POST",
  // a_spot_first: the spot poll, and its leader becomes the plan three hours before.
  body: JSON.stringify({ name: NAME, starts_at: start.toISOString(), venue_id: venue.id, published_at: new Date().toISOString(), source: "manual", convening: "a_spot_first" }),
});
if (!g.is_seed) {
  await rest(`/rest/v1/gatherings?id=eq.${g.id}`, { method: "DELETE" });
  fixture("the walk gathering came out public, not seed — deleted it.");
}
const spots = await rest(`/rest/v1/meeting_spots?venue_id=eq.${venue.id}&select=id`);
// The spot options meet before the start by the city's own offset (a setting on the city
// row, Alex M2.2), the same as any gathering's.
const [{ meet_offset_minutes: offset }] = await rest("/rest/v1/cities?slug=eq.vancouver&select=meet_offset_minutes");
const meetAt = new Date(start.getTime() - offset * 60_000).toISOString();
await rest("/rest/v1/gathering_spots", { method: "POST", body: JSON.stringify(spots.map((s) => ({ gathering_id: g.id, spot_id: s.id, meet_at: meetAt }))) });
const slug = await rest("/rest/v1/rpc/admin_mint_slug", { method: "POST", body: JSON.stringify({ p_gathering: g.id }) });

// The chain, from the database's own rules (spec A18; the lifecycle job runs every 10
// minutes, delivery every minute, the next-morning job at :05 past each hour).
const h = 3_600_000;
const effectiveEnd = new Date(start.getTime() + 3 * h); // no end time given: three hours
const nextMorning = instant(`${new Date(effectiveEnd.getTime() - 6 * h).toLocaleDateString("en-CA", { timeZone: TZ })} 09:00`, TZ);
nextMorning.setTime(nextMorning.getTime() + 24 * h);
console.log(`https://pind.social/g/${slug}   (testers only; seed: ${g.is_seed})`);
console.log(`starts                         ${pacific(start)} (Pacific)`);
console.log(`the plan meets at              ${pacific(new Date(meetAt))} (the poll's spots)`);
console.log(`a group must have 3 by         ${pacific(new Date(start.getTime() - 3 * h))} — or, if started after ${pacific(new Date(start.getTime() - 8 * h))}, two hours after it was started, never later than this`);
console.log(`#3 the plan, #4 day-of, live   ${pacific(new Date(start.getTime() - 3 * h))} (within 10 minutes)`);
console.log(`the group is done, A16 opens   ${pacific(effectiveEnd)} (within 10 minutes)`);
console.log(`#5 the next morning            ${pacific(new Date(nextMorning.getTime() + 5 * 60_000))}`);
