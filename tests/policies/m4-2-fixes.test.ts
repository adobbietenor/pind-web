// M4.2 — the review fixes (29 Oct 2026; decisions, "M4.2: the review fixes"). The cases the
// reviewers' files (review-m3.4, review-m3.7) do not already hold, each proved from the side
// that must be refused and, where there is a boundary, from the side that must be let through.
//
//   P255  a block racing a squad join never leaves the two in one squad (the D1 race)
//   P256  the women-only room's Leave: out of it, still in the general room, not put back by
//         placement — until "women-only rooms only" is chosen again
//   P257  eligibility lost: out of the women-only room and squad, 1-on-1's "women only" turned
//         off — and SILENT: no message, no notification, and the departure reads exactly as a
//         Leave does to those who stay
//   P258  R1: "women only" in 1-on-1 is refused to someone not eligible, in words
//   P259  R5: a request's push is not sent once the request is withdrawn, the sender is hidden,
//         or there is a block — and is, while it is open (the control)
//   P260  F8: three squad starts per person per gathering, the fourth refused
//   P261  F5: raising your +1s in a squad with room changes your seats (the other side of RV04)
//   P262  the app's women-only rule (packages/shared womenOnlyEligible) agrees with the database's
//   P263  one AI call per squad name: the first claim wins, a second within 10 minutes loses
//   P264  a block in a finished squad: out of the chat, ticks kept with everyone but the blocked (V23)
//   P265  a hide in a finished squad is unchanged: the hidden person keeps nothing
//   P266  a block during the night keeps the ticks too; a block before it keeps nothing
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
const run = `mf${randomBytes(3).toString("hex")}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface P { name: string; id: string; authId: string; c: SupabaseClient }
const ppl: Record<string, P> = {};
const g: Record<string, string> = {};
let venue = "";
let spot = "";
let startT = 0;

async function mk(name: string, gender: "woman" | "man" | "nonbinary", include = false): Promise<P> {
  const email = `${PREFIX}-${run}-${name.toLowerCase()}@example.com`;
  const password = randomUUID();
  const made = await service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { pind_harness: true } });
  if (made.error || !made.data.user) throw new Error(`create ${name}: ${made.error?.message}`);
  const authId = made.data.user.id;
  const row = await must(service.from("people").insert({ auth_user_id: authId, first_name: name, neighbourhood: "king-west", photo_path: `${authId}/face.png` }).select("id").single(), `person ${name}`);
  await must(service.from("person_handles").insert({ person_id: row.id, instagram: handleFor(run, name) }), `handle ${name}`);
  await must(service.from("people_private").insert({ person_id: row.id, gender, include_in_women_only: include, birth_year: 1993 }), `private ${name}`);
  await must(service.from("age_attestations").upsert({ person_id: row.id, source: "a26" }, { onConflict: "person_id", ignoreDuplicates: true }), `attest ${name}`);
  const c = newClient(env, env.publishableKey);
  const s = await passwordSignIn(c, { email, password });
  if (s.error) throw new Error(`sign in ${name}: ${s.error.message}`);
  return (ppl[name] = { name, id: row.id, authId, c });
}
async function gathering(label: string): Promise<string> {
  const row = await must(service.from("gatherings").insert({ name: `${PREFIX} ${run} ${label}`, starts_at: new Date(startT).toISOString(), venue_id: venue, published_at: new Date().toISOString() }).select("id").single(), `gathering ${label}`);
  return (g[label] = row.id);
}
const pin = (name: string, G: string, open = true) => must(service.from("pins").insert({ gathering_id: g[G], person_id: ppl[name]!.id, open_to_meeting: open, party_total: 1 }), `pin ${name}@${G}`);
async function pinSolo(name: string, G: string, choice: "everyone" | "women_only") {
  await pin(name, G);
  await must(ppl[name]!.c.from("pins").update({ solo_opt_in: true, solo_visibility: choice }).eq("gathering_id", g[G]).eq("person_id", ppl[name]!.id).select("id"), `${name} turns 1-on-1 on`);
}
async function squad(who: string, G: string, name: string): Promise<string> {
  const crew = (await must(ppl[who]!.c.rpc("start_squad", { p_gathering: g[G], p_name: name, p_spot: spot, p_meet_at: new Date(startT - 3_600_000).toISOString(), p_women_only: false }), `${who} starts`)) as string;
  await must(service.rpc("admin_record_squad_name_check", { p_crew: crew, p_name: name, p_outcome: "approved", p_source: "m4-2" }), "approve");
  return crew;
}
const join = (who: string, crew: string) => ppl[who]!.c.rpc("join_squad", { p_crew: crew });
const block = (by: string, who: string) => ppl[by]!.c.from("blocks").insert({ blocker_id: ppl[by]!.id, blocked_id: ppl[who]!.id });
const isMember = async (who: string, crew: string) =>
  (await must(service.from("crew_members").select("id").eq("crew_id", crew).eq("person_id", ppl[who]!.id).is("left_at", null), "member")).length > 0;
const inRoom = async (who: string, G: string, womenOnly: boolean) =>
  (await must(service.from("room_members").select("room_id").eq("gathering_id", g[G]).eq("person_id", ppl[who]!.id).eq("women_only", womenOnly).is("left_at", null), "room")).length > 0;
const pending = async () => (await must(service.rpc("admin_pending_notifications", { p_limit: 1000 }), "pending")) as { id: string; person_id: string; kind: string; body: string }[];

before(async () => {
  venue = (await must(service.from("venues").insert({ name: `${PREFIX} ${run} Hall` }).select("id").single(), "venue")).id;
  spot = (await must(service.from("meeting_spots").insert({ venue_id: venue, name: "Front steps" }).select("id").single(), "spot")).id;
  startT = Math.ceil((Date.now() + 5 * 86_400_000) / 900_000) * 900_000;
  for (const n of ["Wa", "Wb", "Wc", "Wd", "We", "Ivy"]) await mk(n, "woman");
  for (const n of ["Bob", "Gil", "Cal", "Gus", "Hal", "Jo", "Ann", "Bea"]) await mk(n, "man");
  await mk("Nia", "nonbinary", true);
  await mk("Noa", "nonbinary", false);
}, { timeout: 600_000 + SIGN_IN_WAIT_MS });

after(async () => {
  const ids = Object.values(ppl).map((p) => p.id);
  if (ids.length) {
    await service.from("blocks").delete().in("blocker_id", ids);
    await service.from("notifications").delete().in("person_id", ids);
    await service.from("reports").delete().in("reporter_id", ids);
  }
  const gids = Object.values(g);
  if (gids.length) {
    await service.from("solo_proposals").delete().in("gathering_id", gids);
    // Ticks hold their group (P264 makes some): they go first, or the group cannot.
    const crewIds = ((await must(service.from("crews").select("id").in("gathering_id", gids), "crews")) as { id: string }[]).map((c) => c.id);
    if (crewIds.length) await service.from("confirmations").delete().in("crew_id", crewIds);
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
  assert.deepEqual({ people: left.length, gatherings: leftG.length }, { people: 0, gatherings: 0 }, "this run left its own rows behind");
}, { timeout: 300_000 + SIGN_IN_WAIT_MS });

test("P255 a block racing a squad join never leaves the blocker and the blocked in one squad (20 trials, the race proved exercised)", { timeout: 900_000 + SIGN_IN_WAIT_MS }, async () => {
  // Each trial a fresh gathering: one person starts at most 3 squads at one (P260).
  let together = 0;
  let joins = 0;
  for (let i = 0; i < 20; i++) {
    const G = `race${i}`;
    await gathering(G);
    await pin("Bob", G);
    await pin("Gil", G);
    const s = await squad("Bob", G, `Race ${i}`);
    const [b, j] = await Promise.all([sleep(i % 4).then(() => block("Bob", "Gil")), join("Gil", s)]);
    if (!j.error) joins++;
    const blocked = (await must(service.from("blocks").select("blocker_id").eq("blocker_id", ppl.Bob!.id).eq("blocked_id", ppl.Gil!.id), "block")).length > 0;
    if (!b.error && blocked && (await isMember("Bob", s)) && (await isMember("Gil", s))) together++;
    await service.from("blocks").delete().eq("blocker_id", ppl.Bob!.id).eq("blocked_id", ppl.Gil!.id);
  }
  assert.equal(together, 0, `in ${together} of 20 trials the blocker and the blocked ended up in one squad`);
  // The join must have won the lock at least once (the block then took the blocker out):
  // otherwise every trial was a plain refusal, and the race was never run.
  assert.ok(joins >= 1, "the join never went through — the race was not exercised, so this proves nothing");
});

test("P256 the women-only room's Leave: out of it, still in the general room, and placement does not put her back — until she chooses women-only rooms only", async () => {
  await gathering("L");
  for (const n of ["Wa", "Wc", "Wd", "We"]) await pin(n, "L");
  assert.ok((await inRoom("We", "L", true)) && (await inRoom("We", "L", false)), "setup: We is not in both rooms");
  await must(ppl.We!.c.rpc("leave_women_only_room", { p_gathering: g.L }), "We leaves the women-only room");
  assert.ok(!(await inRoom("We", "L", true)), "We is still in the women-only room");
  assert.ok(await inRoom("We", "L", false), "leaving the women-only room took We out of the general room");
  const listed = ((await ppl.We!.c.rpc("my_rooms", { p_gathering: g.L })).data ?? []) as { women_only: boolean }[];
  assert.ok(!listed.some((r) => r.women_only), "the women-only room is still listed to We");
  // Meeting off and on again: placement runs, and must not put her back.
  await must(ppl.We!.c.from("pins").update({ open_to_meeting: false }).eq("gathering_id", g.L).eq("person_id", ppl.We!.id).select("id"), "off");
  await must(ppl.We!.c.from("pins").update({ open_to_meeting: true }).eq("gathering_id", g.L).eq("person_id", ppl.We!.id).select("id"), "on");
  assert.ok(!(await inRoom("We", "L", true)), "placement put We back in the women-only room she left");
  assert.ok(await inRoom("We", "L", false), "We is not back in the general room");
  // "Women-only rooms only" is an explicit choice to be in them: it forgets the Leave.
  await must(ppl.We!.c.rpc("set_women_only_rooms", { p_on: true }), "women-only rooms only");
  assert.ok(await inRoom("We", "L", true), "choosing women-only rooms only did not put We back");
  await must(ppl.We!.c.rpc("set_women_only_rooms", { p_on: false }), "back to both");
});

test("P257 eligibility lost: out of the women-only room and squad, 1-on-1's 'women only' off — and silent: no line, no notification, and her departure reads as a Leave does", async () => {
  await gathering("W");
  for (const n of ["Wa", "Wb", "Wc", "Wd", "We"]) await pin(n, "W");
  await must(ppl.Wb!.c.from("pins").update({ solo_opt_in: true, solo_visibility: "women_only" }).eq("gathering_id", g.W).eq("person_id", ppl.Wb!.id).select("id"), "Wb: 1-on-1, women only");
  const wo = (await must(service.from("rooms").select("id").eq("gathering_id", g.W).eq("women_only", true).single(), "women-only room")).id;
  const sq = (await must(ppl.Wa!.c.rpc("start_squad", { p_gathering: g.W, p_name: "Women first", p_spot: spot, p_meet_at: new Date(startT - 3_600_000).toISOString(), p_women_only: true }), "Wa starts")) as string;
  await must(service.rpc("admin_record_squad_name_check", { p_crew: sq, p_name: "Women first", p_outcome: "approved", p_source: "m4-2" }), "approve");
  assert.equal((await join("Wb", sq)).error, null, "setup: Wb could not join the women-only squad");
  await must(ppl.Wa!.c.from("room_messages").insert({ room_id: wo, author_id: ppl.Wa!.id, body: "women only room" }), "Wa posts");

  const others = ["Wa", "Wc", "Wd", "We"].map((n) => ppl[n]!.id);
  const before = {
    notes: (await must(service.from("notifications").select("id").in("person_id", others), "notes")).length,
    room: (await must(service.from("room_messages").select("id").eq("room_id", wo), "room lines")).length,
    crew: (await must(service.from("crew_messages").select("id").eq("crew_id", sq), "crew lines")).length,
  };
  // Wc leaves by choice, Wb loses eligibility through the write Profile makes.
  await must(ppl.Wc!.c.rpc("leave_women_only_room", { p_gathering: g.W }), "Wc leaves");
  const upd = await ppl.Wb!.c.from("people_private").update({ gender: "man", include_in_women_only: false }).eq("person_id", ppl.Wb!.id).select("gender");
  assert.equal(upd.error, null, upd.error?.message);

  assert.ok(!(await inRoom("Wb", "W", true)), "Wb is still in the women-only room");
  assert.ok(!(await isMember("Wb", sq)), "Wb is still in the women-only squad");
  assert.equal((await ppl.Wb!.c.from("room_messages").select("id").eq("room_id", wo)).data?.length ?? 0, 0, "Wb still reads the women-only room");
  const solo = await must(service.from("pins").select("solo_opt_in, solo_visibility").eq("gathering_id", g.W).eq("person_id", ppl.Wb!.id).single(), "Wb's 1-on-1");
  assert.deepEqual(solo, { solo_opt_in: false, solo_visibility: null }, "Wb's 'women only' 1-on-1 was not turned off (or was widened)");

  // Silent: nothing written for anyone, no line in either thread.
  const after = {
    notes: (await must(service.from("notifications").select("id").in("person_id", others), "notes")).length,
    room: (await must(service.from("room_messages").select("id").eq("room_id", wo), "room lines")).length,
    crew: (await must(service.from("crew_messages").select("id").eq("crew_id", sq), "crew lines")).length,
  };
  assert.deepEqual(after, before, "a departure wrote a notification or a line");
  // What those who stay can read of the two departures, through the room screen's own columns
  // ("*" is refused: some are sealed). A member who left is not readable at all — so the one
  // who lost eligibility and the one who chose to leave read exactly alike: both simply gone.
  // The control is someone who stayed, so this cannot pass by seeing nothing.
  const view = async (who: string) =>
    (await must(ppl.Wa!.c.from("room_members").select("person_id, joined_at, first_posted_at, left_at").eq("room_id", wo).eq("person_id", ppl[who]!.id), `Wa's view of ${who}`)).length;
  assert.equal(await view("Wd"), 1, "control: Wa cannot read a member who stayed — the check would prove nothing");
  assert.equal(await view("Wc"), await view("Wb"), "a departure for eligibility reads differently from a Leave");
  assert.equal(await view("Wb"), 0, "the one who lost eligibility is still readable to those who stay");
});

test("P258 R1: 'women only' in 1-on-1 is refused to someone not eligible, in words — and 'everyone' is not", async () => {
  await gathering("S1");
  await pin("Cal", "S1");
  const r = await ppl.Cal!.c.from("pins").update({ solo_opt_in: true, solo_visibility: "women_only" }).eq("gathering_id", g.S1).eq("person_id", ppl.Cal!.id).select("id");
  assert.ok(r.error, "a man chose 'women only' for 1-on-1");
  assert.equal((r.error as { hint?: string }).hint, "solo_women_only_ineligible");
  assert.match(r.error!.message, /Women only is for women/);
  const ok = await ppl.Cal!.c.from("pins").update({ solo_opt_in: true, solo_visibility: "everyone" }).eq("gathering_id", g.S1).eq("person_id", ppl.Cal!.id).select("id");
  assert.equal(ok.error, null, `'everyone' was refused too: ${ok.error?.message}`);
});

test("P259 R5: a request's push goes only while the request is open, its sender not hidden and no block — checked at delivery", async () => {
  await gathering("S2");
  for (const n of ["Hal", "Gus", "Ivy", "Jo"]) await pinSolo(n, "S2", "everyone");
  const meetAt = new Date(startT - 3_600_000).toISOString();
  const propose = (from: string) => must(ppl[from]!.c.rpc("propose_solo", { p_gathering: g.S2, p_to: ppl.Hal!.id, p_spot: spot, p_meet_at: meetAt, p_line: 1 }), `${from} proposes`);
  const forHal = async (from: string) => (await pending()).filter((n) => n.person_id === ppl.Hal!.id && n.kind === "solo_proposal" && n.body.startsWith(from)).length;
  for (const n of ["Gus", "Ivy", "Jo"]) await propose(n);
  // The control: three open requests, three pushes waiting.
  for (const n of ["Gus", "Ivy", "Jo"]) assert.equal(await forHal(n), 1, `control: ${n}'s open request has no push waiting`);
  // Gus is hidden (a safety report would do the same): his push must not go.
  await must(service.from("people").update({ hidden_at: new Date().toISOString() }).eq("id", ppl.Gus!.id), "hide Gus");
  assert.equal(await forHal("Gus"), 0, "a hidden sender's request is still pushed to the person he was removed for");
  // Ivy withdraws.
  const ivy = ((await must(ppl.Ivy!.c.rpc("my_solo_proposals", { p_gathering: g.S2 }), "Ivy's")) as { proposal_id: string; direction: string }[]).find((p) => p.direction === "sent")!;
  await must(ppl.Ivy!.c.rpc("withdraw_solo", { p_proposal: ivy.proposal_id }), "Ivy withdraws");
  assert.equal(await forHal("Ivy"), 0, "a withdrawn request is still pushed");
  // Hal blocks Jo.
  assert.equal((await block("Hal", "Jo")).error, null, "Hal could not block Jo");
  assert.equal(await forHal("Jo"), 0, "a request is still pushed across a block");
  await must(service.from("people").update({ hidden_at: null }).eq("id", ppl.Gus!.id), "unhide Gus");
});

test("P260 F8: one squad at a time, and three starts per person per gathering — the fourth refused", async () => {
  await gathering("C");
  await pin("Ann", "C");
  for (let i = 1; i <= 3; i++) {
    const s = await squad("Ann", "C", `Start ${i}`);
    // A second squad while in one is refused (the per-kind index and in_a_group_at).
    if (i === 1) {
      const two = await ppl.Ann!.c.rpc("start_squad", { p_gathering: g.C, p_name: "Another", p_spot: spot, p_meet_at: new Date(startT - 3_600_000).toISOString(), p_women_only: false });
      assert.equal((two.error as { hint?: string } | null)?.hint, "squad_in_group", "two squads at once");
    }
    await must(ppl.Ann!.c.rpc("leave_group", { p_crew: s }), "Ann leaves (last out ends it)");
  }
  const fourth = await ppl.Ann!.c.rpc("start_squad", { p_gathering: g.C, p_name: "Start 4", p_spot: spot, p_meet_at: new Date(startT - 3_600_000).toISOString(), p_women_only: false });
  assert.equal((fourth.error as { hint?: string } | null)?.hint, "squad_start_limit", `a fourth start was not refused by the cap: ${fourth.error?.message ?? "accepted"}`);
});

test("P261 F5, the other side of RV04: raising your +1s in a squad with room changes your seats, and lowering them gives the seat back", async () => {
  await gathering("F");
  await pin("Bea", "F");
  const s = await squad("Bea", "F", "Room for more");
  const seats = async () => (await must(service.from("crew_members").select("seats").eq("crew_id", s).eq("person_id", ppl.Bea!.id).is("left_at", null).single(), "seats")).seats;
  assert.equal(await seats(), 1);
  await must(ppl.Bea!.c.from("pins").update({ party_total: 2 }).eq("gathering_id", g.F).eq("person_id", ppl.Bea!.id).select("id"), "Bea brings a friend");
  assert.equal(await seats(), 2, "a +1 in a squad with room did not take a seat");
  await must(ppl.Bea!.c.from("pins").update({ party_total: 1 }).eq("gathering_id", g.F).eq("person_id", ppl.Bea!.id).select("id"), "Bea comes alone");
  assert.equal(await seats(), 1, "dropping the +1 did not give the seat back");
});

test("P262 the app's women-only rule agrees with the database's, on real rows — a woman, a man, and nonbinary with and without 'include me'", async () => {
  const { womenOnlyEligible } = await import("../../packages/shared/src/profile.ts");
  // The database's rule is private; set_women_only_rooms(true) refuses exactly the ineligible,
  // so it answers for it. Each person is put back as they were.
  const cases = ["Wa", "Bob", "Nia", "Noa"];
  const app: Record<string, boolean> = {};
  const db: Record<string, boolean> = {};
  for (const n of cases) {
    const row = await must(service.from("people_private").select("gender, include_in_women_only").eq("person_id", ppl[n]!.id).single(), `${n}'s row`);
    app[n] = womenOnlyEligible(row);
    const r = await ppl[n]!.c.rpc("set_women_only_rooms", { p_on: true });
    db[n] = !r.error;
    if (!r.error) await must(ppl[n]!.c.rpc("set_women_only_rooms", { p_on: false }), `${n} back`);
  }
  assert.deepEqual(db, { Wa: true, Bob: false, Nia: true, Noa: false }, "the database's own answers moved — this check's oracle is not what it was");
  assert.deepEqual(app, db, "the app and the database disagree on who women-only spaces are for");
});

test("P263 one AI call per squad name: the first claim wins, a second within ten minutes loses, and a new name is its own claim", async () => {
  await gathering("N");
  await pin("Jo", "N");
  const crew = (await must(ppl.Jo!.c.rpc("start_squad", { p_gathering: g.N, p_name: "Claim me", p_spot: spot, p_meet_at: new Date(startT - 3_600_000).toISOString(), p_women_only: false }), "Jo starts")) as string;
  const claim = (name: string) => must(service.rpc("admin_claim_squad_name_check", { p_crew: crew, p_name: name }), `claim ${name}`);
  assert.equal(await claim("Claim me"), true, "the first claim was not granted");
  assert.equal(await claim("Claim me"), false, "a second claim for the same name was granted — two AI calls");
  assert.equal(await claim("  claim   ME "), false, "the same name with other spacing and case was claimed again");
  assert.equal(await claim("Another name"), true, "a different name was refused its own check");
  // A session can never claim (service only).
  const r = await ppl.Jo!.c.rpc("admin_claim_squad_name_check", { p_crew: crew, p_name: "x" });
  assert.ok(r.error, "a signed-in person could claim a name check");
});

// A finished squad, built directly: the night was four hours ago, so after_open holds.
async function finishedSquad(G: string, members: string[], state: "done" | "live" | "spot_set" = "done"): Promise<string> {
  const past = Date.now() - 4 * 3_600_000;
  g[G] = (await must(service.from("gatherings").insert({ name: `${PREFIX} ${run} ${G}`, starts_at: new Date(past).toISOString(), venue_id: venue, published_at: new Date(past - 86_400_000).toISOString() }).select("id").single(), `gathering ${G}`)).id;
  for (const n of members) await must(service.from("pins").insert({ gathering_id: g[G], person_id: ppl[n]!.id, open_to_meeting: true, party_total: 1 }), `pin ${n}`);
  const crew = (await must(service.from("crews").insert({ gathering_id: g[G], kind: "crew", state, spot_id: spot, meet_at: new Date(past - 3_600_000).toISOString(), name: "After the show", name_status: "approved", created_by: ppl[members[0]!]!.id }).select("id").single(), "crew")).id as string;
  await must(service.from("crew_members").insert(members.map((n) => ({ crew_id: crew, gathering_id: g[G], person_id: ppl[n]!.id, seats: 1 }))), "members");
  await must(service.from("crew_messages").insert({ crew_id: crew, author_id: ppl[members[2]!]!.id, kind: "user", body: "good to meet you all" }), "a message");
  return crew;
}
const afterPeople = async (who: string, G: string) =>
  (((await must(ppl[who]!.c.rpc("after_state", { p_gathering: g[G] }), `${who}'s after`)) as { people: { person_id: string }[] }).people ?? [])
    .map((p) => Object.keys(ppl).find((n) => ppl[n]!.id === p.person_id)).sort();
const tick = (from: string, crew: string, to: string, kind = "we_met") => ppl[from]!.c.rpc("after_tick", { p_crew: crew, p_to: ppl[to]!.id, p_kind: kind, p_on: true });

test("P264 a block in a finished squad: the blocker leaves the chat but keeps 'Who did you meet?' with everyone else — never with the one they blocked — silently", async () => {
  for (const [n, gen] of [["Kai", "man"], ["Lev", "man"], ["Mia", "woman"], ["Ned", "man"]] as const) await mk(n, gen);
  const crew = await finishedSquad("B", ["Kai", "Lev", "Mia", "Ned"]);
  const reads = async (who: string) => (await ppl[who]!.c.from("crew_messages").select("id").eq("crew_id", crew)).data?.length ?? 0;
  assert.equal(await reads("Kai"), 1, "control: Kai cannot read the finished squad before the block — this proves nothing");
  assert.deepEqual(await afterPeople("Kai", "B"), ["Lev", "Mia", "Ned"], "control: Kai's after-the-night list");
  const notesBefore = (await must(service.from("notifications").select("id").in("person_id", ["Kai", "Lev", "Mia", "Ned"].map((n) => ppl[n]!.id)), "notes")).length;

  assert.equal((await block("Kai", "Lev")).error, null, "Kai could not block Lev");

  // Out of the chat: not a member, reads nothing, cannot post.
  assert.ok(!(await isMember("Kai", crew)), "the blocker is still in a finished squad with the person they blocked");
  assert.equal(await reads("Kai"), 0, "the blocker still reads the finished squad's chat");
  assert.ok((await ppl.Kai!.c.from("crew_messages").insert({ crew_id: crew, author_id: ppl.Kai!.id, kind: "user", body: "still here" })).error, "the blocker can still post to the finished squad");
  // Keeps the ticks with everyone else, never with the one blocked — both ways.
  assert.deepEqual(await afterPeople("Kai", "B"), ["Mia", "Ned"], "the blocker lost the others, or still sees the one they blocked");
  assert.ok((await afterPeople("Mia", "B")).includes("Kai"), "the others no longer see the blocker for ticks");
  assert.ok(!(await afterPeople("Lev", "B")).includes("Kai"), "the blocked person still sees the blocker after the night");
  assert.equal((await tick("Kai", crew, "Mia")).error, null, "the blocker could not tick someone else in the squad");
  assert.equal((await tick("Mia", crew, "Kai")).error, null, "someone else could not tick the blocker back");
  const kaiState = (await must(ppl.Kai!.c.rpc("after_state", { p_gathering: g.B }), "Kai's after")) as { people: { person_id: string; we_met_matched: boolean }[] };
  assert.ok(kaiState.people.find((p) => p.person_id === ppl.Mia!.id)?.we_met_matched, "the blocker's tick with Mia did not match");
  assert.ok((await tick("Kai", crew, "Lev")).error, "the blocker could tick the person they blocked");
  assert.ok((await tick("Lev", crew, "Kai")).error, "the blocked person could tick the blocker");
  // Silent.
  const notesAfter = (await must(service.from("notifications").select("id").in("person_id", ["Kai", "Lev", "Mia", "Ned"].map((n) => ppl[n]!.id)), "notes")).length;
  assert.equal(notesAfter, notesBefore, "the block in a finished squad told someone");
});

test("P265 a hide in a finished squad is unchanged: the hidden person keeps nothing — moderation's loss is theirs", async () => {
  for (const [n, gen] of [["Oli", "man"], ["Pia", "woman"], ["Quy", "man"]] as const) await mk(n, gen);
  const crew = await finishedSquad("H", ["Oli", "Pia", "Quy"]);
  assert.deepEqual(await afterPeople("Oli", "H"), ["Pia", "Quy"], "control: Oli's after-the-night list");
  await must(service.from("people").update({ hidden_at: new Date().toISOString() }).eq("id", ppl.Oli!.id), "hide Oli");
  assert.ok(!(await isMember("Oli", crew)), "a hidden person is still in a finished squad");
  assert.deepEqual(await afterPeople("Oli", "H"), [], "a hidden person still sees people after the night");
  assert.ok(!(await afterPeople("Pia", "H")).includes("Oli"), "others still see a hidden person after the night");
  await must(service.from("people").update({ hidden_at: null }).eq("id", ppl.Oli!.id), "unhide Oli");
});

test("P266 a block during the night (the squad live) keeps the blocker's ticks once it finishes; a block before the night keeps nothing", async () => {
  for (const [n, gen] of [["Rex", "man"], ["Sol", "man"], ["Tia", "woman"], ["Uma", "woman"], ["Vic", "man"], ["Wil", "man"]] as const) await mk(n, gen);
  const finish = (crew: string) => must(service.from("crews").update({ state: "done" }).eq("id", crew), "the squad finishes");
  // During the night: live, Rex blocks Sol; the squad then finishes.
  const live = await finishedSquad("NL", ["Rex", "Sol", "Tia"], "live");
  assert.equal((await block("Rex", "Sol")).error, null, "Rex could not block Sol");
  assert.ok(!(await isMember("Rex", live)), "a block during the night left the blocker in the group");
  await finish(live);
  assert.deepEqual(await afterPeople("Rex", "NL"), ["Tia"], "a block during the night cost the blocker their ticks (or kept the blocked)");
  assert.ok((await afterPeople("Tia", "NL")).includes("Rex"), "the others lost the blocker for ticks");
  assert.equal((await tick("Rex", live, "Tia")).error, null, "the blocker could not tick someone else after the night");
  // Before the night: set, Uma blocks Vic; nobody has met yet, so nothing is kept.
  const before = await finishedSquad("NB", ["Uma", "Vic", "Wil"], "spot_set");
  assert.equal((await block("Uma", "Vic")).error, null, "Uma could not block Vic");
  await finish(before);
  assert.deepEqual(await afterPeople("Uma", "NB"), [], "a block before the night kept ticks for a night the blocker left before");
  assert.ok(!(await afterPeople("Wil", "NB")).includes("Uma"), "someone who left before the night is still listed after it");
});
