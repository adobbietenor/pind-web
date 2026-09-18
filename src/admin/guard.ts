import type { Env } from "../env";
import { accessConfig, unverifiedClaims, verifyAccessToken, type SigningKey } from "./access";
import { forbidden } from "./ui";

// The team's public signing keys, cached per Worker instance for 10 minutes. An
// unknown key id triggers at most one refetch a minute.
let cache: { domain: string; keys: SigningKey[]; at: number } | null = null;

async function signingKeys(domain: string, refresh: boolean): Promise<SigningKey[]> {
  const age = cache && cache.domain === domain ? Date.now() - cache.at : Infinity;
  if (cache && age < (refresh ? 60_000 : 600_000)) return cache.keys;
  const res = await fetch(`${domain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`certs: HTTP ${res.status}`);
  const body = (await res.json()) as { keys?: SigningKey[] };
  cache = { domain, keys: body.keys ?? [], at: Date.now() };
  return cache.keys;
}

// Why a request was refused: the reason plus the token's iss and aud claims. Never
// the token. Read with `npx wrangler tail`.
function refuse(reason: string, claims: { iss?: string; aud?: string } = {}): Response {
  console.warn(JSON.stringify({ admin: "refused", reason, iss: claims.iss, aud: claims.aud }));
  return forbidden();
}

// Every /admin request passes here first. Returns the admin's email, or a 403.
export async function requireAdmin(request: Request, env: Env): Promise<{ email: string } | Response> {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  const config = accessConfig(env);
  if (typeof config === "string") return refuse(config, token ? unverifiedClaims(token) : {});

  const result = await verifyAccessToken(token, config, (refresh) => signingKeys(config.teamDomain, refresh));
  if (!result.ok) return refuse(result.reason, result);

  // Your Access cookie is sent even when another site submits a form here, so
  // every change must come from the admin's own pages.
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (request.headers.get("Origin") !== new URL(request.url).origin) return refuse("cross-site request");
  }
  return { email: result.email };
}
