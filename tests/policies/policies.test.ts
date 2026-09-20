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

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "./env.ts";
import { ACTOR, BUCKET, MAPS, PNG, buildWorld, handleFor, newClient, sweep, type Member, type World } from "./world.ts";

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

before(async () => {
  w = await buildWorld(loadEnv());
}, { timeout: 300_000 });

after(async () => {
  if (w) await sweep(w.service);
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
    await denied(w.anon.from("people").insert({ first_name: "Anon", instagram_handle: handleFor(w.run, "anon") }), "42501");
    await denied(w.anon.rpc("women_only_offer", { p_gathering: w.G }));
    await denied(w.anon.rpc("spot_poll", { p_gathering: w.G }));
  });

  it("P04 a signed-in user CANNOT read or write any locked app table", async () => {
    const ava = c(M("Ava"));
    for (const t of [
      "crews", "crew_members", "crew_proposals", "crew_proposal_votes", "crew_join_requests",
      "crew_messages", "confirmations", "connections", "tags", "person_tags", "magic_links", "outbound_messages",
    ]) {
      await noAccess(ava, t);
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
    const path = `${authId}/newt.png`;

    await ok(client.storage.from(BUCKET).upload(path, PNG, { contentType: "image/png" }), "upload own photo");
    const person = await ok(
      client
        .from("people")
        .insert({ auth_user_id: authId, first_name: "Newt", instagram_handle: handleFor(w.run, "newt"), photo_path: path })
        .select("id, photo_status")
        .single(),
      "insert own person",
    );
    assert.equal(person.photo_status, "pending");
    newt = { client, authId, personId: person.id };
    await ok(client.from("people_private").insert({ person_id: person.id, gender: "man", birth_year: 1996 }), "private row");
    await ok(client.from("pins").insert({ gathering_id: w.G, person_id: person.id, open_to_meeting: false }), "own pin");
    await ok(client.from("contact_points").insert({ person_id: person.id, kind: "email", value: "newt@example.com" }), "contact");

    // Not for anyone else.
    await denied(
      client.from("people").insert({ auth_user_id: M("Ava").authId, first_name: "Fake", instagram_handle: handleFor(w.run, "fake") }),
      "42501",
    );
    await denied(client.from("people").insert({ auth_user_id: authId, first_name: "Twice", instagram_handle: handleFor(w.run, "twice") }));
    await denied(client.from("pins").insert({ gathering_id: w.H, person_id: id("Ava") }), "42501");
    await denied(client.from("people_private").insert({ person_id: id("Hope"), gender: "woman" }), "42501");
    await denied(client.from("contact_points").insert({ person_id: id("Ava"), kind: "sms", value: "+15555550100" }), "42501");

    // Never moderation fields.
    await denied(client.from("people").update({ photo_status: "approved" }).eq("id", person.id), "42501");
    await denied(client.from("people").update({ hidden_at: new Date().toISOString() }).eq("id", person.id), "42501");
    await denied(
      client.from("people").insert({ first_name: "Hid", instagram_handle: handleFor(w.run, "hid"), hidden_at: new Date().toISOString() }),
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
  it("P11 Ava CAN see Ben's name, neighbourhood, handle and pin at G / Cal (not opted in) CANNOT see Ava or Ben", async () => {
    const ava = c(M("Ava"));
    const ben = await rows(ava.from("people").select("first_name, neighbourhood, instagram_handle").eq("id", id("Ben")));
    assert.equal(ben.length, 1);
    assert.equal(ben[0].first_name, "Ben");
    assert.equal(ben[0].neighbourhood, "king-west");
    assert.equal(ben[0].instagram_handle, handleFor(w.run, "Ben"));
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
  it("P23 Ava CAN get Dee's approved photo / CANNOT get Eve's pending photo / Eve CAN get her own pending photo", async () => {
    await canSign(c(M("Ava")), M("Dee").photoPath);
    assert.equal(await seesPeople(c(M("Ava")), "Eve"), 1, "Eve herself is visible");
    await cannotSign(c(M("Ava")), M("Eve").photoPath);
    await canSign(c(M("Eve")), M("Eve").photoPath);
  });

  it("P24 Ava CANNOT get Rex's rejected photo / CAN still see Rex with his handle", async () => {
    await cannotSign(c(M("Ava")), M("Rex").photoPath);
    const rex = await rows(c(M("Ava")).from("people").select("instagram_handle").eq("id", id("Rex")));
    assert.equal(rex.length, 1);
    assert.equal(rex[0].instagram_handle, handleFor(w.run, "Rex"));
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
  it("P32 Ava CAN submit and read her own response / CANNOT read Ben's / CANNOT submit as someone else", async () => {
    const ava = c(M("Ava"));
    await ok(
      ava.from("survey_responses").insert({ gathering_id: w.G, person_id: id("Ava"), met: "1_2", would_have_gone: "no" }),
      "Ava's survey",
    );
    const visible = await rows(ava.from("survey_responses").select("person_id"));
    assert.deepEqual(visible.map((r) => r.person_id), [id("Ava")]);
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
  // publishing lead times reaches pinning. The only conditions on inserting a pin are
  // "it is me" and "the gathering is published, not withdrawn, not seeded".
  //
  // The first half is the rule and is meant to hold: pinning an hour before doors
  // works, and nothing about publish_lead_days_min reaches it.
  //
  // THE SECOND HALF RECORDS A BUG, NOT AN INTENTION. There is no upper bound either,
  // so a pin can be taken after the gathering has ended. That is a gap left over from
  // M1.1, not a decision, and M3.2 closes it when A26 exists: pins close at the
  // effective end. WHEN M3.2 LANDS THIS ASSERTION IS SUPPOSED TO FAIL — invert it to
  // `assert.ok(ended.error)` and rename the case. It is here so the gap is visible and
  // dated rather than discovered again, not because anyone wants it (Alex, M2.2).
  it("P37b pinning has no lower time gate (intended) / and no upper one either — CURRENT BEHAVIOUR, A BUG M3.2 CLOSES", async () => {
    const ava = c(M("Ava"));
    const ended = await ava
      .from("pins")
      .insert({ gathering_id: w.P, person_id: id("Ava"), party_total: 1, open_to_meeting: false })
      .select("id")
      .single();
    // Pending M3.2: this is the bug, recorded. Invert it there, do not "fix" the test.
    assert.equal(
      ended.error,
      null,
      "pinning after the end was refused — if M3.2 closed the bound, invert this assertion rather than treating it as a regression",
    );
    await ok(w.service.from("pins").delete().eq("id", ended.data!.id));

    // The same for a gathering about to start: published is the only gate.
    const soon = await ok(
      w.service
        .from("gatherings")
        .insert({ name: `pindhx ${w.run} Doors Soon`, starts_at: new Date(Date.now() + 3_600_000).toISOString(), venue_id: w.venue })
        .select("id")
        .single(),
    );
    await ok(w.service.from("gatherings").update({ published_at: new Date().toISOString() }).eq("id", soon.id));
    const late = await ava
      .from("pins")
      .insert({ gathering_id: soon.id, person_id: id("Ava"), party_total: 1, open_to_meeting: false })
      .select("id")
      .single();
    assert.equal(late.error, null, `pinning an hour before doors was refused: ${late.error?.message}`);
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

  it("P46 approving Eve's photo lets Ava get it; a stale photo path is REFUSED / rejecting hides it again", async () => {
    const eve = M("Eve");
    await cannotSign(c(M("Ava")), eve.photoPath);
    const stale = await admin("admin_set_photo_status", {
      p_person: eve.personId,
      p_photo_path: `${eve.authId}/old.png`,
      p_status: "approved",
    });
    assert.ok(stale.error, "approved a photo the admin never saw");
    await cannotSign(c(M("Ava")), eve.photoPath);
    await ok(admin("admin_set_photo_status", { p_person: eve.personId, p_photo_path: eve.photoPath, p_status: "approved" }));
    await canSign(c(M("Ava")), eve.photoPath);
    await ok(admin("admin_set_photo_status", { p_person: eve.personId, p_photo_path: eve.photoPath, p_status: "rejected" }));
    await cannotSign(c(M("Ava")), eve.photoPath);
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
  const data = await rows(client.rpc("public_gatherings", { p_from: inDays(-90), p_to: inDays(90) }));
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
    seedPerson = (
      await ok(
        w.service
          .from("people")
          .insert({
            auth_user_id: signIn.data.user!.id,
            first_name: "Seeda",
            instagram_handle: handleFor(w.run, "seeda"),
            neighbourhood: "king-west",
            is_seed: true,
          })
          .select("id")
          .single(),
      )
    ).id;
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
    assert.equal((await serviceRow("cities", "slug", "toronto", "publish_target_weekly")).publish_target_weekly, 5);
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
      w.service.from("ops_import_schedule").select("cron, utc_hour, utc_minute, grace_minutes").eq("id", true).single(),
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
      await ok(
        w.service
          .from("ops_import_schedule")
          .update({ cron: before.cron, utc_hour: before.utc_hour, utc_minute: before.utc_minute, grace_minutes: before.grace_minutes })
          .eq("id", true),
      );
    }

    const after = await ok(
      w.service.from("ops_import_schedule").select("cron, utc_hour, utc_minute, grace_minutes").eq("id", true).single(),
    );
    assert.deepEqual(after, before, "the harness left the import schedule changed");
  });
});
