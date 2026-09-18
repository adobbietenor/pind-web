# Pin'd — working rules

Read `spec.md` and `decisions.md` before doing anything in this repo. They are the
spec of record. This file is how we work.

## What this repo is

`pind-web` — the Cloudflare Worker serving every public web surface (Test 0 crowd
pages, the crowds landing, the +1 claim page, the `/spot` share card, the next-day
survey, admin), plus the shared Supabase schema in `supabase/migrations/`.

The iOS app lives in a separate repo (`pind-app`, Expo) and reads the same database.

## Stack (fixed — do not substitute)

- Cloudflare Workers + Wrangler for all web surfaces
- Supabase (Postgres, RLS, Auth, Storage, Edge Functions, pg_cron) as the only data plane
- Plain HTML and CSS on the Worker. Expo + TypeScript in the app repo
- Twilio (SMS), Resend (email), Ticketmaster Discovery API (gatherings feed)

## The spec

- Screens have IDs: **T1–T10** (Test 0 web) and **A1–A25** (iOS app).
- Every prompt, branch name and commit message names the screen ID it implements.
  Example: `git commit -m "T3: pin-in form with photo upload and session cookie"`.
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
- No UI tests. They are not worth the hours on this project.

## How we work through milestones

- One milestone per branch, one session per milestone. I paste the milestone's
  acceptance list at the start of the session.
- Before coding, for anything involving a **policy**: explain in plain English what it
  allows and denies, and wait for my confirmation.
- Before coding, for anything with a **lifecycle** (pins, crews, threads,
  confirmations): list the states and what moves the object between them, and wait.
- Work is done when the acceptance list passes **on a real phone**, not when the code
  looks right. Say "ready to check on device", do not declare it finished.

## Dependencies

- Versions are pinned: the Node version in `.nvmrc`, exact versions in `package.json`,
  the Expo SDK in the app repo.
- Do not upgrade anything mid-milestone. Upgrades happen deliberately, between phases,
  when I ask.
- Do not add a dependency without asking first.

## Keep the Worker plain

The Test 0 pages are deliberately styling-free: system fonts, one purple button
(`#582883`), no framework. **No component library, no Tailwind, no build step, no
client-side router.** These pages are pasted into Reddit threads and must load in
under a second. If a page needs more than 100 lines of CSS, something has gone wrong.

## Secrets

- Never commit a key. `.env`, `.dev.vars` and `node_modules` are gitignored.
- Worker secrets go in with `npx wrangler secret put NAME`, never in `wrangler.toml`.
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
- Photos live in a private bucket, served only by short-lived signed URLs after the visibility check. Instagram handles get the same check as photos.
- Test 0 pin-in accepts EITHER an uploaded photo OR an Instagram handle; at least one is required.
- Test 0 threshold and follow-up messages go by email (Resend) first; SMS (Twilio) is added later as a second channel.
- Phase 1: the Worker uses the service key server-side only, and people lists come from one SQL visibility function, never filtered in Worker code.
- Flag anything touching visibility for developer review before real users see it.
