// Probe, 29 Oct 2026 (Alex, after the M3.7 review): evidence, not a fix.
//   F3-room — does a gender change leave someone in a women-only ROOM? The review reproduced
//             it for squads (RV06-F) and said "probably" for the room. Alex: test it.
//   D1      — joining a squad shows you its members (approved). It must never override a
//             block or a hide: confirm a block in either direction, from a member who is not
//             even open to meeting, and a block racing the join, all keep two people apart.
// Not in test:policies. Run: node --env-file=.dev.vars --test --test-concurrency=1 tests/policies/probe-f3-d1.test.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "./env.ts";
import { SIGN_IN_WAIT_MS, newClient, must, handleFor, passwordSignIn, removeUser, PREFIX } from "./world.ts";

const env = loadEnv();
const service = newClient(env, env.secretKey);
const run = `pb${randomBytes(3).toString("hex")}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface P { name: string; id: string; authId: string; c: SupabaseClient }
const ppl: Record<string, P> = {};
const g: Record<string, string> = {};
let venue = "";
let spot = "";
let startT = 0;

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
async function gathering(label: string) {
  const row = await must(service.from("gatherings").insert({ name: `${PREFIX} ${run} ${label}`, starts_at: new Date(startT).toISOString(), venue_id: venue, published_at: new Date().toISOString() }).select("id").single(), `gathering ${label}`);
  g[label] = row.id;
}
const pin = (name: string, G: string, open = true) => must(service.from("pins").insert({ gathering_id: g[G], person_id: ppl[name]!.id, open_to_meeting: open, party_total: 1 }), `pin ${name}@${G}`);
async function squad(who: string, G: string, name: string): Promise<string> {
  const crew = (await must(ppl[who]!.c.rpc("start_squad", { p_gathering: g[G], p_name: name, p_spot: spot, p_meet_at: new Date(startT - 3_600_000).toISOString(), p_women_only: false }), `${who} starts`)) as string;
  await must(service.rpc("admin_record_squad_name_check", { p_crew: crew, p_name: name, p_outcome: "approved", p_source: "probe" }), "approve");
  return crew;
}
const join = (who: string, crew: string) => ppl[who]!.c.rpc("join_squad", { p_crew: crew });
const block = (by: string, who: string) => ppl[by]!.c.from("blocks").insert({ blocker_id: ppl[by]!.id, blocked_id: ppl[who]!.id });
const isMember = async (who: string, crew: string) =>
  (await must(service.from("crew_members").select("id").eq("crew_id", crew).eq("person_id", ppl[who]!.id).is("left_at", null), "member")).length > 0;

before(async () => {
  venue = (await must(service.from("venues").insert({ name: `${PREFIX} ${run} Hall` }).select("id").single(), "venue")).id;
  spot = (await must(service.from("meeting_spots").insert({ venue_id: venue, name: "Front steps" }).select("id").single(), "spot")).id;
  startT = Math.ceil((Date.now() + 5 * 86_400_000) / 900_000) * 900_000;
  await gathering("W");
  await gathering("T");
  for (const n of ["Wa", "Wb", "Wc"]) await mk(n, "woman");
  for (const n of ["Ann", "Bob", "Cal", "Dee", "Eve", "Fay", "Gil"]) await mk(n, "man");
  for (const n of ["Wa", "Wb", "Wc"]) await pin(n, "W");
  for (const n of ["Ann", "Bob", "Cal", "Eve", "Fay", "Gil"]) await pin(n, "T");
  await pin("Dee", "T", false);
}, { timeout: 600_000 + SIGN_IN_WAIT_MS });

after(async () => {
  const ids = Object.values(ppl).map((p) => p.id);
  if (ids.length) {
    await service.from("blocks").delete().in("blocker_id", ids);
    await service.from("notifications").delete().in("person_id", ids);
  }
  const gids = Object.values(g);
  if (gids.length) {
    await service.from("crews").delete().in("gathering_id", gids);
    await service.from("moderation_log").delete().in("gathering_id", gids);
    await service.from("gatherings").delete().in("id", gids);
  }
  for (const p of Object.values(ppl)) await removeUser(service, p.authId).catch((e) => console.log(`# cleanup ${p.name}: ${e.message}`));
  if (venue) {
    await service.from("meeting_spots").delete().eq("venue_id", venue);
    await service.from("venues").delete().eq("id", venue);
  }
  const left = await must(service.from("person_handles").select("person_id").like("instagram", `${PREFIX}_${run}_%`), "left people");
  const leftG = await must(service.from("gatherings").select("id").like("name", `${PREFIX} ${run} %`), "left gatherings");
  assert.deepEqual({ people: left.length, gatherings: leftG.length }, { people: 0, gatherings: 0 }, "the probe left its own rows behind");
}, { timeout: 300_000 + SIGN_IN_WAIT_MS });

test("F3-room: a woman who changes her gender is no longer in, and no longer reads, the women-only room", async () => {
  const rooms = await must(service.from("rooms").select("id, women_only").eq("gathering_id", g.W), "rooms");
  const wo = rooms.find((r: { women_only: boolean }) => r.women_only);
  assert.ok(wo, `setup: no women-only room at W (rooms: ${JSON.stringify(rooms)})`);
  const members = await must(service.from("room_members").select("person_id").eq("room_id", wo.id).is("left_at", null), "wo members");
  assert.equal(members.length, 3, "setup: the women-only room does not hold the three women");
  await must(ppl.Wa!.c.from("room_messages").insert({ room_id: wo.id, author_id: ppl.Wa!.id, body: "women only room" }), "Wa posts");
  const before = await ppl.Wb!.c.from("room_messages").select("id").eq("room_id", wo.id);
  assert.equal(before.data?.length, 1, "control: Wb could not read the women-only room while eligible");

  // The write Profile makes (app/src/lib/profile.ts saveYou).
  const upd = await ppl.Wb!.c.from("people_private").update({ gender: "man", include_in_women_only: false }).eq("person_id", ppl.Wb!.id).select("gender");
  assert.equal(upd.error, null, upd.error?.message);
  await sleep(500);
  const stillMember = (await must(service.from("room_members").select("person_id").eq("room_id", wo.id).eq("person_id", ppl.Wb!.id).is("left_at", null), "Wb still")).length > 0;
  const reads = (await ppl.Wb!.c.from("room_messages").select("id").eq("room_id", wo.id)).data?.length ?? 0;
  const listed = ((await ppl.Wb!.c.rpc("my_rooms", { p_gathering: g.W })).data ?? []).some((r: { room_id: string }) => r.room_id === wo.id);
  const canPost = !(await ppl.Wb!.c.from("room_messages").insert({ room_id: wo.id, author_id: ppl.Wb!.id, body: "still here" })).error;
  assert.ok(!stillMember && reads === 0 && !listed && !canPost, `LEAK: no longer eligible, Wb is still a member: ${stillMember}, reads ${reads} message(s), listed in my_rooms: ${listed}, can post: ${canPost}`);
});

test("D1-a a person someone blocked cannot join that person's squad", async () => {
  const s = await squad("Ann", "T", "Front steps first");
  assert.equal((await block("Ann", "Bob")).error, null, "Ann could not block Bob");
  const r = await join("Bob", s);
  assert.ok(r.error && !(await isMember("Bob", s)), `Bob joined the squad of someone who blocked him (${r.error?.message ?? "accepted"})`);
});

test("D1-b someone who blocked a member cannot join that member's squad", async () => {
  const s = await squad("Eve", "T", "Early drinks");
  assert.equal((await block("Cal", "Eve")).error, null, "Cal could not block Eve");
  const r = await join("Cal", s);
  assert.ok(r.error && !(await isMember("Cal", s)), `Cal joined a squad with someone he blocked (${r.error?.message ?? "accepted"})`);
});

test("D1-c a member who is NOT open to meeting still keeps out someone they blocked", async () => {
  const s = await squad("Fay", "T", "Meet at the doors");
  // Dee joins while open, then turns meeting off: still a member, "counted, not drawn".
  await must(service.from("pins").update({ open_to_meeting: true }).eq("gathering_id", g.T).eq("person_id", ppl.Dee!.id), "Dee open");
  assert.equal((await join("Dee", s)).error, null, "Dee could not join");
  await must(ppl.Dee!.c.from("pins").update({ open_to_meeting: false }).eq("gathering_id", g.T).eq("person_id", ppl.Dee!.id), "Dee off");
  assert.ok(await isMember("Dee", s), "setup: Dee left when she turned meeting off");
  assert.equal((await block("Dee", "Gil")).error, null, "Dee could not block Gil");
  const r = await join("Gil", s);
  assert.ok(r.error && !(await isMember("Gil", s)), `Gil joined a squad holding someone who blocked him (${r.error?.message ?? "accepted"})`);
});

test("D1-d a block racing a join never leaves the two in one squad (20 tries)", { timeout: 600_000 + SIGN_IN_WAIT_MS }, async () => {
  let together = 0;
  for (let i = 0; i < 20; i++) {
    const s = await squad("Bob", "T", `Race ${i}`);
    await Promise.all([block("Bob", "Gil"), join("Gil", s)]);
    const both = (await isMember("Bob", s)) && (await isMember("Gil", s));
    const blocked = (await must(service.from("blocks").select("blocker_id").eq("blocker_id", ppl.Bob!.id).eq("blocked_id", ppl.Gil!.id), "block")).length > 0;
    if (both && blocked) together++;
    // Reset: the block goes, Gil leaves, Bob's squad ends (last one out).
    await service.from("blocks").delete().eq("blocker_id", ppl.Bob!.id).eq("blocked_id", ppl.Gil!.id);
    if (await isMember("Gil", s)) await must(ppl.Gil!.c.rpc("leave_group", { p_crew: s }), "Gil leaves");
    if (await isMember("Bob", s)) await must(ppl.Bob!.c.rpc("leave_group", { p_crew: s }), "Bob leaves");
  }
  assert.equal(together, 0, `LEAK (race): in ${together} of 20 tries the blocker and the blocked ended up in one squad`);
});
