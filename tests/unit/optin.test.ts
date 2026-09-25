// A27's one piece of logic that is not a screen: telling "that address already has an
// account" (the merge's branch) from every other failure — both sides (M3.2).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isEmailTaken, OPTIN_COPY } from "../../packages/shared/src/optin.ts";

describe("A27: the existing-account branch", () => {
  it("M01 the auth server's own shapes for a taken address are recognised", () => {
    assert.ok(isEmailTaken({ code: "email_exists", message: "whatever" }));
    assert.ok(isEmailTaken({ message: "A user with this email address has already been registered" }));
  });

  it("M02 nothing else is mistaken for it — a bad code, a rate limit, offline, garbage", () => {
    for (const err of [
      { code: "otp_expired", message: "Token has expired or is invalid" },
      { message: "Email rate limit exceeded" },
      new TypeError("Network request failed"),
      null,
      "email_exists",
    ]) {
      assert.equal(isEmailTaken(err), false, JSON.stringify(err));
    }
  });

  it("M03 the branch's sentence says the pin is safe (Alex: never silence about whether it survived)", () => {
    assert.match(OPTIN_COPY.emailHasAccount, /enter it to bring this pin into that account/);
    assert.match(OPTIN_COPY.nothingLost, /Nothing was lost — your pin is still there/);
  });
});

import { mergeRefusal } from "../../src/account/merge-checks.ts";

describe("The merge's four checks, each made to fire (Alex: a refusal nobody has seen refuse is not proven)", () => {
  const anon = { id: "a", is_anonymous: true };
  const perm = { id: "p", is_anonymous: false };

  it("M04 both valid, anonymous into permanent, different people: go", () => {
    assert.equal(mergeRefusal(anon, perm), null);
  });
  it("M05 check 1 fires: either session not valid", () => {
    assert.ok(mergeRefusal(null, perm));
    assert.ok(mergeRefusal(anon, null));
  });
  it("M06 check 2 fires: the first session is not anonymous (or does not say)", () => {
    assert.ok(mergeRefusal({ id: "a", is_anonymous: false }, perm));
    assert.ok(mergeRefusal({ id: "a" }, perm));
  });
  it("M07 check 3 fires: the second session is anonymous (or does not say)", () => {
    assert.ok(mergeRefusal(anon, { id: "p", is_anonymous: true }));
    assert.ok(mergeRefusal(anon, { id: "p" }));
  });
  it("M08 check 4 fires: the same person twice", () => {
    assert.ok(mergeRefusal({ id: "x", is_anonymous: true }, { id: "x", is_anonymous: false }));
  });
});
