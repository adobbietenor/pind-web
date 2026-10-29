// Independent adversarial review of M3.4, 1-on-1 (A28, A29) — and what touched it after
// the brief (14 Oct): reports on people (A10, 16 Oct), my_chats (A19, 16 Oct) and the
// thread purge (Q11, 16 Oct). Findings: docs/m3.4-review-findings.md.
//
// Each case names the rule it attacks. A case named "LEAK" / "INFERENCE" / "ROBUSTNESS"
// FAILS today and passes once fixed. A case named "HOLDS" passes today: it is here so an
// absence of findings is distinguishable from an absence of looking.
//
// Run on its own, never with the main suite (not in package.json's test:policies):
//   node --env-file=.dev.vars --test --test-concurrency=1 tests/policies/review-m3.4.test.ts
//
// Every leak is reproduced as a signed-in person with their own token. The service key
// sets up (people, gatherings, the passage of time: moving a start into the past and
// running the lifecycle job, exactly what pg_cron does every ten minutes) and tears down.
// It never pulls the brake: the brake is global, and a second reviewer shares staging.
// Every person is a harness user (pindhx-…@example.com, app_metadata pind_harness, a
// pindhx_ handle), every gathering and venue is "pindhx <run> …", so world.ts's sweep
// finds anything a crashed run leaves.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "./env.ts";
import { ACTOR, PREFIX, SIGN_IN_WAIT_MS, handleFor, newClient, passwordSignIn, removeUser } from "./world.ts";

const env = loadEnv();
const service = newClient(env, env.secretKey);
const anon = newClient(env, env.publishableKey);
const run = `r34${randomBytes(3).toString("hex")}`;
const DAY = 86_400_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Result {
  data: any;
  error: { message: string; code?: string } | null;
}
async function ok(query: PromiseLike<Result>, what = "query"): Promise<any> {
  const { data, error } = await query;
  if (error) assert.fail(`${what} failed: ${error.code ?? ""} ${error.message}`);
  return data;
}
async function rows(query: PromiseLike<Result>, what = "query"): Promise<any[]> {
  return (await ok(query, what)) as any[];
}

type Gender = "woman" | "man" | "nonbinary";
interface P {
  name: string;
  id: string;
  authId: string;
  c: SupabaseClient;
}
const ppl: Record<string, P> = {};
const P = (n: string) => ppl[n]!;
const nameOf = (id: string) => Object.keys(ppl).find((n) => ppl[n]!.id === id) ?? id;
const gatherings: string[] = [];
let venue = "";
let spots: string[] = [];

async function mk(name: string, gender: Gender, include = false): Promise<P> {
  const email = `${PREFIX}-${run}-${name.toLowerCase()}@example.com`;
  const password = randomUUID();
  const made = await service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { pind_harness: true } });
  if (made.error || !made.data.user) throw new Error(`create ${name}: ${made.error?.message}`);
  const authId = made.data.user.id;
  const c = newClient(env, env.publishableKey);
  const s = await passwordSignIn(c, { email, password });
  if (s.error) throw new Error(`sign in ${name}: ${s.error.message}`);
  const person = await ok(service.from("people").insert({ auth_user_id: authId, first_name: name, photo_path: `${authId}/face.png` }).select("id").single(), `person ${name}`);
  await ok(service.from("people_private").insert({ person_id: person.id, gender, include_in_women_only: include, birth_year: 1994 }), `private ${name}`);
  await ok(service.from("age_attestations").upsert({ person_id: person.id, source: "a26" }, { onConflict: "person_id", ignoreDuplicates: true }), `age ${name}`);
  await ok(service.from("person_handles").insert({ person_id: person.id, instagram: handleFor(run, name) }), `handle ${name}`);
  ppl[name] = { name, id: person.id, authId, c };
  return ppl[name]!;
}

// A published gathering at this run's venue, starting on a quarter hour `days` from now.
async function gathering(label: string, days = 5): Promise<{ id: string; start: number }> {
  const start = Math.ceil((Date.now() + days * DAY) / 900_000) * 900_000;
  const g = await ok(
    service.from("gatherings").insert({ name: `${PREFIX} ${run} ${label}`, starts_at: new Date(start).toISOString(), venue_id: venue, published_at: new Date().toISOString() }).select("id").single(),
    `gathering ${label}`,
  );
  gatherings.push(g.id);
  return { id: g.id, start };
}

// Pinned and open to meeting at G, as themselves; then 1-on-1 as asked.
async function pinSolo(n: string, g: string, choice: "everyone" | "women_only" | null = "everyone"): Promise<string> {
  const pin = await ok(P(n).c.from("pins").insert({ gathering_id: g, person_id: P(n).id, party_total: 1, open_to_meeting: true }).select("id").single(), `${n} pins`);
  if (choice) await ok(P(n).c.from("pins").update({ solo_opt_in: true, solo_visibility: choice }).eq("id", pin.id).select("id"), `${n} turns 1-on-1 on`);
  return pin.id;
}

const section = async (n: string, g: string) =>
  (await rows(P(n).c.rpc("solo_people", { p_gathering: g }), `${n}'s section`)).map((r: { person_id: string }) => nameOf(r.person_id)).sort();
const propose = (from: string, to: string, g: string, meetAt: number, line = 1, spot = spots[0]) =>
  P(from).c.rpc("propose_solo", { p_gathering: g, p_to: P(to).id, p_spot: spot, p_meet_at: new Date(meetAt).toISOString(), p_line: line });
const mine = (n: string, g: string) => rows(P(n).c.rpc("my_solo_proposals", { p_gathering: g }), `${n}'s proposals`);
const receivedId = async (to: string, from: string, g: string) => {
  const p = (await mine(to, g)).find((r: { direction: string; person_id: string }) => r.direction === "received" && r.person_id === P(from).id);
  assert.ok(p, `${to} has no proposal from ${from}`);
  return p.proposal_id as string;
};
const sentId = async (from: string, to: string, g: string) => {
  const p = (await mine(from, g)).find((r: { direction: string; person_id: string }) => r.direction === "sent" && r.person_id === P(to).id);
  assert.ok(p, `${from} has no sent proposal to ${to}`);
  return p.proposal_id as string;
};
const exportSent = async (n: string, g: string) =>
  ((await ok(P(n).c.rpc("my_solo_export"), `${n}'s export`)) as { proposals_sent: { gathering_id: string; line: number; status: string }[] }).proposals_sent.filter((p) => p.gathering_id === g);

before(async () => {
  venue = (await ok(service.from("venues").insert({ name: `${PREFIX} ${run} Review Arena` }).select("id").single(), "venue")).id;
  spots = (await rows(service.from("meeting_spots").insert(["North Gate", "Patio Bar"].map((name) => ({ venue_id: venue, name }))).select("id"), "spots")).map((s: { id: string }) => s.id);
  await mk("Ann", "woman");
  await mk("Bea", "woman");
  await mk("Cal", "man");
  await mk("Dov", "man");
  await mk("Eve", "nonbinary", true);
  await mk("Fox", "nonbinary", false);
  await mk("Gus", "man");
  await mk("Hal", "man");
  await mk("Ivy", "woman");
}, { timeout: 240_000 + SIGN_IN_WAIT_MS });

after(async () => {
  const ids = Object.values(ppl).map((p) => p.id);
  if (ids.length) {
    await service.from("blocks").delete().in("blocker_id", ids);
    await service.from("blocks").delete().in("blocked_id", ids);
    await service.from("reports").delete().in("reporter_id", ids);
    await service.from("reports").delete().in("target_person_id", ids);
    await service.from("moderation_log").delete().in("person_id", ids);
  }
  for (const g of gatherings) {
    const crews = (await service.from("crews").select("id").eq("gathering_id", g)).data?.map((c: { id: string }) => c.id) ?? [];
    if (crews.length) await service.from("confirmations").delete().in("crew_id", crews);
    await service.from("crews").delete().eq("gathering_id", g);
    await service.from("gatherings").delete().eq("id", g);
  }
  for (const p of Object.values(ppl)) await removeUser(service, p.authId).catch((e) => console.error(String(e)));
  if (venue) {
    await service.from("meeting_spots").delete().eq("venue_id", venue);
    await service.from("venues").delete().eq("id", venue);
  }
  await service.from("moderation_log").delete().eq("actor", ACTOR).like("note", `${run}%`);
  // Nothing of this run is left.
  const left = (await service.from("gatherings").select("id").like("name", `${PREFIX} ${run} %`)).data ?? [];
  const leftPeople = (await service.from("people").select("id").in("id", ids)).data ?? [];
  assert.deepEqual([left.length, leftPeople.length], [0, 0], "the review left rows behind");
});

// ---------------------------------------------------------------------------
// R1 — women only, by the chooser's door (V14, V5, D1: "gender must never be readable per person")
// ---------------------------------------------------------------------------

describe("R1 women only: an ineligible person's choice", () => {
  let G = "";
  before(async () => {
    G = (await gathering("R1 women only")).id;
    for (const n of ["Ann", "Bea", "Dov", "Eve", "Fox"]) await pinSolo(n, G, "everyone");
    await pinSolo("Cal", G, "everyone");
  }, { timeout: 120_000 + SIGN_IN_WAIT_MS });

  it("R1 LEAK: a man who picks 'women only' is shown exactly the women-only-eligible people — each one's gender (or a nonbinary person's women-only flag) read off the difference", async () => {
    // Control: on 'everyone', Cal sees all five, so the list below is not empty by accident.
    assert.deepEqual(await section("Cal", G), ["Ann", "Bea", "Dov", "Eve", "Fox"], "control: Cal cannot see the five on 'everyone'");
    const pin = (await rows(P("Cal").c.from("pins").select("id").eq("gathering_id", G).eq("person_id", P("Cal").id)))[0].id;
    const { error } = await P("Cal").c.from("pins").update({ solo_visibility: "women_only" }).eq("id", pin).select("id");
    if (error) return; // fixed by refusing the choice to someone ineligible
    const wo = await section("Cal", G);
    assert.deepEqual(
      wo,
      [],
      `a man on 'women only' sees ${JSON.stringify(wo)} and not the others: he has just learned that Ann and Bea are women, that Eve is nonbinary-in-women-only, and that Dov and Fox are not — per-person gender, which V3/D1 never release`,
    );
  });

  it("R1b LEAK: the same for a nonbinary person who did NOT opt into women-only", async () => {
    const G2 = (await gathering("R1b women only")).id;
    for (const n of ["Ann", "Cal", "Eve"]) await pinSolo(n, G2, "everyone");
    const pin = await pinSolo("Fox", G2, "everyone");
    assert.deepEqual(await section("Fox", G2), ["Ann", "Cal", "Eve"], "control");
    const { error } = await P("Fox").c.from("pins").update({ solo_visibility: "women_only" }).eq("id", pin).select("id");
    if (error) return;
    const wo = await section("Fox", G2);
    assert.deepEqual(wo, [], `an ineligible nonbinary person on 'women only' sees ${JSON.stringify(wo)}: Cal is thereby a man, Ann and Eve eligible`);
  });
});

// ---------------------------------------------------------------------------
// R2 — the decline, after the start (decisions: "To the sender a declined proposal is
// indistinguishable from an unanswered one, in every respect"; the export: "A decline is
// never told to the sender, here either"; P225: "After the start, a declined and an
// unanswered proposal read the same to their sender").
// ---------------------------------------------------------------------------

describe("R2 a decline, read by its sender after the start", () => {
  let G = "";
  let start = 0;
  const ids: Record<string, string> = {};
  before(async () => {
    ({ id: G, start } = await gathering("R2 decline"));
    for (const n of ["Ann", "Bea", "Cal", "Dov"]) await pinSolo(n, G, "everyone");
    // Line 1 to Ann, line 2 to Bea: the sender's own record tells them apart.
    await ok(propose("Cal", "Ann", G, start - 60 * 60_000, 1), "Cal to Ann");
    await ok(propose("Cal", "Bea", G, start - 60 * 60_000, 2), "Cal to Bea");
    await ok(propose("Dov", "Ann", G, start - 60 * 60_000, 1), "Dov to Ann");
    await ok(propose("Dov", "Bea", G, start - 60 * 60_000, 2), "Dov to Bea");
    ids.dovAnn = await sentId("Dov", "Ann", G);
    ids.dovBea = await sentId("Dov", "Bea", G);
    // Ann declines both; Bea never answers.
    await ok(P("Ann").c.rpc("respond_to_solo", { p_proposal: await receivedId("Ann", "Cal", G), p_accept: false }));
    await ok(P("Ann").c.rpc("respond_to_solo", { p_proposal: await receivedId("Ann", "Dov", G), p_accept: false }));
  }, { timeout: 120_000 + SIGN_IN_WAIT_MS });

  it("R2-0 HOLDS: before the start the decline is invisible to the sender — list, export, the re-send refusal and withdraw all read the same", async () => {
    const sent = (await mine("Cal", G)).filter((r: { direction: string }) => r.direction === "sent").map((r: { person_id: string }) => nameOf(r.person_id)).sort();
    assert.deepEqual(sent, ["Ann", "Bea"]);
    assert.deepEqual((await exportSent("Cal", G)).map((p) => p.status), ["sent", "sent"]);
    const a = await propose("Cal", "Ann", G, start - 45 * 60_000);
    const b = await propose("Cal", "Bea", G, start - 45 * 60_000);
    assert.deepEqual([a.error?.code, a.error?.message], [b.error?.code, b.error?.message], "a re-send to the decliner is refused differently");
  });

  it("R2a INFERENCE: after the start (once the 10-minute job has run), the sender switching their own 1-on-1 off turns the declined one 'closed' and the unanswered one 'not accepted' in their export", async () => {
    // Time passes: the start moves into the past and the lifecycle job runs, as pg_cron does every 10 minutes.
    await ok(service.from("gatherings").update({ starts_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", G));
    await ok(service.rpc("admin_groups_tick"), "the lifecycle job");
    const before = (await exportSent("Cal", G)).sort((x, y) => x.line - y.line).map((p) => p.status);
    assert.deepEqual(before, ["not accepted", "not accepted"], "control: right after the start the export already differed");
    // Now the sender acts on their OWN pin — allowed until the effective end.
    const pin = (await rows(P("Cal").c.from("pins").select("id").eq("gathering_id", G).eq("person_id", P("Cal").id)))[0].id;
    await ok(P("Cal").c.from("pins").update({ solo_opt_in: false }).eq("id", pin).select("id"), "Cal switches 1-on-1 off");
    const after = (await exportSent("Cal", G)).sort((x, y) => x.line - y.line);
    const toAnn = after.find((p) => p.line === 1)!.status;
    const toBea = after.find((p) => p.line === 2)!.status;
    assert.equal(toAnn, toBea, `the sender's export now says "${toAnn}" for the proposal Ann declined and "${toBea}" for the one Bea never answered`);
  });

  it("R2b INFERENCE: after the start, withdraw_solo succeeds on a declined proposal and is refused on an unanswered one — an oracle by proposal id", async () => {
    const declined = await P("Dov").c.rpc("withdraw_solo", { p_proposal: ids.dovAnn });
    const unanswered = await P("Dov").c.rpc("withdraw_solo", { p_proposal: ids.dovBea });
    assert.deepEqual(
      [declined.error?.code ?? "ok", declined.error?.message ?? "ok"],
      [unanswered.error?.code ?? "ok", unanswered.error?.message ?? "ok"],
      "withdrawing tells a declined proposal from an unanswered one",
    );
  });
});

// ---------------------------------------------------------------------------
// R3 — reason inference: every way out of someone's 1-on-1 list refuses a proposal with
// the same words and code (V14; brief, "Compare the refusal words and the error codes").
// ---------------------------------------------------------------------------

describe("R3 why someone vanished", () => {
  let G = "";
  let start = 0;
  before(async () => {
    ({ id: G, start } = await gathering("R3 reasons"));
    for (const n of ["Ann", "Bea", "Cal", "Dov", "Gus", "Hal", "Ivy", "Fox"]) await pinSolo(n, G, "everyone");
  }, { timeout: 120_000 + SIGN_IN_WAIT_MS });

  it("R3 HOLDS: a block, a report, women only, switching off and a plan with someone else all refuse the same way, and the people list still shows all but the blocker", async () => {
    assert.deepEqual(await section("Dov", G), ["Ann", "Bea", "Cal", "Fox", "Gus", "Hal", "Ivy"], "control: Dov's section");
    const pinOf = async (n: string) => (await rows(P(n).c.from("pins").select("id").eq("gathering_id", G).eq("person_id", P(n).id)))[0].id;
    try {
      await ok(P("Ann").c.from("pins").update({ solo_visibility: "women_only" }).eq("id", await pinOf("Ann")).select("id")); // women only
      await ok(P("Bea").c.from("pins").update({ solo_opt_in: false }).eq("id", await pinOf("Bea")).select("id")); // switched off
      await ok(propose("Gus", "Cal", G, start - 60 * 60_000)); // Cal: a plan with Gus
      await ok(P("Cal").c.rpc("respond_to_solo", { p_proposal: await receivedId("Cal", "Gus", G), p_accept: true }));
      await ok(P("Fox").c.from("reports").insert({ reporter_id: P("Fox").id, target_kind: "person", target_person_id: P("Ivy").id, reason: "spam" })); // Ivy: reported
      await ok(P("Hal").c.from("blocks").insert({ blocker_id: P("Hal").id, blocked_id: P("Dov").id })); // Hal: blocked Dov
      assert.deepEqual(await section("Dov", G), ["Fox"], "control: the five did not all leave Dov's section");
      const said: Record<string, string> = {};
      for (const n of ["Ann", "Bea", "Cal", "Ivy", "Hal"]) {
        const r = await propose("Dov", n, G, start - 60 * 60_000);
        said[n] = `${r.error?.code} ${r.error?.message} ${r.error?.details ?? ""} ${r.error?.hint ?? ""}`;
      }
      assert.equal(new Set(Object.values(said)).size, 1, `the refusals differ: ${JSON.stringify(said)}`);
    } finally {
      await service.from("blocks").delete().eq("blocker_id", P("Hal").id);
      await service.rpc("admin_return_to_solo", { p_person: P("Ivy").id, p_actor: ACTOR, p_note: `${run} R3 cleanup` });
    }
  });
});

// ---------------------------------------------------------------------------
// R4 — the plan: third parties, the sealed seen time, H9 from the thread (A10), my_chats
// ---------------------------------------------------------------------------

describe("R4 the plan, from outside and inside", () => {
  let G = "";
  let start = 0;
  let plan = "";
  before(async () => {
    ({ id: G, start } = await gathering("R4 plan"));
    await ok(service.rpc("admin_mint_slug", { p_gathering: G }), "slug");
    for (const n of ["Fox", "Ivy", "Ann"]) await pinSolo(n, G, "everyone");
    await ok(propose("Fox", "Ivy", G, start - 30 * 60_000));
    plan = (await ok(P("Ivy").c.rpc("respond_to_solo", { p_proposal: await receivedId("Ivy", "Fox", G), p_accept: true }))) as string;
  }, { timeout: 120_000 + SIGN_IN_WAIT_MS });

  it("R4a HOLDS: a third person cannot join, report, read or list the plan — by squad join, crew report, the tables or my_chats", async () => {
    const j = await P("Ann").c.rpc("join_squad", { p_crew: plan });
    assert.ok(j.error, "a third person joined a 1-on-1 plan through join_squad");
    const r = await P("Ann").c.from("reports").insert({ reporter_id: P("Ann").id, target_kind: "crew", target_crew_id: plan, reason: "spam" });
    assert.ok(r.error, "a third person reported a 1-on-1 plan (and so took someone in it out of 1-on-1)");
    assert.equal((await rows(P("Ann").c.from("crews").select("id").eq("id", plan))).length, 0);
    assert.equal((await rows(P("Ann").c.from("crew_members").select("person_id").eq("crew_id", plan))).length, 0);
    const mc = (await ok(P("Ann").c.rpc("my_chats"))) as any[];
    assert.ok(!JSON.stringify(mc).includes(plan), "my_chats lists someone else's plan");
    // Control: the partner does list it, naming Fox.
    const ivy = ((await ok(P("Ivy").c.rpc("my_chats"))) as any[]).find((e) => e.gathering_id === G);
    assert.equal(ivy?.crews?.find((c: any) => c.crew_id === plan)?.partner, "Fox", "control: Ivy's my_chats does not show her plan");
    const leave = await P("Ann").c.rpc("leave_group", { p_crew: plan });
    assert.equal((await ok(service.from("crews").select("state").eq("id", plan).single())).state, "spot_set", `a third person's leave_group ended the plan (${leave.error?.message ?? "no error"})`);
  });

  it("R4b HOLDS: the partner's seen time is sealed — not selectable, not filterable, not orderable; crew_seen marks only one's own row", async () => {
    await ok(P("Fox").c.rpc("crew_seen", { p_crew: plan }));
    for (const q of [
      P("Ivy").c.from("crew_members").select("last_seen_at").eq("crew_id", plan),
      P("Ivy").c.from("crew_members").select("person_id").eq("crew_id", plan).not("last_seen_at", "is", null),
      P("Ivy").c.from("crew_members").select("person_id").eq("crew_id", plan).order("last_seen_at"),
      P("Ivy").c.from("crews").select("id, crew_members(last_seen_at)").eq("id", plan),
    ]) {
      const { error } = await q;
      assert.ok(error, "a seen time was readable through the API");
    }
    const ownRows = (await rows(service.from("crew_members").select("person_id, last_seen_at").eq("crew_id", plan)));
    assert.equal(ownRows.find((r: any) => r.person_id === P("Ivy").id)?.last_seen_at, null, "crew_seen marked the partner's row");
  });

  it("R4c HOLDS: a non-safety report filed from the plan's thread takes the partner out of 1-on-1 and leaves the plan standing (below H9)", async () => {
    const m = await ok(P("Ivy").c.from("crew_messages").insert({ crew_id: plan, author_id: P("Ivy").id, kind: "user", body: "by the gate" }).select("created_at").single());
    try {
      await ok(P("Fox").c.from("reports").insert({ reporter_id: P("Fox").id, target_kind: "person", target_person_id: P("Ivy").id, reason: "spam", context_crew_id: plan, context_at: m.created_at }));
      assert.equal((await ok(service.from("crews").select("state").eq("id", plan).single())).state, "spot_set", "one non-safety report from the thread ended the plan");
      assert.equal((await ok(service.from("people").select("hidden_from_solo").eq("id", P("Ivy").id).single())).hidden_from_solo, true, "control: the report took nobody out");
      // A third person cannot forge a report from that thread.
      const forged = await P("Ann").c.from("reports").insert({ reporter_id: P("Ann").id, target_kind: "person", target_person_id: P("Ivy").id, reason: "spam", context_crew_id: plan, context_at: m.created_at });
      assert.ok(forged.error, "an outsider reported from a 1-on-1 thread they cannot read");
    } finally {
      await service.rpc("admin_return_to_solo", { p_person: P("Ivy").id, p_actor: ACTOR, p_note: `${run} R4c cleanup` });
    }
  });

  it("R4d HOLDS: visitors reach none of 1-on-1's doors", async () => {
    const id = randomUUID();
    for (const [fn, args] of [
      ["solo_people", { p_gathering: G }],
      ["my_solo", { p_gathering: G }],
      ["my_solo_proposals", { p_gathering: G }],
      ["my_solo_export", {}],
      ["propose_solo", { p_gathering: G, p_to: P("Ann").id, p_spot: spots[0], p_meet_at: new Date(start - 3_600_000).toISOString(), p_line: 1 }],
      ["respond_to_solo", { p_proposal: id, p_accept: true }],
      ["withdraw_solo", { p_proposal: id }],
      ["my_chats", {}],
      ["crew_seen", { p_crew: plan }],
      ["admin_delete_expired_crew_messages", {}],
      ["admin_set_solo_brake", { p_pulled: true, p_actor: "x" }],
      ["admin_end_all_solo_plans", { p_actor: "x" }],
    ] as const) {
      const { error } = await anon.rpc(fn, args as any);
      assert.ok(error, `a visitor called ${fn}`);
    }
    for (const fn of ["admin_delete_expired_crew_messages", "admin_set_solo_brake", "admin_end_all_solo_plans", "admin_solo_metrics"]) {
      const args = fn === "admin_set_solo_brake" ? { p_pulled: true, p_actor: "x" } : fn === "admin_end_all_solo_plans" ? { p_actor: "x" } : {};
      const { error } = await P("Ann").c.rpc(fn, args);
      assert.ok(error, `a person called ${fn}`);
    }
    assert.equal(await ok(anon.rpc("solo_available")), true, "control (and proof the brake was not left pulled)");
  });
});

// ---------------------------------------------------------------------------
// R5 — a #8 for a proposal that has closed before delivery (V4, V22; decisions: "see one
// across a block"). The brake drops unsent #8s; nothing else does.
// ---------------------------------------------------------------------------

describe("R5 a received-proposal push after the proposal closed", () => {
  it("R5 ROBUSTNESS: the recipient blocks the sender seconds after the proposal — the queued #8 ('<sender> asked to meet you 1-on-1') is still deliverable", async () => {
    const { id: G, start } = await gathering("R5 push");
    for (const n of ["Gus", "Hal"]) await pinSolo(n, G, "everyone");
    await ok(propose("Gus", "Hal", G, start - 60 * 60_000));
    try {
      await ok(P("Hal").c.from("blocks").insert({ blocker_id: P("Hal").id, blocked_id: P("Gus").id }), "Hal blocks Gus");
      assert.deepEqual((await mine("Hal", G)).length, 0, "control: the proposal did not close on the block");
      const n = await rows(service.from("notifications").select("id, body, sent_at, channel, last_error").eq("person_id", P("Hal").id).eq("gathering_id", G).eq("kind", "solo_proposal"));
      if (n.length === 0) return; // fixed by deleting it with the proposal
      assert.equal(n.length, 1);
      // Delivered or not yet, it must have been dropped (as the brake drops one) — not left for the every-minute job.
      const pending = (await rows(service.rpc("admin_pending_notifications", { p_limit: 1000 }))).some((x: { id: string }) => x.id === n[0].id);
      const dropped = /dropped|closed/i.test(n[0].last_error ?? "");
      assert.ok(dropped || (!pending && n[0].sent_at === null), `the #8 "${n[0].body}" is ${pending ? "still queued for the delivery job" : `marked sent via ${n[0].channel}`} after the recipient blocked its sender`);
    } finally {
      await service.from("blocks").delete().eq("blocker_id", P("Hal").id);
    }
  });
});

// ---------------------------------------------------------------------------
// R6 — a plan across a block, by racing the block against the accept (V4; decisions:
// "blocking the other leaves"). Run last: it makes and clears blocks between Gus and Hal.
// ---------------------------------------------------------------------------

describe("R6 a block racing an accept", () => {
  it("R6 LEAK (race): the sender blocks while the recipient accepts — the plan can be made across the block and stand", { timeout: 600_000 + SIGN_IN_WAIT_MS }, async () => {
    // M4.2 (29 Oct): fixed by both sides taking the two people's locks. Proved the way a
    // refusal must be: every trial runs, the trials where BOTH calls succeeded are counted
    // (the accept won the lock, the block came after it — the overlap that used to leak),
    // and the case fails unless at least one such overlap happened AND no plan stood. A run
    // with no overlap proves nothing, so it fails rather than passing quietly.
    // "Both succeeded" includes a block that simply landed after the accept finished, so
    // the count shows the trials ran, not that each was a true race. The weight is in the
    // number: before the fix this reproduced within 10 trials on every run; 32 clean trials
    // is the evidence the lock holds.
    const trials = 32;
    let overlaps = 0;
    let found: { crew: string; offset: number; trial: number } | null = null;
    for (let t = 0; t < trials && !found; t++) {
      const { id: G, start } = await gathering(`R6 race ${t}`);
      for (const n of ["Gus", "Hal"]) await pinSolo(n, G, "everyone");
      await ok(propose("Gus", "Hal", G, start - 60 * 60_000));
      const pid = await receivedId("Hal", "Gus", G);
      // Sweep the block's start across the accept's window.
      const offset = [0, 5, 10, 15, 20, 25, 30, 40, -5, 0, 8, 12, 18, 22, 3, 35][t % 16]!;
      const accept = offset < 0 ? sleep(-offset).then(() => P("Hal").c.rpc("respond_to_solo", { p_proposal: pid, p_accept: true })) : P("Hal").c.rpc("respond_to_solo", { p_proposal: pid, p_accept: true });
      const block = offset > 0 ? sleep(offset).then(() => P("Gus").c.from("blocks").insert({ blocker_id: P("Gus").id, blocked_id: P("Hal").id })) : P("Gus").c.from("blocks").insert({ blocker_id: P("Gus").id, blocked_id: P("Hal").id });
      const [a, b] = await Promise.all([accept, block]);
      if (!a.error && !b.error) {
        overlaps++;
        const crew = a.data as string;
        const c = await ok(service.from("crews").select("state").eq("id", crew).single());
        const active = await rows(service.from("crew_members").select("person_id").eq("crew_id", crew).is("left_at", null));
        if (c.state !== "dissolved" && active.length === 2) found = { crew, offset, trial: t };
      }
      if (!found) await service.from("blocks").delete().eq("blocker_id", P("Gus").id);
    }
    if (!found) {
      assert.ok(overlaps >= 1, `R6: in ${trials} trials the accept and the block never both succeeded — the race was not exercised, so this proves nothing`);
      console.error(`R6: ${overlaps} of ${trials} trials had both the accept and the block succeed, and no plan stood in any`);
      return;
    }
    try {
      // As the people themselves: the blocked person still holds the plan, the blocker is still in it.
      const asHal = await rows(P("Hal").c.from("crew_members").select("person_id").eq("crew_id", found.crew).is("left_at", null));
      const asGus = await rows(P("Gus").c.from("crews").select("state, meet_at, spot_id").eq("id", found.crew));
      assert.fail(
        `trial ${found.trial} (block ${found.offset} ms after the accept): a 1-on-1 plan stands between Gus and Hal although Gus blocked Hal — ` +
          `Hal reads ${asHal.length} active members (${asHal.map((r: any) => nameOf(r.person_id)).join(", ")}); Gus reads the plan as ${JSON.stringify(asGus[0])}`,
      );
    } finally {
      await service.from("blocks").delete().eq("blocker_id", P("Gus").id);
    }
  });
});
