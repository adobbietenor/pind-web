// A gathering nobody has pinned yet, for walking the room at 1 (M3.3, Alex).
//
// The test crowd cannot show what a first person meets — its seed people are already in
// the room. This makes a second gathering at the test crowd's venue, three days out at
// 7pm Toronto. The venue is a seed venue, so the gathering is seed too (the M2.1 trigger)
// and only testers can see it. Running it again deletes the old one — its pins, room and
// messages with it — and makes it empty again.
//
//   node --env-file=.dev.vars scripts/room-at-one.mjs
const NAME = "Room at one — walk it alone";
const base = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const rest = (path, init = {}) =>
  fetch(`${base}${path}`, { ...init, headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers ?? {}) } });
const must = async (res, what) => {
  if (!res.ok) throw new Error(`${what}: ${res.status} ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
};

const [crowd] = await must(await rest(`/rest/v1/gatherings?name=eq.${encodeURIComponent("Test crowd — walk the list")}&is_seed=eq.true&select=venue_id`), "test crowd");
if (!crowd) throw new Error("no test crowd — refresh it on /admin first");
await must(await rest(`/rest/v1/gatherings?name=eq.${encodeURIComponent(NAME)}&venue_id=eq.${crowd.venue_id}`, { method: "DELETE" }), "delete the old one");

const start = new Date();
start.setUTCDate(start.getUTCDate() + 3);
start.setUTCHours(23, 0, 0, 0); // 7pm Toronto
const [g] = await must(
  await rest("/rest/v1/gatherings", { method: "POST", body: JSON.stringify({ name: NAME, starts_at: start.toISOString(), venue_id: crowd.venue_id, published_at: new Date().toISOString(), source: "manual" }) }),
  "gathering",
);
if (!g.is_seed) {
  await rest(`/rest/v1/gatherings?id=eq.${g.id}`, { method: "DELETE" });
  throw new Error("the gathering came out public, not seed — deleted it");
}
const slug = await must(await rest("/rest/v1/rpc/admin_mint_slug", { method: "POST", body: JSON.stringify({ p_gathering: g.id }) }), "slug");
const pins = await must(await rest(`/rest/v1/pins?gathering_id=eq.${g.id}&select=id`), "pins");
console.log(`seed (testers only): ${g.is_seed}; pins: ${pins.length}`);
console.log(`https://pind.social/pin/${slug}`);
