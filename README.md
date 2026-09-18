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
