// A26 is the one screen built twice (Alex, M3.2): the Worker's for the web, Expo's
// for someone who has the app. This is the guard that decides whether that ages well,
// and it was written BEFORE either screen (Alex: "the first thing you write, not the
// last").
//
// The rule it holds: A26's fields, copy and validation live in
// `packages/shared/src/quickpin.ts`, and **neither screen writes its own**. It reads
// both screens' source (no UI tests, CLAUDE.md), and — per S20's lesson — it proves
// its own patterns match something real before it trusts an empty result: a pattern
// that matches nothing passes by finding nothing.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  PARTY_CHOICES,
  QUICKPIN_COPY,
  QUICKPIN_FIELDS,
  readQuickPin,
  supabaseStorageKey,
} from "../../packages/shared/src/quickpin.ts";

const WORKER_A26 = "src/public/quickpin.ts";
const EXPO_A26 = "app/src/app/g/[slug]/pin.tsx";
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// Every sentence and label the screens show, flattened.
function copyStrings(): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (typeof v === "function") return;
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(QUICKPIN_COPY);
  walk(PARTY_CHOICES.map((c) => c.label));
  return out.filter((s) => s.length >= 4);
}

// A literal copy of a shared sentence in a screen's code — the thing that drifts.
function ownCopy(source: string): string[] {
  const body = code(source);
  return copyStrings().filter((s) => body.includes(`"${s}"`) || body.includes(`'${s}'`) || body.includes(`>${s}<`) || body.includes(`\`${s}\``));
}

// A field named by its literal instead of QUICKPIN_FIELDS.
function ownFieldNames(source: string): string[] {
  const body = code(source);
  return Object.values(QUICKPIN_FIELDS).filter((f) => new RegExp(`["'\`]${f}["'\`]|name="${f}"`).test(body));
}

describe("A26's shared rule: the fields, the copy, the validation (M3.2)", () => {
  it("Q01 validation, both sides of every edge", () => {
    const good = { first_name: "  Sam ", party: "2", meet_up: "on", nineteen: "on" };
    assert.deepEqual(readQuickPin(good), { ok: true, value: { firstName: "Sam", partyTotal: 2, openToMeeting: true } });
    assert.deepEqual(readQuickPin({ ...good, meet_up: undefined }), { ok: true, value: { firstName: "Sam", partyTotal: 2, openToMeeting: false } });

    // The 19+ tick is required, and it says which field.
    const noTick = readQuickPin({ ...good, nineteen: undefined });
    assert.equal(noTick.ok, false);
    assert.equal(!noTick.ok && noTick.field, QUICKPIN_FIELDS.nineteen);

    // First name: 1 to 40 characters once trimmed (the database's own check).
    assert.equal(readQuickPin({ ...good, first_name: "   " }).ok, false);
    assert.equal(readQuickPin({ ...good, first_name: "x".repeat(40) }).ok, true);
    assert.equal(readQuickPin({ ...good, first_name: "x".repeat(41) }).ok, false);

    // Who's coming: alone, +1, +2, or a group of a number up to the database's 10.
    assert.equal(readQuickPin({ ...good, party: "1" }).ok && readQuickPin({ ...good, party: "1" }).value.partyTotal, 1);
    assert.equal(readQuickPin({ ...good, party: "group", group_size: "7" }).ok && readQuickPin({ ...good, party: "group", group_size: "7" }).value.partyTotal, 7);
    assert.equal(readQuickPin({ ...good, party: "group", group_size: "10" }).ok, true);
    assert.equal(readQuickPin({ ...good, party: "group", group_size: "11" }).ok, false);
    assert.equal(readQuickPin({ ...good, party: "group", group_size: "" }).ok, false);
    assert.equal(readQuickPin({ ...good, party: "5" }).ok, false, "a party value outside the choices");
  });

  it("Q02 the storage key the Worker's page looks for is the one supabase-js itself uses", () => {
    // The one read that remains of supabase-js's storage (decisions, the hand-off):
    // whether a session exists. Derived the way supabase-js derives it, and compared
    // with a real client's — a silent upgrade that moved it fails here (CLAUDE.md).
    const url = "https://mxuajvlrkggrqpntekqt.supabase.co";
    const client = createClient(url, "sb_publishable_test", { auth: { persistSession: false } });
    const theirs = (client.auth as unknown as { storageKey: string }).storageKey;
    assert.ok(theirs, "could not read supabase-js's storage key (the check found nothing)");
    assert.equal(supabaseStorageKey(url), theirs);
  });
});

describe("Neither A26 writes its own fields, copy or validation (the divergence guard)", () => {
  it("Q03 the guard's own patterns match something real — or an empty result would mean nothing", () => {
    assert.ok(copyStrings().length >= 8, `only ${copyStrings().length} shared strings to look for`);
    const planted = `export const x = <Text>{"${QUICKPIN_COPY.nineteen}"}</Text>; <input name="${QUICKPIN_FIELDS.firstName}">`;
    assert.deepEqual(ownCopy(planted), [QUICKPIN_COPY.nineteen], "the copy detector missed a planted literal");
    assert.deepEqual(ownFieldNames(planted), [QUICKPIN_FIELDS.firstName], "the field detector missed a planted literal");
  });

  for (const [who, path] of [
    ["the Worker's A26", WORKER_A26],
    ["the app's A26", EXPO_A26],
  ] as const) {
    it(`Q04 ${who} uses the shared module for all three — ${path}`, () => {
      assert.ok(existsSync(path), `${path} does not exist`);
      const source = readFileSync(path, "utf8");
      const body = code(source);
      assert.match(body, /readQuickPin\(/, "it does not validate with readQuickPin");
      assert.match(body, /QUICKPIN_COPY\./, "it does not take its words from QUICKPIN_COPY");
      assert.match(body, /QUICKPIN_FIELDS\./, "it does not name its fields from QUICKPIN_FIELDS");
      assert.match(body, /PARTY_CHOICES/, "it does not build who's-coming from PARTY_CHOICES");
      assert.deepEqual(ownCopy(source), [], "it writes shared copy as its own literal");
      assert.deepEqual(ownFieldNames(source), [], "it names a field with its own literal");
    });
  }
});
