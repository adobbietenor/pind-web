// Verifies a Cloudflare Access token (a JWT signed with RS256) — the Worker's own
// lock on /admin, behind Cloudflare Access itself. If Access is ever misconfigured
// or bypassed, a request without a valid token for this application is refused.
//
// Checks, in order: well-formed, RS256 with a known key id, signature, issuer (the
// team domain), audience (the application's AUD tag), expiry, and the email
// allowlist. Uses the built-in Web Crypto; no dependency. Nothing here imports at
// runtime, so the unit tests load this file directly.

export interface AccessConfig {
  teamDomain: string; // https://<team>.cloudflareaccess.com — the expected issuer
  // The AUD tags this Worker accepts. Normally one. It takes a comma-separated list
  // so a move between hostnames has no gap: while both pind.social/admin* and the
  // old workers.dev application exist, tokens from either verify. It narrows back to
  // one the moment the old application is gone (M2.1).
  auds: string[];
  emails: string[]; // lower case
}

export interface SigningKey {
  kid?: string;
  kty: string;
  n?: string;
  e?: string;
  alg?: string;
}

// Returns the team's public signing keys; refresh = true asks for a fresh fetch
// (a key id we don't know may mean Cloudflare rotated keys).
export type KeySource = (refresh: boolean) => Promise<SigningKey[]>;

// On refusal, `iss` and `aud` are the token's claims — safe to log, and the way to
// see which issuer tokens carry. The token itself is never returned or logged.
export type AccessResult =
  | { ok: true; email: string }
  | { ok: false; reason: string; iss?: string; aud?: string };

const SKEW_SECONDS = 60;

function bytes(segment: string): Uint8Array<ArrayBuffer> {
  const b64 = segment.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((segment.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function json(segment: string): Record<string, unknown> {
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes(segment)));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
  return value as Record<string, unknown>;
}

function audiences(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list.filter((a): a is string => typeof a === "string");
}

// The issuer and audience of a token, WITHOUT verifying it. Only for logging why a
// request was refused.
export function unverifiedClaims(token: string): { iss?: string; aud?: string } {
  try {
    const payload = json(token.split(".")[1] ?? "");
    return {
      iss: typeof payload.iss === "string" ? payload.iss : undefined,
      aud: audiences(payload.aud).join(","),
    };
  } catch {
    return {};
  }
}

// Reads the admin's Access settings. Returns a reason string when one is missing or
// malformed; the caller refuses every admin request until it is fixed.
export function accessConfig(env: {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ADMIN_EMAILS?: string;
}): AccessConfig | string {
  const teamDomain = env.ACCESS_TEAM_DOMAIN?.trim().replace(/\/+$/, "") ?? "";
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(teamDomain)) {
    return "ACCESS_TEAM_DOMAIN is missing or not https://<team>.cloudflareaccess.com";
  }
  const auds = (env.ACCESS_AUD ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  if (!auds.length || !auds.every((a) => /^[A-Za-z0-9]{16,128}$/.test(a))) {
    return "ACCESS_AUD is missing or not an AUD tag (one, or several separated by commas)";
  }
  const emails = (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!emails.length) return "ADMIN_EMAILS is missing";
  return { teamDomain, auds, emails };
}

export async function verifyAccessToken(
  token: string | null,
  config: AccessConfig,
  keys: KeySource,
  nowMs: number = Date.now(),
): Promise<AccessResult> {
  if (!token) return { ok: false, reason: "no Access token" };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed token" };

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = json(parts[0]!);
    payload = json(parts[1]!);
  } catch {
    return { ok: false, reason: "malformed token" };
  }
  const seen = {
    iss: typeof payload.iss === "string" ? payload.iss : undefined,
    aud: audiences(payload.aud).join(","),
  };
  const fail = (reason: string): AccessResult => ({ ok: false, reason, ...seen });

  if (header.alg !== "RS256" || typeof header.kid !== "string") return fail("unexpected algorithm or key id");

  let key: SigningKey | undefined;
  try {
    key = (await keys(false)).find((k) => k.kid === header.kid);
    if (!key) key = (await keys(true)).find((k) => k.kid === header.kid);
  } catch {
    return fail("could not fetch signing keys");
  }
  if (!key) return fail("unknown signing key");

  let valid = false;
  try {
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      { kty: key.kty, n: key.n, e: key.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      bytes(parts[2]!),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    valid = false;
  }
  if (!valid) return fail("bad signature");

  if (seen.iss !== config.teamDomain) return fail("wrong issuer");
  if (!audiences(payload.aud).some((a) => config.auds.includes(a))) return fail("wrong audience");

  const now = nowMs / 1000;
  if (typeof payload.exp !== "number" || payload.exp <= now - SKEW_SECONDS) return fail("expired");
  if (typeof payload.nbf === "number" && payload.nbf > now + SKEW_SECONDS) return fail("not yet valid");

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email || !config.emails.includes(email)) return fail("email not on the admin allowlist");

  return { ok: true, email };
}
