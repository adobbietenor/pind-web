// Independent adversarial review of V20 (the room), V21 (small groups), V22
// (notifications) and V23 (after the night, connections, "women-only rooms only").
//
// Phase 1 cases (R01…) were written from the rules alone — decisions.md, build-plan
// §8 M3.3, visibility.md — and the PostgREST map, before any M3.3 SQL was read.
// Phase 2 cases (numbered after them) came from reading the migrations.
//
// Each case names the rule it attacks and asserts the refusal, or the absence of the
// data. A failing case is a finding: the forbidden thing got through.
//
// Run on its own, never alongside the main suite:
//   node --env-file=<.dev.vars> --test --test-concurrency=1 tests/policies/review-v20-v23.test.ts
//
// Every person here is a harness user (email pindhx-…@example.com, app_metadata
// pind_harness), every gathering and venue is named "pindhx <run> …", so world.ts's
// sweep can find anything a crashed run leaves. The `after` hook removes only this
// run's rows, in the sweep's order, then asserts nothing of this run is left.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "./env.ts";
import { newClient, must, markHarness, handleFor, PREFIX, PNG, BUCKET } from "./world.ts";

const env = loadEnv();
const service = newClient(env, env.secretKey);
const anon = newClient(env, env.publishableKey);
const run = `rv${randomBytes(3).toString("hex")}`;
const DAY = 24 * 60 * 60 * 1000;
const inDays = (d: number) => new Date(Date.now() + d * DAY).toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Gender = "woman" | "man" | "nonbinary" | "undisclosed";
interface P {
  name: string;
  id: string;
  authId: string | null;
  c: SupabaseClient; // a signed-in client (or anon for people without a session)
}
const ppl: Record<string, P> = {};
const g: Record<string, string> = {};
const room: Record<string, string> = {}; // "G" (general), "G/wo", "S1", "S2", "H", …
const crew: Record<string, string> = {};
const msg: Record<string, string> = {};
const notes: string[] = []; // facts the setup observed, printed at the end
let venue = "";

// ---------------------------------------------------------------------------
// Builders — the same tagging as world.ts, scoped to this run.
// ---------------------------------------------------------------------------

async function mk(
  name: string,
  spec: { gender: Gender; include?: boolean; photo?: boolean; hidden?: boolean; anonymous?: boolean; session?: boolean; seed?: boolean } ,
): Promise<P> {
  let c = anon;
  let authId: string | null = null;
  if (spec.anonymous) {
    c = newClient(env, env.publishableKey);
    const { data, error } = await c.auth.signInAnonymously({ options: { data: { harness: PREFIX } } });
    if (error || !data.user) throw new Error(`anon sign-in ${name}: ${error?.message}`);
    authId = data.user.id;
    await markHarness(service, authId);
  } else if (spec.session !== false) {
    c = newClient(env, env.publishableKey);
    const email = `${PREFIX}-${run}-${name.toLowerCase()}@example.com`;
    const password = randomUUID();
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { pind_harness: true } });
    if (created.error || !created.data.user) throw new Error(`create ${name}: ${created.error?.message}`);
    authId = created.data.user.id;
    const s = await c.auth.signInWithPassword({ email, password });
    if (s.error) throw new Error(`sign in ${name}: ${s.error.message}`);
  }
  let photoPath: string | null = null;
  if (spec.photo !== false && authId && !spec.anonymous) {
    photoPath = `${authId}/${name.toLowerCase()}.png`;
    await must(service.storage.from(BUCKET).upload(photoPath, PNG, { contentType: "image/png" }), `photo ${name}`);
  }
  const row = await must(
    service
      .from("people")
      .insert({
        auth_user_id: authId,
        first_name: name,
        neighbourhood: "king-west",
        photo_path: photoPath,
        photo_status: photoPath ? "approved" : "pending",
        is_seed: spec.seed ?? false,
      })
      .select("id")
      .single(),
    `person ${name}`,
  );
  await must(service.from("person_handles").insert({ person_id: row.id, instagram: handleFor(run, name) }), `handle ${name}`);
  if (!spec.anonymous) {
    await must(
      service.from("people_private").insert({ person_id: row.id, gender: spec.gender, include_in_women_only: spec.include ?? false, birth_year: 1995 }),
      `private ${name}`,
    );
  }
  const p = { name, id: row.id, authId, c };
  ppl[name] = p;
  return p;
}

async function hide(name: string) {
  await must(service.from("people").update({ hidden_at: new Date().toISOString() }).eq("id", ppl[name]!.id), `hide ${name}`);
}

async function gathering(label: string, days: number, extra: Record<string, unknown> = {}) {
  const row = await must(
    service
      .from("gatherings")
      .insert({ name: `${PREFIX} ${run} ${label}`, starts_at: inDays(days), venue_id: venue, published_at: new Date().toISOString(), ...extra })
      .select("id")
      .single(),
    `gathering ${label}`,
  );
  g[label] = row.id;
  return row.id as string;
}

async function pin(name: string, G: string, open = true) {
  await must(service.from("pins").insert({ gathering_id: g[G], person_id: ppl[name]!.id, open_to_meeting: open }), `pin ${name}@${G}`);
}

async function rooms(G: string): Promise<{ id: string; number: number; women_only: boolean }[]> {
  return must(service.from("rooms").select("id, number, women_only").eq("gathering_id", g[G]).order("number"), `rooms ${G}`);
}

async function membersOf(roomId: string): Promise<string[]> {
  const rows = await must(service.from("room_members").select("person_id").eq("room_id", roomId).is("left_at", null), "members");
  return rows.map((r: { person_id: string }) => r.person_id);
}

// A message posted by the person themselves; returns its id (read back by the service key).
async function post(name: string, roomKey: string, body: string): Promise<string> {
  const p = ppl[name]!;
  const { error } = await p.c.from("room_messages").insert({ room_id: room[roomKey], author_id: p.id, body });
  if (error) throw new Error(`${name} posts in ${roomKey}: ${error.code} ${error.message}`);
  const row = await must(
    service.from("room_messages").select("id").eq("room_id", room[roomKey]).eq("author_id", p.id).eq("body", body).order("created_at", { ascending: false }).limit(1).single(),
    "read back message",
  );
  await sleep(1100); // keep everyone well inside 3 messages in 3 seconds
  return row.id;
}

async function readable(name: string, roomKey: string): Promise<string[]> {
  const { data, error } = await (ppl[name]?.c ?? anon).from("room_messages").select("id").eq("room_id", room[roomKey]);
  if (error) return [];
  return (data ?? []).map((r: { id: string }) => r.id);
}

async function notifs(name: string, kind?: string): Promise<any[]> {
  let q = service.from("notifications").select("id, kind, title, body, room_id, crew_id, gathering_id, created_at").eq("person_id", ppl[name]!.id);
  if (kind) q = q.eq("kind", kind);
  return must(q, `notifications for ${name}`);
}

// A refusal: an error, or a write that touched nothing visible.
function refusedRpc(res: { error: unknown; data: unknown }, what: string) {
  assert.ok(res.error, `${what} was accepted: ${JSON.stringify(res.data)}`);
}

// connections store each pair once, lower id first (constraint connections_ordered_pair).
function pair(a: string, b: string) {
  return a < b ? { person_a: a, person_b: b } : { person_a: b, person_b: a };
}

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

before(async () => {
  venue = (await must(service.from("venues").insert({ name: `${PREFIX} ${run} Arena` }).select("id").single(), "venue")).id;
  await must(
    service.from("meeting_spots").insert(["North Gate", "Patio Bar", "Statue"].map((name) => ({ venue_id: venue, name }))),
    "spots",
  );

  // --- G: the main room, with a women-only room alongside.
  await gathering("G", 7);
  await gathering("H", 8);
  await gathering("S", 9, { room_size: 2 });
  await gathering("W2", 9);
  await gathering("A", 7); // after-the-night world, moved to the past later
  await gathering("B", 7); // a group that never reached 3
  await gathering("G2", 10); // connection invites point here
  await gathering("Cl", 7); // closed room
  await gathering("NT", 7); // #6 notification world
  await gathering("N1", 9); // #2 with a blocked arrival
  await gathering("N2", 9); // #2 positive control
  await gathering("N3", 9); // #2 with a hidden arrival

  for (const [n, gender, include] of [
    ["Ava", "woman", false], ["Ben", "man", false], ["Cara", "woman", false], ["Dana", "woman", false],
    ["Nico", "nonbinary", true], ["Nell", "nonbinary", false], ["Mo", "man", false], ["Bk", "man", false],
    ["Ck", "man", false], ["Hid", "man", false], ["Out", "woman", false], ["Strg", "man", false],
    ["Wo", "woman", false], ["Eli", "woman", false], ["Rt", "man", false], ["Man2", "man", false],
    ["Hugo", "man", false], ["Hana", "woman", false],
  ] as [string, Gender, boolean][]) {
    await mk(n, { gender, include });
  }
  await mk("Anon", { gender: "man", anonymous: true });
  await mk("Seed", { gender: "woman", session: false, seed: true });

  await must(service.from("blocks").insert({ blocker_id: ppl.Ava!.id, blocked_id: ppl.Bk!.id }), "Ava blocks Bk");
  await must(service.from("blocks").insert({ blocker_id: ppl.Ck!.id, blocked_id: ppl.Ava!.id }), "Ck blocks Ava");

  // Wo chooses "women-only rooms only" before she pins.
  await must(ppl.Wo!.c.rpc("set_women_only_rooms", { p_on: true }), "Wo sets women-only rooms only");

  for (const n of ["Ava", "Ben", "Cara", "Dana", "Nico", "Nell", "Mo", "Bk", "Ck", "Hid", "Wo", "Eli", "Rt"]) await pin(n, "G");
  await pin("Out", "G", false);
  await pin("Anon", "G", false);
  await pin("Seed", "G", true);
  await hide("Hid"); // hidden after placement
  await pin("Hugo", "H");
  await pin("Hana", "H");

  const gr = await rooms("G");
  notes.push(`G rooms: ${JSON.stringify(gr.map((r) => ({ n: r.number, wo: r.women_only })))}`);
  const general = gr.find((r) => !r.women_only);
  const wo = gr.find((r) => r.women_only);
  if (!general) throw new Error("setup: G has no general room");
  room.G = general.id;
  if (wo) room["G/wo"] = wo.id;
  const name = (id: string) => Object.values(ppl).find((p) => p.id === id)?.name ?? id;
  notes.push(`G general members: ${(await membersOf(room.G)).map(name).join(",")}`);
  if (wo) notes.push(`G women-only members: ${(await membersOf(wo.id)).map(name).join(",")}`);
  const hr = await rooms("H");
  room.H = hr[0]!.id;

  // Messages in G's general room.
  msg.ava = await post("Ava", "G", "hi from Ava");
  msg.ben = await post("Ben", "G", "hi from Ben");
  msg.cara = await post("Cara", "G", "hi from Cara");
  msg.dana = await post("Dana", "G", "hi from Dana");
  msg.mo = await post("Mo", "G", "hi from Mo");
  msg.bk = await post("Bk", "G", "hi from Bk");
  msg.ck = await post("Ck", "G", "hi from Ck");
  msg.hugo = await post("Hugo", "H", "hi from Hugo");
  // Hidden person's message: written by the service key, as if posted before the hide.
  msg.hid = (await must(service.from("room_messages").insert({ room_id: room.G, author_id: ppl.Hid!.id, body: "hi from Hid" }).select("id").single(), "Hid's message")).id;
  // A seed person's message, if a seed person was placed at all.
  const seedIn = (await membersOf(room.G)).includes(ppl.Seed!.id);
  notes.push(`seed person placed in G's general room: ${seedIn}`);
  msg.seed = (await must(service.from("room_messages").insert({ room_id: room.G, author_id: ppl.Seed!.id, body: "hi from Seed" }).select("id").single(), "Seed's message")).id;
  if (room["G/wo"]) {
    msg.nico = await post("Nico", "G/wo", "hi from Nico in the women-only room");
    msg.wo = await post("Wo", "G/wo", "hi from Wo");
    msg.eli = await post("Eli", "G/wo", "hi from Eli");
  }

  // --- S: room size 2 → a second room.
  for (const n of ["S1", "S2", "S3", "S4"]) {
    await mk(n, { gender: "man" });
    await pin(n, "S");
  }
  const sr = await rooms("S");
  notes.push(`S rooms: ${sr.length}`);
  room.S1 = sr[0]!.id;
  if (sr[1]) room.S2 = sr[1].id;
  msg.s1 = await post("S1", "S1", "hi from S1 in room 1");

  // --- W2: two eligible people only; Wa wants women-only rooms only.
  await mk("Wa", { gender: "woman" });
  await mk("Wb", { gender: "woman" });
  await mk("Wm", { gender: "man" });
  await must(ppl.Wa!.c.rpc("set_women_only_rooms", { p_on: true }), "Wa sets women-only only");
  for (const n of ["Wa", "Wb", "Wm"]) await pin(n, "W2");

  // --- Cl: a room that will be closed.
  for (const n of ["Cl1", "Cl2"]) {
    await mk(n, { gender: "man" });
    await pin(n, "Cl");
  }
  room.Cl = (await rooms("Cl"))[0]!.id;
  msg.cl2 = await post("Cl2", "Cl", "hi from Cl2");
  await must(service.from("gatherings").update({ starts_at: inDays(-3) }).eq("id", g.Cl), "close Cl");
});

after(async () => {
  for (const n of notes) console.log(`# note: ${n}`);
  const ids = Object.values(ppl).map((p) => p.id);
  const gids = Object.values(g);
  const tryDel = async (what: string, q: PromiseLike<{ error: any }>) => {
    const { error } = await q;
    if (error) console.log(`# cleanup ${what}: ${error.message}`);
  };
  await tryDel("reports by", service.from("reports").delete().in("reporter_id", ids));
  await tryDel("reports on", service.from("reports").delete().in("target_person_id", ids));
  await tryDel("moderation log", service.from("moderation_log").delete().in("gathering_id", gids));
  const crews = await must(service.from("crews").select("id").in("gathering_id", gids), "find crews");
  const crewIds = crews.map((c: { id: string }) => c.id);
  if (crewIds.length) await tryDel("confirmations", service.from("confirmations").delete().in("crew_id", crewIds));
  await tryDel("connection invites", service.from("connection_invites").delete().in("from_person", ids));
  await tryDel("connections a", service.from("connections").delete().in("person_a", ids));
  await tryDel("connections b", service.from("connections").delete().in("person_b", ids));
  await tryDel("crews", service.from("crews").delete().in("gathering_id", gids));
  await tryDel("gatherings", service.from("gatherings").delete().in("id", gids));
  await tryDel("notifications", service.from("notifications").delete().in("person_id", ids));
  await tryDel("people", service.from("people").delete().in("id", ids));
  await tryDel("spots", service.from("meeting_spots").delete().eq("venue_id", venue));
  await tryDel("venue", service.from("venues").delete().eq("id", venue));
  for (const p of Object.values(ppl)) {
    if (!p.authId) continue;
    const { data } = await service.storage.from(BUCKET).list(p.authId);
    if (data?.length) await service.storage.from(BUCKET).remove(data.map((f) => `${p.authId}/${f.name}`));
    const { error } = await service.auth.admin.deleteUser(p.authId);
    if (error) console.log(`# cleanup user ${p.name}: ${error.message}`);
  }
  // Prove the cleanup: nothing of this run is left.
  const leftPeople = await must(service.from("person_handles").select("person_id").like("instagram", `${PREFIX}_${run}_%`), "left people");
  const leftG = await must(service.from("gatherings").select("id").like("name", `${PREFIX} ${run} %`), "left gatherings");
  const leftV = await must(service.from("venues").select("id").like("name", `${PREFIX} ${run} %`), "left venues");
  let leftUsers = 0;
  for (let page = 1; ; page++) {
    const { data } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    leftUsers += data.users.filter((u) => (u.email ?? "").startsWith(`${PREFIX}-${run}-`) || Object.values(ppl).some((p) => p.authId === u.id)).length;
    if (data.users.length < 1000) break;
  }
  console.log(`# cleanup check: people ${leftPeople.length}, gatherings ${leftG.length}, venues ${leftV.length}, auth users ${leftUsers}`);
});

// ===========================================================================
// V20 — the room: who can read a message
// ===========================================================================

test("R01 V20/H3: someone pinned but not opted in reads no room message", async () => {
  assert.deepEqual(await readable("Out", "G"), []);
});

test("R02 V20/H3: a signed-in person with no pin at G reads no room message", async () => {
  assert.deepEqual(await readable("Strg", "G"), []);
});

test("R03 V20: no session at all reads no room message, room, or member", async () => {
  const m = await anon.from("room_messages").select("id").eq("room_id", room.G);
  const r = await anon.from("rooms").select("id").eq("gathering_id", g.G);
  const rm = await anon.from("room_members").select("person_id").eq("gathering_id", g.G);
  assert.deepEqual([m.data ?? [], r.data ?? [], rm.data ?? []], [[], [], []]);
});

test("R04 V20/V1: someone at another gathering reads nothing of G's room", async () => {
  assert.deepEqual(await readable("Hugo", "G"), []);
  const rm = await ppl.Hugo!.c.from("room_members").select("person_id").eq("gathering_id", g.G);
  assert.deepEqual(rm.data ?? [], []);
});

test("R05 V20/V4: a blocker cannot read the blocked person's messages, and vice versa (Ava blocks Bk)", async () => {
  assert.ok(!(await readable("Ava", "G")).includes(msg.bk!), "Ava reads Bk");
  assert.ok(!(await readable("Bk", "G")).includes(msg.ava!), "Bk reads Ava");
});

test("R06 V20/V4: blocked the other way (Ck blocks Ava) hides both directions too", async () => {
  assert.ok(!(await readable("Ava", "G")).includes(msg.ck!), "Ava reads Ck");
  assert.ok(!(await readable("Ck", "G")).includes(msg.ava!), "Ck reads Ava");
});

test("R07 V20/V1: a hidden person's message is read by nobody", async () => {
  for (const n of ["Ben", "Ava", "Mo"]) assert.ok(!(await readable(n, "G")).includes(msg.hid!), `${n} reads Hid`);
});

test("R08 V20/V1: a hidden person reads nobody's message", async () => {
  const seen = await readable("Hid", "G");
  assert.ok(!seen.includes(msg.ben!) && !seen.includes(msg.ava!), `Hid reads ${seen.length} messages`);
});

test("R09 V20/V18: a seed person's message never reaches a non-tester", async () => {
  for (const n of ["Ben", "Ava"]) assert.ok(!(await readable(n, "G")).includes(msg.seed!), `${n} reads Seed`);
  const rm = await ppl.Ben!.c.from("room_members").select("person_id").eq("gathering_id", g.G).eq("person_id", ppl.Seed!.id);
  assert.deepEqual(rm.data ?? [], [], "Ben sees the seed person's membership");
});

test("R10 V20: positive control — a peer in the same room does read messages (else the refusals above prove nothing)", async () => {
  const seen = await readable("Ben", "G");
  assert.ok(seen.includes(msg.ava!) && seen.includes(msg.mo!), "Ben cannot read Ava/Mo — room reads are broken, not safe");
});

test("R11 V20: someone in the other room at the same gathering reads nothing of room 1", async () => {
  assert.ok(room.S2, "setup: room size 2 did not make a second room at S");
  const s2members = await membersOf(room.S2!);
  assert.ok(s2members.includes(ppl.S3!.id), "setup: S3 is not in room 2");
  assert.deepEqual(await readable("S3", "S1"), []);
  const w = await ppl.S3!.c.from("room_messages").insert({ room_id: room.S1, author_id: ppl.S3!.id, body: "into room 1" });
  assert.ok(w.error, "S3 posted into room 1");
});

// ===========================================================================
// V20/H7/Q9 — the women-only room
// ===========================================================================

test("R12 H7: the women-only room exists at G (setup check — else the women-only cases prove nothing)", async () => {
  assert.ok(room["G/wo"], "no women-only room at G with 5+ eligible people opted in");
});

test("R13 H7: a man cannot see the women-only room — not its row, its members or its messages", async () => {
  const r = await ppl.Ben!.c.from("rooms").select("id, women_only").eq("gathering_id", g.G);
  assert.ok(!(r.data ?? []).some((x: any) => x.women_only), "Ben sees a women-only room row");
  const rm = await ppl.Ben!.c.from("room_members").select("room_id, person_id, women_only").eq("gathering_id", g.G);
  assert.ok(!(rm.data ?? []).some((x: any) => x.room_id === room["G/wo"] || x.women_only), `Ben sees women-only memberships: ${JSON.stringify(rm.data)}`);
  assert.deepEqual(await readable("Ben", "G/wo"), []);
});

test("R14 H7/V5: a nonbinary person who did not choose inclusion cannot see the women-only room", async () => {
  assert.ok(!(await membersOf(room["G/wo"]!)).includes(ppl.Nell!.id), "Nell was placed in it");
  assert.deepEqual(await readable("Nell", "G/wo"), []);
  const rm = await ppl.Nell!.c.from("room_members").select("room_id").eq("room_id", room["G/wo"]);
  assert.deepEqual(rm.data ?? [], []);
});

test("R15 H7/V5: a man cannot write into the women-only room", async () => {
  const w = await ppl.Ben!.c.from("room_messages").insert({ room_id: room["G/wo"], author_id: ppl.Ben!.id, body: "let me in" });
  assert.ok(w.error, "Ben posted in the women-only room");
});

test("R16 H7/V5: a man cannot add himself to the women-only room's members", async () => {
  const w = await ppl.Ben!.c.from("room_members").insert({ room_id: room["G/wo"], gathering_id: g.G, person_id: ppl.Ben!.id, women_only: true });
  const now = await membersOf(room["G/wo"]!);
  assert.ok(w.error || !now.includes(ppl.Ben!.id), "Ben inserted himself");
  assert.ok(!now.includes(ppl.Ben!.id));
});

test("R17 H7/V5: a man moving his own membership row into the women-only room is refused", async () => {
  await ppl.Ben!.c.from("room_members").update({ room_id: room["G/wo"], women_only: true }).eq("person_id", ppl.Ben!.id);
  assert.ok(!(await membersOf(room["G/wo"]!)).includes(ppl.Ben!.id), "Ben moved into the women-only room");
});

test("R18 H7: a man who sets 'women-only rooms only' is still never placed in a women-only room", async () => {
  const r = await ppl.Man2!.c.rpc("set_women_only_rooms", { p_on: true });
  notes.push(`Man2 set_women_only_rooms(true): ${r.error ? r.error.message : "accepted"}`);
  await pin("Man2", "G");
  assert.ok(!(await membersOf(room["G/wo"]!)).includes(ppl.Man2!.id), "Man2 placed in the women-only room");
  const mine = await ppl.Man2!.c.rpc("my_rooms", { p_gathering: g.G });
  assert.ok(!JSON.stringify(mine.data ?? "").includes(room["G/wo"]!), "my_rooms gives Man2 the women-only room");
});

test("R19 H7/V5: my_rooms never shows a man the women-only room", async () => {
  const mine = await ppl.Ben!.c.rpc("my_rooms", { p_gathering: g.G });
  notes.push(`Ben my_rooms(G): ${JSON.stringify(mine.data)} ${mine.error?.message ?? ""}`);
  assert.ok(!JSON.stringify(mine.data ?? "").includes(room["G/wo"]!));
});

test("R20 V23b: 'women-only rooms only' is a real only — Wo is not in the general room and reads none of it", async () => {
  assert.ok(!(await membersOf(room.G)).includes(ppl.Wo!.id), "Wo was placed in the general room");
  assert.deepEqual(await readable("Wo", "G"), []);
});

test("R21 Q9/V23b: waiting_for_women_only_room is a yes/no, never a count", async () => {
  const r = await ppl.Wa!.c.rpc("waiting_for_women_only_room", { p_gathering: g.W2 });
  notes.push(`Wa waiting(W2): ${JSON.stringify(r.data)} ${r.error?.message ?? ""}`);
  assert.equal(typeof r.data, "boolean", `answer is ${JSON.stringify(r.data)}`);
  assert.equal(r.data, true, "Wa is waiting at W2 (2 eligible) but not told so");
});

test("R22 Q9/V5: a man learns nothing from waiting_for_women_only_room — same answer whether the room is open (G) or not (W2)", async () => {
  await pin("Ben", "W2").catch(() => {});
  const atG = await ppl.Ben!.c.rpc("waiting_for_women_only_room", { p_gathering: g.G });
  const atW2 = await ppl.Ben!.c.rpc("waiting_for_women_only_room", { p_gathering: g.W2 });
  assert.deepEqual([atG.data, atG.error?.message], [atW2.data, atW2.error?.message]);
  const offerG = await ppl.Ben!.c.rpc("women_only_offer", { p_gathering: g.G });
  assert.ok(!offerG.data, "women_only_offer is true for a man");
});

test("R23 V23b/Q9: below 3 eligible the women-only room is offered to nobody — no row, no members, no count, no posting", async () => {
  const wr = await rooms("W2");
  const wo = wr.find((r) => r.women_only);
  notes.push(`W2 rooms: ${JSON.stringify(wr.map((r) => ({ n: r.number, wo: r.women_only })))}; women-only members (service): ${wo ? (await membersOf(wo.id)).length : "-"}`);
  const leaks: string[] = [];
  for (const n of ["Wa", "Wb", "Wm"]) {
    const c = ppl[n]!.c;
    const mine = await c.rpc("my_rooms", { p_gathering: g.W2 });
    if ((mine.data ?? []).some((r: any) => r.women_only)) leaks.push(`${n} my_rooms: ${JSON.stringify(mine.data)}`);
    const r = await c.from("rooms").select("id, women_only").eq("gathering_id", g.W2);
    if ((r.data ?? []).some((x: any) => x.women_only)) leaks.push(`${n} reads the women-only room row`);
    const rm = await c.from("room_members").select("person_id, room_id").eq("gathering_id", g.W2);
    if (wo && (rm.data ?? []).some((x: any) => x.room_id === wo.id)) leaks.push(`${n} reads ${(rm.data ?? []).filter((x: any) => x.room_id === wo.id).length} women-only memberships`);
    if (wo) {
      const w = await c.from("room_messages").insert({ room_id: wo.id, author_id: ppl[n]!.id, body: `${n} in an unopened women-only room` });
      if (!w.error) leaks.push(`${n} posted in the unopened women-only room`);
    }
  }
  assert.deepEqual(leaks, []);
});

test("R24 Q3: the gender mix is not given below 5 opted in (W2 has 3–4)", async () => {
  const r = await anon.rpc("gathering_counts", { gathering_ids: [g.W2] });
  const row = (r.data ?? [])[0] ?? {};
  notes.push(`W2 counts: ${JSON.stringify(row)}`);
  for (const [k, v] of Object.entries(row)) {
    if (/wom|men|man|other|mix/i.test(k)) assert.ok(v === null || v === undefined, `${k} = ${v} below 5`);
  }
});

// ===========================================================================
// V20 — writes: forging, deleting, rate limits, closed rooms, reports
// ===========================================================================

test("R25 V20: a message forged as someone else (author_id = Ava, posted by Ben) is refused", async () => {
  const w = await ppl.Ben!.c.from("room_messages").insert({ room_id: room.G, author_id: ppl.Ava!.id, body: "I am Ava" });
  const rows = await must(service.from("room_messages").select("id").eq("body", "I am Ava").eq("room_id", room.G), "forged?");
  assert.ok(w.error && rows.length === 0, "a message as Ava was written by Ben");
});

test("R26 V20: not opted in, no pin, another gathering, anonymous: none can post in G's room", async () => {
  // A hidden person posting is recorded as a note; what matters is that it reaches nobody (R07, R48).
  const hid = await ppl.Hid!.c.from("room_messages").insert({ room_id: room.G, author_id: ppl.Hid!.id, body: "from Hid, hidden" });
  notes.push(`a hidden person posts in G: ${hid.error ? hid.error.message : "accepted"}`);
  for (const n of ["Out", "Strg", "Hugo", "Anon"]) {
    const p = ppl[n]!;
    const w = await p.c.from("room_messages").insert({ room_id: room.G, author_id: p.id, body: `from ${n}` });
    assert.ok(w.error, `${n} posted in G's room`);
  }
});

test("R27 V20: 500 characters is allowed, 501 refused (both sides of the cap)", async () => {
  const ok = await ppl.Mo!.c.from("room_messages").insert({ room_id: room.G, author_id: ppl.Mo!.id, body: "x".repeat(500) });
  assert.equal(ok.error, null, `500 chars refused: ${ok.error?.message}`);
  await sleep(1100);
  const no = await ppl.Mo!.c.from("room_messages").insert({ room_id: room.G, author_id: ppl.Mo!.id, body: "y".repeat(501) });
  assert.ok(no.error, "501 chars accepted");
  await sleep(3500);
});

test("R28 V20: the 4th message in 3 seconds is refused (acceptance), and a message after the window is allowed", async () => {
  // The plan says "at most one message every 3 seconds"; the acceptance says "refuse the
  // fourth message in three seconds". The brief read it as "3rd allowed". Recorded, and
  // only what all readings agree on is asserted.
  await sleep(3500);
  const res = [];
  for (let i = 1; i <= 4; i++) res.push(await ppl.Cara!.c.from("room_messages").insert({ room_id: room.G, author_id: ppl.Cara!.id, body: `burst ${i}` }));
  notes.push(`burst of 4 inside 3 s: ${res.map((r) => (r.error ? "refused" : "ok")).join(",")}; error: ${res[1]!.error?.message}`);
  assert.equal(res[0]!.error, null, "the first message refused");
  assert.ok(res[3]!.error, "the 4th message in 3 seconds was accepted");
  await sleep(3200);
  const later = await ppl.Cara!.c.from("room_messages").insert({ room_id: room.G, author_id: ppl.Cara!.id, body: "after the window" });
  assert.equal(later.error, null, `refused 3.2 s after the last accepted message: ${later.error?.message}`);
});

test("R29 V20: the 200th message in a day is allowed and the 201st refused", async () => {
  // 198 earlier messages today, 20 s apart and older than the 3-second window.
  const rows = Array.from({ length: 198 }, (_, i) => ({
    room_id: room.G,
    author_id: ppl.Rt!.id,
    body: `earlier ${i}`,
    created_at: new Date(Date.now() - (i + 1) * 15_000).toISOString(),
  }));
  await must(service.from("room_messages").insert(rows), "backfill Rt");
  const count = await service.from("room_messages").select("id", { count: "exact", head: true }).eq("author_id", ppl.Rt!.id).gte("created_at", new Date(Date.now() - DAY).toISOString());
  notes.push(`Rt messages in the last day before the test: ${count.count}`);
  assert.equal(count.count, 198, "setup: backfill's created_at did not stick");
  const r199 = await ppl.Rt!.c.from("room_messages").insert({ room_id: room.G, author_id: ppl.Rt!.id, body: "199th" });
  await sleep(3500);
  const r200 = await ppl.Rt!.c.from("room_messages").insert({ room_id: room.G, author_id: ppl.Rt!.id, body: "200th" });
  assert.equal(r199.error, null, `199th refused: ${r199.error?.message}`);
  assert.equal(r200.error, null, `200th refused: ${r200.error?.message}`);
  await sleep(3500);
  const r201 = await ppl.Rt!.c.from("room_messages").insert({ room_id: room.G, author_id: ppl.Rt!.id, body: "201st" });
  assert.ok(r201.error, "the 201st message in a day was accepted");
});

test("R30 V20: nobody can delete someone else's message", async () => {
  await ppl.Ben!.c.from("room_messages").delete().eq("id", msg.ava!);
  await ppl.Bk!.c.from("room_messages").delete().eq("id", msg.ava!);
  const still = await must(service.from("room_messages").select("id").eq("id", msg.ava!), "Ava's message");
  assert.equal(still.length, 1, "someone else deleted Ava's message");
});

test("R31 V20: nobody can rewrite someone else's message", async () => {
  await ppl.Ben!.c.from("room_messages").update({ body: "Ava said something else" }).eq("id", msg.ava!);
  await ppl.Ben!.c.from("room_messages").update({ author_id: ppl.Ben!.id }).eq("id", msg.ava!);
  const row = await must(service.from("room_messages").select("body, author_id").eq("id", msg.ava!).single(), "Ava's message");
  assert.deepEqual(row, { body: "hi from Ava", author_id: ppl.Ava!.id });
});

test("R32 V20: an author cannot move their message into another room, or re-author it", async () => {
  await ppl.Mo!.c.from("room_messages").update({ room_id: room["G/wo"] ?? room.H }).eq("id", msg.mo!);
  await ppl.Mo!.c.from("room_messages").update({ author_id: ppl.Ava!.id }).eq("id", msg.mo!);
  const row = await must(service.from("room_messages").select("room_id, author_id").eq("id", msg.mo!).single(), "Mo's message");
  assert.deepEqual(row, { room_id: room.G, author_id: ppl.Mo!.id });
});

// A room-message report exactly as the app files it (app/src/lib/room.ts reportRoomMessage).
async function report(name: string, messageId: string, reason: string, extra: Record<string, unknown> = {}) {
  const p = ppl[name]!;
  return p.c.from("reports").insert({ reporter_id: p.id, target_kind: "message", target_room_message_id: messageId, reason, ...extra });
}

test("R33 V20: a report snapshots the real body — a forged snapshot is not stored", async () => {
  const r = await report("Mo", msg.dana!, "spam", { reported_content_snapshot: "FORGED: Dana threatened me" });
  notes.push(`report with forged snapshot: ${r.error ? r.error.message : "accepted"}`);
  const rows = await must(service.from("reports").select("reported_content_snapshot").eq("target_room_message_id", msg.dana!), "report");
  assert.ok(!rows.some((x: any) => (x.reported_content_snapshot ?? "").includes("FORGED")), "the forged snapshot was stored");
});

test("R34 V20/H9: a report made before a delete keeps its snapshot (positive), and the message is gone for everyone", async () => {
  // Mo reports Ava's 'delete me' message, then Ava deletes it.
  const id = await post("Ava", "G", "delete me later");
  const r = await report("Mo", id, "spam");
  notes.push(`Mo reports a room message: ${r.error ? r.error.message : "accepted"}`);
  assert.equal(r.error, null, `setup: report refused: ${r.error?.message}`);
  const d = await ppl.Ava!.c.from("room_messages").delete().eq("id", id);
  assert.equal(d.error, null);
  assert.ok(!(await readable("Ben", "G")).includes(id), "the deleted message is still readable");
  const rep = await must(service.from("reports").select("reported_content_snapshot").eq("reporter_id", ppl.Mo!.id).like("reported_content_snapshot", "%delete me later%"), "report");
  assert.equal(rep.length, 1, "the snapshot did not survive the delete");
});

test("R35 V20/H9: someone who cannot read a message cannot report it (and so cannot hide it)", async () => {
  for (const n of ["Hugo", "Strg", "Out"]) {
    const r = await report(n, msg.ben!, "uncomfortable");
    notes.push(`${n} reports Ben's message: ${r.error ? r.error.message : "accepted"}`);
    assert.ok(r.error, `${n} reported Ben's message`);
  }
  const bk = await report("Bk", msg.ava!, "uncomfortable");
  assert.ok(bk.error, "Bk (blocked by Ava) reported Ava's message");
  const ava = await must(service.from("room_messages").select("hidden_at").eq("id", msg.ava!).single(), "Ava's message");
  assert.equal(ava.hidden_at, null, "Ava's message hidden by the person she blocked");
  const row = await must(service.from("room_messages").select("hidden_at").eq("id", msg.ben!).single(), "Ben's message");
  assert.equal(row.hidden_at, null, "Ben's message was hidden by an outsider's report");
});

test("R36 V9: a reporter cannot set a report's status or forge another reporter", async () => {
  const r1 = await report("Mo", msg.cara!, "spam", { reporter_id: ppl.Ava!.id });
  const r2 = await report("Mo", msg.cara!, "spam", { status: "dismissed" });
  const byAva = await must(service.from("reports").select("id").eq("reporter_id", ppl.Ava!.id), "reports by Ava");
  assert.equal(byAva.length, 0, "Mo filed a report as Ava");
  assert.ok(r1.error);
  notes.push(`report with status set: ${r2.error ? r2.error.message : "accepted"}`);
  const st = await must(service.from("reports").select("status").eq("reporter_id", ppl.Mo!.id).eq("target_room_message_id", msg.cara!), "status");
  assert.ok(!st.some((x: any) => x.status === "dismissed"), "Mo set his report's status");
});

test("R37 Q11: a closed room is read-only — no new message once it closes", async () => {
  const w = await ppl.Cl1!.c.from("room_messages").insert({ room_id: room.Cl, author_id: ppl.Cl1!.id, body: "after close" });
  assert.ok(w.error, "posted into a closed room");
});

test("R38 V20: room_seen on a room you are not in does not make you a member or open its messages", async () => {
  const r = await ppl.Hugo!.c.rpc("room_seen", { p_room: room.G });
  notes.push(`Hugo room_seen(G): ${r.error ? r.error.message : JSON.stringify(r.data)}`);
  assert.ok(!(await membersOf(room.G)).includes(ppl.Hugo!.id));
  assert.deepEqual(await readable("Hugo", "G"), []);
});

test("R39 V20: join_general_room refuses anyone not open to meeting at that gathering", async () => {
  for (const n of ["Out", "Strg", "Hugo", "Anon"]) {
    const r = await ppl[n]!.c.rpc("join_general_room", { p_gathering: g.G });
    const inRoom = (await membersOf(room.G)).includes(ppl[n]!.id);
    notes.push(`${n} join_general_room(G): ${r.error ? r.error.message : "accepted"}; member=${inRoom}`);
    assert.ok(!inRoom, `${n} joined G's general room`);
    assert.ok(!(await readable(n, "G")).includes(msg.ben!), `${n} reads G`);
  }
});

test("R40 Q8/A27: an anonymous A26 person cannot opt themselves in to meeting", async () => {
  const r = await ppl.Anon!.c.from("pins").update({ open_to_meeting: true }).eq("person_id", ppl.Anon!.id).eq("gathering_id", g.G);
  const row = await must(service.from("pins").select("open_to_meeting").eq("person_id", ppl.Anon!.id).single(), "Anon pin");
  assert.equal(row.open_to_meeting, false, `Anon opted in: ${r.error?.message}`);
});

test("R41 V20/V1: switching opt-in off takes the room away, and your messages with it", async () => {
  await mk("Sw", { gender: "man" });
  await pin("Sw", "G");
  const sid = await post("Sw", "G", "from Sw");
  await must(ppl.Sw!.c.from("pins").update({ open_to_meeting: false }).eq("person_id", ppl.Sw!.id).eq("gathering_id", g.G), "Sw switches off");
  assert.deepEqual((await readable("Sw", "G")).filter((x) => x !== sid), [], "Sw still reads the room");
  assert.ok(!(await readable("Ben", "G")).includes(sid), "Ben still reads Sw's message");
});

// ===========================================================================
// V22 — notifications
// ===========================================================================

test("R42 V22: nobody reads the notifications table, not even their own rows", async () => {
  const own = await ppl.Ben!.c.from("notifications").select("id").eq("person_id", ppl.Ben!.id);
  const all = await ppl.Ben!.c.from("notifications").select("id").limit(5);
  assert.deepEqual([own.data ?? [], all.data ?? []], [[], []]);
});

test("R43 V22: nobody can write a notification row (a fake 'Pin'd says…')", async () => {
  const w = await ppl.Ben!.c.from("notifications").insert({ person_id: ppl.Ava!.id, kind: "invite", title: "Pin'd", body: "fake" });
  assert.ok(w.error, "Ben queued a notification to Ava");
});

test("R44 V22: someone else's notification switches can be neither read nor turned off", async () => {
  const before = await must(service.from("notification_settings").select("*").eq("person_id", ppl.Ava!.id), "Ava settings");
  const r = await ppl.Ben!.c.from("notification_settings").select("*").eq("person_id", ppl.Ava!.id);
  assert.deepEqual(r.data ?? [], [], "Ben reads Ava's settings");
  await ppl.Ben!.c.from("notification_settings").update({ room_activity: false, invite: false }).eq("person_id", ppl.Ava!.id);
  await ppl.Ben!.c.from("notification_settings").insert({ person_id: ppl.Ava!.id, room_activity: false, invite: false, room_open: false });
  const after = await must(service.from("notification_settings").select("*").eq("person_id", ppl.Ava!.id), "Ava settings");
  assert.deepEqual(after, before, "Ben changed Ava's switches");
});

test("R45 V22/V12: admin_switch_off, admin_pending_notifications and admin_groups_tick are refused to a person", async () => {
  const a = await ppl.Ben!.c.rpc("admin_switch_off", { p_kind: "room_activity", p_person: ppl.Ava!.id });
  const b = await ppl.Ben!.c.rpc("admin_pending_notifications", { p_limit: 5 });
  const c = await ppl.Ben!.c.rpc("admin_groups_tick", {});
  const d = await ppl.Ben!.c.rpc("admin_delete_expired_room_messages", {});
  for (const [n, r] of [["switch_off", a], ["pending", b], ["groups_tick", c], ["delete_expired", d]] as const) refusedRpc(r, n);
});

test("R46 V22: device tokens are own-only — another person's token is unreadable and cannot be taken over", async () => {
  const tok = `ExponentPushToken[${PREFIX}${run}ben]`;
  const reg = await ppl.Ben!.c.rpc("register_device", { p_platform: "ios", p_token: tok });
  assert.equal(reg.error, null, `setup: register_device refused: ${reg.error?.message}`);
  const r = await ppl.Mo!.c.from("device_tokens").select("token").eq("token", tok);
  assert.deepEqual(r.data ?? [], [], "Mo reads Ben's token");
  const take = await ppl.Mo!.c.rpc("register_device", { p_platform: "ios", p_token: tok });
  const row = await must(service.from("device_tokens").select("person_id").eq("token", tok), "token row");
  notes.push(`Mo register_device(Ben's token): ${take.error ? take.error.message : "accepted"}; owner now ${row.map((x: any) => (x.person_id === ppl.Ben!.id ? "Ben" : x.person_id === ppl.Mo!.id ? "Mo" : x.person_id)).join(",")}`);
  assert.ok(row.length === 1 && row[0].person_id === ppl.Ben!.id, "Mo took over Ben's device token (Ben's pushes now go to… Mo's notifications reach Ben's phone, Ben's stop)");
});

test("R47 V22 #2: room_open — positive control, then never when the only other arrival is someone you blocked", async () => {
  for (const n of ["X1", "Y1", "X2", "Y2"]) await mk(n, { gender: "man" });
  await must(service.from("blocks").insert({ blocker_id: ppl.X1!.id, blocked_id: ppl.Y1!.id }), "X1 blocks Y1");
  await pin("X2", "N2");
  await pin("Y2", "N2");
  await sleep(1500);
  const control = await notifs("X2", "room_open");
  notes.push(`#2 control rows for X2: ${control.length} ${JSON.stringify(control.map((x) => x.body))}`);
  assert.ok(control.length >= 1, "control: #2 did not fire for an ordinary second arrival — the negative cases below prove nothing");
  await pin("X1", "N1");
  await pin("Y1", "N1");
  await sleep(1500);
  const x1 = await notifs("X1", "room_open");
  const y1 = await notifs("Y1", "room_open");
  notes.push(`#2 blocked pair: X1 ${JSON.stringify(x1.map((x) => x.body))} Y1 ${JSON.stringify(y1.map((x) => x.body))}`);
  assert.equal(x1.length, 0, "X1 told someone arrived — the only arrival is the person X1 blocked");
  assert.equal(y1.length, 0, "Y1 notified about the person who blocked them");
});

test("R47h V1/V22 #2: a hidden person who pins in and opts in is not announced by name to the first person", async () => {
  await mk("Xh", { gender: "man" });
  await mk("Zh", { gender: "man" });
  await hide("Zh");
  await pin("Xh", "N3");
  // The hidden person pins in through their own session, as the app would.
  const own = await ppl.Zh!.c.from("pins").insert({ gathering_id: g.N3, person_id: ppl.Zh!.id, open_to_meeting: true });
  notes.push(`a hidden person pins in and opts in through their own session: ${own.error ? own.error.message : "accepted"}`);
  if (own.error) await pin("Zh", "N3");
  await sleep(1500);
  const xh = await notifs("Xh", "room_open");
  const sees = await ppl.Xh!.c.from("people").select("id").eq("id", ppl.Zh!.id);
  notes.push(`#2 on a hidden arrival: Xh ${JSON.stringify(xh.map((x) => x.body))}; Xh can see Zh: ${(sees.data ?? []).length}`);
  assert.equal(xh.length, 0, `Xh was told by name about a hidden person: ${JSON.stringify(xh.map((x) => x.body))}`);
});

test("R48 V22 #6: room_activity — never from a blocked author, never to a switched-off or hidden person; batched", async () => {
  for (const n of ["Rec", "Rc2", "Pos", "Blkd", "Off", "Hr"]) {
    await mk(n, { gender: "man" });
    await pin(n, "NT");
  }
  room.NT = (await rooms("NT"))[0]!.id;
  await must(service.from("blocks").insert({ blocker_id: ppl.Rec!.id, blocked_id: ppl.Blkd!.id }), "Rec blocks Blkd");
  const off = await ppl.Off!.c.from("notification_settings").upsert({ person_id: ppl.Off!.id, room_activity: false });
  notes.push(`Off switches #6 off: ${off.error ? off.error.message : "ok"}`);
  await hide("Hr");
  await post("Blkd", "NT", "blocked author");
  await sleep(1500);
  const afterBlocked = {
    Rec: (await notifs("Rec", "room_activity")).length,
    Rc2: (await notifs("Rc2", "room_activity")).length,
    Off: (await notifs("Off", "room_activity")).length,
    Hr: (await notifs("Hr", "room_activity")).length,
  };
  await post("Pos", "NT", "ordinary author 1");
  await sleep(1500);
  const afterPos1 = (await notifs("Rec", "room_activity")).length;
  await sleep(2500);
  await post("Pos", "NT", "ordinary author 2");
  await sleep(1500);
  const afterPos2 = (await notifs("Rec", "room_activity")).length;
  notes.push(`#6: afterBlocked ${JSON.stringify(afterBlocked)}; Rec after Pos1 ${afterPos1}, after Pos2 ${afterPos2}`);
  assert.equal(afterBlocked.Rc2, 1, "control: Rc2 got no #6 for the first message — negatives prove nothing");
  assert.equal(afterBlocked.Rec, 0, "Rec notified of a message from someone Rec blocked");
  assert.equal(afterBlocked.Off, 0, "#6 reached someone who switched it off");
  assert.equal(afterBlocked.Hr, 0, "#6 reached a hidden person");
  assert.equal(afterPos1, 1, "Rec got no #6 for the first visible message");
  assert.equal(afterPos2, 1, "a second #6 inside the hour");
});

test("R48h V1/V22 #6: a hidden person's message pings nobody", async () => {
  await gathering("NH", 7);
  for (const n of ["Hr1", "Hr2", "Hd"]) {
    await mk(n, { gender: "man" });
    await pin(n, "NH");
  }
  room.NH = (await rooms("NH"))[0]!.id;
  await hide("Hd");
  const w = await ppl.Hd!.c.from("room_messages").insert({ room_id: room.NH, author_id: ppl.Hd!.id, body: "hidden author" });
  notes.push(`hidden author posts: ${w.error ? w.error.message : "accepted"}`);
  await sleep(1500);
  const rows = [...(await notifs("Hr1", "room_activity")), ...(await notifs("Hr2", "room_activity"))];
  notes.push(`#6 from a hidden author: ${JSON.stringify(rows.map((x) => [x.title, x.body]))}`);
  assert.equal(rows.length, 0, "a hidden person's message notified the room");
});

test("R49 V22: a notification's text never names someone the recipient cannot see", async () => {
  // Every row queued in this run, checked against the recipient's sight of the names in it —
  // except at Cl, A and B, which this file moves into the past after the rows were written.
  const ids = Object.values(ppl).map((p) => p.id);
  const moved = [g.Cl, g.A, g.B];
  const rows = await must(service.from("notifications").select("person_id, kind, title, body, gathering_id").in("person_id", ids), "all");
  const bad: string[] = [];
  for (const r of rows) {
    if (moved.includes(r.gathering_id)) continue;
    const text = `${r.title} ${r.body}`;
    for (const p of Object.values(ppl)) {
      if (p.id === r.person_id) continue;
      if (!new RegExp(`(^|[^A-Za-z0-9])${p.name}([^A-Za-z0-9]|$)`).test(text.replace(`${PREFIX} ${run}`, ""))) continue;
      const viewer = Object.values(ppl).find((x) => x.id === r.person_id)!;
      const seen = await viewer.c.from("people").select("id").eq("id", p.id);
      if (!(seen.data ?? []).length) bad.push(`${viewer.name} ← "${text}"`);
    }
  }
  assert.deepEqual(bad, []);
});


// ===========================================================================
// V21 — small groups
// ===========================================================================

async function invitesOf(crewId: string) {
  return must(service.from("crew_invites").select("id, to_person, status").eq("crew_id", crewId), "invites");
}

test("R50 V21: setup — Ava starts a group from G's room with Ben, Cara, Dana (all posted)", async () => {
  const before = await notifs("Ava");
  const r = await ppl.Ava!.c.rpc("start_group", { p_room: room.G, p_invitees: [ppl.Ben!.id, ppl.Cara!.id, ppl.Dana!.id] });
  notes.push(`start_group: ${r.error ? r.error.message : JSON.stringify(r.data)}`);
  assert.equal(r.error, null);
  const c = await must(service.from("crews").select("id, women_only, state").eq("gathering_id", g.G).eq("room_id", room.G), "crew");
  crew.ava = c[0].id;
  const inv = await invitesOf(crew.ava!);
  const by = (n: string) => inv.find((i: any) => i.to_person === ppl[n]!.id)!.id;
  // An outsider tries to accept Cara's invite for her.
  const steal = await ppl.Mo!.c.rpc("respond_to_invite", { p_invite: by("Cara"), p_accept: true });
  notes.push(`Mo accepts Cara's invite: ${steal.error ? steal.error.message : JSON.stringify(steal.data)}`);
  const mem = await must(service.from("crew_members").select("person_id").eq("crew_id", crew.ava!), "members");
  assert.ok(!mem.some((m: any) => m.person_id === ppl.Mo!.id), "Mo joined by accepting Cara's invite");
  await must(ppl.Ben!.c.rpc("respond_to_invite", { p_invite: by("Ben"), p_accept: false }), "Ben declines");
  await must(ppl.Cara!.c.rpc("respond_to_invite", { p_invite: by("Cara"), p_accept: true }), "Cara accepts");
  await must(ppl.Dana!.c.rpc("respond_to_invite", { p_invite: by("Dana"), p_accept: true }), "Dana accepts");
  await sleep(1500);
  const afterN = await notifs("Ava");
  const newRows = afterN.filter((x) => !before.some((b) => b.id === x.id));
  notes.push(`Ava's notifications after the invites: ${JSON.stringify(newRows.map((x) => [x.kind, x.body]))}`);
  assert.ok(!newRows.some((x) => /Ben/.test(`${x.title} ${x.body}`) || /declin/i.test(`${x.title} ${x.body}`)), "Ava was told about Ben's decline");
});

test("R51 Q4/V21: the inviter never learns of a decline — not from crew_invites, my_invites, or a re-invite's answer", async () => {
  const r = await ppl.Ava!.c.from("crew_invites").select("to_person, status").eq("crew_id", crew.ava!);
  assert.ok(!(r.data ?? []).some((x: any) => x.status === "declined"), `Ava reads a decline: ${JSON.stringify(r.data)}`);
  const mi = await ppl.Ava!.c.rpc("my_invites", { p_gathering: g.G });
  assert.ok(!JSON.stringify(mi.data ?? "").includes("declined"), `my_invites tells Ava: ${JSON.stringify(mi.data)}`);
  // A re-invite of Ben must answer the same way as a re-invite of someone who simply has not answered.
  const again = await ppl.Ava!.c.rpc("invite_more", { p_crew: crew.ava, p_invitees: [ppl.Ben!.id] });
  notes.push(`invite_more Ben after decline: ${again.error ? again.error.message : JSON.stringify(again.data)}`);
  assert.ok(!/declin/i.test(again.error?.message ?? ""), `the re-invite says why: ${again.error?.message}`);
});

test("R52 V21: a group's thread, members, plan and votes are invisible to a room peer outside it", async () => {
  await must(ppl.Cara!.c.from("crew_messages").insert({ crew_id: crew.ava, kind: "user", author_id: ppl.Cara!.id, body: "group only" }), "Cara posts in the group");
  for (const n of ["Mo", "Ben", "Hugo", "Strg"]) {
    const c = ppl[n]!.c;
    const res = await Promise.all([
      c.from("crews").select("id").eq("id", crew.ava!),
      c.from("crew_members").select("person_id").eq("crew_id", crew.ava!),
      c.from("crew_messages").select("id").eq("crew_id", crew.ava!),
      c.from("crew_proposals").select("*").eq("crew_id", crew.ava!),
      c.from("crew_invites").select("id").eq("crew_id", crew.ava!).neq("to_person", ppl[n]!.id), // your own invite is yours
    ]);
    assert.deepEqual(res.map((r) => (r.data ?? []).length), [0, 0, 0, 0, 0], `${n} sees part of Ava's group`);
  }
  const mine = await ppl.Dana!.c.from("crew_messages").select("id").eq("crew_id", crew.ava!);
  assert.ok((mine.data ?? []).length >= 1, "control: a member cannot read the group thread");
});

test("R53 V21: an outsider cannot add themselves to a group or post in its thread", async () => {
  const a = await ppl.Mo!.c.from("crew_members").insert({ crew_id: crew.ava, gathering_id: g.G, person_id: ppl.Mo!.id });
  const b = await ppl.Mo!.c.from("crew_messages").insert({ crew_id: crew.ava, kind: "user", author_id: ppl.Mo!.id, body: "I'm in" });
  const m = await must(service.from("crew_members").select("person_id").eq("crew_id", crew.ava!).eq("person_id", ppl.Mo!.id), "Mo member?");
  assert.ok(a.error && b.error && m.length === 0);
});

test("R54 V21: a member cannot post as another member, or as Pin'd (kind 'system'/'arrival')", async () => {
  const a = await ppl.Cara!.c.from("crew_messages").insert({ crew_id: crew.ava, kind: "user", author_id: ppl.Dana!.id, body: "I am Dana" });
  const b = await ppl.Cara!.c.from("crew_messages").insert({ crew_id: crew.ava, author_id: ppl.Cara!.id, kind: "system", body: "Pin'd: plan moved to 123 Fake St" });
  const c = await ppl.Cara!.c.from("crew_messages").insert({ crew_id: crew.ava, author_id: ppl.Cara!.id, kind: "arrival", body: "Dana is here" });
  notes.push(`member posts kind=system: ${b.error ? "refused" : "accepted"}; kind=arrival: ${c.error ? "refused" : "accepted"}`);
  assert.ok(a.error, "Cara posted as Dana");
  assert.ok(b.error, "Cara posted a 'system' message");
  assert.ok(c.error, "Cara posted an 'arrival' message");
});

test("R55 Q7/V21: 'I'm here' is only for yourself, and not 7 days early", async () => {
  await ppl.Cara!.c.from("crew_members").update({ arrived_at: new Date().toISOString(), arrival_note: "green jersey" }).eq("crew_id", crew.ava!).eq("person_id", ppl.Dana!.id);
  await ppl.Cara!.c.from("crew_members").update({ arrived_at: new Date().toISOString(), arrival_note: "green jersey" }).eq("crew_id", crew.ava!).eq("person_id", ppl.Cara!.id);
  const rows = await must(service.from("crew_members").select("person_id, arrived_at").eq("crew_id", crew.ava!), "members");
  const arrived = rows.filter((r: any) => r.arrived_at).map((r: any) => Object.values(ppl).find((p) => p.id === r.person_id)?.name);
  assert.deepEqual(arrived, [], `arrived 7 days early or for someone else: ${arrived}`);
});

test("R56 V21: a member cannot rewrite the group itself (state, women-only, spot, hidden)", async () => {
  const before = await must(service.from("crews").select("state, women_only, meet_at, hidden_at, room_id").eq("id", crew.ava!).single(), "crew");
  await ppl.Cara!.c.from("crews").update({ state: "done" }).eq("id", crew.ava!);
  await ppl.Cara!.c.from("crews").update({ women_only: true }).eq("id", crew.ava!);
  await ppl.Cara!.c.from("crews").update({ meet_at: inDays(1) }).eq("id", crew.ava!);
  const after = await must(service.from("crews").select("state, women_only, meet_at, hidden_at, room_id").eq("id", crew.ava!).single(), "crew");
  assert.deepEqual(after, before);
});

test("R57 V21: a second group for the same person at the same gathering is refused", async () => {
  const r = await ppl.Ava!.c.rpc("start_group", { p_room: room.G, p_invitees: [ppl.Mo!.id, ppl.Ben!.id] });
  const r2 = await ppl.Mo!.c.rpc("start_group", { p_room: room.G, p_invitees: [ppl.Cara!.id, ppl.Ben!.id] });
  notes.push(`Mo invites a group member: ${r2.error ? r2.error.message : JSON.stringify(r2.data)}`);
  assert.ok(r.error, "Ava started a second group");
  const caraInv = await must(service.from("crew_invites").select("id").eq("to_person", ppl.Cara!.id).eq("from_person", ppl.Mo!.id), "Cara invited by Mo");
  assert.equal(caraInv.length, 0, "Cara (already in a group) was invited into a second");
});

test("R58 V21: only people you have both posted with — not someone who never posted, not another room, not a blocker", async () => {
  const silent = await ppl.Mo!.c.rpc("start_group", { p_room: room.G, p_invitees: [ppl.Nell!.id, ppl.Ben!.id] });
  const fromSilent = await ppl.Nell!.c.rpc("start_group", { p_room: room.G, p_invitees: [ppl.Mo!.id, ppl.Ben!.id] });
  const otherRoom = await ppl.Mo!.c.rpc("start_group", { p_room: room.H, p_invitees: [ppl.Hugo!.id, ppl.Hana!.id] });
  const crossRoom = await ppl.Mo!.c.rpc("start_group", { p_room: room.G, p_invitees: [ppl.Hugo!.id, ppl.Ben!.id] });
  const blocked = await ppl.Bk!.c.rpc("start_group", { p_room: room.G, p_invitees: [ppl.Ava!.id, ppl.Ben!.id] });
  const intoWo = await ppl.Mo!.c.rpc("start_group", { p_room: room["G/wo"], p_invitees: [ppl.Nico!.id, ppl.Wo!.id] });
  notes.push(`start_group errors: silent=${silent.error?.message}; fromSilent=${fromSilent.error?.message}; otherRoom=${otherRoom.error?.message}; crossRoom=${crossRoom.error?.message}; blocked=${blocked.error?.message}; intoWo=${intoWo.error?.message}`);
  for (const [n, r] of [["invite a silent person", silent], ["a silent inviter", fromSilent], ["a room you're not in", otherRoom], ["someone from another gathering", crossRoom], ["someone who blocked you", blocked], ["a man into the women-only room", intoWo]] as const) {
    refusedRpc(r, n);
  }
  const strays = await must(service.from("crew_invites").select("id").in("to_person", [ppl.Nell!.id, ppl.Hugo!.id, ppl.Hana!.id, ppl.Nico!.id, ppl.Wo!.id]), "stray invites");
  assert.equal(strays.length, 0, "an invite was written");
});

test("R59 H9: refusing an invite to someone who blocked you says the same as refusing one to a hidden person (a block is never revealed)", async () => {
  const blocked = await ppl.Bk!.c.rpc("start_group", { p_room: room.G, p_invitees: [ppl.Ava!.id, ppl.Mo!.id] });
  const hidden = await ppl.Bk!.c.rpc("start_group", { p_room: room.G, p_invitees: [ppl.Hid!.id, ppl.Mo!.id] });
  const nobody = await ppl.Bk!.c.rpc("start_group", { p_room: room.G, p_invitees: [randomUUID(), ppl.Mo!.id] });
  notes.push(`block vs hidden vs nobody: ${blocked.error?.message} | ${hidden.error?.message} | ${nobody.error?.message}`);
  assert.equal(blocked.error?.message, hidden.error?.message);
  assert.equal(blocked.error?.message, nobody.error?.message);
});

test("R60 V21: invite_more and leave_group by a non-member do nothing", async () => {
  const a = await ppl.Mo!.c.rpc("invite_more", { p_crew: crew.ava, p_invitees: [ppl.Ben!.id] });
  const b = await ppl.Mo!.c.rpc("leave_group", { p_crew: crew.ava });
  const inv = await must(service.from("crew_invites").select("id").eq("crew_id", crew.ava!).eq("from_person", ppl.Mo!.id), "Mo's invites");
  assert.equal(inv.length, 0, `Mo invited into Ava's group (${a.error?.message})`);
  void b;
});

test("R61 V21: group_closes_at tells an outsider nothing about a group", async () => {
  const r = await ppl.Mo!.c.rpc("group_closes_at", { p_crew: crew.ava });
  notes.push(`group_closes_at as outsider: ${JSON.stringify(r.data)} ${r.error?.message ?? ""}`);
  assert.ok(r.error || r.data === null, `an outsider learns ${JSON.stringify(r.data)}`);
});

test("R62 H7/V21: a group from the women-only room is women-only, and a man cannot be invited into it", async () => {
  const r = await ppl.Nico!.c.rpc("start_group", { p_room: room["G/wo"], p_invitees: [ppl.Wo!.id, ppl.Eli!.id] });
  assert.equal(r.error, null, `setup: ${r.error?.message}`);
  const c = await must(service.from("crews").select("id, women_only").eq("room_id", room["G/wo"]!), "wo crew");
  crew.wo = c[0].id;
  assert.equal(c[0].women_only, true, "a group from the women-only room is not women-only");
  const add = await ppl.Nico!.c.rpc("invite_more", { p_crew: crew.wo, p_invitees: [ppl.Ben!.id] });
  const inv = await must(service.from("crew_invites").select("id").eq("crew_id", crew.wo!).eq("to_person", ppl.Ben!.id), "Ben invited?");
  assert.equal(inv.length, 0, `Ben invited into the women-only group (${add.error?.message})`);
  const seen = await ppl.Ben!.c.from("crews").select("id").eq("gathering_id", g.G);
  assert.ok(!(seen.data ?? []).some((x: any) => x.id === crew.wo), "Ben sees the women-only group");
});

test("R63 V21: an invitee cannot forge an invite row or flip someone else's", async () => {
  const forge = await ppl.Mo!.c.from("crew_invites").insert({ crew_id: crew.ava, gathering_id: g.G, from_person: ppl.Ava!.id, to_person: ppl.Mo!.id });
  const benInv = (await invitesOf(crew.ava!)).find((i: any) => i.to_person === ppl.Ben!.id)!;
  await ppl.Mo!.c.from("crew_invites").update({ status: "accepted" }).eq("id", benInv.id);
  await ppl.Ben!.c.from("crew_invites").update({ status: "accepted" }).eq("id", benInv.id);
  const after = await must(service.from("crew_invites").select("status").eq("id", benInv.id).single(), "Ben's invite");
  const benMember = await must(service.from("crew_members").select("id").eq("crew_id", crew.ava!).eq("person_id", ppl.Ben!.id).is("left_at", null), "Ben member");
  assert.ok(forge.error, "Mo forged an invite from Ava to himself");
  assert.equal(benMember.length, 0, "Ben joined by flipping his declined invite");
  notes.push(`Ben's invite after direct updates: ${after.status}`);
});

// ===========================================================================
// V23 — after the night
// ===========================================================================

test("R64 V23: setup — a group of 3 at A reaches the end of its gathering", async () => {
  for (const [n, gender] of [["A1", "woman"], ["A2", "man"], ["A3", "man"], ["A4", "man"], ["A5", "man"]] as [string, Gender][]) await mk(n, { gender });
  for (const n of ["A1", "A2", "A3", "A4"]) await pin(n, "A");
  await pin("A5", "A", false);
  room.A = (await rooms("A"))[0]!.id;
  for (const n of ["A1", "A2", "A3", "A4"]) await post(n, "A", `hi from ${n}`);
  await must(ppl.A1!.c.rpc("start_group", { p_room: room.A, p_invitees: [ppl.A2!.id, ppl.A3!.id] }), "A1 starts");
  crew.A = (await must(service.from("crews").select("id").eq("room_id", room.A), "crew A"))[0].id;
  for (const i of await invitesOf(crew.A!)) {
    const who = Object.values(ppl).find((p) => p.id === i.to_person)!;
    await must(who.c.rpc("respond_to_invite", { p_invite: i.id, p_accept: true }), `${who.name} accepts`);
  }
  await must(service.from("crew_members").update({ arrived_at: new Date().toISOString(), arrival_note: "red hat" }).eq("crew_id", crew.A!).eq("person_id", ppl.A2!.id), "A2 arrived (fixture)");
  // B: a group that never reached 3.
  for (const n of ["B1", "B2", "B3"]) {
    await mk(n, { gender: "man" });
    await pin(n, "B");
  }
  room.B = (await rooms("B"))[0]!.id;
  for (const n of ["B1", "B2", "B3"]) await post(n, "B", `hi from ${n}`);
  await must(ppl.B1!.c.rpc("start_group", { p_room: room.B, p_invitees: [ppl.B2!.id, ppl.B3!.id] }), "B1 starts");
  crew.B = (await must(service.from("crews").select("id").eq("room_id", room.B), "crew B"))[0].id;
  const b2 = (await invitesOf(crew.B!)).find((i: any) => i.to_person === ppl.B2!.id)!;
  await must(ppl.B2!.c.rpc("respond_to_invite", { p_invite: b2.id, p_accept: true }), "B2 accepts");
  // Both gatherings end: started two days ago, the list now closed.
  await must(service.from("gatherings").update({ starts_at: inDays(-2) }).in("id", [g.A, g.B]), "A, B to the past");
  const tick = await service.rpc("admin_groups_tick", {});
  notes.push(`admin_groups_tick: ${tick.error ? tick.error.message : JSON.stringify(tick.data)}`);
  const states = await must(service.from("crews").select("id, state").in("id", [crew.A, crew.B]), "states");
  notes.push(`after the end: A ${states.find((s: any) => s.id === crew.A)?.state}, B ${states.find((s: any) => s.id === crew.B)?.state}`);
  assert.equal(states.find((s: any) => s.id === crew.A)?.state, "done");
});

test("R65 V23: positive control — A1 can see crewmate A3 inside the 7 days (else the refusals prove nothing)", async () => {
  const r = await ppl.A1!.c.from("people").select("id").eq("id", ppl.A3!.id);
  assert.equal((r.data ?? []).length, 1);
});

test("R66 V23: a room peer who was not in the group sees nobody once the list closes", async () => {
  const r = await ppl.A4!.c.from("people").select("id").in("id", [ppl.A1!.id, ppl.A2!.id, ppl.A3!.id]);
  assert.deepEqual(r.data ?? [], []);
});

test("R67 V23: a group that never reached 3 grants nothing after the night", async () => {
  const r = await ppl.B1!.c.from("people").select("id").eq("id", ppl.B2!.id);
  assert.deepEqual(r.data ?? [], [], "B1 sees B2 after a group of 2");
  const t = await ppl.B1!.c.rpc("after_tick", { p_crew: crew.B, p_to: ppl.B2!.id, p_kind: "we_met", p_on: true });
  refusedRpc(t, "a tick in a group of 2");
});

test("R68 Q6: a one-way 'we met' is invisible to the other person — table, after_state, and showed_up", async () => {
  const t = await ppl.A1!.c.rpc("after_tick", { p_crew: crew.A, p_to: ppl.A3!.id, p_kind: "we_met", p_on: true });
  assert.equal(t.error, null, `setup: ${t.error?.message}`);
  const tbl = await ppl.A3!.c.from("confirmations").select("*");
  assert.deepEqual(tbl.data ?? [], [], "A3 reads confirmations");
  const st = await ppl.A3!.c.rpc("after_state", { p_gathering: g.A });
  notes.push(`A3 after_state with A1's one-way tick: ${JSON.stringify(st.data)}`);
  const s = JSON.stringify(st.data ?? "");
  assert.ok(!s.includes(ppl.A1!.id) || !/(we_met|matched|ticked)[^}]*true/.test(s.slice(s.indexOf(ppl.A1!.id), s.indexOf(ppl.A1!.id) + 300)) , "after_state tells A3 that A1 ticked");
});

test("R69 Q6: nobody reads the confirmations table directly, even their own ticks' counterparts", async () => {
  const r = await ppl.A1!.c.from("confirmations").select("*");
  assert.ok(!(r.data ?? []).some((x: any) => x.from_person !== ppl.A1!.id), `A1 reads others' ticks: ${JSON.stringify(r.data)}`);
});

test("R70 Q6/V23: forging someone else's tick (a direct insert from A3 → A1 as A2) is refused", async () => {
  const w = await ppl.A3!.c.from("confirmations").insert({ crew_id: crew.A, from_person: ppl.A2!.id, to_person: ppl.A1!.id, kind: "we_met" });
  const rows = await must(service.from("confirmations").select("*").eq("from_person", ppl.A2!.id), "A2's ticks");
  assert.ok(w.error && rows.length === 0, "a tick was written in A2's name");
});

test("R71 V23: after_tick refuses an outsider, a target outside the group, and 'keep in touch' before a matched 'we met'", async () => {
  const outsider = await ppl.A4!.c.rpc("after_tick", { p_crew: crew.A, p_to: ppl.A1!.id, p_kind: "we_met", p_on: true });
  const target = await ppl.A1!.c.rpc("after_tick", { p_crew: crew.A, p_to: ppl.A4!.id, p_kind: "we_met", p_on: true });
  const early = await ppl.A1!.c.rpc("after_tick", { p_crew: crew.A, p_to: ppl.A3!.id, p_kind: "keep_in_touch", p_on: true });
  refusedRpc(outsider, "outsider tick");
  refusedRpc(target, "tick on a non-member");
  refusedRpc(early, "keep in touch before a match");
});

test("R72 V23: a matched tick cannot be taken back; a connection forms only through both 'keep in touch'", async () => {
  for (const [a, b] of [["A1", "A2"], ["A2", "A1"]]) await must(ppl[a]!.c.rpc("after_tick", { p_crew: crew.A, p_to: ppl[b]!.id, p_kind: "we_met", p_on: true }), `${a} we_met ${b}`);
  const back = await ppl.A1!.c.rpc("after_tick", { p_crew: crew.A, p_to: ppl.A2!.id, p_kind: "we_met", p_on: false });
  refusedRpc(back, "taking back a matched tick");
  await must(ppl.A1!.c.rpc("after_tick", { p_crew: crew.A, p_to: ppl.A2!.id, p_kind: "keep_in_touch", p_on: true }), "A1 keep");
  const half = await must(service.from("connections").select("id").or(`and(person_a.eq.${ppl.A1!.id},person_b.eq.${ppl.A2!.id}),and(person_a.eq.${ppl.A2!.id},person_b.eq.${ppl.A1!.id})`), "half");
  assert.equal(half.length, 0, "a connection formed on one 'keep in touch'");
  await must(ppl.A2!.c.rpc("after_tick", { p_crew: crew.A, p_to: ppl.A1!.id, p_kind: "keep_in_touch", p_on: true }), "A2 keep");
  const full = await must(service.from("connections").select("id").or(`and(person_a.eq.${ppl.A1!.id},person_b.eq.${ppl.A2!.id}),and(person_a.eq.${ppl.A2!.id},person_b.eq.${ppl.A1!.id})`), "full");
  assert.equal(full.length, 1, "setup: no connection after both 'keep in touch'");
});

test("R73 V23: a connection cannot be forged by a direct insert, and the table is not readable directly", async () => {
  const w = await ppl.A3!.c.from("connections").insert({ ...pair(ppl.A3!.id, ppl.A1!.id), source_crew_id: crew.A });
  const w2 = await ppl.A4!.c.from("connections").insert({ ...pair(ppl.A1!.id, ppl.A4!.id) });
  const rows = await must(service.from("connections").select("id").or(`person_a.in.(${ppl.A3!.id},${ppl.A4!.id}),person_b.in.(${ppl.A3!.id},${ppl.A4!.id})`), "forged");
  notes.push(`forged connection inserts: ${w.error?.message} | ${w2.error?.message}`);
  assert.ok(w.error && w2.error && rows.length === 0, "a connection was forged");
  const r = await ppl.A3!.c.from("connections").select("*");
  assert.ok(!(r.data ?? []).length, `A3 reads connections: ${JSON.stringify(r.data)}`);
});

test("R74 V23: showed_up answers nothing about a person the asker cannot see", async () => {
  const strg = await ppl.Strg!.c.rpc("showed_up", { p_person: ppl.A2!.id });
  const a4 = await ppl.A4!.c.rpc("showed_up", { p_person: ppl.A2!.id });
  const ctl = await ppl.A1!.c.rpc("showed_up", { p_person: ppl.A2!.id });
  notes.push(`showed_up(A2): stranger ${JSON.stringify(strg.data)} ${strg.error?.message ?? ""}; A4 ${JSON.stringify(a4.data)}; crewmate A1 ${JSON.stringify(ctl.data)}`);
  assert.ok(!strg.data, "a stranger learns A2 showed up");
  assert.ok(!a4.data, "a non-crewmate learns A2 showed up");
});

test("R75 V23: the after-event question — once, after the end, open-to-meeting only, own only", async () => {
  const ok = await ppl.A4!.c.from("survey_responses").insert({ gathering_id: g.A, person_id: ppl.A4!.id, met: "none", would_have_gone: "yes" });
  assert.equal(ok.error, null, `control: A4 cannot answer: ${ok.error?.message}`);
  const twice = await ppl.A4!.c.from("survey_responses").insert({ gathering_id: g.A, person_id: ppl.A4!.id, met: "none", would_have_gone: "yes" });
  const notOpen = await ppl.A5!.c.from("survey_responses").insert({ gathering_id: g.A, person_id: ppl.A5!.id, met: "none", would_have_gone: "yes" });
  const early = await ppl.Mo!.c.from("survey_responses").insert({ gathering_id: g.G, person_id: ppl.Mo!.id, met: "none", would_have_gone: "yes" });
  const forged = await ppl.A1!.c.from("survey_responses").insert({ gathering_id: g.A, person_id: ppl.A3!.id, met: "none", would_have_gone: "no" });
  const read = await ppl.A1!.c.from("survey_responses").select("*").eq("gathering_id", g.A);
  assert.ok(twice.error, "answered twice");
  assert.ok(notOpen.error, "answered without being open to meeting");
  assert.ok(early.error, "answered before the end");
  assert.ok(forged.error, "answered as someone else");
  assert.ok(!(read.data ?? []).some((x: any) => x.person_id !== ppl.A1!.id), "read someone else's answer");
});

test("R76 V23: past the 7 days, a crewmate who is not a connection is gone; the connection stays", async () => {
  await must(service.from("gatherings").update({ starts_at: inDays(-10) }).eq("id", g.A), "A to 10 days ago");
  const a3 = await ppl.A1!.c.from("people").select("id").eq("id", ppl.A3!.id);
  const a2 = await ppl.A1!.c.from("people").select("id").eq("id", ppl.A2!.id);
  assert.equal((a2.data ?? []).length, 1, "control: the connection A2 is not visible");
  assert.deepEqual(a3.data ?? [], [], "A1 still sees crewmate A3 after 7 days");
  const t = await ppl.A1!.c.rpc("after_tick", { p_crew: crew.A, p_to: ppl.A3!.id, p_kind: "we_met", p_on: true });
  refusedRpc(t, "a tick after 7 days");
});

test("R77 V23/V4: a block hides a connection both ways — my_connections, the people row, and invites", async () => {
  await mk("Cb", { gender: "man" });
  await must(service.from("connections").insert({ ...pair(ppl.A1!.id, ppl.Cb!.id), source_crew_id: crew.A }), "A1–Cb connection");
  const ctl = await ppl.A1!.c.rpc("my_connections", {});
  assert.ok(JSON.stringify(ctl.data ?? "").includes(ppl.Cb!.id), `control: Cb not in A1's connections ${ctl.error?.message}`);
  await must(service.from("blocks").insert({ blocker_id: ppl.Cb!.id, blocked_id: ppl.A1!.id }), "Cb blocks A1");
  const mc = await ppl.A1!.c.rpc("my_connections", {});
  assert.ok(!JSON.stringify(mc.data ?? "").includes(ppl.Cb!.id), "A1 still lists the person who blocked them");
  const row = await ppl.A1!.c.from("people").select("id").eq("id", ppl.Cb!.id);
  assert.deepEqual(row.data ?? [], []);
  await pin("A1", "G2", false);
  const inv = await ppl.A1!.c.rpc("invite_connection", { p_gathering: g.G2, p_to: ppl.Cb!.id });
  await sleep(1000);
  const n = await notifs("Cb", "invite");
  notes.push(`invite to a blocker: ${inv.error ? inv.error.message : JSON.stringify(inv.data)}; Cb's invite notifications ${n.length}`);
  assert.equal(n.length, 0, "an invite reached the person who blocked the inviter");
});

test("R78 V23 #7: invites only to connections, only to a gathering you're pinned to, once per pair per gathering", async () => {
  const opts = await ppl.A1!.c.rpc("invite_options", { p_to: ppl.A3!.id });
  notes.push(`invite_options(non-connection A3): ${JSON.stringify(opts.data)} ${opts.error?.message ?? ""}`);
  const nonConn = await ppl.A1!.c.rpc("invite_connection", { p_gathering: g.G2, p_to: ppl.A3!.id });
  const notPinned = await ppl.A1!.c.rpc("invite_connection", { p_gathering: g.H, p_to: ppl.A2!.id });
  const first = await ppl.A1!.c.rpc("invite_connection", { p_gathering: g.G2, p_to: ppl.A2!.id });
  const second = await ppl.A1!.c.rpc("invite_connection", { p_gathering: g.G2, p_to: ppl.A2!.id });
  const forged = await ppl.A3!.c.from("connection_invites").insert({ from_person: ppl.A3!.id, to_person: ppl.A1!.id, gathering_id: g.G2 });
  assert.equal(first.error, null, `control: a connection invite refused: ${first.error?.message}`);
  refusedRpc(nonConn, "invite to a non-connection");
  refusedRpc(notPinned, "invite to a gathering the inviter is not pinned to");
  const rows = await must(service.from("connection_invites").select("id").eq("from_person", ppl.A1!.id).eq("to_person", ppl.A2!.id), "A1→A2 invites");
  assert.equal(rows.length, 1, `second invite to the same pair: ${second.error?.message ?? "accepted"}`);
  assert.ok(forged.error, "a direct connection_invites insert was accepted");
  const r1 = await ppl.A2!.c.from("connection_invites").select("*");
  const r2 = await ppl.A1!.c.from("connection_invites").select("*");
  assert.deepEqual([(r1.data ?? []).length, (r2.data ?? []).length], [0, 0], "connection_invites readable");
  assert.ok(!opts.data || JSON.stringify(opts.data) === "[]" || opts.error, "invite_options answers about a non-connection");
});

test("R79 V23 #7: five invites a day per inviter — the 5th allowed, the 6th refused", async () => {
  await mk("K", { gender: "man" });
  await pin("K", "G2", false);
  for (let i = 1; i <= 6; i++) {
    await mk(`K${i}`, { gender: "man" });
    await must(service.from("connections").insert({ ...pair(ppl.K!.id, ppl[`K${i}`]!.id), source_crew_id: crew.A }), `K–K${i}`);
  }
  const res = [];
  for (let i = 1; i <= 6; i++) res.push(await ppl.K!.c.rpc("invite_connection", { p_gathering: g.G2, p_to: ppl[`K${i}`]!.id }));
  notes.push(`K's six invites: ${res.map((r) => (r.error ? "refused" : "ok")).join(",")}`);
  const rows = await must(service.from("connection_invites").select("id").eq("from_person", ppl.K!.id), "K's invites");
  assert.equal(res[4]!.error, null, "the 5th invite was refused");
  assert.equal(rows.length, 5, `K sent ${rows.length} invites`);
});

test("R80 V23: invite_options answers nothing about a stranger's whereabouts", async () => {
  await pin("A3", "G2");
  const r = await ppl.Strg!.c.rpc("invite_options", { p_to: ppl.A3!.id });
  notes.push(`invite_options as a stranger about A3: ${JSON.stringify(r.data)} ${r.error?.message ?? ""}`);
  assert.ok(!JSON.stringify(r.data ?? "").includes(g.G2), "a stranger learns A3 is going to G2");
});

// ===========================================================================
// V18 inside the room — seed people (H6: never fabricate a user)
// ===========================================================================

test("R81 V18/H6: a room's member count shown to a non-tester does not count a seed person", async () => {
  const mine = await ppl.Ben!.c.rpc("my_rooms", { p_gathering: g.G });
  const general = (mine.data ?? []).find((r: any) => r.room_id === room.G);
  const all = await membersOf(room.G);
  const real = all.filter((id) => id !== ppl.Seed!.id);
  const visibleish = real.filter((id) => id !== ppl.Hid!.id);
  notes.push(`G general: my_rooms says ${general?.members}; members ${all.length}, without the seed ${real.length}, without seed and hidden ${visibleish.length}`);
  assert.ok(general, "setup: Ben has no general room in my_rooms");
  assert.ok(general.members <= real.length, `my_rooms counts the seed person for Ben (${general.members} > ${real.length})`);
});

test("R82 V18/V22 #2: a seed person's arrival never announces itself to a real person", async () => {
  await gathering("N5", 9);
  await mk("X5", { gender: "man" });
  await mk("Seed5", { gender: "man", session: false, seed: true });
  await pin("X5", "N5");
  await pin("Seed5", "N5");
  await sleep(1500);
  const x5 = await notifs("X5", "room_open");
  notes.push(`#2 on a seed arrival: ${JSON.stringify(x5.map((x) => x.body))}`);
  assert.equal(x5.length, 0, `a real person was told a seed person arrived: ${JSON.stringify(x5.map((x) => x.body))}`);
});

test("R83 V18/H7: a seed person does not count toward the women-only room's 3", async () => {
  await gathering("W3", 9);
  await mk("Wc", { gender: "woman" });
  await mk("Wd", { gender: "woman" });
  await mk("Seed3", { gender: "woman", session: false, seed: true });
  await must(ppl.Wc!.c.rpc("set_women_only_rooms", { p_on: true }), "Wc only");
  for (const n of ["Wc", "Wd", "Seed3"]) await pin(n, "W3");
  const waiting = await ppl.Wc!.c.rpc("waiting_for_women_only_room", { p_gathering: g.W3 });
  const offer = await ppl.Wd!.c.rpc("women_only_offer", { p_gathering: g.W3 });
  notes.push(`W3 (2 real + 1 seed eligible): Wc waiting ${JSON.stringify(waiting.data)}, Wd offer ${JSON.stringify(offer.data)}`);
  assert.equal(waiting.data, true, "Wc is told the women-only room is open — the third is a seed person");
  assert.ok(!offer.data, "Wd is offered a women-only room whose third member is a seed person");
});

// ===========================================================================
// Realtime — postgres_changes must respect the same rule
// ===========================================================================


const rt: Record<string, any[]> = { Ben: [], Hugo: [], Out: [], nosession: [] };

test("R84 V20: Realtime sends a room message only to people who can read it", async (t) => {
  const chans = [];
  for (const n of Object.keys(rt)) {
    const c = n === "nosession" ? newClient(env, env.publishableKey) : ppl[n]!.c;
    if (n !== "nosession") {
      const { data } = await c.auth.getSession();
      if (data.session) c.realtime.setAuth(data.session.access_token);
    }
    const ch = c
      .channel(`${PREFIX}-${run}-${n}`)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "room_messages" }, (e: any) => rt[n]!.push(e));
    const ok = await new Promise<string>((res) => {
      const timer = setTimeout(() => res("TIMEOUT"), 10_000);
      ch.subscribe((s: string) => {
        if (s === "SUBSCRIBED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT") {
          clearTimeout(timer);
          res(s);
        }
      });
    });
    chans.push([c, ch] as const);
    notes.push(`realtime ${n}: ${ok}`);
  }
  await sleep(2000);
  const id = await post("Mo", "G", "realtime probe");
  await sleep(4000);
  await ppl.Mo!.c.from("room_messages").delete().eq("id", id);
  await sleep(4000);
  for (const [c, ch] of chans) await c.removeChannel(ch);
  const brief = (n: string) => rt[n]!.map((e) => `${e.eventType}:${JSON.stringify(e.new?.body ?? e.old ?? "")}`);
  notes.push(`realtime events: ${Object.keys(rt).map((n) => `${n} ${JSON.stringify(brief(n))}`).join("; ")}`);
  if (!rt.Ben!.some((e) => e.eventType === "INSERT")) {
    t.skip("control: a room peer received no INSERT — nothing to compare against");
    return;
  }
  for (const n of ["Hugo", "Out", "nosession"]) assert.ok(!rt[n]!.some((e) => e.eventType === "INSERT"), `${n} received G's message`);
});

test("R85 V20: Realtime does not tell outsiders when a message in someone else's room is deleted", async () => {
  const leaked = ["Hugo", "Out", "nosession"].filter((n) => rt[n]!.some((e) => e.eventType === "DELETE"));
  assert.deepEqual(leaked, [], `DELETE events (message id and timing) reached: ${leaked.join(", ")}`);
});

// ===========================================================================
// Phase 2 — cases written after reading the M3.3 migrations
// ===========================================================================

async function groupWorld(label: string, names: string[]) {
  await gathering(label, 7);
  for (const n of names) {
    await mk(n, { gender: "man" });
    await pin(n, label);
  }
  room[label] = (await rooms(label)).find((r) => !r.women_only)!.id;
  for (const n of names) await post(n, label, `hi from ${n}`);
}

test("R86 V4/V21: an invite cannot be accepted across a block made after it was sent (respond_to_invite re-checks nothing)", async () => {
  await groupWorld("G5", ["P1", "P2", "P3"]);
  await must(ppl.P1!.c.rpc("start_group", { p_room: room.G5, p_invitees: [ppl.P2!.id, ppl.P3!.id] }), "P1 starts");
  crew.G5 = (await must(service.from("crews").select("id").eq("room_id", room.G5!), "crew G5"))[0].id;
  // P1 blocks P2 after inviting him.
  await must(service.from("blocks").insert({ blocker_id: ppl.P1!.id, blocked_id: ppl.P2!.id }), "P1 blocks P2");
  const mine = await ppl.P2!.c.from("crew_invites").select("id, from_person, crew_id, status").eq("to_person", ppl.P2!.id);
  const listed = await ppl.P2!.c.rpc("my_invites", { p_gathering: g.G5 });
  notes.push(`after the block, P2 reads crew_invites: ${JSON.stringify(mine.data)}; my_invites: ${JSON.stringify(listed.data)}`);
  const inv = (mine.data ?? [])[0];
  if (inv) {
    const acc = await ppl.P2!.c.rpc("respond_to_invite", { p_invite: inv.id, p_accept: true });
    notes.push(`P2 accepts the blocker's invite: ${acc.error ? acc.error.message : "accepted"}`);
  }
  await must(ppl.P1!.c.from("crew_messages").insert({ crew_id: crew.G5, kind: "user", author_id: ppl.P1!.id, body: "P1: meet me at the north gate" }), "P1 posts");
  const joined = await must(service.from("crew_members").select("id").eq("crew_id", crew.G5!).eq("person_id", ppl.P2!.id).is("left_at", null), "P2 member?");
  const reads = await ppl.P2!.c.from("crew_messages").select("body").eq("crew_id", crew.G5!);
  const crewRow = await ppl.P2!.c.from("crews").select("id, state, spot_id, meet_at").eq("id", crew.G5!);
  notes.push(`P2 in P1's group: ${joined.length}; reads ${JSON.stringify(reads.data)}; crew row ${JSON.stringify(crewRow.data)}`);
  assert.equal(joined.length, 0, "the person P1 blocked joined P1's group through a stale invite");
  assert.ok(!(reads.data ?? []).some((m: any) => m.body.startsWith("P1:")), "the blocked person reads the blocker's group messages");
});

test("R87 V4/V21 (spec silent): a block between two people already in one group hides each one's group messages from the other", async () => {
  await groupWorld("G6", ["Q1", "Q2", "Q3"]);
  await must(ppl.Q1!.c.rpc("start_group", { p_room: room.G6, p_invitees: [ppl.Q2!.id, ppl.Q3!.id] }), "Q1 starts");
  crew.G6 = (await must(service.from("crews").select("id").eq("room_id", room.G6!), "crew G6"))[0].id;
  for (const i of await invitesOf(crew.G6!)) {
    const who = Object.values(ppl).find((p) => p.id === i.to_person)!;
    await must(who.c.rpc("respond_to_invite", { p_invite: i.id, p_accept: true }), `${who.name} accepts`);
  }
  await must(service.from("blocks").insert({ blocker_id: ppl.Q1!.id, blocked_id: ppl.Q2!.id }), "Q1 blocks Q2");
  await must(ppl.Q1!.c.from("crew_messages").insert({ crew_id: crew.G6, kind: "user", author_id: ppl.Q1!.id, body: "Q1: running late" }), "Q1 posts");
  const reads = await ppl.Q2!.c.from("crew_messages").select("body").eq("crew_id", crew.G6!);
  notes.push(`Q2 (blocked by groupmate Q1) reads: ${JSON.stringify(reads.data)}`);
  assert.ok(!(reads.data ?? []).some((m: any) => m.body.startsWith("Q1:")), "a blocked groupmate reads the blocker's messages");
});

test("R88 V4/V23: invite_options never tells you where someone who blocked you is going", async () => {
  // Cb (connected to A1) blocked A1 in R77. Cb pins at G2 without opting in.
  await pin("Cb", "G2", false);
  const r = await ppl.A1!.c.rpc("invite_options", { p_to: ppl.Cb!.id });
  notes.push(`invite_options(the connection who blocked me): ${JSON.stringify(r.data)} ${r.error?.message ?? ""}`);
  assert.ok(!(r.data ?? []).some((x: any) => x.already === "going"), "A1 learns the person who blocked them is going to G2");
});

test("R88h V1/V23: invite_options never tells you where a hidden connection is going", async () => {
  await mk("Ch", { gender: "woman" });
  await must(service.from("connections").insert({ ...pair(ppl.A1!.id, ppl.Ch!.id), source_crew_id: crew.A }), "A1–Ch");
  await pin("Ch", "G2", false);
  await hide("Ch");
  const r = await ppl.A1!.c.rpc("invite_options", { p_to: ppl.Ch!.id });
  notes.push(`invite_options(a hidden connection): ${JSON.stringify(r.data)}`);
  assert.ok(!(r.data ?? []).some((x: any) => x.already === "going"), "A1 learns a hidden person is going to G2");
});

test("R89 V23 #7: five invites a day holds under concurrent calls", async () => {
  await mk("L", { gender: "man" });
  await pin("L", "G2", false);
  for (let i = 1; i <= 8; i++) {
    await mk(`L${i}`, { gender: "man" });
    await must(service.from("connections").insert({ ...pair(ppl.L!.id, ppl[`L${i}`]!.id), source_crew_id: crew.A }), `L–L${i}`);
  }
  const res = await Promise.all(Array.from({ length: 8 }, (_, i) => ppl.L!.c.rpc("invite_connection", { p_gathering: g.G2, p_to: ppl[`L${i + 1}`]!.id })));
  const rows = await must(service.from("connection_invites").select("id").eq("from_person", ppl.L!.id), "L's invites");
  notes.push(`8 concurrent invites: ${res.filter((r) => !r.error).length} accepted, ${rows.length} rows`);
  assert.ok(rows.length <= 5, `${rows.length} invites in a day`);
});

test("R90 V20: one message every 3 seconds holds under concurrent posts", async () => {
  await mk("Par", { gender: "man" });
  await pin("Par", "G");
  await sleep(500);
  const res = await Promise.all(Array.from({ length: 8 }, (_, i) => ppl.Par!.c.from("room_messages").insert({ room_id: room.G, author_id: ppl.Par!.id, body: `parallel ${i}` })));
  const ok = res.filter((r) => !r.error).length;
  notes.push(`8 concurrent posts: ${ok} accepted`);
  assert.ok(ok <= 1, `${ok} messages inside 3 seconds`);
});

test("R91 H3/Q3 (spec silent): room peers cannot read each other's last-seen time (a read receipt the list never showed)", async () => {
  await must(ppl.Ava!.c.rpc("room_seen", { p_room: room.G }), "Ava looks at the room");
  const r = await ppl.Ben!.c.from("room_members").select("person_id, joined_at, last_seen_at, first_posted_at").eq("room_id", room.G).eq("person_id", ppl.Ava!.id);
  notes.push(`Ben reads Ava's membership row: ${JSON.stringify(r.data)}`);
  assert.ok(!(r.data ?? []).some((x: any) => x.last_seen_at), "Ben can read when Ava last looked at the room");
});

// Added by the build session (Alex, 6 Oct 2026): #6 is not bait only because it is
// bounded (spec A18; decisions, "#6: why room activity is not bait, and its bound").
// A 50-message room must send someone who never opens it one #6, and someone who does
// open it one per hour at most — the next only after an hour AND an open.
test("R92 V22/A18 #6's bound: a 50-message room sends one #6 to someone who never opens it; one more only after an hour and an open", async () => {
  await gathering("NB", 7);
  const authors = ["Wa1", "Wa2", "Wa3", "Wa4", "Wa5"];
  for (const n of ["Never", "Looker", ...authors]) {
    await mk(n, { gender: "man" });
    await pin(n, "NB");
  }
  room.NB = (await rooms("NB"))[0]!.id;
  const count = async (n: string) => (await notifs(n, "room_activity")).filter((x) => x.room_id === room.NB).length;
  const burst = async (k: number, tag: string) => {
    // Five authors in turn, so no one trips the 3-second limit; post() waits between.
    for (let i = 0; i < k; i++) await post(authors[i % authors.length]!, "NB", `${tag} ${i}`);
    await sleep(1500);
  };

  await burst(50, "first evening burst");
  assert.equal(await count("Never"), 1, "50 messages: someone who never opened the room did not get exactly one #6");
  assert.equal(await count("Looker"), 1, "50 messages: control — Looker did not get exactly one #6");

  // An hour passes (the first #6 moved back 61 minutes), and Looker opened the room
  // 30 minutes ago — after that #6. Never still has never opened it.
  const hourAgo = new Date(Date.now() - 61 * 60_000).toISOString();
  for (const n of ["Never", "Looker"]) {
    await must(service.from("notifications").update({ created_at: hourAgo }).eq("person_id", ppl[n]!.id).eq("kind", "room_activity"), `backdate ${n}`);
  }
  await must(
    service.from("room_members").update({ last_seen_at: new Date(Date.now() - 30 * 60_000).toISOString() }).eq("room_id", room.NB).eq("person_id", ppl.Looker!.id),
    "Looker opened the room",
  );
  await burst(10, "after the hour");
  assert.equal(await count("Looker"), 2, "after an hour and an open: Looker did not get exactly one more #6");
  assert.equal(await count("Never"), 1, "someone who never opens the room got a second #6 — the bound is one, all evening");

  // Inside the hour after Looker's second #6, however many messages follow: nothing.
  await burst(10, "inside the next hour");
  assert.equal(await count("Looker"), 2, "a third #6 inside the hour");
  assert.equal(await count("Never"), 1, "Never: still exactly one after 70 messages");
});
