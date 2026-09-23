// Whether this device is signed in (M3.1, from the airplane-mode walk).
//
// **Written because offline was called a lost sign-in.** A2 told Alex "We lost your
// sign-in. Go back and sign in again" in airplane mode, with a session that was fine:
// `getUser()` is a network call, offline it answers `user: null` with an
// AuthRetryableFetchError, and the screen read the null and dropped the error. These
// put each shape the network actually produces in front of the rule and insist it is
// NOT read as signed out — and put the real signed-out shapes in front of it and
// insist they are. Both sides of the boundary.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isUnreachable,
  readSession,
  SESSION_OUT,
  SESSION_UNREACHABLE,
  sessionSays,
  sessionWayOut,
} from "../../packages/shared/src/session.ts";

// The shapes, as the libraries build them (auth-js lib/errors.js, lib/fetch.js;
// postgrest-js wraps a rejected fetch as "<name>: <message>"; storage-js keeps the
// fetch error's message).
const authOffline = { name: "AuthRetryableFetchError", message: "Network request failed", status: 0 };
const auth503 = { name: "AuthRetryableFetchError", message: "Service Unavailable", status: 503 };
const missing = { name: "AuthSessionMissingError", message: "Auth session missing!", status: 400 };
const staleRefresh = { name: "AuthApiError", message: "Invalid Refresh Token: Refresh Token Not Found", status: 400 };
const badJwt = { name: "AuthApiError", message: "invalid JWT", status: 401 };
const session = { user: { id: "u1" } };

describe("An unreachable server is not a lost session", () => {
  it("N01 offline with no user back — the walk's exact shape — is unreachable, never out", () => {
    const read = readSession(null, authOffline);
    assert.equal(read.state, "unreachable");
    assert.notEqual(sessionSays(read as never), SESSION_OUT);
  });

  it("N02 the auth server down (a 503) is unreachable, not out", () => {
    assert.equal(readSession(null, auth503).state, "unreachable");
  });

  it("N03 each platform's own offline sentence is recognised", () => {
    for (const message of [
      "Network request failed", // React Native
      "Failed to fetch", // Chrome
      "Load failed", // Safari
      "TypeError: Network request failed", // postgrest-js's wrapping
      "The Internet connection appears to be offline.", // iOS NSURLError
    ]) {
      assert.ok(isUnreachable({ message }), message);
      assert.ok(isUnreachable(new TypeError(message)), `TypeError ${message}`);
    }
  });

  it("N04 an error nobody recognises is unsure, with its own message — never out", () => {
    const read = readSession(null, { name: "Weird", message: "something odd", status: 500 });
    assert.deepEqual(read, { state: "unsure", message: "something odd" });
  });

  it("N05 a session on the device is in, and an offline refresh beside it does not demote it to out", () => {
    assert.deepEqual(readSession(session, null), { state: "in", userId: "u1" });
    assert.equal(readSession(session, authOffline).state, "unreachable");
  });
});

describe("A real sign-out is still called one", () => {
  it("N06 nothing stored is out", () => {
    assert.equal(readSession(null, null).state, "out");
  });

  it("N07 the auth server's own refusals are out: session missing, a dead refresh token, a 401", () => {
    for (const err of [missing, staleRefresh, badJwt]) assert.equal(readSession(null, err).state, "out", err.message);
  });

  it("N08 a server error is not mistaken for offline (the regex stays narrow)", () => {
    assert.ok(!isUnreachable({ message: "permission denied for table people", code: "42501" }));
    assert.ok(!isUnreachable(badJwt));
    assert.ok(!isUnreachable(null));
  });
});

describe("Each sentence names its own cause and carries its exit", () => {
  it("N09 out sends you to sign in; unreachable and unsure offer Try again, and never tell you to sign in", () => {
    assert.equal(sessionWayOut({ state: "out" }), "sign-in");
    assert.equal(sessionWayOut({ state: "unreachable" }), "retry");
    assert.equal(sessionWayOut({ state: "unsure", message: "x" }), "retry");
    assert.notEqual(SESSION_UNREACHABLE, SESSION_OUT);
    assert.doesNotMatch(SESSION_UNREACHABLE, /sign in again/i);
    assert.doesNotMatch(sessionSays({ state: "unsure", message: "x" }), /sign in again/i);
    assert.match(SESSION_UNREACHABLE, /could not be reached/);
  });
});
