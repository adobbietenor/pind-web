// The policy harness signs in under auth's rate limits (22 Oct 2026).
//
// A full run made 132 password sign-ins in 220 s; auth refused from the 127th, and every
// suite after P228 failed in setup on every run — 98 "failures" that were one fixture.
// A suite that cannot run must say so, and must not be defeated by the limit at all where
// waiting will do. These prove the wait and the give-up fire (with a fake auth client),
// and that no harness file signs in around them.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonSignIn, passwordSignIn, rateLimited } from "../policies/world.ts";

const POLICIES = join(process.cwd(), "tests", "policies");
const FAST = { retryEveryMs: 5, waitMs: 200 };
const LIMIT = { status: 429, code: "over_request_rate_limit", message: "Request rate limit reached" };
const OK = { data: { user: { id: "u1" }, session: {} }, error: null };

// A client whose sign-ins answer from a script, counting the calls.
function fake(answers: unknown[]) {
  let calls = 0;
  const next = async () => answers[Math.min(calls++, answers.length - 1)];
  const client = { auth: { signInWithPassword: next, signInAnonymously: next } } as unknown as SupabaseClient;
  return { client, calls: () => calls };
}
const limited = { data: { user: null, session: null }, error: LIMIT };
const creds = { email: "pindhx-x@example.com", password: "p" };

describe("Harness sign-in under auth's rate limits", () => {
  it("HL01 a rate-limited password sign-in waits and tries again until it is let in", async () => {
    const f = fake([limited, limited, OK]);
    const res = await passwordSignIn(f.client, creds, FAST);
    assert.equal(res.error, null);
    assert.equal(f.calls(), 3);
  });

  it("HL02 still refused after the wait: it throws 'FIXTURE, not product:', never a product failure", async () => {
    const f = fake([limited]);
    await assert.rejects(passwordSignIn(f.client, creds, FAST), /^Error: FIXTURE, not product: /);
    assert.ok(f.calls() > 1, "it waited and tried again before giving up");
  });

  it("HL03 any other refusal is returned at once, unretried, for the test's own assertion", async () => {
    const wrong = { data: { user: null, session: null }, error: { status: 400, code: "invalid_credentials", message: "Invalid login credentials" } };
    const f = fake([wrong, OK]);
    const res = await passwordSignIn(f.client, creds, FAST);
    assert.equal(res.error?.code, "invalid_credentials");
    assert.equal(f.calls(), 1);
  });

  it("HL04 the limit is recognised by its code or its status alone; nothing else is", () => {
    assert.equal(rateLimited({ code: "over_request_rate_limit" }), true);
    assert.equal(rateLimited({ status: 429 }), true);
    assert.equal(rateLimited({ status: 400, code: "invalid_credentials" }), false);
    assert.equal(rateLimited(null), false);
  });

  it("HL05 the hourly anonymous limit throws 'FIXTURE, not product:'; anything else comes back as auth sent it", async () => {
    await assert.rejects(anonSignIn(fake([limited]).client), /^Error: FIXTURE, not product: /);
    const other = { data: { user: null, session: null }, error: { status: 422, message: "Anonymous sign-ins are disabled" } };
    assert.deepEqual(await anonSignIn(fake([other]).client), other);
    assert.deepEqual(await anonSignIn(fake([OK]).client), OK);
  });
});

describe("No harness file signs in around the helpers", () => {
  const files = readdirSync(POLICIES).filter((n) => n.endsWith(".ts"));
  const DIRECT = /\.auth\.signIn(WithPassword|Anonymously)\(/g;

  it("HL06 only world.ts calls client.auth's sign-ins — and the pattern finds world.ts's own two", () => {
    const world = readFileSync(join(POLICIES, "world.ts"), "utf8");
    assert.equal((world.match(DIRECT) ?? []).length, 2, "the pattern must see the helpers' own calls, or it proves nothing");
    for (const name of files.filter((n) => n !== "world.ts")) {
      const hits = readFileSync(join(POLICIES, name), "utf8").match(DIRECT) ?? [];
      assert.deepEqual(hits, [], `${name} signs in directly — use passwordSignIn / anonSignIn from world.ts`);
    }
  });

  it("HL07 every explicit timeout in the harness leaves room for one wait (SIGN_IN_WAIT_MS)", () => {
    let seen = 0;
    for (const name of files) {
      for (const m of readFileSync(join(POLICIES, name), "utf8").matchAll(/timeout:\s*([^,}]+)/g)) {
        seen++;
        assert.match(m[1]!, /SIGN_IN_WAIT_MS/, `${name}: timeout ${m[1]!.trim()} cannot outlast a wait for the window`);
      }
    }
    assert.ok(seen >= 8, `the pattern must see the harness's own timeouts (saw ${seen})`);
  });
});
