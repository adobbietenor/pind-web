// POST /account/merge — an anonymous pinner joins the account they already have (A27,
// M3.2; the design Alex approved).
//
// The app arrives with BOTH sessions: the account's, in the Authorization header —
// which it holds only because the sign-in code just proved the address — and the
// anonymous one it kept, in the body. **Before anything moves, the auth server itself
// vouches for each**, and four checks must pass (M04–M08 make each one fire):
//
//   1. both sessions are valid right now;
//   2. the first is really anonymous;
//   3. the second is really permanent;
//   4. they are different people.
//
// Only then does the service key run `admin_merge_anonymous` with the two ids the auth
// server returned — never ids the request supplied. A stranger who typed someone
// else's address never got the code, so never holds the second session, and this
// route refuses them at check 1.

import type { Env } from "../env";
import { projectUrl, serviceClient } from "../supabase.ts";
import { mergeRefusal, type VouchedUser } from "./merge-checks.ts";

// Ask the auth server who a token belongs to. Null for anything it will not vouch for.
async function vouch(env: Env, token: string | null | undefined): Promise<VouchedUser | null> {
  const key = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!token || !key) return null;
  const res = await fetch(`${projectUrl(env)}/auth/v1/user`, {
    headers: { apikey: key, authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const user = (await res.json().catch(() => null)) as VouchedUser | null;
  return user?.id ? { id: user.id, is_anonymous: user.is_anonymous } : null;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function mergeAccount(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json(403, { error: "cross-origin" });

  const permToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const body = (await request.json().catch(() => ({}))) as { anon_access_token?: string };
  const [anon, perm] = await Promise.all([vouch(env, body.anon_access_token), vouch(env, permToken)]);

  const refused = mergeRefusal(anon, perm);
  if (refused) return json(403, { error: refused });

  const { data, error } = await serviceClient(env).rpc("admin_merge_anonymous", { p_anon: anon!.id, p_perm: perm!.id });
  if (error) {
    console.error("merge failed:", error.message);
    return json(500, { error: "merge failed" });
  }
  return json(200, data);
}
