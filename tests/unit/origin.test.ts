// Admin writes must come from the admin's own pages (src/admin/origin.ts).
// Run with `npm run test:unit`.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sameOriginWrite } from "../../src/admin/origin.ts";

const URL_ = "https://pind-web-staging.pind.workers.dev/admin/gatherings/0e25920a-38ea-43d1-9cc7-eade7d70cca4/publish";
const OWN = "https://pind-web-staging.pind.workers.dev";

const check = (method: string, headers: Record<string, string>) => sameOriginWrite(method, URL_, new Headers(headers));

describe("Admin form posts — same-origin passes, cross-site is refused", () => {
  it("O01 a same-origin form POST passes — including Origin: null, what the browser sent under no-referrer (M1.2 bug)", () => {
    assert.deepEqual(check("POST", { "Sec-Fetch-Site": "same-origin", Origin: "null" }), { ok: true });
    assert.deepEqual(check("POST", { "Sec-Fetch-Site": "same-origin", Origin: OWN }), { ok: true });
    assert.deepEqual(check("POST", { "Sec-Fetch-Site": "same-origin" }), { ok: true });
  });

  it("O02 an older browser without Sec-Fetch-Site passes only with our exact Origin", () => {
    assert.deepEqual(check("POST", { Origin: OWN }), { ok: true });
    assert.equal(check("POST", { Origin: "null" }).ok, false);
    assert.equal(check("POST", {}).ok, false);
  });

  it("O03 a cross-site form POST is refused (another site submitting to the admin with your Access cookie)", () => {
    const r = check("POST", { "Sec-Fetch-Site": "cross-site", Origin: "https://evil.example" });
    assert.deepEqual(r, { ok: false, reason: "cross-site request", origin: "https://evil.example", secFetchSite: "cross-site" });
    assert.equal(check("POST", { Origin: "https://evil.example" }).ok, false);
  });

  it("O04 same-site is refused too: another Worker under pind.workers.dev is not the admin", () => {
    assert.equal(check("POST", { "Sec-Fetch-Site": "same-site", Origin: "https://other.pind.workers.dev" }).ok, false);
  });

  it("O05 same-origin claimed but a foreign Origin, or a direct navigation, is refused", () => {
    assert.equal(check("POST", { "Sec-Fetch-Site": "same-origin", Origin: "https://evil.example" }).ok, false);
    assert.equal(check("POST", { "Sec-Fetch-Site": "none" }).ok, false);
  });

  it("O06 GET pages are not writes and always pass this check (the Access token check still applies)", () => {
    assert.deepEqual(check("GET", { "Sec-Fetch-Site": "cross-site" }), { ok: true });
  });
});
