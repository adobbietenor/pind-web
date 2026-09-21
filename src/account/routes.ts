// Delete account (A23, Phase 3 M3.1). Both stores require it in-app.
//
// **Why the Worker and not the app.** Removing the auth user needs the Auth admin
// API, which is the service key, which never goes in a bundle. Everything else the
// app could do as itself — but it must not, because a half-finished delete is worse
// than either state: the person row gone and the auth user left behind is a session
// that can sign in to nothing, and the reverse is a profile nobody can reach or
// remove. One call, server-side, in an order that survives failing part way.
//
// **What goes, and what deliberately stays** (Alex, M3.1, restating it so it is not
// rediscovered; decisions Part 3):
//
//   goes    the auth user, the `people` row and everything keyed to it — pins, tags,
//           the private row, the handle, contact points, spot votes, crew
//           memberships, confirmations, connections, blocks either way, photo checks
//           — and the photo file itself.
//   stays   `moderation_log` (no foreign keys, 12 months); `reports` filed by or
//           about them, with the person references nulled and the reason, the date
//           and any message snapshot kept for the 12 months; `gathering_stats`
//           aggregates. And **crew messages stay with the author nulled**, rendered
//           as "someone who left": removing a departed member's lines rewrites a
//           conversation other people are still reading.
//
// The order matters. The log row is written **first**, because it is the only record
// that outlives the row it is about; then the photo, then the person (which cascades),
// then the auth user last, so a failure never leaves a signed-in session pointing at
// a person who is already gone.

import type { Env } from "../env";
import { projectUrl, serviceClient } from "../supabase.ts";
import { createClient } from "@supabase/supabase-js";

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function deleteAccount(request: Request, env: Env): Promise<Response> {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json(401, { error: "sign in first" });
  const key = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!key) return json(503, { error: "not configured" });

  // Who is asking is decided by the token, never by the body. There is no body.
  const asThem = createClient(projectUrl(env), key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: session } = await asThem.auth.getUser(token);
  const authUserId = session?.user?.id;
  if (!authUserId) return json(401, { error: "sign in first" });

  const db = serviceClient(env);
  const { data: person, error } = await db
    .from("people")
    .select("id, photo_path")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (error) return json(500, { error: error.message });

  if (person) {
    // First, because it is the only thing that outlives the row.
    await db.from("moderation_log").insert({
      actor: "self:delete",
      action: "account_deleted",
      person_id: person.id,
      note: "Deleted by the person themselves (A23).",
    });

    // The whole folder, not just the current photo: replacing a photo leaves the old
    // object behind, and "delete my account" means the pictures too.
    const folder = await db.storage.from("photos").list(authUserId);
    const files = (folder.data ?? []).map((f) => `${authUserId}/${f.name}`);
    if (files.length) await db.storage.from("photos").remove(files);

    const removed = await db.from("people").delete().eq("id", person.id);
    if (removed.error) return json(500, { error: removed.error.message });
  }

  // Last. A failure before this leaves a session whose person is gone, which the app
  // recovers from by signing out. A failure HERE leaves an auth user with no person —
  // it can sign in and sees nothing, and **nothing sweeps it up**, because no such
  // job exists. Said plainly rather than waved at: an orphaned auth row is harmless
  // and a comment claiming something cleans it would be the more expensive kind of
  // wrong. If it ever matters, it is a retention job in M4.1 with the rest.
  const gone = await db.auth.admin.deleteUser(authUserId);
  if (gone.error) return json(500, { error: gone.error.message });

  return json(200, { deleted: true });
}
