// Independent adversarial review of M3.7 — squads (A9, A11, A15), plus what touched them
// after the 14 Oct brief: reports on people (A10), my_chats (A19) and the thread purge (Q11).
//
// Brief: docs/m3.7-review-brief.md. Findings: docs/m3.7-review-findings.md.
//
// Three kinds of case, by prefix:
//   RVxx-F  a FINDING: fails today, and would pass once fixed.
//   RVxx-H  something attacked that HOLDS: passes today, so absence of a finding is not
//           absence of looking.
//   RVxx-D  a DESIGN observation: passes today and documents behaviour that follows from a
//           rule as written (V21/V23/H9 applied to open join). Alex's call, not a leak.
//
// Every leak is reproduced as a signed-in person with their own token. The service key only
// builds the world, simulates time passing (a gathering moved to the past, a crew set 'done'
// as the lifecycle job would) and an admin/H9 hide, and tears down — except RV05, whose
// subject IS the service-key path ("eight seats, held even against the service key").
//
// Run on its own, never alongside the main suite (it builds and removes only its own rows;
// it never calls world.ts's sweep, which would remove another run's people):
//   node --env-file=.dev.vars --test --test-concurrency=1 tests/policies/review-m3.7.test.ts
//
// No case sends a squad name to the AI: every person here is a harness user
// (app_metadata.pind_harness), so the webhook and the sweep skip their squads, and the one
// call to the deployed Worker's /squad-name-check is made by a non-member (refused before
// any AI) and by a member of an already-approved squad (nothing to check).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "./env.ts";
import { SIGN_IN_WAIT_MS, newClient, must, handleFor, passwordSignIn, removeUser, PREFIX } from "./world.ts";

const env = loadEnv();
const service = newClient(env, env.secretKey);
const anon = newClient(env, env.publishableKey);
const run = `rm${randomBytes(3).toString("hex")}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SITE = "https://pind.social";

interface P {
  name: string;
  id: string;
  authId: string;
  c: SupabaseClient;
}
const ppl: Record<string, P> = {};
const g: Record<string, string> = {};
const sq: Record<string, string> = {};
let venue = "";
let spots: string[] = [];
let startT = 0;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

async function mk(name: string, gender: "woman" | "man" | "nonbinary", o: { signIn?: boolean } = {}): Promise<P> {
  const email = `${PREFIX}-${run}-${name.toLowerCase()}@example.com`;
  const password = randomUUID();
  const made = await service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { pind_harness: true } });
  if (made.error || !made.data.user) throw new Error(`create ${name}: ${made.error?.message}`);
  const authId = made.data.user.id;
  const row = await must(
    service.from("people").insert({ auth_user_id: authId, first_name: name, neighbourhood: "king-west", photo_path: `${authId}/face.png` }).select("id").single(),
    `person ${name}`,
  );
  await must(service.from("person_handles").insert({ person_id: row.id, instagram: handleFor(run, name) }), `handle ${name}`);
  await must(service.from("people_private").insert({ person_id: row.id, gender, birth_year: 1993 }), `private ${name}`);
  await must(
    service.from("age_attestations").upsert({ person_id: row.id, source: "a26" }, { onConflict: "person_id", ignoreDuplicates: true }),
    `attest ${name}`,
  );
  let c = anon;
  if (o.signIn !== false) {
    c = newClient(env, env.publishableKey);
    const s = await passwordSignIn(c, { email, password });
    if (s.error) throw new Error(`sign in ${name}: ${s.error.message}`);
  }
  const p = { name, id: row.id, authId, c };
  ppl[name] = p;
  return p;
}

async function gathering(label: string, startsAt: number): Promise<string> {
  const row = await must(
    service
      .from("gatherings")
      .insert({ name: `${PREFIX} ${run} ${label}`, starts_at: new Date(startsAt).toISOString(), venue_id: venue, published_at: new Date().toISOString() })
      .select("id")
      .single(),
    `gathering ${label}`,
  );
  g[label] = row.id;
  await must(service.rpc("admin_mint_slug", { p_gathering: row.id }), `slug ${label}`);
  return row.id;
}

async function pin(name: string, G: string, open = true, party = 1) {
  await must(service.from("pins").insert({ gathering_id: g[G], person_id: ppl[name]!.id, open_to_meeting: open, party_total: party }), `pin ${name}@${G}`);
}

const meetAt = (G: string) => new Date(startT - 60 * 60_000).toISOString();

async function start(who: string, G: string, name: string, o: { women?: boolean } = {}): Promise<string> {
  return (await must(
    ppl[who]!.c.rpc("start_squad", { p_gathering: g[G], p_name: name, p_spot: spots[0], p_meet_at: meetAt(G), p_women_only: o.women ?? false }),
    `${who} starts "${name}"`,
  )) as string;
}

async function verdict(crew: string, outcome: "approved" | "rejected") {
  const { name } = await must(service.from("crews").select("name").eq("id", crew).single(), "squad name");
  await must(service.rpc("admin_record_squad_name_check", { p_crew: crew, p_name: name, p_outcome: outcome, p_source: "review" }), `record ${outcome}`);
}

const join = (who: string, crew: string) => ppl[who]!.c.rpc("join_squad", { p_crew: crew });
const leave = (who: string, crew: string) => must(ppl[who]!.c.rpc("leave_group", { p_crew: crew }), `${who} leaves`);

async function activeMembers(crew: string): Promise<string[]> {
  const rows = await must(service.from("crew_members").select("person_id").eq("crew_id", crew).is("left_at", null), "members");
  return rows.map((r: { person_id: string }) => Object.values(ppl).find((p) => p.id === r.person_id)?.name ?? r.person_id).sort();
}

async function post(who: string, crew: string, body: string) {
  const p = ppl[who]!;
  const { error } = await p.c.from("crew_messages").insert({ crew_id: crew, author_id: p.id, kind: "user", body });
  if (error) throw new Error(`${who} posts in ${crew}: ${error.code} ${error.message}`);
  await sleep(1100);
}

async function threadAs(who: string, crew: string): Promise<string[]> {
  const { data, error } = await ppl[who]!.c.from("crew_messages").select("body").eq("crew_id", crew).eq("kind", "user").order("created_at");
  if (error) return [];
  return (data ?? []).map((r: { body: string }) => r.body);
}

async function listedTo(who: string, G: string): Promise<any[]> {
  return must(ppl[who]!.c.rpc("squads", { p_gathering: g[G] }), `squads for ${who}`);
}

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

before(async () => {
  venue = (await must(service.from("venues").insert({ name: `${PREFIX} ${run} Arena` }).select("id").single(), "venue")).id;
  spots = (await must(
    service.from("meeting_spots").insert(["North Gate", "Patio Bar", "Statue"].map((name) => ({ venue_id: venue, name }))).select("id"),
    "spots",
  )).map((s: { id: string }) => s.id);

  startT = Math.ceil((Date.now() + 5 * 86_400_000) / 900_000) * 900_000;
  await gathering("T", startT); // the main night
  await gathering("D", startT); // moved to "last night" later, for after-the-night cases
  await gathering("E", startT); // the name-check cases

  for (const [n, gen] of [
    ["Ann", "woman"], ["Bob", "man"], ["Cal", "man"], ["Dee", "man"], ["Eli", "man"], ["Fay", "woman"], ["Gil", "man"], ["Hal", "man"],
    ["Wen", "woman"], ["Wyn", "woman"], ["Cyd", "man"], ["Hid", "man"], ["Off", "man"], ["Xav", "man"], ["Rae", "woman"],
  ] as const) {
    await mk(n, gen);
    await pin(n, "T");
  }
  await mk("Zed", "man", { signIn: false }); // an account the service key moves (RV05); never signs in
  await pin("Zed", "T");
  for (const n of ["Cyd", "Xav", "Hid"]) await pin(n, "D");
  for (const n of ["Wen", "Xav"]) await pin(n, "E");
}, { timeout: 900_000 + SIGN_IN_WAIT_MS });

after(async () => {
  const ids = Object.values(ppl).map((p) => p.id);
  const gids = Object.values(g);
  const tryDel = async (what: string, q: PromiseLike<{ error: any }>) => {
    const { error } = await q;
    if (error) console.log(`# cleanup ${what}: ${error.message}`);
  };
  if (ids.length) {
    await tryDel("reports by", service.from("reports").delete().in("reporter_id", ids));
    await tryDel("reports on", service.from("reports").delete().in("target_person_id", ids));
  }
  if (gids.length) {
    const crews = await must(service.from("crews").select("id").in("gathering_id", gids), "find crews");
    const crewIds = crews.map((c: { id: string }) => c.id);
    if (crewIds.length) {
      await tryDel("crew reports", service.from("reports").delete().in("target_crew_id", crewIds));
      await tryDel("name checks", service.from("squad_name_checks").delete().in("crew_id", crewIds));
      await tryDel("confirmations", service.from("confirmations").delete().in("crew_id", crewIds));
    }
    await tryDel("moderation log", service.from("moderation_log").delete().in("gathering_id", gids));
    await tryDel("crews", service.from("crews").delete().in("gathering_id", gids));
    await tryDel("gatherings", service.from("gatherings").delete().in("id", gids));
  }
  if (ids.length) await tryDel("notifications", service.from("notifications").delete().in("person_id", ids));
  for (const p of Object.values(ppl)) await removeUser(service, p.authId).catch((e) => console.log(`# cleanup ${p.name}: ${e.message}`));
  if (venue) {
    await tryDel("spots", service.from("meeting_spots").delete().eq("venue_id", venue));
    await tryDel("venue", service.from("venues").delete().eq("id", venue));
  }
  const leftPeople = await must(service.from("person_handles").select("person_id").like("instagram", `${PREFIX}_${run}_%`), "left people");
  const leftG = await must(service.from("gatherings").select("id").like("name", `${PREFIX} ${run} %`), "left gatherings");
  const leftV = await must(service.from("venues").select("id").like("name", `${PREFIX} ${run} %`), "left venues");
  let leftUsers = 0;
  for (let page = 1; ; page++) {
    const { data } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    leftUsers += data.users.filter((u) => (u.email ?? "").startsWith(`${PREFIX}-${run}-`)).length;
    if (data.users.length < 1000) break;
  }
  assert.deepEqual(
    { people: leftPeople.length, gatherings: leftG.length, venues: leftV.length, users: leftUsers },
    { people: 0, gatherings: 0, venues: 0, users: 0 },
    "this review run left its own rows behind",
  );
}, { timeout: 300_000 + SIGN_IN_WAIT_MS });

// ===========================================================================
// Doors that should be shut
// ===========================================================================

test("RV01-H the private schema is not an API: can_see_squad, in_group, my_seen_in_crew and may_report_from_a_message are not callable by a session", async () => {
  for (const [fn, args] of [
    ["can_see_squad", { p_crew: randomUUID() }],
    ["in_group", { p_crew: randomUUID() }],
    ["my_seen_in_crew", { p_crew: randomUUID() }],
    ["may_report_from_a_message", { p_target: ppl.Bob!.id }],
  ] as const) {
    const res = await ppl.Xav!.c.schema("private").rpc(fn, args);
    assert.ok(res.error, `private.${fn} answered a session: ${JSON.stringify(res.data)}`);
  }
});

test("RV02-H the invite-only functions are closed to a visitor too, and a legacy group is never listed, joined or reportable as a squad", async () => {
  for (const [fn, args] of [
    ["start_group", { p_room: randomUUID(), p_invitees: [] }],
    ["invite_more", { p_crew: randomUUID(), p_invitees: [] }],
    ["respond_to_invite", { p_invite: randomUUID(), p_accept: true }],
    ["my_invites", { p_gathering: g.T }],
    ["squads", { p_gathering: g.T }],
    ["join_squad", { p_crew: randomUUID() }],
    ["my_chats", {}],
  ] as const) {
    const res = await anon.rpc(fn, args);
    assert.ok(res.error, `a visitor called ${fn}`);
  }
  // A legacy group with every other flag a listed squad has.
  const legacy = (await must(
    service.from("crews").insert({ gathering_id: g.T, kind: "crew", legacy: true, state: "spot_set", spot_id: spots[0], meet_at: meetAt("T"), name: "Old group", name_status: "approved" }).select("id").single(),
    "legacy group",
  )).id as string;
  sq.legacy = legacy;
  await must(service.from("crew_members").insert({ crew_id: legacy, gathering_id: g.T, person_id: ppl.Zed!.id }), "Zed in the legacy group");
  assert.ok(!(await listedTo("Xav", "T")).some((r) => r.crew_id === legacy), "a legacy group was listed");
  const j = await join("Xav", legacy);
  assert.ok(j.error, "a legacy group was joined");
  assert.equal(j.error!.hint, "squad_closed");
  const rep = await ppl.Xav!.c.from("reports").insert({ reporter_id: ppl.Xav!.id, target_kind: "crew", target_crew_id: legacy, reason: "spam" });
  assert.ok(rep.error, "a non-member reported a legacy group");
  await must(service.from("crew_members").update({ left_at: new Date().toISOString() }).eq("crew_id", legacy), "Zed out");
});

// ===========================================================================
// Eight seats
// ===========================================================================

test("RV03-H the eighth seat is decided once: three people racing for it, exactly one gets it", async () => {
  sq.s1 = await start("Ann", "T", "Pints before the show");
  await verdict(sq.s1, "approved");
  for (const n of ["Bob", "Cal", "Dee", "Eli", "Fay", "Gil"]) assert.equal((await join(n, sq.s1)).error, null, `${n} could not join`);
  const racers = ["Hal", "Xav", "Rae"];
  const res = await Promise.all(racers.map((n) => join(n, sq.s1!)));
  const won = racers.filter((_, i) => !res[i]!.error);
  assert.equal(won.length, 1, `the last seat went to ${won.length} people: ${won.join(", ")}`);
  for (const [i, r] of res.entries()) if (r.error) assert.equal(r.error.hint, "squad_closed", `${racers[i]}: ${r.error.message}`);
  // Normalise: Hal holds the eighth seat.
  if (won[0] !== "Hal") {
    await leave(won[0]!, sq.s1);
    assert.equal((await join("Hal", sq.s1)).error, null, "Hal could not take the freed seat");
  }
  assert.equal((await activeMembers(sq.s1)).length, 8);
});

test("RV04-F eight seats with +1s: a member who raises their party size in a full squad is refused, with a sentence — never a ninth person", async () => {
  // M4.2 (29 Oct): your party size is your seats. Bob joined alone into a full squad; raising
  // his +1s there is refused, in words the app can show, and nothing changes.
  const up = await ppl.Bob!.c.from("pins").update({ party_total: 2 }).eq("gathering_id", g.T).eq("person_id", ppl.Bob!.id).select("party_total");
  assert.ok(up.error, "Bob raised his +1s in a full squad");
  assert.equal((up.error as { hint?: string }).hint, "squad_full_plus_one", `the refusal is not the seats rule: ${up.error?.message}`);
  assert.match(up.error!.message, /no seat there for a \+1/, "the refusal is not the sentence the app shows");
  const pin = await must(service.from("pins").select("party_total").eq("gathering_id", g.T).eq("person_id", ppl.Bob!.id).single(), "Bob's pin");
  assert.equal(pin.party_total, 1, "the pin changed although the refusal said it did not");
  const outsider = (await listedTo("Xav", "T")).find((r) => r.crew_id === sq.s1);
  const rows = await must(service.from("crew_members").select("person_id, seats").eq("crew_id", sq.s1).is("left_at", null), "seats");
  const pins = await must(service.from("pins").select("person_id, party_total").eq("gathering_id", g.T).in("person_id", rows.map((r: any) => r.person_id)), "pins");
  const people = pins.reduce((s: number, p: any) => s + Math.min(p.party_total, 2), 0);
  console.log(`# RV04: recorded seats ${rows.reduce((s: number, r: any) => s + r.seats, 0)}, listed seats ${outsider?.seats}, people coming ${people}`);
  assert.ok(people <= 8, `the squad now brings ${people} people to the spot, while it says ${outsider?.seats} of 8`);
});

test("RV05-F eight seats 'even against the service key': moving a member row into a full squad is not checked", async () => {
  sq.s2 = (await must(
    service.from("crews").insert({ gathering_id: g.T, kind: "crew", state: "spot_set", spot_id: spots[1], meet_at: meetAt("T"), name: "Zed's", name_status: "approved", created_by: ppl.Zed!.id }).select("id").single(),
    "Zed's squad",
  )).id as string;
  const zrow = (await must(service.from("crew_members").insert({ crew_id: sq.s2, gathering_id: g.T, person_id: ppl.Zed!.id }).select("id").single(), "Zed joins")).id;
  // Control: the insert path is held.
  const ins = await service.from("crew_members").insert({ crew_id: sq.s1, gathering_id: g.T, person_id: ppl.Rae!.id });
  assert.ok(ins.error, "control: the service key inserted a ninth seat");
  const moved = await service.from("crew_members").update({ crew_id: sq.s1 }).eq("id", zrow).select("id");
  const seats = (await must(service.from("crew_members").select("seats").eq("crew_id", sq.s1).is("left_at", null), "s1 seats")).reduce((s: number, r: any) => s + r.seats, 0);
  // Put things back whatever happened.
  await service.from("crew_members").update({ left_at: new Date().toISOString() }).eq("id", zrow);
  assert.ok(moved.error, `a member row was moved into a full squad: it now holds ${seats} seats`);
});

// ===========================================================================
// Women-only
// ===========================================================================

test("RV06-F women-only: someone who stops being eligible (Profile → gender) stays in a women-only squad and reads its thread", async () => {
  sq.wo = await start("Wen", "T", "Women going together", { women: true });
  await verdict(sq.wo, "approved");
  assert.equal((await join("Wyn", sq.wo)).error, null, "control: an eligible woman could not join");
  await post("Wen", sq.wo, "women only in here");
  // The same write A2/Profile makes (app/src/lib/profile.ts saveYou): the person's own row.
  const upd = await ppl.Wyn!.c.from("people_private").update({ gender: "man", include_in_women_only: false }).eq("person_id", ppl.Wyn!.id).select("gender");
  assert.equal(upd.error, null, `control: Wyn could not edit her own gender: ${upd.error?.message}`);
  assert.equal(upd.data?.length, 1);
  // Control: the squad no longer exists for him from outside.
  assert.ok(!(await listedTo("Wyn", "T")).some((r) => r.crew_id === sq.wo), "control: an ineligible person was listed the squad");
  const still = (await activeMembers(sq.wo)).includes("Wyn");
  const reads = await threadAs("Wyn", sq.wo);
  assert.ok(!still && reads.length === 0, `an ineligible person is still in a women-only squad (member: ${still}) and reads ${reads.length} message(s) of it`);
});

// ===========================================================================
// Membership as a key; hidden people
// ===========================================================================

test("RV07-setup a mixed squad: Cyd starts it, Hid and Off join and post; Off then turns 'open to meeting' off", async () => {
  sq.s3 = await start("Cyd", "T", "Meet at the statue");
  await verdict(sq.s3, "approved");
  for (const n of ["Hid", "Off"]) assert.equal((await join(n, sq.s3)).error, null, `${n} could not join`);
  await post("Off", sq.s3, "off says hi");
  await post("Hid", sq.s3, "hid was here");
  const off = await ppl.Off!.c.from("pins").update({ open_to_meeting: false }).eq("gathering_id", g.T).eq("person_id", ppl.Off!.id).select("id");
  assert.equal(off.error, null, off.error?.message);
  assert.deepEqual(await activeMembers(sq.s3), ["Cyd", "Hid", "Off"]);
  // sD, at D: Cyd starts, Xav joins just before it meets, Hid joins too. Then the night passes.
  sq.sD = await start("Cyd", "D", "After party");
  await verdict(sq.sD, "approved");
  for (const n of ["Xav", "Hid"]) assert.equal((await join(n, sq.sD)).error, null, `${n} could not join sD`);
  await post("Cyd", sq.sD, "see you there");
  // Last night: started 4 h ago, effective end 1 h ago; the lifecycle job would have set it done.
  await must(service.from("gatherings").update({ starts_at: new Date(Date.now() - 4 * 3_600_000).toISOString() }).eq("id", g.D), "D to last night");
  await must(service.from("crews").update({ state: "done", meet_at: new Date(Date.now() - 5 * 3_600_000).toISOString() }).eq("id", sq.sD), "sD done");
});

test("RV08-F a hidden person's words stay in a squad's thread: members read them, a new joiner reads them from the start, and they are the A19 preview", async () => {
  // An H9 / admin hide (the same column the auto-hide sets).
  await must(service.from("people").update({ hidden_at: new Date().toISOString() }).eq("id", ppl.Hid!.id), "hide Hid");
  assert.ok(!(await activeMembers(sq.s3)).includes("Hid"), "control: a hidden person stayed in a live squad");
  const cyd = await threadAs("Cyd", sq.s3);
  assert.ok(cyd.includes("off says hi"), "control: a member could not read the thread");
  // A new stranger joins after the hide.
  assert.equal((await join("Xav", sq.s3)).error, null, "control: Xav could not join s3");
  const xav = await threadAs("Xav", sq.s3);
  const chats = (await must(ppl.Cyd!.c.rpc("my_chats"), "Cyd's my_chats")) as any[];
  const ev = chats.find((e) => e.gathering_id === g.T);
  const preview = ev?.crews?.find((c: any) => c.crew_id === sq.s3)?.last?.body;
  console.log(`# RV08: Cyd reads ${JSON.stringify(cyd)}; Xav (joined after) reads ${JSON.stringify(xav)}; Cyd's A19 preview: ${JSON.stringify(preview)}`);
  assert.ok(
    !cyd.includes("hid was here") && !xav.includes("hid was here") && preview !== "hid was here",
    "a hidden person's message is still readable in the squad thread (the room's rule hides it at the moment of the hide)",
  );
});

test("RV09-F hidden after the night: a hidden person is taken out of a done squad too, and can neither read nor post", async () => {
  // Hid was hidden in RV08 while sD was already done. M4.2 (29 Oct): a hide takes a person out
  // of every group in any state but dissolved.
  assert.ok(!(await activeMembers(sq.sD)).includes("Hid"), "a hidden person is still a member of a finished squad");
  const reads = await threadAs("Hid", sq.sD);
  const { error } = await ppl.Hid!.c.from("crew_messages").insert({ crew_id: sq.sD, author_id: ppl.Hid!.id, kind: "user", body: "still here, hidden" });
  const othersSee = (await threadAs("Xav", sq.sD)).includes("still here, hidden");
  console.log(`# RV09: hidden Hid reads ${reads.length} message(s) of sD; his post ${error ? `refused (${error.message})` : "accepted"}; Xav sees it: ${othersSee}`);
  assert.ok(reads.length === 0 && error, "a hidden person still reads a squad's thread and posts into it after the night");
});

test("RV10-D 'counted, not drawn' lasts one tap: joining shows a member the card would not name, and their photo path", async () => {
  // Rae (not a member) sees s3's card: Off turned 'open to meeting' off, so he is counted, not named.
  const card = (await listedTo("Rae", "T")).find((r) => r.crew_id === sq.s3);
  assert.ok(card, "precondition: s3 is listed to Rae");
  const named = card.members.map((m: { first_name: string }) => m.first_name).sort();
  assert.ok(!named.includes("Off"), "precondition: Off is not named on the card");
  const before = await ppl.Rae!.c.from("people").select("first_name, photo_path").eq("id", ppl.Off!.id);
  assert.equal(before.data?.length ?? 0, 0, "precondition: Rae cannot read Off's row");
  assert.equal((await join("Rae", sq.s3)).error, null, "Rae could not join");
  const afterJoin = await ppl.Rae!.c.from("people").select("first_name, photo_path").eq("id", ppl.Off!.id);
  await leave("Rae", sq.s3);
  const afterLeave = await ppl.Rae!.c.from("people").select("first_name").eq("id", ppl.Off!.id);
  console.log(`# RV10: card names ${JSON.stringify(named)} of ${card.seats} seats; after one tap Rae reads ${JSON.stringify(afterJoin.data)}; after leaving ${afterLeave.data?.length} row(s)`);
  assert.equal(afterJoin.data?.length, 1, "documents: a joiner reads every member, including one off the people list");
  assert.equal(afterLeave.data?.length, 0);
});

test("RV11-D after the night, open join is a 7-day key: a stranger who joined a squad (and never met anyone) reads its members for A16's 7 days", async () => {
  // Xav joined sD at the last minute. Nobody ticked anything; nobody is connected.
  const conns = await must(service.from("connections").select("person_a").or(`person_a.eq.${ppl.Xav!.id},person_b.eq.${ppl.Xav!.id}`), "connections");
  assert.equal(conns.length, 0, "precondition: Xav has no connection");
  // Off the people list at D: the list closed with the night.
  const rows = await ppl.Xav!.c.from("people").select("first_name, photo_path, neighbourhood").eq("id", ppl.Cyd!.id);
  const after = await ppl.Xav!.c.rpc("after_state", { p_gathering: g.D });
  console.log(`# RV11: Xav reads ${JSON.stringify(rows.data)}; after_state ${after.error ? after.error.message : JSON.stringify(after.data).slice(0, 300)}`);
  assert.equal(rows.data?.length, 1, "documents: V23's 7 days reach anyone who tapped join");
});

test("RV12-H a hidden person cannot get back in, and someone who left cannot report from the thread they no longer read", async () => {
  const j = await join("Hid", sq.s3);
  assert.ok(j.error, "a hidden person rejoined a squad");
  assert.equal(j.error!.hint, "squad_closed");
  // Rae left s3 in RV10: a report from Off's message there must be refused now.
  const m = await must(service.from("crew_messages").select("created_at").eq("crew_id", sq.s3).eq("author_id", ppl.Off!.id).limit(1).single(), "Off's message");
  const r = await ppl.Rae!.c.from("reports").insert({ reporter_id: ppl.Rae!.id, target_kind: "person", target_person_id: ppl.Off!.id, reason: "spam", context_crew_id: sq.s3, context_at: m.created_at });
  assert.ok(r.error, "someone who left a squad reported from its thread");
});

test("RV13-F women-only rooms only: a race between the switch and a join leaves her in a mixed squad (20 attempts)", async () => {
  // s3 is mixed and listed to Rae. Each attempt fires the join and the switch together.
  // M4.2 (29 Oct): the join and the switch take Rae's lock. Proved by counting the attempts
  // where the join went through (the switch then had to take her out): the case fails
  // unless at least one happened, so an attempt that never raced cannot pass for one that held.
  let raced = 0;
  let tries = 0;
  let joined = 0;
  for (let i = 0; i < 20; i++) {
    tries++;
    const delay = i % 4; // 0–3 ms stagger, to move the overlap around
    const [jr] = await Promise.all([
      join("Rae", sq.s3),
      sleep(delay).then(() => ppl.Rae!.c.rpc("set_women_only_rooms", { p_on: true })),
    ]);
    if (!jr.error) joined++;
    const priv = await must(service.from("people_private").select("women_only_rooms").eq("person_id", ppl.Rae!.id).single(), "Rae's setting");
    const inIt = (await activeMembers(sq.s3)).includes("Rae");
    if (inIt && priv.women_only_rooms) {
      raced++;
      break;
    }
    if (inIt) await leave("Rae", sq.s3);
    await must(ppl.Rae!.c.rpc("set_women_only_rooms", { p_on: false }), "switch off");
    void jr;
  }
  if ((await activeMembers(sq.s3)).includes("Rae")) await leave("Rae", sq.s3);
  await ppl.Rae!.c.rpc("set_women_only_rooms", { p_on: false });
  console.log(`# RV13: ${raced ? `reproduced on attempt ${tries}` : `not reproduced in ${tries} attempts`}`);
  assert.equal(raced, 0, `"women-only rooms only" and still in a mixed squad, after ${tries} attempt(s)`);
  assert.ok(joined >= 1, `in ${tries} attempts the join never went through — the race was not exercised, so this proves nothing`);
});

// ===========================================================================
// The name
// ===========================================================================

test("RV14-F a refused name can be resubmitted unchanged — the creator re-rolls the AI until it passes", async () => {
  sq.bad = await start("Wen", "E", "Something awful");
  await verdict(sq.bad, "rejected");
  const again = await ppl.Wen!.c.rpc("rename_squad", { p_crew: sq.bad, p_name: "Something awful" });
  const st = (await must(service.from("crews").select("name, name_status").eq("id", sq.bad).single(), "status")) as { name: string; name_status: string };
  console.log(`# RV14: renaming a refused name to itself: ${again.error ? `refused (${again.error.message})` : "accepted"}; now ${JSON.stringify(st)}`);
  assert.ok(again.error && st.name_status === "rejected", "the same refused name went back to 'pending' — back to the AI for another roll");
});

test("RV15-F renaming a name that hasn't passed has no limit: every rename is another AI call, against the city's shared daily cap", async () => {
  let accepted = 0;
  for (let i = 0; i < 25; i++) {
    const r = await ppl.Wen!.c.rpc("rename_squad", { p_crew: sq.bad, p_name: `Name number ${i}` });
    if (!r.error) accepted++;
    else break;
  }
  console.log(`# RV15: ${accepted} of 25 back-to-back renames accepted (each fires crews_squad_name_webhook for a real person)`);
  assert.ok(accepted < 25, `${accepted} renames in a row were accepted, none refused`);
});

test("RV16-H /squad-name-check on the deployed Worker: a non-member is refused before any check; a member of an approved squad spends nothing", async () => {
  const tok = async (who: string) => (await ppl[who]!.c.auth.getSession()).data.session!.access_token;
  const call = async (who: string, crew: string) => {
    const res = await fetch(`${SITE}/squad-name-check`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${await tok(who)}` },
      body: JSON.stringify({ crew_id: crew }),
    });
    return { status: res.status, body: await res.text() };
  };
  // Xav is not in Wen's pending squad: refused as "not your squad", no AI.
  const outsider = await call("Xav", sq.bad!);
  assert.equal(outsider.status, 404, `a non-member's check ran: ${outsider.status} ${outsider.body}`);
  // Ann is in s1, approved: nothing to check.
  const member = await call("Ann", sq.s1!);
  assert.equal(member.status, 200, member.body);
  assert.match(member.body, /"checked":false/);
  // And the squad's checks table holds nothing from either call.
  const checks = await must(service.from("squad_name_checks").select("source").in("crew_id", [sq.bad, sq.s1]).eq("source", "app"), "checks");
  assert.equal(checks.length, 0, "an app-sourced check was recorded");
});

// ===========================================================================
// Reports (H9)
// ===========================================================================

test("RV17 D3 as decided (Alex, 29 Oct): one report hides a squad for its reporter only; two from different people delist it; members cannot report their own", async () => {
  sq.e2 = sq.bad!;
  await must(service.rpc("admin_approve_squad_name", { p_crew: sq.e2, p_actor: `${PREFIX}@example.com` }), "approve");
  await pin("Rae", "E"); // a second person it is listed to
  assert.ok((await listedTo("Xav", "E")).some((r) => r.crew_id === sq.e2), "precondition: listed to Xav");
  assert.ok((await listedTo("Rae", "E")).some((r) => r.crew_id === sq.e2), "precondition: listed to Rae");
  // One safety report: gone for the reporter, still listed for everyone else.
  const r = await ppl.Xav!.c.from("reports").insert({ reporter_id: ppl.Xav!.id, target_kind: "crew", target_crew_id: sq.e2, reason: "uncomfortable" });
  assert.equal(r.error, null, r.error?.message);
  assert.equal((await must(service.from("crews").select("hidden_at").eq("id", sq.e2).single(), "hidden")).hidden_at, null, "one safety report delisted a squad for everyone");
  assert.ok(!(await listedTo("Xav", "E")).some((x) => x.crew_id === sq.e2), "the reporter still sees the squad they reported");
  assert.ok((await listedTo("Rae", "E")).some((x) => x.crew_id === sq.e2), "one report took the squad off someone else's list");
  // A member cannot report their own squad (from inside, you report a person).
  const own = await ppl.Ann!.c.from("reports").insert({ reporter_id: ppl.Ann!.id, target_kind: "crew", target_crew_id: sq.s1, reason: "uncomfortable" });
  assert.ok(own.error, "a member reported their own squad");
  assert.ok((await listedTo("Rae", "T")).some((x) => x.crew_id === sq.s1), "a member's own report took their squad off the list");
  // A second report, from a different person, of any kind: delisted for everyone.
  const r2 = await ppl.Rae!.c.from("reports").insert({ reporter_id: ppl.Rae!.id, target_kind: "crew", target_crew_id: sq.e2, reason: "spam" });
  assert.equal(r2.error, null, r2.error?.message);
  assert.ok((await must(service.from("crews").select("hidden_at").eq("id", sq.e2).single(), "hidden")).hidden_at, "two reports from different people did not delist the squad");
  // And the admin can list it again (the way back from two wrong reports), and delist it alone.
  await must(service.rpc("admin_set_squad_listed", { p_crew: sq.e2, p_listed: true, p_actor: `${PREFIX}@example.com`, p_note: "review" }), "relist");
  assert.equal((await must(service.from("crews").select("hidden_at").eq("id", sq.e2).single(), "hidden")).hidden_at, null, "the admin could not list it again");
  await must(service.rpc("admin_set_squad_listed", { p_crew: sq.e2, p_listed: false, p_actor: `${PREFIX}@example.com`, p_note: "review" }), "delist");
  assert.ok((await must(service.from("crews").select("hidden_at").eq("id", sq.e2).single(), "hidden")).hidden_at, "the admin could not delist it");
});
