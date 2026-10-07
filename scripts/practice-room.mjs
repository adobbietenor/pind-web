// Stand-ins for walking the room and groups alone, on the phone (Alex, 6 Oct 2026).
//
//   node --env-file=.dev.vars scripts/practice-room.mjs setup     a fresh practice gathering,
//                                                                Maya and Sam opted in, three messages
//   node --env-file=.dev.vars scripts/practice-room.mjs third     Priya opts in and says hi
//   node --env-file=.dev.vars scripts/practice-room.mjs accept    the stand-ins accept invites waiting for them
//   node --env-file=.dev.vars scripts/practice-room.mjs say Sam "on my way"   one of them posts (for #6)
//
// The gathering is seed (at the walk's Vancouver venue), so only testers see it or its
// people, and its times are Pacific. The stand-ins are seed people with harness-marked
// accounts (pind-standin-…@example.com): nothing is ever sent to them — delivery skips
// both (P162, P186) — and the photo check never looks at them. Running `setup` again
// removes the previous practice gathering and every stand-in, person first, then account.
// Stand-ins act through real sessions (a one-time sign-in code minted by the admin API),
// so every rule — rate limits, who may invite whom, the group's lifecycle — applies to
// them exactly as to a person.
import { ALL_TAGS } from "../packages/shared/src/tags.ts";
import { NEIGHBOURHOODS } from "../packages/shared/src/neighbourhoods.ts";
import { fixture, needEnv } from "./fixture.mjs";

needEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_PUBLISHABLE_KEY");
const TZ = "America/Vancouver";
const NAME = "Practice room";
const VENUE = "Walk venue — testers only";
const base = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
if (!base.includes("mxuajvlrkggrqpntekqt")) fixture("SUPABASE_URL is not pind-staging — this script only ever touches staging.");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const pub = process.env.SUPABASE_PUBLISHABLE_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rest = async (path, init = {}) => {
  const r = await fetch(`${base}${path}`, { ...init, headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers ?? {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
};

const STANDINS = {
  Maya: { gender: "woman", hood: 0, tags: [0, 5, 9], says: ["Anyone else going? First time at one of these.", "I was thinking of grabbing food nearby first, if anyone's up for it"] },
  Sam: { gender: "man", hood: 4, tags: [0, 2, 12], says: ["Same — I'll probably get there early"] },
  Priya: { gender: "woman", hood: 9, tags: [5, 7, 14], says: ["Hi! Just pinned in — who's getting there early?"] },
};

// Wall-clock time in Vancouver → the instant.
function instant(local) {
  const [d, t] = local.split(" ");
  const guess = new Date(`${d}T${t}:00Z`);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(guess).map((x) => [x.type, x.value]));
  return new Date(guess.getTime() - (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - guess.getTime()));
}

async function practice() {
  const [venue] = await rest(`/rest/v1/venues?name=eq.${encodeURIComponent(VENUE)}&select=id`);
  if (!venue) fixture("the walk venue does not exist — run scripts/walk-gathering.mjs first.");
  const [g] = await rest(`/rest/v1/gatherings?name=eq.${encodeURIComponent(NAME)}&venue_id=eq.${venue.id}&select=id,slug,starts_at`);
  return { venue, g };
}

async function standins() {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await rest(`/auth/v1/admin/users?page=${page}&per_page=1000`);
    for (const u of r.users) if (u.app_metadata?.pind_standin === true) out.push(u);
    if (r.users.length < 1000) break;
  }
  return out;
}

// A real session for a stand-in: a one-time code minted by the admin API, then verified.
async function sessionFor(name) {
  const u = (await standins()).find((x) => x.user_metadata?.standin === name);
  if (!u) fixture(`${name} is not a stand-in right now — run setup (or third, for Priya).`);
  const link = await rest("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email: u.email }) });
  const otp = link.email_otp ?? link.properties?.email_otp;
  const r = await fetch(`${base}/auth/v1/verify`, { method: "POST", headers: { apikey: pub, "content-type": "application/json" }, body: JSON.stringify({ type: "magiclink", email: u.email, token: otp }) });
  const s = await r.json();
  if (!s.access_token) throw new Error(`sign in ${name}: ${JSON.stringify(s)}`);
  const [person] = await rest(`/rest/v1/people?auth_user_id=eq.${u.id}&select=id`);
  return { token: s.access_token, personId: person.id };
}
const as = (session) => async (path, init = {}) => {
  const r = await fetch(`${base}${path}`, { ...init, headers: { apikey: pub, authorization: `Bearer ${session.token}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers ?? {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
};

async function portrait() {
  // A face the test crowd already uses, so no new picture is made for a stand-in.
  const [p] = await rest(`/rest/v1/people?is_seed=eq.true&photo_path=not.is.null&photo_status=eq.approved&select=photo_path&limit=1`);
  if (!p) fixture("no seed portrait to reuse — refresh the test crowd on /admin/testers.");
  const r = await fetch(`${base}/storage/v1/object/photos/${p.photo_path}`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
  if (!r.ok) fixture(`the test crowd's portrait could not be read (${r.status}) — refresh the test crowd.`);
  return Buffer.from(await r.arrayBuffer());
}

async function addStandin(name, gatheringId, png) {
  const s = STANDINS[name];
  const u = await rest("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email: `pind-standin-${name.toLowerCase()}-${Date.now()}@example.com`, password: crypto.randomUUID(), email_confirm: true, app_metadata: { pind_harness: true, pind_standin: true }, user_metadata: { standin: name } }),
  });
  const path = `${u.id}/portrait.png`;
  const up = await fetch(`${base}/storage/v1/object/photos/${path}`, { method: "POST", headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "image/png", "x-upsert": "true" }, body: png });
  if (!up.ok) throw new Error(`photo ${name}: ${up.status} ${await up.text()}`);
  const [person] = await rest("/rest/v1/people", { method: "POST", body: JSON.stringify({ auth_user_id: u.id, first_name: name, neighbourhood: NEIGHBOURHOODS[s.hood % NEIGHBOURHOODS.length].slug, photo_path: path, photo_status: "approved", is_seed: true }) });
  await rest("/rest/v1/people_private", { method: "POST", body: JSON.stringify({ person_id: person.id, gender: s.gender, birth_year: 1995 }) });
  await rest("/rest/v1/age_attestations?on_conflict=person_id", { method: "POST", headers: { prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ person_id: person.id, source: "a2" }) });
  await rest("/rest/v1/person_tags", { method: "POST", body: JSON.stringify(s.tags.map((i, n) => ({ person_id: person.id, tag: ALL_TAGS[i % ALL_TAGS.length].slug, on_list: n < 3 }))) });
  // A tester, like check:room's people: a seed gathering is published only to testers,
  // so without this a stand-in could not read or post in its own room.
  await rest("/rest/v1/rpc/admin_set_tester", { method: "POST", body: JSON.stringify({ p_auth_user: u.id, p_on: true, p_actor: "practice-room", p_note: "stand-in" }) });
  await rest("/rest/v1/pins", { method: "POST", body: JSON.stringify({ gathering_id: gatheringId, person_id: person.id, party_total: 1, open_to_meeting: true }) });
  return person.id;
}

async function say(name, text) {
  const s = await sessionFor(name);
  const [m] = await rest(`/rest/v1/room_members?person_id=eq.${s.personId}&left_at=is.null&women_only=eq.false&select=room_id`);
  if (!m) fixture(`${name} is in no room — run setup first.`);
  await as(s)("/rest/v1/room_messages", { method: "POST", body: JSON.stringify({ room_id: m.room_id, author_id: s.personId, body: text }) });
  console.log(`${name}: ${text}`);
}

const cmd = process.argv[2] ?? "setup";
if (cmd === "setup") {
  const { venue, g: old } = await practice();
  if (old) await rest(`/rest/v1/gatherings?id=eq.${old.id}`, { method: "DELETE" });
  for (const u of await standins()) {
    await rest("/rest/v1/rpc/admin_set_tester", { method: "POST", body: JSON.stringify({ p_auth_user: u.id, p_on: false, p_actor: "practice-room" }) }).catch(() => undefined);
    await rest(`/rest/v1/people?auth_user_id=eq.${u.id}`, { method: "DELETE" });
    await rest(`/auth/v1/admin/users/${u.id}`, { method: "DELETE" });
  }
  // Two days out at 7pm Pacific: far enough that a group has hours to form, near enough to feel real.
  const day = new Date(Date.now() + 2 * 86_400_000).toLocaleDateString("en-CA", { timeZone: TZ });
  const start = instant(`${day} 19:00`);
  const [g] = await rest("/rest/v1/gatherings", { method: "POST", body: JSON.stringify({ name: NAME, starts_at: start.toISOString(), venue_id: venue.id, published_at: new Date().toISOString(), source: "manual", convening: "a_spot_first" }) });
  if (!g.is_seed) {
    await rest(`/rest/v1/gatherings?id=eq.${g.id}`, { method: "DELETE" });
    fixture("the practice gathering came out public, not seed — deleted it.");
  }
  const spots = await rest(`/rest/v1/meeting_spots?venue_id=eq.${venue.id}&select=id`);
  const [{ meet_offset_minutes: offset }] = await rest("/rest/v1/cities?slug=eq.vancouver&select=meet_offset_minutes");
  await rest("/rest/v1/gathering_spots", { method: "POST", body: JSON.stringify(spots.map((s) => ({ gathering_id: g.id, spot_id: s.id, meet_at: new Date(start.getTime() - offset * 60_000).toISOString() }))) });
  const slug = await rest("/rest/v1/rpc/admin_mint_slug", { method: "POST", body: JSON.stringify({ p_gathering: g.id }) });
  const png = await portrait();
  for (const name of ["Maya", "Sam"]) await addStandin(name, g.id, png);
  await say("Maya", STANDINS.Maya.says[0]);
  await sleep(3500);
  await say("Sam", STANDINS.Sam.says[0]);
  await sleep(3500);
  await say("Maya", STANDINS.Maya.says[1]);
  console.log(`\nhttps://pind.social/g/${slug}   (testers only; starts ${start.toLocaleString("en-CA", { timeZone: TZ })} Pacific)`);
} else if (cmd === "third") {
  const { g } = await practice();
  if (!g) fixture("no practice gathering — run setup first.");
  await addStandin("Priya", g.id, await portrait());
  await say("Priya", STANDINS.Priya.says[0]);
} else if (cmd === "accept") {
  let any = 0;
  for (const u of await standins()) {
    const name = u.user_metadata?.standin;
    const s = await sessionFor(name);
    const invites = await as(s)(`/rest/v1/crew_invites?to_person=eq.${s.personId}&status=eq.sent&select=id`);
    for (const i of invites) {
      await as(s)("/rest/v1/rpc/respond_to_invite", { method: "POST", body: JSON.stringify({ p_invite: i.id, p_accept: true }) });
      console.log(`${name} accepted an invite`);
      any++;
    }
  }
  if (!any) console.log("No invites waiting for a stand-in. (Invite them from the room first: Go together.)");
} else if (cmd === "say") {
  const [name, ...words] = process.argv.slice(3);
  if (!STANDINS[name] || !words.length) fixture(`say <${Object.keys(STANDINS).join("|")}> "<message>"`);
  await say(name, words.join(" "));
} else {
  fixture(`unknown command "${cmd}" — setup, third, accept or say`);
}
