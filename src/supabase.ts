import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./env";

// A missing or empty setting. The message is safe to show on a page: it names
// the setting, never its value.
export class ConfigError extends Error {}

function required(env: Env, name: keyof Env): string {
  const value = env[name]?.trim();
  if (!value) throw new ConfigError(`${name} is missing`);
  return value;
}

// Service-role client. It bypasses RLS, so it is for admin, cron, sending
// messages and non-person reference data (e.g. neighbourhoods) only — never for
// reading people on behalf of a visitor (decisions.md Part 5, H11).
export function serviceClient(env: Env): SupabaseClient {
  const url = required(env, "SUPABASE_URL");
  const key = required(env, "SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
