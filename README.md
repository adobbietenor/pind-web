# pind-web

One repo for Pin'd: the Cloudflare Worker (`src/`: public pages, admin, crons), the
Expo app for iOS and web (`app/`), shared types, copy and tokens (`packages/shared/`)
and the Supabase schema (`supabase/migrations/`). npm workspaces; run `npm install`
at the root. Rules of work: `CLAUDE.md`. Spec: `spec.md`, `decisions.md`.

## Worker (staging)

The Worker is `pind-web-staging` on workers.dev. It has no routes and no custom
domains, and it is the only worker this repo ever deploys.

Requires Node from `.nvmrc`, then `npm install`.

### Run locally

1. Fill in `.dev.vars` (gitignored; never commit it):

   ```
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<pind-staging service_role key>
   SESSION_SECRET=<any long random string>
   ```

   The URL and service_role key are in the Supabase dashboard → pind-staging →
   Project Settings → API. `SUPABASE_URL` is the bare project URL, with no
   `/rest/v1` on the end. Use the **secret** key (`sb_secret_…`), not the
   publishable one. For `SESSION_SECRET`, generate one in PowerShell:

   `$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)`

2. `npx wrangler dev`, then open http://localhost:8787/health. It should show
   `neighbourhoods: 30`.

3. `npm run typecheck` checks types. Wrangler bundles `src/` itself, so there is no
   build step.

### Policy harness (RLS)

`npm run test:policies` checks who can see what, against **pind-staging only**. It
builds a throwaway cast of people, pins and gatherings with the service key, runs
every "X CAN / X CANNOT" case in `docs/visibility.md` with each person's own
session, and sweeps everything it created afterwards. It refuses to run against any
other project.

It needs `SUPABASE_PUBLISHABLE_KEY=sb_publishable_…` in `.dev.vars` as well as the
settings above, and anonymous sign-ins switched on for the project. Supabase limits
sign-ins per IP, so don't run it many times in a row. See
`docs/m1.1-review-brief.md` for what it covers.

### Set secrets on the deployed Worker

Deployed secrets are stored by Cloudflare, not read from `.dev.vars`. Each command
prompts for the value, so it never lands in shell history or a file:

```
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put SESSION_SECRET
```

`npx wrangler secret list` shows the names that are set, never the values.

On the very first deploy, run `npx wrangler deploy` before these commands: until the
secrets are set, `/health` shows "SUPABASE_URL is missing". Secrets take effect
immediately; no redeploy is needed.

### Deploy

```
npx wrangler login     # once; opens a browser
npm run deploy         # builds the app's web export, then wrangler deploy
```

The Expo web export (`app/dist`) is one of the Worker's static assets, so the two are
always deployed together: `npm run deploy` rebuilds it first. Don't run
`npx wrangler deploy` on its own. The Worker's own routes (`/health`, `/admin*`)
run first; every other path serves the app, with fallback to its `index.html`
(`assets` in `wrangler.jsonc`).

This deploys `pind-web-staging` to `https://pind-web-staging.<account-subdomain>.workers.dev`.
Check `/health` there. Never change `name` in `wrangler.jsonc`, and never add
`routes` or custom domains.

If you change `wrangler.jsonc`, rerun `npx wrangler types` and commit the
regenerated `worker-configuration.d.ts`.

## Admin (Phase 1 M1.2)

`/admin` is private to Alex. Two locks:

1. **Cloudflare Access** — a self-hosted Access application on
   `pind-web-staging.pind.workers.dev` with paths `admin` and `admin*`, policy
   "Alex only". Visitors who are not signed in never reach the Worker.
2. **The Worker checks the Access token itself** on every `/admin` request
   (`src/admin/access.ts`): signature against the team's public keys, issuer, audience,
   expiry and an email allowlist. Anything missing or wrong is a 403, including when
   the settings below are not set. Every refusal is logged with its reason and the
   token's `iss` and `aud` claims only (never the token) — read with
   `npx wrangler tail pind-web-staging`.

Admin settings (Worker secrets, never committed):

```
npx wrangler secret put ACCESS_TEAM_DOMAIN   # https://<team>.cloudflareaccess.com
npx wrangler secret put ACCESS_AUD           # the Access application's AUD tag
npx wrangler secret put ADMIN_EMAILS         # comma-separated
```

The admin reads and writes with the service key. Lifecycle and moderation actions
are `admin_*` database functions: they enforce the rules (3 approved spots to publish,
zero pins to unpublish) and write `moderation_log`.

### Staging seed (fake data)

```
npm run seed:staging               # remove any previous seed, then seed
npm run seed:staging -- --remove   # remove the seed only
```

Refuses to run unless `.dev.vars` points at pind-staging. Seeds 3 venues (one with AI
spot suggestions pending), 15 drafts from all three sources (a duplicate pair, free
events, an unmatched venue) and one published gathering with 20 fake pins, pending
photos and one report. Everything is tagged `[TEST]` / `pindseed`.

### Unit tests

`npm run test:unit` — the Access token check, CSV output and admin time conversion.
No network, no database.

## App (Phase 2 M2.0)

`app/` is the Expo Router app for iOS and the web (Expo SDK 57, pinned). Tabs:
Crowds (A5, at `/crowds`) · My Events (A19) · Connections (A20) · Profile (A21, at
`/me`). `/` belongs to the Worker on the web (W1 from M2.1), so the app's root only
redirects to `/crowds`. Design tokens, fixed copy, constants and DB types come from
`packages/shared`.

### Run locally

1. Copy `app/.env.example` to `app/.env` (gitignored) and fill in the pind-staging
   URL and **publishable** key. Only public client keys go here: the Supabase
   anon key, the Sentry DSN and the PostHog project key. Sentry and PostHog stay off
   until their keys are set, and each prints one console line saying so.
2. `npm run start --workspace app`, then scan the QR code with Expo Go (fast loop
   only) or the dev build. `npm run web --workspace app` runs it in a browser.
3. `npm run typecheck:app`.

Opening the app never creates a Supabase user. The anonymous user is created only
when someone pins in (A26), by `ensureAnonymousUser()` in `app/src/lib/supabase.ts`.

### EAS builds (iOS)

From `app/`, with `npx eas-cli@24.7.0`:

| Profile | Variant | Bundle ID | For |
|---|---|---|---|
| `development` | staging | `social.pind.app.staging` | the dev build (expo-dev-client), installed ad hoc on registered devices |
| `internal` | staging | `social.pind.app.staging` | internal TestFlight |
| `production` | production | `social.pind.app` | the App Store (M4.3 onward) |

Build environment variables (the same `EXPO_PUBLIC_*` names as `app/.env`) are set
in EAS (`eas env:set`) for the `development` and `preview` environments.
`SENTRY_AUTH_TOKEN` is an EAS secret in the same two environments, and Sentry
source maps are uploaded by the `development` and `internal` builds. `production`
keeps `SENTRY_DISABLE_AUTO_UPLOAD` until M4.3 gives it its own keys and token.
