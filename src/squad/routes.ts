// The two ways a squad name check starts (M3.7), as the photo check's:
//
//   POST /hooks/squad-name    the database webhook — THE MECHANISM (/hooks/* is in
//                             run_worker_first)
//   POST /squad-name-check    the app, right after starting or renaming, with its own
//                             JWT — THE NET (listed in run_worker_first in this commit)
//
// **Neither trusts what it is sent.** The webhook names a squad and the row is re-read
// with the service key. The app's route reads the squad AS the caller, through RLS, so it
// can only aim the check at a squad they are in.

import { createClient } from "@supabase/supabase-js";
import type { Env } from "../env";
import { DEFAULT_CAP_USD } from "../photo/check.ts";
import { sameSecret } from "../photo/routes.ts";
import { projectUrl, serviceClient } from "../supabase.ts";
import { checkSquadName, type NameSource } from "./check.ts";

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function run(env: Env, crewId: string, source: NameSource): Promise<Response> {
  const cap = Number(env.AI_DAILY_CAP_USD ?? DEFAULT_CAP_USD);
  const out = await checkSquadName(serviceClient(env), env.ANTHROPIC_API_KEY, crewId, source, cap);
  return json(200, { checked: out.checked, status: out.status, error: out.error });
}

export async function squadNameWebhook(request: Request, env: Env): Promise<Response> {
  const expected = env.PHOTO_WEBHOOK_SECRET?.trim();
  const given = (request.headers.get("x-pind-webhook") ?? "").trim();
  if (!expected || !sameSecret(given, expected)) return json(401, { error: "no", header: given ? "mismatch" : "missing" });
  let payload: { record?: { id?: string } };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json(400, { error: "not JSON" });
  }
  const id = payload.record?.id;
  if (!id) return json(400, { error: "no record id" });
  return run(env, id, "webhook");
}

export async function squadNameCheckForMe(request: Request, env: Env): Promise<Response> {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json(401, { error: "sign in first" });
  const key = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!key) return json(503, { error: "SUPABASE_PUBLISHABLE_KEY is not set" });
  let body: { crew_id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: "not JSON" });
  }
  if (typeof body.crew_id !== "string") return json(400, { error: "no crew_id" });
  const asThem = createClient(projectUrl(env), key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: session } = await asThem.auth.getUser(token);
  if (!session?.user) return json(401, { error: "sign in first" });
  // Readable only to its members (crews_read_members): anyone else gets nothing.
  const { data: crew, error } = await asThem.from("crews").select("id").eq("id", body.crew_id).maybeSingle();
  if (error) return json(500, { error: error.message });
  if (!crew) return json(404, { error: "not your squad" });
  return run(env, crew.id, "app");
}
