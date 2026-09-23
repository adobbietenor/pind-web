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
