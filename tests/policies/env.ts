// Settings for the policy harness, read from .dev.vars via `node --env-file`.
// The harness writes and deletes rows, so it refuses to run anywhere but pind-staging.

// pind-staging's project ref (not a secret). Never production.
export const STAGING_REF = "mxuajvlrkggrqpntekqt";

function read(name: string): string {
  // A file saved with a byte-order mark puts it in front of the first key.
  const value = (process.env[name] ?? process.env[`﻿${name}`])?.trim();
  if (!value) throw new Error(`${name} is missing from .dev.vars`);
  return value;
}

export interface HarnessEnv {
  url: string;
  publishableKey: string;
  secretKey: string;
}

export function loadEnv(): HarnessEnv {
  const url = new URL(read("SUPABASE_URL"));
  if (url.hostname !== `${STAGING_REF}.supabase.co`) {
    throw new Error(
      `Refusing to run: SUPABASE_URL is not pind-staging (${STAGING_REF}). The harness only ever touches staging.`,
    );
  }
  const publishableKey = read("SUPABASE_PUBLISHABLE_KEY");
  const secretKey = read("SUPABASE_SERVICE_ROLE_KEY");
  if (!publishableKey.startsWith("sb_publishable_")) {
    throw new Error("SUPABASE_PUBLISHABLE_KEY must be the publishable key (sb_publishable_…)");
  }
  if (secretKey.startsWith("sb_publishable_")) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is the publishable key, not the secret key");
  }
  return { url: url.origin, publishableKey, secretKey };
}
