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
    assert.match(OPTIN_COPY.emailHasAccountForNow, /Nothing was lost; your pin is still there/);
    assert.match(OPTIN_COPY.nothingLost, /Nothing was lost — your pin is still there/);
  });
});
