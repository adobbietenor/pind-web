// A27's one piece of logic that is not a screen: telling "that address already has an
// account" (the merge's branch) from every other failure — both sides (M3.2).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isEmailTaken, OPTIN_COPY, optInMissing } from "../../packages/shared/src/optin.ts";

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

// What still stands between a person and "open to meeting" (M3.2 walk: the gate refused
// at the safety sheet and the screen said "Pin'd was not allowed to write that").
describe("A27: what is missing, and the step that fixes it", () => {
  const all = [true, false].flatMap((permanent) =>
    [true, false].flatMap((hasPrivate) => [true, false].map((hasPhoto) => ({ permanent, hasPrivate, hasPhoto }))),
  );

  it("O01 complete is nothing missing, the safety sheet, and no sentence", () => {
    assert.deepEqual(optInMissing({ permanent: true, hasPrivate: true, hasPhoto: true }), { missing: [], step: "safety", says: null });
  });

  it("O02 every incomplete combination gets a sentence naming each missing thing, and a step that is not the safety sheet", () => {
    for (const f of all.filter((f) => !(f.permanent && f.hasPrivate && f.hasPhoto))) {
      const need = optInMissing(f);
      assert.notEqual(need.step, "safety", JSON.stringify(f));
      assert.ok(need.says, JSON.stringify(f));
      if (!f.hasPhoto) assert.match(need.says, /a photo of you/, JSON.stringify(f));
      if (!f.hasPrivate) assert.match(need.says, /date of birth and gender/, JSON.stringify(f));
      if (!f.permanent) assert.match(need.says, /a way to sign in/, JSON.stringify(f));
      assert.doesNotMatch(need.says, /not allowed|went wrong/i);
    }
  });

  it("O03 the walk's case: a merged account with no photo is sent to the photo, told so", () => {
    const need = optInMissing({ permanent: true, hasPrivate: true, hasPhoto: false });
    assert.deepEqual(need.missing, ["photo"]);
    assert.equal(need.step, "details");
    assert.equal(need.says, "One thing before you can meet people here: a photo of you. Add it below, then you're in.");
  });

  it("O04 only sign-in missing goes to the email step", () => {
    assert.equal(optInMissing({ permanent: false, hasPrivate: true, hasPhoto: true }).step, "contact");
  });
});
