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

One product (Alex, revised build plan, 18 Sept 2026; `docs/build-plan.md`):
- **The product** — built once in Expo for iOS and web (screens A1–A29). The web build
  is the complete product, not a preview; the first real crowds run on it.
- **The public web layer** — the Worker's fast public pages (W1–W4, §2) that a Reddit
  or Discord link lands on, leading into the product.

---

## 1 · Core objects and lifecycles

### gathering
A real public event. Arrives as a **draft** from the nightly Ticketmaster import, the
weekly Community & free run (M4.4), or manual entry (fallback), and is public only once
it is published — by the auto-publisher (§8) or by Alex (decisions Part 5, "Gathering
sourcing"). Fields: name, starts_at,
`ends_at` (nullable), venue, `event_url` (tickets or event info; optional), `is_free`,
`featured` flag, status (draft / published / dismissed / withdrawn),
`publish_mark` (null / publish / never — Alex's marks for the auto-publisher, §8), and
`review_only` (boolean, default false). A published gathering also carries any number
of **promotion** records (`gathering_promotions`): where the team posted it, who
posted it and when, ticked as it happens. They are what "seeded" means in §8, and
nothing else reads them. A **review-only** gathering exists only for
App Review: it is visible only to review-only people and admin, and never appears in
lists, counts or the digest. Nothing in it is ever visible to a real person, so H6
holds (decisions Part 5, "Review-only gatherings"). **Withdrawn**
(Alex, M1.3) applies only to a published gathering that is off — cancelled, postponed,
a takedown request or other — even with pins: it leaves every public list, pins are
kept, and pinned people see a short neutral notice ("This gathering is no longer on
Pin'd. Your pin is kept; there's nothing you need to do.") instead of a dead page.
The map showing the venue and its meeting spots belongs to the **venue**: generated
from their coordinates, with an uploaded image as an optional override. Venues have a city (Toronto
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
**Anonymous person:** created at quick pin (A26) with a first name and the 19+
attestation, as a Supabase anonymous user. It becomes **permanent at opt-in** (A27) by
linking an email (one-time code), Apple or Google identity; the id never changes, so
the pin survives. A person who never opts in is deleted with their last pin.
Date of birth, gender and the photo are collected at opt-in (A27) on the link
path, and at A2 on the store path.
Self-declared `gender`: woman / man / nonbinary / undisclosed.
`include_in_women_only` (default false) is offered **only** to nonbinary people; when
set, they are eligible for women-only crews.
Gender is a protected attribute: its purpose is stated in the privacy policy, and it
is **never shown on a profile** or anywhere per-person — it appears only in the
aggregate mix chip and in women-only eligibility (crews, and solo's "women only").
Date of birth is used for the 19+ check, then only the year is kept.
`hidden_from_solo` (default false): set at insert by **any** report on the person,
whatever the reason; it removes them from every solo list (§1 block / report).
**Instagram handle** (Alex, revised build plan): optional on the profile, never
required, and never a substitute for the photo. Visible **only** to the person's
crewmates, their solo-plan partner and their connections — never on the "going & open
to meeting" list, never on any public page, never in link previews (H2, and solo's
mutual accept). Enforced in the database with harness cases when the profile is built
(M3.1; `docs/visibility.md`, pending rule V17).

### pin
A person saying they are going. Fields: gathering, person, `party_total` (integer
1–10, default 1), `open_to_meeting` boolean, `solo_opt_in` boolean (default false),
`solo_visibility` (everyone | women_only; chosen on the solo opt-in sheet, A28),
created_at.
The UI offers alone / +1 / +2 / a group (enter a number); all map to `party_total`.
`open_to_meeting` requires a permanent identity and a submitted photo (A27); a pin
without them still counts in N pinned.
A +1 never counts toward "open to meeting" or the threshold, and never appears in the
reciprocal list. There is no claim page: a +1 who wants to be seen pins in themselves
through the share link (Q1).
A pin can be edited or removed by its owner at any time.
Deleted 30 days after the gathering's effective end.

### crew
`kind`: **crew** (the default) or **solo**. Everything below about sizes — "3–8",
"locks at 3", requests, sibling crews — applies to `kind = 'crew'`. A **solo plan**
(`kind = 'solo'`) has exactly 2 seats, is created by an accepted proposal (below),
takes no join requests, and is invisible to everyone but its two members. It inherits
every state, the thread, "I'm here" and the confirmations unchanged (decisions Part 1,
decided exception). A person may be in one crew and one solo plan at the same gathering.

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
crews fail to form is a beta metric (§7). Dissolved crews disappear from A10 and the
crowd page; they stay visible to their own members and to admin.

**Capacity counts bodies:** a member may bring at most one +1, so a member occupies
1 or 2 of the 8 seats. This is independent of `party_total` — someone going with six
friends can still join a crew alone or with one of them.
**One crew per person per gathering**, enforced in the database among crews the
person has not left. Leaving a crew, or its dissolving, frees the person to join another.
At 8/8 a request offers a prefilled **sibling crew**, same spot, 15 minutes later (Q5).
A crew may be flagged **women-only**: open to `gender = woman` plus anyone with
`include_in_women_only` set, and invisible to everyone else (H7).

### proposal
How a solo plan starts (A29). Fields: gathering, from person, to person, spot (from
the venue's list only), time, preset line (one of five; §5), status: **open →
accepted / declined / expired**. Accept creates a solo plan; a decline sends nothing
(as Q4). Limits: 3 open proposals per person per gathering, 1 per pair. Every open
proposal expires at the gathering's `starts_at`. There is no free-text field.

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
Separately, **any** report on a person sets `hidden_from_solo` immediately, whatever
its reason and independent of `is_safety`.
A report on a message snapshots the message body at insert, so the report stays
reviewable for its full 12 months after the thread is deleted.

---

## 2 · The public web layer on the Worker (W1–W4)

The dark, on-brand look (Alex, after M1.3): near-black background, purple `#582883`,
white text, the logo — matching the app and pindscene.com. Mobile-first. Must load in
under a second inside a Reddit tab and feel legitimate in a fan thread, not like a
startup. (Previously "white pages"; see decisions Part 5, "Look".)
These pages need no account. Everything with a session — pinning in, opting in, the
reciprocal list, crews — is the Expo product (§3), served from the same host (§4).
The Test 0 screens T3–T8 and T10 are deleted (decisions Part 5, "Build direction").
Built in M2.1.

### T1 — Fan-channel post *(off-product artifact)*
A native Reddit or Discord post, not an ad. Honest count in the title, one link to W2.
Example: "Going to Leafs vs Bruins Saturday alone? 23 others are — see who, pick a
spot, go in together" → the crowd page URL, with "23 pinned · 11 open to meeting".
The founder answers "is this a dating thing?" in the comments with the house rules.

### W1 — This week's crowds *(landing; was T9)*
The public browse surface. Grouped by day, **ordered by date, never by size** (Q10).
Published gatherings: name, venue, time, the chip a reader filters by, what it costs to
walk in, and one line about the crowd. Small counts shown, never hidden, including zero.
**The threshold never leads**: a row short of five says nothing about five (Alex,
closing M2.3). The crowd line has two states — "0 pinned · be the first" and "3 pinned · see
who's going". **Crew state is not on the card**: it belongs on the page you land on
(Alex, closing M2.3).
The header carries the mark top left and the wordmark top right (Alex, closing M2.3).
Each row also carries **one short line saying what it is**, where a source knew
something, and nothing at all where none did, because a restatement of the title is
worth less than a blank. W2 carries that line, a second on what makes this one worth
turning up to, and a link out: **Tickets** for a ticket page, **Learn more** for an
organiser's. Footer: suggest a gathering (a mailto link,
nothing stored) · about · 19+.

**A list of fifty is a different screen from a list of five** (built in M2.3):
- **Two tabs, split on `source`** — **Events** is the Ticketmaster feed at `/`,
  **Community** is everything entered by hand and, later, M4.4's run, at `/community`.
  No editorial call per gathering. Both tabs are always shown; one of them being empty
  this week is a fact about the week, not a reason to move the furniture.
- **Category chips within a tab, never across it**, multi-select, showing the union of
  what is chosen. **A filter that narrows, never a sort that reorders**: the order of
  what remains is the unfiltered order (Q10). Unfiltered is the default, and a chip
  appears only where there are **three gatherings at two venues** on the page
  (`CHIP_MIN_*`), counted before any chip is applied — so no chip can filter to an
  empty page and none advertises an absence.
- **Today and tomorrow are named**, then the rest of the week by date, with the day's
  count beside each heading.
- **One week at a time, with a pager** forwards and back. Everything — tab, chips,
  both ends of the pager — is a server-rendered link with query parameters: no
  client-side JavaScript, nothing that costs the one-second budget.

### W2 — Crowd page, pre-pin *(was T2)*
Public, no account, shareable. Contains:
- Event name, date, time, venue; share and report links
- The generated map: **venue and its meeting spots, never people** (H1) — a schematic
  SVG drawn from the venue's and spots' coordinates (decisions Part 5, "Maps generated
  automatically"); an uploaded image is an optional override
- **Headed "Who else is going?"**, with the counts under it as the answer: pinned, open
  to meeting, gender mix (Women · Men, plus Other when above zero; only at 5+ opted in
  — Q3), and the threshold explanation as a quiet line beneath rather than the message
  (Alex, closing M2.3). The pinned page leads with "Find your crew" instead (A9/A10,
  M3.3), where forming one is the next action.
- **House rules**, verbatim (Alex, after the M2.1 on-device walk):
  1. Make friends how you used to — in person.
  2. You see each other, or neither of you does.
  3. Come as you are. No pressure, no commitment.

  then, underneath, styled as a fact rather than a fourth rule:
  **"Crews meet at a spot near the venue before doors."** That line is **not
  decoration** — it is what App Review is pointed at under Guideline 1.2, and what
  says meetings happen somewhere public, before the event (H5, H10). It stays on
  every crowd surface.
- Primary action: **"Pin in — I've got a ticket"**; for free gatherings, **"Pin in —
  I'm going"** (§5). It opens the product's quick pin (A26) at `/g/<slug>/pin`. If a
  signed-in session exists in this browser, a small script swaps the button to
  "Open"; the page still works with JavaScript off.
- Footnote: names and photos unlock after you pin in and opt to meet
- Footer: block · report · leave any time · 19+
A withdrawn gathering shows a short neutral "no longer on Pin'd" and no counts.

### W3 — Share card (`/g/<slug>/spot`)
Read-only: gathering, spot, time. No names, no join link.

### W4 — Link machinery
- OG tags and a generated, dark, branded OG image per gathering: event, date, venue,
  "See who's going, meet them there." **No counts** — a preview is cached at post
  time and a stale number would be a dishonest one (H6).
- `/.well-known/apple-app-site-association` with the app's IDs (universal links).
- An `.ics` route for "add to calendar".

### Admin *(not a board screen)*
Behind Cloudflare Access, and the Worker verifies the Access token on every admin
request (no admin table). Draft queue (source, AI score and reason; publish / dismiss /
merge / edit; "publish" and "never" marks, M2.2), the Publishing panel (M2.2),
gathering edit (times, venue, event link, free, spot-poll times), manual add as a
fallback, venues with their spots and map image, approve or edit AI-suggested spots,
per-gathering counts and pins, photo queue, reports and hidden people, delete a pin on
request, CSV export (no contact details, no gender), and later the Metrics page (M4.5).
The gathering edit's **main and women-only WhatsApp link fields are unused leftovers
from Test 0**: built in M1.2, left in place for now, removed in a later code milestone.
Moves from workers.dev to `pind.social/admin` in M2.1.

---

## 3 · The product — Expo for iOS and web (A1–A29)

One codebase for the iOS app and the web build (decisions Part 5, "Build direction").
**Dark always**, whatever the phone is set to (Alex, M2.0; decisions Part 5, "Dark
only"). There is no light mode for now. Poppins headlines, SF Pro
body (system font on the web), SF Symbols icons, purple `#582883`. Four tabs:
**Crowds · My Events · Connections · Profile**.

**Two doors, one product** (Alex, revised build plan):
- **Link path** (most people at first): crowd page W2 → **A26 quick pin** (~30 s, no
  account, no photo) → **A27 opt in**, only if they ticked "I'd like to meet up" →
  one safety sheet → crews or solo. Neighbourhood and tags are optional here, nudged
  later ("add 3 tags so your crew has something to say").
- **Store path** (after launch): install → A1–A4 onboarding → this week's crowds → pin
  in with one tap. The store path keeps A1–A4 as designed.

### A1–A4 — Onboarding, store path (4 steps, under 90 seconds)
- **A1 sign in** — Continue with Apple / Continue with Google / Email me a code, **on
  the web and in the app alike** (Alex, M3.1 — Apple on the web was "later" until the
  Services ID was built; decisions Part 5, "Sign in with Apple on the web"). No
  password path. Three positioning lines on screen one: "19+ · no location permission,
  ever · not a dating app".
- **A2 you** — first name; date of birth (**under 19 cannot continue**, H8); gender
  (woman / man / nonbinary / prefer not to say; nonbinary is offered "include me in
  women-only crews"; never shown on a profile); **a
  photo required** (Q2) with one line of why: "A photo of you makes it easier to find
  each other" (Alex, M3.1 — the photo need not be a face; decisions, "The photo check
  holds almost nothing now"). The photo shows as soon as it is uploaded, to the people
  who can see you; the automated check runs afterwards and can only remove it
  (decisions, "Nothing waits on the photo check"). Optional Instagram handle, never a
  substitute for the photo, shown only to crewmates, a solo-plan partner and
  connections (§1 person).
- **A3 neighbourhood + tags** — neighbourhood from a fixed list, shown instead of
  location ("Pin'd never asks where you are"). **At least 3 and at most 10 tags** from
  a fixed list of 32 in four groups, and the person chooses **which 3 show on the
  "going & open to meeting" row**; the profile shows them all (Alex, M3.1). Tags are
  conversation handles, **not match criteria** — there is no matching anywhere. "At
  least 3" defines a complete profile and is asked by the screen, never the database;
  on the link path neighbourhood and tags are optional and nudged later, never a gate
  before a pin. Tags are editable later from Profile, with the same picker.
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
- **A8 pre-pin** — same anatomy as W2 so a shared link feels continuous. Facts, the
  **only map in the app** (venue + named spots, never people, H1), counts, house rules,
  one button: "Pin in — I've got a ticket". Works logged-out via the share link.
- **A9 pinned, below threshold** — "Open to meeting" toggle; reciprocal list already
  works at n=2; **crews locked** with the reason and the number named ("3 of 5 · 2 to
  go · we'll push you the moment it happens"); nudge to share the page.
- **A10 pinned, crews open** — **crews sit above the people list**: the point is joining
  a plan, not browsing people. Each crew card: women-only flag, N/8, spot, time,
  members, "Request to join". **"Put me in a crew"** (Alex, revised build plan; M3.3):
  one button that places the person in the open crew with the most room, respecting
  women-only. Below: "Going & open to meeting" list. Tapping a person opens A22,
  **never a chat**. Below that, the **1-on-1 section** (A29), rendered only for
  solo-opted people; the crew list is untouched by it. "Get the app" is offered once,
  here, when crews open.

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

#### Crew vibe — presets, shown on the crew card (Alex, M2.1; built in M3.3)

Someone choosing between two open crews has **nothing to choose on** today. A crew can
say what kind of night it is.

- **Presets, never free text.** Free text on a forming crew is an unmoderated surface
  visible to strangers before anyone has met, and it is where the product acquires copy
  nobody wants attributed to it.
- Set by whoever starts the crew, **changeable by any member**, shown on the crew card
  (A12) and in the crews list (A10).
- **The test for any chip: would most crews tick it?** If yes, cut it — a vibe everyone
  shares tells nobody anything. That is why there is no "love meeting new people":
  everyone on the list already opted into meeting people.
- **Nothing about substances, and nothing that reads as a dating signal.** Cap it around
  nine, or it stops being a glance and becomes a form.

Starting set, **Tatiana's to rewrite**, grouped so they help someone choose:

| Timing | The night | The company |
|---|---|---|
| getting there early | quiet pint first | first time here |
| just walking in together | out all night | happy to explain the rules |
| staying after | food before | small and chatty |

### A14 — Crew thread
Realtime group chat scoped to one crew. Opens with the auto-posted crew card and
rules. Long-press any message to report. No phone numbers are exchanged. Closes 24h
after the gathering; read-only 30 days; then deleted (Q11).

### A16 — After the event
Per crew member: **"we met"**, then **"keep in touch"** unlocked only once both said
they met. Ticks invisible until mutual; nobody learns they were ticked and not ticked
back (Q6). A mutual we-met mints the **"showed up"** badge for both. A mutual
keep-in-touch creates a connection and offers "Pin in to the next one together".
The same screen serves a solo plan's two members.
**One question for everyone who was opted in** (moved from Test 0's T8): "Would you
have gone alone anyway?" — Yes / No / I wasn't going to go at all. It is the
**attendance metric** (§7): did Pin'd create attendance, or only company.

### A18 — Notifications (exactly five)
1. **Monday 6:00 PM** — this week's crowds digest → A7
2. **Threshold** — "5 people going to X want to meet up — crews are open" → A10
3. **Plan status** — formed / spot set / dissolved / **gathering date changed or
   withdrawn** (Alex, revised build plan). Deep-links to the crew, or to the crowd page
   (A10) when dissolved, changed or withdrawn.
4. **Day-of, ~3h before** — "Tonight: your crew meets at [spot] at [time] — tap when
   you're there" → A13
5. **Next morning** — "Did you meet up?" → A16

Nothing else. Never "someone viewed your profile". The rule is five moments, all
about a plan — a ban on engagement bait, not a count to defend.
**Every notification is mirrored by email to people without a device token** (web-only
people), through Resend on pind.social; the digest email has an unsubscribe link.
SMS is never used (decisions Part 5, "Email delivery", "Notification delivery").

### A19 — My Events
Upcoming (pinned, with crew and spot if any; one day-of reminder toggle) and past
(crew met / went solo). Empty: "Nothing pinned yet — this week's crowds →".

### A20 — Connections
People from your crews, with where you met them. The **only verb is "invite"**, which
opens this week's crowds to pick one. Deliberately not an inbox. Empty state explains
that connections come from crews.

### A21–A22 — Profile
- **A21 self** — photo, first name + initial, neighbourhood, their tags, gatherings count,
  crews-met count, the **"showed up" badge** (the only badge in Pin'd), and the
  optional Instagram handle (add, edit, remove). Edit profile; preview what others
  see — the preview shows that the handle is visible only to crewmates, a solo-plan
  partner and connections. No followers, no grids, no bio.
- **A22 someone else** — visible only reciprocally. Shared context ("you're both pinned
  to Leafs vs Bruins"). The Instagram handle appears **only** when the viewer shares a
  crew or a solo plan with the person, or is a connection — never from the "going &
  open to meeting" list alone. **No message button, no like, no follow** — the absence
  is the design. "⋯" opens report and block.

### A23 — Safety & settings
Safety: blocked people, my reports, "women-only crews only" toggle.
Visibility: "Visible only after I pin in + opt in — **always on**" (not a setting),
show my neighbourhood. There is no "count me in the gender mix" setting (Alex, Phase 1
M1.1): anyone who doesn't want to be counted as a woman or man chooses "Prefer not to
say", which counts as Other, so Women + Men + Other always equals the open-to-meeting
count (Q3).
"Meet 1-on-1" appears here only as a summary of the per-gathering setting (on at which
gatherings, and who can see you); it is switched on and off on the pinned crowd page
(A28), never here.
Notifications: the five, toggleable.
Data: export my data, delete account (in-app, required by both stores).
Note on screen: no location permission exists to manage — the app never asks.

### A24 — Report & block
Identical sheet from a profile, a crew card, or a long-pressed message. Two taps:
"⋯" then a reason — made me uncomfortable / not who they said they were / under 19 /
spam. Confirmation states a human reviews within 24h. Blocking never notifies (H9).

### A25 — Light mode *(dropped for now)*
On the board: same anatomy and the same purple, with light surfaces for daytime
browsing. **Not built** (Alex, M2.0): the app is dark always (decisions Part 5, "Dark
only"). It returns only by a new decision.

### A26 — Quick pin *(link path; new)*
Reached from W2's button at `/g/<slug>/pin`. One screen, no account, no photo:
- First name
- Who's coming: alone / +1 / +2 / a group (enter a number) → `party_total` (Q1)
- Checkbox: "I'd like to meet up with others going" (unticked)
- Checkbox: "I'm 19 or older" (H8 attestation; the date-of-birth hard stop comes at A27)
→ pinned, as a Supabase anonymous user; the pin is a real row under RLS. About 30
seconds. Then: "You're #14 pinned", the threshold with progress ("4 of 5 opted in · 1
to go"), share this page, add to calendar, edit my pin, remove my pin.

### A27 — Opt in *(link path; new)*
Only for someone who ticked "meet up" (or turns it on later). One screen more:
- Date of birth — **under 19 stops here**, no soft fail (H8); only the year is kept
- Gender: woman / man / nonbinary / prefer not to say; nonbinary is offered "include me
  in women-only crews"; never shown to others
- A photo (Q2; it need not be a face), with the automated check and its pending state
- A way to reach you: email me a code, Continue with Apple or Continue with Google, on
  the web and in the app (Alex, M3.1)
- Optional Instagram handle (§1 person)
→ the anonymous user becomes permanent with the same id; the pin, party size and
opt-in survive. Then **one safety sheet** (the link path's version of A4): *crews are
3–8 people at a public spot before the event; leave any time; block and report are two
taps away; women-only crews on every gathering.* Accepting the privacy policy and terms
happens here.

### A28 — Solo opt-in sheet *(new)*
A second toggle on the **pinned** crowd page, below the crews section, labelled
**"Meet 1-on-1"** ("solo crew" is the internal name only). Off by default, separate from
the crew opt-in. Tapping it opens a sheet: what it is, that it is optional, that
meetings happen only at the venue's public spots, and a **forced choice** of who can
see you — "everyone who opted in" or "women only" (no default). Never in onboarding,
never in the digest, never in the store listing or screenshots.

### A29 — Proposals and plan *(new)*
- **The 1-on-1 section** of the pinned crowd page, below crews, rendered only for
  solo-opted people: the solo-opted people the database lets you see (§1 pin, decisions
  Part 1 exception).
- **A proposal**: a spot from the venue's list, a time, and one of **five preset lines**
  (§5). No free-text field. The recipient accepts or declines; a decline sends nothing.
  Limits and expiry as §1 proposal.
- **The plan card**: on accept, a solo plan (a crew with `kind = 'solo'`) with the same
  card, thread (A14), "I'm here" (A13) and after-event flow (A16) as a crew.
- Block and report two taps away; any report removes the person from every solo list
  immediately.

---

## 4 · Where things live: Worker, Expo, Postgres

(Alex, revised build plan; `docs/build-plan.md` §2.)

**One rule decides the boundary.** If it is public, it is the Worker. If it needs a
session, it is Expo. If it is time-driven, it is pg_cron in Postgres. If it decides who
sees whom, it is a policy in Postgres (H11). If it sends anything or calls an AI, it is
the Worker. Nothing is built twice.

| Surface or job | Lives in | Why there |
|---|---|---|
| This week's crowds (W1), the crowd page before you pin (W2), the `/spot` share card (W3), the OG image, the universal-link file, the PindScene.com redirect | **Worker** (HTML from template strings, dark look) | Must load in under a second inside a Reddit tab, work with no account, and be indexable. Reads counts through the anon key and RLS, never the service key. |
| Admin, draft queue, venues and spots, moderation queues, metrics page, publishing panel | **Worker** behind Cloudflare Access | Built. Moves from workers.dev to pind.social/admin in M2.1. |
| Nightly Ticketmaster import, AI vetting, auto-publishing fill, the weekly adaptive adjustment, the Community & free discovery run, spot suggestions (M5.2) | **Worker cron** | The Anthropic key already lives there; M1.3b's streaming-and-abort lessons apply to every AI call. |
| Delivering push and email | **Worker cron** every 5 minutes, reading `notification_queue` | The database decides *what* (a trigger enqueues when opt-ins reach 5, a crew changes state, a date changes); the Worker decides *how* (Expo Push API for devices, Resend for web-only people). One place to retry, one log. |
| The AI photo check | **Worker endpoint** called by a database webhook on the new photo row | The app uploads and inserts; the check is asynchronous with a pending state (V6); the decision lands in `moderation_log` with actor `ai:photo-check`. |
| Pin in, opt in, complete profile, photo upload, the reciprocal list, crews, solo, the thread, "I'm here", the morning after, connections, My Events, settings, report and block | **Expo** — iOS app and web build, one codebase | Everything with a session. The web build is the complete product, not a preview: the first real crowds run on it. |
| Crew live/done/dissolve, thread close and delete, keep-in-touch expiry, pin deletion, Ticketmaster data purge, metrics snapshots | **pg_cron** | Time-driven and keyed off the effective end; no app or Worker code path can forget to run them. |
| Reciprocity, blocks, women-only, hidden people, solo visibility, review-only gatherings, Instagram handles | **RLS policies** + `private.can_see_at` | H11. The harness is the test suite; the adversarial review is the audit. |

**Hosting the web build.** The Expo web export ships as the Worker's static assets on
the *same host*. The Worker renders its own routes first (`/`, `/g/<slug>`,
`/g/<slug>/spot`, `/og/*`, `/admin*`, `/hooks/*`, `/.well-known/*`, `/health`);
everything else falls through to the app's `index.html` with single-page-app fallback,
so `/g/<slug>/pin`, `/crew/<id>`, `/me` and the rest are app routes. One domain, one
`wrangler deploy`, one universal-link file, no CORS, and the shared link is always the
crowd page. Universal links open a crowd URL in the app when installed, the web page
when not; Reddit's in-app browser does not always honour them, which is one more reason
the web build must be the complete product.

---

## 5 · Copy that is fixed

- Tagline: "Know where you're headed, find what you're looking for."
- One-liner: "See who's going, meet them there."
- Primary action: **"Pin in — I've got a ticket"**. For gatherings with `is_free = true`:
  **"Pin in — I'm going"** (Alex, Phase 1 M1.2).
- Threshold explanation: "Crews open when 5 people opt in."
- The three house rules, verbatim, on every crowd surface (see W2), and under them
  "Crews meet at a spot near the venue before doors." Rewritten by Alex after the M2.1
  walk: **the safety property each line describes is unchanged, only how it is said.**
  Block and report leave the front-page rules and stay **two taps away everywhere in
  the product** (H9), which M3.5's acceptance already requires.
- Never use the phrase "not a dating app" in user-facing copy except the single
  onboarding line at A1. Use crew language everywhere else.

### The voice — a full pass is owed before the first real crowds

(Alex, M2.1. With Tatiana.)

Pin'd's position is that it creates **real human connection** — people meeting properly,
in person, comfortably. Most screens today read like a **safety notice**, which is the
wrong register for a product whose whole pitch is meeting people.

- **The three house rules stay verbatim** on every crowd surface. They are safety copy,
  they are what makes a stranger trust this, and they are what App Review is pointed at
  under Guideline 1.2. They are never softened.
- **Everything else is an invitation**: empty states, buttons, the crews section,
  nudges, onboarding, confirmations. Warm, low-commitment, curious. Closer to *"find a
  good spot, meet people who are going anyway"* than *"named spots only, before the
  event."*
- **Never write anything implying you can message someone first and decide later.**
  There are no DMs, and solo has no free text before a mutual accept. Copy that suggests
  otherwise describes a different app.

M2.1 wrote its own non-house-rule copy in this register — W1's empty state, the line
under W2's button, the map caption, the headings, the not-found pages and `/about`. The
**full pass across every screen is owed before the first real crowds**, done once and
properly with Tatiana rather than drifted into screen by screen.

*Each piece marked **Draft** below was written by Claude when the plan was merged and
is **not final copy**: only the label "Meet 1-on-1" and preset line 1 come from the
plan, and the withdrawn notice is Alex's (M1.3).*
- **Solo opt-in sheet** (A28; Alex, revised build plan): toggle label **"Meet 1-on-1"**
  (final). Sheet — **Draft — Alex and Tatiana to replace before the milestone that
  ships it (M3.4):** "Meet 1-on-1 is optional. You'll only see — and be seen by —
  people who also turned it on for this gathering. Meetings happen only at this venue's
  public spots. Choose who can see you:" → **Everyone who opted in** / **Women only**
  (the forced choice with no default is decided, not draft).
- **The five preset lines** for a proposal (A29). Line 1 is from the plan; lines 2–5
  are **Draft — Alex and Tatiana to replace before the milestone that ships it
  (M3.4)**; Tatiana writes the final five:
  1. "Meet at [spot] at [time] and walk in together?"
  2. "Grab a drink at [spot] at [time] before it starts?"
  3. "I'll be at [spot] at [time] — want to meet there?"
  4. "Going alone too — meet at [spot] at [time]?"
  5. "Quick hello at [spot] at [time], then head in?"
- **"Get the app"** nudge, shown once, when crews open — **Draft — Alex and Tatiana to
  replace before the milestone that ships it (M3.2):** "Crews are open. Get the app to
  hear the moment your crew sets a spot."
- **Plan status, date change** (A18 #3) — **Draft — Alex and Tatiana to replace before
  the milestone that ships it (M3.5):** "[Gathering] has moved to [new date and time].
  Your pin is kept — check your crew's plan." Withdrawn (final; Alex, M1.3): "This
  gathering is no longer on Pin'd. Your pin is kept; there's nothing you need to do."

---

## 6 · Milestones and open items

### Where we are
The milestones come from the revised build plan (`docs/build-plan.md` §8, Alex, 18 Sept
2026). Each is one branch and one Claude Code session with its acceptance list —
copied from the plan — pasted at the top; it merges when a real phone shows the list
working. Hours are Alex's, agent-assisted.

| # | Milestone | Status | Hours |
|---|---|---|---|
| Phase 0 | Tooling, initial schema | **Done** | — |
| M1.0 | Worker scaffold | **Done** | — |
| M1.1 | RLS policies and the policy harness | **Done** | — |
| M1.2 | Admin | **Done** | — |
| M1.3 | Nightly Ticketmaster import and AI vetting (+ spots optional to publish) | **Done** | — |
| **Phase 2** | **The public layer and publishing, on the Worker** | | 18–26 |
| M2.0 | Repo + Expo scaffold | **Done** — merged as `7fc973a` | 6–8 |
| M2.1 | Public web layer on pind.social (W1–W4, the real map, the domain) | **Done** — merged as `6fea4a3` | 8–12 |
| M2.2 | Auto-publishing v1 — fixed target (§8) | **Done** — merged as `ec9d74d` | 4–6 |
| M2.3 | The list at fifty a week — today/tomorrow split and category chips (W1) | **Done** — merged as `M2.3` | 4–6 |
| **Phase 3** | **The product, in Expo** | | 68–96 |
| M3.1 | Identity and profile (A1–A3, A21–A23 skeleton, the AI photo check, Instagram rule V17) | **Walked on the web** (Alex and a friend, 22 Sept); native Google, Apple and HEIC wait on the internal TestFlight build. Not merged | 12–16 |
| M3.2 | Crowds, pins, the link-path funnel, universal links (A5–A9, A19, A26, A27) | Not started | 12–18 |
| M3.3 | Crews, the thread, the night, the morning after (A10–A17, A20, "Put me in a crew") | Not started | 20–28 |
| M3.4 | Solo crew (A28, A29) | Not started | 8–12 |
| M3.5 | Safety and the five notifications (A18, A23, A24) | Not started | 10–14 |
| M3.6 | Dogfood on staging | Not started | 6–8 |
| **Phase 4** | **Before the first real crowd** | | 28–42 |
| M4.1 | Policy, terms, operations (moderation rota, incident scripts) | Not started | 4–6 |
| M4.2 | Independent adversarial review of the visibility rules | Not started | 4–8 |
| M4.3 | Production project (`pind-prod`) + external TestFlight | Not started | 6–8 |
| M4.4 | Community & free sourcing | Not started | 8–12 |
| M4.5 | Metrics (§7) + adaptive publishing on (§8) | Not started | 6–8 |
| — | **The first real crowds** — 6–8 weeks, 2–3 seeded gatherings a week, then a decision meeting against §7 | Not started | ~2/week |
| **Phase 5** | **The App Store** | | 22–34 |
| M5.1 | Store readiness (listing, labels, manifest, EULA, review-only gathering) | Not started | 8–12 |
| M5.2 | M1.3b — automated spots | Not started (code built, switched off) | 10–14 |
| M5.3 | Submission, rejections, and Android when Alex chooses | Not started | 4–8 |

About 115–165 hours to the first real crowds and 140–200 to the App Store. Apple's
calendars (Beta App Review, App Review) sit outside those hours. 20 December to
5 January is dead for crowds: if the first crowds would land then, start them in the
second week of January. **Six-week rule, first checkpoint:** M3.2 is showable to a
friend (a link, a pin, a face) before crews exist; if it is more than six weeks away at
the current pace, raise the hours or shrink the phase.

#### Done
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
  other (now M4.2). Fixes from the review come as new migrations.
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
  addendum. Marked done by Alex when the revised build plan was merged (the nightly
  cron run summary is in the admin). Decided (Alex, M1.3; detail in decisions Part 5): search 30 km around
  the city centre, 8 weeks ahead, with centre and radii on the `cities` row; a calculated distance adjustment to the AI score; event facts
  only, Ticketmaster's data deleted 30 days after effective end; no revenue from
  Ticketmaster data during the beta (any paid feature needs a terms review first); a
  privacy policy before public pages go live; the import filter; Sonnet 5 scoring with
  the approved rubric, a queue fold threshold of 70 (raised from 40 after the first
  run) and a $3/day cap; AI spot suggestions (10 venues
  a night); importer-dismissed drafts restore themselves, Alex-dismissed never do;
  flags on published gatherings; the **withdrawn** state; Worker cron on Workers Paid.
- **After M1.3 (same day): meeting spots are optional to publish** (Alex; decisions
  Part 5 "Meeting spots"). Migrations `20260918214318_m1_3_spots_optional` and its
  `_fix` on pind-staging; harness 55/55; deployed. The admin flags "crews open, no
  meeting spots".
- **Phase 2 M2.0 complete** (branch `phase2/m2.0-expo-scaffold`, merged to `main` as
  `7fc973a` on 19 Sept 2026). One repo, two halves, no migrations.
  - **What exists.**
    - npm workspaces: `app/` and `packages/shared/`. Node 24.21.0 in `.nvmrc`.
    - `app/` runs **Expo SDK 57, pinned for the whole build**, with Expo Router.
    - `packages/shared/` holds:
      - the DB types from `supabase gen types`
      - the house rules and the other final §5 lines
      - `THRESHOLD = 5` and `TAGS_PER_PROFILE = 3`
      - the 30 neighbourhoods
      - the design tokens
      - `TAGS_DRAFT`
    - **Four tabs**, empty screens with their board IDs in the file headers:
      Crowds (A5, `/crowds`), My Events (A19), Connections (A20), Profile (A21,
      `/me`). Poppins headlines, system body font, **dark always** in both system
      settings (decisions Part 5, "Dark only"; light mode dropped). `/` is left to the Worker for W1 (M2.1), and the app's root
      redirects to `/crowds`.
    - The splash is solid near-black `#0B0A0D`, held until Poppins loads. Its logo
      slot is empty.
    - supabase-js holds only the publishable key. `ensureAnonymousUser()` is called
      at pin (A26), never on launch. On iOS the session is kept in the Keychain,
      split into chunks.
    - TanStack Query is wired.
    - **Sentry is live**: DSN, org `pind-9y`, project `pind-app`. Source maps upload
      from the development and internal builds; `SENTRY_AUTH_TOKEN` is an EAS
      secret. A test event was accepted on 2026-09-19.
    - **PostHog is live**, with one event, `app_open`. Autocapture and session
      replay are off, client IP is discarded, `$geoip_disable` is sent on every
      event, and each event is sent immediately. Each of Sentry and PostHog prints
      one console line when it's off.
    - **The web export is served as the Worker's static assets on the same host.**
      `/health` and `/admin*` run in the Worker first; every other path gets the app
      with SPA fallback. `npm run deploy` builds the export and deploys both.
    - `app/eas.json` has three profiles: development (dev client, ad hoc), internal
      (TestFlight) and production.
    - Bundle IDs are `social.pind.app.staging` and `social.pind.app`, on EAS project
      `@alexdobbie/pind` and Apple team 93M6B4W5PR (decisions Part 5, "Decided in
      Phase 2 M2.0").
    - The five `EXPO_PUBLIC_*` values are set in the EAS `development` and `preview`
      environments.
    - Checks: `npm run typecheck`, `test:policies` 55/55, `test:unit` 55/55, and the
      app typechecks.
    - **Walked on device, 19 Sept 2026** (Alex): the internal TestFlight build opens
      to the four tabs and stays dark with the phone in Light and in Dark; mobile
      Safari at `/me` is dark with the phone in Light (SPA fallback); `auth.users`
      was 20 before and 20 after opening the app, same `max(created_at)` — the real
      build creates no user on launch.
  - **`public.tags` exists but nothing fills it.** `TAGS_DRAFT` (20 tags in four
    groups) is Tatiana's to reword until the seed. **M3.1 owns both the final list
    and the seed migration.** After the seed, changing a tag costs a data migration,
    because `person_tags` points at tag slugs.
  - **Known gaps.**
    - **Tab icons are deferred to M3.2**, when Crowds has content. `expo-symbols`
      is added then. The tabs are labels only.
    - The app icon is a flat purple placeholder and the splash has no logo. The
      real logo arrives before M2.1, which needs it for the OG image.
  - **The three bugs this empty shell caught.** Each would otherwise have surfaced
    in the M3.6 dogfood walk:
    - **Keys missing from the web bundle.** Expo's build cache reused a
      compilation made before the keys existed. `build:web` now always runs with
      `--clear`.
    - **PostHog losing events.** Its default 10-second batch dropped `app_open`
      whenever the tab closed first. Fixed with `flushAt: 1`.
    - **Wrong device-registration steps.** The steps were written down wrong:
      `eas device:create` asks for the Apple ID (email, password, 2FA, team) *before*
      it offers the Website option.

    This is why the working rule is now in CLAUDE.md: within each milestone, data
    and rules first, then the screen, built properly.
  - **Checked on staging** (https://pind-web-staging.pind.workers.dev):
    - `/health` shows `neighbourhoods: 30`.
    - `/me` loads the app shell on mobile Safari and on desktop. `/crowds`, `/`
      and `/g/x/pin` load it too, so SPA fallback works.
    - `/admin` still redirects to the Cloudflare Access login.
    - Opening `/me` on the phone left `auth.users` at 20 before and after, with
      the same `max(created_at)`.
    - The stored PostHog events carry no `$geoip_*` properties and no `$ip`.
  - **On device (Alex).** The internal TestFlight build installs and opens to the
    four tabs with no dev server. Staying dark with the phone in Light and in Dark
    (the dark-only rebuild): re-check pending.
    `auth.users` was 20 before and after opening it, with the same
    `max(created_at)`. TestFlight was taken as the stronger proof and the dev-build
    check was skipped.

- **Phase 2 M2.1 complete** (branch `phase2/m2.1-public-web`, merged to `main` as
  `6fea4a3` on 20 Sept 2026). The public web layer on pind.social. Three migrations.
  - **The rule first, as agreed.** **V18 — a seed row is invisible to every visitor,
    signed out and signed in alike; only the service key sees it** (`docs/visibility.md`
    §12f). `is_seed` on `venues`, `gatherings` and `people`, carried by
    `private.is_published`, `private.list_open` and `private.is_open_at`, so every M1.1
    rule follows without its own policy changing — the shape V13 used. A seeded pin
    moves no public number, including "pinned" (H6). A venue's flag carries to its
    gatherings; no visitor can write the flag. The admin is untouched, because it reads
    with the service key.
  - **One door.** W1, W2, W3, the OG image and the `.ics` read `public.public_gatherings`
    and `public.public_gathering` and nothing else, so **"on the public web" — published,
    not withdrawn, not seeded, carrying a slug — is one definition in the database**, not
    a filter repeated in Worker code (H11).
  - **Slugs.** Minted by `admin_publish_gathering`. Changing one in the admin leaves a
    **301 forever**; a slug is spent the moment it is used and is never handed to another
    gathering; a published slug can never be removed. That also keeps the policy harness
    off every public page: it inserts its gatherings directly, so they get no slug.
  - **The screens.** W1 by day, ordered by date, honest zeroes. W2 with the map, counts,
    the house rules, one button and the session-swap script. W3. The `.ics`. The
    universal-link file with both bundle IDs. `/about`, `robots.txt`, a favicon. A
    withdrawn gathering answers 410 with a neutral line and nothing else — no name, no
    venue, no counts.
  - **The map is real.** One Mapbox picture per venue, `dark-v11`, WebP @2x, fetched
    once with the token as a Worker secret and **served from our own origin**. The
    markers, spot names, walking minutes, north arrow and a tap target that opens
    **walking directions in the phone's own maps app** are our HTML over it, so
    approving a spot later needs no new picture. A spot outside the frame keeps its
    list entry and says so. Both map URLs are content-addressed and immutable, so
    correcting a venue's coordinates mints a new URL and nothing stale can survive.
    Failures are recorded per venue, counted in the admin, and capped at three attempts.
  - **The OG image is a real PNG**, drawn as an SVG and rasterised in the Worker by
    `@cf-wasm/resvg` with Poppins embedded. Cloudflare Images will not rasterise SVG —
    checked, not assumed.
  - **The house rules, rewritten by Alex** after the on-device walk, with
    "Crews meet at a spot near the venue before doors." underneath. The safety property
    is unchanged; only how it is said.
  - **Measured, deployed, on the real domain.** W1 and W2 at 74–124 ms server response.
    Lighthouse mobile: **W2 99/100, FCP 1.6 s, LCP 1.6 s, TBT 0 ms, 78 KB across four
    requests**, against a 1.5 s floor that `/about` hits with no image and no script.
    The map image is 59 KB and 40–70 ms warm.
  - **Alex's part, done:** pind.social bought and its two proxied `AAAA 100::` records
    added; Cloudflare Access re-created for `pind.social/admin*`; Email Routing live for
    `crowds@` and `safety@`; the Mapbox token; the link-preview check in iMessage.
  - **Walked on device, 20 Sept 2026** (Alex): "It's good." The house rules were
    rewritten as a result. The workers.dev hostname now 404s, so the old admin is gone
    rather than merely unused.
  - **Three rules this milestone earned**, now in CLAUDE.md, each from a bug that looked
    right from the terminal:
    - **everything a public page loads comes from our own origin** — the same 157 KB
      image took 911 ms from Supabase storage and 133 ms from pind.social;
    - **a missing credential reports itself once as a configuration problem**, not as N
      identical runtime failures and never silently;
    - **measure what the phone does, not what the server sent** — a 92 ms response with
      a 911 ms image behind it, an immutable header on a response Cloudflare was not
      storing, and a third-party script the HTML never mentioned.
  - **Checks:** `npm run typecheck`, `test:policies` **62/62** (P55–P61 new),
    `test:unit` **73/73**, and the app typechecks.
  - **Carried out of M2.1:**
    - **the injected Cloudflare beacon** — unexplained, everything ruled out, in the
      notes below for M2.2;
    - **the lockup is provisional** and Tatiana's to change;
    - **the full copy pass** in the new voice is owed before the first real crowds
      (§5, "The voice");
    - **the spot coordinates on Sneaky Dee's are approximate**, set by Claude for the
      measurement and Alex's to confirm;
    - **the M5.2 distance ceiling** — Poetry Jazz Cafe is a 30-minute walk and was
      already approved and in a live spot poll.

- **Phase 2 M2.3 complete** (branch `phase2/m2.3-the-list`, merged to `main` on
  20 Sept 2026). The list at fifty a week, plus the three things the on-device walk
  found and the liveness check Alex chose over map polish. Four migrations.
  - **Data and rules first, and the data was the milestone.** All 49 published Events
    rows carried `category = null`, so the Events tab would have shown a chip row with
    nothing in it. `public.chip_category` maps Ticketmaster's "Segment / Genre" to the
    chip a reader filters by — **one rule, in the database**, called by the nightly
    import and by the backfill — and a category is **set once at draft and never
    overwritten**, so an admin edit is final (P66).
  - **W1.** Two tabs on `source` (`/` and `/community`), chips within a tab and never
    across, multi-select and always a union, Today and Tomorrow named, a week at a time
    with a pager, a count beside each day. **A chip is counted from the rows on the
    page**, so it can never filter to an empty one and never advertises an absence.
    Every control is a server-rendered link.
  - **W2.** The map's zoom is chosen per venue from its own spots; a spot is a numbered
    card with the walking directions inside it; "Open in Maps" for the venue itself; and
    the counts are now headed **"Who else is going?"** with the threshold demoted to a
    quiet line — the threshold is our mechanic, not the reader's reason.
  - **Measured, deployed.** `/about` is 7.9 KB with no list; W1 Events with 26 cards is
    **9.0 KB**, so the whole list costs about 1.1 KB. W2 is 8.8 KB plus a 30 KB map,
    down from 57 KB because the tighter zoom draws fewer features.
  - **What measurement caught that reading the code would not**, four times:
    1. **filling the category in would have stopped the publisher dead** — 0 published
       against 12, weeks at 4/48/30 against 4/50/40, because `capBucket` preferred the
       stored chip and stopped telling a club night from a rock show;
    2. **`/community` served the Expo app's own index.html with a 200** until it was
       added to `run_worker_first`;
    3. **29 of 37 venues had no map at their current key** — a visitor's first view was
       fetching it;
    4. **`admin_ai_spend_today` summed one table**, so a second job's AI cost would have
       been invisible to the $3 cap.
  - **Comedy earns its chip.** Stand-up was capped as seated theatre by analogy: 48
    drafts at a median of 35 against a floor of 60, three ever publishable. Naming it as
    its own case — and naming panel talks and "in conversation" as capped — moved the
    median to 60 and 3 → 28 over the floor, with theatre, classical and opera unmoved
    and the Jaipur Literature Festival holding at 35. Measured twice against a control
    set first, so the ±5–15 noise floor was known before the shift was claimed, and
    shipped with the re-score in one commit.
  - **The liveness check** (M2.3b). 28 hand-entered series had produced 188 published
    occurrences to 31 December with nothing re-checking them. Its own cron, run table,
    lock and budget line; 27 of 28 confirmed on the first pass, one unreadable, no false
    absences, $0.42. Nothing is withdrawn by a machine, "we cannot tell" and "its page
    dropped it" are different sentences, and "I looked" clears the doubt. The generator
    is capped at eight weeks, and seven series already have under 21 days of dates left.
  - **One definition of public, enforced.** `publicVenueIds()` joins `crowds()` in the
    door module, and `tests/unit/door.test.ts` fails if the lookalike service-key filter
    appears anywhere else — verified by reintroducing the bug.
  - **Checks:** `npm run typecheck`, `test:unit` **191**, `test:policies` **68/68**
    (P66 new), and the app typechecks.
  - **Walked on device, 20 Sept 2026** (Alex): "Looks pretty good overall." Three
    problems found on the phone, all fixed and redeployed — the map loading
    inconsistently, the back button, and the map's lack of interactivity answered with a
    costed path rather than a build. **Lighthouse was deliberately skipped** and moved to
    M3.2 (decisions, "Lighthouse on W1 and W2"): the byte floor leaves no room for a
    surprise, the last run measured the wrong URL and cost an hour, and there is nothing
    on these pages for it to find. The rule it does not weaken is the one that found the
    injected beacon and `/community`: load the page and list its requests.
  - **Carried out of M2.3:**
    - **the chip names are owed** — "Community" as a tab name, and cycling and running as
      separate chips, may not be how a reader divides this. What any rethink must keep:
      running is 4 gatherings / 59 rows / 2 venues and cycling is 5 / 13 / 8, so they
      look alike and behave oppositely;
    - **a search bar is designed and filed for M3.2** — no client JavaScript needed, one
      door with an optional query, about two hours, and the app's list needs the same
      thing;
    - **a source can extend a series as well as end one**, found on day one: two to three
      hours, and the cadence comes from the spacing of the rows we already hold;
    - **a horizon a year out is not evidence** — one page confirmed through September
      2027, noted where the clamp will go;
    - **the injected Cloudflare beacon is unchanged**, and the one query that would
      answer it needs an account API token, which is Alex's;
    - **the liveness cron has no watchdog**: the Community page says when no run has
      finished in 48 hours, but M2.2's pg_cron watchdog covers the import only, and
      generalising it is a refactor rather than a copy.

#### M2.2 — the nightly import had never actually run on schedule
Found on 2026-09-20, when the admin showed "TICKETMASTER_CONSUMER_KEY is missing" and
the last run was Friday evening. The diagnosis matters more than the credential.

- **`import_runs` has never held a single row started at the 08:00 UTC cron time.**
  Every "cron" row on record (18 Sep, 19:51 / 20:07 / 20:49 UTC) is a hand-invoked
  M1.3 run labelled cron. The trigger has been live for two nights and produced
  nothing both times.
- **Why nothing was recorded:** `runImport` checked `TICKETMASTER_CONSUMER_KEY`
  **before** calling `admin_start_import_run`, so a night that failed on a credential
  wrote no run row at all. The admin went on showing the last good run and looked
  fine. **A failed run must leave a failed run behind**; the check now sits inside the
  try, after the row is opened.
- **The secret is bound to the Worker** — `wrangler secret list` names it — so "it was
  lost when workers.dev was turned off" is **wrong**: Cloudflare secrets belong to the
  Worker, not to a route or a hostname, and M2.1 removed a hostname. What `secret
  list` cannot show is the *value*: a secret set to an empty string lists exactly like
  a real one and fails at the first `.trim()`. That is why "set but EMPTY" is its own
  state on the Configuration panel.
- **Two clocks now, deliberately.** Cloudflare's cron runs the import; a **pg_cron job
  in Postgres** checks **every hour** whether the run that was due has succeeded, and
  writes a failed `import_runs` row once its grace has passed without one. A Worker
  cannot report its own cron being dead, so the watchdog cannot live in the Worker. It
  caught this immediately on installation: 43 hours since the last success.
- **The watchdog's threshold is relative to the schedule, never a fixed hour** (Alex,
  M2.2, who spotted the trap before it sprang). The first version ran at 09:00 UTC and
  called a night missed after 26 hours, which quietly assumed the import fires at
  08:00 UTC. Had the cron really been 08:00 local — 12:00 UTC — the watchdog would
  have cried wolf every day, three hours before the import could run; a daylight-saving
  shift or an edited cron line does the same thing less visibly. **An alerting rule
  that fires when nothing is wrong is worse than no rule**, because it teaches the
  reader to ignore it and then the real missed night looks like all the others. So:
  the cron expression is stored in `ops_import_schedule`, the watchdog computes the
  most recent due time from it plus a 120-minute grace, and it runs hourly so it has
  no schedule of its own to drift out of step with. Harness P64 covers it.
- **Cloudflare cron triggers are always UTC**, so `"0 8 * * *"` is 08:00 UTC and the
  dashboard's "Runs At 08:00 AM" is UTC too. Nothing depends on that being true: the
  Worker reports `ScheduledController.cron` and `.scheduledTime` into the database on
  every scheduled run, so the next firing settles it with evidence from the scheduler
  itself rather than from documentation, and the threshold follows whatever it says.
- **Workers Logs are on, unsampled, in `wrangler.jsonc`** (Alex, M2.2). Observability
  was disabled on `pind-web-staging`, which is why no invocation history existed for
  the two missed nights and the dashboard could say nothing about them. Enabled in the
  repo rather than the dashboard, for the reason the routes are: config that cannot be
  reproduced from this repo is a broken repo. `head_sampling_rate` stays at 1 — a
  sampled log is worse than none when the question is "did this one invocation
  happen". Logs and the watchdog both stay: logs answer that question for someone who
  goes and looks, and the watchdog is the half that reaches out.
- **The next cron firing is self-diagnosing.** A row at 08:00 UTC means the trigger
  fires and the row says what failed; no row plus a watchdog row at 09:00 means the
  trigger is not firing at all. Until then the two cannot be told apart from data.
- **What now reaches Alex:** a failed run sends one email (Resend, at most one of a
  kind per Toronto day), and every admin page carries a red banner while the import is
  stale. The email needs `RESEND_API_KEY` and `ALERT_EMAIL`; until they are set the
  banner says in as many words that nothing emailed him.

#### Phase 2 M2.2 complete — auto-publishing v1
Merged as `ec9d74d`. The publish click is a nightly job: settings on the `cities` row,
the fill inside the import run, Alex's marks, promotion records, a Publishing panel
that explains every choice **and every refusal** in one line, and the weekly adjust
written and gated by `adaptive = off` so M4.5 is a checkbox. Walked on a phone across
all eight acceptance steps.

**As it stands on staging:** target **50** a week, score floor **60**, lead window
**0–21 days**, per-venue cap **6**, category share **40%** with an allowance of 3,
adaptive off. 128 unit tests, 66 policy-harness cases.

**The walk found five real bugs that the tests did not.** This is the argument for the
on-device walk being what closes a milestone rather than a green suite:
1. **Marks recorded but never published.** "Publish first" only skipped the score
   floor, so three marked drafts were refused by the venue and category caps and
   stayed drafts while the confirmation promised otherwise. A mark now outranks every
   automatic rule, because the Publish button already does.
2. **`FOLD_THRESHOLD` still read 70** after the floor moved to 60, so the draft queue
   collapsed seven drafts the publisher was about to publish, under a label naming a
   number nothing used. A threshold deciding what Alex sees has to be the threshold
   deciding what strangers see.
3. **The decision log was invisible.** A fill outside the nightly import records with a
   null `run_id`, and `eq` never matches null in PostgREST, so the panel reported "no
   run has filled a week yet" with 41 decisions sitting in the table.
4. **"Short by" was coloured as a fault** when at a target of 50 against a queue of
   11–28 it is the normal state, every day. A warning that is always on is a warning
   nobody reads.
5. **The venue-cap line called whatever count it found "the cap"** — "already has 4,
   which is the cap" when the cap was 2 — so it read as correct while being wrong.

Every one of them is a thing that looks right from the code and wrong on the screen.

**The audit trail answered the one question that mattered.** Rogers Centre showing 4
against a cap of 2 turned out to be Alex's own hand-publishing: the publisher took two
Jays games at 15:41 and he published two Zach Bryan nights at 15:57, sixteen minutes
later. It was answerable only because every publish records who did it and when.

#### The manual community pass — done, and what it taught
Merged as `1c52161`. Seven gatherings across six venues, entered by hand and published
for a fortnight; coordinates and real maps for all six. Not the permanent mechanism —
it is how we learn what good looks like, and the rubric M4.4 automates against comes
out of it (`docs/build-plan.md` §8 M4.4).

**Built along the way:** three entry states replacing `is_free` (free / pay at the
door / ticketed, with a price and a note); the category a reader filters by, in five
chips; a recurrence generator that adds no recurrence to the schema — weekly,
fortnightly and monthly, one form to N dated drafts.

**What the pass found, which is the point of doing it by hand:**
- **`is_free` had two values for a world with three.** Pub Chess is $10 cash at the
  door: neither free nor ticketed, and "I'm going" hid a cost while "I've got a ticket"
  described something that does not exist.
- **The feed cannot tell a DJ night from a gig** — the same rooms host both — so there
  is no "going out" chip, recorded with the venue numbers so nobody retries it.
- **The chips and the publisher's category cap are different taxonomies.** Merging
  them, which looked natural, would have taken the three upcoming weeks from 23/16/15
  published to 6/6/6.
- **A spot that exists but is shut at the meeting time is worse than no spot**, because
  the "no spots" flag counts spots rather than open ones and stays silent.
- **The convening is an arena solution applied to everything.** The reveal is identical
  at an arena and at a run club; the convening is not. Settled as a property of the
  gathering, built in M3.3 (decisions Part 5).
- **A `create or replace` on a function somebody has already replaced is a silent
  revert.** Rewriting `public_gathering` from a superseded definition took the real map
  off *every* crowd page and the gender mix off every count, and nothing caught it: the
  function returns jsonb, so a missing key is not a type error. Harness case **P65**
  now names every key its readers need, and a standing admin panel flags any spot more
  than a kilometre from its venue — the check that caught a geocode four kilometres out
  that passed every is-this-Toronto test.

#### Phase 2 M2.3 — the list at fifty a week (W1)
Built on `phase2/m2.3-the-list`, one migration (`20260920203410_m2_3_the_list`), on
staging at pind.social. **Data and rules first**, and the data turned out to be the
milestone: W1's chips had nothing to stand on.

- **Every Ticketmaster gathering had `category = null`** — all 49 published Events rows
  — because only the 31 hand-entered ones were ever tagged. The Events tab would have
  had no chips at all. The classification sits in `gathering_sources.snapshot` as
  "Segment / Genre", and now maps to a chip in **one place in the database**
  (`public.chip_category`), called both by the nightly import and by the backfill:
  Music / * → **Music** (523 in the queue, club nights included — the feed cannot tell
  a DJ night from a gig), Sports / * → **Sport** (83), Arts & Theatre / Comedy →
  **Comedy** (51), everything else → no chip and still on every unfiltered list.
- **The lifecycle Alex fixed:** a category is set **once**, when the draft is created,
  from that listing's own classification; the importer never overwrites it, so an admin
  edit is final and a genre Ticketmaster changes later never silently re-tags a
  published gathering. Harness **P66** proves all four branches, the "never
  overwritten" rule, that a second pass writes nothing, and that no visitor may call
  either function.
- **The chip is "Music", not "Live music"** (Alex): 15 of the 39 published are
  Dance/Electronic, and a DJ set is not live music. One line in `packages/shared`.
- **The page.** Two tabs on `source` (`/` and `/community`), chips within a tab,
  Today and Tomorrow named, a week at a time with a pager, and a count beside each day.
  Every control is a server-rendered link; the page runs no JavaScript.
- **The two map fixes on W2.** The picture's zoom is now chosen per venue from the
  venue's own active spots — as far in as it can go while every spot that fits at the
  wide frame still has room — and a spot is a **numbered card** with the walking
  directions link inside it, tied to a numbered dot on the map by a plain anchor.
- **Venue and neighbourhood filters are deferred**, following Alex's scope for the
  session rather than the build plan's longer list. Neighbourhood has no data behind it:
  the 30 rows carry a name and a sort order, no coordinates and no boundaries.

**What the real data said, before anything was drawn:**

| | rows in 7 days | chips it earns |
|---|---|---|
| Events | 26 | Music (20 gatherings at 14 venues), Sport (5 at 4) |
| Community | 18 | Games, Cycling, Running — Outdoors and Markets sit below the bar and are still listed |

**Three findings, each one measured rather than argued.**
1. **Comedy is a chip with no supply, and the cause is the rubric, not the data.** 20
   comedy drafts inside the lead window score **25–60** against a floor of 60; exactly
   one touches it, and none has ever been published. The chip is correctly hidden,
   which is precisely the problem: nothing anywhere said that a whole category is being
   refused. The Publishing panel now prints it — "nothing published; 20 drafts in the
   lead window, best score 60 against a floor of 60" — for every category, beside the
   chips that are live and the ones below the bar. **Fixing the scoring is Alex's call**
   (see "What fixing the comedy rubric would involve", below).
2. **Filling in the category would have stopped the publisher dead.** `capBucket` read
   the stored chip first, which was harmless while only hand-entered rows had one. With
   every Ticketmaster row carrying `live_music`, the cap stopped distinguishing a club
   night from a rock show — the distinction it exists for. Measured on the real queue
   the night it was filled: **stored-first published 0 tonight and left the weeks at
   4 / 48 / 30; classification-first published 12 and left them at 4 / 50 / 40.** The
   precedence is now classification-first, with the stored chip used only where there
   is no classification, and a unit test pinning it. This is the `FOLD_THRESHOLD` shape
   exactly: a data improvement quietly switching off a rule, with nothing looking wrong.
   `CAP_BUCKET` also now names all eight chip values, because the version that still
   said `taking_part` after that split into four let unlisted values fall through and
   become cap buckets of their own. Folding the five Community chips into one bucket was
   measured too — identical weeks, identical refusals — and **deliberately not done**:
   it would sit Community permanently at or above its 40% share (21 of 50 rows this
   week) and the guard would fire in normal weather.
3. **A Worker route that is not in `run_worker_first` never runs.** `/community`
   returned the Expo app's own `index.html` with a 200 — the single-page fallback — so
   the new page looked like a working page of the wrong app rather than like a 404, and
   the stale asset response sat in Cloudflare's cache afterwards. Found by fetching the
   deployed URL; reading the code would never have shown it. The same shape as M2.1's
   injected beacon: **check it from outside, not from the source.**

**Measured on the deployed pages** (compressed transfer, warm):

| | bytes | requests of ours |
|---|---|---|
| `/about` — the floor, no list and no image | 7.9 KB | 1 + favicon |
| W1 Events, 26 cards across 7 days | 9.0 KB | 1 + favicon |
| W1 Community, 18 cards | 8.6 KB | 1 + favicon |
| W2 crowd page | 8.8 KB + a 30 KB map | 2 + favicon |

So **the whole list costs about 1.1 KB more than an empty page**: the shell is the page
weight, and the fifty rows are nearly free. The crowd page's map came down from 57 KB
to 30 KB as a side effect of the tighter zoom — fewer features in a smaller frame.
**Lighthouse and the request list in a real browser are Alex's**, on the phone, per
CLAUDE.md; the numbers above are `curl`, which is the thing that rule says not to stop
at.

**What fixing the comedy rubric would involve** (asked by Alex; not built, because the
rubric is a product decision and the AI score is what strangers end up seeing):
- The cap that is biting is "seated theatre and classical at most 35" (spec §6, AI
  vetting). Comedy is not named in it, so the model is applying it by analogy — a
  stand-up show is seated — and the scores cluster at 25–45 with one at 60.
- The smallest honest change is **naming comedy in the rubric as its own case**, with
  its own ceiling, and saying why: a comedy crowd is 19–35, goes in twos, and arrives
  early to a bar near the venue, which is most of what the other four criteria reward.
  It is a prompt change in `src/import/ai.ts` plus a **re-score of the comedy drafts
  already in the queue** — only new drafts are scored today, so nothing would change
  for the 51 already there without one.
- It costs about **$0.001 a draft** at Sonnet 5 prices (M1.3 measured 740 drafts for
  $0.77), so re-scoring the comedy queue is cents.
- **The risk to weigh is that the rubric is the one thing deciding what strangers see**,
  and a ceiling lifted for comedy lifts it for everything the model reads as comedy —
  including the "Jaipur Literature Festival: In Conversation" listing currently scoring
  32. So it wants a measured before-and-after on the real queue, the way the category
  share had one, rather than a prompt tweak and a hope. Roughly an hour, and it belongs
  with M4.4's rubric work or its own small pass — not inside a page milestone.

**What the on-device walk found** (Alex, 20 Sept 2026; full entries in decisions.md,
"After the M2.3 walk"). Three problems, all fixed and re-deployed, plus two things
owed:
1. **The map loaded inconsistently — because a visitor was fetching it.** Measured:
   **29 of 37 venues behind a published gathering had no picture at their current key**,
   so the first view of each showed the schematic or nothing and the second showed the
   map. M2.1's `waitUntil` net had become the only thing that ever rendered anything,
   and M2.3's zoom-in-the-key retired every existing render at once. The nightly run now
   renders every reachable venue's map straight after publishing; the fallback stays a
   net; the admin counts what is still missing and no longer calls a venue "ready"
   because it once rendered *something*. Two smaller defects went with it: the image
   route recomputed the zoom and 404'd on any disagreement, and the spots read swallowed
   its error so a failure silently meant zoom 16. **All 38 venue maps now answer 200 at
   the key their page asks for, and 37 of 37 crowd pages show the real map on a first
   load.** Now a rule in CLAUDE.md, "A visitor is never the thing that does the work".
2. **The back button.** The tab and the chips now replace the history entry — they are
   query-parameter state on one page — while the pager and the cards push, and the map
   dots no longer push a hash entry each. 247 bytes of progressive JavaScript; every
   control still works without it.
3. **`/community` had been serving the app's own index.html with a 200** until it was
   added to `run_worker_first`. Alex's rule, now in CLAUDE.md: a missing Worker route
   does not 404, it silently serves the wrong app and then gets cached.
4. **The chip names are owed** (Alex): "Community" as a tab name, and cycling and
   running as separate chips, may not be how a reader divides this — there may be a
   "clubs" or "wellness" shape instead. Not touched this milestone. What any rethink
   must keep: running is 4 gatherings / 59 rows / 2 venues and cycling is 5 / 13 / 8, so
   they look alike and behave oppositely.
5. **The comedy rubric, measured both ways, then shipped with its re-score** (Alex).
   Stand-up is named as its own case and is not capped as seated theatre; panel talks,
   readings, lectures and anything billed "in conversation" are named as capped at 35
   whatever a ticketing site files them under. Measured before shipping, each set scored
   **twice with the current prompt first to establish the noise floor** — individual
   rows move 5–15 points between identical runs, so this is a distribution result and
   not a per-row promise.
   **As applied on staging:** all 48 comedy drafts re-scored, median **35 → 60**, and
   **3 → 28 at or over the floor of 60**. Theatre (28 rows, 15–32), classical (8,
   15–30) and opera (4, 20–30) were not re-scored and did not move in the controls. The
   Jaipur Literature Festival, the one Alex named, sits at **35**, with the model's own
   reason: "In-conversation literary event, capped despite comedian guest." Prompt and
   re-score in one commit, because new drafts judged generously beside old ones that are
   not is worse than either wording. `scripts/rescore.ts` is the re-score, dry by
   default; the whole exercise cost **$0.26**.
6. **The path to an interactive map is costed** in decisions.md: the Protomaps-on-R2
   pipeline (6–12 h) belongs to the city map and A8, real pan and zoom belongs in the
   app (3–6 h on top), and W2 keeps the static image because MapLibre GL JS is ~200 KB
   gzipped against a 9 KB page. What W2 can have cheaply: "Open in Maps" for the venue
   (minutes), two or three pre-rendered zooms with a no-JavaScript switch (1–2 h), and a
   real map behind a tap once the pipeline exists (2–4 h).

**M2.3b — the liveness check** (Alex chose it over the W2 zoom switch; full entry in
decisions.md, "Is that run club still a run club?"). 28 hand-entered series had produced
**188 published occurrences running to 31 December** and nothing re-checked any of them.
Two migrations: `community_series` (provenance and verification, never recurrence),
`gatherings.series_id`, `cities.community_weeks = 8` capping the generator,
`community_check_runs` with its own lock, and `admin_ai_spend_today` extended to sum
both jobs — it read `import_runs` only, so a second job's AI spend was invisible to the
daily cap.
Its own cron at 13:00 UTC reads the four least-recently-checked series' own pages and
asks one narrow question each. **Measured on the first full pass: 27 of 28 confirmed, 1
unreadable, not one false absence, $0.42 for all 28** — six cents a day at four a night.
A deterministic check was tried first and rejected on evidence: 27 of 28 pages answer
200, so being alive is no signal; four name no future date at all ("every Tuesday,
6:30pm"); and seven series share one 582 KB page. Nothing is ever withdrawn by a
machine — the loudest output is a line in the admin, and "I looked, leave it" clears it.
The count also runs the other way: **seven series already have fewer than 21 days of
dates left**, which nothing counted before, because a cap without a top-up is a decay
mechanism.

**Not signed off.** Alex holds the merge until he can run Lighthouse and list the
requests from a browser on a laptop.

**Carried out of M2.3:**
- **the injected Cloudflare beacon is unchanged** — same token, same `"spa":2`, on
  every HTML response including the two new pages. Still not in the repo, still
  unstoppable from it; the one query that would answer it needs an account API token,
  which is Alex's.
- **Events run out before Community does.** Ticketmaster rows stop at the 21-day lead
  window and the recurrence generator runs community rows to mid-November, so the second
  and third pager pages are Community-only. Predicted, not a bug.
- **Community has nothing on a Sunday.** The landing page (Events) has something under
  both Today and Tomorrow; the Community tab's first heading today is Tomorrow. Honest,
  and worth a second look once M4.4 widens the supply.
- **An uploaded map override now carries no markers.** Our coordinates mean nothing over
  somebody else's picture at an unknown scale, and a dot 200 m out is worse than no dot;
  its spots are in the cards like everyone else's. No public venue has an upload today —
  the only one on staging is a seed row — so this is latent either way.

#### Superseded copy — the pin-in button
"Pin in — I've got a ticket" is **retired** (Alex, after the M2.2 walk). Every crowd
page reads **"Pin in — I'm going"**, whatever it costs to get in, with the cost on its
own line beneath and any registration line above. A pin is a statement about the
person, not about how they got in. `packages/shared` now has one `PIN_IN`; the second
constant is gone. decisions.md Part 5 carries the reasoning and marks the M1.2 rule
superseded rather than deleting it.

#### Notes carried into the next milestones
- **M3.1 — the photo check** (recorded by Alex in M1.2; decisions Part 5, "Automated
  photo moderation"). On upload, a Claude vision check auto-approves clear real-person
  photos, auto-rejects clearly inappropriate ones (the person stays visible without a
  photo), and sends uncertain cases (possible minor, not a real person, possibly
  someone else's photo) to the admin photo queue built in M1.2. It never decides
  "under 19" alone; it only flags for review. Reports and auto-hide stay the backstop.
  The work: the check itself (database webhook → Worker → Claude vision); each
  automated decision recorded in `moderation_log` like an admin decision (actor
  `ai:photo-check`); `docs/visibility.md` V6 updated (today it says a photo shows only
  after **admin** approves it); the privacy policy states that photos are checked
  automatically. The Anthropic key is a Worker secret, never committed.
- **M3.1 — Instagram handles** (Alex, revised build plan): the pending rule V17 in
  `docs/visibility.md` is enforced in the database with harness cases (crewmate, solo
  partner and connection can read; the open list, anon and everyone else cannot).
- **M3.5 — date changes** (decided, Alex, revised build plan): people pinned to a
  published gathering whose date Alex changes from a flag, or which is withdrawn, get
  notification 3 ("plan status"). The importer still never changes a published
  gathering silently; it only flags it (done in M1.3).
- **M2.1 — the logo** (Alex, M2.0; settled 19 Sept 2026). The artwork is in `brand/`:
  fifteen files exported from the .ai source with text outlined — `logo-*.svg` (the
  "pin'd" wordmark alone), `mark-*.svg` (the safety pin alone), `icon-1024-*.png`,
  `splash-logo-*.png`, each in white, black and purple, plus unsuffixed defaults that
  are the white ones. Brand purple is exactly `#582883`, matching the tokens in
  `packages/shared`. `brand/pieces/` is animation artwork the app and the Worker do
  not use.
  - **There is no mark+wordmark lockup in the source, and none has ever been
    designed.** M2.1 composes one as a layout — mark and wordmark side by side, the
    mark at the wordmark's cap height, a fixed gap — for the W1/W2 header and the W4
    OG image. **It is provisional and Tatiana's to change** (Alex, 19 Sept 2026); it
    is a layout to correct on staging, not artwork to match.
  - The SVGs carry an embedded C2PA metadata blob — 7.7 KB of `logo.svg`'s 14.5 KB
    and of `mark.svg`'s 9.8 KB. M2.1 strips `<metadata>` and swaps the hard-coded
    `fill` for `currentColor` when inlining into the Worker's pages, which must open
    inside a Reddit tab in under a second. **The files in `brand/` stay untouched.**
  - The app side — `icon-1024-purple.png` over the flat purple placeholder,
    `splash-logo-white.png` into the empty splash slot in `app/app.config.ts`, and a
    favicon from the mark — only shows on a new EAS build, so it is **batched with
    whatever else M2.1 needs on the phone; no build just for an icon** (Alex,
    19 Sept 2026).
- **M2.1 — before it starts** (Alex, M2.0). pind.social serves pind-staging, with seed
  rows excluded from every public read, in the database with a harness case (H6,
  H11). Routes and custom domains are allowed for pind.social only; PindScene.com is
  never touched from this repo. Pages ship unlinked and noindex until the M4.1
  privacy policy. Alex's part: **pind.social is bought and registered through
  Cloudflare Registrar in the alex@tenorconsultants account — the zone is Active on
  Cloudflare's own nameservers, so there is no DNS wait** (Alex, 19 Sept 2026); the
  logo files are **in `brand/`** (fifteen, not four — see the M2.1 logo note).
  Outstanding: the Resend account and the pind.social domain records, and Access for
  `pind.social/admin*` (AUD tag to Claude). Decisions Part 5, "Decided in Phase 2
  M2.0".
- **M2.2 — the injected analytics beacon: unexplained, carried forward.** Every HTML
  response from `pind-web-staging` — the crowd page, an asset-served app page, and
  `/health`, which touches no assets — carries an injected
  `static.cloudflareinsights.com/beacon.min.js`. It is **not in the repo**: the only
  grep hit is CLAUDE.md, where it is written up; `app/dist/index.html` has none;
  `wrangler.jsonc` has none. **It cannot be turned off from the repo** — wrangler's
  config schema has no `web_analytics`, `rum`, `beacon` or `insights` key, and the
  `observability` block that exists is Workers Logs, a different product with a
  similar name. The injection happens at the edge *after* the Worker returns, so there
  is no Worker-side strip either.
  - **The tag:** `{"version":"2024.11.0","token":"6fbd9c007d0e4740bc718720ec35af43",
    "r":1,"spa":2}`. **`"spa":2` is the single-page-app flag Cloudflare sets for a
    Worker or Pages project serving static assets** — which this Worker started doing
    in M2.0. That is the strongest clue to what created it.
  - **It is invisible to a normal request.** Plain `curl` gets a clean page; `curl`
    with `Sec-Fetch-Dest: document` and `Accept: text/html` reproduces it. Reading the
    template will never find it; only a browser, or those headers, will.
  - **Ruled out (Alex, 2026-09-20):** zone-level Web Analytics is off — the Analytics
    tab shows "No data available" and an "Enable Globally" button, which is the
    **zone-wide** switch and must **not** be pressed. The account's two Web Analytics
    sites are `thepindscene.com` and `pindscene.com`, both created three months ago,
    each scoped to its own hostname; neither lists `pind.social` and neither was
    changed. So the token belongs to a site neither of us can see in the dashboard.
  - **Where it is probably from:** Cloudflare creating a Web Analytics site implicitly
    for an asset-serving Worker. Unconfirmed.
  - **Cost, measured:** 10.6 KB from a second host, and **no time outside run-to-run
    noise** — W2 with the beacon blocked scored the same 99. So this is a rule
    problem, not a speed problem: it breaks CLAUDE.md's "everything a public page
    loads comes from our own origin", and it is RUM collection on a page that needs no
    account.
  - **Not a merge blocker** (Alex, M2.1). M2.2 picks it up. Do not rediscover this from
    scratch: start from the token and the `"spa":2` flag, and check whether it survives
    a deploy that changes the assets configuration.
  - **Checked in M2.2 (2026-09-20), after the M2.2 deploy: it survived, unchanged.**
    Same token `6fbd9c00…`, same `"spa":2`, same reproduction — clean on plain `curl`,
    present with `Sec-Fetch-Dest: document`. Injected into **every HTML response** (W1
    `/` and `/health` alike) and into **nothing else**: `/robots.txt` (text/plain) and a
    404 carry none, so it is content-type-triggered edge injection, not something a
    route or an asset pulls in.
  - **Nothing left in the repo can turn it off.** It is still absent from the source,
    wrangler's schema still has no key for it, and it is still added after the Worker
    returns, so there is no Worker-side strip. Nothing M2.2 changed about the Worker,
    its routes or its deploy touched it — which was the experiment M2.1 proposed, and
    it came back negative.
  - **What is left is Alex's, and it is one query.** The dashboard's Web Analytics
    list shows two sites and neither is pind.social, so the site holding this token is
    not in that list — an implicitly created one would not be. The Cloudflare API can
    say outright: list the account's Web Analytics sites and find the one whose token
    is `6fbd9c007d0e4740bc718720ec35af43`, then check the Worker's own observability /
    Web Analytics setting. Both need an account API token, which is Alex's
    (CLAUDE.md, "Things that are mine, not yours"). **Carried into M2.3/M4.1 as Alex's,
    not as a code task** — it is a rule problem, not a speed problem (10.6 KB from a
    second host, no measurable time), and it stays open until that query answers it.

- **M3.2 — tab icons** (Alex, M2.0). Add `expo-symbols` and choose the four icons
  when Crowds has content. The tabs are labels only until then.
- **M4.3 — Apple** (Alex, M2.0). The production bundle ID reuses the Pin'd APNs key.
  If EAS offers to create a key, stop. Never revoke a certificate or key to make
  room. The production internal TestFlight group has Alex only: EAS auto-created
  "Team (Expo)" with all six App Store Connect users on the first staging submit.
  In `docs/build-plan.md` §8 M4.3 acceptance.
- **M4.5 — repoint the weekly adjust, and switch adaptive on** (M2.2). Two things,
  both small because M2.2 left the plumbing in place. (1) `adaptive` becomes a
  checkbox on the Publishing panel; the adjust has been running and logging every
  Monday since M2.2, including the target it would have moved to, so nothing new is
  built. (2) `public.admin_publish_outcomes` moves from live pins to the
  `gathering_stats` snapshots §7 adds. `publish_target_log.inputs` holds every row the
  arithmetic counted on every past week, so the repoint is checked by running both
  sources over the same weeks and comparing — not by trusting it. The 14-day window
  must stay under pin retention until that swap happens; the planner and a check
  constraint both refuse otherwise.
- **M4.5 — PostHog** (Alex, M2.0). No `$geoip_*` properties and no `$ip` were
  stored (checked 2026-09-19), so M4.5 re-checks this rather than building a
  transformation. One iPhone visit produced two `app_open` events 1 ms apart with
  different anonymous ids, most likely Safari pre-loading the page, so funnel
  counts must allow for pre-rendered loads. Both are in `docs/build-plan.md` §8 M4.5
  acceptance.
- **M5.1 — seller name** (Alex, M2.0). Request the App Store Connect "Doing Business
  As" name so the listing reads Pin'd, not Tenor Investments Inc. It takes days and
  needs documentation.

#### M5.2 · M1.3b — automated spots: what M1.3 learned
M1.3b's code is built but **off** (`AI_SPOT_SUGGESTIONS` in `wrangler.jsonc`, off
unless `"on"`; the "Suggest spots now" button is hidden while off). Until M5.2, spots
are added by hand in the admin; "Venues needing spots" on the draft queue lists where
they are needed. The first crowds' venues get their spots by hand (§ "Before the first
real crowd"). What M1.3 learned, measured on 2026-09-18 with Sonnet 5, effort medium,
5 searches max:
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
  - **A spot should be a card, and the content comes by hand first** (Alex, M2.2 —
    filed, not built; full entries in decisions.md Part 5, "A spot is a card, not a
    maps link" and "Spot content starts as a manual pass"). A meeting spot currently
    opens Google Maps and that is the whole interaction; it should open a card — what
    the place is like, food and drink, rough capacity, noise, whether six can get a
    table without booking — with the maps link inside it. A crew choosing between three
    spots otherwise has a name and a walking time to choose on. **The content starts as
    a manual pass**, whose real output is a definition of "a good spot" that becomes
    this run's rubric; the card's fields are designed first so the spreadsheet is an
    import, not notes. **It must not be arena-first**: run clubs, markets and pickup
    games have the harder locations, and M4.4 needs them (`docs/build-plan.md` §8 M4.4).
    Sourcing is the open question, and **this run already fetches an evidence page per
    spot**, so richer data may belong here rather than in a second job.
  - **Quality:** suggestions came back for 2 venues (Scotiabank Arena in a direct
    test; Sneaky Dee's in a run, 3 pending on staging) — sensible but not perfect
    (one "east of the venue" was west). Alex's approval stays the gate.
  - **Cost blind spot:** a call aborted or killed mid-stream is billed but its usage
    never arrives, so it is missing from `import_runs` and the daily cap undercounts.
    M1.3b should count an estimate for every aborted call.
  - **The approval bar was too loose, and it took a map to see it** (M2.1, 2026-09-19).
    Sneaky Dee's has three approved spots. Once M2.1 calculated walking minutes from
    coordinates, one of them — Poetry Jazz Cafe — came out at **30 minutes' walk**: it is
    about 2 km away, at 1078 Queen St W, and it had been approved and was sitting in a
    live spot poll. The prompt asks for places "within about five minutes' walk", which
    is guidance a model can talk itself past, and nothing downstream checked. Alex
    approved it because the admin showed a name and a reason, not a distance. So M5.2
    should:
    - give the suggestion run a **hard walking-distance ceiling**, enforced in code
      against the venue's coordinates, not asked for in the prompt — a suggestion past
      it is dropped before it reaches the queue;
    - make the AI return each spot's coordinates, so the ceiling can be applied and the
      spot lands on the generated map without a second step;
    - show the walking minutes next to every pending suggestion in the admin, so the
      number is in front of Alex at the moment he approves;
    - **sweep the spots already approved** and re-check them against the ceiling, since
      the ones approved before M2.1 were never measured. Poetry Jazz Cafe is the known
      one; there may be others.
  - M1.3b should: prove the fixes on a full run, consider running suggestions outside
    the nightly import (their own cron or a queue), and measure empty-answer rates.
  - Local testing note: on Windows, stopping a background `wrangler dev` did not kill
    its `workerd` children; two local Workers then raced for the run lock. Kill the
    whole process tree (`taskkill /T /F`) between local runs.

### Before the first real crowd
Everything below is a gate before real people can see each other (the build plan's
§9). Items that only applied to the WhatsApp Test 0 are gone from this list.

**Product safety floor**
- [ ] 19+ tick at pin; DOB hard stop at opt-in; year only stored
- [ ] Reciprocal reveal enforced in the database; reciprocity labelled "always on" in settings
- [ ] No location permission exists in the build (check the app's info.plist and the
  web build's permissions)
- [ ] Crews 3–8 at curated spots; no address field anywhere; solo plans only at venue spots
- [ ] Block and report two taps from every person, crew and message; H9 auto-hide;
  blocking never notifies
- [ ] Women-only crews on every gathering; solo "women only" limiter
- [ ] Photo check live; pending state respected; queue monitored
- [ ] Instagram handles visible only to crewmates, solo-plan partners and connections (V17)
- [ ] Delete account and export in-app; house rules verbatim on every crowd surface

**Moderation and incidents**
- [ ] Reports post to the team channel; a human acts within 24 hours; the rota covers
  the night (decisions Part 5, "Moderation rota" — pending Tatiana and Jayme)
- [ ] Incident scripts written and read; the acknowledgement copy in place
- [ ] The admin shows hidden people, open reports, and the photo queue on one screen

**Privacy and legal**
- [ ] Privacy policy and terms published, covering Ticketmaster data, photo checks,
  gender, solo mode, retention
- [ ] Ticketmaster data purged 30 days after effective end (job proven on staging); no
  revenue from their data
- [ ] The lawyer hour on terms and the "we organise nothing" language; incorporation at
  least started, with the accounts to move to the entity listed

**Visibility review**
- [ ] The independent adversarial review done (`docs/m1.1-review-brief.md`, including
  its M1.2, M1.3 and M3 sections); every finding a migration with a harness case
- [ ] Alex's read of `docs/visibility.md` signed off, including V14–V17
- [ ] `test:policies` green on production's schema

**Data and infrastructure**
- [ ] Production Supabase project (`pind-prod`) on Pro; no seed rows; backups on
- [ ] pind.social live; universal links verified from iMessage and Safari; email
  delivering from the domain
- [ ] Sentry on the app and the Worker; the delivery cron's failures visible in the admin

**Content and people**
- [ ] Spots hand-added for the first crowds' venues (Scotiabank Arena, Rogers Centre,
  BMO Field, History, Rebel, Massey Hall, Coca-Cola Coliseum, and whichever community
  venue is first)
- [ ] At least one community gathering published; five gatherings a week publishing on
  their own
- [ ] The fan-channel map and posting rules for the first seeded gatherings; the first
  two posts drafted (decisions Part 5, "Seeding" — pending Tatiana and Jayme)
- [x] Pass criteria and the solo rule written into spec.md before the first pin (§7)

### Deferred cascades
Deferred to the retention and account-deletion milestone. The initial schema does not
yet satisfy these; they must be fixed there.

- **Deleting a gathering must not take pins and after-event answers with it.** Today
  `pins`, `survey_responses` (and the other Test 0-era rows) cascade on gathering
  delete. `decisions.md` keeps aggregate counts after pins are deleted, and the
  after-event answers (A16) are the attendance metric (§7).
- **Deleting a person must not remove their confirmations.** Today `confirmations`
  cascades on person delete, so a crewmate can lose their "showed up" badge because
  someone else left.
- **Anonymous people are deleted with their pins.** A person who pinned and never
  opted in (no permanent identity) is deleted with their last pin, 30 days after the
  gathering's effective end (decisions Part 3).

---

## 7 · Measurement

(Alex, revised build plan; `docs/build-plan.md` §7. Built in M4.5.)

**Source of truth.** SQL views in Postgres over pins, crews, confirmations, check-ins,
reports and the after-event answer, read by a Metrics page in the admin. Pins are
deleted 30 days after a gathering, so a pg_cron job writes a `gathering_stats` row at
the effective end + 24 h and again at + 72 h (after keep-in-touch expiry); the row is
what survives. PostHog carries the in-app funnel events (page → pin → opt-in → photo
approved) and Sentry carries crashes on both halves. Nothing about a person's gender
leaves the aggregate.

**The one number** is **Met** — people who mutually confirmed they met, per week —
split by mode. Everything else explains it.

| Metric | Crews | Solo | Counted from |
|---|---|---|---|
| Opt-in rate | crew-opted ÷ pinned | solo-opted ÷ pinned (and both ÷ pinned) | pins |
| Opened | gatherings that reached 5 crew opt-ins | gatherings with ≥ 2 solo opt-ins | counts |
| Plan formed | crews reaching *spot set* ÷ gatherings that reached 5; dissolve rate | accepted plans ÷ proposals; proposals per solo-opted person | crews, proposals |
| Showed up | "I'm here" ÷ members of set crews | same, per plan | check-ins |
| **Met** | people with ≥ 1 mutual "we met" ÷ crew-opted people | people with a mutual "we met" ÷ solo-opted people | confirmations |
| Women's share | of pinned, of opted-in, of met | same | aggregate only |
| Safety | reports per 100 opted-in; auto-hides; incidents and hours to first human action | same | reports, moderation_log |
| Repeat | pinners who pin a second gathering within 6 weeks | same, for solo-opted people | pins |
| Cannibalisation | crew reach rate and crews-set rate at gatherings with solo activity vs without; share of solo-opted people who also joined a crew | | crews × pins |
| Attendance created | "Would you have gone alone anyway?" — one question in the after-event screen (A16) for everyone opted in (yes / no / I wasn't going to go at all) | | after-event answers |

### Pass criteria for the first crowds, fixed now
Over 6–8 weeks of seeded and unseeded gatherings:
- ≥ 20 pins at each seeded stadium-scale crowd and ≥ 8 at each mid-size one;
- opt-in (either mode) ≥ 50% of pinners;
- a spot and time set at ≥ 60% of gatherings that reached 5;
- Met ≥ 3 at ≥ 2 gatherings;
- women ≥ 35% of pinners;
- repeat ≥ 25%;
- every report acted on by a human within 24 hours.

Miss two and the finding is the assessment's: reveal does not convene itself — stop
building and decide what Pin'd is instead. Pass and the store submission proceeds.

### The solo decision rule, pre-registered
Evaluate after at least 20 published gatherings reached 5 opted-in people, comparing
*per opted-in person* — raw counts favour solo by construction because its threshold is
lower (2, against crews' 5).
- **Keep it and start mentioning it** if solo Met per opted-in ≥ crews' Met per
  opted-in, *and* reports per 100 solo-opted ≤ crews', *and* women are ≥ 30% of
  solo-opted people, *and* crew reach rate is not lower where solo is active.
- **Keep it quiet** (as it is now) if it produces meetings but fails one of the safety
  or gender tests.
- **Turn it off** if reports per 100 exceed twice the crew rate, or any incident traces
  to a solo plan and was handled badly.

---

## 8 · Auto-publishing

(Alex, revised build plan; `docs/build-plan.md` §6. Fixed target in M2.2; adaptive in
M4.5.) The number of published gatherings *is* the spread: it grows when published
gatherings fill and holds or shrinks when they don't. A thermostat, not a model — it has
to be legible in the admin and correct with sparse data.

### Settings (on the `cities` row, never in code)

| Setting | Start | Meaning |
|---|---|---|
| `publish_target_weekly` | **50** | How many gatherings should be published per calendar week of start dates. Raised from 5 in M2.2: build assuming it is popular (decisions Part 5) |
| `publish_min` / `publish_max` | 3 / **75** | Floor and ceiling for the target. The ceiling rose with the target; the floor only binds once adaptive is on (M4.5) |
| `publish_lead_days_min` / `_max` | 4 / 21 | Publish a draft only if it starts within this window; nearer first |
| `max_per_venue_per_week` | 2 | A Jays homestand does not fill the week |
| `community_slots_weekly` | 1 | Reserved for a "Community & free" gathering above its own threshold (from M4.4). **One in five was chosen before any evidence — revisit at M4.4** |
| `score_floor` | 70 | Final score (AI score minus distance adjustment) below which a draft is never auto-published. **At a target of 50 this, not the target, is what limits the list** — and lowering it needs a per-category cap in the same change (decisions Part 5) |
| `grow_reach` · `grow_median_pins` | 0.60 · 8 | Both must hold to grow |
| `shrink_reach` | 0.30 | Below this, shrink |
| `step_up` · `step_down` | +2 · −1 | The most the target can move in one week |
| `adaptive` | off until M4.5 | Alex can freeze the target at any time |

### The nightly fill (inside the import run)
For each of the next three weeks, count published gatherings starting that week. If
below the target, publish the highest-scoring eligible drafts until it is met: inside
the lead window, at or above the score floor, not dismissed by Alex, not withdrawn, at
most two per venue per week, one slot held for a community gathering when the
community run has a candidate. Drafts Alex has marked **"publish"** go first regardless
of score; drafts marked **"never"** are skipped forever (`publish_mark`, §1). A
gathering that has **ever been public is never picked up by a run again** — it carries
a slug, and a slug is minted at publish and can never be removed, so the database
already records it (Alex, M2.2). That one condition covers both withdrawing and
unpublishing: Alex withdraws (any time) or unpublishes (zero pins) whatever is wrong,
and only he can put it back. Manual publish stays.

The weeks are the **city's** weeks, Monday to Sunday, counted by the week a gathering
**starts** in. `publish_lead_days_max` is 21 for that reason: the far end of the third
week is at most 20 days away, so the lead window always covers every week the run
fills. Ranking inside a week is marked drafts first, then final score, then the sooner
start. A withdrawn gathering is not published, so its week is genuinely short and the
next run refills it. The community slot is held **only when a community gathering is
waiting** — holding an empty slot would publish four where the target says five — so
it reserves nothing until M4.4.

### The weekly adjust (Monday's run, before the 6pm digest)
Look at gatherings that ended in the trailing 14 days and had been published at least
7 days before they started (so a late publish does not count as a failed one). Compute
`reach_rate` — the share whose open-to-meeting count reached 5 by the effective end —
and `median_pins`. Then:
- `reach_rate ≥ 0.60` and `median_pins ≥ 8` → target + 2
- `reach_rate < 0.30` → target − 1
- otherwise → hold
- clamp to `publish_min … publish_max`; if fewer than 3 gatherings qualify in the
  window, hold.

**Open: is one community slot in five too few?** (Alex, M2.2; revisit once M4.4 can
actually fill the slot.) The number was set before there was any evidence, alongside
everything else in the table. The case for raising it: free recurring gatherings may
be where this product actually works — **the same people every Saturday is how repeat
attendance happens**, where 18,000 strangers once is a single shot at reaching 5.
Community gatherings are first-class, not the minor half (decisions Part 5,
"Community gatherings are first-class"). The case for leaving it: nothing sources them
until M4.4, so raising it now would hold slots nothing can fill, and the fill already
refuses to hold an empty slot for exactly that reason. It stays at 1 until there is a
queue to measure; then it is a setting on the cities row, not a rebuild.

**The lead minimum is 0** (Alex, M2.2, on the first real fill): `publish_lead_days_min`
starts at **0**, not 4. Someone landing on the site tonight has to see what is on
tonight — people are last-minute, and a five-day hole at the front of the list reads as
an abandoned site. Nothing else changes: `admin_publish_gathering` still refuses a
gathering that has already started, so "today" means the rest of today.

**Open: what the target counts — a week, or a shelf** (Alex, M2.2; decide after real
weeks, not by reasoning). The target is currently *five gatherings starting per
calendar week*, and the first read-only run surfaced the consequence: by mid-week
everything still on the shelf for that week starts inside the 4-day lead minimum, so
the current week's target can no longer be met and the list sags as the week runs
out. Two shapes:
- **Per starting week (built).** Legible — "five a week" is a sentence anyone can
  check against a calendar — and the unit the weekly adjust already measures in.
  The list thins towards the end of each week by construction.
- **A rolling shelf.** Five *live at any time* across the lead window, so the list
  carries roughly the same amount every day and refills as gatherings fall out of the
  window. Steadier for a visitor arriving on a Friday, but "the target" stops matching
  the week the adjust reasons about, and the per-venue-per-week cap needs re-stating.

The rule stays as built. Watch a few real weeks first: how often the current week
actually empties, and whether anyone lands on the thin end of one.

**First evidence, 20 September 2026 — the hole is inside the week, not at its front.**
Dropping the lead minimum to 0 did not fill Monday to Thursday, and the publishing log
says exactly why: the week of 21 Sep was already at its target of 5, and all five fall
on Friday, Saturday and Sunday. Twenty-nine eligible drafts were skipped as "week
full", **five of them on the empty days, including Charli xcx (88) and a Leafs game
(88) — scoring higher than things that published in other weeks.** Part of that is
sequencing: the week was filled while the 4-day minimum still hid the near days, and a
week filled from scratch under a 0-day minimum would have ranked Charli xcx first. But
the shape of the problem survives that: a per-week target says nothing about *which*
days inside the week get filled, so a strong weekend can legitimately consume a whole
week's quota. A rolling shelf, a higher weekly target, or a floor on the next 72 hours
would each address it differently. Decision still deferred; the evidence is no longer
hypothetical.

**Pinning has no time gate, and never had one** (confirmed in M2.2, harness P37b).
`publish_lead_days_min` decides only when a draft may be *auto-published*; it is read
by the publisher and nowhere else. The only conditions on taking a pin are "it is me"
and "the gathering is published, not withdrawn, not seeded", so someone can pin in on
the morning of, or an hour before doors. **They can also pin in after it has ended** —
there is no upper bound either. That is a gap left from M1.1 rather than a decision,
and it is **M3.2's to close** (`docs/build-plan.md` §8 M3.2): pins close at the
effective end, decided with A26, which is the first screen with a button to hang the
rule on. P37b records the gap deliberately and says in the case itself that M3.2
should invert it, so nobody fixing the bound reads a red test as a regression. The
people list still closes 24h after the effective end (V1); that is a read rule and
unaffected.

Written in M2.2 but gated by `adaptive = off`; switched on in M4.5. While it is off it
still runs every Monday and still logs, including the target it *would* have moved to,
so M4.5 is a checkbox and not new plumbing.

Until M4.5 it reads **live pins**, which is exact only because the trailing window (14
days) is shorter than pin retention (30 days, Part 3). If the two ever crossed it would
read gatherings whose pins had gone and return a confident shrink from incomplete data,
so both halves refuse rather than guess: a check constraint caps
`adjust_window_days` at 29, and the planner throws before computing anything (Alex,
M2.2).

### Logging
Every nightly choice is logged with its score, distance and the slot it filled, and
shown on the admin's Publishing panel in one line each. **The refusals are logged too**
(Alex, M2.2): a draft passed over because it had been public before reads "skipped,
previously published" rather than simply not appearing, and the same goes for the
venue cap, the score floor and a full week. A rule whose refusals are invisible is a
rule nobody can tell is working. Every draft inside the lead window gets a line;
drafts outside it are not candidates and are not logged, so the log is three weeks of
queue rather than the whole 8-week import.

Every weekly decision is logged with its inputs — the per-gathering rows it counted,
kept verbatim, so M4.5 can point the same arithmetic at `gathering_stats` and confirm
on the same weeks that the answer did not change.

**Seeded and organic are shown side by side, and "seeded" means somebody recorded
posting it** (Alex, M2.2) — a `gathering_promotions` row naming the channel, who
posted it and when, ticked next to the share link at the moment of posting rather than
reconciled from a list afterwards. It is deliberately *not* inferred from
`publish_mark`, which is only Alex's instruction to the publisher: the two coincide
only until the publisher picks a good game and someone posts it anyway, which is the
common case. A gathering with no promotion row counts as organic, so a forgotten tick
flatters the organic number rather than ours — the unseeded reach rate is a floor, not
a measurement. Neither split decides anything; the whole population does.

In week one there is no evidence: the target starts at 5 and Alex marks the two or
three the team will seed as "publish". Nothing reads ticket availability — off-sale is
not a problem.
