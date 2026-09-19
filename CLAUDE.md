# Pin'd — working rules

Read `spec.md` and `decisions.md` before doing anything in this repo. They are the
spec of record. This file is how we work.

## What this repo is

`pind-web` (may be renamed `pind`) — **one repo for the whole product** (decisions.md
Part 5, "Repo layout"; `docs/build-plan.md` §3):

    app/               Expo Router app for iOS + web (npm workspace)
    packages/shared/   generated DB types, fixed copy, constants (THRESHOLD = 5, neighbourhoods, tags)
    src/               the Cloudflare Worker: public pages W1–W4, admin, crons, AI jobs, delivery
    supabase/          migrations/, seed/, tests/ (policy harness)
    docs/              build-plan.md, visibility.md, review briefs

There is no separate `pind-app` repo. `app/` and `packages/shared/` arrived in M2.0.

## Stack (fixed — do not substitute)

- Cloudflare Workers + Wrangler for the Worker, and to serve the Expo web export
- Supabase (Postgres, RLS, Auth, Storage, Edge Functions, pg_cron) as the only data plane
- Plain HTML and CSS on the Worker's own pages. Expo + TypeScript (Expo Router) for the
  app, iOS and web from one codebase
- Resend (email), Expo Push (push), Ticketmaster Discovery API (gatherings feed),
  Anthropic API (AI jobs), PostHog and Sentry (M2.0). **No SMS, no Twilio.**

## Repo layout and commands

- npm workspaces from the repo root: `app` and `packages/shared`. Run `npm install`
  at the root only.
- The Worker's scripts are unchanged: `npm run typecheck` (now also checks
  `packages/shared`), `npm run test:policies`, `npm run test:unit`.
- The app, from the repo root:
  - `npm run typecheck:app` — typecheck `app/`
  - `npm run build:web` — `expo export --platform web` into `app/dist`
  - `npm run start --workspace app` — the Expo dev server (Expo Go or the dev build)
  - `npm run web --workspace app` — the dev server in a browser
- Shared DB types: `npm run gen:types --workspace packages/shared` after every
  migration (reads pind-staging).
- EAS, from `app/`: `npx eas-cli@24.7.0 build --profile <development|internal|production>
  --platform ios`. Profiles in `app/eas.json`; `APP_VARIANT` picks the staging or
  production bundle ID.
- **The web export is a Worker asset — never deploy one without the other.** Deploy
  with `npm run deploy`, which builds the web export and then runs `wrangler deploy`,
  releasing both together. Do not run `npx wrangler deploy` on its own: it would ship
  whatever stale `app/dist` is on disk.

## Where things live (the boundary rule — do not cross it)

If it is public, it is the Worker. If it needs a session, it is Expo. If it is
time-driven, it is pg_cron in Postgres. If it decides who sees whom, it is a policy in
Postgres (H11). If it sends anything or calls an AI, it is the Worker. Nothing is built
twice. So: **no people lists rendered by the Worker; no AI or email calls from the
app.** (spec.md §4 has the full table.)

## Expo rules

- The Expo SDK is pinned for the whole build. No native module beyond the M2.0 list
  (apple-authentication, image-picker, image, notifications, secure-store) without a
  decision from Alex.
- Expo Router; TanStack Query; Realtime through `postgres_changes` only (it respects
  RLS; broadcast does not).
- Design tokens, fixed copy and constants come from `packages/shared`, never retyped.
- Every screen names its board ID (A1–A29) in the file header and in the commit.

## AI calls

Every AI call follows the M1.3b pattern by default: **streamed, aborted outright after
four minutes, at most one retry, a per-run budget and the daily cap, and an estimate
counted for every aborted call** (its usage never arrives). Long AI work runs in its
own cron, not inside the nightly import.

## The spec

- Screens have IDs: **W1–W4** (the Worker's public pages) and **A1–A29** (the Expo
  product, iOS and web). T1 is an off-product artifact (the fan-channel post).
- Every prompt, branch name and commit message names the screen ID it implements.
  Example: `git commit -m "A26: quick pin as an anonymous user"`.
- The milestones and their order are spec.md §6; each milestone's acceptance list is in
  `docs/build-plan.md` §8.
- If the spec is ambiguous or silent, **ask me**. Do not invent product behaviour.
- The eleven UX calls (Q1–Q11) and the eleven hard rules (H1–H11) in `decisions.md`
  are binding. If an implementation seems to require breaking one, stop and say so.

## Database

- Schema changes are **only** ever a new migration file created with
  `npx supabase migration new <name>`, committed to this repo.
- **Never** run ad-hoc DDL against the database. **Never** change schema in the
  Supabase dashboard. A schema I cannot reproduce from this repo is a broken repo.
- Apply with `npx supabase db push` to **staging only**. Never touch production.
- RLS is enabled on every table. Visibility is decided by policies in the database,
  never by filtering in Worker or app code (H11).
- The `service_role` key is used only by the Worker and Edge Functions, never by the
  app, and never appears in a file that is committed.

## Tests

- Before writing any surface that displays people, write or extend the policy harness
  in `tests/policies`. Run it. It must pass.
- The harness creates users, pins, crews, blocks and connections in staging and
  asserts what each user can and cannot read.
- `test:policies` must gain a case for **every migration touching `can_see_at`,
  blocks, women-only, solo, review-only, hidden people or Instagram handles**.
- No UI tests. They are not worth the hours on this project.

## Data

- **Never run seeds against production.** Seed rows are tagged and live on staging only.
- The service key never reads people on behalf of a visitor.
- Review-only rows are the only non-real data allowed anywhere, and only on production
  for App Review (H6).

## How we work through milestones

- One milestone per branch, one session per milestone. **The milestone's acceptance
  list is the session's first message**; end the session by walking it on the phone.
- Before coding, for anything involving a **policy**: explain in plain English what it
  allows and denies, and wait for my confirmation.
- Before coding, for anything with a **lifecycle** (pins, crews, threads,
  confirmations): list the states and what moves the object between them, and wait.
- Work is done when the acceptance list passes **on a real phone**, not when the code
  looks right. Say "ready to check on device", do not declare it finished.
- **Structure and plumbing first, UI after**, in every milestone. First prove the
  data, keys, policies, delivery and builds end to end on a real device; screens come
  after. UI-first once produced an app that looked finished and didn't work. The
  empty M2.0 shell surfaced three real bugs: keys missing from the web bundle, PostHog
  events never flushing, and wrong device-registration steps. Each would otherwise have
  surfaced during the M3.6 dogfood walk.

## Dependencies

- Versions are pinned: the Node version in `.nvmrc`, exact versions in `package.json`,
  the Expo SDK in `app/`.
- Do not upgrade anything mid-milestone. Upgrades happen deliberately, between phases,
  when I ask.
- Do not add a dependency without asking first.

## Keep the Worker lean

The Worker's public pages (W1–W4) are pasted into Reddit threads and must load in
**under a second** inside a Reddit tab. **No framework, no component library, no
Tailwind, no build step, no client-side router** for the pages the Worker renders.
Plain CSS only. (The Expo app has its own build; its web export is served as static
assets behind these pages and never replaces them.)

The dark, on-brand look is allowed (decisions.md Part 5, "Look"): near-black
background, purple `#582883`, white text, the logo inline, system fonts — or one web
font with a system fallback, only if it doesn't hurt load time.

## Secrets

- Never commit a key. `.env`, `.dev.vars` and `node_modules` are gitignored.
- Worker secrets go in with `npx wrangler secret put NAME`, never in `wrangler.jsonc`.
- The Anthropic key, the Resend key, the Expo push access token and the database
  webhook secret live in the Worker. **Nothing secret goes in the app bundle; the
  only keys it may contain are public client keys — the Supabase anon key, the
  Sentry DSN and the PostHog project key.** Locally they live in `app/.env`
  (gitignored; `app/.env.example` lists the names); EAS builds read them from EAS
  environment variables.
- If you need a credential I have not provided, ask — do not stub a fake one and
  carry on.

## Things that are mine, not yours

Account creation, the Supabase and Cloudflare dashboards, Apple Developer console,
App Store submission, buying domains, and testing on a physical phone. Tell me when
one of these is the next step rather than trying to work around it.

## Database & visibility rules (Claude Code owns these; Alex reviews outcomes, not SQL)
- All schema/policy changes are migration files applied with the Supabase CLI to pind-staging only. Never edit the dashboard. Never touch production without Alex saying so.
- Before writing any policy or visibility function, explain in plain English who can see what and who can't. Wait for Alex's OK.
- Every visibility rule ships with a test proving both: the right person CAN see, and the wrong person CANNOT.
- Photos live in a private bucket, served only by short-lived signed URLs after the visibility check.
- Instagram handles are optional and never a substitute for the photo. They are visible **only** to the person's crewmates, their solo-plan partner and their connections — never on the open "going & open to meeting" list, never on a public page, never in a link preview (H2; solo's mutual accept). Enforced in the database with harness cases in M3.1 (`docs/visibility.md` V17).
- The service key is used server-side only, for admin, cron jobs, AI jobs and sending messages, and never to read people on behalf of a visitor. People lists are always read as the signed-in person, so RLS policies decide visibility.
- There is no WhatsApp Test 0 (decisions.md Part 5, "Build direction"). What replaced its rules:
  - A pin needs a first name and the 19+ tick, nothing else, and creates a Supabase anonymous user (A26). Opting in to meeting (A27) needs date of birth, gender, a face photo and a permanent identity (email code, Apple or Google), linked to the same user id (decisions Part 5, "Identity"; Q2).
  - Notifications are the five in spec A18: push to the app, mirrored by email (Resend) for people without a device token. SMS is never used (Q8).
  - RLS policies and their harness cases are built and pass before any screen that shows people (M3.2 onward).
- Flag anything touching visibility for the independent review before real users see it.
