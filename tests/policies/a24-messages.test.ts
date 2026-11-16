// A18 #10 (a new message), A24 (report and block) and the admin's ban (Alex, 16 Nov 2026).
// Each rule from the side that must be refused and the side let through.
//
//   P313  a squad message notifies every other member, once per 5 minutes, "Bea in <squad>",
//         never the words; not the author, not someone who just looked, not someone switched off
//   P314  a pair-chat message notifies the other, "Bea sent you a message", batched; not once
//         they've just looked
//   P315  never across a block, and a queued one is not delivered once a block lands
//   P316  a harness person's #10 is handed no device and no address (never sent)
//   P317  my blocks are listed to me only; unblocking is mine only, and gives back seeing each
//         other — never the connection
//   P318  a report alerts the admin except when a harness or seed person is in it; nobody but
//         the service key can ask or read the alert
//   P319  ban and unban: the service key's only; hide and log, then unhide and log
//
// Run with the harness: npm run test:policies.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "./env.ts";
import { SIGN_IN_WAIT_MS, newClient, must, passwordSignIn, removeUser, PREFIX } from "./world.ts";

const env = loadEnv();
const service = newClient(env, env.secretKey);
const anon = newClient(env, env.publishableKey);
const run = `am${randomBytes(3).toString("hex")}`;

interface P { name: string; id: string; authId: string; c: SupabaseClient }
const ppl: Record<string, P> = {};
let venue = "";
let G = "";
let squad = "";
let unmarked: { authId: string; id: string } | null = null;
const SQUAD = `${PREFIX} ${run} Section 314`;

async function mk(name: string, gender: "woman" | "man"): Promise<P> {
  const email = `${PREFIX}-${run}-${name.toLowerCase()}@example.com`;
  const password = randomUUID();
  const made = await service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { pind_harness: true } });
  if (made.error || !made.data.user) throw new Error(`create ${name}: ${made.error?.message}`);
  const authId = made.data.user.id;
  const row = await must(service.from("people").insert({ auth_user_id: authId, first_name: name, photo_path: `${authId}/face.png` }).select("id").single(), `person ${name}`);
  await must(service.from("people_private").insert({ person_id: row.id, gender, birth_year: 1993 }), `private ${name}`);
  await must(service.from("age_attestations").upsert({ person_id: row.id, source: "a26" }, { onConflict: "person_id", ignoreDuplicates: true }), `attest ${name}`);
  await must(service.from("pins").insert({ gathering_id: G, person_id: row.id, open_to_meeting: true, party_total: 1 }), `pin ${name}`);
  const c = newClient(env, env.publishableKey);
  const s = await passwordSignIn(c, { email, password });
  if (s.error) throw new Error(`sign in ${name}: ${s.error.message}`);
  return (ppl[name] = { name, id: row.id, authId, c });
}
const pings = async (who: string) =>
  (await must(service.from("notifications").select("id, body, title, crew_id, connection_id, sent_at").eq("person_id", ppl[who]!.id).eq("kind", "chat_message"), `${who}'s #10`)) as { id: string; body: string; title: string; crew_id: string | null; connection_id: string | null }[];
const clearPings = (names: string[]) => must(service.from("notifications").delete().in("person_id", names.map((n) => ppl[n]!.id)).eq("kind", "chat_message").select("id"), "clear #10");
const sayInSquad = (who: string, body: string) => ppl[who]!.c.from("crew_messages").insert({ crew_id: squad, author_id: ppl[who]!.id, kind: "user", body });
const pause = () => new Promise((r) => setTimeout(r, 3_200));
async function chatBetween(a: string, b: string): Promise<string> {
  for (const n of [a, b]) await must(ppl[n]!.c.rpc("set_event_one_on_one", { p_gathering: G, p_on: true, p_audience: "everyone" }), `${n} 1-on-1 on`);
  await must(ppl[a]!.c.rpc("propose_solo", { p_gathering: G, p_to: ppl[b]!.id, p_spot: null, p_meet_at: null, p_line: null }), `${a} asks ${b}`);
  const r = ((await must(ppl[b]!.c.rpc("my_solo_requests"), "requests")) as { proposal_id: string; person_id: string }[]).find((x) => x.person_id === ppl[a]!.id)!;
  await must(ppl[b]!.c.rpc("respond_to_solo", { p_proposal: r.proposal_id, p_accept: true }), `${b} says yes`);
  return (await must(ppl[a]!.c.rpc("connection_with", { p_other: ppl[b]!.id }), "the chat")) as string;
}
const sayInChat = (who: string, conn: string, body: string) => ppl[who]!.c.from("connection_messages").insert({ connection_id: conn, author_id: ppl[who]!.id, body });
const pending = async () => ((await must(service.rpc("admin_pending_notifications", { p_limit: 1000 }), "pending")) as { id: string; tokens: string[]; email: string | null }[]);

before(async () => {
  venue = (await must(service.from("venues").insert({ name: `${PREFIX} ${run} Arena` }).select("id").single(), "venue")).id;
  G = (await must(service.from("gatherings").insert({ name: `${PREFIX} ${run} Night`, starts_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), venue_id: venue, published_at: new Date().toISOString() }).select("id").single(), "gathering")).id;
  for (const [n, gen] of [["Ann", "woman"], ["Bea", "woman"], ["Cal", "man"], ["Dee", "woman"], ["Eve", "woman"], ["Fin", "man"], ["Gus", "man"]] as const) await mk(n, gen);
  squad = (await must(ppl.Ann!.c.rpc("start_squad", { p_gathering: G, p_name: SQUAD, p_details: null, p_spot: null, p_time_note: null, p_women_only: false }), "start")) as string;
  await must(service.rpc("admin_record_squad_name_check", { p_crew: squad, p_name: SQUAD, p_outcome: "approved", p_source: "harness" }), "approve the name");
  for (const n of ["Bea", "Cal", "Dee"]) await must(ppl[n]!.c.rpc("join_squad", { p_crew: squad }), `${n} joins`);
}, { timeout: 600_000 + SIGN_IN_WAIT_MS });

after(async () => {
  const ids = Object.values(ppl).map((p) => p.id);
  if (ids.length) {
    await service.from("blocks").delete().in("blocker_id", ids);
    await service.from("notifications").delete().in("person_id", ids);
    await service.from("reports").delete().in("reporter_id", ids);
    await service.from("moderation_log").delete().in("person_id", ids);
  }
  if (G) {
    await service.from("solo_proposals").delete().eq("gathering_id", G);
    await service.from("crews").delete().eq("gathering_id", G);
    await service.from("gatherings").delete().eq("id", G);
  }
  for (const p of Object.values(ppl)) await removeUser(service, p.authId).catch((e) => console.log(`# cleanup ${p.name}: ${e.message}`));
  if (unmarked) await removeUser(service, unmarked.authId).catch(() => undefined);
  if (venue) await service.from("venues").delete().eq("id", venue);
}, { timeout: 300_000 + SIGN_IN_WAIT_MS });

test("P313 a squad message notifies every other member, once per 5 minutes, 'Bea in <squad>', never the words; not the author, not someone who just looked, not someone switched off", async () => {
  await clearPings(["Ann", "Bea", "Cal", "Dee"]);
  // Dee just looked at the squad's chat; Cal switched #10 off.
  await must(ppl.Dee!.c.rpc("crew_seen", { p_crew: squad }), "Dee looks");
  await must(service.from("notification_settings").upsert({ person_id: ppl.Cal!.id, chat_message: false }).select("person_id"), "Cal switches #10 off");
  assert.equal((await sayInSquad("Bea", "pindsecret: meet by gate 4")).error, null, "Bea could not write in her squad");
  const ann = await pings("Ann");
  assert.equal(ann.length, 1, "a member was not told of a new message");
  assert.equal(ann[0]!.body, `Bea in ${SQUAD}`);
  assert.ok(!ann.some((n) => n.body.includes("pindsecret") || n.title.includes("pindsecret")), "the push carried the message");
  assert.equal((await pings("Bea")).length, 0, "the author was told of her own message");
  assert.equal((await pings("Dee")).length, 0, "someone who just looked was told");
  assert.equal((await pings("Cal")).length, 0, "someone who switched it off was told");
  // A second message inside the 5 minutes: still one.
  await pause();
  await must(sayInSquad("Bea", "and another"), "Bea again");
  assert.equal((await pings("Ann")).length, 1, "a second message inside 5 minutes sent a second push");
  // Someone outside the squad is never told.
  assert.equal((await pings("Eve")).length, 0, "someone outside the squad was told");
});

test("P314 a pair-chat message notifies the other, 'Bea sent you a message', batched; not once they've just looked", async () => {
  const conn = await chatBetween("Eve", "Fin");
  await clearPings(["Eve", "Fin"]);
  await must(sayInChat("Eve", conn, "pindsecret: the north door"), "Eve writes");
  const fin = await pings("Fin");
  assert.equal(fin.length, 1, "the other was not told");
  assert.equal(fin[0]!.body, "Eve sent you a message");
  assert.equal(fin[0]!.connection_id, conn);
  assert.ok(!fin[0]!.body.includes("pindsecret") && !fin[0]!.title.includes("pindsecret"), "the push carried the message");
  assert.equal((await pings("Eve")).length, 0, "the author was told");
  await pause();
  await must(sayInChat("Eve", conn, "hello?"), "Eve again");
  assert.equal((await pings("Fin")).length, 1, "a second message inside 5 minutes sent a second push");
  // Fin looks, Eve writes: nothing for someone who just looked.
  await clearPings(["Fin"]);
  await must(ppl.Fin!.c.rpc("connection_seen", { p_connection: conn }), "Fin looks");
  await pause();
  await must(sayInChat("Eve", conn, "you there"), "Eve, a third");
  assert.equal((await pings("Fin")).length, 0, "someone who just looked was told");
});

test("P315 never across a block, and a queued one is not delivered once a block lands", async () => {
  // Gus joins the squad and is told of Dee's message; then he blocks her.
  await clearPings(["Ann", "Cal", "Dee"]);
  await must(ppl.Gus!.c.rpc("join_squad", { p_crew: squad }), "Gus joins");
  await pause();
  await must(sayInSquad("Dee", "pindhx: who's here"), "Dee writes");
  const gus = await pings("Gus");
  assert.equal(gus.length, 1, "control: Gus was not told");
  assert.ok((await pending()).some((p) => p.id === gus[0]!.id), "control: Gus's #10 is not waiting to go");
  // Gus blocks Dee: his queued #10 from her is no longer delivered (he left the squad too).
  await must(ppl.Gus!.c.from("blocks").insert({ blocker_id: ppl.Gus!.id, blocked_id: ppl.Dee!.id }).select("blocker_id"), "Gus blocks Dee");
  assert.ok(!(await pending()).some((p) => p.id === gus[0]!.id), "a #10 was still delivered after a block");
  // Across a pair: Eve blocks Fin; then nothing she could write reaches him (the chat is gone).
  assert.equal((await must(ppl.Eve!.c.rpc("connection_with", { p_other: ppl.Fin!.id }), "chat")) !== null, true, "control: no chat");
  await must(ppl.Fin!.c.from("blocks").insert({ blocker_id: ppl.Fin!.id, blocked_id: ppl.Eve!.id }).select("blocker_id"), "Fin blocks Eve");
  assert.equal(await must(ppl.Eve!.c.rpc("connection_with", { p_other: ppl.Fin!.id }), "chat"), null, "the chat survived a block");
});

test("P316 a harness person's #10 is handed no device and no address (never sent)", async () => {
  await must(service.from("device_tokens").insert({ person_id: ppl.Ann!.id, token: `ExponentPushToken[${run}ann]`, platform: "ios" }).select("person_id"), "Ann's phone");
  try {
    await clearPings(["Ann"]);
    await pause();
    await must(sayInSquad("Cal", "pindhx: hi all"), "Cal writes");
    const ann = await pings("Ann");
    assert.equal(ann.length, 1, "control: no #10 for Ann");
    const row = (await pending()).find((p) => p.id === ann[0]!.id);
    assert.ok(row, "control: Ann's #10 is not in the delivery queue");
    assert.deepEqual([row!.tokens, row!.email], [[], null], "a harness person was handed a device or an address");
  } finally {
    await service.from("device_tokens").delete().eq("person_id", ppl.Ann!.id);
  }
});

test("P317 my blocks are listed to me only; unblocking is mine only, and gives back seeing each other — never the connection", async () => {
  // Fin blocked Eve (P315).
  const fins = (await must(ppl.Fin!.c.rpc("my_blocks"), "Fin's blocks")) as { person_id: string }[];
  assert.deepEqual(fins.map((b) => b.person_id), [ppl.Eve!.id], "Fin's blocks are not his to read");
  assert.equal(((await must(ppl.Eve!.c.rpc("my_blocks"), "Eve's blocks")) as unknown[]).length, 0, "the blocked one can read who blocked her");
  assert.ok((await anon.rpc("my_blocks")).error || ((await anon.rpc("my_blocks")).data ?? []).length === 0, "a visitor read blocks");
  const sees = async (who: string, of: string) => ((await ppl[who]!.c.from("people").select("id").eq("id", ppl[of]!.id)).data ?? []).length === 1;
  assert.ok(!(await sees("Eve", "Fin")) && !(await sees("Fin", "Eve")), "control: blocked, they still see each other");
  // Eve cannot lift Fin's block.
  await must(ppl.Eve!.c.rpc("unblock_person", { p_person: ppl.Fin!.id }), "Eve tries");
  assert.equal(((await must(ppl.Fin!.c.rpc("my_blocks"), "Fin's blocks")) as unknown[]).length, 1, "the blocked one lifted the block");
  await must(ppl.Fin!.c.rpc("unblock_person", { p_person: ppl.Eve!.id }), "Fin unblocks");
  assert.equal(((await must(ppl.Fin!.c.rpc("my_blocks"), "Fin's blocks")) as unknown[]).length, 0);
  assert.ok((await sees("Eve", "Fin")) && (await sees("Fin", "Eve")), "unblocking did not give back seeing each other at the event");
  assert.equal(await must(ppl.Eve!.c.rpc("connection_with", { p_other: ppl.Fin!.id }), "chat"), null, "unblocking brought the connection back");
  assert.ok((await anon.rpc("unblock_person", { p_person: ppl.Eve!.id })).error, "a visitor unblocked");
});

test("P318 a report alerts the admin except when a harness or seed person is in it; nobody but the service key can ask or read the alert", async () => {
  // A person with no harness mark, made for this case only (removed with their account after).
  const made = await service.auth.admin.createUser({ email: `${PREFIX}-${run}-real@example.com`, password: randomUUID(), email_confirm: true });
  if (made.error || !made.data.user) throw new Error(made.error?.message);
  const row = await must(service.from("people").insert({ auth_user_id: made.data.user.id, first_name: "Real" }).select("id").single(), "real person");
  unmarked = { authId: made.data.user.id, id: row.id };
  const { data: seed } = await service.from("people").select("id").eq("is_seed", true).limit(1);
  const wanted = async (a: string, b: string | null) => (await must(service.rpc("admin_report_alert_wanted", { p_reporter: a, p_target: b }), "wanted")) as boolean;
  assert.equal(await wanted(unmarked.id, unmarked.id), true, "a real report would not alert the admin");
  assert.equal(await wanted(unmarked.id, null), true, "a real report on a squad would not alert the admin");
  assert.equal(await wanted(ppl.Ann!.id, unmarked.id), false, "a harness reporter alerted the admin");
  assert.equal(await wanted(unmarked.id, ppl.Ann!.id), false, "a report on a harness person alerted the admin");
  if (seed?.[0]) assert.equal(await wanted(unmarked.id, seed[0].id), false, "a report on a seed person alerted the admin");
  for (const c of [ppl.Ann!.c, anon]) {
    assert.ok((await c.rpc("admin_report_alert_wanted", { p_reporter: ppl.Ann!.id, p_target: null })).error, "a session asked the alert rule");
    assert.ok((await c.rpc("admin_report_alert", { p_report: randomUUID() })).error, "a session read an alert");
  }
});

test("P319 ban and unban: the service key's only; hide and log, then unhide and log", async () => {
  for (const c of [ppl.Ann!.c, anon]) {
    assert.ok((await c.rpc("admin_ban_person", { p_person: ppl.Gus!.id, p_actor: "x" })).error, "a session banned someone");
    assert.ok((await c.rpc("admin_unban_person", { p_person: ppl.Gus!.id, p_actor: "x" })).error, "a session unbanned someone");
  }
  const authId = await must(service.rpc("admin_ban_person", { p_person: ppl.Gus!.id, p_actor: `${PREFIX}@example.com`, p_note: run }), "ban");
  assert.equal(authId, ppl.Gus!.authId, "the ban did not hand back the account to lock");
  const hidden = (await must(service.from("people").select("hidden_at").eq("id", ppl.Gus!.id).single(), "Gus")) as { hidden_at: string | null };
  assert.ok(hidden.hidden_at, "a ban did not hide");
  await must(service.rpc("admin_unban_person", { p_person: ppl.Gus!.id, p_actor: `${PREFIX}@example.com`, p_note: run }), "unban");
  const back = (await must(service.from("people").select("hidden_at").eq("id", ppl.Gus!.id).single(), "Gus")) as { hidden_at: string | null };
  assert.equal(back.hidden_at, null, "an unban did not unhide");
  const log = ((await must(service.from("moderation_log").select("action").eq("person_id", ppl.Gus!.id).in("action", ["ban", "unban"]).order("at"), "log")) as { action: string }[]).map((l) => l.action);
  assert.deepEqual(log, ["ban", "unban"], "the ban or the unban went unlogged");
});
