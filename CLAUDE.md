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
- **Within each milestone: data and rules first, then the screen, built properly.**
  The front end is the most important part of this product. Flow, usability and look
  must be genuinely good, because people judge the crowd page in one second from a
  Reddit tab. This is not "all plumbing first, all UI later", and never "good enough
  for now". The failure to avoid is a screen built before the data underneath can
  answer its questions: a mock-up that gets rebuilt. So each milestone first proves
  its data, policies, keys and delivery on a real device, then builds its screens to
  finished quality.
- **W2, A10 and A26 carry the first impression** (the crowd page, the pinned crowd
  page, quick pin) and get real design attention. Plain screens, such as My Events,
  can stay plain.
- Why it matters: the empty M2.0 shell surfaced three real bugs — keys missing from
  the web bundle, PostHog events never flushing, wrong device-registration steps.
  Each would otherwise have surfaced during the M3.6 dogfood walk.

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

**Everything a public page loads comes from our own origin.** No image, font, script,
style or data from a third-party host — not Supabase storage, not a CDN, not a font
service, not a tile server. If an asset is needed, the Worker fetches it server-side
and serves it from pind.social, or it is inlined.

Why, measured in M2.1: the same 157 KB image took **911 ms** from Supabase storage and
**133 ms** from pind.social. Identical bytes. The difference is one extra connection —
a DNS lookup, a TCP handshake and a TLS handshake — before a single byte of the asset
moves. On a phone on mobile data that setup costs more than most assets do, and it is
paid per host, so two hosts is two of them. On a page with a one-second budget it is
the whole budget.

It also keeps every promise in one place: no third party gets the visitor's IP, the
referring Reddit thread, or a cookie, on a page that needs no account.

**Check this from a browser, not from the source.** A Cloudflare zone setting can
inject a third-party script into a page the Worker rendered, without touching the
repo: M2.1 found `static.cloudflareinsights.com/beacon.min.js` on every crowd page,
from Web Analytics' automatic setup, when the HTML the Worker sends references no
script at all. Loading the page in a real browser and listing its requests is the only
way to see that; reading the template is not.

**A missing Worker route does not 404 — it silently serves the wrong app** (Alex,
M2.3). `/community` came back as the Expo web export's own `index.html` with a **200**,
because anything not in `run_worker_first` is answered by the assets binding and its
single-page fallback. So a route that was never wired up looked like a working page of
the wrong application rather than like an error, and Cloudflare then cached that
response for the URL. **Any new public route goes into `run_worker_first` in
`wrangler.jsonc` in the same commit as the route itself, and the check is loading it in
a browser — never trusting the router.** The same applies to a route you delete: the
path keeps answering 200 with the app.

## A visitor is never the thing that does the work

**No page may depend on a stranger's first view to produce what the next view needs.**
M2.1 fetched each venue's map picture in `waitUntil` when a crowd page found none: the
page fell back and the picture was made for whoever came second. That is a safety net,
and by M2.3 it was the only thing that ever rendered anything — so **29 of the 37
venues behind a published gathering had no map**, and every one of those pages showed a
drawing, or nothing, to the first person who opened it. Which is exactly the person
arriving from a fresh Reddit post.

The pattern to keep: a job renders it ahead of time (the nightly run, right after
publishing), the fallback stays as a net, and **the admin counts what is still
missing**. "Never fetched" leaves no failure record at all, so it is the state nothing
notices unless something counts it — unset is a different state from broken, one layer
down.

## An instrument that is wrong in a way that looks like a finding

The worst failure is not a check that breaks. It is a check that **answers
confidently and wrongly**, because nothing about it looks like a fault — it sends
someone to fix a thing that is not broken, and it keeps sending them.

M3.1: the admin panel built to answer "do the two halves of the webhook secret
match?" fingerprinted the Worker's value **trimmed** and the database's value
**untrimmed**. The secret was stored with a newline round it, so the same secret
produced two different fingerprints, and the panel reported the difference between
**its own two rulers** as a difference between the secrets. Alex set both halves to
one value three times and was told three times that he had not. The instrument never
failed. It just was not measuring the same thing on both sides.

**So: when two values are compared, both sides are normalised identically, at the
point of comparison — and the comparison is tested with a pair that differs only in
whitespace.** That test is three lines and would have caught this in seconds. It
applies to any equality that crosses a boundary: two fingerprints, two cache keys, two
slugs, an email typed twice, a header against a secret.

Two things that make this failure mode hard to see from inside, both worth knowing:

- **It hides a real fault while impersonating it.** Underneath the false reading there
  *was* a genuine bug — the trigger sent the untrimmed secret as an HTTP header, and a
  header value cannot hold a newline, so it was mangled in transit. The Worker's "these
  do not match" was honest about what arrived and silent about what was stored. A wrong
  instrument pointing at roughly the right place is the hardest thing to disbelieve.
- **Normalise at the point of comparison, not before storing.** The whitespace was left
  in the stored secret on purpose, and the panel now says it is there. Silently
  cleaning a value on the way in destroys the evidence that something upstream is
  adding it.

## A guard that never ran looks exactly like a guard that passed

The sibling of the rule above, and the harder one to catch. An instrument that
measures the wrong thing at least *says* something wrong. **A guard that never fires
says nothing at all** — and so does a guard that correctly found nothing to stop.
The safe path and the broken path report the same thing.

M3.1: `admin_rescore_photo` exists so that re-judging photos after a rubric change
**never overrules a person**. Its guard looked up the last decision with
`like 'photo\_%'` — one backslash too many, a literal backslash in a
standard-conforming string, matching nothing. Every photo looked undecided. The first
real run overwrote four photos Alex had rejected by hand minutes earlier and signed
them `ai:photo-check`. Nothing errored. No count moved. Every line of output said
"now approved", which is exactly what it would have said if the guard had worked.

**So a rule whose job is to refuse something is proved by a test that makes it
refuse — never by an absence of complaints.** The test has to put the forbidden thing
in front of the guard and insist it is turned away. `P81` is the shape: a human
decision, then a rescore, then an assertion that the status did not move.

Two things that follow, both cheap and both easy to skip:

- **Check the boundary from both sides.** A cap proved only by the thing it allows is
  a cap nobody has seen work. P77 asserts the eleventh tag is refused *and* that
  removing one makes room again.
- **Watch for a guard nothing can even load.** The tag picker's "that's ten" refusal
  lived inside a React Native component, so `node --test` could not reach it and
  nothing proved it fired — a refusal that exists *specifically* so a tap never
  silently does nothing, with nothing checking that it speaks. It moved to
  `packages/shared` for the same reason `ageOn` did: **a rule is not a component
  detail just because a component is the only thing that calls it.**
- **Audit by reading the tests, not by remembering them.** Asked which guards lacked a
  firing test, I named the publisher's capacity floor — and it has four, including
  both sides of the boundary. Confidently wrong about my own coverage is the same
  failure as the instrument above, pointed inward.

## A test of a rule proves nothing about a screen that does not call it

The third sibling. A guard that never ran says nothing; **a rule that was tested and
then not used says "passed"** — about a function nobody asked.

M3.1: the tag limits moved into `packages/shared` precisely so they could be tested,
and T01–T09 proved them. Both tag screens then gated Continue on an expression of
their own — `picked.length > 0 && !enoughPicked(picked)` — whose "none is fine"
exception no test ever saw, so Continue worked with no tags while the suite was green.
The eleventh-tap refusal was produced exactly as T03 said, and shown above all 32
chips, off-screen from the tap. Alex walked into both on the phone.

**So: a rule extracted into shared code is not in force until every caller uses it,
and the test that proves it must be one that fails when a caller goes its own way.**
`tests/unit/screens.test.ts` is the shape: it reads the route files and fails if a tag
screen gates on anything but `tagsCanContinue`, if the sign-in screen checks the
platform instead of `methodsFor()`, or if a screen draws its own frame instead of
`AppScreen`. Run against the old code, each one failed on exactly the fault walked.

- **Where a rule has two copies across a boundary, compare them** — normalised the same
  way, per the instrument rule. P88 checks the app's `photoShowsToOthers` against the
  database's `can_see_photo` for every status; I09 checks the types the app uploads
  against the types the Worker's check can read; C04 checks `wrangler.jsonc`'s crons
  against the ones the code routes.
- **"Seen" is part of a refusal.** A sentence rendered where the person is not looking
  is a tap that silently does nothing. Put the message where the tap was.

## Measure what the phone does, not what the server sent

A fast server response is not a fast page. M2.1 hit the same one-layer-down gap three
times in one milestone: a 92 ms server response with a 911 ms image behind it, an
immutable cache header on a Worker response that Cloudflare was not storing, and a
third-party script that the HTML never mentioned. Each looked right from the terminal.
Before claiming a page is fast, load it in a browser, list every request with its
size, and run Lighthouse — and compare against a page with nothing on it, so the
number has a floor to be read against.

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
- **A missing credential must report itself once, as a configuration problem — not as
  N identical runtime failures, and never silently.** M2.1's venue maps returned early
  when `MAPBOX_TOKEN` was unset, before the code that records why a map failed, so the
  one failure most likely to happen on day one was the one failure nothing logged. The
  admin now says "MAPBOX_TOKEN is not set" once, where maps are managed, instead of
  either saying nothing or listing seventy-four identical venue errors. Check this for
  every secret a feature depends on: unset is a different state from broken, and it
  belongs in front of whoever can fix it.

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
