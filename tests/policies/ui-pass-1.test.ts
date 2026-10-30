// UI pass 1, group 2 (Alex, 30 Oct 2026): every rule the redesign changed, each proved from
// both sides, CAN and CANNOT. One world per rule set, made here and removed after.
//
//   D  "I'm here" on the night (A9, 088): set_here / clear_here / here_now, arrivals.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "./env.ts";
import { newClient, must, passwordSignIn, removeUser, PREFIX } from "./world.ts";

const env = loadEnv();
const service = newClient(env, env.secretKey);
const anon = newClient(env, env.publishableKey);
const run = `up${randomBytes(3).toString("hex")}`;

interface P { name: string; id: string; authId: string; c: SupabaseClient }
const ppl: Record<string, P> = {};
const g: Record<string, string> = {};
let venue = "";
let spot = "";

async function mk(name: string, gender: "woman" | "man", womenOnlyRooms = false): Promise<P> {
  const email = `${PREFIX}-${run}-${name.toLowerCase()}@example.com`;
  const password = randomUUID();
  const made = await service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { pind_harness: true } });
  if (made.error || !made.data.user) throw new Error(`create ${name}: ${made.error?.message}`);
  const authId = made.data.user.id;
  const row = await must(service.from("people").insert({ auth_user_id: authId, first_name: name, neighbourhood: "king-west", photo_path: `${authId}/face.png` }).select("id").single(), `person ${name}`);
  await must(service.from("people_private").insert({ person_id: row.id, gender, birth_year: 1993, women_only_rooms: womenOnlyRooms }), `private ${name}`);
  await must(service.from("age_attestations").upsert({ person_id: row.id, source: "a26" }, { onConflict: "person_id", ignoreDuplicates: true }), `attest ${name}`);
  const c = newClient(env, env.publishableKey);
  const s = await passwordSignIn(c, { email, password });
  if (s.error) throw new Error(`sign in ${name}: ${s.error.message}`);
  return (ppl[name] = { name, id: row.id, authId, c });
}
async function gathering(label: string, startsAt: number): Promise<string> {
  const row = await must(service.from("gatherings").insert({ name: `${PREFIX} ${run} ${label}`, starts_at: new Date(startsAt).toISOString(), venue_id: venue, published_at: new Date(startsAt - 7 * 86_400_000).toISOString() }).select("id").single(), `gathering ${label}`);
  return (g[label] = row.id);
}
const pin = (name: string, G: string, open = true) =>
  must(service.from("pins").insert({ gathering_id: g[G], person_id: ppl[name]!.id, open_to_meeting: open, party_total: 1 }), `pin ${name}`);
const here = (who: string, G: string, note: string) => ppl[who]!.c.rpc("set_here", { p_gathering: g[G], p_note: note });
type Here = { count: number; me: string | null; people: { person_id: string; first_name: string; note: string }[] };
const now = async (who: string, G: string) => (await must(ppl[who]!.c.rpc("here_now", { p_gathering: g[G] }), `${who} reads here_now`)) as Here;
const sees = async (who: string, G: string) => (await now(who, G)).people.map((p) => p.first_name).sort();
async function refused(p: PromiseLike<{ error: { code?: string; hint?: string } | null }>, code?: string, hint?: string) {
  const { error } = await p;
  assert.ok(error, "allowed something that must be refused");
  if (code) assert.equal(error.code, code, `refused with ${error.code}, expected ${code}`);
  if (hint) assert.equal(error.hint, hint);
}

before(async () => {
  venue = (await must(service.from("venues").insert({ name: `${PREFIX} ${run} Arena` }).select("id").single(), "venue")).id;
  spot = (await must(service.from("meeting_spots").insert({ venue_id: venue, name: "North Gate" }).select("id").single(), "spot")).id;
  for (const [n, gen, wo] of [["Ann", "woman", false], ["Bob", "man", false], ["Cal", "man", false], ["Dee", "woman", true], ["Eve", "woman", false], ["Fox", "man", false], ["Gus", "man", false]] as const) await mk(n, gen, wo);
  // Tonight: an hour from now, so inside the 3-hour window. Later: five hours away.
  await gathering("Tonight", Date.now() + 3_600_000);
  await gathering("Later", Date.now() + 5 * 3_600_000);
  // Ann, Bob, Cal and Gus in the general room; Dee only in the women-only room (her own
  // setting); Eve pinned but not open; Fox not pinned at all.
  for (const n of ["Ann", "Bob", "Cal", "Gus", "Dee"]) await pin(n, "Tonight");
  await pin("Eve", "Tonight", false);
  await pin("Ann", "Later");
  // Ann has blocked Gus.
  await must(service.from("blocks").insert({ blocker_id: ppl.Ann!.id, blocked_id: ppl.Gus!.id }), "Ann blocks Gus");
});

after(async () => {
  for (const id of Object.values(g)) await service.from("gatherings").delete().eq("id", id);
  if (venue) await service.from("venues").delete().eq("id", venue);
  for (const p of Object.values(ppl)) await removeUser(service, p.authId).catch(() => undefined);
});

test("P279 D: Ann CAN say she's here with Q7's line; a blank line, an 81-character one, someone not open to meeting and someone not pinned CANNOT", async () => {
  await refused(here("Ann", "Tonight", "   "), "22023", "here_note");
  await refused(here("Ann", "Tonight", "x".repeat(81)), "22023", "here_note");
  await refused(here("Eve", "Tonight", "red scarf"), "42501", "here_not_open");
  await refused(here("Fox", "Tonight", "red scarf"), "42501", "here_not_open");
  await must(here("Ann", "Tonight", "  green Matthews jersey "), "Ann is here");
  assert.equal((await now("Ann", "Tonight")).me, "green Matthews jersey", "her own line, trimmed");
  // 80 characters is allowed: the boundary from the other side.
  await must(here("Ann", "Tonight", "y".repeat(80)), "80 characters");
  await must(here("Ann", "Tonight", "green Matthews jersey"), "back to her line");
});

test("P280 D: who sees Ann is here: her rooms CAN (Bob and Cal in the general one, Dee in the women-only one); someone she blocked, someone pinned but not open, a stranger and a visitor CANNOT", async () => {
  const bob = await now("Bob", "Tonight");
  assert.deepEqual(bob.people.map((p) => [p.first_name, p.note]), [["Ann", "green Matthews jersey"]]);
  assert.deepEqual(await sees("Cal", "Tonight"), ["Ann"]);
  // Ann, a woman, is in the women-only room as well as the general one: Dee shares that one.
  assert.deepEqual(await sees("Dee", "Tonight"), ["Ann"], "Dee shares the women-only room with Ann");
  assert.deepEqual(await sees("Gus", "Tonight"), [], "someone Ann blocked saw her");
  assert.deepEqual(await sees("Eve", "Tonight"), [], "someone pinned but not open saw who is here");
  await refused(ppl.Fox!.c.rpc("here_now", { p_gathering: g.Tonight }), "42501");
  await refused(anon.rpc("here_now", { p_gathering: g.Tonight }));
  // And never by reading the table.
  for (const who of ["Bob", "Ann"]) await refused(ppl[who]!.c.from("arrivals").select("note"));
});

test("P281 D: 'N here now' is a number anyone pinned CAN read (Eve, not open, included); it counts everyone here; Bob, who shares no room or squad with Dee, CANNOT see her", async () => {
  await must(here("Dee", "Tonight", "yellow raincoat"), "Dee is here");
  for (const who of ["Ann", "Bob", "Eve", "Dee"]) assert.equal((await now(who, "Tonight")).count, 2, `${who} read the wrong count`);
  assert.deepEqual(await sees("Bob", "Tonight"), ["Ann"], "Bob saw Dee, whom he shares no room or squad with");
});

test("P282 D: a squad shares it too: Dee and Bob in one squad CAN see each other; the switch marks the squad arrival, and switching off clears both", async () => {
  const crew = (await must(service.from("crews").insert({ gathering_id: g.Tonight, kind: "crew", state: "live", name: "Pre-game", name_status: "approved", spot_id: spot, meet_at: new Date(Date.now() + 1_800_000).toISOString() }).select("id").single(), "squad")).id as string;
  for (const n of ["Dee", "Bob"]) await must(service.from("crew_members").insert({ crew_id: crew, gathering_id: g.Tonight, person_id: ppl[n]!.id }), `${n} joins`);
  assert.deepEqual(await sees("Bob", "Tonight"), ["Ann", "Dee"]);
  await must(here("Bob", "Tonight", "blue cap"), "Bob is here");
  assert.deepEqual(await sees("Dee", "Tonight"), ["Ann", "Bob"], "Dee should see Bob through the squad");
  const bobInSquad = await must(service.from("crew_members").select("arrival_note").eq("crew_id", crew).eq("person_id", ppl.Bob!.id).single(), "Bob's squad row");
  assert.equal(bobInSquad.arrival_note, "blue cap", "one switch did not tell the squad");
  await must(ppl.Bob!.c.rpc("clear_here", { p_gathering: g.Tonight }), "Bob switches off");
  assert.deepEqual(await sees("Dee", "Tonight"), ["Ann"], "Bob still shown after switching off");
  const cleared = await must(service.from("crew_members").select("arrived_at, arrival_note").eq("crew_id", crew).eq("person_id", ppl.Bob!.id).single(), "Bob's squad row");
  assert.deepEqual(cleared, { arrived_at: null, arrival_note: null });
});

test("P283 D: only on the night: five hours early CANNOT; after the effective end nothing shows and nothing can be set", async () => {
  await refused(here("Ann", "Later", "green jersey"), "42501", "here_window");
  await must(service.from("gatherings").update({ starts_at: new Date(Date.now() - 4 * 3_600_000).toISOString() }).eq("id", g.Tonight), "the night is over");
  const after = await now("Bob", "Tonight");
  assert.deepEqual([after.count, after.people.length], [0, 0], "arrivals outlived the effective end");
  await refused(here("Bob", "Tonight", "blue cap"), "42501", "here_window");
});
