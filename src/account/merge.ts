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
//
// **The merge fills the account's gaps and leaves nothing behind** (Alex, M3.2 walk).
// The database moves rows; the photo FILE is moved here, in the same request:
//   1. ask which photo the account would take (none if it has its own, or it was rejected);
//   2. copy it into the account's folder;
//   3. merge, pointing the account at the copy — the database takes it only where the
//      account has no photo, so the account's own is never replaced;
//   4. remove everything left in the anonymous folder, the copy's source included, and
//      the copy itself if the database did not take it.
// A file this cannot remove is logged; `npm run check:orphan-photos` finds any that remain.

import type { Env } from "../env";
import { projectUrl, serviceClient } from "../supabase.ts";
import { mergeRefusal, photoDest, type VouchedUser } from "./merge-checks.ts";

const BUCKET = "photos";

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

  const db = serviceClient(env);
  const photos = db.storage.from(BUCKET);

  // 1–2. The photo the account would take, copied into its folder first, so the path
  // the database is given always has a file behind it.
  let dest: string | null = null;
  const plan = await db.rpc("admin_merge_photo_plan", { p_anon: anon!.id, p_perm: perm!.id });
  if (plan.error) console.error("merge photo plan failed:", plan.error.message);
  else if (typeof plan.data === "string" && plan.data) {
    const to = photoDest(perm!.id, plan.data);
    const copied = await photos.copy(plan.data, to);
    if (copied.error) console.error("merge photo copy failed:", copied.error.message);
    else dest = to;
  }

  // 3. The merge itself, one transaction.
  const { data, error } = await db.rpc("admin_merge_anonymous", { p_anon: anon!.id, p_perm: perm!.id, p_photo_dest: dest });
  if (error) {
    console.error("merge failed:", error.message);
    // Nothing moved: the anonymous person keeps their photo; only the copy goes.
    if (dest) await photos.remove([dest]).catch(() => undefined);
    return json(500, { error: "merge failed" });
  }

  // 4. Nothing of the anonymous person stays in the bucket.
  const leftovers: string[] = [];
  const listed = await photos.list(anon!.id, { limit: 1000 });
  if (listed.error) console.error("merge could not list the anonymous folder:", listed.error.message);
  for (const f of listed.data ?? []) if (f.id) leftovers.push(`${anon!.id}/${f.name}`);
  if (dest && !(data as { photo?: boolean } | null)?.photo) leftovers.push(dest);
  if (leftovers.length) {
    const removed = await photos.remove(leftovers);
    if (removed.error) console.error(`merge left ${leftovers.length} photo file(s):`, removed.error.message);
  }
  return json(200, data);
}
