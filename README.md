# pind-web

The Cloudflare Worker serving Pin'd's public web surfaces, plus the shared Supabase
schema in `supabase/migrations/`. Rules of work: `CLAUDE.md`. Spec: `spec.md`,
`decisions.md`.

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
npx wrangler deploy
```

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
