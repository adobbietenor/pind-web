// Everything the Worker receives from Cloudflare at request time.
// Values come from .dev.vars locally and from `wrangler secret put` when deployed.
// Every field is optional on purpose: a missing secret must produce a plain
// error page ("SUPABASE_URL is missing"), not a crash.
export interface Env {
  SUPABASE_URL?: string;
  // Bypasses RLS. Server-side only; never used to read people on behalf of a
  // visitor (decisions.md Part 5).
  SUPABASE_SERVICE_ROLE_KEY?: string;
  // Signs the Test 0 session cookie. Declared now, used from T3 onwards.
  SESSION_SECRET?: string;
}
