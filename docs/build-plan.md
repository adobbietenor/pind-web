<!-- Copied from the claude.ai artifact https://claude.ai/artifact/4SQL5MZSVDQFMmfmXRvEAq (rev 2, 18 September 2026). This file is the repo copy that Claude Code sessions read; if the artifact is revised, replace this file. -->

# Revised Build Plan — one product, Expo and the Worker

18 September 2026, revision 2 · For Alex · Replaces "Build Plan from the Wireframes" (same day, earlier) · Inputs: spec.md and decisions.md as of Phase 1 M1.3, the research assessment (rev 2), the wireframe board, the Test 0 & App build brief · Hours are agent-assisted and calibrated to the first two days of building · No calendar dates; two pace scenarios instead

Contents

1.  [0 · Summary](#sum)
2.  [1 · What changed, and the pace](#changed)
3.  [2 · Worker, Expo, Postgres — and the Reddit link](#where)
4.  [3 · Repo](#repo)
5.  [4 · The funnel](#funnel)
6.  [5 · Solo crew and App Review](#solo)
7.  [6 · Auto-publishing](#publish)
8.  [7 · Measurement](#measure)
9.  [8 · The milestones](#plan)
10. [9 · Before the first real crowd](#beta)
11. [10 · Risks and open decisions](#risks)
12. [11 · Edits for Claude Code](#edits)
13. [12 · Working method](#method)

## 0 · Summary

**The shape.** One product, built in Expo for iOS and web, on the database, policies and admin you already have. The Worker keeps three jobs and no more: the public front door (this week's crowds, the crowd page, the share card — the links that get pasted into Reddit), the operator (admin, the nightly import, the AI jobs, auto-publishing, sending push and email), and the hand-off into the product. The first real crowds run on the *web* version plus email, with TestFlight for anyone who wants push. The App Store comes after the first crowds have shown you what to fix, ahead of the summer crowd season.

**The numbers.** About **115–165 hours** of your time to the first real crowds and **140–200 to the App Store**, in seventeen milestones across four phases. Two days of Claude Code work delivered what the previous plan priced at 60–70 hours, so this plan prices database and Worker work at roughly 40% of the old numbers and app screens and on-device work at roughly 60%. Apple's calendars (Beta App Review for external TestFlight, App Review) are not compressible and sit outside those hours. At 8 hours a week the first crowds land in the Leafs and Raptors season; at 15 a week, before the holiday lull. Either way the store lands before the Jays, Budweiser Stage and the festival weekends — the months the assessment says are the richest.

**Where I push back, then defer.** (1) Ask for the face photo when someone *opts in to meeting*, not when they pin: a pin without a photo is honest and useful (it is a body in the count), and the photo is worth requiring only at the moment a stranger would see it. (2) Let a pin happen with no account: a Supabase anonymous user that becomes a real account (email code, Apple or Google) at opt-in, keeping the pin. (3) Solo crew will win the raw comparison by construction — it opens at 2, crews at 5 — so the beta must compare per opted-in person against a rule written down now, or it will tell you what you already decided.

**What decides the order.** The riskiest untested thing is not code; it is whether strangers convene without a host. So the crew loop is built and dogfooded before anything that only matters at scale. Automated spots, the adaptive publishing loop and the Community & free sourcing run sit just before or just after the first crowds, not before the loop.

**115–165 h**to the first real crowds, on web + email + TestFlight

**140–200 h**to the App Store

**17**milestones, each checkable on a phone

**5 → 20**gatherings auto-published a week, growing with demand

**2 modes**crews and solo, measured per opted-in person

### The milestones at a glance

| \#   | Milestone                                   | What you can check on a phone when it's done                                                           | Hours   |
|------|---------------------------------------------|--------------------------------------------------------------------------------------------------------|---------|
| M2.0 | Repo + Expo scaffold                        | Four dark tabs on your iPhone and in Safari; one internal TestFlight build installed                   | 6–8     |
| M2.1 | Public web layer on pind.social             | A Reddit-ready crowd page with a generated map; this week's crowds; the share card; the domain live    | 8–12    |
| M2.2 | Auto-publishing v1 (fixed target)           | Five gatherings published a week without a click; Alex withdraws what's wrong                          | 4–6     |
| M3.1 | Identity and profile                        | Sign in three ways; a photo checked by AI within a minute; delete account works                        | 12–16   |
| M3.2 | Crowds, pins, the funnel, links             | Link → pinned in 30 seconds; opt in → see the other person at 2; the link opens the app when installed | 12–18   |
| M3.3 | Crews, thread, the night, the morning after | The whole loop with five test accounts, including "I'm here" and a mutual "we met"                     | 20–28   |
| M3.4 | Solo crew                                   | Opt-in, a proposal, a mutual accept, a two-person plan with the same thread and check-in               | 8–12    |
| M3.5 | Safety and the five notifications           | Report and block from every surface; five moments arrive by push and, for web people, by email         | 10–14   |
| M3.6 | Dogfood                                     | The three of you walk the loop on staging on two phones and a laptop; the fix list is closed           | 6–8     |
| M4.1 | Policy, terms, operations                   | Privacy policy and terms live; moderation rota and incident scripts written                            | 4–6     |
| M4.2 | Adversarial review of the visibility rules  | Leaks fixed as migrations; harness green including solo cases                                          | 4–8     |
| M4.3 | Production project + external TestFlight    | A real person can sign up on pind.social; Beta App Review passed                                       | 6–8     |
| M4.4 | Community & free sourcing                   | A weekly run fills its own admin tab; one community gathering is published                             | 8–12    |
| M4.5 | Metrics + adaptive publishing on            | A metrics page in the admin; the controller logs a weekly decision                                     | 6–8     |
| —    | The first real crowds                       | 6–8 weeks; 2–3 seeded gatherings a week; a decision meeting against §7                                 | ~2/week |
| M5.1 | Store readiness                             | Listing, labels, manifest, EULA, a review-only gathering the reviewer can use end to end               | 8–12    |
| M5.2 | M1.3b automated spots                       | Spot pools that rank themselves; user suggestions pass an automated check                              | 10–14   |
| M5.3 | Submission and rejections                   | Approved; Android from the same code when you choose                                                   | 4–8     |

Two pace scenarios. At 8 h/week: first crowds after 14–21 weeks, the store 3–5 weeks of work later plus Apple's calendar. At 15 h/week: first crowds after 8–11 weeks. The assessment's seasonality note applies: 20 December to 5 January is dead for crowds, so if the first crowds would land in that fortnight, start them in the second week of January instead of pushing through.

## 1 · What changed, and what the first two days tell us about pace

| Previous plan (same day, earlier)                                       | This plan                                                                                 | Why                                                                                                                                                                 |
|-------------------------------------------------------------------------|-------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Two products: a WhatsApp-and-email Test 0, then an iOS app if it passed | One product in Expo for iOS and web; the first real crowds run on it                      | Decided (decisions Part 5, "Build direction"). It also removes Twilio, WhatsApp, the +1 claim page, magic-link sessions and the two Test 0 messages from the build. |
| Gatherings typed in by hand; three spots required to publish            | Nightly Ticketmaster import with AI vetting (built); spots optional; auto-publishing next | Built in M1.2–M1.3. Alex will not have time for manual entry, and pins must concentrate.                                                                            |
| Alex approves photos, spots and publishing                              | AI does the work; Alex removes mistakes                                                   | Decided ("Automate by default").                                                                                                                                    |
| Crews only                                                              | Crews, plus an opt-in solo mode measured separately                                       | Decided, as a narrow exception to H2 and H5 with guardrails.                                                                                                        |
| Plain white Test 0 pages                                                | Dark, on-brand public pages                                                               | Decided ("Look").                                                                                                                                                   |
| Two repos (pind-web, pind-app)                                          | One repo, `app/` as a workspace                                                           | §3.                                                                                                                                                                 |
| 235–320 hours                                                           | 140–200 hours                                                                             | Calibrated to what two days produced.                                                                                                                               |

### Calibration, and where it can still be wrong

The old plan priced the schema, the RLS policies and harness, an admin, and a feed import at roughly 60–70 hours. Two days of Claude Code produced all of that plus AI scoring, flags, merging, withdrawal, a photo queue and a CSV export. The lesson is not "everything is 3× faster"; it is that database and Worker work with a precise spec goes very fast, and that the spec-first method (screen IDs, decisions.md, the harness) is the reason. So:

- **Database, Worker, cron and AI jobs** are priced at about 40% of the old plan's hours.
- **Expo screens and anything checked on a device** are priced at about 60%. Screens are volume; agents write them well from the board; but every acceptance item below is a real-phone check, and those take the same minutes they always did.
- **Apple configuration** (bundle IDs, Sign in with Apple, associated domains, EAS credentials, push keys) and **App Review calendars** are not discounted at all. Budget an evening for each configuration item the first time it bites.

The three places the estimate is most likely to slip: the anonymous-to-permanent account link on iOS Safari (M3.2), the Realtime thread's lifecycle on two platforms (M3.3), and photo capture in the web build on iOS (M3.1). Each has a fallback named in its milestone.

## 2 · Where things live: Worker, Expo, Postgres — and how a Reddit link becomes a crew

**One rule decides the boundary.** If it is public, it is the Worker. If it needs a session, it is Expo. If it is time-driven, it is pg_cron in Postgres. If it decides who sees whom, it is a policy in Postgres (H11). If it sends anything or calls an AI, it is the Worker. Nothing is built twice.

| Surface or job                                                                                                                                                                  | Lives in                                                              | Why there                                                                                                                                                                                                                   |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| This week's crowds (public list), the crowd page before you pin, the `/spot` share card, the OG image for link previews, the universal-link file, PindScene.com redirect        | **Worker** (HTML from template strings, dark look)                    | Must load in under a second inside a Reddit tab, work with no account, and be indexable. Reads counts through the anon key and RLS, never the service key.                                                                  |
| Admin, draft queue, venues and spots, moderation queues, metrics page, publishing panel                                                                                         | **Worker** behind Cloudflare Access                                   | Built. Moves from workers.dev to pind.social/admin in M2.1.                                                                                                                                                                 |
| Nightly Ticketmaster import, AI vetting, auto-publishing fill, the weekly adaptive adjustment, the Community & free discovery run, spot suggestions (M1.3b)                     | **Worker cron**                                                       | Built or planned there; the Anthropic key already lives there; M1.3b's streaming-and-abort lessons apply to every AI call.                                                                                                  |
| Delivering push and email                                                                                                                                                       | **Worker cron** every 5 minutes, reading `notification_queue`         | The database decides *what* (a trigger enqueues when opt-ins reach 5, a crew changes state, a date changes); the Worker decides *how* (Expo Push API for devices, Resend for web-only people). One place to retry, one log. |
| The AI photo check                                                                                                                                                              | **Worker endpoint** called by a database webhook on the new photo row | The app uploads and inserts; the check is asynchronous with a pending state (V6); the decision lands in `moderation_log` with actor `ai:photo-check`.                                                                       |
| Pin in, opt in, complete profile, photo upload, the reciprocal list, crews, solo, the thread, "I'm here", the morning after, connections, My Events, settings, report and block | **Expo** — iOS app and web build, one codebase                        | Everything with a session. The web build is the complete product, not a preview: the first real crowds run on it.                                                                                                           |
| Crew live/done/dissolve, thread close and delete, keep-in-touch expiry, pin deletion, Ticketmaster data purge, metrics snapshots                                                | **pg_cron**                                                           | Time-driven and keyed off the effective end; no app or Worker code path can forget to run them.                                                                                                                             |
| Reciprocity, blocks, women-only, hidden people, solo visibility, review-only gatherings                                                                                         | **RLS policies** + `private.can_see_at`                               | H11. The harness is the test suite; the adversarial review is the audit.                                                                                                                                                    |

### Hosting the web build

The Expo web export ships as the Worker's static assets on the *same host*. The Worker renders its own routes first (`/`, `/g/<slug>`, `/g/<slug>/spot`, `/og/*`, `/admin*`, `/hooks/*`, `/.well-known/*`, `/health`); everything else falls through to the app's `index.html` with single-page-app fallback, so `/g/<slug>/pin`, `/crew/<id>`, `/me` and the rest are app routes. One domain, one `wrangler deploy`, one universal-link file, no CORS, and the shared link is always the crowd page. The alternative — `app.pind.social` — doubles the universal-link setup and adds a second deploy for no benefit.

### The Reddit link, step by step

1.  **A post in r/leafs** carries `pind.social/g/leafs-bruins` and an honest count in its title. For the first weeks someone on the team writes that post (1–1.5 hours per seeded gathering, 2–3 a week — see §10); later, pinners share the page themselves.
2.  **Reddit and Discord fetch the OG tags.** The Worker serves a dark, branded image: event, date, venue, "See who's going, meet them there." No counts in the image, because a preview is cached at post time and a stale number would be a dishonest one (H6). Counts live in the post title and on the page.
3.  **Tap.** iOS checks the `apple-app-site-association` file on pind.social. App installed → the app opens straight onto that crowd page (A8). Not installed → Safari loads the Worker page in under a second: facts, the generated map (venue and spots, never people), counts, the three house rules, one button.
4.  **"Pin in — I've got a ticket"** goes to `/g/leafs-bruins/pin`, which is the Expo web app. The first load costs about another second on LTE; that is fine — the person has already decided. **Measured in M2.1, and it is more than a second:** the holding route pulls **828 KB** (688 KB of JavaScript, 145 KB of fonts) and scores **37** on Lighthouse mobile — FCP 5.8 s, LCP 7.3 s, TBT 1,270 ms — against the crowd page's **99** at 78 KB. M3.2 owns making the step after the crowd page survive that, since it is the conversion step. First name, who's coming, "I'd like to meet up", 19+ → pinned. Under the hood a Supabase anonymous user was created and the pin is a real row under RLS. Thirty seconds, no account, no photo.
5.  **If they ticked "meet up"**, one screen more: date of birth (under 19 stops here), gender, a face photo, and a way to reach you — email code, or Apple/Google. The anonymous user becomes a permanent one; the pin stays attached because the user id does not change.
6.  **From here the web app is the product:** the reciprocal list at 2, crews at 5, solo at 2, the thread, "I'm here", the morning after. Push needs the app, so web people get the same five moments by email. "Get the app" is offered once, when crews open — the first moment push is worth having.
7.  **Later, with the app installed**, every shared crowd link opens in the app. Reddit's in-app browser does not always honour universal links; that is one more reason the web build must be the complete product rather than a landing page.

## 3 · Repo: an `app/` folder inside pind-web

**Recommendation: one repo, `app/` as an npm workspace.** Rename the repository to `pind` whenever convenient (GitHub redirects the old name). Reasons, in order of weight:

- **The contract is shared.** spec.md, decisions.md, CLAUDE.md, docs/visibility.md, the migrations and the policy harness govern both halves. In one repo, a Claude Code session building screen A10 can read the policy that makes A10's list appear and the harness case that proves it. Two repos turn every schema change into two pull requests and a copied types file, and the copy drifts.
- **Types and fixed copy are generated once.** `supabase gen types` output, the house rules, the threshold constant (5), the neighbourhood list and the tag list live in `packages/shared` and are imported by the Worker and the app. Spec §5 ("copy that is fixed") becomes a module, not a rule to remember.
- **The web build ships with the Worker.** The Expo web export is the Worker's static assets, so one deploy releases both — and the deployment rules you have already learned the hard way (the `name` field, CLI only) keep applying to one thing.
- **EAS builds from a workspace.** Expo documents monorepos; it is an evening of Metro `watchFolders` config in M2.0, once.

&nbsp;

    pind-web/  (→ pind)
      app/               Expo Router app for iOS + web: app/(tabs)/…, components/, lib/supabase.ts
      src/               the Worker (today's code; move to worker/ only if it ever gets in the way)
      supabase/          migrations/, seed/, tests/ (policy harness)
      packages/shared/   generated DB types, fixed copy, constants (THRESHOLD = 5, neighbourhoods, tags)
      docs/              visibility.md, review briefs, m1.3b notes
      spec.md  decisions.md  CLAUDE.md  wrangler.jsonc  package.json (workspaces)

When would a separate repo be right? Only if a second team ever owns the app. That is not the situation, and it is easy to split later; it is painful to merge later.

## 4 · The funnel: where sign-in happens, and where I'd push back

The decided direction says: accounts, a required face photo with an automated check, a profile. Read literally for someone who tapped a link at 9pm, that is an install, three sign-in options, a date of birth, a camera, an AI check, a neighbourhood, three tags and three explainer cards before the first pin. The board's own note on Q2 says a hard photo step halves conversion from a Reddit tab; Test 0's escape hatch (an Instagram handle) is gone with Test 0. I agree with requiring the photo. I disagree with *when*, and with treating the App Store onboarding as the only door.

#### Push-back 1 — charge for a thing at the moment it buys something

A pin buys a count. Counts are public, honest and useful to everyone, including people who never opt in (H6, Q10). A pin needs no photo and no account to be true. Opting in to meeting buys visibility: that is the moment a stranger will see your face and the moment we need to reach you when crews open. So the photo, the date of birth, gender and the contact belong at opt-in, not at pin. Nothing in the hard rules requires them earlier: H3 is about seeing people, and reciprocity is enforced in the database either way.

#### Push-back 2 — let the pin happen with no account, and keep it

Supabase anonymous sign-in (already on for staging) gives a real JWT, so RLS applies from the first tap. When the person opts in, the same user is linked to an email (one-time code) or to Apple/Google; the user id is unchanged, so the pin, the party size and the opt-in survive. There is no magic link to build and no session to re-establish — a code works on any device. This is the same "account" the direction asks for; it simply arrives in two steps.

#### Push-back 3 — neighbourhood and three tags are not a gate

Tags are conversation handles, not match criteria (A3). On the link path, make neighbourhood optional and tags a nudge afterwards ("add 3 tags so your crew has something to say"). Keep "exactly 3" as the rule for what a complete profile looks like, not as a wall between a person and their first pin.

### Two doors, one product

| Door                                 | Sequence                                                                                                                                                                     | Time to first pin                      |
|--------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------|
| **Link path** (most people at first) | Crowd page (Worker) → Pin in: first name, who's coming, "I'd like to meet up", 19+ → Opt in (only if ticked): DOB, gender, photo, contact → one safety sheet → crews or solo | ~30 s to pinned; ~90 s more to visible |
| **Store path** (after launch)        | Install → A1 sign in → A2 you → A3 neighbourhood + tags → A4 three cards → This week's crowds → pin in one tap                                                               | ~90 s, as the board designed           |

### What each step asks, and why there

| Step         | We ask                                                                                                                                                                                        | Why here and not earlier                                                                                                                                                                                                                                   | Risk to watch                                                                                                                         |
|--------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------|
| Pin          | First name · alone / +1 / +2 / a group · "I'd like to meet up with others going" (unticked) · "I'm 19 or older"                                                                               | It is a declaration, and the count is the product's public promise. The 19+ tick is the H8 attestation; the DOB hard stop comes at opt-in.                                                                                                                 | Opt-in rate. The assessment expects ≥50%; if it is far lower with the box unticked, test a pre-ticked box on one crowd and record it. |
| Opt in       | Date of birth (hard stop under 19) · gender (woman / man / nonbinary / prefer not to say; nonbinary offers women-only inclusion) · a face photo · email code, or Continue with Apple / Google | Visibility and reachability start here. Gender is needed for women-only crews and the mix chip (Q3, H7). Web people can only be told "crews are open" by email — this replaces Q8's email-or-phone with email-or-a-login-that-gives-an-email. SMS is gone. | The photo step. Measure pinned → opted in → photo approved, and the AI check's rejection and false-positive rates from day one.       |
| Later nudges | Neighbourhood · 3 tags · "get the app for push" (once, when crews open)                                                                                                                       | None of these change what a stranger can see or whether we can reach you.                                                                                                                                                                                  | —                                                                                                                                     |
| Never        | Phone number (until abuse forces OTP) · Instagram handle · location · contacts                                                                                                                | Decisions Part 4.                                                                                                                                                                                                                                          | —                                                                                                                                     |

Two more consequences. A person who pins and never opts in is a body in the count and nothing else; their anonymous user is deleted with their pin 30 days after the gathering. And the A4 cards collapse, on the link path, into one sheet at opt-in: *crews are 3–8 people at a public spot before the event; leave any time; block and report are two taps away; women-only crews on every gathering.* The "19+ · no location, ever · not a dating app" line is already in the crowd page footer; A1 keeps it for the store path.

Sign in with Apple is required in the app because Google is offered there (Apple's rule); on the web, offer the email code and Google first and add Apple later if you want it — it needs a Services ID and a return URL and is not worth an evening before the first crowds.

## 5 · Solo crew: the design inside the guardrails, and what App Review will ask

**The case against, stated once.** The assessment's record on 1:1 platonic meeting is not mixed; it is negative (Pie pivoted to groups because 1:1 "failed to take", Bumble BFF's 1:1 was lacklustre, the Toronto attempts died), "meet a stranger alone" is exactly the case the safety floor was designed to exclude, and any product that shows strangers 1:1 gets evaluated as a dating app — in the fan thread and by App Review. There is also a quieter problem: solo opens at 2 and crews at 5, so at a gathering with four opted-in people solo can happen and crews cannot, and the person who accepts a 1-on-1 is one fewer for the crew. The decision is made and it is a reasonable one — the beta exists to find out — so the job here is to build it so that it cannot quietly become the product, and to measure it so that the answer is real.

### The design, guardrail by guardrail

| Guardrail (decisions Part 5)                                                                           | Implementation                                                                                                                                                                                                                                                                                                                                                                                    |
|--------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Opt-in, off by default, separate from the crew opt-in, with a clear prompt explaining groups vs 1-on-1 | A second toggle on the *pinned* crowd page, below the crews section, labelled by what it is ("Meet 1-on-1" — "solo crew" stays the internal name). Tapping it opens a sheet: what it is, that it is optional, that meetings happen only at the venue's public spots, that you choose who can see you. Never in onboarding, never in the Monday digest, never in the store listing or screenshots. |
| Visible only to others who also opted in at the same gathering                                         | `pins.solo_opt_in`. A new branch of `private.can_see_at`: both solo-opted at the gathering, neither blocked, the target not hidden from solo, and the target's visibility choice allows the viewer. The "1-on-1" section of the crowd page renders only for solo-opted people; the crew list is untouched.                                                                                        |
| People can limit who sees them (for example, women only)                                               | `pins.solo_visibility`: *everyone who opted in* or *women only* (gender = woman plus `include_in_women_only`). A forced choice on the opt-in sheet, not a default — one extra tap is the right price.                                                                                                                                                                                             |
| Contact only by mutual accept; before that one preset message from a short list; no free-text chat     | A **proposal** is a spot from the venue's list, a time, and one line chosen from five presets (Tatiana writes the final five; e.g. "Meet at \[spot\] at \[time\] and walk in together?"). The recipient accepts or declines; a decline sends nothing (as Q4). Accept creates a **solo plan**.                                                                                                     |
| Meet only at the venue's public spots                                                                  | The picker is the spot list. There is no address field anywhere in the product, so there is nothing to misuse.                                                                                                                                                                                                                                                                                    |
| Block and report two taps away; a report hides the person from solo mode immediately                   | The same A24 sheet. Any report, whatever the reason, sets `people.hidden_from_solo` at insert — stricter than H9's two-report rule for the rest of the product. Block is mutual invisibility everywhere, as now.                                                                                                                                                                                  |

### One implementation trick that keeps this narrow

A solo plan is a **crew with `kind = 'solo'`**: exactly two seats, created by accept rather than by request, invisible to everyone but its two members. Everything else is inherited unchanged — the thread and its lifecycle (Q11), "I'm here" with the required one-liner (Q7), live and done transitions, the mutual "we met", keep-in-touch and the "showed up" badge (Q6), report on any message, and every policy and harness case that already exists for crews. H5's "3–8" becomes a rule for `kind = 'crew'`; the exception is one column, easy for the adversarial reviewer to find and for you to switch off with one flag. Limits: three open proposals per person per gathering, one per pair, all expiring at the gathering's start. A person may be in one crew and one solo plan at the same gathering — they are not exclusive, and the pair often meets fifteen minutes before joining a crew at the same spot.

### What Apple's App Review is likely to ask

| Guideline or practice                               | What they look for                                                                                                   | Your answer, prepared in the review notes                                                                                                                                                                                                                                                                                                                            |
|-----------------------------------------------------|----------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1.2 User-generated content                          | Filtering, a report mechanism with timely response, blocking, published contact details, an EULA with zero tolerance | The AI photo check and message reports; A24 two taps from everywhere; auto-hide per H9; a human within 24 hours; support address on pind.social; terms with the zero-tolerance clause.                                                                                                                                                                               |
| 2.1 A working demo                                  | A reviewer account and a path through everything the app does, including the reciprocal list, a crew and a thread    | A **review-only gathering** with review-only members that real users can never see (a `review_only` flag and matching policies). This preserves H6 — nothing fabricated is ever visible to a real person — while giving the reviewer a crowd that has already reached 5.                                                                                             |
| Age rating                                          | The 2025 questionnaire's tiers; an app arranging in-person meetings of strangers rates 18+                           | 18+, consistent with the 19+ gate and the DOB hard stop.                                                                                                                                                                                                                                                                                                             |
| 4.8 Login services · 5.1.1 Data · 5.1.1(v) Deletion | Sign in with Apple when Google is offered; minimal data; in-app account deletion; privacy labels and manifest        | All present by M3.5; the manifest and labels are written in M5.1.                                                                                                                                                                                                                                                                                                    |
| 4.3(b) Saturated categories (dating)                | The risk is a reviewer who reads "1-on-1 meetups" as a dating app                                                    | The listing, screenshots and notes lead with gatherings and crews; solo is opt-in and unmentioned in the listing. Notes explain: 19+, public spots only, no location, no DMs, mutual accept, block and report, women-only. If a rejection cites 4.3 or "dating", the fallback is a server flag that ships the store build with solo off while the web beta keeps it. |
| Safety questions about in-person meetings           | Reviewers sometimes ask what protects users                                                                          | The house rules, verbatim, and the fact that the product's job finishes before the event starts (H10).                                                                                                                                                                                                                                                               |

None of this applies to the web build, which is where solo is measured first.

## 6 · Auto-publishing that adapts to demand

**Why a loop at all.** The import creates 700+ drafts. Publish them all and a hundred early users spread across hundreds of pages; nothing reaches five and the city looks empty. Publish five and pins concentrate, but a city with 250 arena dates a year and hundreds of mid-size shows cannot run on five forever. The number of published gatherings *is* the spread, so the number should follow the evidence: grow when published gatherings fill, hold or shrink when they don't. The mechanism below is a thermostat, not a model — deliberately, because it has to be legible in the admin and correct with sparse data.

### Settings (on the `cities` row, never in code)

| Setting                           | Start          | Meaning                                                                                      |
|-----------------------------------|----------------|----------------------------------------------------------------------------------------------|
| `publish_target_weekly`           | 5              | How many gatherings should be published per calendar week of start dates                     |
| `publish_min` / `publish_max`     | 3 / 20         | Floor and ceiling for the target                                                             |
| `publish_lead_days_min` / `_max`  | 4 / 21         | Publish a draft only if it starts within this window; nearer first                           |
| `max_per_venue_per_week`          | 2              | A Jays homestand does not fill the week                                                      |
| `community_slots_weekly`          | 1              | Reserved for a "Community & free" gathering above its own threshold (from M4.4)              |
| `score_floor`                     | 70             | Final score (AI score minus distance adjustment) below which a draft is never auto-published |
| `grow_reach` · `grow_median_pins` | 0.60 · 8       | Both must hold to grow                                                                       |
| `shrink_reach`                    | 0.30           | Below this, shrink                                                                           |
| `step_up` · `step_down`           | +2 · −1        | The most the target can move in one week                                                     |
| `adaptive`                        | off until M4.5 | Alex can freeze the target at any time                                                       |

### Two jobs

**Nightly fill** (inside the import run). For each of the next three weeks, count published gatherings starting that week. If below the target, publish the highest-scoring eligible drafts until it is met: inside the lead window, at or above the score floor, not dismissed by Alex, not withdrawn, at most two per venue per week, one slot held for a community gathering when the community run has a candidate. Drafts Alex has marked "publish" go first regardless of score; drafts marked "never" are skipped forever. Every choice is logged with its score, distance and the slot it filled, and shown on the admin's Publishing panel. Alex withdraws (any time) or unpublishes (zero pins) whatever is wrong.

**Weekly adjust** (Monday's run, before the 6pm digest). Look at gatherings that ended in the trailing 14 days and had been published at least 7 days before they started (so a late publish does not count as a failed one). Compute `reach_rate` — the share whose open-to-meeting count reached 5 by the effective end — and `median_pins`. Then:

- `reach_rate ≥ 0.60` and `median_pins ≥ 8` → target + 2
- `reach_rate < 0.30` → target − 1
- otherwise → hold
- clamp to `publish_min … publish_max`; if fewer than 3 gatherings qualify in the window, hold; log the decision and its inputs

### A worked example

| Week | Published (target) | Ended in trailing 14 days | Reach rate | Median pins | Decision       |
|------|--------------------|---------------------------|------------|-------------|----------------|
| 1–2  | 5 (5)              | none yet                  | —          | —           | hold (no data) |
| 3    | 5 (5)              | 5 (2 seeded)              | 0.40       | 6           | hold           |
| 4    | 5 (5)              | 10                        | 0.60       | 9           | grow → 7       |
| 5–6  | 7 (7)              | 10–12                     | 0.55       | 8           | hold           |
| 7    | 7 (7)              | 12                        | 0.67       | 11          | grow → 9       |
| 9    | 9 (9)              | 16                        | 0.25       | 5           | shrink → 8     |

The feedback delay is real — a gathering published two weeks ahead is judged three weeks after it was chosen — which is why the steps are small and asymmetric. The loop cannot oscillate faster than the calendar, and a bad fortnight costs one gathering, not five.

### Cold start, skew, and what could go wrong

- **Week one has no evidence.** The target starts at 5 and Alex marks the two or three the team will seed in fan channels as "publish"; the rest are the importer's top picks. The first weeks measure whether unseeded gatherings gather any pins at all — an honest and important number, shown seeded/unseeded side by side in the admin.
- **Seeded gatherings will carry the metrics early.** Unseeded ones will drag `reach_rate` down and the target will sit at the floor of 3 until the city starts populating itself. That is the intended behaviour: the loop measures whether the buzz is real, and the floor keeps the list from disappearing.
- **Diversity is a rule, not taste.** Crews need different kinds of crowds to learn which sizes work (assessment §4.3). The per-venue cap and the community slot are the minimum; add a per-category cap (sports / music / club night / community) if the queue skews.
- **A faster signal exists** — pins per day since publishing — and it rewards the seeded ones. Leave it out of v1; add it as a leading indicator in a v2 once a season of outcomes exists.
- **Off-sale is not a problem.** A sold-out Leafs game is the best gathering in the city. Nothing here reads ticket availability.

## 7 · Measuring crews against solo

**Source of truth.** SQL views in Postgres over pins, crews, confirmations, check-ins, reports and the after-event answer, read by a Metrics page in the admin. Pins are deleted 30 days after a gathering, so a pg_cron job writes a `gathering_stats` row at the effective end + 24 h and again at + 72 h (after keep-in-touch expiry); the row is what survives. PostHog carries the in-app funnel events (page → pin → opt-in → photo approved) and Sentry carries crashes on both halves. Nothing about a person's gender leaves the aggregate.

**The one number** is unchanged from the assessment: **Met** — people who mutually confirmed they met, per week — now split by mode. Everything else explains it.

| Metric             | Crews                                                                                                                                       | Solo                                                        | Counted from            |
|--------------------|---------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------|-------------------------|
| Opt-in rate        | crew-opted ÷ pinned                                                                                                                         | solo-opted ÷ pinned (and both ÷ pinned)                     | pins                    |
| Opened             | gatherings that reached 5 crew opt-ins                                                                                                      | gatherings with ≥ 2 solo opt-ins                            | counts                  |
| Plan formed        | crews reaching *spot set* ÷ gatherings that reached 5; dissolve rate                                                                        | accepted plans ÷ proposals; proposals per solo-opted person | crews, proposals        |
| Showed up          | "I'm here" ÷ members of set crews                                                                                                           | same, per plan                                              | check-ins               |
| **Met**            | people with ≥ 1 mutual "we met" ÷ crew-opted people                                                                                         | people with a mutual "we met" ÷ solo-opted people           | confirmations           |
| Women's share      | of pinned, of opted-in, of met                                                                                                              | same                                                        | aggregate only          |
| Safety             | reports per 100 opted-in; auto-hides; incidents and hours to first human action                                                             | same                                                        | reports, moderation_log |
| Repeat             | pinners who pin a second gathering within 6 weeks                                                                                           | same, for solo-opted people                                 | pins                    |
| Cannibalisation    | crew reach rate and crews-set rate at gatherings with solo activity vs without; share of solo-opted people who also joined a crew           |                                                             | crews × pins            |
| Attendance created | "Would you have gone alone anyway?" — one question in the after-event screen for everyone opted in (yes / no / I wasn't going to go at all) |                                                             | after-event answers     |

**Measure the crew mechanic split by gathering size** (Alex, after the community pass). It does different work at each end of the range, and the same numbers will hide that. At an arena a crew is **how you find anyone at all among 18,000**. At a twelve-person run club the gathering is already the meeting, and a crew is closer to *"who is getting coffee after"* — which Frontrunners does already, without us. Same machinery, different job. **Not a reason for two products** (decisions.md, "One list, one product"), but a reason to watch: the pre-meet may be the wrong shape for small gatherings even where the reveal is exactly right. So every §7 figure — reach rate, crews formed, meetups confirmed — is read split by the size of the gathering, not pooled.

### Pass criteria for the first crowds, fixed now

Adapted from the assessment's Test 0 criteria, over 6–8 weeks of seeded and unseeded gatherings: ≥ 20 pins at each seeded stadium-scale crowd and ≥ 8 at each mid-size one; opt-in (either mode) ≥ 50% of pinners; a spot and time set at ≥ 60% of gatherings that reached 5; Met ≥ 3 at ≥ 2 gatherings; women ≥ 35% of pinners; repeat ≥ 25%; every report acted on by a human within 24 hours. Miss two and the finding is the assessment's: reveal does not convene itself — stop building and decide what Pin'd is instead. Pass and the store submission proceeds.

### The solo decision rule, pre-registered

Evaluate after at least 20 published gatherings reached 5 opted-in people, comparing *per opted-in person* — raw counts favour solo by construction because its threshold is lower.

- **Keep it and start mentioning it** if solo Met per opted-in ≥ crews' Met per opted-in, *and* reports per 100 solo-opted ≤ crews', *and* women are ≥ 30% of solo-opted people, *and* crew reach rate is not lower where solo is active.
- **Keep it quiet** (as it is now) if it produces meetings but fails one of the safety or gender tests.
- **Turn it off** if reports per 100 exceed twice the crew rate, or any incident traces to a solo plan and was handled badly.

## 8 · The milestones — to the first real crowds, then to the store

Each milestone is one branch and one Claude Code session with its acceptance list pasted at the top; it merges when a real phone shows the list working. Hours are yours, agent-assisted. Screen IDs are the board's; new screens are numbered on from A25 and W1–W4 for the Worker pages (§11 renames the T-screens).

### Phase 2 — The public layer and publishing, on the Worker (18–26 h)

6–8 h

#### M2.0 · Repo and Expo scaffold

**Goal.** One repo that builds both halves, and an app shell on your phone before any product code, so Apple's configuration pain is paid early and once.

- npm workspaces: `app/`, `packages/shared/` (generated types, fixed copy, `THRESHOLD = 5`); Node pinned by `.nvmrc`; the Expo SDK pinned for the whole build.
- Expo Router with four tabs (Crowds · My Events · Connections · Profile); design tokens (purple `#582883`, Poppins headlines bundled, system body font, dark default, light follows the system); supabase-js client with anonymous sign-in; TanStack Query; Sentry; PostHog. No native modules beyond: apple-authentication, image-picker, image, notifications, secure-store.
- Web export served from the Worker's static assets with SPA fallback; the Worker's own routes rendered first.
- EAS project, iOS credentials, bundle IDs for staging and production; one internal TestFlight build from the cloud so the Windows laptop can build too; the Mac for the simulator.
- CLAUDE.md and spec.md updated with the layout and commands (§11).

**Acceptance**

- The app opens on your iPhone (dev build) to four dark tabs in brand, and stays dark in both system settings (Light and Dark). Light mode was dropped by Alex in M2.0 (decisions Part 5, "Dark only").
- The same shell loads in mobile Safari at the staging hostname, and a deep path like `/me` loads it too (SPA fallback works).
- An internal TestFlight build installs and opens.
- From the repo root: typecheck, `test:policies` 55/55 and `test:unit` 55/55 still pass; `app` typechecks.

8–12 h

#### M2.1 · The public web layer on pind.social, in the dark look

**Goal.** The pages a Reddit link lands on, on the real domain, fast enough and legitimate-looking enough to survive a fan thread. This is where auto-generated maps arrive, because a map that needs an upload per venue is manual work per event.

- **W1 This week's crowds** (was T9): published gatherings by day, ordered by date, honest counts including zero, "crews open at 5", the community ones marked; footer: suggest a gathering (mailto), about, 19+.
- **W2 Crowd page, pre-pin** (was T2): facts, the generated map, counts and mix (mix only at 5+), the three house rules verbatim, the one button ("Pin in — I'm going" when `is_free`), footer. If a signed-in session exists in this browser, a small script swaps the button to "Open" — the page still works with JavaScript off.
- **W3 Share card** (`/g/<slug>/spot`): gathering, spot, time; no names, no join link.
- **W4 Link machinery**: OG tags and a generated OG image per gathering (no counts); `/.well-known/apple-app-site-association` with the app's IDs; an `.ics` route for "add to calendar".
- **Generated venue map**: a schematic SVG drawn by the Worker from the venue's and spots' coordinates — the venue, each spot with its name and walking minutes, a north arrow, a scale bar — cached at the edge. No tiles, no API key, nothing to load, nothing but the building and its spots (H1). Upload stays as the optional override.
- pind.social on Cloudflare; the Worker routed to it; Cloudflare Access re-created for `pind.social/admin*`; PindScene.com redirects; Resend domain records added now so email is ready for M3.5.

**Acceptance**

- `pind.social` lists the week by day in the dark look and loads in well under a second on LTE (Safari's reload feel), and **one Lighthouse mobile run on a crowd page scores FCP ≤ 1.7 s with TBT 0 ms** (Alex, M2.1).

  *Why that number and not "under 1.0 s".* Lighthouse's mobile preset simulates about 150 ms of round-trip time, so connection setup alone spends most of a second before a byte of HTML moves. Measured on the same Chrome, same run: `/about` — 20 KB, no image, no script — scores **FCP 1.5 s**, and `pind.social/` scores **1.5 s**. **1.5 s is the preset's floor, not our page.** The crowd page, with the map, scores **99/100, FCP 1.6 s, LCP 1.6 s, TBT 0 ms, 78 KB across four requests**. Under 1.0 s is not reachable by any page on that preset, so the original wording described a target nothing could meet; the real-world question is answered by the reload feel and by the 92 ms server response. The first run against this line returned 67, which was measured on `/g/<slug>/pin` — the Expo app route, 828 KB — not on a crowd page.
- `pind.social/g/<slug>` shows facts, the map with venue and spots and no people, counts, the house rules word for word, the right button for a free gathering, and the footer.
- Pasting the link into iMessage and a Discord test server shows a dark branded card with the event name and no numbers.
- `/g/<slug>/spot` shows spot and time only.
- A withdrawn gathering's public page shows a short neutral "no longer on Pin'd" and no counts.
- `pind.social/admin` asks for the Access PIN; the workers.dev admin is gone.
- Safari never asks for location on any page.

4–6 h

#### M2.2 · Auto-publishing v1 — fixed target

**Goal.** Remove the publish click now, with the loop's settings and logging in place, so the adaptive rule in §6 can be switched on in M4.5 without new plumbing.

- Settings on the `cities` row; the nightly fill in the import run; per-venue cap; lead window; score floor; "publish" and "never" marks in the draft queue; a Publishing panel in the admin listing each choice with its reasons; the weekly adjust written but gated by `adaptive = off`.
- Unit tests for the fill rules; a harness case that a draft cannot be published twice or after dismissal.

**Acceptance**

- After a nightly run, exactly the target number of gatherings are published per upcoming week (unless the queue is short), with no venue above two.
- Marking a draft "publish" gets it published next run regardless of score; marking one "never" keeps it out for good.
- Withdrawing a published gathering does not lead the next run to re-publish the same draft.
- The Publishing panel explains every choice in one line.

**Settled during M2.2** (decisions.md, "Decided in Phase 2 M2.2"): the re-publish guard is `slug is null`, so unpublishing is as final as withdrawing and only Alex undoes either; refusals are logged and shown, not only choices; "seeded" is a `gathering_promotions` row ticked at the moment of posting, never inferred from `publish_mark`, with the forgotten-tick bias running against us; and the weekly adjust reads live pins with the 14-vs-30-day dependency asserted in code and in a check constraint, keeping its raw inputs for M4.5 to check the repoint against.

4–6 h

#### M2.3 · The list at fifty a week (W1)

**Why its own milestone.** M2.2 raised the target from 5 to 50, and a list of fifty is a different screen from a list of five. Two things make it usable, and both are W1 work with a schema question behind them rather than anything in the publisher — so they do not belong on M2.2's acceptance list, and W1 is a first-impression page that gets real design attention rather than a bolt-on (CLAUDE.md).

- **Today / tomorrow split.** At this volume there is reliably something under both, which is the whole point of the lead minimum being 0.
- **Category filter chips** — sports, concerts, bars, clubs, community — **multi-select**, so sports *and* concerts, or community *and* bars. **A filter that narrows, never a sort that reorders**, so it cannot become a ranking by the back door (Alex, M2.2). Unfiltered is the default. Server-rendered as links with query parameters: no client-side JavaScript, no framework, nothing that costs the one-second budget inside a Reddit tab.
- **The schema question, first.** A gathering has no category column today; the classification sits in `gathering_sources.snapshot`. It has to be a real column, exposed through `public_gatherings` — the public web reads through one door (M2.1, H11) — and mapped to the five names deliberately, because Ticketmaster's segments are Music, Sports and Arts & Theatre and none of them is "bars" or "community".
- **Two tabs: Events and Community** (Alex, walking the community pages). Already in the data and needing no editorial call per gathering: **Events is the Ticketmaster feed, Community is everything sourced by hand or by M4.4**, and `source` says which. **Chips filter within a tab, not across both** — which also answers the "Live music holds 87% of the list" problem, because the useful chips differ per tab: Events wants live music / sport / comedy, Community wants take part / markets. Unfiltered within a tab stays the default.
- **Filter by venue and by neighbourhood, alongside the categories** (Alex, M2.2). Venue needs no new data; neighbourhood comes from the venue's coordinates against the list in `packages/shared`. The same rule applies — filters narrow, they never reorder. And the reason it matters beyond convenience: a cap is a crude way of stopping one venue dominating the list *for everybody*, whereas a filter lets a reader dominate their own list on purpose. As filtering lands the caps should get looser, not tighter.
- **Two chips have no source until M4.4.** Nothing in the Ticketmaster feed is a bar or a community gathering, so "bars" and "community" are empty until the Community & free run exists. Decide what an empty category does — hidden, or shown greyed — before building the chips, and treat this as an argument for M4.4 being close.

**Acceptance**

- The landing page opens on today and tomorrow with something under both, and still loads in under a second on a phone.
- Tapping two chips shows the union of those two categories and nothing else; the order of what remains is unchanged from unfiltered.
- No chip is shown for a category nothing can fill.

**Built in M2.3** (spec §6, "Phase 2 M2.3"; decisions "Decided in Phase 2 M2.3"). What the milestone settled, and what it left:
- The schema question is answered: `category` is a real column, filled for every Ticketmaster gathering from its own classification by one rule in the database, set once at draft and never overwritten. It had been null on all 49 published Events rows, so the Events tab had no chips at all.
- The five chips are the eight of the community pass, split across two tabs on `source`; a chip is counted from the rows on the page, so it can never filter to an empty one. "Bars" and "clubs" were never built: the feed cannot tell a DJ night from a gig (decisions, after the community pass).
- **Deferred, with Alex's agreement: the venue and neighbourhood filters.** Neighbourhood has no data behind it — the 30 rows carry a name and a sort order, no coordinates and no boundaries — so it needs a geo pass of its own. Venue is free from today's data and is about an hour whenever it is wanted.
- **The finding this milestone leaves on the table: comedy.** 51 listings in the queue, 20 inside the lead window scoring 25–60 against a floor of 60, and not one ever published — so the chip is correctly hidden and a whole category is silently refused. The Publishing panel now says so for every category. Fixing the rubric is a measured pass of its own (spec §6, M2.3).

### Phase 3 — The product, in Expo (68–96 h)

12–16 h

#### M3.1 · Identity and profile (A1–A3 store path; A21–A23 skeleton; the AI photo check)

**Read `docs/m3.1-handover.md` first.** Phase 2 made decisions that bind this milestone —
the reciprocal list already works at two people, V17 is stricter than the schema is
today, the house rules were rewritten, the threshold never leads on any screen, the tag
seed is one-way, and the photo check's AI spend has to land where the daily cap can see
it. The handover is the short version so the session does not rediscover or contradict
any of it.

**Goal.** A person exists, can be reached, has a checked face, and can delete themselves — on both platforms — before any of that is exposed to anyone.

- Sign in: Apple and Google native in the app, Google and the email code on the web; anonymous sign-in for the link path; anonymous → permanent linking (updateUser with email, linkIdentity for OAuth) with the pin surviving.
- A2 you: DOB with the under-19 hard stop and year-only storage; gender (nonbinary offers women-only inclusion) into `people_private`; face photo to the private bucket with a pending state.
- The photo check: database webhook → Worker → Claude vision → approve / reject / queue, each written to `moderation_log` as `ai:photo-check`; a rejected photo leaves the person visible without one (V6). Fallback if the webhook is flaky: the app calls the Worker directly after upload with its JWT.
- A3 neighbourhood + tags (optional on the link path); A21 self profile with preview; A22 other-person profile shell; A23 with export and delete account.

**Acceptance**

- All three sign-in methods work in the app; email code and Google work on web; there is no password field anywhere.
- A DOB under 19 stops the flow with no soft fail; the database holds the year only.
- A clear selfie is approved within about a minute; a cartoon lands in the admin photo queue; an inappropriate image is rejected and the profile stays visible without a photo; all three appear in `moderation_log`.
- Gender is asked once and appears on no profile, not even your own.
- Delete account removes the auth user, the pins and the photo; export downloads a JSON of your data.
- Signing out and back in restores the profile on the other platform.

12–18 h

#### M3.2 · Crowds, pins, the link-path funnel, universal links (A5–A9, A19, A26 quick pin, A27 opt-in)

**Goal.** The Reddit link ends in a pin in thirty seconds and in a reciprocal list at two — the first showable checkpoint, worth sending to friends even with no crews.

- A5–A7 home from published gatherings, by day, honest counts, mix at 5+, "be the first"; A8 in-app crowd page with the same anatomy as W2.
- **A26 Quick pin** (new, link path): first name, alone / +1 / +2 / a group, "I'd like to meet up", 19+ → pinned as an anonymous user. **A27 Opt in** (new): DOB, gender, photo, contact → permanent account; one safety sheet.
- Opt-in toggle; A9 locked state with the number named; the reciprocal list (RLS already does the work — the screen just renders what the policy returns); tapping a person opens A22, never a chat.
- Edit and remove my pin; A19 My Events; universal links into the app; the "get the app" nudge shown once at crews-open.
- **Interests, remembered** (Alex, M3.1, after walking A3): somebody picking a neighbourhood wanted to say what they are into as well, so the list shows more of what they like. **This is not the tags** — tags describe you to other people; this shapes what you see. The cheap, honest version is **remembering the chip selection** rather than inventing a second taxonomy: a stored set per person, defaulted onto the app's list, one tap to clear. 2–3 h, here, because this is where A5–A7 build the list it filters.
  - **Narrowing is a filter; reordering is an algorithm** (Alex, M3.1). Q10 says the calendar is the ordering, and a filter leaves that untouched — the remaining rows stay in date order. **The moment it becomes "things you like first", Q10 is dead.** That sentence is the acceptance test for this feature, not a note about it.
  - **It must be visibly on, with a one-tap clear.** A default-on filter that hides things is a new way to see an empty week and conclude the product is dead.
  - **The empty state says why**: "nothing matching your interests this week", never a bare "nothing on".
  - **The overlap with the Interests tag group is settled when this is built, not before** — seven of the 32 tags are taste and so are the chips, and if this ships the obvious question is why tapping "comedy" as a tag does not change the list.
- **The crowd-page button follows what you have done at that gathering** (Alex, M3.1, after "Open" appeared on every crowd page): not pinned → `PIN_IN`, already pinned → `SEE_WHO`. **"Open" never appears on the web.** A26 is what makes the second state reachable, so both halves land here.
  - **The mechanism, decided and not free to change:** the pin writes a **same-origin marker** that W2's script reads. Asking the database from the page breaks the own-origin rule (M2.1: 911 ms against 133 ms, paid per host), and a cookie the Worker could read at render time would make W2 vary by cookie and lose its edge cache. No network, no cookie, no cache change.
- **Search** (designed in M2.3 and filed here; confirmed still M3.2 by Alex, M3.1). About two hours. **No client JavaScript**: it is the same page with an optional query, so W1 keeps its byte budget and works with scripting off. **One door function with an optional query, shared by the Worker's list and the app's** — the M2.3 rule about a second copy of "what is public" drifting applies to "which rows match" as well, and `publicVenueIds()`/`crowds()` in `src/public/data.ts` is where it goes. It was carried out of M2.3 into spec §6 but never into this list, which is the list a session reads first.
- The +1: shown as "+1 friend"; a +1 who wants to be seen pins in themselves through the share link; no claim page (§10).
- **Close the pinning window at the effective end** (found and dated in M2.2, harness P37b). Pinning has no upper time bound today: a pin can be taken at a gathering that ended two days ago. It is a gap left from M1.1, not a decision, and A26 is the first screen with a real button to hang the rule on. Decide the exact edge with A26 — almost certainly the effective end, matching everything else time-driven — enforce it in the database, and **invert P37b rather than treating its failure as a regression**; the case is written to say so.

**Acceptance**

- From a link in iMessage on a phone with no app: tap → Worker page → Pin in → pinned in under 30 seconds with no account and no photo; the Worker page's count is one higher on reload.
- Pinning is refused at a gathering that has ended, and still works an hour before doors; P37b is inverted and green.
- **The quick pin screen is measured, not assumed.** One Lighthouse mobile run on `/g/<slug>/pin`, compared with the crowd page's, and a byte budget agreed for it. M2.1 measured the empty holding route at 828 KB and a score of 37 against the crowd page's 78 KB and 99; whatever A26 costs on top of that, the number is looked at rather than inherited.
- Ticking "meet up" asks for DOB, gender, photo and an email code; afterwards the pin is still there under the same user.
- Two test people opted in each see the other's first name and, once approved, photo; a third who pinned without opting in sees nobody and is not seen.
- The locked state reads "3 of 5 · 2 to go" with three test opt-ins.
- A blocked pair (set in the admin for the test) cannot see each other's pins in the list.
- With the app installed, the same iMessage link opens the app on that crowd page; without it, Safari.
- Remove my pin drops the count; edit changes party size and opt-in; My Events shows the pinned gathering.

20–28 h

#### M3.3 · Crews, the thread, the night, the morning after (A10–A17, A20)

**The convening is not one shape** (Alex, after walking the community pages; decisions.md). The reveal is identical at an arena and at a run club — commit, see who committed — and the convening is not. A10–A12 have to decide this before they are drawn.

**The spot-poll offset becomes a setting here** (Alex, M2.2): sixty minutes before is right for a 7pm gig and wrong for a 9am run. A value on the `cities` row with a shorter morning figure, done when crews are built rather than while the publisher is being walked.

**Two reframings carried in from M2.2** (decisions.md, "Crews open at 5" and "Messaging while crews are forming"). Both are the same point: the hinge is whether people convene without a host, so every screen before that moment should pull toward it rather than report on it.
- **Lead with the people, not the rule.** The reciprocal list already works at n=2 — `can_see_at` never mentions five, and only crews and the mix chip are gated at 5 — so A9 has faces to show long before the threshold. The locked crew state belongs as a quiet line underneath, not as the page's headline, and "Crews open when 5 people opt in." needs replacing with what a reader came for.
- **The vibe chips are load-bearing, not decorative** (Alex, after the community pass). If the product is commit → see who → form a crew by vibe, then **vibe is the only thing distinguishing one open crew from another**. Two crews at the same gathering, same spot, same time differ by nothing else, so a reader choosing between them is choosing on the vibe alone. Design them as the deciding information on the crew card, not as a garnish on it.
- **Build the nudge here, once.** A preset, plan-shaped line that opens a free-text thread on a one-tap accept, so the recipient lets the conversation in. M3.4's solo mode specifies the same mechanism, so building it in M3.3 and reusing it there is the cheap order. Do the "Start a crew" → "I'll be at [spot], join me" reframing first: it is hours, and may shrink what the nudge has to carry.



**Goal.** The convene step — the hinge the whole product turns on — working end to end without anyone from Pin'd in the room. The biggest milestone; split the session in two if it runs long (crews and thread; then night and after).

- Crew object and states: forming → spot set → live → done, plus dissolved; pg_cron transitions keyed off the effective end; one crew per person per gathering; seats counting bodies (a member's +1 takes a seat).
- A10 crews above the people list; start a crew (women-only flag); request to join; any-member approval; silent decline; locks at 3; spot poll from the venue's spots with three times; "Set spot & time"; the crew card as hero; "Share spot & time with a friend" as a first-class button sending the W3 card; sibling crew at 8/8; A15 non-member view; A17 done.
- **"Put me in a crew"** (decided here, see §10): one button that places the person in the open crew with the most room, respecting women-only — the closest thing to a host the product will ever have. 2–3 hours inside this milestone.
- A14 thread on Supabase Realtime using `postgres_changes` only (it respects RLS; broadcast does not); auto-posted card and rules; long-press to report with the message body snapshotted onto the report; close at +24 h, read-only 30 days, delete.
- A13 "I'm here": unlocks 3 hours before; requires a line of text; posts to the thread; never geofenced.
- **Crew vibe** (Alex, M2.1; spec §3, under A11–A13): up to nine preset chips, never free text, set by whoever starts the crew and changeable by any member, shown on the crew card and in the crews list so someone choosing between two open crews has something to choose on. Tatiana rewrites the starting set. No substances, nothing that reads as a dating signal, and any chip most crews would tick gets cut.
  - **The vibe chips own the night; the person's tags own the person** (Alex, M3.1). The M3.1 tag list was cut against exactly this line — anything about when you arrive, how long you stay or what you drink is the crew's, not the person's — so the nine chips can take that whole territory back without colliding with a tag. `packages/shared/src/tags.ts` records the split.
  - **"first time here" is a strange chip for a crew** (Alex, M3.1, rewriting the starting set): a crew cannot be a first-timer, its members can, and the person's version of it is already a tag (`first-time-at-this`). It wants replacing with something a crew can actually be.
- A16 after the event: mutual-only "we met" and "keep in touch", invisible until mutual; the "showed up" badge; connections; A20 with the single verb "invite"; the one after-event question from §7.
- Fallback if Realtime misbehaves on one platform: poll the thread every 10 seconds while it is open. The spot and time are on the card, so the meeting never depends on the chat.

**Acceptance** (five test accounts across two phones and a laptop, a staging gathering scheduled hours ahead)

- Below 5 opt-ins "start a crew" is locked with the reason; at 5, crews appear above the people list.
- A crew of one accepts two requests (any member can approve); the third request is declined and the requester sees nothing; the crew cannot set a spot until it has 3.
- The poll shows up to 3 curated spots and three times; setting them makes the crew card the hero; the share button sends a card with no names.
- At 8/8, a ninth request is offered a prefilled sibling crew at the same spot 15 minutes later.
- Two open crews at the same gathering read differently at a glance because their vibe chips differ, and a member who did not start the crew can change them.
- A women-only crew is invisible to a man test account (list and direct URL) and visible to a nonbinary account with women-only inclusion.
- The thread opens with the card and rules, updates live between two phones, reports a long-pressed message, and contains no phone numbers.
- Three hours before the fake start the crew turns live; "I'm here" refuses an empty line and posts the description; after the effective end the crew is done; a forming crew of two dissolves at six hours before with one notification.
- "We met" ticks are invisible until mutual; a mutual tick mints the badge for both; "keep in touch" appears only then; a mutual keep-in-touch shows in Connections with "invite", which opens this week's crowds.
- Trying to join a second crew at the same gathering is refused.
- "Put me in a crew" seats a woman in the women-only crew when one has room, otherwise in the mixed one.

8–12 h

#### M3.4 · Solo crew (A28 opt-in sheet, A29 proposals and plan)

**Goal.** The narrow exception, built on the crew object so it inherits every safety rule, and measured separately from day one.

- `pins.solo_opt_in`, `pins.solo_visibility`, `people.hidden_from_solo`; the `can_see_at` branch with harness cases (P55+): reciprocal, women-only limiter, block, hidden, review-only.
- Crew `kind = 'solo'` with two seats and no requests; proposals (spot, time, one of five preset lines) with limits and expiry; accept → plan; decline silent.
- The opt-in sheet with the forced visibility choice; the 1-on-1 section on the pinned crowd page, below crews; metrics views for solo.

**Acceptance**

- The toggle is off by default and lives only on the pinned crowd page; the sheet explains groups vs 1-on-1 and makes you choose who can see you.
- Two solo-opted people see each other in the 1-on-1 section; a crew-only person sees no such section and is not listed in it.
- A proposal carries a spot from the venue list, a time and a preset line; there is no free-text field; declining sends nothing; accepting creates a two-person plan with a thread, "I'm here" and the after-event flow identical to a crew's.
- A fourth open proposal is refused; a second proposal to the same person is refused; proposals vanish at the gathering's start.
- A woman who chose "women only" is invisible in solo to a man test account, including by direct URL.
- Any report on a person removes them from every solo list immediately; block hides both ways.
- `test:policies` passes with the new cases.

10–14 h

#### M3.5 · Safety and the five notifications (A18, A23, A24)

**Goal.** Every surface has block and report two taps away, and the product speaks exactly five times — by push to the app, by email to web-only people — so that Beta App Review and the first crowds see a finished safety floor.

- A24 from a profile, a crew card and a message; confirmation copy ("a human reviews within 24h"); H9 auto-hide behaviour surfaced in the admin; blocking never notifies.
- A23 complete: blocked people, my reports, "women-only crews only", visibility (always on), show my neighbourhood, notification toggles, export, delete, the no-location note.
- `notification_queue` written by triggers and pg_cron; the Worker delivery cron; Expo push tokens per device; Resend for email with an unsubscribe link on the digest; deep links for every notification including cold start. Monday 6:00 PM Toronto handled across DST (two UTC schedules, local-hour check).
- Notification 3 becomes "plan status": formed / spot set / dissolved / *gathering date changed or withdrawn* (§10). Still five.

**Acceptance**

- Report and block work in two taps from a profile, a crew card and a long-pressed message, on both platforms.
- An "uncomfortable" report hides the target immediately; two "spam" reports hide the target; the reporter is never shown an outcome beyond the confirmation.
- Each of the five arrives on the phone as push and, for a web-only test account, as email: a test-fired digest, threshold, plan status (including a date change), day-of about 3 hours before, next morning — each opening the right screen, including from a cold start.
- Nothing else is ever sent; no SMS exists.
- Settings show every toggle, export and delete; the digest email has an unsubscribe link that works.

6–8 h

#### M3.6 · Dogfood on staging

**Goal.** The whole loop walked by people who know what it should feel like, on real phones, before a stranger is invited.

**Acceptance**

- The three of you, with five synthetic accounts, walk from a fake Reddit post to the next-morning ticks on two phones and a laptop, using a staging gathering scheduled hours ahead; every acceptance item above is re-checked; the fix list is closed.
- The internal TestFlight build is installed on all team phones; Sentry shows no crash in the walk.
- The web build's photo capture works on iOS Safari and Android Chrome (borrow an Android phone once).

### Phase 4 — Before the first real crowd (28–42 h)

4–6 h

#### M4.1 · Policy, terms, operations

- Privacy policy (Ticketmaster data and its 30-day purge, the automated photo checks, gender and its stated purpose, solo mode, retention table, PIPEDA access and deletion) and terms with the zero-tolerance clause and the "we organise nothing; crews meet at public spots at gatherings run by others" language; published on pind.social; acceptance at opt-in and at store sign-in; the one-hour lawyer read (§10).
- Moderation rota that covers Toronto's night without heroics: Tatiana's time zone in Spain is six hours ahead, which naturally covers the 2 a.m. to 8 a.m. gap; Alex and Jayme cover the day. Every report posts to a private team channel; "by 10 a.m. someone has looked" is the standard, 24 hours the promise.
- Incident scripts (safety report, data breach, a public safety post) in the admin; the reporter-acknowledgement copy.

**Acceptance**

- Policy and terms are live and linked from every crowd surface footer and the opt-in sheet.
- A test report reaches the team channel within a minute.
- The scripts exist in the admin and the three of you have read them.
- **The support address is a real, monitored inbox.** `safety@pind.social` and `crowds@pind.social` are on the public pages from M2.1; Resend sends mail but does not receive it, so both are forwarded to a real inbox (Cloudflare Email Routing) and a test to each arrives. `safety@` is an App Review 1.2 requirement and a promise to users, not decoration (Alex, M2.1).

4–8 h

#### M4.2 · The independent adversarial review

- A fresh Claude Code session with no prior context, tasked only with finding leaks, given `docs/m1.1-review-brief.md` with its M1.2 and M1.3 sections plus a new M3 section (solo branch, review-only gatherings, anonymous users, photo pending state, thread snapshots). Every leak found becomes a migration with a harness case.
- Alex's own read of `docs/visibility.md`, updated for V14+ (solo), V15 (review-only), V16 (anonymous people).

**Acceptance**

- The review's findings are closed as migrations; `test:policies` is green with new cases for each.
- Alex has read visibility.md end to end and signed it off in the brief.

6–8 h

#### M4.3 · Production project and external TestFlight

- A new Supabase project `pind-prod` on Pro (daily backups, no pausing), same region, migrations applied by the CLI only, no seed data ever; secrets and Access for production; the Worker's production environment; Apple config for the production bundle ID; Resend on the live domain.
- External TestFlight through Beta App Review with the review notes from §5; a public link for volunteers.
- **Sign in with Apple has to be re-pointed** (Alex, M3.1). The Services ID `social.pind.web` was created with **`social.pind.app.staging` as its primary App ID**, because `social.pind.app` did not exist yet. It has to be changed to the production App ID here, or Apple sign-in on the web is wrong for production. Enable Sign in with Apple on the production App ID first, then change the Services ID's primary, then mint a fresh client secret (`scripts/apple-client-secret.ts`) and update `APPLE_SECRET_EXPIRES`.
- **Redirect URLs for production.** `pind://**` is already on the staging project's allow-list; the production Supabase project needs the whole list built again — it is per-project, not per-domain.
- **A custom auth domain** (`auth.pind.social`, a paid Supabase add-on on a Pro project) so a new person is not asked to "continue to mxuajvlrkggrqpntekqt.supabase.co", which is the first thing they see and reads like a phishing page (Alex, M3.1). **It changes the callback URL**, so Google Cloud's authorised redirect URI, Apple's Services ID return URL and a freshly minted Apple client secret all move with it — which is why it belongs here, with the production project, rather than being retrofitted later.

**Acceptance**

- A real person (you, from a fresh phone) can pin in, opt in, get a photo approved and see a crew on pind.social against production.
- Staging seed rows do not exist in production (a query proves it).
- The external TestFlight link installs the app and it talks to production.
- The production bundle ID (`social.pind.app`) **reuses the existing Pin'd APNs key**. The team is at Apple's limit of two, so if EAS offers to create a key, stop and reuse. No certificate is ever revoked to make room: create, never revoke (Alex, M2.0).
- Apple sign-in on **the web** works against production — which means the Services ID's primary App ID was changed off the staging one and a fresh client secret was minted. Native iOS sign-in would keep working either way, so testing the app alone proves nothing here.
- The production app's internal TestFlight group has Alex only. Either create it by hand with just Alex before the first submit, or stop EAS filling its auto-created "Team (Expo)" group with every App Store Connect user on the Tenor team (Alex, M2.0).

8–12 h

#### M4.4 · Community & free sourcing

**Open: should this move earlier?** (Alex asked in M2.2; **not decided, nothing reordered.**) The prompt was a measurement, not enthusiasm: Ticketmaster classifies everything as Music, Sports or Arts & Theatre, so "bars" and "community" have no source at all, and the breadth a 50-a-week target exists to show is three categories wearing five labels. The variety problem is a *sourcing* problem, and no publishing setting fixes it.

**Cost of moving it before Phase 3:** 8–12 h of its own, plus 8–12 h of delay to M3.1 and M3.2 — which pushes the six-week checkpoint ("M3.2 showable to a friend") back by the same amount.

**What it needs that does not exist yet:**
- `gathering_source` has no `community` value — a migration, trivial.
- **The web-search mechanism M1.3b proved unreliable.** M4.4 is Claude with web search over Toronto sources, which is the same tool that took 43 s for one venue and 219 s for another, returned empty lists, and stalled mid-stream until a run hung for 40 minutes (spec §6, M5.2). That work is built and switched off *because* it is not trusted. M4.4 would be fighting that battle now, before the crew loop is proven.
- **Venues and meeting spots for places that are not buildings.** A run club meets at a park entrance; publishing needs a venue row, and a crew needs a spot. The manual spot pass (decisions Part 5) is not scheduled yet, and a published community gathering with nowhere to meet fails at the crew step, which is the product.

**The honest case against:**
1. The loop is still the risk, and it is why M4.4 sits after it. A varied list that cannot form a crew is a prettier empty room.
2. Nothing is pointed at these pages yet — they are noindex and unlinked until M4.1 — so the thin-list problem has no audience today. Its cost is near zero now and rises sharply at first-crowd time.
3. The 50-a-week change already bought most of the available breadth: 41 gatherings over three weeks at 49/32/20, against 18 before.

**The option that may make the question moot: add the community gatherings by hand.** M4.4's value *to the list* is the gatherings, not the automation. Eight to twelve recurring community gatherings — run clubs, markets, a games night — entered through the manual-add admin that already exists, with their venues and spots done in the same pass, is roughly **2–3 h** and needs no new machinery, no web search and no reordering. It fills both empty chips, tests whether community crowds behave differently, and doubles as the first half of the manual spot pass that has to happen anyway. The automated weekly run then stays where it is, and arrives with a rubric written from real examples rather than guessed.

**Decide after M2.2's acceptance walk, with M2.3 on the table at the same time.**


**Why here.** The decision says the first real crowds include at least one small community gathering, so this must exist before them; it is independent of the app, and it comes after the crew loop because the loop is the risk. It runs as its own cron, applying M1.3b's lessons from the start.

- A weekly run: Claude with web search over a fixed list of Toronto sources (city listings, run-club and market pages, festival calendars, community boards) producing drafts with `source = community`, its own rubric (social by design, solo-friendly, free or low-cost, recurring — not crowd size), ranked separately; a "Community & free" tab in the admin with source pages; duplicates against Ticketmaster merged.
- Every call streamed and aborted at four minutes, at most one retry, a per-run budget and the daily cap, aborted usage estimated (M1.3b's cost blind spot).
- The auto-publisher's community slot fed from this tab.
- **"What does it cost to walk in" is a field the rubric must require, never infer** (Alex, after M2.2). Gatherings carry `entry` — free / pay at the door / ticketed — with an optional door price and note, because most community gatherings are drop-in with a small cost. When this run is reading a web page to fill that in, **inferring "free" when it is actually $20 at the door is the most damaging mistake it can make**: it sends somebody to a door with no cash, and the page said they were fine. So the rubric asks for an explicit answer and **leaves it unknown rather than guessing cheerfully** — `entry = 'door'` with a null price reads as "pay at the door" with no amount, which is honest and useful, where a wrong "Free" is neither. A page that does not say is a page that does not say; that is a finding, not a gap to fill with the friendly option.
- **The doughnut is a sourcing problem, and the inner suburbs are the gap** (Alex, after the wider pass, measured). 104 of 188 dated rows sit within 3 km of Union, while east-inner has 2 rows and west-outer has 2 — Leslieville, the Junction and Bloor West have almost nothing, and the outer areas that *do* appear are carried by one-offs. **That is where recurring social things exist and directories do not reach.** Two proofs that the data is there if the run looks in the right place, both found by hand in the manual pass: **Toronto Public Library's per-branch event pages**, which carry dated sessions and are how Port Union and Kennedy/Eglinton were confirmed, and **the City's own drop-in sports map**. Neither is a directory and neither would be found by searching for "things to do in Toronto"; both are per-location pages that have to be enumerated. M4.4's source list should start from institutions with per-branch pages rather than from listings sites.
- **Community venues are the hard case, and the spot work must not assume arenas** (Alex, M2.2). A run club, a market or a pickup game often has no venue in the Ticketmaster sense: a park entrance, a corner of a street, a community centre. Those need meeting spots too, and **harder ones, not easier** — there is no box office to meet outside of, and "the north gate" means nothing to someone who has never been. If the manual spot pass (decisions.md, "Spot content starts as a manual pass") covers only Scotiabank Arena and Rogers Centre, M4.4 arrives with nowhere for community crews to meet and the slot cannot be filled. **The manual pass must carry community locations from the start**, and the card's fields must survive a place that is not a building.

- **The rubric comes out of the manual ten, and the goal is sourcing a city — not maintaining a venue list** (Alex, after the community pass). The first seven were entered by hand across six venues with thirteen spots, and that is how we learn what a good community gathering and a good meeting spot actually look like. **It is not the permanent mechanism.** The research that produced that list is repeatable for any city, and M4.4 exists to make it so: the rubric is written from those ten real examples rather than guessed, and success is "a city can be sourced", not "six venues are kept up to date". A second city should be a run, not a week of typing.
- **The confidence marks are part of the output, not scaffolding.** The list arrived marked [V] confirmed on the organiser's own page, [D] third-party directory only, [?] not confirmed, [G] hours from a Google listing. Three of ten were held back on those marks and one was dropped, which is the rubric working before it was written down. The automated run needs the same: what it confirmed, from where, and what it could not — and **a [?] is a reason to hold, not to publish with a caveat**.

**Acceptance**

- A run finishes within its budget and fills the tab with real, dated, free or low-cost gatherings with links Alex can open.
- Each candidate carries what was confirmed and from where, and anything unconfirmed is held rather than published.
- At least one community gathering is published and visible on pind.social before the first real crowd.
- **That gathering has meeting spots** — its location, whatever shape it is, has somewhere a crew can actually meet.
- A run that stalls is aborted and reported, not hung.

6–8 h

#### M4.5 · Metrics, and the adaptive publishing loop switched on

- The views and the `gathering_stats` snapshots from §7; PostHog funnel events; the admin Metrics page (per gathering, per week, crews vs solo, seeded vs unseeded, the after-event answer).
- `adaptive = on` with the settings from §6; the weekly decision logged with its inputs; a freeze switch.

**Acceptance**

- The Metrics page shows every number in §7's table for the staging dogfood data, split by mode.
- A Monday run logs a decision and its reasons; freezing the target stops the next decision from changing it.
- PostHog events still carry no `$geoip_*` properties and no `$ip`. Checked in M2.0 (2026-09-19) by querying the stored `app_open` events: none had either, so PostHog honours the app's per-event `$geoip_disable` flag. M4.5 re-checks this against live funnel events rather than building a transformation (Alex, M2.0).
- Web counts are not inflated by pages the browser pre-loads. In M2.0 one phone visit produced two `app_open` events 1 ms apart, with different anonymous ids; the likely cause is iOS Safari pre-loading a top hit. Funnel counts skip pre-rendered loads, or the metrics say why they don't (Alex, M2.0).

### The first real crowds

Six to eight weeks. The publisher runs; the team seeds two or three gatherings a week in their fan channels (the only per-event labour left, and it is marketing, not operations); the digest goes out on Mondays; the team pins in to things they were going to anyway as ordinary members (allowed — never as operators). Your time: about two hours a week of reading the metrics page, the report queue and the fix list. At the end, a decision meeting against §7's pass criteria and the solo rule. Then Phase 5, or a different plan.

### Phase 5 — The App Store (22–34 h)

8–12 h

#### M5.1 · Store readiness

- The 1.2 checklist written into the review notes; the review-only gathering and reviewer account (H6 preserved); age rating 18+; privacy labels and manifest; EULA; support and marketing URLs; screenshots that show crews and gatherings and never solo; the listing copy (crew language; "not a dating app" appears nowhere in it).
- The solo server flag per platform, so a rejection on that ground costs a switch, not a rebuild.

**Acceptance**

- A reviewer-style walk from a fresh install on a fresh phone reaches a crew and a thread using only the notes and the demo account.
- Real users cannot see the review-only gathering (a harness case proves it).
- The listing's seller line reads **Pin'd**, through an App Store Connect "Doing Business As" name for Tenor Investments Inc. Apple wants documentation and takes a few days, so request it well before submission (Alex, M2.0).

10–14 h

#### M5.2 · M1.3b — automated spots

**Why here.** The first crowds use a handful of venues whose spots Jayme's list and Alex's hand add in an hour. Automation pays when the publishing target passes what a human can curate, and its ranking needs the tallies real crews produce. Building it earlier would automate a problem you do not yet have.

- Suggestions in their own cron (not the import), streamed, aborted at four minutes, aborted usage estimated; the empty-answer rate measured.
- The automated check (real, currently open, public and staffed, within about five minutes' walk, an evidence page) auto-approves; uncertain ones queue for Alex.
- User suggestions from the crew's spot picker ("suggest a spot") through the same check — no address field, ever.
- Pools of any size; anonymous per-spot tallies (picked, met there, reported) that survive pin deletion; polls showing the top two proven spots plus one rising, with "see all"; staggered times at scale.

**Acceptance**

- A nightly suggestions run for ten venues finishes inside its budget with a measured empty rate; a proven spot is auto-approved with its evidence page attached; a doubtful one waits for Alex.
- A user-suggested spot appears in the poll only after the check passes; a typed address is impossible.
- A venue's poll re-orders after crews meet at a spot.

4–8 h

#### M5.3 · Submission, rejections, and Android when you choose

Expect one or two rejections; each is a week of calendar and an hour of work. Android comes from the same code (~20–30 h in the old plan; less now) — register the Play account under the corporation to avoid the 12-tester closed-test rule for personal accounts. Until then the web build serves Android users, which is most of Reddit.

**Acceptance**

- Live on the App Store; the crowd page's smart banner offers the app; a shared link opens the store build.

### Where the four things fit, and why

| Item                      | Milestone                      | Reason for the place                                                                                                                              |
|---------------------------|--------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------|
| Auto-generated maps       | M2.1                           | The crowd page needs a map; a schematic from coordinates removes an upload per venue and loads instantly.                                         |
| Auto-publishing           | M2.2 (fixed) → M4.5 (adaptive) | Removing the click is cheap now; adapting needs outcomes, which do not exist until gatherings end with real pins.                                 |
| Community & free sourcing | M4.4                           | Required before the first crowds by decision; independent of the app; benefits from M1.3b's lessons; after the loop because the loop is the risk. |
| M1.3b automated spots     | M5.2                           | Hand-added spots cover the first crowds' venues; automation and ranking need volume and real tallies.                                             |

## 9 · The first beta: what must be true before a real crowd

Everything below is a gate. Items that only applied to the WhatsApp Test 0 are gone from this list rather than struck through.

### Product safety floor

- 19+ tick at pin; DOB hard stop at opt-in; year only stored
- Reciprocal reveal enforced in the database; reciprocity labelled "always on" in settings
- No location permission exists in the build (check the app's info.plist and the web build's permissions)
- Crews 3–8 at curated spots; no address field anywhere; solo plans only at venue spots
- Block and report two taps from every person, crew and message; H9 auto-hide; blocking never notifies
- Women-only crews on every gathering; solo "women only" limiter
- Photo check live; pending state respected; queue monitored
- Delete account and export in-app; house rules verbatim on every crowd surface

### Moderation and incidents

- Reports post to the team channel; a human acts within 24 hours; the rota covers the night
- Incident scripts written and read; the acknowledgement copy in place
- The admin shows hidden people, open reports, and the photo queue on one screen

### Privacy and legal

- Privacy policy and terms published, covering Ticketmaster data, photo checks, gender, solo mode, retention
- Ticketmaster data purged 30 days after effective end (job proven on staging); no revenue from their data
- The lawyer hour on terms and the "we organise nothing" language; incorporation at least started, with the accounts to move to the entity listed

### Visibility review

- The independent adversarial review done; every finding a migration with a harness case
- Alex's read of visibility.md signed off, including V14–V16
- `test:policies` green on production's schema

### Data and infrastructure

- Production Supabase project on Pro; no seed rows; backups on
- pind.social live; universal links verified from iMessage and Safari; email delivering from the domain
- Sentry on the app and the Worker; the delivery cron's failures visible in the admin

### Content and people

- Spots hand-added for the first crowds' venues (Scotiabank Arena, Rogers Centre, BMO Field, History, Rebel, Massey Hall, Coca-Cola Coliseum, and whichever community venue is first)
- At least one community gathering published; five gatherings a week publishing on their own
- The fan-channel map and posting rules for the first seeded gatherings; the first two posts drafted
- Pass criteria and the solo rule (§7) written into spec.md before the first pin, not after

## 10 · Risks, and the decisions I need from you

### Risks

| Risk                                                                   | Why it matters                                                                                        | Mitigation in this plan                                                                                                                                                                    |
|------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Reveal does not convene — crews don't form without a host              | The hinge; every reveal-only precedent died on it                                                     | "Put me in a crew"; team members pin in as ordinary members; crew conversion measured; the stop rule in §7                                                                                 |
| The photo step kills the funnel                                        | Q2's own warning; no IG escape hatch now                                                              | Photo at opt-in, not pin; step conversion measured from the first crowd; the AI check's false positives watched                                                                            |
| Solo mode reframes Pin'd as a dating app — in threads or at App Review | The assessment's clearest lesson about 1:1                                                            | Opt-in and invisible until then; nothing in listings; a per-platform kill switch; the pre-registered rule                                                                                  |
| A safety incident with nobody present                                  | One badly handled incident ends the brand                                                             | Public spots, 19+, women-only, immediate hide on solo reports, the rota, the scripts; crews meet before events, not after last call                                                        |
| A visibility leak written by an agent                                  | Strangers' faces and plans                                                                            | Harness on every migration; the adversarial review before real people; solo and review-only cases added                                                                                    |
| Apple: Beta App Review or App Review rejections                        | Calendar, and the dating framing                                                                      | The web build is the complete product; review-only gathering; notes prepared; solo switchable                                                                                              |
| AI jobs stalling or overspending                                       | Seen in M1.3b                                                                                         | Own crons, streaming with a four-minute abort, one retry, caps, aborted usage estimated                                                                                                    |
| Seeding labour vs "no manual work per event"                           | The assessment says per-event seeding is the only cold-start mechanic that needs no money and no host | Treat seeding as marketing, not operations: 2–3 posts a week for the first crowds, by Tatiana and Jayme; the adaptive loop measures when the city populates itself and the labour can stop |
| Realtime flakiness on web or iOS                                       | The thread is the only messaging                                                                      | `postgres_changes` only; reconnect handling; a polling fallback; the plan lives on the card, not in the chat                                                                               |
| Hours dry up in Phase 3                                                | The likeliest way a solo build ends                                                                   | The six-week rule; M3.2 is a showable checkpoint on its own; nothing after M3.5 is required for a demo                                                                                     |
| Staging data or habits leaking into production                         | Real photos and gender next to a database sessions migrate nightly                                    | A separate production project; migrations by CLI only; seeds tagged and never applied to prod; a query in M4.3's acceptance                                                                |
| Ticketmaster's terms                                                   | Revenue and retention                                                                                 | Already decided: no revenue during the beta; the 30-day purge; the policy footer                                                                                                           |

### Open decisions, each with a recommendation

| Decision                                        | Recommendation                                                                                                           | Why                                                                                                                   |
|-------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------|
| Production data: pind-staging or a new project? | **A new `pind-prod` on Pro** before any real person; staging stays free and keeps its seed data                          | Backups, no pausing, and no real faces beside a database that agent sessions migrate nightly                          |
| Photo at pin or at opt-in?                      | **At opt-in**                                                                                                            | §4. A pin is honest without it; the photo earns its keep at the reveal                                                |
| Account at pin or at opt-in?                    | **Anonymous at pin, permanent at opt-in**, same user id                                                                  | §4. Same account, two steps, no magic links                                                                           |
| Email delivery for web people?                  | **Yes, Resend on pind.social**; the five moments mirrored by email for web-only people; SMS never                        | Push does not reach the web; without email a web pinner is never told crews are open                                  |
| Tell pinned people when a date changes?         | **Yes** — fold it into notification 3, renamed "plan status"; still five                                                 | A date change is a plan-state change, exactly what A18's rule protects; silence would strand people at the wrong time |
| The +1 claim page (T10)?                        | **Drop it.** A +1 shows as "+1 friend" and pins in themselves via the share link if they want to be seen                 | Thirty seconds on the quick-pin screen replaces a page, a token and a rule                                            |
| "Put me in a crew"?                             | **Build it in M3.3**                                                                                                     | 2–3 hours, and it is the closest thing to a host you will ever ship                                                   |
| Solo's user-facing name and default visibility  | **"Meet 1-on-1"**; a forced choice between "everyone who opted in" and "women only"                                      | Say what it is; do not choose for people whose safety it affects                                                      |
| Neighbourhood and 3 tags on the link path       | **Optional, nudged later**; "exactly 3" defines a complete profile                                                       | §4. Conversation handles are not a gate                                                                               |
| Where the web build is hosted                   | **Same host, Worker static assets**                                                                                      | §2. One domain, one deploy, one link file                                                                             |
| Incorporation and account ownership             | **Start now; done before store submission at the latest**; Apple, Play, Supabase, Cloudflare and Resend under the entity | The terms name an entity; the Play account rule; billing kept away from your other companies                          |
| First crowds on TestFlight or web?              | **Web and email first**; TestFlight for volunteers                                                                       | No install for a Reddit visitor; Android covered; push is a bonus, not a gate                                         |
| Android                                         | **After iOS, from the same code**; the web covers Android until then                                                     | Reddit skews Android; the web build already serves them                                                               |
| Analytics and crashes                           | **PostHog + SQL views; Sentry on both halves**                                                                           | Free tiers; the outcome numbers live in Postgres anyway                                                               |
| Who covers moderation at night                  | **Tatiana's daytime is Toronto's night**; Alex and Jayme cover the day; nobody wakes up for the queue                    | A rota that exists is the one that gets followed                                                                      |
| Sign in with Apple on the web                   | **Later**; email code and Google first                                                                                   | Apple's rule applies to the app; the web setup is an evening for little gain                                          |

## 11 · Edits for Claude Code: spec.md, decisions.md, CLAUDE.md

Written so a session can apply them as one pull request, "docs: merge the revised build plan". Each edit names the section it touches; nothing outside it changes.

### spec.md

1.  **§0** — Replace "Two versions of this exist" with: one product built in Expo for iOS and web, plus the Worker's public web layer (W1–W4). Delete the Test 0 bullet.
2.  **§1 gathering** — Add `review_only` (boolean, default false): visible only to review-only people and admin; never in lists, counts or the digest; H6 note that nothing in it is visible to a real person. Add the publishing marks `publish_mark` (null / publish / never).
3.  **§1 person** — Add "anonymous person: created at quick pin with a first name and the 19+ attestation; becomes permanent at opt-in by linking an email, Apple or Google identity; the id never changes". Add `hidden_from_solo`, set at insert by any report on the person. Note that DOB, gender and the photo are collected at opt-in (A27) on the link path and at A2 on the store path.
4.  **§1 pin** — Add `solo_opt_in` (default false) and `solo_visibility` (everyone \| women_only). State that `open_to_meeting` requires a permanent identity and a submitted photo; a pin without them still counts in N pinned.
5.  **§1 crew** — Add `kind` (crew \| solo). Solo: exactly 2 seats, created by an accepted proposal, no join requests, invisible to non-members; inherits every state, the thread, check-in and confirmations. State that "3–8" and "locks at 3" apply to `kind = 'crew'`. Add the **proposal** object: gathering, from, to, spot, time, preset line, status (open / accepted / declined / expired); limits 3 open per person per gathering, 1 per pair; expiry at `starts_at`.
6.  **§1 block / report** — Add: any report sets `hidden_from_solo` immediately, independent of `is_safety`.
7.  **§2** — Retitle "Test 0 — web + WhatsApp (T1–T10)" as "The public web layer on the Worker (W1–W4)". W1 = T9's content; W2 = T2's content with the generated map and the session-aware button; W3 = `/spot`; W4 = OG image (no counts), AASA, `.ics`. Remove T1's WhatsApp reference (the post links to W2). Delete T3–T8 and T10; move T8's two questions to A16 (one question, everyone opted in) and note "Would you have gone alone anyway?" as the attendance metric. Delete the signed-cookie and magic-link sentences. Keep the dark-look paragraph.
8.  **§3** — Add **A26 Quick pin** and **A27 Opt in** (link path) with their fields; note the store path keeps A1–A4. Make neighbourhood and tags optional on the link path. Add **A28 Solo opt-in sheet** and **A29 Proposals and plan** (the 1-on-1 section, the five preset lines, the plan card). A10: the 1-on-1 section sits below crews and renders only for solo-opted people. A18: rename 3 to "plan status — formed / spot set / dissolved / gathering date changed or withdrawn"; add "every notification is mirrored by email to people without a device token". A23: "Meet 1-on-1" toggle appears here only as a per-gathering setting summary. Add "Put me in a crew" to A10.
9.  **§4** — Replace with §2's boundary table from this plan and the hosting paragraph (Worker routes first, SPA fallback, one host).
10. **§5 copy** — Add the solo opt-in sheet copy, the five preset lines (placeholders until Tatiana's final), the "get the app" nudge (once, at crews open), the plan-status copy for a date change. Keep the "not a dating app" restriction to A1.
11. **§6** — Replace "Where we are" with the milestone list M2.0–M5.3 and their status; remove the superseded and Test 0-only items; keep the M1.3b learnings verbatim under M5.2; move "Before the first real crowd" to §9 of this plan's checklist; keep "Deferred cascades" and add "anonymous people deleted with their pins".
12. **New §7 Measurement** — §7 of this plan: the views, the snapshot job, the metric table, the pass criteria, the solo rule.
13. **New §8 Auto-publishing** — §6 of this plan: settings, the nightly fill, the weekly adjust, the logging.

### decisions.md

1.  **Part 1, decided exception** — Append: implemented as `crews.kind = 'solo'` with exactly two seats; H5's 3–8 governs `kind = 'crew'`; any report hides the person from solo immediately.
2.  **Q1** — Replace the claim-link sentences: the +1 claim page is dropped; a +1 who wants to be visible pins in through the share link; `party_total` keeps counting bodies; crews show "+1 friend" for a seat taken by an unnamed +1.
3.  **Q2** — Replace with: the photo is required to opt in to meeting (A27 / A2), never to pin; there is no Instagram alternative; the check is automated (Part 5). Alternative unchanged.
4.  **Q8** — Replace with: a permanent identity (email code, Apple, Google) is required at opt-in; email is the channel for people without a device token; SMS is never used.
5.  **Q9** — Mark retired (Test 0 only); keep the text for history.
6.  **Part 3** — Add rows: proposals expire at `starts_at` and are deleted with the pin; solo plans follow crew retention; anonymous people are deleted with their last pin; `gathering_stats` snapshots persist.
7.  **Part 5** — Add entries: *Production project*; *Email delivery* (Resend, transactional, unsubscribe on the digest); *Notification delivery* (database enqueues, Worker delivers, five minutes, one retry); *Photo check on the Worker via database webhook*; *Generated maps are schematic SVGs from coordinates*; *OG images carry no counts*; *Review-only gatherings* (H6 preserved); *"Put me in a crew" — decided yes*; *Date changes message pinned people through notification 3*; *Repo layout*; *Realtime via `postgres_changes` only*; *Auto-publishing, adaptive* (the settings and rule); *Solo user-facing name and forced visibility choice*. Update "Build direction" to say the revised plan is merged and Test 0 screens are deleted, not superseded.
8.  **Part 5, "Review of the visibility rules"** — Add the M3 items to the review brief's scope: solo branch, review-only, anonymous people, photo pending state, message snapshots.

### CLAUDE.md

1.  Repo layout and commands: workspaces; `app/` scripts (start, web export, typecheck); the Worker's unchanged scripts; "the web export is a Worker asset — never deploy one without the other".
2.  The boundary rule from §2, verbatim, as a rule agents must not cross ("no people lists rendered by the Worker; no AI or email calls from the app").
3.  Expo rules: SDK pinned; no native module beyond the M2.0 list without a decision; Expo Router; TanStack Query; `postgres_changes` only; tokens from `packages/shared`; every screen references its board ID in the file header and the commit.
4.  Testing: `test:policies` must gain a case for every migration touching `can_see_at`, blocks, women-only, solo, review-only or hidden people; the acceptance list of the milestone is pasted at the top of the session.
5.  Data: never run seeds against production; the service key never reads people for a visitor; review-only rows are the only non-real data allowed anywhere, and only on production for App Review.
6.  Secrets: the Anthropic key, Resend key, Expo push access token and the webhook secret live in the Worker; nothing in the app bundle but the anon key.

## 12 · Working method — what carries over, and three additions

- The board is the spec, screen IDs in every prompt and commit; migrations in the repo, never in the dashboard; tests before screens for anything about visibility; one milestone per branch, one session per milestone, merge on a real-phone check; staging is real; pin everything; the two prompts ("explain what this policy allows and denies" and "list the states and what moves between them"). All unchanged, and all vindicated by the first two days.
- **Addition 1 — the acceptance list is the session's first message.** Every milestone above has one; paste it, and end the session by walking it on the phone.
- **Addition 2 — AI calls follow the M1.3b pattern by default:** streamed, four-minute abort, one retry, a budget, aborted usage estimated. Put it in CLAUDE.md so no session rediscovers the stall.
- **Addition 3 — the six-week rule now has a first checkpoint you can name:** M3.2 is showable to a friend with a link, a pin and a face — before crews exist. If it is more than six weeks away at your current pace, that is the signal to raise the hours or shrink the phase, not to keep going quietly.

Companion to spec.md and decisions.md (Phase 1 M1.3), the research assessment (revision 2), the wireframe board and the Test 0 & App build brief. Hours are estimates for an agent-assisted part-time builder with strong infrastructure skills and no prior React Native app shipped, calibrated to the first two days of building; re-calibrate after M3.2, which is the next honest reading of pace.
