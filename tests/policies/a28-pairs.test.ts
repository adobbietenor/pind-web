// #17 — "Let's meet up!": pairs (A28, A29; Alex, 29 Oct 2026; decisions, "#17: 1-on-1 'Let's
// meet up!'"). Each rule from the side that must be refused and, where there is one, the side
// that must be let through.
//
//   P267  an invite names no spot and no time; half of one is refused; both see it listed
//   P268  accepted, it is a pair: forming, no spot; the two read and write its chat — nobody
//         else reads the pair, its members, its chat or its suggestion
//   P269  a pair counts as your one 1-on-1: off everyone else's list, nothing else sent or accepted
//   P270  no Instagram in a pair; once it is a plan, the partner's handle (V17)
//   P271  the spot: either suggests, only the other confirms; a new suggestion replaces the
//         old; confirmed, it is a plan (spot and time), and the suggester is told (#3)
//   P272  at the start a pair can no longer become a plan, and its chat follows Q11
//   P273  the lifecycle tick leaves a pair alone (its forming rules are squads')
//   P274  a block ends a pair, and the other is told it is off — never why
//   P275  the brake, pulled, ends every pair and tells both; a plan stands
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
const run = `pr${randomBytes(3).toString("hex")}`;

interface P { name: string; id: string; authId: string; c: SupabaseClient }
const ppl: Record<string, P> = {};
const g: Record<string, string> = {};
let venue = "";
let spots: string[] = [];
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
async function gathering(label: string, startsAt = startT): Promise<string> {
  const row = await must(service.from("gatherings").insert({ name: `${PREFIX} ${run} ${label}`, starts_at: new Date(startsAt).toISOString(), venue_id: venue, published_at: new Date(startsAt - 7 * 86_400_000).toISOString() }).select("id").single(), `gathering ${label}`);
  return (g[label] = row.id);
}
async function soloOn(name: string, G: string) {
  await must(service.from("pins").insert({ gathering_id: g[G], person_id: ppl[name]!.id, open_to_meeting: true, party_total: 1 }), `pin ${name}`);
  await must(ppl[name]!.c.from("pins").update({ solo_opt_in: true, solo_visibility: "everyone" }).eq("gathering_id", g[G]).eq("person_id", ppl[name]!.id).select("id"), `${name} 1-on-1 on`);
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
  (await must(service.from("notifications").select("body").eq("person_id", ppl[who]!.id).eq("crew_id", crew), "notes")) as { body: string }[];
const meetAt = () => new Date(startT - 3_600_000).toISOString();

before(async () => {
  venue = (await must(service.from("venues").insert({ name: `${PREFIX} ${run} Arena` }).select("id").single(), "venue")).id;
  spots = ((await must(service.from("meeting_spots").insert(["North Gate", "Patio Bar"].map((name) => ({ venue_id: venue, name }))).select("id"), "spots")) as { id: string }[]).map((s) => s.id);
  startT = Math.ceil((Date.now() + 5 * 86_400_000) / 900_000) * 900_000;
  for (const [n, gen] of [["Ann", "woman"], ["Bob", "man"], ["Cal", "man"], ["Dee", "woman"], ["Eve", "woman"], ["Fin", "man"], ["Gus", "man"], ["Hal", "man"], ["Ivy", "woman"], ["Jon", "man"]] as const) await mk(n, gen);
}, { timeout: 600_000 + SIGN_IN_WAIT_MS });

after(async () => {
  await service.rpc("admin_set_solo_brake", { p_pulled: false, p_actor: `${PREFIX}@example.com` });
  const ids = Object.values(ppl).map((p) => p.id);
  if (ids.length) {
    await service.from("blocks").delete().in("blocker_id", ids);
    await service.from("notifications").delete().in("person_id", ids);
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
  if (venue) {
    await service.from("meeting_spots").delete().eq("venue_id", venue);
    await service.from("venues").delete().eq("id", venue);
  }
  const left = await must(service.from("person_handles").select("person_id").like("instagram", `${PREFIX}_${run}_%`), "left people");
  const leftG = await must(service.from("gatherings").select("id").like("name", `${PREFIX} ${run} %`), "left gatherings");
  assert.deepEqual({ people: left.length, gatherings: leftG.length }, { people: 0, gatherings: 0 }, "this run left its own rows behind");
}, { timeout: 300_000 + SIGN_IN_WAIT_MS });

test("P267 an invite names no spot and no time; half of one is refused; both see it listed", async () => {
  await gathering("A");
  for (const n of ["Ann", "Bob"]) await soloOn(n, "A");
  const half = await ppl.Ann!.c.rpc("propose_solo", { p_gathering: g.A, p_to: ppl.Bob!.id, p_spot: spots[0], p_meet_at: null, p_line: null });
  assert.ok(half.error, "a request with a spot and no time was accepted");
  assert.equal((await invite("Ann", "Bob", "A")).error, null, "'Let's meet up!' was refused");
  const sent = (await listed("Ann", "A")).find((r) => r.direction === "sent");
  const got = (await listed("Bob", "A")).find((r) => r.direction === "received");
  assert.ok(sent && got, "the invite is missing from a list (an inner join on the spot would drop it)");
  assert.deepEqual([got.spot_id, got.meet_at], [null, null]);
});

test("P268 accepted, it is a pair: forming, no spot; the two read and write its chat — nobody else reads the pair, its members, its chat or its suggestion", async () => {
  await soloOn("Cal", "A");
  const crew = await pair("Cal", "Ann", "A");
  // Bob's invite to Ann is still open; Ann's pair with Cal closes it (one 1-on-1, P269).
  assert.deepEqual(await crewOf(crew), { state: "forming", spot_id: null, meet_at: null }, "an accepted invite is not a pair");
  for (const [who, body] of [["Ann", "hi Cal"], ["Cal", "hi Ann"]] as const) {
    assert.equal((await ppl[who]!.c.from("crew_messages").insert({ crew_id: crew, author_id: ppl[who]!.id, kind: "user", body })).error, null, `${who} cannot write in the pair's chat`);
  }
  assert.equal((await ppl.Ann!.c.from("crew_messages").select("id").eq("crew_id", crew)).data?.length, 2, "the pair cannot read its own chat");
  await must(ppl.Cal!.c.rpc("suggest_solo_spot", { p_crew: crew, p_spot: spots[0], p_meet_at: meetAt() }), "Cal suggests");
  // Bob was at the same gathering, in 1-on-1, and asked Ann: still nothing of the pair.
  for (const [what, q] of [
    ["the pair", ppl.Bob!.c.from("crews").select("id").eq("id", crew)],
    ["its members", ppl.Bob!.c.from("crew_members").select("person_id").eq("crew_id", crew)],
    ["its chat", ppl.Bob!.c.from("crew_messages").select("id").eq("crew_id", crew)],
    ["its suggestion", ppl.Bob!.c.from("solo_spot_suggestions").select("crew_id").eq("crew_id", crew)],
  ] as const) {
    const { data } = await q;
    assert.equal((data ?? []).length, 0, `someone outside the pair read ${what}`);
  }
  assert.ok((await ppl.Bob!.c.from("crew_messages").insert({ crew_id: crew, author_id: ppl.Bob!.id, kind: "user", body: "me too" })).error, "someone outside the pair wrote in its chat");
  // The pair's own: both read the suggestion.
  assert.equal((await ppl.Ann!.c.from("solo_spot_suggestions").select("crew_id").eq("crew_id", crew)).data?.length, 1, "the other in the pair cannot read the suggestion");
  g.pairAC = crew;
});

test("P269 a pair counts as your one 1-on-1: off everyone else's list, nothing else sent or accepted", async () => {
  // Bob is still in 1-on-1 at A; Ann and Cal are a pair.
  const bobSees = await soloPeople("Bob", "A");
  assert.ok(!bobSees.includes("Ann") && !bobSees.includes("Cal"), "someone in a pair is still on another's 1-on-1 list");
  assert.ok((await invite("Ann", "Bob", "A")).error, "someone in a pair sent another invite");
  assert.ok((await invite("Bob", "Cal", "A")).error, "someone in a pair was sent an invite");
  // Bob's earlier invite to Ann closed when she made the pair: not listed to him as pending.
  assert.ok(!(await listed("Bob", "A")).some((r) => r.person_id === ppl.Ann!.id), "an invite to someone now in a pair is still open");
});

test("P270 no Instagram in a pair; once it is a plan, the partner's handle (V17)", async () => {
  const handle = (who: string, of: string) => ppl[who]!.c.from("person_handles").select("instagram").eq("person_id", ppl[of]!.id);
  assert.equal((await handle("Ann", "Cal")).data?.length ?? 0, 0, "a pair shares Instagram before it is a plan");
  await must(ppl.Ann!.c.rpc("confirm_solo_spot", { p_crew: g.pairAC }), "Ann confirms Cal's spot");
  assert.equal((await handle("Ann", "Cal")).data?.length, 1, "control: a plan's partner cannot read the handle — the rule's other side is gone");
});

test("P271 the spot: either suggests, only the other confirms; a new suggestion replaces the old; confirmed, it is a plan and the suggester is told (#3)", async () => {
  await gathering("B");
  for (const n of ["Dee", "Eve"]) await soloOn(n, "B");
  const crew = await pair("Dee", "Eve", "B");
  await must(ppl.Dee!.c.rpc("suggest_solo_spot", { p_crew: crew, p_spot: spots[0], p_meet_at: meetAt() }), "Dee suggests");
  const own = await ppl.Dee!.c.rpc("confirm_solo_spot", { p_crew: crew });
  assert.equal((own.error as { hint?: string } | null)?.hint, "pair_own_suggestion", "the suggester confirmed their own spot");
  // Eve suggests another: it replaces Dee's, and now only Dee can confirm.
  const later = new Date(startT - 2 * 3_600_000).toISOString();
  await must(ppl.Eve!.c.rpc("suggest_solo_spot", { p_crew: crew, p_spot: spots[1], p_meet_at: later }), "Eve suggests another");
  assert.equal((await ppl.Eve!.c.rpc("confirm_solo_spot", { p_crew: crew })).error !== null, true, "the new suggester confirmed their own");
  const bad = await ppl.Eve!.c.rpc("suggest_solo_spot", { p_crew: crew, p_spot: spots[1], p_meet_at: new Date(startT - 20 * 3_600_000).toISOString() });
  assert.equal((bad.error as { hint?: string } | null)?.hint, "pair_time", "a time outside the window was suggested");
  await must(ppl.Dee!.c.rpc("confirm_solo_spot", { p_crew: crew }), "Dee confirms Eve's");
  const c = await crewOf(crew);
  assert.deepEqual([c.state, c.spot_id, Date.parse(c.meet_at)], ["spot_set", spots[1], Date.parse(later)], "confirmed, it is not the plan suggested");
  assert.ok((await notes("Eve", crew)).some((n) => /said yes: you're meeting at Patio Bar/.test(n.body)), "the suggester was not told the plan is made");
  assert.equal((await ppl.Eve!.c.from("solo_spot_suggestions").select("crew_id").eq("crew_id", crew)).data?.length ?? 0, 0, "the suggestion outlived the plan");
  assert.ok((await ppl.Eve!.c.rpc("suggest_solo_spot", { p_crew: crew, p_spot: spots[0], p_meet_at: meetAt() })).error, "a plan's spot was changed by a new suggestion");
});

test("P272 at the start a pair can no longer become a plan, and its chat follows Q11", async () => {
  await gathering("C");
  for (const n of ["Fin", "Gus"]) await soloOn(n, "C");
  const crew = await pair("Fin", "Gus", "C");
  await must(ppl.Fin!.c.rpc("suggest_solo_spot", { p_crew: crew, p_spot: spots[0], p_meet_at: meetAt() }), "Fin suggests before the start");
  // The night begins an hour ago.
  await must(service.from("gatherings").update({ starts_at: new Date(Date.now() - 3_600_000).toISOString() }).eq("id", g.C), "the start");
  const r = await ppl.Gus!.c.rpc("confirm_solo_spot", { p_crew: crew });
  assert.equal((r.error as { hint?: string } | null)?.hint, "pair_closed", "a pair became a plan after the start");
  assert.equal((await crewOf(crew)).state, "forming", "the pair changed state at the start");
  assert.equal((await ppl.Gus!.c.from("crew_messages").insert({ crew_id: crew, author_id: ppl.Gus!.id, kind: "user", body: "missed you" })).error, null, "a pair's chat closed at the start — Q11 keeps it to the read-only day");
  // Past the read-only day: read, not written.
  await must(service.from("gatherings").update({ starts_at: new Date(Date.now() - 5 * 86_400_000).toISOString() }).eq("id", g.C), "days later");
  assert.ok((await ppl.Gus!.c.from("crew_messages").insert({ crew_id: crew, author_id: ppl.Gus!.id, kind: "user", body: "late" })).error, "a pair's chat is writable after the read-only day");
  assert.ok(((await ppl.Fin!.c.from("crew_messages").select("id").eq("crew_id", crew)).data?.length ?? 0) >= 1, "a pair's chat cannot be read in its 30 days");
});

test("P273 the lifecycle tick leaves a pair alone — its forming rules are squads'", async () => {
  // The old rule closed a forming group under 3 once now passed
  // least(greatest(start − 6 h, created + 2 h), start − 3 h). A gathering five hours off and a
  // pair made three hours ago is past it — asserted, so this cannot pass on a case the old
  // tick would have left alone too (its first version did exactly that).
  const startsAt = Math.ceil((Date.now() + 5 * 3_600_000) / 900_000) * 900_000;
  await gathering("D", startsAt);
  for (const n of ["Hal", "Ivy"]) await soloOn(n, "D");
  const crew = await pair("Hal", "Ivy", "D");
  const created = Date.now() - 3 * 3_600_000;
  await must(service.from("crews").update({ created_at: new Date(created).toISOString() }).eq("id", crew), "made three hours ago");
  const oldDeadline = Math.min(Math.max(startsAt - 6 * 3_600_000, created + 2 * 3_600_000), startsAt - 3 * 3_600_000);
  assert.ok(Date.now() >= oldDeadline, "setup: the old tick's deadline has not passed — the case would prove nothing");
  await must(service.rpc("admin_groups_tick"), "the tick");
  assert.equal((await crewOf(crew)).state, "forming", "the tick closed a pair as an under-three group");
  g.pairHI = crew;
});

test("P274 a block ends a pair, and the other is told it is off — never why", async () => {
  assert.equal((await ppl.Hal!.c.from("blocks").insert({ blocker_id: ppl.Hal!.id, blocked_id: ppl.Ivy!.id })).error, null, "Hal could not block Ivy");
  assert.equal((await crewOf(g.pairHI!)).state, "dissolved", "a block did not end the pair");
  const told = await notes("Ivy", g.pairHI!);
  assert.ok(told.some((n) => / is off\.$/.test(n.body)), "the other was not told the pair is off");
  assert.ok(!told.some((n) => /block/i.test(n.body)), "the other was told why");
});

test("P275 the brake, pulled, ends every pair and tells both; a plan stands", async () => {
  await gathering("E");
  for (const n of ["Jon", "Bob"]) await soloOn(n, "E");
  const p = await pair("Jon", "Bob", "E");
  // Dee and Eve's plan from P271 stands.
  const plan = ((await must(service.from("crews").select("id").eq("gathering_id", g.B).eq("kind", "solo").eq("state", "spot_set"), "the plan")) as { id: string }[])[0]!.id;
  try {
    await must(service.rpc("admin_set_solo_brake", { p_pulled: true, p_actor: `${PREFIX}@example.com` }), "pull");
    assert.equal((await crewOf(p)).state, "dissolved", "the brake left a pair standing");
    for (const n of ["Jon", "Bob"]) assert.ok((await notes(n, p)).some((x) => / is off\.$/.test(x.body)), `${n} was not told the pair is off`);
    assert.equal((await crewOf(plan)).state, "spot_set", "the brake ended a plan");
  } finally {
    await must(service.rpc("admin_set_solo_brake", { p_pulled: false, p_actor: `${PREFIX}@example.com` }), "lift");
  }
});
