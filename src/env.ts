// Everything the Worker receives from Cloudflare at request time.
// Values come from .dev.vars locally and from `wrangler secret put` when deployed.
// Every field is optional on purpose: a missing secret must produce a plain
// error page ("SUPABASE_URL is missing"), not a crash. For the admin, a missing
// Access setting means every admin request is refused (403).
export interface Env {
  // The Expo web export, served from the same host (M2.0). The Worker's own routes
  // run first; everything else is handed to this binding with SPA fallback.
  ASSETS?: Fetcher;
  SUPABASE_URL?: string;
  // Bypasses RLS. Server-side only; never used to read people on behalf of a
  // visitor (decisions.md Part 5).
  SUPABASE_SERVICE_ROLE_KEY?: string;
  // The publishable (anon) key. Public by design — it is in the app bundle too —
  // but it is set with `wrangler secret put` like the rest, so no key is ever in a
  // committed file. Every public page (W1-W4) reads with THIS key, so RLS decides
  // what a visitor sees (M2.1).
  SUPABASE_PUBLISHABLE_KEY?: string;
  // Signs the Test 0 session cookie. Declared now, used from T3 onwards.
  SESSION_SECRET?: string;
  // Cloudflare Access, checked by the Worker on every /admin request (M1.2).
  // The team domain, e.g. https://<team>.cloudflareaccess.com — the tokens' issuer.
  ACCESS_TEAM_DOMAIN?: string;
  // The Access application's Audience (AUD) tag.
  ACCESS_AUD?: string;
  // Comma-separated emails allowed into the admin.
  ADMIN_EMAILS?: string;
  // Ticketmaster Discovery API key (M1.3). Secret.
  TICKETMASTER_CONSUMER_KEY?: string;
  // Anthropic API key (M1.3: AI vetting and spot suggestions; T3: photo checks). Secret.
  ANTHROPIC_API_KEY?: string;
  // Mapbox Static Images token (M2.1). Secret, and NEVER in the page: the Worker
  // fetches each venue's map server-side, once, and serves it from our own origin.
  MAPBOX_TOKEN?: string;
  // Hard daily AI spend cap in US dollars, per Toronto calendar day (M1.3). Not a
  // secret: set in wrangler.jsonc "vars".
  AI_DAILY_CAP_USD?: string;
  // AI spot suggestions: "on" to enable in the nightly run and the admin. Off unless
  // exactly "on" — moved to M1.3b (spec §6). Not a secret: wrangler.jsonc "vars".
  AI_SPOT_SUGGESTIONS?: string;
}

export const spotSuggestionsOn = (env: Env): boolean => env.AI_SPOT_SUGGESTIONS === "on";
