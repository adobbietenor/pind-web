# Pin'd — product spec

Source: the Claude Design wireframe board ("wireframes & user flows"), plus the
research assessment. This file is the spec of record. Every prompt, branch and
commit references a screen ID from this document.

Hard rules and the eleven UX calls live in `decisions.md` and are referenced here
as H1–H11 and Q1–Q11.

Tagline: **"Know where you're headed, find what you're looking for."**
One-liner: **"See who's going, meet them there."**

---

## 0 · The product in one paragraph

Pin'd attaches to gatherings that already exist — Leafs and Raptors games, Jays
games, arena and amphitheatre concerts, festival days, big club nights in Toronto.
Someone with a ticket **pins in** to say they are going. Once pinned in, they can
see who else is going. When **5 people at one gathering opt in to meeting**, crews
open: a **crew** is 3–8 people who agree a **curated public spot** and a time before
the event, meet there, and go in together. Afterwards they confirm they met and can
choose to keep in touch. The company never hosts or attends (H10).

Two versions of this exist:
- **Test 0** — mobile web pages plus a WhatsApp group per gathering. No accounts, no app.
- **iOS app** — the same journey, owned end to end.

---

## 1 · Core objects and lifecycles

### gathering
A real public event. Arrives as a **draft** from the nightly Ticketmaster import, the
weekly AI discovery run, or manual entry (fallback), and is public only once admin
publishes it (decisions Part 5, "Gathering sourcing"). Fields: name, starts_at,
`ends_at` (nullable), venue, `event_url` (tickets or event info; optional), `is_free`,
`featured` flag, status (draft / published / dismissed / withdrawn). **Withdrawn**
(Alex, M1.3) applies only to a published gathering that is off — cancelled, postponed,
a takedown request or other — even with pins: it leaves every public list, pins are
kept, and pinned people see a short neutral notice ("This gathering is no longer on
Pin'd. Your pin is kept; there's nothing you need to do.") instead of a dead page.
The static map image showing the venue and its meeting spots belongs to the **venue**. Venues have a city (Toronto
now; Vancouver and Montreal possible).

**Effective end** = `ends_at`, or `starts_at + 180 minutes` when `ends_at` is null.
Admin can set `ends_at` per gathering; festival days and club nights get it set by
hand. Everything time-driven *after* a gathering (crew `done`, thread close, 72h
keep-in-touch expiry, pin deletion) keys off the effective end, never `starts_at`.

Derived counts:
- **N pinned** = sum of `party_total` across pins. This is the honest number of
  bodies going (H6).
- **N open to meeting** = count of distinct people with `open_to_meeting`. Never party
  totals: a +1 has consented to nothing. This is the count that reaches the threshold of 5.
- **Gender mix** = opted-in Women and Men, plus Other only when above zero (every answer
  that is not woman or man), only at 5+ opted in (Q3). The three add up to N open to
  meeting. Hidden (reported) people are left out of N open to meeting and the mix.
- Crews forming.

### person
Self-declared `gender`: woman / man / nonbinary / undisclosed. Collected at T3 and A2.
`include_in_women_only` (default false) is offered **only** to nonbinary people; when
set, they are eligible for women-only crews and the women-only WhatsApp group.
Gender is a protected attribute: its purpose is stated in the privacy policy, and it
is **never shown on a profile** or anywhere per-person — it appears only in the
aggregate mix chip and in women-only eligibility.
Date of birth is used for the 19+ check, then only the year is kept.

### pin
A person saying they are going. Fields: gathering, person, `party_total` (integer
1–10, default 1), `open_to_meeting` boolean, created_at.
The UI offers alone / +1 / +2 / a group (enter a number); all map to `party_total`.
A +1 never counts toward "open to meeting" or the threshold, and never appears in the
reciprocal list until they claim (Q1, T10).
A pin can be edited or removed by its owner at any time.
Deleted 30 days after the gathering's effective end.

### crew
States: **forming → spot set → live → done**, or **forming → dissolved**.
- `forming` — created by one person; visible to others as joinable. No spot or time
  agreed yet. Any member may propose. Cannot move to `spot set` until it has 3
  members ("locks at 3, room for 8", A11).
- `spot set` — one curated spot and one time chosen. Others may request to join;
  any member may approve (Q4); declines are silent. Survives departures, even below 3:
  a spot and a time exist and people are coming.
- `live` — from 3 hours before the gathering's `starts_at`; "I'm here" check-ins unlock (Q7).
- `done` — after the gathering's effective end; the only remaining action is the
  we-met confirmation.

**Dissolving:** a crew still in `forming` with fewer than 3 members at 6 hours before
`starts_at` auto-dissolves; its members get one notification (A18 #3) pointing at the
other crews on that gathering. Only `forming` crews dissolve. `dissolved` is terminal
and the row is kept, never deleted — reports on it survive, and the rate at which
crews fail to form is a Test 0 metric. Dissolved crews disappear from A10 and the
crowd page; they stay visible to their own members and to admin.

**Capacity counts bodies:** a member may bring at most one +1, so a member occupies
1 or 2 of the 8 seats. This is independent of `party_total` — someone going with six
friends can still join a crew alone or with one of them.
**One crew per person per gathering**, enforced in the database among crews the
person has not left. Leaving a crew, or its dissolving, frees the person to join another.
At 8/8 a request offers a prefilled **sibling crew**, same spot, 15 minutes later (Q5).
A crew may be flagged **women-only**: open to `gender = woman` plus anyone with
`include_in_women_only` set, and invisible to everyone else (H7).

### neighbourhood
A fixed list, in this order: Liberty Village, King West, CityPlace, Fort York, Queen
West, Trinity Bellwoods, Ossington, Dundas West, Little Portugal, Little Italy,
Kensington Market, The Annex, Harbourfront, St. Lawrence, Church-Wellesley, Yorkville,
Leslieville, Riverside, The Danforth, Junction, Roncesvalles, High Park, Parkdale,
Leaside, Midtown, North York, Scarborough, Etobicoke, East York, Outside Toronto.
"Outside Toronto" always sorts last and is the catch-all for the GTA.

### crew thread
Exists because a crew exists. Auto-posts the crew card and house rules on creation.
Closes 24h after the gathering's effective end, read-only 30 days, then deleted (Q11).
The only messaging in Pin'd. No inbox, no DMs (H2).

### confirmation
Two kinds, both mutual-or-nothing and invisible until mutual (Q6):
- **we met** — mutual confirmation mints the "showed up" badge for both.
- **keep in touch** — unlocked per person only after a mutual "we met"; mutual ticks
  create a connection. Expires 72h after the gathering's effective end.

### connection
The result of a mutual keep-in-touch. Its only verb is **invite to a gathering**.
Not a chat list.

### block / report
Block is mutual invisibility everywhere, never notified. Report has four reasons:
made me uncomfortable / not who they said they were / under 19 / spam.
Severity is derived from the reason, never asked of the reporter. `is_safety` is
stored on the report, set from the reason at insert:
- **uncomfortable**, **under 19** → `is_safety = true` → the target is auto-hidden
  immediately, pending human review.
- **not who they said**, **spam** → the target is auto-hidden at two reports.
A report on a message snapshots the message body at insert, so the report stays
reviewable for its full 12 months after the thread is deleted.

---

## 2 · Test 0 — web + WhatsApp (T1–T10)

The dark, on-brand look (Alex, after M1.3): near-black background, purple `#582883`,
white text, the logo — matching the app and pindscene.com. Mobile-first. Must load in
under a second inside a Reddit tab and feel legitimate in a fan thread, not like a
startup. (Previously "white pages"; see decisions Part 5, "Look". Test 0's own
screens T3–T8 and T10 are superseded by the build direction in decisions Part 5.)
No account exists anywhere in Test 0; state is carried by a signed session cookie set
at pin-in, re-establishable by a magic link.

### T1 — Fan-channel post *(off-product artifact)*
A native Reddit or Discord post, not an ad. Honest count in the title, one link.
Example: "Going to Leafs vs Bruins Saturday alone? 23 others are — see who, pick a
spot, go in together" → the crowd page URL, with "23 pinned · 11 open to meeting".
The founder answers "is this a dating thing?" in the comments with the house rules.

### T2 — Crowd page, pre-pin
Public, no account, shareable. Contains:
- Event name, date, time, venue; share and report links
- The static map: **venue and its 3 meeting spots, never people** (H1)
- Counts: pinned, open to meeting, gender mix (Women · Men, plus Other when above zero;
  only at 5+ opted in — Q3)
- **House rules**, verbatim:
  1. Meet in public — named spots only, before the event.
  2. You see people only after they can see you.
  3. Leave any time. Block & report are one tap away.
- Primary action: **"Pin in — I've got a ticket"**; for free gatherings, **"Pin in —
  I'm going"** (§5)
- Footnote: names and photos unlock after you pin in and opt to meet
- Footer: block · report · leave any time · 19+

### T3 — Pin-in form
One screen, no account, no password:
- First name
- Photo **or** Instagram handle (Q2)
- Gender: woman / man / nonbinary / prefer not to say (needed for the women-only group,
  Q9). Nonbinary additionally offers "include me in women-only groups". Never shown to others.
- Neighbourhood — optional dropdown from the fixed list (see below)
- Who's coming: alone / +1 / +2 / a group (enter a number) → `party_total` (Q1)
- Checkbox: "I'd like to meet up with others going"
- Email **or** phone — one field, either works (Q8) — for one message when crews open
- Checkbox: "I'm 19 or older" (H8)
Copy: visible to others only after they pin in and opt to meet.

### T4 — Confirmation
"You're #14 pinned." Threshold explained plainly, with progress ("4 of 5 opted in ·
1 to go"). Actions: share this page, add to calendar, edit my pin, **remove my pin**.

### T5 — Threshold message *(off-product artifact)*
Sent **once per gathering**, when opt-ins reach 5, to every opted-in pinner, by SMS or
email depending on what they gave. Contains a magic link that re-establishes the
session on any device. SMS includes STOP opt-out.
This and the next-morning survey link are the **only two messages Test 0 sends**.

### T6 — Crowd page, pinned *(reciprocal state)*
Renders only behind a session that pinned **and** opted in (H3). Adds:
- "Going & open to meeting" list: first name · neighbourhood · alone/with friends.
  No tags in Test 0 — tags are app-only. **Never ordered by join time** (Q3). Closes
  24h after the gathering's effective end; counts stay readable.
- **Spot poll**: up to 3 curated spots with times and vote counts (H5; Alex, M1.3 — spots
  are optional to publish and needed when crews open); one vote per
  person per gathering, changeable
- "Join the WhatsApp group (14)" — link pasted by admin at threshold
- At 3+ eligible people opted in (women, plus nonbinary people who opted into
  women-only): a separate **women-only group** offer, shown only to eligible people.
  No number is ever displayed with it (Q9, H7)
- Footer: block · report · remove my pin

### T7 — WhatsApp group *(off-product artifact)*
One group per gathering (Q9). The company posts **once** — the seed message — and
leaves. Seed contains: member count and mix, the voted spot and time, house rules
(public spot only; everyone here pinned in and opted to meet; leave any time;
block/report on the crowd page), the finding-each-other convention ("first person
there posts 'I'm here' + what you're wearing"), the share-the-spot link, and
"We're not attending — have a great night."
Known cost: phone numbers are visible to all members. This is the app's opening argument.

### T8 — Next-day survey
Two questions plus a free-text escape hatch:
1. "Did you meet up with anyone from Pin'd?" — No / 1 or 2 / 3 to 5 / 6 or more
2. "Would you have gone alone anyway?" — Yes / No / I wasn't going to go at all
3. "Anything feel off?" (free text, emailed to a human)
These two questions measure the entire test: did strangers meet, and did Pin'd create
attendance or only company.

### T9 — This week's crowds *(landing)*
The only browse surface in Test 0. Grouped by day, **ordered by date, never by size**
(Q10). 10–20 gatherings over the next 14 days: name, venue, time, pin count, and
either "crews forming" or "crews open at 5". Small counts shown, never hidden.
Footer: suggest a gathering (a mailto link, nothing stored) · about · 19+.

### T10 — +1 claim page
Reached from a share link minted when someone pins with `party_total` > 1 (Q1). The friend adds a
first name and confirms 19+; no account. They then appear as "Rohan · with Dev".
Optionally adds an email or phone to receive the crews-open message.

### Also required, not a board screen
- **`/spot` share page** — read-only: gathering, spot, time. No names, no join link.
- **Admin** — behind Cloudflare Access, and the Worker verifies the Access token on
  every admin request (no admin table). Draft queue (source, AI score and reason;
  publish / dismiss / merge / edit), gathering edit (times, venue, event link, free,
  spot-poll times, main and women-only WhatsApp links), manual add as a fallback,
  venues with their spots and map image, approve or edit AI-suggested spots, per-gathering
  counts and pins, photo approval queue, reports and hidden people, delete a pin on
  request, CSV export (no contact details, no gender).

---

## 3 · iOS app (A1–A25)

Dark mode primary, light mode follows the system setting. Poppins headlines, SF Pro
body, SF Symbols icons, purple `#582883`. Four tabs: **Crowds · My Events ·
Connections · Profile**.

### A1–A4 — Onboarding (4 steps, under 90 seconds)
- **A1 sign in** — Continue with Apple / Continue with Google / Email me a code. No
  password path. Three positioning lines on screen one: "19+ · no location permission,
  ever · not a dating app".
- **A2 you** — first name; date of birth (**under 19 cannot continue**, H8); gender
  (woman / man / nonbinary / prefer not to say; nonbinary is offered "include me in
  women-only crews"; never shown on a profile); **face
  photo required** (Q2) with one line of why: "your crew looks for a face at a patio
  table". Photo passes the moderation gate before it is visible to anyone.
- **A3 neighbourhood + 3 tags** — neighbourhood from a fixed list, shown instead of
  location ("Pin'd never asks where you are"). Exactly 3 tags from a fixed list. Tags
  are conversation handles, **not match criteria** — there is no matching anywhere.
- **A4 how Pin'd works** — three cards: (1) Pin in; (2) Crews; (3) You're in control
  (leave any time, block & report two taps, no location, no DMs, women-only crews,
  share your crew's spot with a friend). The safety card is part of onboarding, never
  buried in settings.

### A5–A7 — Home: This Week's Crowds
List by day; the calendar is the ordering (Q10). Each row: event, venue, time, ticket
link out, pins, opt-ins, gender mix, crews badge. **No map, no feed, no algorithm.**
- **A5 empty** — real events with true zeros; "be the first" replaces the crews badge.
- **A6 sparse** — "3 pinned · crews open at 5" reads as progress. Mix chip appears only
  at 5+ opted in (Q3).
- **A7 populated** — crews badge is the only purple element per row.

### A8–A10 — Crowd page
- **A8 pre-pin** — same anatomy as T2 so a shared link feels continuous. Facts, the
  **only map in the app** (venue + named spots, never people, H1), counts, house rules,
  one button: "Pin in — I've got a ticket". Works logged-out via the share link.
- **A9 pinned, below threshold** — "Open to meeting" toggle; reciprocal list already
  works at n=2; **crews locked** with the reason and the number named ("3 of 5 · 2 to
  go · we'll push you the moment it happens"); nudge to share the page.
- **A10 pinned, crews open** — **crews sit above the people list**: the point is joining
  a plan, not browsing people. Each crew card: women-only flag, N/8, spot, time,
  members, "Request to join". Below: "Going & open to meeting" list. Tapping a person
  opens A22, **never a chat**.

### A11–A13, A15, A17 — Crew
- **A11 forming** — 3/8, spot selection from **the venue's curated list only** ("there
  is no enter-an-address"), three time options, votes. Any member may propose;
  "Set spot & time" moves the crew to spot set.
- **A12 spot set** — the crew card is the hero object. **"Share spot & time with a
  friend"** is a first-class button, not a menu item, and sends a read-only card with
  no join link. Incoming join requests show the requester's profile; **any member can
  approve** (Q4); declines are silent; the requester cannot see the thread until approved.
- **A13 live, "I'm here"** — unlocks 3 hours before. "Who's arrived" list with each
  member's one-line description. Tapping "I'm here" **requires** a line of text
  ("green Matthews jersey") — manual, never geofenced (Q7, H4). Arrivals also post to
  the thread.
- **A15 non-member view** — "Request to join"; the thread stays private until approved.
  At 8/8: "This crew's full — start one at the same spot, 15 min later?" → prefilled
  sibling crew (Q5). Women-only crews show a quiet label to others with nothing to tap.
- **A17 done** — terminal state; member count and check-in count; thread closure
  explained; the only action points at A16.

### A14 — Crew thread
Realtime group chat scoped to one crew. Opens with the auto-posted crew card and
rules. Long-press any message to report. No phone numbers are exchanged. Closes 24h
after the gathering; read-only 30 days; then deleted (Q11).

### A16 — After the event
Per crew member: **"we met"**, then **"keep in touch"** unlocked only once both said
they met. Ticks invisible until mutual; nobody learns they were ticked and not ticked
back (Q6). A mutual we-met mints the **"showed up"** badge for both. A mutual
keep-in-touch creates a connection and offers "Pin in to the next one together".

### A18 — Notifications (exactly five)
1. **Monday 6:00 PM** — this week's crowds digest → A7
2. **Threshold** — "5 people going to X want to meet up — crews are open" → A10
3. **Crew status** — formed / spot set / dissolved. Deep-links to the crew, or to the
   crowd page (A10) when dissolved.
4. **Day-of, ~3h before** — "Tonight: your crew meets at [spot] at [time] — tap when
   you're there" → A13
5. **Next morning** — "Did you meet up?" → A16

Nothing else. Never "someone viewed your profile". The rule is five moments, all
about a plan — a ban on engagement bait, not a count to defend.

### A19 — My Events
Upcoming (pinned, with crew and spot if any; one day-of reminder toggle) and past
(crew met / went solo). Empty: "Nothing pinned yet — this week's crowds →".

### A20 — Connections
People from your crews, with where you met them. The **only verb is "invite"**, which
opens this week's crowds to pick one. Deliberately not an inbox. Empty state explains
that connections come from crews.

### A21–A22 — Profile
- **A21 self** — face, first name + initial, neighbourhood, 3 tags, gatherings count,
  crews-met count, the **"showed up" badge** (the only badge in Pin'd). Edit profile;
  preview what others see. No followers, no grids, no bio.
- **A22 someone else** — visible only reciprocally. Shared context ("you're both pinned
  to Leafs vs Bruins"). **No message button, no like, no follow** — the absence is the
  design. "⋯" opens report and block.

### A23 — Safety & settings
Safety: blocked people, my reports, "women-only crews only" toggle.
Visibility: "Visible only after I pin in + opt in — **always on**" (not a setting),
show my neighbourhood. There is no "count me in the gender mix" setting (Alex, Phase 1
M1.1): anyone who doesn't want to be counted as a woman or man chooses "Prefer not to
say", which counts as Other, so Women + Men + Other always equals the open-to-meeting
count (Q3).
Notifications: the five, toggleable.
Data: export my data, delete account (in-app, required by both stores).
Note on screen: no location permission exists to manage — the app never asks.

### A24 — Report & block
Identical sheet from a profile, a crew card, or a long-pressed message. Two taps:
"⋯" then a reason — made me uncomfortable / not who they said they were / under 19 /
spam. Confirmation states a human reviews within 24h. Blocking never notifies (H9).

### A25 — Light mode
Same anatomy and the same purple; light surfaces for daytime browsing.

---

## 4 · Web surfaces that persist after the app ships

The Test 0 Worker becomes the app's public web layer:
- Crowd pages (the shareable link pasted into fan channels) — must work for
  non-users forever, with "open in the app" for those who have it
- This week's crowds
- The `/spot` share card
- The +1 claim page
- Admin and the moderation queue

Universal links open a crowd URL in the app when installed, the web page when not.

---

## 5 · Copy that is fixed

- Tagline: "Know where you're headed, find what you're looking for."
- One-liner: "See who's going, meet them there."
- Primary action: **"Pin in — I've got a ticket"**. For gatherings with `is_free = true`:
  **"Pin in — I'm going"** (Alex, Phase 1 M1.2).
- Threshold explanation: "Crews open when 5 people opt in."
- The three house rules, verbatim, on every crowd surface (see T2).
- Never use the phrase "not a dating app" in user-facing copy except the single
  onboarding line at A1. Use crew language everywhere else.

---

## 6 · Open items

### Where we are
- **Phase 0 complete** (commit `8f32061`): npm + pinned Supabase CLI, `supabase init`/link
  to pind-staging, `20260918033807_initial_schema.sql` applied — 25 tables, RLS on all,
  no policies, 30 neighbourhoods seeded; spec and decisions updated with Phase 0 answers.
- **Phase 1 M1.0 complete** (branch `phase1/m1-scaffold`): empty Test 0 Worker shell — plain
  TypeScript, hand-written router, HTML via template strings, `serviceClient` helper (service
  key server-side only, never to read people for a visitor). One route, `GET /health`, shows
  the neighbourhoods row count. Deployed as `pind-web-staging` on workers.dev only (no routes,
  no custom domains): https://pind-web-staging.pind.workers.dev/health → 30, checked on a
  phone. PindScene.com is a separate worker and was unchanged. README covers running locally,
  secrets and deploying.
- **Phase 1 M1.1 complete** (merged to `main`, commit `b496cf1`): RLS policies and the
  policy harness. Rules in plain English: `docs/visibility.md`. Five migrations on
  pind-staging: gender/age moved to owner-only `people_private`, WhatsApp links to
  `gathering_group_links`, `gatherings.published_at`, one spot vote per person per
  gathering, privileges + policies, private `photos` bucket, report auto-hide (H9).
  `npm run test:policies` passes 38/38 (P01–P37 plus P07b) on pind-staging. Anonymous
  sign-ins are on for pind-staging.
  **The independent adversarial review is pending** (`docs/m1.1-review-brief.md`). It
  is **not** a blocker for building. It is a gate before any real crowd sees each
  other (T6 with real people). Fixes from the review come as new migrations.
- **Phase 1 M1.2 complete** (branch `phase1/m1.2-admin`, merged to `main`): the admin.
  Gatherings arrive as drafts from Ticketmaster, the AI run or manual entry; AI vets and
  scores them; Alex publishes a handful per week (decisions Part 5). Four migrations on
  pind-staging: `ai` source; draft/published/dismissed status (derived from
  `published_at` + `dismissed_at`), merging, `event_url`, `is_free`, venue city
  (`cities`), venue map image; admin-only tables (`gathering_sources`,
  `gathering_triage`, `spot_suggestions`, `venue_aliases`, `venue_external_ids`,
  `moderation_log`); public `venue-maps` bucket; a trigger enforcing "3 approved spots
  to publish" and "zero pins to unpublish"; `admin_*` functions (service key only) for
  every admin action, each logged. Screens: draft queue, gathering edit (spot poll,
  WhatsApp links), manual add, published counts and pins, venues and spots with AI
  suggestions and map upload, photo queue, reports and hidden people, delete pin, CSV
  (no contact details, no gender). `/admin` is behind Cloudflare Access (self-hosted
  application on the workers.dev hostname, paths `admin` and `admin*`, "Alex only",
  one-time PIN; team domain `pind-social.cloudflareaccess.com`), and the Worker
  verifies the Access token on every admin request and accepts writes only from the
  admin's own pages. `npm run test:policies` 48/48 (P01–P47 + P07b),
  `npm run test:unit` 24/24, typecheck clean. Acceptance checked on device by Alex
  2026-09-18. Rules: `docs/visibility.md` V11, V12; review: `docs/m1.1-review-brief.md`
  (M1.2 section).
  **Staging seed data is left in place on purpose** (all tagged `[TEST]` / `pindseed`)
  for the next milestones; `npm run seed:staging -- --remove` deletes it.
- **Phase 1 M1.3 complete** (branch `phase1/m1.3-ticketmaster`, merged to `main`): the
  nightly Ticketmaster import and AI vetting. Three migrations on pind-staging
  (`20260918192…_m1_3_*`): city import settings, venue coordinates, source snapshots,
  admin-only `import_runs`, `gathering_flags`, `gathering_withdrawals`; the withdrawn
  state (V13); `admin_import_apply` and the other M1.3 `admin_*` functions. Worker
  cron `0 8 * * *` (4am EDT / 3am EST) and "Run import now". First real run on
  staging, 2026-09-18: 9 Ticketmaster calls, 1,319 listings, 772 kept, 744 drafts and
  74 venues created, 740 scored by Claude Sonnet 5 for **$0.77**; a second run created
  no duplicates. `npm run test:policies` 55/55 (P48–P54 new), `npm run test:unit`
  55/55, typecheck clean. Rules: `docs/visibility.md` V13 and §12d; review brief M1.3
  addendum. **Ready to check on device**: Alex checks tonight's 4am cron run summary
  in the admin. Decided (Alex, M1.3; detail in decisions Part 5): search 30 km around
  the city centre, 8 weeks ahead, with centre and radii on the `cities` row; a calculated distance adjustment to the AI score; event facts
  only, Ticketmaster's data deleted 30 days after effective end; no revenue from
  Ticketmaster data during Test 0 (any paid feature needs a terms review first); a
  privacy policy before public pages go live; the import filter; Sonnet 5 scoring with
  the approved rubric, a queue fold threshold of 70 (raised from 40 after the first
  run) and a $3/day cap; AI spot suggestions (10 venues
  a night); importer-dismissed drafts restore themselves, Alex-dismissed never do;
  flags on published gatherings; the **withdrawn** state; Worker cron on Workers Paid.
- **After M1.3 (same day): meeting spots are optional to publish** (Alex; decisions
  Part 5 "Meeting spots"). Migrations `20260918214318_m1_3_spots_optional` and its
  `_fix` on pind-staging; harness 55/55; deployed. The admin flags "crews open, no
  meeting spots".
- **The build direction changed** (Alex, decisions Part 5 "Build direction"): one
  Expo product for iOS and web; the Worker keeps admin, the import and AI jobs, and
  the fast public crowd pages; the WhatsApp-and-email Test 0 is dropped and the first
  real crowds run on the beta. Also decided, no code yet: scale with no manual work
  per event and demand-adaptive auto-publishing, automate by default, automated spot
  pools, generated maps, the dark look, "Put me in a crew", "Solo crew", and
  "Community & free" sourcing. **Test 0 screens T3–T8 and T10 are superseded, not next
  work**, until the revised plan is merged here.
- **Next step: a planning session** that produces the revised build plan. That plan
  sets the next milestones (it replaces the earlier order: T9/T2, "Community & free",
  T3/T4).
- **M1.3b, AI spot suggestions — parked** (split from M1.3 by Alex; not yet
  scheduled). The code is built but
  **off** (`AI_SPOT_SUGGESTIONS` in `wrangler.jsonc`, off unless `"on"`; the "Suggest
  spots now" button is hidden while off). Until then spots are added by hand in the
  admin; "Venues needing spots" on the draft queue lists where they are needed. What
  M1.3 learned, measured on 2026-09-18 with Sonnet 5, effort medium, 5 searches max:
  - **Timing varies widely:** one call took 43 s (Scotiabank Arena), the same request
    shape took 219 s for BMO Field. With the `web_search_20260209` tool most of the
    time goes into its built-in code-execution filtering step.
  - **Cost:** about $0.19–0.20 a venue (60–100k input tokens from search results).
  - **Empty answers:** the model sometimes called `propose_spots` with an empty list
    (BMO Field, where few staffed places are within 5 minutes' walk) — billed, nothing
    saved. The prompt now asks for the best 3 found, with what is weaker named in the
    reason; unproven.
  - **Mid-stream stalls inside the Worker:** a non-streaming call hit the SDK timeout
    (180 s) and its retries ate the cron budget; a streaming call could stall after
    the response started, where the SDK timeout no longer applies, and one run hung
    for over 40 minutes. Fixed in code but not yet proven on a full run: every call
    is streamed and aborted outright after **4 minutes** (`AbortSignal`), at most 1
    retry, and a venue is started only if its call can finish before the deadline.
  - **Basic `web_search_20250305`** was faster (57 s) but returned an empty list in its
    one trial, with more input tokens (99k).
  - **Quality:** suggestions came back for 2 venues (Scotiabank Arena in a direct
    test; Sneaky Dee's in a run, 3 pending on staging) — sensible but not perfect
    (one "east of the venue" was west). Alex's approval stays the gate.
  - **Cost blind spot:** a call aborted or killed mid-stream is billed but its usage
    never arrives, so it is missing from `import_runs` and the daily cap undercounts.
    M1.3b should count an estimate for every aborted call.
  - M1.3b should: prove the fixes on a full run, consider running suggestions outside
    the nightly import (their own cron or a queue), and measure empty-answer rates.
  - Local testing note: on Windows, stopping a background `wrangler dev` did not kill
    its `workerd` children; two local Workers then raced for the run lock. Kill the
    whole process tree (`taskkill /T /F`) between local runs.
- **Open (Alex, M1.3): people pinned to a published gathering are not told when its
  date changes.** Applying a new date from a flag updates the page only; Test 0 sends
  just two messages (T5, T8). Decide before the first real crowd whether a date change
  needs a message.
- **Done in M1.3** (recorded by Alex in M1.2): the importer must detect
  date or status changes (cancelled, postponed, rescheduled) on **published**
  gatherings and flag them in the admin for Alex. It never changes a published
  gathering silently.
- **For the photo step (was T3; under the new direction, the app's required face
  photo, A2), recorded by Alex in M1.2: automated photo moderation**
  (decisions Part 5). On upload, a Claude vision check auto-approves clear real-person
  photos, auto-rejects clearly inappropriate ones (the person stays visible without a
  photo), and sends uncertain cases (possible minor, not a real person, possibly
  someone else's photo) to the admin photo queue built in M1.2. It never decides
  "under 19" alone; it only flags for review. Reports and auto-hide stay the backstop.
  T3 work: the check itself; each automated decision recorded in `moderation_log`
  like an admin decision; `docs/visibility.md` V6 updated (today it says a photo shows
  only after **admin** approves it); the privacy policy states that photos are checked
  automatically. The Anthropic key is a Worker/Edge Function secret, never committed.
- **Superseded by the build direction** (were open for Test 0): T5 new-device sign-in
  (Supabase Auth email sign-in linked to the anonymous user, or a narrow service-key
  exception); T10 +1 claim; the anonymous sign-in per-IP rate limit when the Worker
  signs visitors in (T3). The revised plan decides what replaces them.
- **Deferred** to retention and account deletion (detail below): gathering delete must
  not cascade pins and survey responses; person delete must not remove confirmations.

### Before the first real crowd
All must be true before real people can see each other (now the first beta crowds;
items that only applied to the WhatsApp Test 0 are marked superseded, not deleted):
- [ ] pind.social is live (decisions Part 5). *Superseded in part:* "email sending set
  up on it" was for Test 0's threshold emails; the revised plan decides what messaging
  the beta needs.
- [ ] an independent adversarial review of the visibility rules: a fresh Claude Code
  session with no prior context, tasked only with finding leaks, using
  `docs/m1.1-review-brief.md` (including its M1.2 and M1.3 sections) as its input
- [ ] Alex's own read of `docs/visibility.md`
- [ ] a decision on whether real beta data lives on pind-staging or a production project
- ~~T5 new-device sign-in is decided~~ — *superseded, not done*: WhatsApp Test 0 only
  (decisions Part 5, "Build direction")
- [ ] a decision on whether people pinned to a published gathering get a message when
  its date changes (open item above, Alex M1.3)
- [ ] a privacy policy is published covering Ticketmaster data, the automated photo
  checks and gender (decisions Part 5, Alex M1.3)

### Deferred cascades
Deferred to the retention and account-deletion milestone. The initial schema does not
yet satisfy these; they must be fixed there.

- **Deleting a gathering must not take pins and survey responses with it.** Today
  `pins`, `survey_responses` (and the other Test 0 rows) cascade on gathering delete.
  `decisions.md` keeps aggregate counts after pins are deleted, and the Test 0 survey
  data is the whole point of the test.
- **Deleting a person must not remove their confirmations.** Today `confirmations`
  cascades on person delete, so a crewmate can lose their "showed up" badge because
  someone else left.
