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
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
npx wrangler secret put SESSION_SECRET
npx wrangler secret put MAPBOX_TOKEN
```

`SUPABASE_PUBLISHABLE_KEY` is the anon key. It is public by design — the app bundle
carries it too — but it is set here like the rest so no key is ever in a committed
file. **Every public page (W1-W4) reads with this key**, never the service key, so
RLS is what decides what a visitor sees.

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

## Public web layer (Phase 2 M2.1)

The pages a Reddit link lands on. Plain HTML from template strings and plain CSS —
no framework, no build step — because they have to open inside Reddit's in-app
browser in under a second.

| Route | What |
|---|---|
| `/` | W1, this week's crowds, grouped by day and ordered by date |
| `/g/<slug>` | W2, the crowd page before you pin: facts, the generated map, counts, the house rules, one button |
| `/g/<slug>/spot` | W3, the share card: gathering, spot, time |
| `/g/<slug>.ics` | add to calendar |
| `/og/<slug>.png` | W4, the link preview image — no counts, ever |
| `/map/<venue>-<key>.webp` | the venue map, fetched once from Mapbox and served from here |
| `/venue-map/<venue>-<hash>` | the uploaded map override, also served from here |
| `/.well-known/apple-app-site-association` | universal links, both bundle IDs |
| `/about`, `/robots.txt`, `/favicon.svg` | the footer's page, and the two small files |

Everything else falls through to the Expo web export, so `/g/<slug>/pin`, `/crew/<id>`
and `/me` are app routes on the same host.

All of it reads two database functions, `public_gatherings` and `public_gathering`,
with the publishable key. "On the public web" — published, not withdrawn, not seeded,
carrying a slug — is defined there and nowhere else.

### The logo

```
npm run brand      # brand/*.svg -> src/public/brand.ts
```

Strips the C2PA metadata blob (7.7 KB of `logo.svg`'s 14.5 KB), swaps the hard-coded
fill for `currentColor`, and composes the mark-and-wordmark lockup the header and the
OG image use. `brand/` is never modified. **The lockup is provisional and Tatiana's to
change**: no such lockup has ever been designed, so `CAP_HEIGHT` and `GAP` at the top
of `scripts/build-brand.ts` are the whole layout.

### The link preview image

`src/public/og.ts` draws the card as an SVG; `src/public/ogpng.ts` rasterises it with
`@cf-wasm/resvg`, the Worker's only wasm dependency. Cloudflare Images will not convert
SVG to raster, so this has to happen in the Worker. The two Poppins faces are imported
as bytes (the `Data` rule in `wrangler.jsonc`) rather than fetched, so a link preview
never depends on an outside CDN.

Workers block dynamic WebAssembly compilation, so the module is on every route's cold
start whether or not `/og/` is hit. Measured on the deployed Worker: startup **8 ms ->
10 ms**, bundle 288 KB gzipped -> 1.37 MB, the image about 410 ms of CPU and cached a
day at the edge. If that ever needs re-checking, `wrangler deploy` prints
"Worker Startup Time" on every deploy.

### The venue map

`src/public/venuemap.ts` and `mapserve.ts`. One picture per venue: streets and
buildings around it, fetched once from Mapbox with `MAPBOX_TOKEN` (a Worker secret,
never in the page), stored in the `venue-maps` bucket, and served from **our own
origin** — the visitor's browser never talks to Supabase.

Everything with meaning is HTML over the image: the venue, each spot, its name, its
walking minutes, the north arrow, and a tap target that opens **walking directions in
the phone's own maps app**. So approving a spot later changes the page without
re-fetching anything. A spot outside the frame keeps its list entry and says it is not
on the map.

Both URLs are content-addressed and served `immutable`: correcting a venue's
coordinates mints a new key, so the page asks for a new URL and the old one is never
requested again. Nothing needs purging.

Failures land in `venue_map_renders`, are counted on the admin's venue list, and stop
after three attempts. "Fetch the map again" on a venue is the deliberate retry.

### The schematic map (the fallback)

`src/public/map.ts` draws the venue and its meeting spots from their coordinates — a
schematic SVG with walking minutes, a north arrow and a scale bar. No tiles, no API
key, nothing to fetch. A spot's coordinates and an optional walk-minutes override are
entered on the venue screen in the admin; a spot without coordinates is still listed by
name. An uploaded image on the venue overrides the drawing.

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
photos and one report. Everything is tagged `[TEST]` / `pindseed`, and every row
carries `is_seed`, which is what actually keeps it off the public pages — **seed rows
are invisible to every visitor, signed in or not** (`docs/visibility.md` V18). They are
still fully visible in the admin, which reads with the service key. So the public pages
on staging show only gatherings you have really published.

### Unit tests

`npm run test:unit` — the Access token check, CSV output, admin time conversion, and
the public layer's pure parts (the generated venue map, walking minutes, the OG card).
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
