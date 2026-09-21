// The two ways a photo check starts (Phase 3 M3.1; decisions.md Part 5, "Photo check
// on the Worker via a database webhook").
//
//   POST /hooks/photo-check   the database webhook — THE MECHANISM
//   POST /photo-check         the app, right after upload, with its own JWT — THE NET
//
// Both are in `run_worker_first` in wrangler.jsonc, in the same commit as the routes.
// A Worker route that is not listed there never runs: the assets binding answers
// first and the app's single-page fallback returns its own index.html with a 200, so
// a route that was never wired up looks like a working page of the wrong application
// (M2.3).
//
// **Neither route trusts what it is sent.** The webhook's payload names a person; the
// row is then re-read with the service key, and the check runs against what the
// database actually holds. The app's route is given no body at all — it reads the
// caller's own person row as the caller, through RLS, and checks whatever photo is on
// it. So neither a replayed webhook nor a crafted body can aim the check at somebody
// else's photo.

import { checkPhoto, DEFAULT_CAP_USD, type Source } from "./check.ts";
import type { Env } from "../env";
import { projectUrl, serviceClient } from "../supabase.ts";
import { createClient } from "@supabase/supabase-js";

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Length-independent comparison, so a wrong secret tells an attacker nothing by how
// long it took to be refused.
function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

async function run(env: Env, personId: string, source: Source): Promise<Response> {
  const db = serviceClient(env);
  const { data: person, error } = await db
    .from("people")
    .select("id, photo_path, photo_status")
    .eq("id", personId)
    .maybeSingle();
  if (error) return json(500, { error: error.message });
  // Nothing to do is a success: a person with no photo, or one already decided, is
  // not a failure and must not leave a failure record.
  if (!person?.photo_path) return json(200, { checked: false, why: "no photo" });
  if (person.photo_status !== "pending") {
    return json(200, { checked: false, why: `already ${person.photo_status}` });
  }
  const cap = Number(env.AI_DAILY_CAP_USD ?? DEFAULT_CAP_USD);
  const result = await checkPhoto(db, env.ANTHROPIC_API_KEY, { id: person.id, photo_path: person.photo_path }, source, cap);
  return json(200, { checked: true, status: result.status, cost: result.cost, error: result.error });
}

// The database webhook. Supabase sends { type, table, record, old_record }.
export async function photoWebhook(request: Request, env: Env): Promise<Response> {
  // A missing secret is refused exactly like a wrong one. The rule is that a missing
  // credential reports itself **in front of whoever can fix it** — which is the admin
  // photo queue, where it says "PHOTO_WEBHOOK_SECRET is not set" in as many words —
  // not to whoever finds the URL. Naming a setting in a public reply tells a stranger
  // what we are missing and helps nobody who can act on it.
  const expected = env.PHOTO_WEBHOOK_SECRET?.trim();
  const given = (request.headers.get("x-pind-webhook") ?? "").trim();
  if (!expected || !sameSecret(given, expected)) {
    // **Which 401 this is, in one word.** "No header arrived" and "a header arrived
    // and did not match" are different faults — the first is the trigger or pg_net,
    // the second is the two halves of the secret — and they were indistinguishable
    // from the database side, which cost a round trip on the M3.1 walk. It tells a
    // prober nothing they do not already know: whether they sent a header.
    return json(401, { error: "no", header: given ? "mismatch" : "missing" });
  }

  let payload: { record?: { id?: string; photo_path?: string | null }; old_record?: { photo_path?: string | null } };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json(400, { error: "not JSON" });
  }
  const id = payload.record?.id;
  if (!id) return json(400, { error: "no record id" });
  // An update that did not touch the photo is not a reason to spend money.
  if (payload.old_record && payload.old_record.photo_path === payload.record?.photo_path) {
    return json(200, { checked: false, why: "the photo did not change" });
  }
  return run(env, id, "webhook");
}

// The app's own call after an upload. No body: the JWT says who is asking, and the
// person row is read AS them, so RLS decides what they may point this at.
export async function photoCheckForMe(request: Request, env: Env): Promise<Response> {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json(401, { error: "sign in first" });
  const key = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!key) return json(503, { error: "SUPABASE_PUBLISHABLE_KEY is not set" });

  const asThem = createClient(projectUrl(env), key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  // Supabase validates the token; an expired or forged one has no user.
  const { data: session } = await asThem.auth.getUser(token);
  if (!session?.user) return json(401, { error: "sign in first" });
  // Read as them, and by their own auth id — `people` returns everyone they can see,
  // so an unfiltered read here would be a different question with the same shape.
  const { data: me, error } = await asThem
    .from("people")
    .select("id")
    .eq("auth_user_id", session.user.id)
    .maybeSingle();
  if (error) return json(500, { error: error.message });
  if (!me) return json(404, { error: "no person for this session" });
  return run(env, me.id, "app");
}
