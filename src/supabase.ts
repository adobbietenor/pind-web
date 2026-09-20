import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./env";

// A missing or empty setting. The message is safe to show on a page: it names
// the setting, never its value.
export class ConfigError extends Error {}

// The settings that are plain strings — everything in Env except the bindings.
type Setting = { [K in keyof Env]-?: Env[K] extends string | undefined ? K : never }[keyof Env];

function required(env: Env, name: Setting): string {
  const value = env[name]?.trim();
  if (!value) throw new ConfigError(`${name} is missing`);
  return value;
}

// supabase-js appends /rest/v1 itself, so a URL with a path (e.g. the dashboard's
// ".../rest/v1/") doubles it, and a count query then silently comes back empty.
export function projectUrl(env: Env): string {
  const value = required(env, "SUPABASE_URL");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError("SUPABASE_URL is not a valid URL");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new ConfigError("SUPABASE_URL must be the bare project URL (no /rest/v1)");
  }
  return url.origin;
}

// Checks the prefix only; the value is never shown.
function secretKey(env: Env): string {
  const key = required(env, "SUPABASE_SERVICE_ROLE_KEY");
  if (key.startsWith("sb_publishable_")) {
    throw new ConfigError("SUPABASE_SERVICE_ROLE_KEY is the publishable key, not the secret key");
  }
  return key;
}

// Service-role client. It bypasses RLS, so it is for admin, cron, sending
// messages and non-person reference data (e.g. neighbourhoods) only — never for
// reading people on behalf of a visitor (decisions.md Part 5, H11).
export function serviceClient(env: Env): SupabaseClient {
  return createClient(projectUrl(env), secretKey(env), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
