// The harness's cast and gatherings, built in pind-staging with the service key and
// swept away afterwards. Every row the harness creates is tagged so a sweep can find
// it again, even after a crashed run:
//   - auth users:   email "pindhx-…@example.com", or (anonymous) user_metadata.harness = "pindhx"
//   - people:       instagram_handle "pindhx_…"
//   - gatherings, venues: name "pindhx …"
//   - venue maps:   venue-maps/<harness venue id>/…
//   - moderation log rows: actor "pindhx@example.com"
// Nothing else in staging is touched.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import type { HarnessEnv } from "./env.ts";

export const PREFIX = "pindhx";
export const BUCKET = "photos";
export const MAPS = "venue-maps";
// The admin identity the harness acts as when it calls admin_* functions.
export const ACTOR = `${PREFIX}@example.com`;

// A 1×1 PNG.
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

type Gender = "woman" | "man" | "nonbinary" | "undisclosed";
type PhotoStatus = "approved" | "pending" | "rejected";

interface Result {
  data: any;
  error: { message: string; code?: string } | null;
}

export async function must(query: PromiseLike<Result>, what: string): Promise<any> {
  const { data, error } = await query;
  if (error) throw new Error(`${what}: ${error.code ?? ""} ${error.message}`);
  return data;
}

export function newClient(env: HarnessEnv, key: string): SupabaseClient {
  return createClient(env.url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export interface Member {
  name: string;
  personId: string;
  authId: string | null;
  client: SupabaseClient | null;
  photoPath: string | null;
}

export interface World {
  env: HarnessEnv;
  service: SupabaseClient;
  anon: SupabaseClient;
  run: string;
  venue: string;
  G: string; // published, next week — the main crowd
  H: string; // published — Ben's second gathering; only 2 eligible for women-only
  U: string; // unpublished
  P: string; // published, ended 2 days ago — list closed
  C4: string; // counts: 4 open to meeting
  C5: string; // counts: 5 open, only women and men
  C6: string; // counts: 6 open, two neither woman nor man
  gs: string[]; // G's three spot options
  // M1.2 — drafts and admin
  venue2: string; // only 2 approved spots, 1 pending suggestion: its poll starts with 2 options
  D: { ticketmaster: string; ai: string; manual: string }; // drafts, one per source
  X: string; // dismissed draft
  Dup: string; // draft duplicate of G, found by AI — merged into G in P43
  Q: string; // draft at venue2, 12 days out — the publish-rule case (P42)
  // M1.3 — withdrawn, import and retention
  W: string; // published, 6 days out, withdrawn in P49: Wil and Wyn opted in, Wes pinned only
  Old: string; // published, ended 40 days ago, from Ticketmaster — keeps our record (P53)
  OldDraft: string; // Ticketmaster-only draft, 40 days ago — deleted by the purge (P53)
  hs: string; // H's spot option — moves with H's date (P52)
  m: Record<string, Member>;
  pin: Record<string, string>; // "Dev@G" → pin id
}

// ---------------------------------------------------------------------------
// Sweep: removes everything a harness run (this one or a crashed one) created.
// ---------------------------------------------------------------------------

export async function sweep(service: SupabaseClient): Promise<void> {
  const authIds: string[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`sweep: list users: ${error.message}`);
    for (const u of data.users) {
      if ((u.email ?? "").startsWith(`${PREFIX}-`) || u.user_metadata?.harness === PREFIX) authIds.push(u.id);
    }
    if (data.users.length < 1000) break;
  }

  // Photos live in each user's folder. Before the bucket exists this is a no-op.
  for (const id of authIds) {
    const { data } = await service.storage.from(BUCKET).list(id);
    if (data?.length) await service.storage.from(BUCKET).remove(data.map((f) => `${id}/${f.name}`));
  }

  const personIds = new Set<string>();
  const tagged = await must(
    service.from("people").select("id, instagram_handle").like("instagram_handle", `${PREFIX}%`),
    "sweep: find people",
  );
  for (const p of tagged) if (p.instagram_handle.startsWith(`${PREFIX}_`)) personIds.add(p.id);
  if (authIds.length) {
    const linked = await must(service.from("people").select("id").in("auth_user_id", authIds), "sweep: linked people");
    for (const p of linked) personIds.add(p.id);
  }
  const ids = [...personIds];

  if (ids.length) {
    // Reports outlive their people (FKs set null), so they go first.
    await must(service.from("reports").delete().in("reporter_id", ids), "sweep: reports by");
    await must(service.from("reports").delete().in("target_person_id", ids), "sweep: reports on");
  }
  // The importer logs under its own actor; its rows on harness gatherings go too.
  const harnessGatherings = await must(
    service.from("gatherings").select("id").like("name", `${PREFIX} %`),
    "sweep: find gatherings",
  );
  const gatheringIds = harnessGatherings.map((g: { id: string }) => g.id);
  for (let i = 0; i < gatheringIds.length; i += 100) {
    await must(
      service.from("moderation_log").delete().in("gathering_id", gatheringIds.slice(i, i + 100)),
      "sweep: gathering log",
    );
  }
  // Cascades to pins, spot options, votes, survey responses, group links, sources,
  // AI scores, flags and withdrawals.
  await must(service.from("gatherings").delete().like("name", `${PREFIX} %`), "sweep: gatherings");
  await must(service.from("import_runs").delete().eq("actor", ACTOR), "sweep: import runs");
  if (ids.length) await must(service.from("people").delete().in("id", ids), "sweep: people");

  const venues = await must(service.from("venues").select("id").like("name", `${PREFIX} %`), "sweep: find venues");
  const venueIds = venues.map((v: { id: string }) => v.id);
  for (const id of venueIds) {
    const { data } = await service.storage.from(MAPS).list(id);
    if (data?.length) await service.storage.from(MAPS).remove(data.map((f) => `${id}/${f.name}`));
  }
  // Aliases, external ids and spot suggestions cascade with their venue.
  if (venueIds.length) {
    await must(service.from("meeting_spots").delete().in("venue_id", venueIds), "sweep: meeting spots");
    await must(service.from("venues").delete().in("id", venueIds), "sweep: venues");
  }

  await must(service.from("moderation_log").delete().eq("actor", ACTOR), "sweep: moderation log");

  for (const id of authIds) {
    const { error } = await service.auth.admin.deleteUser(id);
    if (error) throw new Error(`sweep: delete user: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const inDays = (d: number) => new Date(Date.now() + d * DAY).toISOString();

// A signed-in person: an auth user with a session, plus their people rows made by
// the service key (the self-service insert path is exercised by Newt in the tests).
async function signedIn(
  w: World,
  name: string,
  opts: { anonymous?: boolean } = {},
): Promise<{ client: SupabaseClient; authId: string }> {
  const client = newClient(w.env, w.env.publishableKey);
  if (opts.anonymous) {
    const { data, error } = await client.auth.signInAnonymously({ options: { data: { harness: PREFIX } } });
    if (error || !data.user) throw new Error(`anonymous sign-in for ${name}: ${error?.message}`);
    return { client, authId: data.user.id };
  }
  const email = `${PREFIX}-${w.run}-${name.toLowerCase()}@example.com`;
  const password = randomUUID();
  const created = await w.service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`create user ${name}: ${created.error?.message}`);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in ${name}: ${error.message}`);
  return { client, authId: created.data.user.id };
}

export function handleFor(run: string, name: string): string {
  return `${PREFIX}_${run}_${name}`.toLowerCase();
}

async function person(
  w: World,
  name: string,
  spec: {
    gender: Gender;
    womenOnly?: boolean;
    photo?: PhotoStatus;
    session?: boolean;
    anonymous?: boolean;
    hidden?: boolean;
  },
): Promise<Member> {
  let client: SupabaseClient | null = null;
  let authId: string | null = null;
  if (spec.session || spec.anonymous) ({ client, authId } = await signedIn(w, name, { anonymous: spec.anonymous }));

  let photoPath: string | null = null;
  if (spec.photo) {
    if (!authId) throw new Error(`${name}: a photo needs a user folder`);
    photoPath = `${authId}/${name.toLowerCase()}.png`;
    await must(
      w.service.storage.from(BUCKET).upload(photoPath, PNG, { contentType: "image/png" }),
      `upload photo for ${name}`,
    );
  }

  const row = await must(
    w.service
      .from("people")
      .insert({
        auth_user_id: authId,
        first_name: name,
        instagram_handle: handleFor(w.run, name),
        neighbourhood: "king-west",
        photo_path: photoPath,
        photo_status: spec.photo ?? "pending",
        hidden_at: spec.hidden ? new Date().toISOString() : null,
      })
      .select("id")
      .single(),
    `insert person ${name}`,
  );
  await must(
    w.service.from("people_private").insert({
      person_id: row.id,
      gender: spec.gender,
      include_in_women_only: spec.womenOnly ?? false,
      birth_year: 1995,
    }),
    `insert private row for ${name}`,
  );
  const member: Member = { name, personId: row.id, authId, client, photoPath };
  w.m[name] = member;
  return member;
}

async function pinIn(w: World, name: string, gathering: string, key: string, open: boolean, partyTotal = 1) {
  const row = await must(
    w.service
      .from("pins")
      .insert({ gathering_id: gathering, person_id: w.m[name]!.personId, open_to_meeting: open, party_total: partyTotal })
      .select("id")
      .single(),
    `pin ${name} at ${key}`,
  );
  w.pin[`${name}@${key}`] = row.id;
}

async function gathering(
  w: World,
  label: string,
  startsInDays: number,
  published: boolean,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const row = await must(
    w.service
      .from("gatherings")
      .insert({
        name: `${PREFIX} ${w.run} ${label}`,
        starts_at: inDays(startsInDays),
        venue_id: w.venue,
        published_at: published ? new Date().toISOString() : null,
        ...extra,
      })
      .select("id")
      .single(),
    `insert gathering ${label}`,
  );
  return row.id;
}

export async function buildWorld(env: HarnessEnv): Promise<World> {
  const service = newClient(env, env.secretKey);
  await sweep(service);
  try {
    return await populate(env, service);
  } catch (error) {
    // A half-built world must not outlive a failed setup.
    await sweep(service);
    throw error;
  }
}

async function populate(env: HarnessEnv, service: SupabaseClient): Promise<World> {
  const w = {
    env,
    service,
    anon: newClient(env, env.publishableKey),
    run: randomBytes(3).toString("hex"),
    m: {},
    pin: {},
  } as World;

  // Places and gatherings.
  w.venue = (
    await must(service.from("venues").insert({ name: `${PREFIX} ${w.run} Arena` }).select("id").single(), "venue")
  ).id;
  const spots = await must(
    service
      .from("meeting_spots")
      .insert(["North Gate", "Patio Bar", "Statue"].map((name) => ({ venue_id: w.venue, name })))
      .select("id"),
    "meeting spots",
  );
  w.G = await gathering(w, "G", 7, true);
  w.H = await gathering(w, "H", 8, true);
  w.U = await gathering(w, "U", 9, false);
  w.P = await gathering(w, "P", -2, true);
  w.C4 = await gathering(w, "C4", 10, true);
  w.C5 = await gathering(w, "C5", 10, true);
  w.C6 = await gathering(w, "C6", 10, true);

  const gs = await must(
    service
      .from("gathering_spots")
      .insert(spots.map((s: { id: string }, i: number) => ({ gathering_id: w.G, spot_id: s.id, meet_at: inDays(7 - i / 24) })))
      .select("id"),
    "G spot options",
  );
  w.gs = gs.map((r: { id: string }) => r.id);
  await must(
    service.from("gathering_spots").insert({ gathering_id: w.U, spot_id: spots[0].id, meet_at: inDays(9) }),
    "U spot option",
  );

  // The cast at G (all signed in). Cal and Newt use real anonymous sign-in.
  await person(w, "Ava", { gender: "woman", photo: "approved", session: true });
  await person(w, "Ben", { gender: "man", session: true });
  await person(w, "Cal", { gender: "man", anonymous: true });
  await person(w, "Dee", { gender: "nonbinary", womenOnly: true, photo: "approved", session: true });
  await person(w, "Nia", { gender: "nonbinary", session: true });
  await person(w, "Eve", { gender: "woman", photo: "pending", session: true });
  await person(w, "Rex", { gender: "man", photo: "rejected", session: true });
  await person(w, "Gus", { gender: "man", photo: "approved", session: true });
  await person(w, "Hal", { gender: "man", session: true });
  await person(w, "Dev", { gender: "man", session: true });
  await person(w, "Ivy1", { gender: "man", session: true });
  await person(w, "Ivy2", { gender: "man", session: true });
  await person(w, "Bo", { gender: "man", photo: "approved", session: true });
  await person(w, "Oli", { gender: "man", session: true });
  await person(w, "Wen", { gender: "woman", session: true });
  // H and P.
  await person(w, "Hana", { gender: "woman", session: true });
  await person(w, "Hope", { gender: "woman" });
  await person(w, "Pam", { gender: "woman", session: true });
  await person(w, "Pat", { gender: "man" });

  for (const name of ["Ava", "Ben", "Dee", "Nia", "Eve", "Rex", "Gus", "Hal", "Ivy1", "Ivy2", "Bo", "Oli"]) {
    await pinIn(w, name, w.G, "G", true);
  }
  await pinIn(w, "Dev", w.G, "G", true, 3);
  await pinIn(w, "Cal", w.G, "G", false);
  await pinIn(w, "Wen", w.G, "G", false);
  await pinIn(w, "Ben", w.H, "H", true);
  await pinIn(w, "Hana", w.H, "H", true);
  await pinIn(w, "Hope", w.H, "H", true);
  await pinIn(w, "Pam", w.P, "P", true);
  await pinIn(w, "Pat", w.P, "P", true);

  // Count fixtures: people without sessions.
  // C4: pinned 3+1+1+1+1+1 = 8; open 4 (m3 not open, m4 hidden; w1's +2 never count as open).
  await person(w, "c4w1", { gender: "woman" });
  await person(w, "c4w2", { gender: "woman" });
  await person(w, "c4m1", { gender: "man" });
  await person(w, "c4m2", { gender: "man" });
  await person(w, "c4m3", { gender: "man" });
  await person(w, "c4m4", { gender: "man", hidden: true });
  await pinIn(w, "c4w1", w.C4, "C4", true, 3);
  for (const n of ["c4w2", "c4m1", "c4m2", "c4m4"]) await pinIn(w, n, w.C4, "C4", true);
  await pinIn(w, "c4m3", w.C4, "C4", false);
  // C5: 3 women, 2 men.
  for (const n of ["c5w1", "c5w2", "c5w3"]) await person(w, n, { gender: "woman" });
  for (const n of ["c5m1", "c5m2"]) await person(w, n, { gender: "man" });
  for (const n of ["c5w1", "c5w2", "c5w3", "c5m1", "c5m2"]) await pinIn(w, n, w.C5, "C5", true);
  // C6: 2 women, 2 men, 1 prefer not to say, 1 nonbinary.
  for (const n of ["c6w1", "c6w2"]) await person(w, n, { gender: "woman" });
  for (const n of ["c6m1", "c6m2"]) await person(w, n, { gender: "man" });
  await person(w, "c6u1", { gender: "undisclosed" });
  await person(w, "c6n1", { gender: "nonbinary" });
  for (const n of ["c6w1", "c6w2", "c6m1", "c6m2", "c6u1", "c6n1"]) await pinIn(w, n, w.C6, "C6", true);

  // Rows that must exist so "cannot read" proves something.
  const ben = w.m.Ben!.personId;
  await must(service.from("contact_points").insert({ person_id: ben, kind: "email", value: "ben@example.com" }), "contact");
  await must(
    service.from("spot_votes").insert({ gathering_id: w.G, gathering_spot_id: w.gs[0], person_id: ben }),
    "Ben's vote",
  );
  await must(
    service.from("survey_responses").insert({ gathering_id: w.G, person_id: ben, met: "none", would_have_gone: "yes" }),
    "Ben's survey",
  );
  await must(
    service.from("pin_friends").insert([
      {
        pin_id: w.pin["Dev@G"],
        claim_token_hash: `${PREFIX}-${randomUUID()}`,
        first_name: "Rohan",
        age_attested_at: new Date().toISOString(),
        claimed_at: new Date().toISOString(),
      },
      { pin_id: w.pin["Dev@G"], claim_token_hash: `${PREFIX}-${randomUUID()}` },
    ]),
    "Dev's +1s",
  );
  await must(
    service.from("gathering_group_links").insert([
      { gathering_id: w.G, kind: "everyone", url: "https://chat.whatsapp.com/pindhx-everyone" },
      { gathering_id: w.G, kind: "women_only", url: "https://chat.whatsapp.com/pindhx-women" },
      { gathering_id: w.H, kind: "women_only", url: "https://chat.whatsapp.com/pindhx-h-women" },
    ]),
    "group links",
  );
  await must(
    service.from("blocks").insert({ blocker_id: w.m.c4m1!.personId, blocked_id: w.m.c4m2!.personId }),
    "fixture block",
  );
  await must(
    service.from("reports").insert({
      reporter_id: w.m.c5m1!.personId,
      target_kind: "person",
      target_person_id: w.m.c5m2!.personId,
      reason: "spam",
    }),
    "fixture report",
  );
  await must(
    service.from("magic_links").insert({
      token_hash: `${PREFIX}-${randomUUID()}`,
      person_id: ben,
      gathering_id: w.G,
      expires_at: inDays(1),
    }),
    "magic link",
  );
  await must(
    service.from("outbound_messages").insert({ gathering_id: w.G, person_id: ben, kind: "threshold", channel: "email" }),
    "outbound message",
  );

  // M1.2 — drafts from each source, a dismissed draft, a duplicate, and a venue that
  // cannot take a published gathering yet.
  w.venue2 = (
    await must(service.from("venues").insert({ name: `${PREFIX} ${w.run} Hall` }).select("id").single(), "venue2")
  ).id;
  await must(
    service.from("meeting_spots").insert(["Box Office", "Coat Check"].map((name) => ({ venue_id: w.venue2, name }))),
    "venue2 spots",
  );
  await must(
    service.from("spot_suggestions").insert({ venue_id: w.venue2, name: "Front Steps", reason: "pindhx suggestion" }),
    "venue2 suggestion",
  );
  await must(service.from("venue_aliases").insert({ venue_id: w.venue2, alias: `${PREFIX} ${w.run} The Hall` }), "alias");
  await must(
    service.from("venue_external_ids").insert({ venue_id: w.venue2, source: "ticketmaster", external_id: `${PREFIX}-${w.run}-v2` }),
    "venue external id",
  );
  w.D = {
    ticketmaster: await gathering(w, "D-tm", 11, false, { source: "ticketmaster" }),
    ai: await gathering(w, "D-ai", 11, false, { source: "ai", is_free: true }),
    manual: await gathering(w, "D-manual", 11, false, { source: "manual" }),
  };
  w.X = await gathering(w, "X", 11, false, { source: "ai", dismissed_at: new Date().toISOString() });
  w.Dup = await gathering(w, "Dup", 7, false, { source: "ai", event_url: "https://example.com/pindhx-dup" });
  w.Q = await gathering(w, "Q", 12, false, { venue_id: w.venue2 });
  await must(
    service.from("gathering_sources").insert([
      { gathering_id: w.D.ticketmaster, source: "ticketmaster", external_id: `${PREFIX}-${w.run}-tm1`, urls: ["https://example.com/tm1"] },
      { gathering_id: w.D.ai, source: "ai", urls: ["https://example.com/ai1"] },
      { gathering_id: w.Dup, source: "ai", external_id: `${PREFIX}-${w.run}-dup`, urls: ["https://example.com/dup"] },
    ]),
    "gathering sources",
  );
  await must(
    service.from("gathering_triage").insert([
      { gathering_id: w.D.ai, score: 72, reason: "pindhx: free market, big crowd" },
      { gathering_id: w.Dup, score: 60, reason: "pindhx: duplicate" },
    ]),
    "triage",
  );
  // A draft may already have spot options chosen; they stay private until publish.
  await must(
    service.from("gathering_spots").insert({ gathering_id: w.D.ai, spot_id: spots[0].id, meet_at: inDays(11) }),
    "draft spot option",
  );
  await must(
    service.from("gathering_group_links").insert({ gathering_id: w.D.ai, kind: "everyone", url: "https://chat.whatsapp.com/pindhx-draft" }),
    "draft group link",
  );

  // M1.3 — W is withdrawn in P49 (its own cast, so earlier cases are untouched); Old
  // and OldDraft are for the retention purge; H gets a spot option that must move
  // when a new date is applied.
  w.W = await gathering(w, "W", 6, true);
  await must(
    service
      .from("gathering_spots")
      .insert(spots.map((s: { id: string }) => ({ gathering_id: w.W, spot_id: s.id, meet_at: inDays(6 - 1 / 24) }))),
    "W spot options",
  );
  await must(
    service.from("gathering_group_links").insert({ gathering_id: w.W, kind: "everyone", url: "https://chat.whatsapp.com/pindhx-w" }),
    "W group link",
  );
  await person(w, "Wil", { gender: "woman", session: true });
  await person(w, "Wyn", { gender: "man", session: true });
  await person(w, "Wes", { gender: "man", session: true });
  await pinIn(w, "Wil", w.W, "W", true);
  await pinIn(w, "Wyn", w.W, "W", true);
  await pinIn(w, "Wes", w.W, "W", false);

  const hs = await must(
    service.from("gathering_spots").insert({ gathering_id: w.H, spot_id: spots[1].id, meet_at: inDays(8 - 1 / 24) }).select("id").single(),
    "H spot option",
  );
  w.hs = hs.id;

  w.Old = await gathering(w, "Old", -40, true, { source: "ticketmaster", event_url: "https://www.ticketmaster.ca/event/pindhx-old" });
  w.OldDraft = await gathering(w, "OldDraft", -40, false, { source: "ticketmaster" });
  await must(
    service.from("gathering_sources").insert([
      { gathering_id: w.Old, source: "ticketmaster", external_id: `${PREFIX}-${w.run}-old`, urls: ["https://www.ticketmaster.ca/event/pindhx-old"] },
      { gathering_id: w.OldDraft, source: "ticketmaster", external_id: `${PREFIX}-${w.run}-olddraft`, urls: [] },
    ]),
    "old sources",
  );

  return w;
}
