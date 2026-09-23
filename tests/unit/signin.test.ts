// A1's methods per platform (M3.1).
//
// **Written because the web had no Apple button and nothing noticed.** The Services
// ID, the minted secret and the expiry watch were all built, and the table that
// decides what A1 renders still said "not on the web". A probe proved Apple's
// redirect existed; it could not prove anyone could reach it. This proves the button
// is asked for.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signInMethods } from "../../packages/shared/src/signin.ts";

describe("Sign-in methods", () => {
  it("S01 the web offers all three, Apple included", () => {
    assert.deepEqual(signInMethods("web"), ["apple", "google", "email"]);
  });

  it("S02 iOS offers all three, Apple first (Apple's rule, beside Google)", () => {
    assert.deepEqual(signInMethods("ios"), ["apple", "google", "email"]);
  });

  it("S03 Android offers no Apple button it cannot render", () => {
    assert.ok(!signInMethods("android").includes("apple"));
    assert.ok(signInMethods("android").includes("google"));
  });
});

describe("What a failed sign-in says (M3.1, from the walk)", () => {
  it("S05 a stale session is never called an expired code — the walk's false reading", async () => {
    const { signInSays, SIGNIN_CODE_BAD, SIGNIN_STALE } = await import("../../packages/shared/src/signin.ts");
    const stale = "Invalid Refresh Token: Refresh Token Not Found";
    for (const step of ["send", "verify", "oauth"] as const) {
      assert.notEqual(signInSays(step, stale), SIGNIN_CODE_BAD, `${step}: a stale session read as an expired code`);
      assert.equal(signInSays(step, stale), SIGNIN_STALE);
    }
  });

  it("S06 only entering a code can say a code expired", async () => {
    const { signInSays, SIGNIN_CODE_BAD, SIGNIN_BAD_EMAIL } = await import("../../packages/shared/src/signin.ts");
    assert.equal(signInSays("verify", "Token has expired or is invalid"), SIGNIN_CODE_BAD);
    assert.notEqual(signInSays("send", "Token has expired or is invalid"), SIGNIN_CODE_BAD);
    assert.equal(signInSays("send", 'Email address "x@y" is invalid'), SIGNIN_BAD_EMAIL);
    assert.notEqual(signInSays("oauth", "invalid_client"), SIGNIN_CODE_BAD);
  });

  it("S07 backing out of the Apple or Google sheet says nothing", async () => {
    const { signInSays } = await import("../../packages/shared/src/signin.ts");
    assert.equal(signInSays("oauth", "ERR_REQUEST_CANCELED"), "");
  });
});
