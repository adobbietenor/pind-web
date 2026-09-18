import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env";

// What every admin handler receives, after the Access check has passed.
export interface AdminContext {
  env: Env;
  email: string; // the verified Access email; recorded in moderation_log as the actor
  params: Record<string, string>;
  // Service-role client: bypasses RLS. Admin is the one surface that sees everything,
  // which is why it sits behind Cloudflare Access AND the Worker's own token check.
  db: SupabaseClient;
}

export type AdminHandler = (request: Request, ctx: AdminContext) => Promise<Response>;
