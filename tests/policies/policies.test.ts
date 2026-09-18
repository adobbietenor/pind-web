// Policy harness — Phase 1 M1.1. Run with `npm run test:policies`.
//
// Every case is an approved "X CAN / X CANNOT" pair from docs/visibility.md, numbered
// P01–P37, with the rule it proves (V1–V11). Each person queries with their own
// session through the same REST and Storage APIs the Worker uses, so what passes
// here is what RLS lets through. The service key only builds and sweeps the world.
//
// Cases run in order: later cases change the world (blocks, removed pins, reports).

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "./env.ts";
import { BUCKET, PNG, buildWorld, handleFor, newClient, sweep, type Member, type World } from "./world.ts";

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
});
