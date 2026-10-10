// Independent adversarial review of V1–V19 (docs/visibility.md §1–§12h, §12f).
// Cases Q01… Each names the rule it attacks and asserts the refusal or the absence.
// A failing case is a leak (or, where marked SOFT, a finding recorded as a diagnostic).
//
// Builds its own small world on pind-staging, tagged "pindhx q<run>", made only of
// harness users (app_metadata.pind_harness), and removes all of it afterwards:
// person row first, then the account (removeUser).
//
// Run alone:
//   node --env-file=C:/Users/PC/pind-web/.dev.vars --test --test-concurrency=1 tests/policies/review-v1-v19.test.ts

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEnv, type HarnessEnv } from "./env.ts";
import { newClient, must, removeUser, accountlessPeople, PREFIX, BUCKET, PNG, ACTOR } from "./world.ts";

const env: HarnessEnv = loadEnv();
const service = newClient(env, env.secretKey);
const anon = newClient(env, env.publishableKey);
const RUN = `q${randomBytes(3).toString("hex")}`;
const DAY = 24 * 3600 * 1000;
// What another person may read on a people row since M4.2/Q07+Q37 (no photo_status, no timestamps).
const VIEWER_COLUMNS = "id, auth_user_id, first_name, last_initial, neighbourhood, photo_path, gatherings_count, hidden_at, is_seed";
const HOUR = 3600 * 1000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

interface P {
  name: string;
  id: string;
  authId: string | null;
  c: SupabaseClient | null;
  photo: string | null;
}
const m: Record<string, P> = {};
const g: Record<string, string> = {};
const pin: Record<string, string> = {};
const authIds: string[] = [];
let venue = "";
let seedVenue = "";
let attestSource = "";
let gs: string[] = [];
let hs = "";
let before_accountless = 0;
const findings: string[] = [];

// ---------------------------------------------------------------- helpers

async function user(name: string, anonymous = false): Promise<{ c: SupabaseClient; authId: string }> {
  const c = newClient(env, env.publishableKey);
  if (anonymous) {
    const { data, error } = await c.auth.signInAnonymously({ options: { data: { harness: PREFIX } } });
    if (error || !data.user) throw new Error(`anon sign-in ${name}: ${error?.message}`);
    const mk = await service.auth.admin.updateUserById(data.user.id, { app_metadata: { pind_harness: true } });
    if (mk.error) throw new Error(`mark ${name}: ${mk.error.message}`);
    authIds.push(data.user.id);
    return { c, authId: data.user.id };
  }
  const email = `${PREFIX}-${RUN}-${name.toLowerCase()}@example.com`;
  const password = randomUUID();
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { pind_harness: true } });
  if (created.error || !created.data.user) throw new Error(`create ${name}: ${created.error?.message}`);
  authIds.push(created.data.user.id);
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in ${name}: ${error.message}`);
  return { c, authId: created.data.user.id };
}

async function person(
  name: string,
  o: { gender?: string; womenOnly?: boolean; photo?: string; session?: boolean; anonymous?: boolean; hidden?: boolean; seed?: boolean; noPrivate?: boolean; attest?: boolean } = {},
): Promise<P> {
  let c: SupabaseClient | null = null;
  let authId: string | null = null;
  if (o.session || o.anonymous) ({ c, authId } = await user(name, o.anonymous));
  let photo: string | null = null;
  if (o.photo) {
    photo = `${authId}/${name.toLowerCase()}.png`;
    await must(service.storage.from(BUCKET).upload(photo, PNG, { contentType: "image/png" }), `photo ${name}`);
  }
  const row = await must(
    service
      .from("people")
      .insert({
        auth_user_id: authId,
        first_name: name,
        neighbourhood: "king-west",
        photo_path: photo,
        photo_status: o.photo ?? "pending",
        hidden_at: o.hidden ? new Date().toISOString() : null,
        is_seed: o.seed ?? false,
      })
      .select("id")
      .single(),
    `person ${name}`,
  );
  await must(service.from("person_handles").insert({ person_id: row.id, instagram: `${PREFIX}_${RUN}_${name}`.toLowerCase() }), `handle ${name}`);
  if (!o.noPrivate) {
    await must(
      service.from("people_private").insert({ person_id: row.id, gender: o.gender ?? "man", include_in_women_only: o.womenOnly ?? false, birth_year: 1995 }),
      `private ${name}`,
    );
  }
  if (o.attest !== false && attestSource) {
    // A trigger may already have written one (A2's path); keep it.
    await must(
      service.from("age_attestations").upsert({ person_id: row.id, attested_at: new Date().toISOString(), source: attestSource }, { onConflict: "person_id", ignoreDuplicates: true }),
      `attest ${name}`,
    );
  }
  m[name] = { name, id: row.id, authId, c, photo };
  return m[name];
}

async function gathering(label: string, startsMs: number, published: boolean, extra: Record<string, unknown> = {}): Promise<string> {
  const row = await must(
    service
      .from("gatherings")
      .insert({ name: `${PREFIX} ${RUN} ${label}`, starts_at: at(startsMs), venue_id: venue, published_at: published ? new Date().toISOString() : null, ...extra })
      .select("id")
      .single(),
    `gathering ${label}`,
  );
  g[label] = row.id;
  return row.id;
}

async function pinIn(name: string, label: string, open: boolean, party = 1) {
  const row = await must(
    service.from("pins").insert({ gathering_id: g[label], person_id: m[name]!.id, open_to_meeting: open, party_total: party }).select("id").single(),
    `pin ${name}@${label}`,
  );
  pin[`${name}@${label}`] = row.id;
}

const C = (name: string): SupabaseClient => {
  const c = m[name]?.c;
  if (!c) throw new Error(`${name} has no session`);
  return c;
};

async function ids(q: PromiseLike<{ data: any; error: any }>, col = "id"): Promise<string[]> {
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []).map((r: any) => r[col]);
}

async function sees(viewer: string, target: string): Promise<boolean> {
  const people = await ids(C(viewer).from("people").select("id").eq("id", m[target]!.id));
  return people.length > 0;
}

async function svcPerson(name: string): Promise<any> {
  return must(service.from("people").select("*").eq("id", m[name]!.id).single(), `svc read ${name}`);
}

async function canSign(viewer: SupabaseClient, path: string): Promise<boolean> {
  const { data, error } = await viewer.storage.from(BUCKET).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) return false;
  const r = await fetch(data.signedUrl);
  return r.status === 200;
}

async function fileExists(path: string): Promise<boolean> {
  const { data, error } = await service.storage.from(BUCKET).download(path);
  return !error && !!data;
}

async function counts(c: SupabaseClient, label: string): Promise<any | null> {
  const { data, error } = await c.rpc("gathering_counts", { gathering_ids: [g[label]] });
  if (error) return { error: error.message };
  return (data ?? [])[0] ?? null;
}

function note(s: string) {
  findings.push(s);
}

// ---------------------------------------------------------------- world

before(async () => {
  before_accountless = await accountlessPeople(service);
  const a = await must(service.from("age_attestations").select("source").limit(1), "attestation source");
  attestSource = a[0]?.source ?? "";

  venue = (await must(service.from("venues").insert({ name: `${PREFIX} ${RUN} Arena` }).select("id").single(), "venue")).id;
  const spots = await must(
    service.from("meeting_spots").insert(["North Gate", "Patio"].map((name) => ({ venue_id: venue, name }))).select("id"),
    "spots",
  );
  seedVenue = (await must(service.from("venues").insert({ name: `${PREFIX} ${RUN} SeedHall`, is_seed: true }).select("id").single(), "seed venue")).id;
  await must(service.from("meeting_spots").insert({ venue_id: seedVenue, name: "Seed Steps" }), "seed spot");

  await gathering("G", 7 * DAY, true);
  await gathering("H", 8 * DAY, true);
  await gathering("U", 9 * DAY, false);
  await gathering("W", 6 * DAY, true);
  await gathering("R", 7 * DAY, true); // reports
  await gathering("K", 10 * DAY, true); // counts floor
  await gathering("S", 7 * DAY, true, { venue_id: seedVenue }); // seed gathering (trigger should flag it)
  gs = (await must(
    service.from("gathering_spots").insert(spots.map((s: any, i: number) => ({ gathering_id: g.G, spot_id: s.id, meet_at: at(7 * DAY - i * HOUR) }))).select("id"),
    "G spot options",
  )).map((r: any) => r.id);
  hs = (await must(service.from("gathering_spots").insert({ gathering_id: g.H, spot_id: spots[0].id, meet_at: at(8 * DAY) }).select("id").single(), "H spot")).id;
  await must(service.from("gathering_spots").insert({ gathering_id: g.U, spot_id: spots[0].id, meet_at: at(9 * DAY) }), "U spot");
  await must(service.from("gathering_spots").insert({ gathering_id: g.W, spot_id: spots[0].id, meet_at: at(6 * DAY) }), "W spot");

  // The list-closing boundary: place effective_end at now-23h (open) and now-25h (closed).
  for (const [label, endAgo] of [["Lopen", 23 * HOUR], ["Lclosed", 25 * HOUR]] as const) {
    const start = -endAgo - 3 * HOUR;
    const id = await gathering(label, start, true, { ends_at: at(-endAgo) });
    const rowG = await must(service.from("gatherings").select("*").eq("id", id).single(), "row");
    const { data, error } = await service.rpc("effective_end", { g: rowG });
    if (error) throw new Error(`effective_end: ${error.message}`);
    const end = new Date(data as string).getTime();
    const want = Date.now() - endAgo;
    if (Math.abs(end - want) > 10 * 60 * 1000) throw new Error(`effective_end for ${label} is ${data}, wanted ~${new Date(want).toISOString()}`);
  }

  // Cast.
  await person("Ana", { gender: "woman", photo: "approved", session: true });
  await person("Bo", { gender: "man", photo: "approved", session: true });
  await person("Cy", { gender: "man", session: true });
  await person("Di", { gender: "woman", session: true });
  await person("Ed", { gender: "man", session: true, hidden: true });
  await person("Fi", { gender: "woman", photo: "approved", session: true });
  await person("Gil", { gender: "man", photo: "rejected", session: true });
  await person("Hu", { gender: "nonbinary", womenOnly: true, session: true });
  await person("Ida", { gender: "woman", session: true });
  await person("Nb", { gender: "nonbinary", womenOnly: false, session: true });
  await person("Jo", { gender: "man", session: true });
  await person("Kai", { gender: "man", session: true });
  await person("Ty", { gender: "man" });
  await person("Uma", { gender: "woman" });
  await person("Vic", { gender: "man" });
  await person("Wa", { gender: "man" });
  await person("Seedy", { gender: "woman", session: true, seed: true, photo: "approved" });
  await person("Tess", { gender: "woman", session: true });
  await person("Lee", { gender: "man", session: true });
  await person("Lou", { gender: "woman" });
  await person("Wil", { gender: "woman", session: true });
  await person("Wes", { gender: "man", session: true });
  await person("Zed", { gender: "man", session: true });
  await person("Anon1", { gender: "man", anonymous: true });

  // Gil also has an old file in his folder that is not his photo_path (a previous upload).
  await must(service.storage.from(BUCKET).upload(`${m.Gil!.authId}/old.png`, PNG, { contentType: "image/png" }), "Gil old file");

  for (const n of ["Ana", "Bo", "Ed", "Fi", "Gil", "Hu", "Ida", "Nb", "Jo", "Seedy", "Tess"]) await pinIn(n, "G", true, n === "Bo" ? 2 : 1);
  await pinIn("Cy", "G", false);
  await pinIn("Anon1", "G", false);
  await pinIn("Bo", "H", true);
  await pinIn("Di", "H", true);
  await pinIn("Wil", "W", true);
  await pinIn("Wes", "W", false);
  await pinIn("Lee", "Lopen", true);
  await pinIn("Lou", "Lopen", true);
  await pinIn("Lee", "Lclosed", true);
  await pinIn("Lou", "Lclosed", true);
  for (const n of ["Jo", "Kai", "Ty", "Uma", "Vic", "Wa"]) await pinIn(n, "R", true);
  await pinIn("Seedy", "S", true);
  await pinIn("Tess", "S", true);

  // Bo's +1s: one claimed (Rohan), one unclaimed.
  await must(
    service.from("pin_friends").insert([
      { pin_id: pin["Bo@G"], claim_token_hash: `${PREFIX}-${randomUUID()}`, first_name: "Rohan", age_attested_at: new Date().toISOString(), claimed_at: new Date().toISOString() },
      { pin_id: pin["Bo@G"], claim_token_hash: `${PREFIX}-${randomUUID()}`, first_name: "Secret" },
    ]),
    "Bo's +1s",
  );
  // Bo's tags.
  await must(service.from("person_tags").insert([{ person_id: m.Bo!.id, tag: "chatty", on_list: true }, { person_id: m.Bo!.id, tag: "live-music", on_list: false }]), "Bo tags");
  await must(service.from("contact_points").insert({ person_id: m.Bo!.id, kind: "email", value: `bo-${RUN}@example.com` }), "Bo contact");
  await must(service.from("spot_votes").insert({ gathering_id: g.G, gathering_spot_id: gs[0], person_id: m.Bo!.id }), "Bo vote");
  await must(
    service.from("gathering_group_links").insert([
      { gathering_id: g.G, kind: "everyone", url: `https://chat.whatsapp.com/${PREFIX}-${RUN}-g` },
      { gathering_id: g.G, kind: "women_only", url: `https://chat.whatsapp.com/${PREFIX}-${RUN}-gw` },
      { gathering_id: g.H, kind: "women_only", url: `https://chat.whatsapp.com/${PREFIX}-${RUN}-hw` },
      { gathering_id: g.U, kind: "everyone", url: `https://chat.whatsapp.com/${PREFIX}-${RUN}-u` },
    ]),
    "group links",
  );

  // K: 4 open (2 women, 2 men) + 1 hidden open + 1 seed open + 1 not open with a +2.
  for (const [n, gen] of [["k1", "woman"], ["k2", "woman"], ["k3", "man"], ["k4", "man"]]) {
    await person(n, { gender: gen });
    await pinIn(n, "K", true);
  }
  await person("khid", { gender: "nonbinary", hidden: true });
  await pinIn("khid", "K", true);
  await person("kseed", { gender: "nonbinary", seed: true });
  await pinIn("kseed", "K", true);
  await person("kno", { gender: "man" });
  await pinIn("kno", "K", false, 3);

  // Tester flag on Tess (service key only).
  await must(service.rpc("admin_set_tester", { p_actor: ACTOR, p_auth_user: m.Tess!.authId, p_note: `${PREFIX} review`, p_on: true }), "set tester");

  // Sanity: S inherited the seed flag; Seedy is seed.
  const s = await must(service.from("gatherings").select("is_seed").eq("id", g.S).single(), "S seed");
  assert.equal(s.is_seed, true, "setup: S should be a seed gathering by its venue");
});

after(async () => {
  const errors: string[] = [];
  const tryIt = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      errors.push(`${what}: ${(e as Error).message}`);
    }
  };
  if (m.Tess?.authId) await tryIt("tester off", () => must(service.rpc("admin_set_tester", { p_actor: ACTOR, p_auth_user: m.Tess!.authId, p_note: `${PREFIX} review`, p_on: false }), "tester off"));
  for (const id of authIds) {
    await tryIt("photos", async () => {
      const { data } = await service.storage.from(BUCKET).list(id);
      if (data?.length) await service.storage.from(BUCKET).remove(data.map((f) => `${id}/${f.name}`));
    });
  }
  const personIds = Object.values(m).map((p) => p.id);
  await tryIt("reports by", () => must(service.from("reports").delete().in("reporter_id", personIds), "reports by"));
  await tryIt("reports on", () => must(service.from("reports").delete().in("target_person_id", personIds), "reports on"));
  const gids = Object.values(g);
  await tryIt("modlog", () => must(service.from("moderation_log").delete().in("gathering_id", gids), "modlog g"));
  // Crews hold their gathering with `on delete restrict`; members cascade with the crew.
  await tryIt("crews", () => must(service.from("crews").delete().in("gathering_id", gids), "crews"));
  await tryIt("gatherings", () => must(service.from("gatherings").delete().like("name", `${PREFIX} ${RUN} %`), "gatherings"));
  // People with an account: person first, then account.
  for (const id of authIds) await tryIt(`removeUser ${id}`, () => removeUser(service, id));
  // People without an account.
  const sessionless = Object.values(m).filter((p) => !p.authId).map((p) => p.id);
  if (sessionless.length) await tryIt("sessionless people", () => must(service.from("people").delete().in("id", sessionless), "sessionless"));
  for (const v of [venue, seedVenue].filter(Boolean)) {
    await tryIt("spots", () => must(service.from("meeting_spots").delete().eq("venue_id", v), "spots"));
    await tryIt("venue", () => must(service.from("venues").delete().eq("id", v), "venue"));
  }
  await tryIt("modlog actor", () => must(service.from("moderation_log").delete().eq("actor", ACTOR), "modlog actor"));

  // Prove the clean-up.
  const left = {
    accountlessBefore: before_accountless,
    accountlessAfter: await accountlessPeople(service),
    gatherings: ((await service.from("gatherings").select("id").like("name", `${PREFIX} ${RUN} %`)).data ?? []).length,
    venues: ((await service.from("venues").select("id").like("name", `${PREFIX} ${RUN} %`)).data ?? []).length,
    people: ((await service.from("people").select("id").in("id", personIds)).data ?? []).length,
    accounts: 0,
  };
  for (let page = 1; ; page++) {
    const { data } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (!data) break;
    left.accounts += data.users.filter((u) => (u.email ?? "").startsWith(`${PREFIX}-${RUN}-`) || authIds.includes(u.id)).length;
    if (data.users.length < 1000) break;
  }
  console.log("CLEANUP", JSON.stringify(left), errors.length ? `errors: ${errors.join(" | ")}` : "no errors");
  console.log("FINDINGS\n" + findings.join("\n"));
});

// ================================================================ Phase 1 — blind

const PUBLIC_TABLES = new Set(["venues", "meeting_spots", "gatherings", "gathering_spots", "gathering_slug_history", "neighbourhoods", "cities", "tags"]);

async function openapi(): Promise<any> {
  const r = await fetch(`${env.url}/rest/v1/`, { headers: { apikey: env.secretKey, Authorization: `Bearer ${env.secretKey}` } });
  return r.json();
}

test("Q01 V12/§15 — anon reads no row of any non-public table, and writes to none", async () => {
  const doc = await openapi();
  const tables = Object.keys(doc.paths).filter((p) => p !== "/" && !p.startsWith("/rpc/")).map((p) => p.slice(1));
  const leaks: string[] = [];
  for (const t of tables) {
    const { data, error } = await anon.from(t).select("*").limit(5);
    if (!PUBLIC_TABLES.has(t) && !error && (data ?? []).length) leaks.push(`read ${t}: ${data.length} rows`);
    const ins = await anon.from(t).insert({});
    if (!ins.error || ins.error.code !== "42501") leaks.push(`insert ${t}: ${ins.error ? ins.error.code + " " + ins.error.message : "succeeded"}`);
  }
  assert.deepEqual(leaks, []);
});

test("Q02 V12/§3 — a signed-in person pinned nowhere reads only their own rows anywhere", async () => {
  const doc = await openapi();
  const tables = Object.keys(doc.paths).filter((p) => p !== "/" && !p.startsWith("/rpc/")).map((p) => p.slice(1));
  const mine = new Set([m.Zed!.id, m.Zed!.authId]);
  const leaks: string[] = [];
  for (const t of tables) {
    if (PUBLIC_TABLES.has(t)) continue;
    const { data, error } = await C("Zed").from(t).select("*").limit(50);
    if (error) continue;
    const foreign = (data ?? []).filter((r: any) => !Object.values(r).some((v) => mine.has(v as string)));
    if (foreign.length) leaks.push(`${t}: ${foreign.length} rows not Zed's`);
  }
  assert.deepEqual(leaks, []);
});

test("Q03 V12 — no admin_* function runs for anon or for a signed-in person", async () => {
  const doc = await openapi();
  const leaks: string[] = [];
  for (const p of Object.keys(doc.paths).filter((p) => p.startsWith("/rpc/admin_"))) {
    const fn = p.slice(5);
    const body = doc.paths[p].post?.parameters?.find((x: any) => x.in === "body");
    const args: Record<string, null> = {};
    for (const k of Object.keys(body?.schema?.properties ?? {})) args[k] = null;
    for (const [who, c] of [["anon", anon], ["Zed", C("Zed")]] as const) {
      const { error } = await c.rpc(fn, args);
      if (!error) leaks.push(`${who} ran ${fn}`);
      else if (error.code !== "42501") leaks.push(`${who} ${fn}: ${error.code} ${error.message.slice(0, 80)}`);
    }
  }
  assert.deepEqual(leaks, []);
});

test("Q04 V1 — positive control, then: pinned-not-opted, opted-in elsewhere, anon and hidden see nobody at G", async () => {
  assert.equal(await sees("Ana", "Bo"), true, "control: Ana must see Bo at G");
  for (const viewer of ["Cy", "Di", "Ed", "Zed", "Anon1"]) {
    // Di is opted in at H, where Bo is too: Bo at H is hers to see (control below).
    const except = viewer === "Di" ? [m[viewer]!.id, m.Bo!.id] : [m[viewer]!.id];
    const people = await ids(C(viewer).from("people").select("id").not("id", "in", `(${except.join(",")})`));
    assert.deepEqual(people, [], `${viewer} reads other people`);
    const pins = await ids(C(viewer).from("pins").select("id").not("person_id", "in", `(${except.join(",")})`));
    assert.deepEqual(pins, [], `${viewer} reads other pins`);
  }
  const diPins = await ids(C("Di").from("pins").select("gathering_id").eq("person_id", m.Bo!.id), "gathering_id");
  assert.deepEqual(diPins, [g.H], "Di sees Bo only at H, never his pin at G");
  assert.deepEqual(await ids(anon.from("people").select("id").limit(1)), [], "anon reads people");
  assert.deepEqual(await ids(anon.from("pins").select("id").limit(1)), [], "anon reads pins");
  assert.equal(await sees("Ana", "Ed"), false, "Ana sees hidden Ed");
  assert.equal(await sees("Ana", "Cy"), false, "Ana sees Cy who did not opt in");
});

test("Q05 V1 scoping — seeing Bo at G reveals nothing about his pin at H", async () => {
  const pins = await must(C("Ana").from("pins").select("id, gathering_id").eq("person_id", m.Bo!.id), "Ana reads Bo's pins");
  assert.deepEqual(pins.map((p: any) => p.gathering_id), [g.G], "Ana reads Bo's pins beyond G");
});

test("Q06 V1 scoping — the people row does not carry how many gatherings someone is pinned to", async () => {
  // Since M4.2/Q07+Q37 (10 Oct 2026) people is read column by column: "*" is refused.
  const { data, error } = await C("Ana").from("people").select(VIEWER_COLUMNS).eq("id", m.Bo!.id);
  assert.equal(error, null);
  const row = data![0];
  const svc = await svcPerson("Bo");
  note(`Q06: columns Ana reads on Bo's row: ${Object.keys(row).join(",")}; service gatherings_count=${svc.gatherings_count}`);
  // Phase 2: decided (Alex, M3.2, migration 20260925181557 — A22 shows "a number, never
  // which ones", readable as the first name is). Kept as a recorded observation, not a leak.
  note(`Q06 (decided, A22): gatherings_count readable by V1 viewers: ${"gatherings_count" in row}`);
});

test("Q07 V3 (§5 'never ordered by join time') — a viewer cannot read when someone joined", async () => {
  const p = await C("Ana").from("people").select("created_at").eq("id", m.Bo!.id);
  const q = await C("Ana").from("pins").select("created_at, updated_at").eq("person_id", m.Bo!.id);
  const leaked: string[] = [];
  if (!p.error && p.data?.[0]?.created_at) leaked.push("people.created_at");
  if (!q.error && q.data?.[0]?.created_at) leaked.push("pins.created_at");
  if (!q.error && q.data?.[0]?.updated_at) leaked.push("pins.updated_at");
  assert.deepEqual(leaked, [], "join time readable: the list can be ordered by join time by the viewer");
});

test("Q08 D1/V3/V5 — another person's gender, birth year, 19+ record, contact details: not by table, not by embedding", async () => {
  for (const t of ["people_private", "age_attestations", "contact_points"]) {
    assert.deepEqual(await ids(C("Ana").from(t).select("person_id").eq("person_id", m.Bo!.id), "person_id"), [], `Ana reads Bo's ${t}`);
  }
  const { data } = await C("Ana").from("people").select("id, people_private(*), age_attestations(*), contact_points(*), person_handles(*), pin_friends:pins(pin_friends(*))").eq("id", m.Bo!.id);
  const row = data?.[0];
  if (row) {
    for (const k of ["people_private", "age_attestations", "contact_points", "person_handles"]) {
      const v = (row as Record<string, unknown>)[k];
      assert.ok(v === null || v === undefined || (Array.isArray(v) && v.length === 0), `embedded ${k} leaks: ${JSON.stringify(v)}`);
    }
  }
});

test("Q09 V4 — a block (one row) hides both ways everywhere; the blocked never sees the row; nobody forges one", async () => {
  // Control before: Fi and Bo see each other, Fi can sign Bo's photo.
  assert.equal(await sees("Fi", "Bo"), true, "control");
  await must(C("Fi").from("blocks").insert({ blocker_id: m.Fi!.id, blocked_id: m.Bo!.id }), "Fi blocks Bo");
  assert.equal(await sees("Fi", "Bo"), false, "Fi still sees Bo");
  assert.equal(await sees("Bo", "Fi"), false, "Bo still sees Fi");
  assert.equal(await canSign(C("Fi"), m.Bo!.photo!), false, "Fi can sign Bo's photo after blocking");
  assert.equal(await canSign(C("Bo"), m.Fi!.photo!), false, "Bo can sign Fi's photo after being blocked");
  assert.deepEqual(await ids(C("Fi").from("person_tags").select("person_id").eq("person_id", m.Bo!.id), "person_id"), [], "Fi reads Bo's tags");
  assert.deepEqual(await ids(C("Fi").from("pin_friends").select("id").eq("pin_id", pin["Bo@G"])), [], "Fi reads Bo's +1");
  assert.deepEqual(await ids(C("Bo").from("blocks").select("blocker_id"), "blocker_id"), [], "Bo reads the block row");
  // Bo cannot remove it.
  await C("Bo").from("blocks").delete().eq("blocker_id", m.Fi!.id);
  const still = await must(service.from("blocks").select("blocker_id").eq("blocker_id", m.Fi!.id), "svc block");
  assert.equal(still.length, 1, "Bo deleted Fi's block");
  // Others unaffected.
  assert.equal(await sees("Ana", "Bo"), true);
  assert.equal(await sees("Ana", "Fi"), true);
  // Forge: Ana writes a block between Jo and Ida.
  const forged = await C("Ana").from("blocks").insert({ blocker_id: m.Ida!.id, blocked_id: m.Jo!.id });
  assert.ok(forged.error, "Ana forged a block for Ida");
});

test("Q10 V1/V10 — a hidden person sees nobody and cannot unhide; nobody sees them", async () => {
  const people = await ids(C("Ed").from("people").select("id").neq("id", m.Ed!.id));
  assert.deepEqual(people, [], "hidden Ed reads people");
  await C("Ed").from("people").update({ hidden_at: null }).eq("id", m.Ed!.id);
  assert.ok((await svcPerson("Ed")).hidden_at, "Ed unhid himself");
});

test("Q11 D3 — a person cannot write their own photo_status, hidden_at, is_seed, auth_user_id, gatherings_count, or anyone else's row", async () => {
  const attempts: Record<string, unknown> = {
    photo_status: "approved",
    hidden_at: new Date().toISOString(),
    is_seed: true,
    auth_user_id: m.Zed!.authId,
    gatherings_count: 99,
  };
  const before = await svcPerson("Gil");
  for (const [col, val] of Object.entries(attempts)) {
    await C("Gil").from("people").update({ [col]: val }).eq("id", m.Gil!.id);
  }
  const after = await svcPerson("Gil");
  for (const col of Object.keys(attempts)) assert.deepEqual(after[col], before[col], `Gil wrote ${col}`);
  await C("Ana").from("people").update({ first_name: "Pwned" }).eq("id", m.Bo!.id);
  assert.equal((await svcPerson("Bo")).first_name, "Bo", "Ana renamed Bo");
  await C("Ana").from("people").delete().eq("id", m.Bo!.id);
  assert.ok(await svcPerson("Bo"), "Ana deleted Bo");
});

test("Q12 own rows only — a new account cannot claim someone else's account, a second person, a seed or pre-approved row, or another folder", async () => {
  const { c, authId } = await user("Nu");
  m.Nu = { name: "Nu", id: "", authId, c, photo: null };
  const nx = await user("Nx"); // an account with no person yet: claiming it is refused only by the rule, not by uniqueness
  const tries: Record<string, unknown>[] = [
    { first_name: "Nu", auth_user_id: nx.authId },
    { first_name: "Nu", auth_user_id: null },
    { first_name: "Nu", auth_user_id: authId, photo_path: m.Bo!.photo },
    { first_name: "Nu", auth_user_id: authId, is_seed: true },
    { first_name: "Nu", auth_user_id: authId, photo_status: "approved" },
    { first_name: "Nu", auth_user_id: authId, hidden_at: null, gatherings_count: 5 },
  ];
  const got: string[] = [];
  for (const row of tries) {
    const r = await c.from("people").insert(row).select("id");
    if (!r.error) {
      got.push(JSON.stringify(row));
      for (const x of r.data ?? []) await service.from("people").delete().eq("id", x.id);
    }
  }
  assert.deepEqual(got, [], "inserts that should have been refused");
  // A legitimate insert, then a second one.
  const ok = await must(c.from("people").insert({ first_name: "Nu", auth_user_id: authId }).select("id").single(), "Nu self insert");
  m.Nu.id = ok.id;
  const second = await c.from("people").insert({ first_name: "Nu2", auth_user_id: authId });
  assert.ok(second.error, "Nu made a second person");
  // Point photo_path into Bo's folder after insert.
  await c.from("people").update({ photo_path: m.Bo!.photo }).eq("id", ok.id);
  const nu = await must(service.from("people").select("photo_path").eq("id", ok.id).single(), "nu");
  assert.notEqual(nu.photo_path, m.Bo!.photo, "Nu pointed photo_path at Bo's photo");
  // people_private for someone else.
  const pp = await c.from("people_private").insert({ person_id: m.Ty!.id, gender: "woman" });
  assert.ok(pp.error, "Nu wrote Ty's private row");
});

test("Q13 pins — only your own, only on published/live/real gatherings, one per gathering, party 1–10", async () => {
  const a = C("Ana");
  const refused: [string, PromiseLike<any>][] = [
    ["pin for Bo", a.from("pins").insert({ gathering_id: g.R, person_id: m.Bo!.id, open_to_meeting: false, party_total: 1 })],
    ["pin on unpublished U", a.from("pins").insert({ gathering_id: g.U, person_id: m.Ana!.id, open_to_meeting: false, party_total: 1 })],
    ["pin on seed S", a.from("pins").insert({ gathering_id: g.S, person_id: m.Ana!.id, open_to_meeting: false, party_total: 1 })],
    ["pin on ended Lclosed", a.from("pins").insert({ gathering_id: g.Lclosed, person_id: m.Ana!.id, open_to_meeting: false, party_total: 1 })],
    ["second pin at G", a.from("pins").insert({ gathering_id: g.G, person_id: m.Ana!.id, open_to_meeting: false, party_total: 1 })],
    ["party 11", a.from("pins").insert({ gathering_id: g.H, person_id: m.Ana!.id, open_to_meeting: false, party_total: 11 })],
    ["party 0", a.from("pins").insert({ gathering_id: g.H, person_id: m.Ana!.id, open_to_meeting: false, party_total: 0 })],
  ];
  const leaks: string[] = [];
  for (const [what, q] of refused) {
    const r = await q;
    if (!r.error) leaks.push(what);
  }
  // Control: Ana CAN pin at H (proves the refusals above are not just a missing attestation).
  const ctl = await a.from("pins").insert({ gathering_id: g.H, person_id: m.Ana!.id, open_to_meeting: false, party_total: 1 }).select("id").single();
  assert.equal(ctl.error, null, `control: Ana could not pin at H: ${ctl.error?.message}`);
  pin["Ana@H"] = ctl.data.id;
  // Move own pin to U, or onto Bo.
  await a.from("pins").update({ gathering_id: g.U }).eq("id", pin["Ana@H"]);
  await a.from("pins").update({ person_id: m.Bo!.id }).eq("id", pin["Ana@H"]);
  const moved = await must(service.from("pins").select("gathering_id, person_id").eq("id", pin["Ana@H"]).single(), "ana@H");
  if (moved.gathering_id !== g.H) leaks.push("moved own pin to unpublished U");
  if (moved.person_id !== m.Ana!.id) leaks.push("re-assigned own pin to Bo");
  // Someone else's pin.
  await a.from("pins").update({ party_total: 9 }).eq("id", pin["Bo@G"]);
  await a.from("pins").delete().eq("id", pin["Bo@G"]);
  const bo = await service.from("pins").select("party_total").eq("id", pin["Bo@G"]).single();
  if (!bo.data || bo.data.party_total !== 2) leaks.push("touched Bo's pin");
  await a.from("pins").delete().eq("id", pin["Ana@H"]);
  assert.deepEqual(leaks, []);
});

test("Q14 may_meet (§3) — an anonymous person, or one without a photo, cannot make themselves open to meeting", async () => {
  await C("Anon1").from("pins").update({ open_to_meeting: true }).eq("id", pin["Anon1@G"]);
  const a = await must(service.from("pins").select("open_to_meeting").eq("id", pin["Anon1@G"]).single(), "anon1");
  assert.equal(a.open_to_meeting, false, "anonymous Anon1 opened to meeting");
  await C("Cy").from("pins").update({ open_to_meeting: true }).eq("id", pin["Cy@G"]);
  const c = await must(service.from("pins").select("open_to_meeting").eq("id", pin["Cy@G"]).single(), "cy");
  assert.equal(c.open_to_meeting, false, "Cy, with no photo, opened to meeting");
});

test("Q15 V6 — signed URLs: only for a photo you may see, not rejected, only the current file; no listing", async () => {
  assert.equal(await canSign(C("Ana"), m.Bo!.photo!), true, "control: Ana signs Bo's photo");
  assert.equal(await canSign(C("Bo"), m.Bo!.photo!), true, "control: owner");
  assert.equal(await canSign(C("Gil"), m.Gil!.photo!), true, "control: owner reads own rejected");
  for (const v of ["Cy", "Ed", "Zed", "Anon1"]) assert.equal(await canSign(C(v), m.Bo!.photo!), false, `${v} signs Bo's photo`);
  assert.equal(await canSign(C("Di"), m.Bo!.photo!), true, "control: Di sees Bo at H");
  assert.equal(await canSign(C("Di"), m.Ana!.photo!), false, "Di (opted in at H only) signs Ana's photo (G only)");
  assert.equal(await canSign(anon, m.Bo!.photo!), false, "anon signs Bo's photo");
  assert.equal(await canSign(C("Ana"), m.Gil!.photo!), false, "Ana signs Gil's rejected photo");
  assert.equal(await canSign(C("Ana"), `${m.Gil!.authId}/old.png`), false, "Ana signs a file in Gil's folder that is not his photo (an old upload)");
  const dl = await C("Ana").storage.from(BUCKET).download(`${m.Gil!.authId}/old.png`);
  assert.ok(dl.error || !dl.data, "Ana downloads Gil's old file directly");
  const list = await C("Ana").storage.from(BUCKET).list(m.Bo!.authId!);
  const listed = (list.data ?? []).map((f) => f.name);
  if (listed.length) note(`Q15: Ana can list Bo's folder and sees ${JSON.stringify(listed)} (only the photo she may already see)`);
  assert.ok(listed.every((n) => `${m.Bo!.authId}/${n}` === m.Bo!.photo), `Ana lists more than Bo's current photo: ${JSON.stringify(listed)}`);
  const gl = await C("Ana").storage.from(BUCKET).list(m.Gil!.authId!);
  assert.deepEqual((gl.data ?? []).map((f) => f.name), [], "Ana lists Gil's folder (rejected photo, old upload)");
  const root = await C("Ana").storage.from(BUCKET).list("");
  const rootNames = (root.data ?? []).map((f) => f.name);
  note(`Q15: Ana's root listing shows ${rootNames.length} folder(s) — the auth ids of people whose current photo she may see (already on their people rows)`);
  for (const n of ["Gil", "Seedy", "Ed", "Cy", "Zed"]) assert.ok(!rootNames.includes(m[n]!.authId!), `Ana's root listing reveals ${n}'s folder`);
  const pub = await fetch(`${env.url}/storage/v1/object/public/${BUCKET}/${m.Bo!.photo}`);
  assert.notEqual(pub.status, 200, "public URL works");
});

test("Q16 V6 — nobody writes, overwrites, deletes, moves or copies into another person's folder", async () => {
  const a = C("Ana").storage.from(BUCKET);
  const bo = m.Bo!.photo!;
  const leaks: string[] = [];
  const up = await a.upload(`${m.Bo!.authId}/evil.png`, PNG, { contentType: "image/png" });
  if (!up.error) leaks.push("upload into Bo's folder");
  const ow = await a.upload(bo, PNG, { contentType: "image/png", upsert: true });
  if (!ow.error) leaks.push("overwrite Bo's photo");
  await a.remove([bo]);
  if (!(await fileExists(bo))) leaks.push("deleted Bo's photo");
  const mv = await a.move(bo, `${m.Ana!.authId}/stolen.png`);
  if (!mv.error) leaks.push("moved Bo's photo");
  const cp = await a.copy(`${m.Gil!.authId}/old.png`, `${m.Ana!.authId}/gil-old.png`);
  if (!cp.error) leaks.push("copied Gil's (invisible) old file into own folder");
  const cp2 = await a.copy(bo, `${m.Ana!.authId}/bo-copy.png`);
  if (!cp2.error) note("Q16: Ana could COPY Bo's (visible) photo into her own folder — she could then wear it as her own photo (impersonation); not forbidden by the written rule");
  assert.deepEqual(leaks, []);
});

test("Q17 V6 — replacing an approved photo's bytes in place sends it back to be checked", async () => {
  const p = m.Bo!.photo!;
  const before = (await svcPerson("Bo")).photo_status;
  assert.equal(before, "approved");
  const r = await C("Bo").storage.from(BUCKET).upload(p, Buffer.concat([PNG, Buffer.from([0])]), { contentType: "image/png", upsert: true });
  if (r.error) {
    // try delete + re-upload under the same name
    await C("Bo").storage.from(BUCKET).remove([p]);
    const r2 = await C("Bo").storage.from(BUCKET).upload(p, PNG, { contentType: "image/png" });
    note(`Q17: in-place upsert refused (${r.error.message}); delete+reupload ${r2.error ? "refused: " + r2.error.message : "worked"}`);
    if (r2.error) return;
  }
  const after = (await svcPerson("Bo")).photo_status;
  assert.notEqual(after, "approved", "Bo replaced the bytes of his approved photo and it stayed 'approved' — never re-checked");
});

test("Q18 V17 — the handle is not readable through V1, by anon, by table or embedding; nobody writes another's", async () => {
  assert.deepEqual(await ids(C("Ana").from("person_handles").select("person_id").eq("person_id", m.Bo!.id), "person_id"), [], "Ana reads Bo's handle via V1");
  assert.deepEqual(await ids(anon.from("person_handles").select("person_id").limit(1), "person_id"), [], "anon reads handles");
  const own = await ids(C("Bo").from("person_handles").select("person_id"), "person_id");
  assert.deepEqual(own, [m.Bo!.id], "control: Bo reads his own");
  await C("Ana").from("person_handles").update({ instagram: "pwned" }).eq("person_id", m.Bo!.id);
  const ins = await C("Ana").from("person_handles").insert({ person_id: m.Ida!.id, instagram: "pwned" });
  const h = await must(service.from("person_handles").select("instagram").eq("person_id", m.Bo!.id).single(), "bo handle");
  assert.notEqual(h.instagram, "pwned", "Ana rewrote Bo's handle");
  assert.ok(ins.error, "Ana wrote Ida's handle");
});

test("Q19 V19 — tags: read exactly when V1 allows; own writes only; caps hold on both sides", async () => {
  const tagsOf = (v: string) => ids(C(v).from("person_tags").select("tag").eq("person_id", m.Bo!.id), "tag");
  assert.equal((await tagsOf("Ana")).length, 2, "control: Ana reads Bo's tags");
  for (const v of ["Cy", "Ed", "Zed", "Anon1"]) assert.deepEqual(await tagsOf(v), [], `${v} reads Bo's tags`);
  assert.deepEqual(await ids(anon.from("person_tags").select("tag").limit(1), "tag"), [], "anon reads tags");
  const ins = await C("Ana").from("person_tags").insert({ person_id: m.Bo!.id, tag: "comedy", on_list: false });
  assert.ok(ins.error, "Ana tagged Bo");
  await C("Bo").from("person_tags").update({ tag: "not-drinking" }).eq("person_id", m.Bo!.id).eq("tag", "chatty");
  const t = await ids(service.from("person_tags").select("tag").eq("person_id", m.Bo!.id), "tag");
  assert.ok(t.includes("chatty"), "Bo rewrote a tag's slug (only on_list is updatable)");
  // Caps: 10 tags, 3 on the list.
  const slugs = (await must(anon.from("tags").select("slug"), "tags")).map((r: any) => r.slug).filter((s: string) => !["chatty", "live-music"].includes(s));
  for (const s of slugs.slice(0, 8)) await must(C("Bo").from("person_tags").insert({ person_id: m.Bo!.id, tag: s, on_list: false }), `tag ${s}`);
  const eleventh = await C("Bo").from("person_tags").insert({ person_id: m.Bo!.id, tag: slugs[8], on_list: false });
  assert.ok(eleventh.error, "an eleventh tag was accepted");
  await must(C("Bo").from("person_tags").update({ on_list: true }).eq("person_id", m.Bo!.id).in("tag", [slugs[0], slugs[1]]), "two more on list");
  const fourth = await C("Bo").from("person_tags").update({ on_list: true }).eq("person_id", m.Bo!.id).eq("tag", slugs[2]).select();
  const onList = await ids(service.from("person_tags").select("tag").eq("person_id", m.Bo!.id).eq("on_list", true), "tag");
  assert.equal(onList.length, 3, `four on the list (${fourth.error?.message ?? "no error"})`);
  // Room again after removing one (other side of the boundary).
  await must(C("Bo").from("person_tags").delete().eq("person_id", m.Bo!.id).eq("tag", slugs[7]), "remove one");
  await must(C("Bo").from("person_tags").insert({ person_id: m.Bo!.id, tag: slugs[8], on_list: false }), "tenth again");
  // Vocabulary is read-only.
  const vocab = await C("Bo").from("tags").insert({ slug: "pwned", name: "pwned", sort_order: 99 });
  assert.ok(vocab.error, "Bo added to the vocabulary");
});

test("Q20 V2 — counts: numbers only; unpublished/seed give nothing; hidden in pinned only; +1s never open; seed never counted", async () => {
  const k = await counts(anon, "K");
  note(`Q20: gathering_counts keys = ${Object.keys(k ?? {}).join(",")}; K = ${JSON.stringify(k)}`);
  for (const key of Object.keys(k)) assert.ok(!/person|name|first|auth|photo|people/.test(key), `counts carry ${key}`);
  // K: open k1..k4 (+ hidden khid, + seed kseed) ; pinned 4 + khid 1 + kno 3 = 8 (kseed excluded)
  assert.equal(k.open_to_meeting, 4, "open_to_meeting at K");
  assert.equal(k.pinned, 8, "pinned at K (hidden counts, seed never, +2 counts)");
  for (const label of ["U", "S"]) {
    const x = await counts(anon, label);
    assert.ok(x === null || x.error, `anon gets counts for ${label}: ${JSON.stringify(x)}`);
    const y = await counts(C("Ana"), label);
    assert.ok(y === null || y.error, `Ana gets counts for ${label}: ${JSON.stringify(y)}`);
  }
});

test("Q21 V3 — the mix is null below 5, appears at 5, sums to open, Other only above zero; hidden/seed never fill the floor", async () => {
  const k = await counts(anon, "K");
  assert.equal(k.open_to_meeting, 4);
  assert.ok(k.women === null && k.men === null && k.other === null, `mix shown at 4 (with a hidden and a seed person open): ${JSON.stringify(k)}`);
  await person("k5", { gender: "man" });
  await pinIn("k5", "K", true);
  const k5 = await counts(anon, "K");
  assert.equal(k5.open_to_meeting, 5);
  assert.equal(k5.women, 2);
  assert.equal(k5.men, 3);
  assert.equal(k5.other, null, "Other shown at zero");
  // Withdraw k5's opt-in again: back under the floor.
  await must(service.from("pins").update({ open_to_meeting: false }).eq("id", pin["k5@K"]), "k5 off");
  const k4 = await counts(anon, "K");
  assert.ok(k4.women === null && k4.men === null, "mix still shown after dropping to 4");
});

test("Q22 V5 — the women-only offer and link: yes only to eligible people when 3+ eligible; never a number; nothing to others", async () => {
  const offer = async (v: string, label: string) => {
    const { data, error } = await C(v).rpc("women_only_offer", { p_gathering: g[label] });
    return error ? `error ${error.message}` : data;
  };
  // Eligible opted in at G: Ana, Fi, Hu, Ida (Seedy is seed → must not count).
  assert.equal(await offer("Ana", "G"), true, "control: Ana gets the offer");
  assert.equal(await offer("Hu", "G"), true, "control: Hu (nonbinary, opted in to women-only)");
  for (const v of ["Bo", "Nb", "Cy", "Zed", "Ed"]) assert.notEqual(await offer(v, "G"), true, `${v} gets the women-only offer`);
  assert.notEqual(await offer("Di", "H"), true, "Di gets the offer at H with only one eligible");
  const link = async (v: string, kind: string, label = "G") => ids(C(v).from("gathering_group_links").select("url").eq("gathering_id", g[label]).eq("kind", kind), "url");
  assert.equal((await link("Ana", "women_only")).length, 1, "control: Ana reads the women-only link");
  for (const v of ["Bo", "Nb", "Cy"]) assert.deepEqual(await link(v, "women_only"), [], `${v} reads the women-only link`);
  assert.deepEqual(await link("Di", "women_only", "H"), [], "Di reads H's women-only link below 3");
  assert.deepEqual(await link("Cy", "everyone"), [], "Cy (pinned, not opted in) reads the main link");
  assert.deepEqual(await ids(anon.from("gathering_group_links").select("url").limit(1), "url"), [], "anon reads links");
  assert.deepEqual(await link("Ana", "everyone", "U"), [], "Ana reads an unpublished gathering's link");
});

test("Q23 V5/H7 SOFT — a man can re-declare himself a woman after opting in and receive the women-only offer", async () => {
  const r = await C("Bo").from("people_private").update({ gender: "woman" }).eq("person_id", m.Bo!.id).select("gender");
  const { data } = await C("Bo").rpc("women_only_offer", { p_gathering: g.G });
  note(`Q23: Bo's own gender update ${r.error ? "refused: " + r.error.message : "accepted"}; offer afterwards = ${data}`);
  await must(service.from("people_private").update({ gender: "man" }).eq("person_id", m.Bo!.id), "restore Bo");
});

test("Q24 V7 — +1s: claimed only, only to viewers of the host, never the token hash or attestation; nobody writes them", async () => {
  const names = await ids(C("Ana").from("pin_friends").select("first_name").eq("pin_id", pin["Bo@G"]), "first_name");
  assert.deepEqual(names, ["Rohan"], `Ana reads Bo's +1s: ${names}`);
  const tok = await C("Ana").from("pin_friends").select("claim_token_hash").eq("pin_id", pin["Bo@G"]);
  assert.ok(tok.error || (tok.data ?? []).every((r: any) => r.claim_token_hash == null), "claim_token_hash readable");
  const age = await C("Bo").from("pin_friends").select("age_attested_at").eq("pin_id", pin["Bo@G"]);
  assert.ok(age.error || (age.data ?? []).every((r: any) => r.age_attested_at == null), "+1 age attestation readable (even to host)");
  const hostTok = await C("Bo").from("pin_friends").select("claim_token_hash");
  assert.ok(hostTok.error || (hostTok.data ?? []).every((r: any) => r.claim_token_hash == null), "host reads claim_token_hash");
  for (const v of ["Cy", "Di", "Zed"]) assert.deepEqual(await ids(C(v).from("pin_friends").select("id").eq("pin_id", pin["Bo@G"])), [], `${v} reads Bo's +1s`);
  const w = await C("Bo").from("pin_friends").insert({ pin_id: pin["Bo@G"], first_name: "Fake", claimed_at: new Date().toISOString(), claim_token_hash: "x" });
  assert.ok(w.error, "a visitor wrote a +1 row");
});

test("Q25 V9 — reports: only on someone you can see, only as yourself, never setting status, never reading what moderation did", async () => {
  const j = C("Jo");
  const bad: [string, Record<string, unknown>][] = [
    ["on Di (not visible to Jo)", { reporter_id: m.Jo!.id, target_kind: "person", target_person_id: m.Di!.id, reason: "spam" }],
    ["as Kai", { reporter_id: m.Kai!.id, target_kind: "person", target_person_id: m.Ty!.id, reason: "spam" }],
    ["with status", { reporter_id: m.Jo!.id, target_kind: "person", target_person_id: m.Ty!.id, reason: "spam", status: "actioned" }],
    ["with is_safety", { reporter_id: m.Jo!.id, target_kind: "person", target_person_id: m.Ty!.id, reason: "spam", is_safety: true }],
    ["Di via kind=crew", { reporter_id: m.Jo!.id, target_kind: "crew", target_person_id: m.Di!.id, reason: "uncomfortable" }],
    ["Di via kind=message", { reporter_id: m.Jo!.id, target_kind: "message", target_person_id: m.Di!.id, reason: "uncomfortable" }],
    ["Di via kind=room_message", { reporter_id: m.Jo!.id, target_kind: "room_message", target_person_id: m.Di!.id, reason: "uncomfortable" }],
    ["anon", { target_kind: "person", target_person_id: m.Ty!.id, reason: "spam" }],
  ];
  const leaks: string[] = [];
  for (const [what, row] of bad) {
    const r = await (what === "anon" ? anon : j).from("reports").insert(row);
    if (!r.error) leaks.push(what);
  }
  const di = await svcPerson("Di");
  if (di.hidden_at) leaks.push("Di got hidden by Jo, who cannot see her");
  assert.deepEqual(leaks, []);
});

test("Q26 V10 — auto-hide: uncomfortable/under_19 at one; spam/not_who_they_said at two distinct reporters; a repeat counts once", async () => {
  const file = (who: string, target: string, reason: string) =>
    must(C(who).from("reports").insert({ reporter_id: m[who]!.id, target_kind: "person", target_person_id: m[target]!.id, reason }), `${who} reports ${target} ${reason}`);
  const hidden = async (n: string) => !!(await svcPerson(n)).hidden_at;
  await file("Jo", "Ty", "spam");
  await file("Jo", "Ty", "spam").catch((e) => note(`Q26: a repeat spam report from Jo was refused: ${e.message}`));
  assert.equal(await hidden("Ty"), false, "spam: the same reporter twice hid Ty");
  await file("Kai", "Ty", "spam");
  assert.equal(await hidden("Ty"), true, "spam: two distinct reporters did not hide Ty");
  await file("Jo", "Vic", "not_who_they_said");
  assert.equal(await hidden("Vic"), false, "not_who_they_said: one report hid Vic");
  await file("Kai", "Vic", "not_who_they_said");
  assert.equal(await hidden("Vic"), true, "not_who_they_said: two did not hide Vic");
  await file("Jo", "Uma", "uncomfortable");
  assert.equal(await hidden("Uma"), true, "uncomfortable did not hide at one");
  await file("Kai", "Wa", "under_19");
  assert.equal(await hidden("Wa"), true, "under_19 did not hide at one");
  // A spam report + a not_who_they_said from a second reporter: two different non-safety reasons.
  // Reporter reads own report: only the four columns.
  const own = await C("Jo").from("reports").select("id, target_kind, reason, created_at");
  assert.equal(own.error, null);
  assert.ok((own.data ?? []).length >= 1, "control: Jo reads his own reports");
  for (const col of ["status", "target_person_id", "decision_note", "is_safety", "reviewed_at", "reported_content_snapshot"]) {
    const r = await C("Jo").from("reports").select(col);
    assert.ok(r.error || (r.data ?? []).every((x: any) => x[col] == null), `Jo reads ${col} of his report`);
  }
  // Filter-based inference: can Jo test a column he cannot select? (status=auto_hidden)
  const probe = await C("Jo").from("reports").select("id").eq("status", "auto_hidden");
  assert.ok(probe.error, `Jo filters his reports on status (learns his report hid someone): ${JSON.stringify(probe.data)}`);
  // Target and bystanders read nothing.
  for (const v of ["Kai", "Ana", "Zed"]) {
    const r = await C(v).from("reports").select("id").neq("reporter_id", m[v]!.id);
    assert.ok(r.error || (r.data ?? []).length === 0, `${v} reads someone else's report`);
  }
  // Reporter cannot change or delete it.
  await C("Jo").from("reports").update({ reason: "comedy" }).eq("reporter_id", m.Jo!.id);
  await C("Jo").from("reports").delete().eq("reporter_id", m.Jo!.id);
  const left = await must(service.from("reports").select("reason").eq("reporter_id", m.Jo!.id), "jo reports");
  assert.ok(left.length >= 3 && left.every((r: any) => r.reason !== "comedy"), "Jo changed or deleted his reports");
});

test("Q27 V8 — switching opt-in off removes you from G for everyone at once, and you lose sight; the vote stops counting", async () => {
  const poll = async (v: string) => {
    const { data } = await C(v).rpc("spot_poll", { p_gathering: g.G });
    return data;
  };
  const before = await poll("Ana");
  note(`Q27: spot_poll as Ana before = ${JSON.stringify(before)}`);
  await must(C("Bo").from("pins").update({ open_to_meeting: false }).eq("id", pin["Bo@G"]), "Bo off");
  assert.equal(await sees("Ana", "Bo"), false, "Ana still sees Bo after he switched off");
  assert.equal(await canSign(C("Ana"), m.Bo!.photo!), false, "Ana signs Bo's photo after he switched off");
  assert.deepEqual(await ids(C("Ana").from("pin_friends").select("id").eq("pin_id", pin["Bo@G"])), [], "Ana reads Bo's +1 after he switched off");
  assert.deepEqual(await ids(C("Ana").from("person_tags").select("tag").eq("person_id", m.Bo!.id), "tag"), [], "Ana reads Bo's tags after he switched off");
  assert.deepEqual(await ids(C("Bo").from("people").select("id").neq("id", m.Bo!.id).in("id", [m.Ana!.id, m.Ida!.id])), [], "Bo still sees G after switching off");
  const after = await poll("Ana");
  note(`Q27: spot_poll as Ana after Bo off = ${JSON.stringify(after)}`);
  assert.notDeepEqual(after, before, "Bo's vote still counts after he switched off");
  const bp = await C("Bo").rpc("spot_poll", { p_gathering: g.G });
  assert.ok(bp.error || bp.data == null || (Array.isArray(bp.data) && bp.data.length === 0), `Bo (not opted in) reads poll counts: ${JSON.stringify(bp.data)}`);
  // Delete the pin entirely: same.
  await must(C("Bo").from("pins").update({ open_to_meeting: true }).eq("id", pin["Bo@G"]), "Bo on");
  assert.equal(await sees("Ana", "Bo"), true, "control: back on");
  await must(C("Bo").from("pins").delete().eq("id", pin["Bo@G"]), "Bo deletes pin");
  assert.equal(await sees("Ana", "Bo"), false, "Ana still sees Bo after he removed his pin");
});

test("Q28 V1 list closing — open until effective end + 24h, closed after; pins frozen after the end, deletion always allowed", async () => {
  assert.equal(await sees("Lee", "Lou"), true, "Lee cannot see Lou 23h after the end (list should still be open)");
  const pinsOpen = await ids(C("Lee").from("pins").select("gathering_id").eq("person_id", m.Lou!.id), "gathering_id");
  assert.ok(pinsOpen.includes(g.Lopen), "control: Lou's Lopen pin readable");
  assert.ok(!pinsOpen.includes(g.Lclosed), "Lee reads Lou's pin at Lclosed (list closed 25h after end)");
  await C("Lee").from("pins").update({ party_total: 4 }).eq("id", pin["Lee@Lopen"]);
  const p = await must(service.from("pins").select("party_total").eq("id", pin["Lee@Lopen"]).single(), "lee");
  assert.equal(p.party_total, 1, "Lee edited a pin after the effective end");
  await must(C("Lee").from("pins").delete().eq("id", pin["Lee@Lclosed"]), "Lee deletes after the end");
  const gone = await service.from("pins").select("id").eq("id", pin["Lee@Lclosed"]);
  assert.equal((gone.data ?? []).length, 0, "Lee could not delete his pin after the end");
});

test("Q29 V11/V13 — unpublished and withdrawn gatherings: invisible to outsiders; withdrawn readable only by its pinned people, list closed", async () => {
  assert.deepEqual(await ids(anon.from("gatherings").select("id").eq("id", g.U)), [], "anon reads U");
  assert.deepEqual(await ids(C("Ana").from("gatherings").select("id").eq("id", g.U)), [], "Ana reads U");
  assert.deepEqual(await ids(anon.from("gathering_spots").select("id").eq("gathering_id", g.U)), [], "anon reads U's spot options");
  assert.equal((await ids(C("Wil").from("people").select("id").eq("id", m.Wes!.id))).length, 0);
  await must(service.rpc("admin_withdraw_gathering", { p_actor: ACTOR, p_gathering: g.W, p_note: `${PREFIX} review`, p_reason: "takedown" }), "withdraw W");
  assert.deepEqual(await ids(anon.from("gatherings").select("id").eq("id", g.W)), [], "anon reads withdrawn W");
  assert.deepEqual(await ids(C("Zed").from("gatherings").select("id").eq("id", g.W)), [], "Zed reads withdrawn W");
  assert.equal((await ids(C("Wil").from("gatherings").select("id").eq("id", g.W))).length, 1, "control: Wil (pinned) reads W");
  assert.equal((await ids(C("Wes").from("gatherings").select("id").eq("id", g.W))).length, 1, "control: Wes (pinned, not open) reads W");
  assert.deepEqual(await ids(C("Wil").from("gathering_spots").select("id").eq("gathering_id", g.W)), [], "Wil reads W's spot options");
  const wc = await counts(anon, "W");
  assert.ok(wc === null || wc.error, `anon reads W's counts: ${JSON.stringify(wc)}`);
  const wcz = await counts(C("Zed"), "W");
  assert.ok(wcz === null || wcz.error, `Zed reads W's counts: ${JSON.stringify(wcz)}`);
  const reason = await C("Wil").from("gatherings").select("*").eq("id", g.W);
  assert.ok(!JSON.stringify(reason.data ?? []).includes("takedown"), "Wil reads the withdrawal reason");
  const wr = await C("Wil").from("gathering_withdrawals").select("*");
  assert.ok(wr.error || (wr.data ?? []).length === 0, "Wil reads gathering_withdrawals");
  const np = await C("Zed").from("pins").insert({ gathering_id: g.W, person_id: m.Zed!.id, open_to_meeting: false, party_total: 1 });
  assert.ok(np.error, "Zed pinned to a withdrawn gathering");
  await C("Wes").from("pins").update({ party_total: 3 }).eq("id", pin["Wes@W"]);
  const wes = await must(service.from("pins").select("party_total").eq("id", pin["Wes@W"]).single(), "wes");
  note(`Q29: Wes editing his pin on a withdrawn gathering: party_total now ${wes.party_total}`);
  const pg = await anon.rpc("public_gatherings", { p_city: "toronto", p_from: at(-DAY), p_to: at(30 * DAY) });
  assert.ok(!JSON.stringify(pg.data ?? []).includes(RUN), "a harness gathering appears on the public list");
});

test("Q30 V18 — seed rows never reach a non-tester: gathering, venue, spots, counts, a seed person at a real gathering; a seed person sees nobody", async () => {
  for (const [who, c] of [["anon", anon], ["Ana", C("Ana")]] as const) {
    assert.deepEqual(await ids(c.from("gatherings").select("id").eq("id", g.S)), [], `${who} reads seed gathering S`);
    assert.deepEqual(await ids(c.from("venues").select("id").eq("id", seedVenue)), [], `${who} reads the seed venue`);
    assert.deepEqual(await ids(c.from("meeting_spots").select("id").eq("venue_id", seedVenue)), [], `${who} reads seed spots`);
    const sc = await counts(c, "S");
    assert.ok(sc === null || sc.error, `${who} reads seed counts: ${JSON.stringify(sc)}`);
  }
  assert.equal(await sees("Ana", "Seedy"), false, "Ana sees seed person Seedy at real G");
  assert.equal(await canSign(C("Ana"), m.Seedy!.photo!), false, "Ana signs seed person's photo");
  assert.deepEqual(await ids(C("Seedy").from("people").select("id").neq("id", m.Seedy!.id)), [], "seed person Seedy sees people");
  const s = await C("Seedy").from("pins").insert({ gathering_id: g.H, person_id: m.Seedy!.id, open_to_meeting: true, party_total: 1 });
  note(`Q30: a seed person pinning a real gathering herself: ${s.error ? "refused" : "accepted"}`);
  if (!s.error) await service.from("pins").delete().eq("gathering_id", g.H).eq("person_id", m.Seedy!.id);
});

test("Q31 V18 testers — a tester sees the seed gathering and its seed people; never a seed person at a real gathering; counts at G equal anon's; flag off removes it", async () => {
  assert.equal((await ids(C("Tess").from("gatherings").select("id").eq("id", g.S))).length, 1, "control: tester reads S");
  const atS = await ids(C("Tess").from("pins").select("person_id").eq("gathering_id", g.S), "person_id");
  assert.ok(atS.includes(m.Seedy!.id), "control: tester sees Seedy at S");
  const atG = await ids(C("Tess").from("pins").select("person_id").eq("gathering_id", g.G), "person_id");
  assert.ok(!atG.includes(m.Seedy!.id), "tester sees seed Seedy at real G");
  assert.equal(await sees("Tess", "Seedy"), true, "control: Seedy's row via S");
  const tg = await counts(C("Tess"), "G");
  const ag = await counts(anon, "G");
  assert.deepEqual(tg, ag, "tester's counts at real G differ from anon's");
  // Does Seedy (seed) see Tess at S? (testers exception only speaks of the tester's sight)
  note(`Q31: seed person Seedy sees tester Tess at S: ${await sees("Seedy", "Tess")}`);
  // A tester's sight of a seed photo at S.
  note(`Q31: tester signs Seedy's photo: ${await canSign(C("Tess"), m.Seedy!.photo!)}`);
  // The tester's tag/handle read on Seedy.
  const h = await ids(C("Tess").from("person_handles").select("person_id").eq("person_id", m.Seedy!.id), "person_id");
  assert.deepEqual(h, [], "tester reads seed person's handle");
  // Remove the flag.
  await must(service.rpc("admin_set_tester", { p_actor: ACTOR, p_auth_user: m.Tess!.authId, p_note: `${PREFIX} review`, p_on: false }), "tester off");
  assert.deepEqual(await ids(C("Tess").from("gatherings").select("id").eq("id", g.S)), [], "Tess still reads S after the flag came off");
  assert.equal(await sees("Tess", "Seedy"), false, "Tess still sees Seedy after the flag came off");
});

test("Q32 votes & surveys — own only, opted in only, the option must belong to the gathering", async () => {
  const leaks: string[] = [];
  const v1 = await C("Ana").from("spot_votes").insert({ gathering_id: g.G, gathering_spot_id: gs[0], person_id: m.Ida!.id });
  if (!v1.error) leaks.push("Ana voted as Ida");
  const v2 = await C("Ida").from("spot_votes").insert({ gathering_id: g.G, gathering_spot_id: hs, person_id: m.Ida!.id });
  if (!v2.error) leaks.push("Ida voted at G with H's option");
  const v3 = await C("Cy").from("spot_votes").insert({ gathering_id: g.G, gathering_spot_id: gs[0], person_id: m.Cy!.id });
  if (!v3.error) leaks.push("Cy (not opted in) voted");
  const r = await C("Ana").from("spot_votes").select("person_id").neq("person_id", m.Ana!.id);
  if (!r.error && (r.data ?? []).length) leaks.push("Ana reads others' votes");
  const s = await C("Ana").from("survey_responses").insert({ gathering_id: g.G, person_id: m.Ida!.id, met: "none", would_have_gone: "yes" });
  if (!s.error) leaks.push("Ana wrote Ida's survey");
  const cp = await C("Ana").from("contact_points").insert({ person_id: m.Ida!.id, kind: "email", value: "x@example.com" });
  if (!cp.error) leaks.push("Ana wrote Ida's contact point");
  const aa = await C("Ana").from("age_attestations").insert({ person_id: m.Zed!.id, attested_at: new Date().toISOString(), source: attestSource });
  if (!aa.error) leaks.push("Ana wrote Zed's 19+ record");
  await C("Ana").from("age_attestations").delete().eq("person_id", m.Ana!.id);
  const own = await service.from("age_attestations").select("person_id").eq("person_id", m.Ana!.id);
  if ((own.data ?? []).length === 0) leaks.push("Ana deleted her own 19+ record");
  assert.deepEqual(leaks, []);
});

test("Q33 remove_me_under_19 — refused for a permanent account", async () => {
  const r = await C("Zed").rpc("remove_me_under_19");
  const z = await service.from("people").select("id").eq("id", m.Zed!.id);
  assert.equal((z.data ?? []).length, 1, `Zed (a permanent account) removed himself: ${r.error?.message}`);
});

test("Q34 enumeration — error text does not tell a real hidden-from-you id from a random one", async () => {
  const rand = randomUUID();
  const a = await C("Jo").from("reports").insert({ reporter_id: m.Jo!.id, target_kind: "person", target_person_id: m.Di!.id, reason: "spam" });
  const b = await C("Jo").from("reports").insert({ reporter_id: m.Jo!.id, target_kind: "person", target_person_id: rand, reason: "spam" });
  const c = await C("Ana").from("pins").insert({ gathering_id: g.U, person_id: m.Ana!.id, open_to_meeting: false, party_total: 1 });
  const d = await C("Ana").from("pins").insert({ gathering_id: rand, person_id: m.Ana!.id, open_to_meeting: false, party_total: 1 });
  note(`Q34: report real=${a.error?.code} random=${b.error?.code}; pin draft=${c.error?.code} random=${d.error?.code}`);
  assert.equal(a.error?.code, b.error?.code, "report error codes differ between a real and a random person");
  assert.equal(c.error?.code, d.error?.code, "pin error codes differ between a draft and a random gathering");
});

test("Q35 GraphQL — the second API door reads no people", async () => {
  const r = await fetch(`${env.url}/graphql/v1`, {
    method: "POST",
    headers: { apikey: env.publishableKey, "content-type": "application/json" },
    body: JSON.stringify({ query: "{ peopleCollection(first: 5) { edges { node { id first_name } } } }" }),
  });
  const j: any = await r.json().catch(() => ({}));
  note(`Q35: graphql status ${r.status}: ${JSON.stringify(j).slice(0, 160)}`);
  const edges = j?.data?.peopleCollection?.edges ?? [];
  assert.equal(edges.length, 0, "anon reads people over GraphQL");
});

test("Q36 public RPCs — what anon can call, and that each returns no person", async () => {
  const doc = await openapi();
  const out: string[] = [];
  for (const p of Object.keys(doc.paths).filter((p) => p.startsWith("/rpc/") && !p.startsWith("/rpc/admin_"))) {
    const fn = p.slice(5);
    const body = doc.paths[p].post?.parameters?.find((x: any) => x.in === "body");
    const args: Record<string, null> = {};
    for (const k of Object.keys(body?.schema?.properties ?? {})) args[k] = null;
    const { data, error } = await anon.rpc(fn, args);
    out.push(`${fn}: ${error ? error.code : "OK " + JSON.stringify(data).slice(0, 60)}`);
  }
  note("Q36 anon RPC sweep:\n  " + out.join("\n  "));
  const chip = await anon.rpc("chip_category", { p_classification: null });
  assert.ok(chip.error, "anon ran chip_category (doc: service_role only)");
});

test("Q37 V6 §8 — 'needs_review' (a possible minor) is told to nobody: not to a viewer, not to the owner; 'rejected' is not readable by a viewer", async () => {
  await person("Mia", { gender: "woman", photo: "needs_review", session: true });
  await pinIn("Mia", "G", true);
  assert.equal(await sees("Ana", "Mia"), true, "control: Ana sees Mia");
  assert.equal(await canSign(C("Ana"), m.Mia!.photo!), true, "control: a needs_review photo shows (§8)");
  const v = await C("Ana").from("people").select("photo_status").eq("id", m.Mia!.id);
  const o = await C("Mia").from("people").select("photo_status").eq("id", m.Mia!.id);
  const r = await C("Ana").from("people").select("photo_status").eq("id", m.Gil!.id);
  const leaks: string[] = [];
  if (!v.error && v.data?.[0]?.photo_status === "needs_review") leaks.push("Ana (a stranger on the list) reads Mia's photo_status = needs_review: 'flagged as a possible minor'");
  if (!o.error && o.data?.[0]?.photo_status === "needs_review") leaks.push("Mia reads her own photo_status = needs_review (§8: the owner is told nothing, ever — it tells someone gaming the check what trips it)");
  if (!r.error && r.data?.[0]?.photo_status === "rejected") leaks.push("Ana reads Gil's photo_status = rejected (nudity, hate imagery or gore)");
  // The same through a filter even if the column were hidden.
  const f = await C("Ana").from("people").select("id").eq("photo_status", "needs_review");
  if (!f.error && (f.data ?? []).length) leaks.push(`Ana filters people on photo_status=needs_review: ${f.data!.length}`);
  assert.deepEqual(leaks, []);
});

test("Q38 V1 — what else a viewer reads on another person's row (auth id, hidden_at, is_seed, last_initial)", async () => {
  const { data } = await C("Ana").from("people").select(VIEWER_COLUMNS).eq("id", m.Ida!.id);
  note(`Q38: Ana reads Ida's row: ${JSON.stringify(Object.fromEntries(Object.entries(data?.[0] ?? {}).map(([k, v]) => [k, k === "auth_user_id" ? (v ? "<uuid>" : v) : v])))}`);
});

// ================================================================ Phase 2 — after reading the SQL

test("Q39 V10 §11 'hidden people cannot see anyone themselves' — a hidden person still in a group sees its members and can hide one with a report", async () => {
  // private.after_peer (V23, inside private.can_see) checks the TARGET is not hidden, never the viewer.
  await person("Hx", { gender: "man", photo: "approved", session: true });
  await person("Gm1", { gender: "woman", photo: "approved", session: true });
  await person("Gm2", { gender: "woman" });
  await must(service.from("person_tags").insert({ person_id: m.Gm1!.id, tag: "comedy", on_list: true }), "Gm1 tag");
  const crew = await must(service.from("crews").insert({ gathering_id: g.G, state: "forming" }).select("id").single(), "crew");
  await must(
    service.from("crew_members").insert(["Hx", "Gm1", "Gm2"].map((n) => ({ crew_id: crew.id, gathering_id: g.G, person_id: m[n]!.id }))),
    "crew members",
  );
  assert.equal(await sees("Hx", "Gm1"), true, "control: a group member sees another (V21/V23 by design)");
  // Moderation hides Hx (e.g. an upheld report). He stays in the group: only rooms are emptied on hide.
  await must(service.from("people").update({ hidden_at: new Date().toISOString() }).eq("id", m.Hx!.id), "hide Hx");
  const leaks: string[] = [];
  if (await sees("Hx", "Gm1")) leaks.push("hidden Hx reads Gm1's people row");
  if (await canSign(C("Hx"), m.Gm1!.photo!)) leaks.push("hidden Hx signs Gm1's photo");
  if ((await ids(C("Hx").from("person_tags").select("tag").eq("person_id", m.Gm1!.id), "tag")).length) leaks.push("hidden Hx reads Gm1's tags");
  const r = await C("Hx").from("reports").insert({ reporter_id: m.Hx!.id, target_kind: "person", target_person_id: m.Gm2!.id, reason: "uncomfortable" });
  if (!r.error) leaks.push("hidden Hx filed a report on Gm2");
  if ((await svcPerson("Gm2")).hidden_at) leaks.push("hidden Hx's one 'uncomfortable' report hid Gm2 (retaliation by a moderated person)");
  const back = await C("Gm1").from("people").select("id").eq("id", m.Hx!.id);
  note(`Q39: Gm1 sees hidden Hx: ${(back.data ?? []).length > 0}`);
  assert.deepEqual(leaks, []);
});

test("Q40 Q2/§3 may_meet — the opt-in gate trusts photo_path, not a photo: point it at nothing and opt in", async () => {
  const fake = `${m.Zed!.authId}/nothing-here.png`;
  assert.equal(await fileExists(fake), false);
  await must(C("Zed").from("people").update({ photo_path: fake }).eq("id", m.Zed!.id), "Zed fake photo_path");
  const r = await C("Zed").from("pins").insert({ gathering_id: g.H, person_id: m.Zed!.id, open_to_meeting: true, party_total: 1 }).select("id");
  const got = !r.error && (r.data ?? []).length > 0;
  if (got) await service.from("pins").delete().eq("id", r.data![0].id);
  await service.from("people").update({ photo_path: null }).eq("id", m.Zed!.id);
  assert.equal(got, false, "Zed opted in to meeting with no photo at all (photo_path points at a file that does not exist)");
});

test("Q41 H8 — an under-19 birth year is not accepted, and never becomes a 19+ attestation", async () => {
  const { c, authId } = await user("Kid");
  const p = await must(c.from("people").insert({ first_name: "Kid", auth_user_id: authId }).select("id").single(), "Kid person");
  m.Kid = { name: "Kid", id: p.id, authId, c, photo: null };
  const year = new Date().getFullYear() - 12;
  const r = await c.from("people_private").insert({ person_id: p.id, gender: "woman", birth_year: year, age_attested_at: new Date().toISOString() });
  const att = await service.from("age_attestations").select("source").eq("person_id", p.id);
  note(`Q41: people_private with birth_year ${year}: ${r.error ? "refused: " + r.error.message : "accepted"}; attestation rows: ${JSON.stringify(att.data)}`);
  assert.ok(r.error, `a ${new Date().getFullYear() - year}-year-old's birth year was accepted and recorded as a 19+ attestation`);
});

test("Q42 V11/V18 — convening_of (anon-callable, security definer) does not answer for a draft or seed gathering", async () => {
  const out: Record<string, unknown> = {};
  for (const label of ["U", "S", "G"]) out[label] = (await anon.rpc("convening_of", { p_gathering: g[label] })).data;
  out.random = (await anon.rpc("convening_of", { p_gathering: randomUUID() })).data;
  note(`Q42: convening_of as anon: ${JSON.stringify(out)}`);
  assert.equal(out.U, null, "anon learns a draft gathering exists (and whether it came from Ticketmaster)");
  assert.equal(out.S, null, "anon learns a seed gathering exists");
});

test("Q43 V13 — a pin on a withdrawn gathering cannot be edited (only read and removed)", async () => {
  // pins_update_own checks pinning_open (time) but not is_published (withdrawn/seed).
  const before = await must(service.from("pins").select("party_total").eq("id", pin["Wes@W"]).single(), "wes");
  await C("Wes").from("pins").update({ party_total: before.party_total === 5 ? 6 : 5 }).eq("id", pin["Wes@W"]);
  const after = await must(service.from("pins").select("party_total").eq("id", pin["Wes@W"]).single(), "wes");
  assert.equal(after.party_total, before.party_total, "Wes changed his party size on a withdrawn gathering (moves the 'pinned' count its pinned people read)");
});
