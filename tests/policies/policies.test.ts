// Policy harness — Phase 1 M1.1. Run with `npm run test:policies`.
//
// Every case is an approved "X CAN / X CANNOT" pair from docs/visibility.md, numbered
// P01–P61, with the rule it proves (V1–V18). P38–P47 arrive with M1.2 (admin); P48–P54
// with M1.3 (import, flags, withdrawn); P55–P61 with M2.1 (seed rows, and the one door
// the public web reads through). Each person queries with their own
// session through the same REST and Storage APIs the Worker uses, so what passes
// here is what RLS lets through. The service key only builds and sweeps the world.
//
// Cases run in order: later cases change the world (blocks, removed pins, reports).

import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "./env.ts";
import { optInMissing } from "../../packages/shared/src/optin.ts";
import { MY_EVENTS_PINS_SELECT } from "../../packages/shared/src/myevents.ts";
import { photoDest } from "../../src/account/merge-checks.ts";
import { ACTOR, BUCKET, MAPS, PNG, PREFIX, buildWorld, handleFor, markHarness, newClient, sweep, type Member, type World, removeUser, accountlessPeople } from "./world.ts";

interface Result {
  data: any;
  error: { message: string; code?: string } | null;
}

async function ok(query: PromiseLike<Result>, what = "query"): Promise<any> {
  const { data, error } = await query;
  if (error) assert.fail(`${what} failed: ${error.code ?? ""} ${error.message}`);
  return data;
}

// The call must fail. With a code, it must fail for that reason.
async function denied(query: PromiseLike<Result>, code?: string): Promise<void> {
  const { error } = await query;
  assert.ok(error, "expected the call to be refused, but it succeeded");
  if (code) assert.equal(error.code, code, error.message);
}

// No privilege at all on the table: the database refuses the read outright.
async function noAccess(client: SupabaseClient, table: string): Promise<void> {
  const { error } = await client.from(table).select("*").limit(1);
  assert.ok(error, `${table}: read was allowed`);
  assert.equal(error.code, "42501", `${table}: ${error.message}`);
}

async function rows(query: PromiseLike<Result>): Promise<any[]> {
  return (await ok(query)) as any[];
}

function c(m: Member | undefined): SupabaseClient {
  assert.ok(m?.client, "member has no session");
  return m.client;
}

let w: World;
const M = (name: string): Member => {
  const m = w.m[name];
  assert.ok(m, `no member ${name}`);
  return m;
};
const id = (name: string) => M(name).personId;

// Rows of `people` the client can read for these people.
async function seesPeople(client: SupabaseClient, ...names: string[]): Promise<number> {
  return (await rows(client.from("people").select("id").in("id", names.map(id)))).length;
}

async function seesPins(client: SupabaseClient, name: string, gathering: string): Promise<number> {
  return (await rows(client.from("pins").select("id").eq("person_id", id(name)).eq("gathering_id", gathering))).length;
}

async function counts(client: SupabaseClient, gathering: string): Promise<any> {
  const data = await rows(client.rpc("gathering_counts", { gathering_ids: [gathering] }));
  assert.equal(data.length, 1, "expected one counts row");
  return data[0];
}

function sign(client: SupabaseClient, path: string | null) {
  assert.ok(path, "member has no photo");
  return client.storage.from(BUCKET).createSignedUrl(path, 300);
}

async function canSign(client: SupabaseClient, path: string | null): Promise<void> {
  const { data, error } = await sign(client, path);
  assert.equal(error, null, `signed URL refused: ${error?.message}`);
  assert.ok(data?.signedUrl);
}

async function cannotSign(client: SupabaseClient, path: string | null): Promise<void> {
  const { data, error } = await sign(client, path);
  assert.ok(error, `signed URL was issued: ${data?.signedUrl}`);
}

async function offer(client: SupabaseClient, gathering: string): Promise<unknown> {
  return ok(client.rpc("women_only_offer", { p_gathering: gathering }));
}

async function links(client: SupabaseClient, gathering: string, kind: string): Promise<number> {
  return (
    await rows(client.from("gathering_group_links").select("url").eq("gathering_id", gathering).eq("kind", kind))
  ).length;
}

async function poll(client: SupabaseClient, gathering: string): Promise<Map<string, number>> {
  const data = await rows(client.rpc("spot_poll", { p_gathering: gathering }));
  return new Map(data.map((r: { gathering_spot_id: string; votes: number }) => [r.gathering_spot_id, r.votes]));
}

async function serviceRow(table: string, column: string, value: string, select = "*"): Promise<any> {
  return ok(w.service.from(table).select(select).eq(column, value).maybeSingle());
}

let accountlessAtStart = 0;
before(async () => {
  // Counted BEFORE the world is built: the world itself holds people with no account
  // (19 of them, swept at the end), so a count taken after it hid a leftover (6 Oct).
  const env = loadEnv();
  accountlessAtStart = await accountlessPeople(newClient(env, env.secretKey));
  w = await buildWorld(env);
  // P184's firing proof: PIND_P184_FIRE=1 leaves one person with no account behind on
  // purpose, and the check at the end must refuse the run.
  if (process.env.PIND_P184_FIRE === "1") await ok(w.service.from("people").insert({ first_name: "P184 probe" }));
}, { timeout: 300_000 });

// P184 (Alex, 6 Oct 2026): the harness deletes its own people. Checked here, the very
// last thing a run does — after every suite's clean-up and the sweep: a person row left
// with no account is the leftover that made the photo sweep fail every hour.
after(async () => {
  if (!w) return;
  await sweep(w.service);
  const now = await accountlessPeople(w.service);
  console.log(`P184: people with no account — ${accountlessAtStart} at the start, ${now} at the end`);
  assert.ok(now <= accountlessAtStart, `P184: this run left ${now - accountlessAtStart} person rows with no account behind (${accountlessAtStart} → ${now})`);
}, { timeout: 300_000 });

describe("Public data — V2, V11", () => {
  it("P01 anon CAN read published G, its venue, spots and spot options / CANNOT read unpublished U or its spot options", async () => {
    assert.equal((await rows(w.anon.from("gatherings").select("id").eq("id", w.G))).length, 1);
    assert.equal((await rows(w.anon.from("venues").select("id").eq("id", w.venue))).length, 1);
    assert.equal((await rows(w.anon.from("meeting_spots").select("id").eq("venue_id", w.venue))).length, 3);
    assert.equal((await rows(w.anon.from("gathering_spots").select("id").eq("gathering_id", w.G))).length, 3);
    assert.ok(await serviceRow("gatherings", "id", w.U), "U exists");
    assert.equal((await rows(w.anon.from("gatherings").select("id").eq("id", w.U))).length, 0);
    assert.equal((await rows(w.anon.from("gathering_spots").select("id").eq("gathering_id", w.U))).length, 0);
  });

  it("P02 anon CAN get G's counts / the result holds numbers only, no ids or names; U has no counts", async () => {
    const row = await counts(w.anon, w.G);
    assert.deepEqual(Object.keys(row).sort(), ["crews_open", "gathering_id", "men", "open_to_meeting", "other", "pinned", "women"]);
    assert.equal(row.gathering_id, w.G);
    for (const k of ["pinned", "open_to_meeting", "women", "men"]) assert.equal(typeof row[k], "number", k);
    assert.equal((await rows(w.anon.rpc("gathering_counts", { gathering_ids: [w.U] }))).length, 0);
  });

  it("P03 anon CANNOT read any person table, group links, blocks, reports, surveys, magic links or outbound messages / CANNOT write", async () => {
    for (const t of [
      "people", "people_private", "pins", "pin_friends", "contact_points", "spot_votes",
      "gathering_group_links", "blocks", "reports", "survey_responses", "magic_links", "outbound_messages",
    ]) {
      await noAccess(w.anon, t);
    }
    await denied(w.anon.from("pins").insert({ gathering_id: w.G, person_id: id("Ava") }), "42501");
    await denied(w.anon.from("people").insert({ first_name: "Anon" }), "42501");
    await denied(w.anon.rpc("women_only_offer", { p_gathering: w.G }));
    await denied(w.anon.rpc("spot_poll", { p_gathering: w.G }));
  });

  it("P04 a signed-in user CANNOT read or write any locked app table", async () => {
    const ava = c(M("Ava"));
    // `tags` and `person_tags` left this list in M3.1: the vocabulary is public
    // reference data like `neighbourhoods`, and a person's own tags are theirs.
    // P74–P77 are the cases that replaced them.
    for (const t of ["confirmations", "connections", "connection_invites", "magic_links", "outbound_messages"]) {
      await noAccess(ava, t);
    }
    // The group tables opened in M3.3 behind their own rules (P149–P158): someone in no
    // group reads nothing from them, and nobody creates a group except through
    // start_group.
    for (const t of ["crews", "crew_members", "crew_proposals", "crew_proposal_votes", "crew_messages", "crew_invites"]) {
      assert.deepEqual(await rows(ava.from(t).select("*").limit(1)), [], `${t}: someone in no group read a row`);
    }
    await denied(ava.from("crews").insert({ gathering_id: w.G }), "42501");
    await denied(ava.from("connections").insert({ person_a: id("Ava"), person_b: id("Ben") }), "42501");
  });
});

describe("Counts and mix — V2, V3", () => {
  it("P05 pinned includes +1s and hidden people / open to meeting excludes +1s and hidden people", async () => {
    const row = await counts(w.anon, w.C4);
    assert.equal(row.pinned, 8);
    assert.equal(row.open_to_meeting, 4);
    assert.equal(row.crews_open, false);
  });

  it("P06 mix is empty at 4 open / at 5+ shows women and men, other absent at 0 and present at 1+, and the three sum to open", async () => {
    const c4 = await counts(w.anon, w.C4);
    assert.equal(c4.women, null);
    assert.equal(c4.men, null);
    assert.equal(c4.other, null);

    const c5 = await counts(w.anon, w.C5);
    assert.equal(c5.open_to_meeting, 5);
    assert.equal(c5.women, 3);
    assert.equal(c5.men, 2);
    assert.equal(c5.other, null);
    assert.equal(c5.crews_open, true);
    assert.equal(c5.women + c5.men + (c5.other ?? 0), c5.open_to_meeting);

    const c6 = await counts(w.anon, w.C6);
    assert.equal(c6.open_to_meeting, 6);
    assert.equal(c6.women, 2);
    assert.equal(c6.men, 2);
    assert.equal(c6.other, 2);
    assert.equal(c6.women + c6.men + c6.other, c6.open_to_meeting);
  });
});

describe("Own rows — V1 writes", () => {
  let newt: { client: SupabaseClient; authId: string; personId: string };

  it("P07 an anonymous visitor CAN create their own person, private row, pin, contact and photo / CANNOT act for anyone else or set moderation fields", async () => {
    const client = newClient(w.env, w.env.publishableKey);
    const { data, error } = await client.auth.signInAnonymously({ options: { data: { harness: "pindhx" } } });
    assert.equal(error, null, error?.message);
    assert.ok(data.user?.is_anonymous, "session is anonymous");
    const authId = data.user!.id;
    await markHarness(w.service, authId);
    const path = `${authId}/newt.png`;

    await ok(client.storage.from(BUCKET).upload(path, PNG, { contentType: "image/png" }), "upload own photo");
    const person = await ok(
      client
        .from("people")
        .insert({ auth_user_id: authId, first_name: "Newt", photo_path: path })
        .select("id")
        .single(),
      "insert own person",
    );
    // Read by the service key: since M4.2/Q37 the status is not a column a person reads.
    assert.equal((await rows(w.service.from("people").select("photo_status").eq("id", person.id)))[0]?.photo_status, "pending");
    newt = { client, authId, personId: person.id };
    await ok(client.from("people_private").insert({ person_id: person.id, gender: "man", birth_year: 1996 }), "private row");
    await ok(client.from("pins").insert({ gathering_id: w.G, person_id: person.id, open_to_meeting: false }), "own pin");
    await ok(client.from("contact_points").insert({ person_id: person.id, kind: "email", value: "newt@example.com" }), "contact");

    // Not for anyone else.
    await denied(
      client.from("people").insert({ auth_user_id: M("Ava").authId, first_name: "Fake" }),
      "42501",
    );
    await denied(client.from("people").insert({ auth_user_id: authId, first_name: "Twice" }));
    await denied(client.from("pins").insert({ gathering_id: w.H, person_id: id("Ava") }), "42501");
    await denied(client.from("people_private").insert({ person_id: id("Hope"), gender: "woman" }), "42501");
    await denied(client.from("contact_points").insert({ person_id: id("Ava"), kind: "sms", value: "+15555550100" }), "42501");

    // Never moderation fields.
    await denied(client.from("people").update({ photo_status: "approved" }).eq("id", person.id), "42501");
    await denied(client.from("people").update({ hidden_at: new Date().toISOString() }).eq("id", person.id), "42501");
    await denied(
      client.from("people").insert({ first_name: "Hid", hidden_at: new Date().toISOString() }),
      "42501",
    );
    // A photo path outside their own folder.
    await denied(client.from("people").update({ photo_path: M("Ava").photoPath }).eq("id", person.id), "42501");
  });

  it("P07b changing a photo sends it back to pending moderation (V6)", async () => {
    await ok(w.service.from("people").update({ photo_status: "approved" }).eq("id", newt.personId));
    const path2 = `${newt.authId}/newt2.png`;
    await ok(newt.client.storage.from(BUCKET).upload(path2, PNG, { contentType: "image/png" }));
    await ok(newt.client.from("people").update({ photo_path: path2 }).eq("id", newt.personId));
    const row = await serviceRow("people", "id", newt.personId, "photo_status");
    assert.equal(row.photo_status, "pending");
  });

  it("P08 a user CANNOT pin to unpublished U", async () => {
    await denied(newt.client.from("pins").insert({ gathering_id: w.U, person_id: newt.personId }), "42501");
  });

  it("P09 Ava CAN read her own private row / CANNOT read Ben's, even though she can see Ben", async () => {
    const ava = c(M("Ava"));
    assert.equal((await rows(ava.from("people_private").select("gender").eq("person_id", id("Ava")))).length, 1);
    assert.equal(await seesPeople(ava, "Ben"), 1);
    assert.equal((await rows(ava.from("people_private").select("gender").eq("person_id", id("Ben")))).length, 0);
    assert.equal((await rows(ava.from("people_private").select("person_id"))).length, 1);
  });

  it("P10 Ava CANNOT read anyone's contact details / CANNOT edit or delete Ben's pin or person", async () => {
    const ava = c(M("Ava"));
    assert.equal((await rows(ava.from("contact_points").select("id").eq("person_id", id("Ben")))).length, 0);
    await ava.from("pins").update({ party_total: 9 }).eq("id", w.pin["Ben@G"]);
    await ava.from("pins").delete().eq("id", w.pin["Ben@G"]);
    await ava.from("people").update({ first_name: "Hacked" }).eq("id", id("Ben"));
    const pin = await serviceRow("pins", "id", w.pin["Ben@G"]!, "party_total");
    assert.ok(pin, "Ben's pin still exists");
    assert.equal(pin.party_total, 1);
    assert.equal((await serviceRow("people", "id", id("Ben"), "first_name")).first_name, "Ben");
  });
});

describe("Reciprocal reveal — V1", () => {
  it("P11 Ava CAN see Ben's name, neighbourhood and pin at G — but NOT his handle (V17) / Cal (not opted in) CANNOT see Ava or Ben", async () => {
    const ava = c(M("Ava"));
    const ben = await rows(ava.from("people").select("first_name, neighbourhood").eq("id", id("Ben")));
    assert.equal(ben.length, 1);
    assert.equal(ben[0].first_name, "Ben");
    assert.equal(ben[0].neighbourhood, "king-west");
    // Until M3.1 the handle was a column on this row and came back with it. The open
    // list is not enough for a handle (V17); P67 is the case that proves it.
    assert.equal(await rows(ava.from("person_handles").select("instagram").eq("person_id", id("Ben"))).then((r) => r.length), 0);
    assert.equal(await seesPins(ava, "Ben", w.G), 1);

    const cal = c(M("Cal"));
    assert.equal(await seesPeople(cal, "Ava", "Ben"), 0);
    assert.equal((await rows(cal.from("pins").select("id").eq("gathering_id", w.G).neq("person_id", id("Cal")))).length, 0);
  });

  it("P12 Ava CANNOT see Cal, who is pinned but not opted in", async () => {
    const ava = c(M("Ava"));
    assert.equal(await seesPeople(ava, "Cal"), 0);
    assert.equal(await seesPins(ava, "Cal", w.G), 0);
  });

  it("P13 Ava CANNOT see Ben's pin at H / Hana (at H only) CANNOT see anyone at G", async () => {
    const ava = c(M("Ava"));
    const benPins = await rows(ava.from("pins").select("gathering_id").eq("person_id", id("Ben")));
    assert.deepEqual(benPins.map((p) => p.gathering_id), [w.G]);
    assert.equal(await seesPins(ava, "Ben", w.H), 0);

    const hana = c(M("Hana"));
    assert.equal(await seesPeople(hana, "Ava", "Dee"), 0);
    assert.equal((await rows(hana.from("pins").select("id").eq("gathering_id", w.G))).length, 0);
    assert.equal(await seesPeople(hana, "Ben"), 1, "Hana sees Ben through H");
  });
});

describe("One-way block — V4", () => {
  let countsBefore: any;

  it("P14 Gus blocks Hal: Gus CANNOT see Hal / Hal CANNOT see Gus — person, pin or photo", async () => {
    const gus = c(M("Gus"));
    const hal = c(M("Hal"));
    assert.equal(await seesPeople(hal, "Gus"), 1, "baseline: Hal sees Gus");
    await canSign(hal, M("Gus").photoPath);
    countsBefore = await counts(w.anon, w.G);

    await ok(gus.from("blocks").insert({ blocker_id: id("Gus"), blocked_id: id("Hal") }), "block");

    assert.equal(await seesPeople(gus, "Hal"), 0);
    assert.equal(await seesPins(gus, "Hal", w.G), 0);
    assert.equal(await seesPeople(hal, "Gus"), 0);
    assert.equal(await seesPins(hal, "Gus", w.G), 0);
    await cannotSign(hal, M("Gus").photoPath);
  });

  it("P15 Hal CANNOT read the block row / Gus CAN read his own block row", async () => {
    assert.equal((await rows(c(M("Hal")).from("blocks").select("*"))).length, 0);
    const own = await rows(c(M("Gus")).from("blocks").select("blocked_id"));
    assert.deepEqual(own.map((b) => b.blocked_id), [id("Hal")]);
  });

  it("P16 Ava CAN still see both Gus and Hal / G's counts are unchanged by the block", async () => {
    const ava = c(M("Ava"));
    assert.equal(await seesPeople(ava, "Gus", "Hal"), 2);
    await canSign(ava, M("Gus").photoPath);
    assert.deepEqual(await counts(w.anon, w.G), countsBefore);
  });
});

describe("Women-only — V5", () => {
  it("P17 Ava and Dee CAN see the offer and the link, never a number / Ben, Nia and Cal CANNOT see either", async () => {
    for (const name of ["Ava", "Dee"]) {
      const result = await offer(c(M(name)), w.G);
      assert.equal(result, true, `${name} offer`);
      assert.equal(typeof result, "boolean");
      assert.equal(await links(c(M(name)), w.G, "women_only"), 1, `${name} link`);
    }
    for (const name of ["Ben", "Nia", "Cal"]) {
      assert.equal(await offer(c(M(name)), w.G), false, `${name} offer`);
      assert.equal(await links(c(M(name)), w.G, "women_only"), 0, `${name} link`);
    }
  });

  it("P18 an eligible woman pinned but not opted in (Wen) CANNOT see the offer or the link", async () => {
    assert.equal(await offer(c(M("Wen")), w.G), false);
    assert.equal(await links(c(M("Wen")), w.G, "women_only"), 0);
  });

  it("P19 with only 2 eligible opted in at H, eligible Hana CANNOT see the offer or the link", async () => {
    assert.ok(await serviceRow("gathering_group_links", "url", "https://chat.whatsapp.com/pindhx-h-women"), "link exists");
    assert.equal(await offer(c(M("Hana")), w.H), false);
    assert.equal(await links(c(M("Hana")), w.H, "women_only"), 0);
  });

  it("P20 opted-in people CAN read the main WhatsApp link / Cal and anon CANNOT", async () => {
    assert.equal(await links(c(M("Ava")), w.G, "everyone"), 1);
    assert.equal(await links(c(M("Ben")), w.G, "everyone"), 1);
    assert.equal(await links(c(M("Cal")), w.G, "everyone"), 0);
    await noAccess(w.anon, "gathering_group_links");
  });
});

describe("Removing a pin — V8", () => {
  it("P21 Bo removes his pin: Ava CANNOT see him (person, pin, photo) / Bo CANNOT see Ava / his vote stops counting / counts drop", async () => {
    const ava = c(M("Ava"));
    const bo = c(M("Bo"));
    assert.equal(await seesPeople(ava, "Bo"), 1, "baseline");
    await canSign(ava, M("Bo").photoPath);
    await ok(bo.from("spot_votes").insert({ gathering_id: w.G, gathering_spot_id: w.gs[2], person_id: id("Bo") }), "Bo votes");
    const pollBefore = await poll(ava, w.G);
    const countsBefore = await counts(w.anon, w.G);

    await ok(bo.from("pins").delete().eq("id", w.pin["Bo@G"]), "Bo removes his pin");
    assert.equal(await serviceRow("pins", "id", w.pin["Bo@G"]!), null, "pin is gone");

    assert.equal(await seesPeople(ava, "Bo"), 0);
    assert.equal(await seesPins(ava, "Bo", w.G), 0);
    await cannotSign(ava, M("Bo").photoPath);
    assert.equal(await seesPeople(bo, "Ava"), 0);
    assert.equal((await poll(ava, w.G)).get(w.gs[2]!), pollBefore.get(w.gs[2]!)! - 1);
    const countsAfter = await counts(w.anon, w.G);
    assert.equal(countsAfter.open_to_meeting, countsBefore.open_to_meeting - 1);
    assert.equal(countsAfter.pinned, countsBefore.pinned - 1);
  });

  it("P22 Oli switches opt-in off: Ava CANNOT see him / Oli CANNOT see Ava", async () => {
    const oli = c(M("Oli"));
    assert.equal(await seesPeople(c(M("Ava")), "Oli"), 1, "baseline");
    await ok(oli.from("pins").update({ open_to_meeting: false }).eq("id", w.pin["Oli@G"]), "Oli opts out");
    assert.equal(await seesPeople(c(M("Ava")), "Oli"), 0);
    assert.equal(await seesPins(c(M("Ava")), "Oli", w.G), 0);
    assert.equal(await seesPeople(oli, "Ava"), 0);
  });
});

describe("Photos — V6", () => {
  // **Inverted in M3.1, "nothing waits on the check" (Alex):** a photo nobody has
  // checked yet is visible to whoever can see its owner. It used to be hidden until
  // approved, so every pipeline failure meant "invisible, and nobody knows".
  it("P23 Ava CAN get Dee's approved photo / CAN get Eve's pending photo — nothing waits on the check / Eve CAN get her own / Cal, who cannot see Eve, still CANNOT", async () => {
    await canSign(c(M("Ava")), M("Dee").photoPath);
    assert.equal(await seesPeople(c(M("Ava")), "Eve"), 1, "Eve herself is visible");
    assert.equal(
      (await serviceRow("people", "id", M("Eve").personId, "photo_status")).photo_status,
      "pending",
      "Eve's photo is not pending, so this case proves nothing",
    );
    await canSign(c(M("Ava")), M("Eve").photoPath);
    await canSign(c(M("Eve")), M("Eve").photoPath);
    // The other side: visibility is still V1's. Somebody who cannot see Eve gets nothing.
    assert.equal(await seesPeople(c(M("Cal")), "Eve"), 0, "Cal can see Eve, so this half proves nothing");
    await cannotSign(c(M("Cal")), M("Eve").photoPath);
  });

  it("P24 Ava CANNOT get Rex's rejected photo / CAN still see Rex himself, without a photo and without a handle", async () => {
    await cannotSign(c(M("Ava")), M("Rex").photoPath);
    const rex = await rows(c(M("Ava")).from("people").select("first_name").eq("id", id("Rex")));
    assert.equal(rex.length, 1, "a rejected photo must never hide the person (V6)");
    // Since M4.2/Q37 (10 Oct 2026): WHY the photo is gone is not Ava's to read.
    await denied(c(M("Ava")).from("people").select("photo_status").eq("id", id("Rex")), "42501");
    assert.equal(await rows(c(M("Ava")).from("person_handles").select("instagram").eq("person_id", id("Rex"))).then((r) => r.length), 0);
  });

  it("P25 guessing the URL: Cal and anon CANNOT get Ava's photo by its exact path / the public URL returns nothing", async () => {
    const path = M("Ava").photoPath!;
    await cannotSign(c(M("Cal")), path);
    await cannotSign(w.anon, path);
    const download = await w.anon.storage.from(BUCKET).download(path);
    assert.ok(download.error, "anon download was allowed");

    const publicUrl = w.anon.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    const res = await fetch(publicUrl);
    assert.notEqual(res.status, 200, "public URL served the photo");
    const authUrl = `${w.env.url}/storage/v1/object/authenticated/${BUCKET}/${path}`;
    const res2 = await fetch(authUrl, { headers: { apikey: w.env.publishableKey } });
    assert.notEqual(res2.status, 200, "object served without a session");

    // A legitimate signed URL does work, so the refusals above mean something.
    const { data } = await sign(c(M("Dee")), path);
    assert.equal((await fetch(data!.signedUrl)).status, 200);
  });

  it("P26 Ben CANNOT upload into, overwrite or delete files in Ava's folder", async () => {
    const ben = c(M("Ben"));
    const ava = M("Ava");
    const folder = ava.authId!;
    const up = await ben.storage.from(BUCKET).upload(`${folder}/intruder.png`, PNG, { contentType: "image/png" });
    assert.ok(up.error, "upload into Ava's folder was allowed");
    const over = await ben.storage.from(BUCKET).upload(ava.photoPath!, PNG, { contentType: "image/png", upsert: true });
    assert.ok(over.error, "overwrite of Ava's photo was allowed");
    await ben.storage.from(BUCKET).remove([ava.photoPath!]);
    const still = await w.service.storage.from(BUCKET).download(ava.photoPath!);
    assert.equal(still.error, null, "Ava's photo was deleted");
  });
});

describe("+1s — V7", () => {
  it("P27 Ava CAN see 'Rohan · with Dev' / CANNOT see Dev's unclaimed +1; Dev CAN see both of his", async () => {
    const seen = await rows(c(M("Ava")).from("pin_friends").select("first_name, claimed_at").eq("pin_id", w.pin["Dev@G"]));
    assert.deepEqual(seen.map((f) => f.first_name), ["Rohan"]);
    const own = await rows(c(M("Dev")).from("pin_friends").select("id").eq("pin_id", w.pin["Dev@G"]));
    assert.equal(own.length, 2);
  });

  it("P28 nobody, Dev included, CAN read claim_token_hash / when Dev opts out, Ava CANNOT see Rohan", async () => {
    await denied(c(M("Dev")).from("pin_friends").select("claim_token_hash"), "42501");
    await denied(c(M("Ava")).from("pin_friends").select("claim_token_hash"), "42501");
    await ok(c(M("Dev")).from("pins").update({ open_to_meeting: false }).eq("id", w.pin["Dev@G"]), "Dev opts out");
    assert.equal((await rows(c(M("Ava")).from("pin_friends").select("id").eq("pin_id", w.pin["Dev@G"]))).length, 0);
  });
});

describe("Spot poll", () => {
  it("P29 Ava CAN vote at G and see counts / Cal CANNOT vote or see counts", async () => {
    const ava = c(M("Ava"));
    await ok(ava.from("spot_votes").insert({ gathering_id: w.G, gathering_spot_id: w.gs[0], person_id: id("Ava") }), "Ava votes");
    const counts = await poll(ava, w.G);
    assert.equal(counts.size, 3);
    assert.equal(counts.get(w.gs[0]!), 2, "Ben's vote and Ava's");

    const cal = c(M("Cal"));
    await denied(cal.from("spot_votes").insert({ gathering_id: w.G, gathering_spot_id: w.gs[0], person_id: id("Cal") }), "42501");
    assert.equal((await poll(cal, w.G)).size, 0);
  });

  it("P30 Ava CANNOT vote as someone else / CANNOT read Ben's vote row", async () => {
    const ava = c(M("Ava"));
    await denied(ava.from("spot_votes").insert({ gathering_id: w.G, gathering_spot_id: w.gs[1], person_id: id("Dee") }), "42501");
    const visible = await rows(ava.from("spot_votes").select("person_id"));
    assert.deepEqual(visible.map((v) => v.person_id), [id("Ava")]);
  });

  it("P31 Ava CANNOT cast a second vote at G / CAN change her vote", async () => {
    const ava = c(M("Ava"));
    await denied(ava.from("spot_votes").insert({ gathering_id: w.G, gathering_spot_id: w.gs[1], person_id: id("Ava") }), "23505");
    await ok(ava.from("spot_votes").update({ gathering_spot_id: w.gs[1] }).eq("person_id", id("Ava")).eq("gathering_id", w.G));
    const vote = await ok(
      w.service.from("spot_votes").select("gathering_spot_id").eq("person_id", id("Ava")).eq("gathering_id", w.G).single(),
    );
    assert.equal(vote.gathering_spot_id, w.gs[1]);
  });
});

describe("Survey", () => {
  // M3.3 (Alex, 29 Sept): the question is asked after the night, of those who were open
  // to meeting — so before G's end even Ava's own answer is refused. The CAN side, and
  // "readable only by its author", moved to P173, on a gathering that has ended.
  it("P32 Ava CANNOT answer before the gathering has happened / CANNOT submit as someone else", async () => {
    const ava = c(M("Ava"));
    await denied(
      ava.from("survey_responses").insert({ gathering_id: w.G, person_id: id("Ava"), would_have_gone: "no" }),
      "42501",
    );
    assert.deepEqual(await rows(ava.from("survey_responses").select("person_id")), []);
    await denied(
      ava.from("survey_responses").insert({ gathering_id: w.G, person_id: id("Dee"), met: "none", would_have_gone: "yes" }),
      "42501",
    );
  });
});

describe("Reports and auto-hide — V9, V10", () => {
  it("P33 Cal CANNOT report Ava (he can't see her) / nobody CAN read reports / a reporter CANNOT set the status", async () => {
    await denied(
      c(M("Cal")).from("reports").insert({ reporter_id: id("Cal"), target_kind: "person", target_person_id: id("Ava"), reason: "spam" }),
      "42501",
    );
    await denied(
      c(M("Ava")).from("reports").insert({
        reporter_id: id("Ava"), target_kind: "person", target_person_id: id("Ben"), reason: "spam", status: "dismissed",
      }),
      "42501",
    );
    await denied(
      c(M("Ava")).from("reports").insert({ reporter_id: id("Ben"), target_kind: "person", target_person_id: id("Dee"), reason: "spam" }),
      "42501",
    );
    await noAccess(c(M("Ava")), "reports");
  });

  it("P34 one 'uncomfortable' report hides Ivy1 at once / she stays in pinned, leaves open to meeting", async () => {
    const before = await counts(w.anon, w.G);
    await ok(
      c(M("Ava")).from("reports").insert({ reporter_id: id("Ava"), target_kind: "person", target_person_id: id("Ivy1"), reason: "uncomfortable" }),
      "report",
    );
    assert.notEqual((await serviceRow("people", "id", id("Ivy1"), "hidden_at")).hidden_at, null);
    const report = await serviceRow("reports", "target_person_id", id("Ivy1"), "status");
    assert.equal(report.status, "auto_hidden");
    const after = await counts(w.anon, w.G);
    assert.equal(after.pinned, before.pinned);
    assert.equal(after.open_to_meeting, before.open_to_meeting - 1);
  });

  it("P35 one 'spam' report does NOT hide Ivy2 / a second from the same reporter does NOT / one from a different reporter DOES", async () => {
    const hidden = async () => (await serviceRow("people", "id", id("Ivy2"), "hidden_at")).hidden_at;
    const report = (who: string) =>
      c(M(who)).from("reports").insert({ reporter_id: id(who), target_kind: "person", target_person_id: id("Ivy2"), reason: "spam" });
    await ok(report("Ava"), "first spam report");
    assert.equal(await hidden(), null);
    await ok(report("Ava"), "same reporter again");
    assert.equal(await hidden(), null);
    await ok(report("Ben"), "second reporter");
    assert.notEqual(await hidden(), null);
  });

  it("P36 hidden Ivy1: others CANNOT see her / she CANNOT see anyone", async () => {
    assert.equal(await seesPeople(c(M("Ava")), "Ivy1"), 0);
    assert.equal(await seesPins(c(M("Ava")), "Ivy1", w.G), 0);
    const ivy = c(M("Ivy1"));
    assert.equal(await seesPeople(ivy, "Ava", "Ben", "Dee"), 0);
    assert.equal((await rows(ivy.from("pins").select("id").eq("gathering_id", w.G).neq("person_id", id("Ivy1")))).length, 0);
  });
});

describe("After the gathering — V1 (list closes 24h after effective end)", () => {
  it("P37 at P (ended 2 days ago) Pam CANNOT see Pat / anyone CAN still read P's counts", async () => {
    const pam = c(M("Pam"));
    assert.equal(await seesPeople(pam, "Pat"), 0);
    assert.equal(await seesPins(pam, "Pat", w.P), 0);
    const row = await counts(w.anon, w.P);
    assert.equal(row.pinned, 2);
    assert.equal(row.open_to_meeting, 2);
  });

  // Asked by Alex in M2.2 and written down here rather than inferred: nothing about
  // publishing lead times reaches pinning. Pinning an hour before doors works, and
  // nothing about publish_lead_days_min reaches it.
  //
  // THE UPPER BOUND, INVERTED IN M3.2 as M2.2 asked. Until M3.2 a pin could be taken
  // after the gathering had ended — a gap left from M1.1, recorded here so it stayed
  // visible. Pinning now closes at the effective end (Alex, before M3.2): open during
  // the gathering, shut after. Edits close with it; removing a pin never does.
  it("P37b pinning has no lower time gate, and is REFUSED after the effective end (inverted in M3.2)", async () => {
    const ava = c(M("Ava"));
    await denied(
      ava.from("pins").insert({ gathering_id: w.P, person_id: id("Ava"), party_total: 1, open_to_meeting: false }),
      "42501",
    );

    const soon = await ok(
      w.service
        .from("gatherings")
        .insert({ name: `pindhx ${w.run} Doors Soon`, starts_at: new Date(Date.now() + 3_600_000).toISOString(), venue_id: w.venue })
        .select("id")
        .single(),
    );
    await ok(w.service.from("gatherings").update({ published_at: new Date().toISOString() }).eq("id", soon.id));
    const early = await ava
      .from("pins")
      .insert({ gathering_id: soon.id, person_id: id("Ava"), party_total: 1, open_to_meeting: false })
      .select("id")
      .single();
    assert.equal(early.error, null, `pinning an hour before doors was refused: ${early.error?.message}`);
  });

  // Both sides of the new edge, and the one thing it must never touch.
  it("P90 pinning is OPEN during the gathering — started an hour ago, not yet ended (the 9pm case)", async () => {
    const now = await ok(
      w.service
        .from("gatherings")
        .insert({ name: `pindhx ${w.run} Under Way`, starts_at: new Date(Date.now() - 3_600_000).toISOString(), venue_id: w.venue })
        .select("id")
        .single(),
    );
    await ok(w.service.from("gatherings").update({ published_at: new Date().toISOString() }).eq("id", now.id));
    const ava = c(M("Ava"));
    const pin = await ava
      .from("pins")
      .insert({ gathering_id: now.id, person_id: id("Ava"), party_total: 1, open_to_meeting: false })
      .select("id")
      .single();
    assert.equal(pin.error, null, `pinning during the gathering was refused: ${pin.error?.message}`);
    const edited = await ava.from("pins").update({ party_total: 2 }).eq("id", pin.data!.id).select("id");
    assert.equal(edited.data?.length, 1, "editing a pin during the gathering was refused");
  });

  it("P91 after the effective end a pin CANNOT be edited, and CAN always be removed", async () => {
    // A pin taken while it was open, then the gathering ends (moved into the past by
    // the service key, the only way a test can make time pass).
    const g = await ok(
      w.service
        .from("gatherings")
        .insert({ name: `pindhx ${w.run} Ends Now`, starts_at: new Date(Date.now() - 3_600_000).toISOString(), venue_id: w.venue })
        .select("id")
        .single(),
    );
    await ok(w.service.from("gatherings").update({ published_at: new Date().toISOString() }).eq("id", g.id));
    const ava = c(M("Ava"));
    const pin = await ok(
      ava.from("pins").insert({ gathering_id: g.id, person_id: id("Ava"), party_total: 1, open_to_meeting: false }).select("id").single(),
    );
    await ok(
      w.service.from("gatherings").update({ starts_at: new Date(Date.now() - 5 * 3_600_000).toISOString() }).eq("id", g.id),
    );

    // An update the policy refuses matches no row: no error, nothing changed.
    const edited = await ava.from("pins").update({ party_total: 3, open_to_meeting: true }).eq("id", pin.id).select("id");
    assert.equal(edited.data?.length ?? 0, 0, "a pin was edited after the gathering ended");
    const after = await ok(w.service.from("pins").select("party_total, open_to_meeting").eq("id", pin.id).single());
    assert.deepEqual(after, { party_total: 1, open_to_meeting: false }, "the ended pin changed");

    const removed = await ava.from("pins").delete().eq("id", pin.id).select("id");
    assert.equal(removed.data?.length, 1, "removing a pin after the end was refused — it never may be");
  });
});

// ---------------------------------------------------------------------------
// Phase 1 M1.2 — drafts, admin-only data, admin actions (V11, V12)
// ---------------------------------------------------------------------------

const admin = (fn: string, args: Record<string, unknown>) => w.service.rpc(fn, { ...args, p_actor: ACTOR });
// The operational functions take no actor: they are the machine talking to itself.
const admin2 = (fn: string, args: Record<string, unknown>) => w.service.rpc(fn, args);

async function readable(client: SupabaseClient, gathering: string): Promise<boolean> {
  return (await rows(client.from("gatherings").select("id").eq("id", gathering))).length === 1;
}

describe("Drafts and dismissed gatherings — V11", () => {
  it("P38 anon and Ava CANNOT read drafts from any source, or a dismissed gathering, or their spot options, links or counts / CAN still read published G", async () => {
    const hidden = [w.D.ticketmaster, w.D.ai, w.D.manual, w.X, w.Dup, w.Q];
    for (const client of [w.anon, c(M("Ava"))]) {
      assert.equal(await readable(client, w.G), true);
      for (const g of hidden) assert.equal(await readable(client, g), false, `draft ${g} was readable`);
      assert.equal((await rows(client.from("gathering_spots").select("id").eq("gathering_id", w.D.ai))).length, 0);
      assert.equal((await rows(client.rpc("gathering_counts", { gathering_ids: hidden }))).length, 0);
    }
    assert.equal(await links(c(M("Ava")), w.D.ai, "everyone"), 0);
  });

  it("P39 Ava CANNOT pin to a draft or a dismissed gathering", async () => {
    const ava = c(M("Ava"));
    for (const g of [w.D.ai, w.X]) {
      await denied(ava.from("pins").insert({ gathering_id: g, person_id: id("Ava"), open_to_meeting: true }), "42501");
    }
  });
});

describe("Admin-only data — V12", () => {
  const ADMIN_TABLES = [
    "gathering_sources",
    "gathering_triage",
    "spot_suggestions",
    "venue_aliases",
    "venue_external_ids",
    "moderation_log",
  ];

  it("P40 anon and Ava CANNOT read or write sources, AI scores, spot suggestions, aliases, external ids or the log / CAN read cities, not write them", async () => {
    for (const client of [w.anon, c(M("Ava"))]) {
      for (const table of ADMIN_TABLES) await noAccess(client, table);
      await denied(client.from("spot_suggestions").insert({ venue_id: w.venue2, name: "Sneaky" }), "42501");
      await denied(client.from("gathering_triage").insert({ gathering_id: w.G, score: 100 }), "42501");
      const cities = await rows(client.from("cities").select("slug, timezone"));
      assert.deepEqual(cities.find((r: { slug: string }) => r.slug === "toronto"), { slug: "toronto", timezone: "America/Toronto" });
      await denied(client.from("cities").insert({ slug: "pindhx", name: "Pindhx", timezone: "UTC" }), "42501");
    }
    // A pending suggestion is not a meeting spot: nobody sees "Front Steps" at venue2.
    const spots = await rows(w.anon.from("meeting_spots").select("name").eq("venue_id", w.venue2));
    assert.deepEqual(spots.map((r: { name: string }) => r.name).sort(), ["Box Office", "Coat Check"]);
  });

  it("P41 anon and Ava CANNOT call any admin action", async () => {
    const calls: [string, Record<string, unknown>][] = [
      ["admin_publish_gathering", { p_gathering: w.D.ai, p_actor: "x" }],
      ["admin_unpublish_gathering", { p_gathering: w.G, p_actor: "x" }],
      ["admin_dismiss_gathering", { p_gathering: w.D.ai, p_actor: "x" }],
      ["admin_restore_gathering", { p_gathering: w.X, p_actor: "x" }],
      ["admin_merge_gatherings", { p_loser: w.Dup, p_survivor: w.G, p_actor: "x" }],
      ["admin_set_photo_status", { p_person: id("Eve"), p_photo_path: M("Eve").photoPath, p_status: "approved", p_actor: "x" }],
      ["admin_unhide_person", { p_person: id("Ivy1"), p_actor: "x" }],
      ["admin_keep_hidden", { p_person: id("Ivy1"), p_actor: "x" }],
      ["admin_hide_person", { p_person: id("Ben"), p_actor: "x" }],
      ["admin_dismiss_reports", { p_person: id("c5m2"), p_actor: "x" }],
      ["admin_delete_pin", { p_pin: w.pin["Ben@G"], p_actor: "x" }],
      ["admin_approve_spot", { p_suggestion: w.venue2, p_name: "x", p_description: "x", p_actor: "x" }],
      ["admin_reject_spot", { p_suggestion: w.venue2, p_actor: "x" }],
    ];
    for (const client of [w.anon, c(M("Ava"))]) {
      for (const [fn, args] of calls) await denied(client.rpc(fn, args), "42501");
    }
    assert.equal(await readable(w.anon, w.D.ai), false, "a draft got published");
    assert.equal(await seesPeople(c(M("Ava")), "Ben"), 1, "Ben got hidden");
  });
});

describe("Publishing rules — decisions Part 5 (enforced in the database)", () => {
  it("P42 spots are not needed to publish (Alex, M1.3): a venue with NO spots publishes with an empty poll; venue2 (2 spots) publishes with 2 options at start minus 60 min, and approving a 3rd tops the poll up to 3 / a gathering with no venue is REFUSED / unpublish works at zero pins, REFUSED at G with pins", async () => {
    // A venue with no approved spots.
    const empty = await ok(w.service.from("venues").insert({ name: `pindhx ${w.run} Empty` }).select("id").single());
    const e = await ok(
      w.service
        .from("gatherings")
        .insert({ name: `pindhx ${w.run} E`, starts_at: new Date(Date.now() + 13 * 86_400_000).toISOString(), venue_id: empty.id })
        .select("id")
        .single(),
    );
    await ok(admin("admin_publish_gathering", { p_gathering: e.id }));
    assert.equal(await readable(w.anon, e.id), true);
    assert.equal((await rows(w.anon.from("gathering_spots").select("id").eq("gathering_id", e.id))).length, 0);

    // No venue: still refused, by the function and by the trigger (even with the service key).
    const noVenue = await ok(
      w.service
        .from("gatherings")
        .insert({ name: `pindhx ${w.run} no-venue`, starts_at: new Date(Date.now() + 13 * 86_400_000).toISOString(), venue_id: null })
        .select("id")
        .single(),
    );
    assert.match((await admin("admin_publish_gathering", { p_gathering: noVenue.id })).error?.message ?? "", /no venue/);
    await denied(w.service.from("gatherings").update({ published_at: new Date().toISOString() }).eq("id", noVenue.id));

    // venue2 has 2 approved spots: the poll gets 2.
    await ok(admin("admin_publish_gathering", { p_gathering: w.Q }));
    assert.equal(await readable(w.anon, w.Q), true);
    const q = await ok(w.service.from("gatherings").select("starts_at, status").eq("id", w.Q).single());
    assert.equal(q.status, "published");
    let options = await rows(w.anon.from("gathering_spots").select("meet_at").eq("gathering_id", w.Q));
    assert.equal(options.length, 2);
    for (const o of options) assert.equal(Date.parse(o.meet_at), Date.parse(q.starts_at) - 60 * 60 * 1000);

    // Approving venue2's pending suggestion (edited) tops Q's poll up to 3 — never more.
    const suggestion = await ok(w.service.from("spot_suggestions").select("id").eq("venue_id", w.venue2).single());
    await ok(admin("admin_approve_spot", { p_suggestion: suggestion.id, p_name: "Front Steps (south)", p_description: "" }));
    options = await rows(w.anon.from("gathering_spots").select("meet_at").eq("gathering_id", w.Q));
    assert.equal(options.length, 3);
    await ok(w.service.from("meeting_spots").insert({ venue_id: w.venue2, name: `pindhx ${w.run} Fourth` }));
    assert.equal((await rows(w.anon.from("gathering_spots").select("id").eq("gathering_id", w.Q))).length, 3);

    await ok(admin("admin_unpublish_gathering", { p_gathering: w.Q }));
    assert.equal(await readable(w.anon, w.Q), false);
    const g = await admin("admin_unpublish_gathering", { p_gathering: w.G });
    assert.match(g.error?.message ?? "", /pinned in/);
    assert.equal(await readable(w.anon, w.G), true);

    // Already started: refused.
    const past = await ok(
      w.service
        .from("gatherings")
        .insert({ name: `pindhx ${w.run} past-draft`, starts_at: new Date(Date.now() - 3600_000).toISOString(), venue_id: w.venue })
        .select("id")
        .single(),
    );
    assert.match((await admin("admin_publish_gathering", { p_gathering: past.id })).error?.message ?? "", /already started/);
  });

  it("P43 merging the AI duplicate into G moves its source record to G and hides it / a published gathering CANNOT be merged away / dismiss and restore work on a draft", async () => {
    await ok(admin("admin_merge_gatherings", { p_loser: w.Dup, p_survivor: w.G }));
    const dup = await ok(w.service.from("gatherings").select("status, merged_into_id").eq("id", w.Dup).single());
    assert.deepEqual(dup, { status: "dismissed", merged_into_id: w.G });
    const src = await ok(
      w.service.from("gathering_sources").select("gathering_id").eq("external_id", `pindhx-${w.run}-dup`).single(),
    );
    assert.equal(src.gathering_id, w.G);
    const g = await ok(w.service.from("gatherings").select("event_url").eq("id", w.G).single());
    assert.equal(g.event_url, "https://example.com/pindhx-dup", "survivor's blank link filled from the duplicate");
    assert.equal(await readable(w.anon, w.Dup), false);
    assert.match((await admin("admin_restore_gathering", { p_gathering: w.Dup })).error?.message ?? "", /unmerged/);
    assert.ok((await admin("admin_merge_gatherings", { p_loser: w.G, p_survivor: w.D.ai })).error, "merged a published gathering away");

    await ok(admin("admin_dismiss_gathering", { p_gathering: w.D.manual }));
    assert.equal((await ok(w.service.from("gatherings").select("status").eq("id", w.D.manual).single())).status, "dismissed");
    await ok(admin("admin_restore_gathering", { p_gathering: w.D.manual }));
    assert.equal((await ok(w.service.from("gatherings").select("status").eq("id", w.D.manual).single())).status, "draft");
    assert.ok((await admin("admin_dismiss_gathering", { p_gathering: w.G })).error, "dismissed a published gathering");

    const log = await rows(w.service.from("moderation_log").select("action").eq("actor", ACTOR));
    for (const action of ["merge", "dismiss", "restore", "publish", "unpublish", "spot_approve"]) {
      assert.ok(log.some((r: { action: string }) => r.action === action), `no ${action} in the moderation log`);
    }
  });
});

describe("Venue maps — V12 (public bucket, admin-written)", () => {
  it("P44 anon CAN load a venue map by its public URL / Ava CANNOT upload, overwrite or delete one", async () => {
    const path = `${w.venue}/map.png`;
    await ok(w.service.storage.from(MAPS).upload(path, PNG, { contentType: "image/png" }), "service upload");
    const url = w.anon.storage.from(MAPS).getPublicUrl(path).data.publicUrl;
    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.equal(Buffer.from(await res.arrayBuffer()).equals(PNG), true);

    const ava = c(M("Ava"));
    await denied(ava.storage.from(MAPS).upload(`${w.venue}/evil.png`, PNG, { contentType: "image/png" }));
    await denied(ava.storage.from(MAPS).upload(path, PNG, { contentType: "image/png", upsert: true }));
    await ava.storage.from(MAPS).remove([path]);
    const still = await ok(w.service.storage.from(MAPS).list(w.venue));
    assert.ok(still.some((f: { name: string }) => f.name === "map.png"), "Ava deleted the map");
  });
});

describe("Moderation actions — V6, V8, V10 after admin review", () => {
  it("P45 admin unhides Ivy1: Ava CAN see her again, Cal still CANNOT, her reports are dismissed / Hide now hides her again", async () => {
    const before = (await counts(w.anon, w.G)).open_to_meeting;
    await ok(admin("admin_unhide_person", { p_person: id("Ivy1"), p_note: "pindhx review" }));
    assert.equal(await seesPeople(c(M("Ava")), "Ivy1"), 1);
    assert.equal(await seesPeople(c(M("Cal")), "Ivy1"), 0);
    assert.equal((await counts(w.anon, w.G)).open_to_meeting, before + 1);
    const reports = await rows(w.service.from("reports").select("status").eq("target_person_id", id("Ivy1")));
    assert.ok(reports.length > 0 && reports.every((r: { status: string }) => r.status === "dismissed"));

    await ok(admin("admin_hide_person", { p_person: id("Ivy1") }));
    assert.equal(await seesPeople(c(M("Ava")), "Ivy1"), 0);
    await ok(admin("admin_keep_hidden", { p_person: id("Ivy1") }));
    assert.ok((await admin("admin_dismiss_reports", { p_person: id("Ivy1") })).error, "dismissed reports on a hidden person");
  });

  // Reworked in M3.1 ("nothing waits on the check"): approving no longer reveals a
  // photo — it was visible already. Rejecting is the only thing that hides one.
  it("P46 a stale photo path is REFUSED / approving keeps Eve's photo visible / rejecting hides it / approving again brings it back", async () => {
    const eve = M("Eve");
    await canSign(c(M("Ava")), eve.photoPath);
    const stale = await admin("admin_set_photo_status", {
      p_person: eve.personId,
      p_photo_path: `${eve.authId}/old.png`,
      p_status: "approved",
    });
    assert.ok(stale.error, "approved a photo the admin never saw");
    await ok(admin("admin_set_photo_status", { p_person: eve.personId, p_photo_path: eve.photoPath, p_status: "approved" }));
    await canSign(c(M("Ava")), eve.photoPath);
    await ok(admin("admin_set_photo_status", { p_person: eve.personId, p_photo_path: eve.photoPath, p_status: "rejected" }));
    await cannotSign(c(M("Ava")), eve.photoPath);
    await canSign(c(eve), eve.photoPath);
    await ok(admin("admin_set_photo_status", { p_person: eve.personId, p_photo_path: eve.photoPath, p_status: "approved" }));
    await canSign(c(M("Ava")), eve.photoPath);
  });

  it("P47 admin deletes Nia's pin at G: Ava CANNOT see Nia or her pin / Nia's person row stays / the deletion is logged", async () => {
    assert.equal(await seesPeople(c(M("Ava")), "Nia"), 1);
    await ok(admin("admin_delete_pin", { p_pin: w.pin["Nia@G"], p_note: "pindhx on request" }));
    assert.equal(await seesPeople(c(M("Ava")), "Nia"), 0);
    assert.equal(await seesPins(c(M("Ava")), "Nia", w.G), 0);
    assert.ok(await serviceRow("people", "id", id("Nia"), "id"));
    const log = await rows(w.service.from("moderation_log").select("pin_id").eq("action", "pin_delete").eq("actor", ACTOR));
    assert.ok(log.some((r: { pin_id: string }) => r.pin_id === w.pin["Nia@G"]));
  });
});

// ---------------------------------------------------------------------------
// M1.3 — Ticketmaster import, flags and the withdrawn state (V12, V13)
// ---------------------------------------------------------------------------

const IMPORTER = "importer:ticketmaster";

async function startRun(): Promise<number> {
  return ok(w.service.rpc("admin_start_import_run", { p_source: "ticketmaster", p_trigger: "manual", p_actor: ACTOR, p_city: "toronto" }));
}

async function finishRun(run: number): Promise<void> {
  await ok(w.service.from("import_runs").update({ status: "ok", finished_at: new Date().toISOString() }).eq("id", run));
}

function apply(run: number, plan: Record<string, unknown>) {
  return w.service.rpc("admin_import_apply", { p_run: run, p_plan: plan });
}

async function gatheringRow(g: string): Promise<any> {
  return ok(w.service.from("gatherings").select("status, starts_at, dismissed_at, event_url, venue_id").eq("id", g).single());
}

describe("Import data and actions — V12 (M1.3)", () => {
  it("P48 anon and Ava CANNOT read or write import runs, flags or withdrawal reasons / CANNOT call any M1.3 admin action", async () => {
    for (const client of [w.anon, c(M("Ava"))]) {
      for (const table of ["import_runs", "gathering_flags", "gathering_withdrawals"]) await noAccess(client, table);
      await denied(client.from("gathering_flags").insert({ gathering_id: w.G, kind: "cancelled", source: "ticketmaster" }), "42501");
      const calls: [string, Record<string, unknown>][] = [
        ["admin_start_import_run", { p_source: "ticketmaster", p_trigger: "manual", p_actor: "x", p_city: "toronto" }],
        ["admin_ai_spend_today", { p_city: "toronto" }],
        ["admin_import_apply", { p_run: 1, p_plan: {} }],
        ["admin_purge_ticketmaster_data", { p_days: 30 }],
        ["admin_withdraw_gathering", { p_gathering: w.G, p_reason: "takedown", p_note: "x", p_actor: "x" }],
        ["admin_unwithdraw_gathering", { p_gathering: w.G, p_actor: "x" }],
        ["admin_resolve_flag", { p_flag: w.G, p_resolution: "ignored", p_actor: "x" }],
        ["admin_confirm_venue", { p_venue: w.venue, p_actor: "x" }],
        ["admin_merge_venues", { p_from: w.venue2, p_into: w.venue, p_actor: "x" }],
        ["admin_top_up_spot_poll", { p_gathering: w.G }],
      ];
      for (const [fn, args] of calls) await denied(client.rpc(fn, args), "42501");
    }
    assert.equal(await readable(w.anon, w.G), true, "G got withdrawn");
  });
});

describe("Withdrawn — V13 (Alex, M1.3)", () => {
  it("P49 before: Wil CAN see Wyn at W / after withdrawing W (it has pins): anon and Hana CANNOT read W, its spot options or its counts, and it leaves the published list / Wil and Wes (pinned) CAN read W, its counts and their own pins", async () => {
    assert.equal(await seesPeople(c(M("Wil")), "Wyn"), 1);
    await ok(admin("admin_withdraw_gathering", { p_gathering: w.W, p_reason: "takedown", p_note: "pindhx request" }));
    assert.equal((await gatheringRow(w.W)).status, "withdrawn");

    for (const client of [w.anon, c(M("Hana"))]) {
      assert.equal(await readable(client, w.W), false);
      assert.equal((await rows(client.from("gathering_spots").select("id").eq("gathering_id", w.W))).length, 0);
      assert.equal((await rows(client.rpc("gathering_counts", { gathering_ids: [w.W] }))).length, 0);
      const listed = await rows(client.from("gatherings").select("id").like("name", `pindhx ${w.run} %`));
      assert.ok(!listed.some((g: { id: string }) => g.id === w.W), "W is still in a public list");
      assert.ok(listed.some((g: { id: string }) => g.id === w.G));
    }
    for (const name of ["Wil", "Wes"]) {
      assert.equal(await readable(c(M(name)), w.W), true, `${name} cannot read W`);
      assert.equal((await counts(c(M(name)), w.W)).pinned, 3);
      assert.equal(await seesPins(c(M(name)), name, w.W), 1);
    }
    const reason = await serviceRow("gathering_withdrawals", "gathering_id", w.W, "reason, note");
    assert.deepEqual(reason, { reason: "takedown", note: "pindhx request" });
  });

  it("P50 withdrawn W: Wil CANNOT see Wyn or his pin, the WhatsApp link, the spot options or poll counts, and CANNOT vote or submit the survey / Hana CANNOT pin / Wes CAN remove his own pin", async () => {
    const wil = c(M("Wil"));
    assert.equal(await seesPeople(wil, "Wyn"), 0);
    assert.equal(await seesPins(wil, "Wyn", w.W), 0);
    assert.equal(await links(wil, w.W, "everyone"), 0);
    assert.equal((await rows(wil.from("gathering_spots").select("id").eq("gathering_id", w.W))).length, 0);
    assert.equal((await poll(wil, w.W)).size, 0);
    const option = await ok(w.service.from("gathering_spots").select("id").eq("gathering_id", w.W).limit(1).single());
    await denied(wil.from("spot_votes").insert({ gathering_id: w.W, gathering_spot_id: option.id, person_id: id("Wil") }), "42501");
    await denied(
      wil.from("survey_responses").insert({ gathering_id: w.W, person_id: id("Wil"), met: "none", would_have_gone: "yes" }),
      "42501",
    );
    await denied(c(M("Hana")).from("pins").insert({ gathering_id: w.W, person_id: id("Hana"), open_to_meeting: true }), "42501");
    await ok(c(M("Wes")).from("pins").delete().eq("id", w.pin["Wes@W"]));
    assert.equal(await serviceRow("pins", "id", w.pin["Wes@W"], "id"), null, "Wes's pin was not removed");
    assert.ok(await serviceRow("pins", "id", w.pin["Wil@W"], "id"), "Wil's pin was not kept");
  });

  it("P51 un-withdrawing restores it: anon CAN read W, Wil CAN see Wyn, Hana CAN pin / a draft CANNOT be withdrawn / both actions are logged", async () => {
    await ok(admin("admin_unwithdraw_gathering", { p_gathering: w.W }));
    assert.equal(await readable(w.anon, w.W), true);
    assert.equal(await seesPeople(c(M("Wil")), "Wyn"), 1);
    await ok(c(M("Hana")).from("pins").insert({ gathering_id: w.W, person_id: id("Hana"), open_to_meeting: false }));
    assert.equal(await serviceRow("gathering_withdrawals", "gathering_id", w.W, "reason"), null);
    assert.match(
      (await admin("admin_withdraw_gathering", { p_gathering: w.D.manual, p_reason: "other", p_note: "" })).error?.message ?? "",
      /Only a published gathering/,
    );
    const log = await rows(w.service.from("moderation_log").select("action, note").eq("gathering_id", w.W));
    assert.ok(log.some((r: { action: string; note: string }) => r.action === "withdraw" && r.note.startsWith("takedown")));
    assert.ok(log.some((r: { action: string }) => r.action === "unwithdraw"));
  });
});

describe("Importer rights, enforced in the database (decisions Part 5, M1.3)", () => {
  it("P52 one run at a time / an import CANNOT dismiss or move a published gathering, or restore a draft Alex dismissed / it CAN dismiss a draft and restore it itself / flags on published gatherings only, one open per kind / applying a new date moves the spot poll", async () => {
    const run = await startRun();
    assert.match(
      (await w.service.rpc("admin_start_import_run", { p_source: "ticketmaster", p_trigger: "cron", p_actor: ACTOR, p_city: "toronto" })).error?.message ?? "",
      /already running/,
    );
    try {
      const g0 = await gatheringRow(w.G);
      const later = new Date(Date.parse(g0.starts_at) + 86_400_000).toISOString();
      const res = await apply(run, {
        dismiss: [
          { gatheringId: w.G, reason: "cancelled" },
          { gatheringId: w.D.ticketmaster, reason: "postponed" },
        ],
        draftUpdates: [{ gatheringId: w.G, startsAt: later }],
        restore: [{ gatheringId: w.X, startsAt: later }],
        flags: [
          { gatheringId: w.G, kind: "date_changed", oldStartsAt: g0.starts_at, newStartsAt: later, status: "onsale" },
          { gatheringId: w.D.manual, kind: "cancelled", oldStartsAt: null, newStartsAt: null, status: "cancelled" },
        ],
      });
      assert.equal(res.error, null, res.error?.message);
      const g1 = await gatheringRow(w.G);
      assert.equal(g1.status, "published");
      assert.equal(Date.parse(g1.starts_at), Date.parse(g0.starts_at), "a published gathering's date moved");
      assert.equal((await gatheringRow(w.X)).status, "dismissed", "restored a draft the importer never dismissed");
      assert.equal((await gatheringRow(w.D.ticketmaster)).status, "dismissed");
      const flags = await rows(w.service.from("gathering_flags").select("id, gathering_id, kind").in("gathering_id", [w.G, w.D.manual]));
      assert.deepEqual(flags.map((f: { gathering_id: string; kind: string }) => [f.gathering_id, f.kind]), [[w.G, "date_changed"]]);

      // Same change again: still one open flag. The importer restores its own dismissal.
      await ok(apply(run, {
        flags: [{ gatheringId: w.G, kind: "date_changed", oldStartsAt: g0.starts_at, newStartsAt: later, status: "onsale" }],
        restore: [{ gatheringId: w.D.ticketmaster, startsAt: later }],
      }));
      assert.equal((await rows(w.service.from("gathering_flags").select("id").eq("gathering_id", w.G).is("resolved_at", null))).length, 1);
      const restored = await gatheringRow(w.D.ticketmaster);
      assert.equal(restored.status, "draft");
      assert.equal(Date.parse(restored.starts_at), Date.parse(later));
      const log = await rows(w.service.from("moderation_log").select("actor, action").eq("gathering_id", w.D.ticketmaster));
      assert.ok(log.some((r: { actor: string; action: string }) => r.actor === IMPORTER && r.action === "dismiss"));
      assert.ok(log.some((r: { actor: string; action: string }) => r.actor === IMPORTER && r.action === "restore"));

      // Alex dismisses it: the importer can no longer bring it back.
      await ok(admin("admin_dismiss_gathering", { p_gathering: w.D.ticketmaster }));
      await ok(apply(run, { restore: [{ gatheringId: w.D.ticketmaster, startsAt: later }] }));
      assert.equal((await gatheringRow(w.D.ticketmaster)).status, "dismissed");

      // Ignore G's flag; apply a new date to H (moves its spot option by the same amount).
      await ok(admin("admin_resolve_flag", { p_flag: flags[0].id, p_resolution: "ignored" }));
      const h0 = await gatheringRow(w.H);
      const opt0 = await serviceRow("gathering_spots", "id", w.hs, "meet_at");
      const hLater = new Date(Date.parse(h0.starts_at) + 2 * 3_600_000).toISOString();
      await ok(apply(run, { flags: [{ gatheringId: w.H, kind: "rescheduled", oldStartsAt: h0.starts_at, newStartsAt: hLater, status: "rescheduled" }] }));
      const hFlag = await ok(w.service.from("gathering_flags").select("id").eq("gathering_id", w.H).is("resolved_at", null).single());
      await ok(admin("admin_resolve_flag", { p_flag: hFlag.id, p_resolution: "applied" }));
      assert.equal(Date.parse((await gatheringRow(w.H)).starts_at), Date.parse(hLater));
      const opt1 = await serviceRow("gathering_spots", "id", w.hs, "meet_at");
      assert.equal(Date.parse(opt1.meet_at) - Date.parse(opt0.meet_at), 2 * 3_600_000);

      // A new draft at a new venue; applying the same plan twice makes no copy.
      const plan = {
        newVenues: [{ key: "pindhx venue", name: `pindhx ${w.run} Venue`, address: "1 Test St, Toronto", lat: 43.65, lng: -79.39, externalIds: [`pindhx-${w.run}-venue`] }],
        newDrafts: [{
          name: `pindhx ${w.run} New`, startsAt: later, eventUrl: "https://www.ticketmaster.ca/event/pindhx-new",
          venueNameRaw: "pindhx Venue", venueId: null, newVenue: "pindhx venue",
          sources: [{ externalId: `pindhx-${w.run}-new1`, url: "https://www.ticketmaster.ca/event/pindhx-new", snapshot: { name: "New", startsAt: later, status: "onsale", url: null } }],
        }],
      };
      await ok(apply(run, plan));
      await ok(apply(run, plan));
      const made = await rows(w.service.from("gatherings").select("id, status, venue_id").eq("name", `pindhx ${w.run} New`));
      assert.equal(made.length, 1);
      assert.equal(made[0].status, "draft");
      const ext = await serviceRow("venue_external_ids", "external_id", `pindhx-${w.run}-venue`, "venue_id, needs_review");
      assert.deepEqual(ext, { venue_id: made[0].venue_id, needs_review: true });
    } finally {
      await finishRun(run);
    }
  });

  it("P53 retention: 30 days after the end, Ticketmaster's ids and links are deleted and a Ticketmaster-only draft goes / our published record stays / upcoming gatherings are untouched", async () => {
    const purge = await w.service.rpc("admin_purge_ticketmaster_data", { p_days: 30 });
    assert.equal(purge.error, null, purge.error?.message);
    assert.equal(await serviceRow("gatherings", "id", w.OldDraft, "id"), null, "the old Ticketmaster draft was kept");
    const old = await gatheringRow(w.Old);
    assert.equal(old.status, "published");
    assert.equal(old.event_url, null);
    assert.equal(await serviceRow("gathering_sources", "gathering_id", w.Old, "id"), null);
    assert.ok(await serviceRow("gathering_sources", "external_id", `pindhx-${w.run}-tm1`, "id"), "an upcoming source was deleted");
  });

  it("P54 a venue the importer created can be confirmed, or merged into the real one (drafts, Ticketmaster id and old name move) / merging a venue with spots is REFUSED", async () => {
    const made = await ok(w.service.from("gatherings").select("venue_id").eq("name", `pindhx ${w.run} New`).single());
    const created = made.venue_id as string;
    await ok(admin("admin_confirm_venue", { p_venue: created }));
    assert.equal((await serviceRow("venue_external_ids", "external_id", `pindhx-${w.run}-venue`, "needs_review")).needs_review, false);

    assert.match((await admin("admin_merge_venues", { p_from: w.venue, p_into: w.venue2 })).error?.message ?? "", /published gathering|meeting spots/);
    await ok(admin("admin_merge_venues", { p_from: created, p_into: w.venue2 }));
    assert.equal(await serviceRow("venues", "id", created, "id"), null);
    assert.equal((await ok(w.service.from("gatherings").select("venue_id").eq("name", `pindhx ${w.run} New`).single())).venue_id, w.venue2);
    assert.equal((await serviceRow("venue_external_ids", "external_id", `pindhx-${w.run}-venue`, "venue_id")).venue_id, w.venue2);
    const aliases = await rows(w.service.from("venue_aliases").select("alias").eq("venue_id", w.venue2));
    assert.ok(aliases.some((a: { alias: string }) => a.alias === `pindhx ${w.run} Venue`));
  });
});

// ---------------------------------------------------------------------------
// V18 — seed rows never reach the public (Phase 2 M2.1; decisions.md Part 5,
// "pind.social before production"). Until pind-prod exists, pind.social serves
// pind-staging, which holds the seeded rows the admin was built against.
//
// The rows below carry is_seed, which is what the staging seed looks like to the
// database. Everything else in this file is an ordinary row — which is why the
// other 55 cases are untouched by the rule, and why the harness itself stays off
// the public web through the slug instead (P59, docs/visibility.md §12f).
// ---------------------------------------------------------------------------

let seedVenue = "";
let seedG = "";
let seedGSlug = "";
let seedPerson = "";
let seedSession: SupabaseClient;
let publicG = "";
let publicSlug = "";

function inDays(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString();
}

// What a visitor would get from the public web layer for this slug.
async function publicDoor(client: SupabaseClient, slug: string): Promise<any> {
  return ok(client.rpc("public_gathering", { p_slug: slug }));
}

// The slugs the week's list would show, over a window wide enough for the world.
async function publicList(client: SupabaseClient): Promise<string[]> {
  const data = await rows(client.rpc("public_gatherings", { p_from: inDays(-90), p_to: inDays(90), p_city: "toronto" }));
  return data.map((r: { slug: string }) => r.slug);
}

describe("Seed rows never reach the public — V18 (Alex, M2.1)", () => {
  before(async () => {
    // A seeded venue, with a spot, and a published gathering at it. The gathering
    // is inserted WITHOUT is_seed: the venue's flag must carry to it on its own.
    seedVenue = (
      await ok(
        w.service
          .from("venues")
          .insert({ name: `pindhx ${w.run} Seed Venue`, address: "1 Seed St, Toronto", is_seed: true })
          .select("id")
          .single(),
      )
    ).id;
    await ok(w.service.from("meeting_spots").insert({ venue_id: seedVenue, name: `pindhx ${w.run} Seed Spot` }));
    seedG = (
      await ok(
        w.service
          .from("gatherings")
          .insert({
            name: `pindhx ${w.run} Seed Crowd`,
            starts_at: inDays(9),
            venue_id: seedVenue,
            published_at: new Date().toISOString(),
          })
          .select("id")
          .single(),
      )
    ).id;
    // Give it a public URL, so the door is tested on the rule and not on a missing slug.
    seedGSlug = await ok(w.service.rpc("admin_mint_slug", { p_gathering: seedG }));

    // A seeded person with their own session, pinned and opted in at the REAL
    // gathering G, bringing two friends.
    seedSession = newClient(w.env, w.env.publishableKey);
    const signIn = await seedSession.auth.signInAnonymously({ options: { data: { harness: "pindhx" } } });
    assert.equal(signIn.error, null, signIn.error?.message);
    await markHarness(w.service, signIn.data.user!.id);
    seedPerson = (
      await ok(
        w.service
          .from("people")
          .insert({
            auth_user_id: signIn.data.user!.id,
            first_name: "Seeda",
            neighbourhood: "king-west",
            is_seed: true,
          })
          .select("id")
          .single(),
      )
    ).id;
    // The handle is also this person's sweep tag (V17 moved both).
    await ok(w.service.from("person_handles").insert({ person_id: seedPerson, instagram: handleFor(w.run, "seeda") }));
    await ok(w.service.from("people_private").insert({ person_id: seedPerson, gender: "woman", birth_year: 1995 }));
  });

  it("P55 a seeded gathering and its venue are invisible to anon and to a signed-in person / the service key still sees everything", async () => {
    assert.equal((await serviceRow("gatherings", "id", seedG, "is_seed")).is_seed, true, "the venue's flag did not carry");

    for (const client of [w.anon, c(M("Ava"))]) {
      assert.equal(await readable(client, seedG), false, "the seeded gathering was readable");
      assert.equal((await rows(client.from("venues").select("id").eq("id", seedVenue))).length, 0, "seeded venue");
      assert.equal((await rows(client.from("meeting_spots").select("id").eq("venue_id", seedVenue))).length, 0, "seeded spots");
      assert.equal((await rows(client.from("gathering_spots").select("id").eq("gathering_id", seedG))).length, 0, "seeded options");
      assert.equal((await rows(client.rpc("gathering_counts", { gathering_ids: [seedG] }))).length, 0, "seeded counts");
      // The public web layer: not on the week's list, and its URL is gone.
      assert.equal((await publicList(client)).includes(seedGSlug), false, "a seeded gathering was listed");
      assert.equal((await publicDoor(client, seedGSlug)).status, "gone", "a seeded crowd page answered");
    }

    // The admin is untouched: it reads with the service key, which is the point of the seed.
    assert.ok(await serviceRow("venues", "id", seedVenue, "id"), "the admin lost the seeded venue");
    assert.equal((await rows(w.service.from("gatherings").select("id").eq("id", seedG))).length, 1);
  });

  it("P56 a seeded person is invisible at a REAL gathering, sees nobody there, and moves no count (H6)", async () => {
    const before = await counts(w.anon, w.G);

    await ok(
      w.service.from("pins").insert({ gathering_id: w.G, person_id: seedPerson, open_to_meeting: true, party_total: 3 }),
    );

    const after = await counts(w.anon, w.G);
    assert.deepEqual(after, before, "a fabricated pin moved a public number");

    // Ava is opted in at G, so V1 would let her see any real person pinned there.
    assert.equal(await seesPeople(c(M("Ava")), "Ava"), 1, "Ava cannot see herself: the world is wrong");
    assert.equal(
      (await rows(c(M("Ava")).from("people").select("id").eq("id", seedPerson))).length,
      0,
      "a signed-in person saw a seeded person",
    );
    assert.equal(
      (await rows(c(M("Ava")).from("pins").select("id").eq("person_id", seedPerson))).length,
      0,
      "a signed-in person saw a seeded pin",
    );
    // anon has no privilege on `people` at all, seeded or not (P03).
    await noAccess(w.anon, "people");

    // And it cuts both ways: the seeded person sees nobody at G.
    assert.equal(await seesPeople(seedSession, "Ava", "Dev", "Eve"), 0, "a seeded person saw real people");
    assert.equal(
      (await rows(seedSession.from("pins").select("id").eq("gathering_id", w.G))).length,
      1,
      "a seeded person should still read their own pin, and nobody else's",
    );

    assert.ok(await serviceRow("people", "id", seedPerson, "id"), "the admin lost the seeded person");
  });

  it("P57 flagging a venue after the fact takes its gatherings with it", async () => {
    const venue = (await ok(w.service.from("venues").insert({ name: `pindhx ${w.run} Late Venue` }).select("id").single())).id;
    const g = (
      await ok(
        w.service
          .from("gatherings")
          .insert({
            name: `pindhx ${w.run} Late Crowd`,
            starts_at: inDays(10),
            venue_id: venue,
            published_at: new Date().toISOString(),
          })
          .select("id")
          .single(),
      )
    ).id;
    assert.equal(await readable(w.anon, g), true, "an ordinary published gathering was not readable");

    await ok(w.service.from("venues").update({ is_seed: true }).eq("id", venue));

    assert.equal(await readable(w.anon, g), false, "the gathering stayed public after its venue was flagged");
    assert.equal((await serviceRow("gatherings", "id", g, "is_seed")).is_seed, true, "the flag did not spread");
  });

  it("P58 no visitor can flag themselves, or unflag a seeded row", async () => {
    await denied(c(M("Ava")).from("people").update({ is_seed: true }).eq("id", id("Ava")), "42501");
    await denied(seedSession.from("people").update({ is_seed: false }).eq("id", seedPerson), "42501");
    await denied(c(M("Ava")).from("gatherings").update({ is_seed: true }).eq("id", w.G), "42501");
  });
});

// ---------------------------------------------------------------------------
// Phase 3 M3.2 — the testers list, a V18 change (Alex, M3.2; on M4.2's review list)
// ---------------------------------------------------------------------------

describe("Testers see the seed gathering while signed in — and nothing else moves (V18, M3.2)", () => {
  let avaUser = "";
  const setTester = (on: boolean) =>
    w.service.rpc("admin_set_tester", { p_auth_user: avaUser, p_on: on, p_actor: ACTOR, p_note: "harness" });

  before(async () => {
    avaUser = (await c(M("Ava")).auth.getUser()).data.user!.id;
    // The seed person from V18's block, opted in at the SEED gathering too.
    await ok(w.service.from("pins").insert({ gathering_id: seedG, person_id: seedPerson, open_to_meeting: true, party_total: 1 }));
    await ok(setTester(true));
  });

  after(async () => {
    await ok(setTester(false));
    await ok(w.service.from("pins").delete().eq("gathering_id", seedG));
  });

  it("P92 a tester CAN read the seed gathering, its venue, spots and options / a signed-in non-tester and anon CANNOT", async () => {
    const ava = c(M("Ava"));
    assert.equal(await readable(ava, seedG), true, "the tester could not read the seed gathering");
    assert.equal((await rows(ava.from("venues").select("id").eq("id", seedVenue))).length, 1, "tester: seed venue");
    assert.equal((await rows(ava.from("meeting_spots").select("id").eq("venue_id", seedVenue))).length, 1, "tester: seed spots");
    for (const client of [w.anon, c(M("Ben"))]) {
      assert.equal(await readable(client, seedG), false, "a non-tester read the seed gathering");
      assert.equal((await rows(client.from("venues").select("id").eq("id", seedVenue))).length, 0, "non-tester: seed venue");
    }
  });

  it("P93 a tester CAN pin at the seed gathering and remove it / a non-tester CANNOT pin there", async () => {
    await denied(
      c(M("Ben")).from("pins").insert({ gathering_id: seedG, person_id: id("Ben"), party_total: 1, open_to_meeting: false }),
      "42501",
    );
    const pin = await ok(
      c(M("Ava")).from("pins").insert({ gathering_id: seedG, person_id: id("Ava"), party_total: 1, open_to_meeting: true }).select("id").single(),
    );
    assert.ok(pin.id, "the tester could not pin at the seed gathering");
  });

  it("P94 a tester opted in at the seed gathering CAN see the seed person opted in there / the seed person stays invisible to non-testers", async () => {
    const ava = c(M("Ava"));
    assert.equal((await rows(ava.from("people").select("id").eq("id", seedPerson))).length, 1, "the tester could not see the seed person");
    assert.equal(
      (await rows(ava.from("pins").select("id").eq("person_id", seedPerson).eq("gathering_id", seedG))).length,
      1,
      "the tester could not see the seed person's pin",
    );
    assert.equal((await rows(c(M("Ben")).from("people").select("id").eq("id", seedPerson))).length, 0, "a non-tester saw the seed person");
  });

  it("P95 a tester gets the seed gathering's counts, seed people counted / anon and a non-tester get no row", async () => {
    const row = await counts(c(M("Ava")), seedG);
    assert.equal(row.open_to_meeting, 2, "the tester's counts should hold Ava and the seed person");
    for (const client of [w.anon, c(M("Ben"))]) {
      assert.equal((await rows(client.rpc("gathering_counts", { gathering_ids: [seedG] }))).length, 0, "a non-tester got seed counts");
    }
  });

  it("P96 no public page changes: the public doors, asked WITH a tester's session, return no seed row", async () => {
    const ava = c(M("Ava"));
    assert.equal((await publicList(ava)).includes(seedGSlug), false, "a tester's week list included the seed gathering");
    assert.equal((await publicDoor(ava, seedGSlug)).status, "gone", "a tester opened the seed crowd page");
  });

  it("P97 nobody can add themselves: the list is service-key only, unreadable to visitors", async () => {
    const ben = c(M("Ben"));
    const benUser = (await ben.auth.getUser()).data.user!.id;
    for (const client of [ben, c(M("Ava")), w.anon]) {
      const add = await client.rpc("admin_set_tester", { p_auth_user: benUser, p_on: true, p_actor: "self", p_note: null });
      assert.ok(add.error, "a visitor ran admin_set_tester");
      const list = await client.rpc("admin_testers");
      assert.ok(list.error, "a visitor read the testers list");
    }
    assert.equal(await readable(ben, seedG), false, "Ben became a tester");
  });

  it("P98 at a REAL gathering a tester sees no seed person, and counts do not move (the seed rule holds there)", async () => {
    // The seed person is pinned and opted in at G (V18's P56); Ava is opted in at G.
    const ava = c(M("Ava"));
    assert.equal(
      (await rows(ava.from("pins").select("id").eq("person_id", seedPerson).eq("gathering_id", w.G))).length,
      0,
      "a tester saw a seed person's pin at a real gathering",
    );
    assert.deepEqual(await counts(ava, w.G), await counts(w.anon, w.G), "a tester's counts at a real gathering differ from anon's");
  });

  it("P99 taking a tester off the list takes the sight away at once — both sides of the flag", async () => {
    await ok(setTester(false));
    const ava = c(M("Ava"));
    assert.equal(await readable(ava, seedG), false, "the seed gathering stayed visible after the flag came off");
    assert.equal((await rows(ava.from("people").select("id").eq("id", seedPerson))).length, 0, "the seed person stayed visible");
    await ok(setTester(true));
    assert.equal(await readable(ava, seedG), true, "putting the flag back did not restore sight");
  });
});


describe("The public web layer reads through one door — M2.1 (W1–W4)", () => {
  it("P59 publishing mints a public URL / a gathering without one is on no public list and has no public page", async () => {
    // The world's published gatherings were inserted straight through the service
    // key, the way the harness builds everything, so none of them has a slug. That
    // is what keeps a harness run off the public web (docs/visibility.md §12f).
    const slugless = await rows(w.service.from("gatherings").select("id, slug").in("id", [w.G, w.C4, w.C5, w.C6]));
    for (const g of slugless) assert.equal(g.slug, null, "a directly-inserted gathering was given a slug");
    const listed = await publicList(w.anon);
    assert.equal(listed.includes(null as unknown as string), false, "a gathering with no slug reached the list");

    // Publishing through the admin action is what mints one.
    publicG = (
      await ok(
        w.service
          .from("gatherings")
          .insert({ name: `pindhx ${w.run} Leafs vs Bruins`, starts_at: inDays(11), venue_id: w.venue })
          .select("id")
          .single(),
      )
    ).id;
    await ok(admin("admin_publish_gathering", { p_gathering: publicG }));
    publicSlug = (await serviceRow("gatherings", "id", publicG, "slug")).slug;
    assert.match(publicSlug, /^pindhx-[a-z0-9]+-leafs-vs-bruins-[a-z]{3}-\d{2}$/, `slug was ${publicSlug}`);

    const door = await publicDoor(w.anon, publicSlug);
    assert.equal(door.status, "ok");
    assert.equal(door.gathering.name, `pindhx ${w.run} Leafs vs Bruins`);
    assert.equal(door.counts.pinned, 0, "honest counts start at zero (H6)");
    assert.ok((await publicList(w.anon)).includes(publicSlug), "the new gathering is not on the week's list");

    // Nothing about a person is in reach of the public door (H1, H3).
    const payload = JSON.stringify(door);
    for (const leak of ["first_name", "instagram", "photo_path", "person_id", "auth_user_id"]) {
      assert.equal(payload.includes(leak), false, `the public door returned ${leak}`);
    }
  });

  it("P60 renaming a URL leaves a 301 behind, and a spent slug is never handed out again", async () => {
    const renamed = `pindhx-${w.run}-leafs-bruins-rematch`;
    await ok(admin("admin_set_slug", { p_gathering: publicG, p_slug: renamed }));

    const old = await publicDoor(w.anon, publicSlug);
    assert.equal(old.status, "redirect", "the old URL stopped redirecting");
    assert.equal(old.slug, renamed);
    assert.equal((await publicDoor(w.anon, renamed)).status, "ok");
    assert.equal((await publicList(w.anon)).includes(publicSlug), false, "the retired slug is still listed");

    // The spent slug cannot be given to another gathering, live or retired.
    const other = (
      await ok(
        w.service
          .from("gatherings")
          .insert({ name: `pindhx ${w.run} Other Crowd`, starts_at: inDays(12), venue_id: w.venue })
          .select("id")
          .single(),
      )
    ).id;
    await ok(admin("admin_publish_gathering", { p_gathering: other }));
    assert.match((await admin("admin_set_slug", { p_gathering: other, p_slug: publicSlug })).error?.message ?? "", /already spent/);
    assert.match((await admin("admin_set_slug", { p_gathering: other, p_slug: renamed })).error?.message ?? "", /already spent/);
    // A published URL can never be taken away.
    await denied(w.service.from("gatherings").update({ slug: null }).eq("id", publicG));
  });

  it("P61 a withdrawn gathering's page says only that it is gone / an unknown slug is gone / neither leaks a fact", async () => {
    const renamed = `pindhx-${w.run}-leafs-bruins-rematch`;
    await ok(admin("admin_withdraw_gathering", { p_gathering: publicG, p_reason: "takedown", p_note: "pindhx request" }));

    const door = await publicDoor(w.anon, renamed);
    assert.equal(door.status, "withdrawn");
    assert.deepEqual(Object.keys(door), ["status"], "the withdrawn page returned more than the word");
    assert.equal((await publicList(w.anon)).includes(renamed), false, "a withdrawn gathering is listed");

    assert.equal((await publicDoor(w.anon, "no-such-crowd-anywhere")).status, "gone");
    assert.equal((await publicDoor(w.anon, "Not A Slug!")).status, "gone");
  });
});

describe("Auto-publishing — M2.2 (spec §8)", () => {
  // The publisher has no privilege Alex's button does not, and publishing is still
  // only ever admin_publish_gathering. These are the refusals that hold whoever
  // calls it, including the service key: they are function and trigger rules, not
  // application code.
  it("P62 a draft CANNOT be published twice, or after dismissal / unpublishing keeps the slug, which is what stops a later run re-publishing it", async () => {
    const g = (
      await ok(
        w.service
          .from("gatherings")
          .insert({ name: `pindhx ${w.run} Auto Candidate`, starts_at: inDays(10), venue_id: w.venue })
          .select("id")
          .single(),
      )
    ).id;

    await ok(admin("admin_publish_gathering", { p_gathering: g }));
    const slug = (await serviceRow("gatherings", "id", g, "slug")).slug;
    assert.ok(slug, "publishing did not mint a slug");
    assert.match((await admin("admin_publish_gathering", { p_gathering: g })).error?.message ?? "", /Already published/);

    // Alex unpublishes: back to draft, and the URL it has been seen at stays on the
    // row forever. A run reads that as "this has been public before" and leaves it
    // alone, so his click cannot be silently undone (Alex, M2.2).
    await ok(admin("admin_unpublish_gathering", { p_gathering: g }));
    const after = await serviceRow("gatherings", "id", g, "status, slug");
    assert.equal(after.status, "draft");
    assert.equal(after.slug, slug, "unpublishing took the slug away");
    await denied(w.service.from("gatherings").update({ slug: null }).eq("id", g));

    // Dismissed: refused until it is restored, whatever a run thinks of its score.
    await ok(admin("admin_dismiss_gathering", { p_gathering: g }));
    assert.match((await admin("admin_publish_gathering", { p_gathering: g })).error?.message ?? "", /Dismissed: restore it first/);
    await ok(admin("admin_restore_gathering", { p_gathering: g }));
    await ok(admin("admin_publish_gathering", { p_gathering: g }));
    assert.equal((await serviceRow("gatherings", "id", g, "slug")).slug, slug, "re-publishing minted a second URL");
  });

  it("P63 marks and promotions are the admin's alone: anon and Ava CANNOT read or write the publishing log, the target log or promotions, and CANNOT call any M2.2 action", async () => {
    const g = (
      await ok(
        w.service
          .from("gatherings")
          .insert({ name: `pindhx ${w.run} Marked`, starts_at: inDays(9), venue_id: w.venue })
          .select("id")
          .single(),
      )
    ).id;
    const targetBefore = (await serviceRow("cities", "slug", "toronto", "publish_target_weekly")).publish_target_weekly;
    await ok(admin("admin_set_publish_mark", { p_gathering: g, p_mark: "never" }));
    assert.equal((await serviceRow("gatherings", "id", g, "publish_mark")).publish_mark, "never");
    await ok(admin("admin_set_publish_mark", { p_gathering: g, p_mark: "" }));
    assert.equal((await serviceRow("gatherings", "id", g, "publish_mark")).publish_mark, null);

    // Promotion is a record of a post, so it needs a published gathering.
    assert.match((await admin("admin_record_promotion", { p_gathering: g, p_channel: "r/leafs", p_note: null })).error?.message ?? "", /published/);
    await ok(admin("admin_publish_gathering", { p_gathering: g }));
    const promotion = await ok(admin("admin_record_promotion", { p_gathering: g, p_channel: "r/leafs", p_note: "pindhx" }));
    assert.equal((await rows(w.service.from("gathering_promotions").select("id").eq("gathering_id", g))).length, 1);

    for (const client of [w.anon, c(M("Ava"))]) {
      for (const table of ["publish_decisions", "publish_target_log", "gathering_promotions", "ops_alerts"]) {
        await noAccess(client, table);
      }
      const calls: [string, Record<string, unknown>][] = [
        ["admin_set_publish_mark", { p_gathering: g, p_mark: "publish", p_actor: "x" }],
        ["admin_record_promotion", { p_gathering: g, p_channel: "r/evil", p_note: null, p_actor: "x" }],
        ["admin_delete_promotion", { p_promotion: promotion, p_actor: "x" }],
        ["admin_publish_outcomes", { p_city: "toronto", p_days: 14 }],
        ["admin_save_publish_settings", { p_city: "toronto", p_settings: { publish_target_weekly: 20 }, p_actor: "x" }],
        ["admin_apply_publish_target", { p_city: "toronto", p_target: 20, p_actor: "x" }],
        // M2.2's operational functions: the health of the import and the alert log
        // are the admin's business, not a visitor's.
        ["admin_import_health", {}],
        ["admin_watchdog_import", {}],
        ["admin_alert_already_sent_today", { p_kind: "import_failed" }],
        ["admin_record_alert", { p_kind: "import_failed", p_subject: "x", p_sent: true, p_error: null }],
      ];
      for (const [fn, args] of calls) await denied(client.rpc(fn, args), "42501");
    }

    // Nothing a visitor tried changed anything.
    assert.equal((await serviceRow("gatherings", "id", g, "publish_mark")).publish_mark, null);
    // Asserts the visitor changed nothing, rather than naming a number: the target is
    // a setting Alex moves, and a test that hard-codes it fails the day he does (it
    // did, when 5 became 50).
    assert.equal((await serviceRow("cities", "slug", "toronto", "publish_target_weekly")).publish_target_weekly, targetBefore);
    assert.equal((await rows(w.service.from("gathering_promotions").select("id").eq("gathering_id", g))).length, 1);

    // Removing the last record makes it organic again, which is the honest state if
    // it was never posted.
    await ok(admin("admin_delete_promotion", { p_promotion: promotion }));
    assert.equal((await rows(w.service.from("gathering_promotions").select("id").eq("gathering_id", g))).length, 0);
  });
});

describe("The import watchdog follows the schedule — M2.2", () => {
  // Alex, M2.2: the threshold must be relative to the import's own schedule, not to a
  // fixed hour, so that a changed cron line — or a wrong assumption about which
  // timezone Cloudflare cron triggers use — cannot produce a phantom alarm every day
  // before the import has had a chance to run. An alerting rule that fires when
  // nothing is wrong is worse than no rule.
  it("P64 the due time moves with the cron, nothing is called missed inside its grace, and the schedule is restored afterwards", async () => {
    const before = await ok(
      w.service
        .from("ops_import_schedule")
        .select("cron, utc_hour, utc_minute, grace_minutes, reported_cron, reported_scheduled_time, reported_at")
        .eq("id", true)
        .single(),
    );

    try {
      // The exact case that would have cried wolf: a schedule three hours later than
      // the watchdog's old fixed hour.
      await ok(admin2("admin_report_import_schedule", { p_cron: "0 12 * * *", p_scheduled_time: new Date().toISOString() }));
      const noon = await ok(w.service.rpc("admin_import_due"));
      assert.equal(noon.due_at.slice(11, 16), "12:00", "the due time did not follow the cron");
      assert.equal(noon.cron, "0 12 * * *");

      // Back to what wrangler.jsonc says, and the due time follows again.
      await ok(admin2("admin_report_import_schedule", { p_cron: "0 8 * * *", p_scheduled_time: new Date().toISOString() }));
      const eight = await ok(w.service.rpc("admin_import_due"));
      assert.equal(eight.due_at.slice(11, 16), "08:00");

      // Late is not missed. With a full day of grace nothing is overdue, whatever the
      // last run did, so the watchdog stays quiet.
      await ok(w.service.from("ops_import_schedule").update({ grace_minutes: 1440 }).eq("id", true));
      const inGrace = await ok(w.service.rpc("admin_import_due"));
      assert.equal(inGrace.past_grace, false, "a run still inside its grace was treated as overdue");
      assert.equal((await ok(w.service.rpc("admin_import_health"))).stale, false, "stale while still inside the grace");
      assert.equal((await ok(w.service.rpc("admin_watchdog_import"))).missed, false, "the watchdog cried wolf inside the grace");

      // A cron shape it cannot parse leaves the stored schedule alone rather than
      // guessing at one nobody can check.
      await ok(admin2("admin_report_import_schedule", { p_cron: "*/5 * * * *", p_scheduled_time: new Date().toISOString() }));
      assert.equal((await ok(w.service.rpc("admin_import_due"))).due_at.slice(11, 16), "08:00", "an unparsable cron moved the due time");
    } finally {
      // Including reported_cron and reported_scheduled_time: the Configuration page
      // shows those as "last fired by Cloudflare", so a harness run that left its own
      // values there would have the admin quietly reporting a fiction.
      await ok(w.service.from("ops_import_schedule").update(before).eq("id", true));
    }

    const after = await ok(
      w.service
        .from("ops_import_schedule")
        .select("cron, utc_hour, utc_minute, grace_minutes, reported_cron, reported_scheduled_time, reported_at")
        .eq("id", true)
        .single(),
    );
    assert.deepEqual(after, before, "the harness left the import schedule changed");
  });
});

let publicSlug2: string;

describe("The public door's shape — the keys its readers need", () => {
  before(async () => {
    const g = await ok(
      w.service
        .from("gatherings")
        .insert({ name: `pindhx ${w.run} Shape Check`, starts_at: inDays(9), venue_id: w.venue })
        .select("id")
        .single(),
    );
    await ok(admin("admin_publish_gathering", { p_gathering: g.id }));
    publicSlug2 = (await serviceRow("gatherings", "id", g.id, "slug")).slug;
  });

  // Written after I broke it (decisions.md, "create or replace ... is a silent
  // revert"). Rewriting public_gathering from a superseded definition dropped
  // map_key, map_ready, the spots' active filter and the gender-mix counts, and
  // **nothing caught it**: the function returns jsonb, so a missing key is not a type
  // error; the unit tests do not call it; and the rest of this harness asks what a
  // visitor may *see* rather than what a page is handed. It showed only when somebody
  // loaded a page and the map was a drawing.
  //
  // So this names every key src/public/data.ts reads. It is deliberately about
  // presence, not values — the values are the other sixty-odd cases' business.
  it("P65 public_gathering returns every key the crowd page reads, and public_gatherings every column the list reads", async () => {
    const door = await publicDoor(w.anon, publicSlug2);
    assert.equal(door.status, "ok", `the door said ${door.status}`);

    const want = {
      gathering: ["id", "slug", "name", "starts_at", "ends_at", "effective_end", "entry", "door_price_cents", "entry_note", "category", "source", "event_url"],
      venue: ["id", "name", "address", "latitude", "longitude", "map_image_path", "map_key", "map_ready", "map_spots", "city_name", "timezone"],
      counts: ["pinned", "open_to_meeting", "women", "men", "other", "crews_open"],
    };
    for (const [section, keys] of Object.entries(want)) {
      const got = Object.keys(door[section] ?? {});
      for (const k of keys) assert.ok(got.includes(k), `public_gathering's ${section} is missing "${k}" — got ${got.join(", ")}`);
    }
    // map_ready is the one whose *type* matters: isReady() calls .includes on it, and
    // an object rather than an array fails silently into "no map".
    assert.ok(Array.isArray(door.venue.map_ready), "venue.map_ready must be an array");
    // map_spots is the input to chooseZoom, which decides the map's zoom AND the key
    // its picture is stored under. An object instead of an array, or a missing
    // coordinate, silently sends every venue back to the widest frame (M2.3).
    assert.ok(Array.isArray(door.venue.map_spots), "venue.map_spots must be an array");
    for (const s of door.venue.map_spots) {
      assert.ok("latitude" in s && "longitude" in s, "a map_spots entry has no coordinates");
      assert.ok(s.latitude !== null && s.longitude !== null, "map_spots must not carry a spot with no coordinates");
    }
    assert.ok(Array.isArray(door.spots), "spots must be an array");
    for (const s of door.spots) {
      for (const k of ["name", "description", "latitude", "longitude", "walk_minutes", "meet_at"]) {
        assert.ok(k in s, `a spot is missing "${k}"`);
      }
    }

    const listed = await rows(w.anon.rpc("public_gatherings", { p_from: inDays(-90), p_to: inDays(90), p_city: "toronto" }));
    assert.ok(listed.length > 0, "the list came back empty, so its shape proves nothing");
    for (const k of ["slug", "name", "starts_at", "ends_at", "entry", "door_price_cents", "entry_note", "category", "signup_required", "source", "venue_id", "venue_name", "city_name", "city_timezone", "pinned", "open_to_meeting", "crews_open"]) {
      assert.ok(k in listed[0], `public_gatherings is missing "${k}" — got ${Object.keys(listed[0]).join(", ")}`);
    }
  });

  // M2.3 — the chip a Ticketmaster gathering wears, and the one rule that governs it.
  //
  // The rule lives in the database (public.chip_category) because two things have to
  // apply it and must never disagree: the nightly import, for every draft it creates,
  // and the one-off backfill for everything already here. This case is that rule's
  // only test bed, so it proves all four branches and the lifecycle Alex fixed:
  // **set once at draft, never overwritten** — an admin edit is final.
  it("P66 a Ticketmaster listing gets the chip its own classification implies, once, and never again", async () => {
    const draft = w.D.ticketmaster;
    const setSnapshot = async (category: string | null) =>
      ok(
        w.service
          .from("gathering_sources")
          .update({ snapshot: category === null ? {} : { category } })
          .eq("gathering_id", draft)
          .eq("source", "ticketmaster"),
        "set the snapshot",
      );
    const clear = async () => ok(w.service.from("gatherings").update({ category: null }).eq("id", draft), "clear the chip");
    const categoryNow = async (): Promise<string | null> =>
      (await ok(w.service.from("gatherings").select("category").eq("id", draft).single(), "read the chip")).category;

    // Music of every kind is one chip, because the feed cannot tell a DJ night from a
    // gig — the same rooms host both, measured (decisions.md).
    for (const [classification, chip] of [
      ["Music / Rock", "live_music"],
      ["Music / Dance/Electronic", "live_music"],
      ["Sports / Hockey", "sport"],
      ["Arts & Theatre / Comedy", "comedy"],
    ] as const) {
      await setSnapshot(classification);
      await clear();
      await ok(w.service.rpc("admin_categorise_gatherings"), "categorise");
      assert.equal(await categoryNow(), chip, `${classification} should be ${chip}`);
    }

    // Theatre, classical, opera, lectures: no chip, and the row stays on every
    // unfiltered list. Null is a real answer, not a gap.
    for (const classification of ["Arts & Theatre / Theatre", "Arts & Theatre / Classical", "Miscellaneous / Lecture/Seminar"]) {
      await setSnapshot(classification);
      await clear();
      await ok(w.service.rpc("admin_categorise_gatherings"), "categorise");
      assert.equal(await categoryNow(), null, `${classification} should wear no chip`);
    }

    // Set once, never overwritten: Alex's own edit survives a listing whose genre
    // says something else, and survives every night afterwards.
    await setSnapshot("Music / Rock");
    await ok(w.service.from("gatherings").update({ category: "games" }).eq("id", draft), "hand-set the chip");
    await ok(w.service.rpc("admin_categorise_gatherings"), "categorise");
    assert.equal(await categoryNow(), "games", "the importer overwrote a chip somebody had chosen");

    // A second pass writes nothing at all, which is what makes it safe nightly.
    const again = await ok(w.service.rpc("admin_categorise_gatherings"), "categorise again");
    assert.equal(again, 0, `a second pass rewrote ${again} rows`);

    // Neither function is a visitor's to call, signed in or not.
    await denied(w.anon.rpc("chip_category", { p_classification: "Music / Rock" }), "42501");
    await denied(w.anon.rpc("admin_categorise_gatherings"), "42501");
    await denied(c(w.m.Dev).rpc("admin_categorise_gatherings"), "42501");
  });
});

// ---------------------------------------------------------------------------
// V17 — the Instagram handle (Alex, M3.1). Two branches: a crewmate, or a
// connection. A solo-plan partner is a crewmate (`kind = 'solo'`, M3.4), so it
// needs no branch of its own; M3.4 adds the column and the case that proves it.
//
// Crews and connections have no screens yet (M3.3, M3.4), so these rows are made
// with the service key. That is honest for this rule: V17 asks who shares a crew
// and who is connected, and never whether anybody is pinned.
// ---------------------------------------------------------------------------

describe("Instagram handles — V17 (Alex, M3.1)", () => {
  const handleSeen = async (viewer: SupabaseClient, target: string): Promise<string | null> => {
    const r = await rows(viewer.from("person_handles").select("instagram").eq("person_id", id(target)));
    return r.length === 0 ? null : r[0].instagram;
  };

  // A crew at `gathering` with these people in it. Returns the crew id.
  const crewOf = async (gathering: string, names: string[]): Promise<string> => {
    const crew = await ok(
      w.service.from("crews").insert({ gathering_id: gathering }).select("id").single(),
      "make a crew",
    );
    for (const name of names) {
      await ok(
        w.service.from("crew_members").insert({ crew_id: crew.id, gathering_id: gathering, person_id: id(name) }),
        `put ${name} in the crew`,
      );
    }
    return crew.id;
  };

  it("P67 the open list is NOT enough: Ava CAN see Ben at G but CANNOT read his handle / each CAN read and edit their own / anon has no access at all", async () => {
    const ava = c(M("Ava"));
    const ben = c(M("Ben"));
    assert.equal(await seesPeople(ava, "Ben"), 1, "Ava can see Ben — this case is only meaningful if she can");

    assert.equal(await handleSeen(ava, "Ben"), null, "the open list leaked a handle");
    assert.equal(await handleSeen(ben, "Ava"), null, "the open list leaked a handle");

    // Their own, always — read and write.
    assert.equal(await handleSeen(ava, "Ava"), handleFor(w.run, "Ava"));
    await ok(ava.from("person_handles").update({ instagram: handleFor(w.run, "Ava") }).eq("person_id", id("Ava")), "edit own");
    // Never anyone else's. An update or delete the policy refuses matches no row
    // rather than raising, so the proof is that nothing changed.
    const edited = await rows(ava.from("person_handles").update({ instagram: "stolen" }).eq("person_id", id("Ben")).select("person_id"));
    assert.equal(edited.length, 0, "Ava edited Ben's handle");
    const removed = await rows(ava.from("person_handles").delete().eq("person_id", id("Ben")).select("person_id"));
    assert.equal(removed.length, 0, "Ava deleted Ben's handle");
    await denied(ava.from("person_handles").insert({ person_id: id("Cal"), instagram: "planted" }), "42501");
    assert.equal(
      (await serviceRow("person_handles", "person_id", id("Ben"), "instagram")).instagram,
      handleFor(w.run, "Ben"),
      "Ben's handle was changed by someone else",
    );

    await noAccess(w.anon, "person_handles");
  });

  it("P68 a crewmate CAN read it / leaving the crew ends it", async () => {
    const ava = c(M("Ava"));
    const ben = c(M("Ben"));
    const crew = await crewOf(w.G, ["Ava", "Ben"]);

    assert.equal(await handleSeen(ava, "Ben"), handleFor(w.run, "Ben"));
    assert.equal(await handleSeen(ben, "Ava"), handleFor(w.run, "Ava"));

    // Leaving is what ends it — not the crew's state (Alex, M3.1: a crew is a crew
    // whatever its state, forming through dissolved).
    await ok(
      w.service.from("crew_members").update({ left_at: new Date().toISOString() }).eq("crew_id", crew).eq("person_id", id("Ben")),
      "Ben leaves",
    );
    assert.equal(await handleSeen(ava, "Ben"), null, "a departed crewmate's handle stayed readable");
    assert.equal(await handleSeen(ben, "Ava"), null, "someone who left kept reading handles");

    // A dissolved crew still counts (Alex, M3.1): Ben is back in, the crew dissolves,
    // and the handle is still there. The state never decides this; leaving does.
    await ok(
      w.service.from("crew_members").update({ left_at: null }).eq("crew_id", crew).eq("person_id", id("Ben")),
      "Ben rejoins",
    );
    await ok(
      w.service.from("crews").update({ state: "dissolved", dissolved_at: new Date().toISOString() }).eq("id", crew),
      "dissolve it",
    );
    assert.equal(await handleSeen(ava, "Ben"), handleFor(w.run, "Ben"), "a dissolved crew should still count");
  });

  it("P69 a connection CAN read it even with no gathering in common / and, since V23, each other's row", async () => {
    const ava = c(M("Ava"));
    const cal = c(M("Cal"));
    // Cal is pinned at G but not opted in, so V1 denies both of them, in both
    // directions (P12). The connection branch is independent of V1 by design.
    assert.equal(await seesPeople(ava, "Cal"), 0);
    assert.equal(await seesPeople(cal, "Ava"), 0);

    const pair = [id("Ava"), id("Cal")].sort();
    await ok(w.service.from("connections").insert({ person_a: pair[0], person_b: pair[1] }), "connect them");

    assert.equal(await handleSeen(ava, "Cal"), handleFor(w.run, "Cal"));
    assert.equal(await handleSeen(cal, "Ava"), handleFor(w.run, "Ava"));
    // V23 (M3.3, Alex, 29 Sept): a connection now sees the person too — first name and
    // photo, outside any gathering. Until then this line asserted the opposite.
    assert.equal(await seesPeople(ava, "Cal"), 1, "a connection could not see the person (V23)");
    assert.equal(await seesPeople(cal, "Ava"), 1, "a connection could not see the person (V23)");
    // The world goes back as it was for the cases after this one.
    await ok(w.service.from("connections").delete().eq("person_a", pair[0]).eq("person_b", pair[1]), "unconnect them");
    assert.equal(await seesPeople(ava, "Cal"), 0, "a removed connection still showed the person");
  });

  it("P70 a pending invite is not a crewmate / a block and a moderation hide both override the crew branch", async () => {
    // Join requests went with the room design (M3.3); an invite not yet accepted is its
    // successor and, like a request before it, makes nobody a crewmate.
    const crew = await crewOf(w.G, ["Dee"]);
    await ok(w.service.from("crew_invites").insert({ crew_id: crew, gathering_id: w.G, from_person: id("Dee"), to_person: id("Hana") }), "Dee invites Hana");
    assert.equal(await handleSeen(c(M("Hana")), "Dee"), null, "someone invited read a member's handle");
    assert.equal(await handleSeen(c(M("Dee")), "Hana"), null, "a member read an invitee's handle");

    // Gus blocked Hal in P14. Being in a crew together does not undo a block (V4).
    await crewOf(w.H, ["Gus", "Hal"]);
    assert.equal(await handleSeen(c(M("Gus")), "Hal"), null, "a block did not stop a handle");
    assert.equal(await handleSeen(c(M("Hal")), "Gus"), null, "a block did not stop a handle");

    // Ivy1 is hidden by moderation (P45). Hidden works in both directions.
    await crewOf(w.C4, ["Ava", "Ivy1"]);
    assert.equal(await handleSeen(c(M("Ava")), "Ivy1"), null, "a hidden person's handle was readable");
    assert.equal(await handleSeen(c(M("Ivy1")), "Ava"), null, "a hidden person read a handle");
  });
});

// ---------------------------------------------------------------------------
// V6 rewritten — the automated photo check (Alex, M3.1). Three outcomes, and the
// two that hide a photo are not the same state: "we could not tell" waits for a
// human, "we refused it" is a decision. Neither ever hides the PERSON.
// ---------------------------------------------------------------------------

describe("The photo check — V6 (Alex, M3.1)", () => {
  // Inverted in M3.1 ("nothing waits on the check"): a possible minor is a note to
  // Alex, not a verdict, so the photo stays visible while it waits in his queue.
  it("P71 a photo flagged for a human stays visible / its owner still sees it / the person stays visible", async () => {
    const eve = M("Eve");
    await ok(w.service.from("people").update({ photo_status: "needs_review" }).eq("id", eve.personId), "needs review");
    await canSign(c(M("Ava")), eve.photoPath);
    await canSign(c(eve), eve.photoPath);
    // The person is never hidden by any photo state (V6). That is the whole point of
    // a rejected photo leaving someone visible without one.
    assert.equal(await seesPeople(c(M("Ava")), "Eve"), 1, "a photo state hid the person");
    await ok(w.service.from("people").update({ photo_status: "approved" }).eq("id", eve.personId), "restore");
    await canSign(c(M("Ava")), eve.photoPath);
  });

  it("P72 the check's own record is the service key's alone / nobody else can record a check, read one, or ask for the counts", async () => {
    await noAccess(w.anon, "photo_checks");
    await noAccess(c(M("Ava")), "photo_checks");
    await denied(w.anon.rpc("admin_photo_states"), "42501");
    await denied(c(M("Ava")).rpc("admin_photo_states"), "42501");
    for (const client of [w.anon, c(M("Ava"))]) {
      await denied(
        client.rpc("admin_record_photo_check", {
          p_person: id("Ava"),
          p_photo_path: M("Ava").photoPath,
          p_outcome: "approved",
          p_source: "app",
        }),
        "42501",
      );
    }
    // And the admin function still refuses to leave a photo undecided — "needs_review"
    // is what the human was asked to resolve, not an answer they may give back.
    await denied(
      w.service.rpc("admin_set_photo_status", {
        p_person: id("Eve"),
        p_photo_path: M("Eve").photoPath,
        p_status: "needs_review",
        p_actor: ACTOR,
      }),
    );
  });

  it("P73 a failed check decides nothing, leaves a record, and is counted apart from a photo nothing has looked at", async () => {
    const rex = M("Rex");
    const before = await ok(w.service.rpc("admin_photo_states"), "counts before");
    // A check that errored: recorded, and the photo does not move.
    const applied = await ok(
      w.service.rpc("admin_record_photo_check", {
        p_person: rex.personId,
        p_photo_path: rex.photoPath,
        p_outcome: "failed",
        p_source: "webhook",
        p_error: "the call stopped early",
        p_cost: "0.020000",
      }),
      "record a failure",
    );
    assert.equal(applied, null, "a failed check moved the photo");
    assert.equal((await serviceRow("people", "id", rex.personId, "photo_status")).photo_status, "rejected");

    // Its cost still counts against the day, because it was still billed. A job whose
    // spend is invisible to the cap turns a hard cap into a suggestion (M2.3).
    const spend = await ok(w.service.rpc("admin_ai_spend_today", { p_city: "toronto" }), "spend");
    assert.ok(Number(spend) >= 0.02, `the failed check's $0.02 is missing from the day (${spend})`);

    // And a check about a photo the person has already replaced is recorded and moves
    // nothing — the stale-photo rule, the same one the admin's own button follows.
    const stale = await ok(
      w.service.rpc("admin_record_photo_check", {
        p_person: rex.personId,
        p_photo_path: `${rex.authId}/gone.png`,
        p_outcome: "approved",
        p_source: "webhook",
      }),
      "record a stale check",
    );
    assert.equal(stale, null, "a check about a replaced photo decided something");
    assert.ok(Array.isArray(before), "admin_photo_states returns a row");
  });
});

// ---------------------------------------------------------------------------
// V19 — a person's three tags (Alex, M3.1). They ride V1 rather than inventing a
// stricter rule: a tag is a conversation handle chosen in order to be read by the
// people on the list with you, so it travels with the first name.
// ---------------------------------------------------------------------------

describe("Tags — V19 (Alex, M3.1)", () => {
  const tagsSeen = (viewer: SupabaseClient, target: string) =>
    rows(viewer.from("person_tags").select("tag").eq("person_id", id(target)));

  it("P74 the vocabulary is public and read-only / anon CAN read the fifteen tags and CANNOT write one", async () => {
    const all = await rows(w.anon.from("tags").select("slug"));
    assert.ok(all.length >= 15, `expected the seeded vocabulary, got ${all.length}`);
    assert.ok(
      all.some((t: any) => t.slug === "not-drinking"),
      "the seed is missing",
    );
    await denied(w.anon.from("tags").insert({ slug: "made-up", name: "made up", sort_order: 99 }), "42501");
    await denied(c(M("Ava")).from("tags").insert({ slug: "made-up", name: "made up", sort_order: 99 }), "42501");
    // A person's tags are never anon's, vocabulary or not.
    await noAccess(w.anon, "person_tags");
  });

  it("P75 Ava CAN read Ben's tags, because she can see Ben / Cal CANNOT, because he cannot", async () => {
    await ok(
      w.service.from("person_tags").insert([
        { person_id: id("Ben"), tag: "usually-go-alone" },
        { person_id: id("Ben"), tag: "not-drinking" },
        { person_id: id("Ben"), tag: "here-for-the-support-act" },
      ]),
      "Ben picks three",
    );
    assert.equal(await seesPeople(c(M("Ava")), "Ben"), 1, "this case only means something if Ava can see Ben");
    assert.equal((await tagsSeen(c(M("Ava")), "Ben")).length, 3);
    // Cal is pinned but not opted in, so V1 denies him the person — and the tags with
    // them, at the same door rather than a second one.
    assert.equal(await seesPeople(c(M("Cal")), "Ben"), 0);
    assert.equal((await tagsSeen(c(M("Cal")), "Ben")).length, 0);
  });

  it("P76 a blocked person and a hidden person CANNOT read them, in both directions / the owner always CAN", async () => {
    // Gus blocked Hal in P14; Ivy1 is hidden by moderation (P45).
    await ok(w.service.from("person_tags").insert({ person_id: id("Hal"), tag: "up-for-whatever" }), "Hal picks one");
    await ok(w.service.from("person_tags").insert({ person_id: id("Ivy1"), tag: "up-for-whatever" }), "Ivy1 picks one");
    assert.equal((await tagsSeen(c(M("Gus")), "Hal")).length, 0, "a block did not stop tags");
    assert.equal((await tagsSeen(c(M("Hal")), "Gus")).length, 0, "a block did not stop tags");
    assert.equal((await tagsSeen(c(M("Ava")), "Ivy1")).length, 0, "a hidden person's tags were readable");
    // Their own, whatever anyone else can see.
    assert.equal((await tagsSeen(c(M("Hal")), "Hal")).length, 1);
    assert.equal((await tagsSeen(c(M("Ivy1")), "Ivy1")).length, 1);
  });

  it("P77 a person writes only their own, at most TEN, three of them on the list, and both caps are the database's not the screen's", async () => {
    const ava = c(M("Ava"));
    // Ten is the cap (Alex, after the A3 walk; it was three until the list grew to
    // 32). "At least three" stays a rule on the screen, because the link path pins
    // with none and a database minimum would make a pin impossible.
    const ten = [
      "chatty", "will-talk-to-anyone", "good-listener", "dont-mind-the-quiet", "takes-a-minute-to-warm-up",
      "happy-to-explain", "the-hype-person", "knows-all-the-good-spots", "up-for-whatever", "always-slightly-late",
    ];
    for (const tag of ten) {
      await ok(ava.from("person_tags").insert({ person_id: id("Ava"), tag }), `pick ${tag}`);
    }
    // The ELEVENTH is refused by the database, not by a form. P77 asserted a fourth
    // until the rules changed; inverted rather than deleted, so the cap moving is
    // visible in the history.
    await denied(ava.from("person_tags").insert({ person_id: id("Ava"), tag: "not-drinking" }));
    // Removing one makes room again: this is a cap, not a quota spent once.
    await ok(ava.from("person_tags").delete().eq("person_id", id("Ava")).eq("tag", "chatty"), "remove one");
    await ok(ava.from("person_tags").insert({ person_id: id("Ava"), tag: "not-drinking" }), "and add another");

    // Three of them show on the list, and that cap is the database's too. It is not
    // a visibility rule: every tag is readable by anyone V19 allows either way.
    for (const tag of ten.slice(1, 4)) {
      await ok(ava.from("person_tags").update({ on_list: true }).eq("person_id", id("Ava")).eq("tag", tag), `feature ${tag}`);
    }
    await denied(ava.from("person_tags").update({ on_list: true }).eq("person_id", id("Ava")).eq("tag", "not-drinking"));

    // Never anyone else's, in either verb.
    await denied(ava.from("person_tags").insert({ person_id: id("Ben"), tag: "up-for-whatever" }), "42501");
    const removed = await rows(ava.from("person_tags").delete().eq("person_id", id("Ben")).select("tag"));
    assert.equal(removed.length, 0, "Ava deleted Ben's tags");
    assert.equal((await tagsSeen(c(M("Ava")), "Ben")).length, 3, "Ben's three are untouched");

    // And a slug that is not in the vocabulary is not a tag.
    await denied(ava.from("person_tags").insert({ person_id: id("Ava"), tag: "invented-slug" }));
  });
});

// ---------------------------------------------------------------------------
// A23's two halves — the export reads as you, and delete takes the right things
// (Alex, M3.1). V9 is extended, not loosened: a reporter reads their own reason
// and date and nothing the moderator wrote.
// ---------------------------------------------------------------------------

describe("Export and delete — A23 (Alex, M3.1)", () => {
  it("P78 a reporter CAN read their own reason and date / CANNOT read the outcome / nobody else CAN read it at all", async () => {
    // Ava filed on Ivy1 and Ivy2 earlier in this run (P34, P35), so these are real
    // rows rather than ones this case arranged for itself.
    const ava = c(M("Ava"));
    const mine = await rows(ava.from("reports").select("id, target_kind, reason, created_at"));
    assert.ok(mine.length >= 2, `a reporter cannot read the reports they filed (${mine.length})`);
    assert.ok(mine.every((r: any) => r.reason && r.created_at && r.target_kind === "person"));

    // The moderator's half stays shut, and it is the column grant that shuts it:
    // `auto_hidden` would tell a reporter their report hid someone (H9).
    for (const column of ["status", "decision_note", "reviewed_at", "is_safety", "reported_content_snapshot", "reporter_id", "target_person_id"]) {
      await denied(ava.from("reports").select(column), "42501");
    }
    // Not the target's, not a stranger's, not anon's. Ivy2 was reported by Ava and
    // by Dev, and reads nothing at all.
    assert.equal((await rows(c(M("Ivy2")).from("reports").select("id, reason"))).length, 0, "the target read a report about them");
    // Dee has filed nothing all run, which is what makes her the bystander here —
    // Ben filed one in P35, so he would be reading his own and proving nothing.
    assert.equal((await rows(c(M("Dee")).from("reports").select("id, reason"))).length, 0, "a bystander read someone's report");
    await noAccess(w.anon, "reports");
  });

  it("P79 deleting a person takes what is keyed to them and leaves what outlives them", async () => {
    // A person of this case's own, so nothing else in the world depends on them.
    const authId = (await ok(
      w.service.auth.admin.createUser({ email: `${PREFIX}-gone-${w.run}@example.com`, email_confirm: true, app_metadata: { pind_harness: true } }),
      "make a user",
    )).user.id;
    const person = await ok(
      w.service.from("people").insert({ auth_user_id: authId, first_name: "Gone" }).select("id").single(),
      "make a person",
    );
    await ok(w.service.from("person_handles").insert({ person_id: person.id, instagram: handleFor(w.run, "gone") }), "handle");
    await ok(w.service.from("people_private").insert({ person_id: person.id, gender: "man", birth_year: 1994 }), "private");
    await ok(w.service.from("person_tags").insert({ person_id: person.id, tag: "up-for-whatever" }), "a tag");
    await ok(w.service.from("pins").insert({ gathering_id: w.G, person_id: person.id, open_to_meeting: true }), "a pin");
    await ok(
      w.service.from("reports").insert({ reporter_id: person.id, target_kind: "person", target_person_id: id("Ava"), reason: "spam" }),
      "a report they filed",
    );
    await ok(
      w.service.from("moderation_log").insert({ actor: ACTOR, action: "account_deleted", person_id: person.id }),
      "the log row the delete writes first",
    );

    await ok(w.service.from("people").delete().eq("id", person.id), "delete the person");

    // Gone, by cascade.
    for (const table of ["person_handles", "people_private", "person_tags"]) {
      assert.equal((await rows(w.service.from(table).select("person_id").eq("person_id", person.id))).length, 0, `${table} survived`);
    }
    assert.equal((await rows(w.service.from("pins").select("id").eq("person_id", person.id))).length, 0, "a pin survived");

    // Kept, with the person reference nulled — a safety record must not disappear
    // because somebody deleted an account.
    const report = await rows(w.service.from("reports").select("id, reporter_id, reason").eq("target_person_id", id("Ava")).eq("reason", "spam"));
    assert.ok(report.some((r: any) => r.reporter_id === null), "the report they filed was deleted with them");

    // And the log, which has no foreign keys precisely so it outlives the row.
    const log = await rows(w.service.from("moderation_log").select("action").eq("person_id", person.id));
    assert.ok(log.some((l: any) => l.action === "account_deleted"), "the deletion left no record");

    await removeUser(w.service, authId);
  });
});

// ---------------------------------------------------------------------------
// The sequence the app actually performs — P80 (M3.1).
//
// **Why this case exists.** Every policy A2 touches had a passing test, and A2 still
// could not save a profile. The harness proved that a person MAY write their own
// rows; it never performed the writes IN THE ORDER AND SHAPE the screen performs
// them, so an `upsert` against a table deliberately granted INSERT on five columns
// and UPDATE on two went unnoticed — Postgres checks the DO UPDATE clause's
// privileges statically, so the first insert of a brand-new person was refused for
// an update branch that would never run.
//
// So this is not another policy case. It is the screen's sequence, run as a real
// signed-in person: the thing `tests/unit/door.test.ts` does for public reads, done
// for the first-run writes.
// ---------------------------------------------------------------------------

describe("A person sets themselves up — the app's own sequence (M3.1)", () => {
  it("P80 sign in, create the person, the private row, a neighbourhood, three tags and a handle — twice, because the second time is the update path", async () => {
    const client = newClient(w.env, w.env.publishableKey);
    const signedIn = await client.auth.signInAnonymously({ options: { data: { harness: PREFIX } } });
    assert.equal(signedIn.error, null, signedIn.error?.message);
    const authId = signedIn.data.user!.id;
    await markHarness(w.service, authId);

    // --- A2, first run: no rows exist yet.
    const person = await ok(
      client.from("people").insert({ auth_user_id: authId, first_name: "Setup" }).select("id").single(),
      "A2 creates the person",
    );
    await ok(
      client.from("people_private").insert({
        person_id: person.id,
        gender: "man",
        include_in_women_only: false,
        birth_year: 1995,
        age_attested_at: new Date().toISOString(),
      }),
      "A2 writes the private row",
    );

    // --- A3.
    await ok(client.from("people").update({ neighbourhood: "king-west" }).eq("id", person.id), "A3 saves a neighbourhood");
    await ok(
      client.from("person_tags").insert(
        ["new-in-town", "not-drinking", "up-for-whatever"].map((tag) => ({ person_id: person.id, tag })),
      ),
      "A3 saves three tags",
    );

    // --- A21.
    await ok(
      client.from("person_handles").insert({ person_id: person.id, instagram: handleFor(w.run, "setup") }),
      "A21 adds a handle",
    );

    // --- Coming back and changing what CAN be changed. This half is what the upsert
    // was standing in for, and it has to work through the narrower update grants.
    await ok(client.from("people").update({ first_name: "Setup2" }).eq("id", person.id), "edit the name");
    await ok(
      client.from("people_private").update({ gender: "woman", include_in_women_only: false }).eq("person_id", person.id),
      "change gender",
    );
    await ok(
      client.from("person_handles").update({ instagram: handleFor(w.run, "setup2") }).eq("person_id", person.id),
      "change the handle",
    );
    await ok(client.from("person_tags").delete().eq("person_id", person.id), "clear the tags");
    await ok(
      client.from("person_tags").insert([{ person_id: person.id, tag: "chatty" }]),
      "and pick again",
    );

    // --- And the two things the grants deliberately refuse, so the narrowness that
    // caused the bug is also the thing being protected.
    // Refused outright rather than quietly matching no rows: a column with no UPDATE
    // grant is a privilege error, which is the stronger of the two behaviours and the
    // one worth pinning down.
    await denied(client.from("people_private").update({ birth_year: 2010 }).eq("person_id", person.id), "42501");
    assert.equal(
      (await serviceRow("people_private", "person_id", person.id, "birth_year")).birth_year,
      1995,
      "the birth year moved",
    );
    await denied(client.from("people").update({ photo_status: "approved" }).eq("id", person.id), "42501");

    await ok(client.from("person_handles").delete().eq("person_id", person.id), "remove the handle");
    await w.service.from("people").delete().eq("id", person.id);
    await removeUser(w.service, authId);
  });
});

// ---------------------------------------------------------------------------
// A rescore never overrules a person — P81 (M3.1).
//
// **This case exists because the guard silently did not work.** It was written
// `like 'photo\_%'` with one backslash too many, which in a standard-conforming
// string matches a literal backslash and therefore nothing at all — so every photo
// looked undecided and the first real rescore overwrote four decisions Alex had made
// by hand minutes earlier.
//
// It went unnoticed because **a guard that passes and a guard that never ran look
// identical from outside**: both report "now approved". So the rule gets a case that
// puts a human decision in front of a rescore and insists the status does not move.
// A safety rule with no test proving it fires is a comment.
// ---------------------------------------------------------------------------

describe("Re-judging after a rubric change — P81 (M3.1)", () => {
  it("P81 a rescore records its verdict always, moves a photo the check itself decided, and refuses to move one a person decided", async () => {
    const eve = M("Eve");
    const path = eve.photoPath!;

    // 1. A photo whose last decision was the check's own: the rescore may move it.
    await ok(w.service.from("people").update({ photo_status: "pending" }).eq("id", eve.personId), "back to pending");
    await ok(
      w.service.rpc("admin_record_photo_check", {
        p_person: eve.personId,
        p_photo_path: path,
        p_outcome: "needs_review",
        p_source: "webhook",
        p_reason: "the old rubric held it",
      }),
      "the check decides",
    );
    const moved = await ok(
      w.service.rpc("admin_rescore_photo", {
        p_person: eve.personId,
        p_photo_path: path,
        p_outcome: "approved",
        p_reason: "the new rubric approves it",
        p_only_if_ai: true,
      }),
      "rescore after the check",
    );
    assert.match(String(moved), /now approved/, `a check's own verdict should be re-judgeable (${moved})`);
    assert.equal((await serviceRow("people", "id", eve.personId, "photo_status")).photo_status, "approved");

    // 2. Now a person decides. A later rescore must not undo it.
    await ok(
      w.service.rpc("admin_set_photo_status", {
        p_person: eve.personId,
        p_photo_path: path,
        p_status: "rejected",
        p_actor: ACTOR,
      }),
      "a human decides",
    );
    const held = await ok(
      w.service.rpc("admin_rescore_photo", {
        p_person: eve.personId,
        p_photo_path: path,
        p_outcome: "approved",
        p_reason: "the rubric would approve it",
        p_only_if_ai: true,
      }),
      "rescore after a human",
    );
    assert.match(String(held), /left alone/, `a rescore overruled a person (${held})`);
    assert.equal(
      (await serviceRow("people", "id", eve.personId, "photo_status")).photo_status,
      "rejected",
      "a rescore moved a photo a person had decided",
    );

    // 3. And it is still recorded, because the verdict is evidence even when it is
    // not applied — otherwise a rubric change leaves no trace of what it would have
    // done to the photos it was not allowed to touch.
    const recorded = await rows(
      w.service.from("photo_checks").select("outcome, source").eq("person_id", eve.personId).eq("source", "rescore"),
    );
    assert.equal(recorded.length, 2, "a refused rescore recorded nothing");

    // Leave Eve as the rest of the run expects her.
    await ok(
      w.service.rpc("admin_set_photo_status", {
        p_person: eve.personId,
        p_photo_path: path,
        p_status: "approved",
        p_actor: ACTOR,
      }),
      "restore",
    );
  });
});

// ---------------------------------------------------------------------------
// The live photo check never judges the harness's people — P82, P83 (M3.1).
//
// **Why this exists:** the webhook approved Eve's "pending" photo mid-run, and P23/P46
// then asserted against a world that had moved (and every run spent money). The
// skip is a refusal, so it is proved by making it refuse: a marked person's pending
// photo is still pending after the check would long since have answered (it takes
// about three seconds), and the sweep's list leaves them out — and includes them the
// moment the marker goes, so the exclusion is the marker and not an accident.
// ---------------------------------------------------------------------------

describe("The harness is invisible to the live photo check — P82, P83 (M3.1)", () => {
  it("P82 a marked person's pending photo is never checked / the sweep skips them, and takes them once unmarked", async () => {
    const authId = (await ok(
      w.service.auth.admin.createUser({
        email: `${PREFIX}-skip-${w.run}@example.com`,
        email_confirm: true,
        app_metadata: { pind_harness: true },
      }),
      "make a marked user",
    )).user.id;
    const path = `${authId}/skip.png`;
    let personId: string | null = null;
    try {
      await ok(w.service.storage.from(BUCKET).upload(path, PNG, { contentType: "image/png" }), "upload");
      personId = (await ok(
        w.service.from("people").insert({ auth_user_id: authId, first_name: "Skip", photo_path: path }).select("id").single(),
        "insert a pending photo",
      )).id as string;

      // Twelve seconds: four times what the check took end to end.
      await new Promise((r) => setTimeout(r, 12_000));
      assert.equal(
        (await serviceRow("people", "id", personId, "photo_status")).photo_status,
        "pending",
        "the live check judged a harness user's photo",
      );
      assert.equal(
        (await rows(w.service.from("photo_checks").select("id").eq("person_id", personId))).length,
        0,
        "a check was recorded for a harness user",
      );

      const waiting = async () =>
        ((await ok(w.service.rpc("admin_photos_waiting", { p_limit: 100000 }))) as { id: string }[]).map((r) => r.id);
      assert.ok(!(await waiting()).includes(personId), "the sweep would check a harness user");

      // The other side: the same row, unmarked, IS what the sweep takes. (Changing
      // app_metadata touches no `people` row, so no webhook fires and nothing is spent.)
      await ok(w.service.auth.admin.updateUserById(authId, { app_metadata: { pind_harness: false } }), "unmark");
      assert.ok((await waiting()).includes(personId), "the sweep skipped an ordinary pending photo");
    } finally {
      await w.service.auth.admin.updateUserById(authId, { app_metadata: { pind_harness: true } });
      if (personId) await w.service.from("people").delete().eq("id", personId);
      await w.service.storage.from(BUCKET).remove([path]);
      await removeUser(w.service, authId);
    }
  });

  it("P83 a person cannot mark themselves to skip the check", async () => {
    const client = newClient(w.env, w.env.publishableKey);
    const signedIn = await client.auth.signInAnonymously();
    assert.equal(signedIn.error, null, signedIn.error?.message);
    const authId = signedIn.data.user!.id;
    try {
      // Everything a session can write about itself.
      await client.auth.updateUser({ data: { pind_harness: true } });
      const user = (await ok(w.service.auth.admin.getUserById(authId), "read the user")).user;
      assert.notEqual(user.app_metadata?.pind_harness, true, "a session set its own harness marker");
      assert.equal(user.user_metadata?.pind_harness, true, "the attempt did not even land where a session can write");
    } finally {
      await removeUser(w.service, authId);
    }
  });
});

// ---------------------------------------------------------------------------
// Anonymous → permanent, with the pin surviving — P84, P85, P86 (M3.1, for M3.2).
//
// **The step the build plan names as most likely to slip**, and the one the whole
// quick-pin funnel rests on: A26 pins as an anonymous user, A27 makes that SAME user
// permanent. If the id changes, or the pin does not come with it, every quick pin is
// lost at the moment somebody says they would like to meet. `linkEmail()` existed and
// nothing called it; nothing proved any of this (Alex, M3.1).
//
// What a harness can prove, and what it cannot: it proves the id is stable through
// the conversion and that the person, the pin, the party size and the opt-in survive
// and stay readable under the new token (P84); that the app's own call is accepted
// for an anonymous session and changes nothing while the code is outstanding (P85);
// and whether OAuth linking is switched on at all (P86). **It cannot read the
// six-digit code from an inbox**, so `verifyOtp({ type: "email_change" })` itself is
// walked on a device in M3.2.
// ---------------------------------------------------------------------------

describe("Anonymous → permanent, the pin survives — P84–P86 (M3.1, for M3.2)", () => {
  // A26, done the way the screen will: an anonymous session makes its own person
  // and its own pin, opted in, bringing a friend.
  async function quickPin(label: string) {
    const client = newClient(w.env, w.env.publishableKey);
    const signedIn = await client.auth.signInAnonymously();
    assert.equal(signedIn.error, null, signedIn.error?.message);
    const authId = signedIn.data.user!.id;
    await markHarness(w.service, authId);
    assert.equal(signedIn.data.user!.is_anonymous, true);
    const person = await ok(
      client.from("people").insert({ auth_user_id: authId, first_name: label }).select("id").single(),
      "A26 makes the person",
    );
    await ok(client.from("age_attestations").insert({ person_id: person.id, source: "a26" }), "A26 records the 19+ tick");
    const pin = await ok(
      client
        .from("pins")
        // Closed: an anonymous pinner may not be open to meeting (the gate, M3.2).
        .insert({ gathering_id: w.G, person_id: person.id, open_to_meeting: false, party_total: 2 })
        .select("id")
        .single(),
      "A26 pins",
    );
    return { client, authId, personId: person.id as string, pinId: pin.id as string };
  }

  async function stillMine(client: SupabaseClient, authId: string, personId: string, pinId: string) {
    const me = await ok(client.auth.getUser(), "read my user");
    assert.equal(me.user.id, authId, "the user id changed");
    const person = await rows(client.from("people").select("id, auth_user_id").eq("id", personId));
    assert.equal(person.length, 1, "the person is no longer readable as mine");
    assert.equal(person[0].auth_user_id, authId);
    const pin = await rows(client.from("pins").select("id, open_to_meeting, party_total").eq("id", pinId));
    assert.equal(pin.length, 1, "the pin did not survive");
    assert.equal(pin[0].open_to_meeting, false, "the pin changed state across the link");
    assert.equal(pin[0].party_total, 2, "the party size did not survive");
    // And it is still the person's to change — the write half of RLS, not only reads.
    await ok(client.from("pins").update({ party_total: 3 }).eq("id", pinId), "edit my pin after the link");
  }

  it("P84 an anonymous pinner made permanent keeps the same id, the person, the pin and the party size — and the SAME pin opens to meeting once A27 is done (the gate, M3.2)", async () => {
    const q = await quickPin("Link");
    try {
      // The conversion itself, as the email code will do it once verified: the same
      // auth user gains a confirmed email.
      await ok(
        w.service.auth.admin.updateUserById(q.authId, { email: `${PREFIX}-link-${w.run}@example.com`, email_confirm: true }),
        "make the user permanent",
      );
      const refreshed = await q.client.auth.refreshSession();
      assert.equal(refreshed.error, null, refreshed.error?.message);
      assert.equal(refreshed.data.user?.id, q.authId, "a new user came back from the link");
      assert.equal(refreshed.data.user?.is_anonymous, false, "the user is still anonymous after the link");
      const claims = JSON.parse(Buffer.from(refreshed.data.session!.access_token.split(".")[1]!, "base64url").toString());
      assert.equal(claims.sub, q.authId, "the new token is for a different user");
      assert.equal(claims.is_anonymous, false, "the new token still says anonymous");
      await stillMine(q.client, q.authId, q.personId, q.pinId);

      // A27's details (date of birth and gender, a photo) — and now the SAME pin opens.
      await ok(w.service.from("people_private").insert({ person_id: q.personId, gender: "woman", birth_year: 1995 }));
      await ok(w.service.from("people").update({ photo_path: `${q.authId}/face.png` }).eq("id", q.personId));
      const opened = await ok(q.client.from("pins").update({ open_to_meeting: true }).eq("id", q.pinId).select("open_to_meeting"));
      assert.deepEqual(opened, [{ open_to_meeting: true }], "after the link and A27 the pin could not open");
    } finally {
      await w.service.from("pins").delete().eq("id", q.pinId);
      await w.service.from("people").delete().eq("id", q.personId);
      await removeUser(w.service, q.authId);
    }
  });

  it("P85 the app's own call — updateUser({ email }) from an anonymous session — is accepted, and nothing moves while the code is outstanding", async () => {
    const q = await quickPin("Asks");
    try {
      // Resend's test inbox: accepts and discards, and costs the domain nothing.
      const address = `delivered+${PREFIX}-${w.run}@resend.dev`;
      const asked = await q.client.auth.updateUser({ email: address });
      assert.equal(asked.error, null, `an anonymous session could not ask to link an email: ${asked.error?.message}`);
      assert.equal(asked.data.user?.id, q.authId);
      const user = (await ok(w.service.auth.admin.getUserById(q.authId), "read the user")).user;
      assert.equal(user.new_email ?? (user as { email_change?: string }).email_change, address, "no change of email is pending");
      assert.equal(user.is_anonymous, true, "the user became permanent before the code was entered");
      await stillMine(q.client, q.authId, q.personId, q.pinId);
    } finally {
      await w.service.from("pins").delete().eq("id", q.pinId);
      await w.service.from("people").delete().eq("id", q.personId);
      await removeUser(w.service, q.authId);
    }
  });

  it("P86 linking Google or Apple to an anonymous user is switched on (Supabase: Allow manual linking)", async () => {
    const q = await quickPin("Oauth");
    try {
      for (const provider of ["google", "apple"] as const) {
        const { data, error } = await q.client.auth.linkIdentity({
          provider,
          options: { skipBrowserRedirect: true, redirectTo: "https://pind.social/you" },
        });
        assert.equal(error, null, `${provider}: ${error?.message} — is "Allow manual linking" on in Supabase Auth?`);
        assert.ok(data?.url, `${provider}: no sign-in page to send the person to`);
      }
    } finally {
      await w.service.from("pins").delete().eq("id", q.pinId);
      await w.service.from("people").delete().eq("id", q.personId);
      await removeUser(w.service, q.authId);
    }
  });
});

// ---------------------------------------------------------------------------
// Nothing waits on the check — P87 (Alex, M3.1).
//
// A photo is visible from the moment it lands, and the check can only remove. The
// refusal that matters now is the check's own: a `rejected` verdict must take a
// visible photo away, and a `needs_review` verdict must not.
// ---------------------------------------------------------------------------

describe("Nothing waits on the check — P87 (M3.1)", () => {
  it("P87 an unchecked photo is visible / the check flagging it for a human leaves it visible / the check rejecting it removes it, from everyone but its owner", async () => {
    const eve = M("Eve");
    const check = (outcome: string) =>
      ok(
        w.service.rpc("admin_record_photo_check", {
          p_person: eve.personId,
          p_photo_path: eve.photoPath,
          p_outcome: outcome,
          p_source: "webhook",
          p_reason: `P87 ${outcome}`,
        }),
        `record ${outcome}`,
      );
    try {
      await ok(w.service.from("people").update({ photo_status: "pending" }).eq("id", eve.personId), "unchecked");
      await canSign(c(M("Ava")), eve.photoPath);

      await check("needs_review");
      assert.equal((await serviceRow("people", "id", eve.personId, "photo_status")).photo_status, "needs_review");
      await canSign(c(M("Ava")), eve.photoPath);

      await ok(w.service.from("people").update({ photo_status: "pending" }).eq("id", eve.personId), "unchecked again");
      await check("rejected");
      assert.equal((await serviceRow("people", "id", eve.personId, "photo_status")).photo_status, "rejected", "the check's rejection did not land");
      await cannotSign(c(M("Ava")), eve.photoPath);
      await canSign(c(eve), eve.photoPath);
      assert.equal(await seesPeople(c(M("Ava")), "Eve"), 1, "a rejected photo hid the person");
    } finally {
      await w.service.from("people").update({ photo_status: "approved" }).eq("id", eve.personId);
    }
  });

  // **Two copies of one rule, compared** (CLAUDE.md, "an instrument that is wrong"):
  // the database's `can_see_photo` and the app's `photoShowsToOthers`, which A21's
  // preview uses to tell a person what others see. For every status, both must agree.
  it("P88 the app's preview rule and the database's agree on every photo status", async () => {
    const { photoShowsToOthers } = await import("../../packages/shared/src/copy.ts");
    const eve = M("Eve");
    try {
      for (const status of ["pending", "approved", "needs_review", "rejected"]) {
        await ok(w.service.from("people").update({ photo_status: status }).eq("id", eve.personId), status);
        const { data } = await sign(c(M("Ava")), eve.photoPath);
        assert.equal(!!data?.signedUrl, photoShowsToOthers(status), `${status}: the database and the preview disagree`);
      }
    } finally {
      await w.service.from("people").update({ photo_status: "approved" }).eq("id", eve.personId);
    }
  });
});

// ---------------------------------------------------------------------------
// Changing or removing your photo after A2 — P89 (Alex, M3.1 walk).
//
// The app's own writes, in the screen's order, as the person: upload a new file into
// your folder, point your profile at it, delete the old file; then take the photo off
// altogether. The screen existed nowhere until the walk found a bad photo could not be
// changed, so its writes get a case the way A2's did (P80).
// ---------------------------------------------------------------------------

describe("Changing or removing a photo — P89 (M3.1)", () => {
  it("P89 a person CAN replace their photo, delete the old file and clear the photo / the old file is really gone", async () => {
    const client = newClient(w.env, w.env.publishableKey);
    const signedIn = await client.auth.signInAnonymously();
    assert.equal(signedIn.error, null, signedIn.error?.message);
    const authId = signedIn.data.user!.id;
    await markHarness(w.service, authId);
    const first = `${authId}/first.png`;
    const second = `${authId}/second.png`;
    let personId: string | null = null;
    try {
      await ok(client.storage.from(BUCKET).upload(first, PNG, { contentType: "image/png" }), "upload the first");
      personId = (await ok(
        client.from("people").insert({ auth_user_id: authId, first_name: "Swap", photo_path: first }).select("id").single(),
        "A2 with a photo",
      )).id as string;

      // Change photo: upload, point the profile at it, delete the old file.
      await ok(client.storage.from(BUCKET).upload(second, PNG, { contentType: "image/png" }), "upload the second");
      await ok(client.from("people").update({ photo_path: second }).eq("id", personId), "point at the second");
      await ok(client.storage.from(BUCKET).remove([first]), "delete the old file");
      const listed = await ok(client.storage.from(BUCKET).list(authId), "list my folder");
      assert.deepEqual(
        (listed as { name: string }[]).map((f) => f.name).sort(),
        ["second.png"],
        "the replaced file is still stored",
      );

      // Remove photo: the profile no longer has one.
      await ok(client.from("people").update({ photo_path: null }).eq("id", personId), "clear the photo");
      assert.equal((await serviceRow("people", "id", personId, "photo_path")).photo_path, null);
    } finally {
      if (personId) await w.service.from("people").delete().eq("id", personId);
      await w.service.storage.from(BUCKET).remove([first, second]);
      await removeUser(w.service, authId);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 3 M3.2 — the 19+ attestation, and under 19 at A27 (Alex, M3.2; H8)
// ---------------------------------------------------------------------------

describe("A pin needs the 19+ tick, recorded where nobody else can read it (M3.2)", () => {
  async function anonPerson(label: string) {
    const client = newClient(w.env, w.env.publishableKey);
    const signedIn = await client.auth.signInAnonymously();
    assert.equal(signedIn.error, null, signedIn.error?.message);
    const authId = signedIn.data.user!.id;
    await markHarness(w.service, authId);
    const person = await ok(
      client.from("people").insert({ auth_user_id: authId, first_name: label }).select("id").single(),
      "the person",
    );
    return { client, authId, personId: person.id as string };
  }

  async function cleanUp(q: { authId: string; personId: string }) {
    await w.service.from("people").delete().eq("id", q.personId);
    await removeUser(w.service, q.authId);
  }

  it("P100 without the 19+ record a pin is REFUSED — a token calling the API directly cannot skip the tick", async () => {
    const q = await anonPerson("NoTick");
    try {
      await denied(
        q.client.from("pins").insert({ gathering_id: w.G, person_id: q.personId, party_total: 1, open_to_meeting: false }),
        "42501",
      );
    } finally {
      await cleanUp(q);
    }
  });

  it("P101 with the record the same pin WORKS; everyone who finished A2 already has one", async () => {
    const q = await anonPerson("Ticked");
    try {
      await ok(q.client.from("age_attestations").insert({ person_id: q.personId, source: "a26" }), "tick");
      await ok(
        q.client.from("pins").insert({ gathering_id: w.G, person_id: q.personId, party_total: 1, open_to_meeting: false }),
        "pin after the tick",
      );
      // A2's people were backfilled and the trigger keeps doing it: Ava finished A2.
      const ava = await rows(w.service.from("age_attestations").select("source").eq("person_id", id("Ava")));
      assert.deepEqual(ava.map((r) => r.source), ["a2"], "an A2 person has no attestation");
    } finally {
      await cleanUp(q);
    }
  });

  it("P102 the record is the owner's alone: nobody else can read it, even someone who can see them; the owner cannot change, remove or forge it", async () => {
    // Ava and Eve can see each other at G (V1). Neither may read the other's record.
    assert.equal((await rows(c(M("Ava")).from("people").select("id").eq("id", id("Eve")))).length, 1, "the world is wrong: Ava cannot see Eve");
    assert.equal((await rows(c(M("Ava")).from("age_attestations").select("person_id").eq("person_id", id("Eve")))).length, 0, "Ava read Eve's attestation");
    assert.equal((await rows(c(M("Ava")).from("age_attestations").select("person_id").eq("person_id", id("Ava")))).length, 1, "Ava cannot read her own");
    await noAccess(w.anon, "age_attestations");

    const changed = await c(M("Ava")).from("age_attestations").update({ source: "a26" }).eq("person_id", id("Ava")).select("person_id");
    assert.ok(changed.error || (changed.data?.length ?? 0) === 0, "Ava changed her attestation");
    const removed = await c(M("Ava")).from("age_attestations").delete().eq("person_id", id("Ava")).select("person_id");
    assert.ok(removed.error || (removed.data?.length ?? 0) === 0, "Ava removed her attestation");
    await denied(c(M("Ava")).from("age_attestations").insert({ person_id: id("Ben"), source: "a26" }), "42501");
  });

  it("P103 under 19 at A27 removes them COMPLETELY — the pin, the person, the record and the anonymous auth user — and the count drops", async () => {
    const q = await anonPerson("Under");
    await ok(q.client.from("age_attestations").insert({ person_id: q.personId, source: "a26" }), "tick");
    await ok(q.client.from("pins").insert({ gathering_id: w.G, person_id: q.personId, party_total: 2, open_to_meeting: false }), "pin");
    const before = (await counts(w.anon, w.G)).pinned;

    await ok(q.client.rpc("remove_me_under_19"), "remove me");

    assert.equal((await rows(w.service.from("pins").select("id").eq("person_id", q.personId))).length, 0, "the pin survived");
    assert.equal((await rows(w.service.from("people").select("id").eq("id", q.personId))).length, 0, "the person survived");
    assert.equal((await rows(w.service.from("age_attestations").select("person_id").eq("person_id", q.personId))).length, 0, "the 19+ record survived");
    const user = await w.service.auth.admin.getUserById(q.authId);
    assert.ok(user.error || !user.data.user, "the anonymous auth user survived");
    assert.equal((await counts(w.anon, w.G)).pinned, before - 2, "the count did not drop by the party");
  });

  it("P104 only an anonymous session can use it, and only on itself — a permanent account and a stranger cannot", async () => {
    const before = await rows(w.service.from("people").select("id").eq("id", id("Ava")));
    const r = await c(M("Ava")).rpc("remove_me_under_19");
    assert.ok(r.error, "a permanent account removed itself through the under-19 path");
    assert.equal((await rows(w.service.from("people").select("id").eq("id", id("Ava")))).length, before.length, "Ava was removed");
    const a = await w.anon.rpc("remove_me_under_19");
    assert.ok(a.error, "a visitor with no session ran it");
  });
});

// ---------------------------------------------------------------------------
// Phase 3 M3.2 — the opt-in gate: "open to meeting" only after A27 (Alex, M3.2)
// ---------------------------------------------------------------------------

describe("Open to meeting only for someone who has finished A27 — permanent, dated, with a photo (M3.2)", () => {
  // A person made the way each case needs: anonymous or permanent, with or without the
  // private row and the photo. Every one has the 19+ record, so only the gate decides.
  async function someone(label: string, o: { permanent: boolean; privateRow: boolean; photo: boolean }) {
    const client = newClient(w.env, w.env.publishableKey);
    let authId: string;
    if (o.permanent) {
      const email = `${PREFIX}-${w.run}-gate-${label.toLowerCase()}@example.com`;
      const password = randomUUID();
      const made = await w.service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { pind_harness: true } });
      assert.equal(made.error, null, made.error?.message);
      authId = made.data.user!.id;
      const signIn = await client.auth.signInWithPassword({ email, password });
      assert.equal(signIn.error, null, signIn.error?.message);
    } else {
      const signIn = await client.auth.signInAnonymously();
      assert.equal(signIn.error, null, signIn.error?.message);
      authId = signIn.data.user!.id;
      await markHarness(w.service, authId);
    }
    const person = await ok(
      w.service
        .from("people")
        .insert({ auth_user_id: authId, first_name: label, photo_path: o.photo ? `${authId}/face.png` : null })
        .select("id")
        .single(),
    );
    if (o.privateRow) {
      await ok(w.service.from("people_private").insert({ person_id: person.id, gender: "woman", birth_year: 1995 }));
    }
    await ok(w.service.from("age_attestations").upsert({ person_id: person.id, source: "a26" }, { onConflict: "person_id", ignoreDuplicates: true }));
    return { client, authId, personId: person.id as string };
  }
  const gone = async (q: { authId: string; personId: string }) => {
    await w.service.from("people").delete().eq("id", q.personId);
    await removeUser(w.service, q.authId);
  };
  const pinOpen = (q: { client: SupabaseClient; personId: string }, open: boolean) =>
    q.client.from("pins").insert({ gathering_id: w.G, person_id: q.personId, party_total: 1, open_to_meeting: open }).select("id").single();

  it("P105 an ANONYMOUS pinner cannot be open to meeting — not on insert, not by a later update; closed is fine", async () => {
    const q = await someone("GateAnon", { permanent: false, privateRow: false, photo: false });
    try {
      await denied(pinOpen(q, true), "42501");
      const pin = await ok(pinOpen(q, false), "a closed pin is fine");
      await denied(q.client.from("pins").update({ open_to_meeting: true }).eq("id", pin.id).select("id"), "42501");
      assert.equal(await ok(q.client.rpc("i_may_meet")), false);
    } finally {
      await gone(q);
    }
  });

  it("P106 permanent but no photo, or no date of birth and gender, cannot be open to meeting either", async () => {
    const noPhoto = await someone("GateNoPhoto", { permanent: true, privateRow: true, photo: false });
    const noPrivate = await someone("GateNoPrivate", { permanent: true, privateRow: false, photo: true });
    try {
      await denied(pinOpen(noPhoto, true), "42501");
      await denied(pinOpen(noPrivate, true), "42501");
    } finally {
      await gone(noPhoto);
      await gone(noPrivate);
    }
  });

  it("P107 someone who HAS finished A27 — permanent, dated, with a photo — CAN be open to meeting, on insert and on update", async () => {
    const q = await someone("GateDone", { permanent: true, privateRow: true, photo: true });
    try {
      assert.equal(await ok(q.client.rpc("i_may_meet")), true);
      const pin = await ok(pinOpen(q, false));
      const up = await ok(q.client.from("pins").update({ open_to_meeting: true }).eq("id", pin.id).select("open_to_meeting"));
      assert.deepEqual(up, [{ open_to_meeting: true }], "a complete person could not opt in");
    } finally {
      await gone(q);
    }
  });

  it("P108 turning it OFF is never refused, even for someone the gate would refuse now", async () => {
    const q = await someone("GateOff", { permanent: false, privateRow: false, photo: false });
    try {
      // Set open by the service key, as a pin made before the gate existed would be.
      const pin = await ok(w.service.from("pins").insert({ gathering_id: w.G, person_id: q.personId, party_total: 1, open_to_meeting: true }).select("id").single());
      const off = await ok(q.client.from("pins").update({ open_to_meeting: false }).eq("id", pin.id).select("open_to_meeting"));
      assert.deepEqual(off, [{ open_to_meeting: false }], "opting out was refused");
    } finally {
      await gone(q);
    }
  });

  it("P109 i_may_meet answers for the caller only, and a visitor with no session cannot ask", async () => {
    const a = await someone("GateAsk", { permanent: true, privateRow: true, photo: true });
    try {
      assert.equal(await ok(a.client.rpc("i_may_meet")), true);
      assert.ok((await w.anon.rpc("i_may_meet")).error, "a visitor with no session called i_may_meet");
    } finally {
      await gone(a);
    }
  });

  it("P126 A27's rule and the gate agree on what \"complete\" means — every combination, read the way A27 reads it", async () => {
    // M3.2 walk: A27 reached the safety sheet for someone the gate refused, and the
    // refusal came back as "not allowed". The screen now asks optInMissing (shared)
    // before writing; this proves its idea of complete IS the database's, on real rows.
    for (const permanent of [true, false]) {
      for (const privateRow of [true, false]) {
        for (const photo of [true, false]) {
          const label = `Agree${permanent ? "P" : "A"}${privateRow ? "D" : "x"}${photo ? "F" : "x"}`;
          const q = await someone(label, { permanent, privateRow, photo });
          try {
            // A27's own reads, as the person: their row, their private row, their session.
            const me = await ok(q.client.from("people").select("id, photo_path").eq("auth_user_id", q.authId).single());
            const priv = await rows(q.client.from("people_private").select("person_id").eq("person_id", me.id));
            const { data: session } = await q.client.auth.getSession();
            const facts = { permanent: !session.session!.user.is_anonymous, hasPrivate: priv.length > 0, hasPhoto: !!me.photo_path };
            assert.deepEqual(facts, { permanent, hasPrivate: privateRow, hasPhoto: photo }, `${label}: A27's reads do not see what was built`);
            const screen = optInMissing(facts).missing.length === 0;
            const gate = await ok(q.client.rpc("i_may_meet"));
            assert.equal(screen, gate, `${label}: A27 says ${screen ? "complete" : "not complete"}, the gate says ${gate}`);
            // And the gate is what the write meets: open is refused exactly when A27 says so.
            const pin = await q.client.from("pins").insert({ gathering_id: w.G, person_id: q.personId, party_total: 1, open_to_meeting: true }).select("id");
            assert.equal(!pin.error, screen, `${label}: the open pin was ${pin.error ? "refused" : "allowed"} while A27 said ${screen ? "complete" : "not complete"}`);
          } finally {
            await gone(q);
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 3 M3.2 — which policy version a person accepted (Alex, M3.2)
// ---------------------------------------------------------------------------

describe("Policy acceptances: one row per acceptance, owner-only, never changed (M3.2)", () => {
  const V = `pindhx-test-version-${Date.now()}`;

  after(async () => {
    await w.service.from("policy_acceptances").delete().eq("version", V);
  });

  it("P110 a person CAN record their own acceptance, and CANNOT record one for someone else", async () => {
    await ok(c(M("Ava")).from("policy_acceptances").insert({ person_id: id("Ava"), version: V }), "own acceptance");
    await denied(c(M("Ava")).from("policy_acceptances").insert({ person_id: id("Ben"), version: V }), "42501");
  });

  it("P111 only the person reads it — not someone who can see them, not a visitor", async () => {
    assert.equal((await rows(c(M("Ava")).from("policy_acceptances").select("version").eq("version", V))).length, 1, "Ava cannot read her own");
    assert.equal(
      (await rows(c(M("Eve")).from("policy_acceptances").select("person_id").eq("person_id", id("Ava")))).length,
      0,
      "Eve read Ava's acceptance",
    );
    await noAccess(w.anon, "policy_acceptances");
  });

  it("P112 an acceptance cannot be changed or removed by anyone signed in; a new version is a new row", async () => {
    const ava = c(M("Ava"));
    const changed = await ava.from("policy_acceptances").update({ version: "forged" }).eq("version", V).select("id");
    assert.ok(changed.error || (changed.data?.length ?? 0) === 0, "Ava changed her acceptance");
    const removed = await ava.from("policy_acceptances").delete().eq("version", V).select("id");
    assert.ok(removed.error || (removed.data?.length ?? 0) === 0, "Ava removed her acceptance");
    await ok(ava.from("policy_acceptances").insert({ person_id: id("Ava"), version: `${V}-next` }), "a new version adds a row");
    await w.service.from("policy_acceptances").delete().eq("version", `${V}-next`);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 M3.2 — the existing-email merge (Alex, M3.2): only from anonymous, only into
// permanent, only by the service key, and the moved pin wins on party size
// ---------------------------------------------------------------------------

describe("Merging an anonymous pinner into their existing account (M3.2)", () => {
  async function anonWithPin(label: string, gathering: string, party: number) {
    const client = newClient(w.env, w.env.publishableKey);
    const signIn = await client.auth.signInAnonymously();
    assert.equal(signIn.error, null, signIn.error?.message);
    const authId = signIn.data.user!.id;
    await markHarness(w.service, authId);
    const person = await ok(w.service.from("people").insert({ auth_user_id: authId, first_name: label }).select("id").single());
    await ok(w.service.from("age_attestations").insert({ person_id: person.id, source: "a26" }));
    await ok(w.service.from("pins").insert({ gathering_id: gathering, person_id: person.id, party_total: party, open_to_meeting: false }));
    return { authId, personId: person.id as string };
  }
  async function permanent(label: string, withPerson: boolean) {
    const made = await w.service.auth.admin.createUser({
      email: `${PREFIX}-${w.run}-merge-${label.toLowerCase()}@example.com`,
      password: randomUUID(),
      email_confirm: true,
      app_metadata: { pind_harness: true },
    });
    assert.equal(made.error, null, made.error?.message);
    const authId = made.data.user!.id;
    let personId: string | null = null;
    if (withPerson) personId = (await ok(w.service.from("people").insert({ auth_user_id: authId, first_name: label }).select("id").single())).id;
    return { authId, personId };
  }
  const merge = (anon: string, perm: string) => w.service.rpc("admin_merge_anonymous", { p_anon: anon, p_perm: perm });
  const userGone = async (authId: string) => {
    const u = await w.service.auth.admin.getUserById(authId);
    return !!u.error || !u.data.user;
  };
  const cleanup = async (...ids: (string | null)[]) => {
    for (const id of ids) if (id) await removeUser(w.service, id).catch(() => undefined);
  };

  it("P113 the anonymous pin MOVES into the account; the anonymous person and user are gone", async () => {
    const a = await anonWithPin("MergeA", w.G, 2);
    const p = await permanent("MergeP", true);
    try {
      await ok(merge(a.authId, p.authId));
      const pins = await rows(w.service.from("pins").select("party_total").eq("person_id", p.personId!).eq("gathering_id", w.G));
      assert.deepEqual(pins, [{ party_total: 2 }], "the pin did not arrive in the account");
      assert.equal((await rows(w.service.from("people").select("id").eq("id", a.personId))).length, 0, "the anonymous person survived");
      assert.ok(await userGone(a.authId), "the anonymous user survived");
    } finally {
      await cleanup(a.authId, p.authId);
    }
  });

  it("P114 both pinned at one gathering: ONE pin remains, the moved one's party size wins, the count does not double", async () => {
    const a = await anonWithPin("MergeBothA", w.H, 3);
    const p = await permanent("MergeBothP", true);
    await ok(w.service.from("age_attestations").insert({ person_id: p.personId, source: "a26" }));
    await ok(w.service.from("pins").insert({ gathering_id: w.H, person_id: p.personId, party_total: 1, open_to_meeting: false }));
    const before = (await counts(w.anon, w.H)).pinned;
    try {
      const out = await ok(merge(a.authId, p.authId));
      assert.equal((out as { merged: number }).merged, 1);
      const pins = await rows(w.service.from("pins").select("party_total").eq("person_id", p.personId!).eq("gathering_id", w.H));
      assert.deepEqual(pins, [{ party_total: 3 }], "the moved pin's party size did not win");
      assert.equal((await counts(w.anon, w.H)).pinned, before - 1, "the count doubled or did not settle to the moved party");
    } finally {
      await cleanup(a.authId, p.authId);
    }
  });

  it("P115 an account with no profile takes the anonymous person WHOLE — re-homed, not copied", async () => {
    const a = await anonWithPin("MergeRehome", w.G, 1);
    const p = await permanent("MergeRehomeP", false);
    try {
      const out = await ok(merge(a.authId, p.authId));
      assert.equal((out as { rehomed: boolean }).rehomed, true);
      const person = await rows(w.service.from("people").select("id, auth_user_id").eq("id", a.personId));
      assert.deepEqual(person, [{ id: a.personId, auth_user_id: p.authId }], "the person was not re-homed onto the account");
      assert.equal((await rows(w.service.from("pins").select("id").eq("person_id", a.personId))).length, 1, "the pin did not come with the person");
      assert.ok(await userGone(a.authId), "the anonymous user survived");
    } finally {
      await w.service.from("people").delete().eq("id", a.personId);
      await cleanup(a.authId, p.authId);
    }
  });

  it("P116 every refusal FIRES: a permanent source, an anonymous target, the same user twice — and nothing moves", async () => {
    const a = await anonWithPin("MergeRefA", w.G, 1);
    const p = await permanent("MergeRefP", true);
    const a2 = await anonWithPin("MergeRefA2", w.H, 1);
    try {
      for (const [from, to, why] of [
        [p.authId, a.authId, "a permanent user as the source"],
        [a.authId, a2.authId, "an anonymous user as the target"],
        [a.authId, a.authId, "the same user twice"],
      ] as const) {
        const r = await merge(from, to);
        assert.ok(r.error, `the merge accepted ${why}`);
      }
      assert.equal((await rows(w.service.from("pins").select("id").eq("person_id", a.personId))).length, 1, "a refused merge moved the pin");
      assert.equal(await userGone(a.authId), false, "a refused merge deleted the anonymous user");
    } finally {
      await cleanup(a.authId, a2.authId, p.authId);
    }
  });

  it("P117 nobody signed in, and no visitor, can call it — the service key only", async () => {
    for (const client of [c(M("Ava")), w.anon]) {
      const r = await client.rpc("admin_merge_anonymous", { p_anon: randomUUID(), p_perm: randomUUID() });
      assert.ok(r.error, "a visitor ran the merge");
    }
    for (const client of [c(M("Ava")), w.anon]) {
      const r = await client.rpc("admin_merge_photo_plan", { p_anon: randomUUID(), p_perm: randomUUID() });
      assert.ok(r.error, "a visitor asked for the merge's photo plan");
    }
  });

  // The merge fills the account's gaps (Alex, M3.2 walk): never overwrite, fill only what
  // is missing, delete what is not moved. The photo FILE moves in the Worker; these prove
  // the rows, with the destination the Worker's own photoDest() produces.
  async function anonGave(label: string, o: { photo?: "approved" | "pending" | "rejected"; details?: boolean }) {
    const a = await anonWithPin(label, w.G, 1);
    if (o.photo) {
      await ok(w.service.from("people").update({ photo_path: `${a.authId}/face.jpg` }).eq("id", a.personId));
      await ok(w.service.from("people").update({ photo_status: o.photo }).eq("id", a.personId));
    }
    if (o.details) await ok(w.service.from("people_private").insert({ person_id: a.personId, gender: "woman", birth_year: 1996 }));
    return a;
  }
  const personOf = async (authId: string) =>
    (await rows(w.service.from("people").select("id, first_name, photo_path, photo_status").eq("auth_user_id", authId)))[0];
  const privateOf = async (personId: string) => (await rows(w.service.from("people_private").select("gender, birth_year").eq("person_id", personId)))[0];
  const plan = async (anon: string, perm: string) => (await ok(w.service.rpc("admin_merge_photo_plan", { p_anon: anon, p_perm: perm }))) as string | null;
  const mergeWith = (anon: string, perm: string, dest: string | null) =>
    w.service.rpc("admin_merge_anonymous", { p_anon: anon, p_perm: perm, p_photo_dest: dest });

  it("P127 an account with NO photo takes the anonymous person's, in its own folder — checked again, as V6 requires", async () => {
    const a = await anonGave("FillPhotoA", { photo: "approved", details: true });
    const p = await permanent("FillPhotoP", true);
    try {
      const from = await plan(a.authId, p.authId);
      assert.equal(from, `${a.authId}/face.jpg`, "the plan does not offer the photo to an account without one");
      const dest = photoDest(p.authId, from!);
      const out = await ok(mergeWith(a.authId, p.authId, dest));
      assert.equal((out as { photo: boolean }).photo, true);
      const me = await personOf(p.authId);
      assert.equal(me.photo_path, dest, "the account did not take the photo");
      assert.equal(me.photo_status, "pending", "a moved photo skipped the check (V6)");
      assert.equal((await rows(w.service.from("people").select("id").eq("id", a.personId))).length, 0, "the anonymous person survived");
    } finally {
      await cleanup(a.authId, p.authId);
    }
  });

  it("P128 an account WITH a photo is never replaced — not by the plan, not by a destination passed anyway", async () => {
    const a = await anonGave("KeepPhotoA", { photo: "approved" });
    const p = await permanent("KeepPhotoP", true);
    await ok(w.service.from("people").update({ photo_path: `${p.authId}/mine.jpg` }).eq("id", p.personId!));
    await ok(w.service.from("people").update({ photo_status: "approved" }).eq("id", p.personId!));
    try {
      assert.equal(await plan(a.authId, p.authId), null, "the plan offered to replace the account's photo");
      // Even if the Worker passed a destination, the database does not take it.
      const out = await ok(mergeWith(a.authId, p.authId, `${p.authId}/face.jpg`));
      assert.equal((out as { photo: boolean }).photo, false);
      const me = await personOf(p.authId);
      assert.deepEqual([me.photo_path, me.photo_status], [`${p.authId}/mine.jpg`, "approved"], "the account's photo was replaced or re-checked");
    } finally {
      await cleanup(a.authId, p.authId);
    }
  });

  it("P129 date of birth and gender fill an account that has none, and NEVER overwrite one that has them", async () => {
    const a1 = await anonGave("FillDetailsA", { details: true });
    const p1 = await permanent("FillDetailsP", true);
    const a2 = await anonGave("KeepDetailsA", { details: true });
    const p2 = await permanent("KeepDetailsP", true);
    await ok(w.service.from("people_private").insert({ person_id: p2.personId, gender: "man", birth_year: 1980 }));
    try {
      const filled = await ok(mergeWith(a1.authId, p1.authId, null));
      assert.equal((filled as { details: boolean }).details, true);
      assert.deepEqual(await privateOf(p1.personId!), { gender: "woman", birth_year: 1996 }, "the account without details did not take them");
      const kept = await ok(mergeWith(a2.authId, p2.authId, null));
      assert.equal((kept as { details: boolean }).details, false);
      assert.deepEqual(await privateOf(p2.personId!), { gender: "man", birth_year: 1980 }, "the account's own details were overwritten");
      assert.equal(await privateOf(a2.personId), undefined, "the anonymous details not moved were left behind");
      // Never the first name either.
      assert.equal((await personOf(p2.authId)).first_name, "KeepDetailsP");
    } finally {
      await cleanup(a1.authId, p1.authId, a2.authId, p2.authId);
    }
  });

  it("P130 an account with no profile takes the person whole — its photo moved to the account's folder, or none", async () => {
    const a = await anonGave("RehomePhotoA", { photo: "pending" });
    const p = await permanent("RehomePhotoP", false);
    const a2 = await anonGave("RehomeNoCopyA", { photo: "pending" });
    const p2 = await permanent("RehomeNoCopyP", false);
    try {
      const dest = photoDest(p.authId, (await plan(a.authId, p.authId))!);
      const out = await ok(mergeWith(a.authId, p.authId, dest));
      assert.deepEqual([(out as { rehomed: boolean }).rehomed, (out as { photo: boolean }).photo], [true, true]);
      assert.equal((await personOf(p.authId)).photo_path, dest, "the re-homed person's photo still points into the anonymous folder");
      // No copy made (the Worker's copy failed): no photo, rather than a path nobody owns.
      await ok(mergeWith(a2.authId, p2.authId, null));
      assert.equal((await personOf(p2.authId)).photo_path, null, "a re-homed person kept a path into a deleted user's folder");
    } finally {
      await w.service.from("people").delete().in("id", [a.personId, a2.personId]);
      await cleanup(a.authId, p.authId, a2.authId, p2.authId);
    }
  });

  it("P131 the photo can only go to the ACCOUNT's own folder — anywhere else is refused, and nothing moves", async () => {
    const a = await anonGave("DestA", { photo: "pending" });
    const p = await permanent("DestP", true);
    try {
      for (const bad of [`${a.authId}/face.jpg`, `${randomUUID()}/face.jpg`, `${p.authId}/x/face.jpg`, `${p.authId}/../face.jpg`, "face.jpg"]) {
        await denied(mergeWith(a.authId, p.authId, bad), "22023");
      }
      assert.equal((await rows(w.service.from("pins").select("id").eq("person_id", a.personId))).length, 1, "a refused merge moved the pin");
      // And the Worker's own producer passes the database's rule.
      await ok(mergeWith(a.authId, p.authId, photoDest(p.authId, `${a.authId}/face.jpg`)));
    } finally {
      await cleanup(a.authId, p.authId);
    }
  });

  it("P132 a REJECTED photo is never carried into the account", async () => {
    const a = await anonGave("RejectedA", { photo: "rejected" });
    const p = await permanent("RejectedP", true);
    try {
      assert.equal(await plan(a.authId, p.authId), null, "the plan offered a rejected photo");
      const out = await ok(mergeWith(a.authId, p.authId, `${p.authId}/face.jpg`));
      assert.equal((out as { photo: boolean }).photo, false);
      assert.equal((await personOf(p.authId)).photo_path, null, "a rejected photo came in");
    } finally {
      await cleanup(a.authId, p.authId);
    }
  });

  // A27 now asks "where" before a way to sign in (one set of profile steps), so the
  // neighbourhood and tags an anonymous person gave must survive a merge the same way.
  const someTags = async (n: number) => (await rows(w.service.from("tags").select("slug").order("slug").limit(n))).map((t) => t.slug as string);
  const tagsOf = async (personId: string) => (await rows(w.service.from("person_tags").select("tag").eq("person_id", personId))).map((t) => t.tag as string).sort();
  const hoodOf = async (personId: string) => (await rows(w.service.from("people").select("neighbourhood").eq("id", personId)))[0]?.neighbourhood ?? null;

  it("P133 an account with no neighbourhood and no tags takes the anonymous person's — the tags as a set", async () => {
    const a = await anonGave("FillWhereA", {});
    const p = await permanent("FillWhereP", true);
    const tags = await someTags(3);
    await ok(w.service.from("people").update({ neighbourhood: "dundas-west" }).eq("id", a.personId));
    await ok(w.service.from("person_tags").insert(tags.map((tag) => ({ person_id: a.personId, tag }))));
    try {
      const out = await ok(mergeWith(a.authId, p.authId, null));
      assert.deepEqual([(out as { neighbourhood: boolean }).neighbourhood, (out as { tags: boolean }).tags], [true, true]);
      assert.equal(await hoodOf(p.personId!), "dundas-west", "the neighbourhood did not come in");
      assert.deepEqual(await tagsOf(p.personId!), tags.slice().sort(), "the tags did not come in");
    } finally {
      await cleanup(a.authId, p.authId);
    }
  });

  it("P134 an account WITH a neighbourhood and tags keeps exactly its own — never overwritten, never mixed", async () => {
    const a = await anonGave("KeepWhereA", {});
    const p = await permanent("KeepWhereP", true);
    const [t1, t2, t3, t4, t5, t6] = await someTags(6);
    await ok(w.service.from("people").update({ neighbourhood: "dundas-west" }).eq("id", a.personId));
    await ok(w.service.from("person_tags").insert([t1, t2, t3].map((tag) => ({ person_id: a.personId, tag }))));
    await ok(w.service.from("people").update({ neighbourhood: "king-west" }).eq("id", p.personId!));
    await ok(w.service.from("person_tags").insert([t4, t5, t6].map((tag) => ({ person_id: p.personId, tag }))));
    try {
      const out = await ok(mergeWith(a.authId, p.authId, null));
      assert.deepEqual([(out as { neighbourhood: boolean }).neighbourhood, (out as { tags: boolean }).tags], [false, false]);
      assert.equal(await hoodOf(p.personId!), "king-west", "the account's neighbourhood was overwritten");
      assert.deepEqual(await tagsOf(p.personId!), [t4, t5, t6].sort(), "the account's tags were overwritten or mixed");
      assert.deepEqual(await tagsOf(a.personId), [], "the anonymous tags not moved were left behind");
    } finally {
      await cleanup(a.authId, p.authId);
    }
  });

  // **The tester flag follows the person** (Alex, M3.2 walk, 28 Sept). The walk was
  // impossible: every way Alex signed in at A27 was a merge into an account he already
  // had, the merge deleted the anonymous tester, and the test crowd vanished. Proved the
  // way it failed — can this account SEE the seed gathering after signing in — not by
  // reading the list.
  async function accountWithSession(label: string) {
    const email = `${PREFIX}-${w.run}-tester-${label.toLowerCase()}@example.com`;
    const password = randomUUID();
    const made = await w.service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { pind_harness: true } });
    assert.equal(made.error, null, made.error?.message);
    const authId = made.data.user!.id;
    await ok(w.service.from("people").insert({ auth_user_id: authId, first_name: label }));
    const client = newClient(w.env, w.env.publishableKey);
    const signIn = await client.auth.signInWithPassword({ email, password });
    assert.equal(signIn.error, null, signIn.error?.message);
    return { authId, client };
  }
  const makeAnonTester = (authId: string) => w.service.rpc("admin_add_anonymous_tester", { p_user: authId, p_actor: "harness" });

  it("P136 an anonymous TESTER who signs in to an account they already have makes it a tester — the test crowd is still there", async () => {
    const a = await anonWithPin("TesterMergeA", w.G, 1);
    await ok(makeAnonTester(a.authId));
    const acct = await accountWithSession("TesterMergeP");
    try {
      assert.equal(await readable(acct.client, seedG), false, "the account could see the test crowd BEFORE the merge");
      const out = await ok(merge(a.authId, acct.authId));
      assert.equal((out as { tester: boolean }).tester, true);
      assert.equal(await readable(acct.client, seedG), true, "after signing in from a tester session, the test crowd vanished — the walk's failure");
      // Visible and removable like any other tester, with how it got there.
      const listed = (await rows(w.service.rpc("admin_testers"))).find((t: { auth_user_id: string }) => t.auth_user_id === acct.authId);
      assert.match(String(listed?.note), /anonymous tester session/, "the account is a tester with no note saying how");
    } finally {
      await ok(w.service.rpc("admin_set_tester", { p_auth_user: acct.authId, p_on: false, p_actor: "harness" }));
      await cleanup(a.authId, acct.authId);
    }
  });

  it("P137 a merge from someone who is NOT a tester never makes the account one — the flag is never created from nothing", async () => {
    const a = await anonWithPin("PlainMergeA", w.G, 1);
    const acct = await accountWithSession("PlainMergeP");
    try {
      const out = await ok(merge(a.authId, acct.authId));
      assert.equal((out as { tester: boolean }).tester, false);
      assert.equal(await readable(acct.client, seedG), false, "a merge from a non-tester made the account a tester");
    } finally {
      await cleanup(a.authId, acct.authId);
    }
  });

  it("P138 an anonymous tester who becomes permanent by LINK (same user) keeps the test crowd", async () => {
    const client = newClient(w.env, w.env.publishableKey);
    const signIn = await client.auth.signInAnonymously();
    assert.equal(signIn.error, null, signIn.error?.message);
    const authId = signIn.data.user!.id;
    await markHarness(w.service, authId);
    await ok(makeAnonTester(authId));
    try {
      assert.equal(await readable(client, seedG), true, "the anonymous tester could not see the test crowd");
      // What a confirmed email code does to the same user: an identity, no longer anonymous.
      const linked = await w.service.auth.admin.updateUserById(authId, { email: `${PREFIX}-${w.run}-tester-link@example.com`, email_confirm: true });
      assert.equal(linked.error, null, linked.error?.message);
      const refreshed = await client.auth.refreshSession();
      assert.equal(refreshed.error, null, refreshed.error?.message);
      assert.equal(refreshed.data.session?.user.is_anonymous, false, "the link did not make the user permanent");
      assert.equal(await readable(client, seedG), true, "linking lost the test crowd");
    } finally {
      await w.service.rpc("admin_set_tester", { p_auth_user: authId, p_on: false, p_actor: "harness" });
      await cleanup(authId);
    }
  });

  it("P135 an ANONYMOUS pinner can set their own neighbourhood and tags (A27's 'where' comes before sign-in) — and nobody else's", async () => {
    const client = newClient(w.env, w.env.publishableKey);
    const signIn = await client.auth.signInAnonymously();
    assert.equal(signIn.error, null, signIn.error?.message);
    const authId = signIn.data.user!.id;
    await markHarness(w.service, authId);
    const person = await ok(w.service.from("people").insert({ auth_user_id: authId, first_name: "WhereAnon" }).select("id").single());
    const other = await anonGave("WhereOther", {});
    const [t1, t2, t3] = await someTags(3);
    try {
      await ok(client.from("people").update({ neighbourhood: "king-west" }).eq("id", person.id).select("id"));
      assert.equal(await hoodOf(person.id), "king-west", "an anonymous pinner could not set their own neighbourhood");
      await ok(client.from("person_tags").insert([t1, t2, t3].map((tag) => ({ person_id: person.id, tag }))));
      assert.deepEqual(await tagsOf(person.id), [t1, t2, t3].sort(), "an anonymous pinner could not set their own tags");
      // Someone else's: refused, and nothing changes.
      const theirs = await client.from("people").update({ neighbourhood: "king-west" }).eq("id", other.personId).select("id");
      assert.deepEqual(theirs.data ?? [], [], "an anonymous pinner changed someone else's neighbourhood");
      assert.equal(await hoodOf(other.personId), null);
      await denied(client.from("person_tags").insert({ person_id: other.personId, tag: t1 }));
    } finally {
      await w.service.from("people").delete().eq("id", person.id);
      await cleanup(authId, other.authId);
    }
  });

  it("P182 every merge writes its record in its own transaction — how, where and by which route; a refused merge writes none; nobody signed in reads or calls it", async () => {
    const a = await anonWithPin("RecA", w.G, 1);
    const p = await permanent("RecP", true);
    const recorded = async () => rows(w.service.from("account_merges").select("method, platform, via").eq("person_id", p.personId!));
    try {
      // Refused (the same user twice): no merge, and no record of one.
      await denied(w.service.rpc("admin_merge_recorded", { p_anon: p.authId, p_perm: p.authId, p_photo_dest: null, p_method: "email", p_platform: "web", p_via: "already_on_pind" }));
      assert.deepEqual(await recorded(), [], "a refused merge left a record");
      await ok(w.service.rpc("admin_merge_recorded", { p_anon: a.authId, p_perm: p.authId, p_photo_dest: null, p_method: "email", p_platform: "web", p_via: "already_on_pind" }));
      assert.deepEqual(await recorded(), [{ method: "email", platform: "web", via: "already_on_pind" }]);
      assert.equal((await rows(w.service.from("pins").select("id").eq("person_id", p.personId!).eq("gathering_id", w.G))).length, 1, "the record was written but the merge did not happen");
      // Anything but a known value is recorded as not known, never guessed.
      const b = await anonWithPin("RecB", w.G, 1);
      await ok(w.service.rpc("admin_merge_recorded", { p_anon: b.authId, p_perm: p.authId, p_photo_dest: null, p_method: "EMAIL ", p_platform: "windows", p_via: "" }));
      assert.ok((await recorded()).some((r: { method: string | null; platform: string | null; via: string | null }) => r.method === null && r.platform === null && r.via === null), "an unknown value was recorded as if known");
      await noAccess(c(M("Ava")), "account_merges");
      for (const client of [c(M("Ava")), w.anon]) {
        assert.ok((await client.rpc("admin_merge_recorded", { p_anon: randomUUID(), p_perm: randomUUID(), p_photo_dest: null, p_method: null, p_platform: null, p_via: null })).error, "a visitor ran the merge");
      }
    } finally {
      await w.service.from("account_merges").delete().eq("person_id", p.personId!);
      await cleanup(a.authId, p.authId);
    }
  });
});

describe("The client's copy of effective_end matches the database's (M3.2)", () => {
  it("P118 effectiveEnd(starts_at, ends_at) equals public.effective_end on real rows, with and without ends_at", async () => {
    const { effectiveEnd } = await import("../../packages/shared/src/copy.ts");
    const withEnd = await ok(
      w.service.from("gatherings").insert({ name: `pindhx ${w.run} Ends`, starts_at: inDays(3), ends_at: inDays(3.2), venue_id: w.venue }).select("id").single(),
    );
    const rowsBack = (await ok(
      w.service.from("gatherings").select("id, starts_at, ends_at, effective_end").in("id", [withEnd.id, w.G]),
    )) as { id: string; starts_at: string; ends_at: string | null; effective_end: string }[];
    assert.equal(rowsBack.length, 2, "the database did not return both rows (the check found nothing)");
    assert.ok(rowsBack.some((r) => r.ends_at === null) && rowsBack.some((r) => r.ends_at !== null), "need one row of each kind");
    for (const r of rowsBack) {
      assert.equal(Date.parse(effectiveEnd(r.starts_at, r.ends_at)), Date.parse(r.effective_end), `drifted on ${r.id}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 3 M3.2 — a person's gathering count for A22: a number, never which (Alex)
// ---------------------------------------------------------------------------

describe("A person's gathering count — readable as widely as their first name, written only by the nightly job (M3.2)", () => {
  it("P119 the person reads their own count; someone who can see them reads it too", async () => {
    const own = await rows(c(M("Ava")).from("people").select("gatherings_count").eq("id", id("Ava")));
    assert.equal(own.length, 1, "Ava cannot read her own count");
    assert.equal(typeof own[0].gatherings_count, "number");
    const seen = await rows(c(M("Ava")).from("people").select("gatherings_count").eq("id", id("Eve")));
    assert.equal(seen.length, 1, "someone who can see Eve could not read her count");
  });

  it("P120 someone who cannot see them gets nothing — no count, no row", async () => {
    // Ben is not open at G with Pam; P-cases above establish Pam sees nobody at G.
    assert.equal((await rows(c(M("Pam")).from("people").select("gatherings_count").eq("id", id("Ava")))).length, 0, "Pam read Ava's count");
    await noAccess(w.anon, "people");
  });

  it("P121 nobody signed in can write a count, their own included", async () => {
    await denied(c(M("Ava")).from("people").update({ gatherings_count: 999 }).eq("id", id("Ava")), "42501");
  });

  it("P122 the job counts each ENDED gathering once — not an upcoming one, and never twice", async () => {
    const ended = await ok(
      w.service
        .from("gatherings")
        .insert({ name: `pindhx ${w.run} Counted`, starts_at: inDays(-2), venue_id: w.venue, published_at: new Date().toISOString() })
        .select("id")
        .single(),
    );
    const upcoming = await ok(
      w.service
        .from("gatherings")
        .insert({ name: `pindhx ${w.run} Not Yet`, starts_at: inDays(4), venue_id: w.venue, published_at: new Date().toISOString() })
        .select("id")
        .single(),
    );
    const before = (await serviceRow("people", "id", id("Dev"), "gatherings_count")).gatherings_count as number;
    await ok(w.service.from("pins").insert([
      { gathering_id: ended.id, person_id: id("Dev"), party_total: 1, open_to_meeting: false },
      { gathering_id: upcoming.id, person_id: id("Dev"), party_total: 1, open_to_meeting: false },
    ]));
    await ok(w.service.rpc("admin_count_ended_gatherings"));
    await ok(w.service.rpc("admin_count_ended_gatherings"));
    const after = (await serviceRow("people", "id", id("Dev"), "gatherings_count")).gatherings_count as number;
    assert.equal(after, before + 1, "the ended gathering was not counted exactly once, or the upcoming one was counted");
    assert.ok((await c(M("Ava")).rpc("admin_count_ended_gatherings")).error, "a visitor ran the counting job");
  });
});

// ---------------------------------------------------------------------------
// Phase 3 M3.2 — anonymous tester sessions: only ever anonymous, visible, clearable,
// service key only (Alex's conditions)
// ---------------------------------------------------------------------------

describe("Anonymous tester sessions (M3.2)", () => {
  async function anon() {
    const client = newClient(w.env, w.env.publishableKey);
    const s = await client.auth.signInAnonymously();
    assert.equal(s.error, null, s.error?.message);
    return { client, authId: s.data.user!.id };
  }

  it("P123 only an ANONYMOUS user can be made an anonymous tester — a permanent account is refused and left untouched", async () => {
    const a = await anon();
    try {
      await ok(w.service.rpc("admin_add_anonymous_tester", { p_user: a.authId, p_actor: ACTOR }));
      const g = await rows(a.client.from("gatherings").select("id").eq("is_seed", true).limit(1));
      assert.equal(g.length, 1, "the anonymous tester cannot see a seed gathering");
      const avaUser = (await c(M("Ava")).auth.getUser()).data.user!.id;
      assert.ok((await w.service.rpc("admin_add_anonymous_tester", { p_user: avaUser, p_actor: ACTOR })).error, "a permanent account was made an anonymous tester");
      assert.equal(await readable(c(M("Ava")), (await rows(w.service.from("gatherings").select("id").eq("is_seed", true).limit(1)))[0].id), false, "Ava was elevated");
    } finally {
      await removeUser(w.service, a.authId);
    }
  });

  it("P124 no visitor can make, list or clear anonymous tester sessions", async () => {
    for (const client of [c(M("Ava")), w.anon]) {
      assert.ok((await client.rpc("admin_add_anonymous_tester", { p_user: randomUUID(), p_actor: "self" })).error, "a visitor made one");
      assert.ok((await client.rpc("admin_anonymous_testers")).error, "a visitor listed them");
      assert.ok((await client.rpc("admin_clear_anonymous_tester", { p_user: randomUUID() })).error, "a visitor cleared one");
      assert.ok((await client.rpc("admin_clear_stale_anonymous_testers")).error, "a visitor ran the clean-up");
    }
  });

  it("P125 a session is listed, and clearing it deletes the anonymous user; the clean-up removes only stale still-anonymous ones", async () => {
    const a = await anon();
    const b = await anon();
    await ok(w.service.rpc("admin_add_anonymous_tester", { p_user: a.authId, p_actor: ACTOR }));
    await ok(w.service.rpc("admin_add_anonymous_tester", { p_user: b.authId, p_actor: ACTOR }));
    const listed = (await ok(w.service.rpc("admin_anonymous_testers"))) as { auth_user_id: string }[];
    assert.ok(listed.some((r) => r.auth_user_id === a.authId), "the session is not listed");

    await ok(w.service.rpc("admin_clear_anonymous_tester", { p_user: a.authId }));
    const goneA = await w.service.auth.admin.getUserById(a.authId);
    assert.ok(goneA.error || !goneA.data.user, "clearing left the anonymous user alive");

    // A fresh session is not stale; with a zero cutoff it is.
    assert.equal(await ok(w.service.rpc("admin_clear_stale_anonymous_testers", { p_older_than: "3 days", p_only: b.authId })), 0, "a fresh session was cleared as stale");
    // Only the session this test made — never one someone is walking with.
    assert.equal(await ok(w.service.rpc("admin_clear_stale_anonymous_testers", { p_older_than: "0 seconds", p_only: b.authId })), 1, "a stale session was not cleared");
    const goneB = await w.service.auth.admin.getUserById(b.authId);
    assert.ok(goneB.error || !goneB.data.user, "the stale session survived the clean-up");
  });
});

// ---------------------------------------------------------------------------
// Phase 3 M3.3 — the room (Alex, with Tatiana and Jayme, 28 Sept 2026)
// ---------------------------------------------------------------------------
// Each rule proved from both sides, with fresh people at a fresh gathering sized to 3,
// so the placement can be seen and nothing else in the world is touched.

describe("The room — who is in it, who reads it, who can post (M3.3)", () => {
  let G = "";
  const people: Record<string, { authId: string; personId: string; client: SupabaseClient }> = {};

  // A person who may meet: permanent, dated, with a photo — then opted in at G as themselves.
  async function meeter(label: string, gender: "woman" | "man" | "nonbinary", open = true, womenOnly = false) {
    const email = `${PREFIX}-${w.run}-room-${label.toLowerCase()}@example.com`;
    const password = randomUUID();
    const made = await w.service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { pind_harness: true } });
    assert.equal(made.error, null, made.error?.message);
    const authId = made.data.user!.id;
    const person = await ok(w.service.from("people").insert({ auth_user_id: authId, first_name: label, photo_path: `${authId}/face.png` }).select("id").single());
    await ok(w.service.from("people_private").insert({ person_id: person.id, gender, birth_year: 1994, include_in_women_only: womenOnly }));
    await ok(w.service.from("age_attestations").upsert({ person_id: person.id, source: "a26" }, { onConflict: "person_id", ignoreDuplicates: true }));
    const client = newClient(w.env, w.env.publishableKey);
    const signIn = await client.auth.signInWithPassword({ email, password });
    assert.equal(signIn.error, null, signIn.error?.message);
    await ok(client.from("pins").insert({ gathering_id: G, person_id: person.id, party_total: 1, open_to_meeting: open }).select("id").single());
    people[label] = { authId, personId: person.id, client };
    return people[label];
  }
  const roomsOf = async (label: string) => rows(people[label].client.rpc("my_rooms", { p_gathering: G }));
  const generalRoom = async (label: string) => (await roomsOf(label)).find((r: { women_only: boolean }) => !r.women_only)?.room_id as string | undefined;
  const post = (label: string, room: string, body: string) =>
    people[label].client.from("room_messages").insert({ room_id: room, author_id: people[label].personId, body }).select("id").single();
  const readBodies = async (label: string, room: string) =>
    (await rows(people[label].client.from("room_messages").select("body").eq("room_id", room))).map((m: { body: string }) => m.body);
  const pause = () => new Promise((r) => setTimeout(r, 3100));

  before(async () => {
    G = (
      await ok(
        w.service
          .from("gatherings")
          .insert({ name: `${PREFIX} ${w.run} Room`, starts_at: inDays(5), venue_id: w.venue, published_at: new Date().toISOString(), room_size: 3 })
          .select("id")
          .single(),
      )
    ).id;
  });

  after(async () => {
    for (const p of Object.values(people)) await removeUser(w.service, p.authId).catch(() => undefined);
  });

  it("P139 opting in places you; the fullest room with space fills first; the fourth of a room of 3 opens room 2; pinning without opting in places nobody", async () => {
    await meeter("Rae", "woman");
    await meeter("Sol", "man");
    await meeter("Tia", "woman");
    await meeter("Uma", "man");
    await meeter("Vic", "man", false);
    const r1 = await generalRoom("Rae");
    assert.ok(r1, "Rae was not placed");
    assert.equal(await generalRoom("Sol"), r1);
    assert.equal(await generalRoom("Tia"), r1, "the fullest room with space did not fill first");
    const r2 = await generalRoom("Uma");
    assert.ok(r2 && r2 !== r1, "the fourth person was not placed in a second room");
    assert.equal((await roomsOf("Vic")).length, 0, "someone pinned without opting in was placed in a room");
    const [first] = (await roomsOf("Rae")).filter((r: { women_only: boolean }) => !r.women_only);
    assert.deepEqual([first.number, first.members, first.open], [1, 3, true]);
  });

  it("P140 a message is read by the people in the room who can see its author — not by someone pinned without opting in, another room, a blocked person or a visitor", async () => {
    const r1 = (await generalRoom("Rae"))!;
    await ok(post("Rae", r1, "Hi — first time at this"));
    assert.deepEqual(await readBodies("Sol", r1), ["Hi — first time at this"], "someone in the room could not read it");
    assert.deepEqual(await readBodies("Uma", r1), [], "someone in another room read it");
    assert.deepEqual(await readBodies("Vic", r1), [], "someone pinned without opting in read it");
    assert.deepEqual(await rows(w.anon.from("room_messages").select("body").eq("room_id", r1)), [], "a visitor read it");
    // A block, either way, hides the author's messages and arrival card.
    await ok(w.service.from("blocks").insert({ blocker_id: people.Tia.personId, blocked_id: people.Rae.personId }));
    assert.deepEqual(await readBodies("Tia", r1), [], "a blocked pair still read each other");
    const cards = (await rows(people.Tia.client.from("room_members").select("person_id").eq("room_id", r1))).map((m: { person_id: string }) => m.person_id);
    assert.ok(!cards.includes(people.Rae.personId), "a blocked person's arrival card was visible");
    assert.ok(cards.includes(people.Sol.personId), "someone visible was missing from the room");
  });

  it("P141 posting is refused as someone else, in a room you are not in, and in a room of one", async () => {
    const r1 = (await generalRoom("Rae"))!;
    const r2 = (await generalRoom("Uma"))!;
    await denied(people.Sol.client.from("room_messages").insert({ room_id: r1, author_id: people.Rae.personId, body: "not me" }));
    await denied(post("Sol", r2, "wrong room"));
    // Room 2 has one person: nobody to talk to, so it is not open.
    await denied(post("Uma", r2, "anyone?"));
    assert.equal((await roomsOf("Uma"))[0].open, false);
  });

  it("P142 one message every 3 seconds, and 200 a day — both refused, both sides", async () => {
    const r1 = (await generalRoom("Rae"))!;
    await ok(post("Sol", r1, "one"));
    await denied(post("Sol", r1, "two, too soon"), "23514");
    // 199 more earlier today, set up by the service key (outside the limits): 200 in all.
    await ok(
      w.service.from("room_messages").insert(
        Array.from({ length: 199 }, (_, i) => ({ room_id: r1, author_id: people.Sol.personId, body: `earlier ${i}`, created_at: new Date(Date.now() - 3_600_000 - i * 1000).toISOString() })),
      ),
    );
    await pause();
    await denied(post("Sol", r1, "the 201st"), "23514");
    await ok(w.service.from("room_messages").delete().eq("author_id", people.Sol.personId).like("body", "earlier %"));
    await ok(post("Sol", r1, "under the cap again"), "after the day's messages go, posting works again");
  });

  // Since 6 Oct 2026 (L9) deleting is a removal through delete_room_message: a row delete
  // was broadcast by Realtime to every subscriber. The words are cleared at once.
  it("P143 you can delete your own message — it is gone for everyone, its author too, its words cleared — and nobody else's", async () => {
    const r1 = (await generalRoom("Rae"))!;
    await pause();
    const mine = await ok(post("Rae", r1, "take this back"));
    await denied(people.Sol.client.rpc("delete_room_message", { p_message: mine.id }));
    const rowDelete = await people.Sol.client.from("room_messages").delete().eq("id", mine.id).select("id");
    assert.deepEqual(rowDelete.data ?? [], [], "someone deleted another person's message");
    assert.ok((await readBodies("Sol", r1)).includes("take this back"));
    const ownRowDelete = await people.Rae.client.from("room_messages").delete().eq("id", mine.id).select("id");
    assert.deepEqual(ownRowDelete.data ?? [], [], "a row delete still works — it is broadcast to every subscriber");
    await ok(people.Rae.client.rpc("delete_room_message", { p_message: mine.id }));
    assert.ok(!(await readBodies("Sol", r1)).includes("take this back"), "a deleted message was still there for others");
    assert.ok(!(await readBodies("Rae", r1)).includes("take this back"), "a deleted message was still there for its author");
    const [row] = await ok(w.service.from("room_messages").select("body, deleted_at").eq("id", mine.id));
    assert.ok(row.deleted_at && row.body === "", "a deleted message kept its words");
  });

  it("P144 a safety report hides the message at once for others, keeps its snapshot, and the author still sees it", async () => {
    const r1 = (await generalRoom("Rae"))!;
    await pause();
    const msg = await ok(post("Rae", r1, "reportable line"));
    await ok(people.Sol.client.from("reports").insert({ reporter_id: people.Sol.personId, target_kind: "message", target_room_message_id: msg.id, reason: "uncomfortable" }));
    assert.ok(!(await readBodies("Sol", r1)).includes("reportable line"), "a reported message stayed visible");
    assert.ok((await readBodies("Rae", r1)).includes("reportable line"), "the author lost sight of their own message");
    const report = await serviceRow("reports", "target_room_message_id", msg.id, "reported_content_snapshot");
    assert.equal(report.reported_content_snapshot, "reportable line", "the report did not keep the text");
    // Nobody can report a message they cannot read.
    await denied(people.Uma.client.from("reports").insert({ reporter_id: people.Uma.personId, target_kind: "message", target_room_message_id: msg.id, reason: "spam" }));
  });

  it("P145 the women-only room: only the eligible are placed in it, and it is offered only from 3", async () => {
    const wo = (label: string) => roomsOf(label).then((rs) => rs.find((r: { women_only: boolean }) => r.women_only));
    // Rae and Tia are women: two eligible, so it is not offered yet.
    assert.equal(await wo("Rae"), undefined, "the women-only room was offered below 3");
    await meeter("Wen", "nonbinary", true, true);
    assert.ok(await wo("Rae"), "the women-only room was not offered to a woman at 3");
    assert.ok(await wo("Wen"), "a nonbinary person who chose inclusion was not in it");
    assert.equal(await wo("Sol"), undefined, "a man was placed in the women-only room");
    const woRoom = (await wo("Rae")).room_id as string;
    assert.deepEqual(await readBodies("Sol", woRoom), [], "a man read the women-only room");
  });

  it("P146 opting out takes you out: you stop reading the room and stop showing in it; opting back in returns you to it", async () => {
    const r1 = (await generalRoom("Rae"))!;
    await ok(people.Sol.client.from("pins").update({ open_to_meeting: false }).eq("person_id", people.Sol.personId).eq("gathering_id", G).select("id"));
    assert.equal(await generalRoom("Sol"), undefined, "opting out left you in the room");
    // Their own messages stay theirs (they can still delete them); everyone else's go.
    assert.ok(!(await readBodies("Sol", r1)).includes("Hi — first time at this"), "someone who opted out still read the room");
    assert.ok((await readBodies("Sol", r1)).includes("one"), "someone who opted out lost sight of their own message");
    const cards = (await rows(people.Rae.client.from("room_members").select("person_id").eq("room_id", r1))).map((m: { person_id: string }) => m.person_id);
    assert.ok(!cards.includes(people.Sol.personId), "someone who left still showed in the room");
    await ok(people.Sol.client.from("pins").update({ open_to_meeting: true }).eq("person_id", people.Sol.personId).eq("gathering_id", G).select("id"));
    assert.equal(await generalRoom("Sol"), r1, "opting back in did not return you to your room");
  });

  it("P147 after the gathering the room is read-only: posting is refused, reading still works though the list has closed", async () => {
    const r1 = (await generalRoom("Rae"))!;
    await ok(w.service.from("gatherings").update({ starts_at: inDays(-3) }).eq("id", G));
    try {
      await denied(post("Rae", r1, "too late"));
      assert.ok((await readBodies("Sol", r1)).includes("one"), "the room stopped being readable when the list closed");
    } finally {
      await ok(w.service.from("gatherings").update({ starts_at: inDays(5) }).eq("id", G));
    }
  });

  it("P148 the retention job and the placement machinery are nobody else's to call", async () => {
    for (const client of [people.Rae.client, w.anon]) {
      assert.ok((await client.rpc("admin_delete_expired_room_messages")).error, "a visitor ran the retention job");
    }
    assert.ok((await w.anon.rpc("my_rooms", { p_gathering: G })).error, "a visitor asked for rooms");
    await denied(people.Vic.client.from("room_members").insert({ room_id: (await generalRoom("Rae"))!, gathering_id: G, person_id: people.Vic.personId, women_only: false }));
  });
});

// ---------------------------------------------------------------------------
// Phase 3 M3.3 — small groups: "go together" from the room (first version)
// ---------------------------------------------------------------------------

describe("Small groups — invites to people you've talked with, the plan, the night (M3.3)", () => {
  let E = ""; // Events: a spot first
  let K = ""; // Community: at the gathering
  const people: Record<string, { authId: string; personId: string; client: SupabaseClient }> = {};

  async function meeter(label: string, gathering: string) {
    const email = `${PREFIX}-${w.run}-grp-${label.toLowerCase()}@example.com`;
    const password = randomUUID();
    const made = await w.service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { pind_harness: true } });
    assert.equal(made.error, null, made.error?.message);
    const authId = made.data.user!.id;
    const person = await ok(w.service.from("people").insert({ auth_user_id: authId, first_name: label, photo_path: `${authId}/face.png` }).select("id").single());
    await ok(w.service.from("people_private").insert({ person_id: person.id, gender: "man", birth_year: 1993 }));
    await ok(w.service.from("age_attestations").upsert({ person_id: person.id, source: "a26" }, { onConflict: "person_id", ignoreDuplicates: true }));
    const client = newClient(w.env, w.env.publishableKey);
    const signIn = await client.auth.signInWithPassword({ email, password });
    assert.equal(signIn.error, null, signIn.error?.message);
    await ok(client.from("pins").insert({ gathering_id: gathering, person_id: person.id, party_total: 1, open_to_meeting: true }).select("id").single());
    people[label] = { authId, personId: person.id, client };
    return people[label];
  }
  const room = async (label: string, gathering: string) =>
    (await rows(people[label].client.rpc("my_rooms", { p_gathering: gathering }))).find((r: { women_only: boolean }) => !r.women_only)?.room_id as string;
  const say = async (label: string, gathering: string, body: string) =>
    ok(people[label].client.from("room_messages").insert({ room_id: await room(label, gathering), author_id: people[label].personId, body }).select("id").single());
  const start = async (label: string, gathering: string, invitees: string[]) =>
    people[label].client.rpc("start_group", { p_room: await room(label, gathering), p_invitees: invitees.map((n) => people[n].personId) });
  const inviteFor = async (label: string, gathering: string) =>
    (await rows(people[label].client.rpc("my_invites", { p_gathering: gathering })))[0] as { invite_id: string; crew_id: string; from_name: string; members: string[] } | undefined;
  const crewState = async (crew: string) => (await serviceRow("crews", "id", crew, "state, spot_id, meet_at")) as { state: string; spot_id: string | null; meet_at: string | null };
  const pause = () => new Promise((r) => setTimeout(r, 3100));

  before(async () => {
    const make = async (label: string, extra: Record<string, unknown>) =>
      (await ok(w.service.from("gatherings").insert({ name: `${PREFIX} ${w.run} ${label}`, starts_at: inDays(4), venue_id: w.venue, published_at: new Date().toISOString(), ...extra }).select("id").single())).id as string;
    E = await make("Groups E", { source: "ticketmaster", convening: "a_spot_first" });
    K = await make("Groups K", { source: "manual" });
    const spots = await rows(w.service.from("gathering_spots").select("spot_id").eq("gathering_id", w.G));
    await ok(w.service.from("gathering_spots").insert(spots.map((s: { spot_id: string }, i: number) => ({ gathering_id: E, spot_id: s.spot_id, meet_at: inDays(4 - i / 100) }))));
    for (const n of ["Ada", "Bo", "Cy", "Di", "Ed", "Fay"]) await meeter(n, E);
    for (const n of ["Gil", "Hu", "Ike"]) await meeter(n, K);
  });

  after(async () => {
    for (const p of Object.values(people)) await removeUser(w.service, p.authId).catch(() => undefined);
  });

  it("P149 the default convening follows the source, and the admin can override it", async () => {
    assert.equal(await ok(w.anon.rpc("convening_of", { p_gathering: K })), "at_the_gathering");
    assert.equal(await ok(w.anon.rpc("convening_of", { p_gathering: E })), "a_spot_first");
  });

  it("P150 you can invite only people you've both talked with in this room — not before you've said hi, not someone silent, not two, not four", async () => {
    await denied(start("Ada", E, ["Bo", "Cy"]), "42501"); // Ada hasn't posted
    await say("Ada", E, "hi all");
    await say("Bo", E, "hey");
    await say("Cy", E, "hello");
    await denied(start("Ada", E, ["Bo", "Di"]), "42501"); // Di hasn't posted
    await denied(start("Ada", E, ["Bo"]), "22023"); // too few
    await say("Di", E, "hi");
    await say("Ed", E, "yo");
    await say("Fay", E, "hiya");
    await denied(start("Ada", E, ["Bo", "Cy", "Di", "Ed"]), "22023"); // too many
  });

  let crew = "";
  let diCrew = "";
  it("P151 a group exists only for its members and the people invited; the room cannot see it", async () => {
    crew = await ok(start("Ada", E, ["Bo", "Cy", "Fay"]));
    assert.equal((await rows(people.Ada.client.from("crews").select("id").eq("id", crew))).length, 1, "the starter could not see their group");
    assert.equal((await rows(people.Di.client.from("crews").select("id").eq("id", crew))).length, 0, "someone in the room saw the group");
    const inv = await inviteFor("Bo", E);
    assert.equal(inv?.from_name, "Ada", "the invitee did not see who asked");
    assert.equal(await inviteFor("Di", E), undefined, "someone not invited saw an invite");
    assert.equal((await rows(people.Ada.client.from("crew_invites").select("id").eq("crew_id", crew))).length, 0, "the inviter could read the invites (and so learn of a decline)");
  });

  it("P152 a decline is silent; an accept makes a member; at 3 the group is on", async () => {
    const cyInv = (await inviteFor("Cy", E))!;
    await ok(people.Cy.client.rpc("respond_to_invite", { p_invite: cyInv.invite_id, p_accept: false }));
    assert.equal((await rows(people.Ada.client.from("crew_members").select("person_id").eq("crew_id", crew))).length, 1, "a decline added someone");
    const boInv = (await inviteFor("Bo", E))!;
    await ok(people.Bo.client.rpc("respond_to_invite", { p_invite: boInv.invite_id, p_accept: true }));
    assert.equal((await rows(people.Ada.client.from("crew_members").select("person_id").eq("crew_id", crew).is("left_at", null))).length, 2);
    // Nobody else can accept someone else's invite.
    await denied(people.Di.client.rpc("respond_to_invite", { p_invite: boInv.invite_id, p_accept: true }), "42501");
    assert.equal((await crewState(crew)).state, "forming", "a spot-first group set a plan before three hours out");
  });

  it("P153 one group per person per gathering: accepting one lapses your other invites; a member can be neither invited nor start another", async () => {
    await pause();
    const other = await ok(start("Di", E, ["Ed", "Fay"]));
    assert.ok(other);
    diCrew = other as string;
    assert.equal((await rows(people.Fay.client.rpc("my_invites", { p_gathering: E }))).length, 2, "Fay should hold two invites");
    const fromAda = (await rows(people.Fay.client.rpc("my_invites", { p_gathering: E }))).find((i: { crew_id: string }) => i.crew_id === crew);
    await ok(people.Fay.client.rpc("respond_to_invite", { p_invite: fromAda.invite_id, p_accept: true }));
    assert.equal((await rows(people.Fay.client.rpc("my_invites", { p_gathering: E }))).length, 0, "the other invite did not lapse");
    // Bo is in Ada's group: nobody can invite him, and he cannot start a second.
    await denied(start("Ed", E, ["Bo", "Di"]), "42501");
    await denied(start("Bo", E, ["Di", "Ed"]));
    assert.equal((await rows(people.Ada.client.from("crew_members").select("person_id").eq("crew_id", crew).is("left_at", null))).length, 3, "the group is not on at 3");
  });

  it("P154 the group's thread: members read and post; the room and those invited do not", async () => {
    await ok(people.Ada.client.from("crew_messages").insert({ crew_id: crew, author_id: people.Ada.personId, kind: "user", body: "Spot B at 6?" }));
    const read = (label: string) => rows(people[label].client.from("crew_messages").select("body").eq("crew_id", crew));
    assert.equal((await read("Bo")).length, 1, "a member could not read the thread");
    assert.equal((await read("Di")).length, 0, "someone in the room read a group's thread");
    await denied(people.Di.client.from("crew_messages").insert({ crew_id: crew, author_id: people.Di.personId, kind: "user", body: "let me in" }));
    await denied(people.Bo.client.from("crew_messages").insert({ crew_id: crew, author_id: people.Bo.personId, kind: "system", body: "fake system" }));
  });

  it("P155 votes: members vote on the poll; others cannot", async () => {
    const props = await rows(people.Ada.client.from("crew_proposals").select("id").eq("crew_id", crew));
    assert.ok(props.length >= 1, "the group had no spot options");
    await ok(people.Bo.client.from("crew_proposal_votes").insert({ proposal_id: props[props.length - 1].id, person_id: people.Bo.personId }));
    await denied(people.Di.client.from("crew_proposal_votes").insert({ proposal_id: props[0].id, person_id: people.Di.personId }));
    assert.equal((await rows(people.Di.client.from("crew_proposals").select("id").eq("crew_id", crew))).length, 0, "a non-member read the poll");
  });

  it("P156 three hours out, a group of 3 takes the poll's leader without anyone setting it, and goes live; 'I'm here' needs a line and works only then", async () => {
    // Time moves to two hours before the start.
    const leader = (await rows(people.Ada.client.from("crew_proposals").select("id, spot_id").eq("crew_id", crew))).slice(-1)[0];
    await ok(w.service.from("gatherings").update({ starts_at: new Date(Date.now() + 2 * 3_600_000).toISOString() }).eq("id", E));
    await ok(w.service.rpc("admin_groups_tick"));
    const s = await crewState(crew);
    assert.equal(s.state, "live", "the group did not take its plan and go live");
    assert.equal(s.spot_id, leader.spot_id, "the plan was not the poll's leader");
    await denied(people.Bo.client.from("crew_members").update({ arrived_at: new Date().toISOString(), arrival_note: null }).eq("crew_id", crew).eq("person_id", people.Bo.personId).select("person_id"));
    await ok(people.Bo.client.from("crew_members").update({ arrived_at: new Date().toISOString(), arrival_note: "green Matthews jersey" }).eq("crew_id", crew).eq("person_id", people.Bo.personId).select("person_id"));
  });

  it("P157 at the gathering: a Community group of 3 has its plan at once — the start, no spot", async () => {
    for (const n of ["Gil", "Hu", "Ike"]) await say(n, K, `hi from ${n}`);
    const g = await ok(people.Gil.client.rpc("start_group", { p_room: await room("Gil", K), p_invitees: [people.Hu.personId, people.Ike.personId] }));
    for (const n of ["Hu", "Ike"]) {
      const inv = (await inviteFor(n, K))!;
      await ok(people[n].client.rpc("respond_to_invite", { p_invite: inv.invite_id, p_accept: true }));
    }
    const s = await crewState(g);
    assert.equal(s.state, "spot_set");
    assert.equal(s.spot_id, null, "an at-the-gathering plan named a spot");
    assert.ok(s.meet_at, "an at-the-gathering plan had no time");
  });

  it("P158 under 3 at six hours out, a forming group dissolves and releases its people; the lifecycle job is the service key's only", async () => {
    const dCrew = diCrew;
    assert.ok(dCrew, "Di's group was not made");
    // E is two hours out now: Di's group has one member (Fay went with Ada; Ed never answered).
    await ok(w.service.rpc("admin_groups_tick"));
    assert.equal((await crewState(dCrew)).state, "dissolved");
    assert.equal((await rows(w.service.from("crew_members").select("person_id").eq("crew_id", dCrew).is("left_at", null))).length, 0, "a dissolved group kept its people");
    for (const client of [people.Ada.client, w.anon]) assert.ok((await client.rpc("admin_groups_tick")).error, "a visitor ran the lifecycle job");
  });
});

// ---------------------------------------------------------------------------
// Phase 3 M3.3 — notifications #2 and #6, recorded at the moment (A18, six)
// ---------------------------------------------------------------------------

describe("Notifications #2 and #6 — written by the act itself, and refused when they should be (M3.3)", () => {
  let N = "";
  const people: Record<string, { authId: string; personId: string; client: SupabaseClient }> = {};

  async function meeter(label: string) {
    const email = `${PREFIX}-${w.run}-note-${label.toLowerCase()}@example.com`;
    const password = randomUUID();
    const made = await w.service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { pind_harness: true } });
    assert.equal(made.error, null, made.error?.message);
    const authId = made.data.user!.id;
    const person = await ok(w.service.from("people").insert({ auth_user_id: authId, first_name: label, photo_path: `${authId}/face.png` }).select("id").single());
    await ok(w.service.from("people_private").insert({ person_id: person.id, gender: "man", birth_year: 1992 }));
    await ok(w.service.from("age_attestations").upsert({ person_id: person.id, source: "a26" }, { onConflict: "person_id", ignoreDuplicates: true }));
    const client = newClient(w.env, w.env.publishableKey);
    const signIn = await client.auth.signInWithPassword({ email, password });
    assert.equal(signIn.error, null, signIn.error?.message);
    people[label] = { authId, personId: person.id, client };
    return people[label];
  }
  const optIn = (label: string) =>
    ok(people[label].client.from("pins").insert({ gathering_id: N, person_id: people[label].personId, party_total: 1, open_to_meeting: true }).select("id").single());
  const room = async (label: string) =>
    (await rows(people[label].client.rpc("my_rooms", { p_gathering: N }))).find((r: { women_only: boolean }) => !r.women_only)?.room_id as string;
  const notes = async (label: string, kind: string) =>
    rows(w.service.from("notifications").select("id, body, created_at").eq("person_id", people[label].personId).eq("kind", kind));
  const say = async (label: string, body: string) =>
    ok(people[label].client.from("room_messages").insert({ room_id: await room(label), author_id: people[label].personId, body }).select("id").single());
  const pause = () => new Promise((r) => setTimeout(r, 3100));

  before(async () => {
    N = (await ok(w.service.from("gatherings").insert({ name: `${PREFIX} ${w.run} Notes`, starts_at: inDays(6), venue_id: w.venue, published_at: new Date().toISOString() }).select("id").single())).id;
    for (const n of ["Jo", "Kit", "Lu", "Mo"]) await meeter(n);
  });
  after(async () => {
    for (const p of Object.values(people)) await removeUser(w.service, p.authId).catch(() => undefined);
  });

  it("P159 #2: the first person is told, by name, when the second arrives — the second is not, and nobody is told twice", async () => {
    await optIn("Jo");
    assert.equal((await notes("Jo", "room_open")).length, 0, "someone alone was told there was someone to talk to");
    await optIn("Kit");
    const jo = await notes("Jo", "room_open");
    assert.equal(jo.length, 1, "the promise did not fire: the first person was not told");
    assert.match(jo[0].body, /^Kit's going to .* too — say hi$/);
    assert.equal((await notes("Kit", "room_open")).length, 0, "the second person was told about themselves");
    await optIn("Lu");
    assert.equal((await notes("Jo", "room_open")).length, 1, "the first person was told twice");
    assert.equal((await notes("Lu", "room_open")).length, 0);
  });

  it("P160 #6: the first message since you last looked — then nothing for an hour; never to the author; not to someone who switched it off", async () => {
    await ok(people.Lu.client.from("notification_settings").insert({ person_id: people.Lu.personId, room_activity: false }));
    await say("Jo", "anyone getting food before?");
    assert.equal((await notes("Kit", "room_activity")).length, 1, "the first message since Kit looked did not notify");
    assert.equal((await notes("Jo", "room_activity")).length, 0, "the author was notified of their own message");
    assert.equal((await notes("Lu", "room_activity")).length, 0, "someone who switched it off was notified");
    await pause();
    await say("Jo", "and a second one");
    assert.equal((await notes("Kit", "room_activity")).length, 1, "a second message inside the hour notified again");
    // Kit looks; a message after that, still inside the hour, stays quiet (the hour holds).
    await ok(people.Kit.client.rpc("room_seen", { p_room: await room("Kit") }));
    await pause();
    await say("Jo", "third");
    assert.equal((await notes("Kit", "room_activity")).length, 1, "the hour did not hold after Kit looked");
    // Two hours on (moved back by the service key). Kit was told and has NOT looked since:
    // still the same unread activity, so no second notification, however long it has been.
    await ok(w.service.from("notifications").update({ created_at: new Date(Date.now() - 2 * 3_600_000).toISOString() }).eq("person_id", people.Kit.personId).eq("kind", "room_activity"));
    await ok(w.service.from("room_members").update({ last_seen_at: new Date(Date.now() - 3 * 3_600_000).toISOString() }).eq("person_id", people.Kit.personId).eq("gathering_id", N));
    await pause();
    await say("Jo", "fourth, unseen");
    assert.equal((await notes("Kit", "room_activity")).length, 1, "someone was told twice about activity they have not looked at");
    // Kit looked after being told, and the hour has passed: the next message notifies once more.
    await ok(w.service.from("room_members").update({ last_seen_at: new Date(Date.now() - 90 * 60_000).toISOString() }).eq("person_id", people.Kit.personId).eq("gathering_id", N));
    await pause();
    await say("Jo", "fifth, after Kit looked and the hour passed");
    assert.equal((await notes("Kit", "room_activity")).length, 2, "after looking and an hour, new activity did not notify");
  });

  it("P161 #6 is not sent across a block, nor to someone looking right now", async () => {
    await optIn("Mo");
    await ok(w.service.from("blocks").insert({ blocker_id: people.Mo.personId, blocked_id: people.Jo.personId }));
    await ok(people.Kit.client.rpc("room_seen", { p_room: await room("Kit") }));
    const kitBefore = (await notes("Kit", "room_activity")).length;
    await pause();
    await say("Jo", "after the block");
    assert.equal((await notes("Mo", "room_activity")).length, 0, "a blocked pair was notified of each other");
    assert.equal((await notes("Kit", "room_activity")).length, kitBefore, "someone looking right now was notified");
  });

  it("P162 your switches and phones are yours only; the queue and the delivery functions are the service key's", async () => {
    await ok(people.Jo.client.rpc("register_device", { p_token: `ExponentPushToken[${w.run}-jo]`, p_platform: "ios" }));
    assert.equal((await rows(people.Jo.client.from("device_tokens").select("token"))).length, 1);
    assert.equal((await rows(people.Kit.client.from("device_tokens").select("token"))).length, 0, "someone read another person's phone");
    await denied(people.Kit.client.from("device_tokens").insert({ token: `ExponentPushToken[${w.run}-x]`, person_id: people.Jo.personId, platform: "ios" }));
    await denied(people.Kit.client.from("notification_settings").insert({ person_id: people.Jo.personId, room_activity: false }));
    await noAccess(people.Jo.client, "notifications");
    for (const fn of ["admin_pending_notifications", "admin_mark_notification", "admin_forget_device", "admin_switch_off"]) {
      assert.ok((await people.Jo.client.rpc(fn, {})).error, `${fn} was callable by a person`);
    }
    // The Worker's view of the queue carries where each can go.
    // Jo is a harness person: sent nowhere — no phone, no email — so a harness run never
    // emails @example.com (m3_3_notifications_skip_harness). The live delivery runs every
    // minute, so her notification is either still queued (and the queue shows nowhere to
    // send it) or already delivered (and its channel is "none"). Either way, never sent.
    const pending = (await ok(w.service.rpc("admin_pending_notifications", { p_limit: 500 }))) as { person_id: string; tokens: string[]; email: string | null }[];
    const queued = pending.find((p) => p.person_id === people.Jo.personId);
    if (queued) assert.deepEqual([queued.tokens, queued.email], [[], null], "a harness person would have been emailed or pushed");
    const delivered = await rows(w.service.from("notifications").select("channel").eq("person_id", people.Jo.personId).not("sent_at", "is", null));
    for (const d of delivered) assert.equal(d.channel, "none", "a harness person was emailed or pushed");
    assert.ok(queued || delivered.length, "Jo's notification was neither queued nor delivered");
  });

  it("P187 sign-out (A23): you can take your own phone off your account, and nobody else can", async () => {
    // A delete that RLS filters is not an error — it removes nothing and says so by
    // silence. So the refusal is proved by the row still being there, read by the
    // service key, and the allowance by it being gone.
    const tok = `ExponentPushToken[${w.run}-p187]`;
    await ok(people.Jo.client.rpc("register_device", { p_token: tok, p_platform: "ios" }));
    const held = async () => (await rows(w.service.from("device_tokens").select("token").eq("token", tok))).length;
    assert.equal(await held(), 1, "setup: Jo's phone was not registered");
    await people.Kit.client.from("device_tokens").delete().eq("token", tok);
    assert.equal(await held(), 1, "someone took another person's phone off their account");
    await ok(people.Jo.client.from("device_tokens").delete().eq("token", tok));
    assert.equal(await held(), 0, "a person could not take their own phone off their account");
  });
});

describe("A group's deadline moves with it, and a group under 3 can invite someone else (M3.3)", () => {
  let Z = "";
  const people: Record<string, { authId: string; personId: string; client: SupabaseClient }> = {};
  async function meeter(label: string) {
    const email = `${PREFIX}-${w.run}-late-${label.toLowerCase()}@example.com`;
    const password = randomUUID();
    const made = await w.service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { pind_harness: true } });
    assert.equal(made.error, null, made.error?.message);
    const authId = made.data.user!.id;
    const person = await ok(w.service.from("people").insert({ auth_user_id: authId, first_name: label, photo_path: `${authId}/face.png` }).select("id").single());
    await ok(w.service.from("people_private").insert({ person_id: person.id, gender: "man", birth_year: 1991 }));
    await ok(w.service.from("age_attestations").upsert({ person_id: person.id, source: "a26" }, { onConflict: "person_id", ignoreDuplicates: true }));
    const client = newClient(w.env, w.env.publishableKey);
    const signIn = await client.auth.signInWithPassword({ email, password });
    assert.equal(signIn.error, null, signIn.error?.message);
    await ok(client.from("pins").insert({ gathering_id: Z, person_id: person.id, party_total: 1, open_to_meeting: true }).select("id").single());
    people[label] = { authId, personId: person.id, client };
  }
  const room = async (label: string) =>
    (await rows(people[label].client.rpc("my_rooms", { p_gathering: Z }))).find((r: { women_only: boolean }) => !r.women_only)?.room_id as string;
  const inviteFor = async (label: string) => (await rows(people[label].client.rpc("my_invites", { p_gathering: Z })))[0] as { invite_id: string } | undefined;
  const state = async (crew: string) => (await serviceRow("crews", "id", crew, "state")).state as string;
  let crew = "";

  before(async () => {
    // Four hours out: already inside the six-hour mark.
    Z = (await ok(w.service.from("gatherings").insert({ name: `${PREFIX} ${w.run} Late`, starts_at: new Date(Date.now() + 4 * 3_600_000).toISOString(), venue_id: w.venue, published_at: new Date().toISOString(), source: "manual" }).select("id").single())).id;
    for (const n of ["Pia", "Quin", "Rex", "Sam", "Ty", "Uri"]) await meeter(n);
    for (const n of ["Pia", "Quin", "Rex", "Sam"]) await ok(people[n].client.from("room_messages").insert({ room_id: await room(n), author_id: people[n].personId, body: `hi, ${n}` }));
  });
  after(async () => {
    for (const p of Object.values(people)) await removeUser(w.service, p.authId).catch(() => undefined);
  });

  it("P163 a group started inside the six-hour mark is NOT closed by the next run — it has until its own deadline", async () => {
    crew = await ok(people.Pia.client.rpc("start_group", { p_room: await room("Pia"), p_invitees: [people.Quin.personId, people.Rex.personId] }));
    await ok(w.service.rpc("admin_groups_tick"));
    assert.equal(await state(crew), "forming", "a group started late closed on the next run");
    // Its deadline: the later of −6 h and started + 2 h, capped at −3 h — here, −3 h.
    const closes = new Date(await ok(people.Pia.client.rpc("group_closes_at", { p_crew: crew }))).getTime();
    const starts = new Date((await serviceRow("gatherings", "id", Z, "starts_at")).starts_at).getTime();
    assert.ok(Math.abs(closes - (starts - 3 * 3_600_000)) < 60_000, "the deadline was not three hours before the start");
    assert.equal(await ok(people.Ty.client.rpc("group_closes_at", { p_crew: crew })), null, "someone outside the group read its deadline");
  });

  it("P164 while under 3, a member can invite someone else they've talked with — not someone silent, not as an outsider, and not once the group is on", async () => {
    const quin = (await inviteFor("Quin"))!;
    await ok(people.Quin.client.rpc("respond_to_invite", { p_invite: quin.invite_id, p_accept: false }));
    await denied(people.Pia.client.rpc("invite_more", { p_crew: crew, p_invitees: [people.Ty.personId] }), "42501"); // Ty never posted
    await denied(people.Sam.client.rpc("invite_more", { p_crew: crew, p_invitees: [people.Quin.personId] }), "42501"); // Sam is not in it
    await ok(people.Pia.client.rpc("invite_more", { p_crew: crew, p_invitees: [people.Sam.personId] }));
    for (const n of ["Rex", "Sam"]) {
      const inv = (await inviteFor(n))!;
      await ok(people[n].client.rpc("respond_to_invite", { p_invite: inv.invite_id, p_accept: true }));
    }
    await denied(people.Pia.client.rpc("invite_more", { p_crew: crew, p_invitees: [people.Quin.personId] }), "42501"); // on at 3
  });

  it("P165 under 3 past its own deadline, a late group closes — and its open invites lapse with it", async () => {
    for (const n of ["Ty", "Uri"]) await ok(people[n].client.from("room_messages").insert({ room_id: await room(n), author_id: people[n].personId, body: `hi, ${n}` }));
    const late = await ok(people.Quin.client.rpc("start_group", { p_room: await room("Quin"), p_invitees: [people.Ty.personId, people.Uri.personId] }));
    await ok(w.service.rpc("admin_groups_tick"));
    assert.equal(await state(late), "forming", "a group started late closed at once");
    // Three hours pass (moved by the service key): its deadline, two hours after it started, is gone.
    await ok(w.service.from("crews").update({ created_at: new Date(Date.now() - 3 * 3_600_000).toISOString() }).eq("id", late));
    await ok(w.service.rpc("admin_groups_tick"));
    assert.equal(await state(late), "dissolved", "a group under 3 past its deadline did not close");
    assert.equal(await inviteFor("Ty"), undefined, "a closed group's invite was still open");
  });

  it("P166 #3: an invite tells the invitee; a decline tells nobody; a closed group tells everyone in it, the same words, attributing nothing", async () => {
    const note = async (label: string) =>
      (await rows(w.service.from("notifications").select("body").eq("person_id", people[label].personId).eq("kind", "plan_status"))).map((n: { body: string }) => n.body);
    assert.ok((await note("Rex")).some((b: string) => /^Pia wants to go together to /.test(b)), "an invitee was not told");
    assert.ok(!(await note("Pia")).some((b: string) => /declin|said no|turned/i.test(b)), "an inviter was told of a decline");
    assert.ok((await note("Quin")).some((b: string) => /^Not enough people joined your group for .*, so it's closed\. You're all still in the room\.$/.test(b)), "a closed group did not say so");
  });
});

// ---------------------------------------------------------------------------
// Phase 3 M3.3 — the night and after: #4, A16's ticks, connections (V23), the
// after-event question, #5, "women-only rooms only", invite (#7). Alex, 29 Sept 2026.
// ---------------------------------------------------------------------------

// A wall-clock time in Toronto, as an instant — for #5's "9am local".
function torontoAt(ymd: string, h: number, m = 0): string {
  const [y, mo, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y!, mo! - 1, d!, h, m);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value]),
  );
  const shown = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!);
  return new Date(guess - (shown - guess)).toISOString();
}

describe("The night and after — #4, A16, connections (V23), the question, #5 (M3.3)", () => {
  let A = "";
  let crew = "";
  let endDay = ""; // the Toronto date of the morning after
  const people: Record<string, { authId: string; personId: string; client: SupabaseClient }> = {};
  async function meeter(label: string, pinAt: string | null) {
    const email = `${PREFIX}-${w.run}-after-${label.toLowerCase()}@example.com`;
    const password = randomUUID();
    const made = await w.service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { pind_harness: true } });
    assert.equal(made.error, null, made.error?.message);
    const authId = made.data.user!.id;
    const person = await ok(w.service.from("people").insert({ auth_user_id: authId, first_name: label, photo_path: `${authId}/face.png` }).select("id").single());
    await ok(w.service.from("people_private").insert({ person_id: person.id, gender: "man", birth_year: 1990 }));
    await ok(w.service.from("age_attestations").upsert({ person_id: person.id, source: "a26" }, { onConflict: "person_id", ignoreDuplicates: true }));
    const client = newClient(w.env, w.env.publishableKey);
    const signIn = await client.auth.signInWithPassword({ email, password });
    assert.equal(signIn.error, null, signIn.error?.message);
    if (pinAt) await ok(client.from("pins").insert({ gathering_id: pinAt, person_id: person.id, party_total: 1, open_to_meeting: true }).select("id").single());
    people[label] = { authId, personId: person.id, client };
  }
  const id = (label: string) => people[label]!.personId;
  const cl = (label: string) => people[label]!.client;
  const room = async (label: string) =>
    (await rows(cl(label).rpc("my_rooms", { p_gathering: A }))).find((r: { women_only: boolean }) => !r.women_only)?.room_id as string;
  const tick = (who: string, to: string, kind: "we_met" | "keep_in_touch", on = true) =>
    cl(who).rpc("after_tick", { p_crew: crew, p_to: id(to), p_kind: kind, p_on: on });
  const seen = async (who: string, about: string) => {
    const s = await ok(cl(who).rpc("after_state", { p_gathering: A }));
    return (s.people as { person_id: string; we_met: boolean; we_met_matched: boolean; keep: boolean; keep_matched: boolean }[]).find((p) => p.person_id === id(about));
  };
  const reads = async (who: string, about: string) => (await rows(cl(who).from("people").select("id").eq("id", id(about)))).length === 1;
  const notes = async (label: string, kind: string) =>
    rows(w.service.from("notifications").select("body, path").eq("person_id", id(label)).eq("kind", kind));

  before(async () => {
    A = (await ok(w.service.from("gatherings").insert({ name: `${PREFIX} ${w.run} After`, starts_at: inDays(3), venue_id: w.venue, published_at: new Date().toISOString(), source: "manual" }).select("id").single())).id;
    for (const n of ["Ann", "Ben", "Cat", "Eve"]) await meeter(n, A);
    await meeter("Fox", null);
    for (const n of ["Ann", "Ben", "Cat"]) await ok(cl(n).from("room_messages").insert({ room_id: await room(n), author_id: id(n), body: `hi, ${n}` }));
    crew = await ok(cl("Ann").rpc("start_group", { p_room: await room("Ann"), p_invitees: [id("Ben"), id("Cat")] }));
    for (const n of ["Ben", "Cat"]) {
      const inv = (await rows(cl(n).rpc("my_invites", { p_gathering: A })))[0];
      await ok(cl(n).rpc("respond_to_invite", { p_invite: inv.invite_id, p_accept: true }));
    }
  });
  after(async () => {
    for (const p of Object.values(people)) await removeUser(w.service, p.authId).catch(() => undefined);
  });

  it("P167 before the end: no ticks (the group isn't done) and no answer (the night hasn't happened)", async () => {
    await denied(tick("Ann", "Ben", "we_met"), "42501");
    await denied(cl("Eve").from("survey_responses").insert({ gathering_id: A, person_id: id("Eve"), would_have_gone: "yes" }));
  });

  it("P168 #4: going live tells each member once, with the way to 'I'm here' — nobody outside the group", async () => {
    await ok(w.service.from("gatherings").update({ starts_at: new Date(Date.now() + 2 * 3_600_000).toISOString() }).eq("id", A));
    await ok(w.service.rpc("admin_groups_tick"));
    assert.equal((await serviceRow("crews", "id", crew, "state")).state, "live");
    await ok(w.service.rpc("admin_groups_tick"));
    for (const n of ["Ann", "Ben", "Cat"]) {
      const d = await notes(n, "day_of");
      assert.equal(d.length, 1, `${n} was told ${d.length} times`);
      assert.equal(d[0].path, `/group/${crew}`);
      assert.match(d[0].body, /^(Tonight|Today): .* — tap when you're there$/);
    }
    assert.equal((await notes("Eve", "day_of")).length, 0, "someone outside the group was told");
  });

  it("P169 after the end the group is done; a 'we met' is invisible to its person until they tick back; it can be taken back until then, and not after", async () => {
    // Two days ago at 7pm Toronto — so the effective end, and the morning after, are past.
    const twoAgo = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const starts = torontoAt(twoAgo, 19);
    await ok(w.service.from("gatherings").update({ starts_at: starts, ends_at: null }).eq("id", A));
    endDay = new Date(Date.parse(starts) + 86_400_000).toISOString().slice(0, 10);
    await ok(w.service.rpc("admin_groups_tick"));
    assert.equal((await serviceRow("crews", "id", crew, "state")).state, "done");

    await ok(tick("Ann", "Ben", "we_met"));
    const ann = (await seen("Ann", "Ben"))!;
    assert.deepEqual([ann.we_met, ann.we_met_matched], [true, false]);
    const ben = (await seen("Ben", "Ann"))!;
    assert.deepEqual([ben.we_met, ben.we_met_matched], [false, false], "Ben learned of a tick he had not matched");
    await denied(tick("Ann", "Ben", "keep_in_touch"), "42501"); // not before "we met" is matched
    await ok(tick("Ann", "Ben", "we_met", false)); // taken back while unmatched
    assert.equal((await seen("Ann", "Ben"))!.we_met, false);
    await ok(tick("Ann", "Ben", "we_met"));
    await ok(tick("Ben", "Ann", "we_met"));
    assert.equal((await seen("Ben", "Ann"))!.we_met_matched, true);
    await denied(tick("Ann", "Ben", "we_met", false), "42501"); // a match cannot be undone
    assert.equal(await ok(cl("Ann").rpc("showed_up", { p_person: id("Ann") })), true, "a matched 'we met' minted no badge");
    assert.equal(await ok(cl("Cat").rpc("showed_up", { p_person: id("Cat") })), false, "a badge without a match");
  });

  it("P170 'keep in touch' both ways makes a connection — one way makes nothing; the tables stay unreadable", async () => {
    await ok(tick("Ann", "Ben", "keep_in_touch"));
    assert.equal((await rows(cl("Ann").rpc("my_connections"))).length, 0, "one-way 'keep in touch' made a connection");
    await ok(tick("Ben", "Ann", "keep_in_touch"));
    const mine = await rows(cl("Ann").rpc("my_connections"));
    assert.deepEqual(mine.map((c: { person_id: string }) => c.person_id), [id("Ben")]);
    assert.match(mine[0].met_at, /After$/);
    assert.equal((await rows(cl("Cat").rpc("my_connections"))).length, 0);
    for (const t of ["confirmations", "connections", "connection_invites"]) await noAccess(cl("Ann"), t);
  });

  it("P171 nobody outside the group can tick or be ticked", async () => {
    await denied(cl("Eve").rpc("after_tick", { p_crew: crew, p_to: id("Ann"), p_kind: "we_met", p_on: true }), "42501");
    await denied(tick("Ann", "Eve", "we_met"), "42501");
    await denied(tick("Ann", "Ann", "we_met"), "42501");
  });

  it("P172 V23: crewmates see each other for A16's 7 days, connections always; not a stranger, and not across a block", async () => {
    assert.ok(await reads("Cat", "Ann"), "a crewmate could not see Ann after the night");
    assert.ok(await reads("Ben", "Ann"), "a connection could not see Ann");
    assert.ok(!(await reads("Fox", "Ann")), "a stranger saw Ann");
    await ok(w.service.from("blocks").insert({ blocker_id: id("Ann"), blocked_id: id("Ben") }));
    assert.ok(!(await reads("Ben", "Ann")), "a block did not hide a connection");
    assert.equal((await rows(cl("Ben").rpc("my_connections"))).length, 0, "a block left the connection listed");
    assert.equal((await rows(cl("Ann").rpc("my_connections"))).length, 0, "a block left the connection listed for the blocker");
    await ok(w.service.from("blocks").delete().eq("blocker_id", id("Ann")).eq("blocked_id", id("Ben")));
  });

  it("P173 the question: once, after the end, by someone who was open to meeting — readable only by them", async () => {
    await ok(cl("Eve").from("survey_responses").insert({ gathering_id: A, person_id: id("Eve"), would_have_gone: "no" }).select("id").single());
    await denied(cl("Eve").from("survey_responses").insert({ gathering_id: A, person_id: id("Eve"), would_have_gone: "yes" }));
    await denied(cl("Fox").from("survey_responses").insert({ gathering_id: A, person_id: id("Fox"), would_have_gone: "yes" }));
    await denied(cl("Ann").from("survey_responses").insert({ gathering_id: A, person_id: id("Eve"), would_have_gone: "yes" }));
    assert.equal((await rows(cl("Ann").from("survey_responses").select("id").eq("person_id", id("Eve")))).length, 0, "someone read another's answer");
    const s = await ok(cl("Eve").rpc("after_state", { p_gathering: A }));
    assert.deepEqual([s.asked, s.answered, s.crew_id], [true, true, null]);
  });

  it("P174 #5: at 9am the morning after — 'Did you meet up?' to the group, only the question to everyone else; not before 9, never twice, never a backlog", async () => {
    await ok(w.service.rpc("admin_next_morning_tick", { p_now: torontoAt(endDay, 8, 30) }));
    assert.equal((await notes("Ann", "next_morning")).length, 0, "#5 went before 9am");
    const late = new Date(Date.parse(torontoAt(endDay, 9)) + 36 * 3_600_000).toISOString();
    await ok(w.service.rpc("admin_next_morning_tick", { p_now: late }));
    assert.equal((await notes("Ann", "next_morning")).length, 0, "#5 sent a backlog a day and a half late");
    await ok(w.service.rpc("admin_next_morning_tick", { p_now: torontoAt(endDay, 9, 30) }));
    await ok(w.service.rpc("admin_next_morning_tick", { p_now: torontoAt(endDay, 10, 30) }));
    const ann = await notes("Ann", "next_morning");
    const eve = await notes("Eve", "next_morning");
    assert.equal(ann.length, 1, "the group member was not told exactly once");
    assert.match(ann[0].body, /^Did you meet up at /);
    assert.equal(eve.length, 1);
    assert.match(eve[0].body, /^How was .*\? One quick question/);
    assert.doesNotMatch(eve[0].body, /meet up|group|didn't|alone/i, "the non-group line implied something");
    assert.equal((await notes("Fox", "next_morning")).length, 0);
    for (const client of [cl("Ann"), w.anon]) assert.ok((await client.rpc("admin_next_morning_tick", {})).error, "a visitor ran #5");
  });

  it("P175 after A16's 7 days: ticks close, and a crewmate who isn't a connection stops seeing you — a connection doesn't", async () => {
    await ok(w.service.from("gatherings").update({ starts_at: new Date(Date.now() - 9 * 86_400_000).toISOString() }).eq("id", A));
    await denied(tick("Cat", "Ann", "we_met"), "42501");
    assert.ok(!(await reads("Cat", "Ann")), "a crewmate still saw Ann after the 7 days");
    assert.ok(await reads("Ben", "Ann"), "a connection lost sight of Ann");
  });
});

describe("Women-only rooms only — a real only (Alex, 29 Sept 2026)", () => {
  let W = "";
  const people: Record<string, { authId: string; personId: string; client: SupabaseClient }> = {};
  async function person(label: string, gender: "woman" | "man" | "nonbinary", include = false) {
    const email = `${PREFIX}-${w.run}-wor-${label.toLowerCase()}@example.com`;
    const password = randomUUID();
    const made = await w.service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { pind_harness: true } });
    assert.equal(made.error, null, made.error?.message);
    const authId = made.data.user!.id;
    const p = await ok(w.service.from("people").insert({ auth_user_id: authId, first_name: label, photo_path: `${authId}/face.png` }).select("id").single());
    await ok(w.service.from("people_private").insert({ person_id: p.id, gender, birth_year: 1995, include_in_women_only: include }));
    await ok(w.service.from("age_attestations").upsert({ person_id: p.id, source: "a26" }, { onConflict: "person_id", ignoreDuplicates: true }));
    const client = newClient(w.env, w.env.publishableKey);
    assert.equal((await client.auth.signInWithPassword({ email, password })).error, null);
    people[label] = { authId, personId: p.id, client };
  }
  const cl = (l: string) => people[l]!.client;
  const pin = (l: string) => ok(cl(l).from("pins").insert({ gathering_id: W, person_id: people[l]!.personId, party_total: 1, open_to_meeting: true }).select("id").single());
  const memberships = async (l: string) =>
    (await rows(w.service.from("room_members").select("women_only").eq("person_id", people[l]!.personId).eq("gathering_id", W).is("left_at", null))).map((r: { women_only: boolean }) => r.women_only).sort();
  const waiting = (l: string) => ok(cl(l).rpc("waiting_for_women_only_room", { p_gathering: W }));

  before(async () => {
    W = (await ok(w.service.from("gatherings").insert({ name: `${PREFIX} ${w.run} WOR`, starts_at: inDays(4), venue_id: w.venue, published_at: new Date().toISOString(), source: "manual" }).select("id").single())).id;
    await person("Wen", "woman");
    await person("Mo", "man");
    await person("Wanda", "woman");
    await person("Nia", "nonbinary", true);
  });
  after(async () => {
    for (const p of Object.values(people)) await removeUser(w.service, p.authId).catch(() => undefined);
  });

  it("P176 only the eligible can set it, and only through its function", async () => {
    await denied(cl("Mo").rpc("set_women_only_rooms", { p_on: true }), "42501");
    await denied(cl("Wen").from("people_private").update({ women_only_rooms: true }).eq("person_id", people.Wen!.personId).select("person_id"));
    await ok(cl("Wen").rpc("set_women_only_rooms", { p_on: true }));
  });

  it("P177 set, she is placed in no general room; she is told she's waiting — never how many — and #2 doesn't fire for a room she can't see", async () => {
    await pin("Wen");
    await pin("Mo");
    assert.deepEqual(await memberships("Wen"), [true], "someone who chose women-only was placed in the general room");
    assert.equal(await waiting("Wen"), true);
    assert.deepEqual(await rows(cl("Wen").rpc("my_rooms", { p_gathering: W })), [], "a women-only room was offered under 3");
    await pin("Wanda");
    const wen = await rows(w.service.from("notifications").select("body").eq("person_id", people.Wen!.personId).eq("kind", "room_open"));
    assert.equal(wen.length, 0, "#2 fired for a women-only room of 2");
  });

  it("P178 one tap joins the general room for this gathering; switching back on leaves it", async () => {
    await ok(cl("Wen").rpc("join_general_room", { p_gathering: W }));
    assert.deepEqual(await memberships("Wen"), [false, true]);
    assert.equal(await waiting("Wen"), false);
    await denied(cl("Mo").rpc("join_general_room", { p_gathering: randomUUID() }), "42501");
    await ok(cl("Wen").rpc("set_women_only_rooms", { p_on: true }));
    assert.deepEqual(await memberships("Wen"), [true], "switching on left her in the general room");
  });

  it("P179 at 3 eligible the women-only room opens, #2 says so, and switching off returns her to the general room", async () => {
    await pin("Nia");
    assert.equal(await waiting("Wen"), false);
    assert.ok((await rows(cl("Wen").rpc("my_rooms", { p_gathering: W }))).some((r: { women_only: boolean }) => r.women_only), "the room did not open at 3");
    const wen = await rows(w.service.from("notifications").select("body").eq("person_id", people.Wen!.personId).eq("kind", "room_open"));
    assert.equal(wen.length, 1);
    assert.match(wen[0].body, /^The women-only room for .* is open — say hi$/);
    assert.equal((await rows(cl("Mo").rpc("my_rooms", { p_gathering: W }))).some((r: { women_only: boolean }) => r.women_only), false, "a man was offered the women-only room");
    await ok(cl("Wen").rpc("set_women_only_rooms", { p_on: false }));
    assert.deepEqual(await memberships("Wen"), [false, true]);
  });
});

describe("'Get the app' is seen once — per person, on their own row (M3.3)", () => {
  it("P183 a person marks their own nudge seen; nobody else's", async () => {
    const ava = c(M("Ava"));
    const now = new Date().toISOString();
    assert.equal((await rows(ava.from("people_private").update({ app_nudge_seen_at: now }).eq("person_id", id("Ava")).select("person_id"))).length, 1);
    assert.equal((await rows(ava.from("people_private").update({ app_nudge_seen_at: now }).eq("person_id", id("Ben")).select("person_id"))).length, 0, "someone marked another person's nudge");
    assert.equal((await serviceRow("people_private", "person_id", id("Ben"), "app_nudge_seen_at")).app_nudge_seen_at, null);
    await ok(w.service.from("people_private").update({ app_nudge_seen_at: null }).eq("person_id", id("Ava")));
  });
});

describe("Invite — #7, between connections only (Alex, 29 Sept 2026)", () => {
  const gs: string[] = [];
  const people: Record<string, { authId: string; personId: string; client: SupabaseClient }> = {};
  async function person(label: string) {
    const email = `${PREFIX}-${w.run}-inv-${label.toLowerCase()}@example.com`;
    const password = randomUUID();
    const made = await w.service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { pind_harness: true } });
    assert.equal(made.error, null, made.error?.message);
    const authId = made.data.user!.id;
    const p = await ok(w.service.from("people").insert({ auth_user_id: authId, first_name: label, photo_path: `${authId}/face.png` }).select("id").single());
    const client = newClient(w.env, w.env.publishableKey);
    assert.equal((await client.auth.signInWithPassword({ email, password })).error, null);
    people[label] = { authId, personId: p.id, client };
  }
  const id = (l: string) => people[l]!.personId;
  const cl = (l: string) => people[l]!.client;
  const pinTo = (l: string, g: string) => ok(w.service.from("pins").insert({ gathering_id: g, person_id: id(l), party_total: 1 }).select("id").single());
  const invite = (from: string, to: string, g: string) => cl(from).rpc("invite_connection", { p_to: id(to), p_gathering: g });
  const invites = async (l: string) => rows(w.service.from("notifications").select("body, gathering_id").eq("person_id", id(l)).eq("kind", "invite"));

  before(async () => {
    for (const n of ["Ivy", "Jon", "Kit"]) await person(n);
    const [a, b] = [id("Ivy"), id("Jon")].sort();
    await ok(w.service.from("connections").insert({ person_a: a, person_b: b }));
    for (let i = 0; i < 7; i++)
      gs.push((await ok(w.service.from("gatherings").insert({ name: `${PREFIX} ${w.run} Inv${i}`, starts_at: inDays(2 + i), venue_id: w.venue, published_at: new Date().toISOString(), source: "manual" }).select("id").single())).id);
  });
  after(async () => {
    for (const p of Object.values(people)) await removeUser(w.service, p.authId).catch(() => undefined);
  });

  it("P180 only to a connection, only to a gathering you're pinned to, only once a pair — and it tells them, by your name", async () => {
    await denied(invite("Ivy", "Jon", gs[0]!), "42501"); // not pinned yet
    await pinTo("Ivy", gs[0]!);
    await denied(invite("Ivy", "Kit", gs[0]!), "42501"); // not a connection
    assert.deepEqual(await rows(cl("Ivy").rpc("invite_options", { p_to: id("Kit") })), [], "options offered for a stranger");
    await ok(invite("Ivy", "Jon", gs[0]!));
    const j = await invites("Jon");
    assert.equal(j.length, 1);
    assert.match(j[0].body, /^Ivy's going to .* — want to come\?$/);
    await denied(invite("Ivy", "Jon", gs[0]!)); // once
    await pinTo("Jon", gs[1]!);
    await pinTo("Ivy", gs[1]!);
    await denied(invite("Jon", "Ivy", gs[0]!), "42501"); // Jon isn't pinned to it
    // Jon is pinned to gs[1] but NOT open to meeting. Since 6 Oct 2026 (Alex; review R95)
    // "already going" counts only a pin open to meeting — anything else would tell Ivy
    // where Jon is going without Jon ever opting in to being seen — so the picker says
    // nothing for gs[1] and the invite goes.
    const opts = await rows(cl("Ivy").rpc("invite_options", { p_to: id("Jon") }));
    assert.deepEqual(opts.map((o: { already: string | null }) => o.already), ["invited", null]);
    await ok(invite("Ivy", "Jon", gs[1]!));
    // P181 counts today's invites from here; this one is P180's, not P181's.
    await ok(w.service.from("connection_invites").delete().eq("from_person", id("Ivy")).eq("gathering_id", gs[1]!));
    await ok(w.service.from("notifications").delete().eq("person_id", id("Jon")).eq("kind", "invite").eq("gathering_id", gs[1]!));
  });

  it("P181 five a day, the sixth refused; switched off, the invite is recorded and nobody is told; a block ends it", async () => {
    for (const g of gs.slice(2)) await pinTo("Ivy", g);
    await ok(cl("Jon").from("notification_settings").upsert({ person_id: id("Jon"), invite: false }).select("person_id"));
    for (const g of gs.slice(2, 6)) await ok(invite("Ivy", "Jon", g)); // 2nd–5th today
    assert.equal((await invites("Jon")).length, 1, "an invite reached someone who switched them off");
    await denied(invite("Ivy", "Jon", gs[6]!), "42501"); // the sixth
    await ok(w.service.from("connection_invites").delete().eq("from_person", id("Ivy")).eq("gathering_id", gs[5]!));
    await ok(w.service.from("blocks").insert({ blocker_id: id("Jon"), blocked_id: id("Ivy") }));
    await denied(invite("Ivy", "Jon", gs[6]!), "42501"); // room under the cap, but blocked
    assert.deepEqual(await rows(cl("Ivy").rpc("my_connections")), []);
  });
});

// P185 (Alex, 6 Oct 2026 — the app's home, M3.3c): "prove a Toronto picker can never return
// the staging Vancouver gathering". The public list (public_gatherings) was not
// city-scoped; it now takes the city, and both W1 and the app pass the live one from
// packages/shared/src/cities.ts. Proved from both sides, as a visitor and as a tester.
describe("The public list is one city's (M3.3c)", () => {
  it("P185 a Toronto list never returns a gathering in another city — to a visitor or a tester — and that city's own list does; a seed row is on neither", async () => {
    const env = loadEnv();
    const elsewhere = `${PREFIX}-${w.run}-elsewhere`.toLowerCase();
    const made: { gatherings: string[]; venues: string[] } = { gatherings: [], venues: [] };
    let tester: { authId: string } | null = null;
    await ok(w.service.from("cities").insert({ slug: elsewhere, name: "Elsewhere", timezone: "America/Vancouver", centre_lat: 49.28, centre_lng: -123.12, country: "Canada", country_code: "CA" }));
    try {
      const venue = async (name: string, city: string | null, seed: boolean) => {
        const v = await ok(w.service.from("venues").insert({ name: `${PREFIX} ${w.run} ${name}`, ...(city ? { city } : {}), is_seed: seed }).select("id").single());
        made.venues.push(v.id);
        return v.id as string;
      };
      const gathering = async (name: string, venueId: string) => {
        const g = await ok(w.service.from("gatherings").insert({ name: `${PREFIX} ${w.run} ${name}`, starts_at: inDays(3), venue_id: venueId, published_at: new Date().toISOString(), source: "manual" }).select("id").single());
        made.gatherings.push(g.id);
        return (await ok(w.service.rpc("admin_mint_slug", { p_gathering: g.id }))) as string;
      };
      const there = await gathering("Elsewhere gig", await venue("Elsewhere Hall", elsewhere, false));
      const thereSeed = await gathering("Elsewhere seed gig", await venue("Elsewhere Seed Hall", elsewhere, true));
      const here = await gathering("Toronto gig", await venue("Toronto Hall", null, false));

      const s = await newClient(env, env.publishableKey).auth.signInAnonymously({ options: { data: { harness: "pindhx" } } });
      assert.equal(s.error, null, s.error?.message);
      const testerClient = newClient(env, env.publishableKey);
      await testerClient.auth.setSession({ access_token: s.data.session!.access_token, refresh_token: s.data.session!.refresh_token });
      tester = { authId: s.data.user!.id };
      await markHarness(w.service, tester.authId);
      await ok(w.service.rpc("admin_add_anonymous_tester", { p_user: tester.authId, p_actor: ACTOR }));

      const list = async (client: typeof w.anon, city: string) =>
        (await rows(client.rpc("public_gatherings", { p_from: inDays(-1), p_to: inDays(10), p_city: city }))).map((r: { slug: string }) => r.slug);
      for (const [who, client] of [["a visitor", w.anon], ["a tester", testerClient]] as const) {
        const toronto = await list(client, "toronto");
        assert.ok(toronto.includes(here), `control: ${who}'s Toronto list is missing a Toronto gathering — the absences below prove nothing`);
        assert.ok(!toronto.includes(there), `${who}'s Toronto list returned a gathering in another city`);
        assert.ok(!toronto.includes(thereSeed), `${who}'s Toronto list returned a seed gathering in another city`);
        const other = await list(client, elsewhere);
        assert.ok(other.includes(there), `control: ${who}'s list for the other city is missing its own gathering`);
        assert.ok(!other.includes(here), `${who}'s list for the other city returned a Toronto gathering`);
        assert.ok(!other.includes(thereSeed), `${who} sees a seed gathering on the public list (V18)`);
      }
      // And there is no "every city": asked without one, the list refuses.
      const noCity = await w.anon.rpc("public_gatherings", { p_from: inDays(-1), p_to: inDays(10) });
      assert.ok(noCity.error, "the public list answered without a city — every city's gatherings");
    } finally {
      for (const id of made.gatherings) await w.service.from("gatherings").delete().eq("id", id);
      for (const id of made.venues) await w.service.from("venues").delete().eq("id", id);
      await w.service.from("cities").delete().eq("slug", elsewhere);
      if (tester) await removeUser(w.service, tester.authId);
    }
  });
});

// P186 (6 Oct 2026): a seed person is never sent anything. The test crowd's people have
// accounts that are not marked as harness people, so delivery would have emailed them
// (example.com, which bounces, on the domain real sign-in codes are sent from).
describe("Delivery never reaches a seed person (M3.3c)", () => {
  it("P186 a seed person's notification goes out with no phone and no address — and the same person, not seed, gets them back (control)", async () => {
    const email = `delivered+pind-p186-${w.run}@resend.dev`;
    const u = await w.service.auth.admin.createUser({ email, password: crypto.randomUUID(), email_confirm: true });
    assert.equal(u.error, null, u.error?.message);
    const authId = u.data.user!.id;
    try {
      const person = await ok(w.service.from("people").insert({ auth_user_id: authId, first_name: "SeedP186", is_seed: true }).select("id").single());
      await ok(w.service.from("device_tokens").insert({ token: `ExponentPushToken[p186-${w.run}]`, person_id: person.id, platform: "ios" }));
      const n = await ok(w.service.from("notifications").insert({ person_id: person.id, kind: "room_activity", title: "P186", body: "P186", path: "/" }).select("id").single());
      const queued = async () => (await rows(w.service.rpc("admin_pending_notifications", { p_limit: 1000 }))).find((r: { id: string }) => r.id === n.id);
      const asSeed = await queued();
      assert.ok(asSeed, "setup: the notification is not in the queue at all — the check below would prove nothing");
      assert.deepEqual(asSeed.tokens, [], "a seed person's phone was handed to delivery");
      assert.equal(asSeed.email, null, "a seed person's address was handed to delivery");
      await ok(w.service.from("people").update({ is_seed: false }).eq("id", person.id));
      const asReal = await queued();
      assert.equal(asReal?.email, email, "control: the same person, not seed, gets no address — the refusal above proves nothing");
      assert.equal(asReal?.tokens.length, 1, "control: the same person, not seed, gets no phone");
      await ok(w.service.from("notifications").delete().eq("id", n.id));
    } finally {
      await removeUser(w.service, authId);
    }
  });
});

// P188–P190 (Alex, 10 Oct 2026 — M3.2b): interests, remembered. Your own row only: read,
// set, change and clear it yourself; nobody else can do any of it. A refusal is proved by
// the row being as it was (read by the service key) — an RLS-filtered update or delete is
// silent, not an error.
describe("Interests are yours alone (M3.2b)", () => {
  const stored = async (name: string) =>
    ((await rows(w.service.from("person_interests").select("categories").eq("person_id", id(name))))[0]?.categories ?? null) as string[] | null;
  after(async () => {
    await w.service.from("person_interests").delete().in("person_id", [id("Ava"), id("Cal")]);
  });

  it("P188 you set and read your own interests; nobody else can read them, and a visitor has no access at all", async () => {
    await ok(c(M("Ava")).from("person_interests").insert({ person_id: id("Ava"), categories: ["comedy", "live_music"] }));
    assert.deepEqual((await rows(c(M("Ava")).from("person_interests").select("categories")))[0]?.categories, ["comedy", "live_music"]);
    assert.equal((await rows(c(M("Cal")).from("person_interests").select("categories").eq("person_id", id("Ava")))).length, 0, "someone read another person's interests");
    await noAccess(w.anon, "person_interests");
  });

  it("P189 nobody else can set, change or clear your interests — and a made-up category is refused", async () => {
    await denied(c(M("Cal")).from("person_interests").insert({ person_id: id("Ava"), categories: ["sport"] }));
    await c(M("Cal")).from("person_interests").update({ categories: ["sport"] }).eq("person_id", id("Ava"));
    assert.deepEqual(await stored("Ava"), ["comedy", "live_music"], "someone changed another person's interests");
    await c(M("Cal")).from("person_interests").delete().eq("person_id", id("Ava"));
    assert.deepEqual(await stored("Ava"), ["comedy", "live_music"], "someone cleared another person's interests");
    await denied(c(M("Cal")).from("person_interests").insert({ person_id: id("Cal"), categories: ["nightclubs"] }));
    assert.equal(await stored("Cal"), null, "a made-up category was stored");
  });

  it("P190 you change and clear your own", async () => {
    await ok(c(M("Ava")).from("person_interests").update({ categories: ["sport"] }).eq("person_id", id("Ava")));
    assert.deepEqual(await stored("Ava"), ["sport"], "a person could not change their own interests");
    await ok(c(M("Ava")).from("person_interests").delete().eq("person_id", id("Ava")));
    assert.equal(await stored("Ava"), null, "a person could not clear their own interests");
  });
});

// P191–P192 (Alex, 10 Oct 2026 — M3.2b): search is the public list with a query — one
// door. It narrows by name and venue; it can never return what the list would not.
describe("Search is the public list, narrowed (M3.2b)", () => {
  const made: { gatherings: string[]; venues: string[] } = { gatherings: [], venues: [] };
  const elsewhere = () => `${PREFIX}-${w.run}-srch`.toLowerCase();
  const tag = () => `zq${w.run}`.toLowerCase(); // a word no real gathering carries
  const S: Record<string, string> = {};
  let tester: { authId: string } | null = null;
  let testerClient: SupabaseClient;

  before(async () => {
    const env = loadEnv();
    await ok(w.service.from("cities").insert({ slug: elsewhere(), name: "Elsewhere", timezone: "America/Vancouver", centre_lat: 49.28, centre_lng: -123.12, country: "Canada", country_code: "CA" }));
    const venue = async (name: string, city: string | null, seed = false) => {
      const v = await ok(w.service.from("venues").insert({ name: `${PREFIX} ${w.run} ${name}`, ...(city ? { city } : {}), is_seed: seed }).select("id").single());
      made.venues.push(v.id);
      return v.id as string;
    };
    const gathering = async (key: string, name: string, venueId: string) => {
      const g = await ok(w.service.from("gatherings").insert({ name, starts_at: inDays(3), venue_id: venueId, published_at: new Date().toISOString(), source: "manual" }).select("id").single());
      made.gatherings.push(g.id);
      S[key] = (await ok(w.service.rpc("admin_mint_slug", { p_gathering: g.id }))) as string;
      return g.id as string;
    };
    const hall = await venue(`${tag()} Hall`, null);
    const plain = await venue("Plain Room", null);
    await gathering("byName", `${PREFIX} ${w.run} ${tag()} Quiz Night`, plain);
    await gathering("byVenue", `${PREFIX} ${w.run} Open Mic`, hall);
    await gathering("percent", `${PREFIX} ${w.run} ${tag()} 100% Vinyl`, plain);
    await gathering("under", `${PREFIX} ${w.run} ${tag()}_x Bingo`, plain);
    // Decoys only a wildcard would find: '100%' as a pattern matches "1000 …", '_x' "Ax".
    await gathering("percentDecoy", `${PREFIX} ${w.run} ${tag()} 1000 Club`, plain);
    await gathering("underDecoy", `${PREFIX} ${w.run} ${tag()}Ax Darts`, plain);
    await gathering("seed", `${PREFIX} ${w.run} ${tag()} Seed Show`, await venue("Seed Room", null, true));
    const wd = await gathering("withdrawn", `${PREFIX} ${w.run} ${tag()} Withdrawn Show`, plain);
    await ok(w.service.from("gatherings").update({ withdrawn_at: new Date().toISOString() }).eq("id", wd));
    await gathering("elsewhere", `${PREFIX} ${w.run} ${tag()} Elsewhere Show`, await venue("Far Hall", elsewhere()));
    // A draft: never published, so it has no slug and no place on the list.
    const draft = await ok(w.service.from("gatherings").insert({ name: `${PREFIX} ${w.run} ${tag()} Draft Show`, starts_at: inDays(3), venue_id: plain, source: "manual" }).select("id").single());
    made.gatherings.push(draft.id);

    const s = await newClient(env, env.publishableKey).auth.signInAnonymously({ options: { data: { harness: "pindhx" } } });
    assert.equal(s.error, null, s.error?.message);
    testerClient = newClient(env, env.publishableKey);
    await testerClient.auth.setSession({ access_token: s.data.session!.access_token, refresh_token: s.data.session!.refresh_token });
    tester = { authId: s.data.user!.id };
    await markHarness(w.service, tester.authId);
    await ok(w.service.rpc("admin_add_anonymous_tester", { p_user: tester.authId, p_actor: ACTOR }));
  }, { timeout: 120_000 });

  after(async () => {
    for (const g of made.gatherings) await w.service.from("gatherings").delete().eq("id", g);
    for (const v of made.venues) await w.service.from("venues").delete().eq("id", v);
    await w.service.from("cities").delete().eq("slug", elsewhere());
    if (tester) await removeUser(w.service, tester.authId);
  });

  const search = async (client: SupabaseClient, q: string | null, city = "toronto") =>
    (await rows(client.rpc("public_gatherings", { p_from: inDays(-1), p_to: inDays(22), p_city: city, p_query: q }))).map((r: { slug: string }) => r.slug);

  it("P191 a search narrows by gathering name or venue name, case-insensitive; % and _ are only themselves", async () => {
    const found = await search(w.anon, tag().toUpperCase());
    for (const k of ["byName", "byVenue", "percent", "under"]) assert.ok(found.includes(S[k]!), `search missed the ${k} gathering`);
    assert.deepEqual(await search(w.anon, `${tag()} 100%`), [S.percent], "'%' acted as a wildcard, or '100%' was not found");
    assert.deepEqual(await search(w.anon, `${tag()}_x`), [S.under], "'_' acted as a wildcard, or it was not found");
    assert.ok((await search(w.anon, `${tag()} quiz`)).includes(S.byName!));
    assert.equal((await search(w.anon, `${tag()} nothing-like-this`)).length, 0);
    const blank = await search(w.anon, "   ");
    assert.ok(blank.includes(S.byName!) && blank.includes(S.byVenue!), "a blank query narrowed the list instead of being no query");
  });

  it("P192 a search never returns what the list would not — seed, withdrawn, draft, another city — to a visitor or a tester", async () => {
    for (const [who, client] of [["a visitor", w.anon], ["a tester", testerClient]] as const) {
      const found = await search(client, tag());
      assert.ok(found.includes(S.byName!), `control: ${who}'s search is missing a gathering it should find — the absences below prove nothing`);
      assert.ok(!found.includes(S.seed!), `${who}'s search returned a seed gathering (V18)`);
      assert.ok(!found.includes(S.withdrawn!), `${who}'s search returned a withdrawn gathering`);
      assert.ok(!found.includes(S.elsewhere!), `${who}'s Toronto search returned another city's gathering`);
      assert.equal((await search(client, `${tag()} Draft`)).length, 0, `${who}'s search returned a draft`);
      assert.ok((await search(client, tag(), elsewhere())).includes(S.elsewhere!), `control: ${who}'s search of the other city is missing its own gathering`);
    }
    const noCity = await w.anon.rpc("public_gatherings", { p_from: inDays(-1), p_to: inDays(22), p_query: tag() });
    assert.ok(noCity.error, "search answered without a city — every city's gatherings");
  });
});

// P193 (Alex, 10 Oct 2026 — M3.2b, A19): My Events reads exactly what the app reads
// (MY_EVENTS_PINS_SELECT), as the person, under RLS. The acceptance line: the pinned
// gathering shows; removing the pin removes it. A withdrawn one stays while pinned (V13).
describe("My Events lists your pins (M3.2b, A19)", () => {
  it("P193 your pinned gathering shows with its venue and time zone, stays when withdrawn, and goes when you remove the pin", async () => {
    const g = await ok(w.service.from("gatherings").insert({ name: `${PREFIX} ${w.run} My Events`, starts_at: inDays(5), venue_id: w.venue, published_at: new Date().toISOString(), source: "manual" }).select("id").single());
    try {
      const slug = (await ok(w.service.rpc("admin_mint_slug", { p_gathering: g.id }))) as string;
      const mine = async () =>
        ((await rows(c(M("Ava")).from("pins").select(MY_EVENTS_PINS_SELECT).eq("person_id", id("Ava")))) as {
          gathering_id: string;
          gatherings: { slug: string | null; withdrawn_at: string | null; venues: { name: string; cities: { timezone: string } | null } | null } | null;
        }[]).find((p) => p.gathering_id === g.id);
      assert.equal(await mine(), undefined, "setup: Ava is already pinned here");
      await ok(c(M("Ava")).from("pins").insert({ gathering_id: g.id, person_id: id("Ava"), party_total: 1 }));
      const row = await mine();
      assert.equal(row?.gatherings?.slug, slug, "the pinned gathering is not on My Events");
      assert.ok(row?.gatherings?.venues?.name, "My Events cannot read the venue's name");
      assert.ok(row?.gatherings?.venues?.cities?.timezone, "My Events cannot read the venue's time zone");
      await ok(w.service.from("gatherings").update({ withdrawn_at: new Date().toISOString() }).eq("id", g.id));
      assert.ok((await mine())?.gatherings?.withdrawn_at, "a withdrawn gathering vanished from My Events while still pinned (V13)");
      await ok(c(M("Ava")).from("pins").delete().eq("gathering_id", g.id).eq("person_id", id("Ava")));
      assert.equal(await mine(), undefined, "a removed pin is still on My Events");
    } finally {
      await w.service.from("pins").delete().eq("gathering_id", g.id);
      await w.service.from("gatherings").delete().eq("id", g.id);
    }
  });
});

// P194–P195 (Alex, 10 Oct 2026 — M4.2, Q41; H8): the 19+ gate holds in the database.
// Both sides of the boundary: (this year − 19) is accepted — the app's full-date check
// decides that year — and (this year − 18) is refused, with no attestation recorded.
describe("19+ is enforced by the database, not only the app (H8; Q41)", () => {
  const made: string[] = [];
  const thisYear = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric" }).format(new Date()));
  async function newcomer(label: string) {
    const email = `${PREFIX}-${w.run}-h8-${label}@example.com`;
    const password = randomUUID();
    const u = await w.service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { pind_harness: true } });
    assert.equal(u.error, null, u.error?.message);
    made.push(u.data.user!.id);
    const person = await ok(w.service.from("people").insert({ auth_user_id: u.data.user!.id, first_name: label }).select("id").single());
    const client = newClient(w.env, w.env.publishableKey);
    const s = await client.auth.signInWithPassword({ email, password });
    assert.equal(s.error, null, s.error?.message);
    return { personId: person.id as string, client };
  }
  const attested = async (personId: string) => rows(w.service.from("age_attestations").select("attested_at, source").eq("person_id", personId));
  after(async () => {
    for (const a of made) await removeUser(w.service, a).catch(() => undefined);
  });

  it("P194 a birth year certainly under 19 is refused, and records no 19+ attestation — the year before it is accepted", async () => {
    const kid = await newcomer("kid");
    for (const year of [thisYear - 12, thisYear - 18]) {
      await denied(kid.client.from("people_private").insert({ person_id: kid.personId, gender: "woman", birth_year: year }), "23514");
      assert.equal((await rows(w.service.from("people_private").select("person_id").eq("person_id", kid.personId))).length, 0, `birth year ${year} was stored`);
      assert.deepEqual(await attested(kid.personId), [], `birth year ${year} became a 19+ attestation`);
    }
    // The other side of the boundary: born (this year − 19) may be 19 today — accepted.
    const edge = await newcomer("edge");
    await ok(edge.client.from("people_private").insert({ person_id: edge.personId, gender: "woman", birth_year: thisYear - 19 }));
    assert.equal((await attested(edge.personId)).length, 1, "a 19+ year recorded no attestation");
  });

  it("P195 the attestation time is the server's: a backdated one sent by the client is replaced by now", async () => {
    const p = await newcomer("backdate");
    const before = Date.now();
    await ok(p.client.from("people_private").insert({ person_id: p.personId, gender: "man", birth_year: 1990, age_attested_at: "2001-01-01T00:00:00Z" }));
    const row = (await rows(w.service.from("people_private").select("age_attested_at").eq("person_id", p.personId)))[0] as { age_attested_at: string };
    assert.ok(Date.parse(row.age_attested_at) >= before - 60_000, `the client's backdated attestation was kept: ${row.age_attested_at}`);
    const a = (await attested(p.personId))[0] as { attested_at: string } | undefined;
    assert.ok(a && Date.parse(a.attested_at) >= before - 60_000, "the attestation record carries the client's time");
  });
});

// P196–P198 (Alex, 10 Oct 2026 — M4.2, Q37 + Q07): people and pins are read column by
// column. A viewer gets the person and never why their photo is gone, nor when they
// joined or pinned; nobody can search people by photo status; the owner is told exactly
// what §8 says — rejected or not — and the export still carries their own times.
describe("Photo status and join time are nobody else's (M4.2: Q37, Q07)", () => {
  it("P196 a viewer sees the person but cannot read, filter or order by photo status, join time or pin time", async () => {
    assert.equal(await seesPeople(c(M("Ava")), "Eve"), 1, "control: Ava cannot see Eve, so the refusals below prove nothing");
    for (const col of ["photo_status", "created_at", "updated_at"])
      await denied(c(M("Ava")).from("people").select(col).eq("id", id("Eve")), "42501");
    await denied(c(M("Ava")).from("people").select("*").eq("id", id("Eve")), "42501");
    await denied(c(M("Ava")).from("people").select("id").eq("photo_status", "needs_review"), "42501");
    await denied(c(M("Ava")).from("people").select("id").order("created_at"), "42501");
    for (const col of ["created_at", "updated_at"]) await denied(c(M("Ava")).from("pins").select(col).eq("gathering_id", w.G), "42501");
    await denied(c(M("Ava")).from("pins").select("person_id").eq("gathering_id", w.G).order("created_at"), "42501");
    assert.ok((await rows(c(M("Ava")).from("pins").select("person_id, party_total").eq("gathering_id", w.G))).length > 0, "control: the list itself stopped working");
  });

  it("P197 the owner is told rejected or not — never 'needs review' — and cannot read the status column either", async () => {
    assert.equal(await ok(c(M("Rex")).rpc("my_photo_rejected")), true, "a rejected owner was not told");
    const was = (await rows(w.service.from("people").select("photo_status").eq("id", id("Ava"))))[0].photo_status as string;
    try {
      await ok(w.service.from("people").update({ photo_status: "needs_review" }).eq("id", id("Ava")));
      assert.equal(await ok(c(M("Ava")).rpc("my_photo_rejected")), false, "'needs review' reached its owner as a rejection");
      await denied(c(M("Ava")).from("people").select("photo_status").eq("id", id("Ava")), "42501");
    } finally {
      await w.service.from("people").update({ photo_status: was }).eq("id", id("Ava"));
    }
  });

  it("P198 the owner's own join and pin times reach the export, and only the owner's", async () => {
    const t = (await ok(c(M("Ava")).rpc("my_record_times"))) as { joined_at: string; pins: { gathering_id: string; pinned_at: string }[] };
    assert.ok(t.joined_at, "the export lost when the owner joined");
    const mine = (await rows(w.service.from("pins").select("gathering_id").eq("person_id", id("Ava")))).map((p: { gathering_id: string }) => p.gathering_id).sort();
    assert.deepEqual(t.pins.map((p) => p.gathering_id).sort(), mine, "my_record_times returned pins that are not the owner's, or missed some");
  });
});

// P199 (Alex, 10 Oct 2026 — M4.2, Q17; V6): a new photo is always a new file. Nobody can
// put new bytes behind an approved photo's name — not by overwriting it, not by deleting
// and re-uploading it — and a genuinely new photo still works and goes back to be checked.
describe("A new photo is always a new file (M4.2: Q17)", () => {
  let authId = "";
  after(async () => {
    if (!authId) return;
    const files = ((await w.service.storage.from(BUCKET).list(authId)).data ?? []).map((f) => `${authId}/${f.name}`);
    if (files.length) await w.service.storage.from(BUCKET).remove(files);
    await removeUser(w.service, authId).catch(() => undefined);
  });

  it("P199 an approved photo's bytes cannot be replaced in place or by delete-and-reupload; a new path is allowed and re-checked", async () => {
    const email = `${PREFIX}-${w.run}-q17@example.com`;
    const password = randomUUID();
    const u = await w.service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { pind_harness: true } });
    assert.equal(u.error, null, u.error?.message);
    authId = u.data.user!.id;
    const person = await ok(w.service.from("people").insert({ auth_user_id: authId, first_name: "Quill" }).select("id").single());
    const me = newClient(w.env, w.env.publishableKey);
    assert.equal((await me.auth.signInWithPassword({ email, password })).error, null);

    const first = `${authId}/1.png`;
    await ok(me.storage.from(BUCKET).upload(first, PNG, { contentType: "image/png", upsert: false }));
    await ok(me.from("people").update({ photo_path: first }).eq("id", person.id));
    await ok(w.service.from("people").update({ photo_status: "approved" }).eq("id", person.id));
    const status = async () => (await rows(w.service.from("people").select("photo_status, photo_path").eq("id", person.id)))[0] as { photo_status: string; photo_path: string };
    const other = Buffer.concat([PNG, Buffer.from("different bytes")]);

    // 1. Overwrite in place.
    await denied(me.storage.from(BUCKET).upload(first, other, { contentType: "image/png", upsert: true }));
    // 2. Delete, then upload new bytes under the same name.
    await me.storage.from(BUCKET).remove([first]);
    await denied(me.storage.from(BUCKET).upload(first, other, { contentType: "image/png", upsert: false }));
    assert.deepEqual(await status(), { photo_status: "approved", photo_path: first }, "new bytes went behind an approved name");

    // Control — the other side: a genuinely new photo is a new path, and it is checked again.
    const second = `${authId}/2.png`;
    await ok(me.storage.from(BUCKET).upload(second, other, { contentType: "image/png", upsert: false }));
    await ok(me.from("people").update({ photo_path: second }).eq("id", person.id));
    assert.equal((await status()).photo_status, "pending", "a new photo was not sent back to be checked");
  });
});

// P200 (Alex, 10 Oct 2026 — M4.2, Q40; Q2, §3): a photo path a person sets is a real
// file, and the file behind their current photo cannot be deleted out from under it — so
// the opt-in gate's "has a photo" always means a photo.
describe("A photo is a file (M4.2: Q40)", () => {
  let authId = "";
  after(async () => {
    if (!authId) return;
    const files = ((await w.service.storage.from(BUCKET).list(authId)).data ?? []).map((f) => `${authId}/${f.name}`);
    if (files.length) await w.service.storage.from(BUCKET).remove(files);
    await removeUser(w.service, authId).catch(() => undefined);
  });

  it("P200 a path to nothing is refused, the current photo's file cannot be deleted, and a real photo — then a replaced one — works", async () => {
    const email = `${PREFIX}-${w.run}-q40@example.com`;
    const password = randomUUID();
    const u = await w.service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { pind_harness: true } });
    assert.equal(u.error, null, u.error?.message);
    authId = u.data.user!.id;
    const person = await ok(w.service.from("people").insert({ auth_user_id: authId, first_name: "Zia" }).select("id").single());
    await ok(w.service.from("people_private").insert({ person_id: person.id, gender: "woman", birth_year: 1992 }));
    const me = newClient(w.env, w.env.publishableKey);
    assert.equal((await me.auth.signInWithPassword({ email, password })).error, null);
    const path = async () => (await rows(w.service.from("people").select("photo_path").eq("id", person.id)))[0]?.photo_path as string | null;

    // The attack: point photo_path at a file that does not exist, then opt in.
    await denied(me.from("people").update({ photo_path: `${authId}/not-there.png` }).eq("id", person.id), "23514");
    assert.equal(await path(), null, "a path to nothing was stored");
    assert.equal(await ok(me.rpc("i_may_meet")), false, "someone with no photo may meet");

    // Control: a real photo is accepted, and then the gate opens.
    const one = `${authId}/1.png`;
    await ok(me.storage.from(BUCKET).upload(one, PNG, { contentType: "image/png", upsert: false }));
    await ok(me.from("people").update({ photo_path: one }).eq("id", person.id));
    assert.equal(await ok(me.rpc("i_may_meet")), true, "control: a real photo did not open the gate");

    // The current photo's file cannot be deleted out from under it.
    await me.storage.from(BUCKET).remove([one]);
    const still = (await w.service.storage.from(BUCKET).list(authId)).data?.map((f) => f.name) ?? [];
    assert.ok(still.includes("1.png"), "the file behind someone's current photo was deleted");

    // The app's order still works: upload the new one, point at it, then remove the old.
    const two = `${authId}/2.png`;
    await ok(me.storage.from(BUCKET).upload(two, PNG, { contentType: "image/png", upsert: false }));
    await ok(me.from("people").update({ photo_path: two }).eq("id", person.id));
    await ok(me.storage.from(BUCKET).remove([one]));
    const after = (await w.service.storage.from(BUCKET).list(authId)).data?.map((f) => f.name) ?? [];
    assert.ok(!after.includes("1.png") && after.includes("2.png"), "the app's replace-then-remove no longer works");
  });
});

// P201 (Alex, 10 Oct 2026 — M4.2, Q39; V10 §11, V23): a person hidden by moderation sees
// no one — not a connection, not a groupmate — and so cannot report one and hide them.
// The group path is the review's Q39; this proves the same rule on the connection path.
describe("A hidden person sees no one, and cannot hide anyone with a report (M4.2: Q39)", () => {
  const made: string[] = [];
  after(async () => {
    for (const a of made) await removeUser(w.service, a).catch(() => undefined);
  });
  async function someone(label: string) {
    const email = `${PREFIX}-${w.run}-q39-${label}@example.com`;
    const password = randomUUID();
    const u = await w.service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { pind_harness: true } });
    assert.equal(u.error, null, u.error?.message);
    made.push(u.data.user!.id);
    const person = await ok(w.service.from("people").insert({ auth_user_id: u.data.user!.id, first_name: label }).select("id").single());
    const client = newClient(w.env, w.env.publishableKey);
    assert.equal((await client.auth.signInWithPassword({ email, password })).error, null);
    return { id: person.id as string, client };
  }

  it("P201 connected, the hidden one sees the other until the hide, then no one — and their 'uncomfortable' report is refused, hiding nobody", async () => {
    const kay = await someone("kay");
    const lou = await someone("lou");
    const [a, b] = [kay.id, lou.id].sort();
    await ok(w.service.from("connections").insert({ person_a: a, person_b: b }));
    const louSeesKay = async () => (await rows(lou.client.from("people").select("id").eq("id", kay.id))).length;
    assert.equal(await louSeesKay(), 1, "control: connected, Lou cannot see Kay — the refusals below prove nothing");

    await ok(w.service.from("people").update({ hidden_at: new Date().toISOString() }).eq("id", lou.id));
    assert.equal(await louSeesKay(), 0, "a hidden person still sees a connection (V10)");
    await denied(lou.client.from("reports").insert({ reporter_id: lou.id, target_kind: "person", target_person_id: kay.id, reason: "uncomfortable" }));
    const kayHidden = (await rows(w.service.from("people").select("hidden_at").eq("id", kay.id)))[0]?.hidden_at;
    assert.equal(kayHidden, null, "a hidden person's report hid someone else");
  });
});

// P202 (Alex, 10 Oct 2026 — M4.2, Q42; V11, V18): convening_of says nothing about a
// gathering its caller cannot read — not that a draft exists, not where it came from.
describe("convening_of answers only about readable gatherings (M4.2: Q42)", () => {
  it("P202 a draft, an unpublished and a dismissed gathering answer null to a visitor and a person; a published one still answers", async () => {
    for (const [who, client] of [["a visitor", w.anon], ["Ava", c(M("Ava"))]] as const) {
      assert.ok(await ok(client.rpc("convening_of", { p_gathering: w.G })), `control: ${who} gets nothing for the published gathering — the nulls below prove nothing`);
      for (const [what, gid] of [["a Ticketmaster draft", w.D.ticketmaster], ["an unpublished gathering", w.U], ["a dismissed draft", w.X]] as const)
        assert.equal(await ok(client.rpc("convening_of", { p_gathering: gid })), null, `${who} learned that ${what} exists`);
    }
  });
});

// P203 (Alex, 10 Oct 2026 — M4.2, Q43; V13): after a withdrawal a pin is read and
// removed, never edited — except that turning "open to meeting" off is never refused.
describe("A pin on a withdrawn gathering is frozen, not trapped (M4.2: Q43)", () => {
  it("P203 party size and opting in are refused after a withdrawal; opting out and removing the pin still work", async () => {
    const g = await ok(w.service.from("gatherings").insert({ name: `${PREFIX} ${w.run} Q43`, starts_at: inDays(6), venue_id: w.venue, published_at: new Date().toISOString(), source: "manual" }).select("id").single());
    try {
      const ava = c(M("Ava"));
      const pin = await ok(ava.from("pins").insert({ gathering_id: g.id, person_id: id("Ava"), party_total: 1, open_to_meeting: true }).select("id").single());
      const now = async () => (await rows(w.service.from("pins").select("party_total, open_to_meeting").eq("id", pin.id)))[0] as { party_total: number; open_to_meeting: boolean } | undefined;
      // Control: before the withdrawal, the pin is editable.
      await ok(ava.from("pins").update({ party_total: 2 }).eq("id", pin.id));
      assert.equal((await now())?.party_total, 2, "control: a live pin could not be edited — the refusals below prove nothing");

      await ok(w.service.from("gatherings").update({ withdrawn_at: new Date().toISOString() }).eq("id", g.id));
      await denied(ava.from("pins").update({ party_total: 5 }).eq("id", pin.id), "23514");
      assert.equal((await now())?.party_total, 2, "a withdrawn gathering's pinned count moved");
      await ok(ava.from("pins").update({ open_to_meeting: false }).eq("id", pin.id));
      assert.equal((await now())?.open_to_meeting, false, "taking yourself off a list was refused — it never may be");
      await denied(ava.from("pins").update({ open_to_meeting: true }).eq("id", pin.id), "23514");
      await ok(ava.from("pins").delete().eq("id", pin.id));
      assert.equal(await now(), undefined, "a pin on a withdrawn gathering could not be removed");
    } finally {
      await w.service.from("pins").delete().eq("gathering_id", g.id);
      await w.service.from("gatherings").delete().eq("id", g.id);
    }
  });
});
