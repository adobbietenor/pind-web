// What the Worker needs to be configured, in one list (Phase 2 M2.2).
//
// CLAUDE.md's rule, learned the hard way twice in M2.1 and once more when the
// nightly import stopped for two nights: a missing credential must report itself
// once, as a configuration problem, in front of whoever can fix it — not as N
// identical runtime failures, and never silently. **Unset is a different state from
// broken**, and this file is what makes that difference answerable in one look
// instead of inferred from a failure.
//
// Nothing here ever reads a value. Presence, emptiness and absence are the three
// states; the value is never logged, rendered or returned.
//
// It takes a plain record rather than `Env` so the unit tests can load it under bare
// node: Env names the ASSETS binding, which drags Cloudflare's globals in and they
// collide with Node's. src/admin/config.ts holds a compile-time assertion that every
// name below is a real Env setting, so the two cannot drift.
export type Settings = object;

export type SecretState = "set" | "empty" | "missing";

export interface SecretCheck {
  name: string;
  state: SecretState;
  required: boolean;
  what: string; // what stops working without it
}

// `required` means the Worker cannot do its job without it. The rest degrade: the
// feature is off, and the panel says so where it can be turned on.
const NEEDED = [
  { name: "SUPABASE_URL", required: true, what: "Every page and every job. Nothing works without it." },
  { name: "SUPABASE_SERVICE_ROLE_KEY", required: true, what: "The admin, the import, the publisher and every AI job." },
  { name: "SUPABASE_PUBLISHABLE_KEY", required: true, what: "The public pages W1–W4 read with this key, so RLS decides what a visitor sees." },
  { name: "ACCESS_TEAM_DOMAIN", required: true, what: "The admin. Without it every /admin request is refused." },
  { name: "ACCESS_AUD", required: true, what: "The admin. Without it every /admin request is refused." },
  { name: "ADMIN_EMAILS", required: true, what: "The admin. Without it nobody is allowed in." },
  { name: "TICKETMASTER_CONSUMER_KEY", required: true, what: "The nightly import. Without it no new gatherings arrive and the city's list stops refreshing." },
  { name: "ANTHROPIC_API_KEY", required: false, what: "AI scoring, and the photo check. Without it new drafts stay unscored and every uploaded photo stays pending, visible to nobody." },
  { name: "PHOTO_WEBHOOK_SECRET", required: false, what: "The photo check's database webhook. Without it the webhook refuses every call and photos are only checked when the app asks." },
  { name: "MAPBOX_TOKEN", required: false, what: "Venue maps on the crowd page. Without it a map cannot be fetched (M2.1)." },
  { name: "RESEND_API_KEY", required: false, what: "Operational alerts. Without it a failed nightly run is recorded and shown here, but reaches nobody." },
  { name: "ALERT_EMAIL", required: false, what: "Where operational alerts go. Without it there is nowhere to send them." },
  { name: "ALERT_FROM", required: false, what: "Who alerts come from. Defaults to alerts@pind.social." },
  { name: "SESSION_SECRET", required: true, what: "The quick pin on the web (A26). Without it nobody can pin from a crowd page: the Worker cannot seal the visitor's session to hand to the app." },
] as const satisfies readonly { name: string; required: boolean; what: string }[];

export type SecretName = (typeof NEEDED)[number]["name"];

function stateOf(env: Settings, name: string): SecretState {
  const value = (env as Record<string, unknown>)[name];
  if (value === undefined || value === null) return "missing";
  if (typeof value !== "string" || value.trim() === "") return "empty";
  return "set";
}

export function checkSecrets(env: Settings): SecretCheck[] {
  return NEEDED.map((n) => ({ name: n.name, required: n.required, what: n.what, state: stateOf(env, n.name) }));
}

// The ones that are required and are not there. Empty counts: a secret set to an
// empty string lists in `wrangler secret list` exactly like a real one and fails at
// the first `.trim()`, which is a state worth naming separately.
export function missingRequired(env: Settings): SecretCheck[] {
  return checkSecrets(env).filter((c) => c.required && c.state !== "set");
}

// True when alerts can actually be sent. Both halves are needed: a key with nowhere
// to send is as dark as no key.
export function alertsConfigured(env: Settings): boolean {
  return stateOf(env, "RESEND_API_KEY") === "set" && stateOf(env, "ALERT_EMAIL") === "set";
}

// "Pin'd alerts <alerts@pind.social>" -> "pind.social". Lives here, with the other
// settings helpers, so the unit tests can reach it without loading Env.
export function domainOf(from: string | undefined): string {
  const address = /<([^>]+)>/.exec(from ?? "")?.[1] ?? from ?? "";
  return address.split("@")[1]?.trim().toLowerCase() ?? "";
}
