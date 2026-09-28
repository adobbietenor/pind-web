// The quick pin's sealed session cookie (M3.2). The Worker keeps an anonymous
// visitor's refresh token in it until the app claims it; these prove it opens only for
// our key, only untouched, and never as something it is not.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pinCookie, readCookie, seal, unseal } from "../../src/public/sealed.ts";

const value = { userId: "u-1", refreshToken: "r-abc", issuedAt: 1 };

describe("The sealed pin cookie", () => {
  it("Z01 what is sealed opens to exactly what went in", async () => {
    assert.deepEqual(await unseal("secret", await seal("secret", value)), value);
  });

  it("Z02 a different key, a changed byte or garbage opens to nothing — never to a session", async () => {
    const token = await seal("secret", value);
    assert.equal(await unseal("another", token), null, "opened under the wrong key");
    const flipped = token.slice(0, -2) + (token.at(-2) === "A" ? "B" : "A") + token.at(-1);
    assert.equal(await unseal("secret", flipped), null, "a tampered cookie opened");
    for (const junk of [null, "", "abc", "a.b", "..."]) assert.equal(await unseal("secret", junk), null, `opened: ${junk}`);
  });

  it("Z03 whitespace round the secret does not change the key (normalised at the point of use)", async () => {
    // CLAUDE.md, the instrument rule: two sides compared must be normalised the same way.
    assert.deepEqual(await unseal("secret\n", await seal("  secret", value)), value);
  });

  it("Z04 the cookie is HttpOnly, Secure and SameSite=Lax, and is read back by name", () => {
    const set = pinCookie("x.y");
    for (const attr of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) assert.ok(set.includes(attr), `missing ${attr}`);
    const req = new Request("https://pind.social/", { headers: { cookie: "a=1; pind_pin=x.y; b=2" } });
    assert.equal(readCookie(req, "pind_pin"), "x.y");
    assert.equal(readCookie(new Request("https://pind.social/"), "pind_pin"), null);
  });
});
