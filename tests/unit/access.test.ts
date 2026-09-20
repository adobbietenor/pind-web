// The Worker's own Access check (src/admin/access.ts). Run with `npm run test:unit`.
// Tokens are signed here with throwaway keys; no network, no database.
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { webcrypto } from "node:crypto";
import { accessConfig, unverifiedClaims, verifyAccessToken, type AccessConfig, type SigningKey } from "../../src/admin/access.ts";

const TEAM = "https://pind-test.cloudflareaccess.com";
const AUD = "a".repeat(64);
const config: AccessConfig = { teamDomain: TEAM, auds: [AUD], emails: ["alex@example.com"] };
const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);

const b64url = (data: Uint8Array | string) =>
  Buffer.from(typeof data === "string" ? Buffer.from(data) : data).toString("base64url");

interface Signer {
  kid: string;
  jwk: SigningKey;
  privateKey: webcrypto.CryptoKey;
}

async function signer(kid: string): Promise<Signer> {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as SigningKey;
  return { kid, jwk: { ...jwk, kid }, privateKey: pair.privateKey };
}

async function token(s: Signer, claims: Record<string, unknown>, header: Record<string, unknown> = {}): Promise<string> {
  const h = b64url(JSON.stringify({ alg: "RS256", kid: s.kid, typ: "JWT", ...header }));
  const p = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", s.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}

const good = (over: Record<string, unknown> = {}) => ({
  iss: TEAM,
  aud: [AUD],
  email: "Alex@Example.com",
  exp: NOW / 1000 + 3600,
  iat: NOW / 1000 - 10,
  nbf: NOW / 1000 - 10,
  ...over,
});

let team: Signer;
let stranger: Signer;
const keys = async () => [team.jwk];

async function refused(t: string | null, reason: string, source = keys) {
  const result = await verifyAccessToken(t, config, source, NOW);
  assert.equal(result.ok, false, "token was accepted");
  if (!result.ok) assert.equal(result.reason, reason);
}

before(async () => {
  team = await signer("team-key");
  stranger = await signer("team-key"); // same kid, different key: a forgery
});

describe("Access token — the Worker refuses unless everything checks out", () => {
  it("A01 a valid token for this application and an allowlisted email is accepted", async () => {
    const result = await verifyAccessToken(await token(team, good()), config, keys, NOW);
    assert.deepEqual(result, { ok: true, email: "alex@example.com" });
  });

  it("A02 no token, or garbage, is refused", async () => {
    await refused(null, "no Access token");
    await refused("", "no Access token");
    await refused("not-a-jwt", "malformed token");
    await refused("a.b.c", "malformed token");
  });

  it("A03 a token signed by someone else's key is refused (bad signature)", async () => {
    await refused(await token(stranger, good()), "bad signature");
  });

  it("A04 a tampered payload is refused", async () => {
    const [h, , s] = (await token(team, good({ email: "someone@example.com" }))).split(".");
    const forged = `${h}.${b64url(JSON.stringify(good()))}.${s}`;
    await refused(forged, "bad signature");
  });

  it("A05 an unsigned token (alg none) or an unknown key id is refused", async () => {
    const p = b64url(JSON.stringify(good()));
    await refused(`${b64url(JSON.stringify({ alg: "none", kid: "team-key" }))}.${p}.`, "unexpected algorithm or key id");
    const other = await signer("other-key");
    await refused(await token(other, good()), "unknown signing key");
  });

  it("A06 wrong issuer, wrong audience, expired or not-yet-valid tokens are refused", async () => {
    await refused(await token(team, good({ iss: "https://someone-else.cloudflareaccess.com" })), "wrong issuer");
    await refused(await token(team, good({ aud: ["b".repeat(64)] })), "wrong audience");
    await refused(await token(team, good({ exp: NOW / 1000 - 120 })), "expired");
    await refused(await token(team, good({ exp: undefined })), "expired");
    await refused(await token(team, good({ nbf: NOW / 1000 + 600 })), "not yet valid");
  });

  it("A07 a valid token for an email not on the allowlist is refused", async () => {
    await refused(await token(team, good({ email: "other@example.com" })), "email not on the admin allowlist");
    await refused(await token(team, good({ email: undefined })), "email not on the admin allowlist");
  });

  it("A08 when the key list can't be fetched, the request is refused, not let through", async () => {
    await refused(await token(team, good()), "could not fetch signing keys", async () => {
      throw new Error("network down");
    });
  });

  it("A09 a rotated key is picked up with one refresh", async () => {
    let calls = 0;
    const rotating = async (refresh: boolean) => {
      calls++;
      return refresh ? [team.jwk] : [];
    };
    const result = await verifyAccessToken(await token(team, good()), config, rotating, NOW);
    assert.equal(result.ok, true);
    assert.equal(calls, 2);
  });

  it("A10 refusals report iss and aud for the log, never the token", async () => {
    const t = await token(team, good({ iss: "https://old-name.cloudflareaccess.com" }));
    const result = await verifyAccessToken(t, config, keys, NOW);
    assert.deepEqual(result, {
      ok: false,
      reason: "wrong issuer",
      iss: "https://old-name.cloudflareaccess.com",
      aud: AUD,
    });
    assert.ok(!JSON.stringify(result).includes(t.split(".")[2]!), "signature leaked into the result");
    assert.deepEqual(unverifiedClaims(t), { iss: "https://old-name.cloudflareaccess.com", aud: AUD });
  });
});

describe("Access settings — missing or malformed means every admin request is refused", () => {
  it("A11 accepts a complete configuration", () => {
    assert.deepEqual(
      accessConfig({ ACCESS_TEAM_DOMAIN: `${TEAM}/`, ACCESS_AUD: AUD, ADMIN_EMAILS: " Alex@Example.com , b@x.com" }),
      { teamDomain: TEAM, auds: [AUD], emails: ["alex@example.com", "b@x.com"] },
    );
  });

  it("A12 reports each missing or malformed setting", () => {
    assert.equal(typeof accessConfig({}), "string");
    assert.equal(typeof accessConfig({ ACCESS_TEAM_DOMAIN: "pind-test.cloudflareaccess.com", ACCESS_AUD: AUD, ADMIN_EMAILS: "a@b.c" }), "string");
    assert.equal(typeof accessConfig({ ACCESS_TEAM_DOMAIN: "https://evil.example.com", ACCESS_AUD: AUD, ADMIN_EMAILS: "a@b.c" }), "string");
    assert.equal(typeof accessConfig({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: "", ADMIN_EMAILS: "a@b.c" }), "string");
    assert.equal(typeof accessConfig({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: " , " }), "string");
  });
});

// M2.1 — moving the admin from workers.dev to pind.social means two Access
// applications exist at once, each with its own AUD. ACCESS_AUD takes a list so the
// move has no window where the admin is unreachable, and narrows back to one after.
describe("Two Access applications, while the admin moves hostname", () => {
  const OLD = "7".repeat(64);
  const NEW = "3".repeat(64);

  it("A13 a list of AUD tags is read, and a token matching EITHER is accepted / one matching neither is refused", async () => {
    const both = accessConfig({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: ` ${NEW} , ${OLD} `, ADMIN_EMAILS: "alex@example.com" });
    assert.ok(typeof both !== "string", both as string);
    assert.deepEqual(both.auds, [NEW, OLD]);

    for (const aud of [OLD, NEW]) {
      const result = await verifyAccessToken(await token(team, good({ aud: [aud] })), both, keys, NOW);
      assert.equal(result.ok, true, `a token for ${aud === OLD ? "the old" : "the new"} application was refused`);
    }
    const stray = await verifyAccessToken(await token(team, good({ aud: ["9".repeat(64)] })), both, keys, NOW);
    assert.equal(stray.ok, false, "a token for neither application was accepted");
    if (!stray.ok) assert.equal(stray.reason, "wrong audience");
  });

  it("A14 a malformed entry anywhere in the list refuses every admin request", () => {
    for (const value of ["", " , ", `${NEW},nope`, "nope"]) {
      const c = accessConfig({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: value, ADMIN_EMAILS: "alex@example.com" });
      assert.equal(typeof c, "string", `"${value}" was accepted`);
    }
  });
});
