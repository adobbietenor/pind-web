// 1-on-1 (A9, A28, A29, A20, A22). Rebuilt for build 23 (Alex, 16 Nov 2026): an accept makes
// a connection and the pair's one chat; nothing needs a place or time; requests run to the
// event's effective end; calling off, removing, blocking or reporting ends the connection and
// the chat, silently. Each rule from the side that must be refused and the side let through.
//
//   P267  a request names no spot and no time; half of one is refused; both see it listed
//   P268  accepted, it is a pair, and the two are connections with one chat: they read and write
//         it — nobody else reads the pair, its members or its chat, or writes in it
//   P269  a pair counts as your one 1-on-1: off everyone else's list, nothing else sent or accepted
//   P270  before the yes: no Instagram, not a connection; after: both (V17 through the connection)
//   P271  no place, ever: a venue with no meeting spots offers 1-on-1; a pair goes live and done
//         with no place, and the day-of push says it is on; a place stays optional
//   P272  requests run to the effective end: sent and accepted during the night, refused after;
//         the chat outlives the event (not Q11's 30 days)
//   P273  the lifecycle tick never closes a pair as an under-three group
//   P274  a block ends the pair, the connection and the chat — and tells nobody
//   P275  the brake, pulled, ends every pair that has no place and tells both; a plan stands
//   P308  calling it off ends the pair, the connection and the chat for both, silently
//   P309  either can remove the connection: the chat goes for both, a 1-on-1 still on is off
//   P310  reporting the other ends the connection and the chat
//   P311  a keep-in-touch connection has the same one chat: its two CAN, anyone else CANNOT
//   P312  the chat is closed to a visitor, and to the partner of someone hidden by H9
//
// Run with the harness: npm run test:policies.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "./env.ts";
import { SIGN_IN_WAIT_MS, newClient, must, handleFor, passwordSignIn, removeUser, PREFIX } from "./world.ts";

const env = loadEnv();
const service = newClient(env, env.secretKey);
const anon = newClient(env, env.publishableKey);
const run = `pr${randomBytes(3).toString("hex")}`;

interface P { name: string; id: string; authId: string; c: SupabaseClient }
const ppl: Record<string, P> = {};
const g: Record<string, string> = {};
let venue = "";
let bareVenue = ""; // no meeting spots at all
let spots: string[] = [];
let startT = 0;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function mk(name: string, gender: "woman" | "man"): Promise<P> {
  const email = `${PREFIX}-${run}-${name.toLowerCase()}@example.com`;
  const password = randomUUID();
  const made = await service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { pind_harness: true } });
  if (made.error || !made.data.user) throw new Error(`create ${name}: ${made.error?.message}`);
  const authId = made.data.user.id;
  const row = await must(service.from("people").insert({ auth_user_id: authId, first_name: name, neighbourhood: "king-west", photo_path: `${authId}/face.png` }).select("id").single(), `person ${name}`);
  await must(service.from("person_handles").insert({ person_id: row.id, instagram: handleFor(run, name) }), `handle ${name}`);
  await must(service.from("people_private").insert({ person_id: row.id, gender, birth_year: 1993 }), `private ${name}`);
  await must(service.from("age_attestations").upsert({ person_id: row.id, source: "a26" }, { onConflict: "person_id", ignoreDuplicates: true }), `attest ${name}`);
  const c = newClient(env, env.publishableKey);
  const s = await passwordSignIn(c, { email, password });
  if (s.error) throw new Error(`sign in ${name}: ${s.error.message}`);
  return (ppl[name] = { name, id: row.id, authId, c });
}
async function gathering(label: string, startsAt = startT, at = venue): Promise<string> {
  const row = await must(service.from("gatherings").insert({ name: `${PREFIX} ${run} ${label}`, starts_at: new Date(startsAt).toISOString(), venue_id: at, published_at: new Date(startsAt - 7 * DAY).toISOString() }).select("id").single(), `gathering ${label}`);
  return (g[label] = row.id);
}
const moveStart = (G: string, at: number) =>
  must(service.from("gatherings").update({ starts_at: new Date(at).toISOString() }).eq("id", g[G]).select("id"), `move ${G}`);
async function soloOn(name: string, G: string) {
  await must(service.from("pins").insert({ gathering_id: g[G], person_id: ppl[name]!.id, open_to_meeting: true, party_total: 1 }), `pin ${name}`);
  await must(ppl[name]!.c.rpc("set_event_one_on_one", { p_gathering: g[G], p_on: true, p_audience: "everyone" }), `${name} 1-on-1 on`);
}
const invite = (from: string, to: string, G: string) =>
  ppl[from]!.c.rpc("propose_solo", { p_gathering: g[G], p_to: ppl[to]!.id, p_spot: null, p_meet_at: null, p_line: null });
const listed = async (who: string, G: string) =>
  (await must(ppl[who]!.c.rpc("my_solo_proposals", { p_gathering: g[G] }), `${who}'s requests`)) as { proposal_id: string; direction: string; person_id: string; spot_id: string | null; meet_at: string | null }[];
const soloPeople = async (who: string, G: string) =>
  ((await must(ppl[who]!.c.rpc("solo_people", { p_gathering: g[G] }), `${who}'s 1-on-1 list`)) as { person_id: string }[])
    .map((r) => Object.keys(ppl).find((n) => ppl[n]!.id === r.person_id)).sort();
async function pair(a: string, b: string, G: string): Promise<string> {
  await must(invite(a, b, G), `${a} invites ${b}`);
  const r = (await listed(b, G)).find((x) => x.direction === "received" && x.person_id === ppl[a]!.id)!;
  return (await must(ppl[b]!.c.rpc("respond_to_solo", { p_proposal: r.proposal_id, p_accept: true }), `${b} says yes`)) as string;
}
const crewOf = (crew: string) => must(service.from("crews").select("state, spot_id, meet_at").eq("id", crew).single(), "crew");
const notes = async (who: string, crew: string) =>
  (await must(service.from("notifications").select("body, kind").eq("person_id", ppl[who]!.id).eq("crew_id", crew), "notes")) as { body: string; kind: string }[];
// The pair's chat, as each of them can reach it.
const chatWith = async (who: string, other: string) =>
  (await ppl[who]!.c.rpc("connection_with", { p_other: ppl[other]!.id })).data as string | null;
const connectionRow = async (a: string, b: string) =>
  ((await must(service.from("connections").select("id").or(`and(person_a.eq.${ppl[a]!.id},person_b.eq.${ppl[b]!.id}),and(person_a.eq.${ppl[b]!.id},person_b.eq.${ppl[a]!.id})`), "connection")) as { id: string }[])[0]?.id ?? null;
const say = (who: string, conn: string, body: string) =>
  ppl[who]!.c.from("connection_messages").insert({ connection_id: conn, author_id: ppl[who]!.id, body });
const reads = async (who: string, conn: string) => ((await ppl[who]!.c.from("connection_messages").select("id").eq("connection_id", conn)).data ?? []).length;
const myConnections = async (who: string) =>
  ((await must(ppl[who]!.c.rpc("my_connections"), `${who}'s connections`)) as { person_id: string; one_on_one: boolean; connection_id: string }[]);
const pause = () => new Promise((r) => setTimeout(r, 3_200)); // the chat's one-message-every-3-seconds

before(async () => {
  venue = (await must(service.from("venues").insert({ name: `${PREFIX} ${run} Arena` }).select("id").single(), "venue")).id;
  bareVenue = (await must(service.from("venues").insert({ name: `${PREFIX} ${run} Bare Hall` }).select("id").single(), "bare venue")).id;
  spots = ((await must(service.from("meeting_spots").insert(["North Gate", "Patio Bar"].map((name) => ({ venue_id: venue, name }))).select("id"), "spots")) as { id: string }[]).map((s) => s.id);
  startT = Math.ceil((Date.now() + 5 * DAY) / 900_000) * 900_000;
  for (const [n, gen] of [["Ann", "woman"], ["Bob", "man"], ["Cal", "man"], ["Dee", "woman"], ["Eve", "woman"], ["Fin", "man"], ["Gus", "man"], ["Hal", "man"], ["Ivy", "woman"], ["Jon", "man"], ["Kim", "woman"], ["Leo", "man"], ["Mia", "woman"], ["Ned", "man"]] as const) await mk(n, gen);
}, { timeout: 600_000 + SIGN_IN_WAIT_MS });

after(async () => {
  await service.rpc("admin_set_solo_brake", { p_pulled: false, p_actor: `${PREFIX}@example.com` });
  const ids = Object.values(ppl).map((p) => p.id);
  if (ids.length) {
    await service.from("blocks").delete().in("blocker_id", ids);
    await service.from("notifications").delete().in("person_id", ids);
    await service.from("reports").delete().in("reporter_id", ids);
    await service.from("people").update({ hidden_at: null }).in("id", ids);
  }
  const gids = Object.values(g);
  if (gids.length) {
    const crewIds = ((await must(service.from("crews").select("id").in("gathering_id", gids), "crews")) as { id: string }[]).map((c) => c.id);
    if (crewIds.length) await service.from("confirmations").delete().in("crew_id", crewIds);
    await service.from("solo_proposals").delete().in("gathering_id", gids);
    await service.from("crews").delete().in("gathering_id", gids);
    await service.from("moderation_log").delete().in("gathering_id", gids);
    await service.from("gatherings").delete().in("id", gids);
  }
  for (const p of Object.values(ppl)) await removeUser(service, p.authId).catch((e) => console.log(`# cleanup ${p.name}: ${e.message}`));
  for (const v of [venue, bareVenue].filter(Boolean)) {
    await service.from("meeting_spots").delete().eq("venue_id", v);
    await service.from("venues").delete().eq("id", v);
  }
  const left = await must(service.from("person_handles").select("person_id").like("instagram", `${PREFIX}_${run}_%`), "left people");
  const leftG = await must(service.from("gatherings").select("id").like("name", `${PREFIX} ${run} %`), "left gatherings");
  assert.deepEqual({ people: left.length, gatherings: leftG.length }, { people: 0, gatherings: 0 }, "this run left its own rows behind");
}, { timeout: 300_000 + SIGN_IN_WAIT_MS });

test("P267 a request names no spot and no time; half of one is refused; both see it listed", async () => {
  await gathering("A");
  for (const n of ["Ann", "Bob"]) await soloOn(n, "A");
  const half = await ppl.Ann!.c.rpc("propose_solo", { p_gathering: g.A, p_to: ppl.Bob!.id, p_spot: spots[0], p_meet_at: null, p_line: null });
  assert.ok(half.error, "a request with a spot and no time was accepted");
  assert.equal((await invite("Ann", "Bob", "A")).error, null, "the request was refused");
  const sent = (await listed("Ann", "A")).find((r) => r.direction === "sent");
  const got = (await listed("Bob", "A")).find((r) => r.direction === "received");
  assert.ok(sent && got, "the request is missing from a list");
  assert.deepEqual([got.spot_id, got.meet_at], [null, null]);
});

test("P268 accepted, it is a pair, and the two are connections with one chat: they read and write it — nobody else reads the pair, its members or its chat, or writes in it", async () => {
  await soloOn("Cal", "A");
  const crew = await pair("Cal", "Ann", "A");
  assert.deepEqual(await crewOf(crew), { state: "forming", spot_id: null, meet_at: null }, "an accepted request is not a pair");
  const conn = await chatWith("Ann", "Cal");
  assert.ok(conn, "the yes made no connection, or Ann cannot reach its chat");
  assert.equal(await chatWith("Cal", "Ann"), conn, "the two reach different chats — one chat per pair");
  assert.equal((await say("Ann", conn!, "hi Cal")).error, null, "Ann cannot write in the pair's chat");
  assert.equal((await say("Cal", conn!, "hi Ann")).error, null, "Cal cannot write in the pair's chat");
  assert.equal(await reads("Ann", conn!), 2, "the pair cannot read its own chat");
  assert.ok((await myConnections("Ann")).some((c) => c.person_id === ppl.Cal!.id && c.one_on_one), "Connections does not list the 1-on-1");
  // Bob was at the same gathering, in 1-on-1, and asked Ann: still nothing of the pair.
  assert.equal(await chatWith("Bob", "Ann"), null, "an outsider reached the pair's chat");
  for (const [what, q] of [
    ["the pair", ppl.Bob!.c.from("crews").select("id").eq("id", crew)],
    ["its members", ppl.Bob!.c.from("crew_members").select("person_id").eq("crew_id", crew)],
    ["its chat", ppl.Bob!.c.from("connection_messages").select("id").eq("connection_id", conn!)],
  ] as const) {
    const { data } = await q;
    assert.equal((data ?? []).length, 0, `someone outside the pair read ${what}`);
  }
  assert.ok((await say("Bob", conn!, "me too")).error, "someone outside the pair wrote in its chat");
  assert.ok((await ppl.Bob!.c.rpc("connection_chat", { p_connection: conn })).data?.length === 0, "an outsider read who is in the chat");
  g.pairAC = crew;
});

test("P269 a pair counts as your one 1-on-1: off everyone else's list, nothing else sent or accepted", async () => {
  const bobSees = await soloPeople("Bob", "A");
  assert.ok(!bobSees.includes("Ann") && !bobSees.includes("Cal"), "someone in a pair is still on another's 1-on-1 list");
  assert.ok((await invite("Ann", "Bob", "A")).error, "someone in a pair sent another request");
  assert.ok((await invite("Bob", "Cal", "A")).error, "someone in a pair was sent a request");
  assert.ok(!(await listed("Bob", "A")).some((r) => r.person_id === ppl.Ann!.id), "a request to someone now in a pair is still open");
});

test("P270 before the yes: no Instagram, not a connection; after: both (V17 through the connection)", async () => {
  await gathering("B");
  for (const n of ["Dee", "Eve"]) await soloOn(n, "B");
  const handle = async (who: string, of: string) => ((await ppl[who]!.c.from("person_handles").select("instagram").eq("person_id", ppl[of]!.id)).data ?? []).length;
  assert.equal(await handle("Dee", "Eve"), 0, "Instagram showed before a yes");
  assert.equal(await chatWith("Dee", "Eve"), null, "a chat existed before a yes");
  assert.ok(!(await myConnections("Dee")).some((c) => c.person_id === ppl.Eve!.id), "a connection before a yes");
  g.pairDE = await pair("Dee", "Eve", "B");
  assert.equal(await handle("Dee", "Eve"), 1, "the partner's handle is hidden after the yes");
  assert.equal(await handle("Eve", "Dee"), 1, "the partner's handle is hidden after the yes, the other way");
});

test("P308 calling it off ends the pair, the connection and the chat for both, silently", async () => {
  // Ann and Cal (P268).
  const conn = (await chatWith("Ann", "Cal"))!;
  assert.ok(conn, "control: no chat");
  await must(ppl.Cal!.c.rpc("leave_group", { p_crew: g.pairAC }), "Cal calls it off");
  assert.equal((await crewOf(g.pairAC!)).state, "dissolved", "calling off left the pair");
  assert.equal(await connectionRow("Ann", "Cal"), null, "calling off left the connection");
  for (const who of ["Ann", "Cal"]) assert.equal(await reads(who, conn), 0, `${who} still reads the chat`);
  assert.ok((await say("Ann", conn, "hello?")).error, "the chat took a message after the call-off");
  assert.equal((await notes("Ann", g.pairAC!)).filter((n) => n.kind === "plan_status" && /off/.test(n.body)).length, 0, "the other was told");
  assert.ok(!(await myConnections("Ann")).some((c) => c.person_id === ppl.Cal!.id), "Connections still lists the call-off");
});

test("P271 no place, ever: a venue with no meeting spots offers 1-on-1; a pair goes live and done with no place, and the day-of push says it is on; a place stays optional", async () => {
  // Two hours off, at a venue with no spots: refused before 16 Nov ("no meeting spots").
  await gathering("C", Math.ceil((Date.now() + 2 * HOUR) / 900_000) * 900_000, bareVenue);
  for (const n of ["Fin", "Gus"]) await soloOn(n, "C");
  const crew = await pair("Fin", "Gus", "C");
  await must(service.rpc("admin_groups_tick"), "the tick, inside 3 h of the start");
  assert.equal((await crewOf(crew)).state, "live", "a pair with no place did not go live on the night");
  assert.ok((await notes("Fin", crew)).some((n) => n.kind === "day_of" && /your 1-on-1 is on/.test(n.body)), "the day-of push named no 1-on-1, or a place it hasn't got");
  // The optional place: either may add one, nobody confirms, and nothing waits on it.
  await must(ppl.Gus!.c.rpc("set_solo_place", { p_crew: crew, p_spot: null, p_at_event: true, p_time_note: "around 7" }), "Gus adds a place");
  assert.equal((await crewOf(crew)).state, "live", "adding a place moved a live 1-on-1");
  // After the end: done, with A16's morning after to come.
  await moveStart("C", Date.now() - 4 * HOUR);
  // Going live gave it the start as its time; that time moves with the start (as P169's squad).
  await must(service.from("crews").update({ meet_at: new Date(Date.now() - 4 * HOUR).toISOString() }).eq("id", crew).select("id"), "its time moves too");
  await must(service.rpc("admin_groups_tick"), "the tick after the end");
  assert.equal((await crewOf(crew)).state, "done", "a pair did not finish at the end");
  g.pairFG = crew;
});

test("P272 requests run to the effective end: sent and accepted during the night, refused after; the chat outlives the event", async () => {
  // The night began an hour ago; it ends in two (starts + 180 min).
  await gathering("D", Date.now() - HOUR);
  for (const n of ["Hal", "Ivy", "Kim"]) await soloOn(n, "D");
  assert.equal((await invite("Hal", "Ivy", "D")).error, null, "a request during the night was refused");
  const r = (await listed("Ivy", "D")).find((x) => x.direction === "received")!;
  assert.ok(r, "a request during the night is not listed to its recipient");
  const crew = (await must(ppl.Ivy!.c.rpc("respond_to_solo", { p_proposal: r.proposal_id, p_accept: true }), "Ivy says yes during the night")) as string;
  assert.ok(crew, "a yes during the night made no 1-on-1");
  // After the end: nothing new.
  await moveStart("D", Date.now() - 4 * HOUR);
  // Hal is in a 1-on-1 here, which would refuse Kim anyway — so insist on the reason.
  assert.match((await invite("Kim", "Hal", "D")).error?.message ?? "", /closed at the end/, "a request after the end was not refused for the end");
  // Forty days later — past Q11's 30 for event chats — the pair's chat is still theirs.
  await moveStart("D", Date.now() - 40 * DAY);
  const conn = (await chatWith("Hal", "Ivy"))!;
  assert.ok(conn, "the chat went with the event");
  assert.equal((await say("Hal", conn, "still here")).error, null, "the chat closed with the event");
  assert.equal(await reads("Ivy", conn), 1, "the other cannot read the chat after the event");
});

test("P273 the lifecycle tick never closes a pair as an under-three group", async () => {
  // The squads' rule closes a forming group under 3 once now passes
  // least(greatest(start − 6 h, created + 2 h), start − 3 h): five hours off, made three hours ago.
  const startsAt = Math.ceil((Date.now() + 5 * HOUR) / 900_000) * 900_000;
  await gathering("E", startsAt);
  for (const n of ["Jon", "Leo"]) await soloOn(n, "E");
  const crew = await pair("Jon", "Leo", "E");
  const created = Date.now() - 3 * HOUR;
  await must(service.from("crews").update({ created_at: new Date(created).toISOString() }).eq("id", crew), "made three hours ago");
  const oldDeadline = Math.min(Math.max(startsAt - 6 * HOUR, created + 2 * HOUR), startsAt - 3 * HOUR);
  assert.ok(Date.now() >= oldDeadline, "setup: the squads' deadline has not passed — the case would prove nothing");
  await must(service.rpc("admin_groups_tick"), "the tick");
  assert.equal((await crewOf(crew)).state, "forming", "the tick closed a pair as an under-three group, or moved it early");
  g.pairJL = crew;
});

test("P274 a block ends the pair, the connection and the chat — and tells nobody", async () => {
  const conn = (await chatWith("Jon", "Leo"))!;
  assert.ok(conn, "control: no chat to end");
  assert.equal((await ppl.Jon!.c.from("blocks").insert({ blocker_id: ppl.Jon!.id, blocked_id: ppl.Leo!.id })).error, null, "Jon could not block Leo");
  assert.equal((await crewOf(g.pairJL!)).state, "dissolved", "a block did not end the pair");
  assert.equal(await connectionRow("Jon", "Leo"), null, "a block left the connection");
  for (const [who, other] of [["Jon", "Leo"], ["Leo", "Jon"]] as const) {
    assert.equal(await chatWith(who, other), null, `${who} can still reach the chat`);
    assert.equal(await reads(who, conn), 0, `${who} can still read the chat`);
  }
  assert.equal((await notes("Leo", g.pairJL!)).filter((n) => n.kind === "plan_status" && /off/.test(n.body)).length, 0, "the blocked one was told");
});

test("P275 the brake, pulled, ends every pair that has no place and tells both; a plan stands", async () => {
  // Dee and Eve's 1-on-1 (P270) gets a place: a plan.
  await must(ppl.Dee!.c.rpc("set_solo_place", { p_crew: g.pairDE, p_spot: spots[0], p_at_event: false, p_time_note: null }), "Dee adds a place");
  assert.equal((await crewOf(g.pairDE!)).state, "spot_set", "setup: no plan");
  await gathering("F");
  for (const n of ["Mia", "Bob"]) await soloOn(n, "F");
  const p = await pair("Mia", "Bob", "F");
  try {
    await must(service.rpc("admin_set_solo_brake", { p_pulled: true, p_actor: `${PREFIX}@example.com` }), "pull");
    assert.equal((await crewOf(p)).state, "dissolved", "the brake left a pair standing");
    for (const n of ["Mia", "Bob"]) assert.ok((await notes(n, p)).some((x) => / is off\.$/.test(x.body)), `${n} was not told the pair is off`);
    assert.equal((await crewOf(g.pairDE!)).state, "spot_set", "the brake ended a plan");
  } finally {
    await must(service.rpc("admin_set_solo_brake", { p_pulled: false, p_actor: `${PREFIX}@example.com` }), "lift");
  }
});

test("P309 either can remove the connection: the chat goes for both, a 1-on-1 still on is off", async () => {
  // Dee and Eve's plan (P275 gave it a place) is still on.
  const conn = (await chatWith("Eve", "Dee"))!;
  assert.ok(conn, "control: no chat");
  await must(ppl.Eve!.c.rpc("remove_connection", { p_other: ppl.Dee!.id }), "Eve removes Dee");
  assert.equal(await connectionRow("Dee", "Eve"), null, "the connection stayed");
  for (const who of ["Dee", "Eve"]) assert.equal(await reads(who, conn), 0, `${who} still reads the chat`);
  assert.equal((await crewOf(g.pairDE!)).state, "dissolved", "the 1-on-1 still on survived its connection");
  // Someone not connected removes nothing of anyone's.
  assert.equal((await ppl.Bob!.c.rpc("remove_connection", { p_other: ppl.Hal!.id })).error, null);
  assert.ok(await connectionRow("Hal", "Ivy"), "removing a stranger touched someone else's connection");
});

test("P310 reporting the other ends the connection and the chat", async () => {
  // Fin and Gus (P271), done after the night, still connected.
  const conn = (await chatWith("Fin", "Gus"))!;
  assert.ok(conn, "control: no chat");
  assert.equal((await ppl.Fin!.c.from("reports").insert({ reporter_id: ppl.Fin!.id, target_kind: "person", target_person_id: ppl.Gus!.id, reason: "spam" })).error, null, "Fin could not report Gus from his profile");
  assert.equal(await connectionRow("Fin", "Gus"), null, "a report left the connection");
  for (const who of ["Fin", "Gus"]) assert.equal(await reads(who, conn), 0, `${who} still reads the chat`);
});

test("P311 a keep-in-touch connection has the same one chat: its two CAN, anyone else CANNOT", async () => {
  // Kim and Ned met in a squad; kept in touch (as A16's accept writes it).
  const [a, b] = [ppl.Kim!.id, ppl.Ned!.id].sort();
  await must(service.from("connections").insert({ person_a: a, person_b: b, source_gathering_id: g.D }).select("id"), "kept in touch");
  const conn = (await chatWith("Kim", "Ned"))!;
  assert.ok(conn, "a kept connection has no chat");
  assert.equal(await chatWith("Ned", "Kim"), conn);
  assert.equal((await say("Ned", conn, "good to meet you")).error, null, "a kept connection cannot write");
  assert.equal(await reads("Kim", conn), 1, "a kept connection cannot read");
  assert.equal(await reads("Bob", conn), 0, "an outsider read a kept connection's chat");
  assert.ok((await say("Bob", conn, "hi")).error, "an outsider wrote in a kept connection's chat");
  assert.ok((await ppl.Bob!.c.from("connection_messages").insert({ connection_id: conn, author_id: ppl.Kim!.id, body: "forged" })).error, "someone wrote as another");
  assert.ok((await myConnections("Kim")).some((c) => c.person_id === ppl.Ned!.id && !c.one_on_one), "Connections does not list the kept connection");
});

test("P312 the chat is closed to a visitor, and to the partner of someone hidden by H9", async () => {
  const conn = (await chatWith("Kim", "Ned"))!;
  assert.equal(((await anon.from("connection_messages").select("id").eq("connection_id", conn)).data ?? []).length, 0, "a visitor read the chat");
  assert.ok((await anon.from("connection_messages").insert({ connection_id: conn, author_id: ppl.Kim!.id, body: "x" })).error, "a visitor wrote in the chat");
  await must(service.from("people").update({ hidden_at: new Date().toISOString() }).eq("id", ppl.Ned!.id).select("id"), "Ned hidden");
  try {
    assert.equal(await reads("Kim", conn), 0, "the chat still showed a hidden person's words");
    await pause();
    assert.ok((await say("Kim", conn, "hello?")).error, "the chat took a message to a hidden person");
  } finally {
    await must(service.from("people").update({ hidden_at: null }).eq("id", ppl.Ned!.id).select("id"), "Ned unhidden");
  }
  assert.equal(await reads("Kim", conn), 1, "control: unhidden, the chat did not come back (V20's reversibility)");
});
