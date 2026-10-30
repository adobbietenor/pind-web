// UI pass 1, group 2 (Alex, 30 Oct 2026): every rule the redesign changed, each proved from
// both sides, CAN and CANNOT. One world per rule set, made here and removed after.
//
//   D  "I'm here" on the night (A9, 088): set_here / clear_here / here_now, arrivals.
//   C  a squad's details, place and time (A15/A11): start_squad, edit_squad, squads.
//   A  1-on-1 (A28/A29/A20): set_one_on_one, my_solo_requests, set_solo_place.
//   B  keep in touch (A16/A20): ask_keep, answer_keep, take_back_keep, keep_people.
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  // Every venue this run made (the arena, and P285's second venue).
  await service.from("venues").delete().like("name", `${PREFIX} ${run}%`);
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

// ---------------------------------------------------------------------------
// C  A squad's details, place and time (A15/A11, 064/065/071): start_squad / edit_squad,
//    the contact filter, the whole-card check, and the place that is never typed (H5).
// ---------------------------------------------------------------------------
let squadId = "";
let otherVenueSpot = "";
const startC = (who: string, name: string, details: string | null, spot: string | null, time: string | null) =>
  ppl[who]!.c.rpc("start_squad", { p_gathering: g.Later, p_name: name, p_details: details, p_spot: spot, p_time_note: time, p_women_only: false });
const listedTo = async (who: string) =>
  (await must(ppl[who]!.c.rpc("squads", { p_gathering: g.Later }), `${who}'s squads`)) as { crew_id: string; name: string; details: string | null; time_note: string | null; spot: string | null }[];
// The check's verdict, as the Worker records it: for the exact card text it judged.
const verdict = (crew: string, text: string, outcome: "approved" | "rejected" = "approved") =>
  service.rpc("admin_record_squad_name_check", { p_crew: crew, p_name: text, p_outcome: outcome, p_source: "app", p_reason: "harness" });

test("P284 C: Ann CAN start a squad with details, a curated place and a time in words; she sees it at once, Bob CANNOT until the whole card has passed the check, then CAN with every word", async () => {
  for (const n of ["Bob", "Cal"]) await pin(n, "Later");
  squadId = (await must(startC("Ann", "300 level pre-game", "  First time solo, happy to grab a drink before.  ", spot, " around 5:30 p.m. "), "Ann starts")) as string;
  const mine = await must(ppl.Ann!.c.from("crews").select("details, time_note, spot_id, name_status").eq("id", squadId).single(), "Ann reads her squad");
  assert.deepEqual(mine, { details: "First time solo, happy to grab a drink before.", time_note: "around 5:30 p.m.", spot_id: spot, name_status: "pending" });
  assert.deepEqual((await listedTo("Bob")).map((s) => s.crew_id), [], "a card no check has passed was listed");
  await must(verdict(squadId, "300 level pre-game\nFirst time solo, happy to grab a drink before.\naround 5:30 p.m."), "the check passes the card");
  const seen = (await listedTo("Bob")).find((s) => s.crew_id === squadId);
  assert.deepEqual(seen && [seen.details, seen.time_note, seen.spot], ["First time solo, happy to grab a drink before.", "around 5:30 p.m.", "North Gate"]);
});

test("P285 C: the place is never typed: a spot of another venue CANNOT be used, the event itself (no spot) CAN even where the venue has spots, and no one can write the squad row directly", async () => {
  otherVenueSpot = (await must(service.from("meeting_spots").insert({ venue_id: (await must(service.from("venues").insert({ name: `${PREFIX} ${run} Elsewhere` }).select("id").single(), "venue 2")).id, name: "Someone's flat" }).select("id").single(), "a spot elsewhere")).id;
  await refused(startC("Cal", "Elsewhere crew", null, otherVenueSpot, null), "22023", "squad_spot");
  const atTheEvent = (await must(startC("Cal", "Meet in the lobby", null, null, null), "Cal starts one at the event")) as string;
  assert.equal((await must(service.from("crews").select("spot_id").eq("id", atTheEvent).single(), "Cal's squad")).spot_id, null);
  await refused(ppl.Cal!.c.from("crews").update({ details: "123 Fake St, apt 4" }).eq("id", atTheEvent).select("id").single());
  await must(service.from("crews").delete().eq("id", atTheEvent), "tidy");
});

test("P286 C: no handle, link, email or phone number in the name, details or time CAN get through; the limits hold from both sides (200 and 40 CAN, 201 and 41 CANNOT)", async () => {
  const contact = ["insta @rocketfan", "my insta is rocketfan", "text me 416 555 1234", "pind.social/rocket", "https://x.example", "www.example.com", "rocket@example.com"];
  // The filter proves it can see each one before anything else is trusted.
  for (const bad of contact) {
    await refused(startC("Bob", "Clean name", bad, null, null), "22023", "squad_contact");
    await refused(startC("Bob", "Clean name", null, null, bad.slice(0, 40)), "22023", "squad_contact");
  }
  await refused(startC("Bob", "insta @rocketfan", null, null, null), "22023", "squad_contact");
  await refused(startC("Bob", "Long details", "d".repeat(201), null, null), "22023", "squad_details");
  await refused(startC("Bob", "Long time", null, null, "t".repeat(41)), "22023", "squad_time_note");
  // And the ordinary words of a plan pass: numbers that are times or levels, a place name.
  const ok = (await must(startC("Bob", "Section 314", "d".repeat(200), null, "t".repeat(40)), "the limits themselves")) as string;
  await must(ppl.Bob!.c.rpc("edit_squad", { p_crew: ok, p_name: "Section 314", p_details: "Meet by the 300 level bar at 5:30, gate 4", p_spot: null, p_time_note: "around 5:30 p.m." }), "a plan's own numbers pass");
  await must(service.from("crews").delete().eq("id", ok), "tidy");
});

test("P287 C: any member CAN change the card (Cal, who joined); changed words go back to the check and off Bob's list; a non-member CANNOT; a verdict on the old words does not list the new ones", async () => {
  await must(ppl.Cal!.c.rpc("join_squad", { p_crew: squadId }), "Cal joins Ann's squad");
  await refused(ppl.Bob!.c.rpc("edit_squad", { p_crew: squadId, p_name: "Bob's now", p_details: null, p_spot: null, p_time_note: null }), "42501", "squad_not_member");
  await must(ppl.Cal!.c.rpc("edit_squad", { p_crew: squadId, p_name: "300 level pre-game", p_details: "Doors at 6, drinks first.", p_spot: null, p_time_note: "around 5" }), "Cal edits");
  assert.equal((await listedTo("Bob")).some((s) => s.crew_id === squadId), false, "an edited card stayed listed before its check");
  // The verdict on the words it judged before the edit lands on nothing.
  await must(verdict(squadId, "300 level pre-game\nFirst time solo, happy to grab a drink before.\naround 5:30 p.m."), "a stale verdict");
  assert.equal((await must(service.from("crews").select("name_status").eq("id", squadId).single(), "status")).name_status, "pending", "a verdict on old words approved new ones");
  await must(verdict(squadId, "300 level pre-game\nDoors at 6, drinks first.\naround 5"), "the check passes the new card");
  const seen = (await listedTo("Bob")).find((s) => s.crew_id === squadId);
  assert.deepEqual(seen && [seen.details, seen.time_note, seen.spot], ["Doors at 6, drinks first.", "around 5", null]);
});

// ---------------------------------------------------------------------------
// A  1-on-1 since UI pass 1 (A28/A29/A20): one account switch with its audience, requests
//    in Connections, a chat whose place and time either of the two sets (curated spot or
//    the event itself, never typed), handles once a place is set.
// ---------------------------------------------------------------------------
const oneOnOne = (who: string, on: boolean, audience: "everyone" | "women_only" = "everyone") =>
  must(ppl[who]!.c.rpc("set_one_on_one", { p_on: on, p_audience: audience }), `${who} 1-on-1 ${on ? "on" : "off"}`);
const soloList = async (who: string) =>
  ((await must(ppl[who]!.c.rpc("solo_people", { p_gathering: g.Later }), `${who}'s 1-on-1 list`)) as { person_id: string }[])
    .map((r) => Object.keys(ppl).find((n) => ppl[n]!.id === r.person_id)).sort();
const handleSeen = async (who: string, of: string) =>
  ((await ppl[who]!.c.from("person_handles").select("instagram").eq("person_id", ppl[of]!.id)).data ?? []).length > 0;
let pairId = "";

test("P288 A: the switch is on the account: on, Ann is in Bob's 1-on-1 list wherever both are open to meeting; off, she CANNOT be; a person not switched on sees nobody", async () => {
  await pin("Dee", "Later");
  await oneOnOne("Bob", true);
  assert.deepEqual(await soloList("Bob"), [], "control: nobody else is switched on");
  await oneOnOne("Ann", true);
  assert.deepEqual(await soloList("Bob"), ["Ann"]);
  assert.deepEqual(await soloList("Cal"), [], "Cal, switched off, saw the 1-on-1 list");
  await oneOnOne("Ann", false);
  assert.deepEqual(await soloList("Bob"), [], "Ann switched off and still listed");
  // Nobody reads another's switch.
  assert.equal(((await ppl.Bob!.c.from("people_private").select("one_on_one").eq("person_id", ppl.Ann!.id)).data ?? []).length, 0);
});

test("P289 A: the audience is the switch's second line: women only, Ann CANNOT be seen by Bob and CAN by Dee", async () => {
  await oneOnOne("Ann", true, "women_only");
  await oneOnOne("Dee", true);
  assert.deepEqual(await soloList("Bob"), ["Dee"], "Bob saw Ann after she chose women only");
  assert.deepEqual(await soloList("Dee"), ["Ann", "Bob"]);
  assert.deepEqual(await must(ppl.Ann!.c.rpc("my_one_on_one"), "Ann's switch"), { on: true, audience: "women_only" });
});

test("P290 A: a request is waiting in Dee's Requests and nobody else's; 'Not now' is silent: Bob still sees 'sent'", async () => {
  await must(ppl.Bob!.c.rpc("propose_solo", { p_gathering: g.Later, p_to: ppl.Dee!.id, p_spot: null, p_meet_at: null, p_line: null }), "Bob asks Dee");
  const waiting = (await must(ppl.Dee!.c.rpc("my_solo_requests"), "Dee's requests")) as { proposal_id: string; first_name: string }[];
  assert.deepEqual(waiting.map((r) => r.first_name), ["Bob"]);
  for (const who of ["Ann", "Cal", "Bob"]) assert.equal(((await must(ppl[who]!.c.rpc("my_solo_requests"), `${who}'s requests`)) as unknown[]).length, 0, `${who} saw a request not theirs`);
  await must(ppl.Dee!.c.rpc("respond_to_solo", { p_proposal: waiting[0]!.proposal_id, p_accept: false }), "Dee: not now");
  assert.equal(((await must(ppl.Dee!.c.rpc("my_solo_requests"), "Dee's requests")) as unknown[]).length, 0, "a 'Not now' stayed in Requests");
  const bobs = (await must(ppl.Bob!.c.rpc("my_solo_proposals", { p_gathering: g.Later }), "Bob's requests")) as { direction: string }[];
  assert.deepEqual(bobs.map((r) => r.direction), ["sent"], "Bob learned of the 'Not now'");
});

test("P291 A: accepted, it is a chat; either of the two CAN set a curated place, the event itself or a time, nobody confirms; a stranger and another venue's spot CANNOT; handles show once a place is set, and go when it's taken away", async () => {
  await must(service.from("person_handles").upsert({ person_id: ppl.Ann!.id, instagram: `${run}ann` }), "Ann's handle");
  await must(ppl.Ann!.c.rpc("propose_solo", { p_gathering: g.Later, p_to: ppl.Dee!.id, p_spot: null, p_meet_at: null, p_line: null }), "Ann asks Dee");
  const req = ((await must(ppl.Dee!.c.rpc("my_solo_requests"), "Dee's requests")) as { proposal_id: string }[])[0]!;
  pairId = (await must(ppl.Dee!.c.rpc("respond_to_solo", { p_proposal: req.proposal_id, p_accept: true }), "Dee says yes")) as string;
  assert.equal(await handleSeen("Dee", "Ann"), false, "a handle showed before any place");
  const place = (who: string, s: string | null, atEvent: boolean, time: string | null) =>
    ppl[who]!.c.rpc("set_solo_place", { p_crew: pairId, p_spot: s, p_at_event: atEvent, p_time_note: time });
  await refused(place("Cal", spot, false, null), "42501", "solo_not_member");
  await refused(place("Dee", otherVenueSpot, false, null), "22023", "solo_spot");
  await refused(place("Dee", null, false, "t".repeat(41)), "22023", "solo_time_note");
  await must(place("Dee", spot, false, "around 5:30"), "Dee sets the place");
  const c1 = await must(service.from("crews").select("state, spot_id, at_event, time_note").eq("id", pairId).single(), "the chat");
  assert.deepEqual(c1, { state: "spot_set", spot_id: spot, at_event: false, time_note: "around 5:30" }, "the place needed a confirmation");
  assert.equal(await handleSeen("Dee", "Ann"), true, "no handle once a place was set");
  await must(place("Ann", null, true, "around 6"), "Ann changes it to the event itself");
  const c2 = await must(service.from("crews").select("state, spot_id, at_event, time_note").eq("id", pairId).single(), "the chat");
  assert.deepEqual(c2, { state: "spot_set", spot_id: null, at_event: true, time_note: "around 6" });
  await must(place("Ann", null, false, null), "Ann takes the place away");
  assert.equal(await handleSeen("Dee", "Ann"), false, "the handle stayed once the place was taken away");
  assert.equal(await handleSeen("Bob", "Ann"), false, "someone outside the chat saw the handle");
});

test("P292 A: switching the account off closes every request still waiting, both ways", async () => {
  await oneOnOne("Cal", true);
  await must(ppl.Cal!.c.rpc("propose_solo", { p_gathering: g.Later, p_to: ppl.Bob!.id, p_spot: null, p_meet_at: null, p_line: null }), "Cal asks Bob");
  assert.equal(((await must(ppl.Bob!.c.rpc("my_solo_requests"), "Bob's requests")) as unknown[]).length, 1, "control: the request is waiting");
  await oneOnOne("Bob", false);
  assert.equal(((await must(ppl.Bob!.c.rpc("my_solo_requests"), "Bob's requests")) as unknown[]).length, 0, "a request outlived the switch");
  const cals = (await must(ppl.Cal!.c.rpc("my_solo_proposals", { p_gathering: g.Later }), "Cal's requests")) as unknown[];
  assert.equal(cals.length, 0, "Cal's request stayed open to someone switched off");
});

// ---------------------------------------------------------------------------
// B  Keep in touch as a request and an accept (A16/A20; decision 2, calls d and e):
//    ask_keep / answer_keep / take_back_keep / my_keep_requests / keep_people.
// ---------------------------------------------------------------------------
const keepReqs = async (who: string) =>
  (await must(ppl[who]!.c.rpc("my_keep_requests"), `${who}'s keep requests`)) as { request_id: string; first_name: string; met_as: string }[];
const keepState = async (who: string, of: string) =>
  (((await must(ppl[who]!.c.rpc("keep_people", { p_gathering: g.Past }), `${who}'s cards`)) as { people: { person_id: string; state: string; met_as: string }[] }).people.find((p) => p.person_id === ppl[of]!.id)) ?? null;
const ask = (who: string, to: string) => ppl[who]!.c.rpc("ask_keep", { p_gathering: g.Past, p_to: ppl[to]!.id });
const connected = async (who: string, to: string) =>
  ((await must(ppl[who]!.c.rpc("my_connections"), `${who}'s connections`)) as { person_id: string }[]).some((c) => c.person_id === ppl[to]!.id);

// Everyone here is placed in the general room (Dee switches "women-only rooms only" off
// first); a women-only room opens only at three, so it is not where anyone speaks here.
const roomOf = async (who: string, womenOnly: boolean) =>
  (await must(service.from("room_members").select("room_id").eq("gathering_id", g.Past).eq("person_id", ppl[who]!.id).eq("women_only", womenOnly).single(), `${who}'s room`)).room_id as string;
const speak = async (who: string, womenOnly = false) =>
  must(ppl[who]!.c.from("room_messages").insert({ room_id: await roomOf(who, womenOnly), author_id: ppl[who]!.id, body: `hi from ${who}` }), `${who} speaks`);

test("P293 B: setup, the night is over: Ann and Bob shared a squad; Ann, Dee, Bob and Gus spoke in the room; Cal was in it and never spoke", async () => {
  // Ended two hours ago (no end time: the effective end is the start plus three hours).
  await gathering("Past", Date.now() - 5 * 3_600_000);
  await must(service.from("people_private").update({ women_only_rooms: false }).eq("person_id", ppl.Dee!.id), "Dee: the general room too");
  for (const n of ["Ann", "Bob", "Cal", "Dee", "Gus"]) await pin(n, "Past");
  const crew = (await must(service.from("crews").insert({ gathering_id: g.Past, kind: "crew", state: "done", name: "Pre-game", name_status: "approved", spot_id: spot, meet_at: new Date(Date.now() - 6 * 3_600_000).toISOString() }).select("id").single(), "a done squad")).id as string;
  for (const n of ["Ann", "Bob"]) await must(service.from("crew_members").insert({ crew_id: crew, gathering_id: g.Past, person_id: ppl[n]!.id }), `${n} in the squad`);
  await speak("Ann");
  await speak("Dee");
  await speak("Bob");
  await speak("Gus");
  assert.equal((await keepState("Ann", "Bob"))?.met_as, "squad");
  assert.equal((await keepState("Ann", "Dee"))?.met_as, "room");
  assert.equal((await keepState("Bob", "Gus"))?.met_as, "room");
  assert.equal(await keepState("Ann", "Cal"), null, "someone who never spoke is a card");
  assert.equal(await keepState("Cal", "Ann"), null, "a card for someone who never spoke");
});

test("P294 B: Ann CAN ask Bob (squad) and Dee (both spoke in the room); nobody CAN ask Cal (never spoke) or Fox (not there), and Cal CANNOT ask; only Bob sees Ann's request", async () => {
  assert.equal(await must(ask("Ann", "Bob"), "Ann asks Bob"), "sent");
  assert.equal(await must(ask("Ann", "Dee"), "Ann asks Dee"), "sent");
  await refused(ask("Ann", "Cal"), "42501", "keep_not_met");
  await refused(ask("Ann", "Fox"), "42501", "keep_not_met");
  await refused(ask("Cal", "Ann"), "42501", "keep_not_met");
  assert.deepEqual((await keepReqs("Bob")).map((r) => [r.first_name, r.met_as]), [["Ann", "squad"]]);
  for (const who of ["Cal", "Gus", "Ann"]) assert.equal((await keepReqs(who)).length, 0, `${who} saw a request not theirs`);
  assert.equal((await keepState("Ann", "Bob"))?.state, "sent");
  assert.equal((await keepState("Bob", "Ann"))?.state, "asked_me");
  await refused(ppl.Bob!.c.from("keep_requests").select("id"));
});

test("P295 B: 'Not now' is silent: Dee says it, the request leaves her Requests, Ann's card still says sent, and Ann CANNOT ask again", async () => {
  const r = (await keepReqs("Dee"))[0]!;
  await must(ppl.Dee!.c.rpc("answer_keep", { p_request: r.request_id, p_accept: false }), "Dee: not now");
  assert.equal((await keepReqs("Dee")).length, 0);
  assert.equal((await keepState("Ann", "Dee"))?.state, "sent", "Ann learned of the 'Not now'");
  assert.equal(await must(ask("Ann", "Dee"), "Ann asks again"), "sent");
  assert.equal((await keepReqs("Dee")).length, 0, "a second ask reached Dee after 'Not now'");
  assert.equal(await connected("Ann", "Dee"), false);
});

test("P296 B: Bob accepts: a connection on both sides, and the 'showed up' badge for both; asking each other connects at once", async () => {
  const r = (await keepReqs("Bob"))[0]!;
  await must(ppl.Bob!.c.rpc("answer_keep", { p_request: r.request_id, p_accept: true }), "Bob accepts");
  assert.equal(await connected("Ann", "Bob"), true);
  assert.equal(await connected("Bob", "Ann"), true);
  for (const [who, of] of [["Ann", "Ann"], ["Bob", "Ann"], ["Ann", "Bob"]] as const) {
    assert.equal(await must(ppl[who]!.c.rpc("showed_up", { p_person: ppl[of]!.id }), "badge"), true, `${who} does not see ${of}'s badge`);
  }
  assert.equal(await must(ppl.Cal!.c.rpc("showed_up", { p_person: ppl.Cal!.id }), "Cal's badge"), false, "a badge nobody earned");
  assert.equal((await keepState("Ann", "Bob"))?.state, "connected");
  assert.equal(await must(ask("Gus", "Bob"), "Gus asks Bob"), "sent");
  assert.equal(await must(ask("Bob", "Gus"), "Bob asks Gus"), "connected");
  assert.equal(await connected("Gus", "Bob"), true);
});

// #9, the keep-in-touch request's notification (UI pass 1, round 2; spec A18 #9).
const keepNotes = async (to: string, from: string) => {
  const reqs = (await must(service.from("keep_requests").select("id").eq("gathering_id", g.Past).eq("from_person", ppl[from]!.id).eq("to_person", ppl[to]!.id), "the request")) as { id: string }[];
  if (!reqs.length) return [];
  return (await must(service.from("notifications").select("id, kind, path").eq("person_id", ppl[to]!.id).eq("kind", "keep_request").in("keep_request_id", reqs.map((r) => r.id)), "its notifications")) as { id: string; kind: string; path: string }[];
};
const pendingIds = async () =>
  new Set(((await must(service.rpc("admin_pending_notifications", { p_limit: 100000 }), "the queue")) as { id: string }[]).map((n) => n.id));

test("P298 B #9: a request CAN notify the person asked, once, to Connections; CANNOT with their switch off, for an answered request, or to the asker; a test person is sent nowhere", async () => {
  // Answered ones (P294-P296): each was queued once, and none goes out now.
  const toBob = await keepNotes("Bob", "Ann");
  assert.equal(toBob.length, 1, "Ann's request to Bob was not queued, or queued twice");
  assert.equal(toBob[0]!.path, "/connections");
  const toDee = await keepNotes("Dee", "Ann");
  assert.equal(toDee.length, 1, "Ann's second ask after 'Not now' queued another");
  assert.equal((await keepNotes("Bob", "Gus")).length, 1);
  assert.equal((await keepNotes("Gus", "Bob")).length, 0, "asking back, which connects at once, notified");
  const queue = await pendingIds();
  for (const n of [...toBob, ...toDee]) assert.ok(!queue.has(n.id), "an accepted or 'Not now' request would still be sent");
  // An open one goes out, and a test person's carries no phone and no address (P162).
  assert.equal(await must(ask("Bob", "Dee"), "Bob asks Dee"), "sent");
  const open = await keepNotes("Dee", "Bob");
  assert.equal(open.length, 1, "an open request was not queued");
  const row = ((await must(service.rpc("admin_pending_notifications", { p_limit: 100000 }), "the queue")) as { id: string; tokens: string[]; email: string | null }[]).find((n) => n.id === open[0]!.id);
  if (row) {
    assert.deepEqual(row.tokens, [], "a test person would be pushed");
    assert.equal(row.email, null, "a test person would be emailed");
  } else {
    // Delivery ran in between: it must have sent nothing anywhere.
    const sent = (await must(service.from("notifications").select("sent_at, channel").eq("id", open[0]!.id).single(), "the row")) as { channel: string | null };
    assert.ok(!sent.channel || sent.channel === "none", `a test person's notification went out by ${sent.channel}`);
  }
  // Switched off: no notification at all.
  await must(service.from("notification_settings").upsert({ person_id: ppl.Dee!.id, keep_request: false }), "Dee switches #9 off");
  assert.equal(await must(ask("Gus", "Dee"), "Gus asks Dee"), "sent");
  assert.equal((await keepNotes("Dee", "Gus")).length, 0, "a switched-off person was notified");
  await must(service.from("notification_settings").update({ keep_request: true }).eq("person_id", ppl.Dee!.id), "Dee switches it back on");
});

test("P297 B: a request CAN be taken back while it waits; a block CANNOT be crossed and cancels what is waiting; nothing before the end or after 7 days", async () => {
  // Dee asks Ann (Ann's own request was "Not now"-ed, so this is Dee's first), then takes it back.
  assert.equal(await must(ask("Dee", "Ann"), "Dee asks Ann"), "sent");
  assert.equal((await keepReqs("Ann")).length, 1, "control: Dee's request is waiting");
  await must(ppl.Dee!.c.rpc("take_back_keep", { p_gathering: g.Past, p_to: ppl.Ann!.id }), "Dee takes it back");
  assert.equal((await keepReqs("Ann")).length, 0, "a taken-back request stayed in Requests");
  // Ann blocked Gus at the start: neither can ask the other.
  await refused(ask("Gus", "Ann"), "42501");
  await refused(ask("Ann", "Gus"), "42501");
  // A block made while a request waits cancels it; lifting the block does not bring it back.
  await speak("Cal");
  assert.equal(await must(ask("Cal", "Gus"), "Cal asks Gus"), "sent");
  assert.equal((await keepReqs("Gus")).length, 1, "control: Cal's request is waiting");
  await must(service.from("blocks").insert({ blocker_id: ppl.Gus!.id, blocked_id: ppl.Cal!.id }), "Gus blocks Cal");
  assert.equal((await keepReqs("Gus")).length, 0, "a block left the request waiting");
  await refused(ask("Cal", "Gus"), "42501", "keep_unavailable");
  await must(service.from("blocks").delete().eq("blocker_id", ppl.Gus!.id).eq("blocked_id", ppl.Cal!.id), "unblock");
  await must(ask("Cal", "Gus"), "Cal asks again after the unblock");
  assert.equal((await keepReqs("Gus")).length, 0, "a cancelled request came back after the unblock");
  // Before the end: Later has not ended. After 7 days: closed, both ways.
  await refused(ppl.Ann!.c.rpc("ask_keep", { p_gathering: g.Later, p_to: ppl.Bob!.id }), "42501", "keep_window");
  await must(service.from("gatherings").update({ starts_at: new Date(Date.now() - 9 * 86_400_000).toISOString() }).eq("id", g.Past), "eight days on");
  await refused(ask("Cal", "Bob"), "42501", "keep_window");
  assert.equal(((await must(ppl.Ann!.c.rpc("keep_people", { p_gathering: g.Past }), "cards")) as { open: boolean }).open, false);
});

test("P299 B #9: a request taken back, or cancelled by a block, was queued and CANNOT be sent", async () => {
  const takenBack = await keepNotes("Ann", "Dee");
  const blocked = await keepNotes("Gus", "Cal");
  assert.equal(takenBack.length, 1, "Dee's request to Ann was never queued");
  assert.equal(blocked.length, 1, "Cal's request to Gus was never queued");
  const queue = await pendingIds();
  assert.ok(!queue.has(takenBack[0]!.id), "a taken-back request would still be sent");
  assert.ok(!queue.has(blocked[0]!.id), "a request cancelled by a block would still be sent");
});
