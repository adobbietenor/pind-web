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
A real public event. Imported from the Ticketmaster Discovery API or entered by hand
(teams, festivals, club nights). Fields: name, starts_at, `ends_at` (nullable), venue,
ticket_url, a static map image showing the venue and its meeting spots, `featured` flag.

**Effective end** = `ends_at`, or `starts_at + 180 minutes` when `ends_at` is null.
Admin can set `ends_at` per gathering; festival days and club nights get it set by
hand. Everything time-driven *after* a gathering (crew `done`, thread close, 72h
keep-in-touch expiry, pin deletion) keys off the effective end, never `starts_at`.

Derived counts:
- **N pinned** = sum of `party_total` across pins. This is the honest number of
  bodies going (H6).
- **N open to meeting** = count of distinct people with `open_to_meeting`. Never party
  totals: a +1 has consented to nothing. This is the count that reaches the threshold of 5.
- **Gender mix** = count of opted-in `woman` and `man` only, rendered "8 · 4", and only
  at 5+ opted in (Q3). `nonbinary` and `undisclosed` count in the pinned total but are
  never broken out — at these numbers a breakout identifies one person.
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

Deliberately plain: white pages, system type, one purple button. Must load in under
a second inside a Reddit tab and feel legitimate in a fan thread, not like a startup.
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
- Counts: pinned, open to meeting, gender mix ("8 · 4", woman · man only, and only at
  5+ opted in — Q3)
- **House rules**, verbatim:
  1. Meet in public — named spots only, before the event.
  2. You see people only after they can see you.
  3. Leave any time. Block & report are one tap away.
- Primary action: **"Pin in — I've got a ticket"**
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
  No tags in Test 0 — tags are app-only.
- **Spot poll**: exactly 3 curated spots with times and vote counts (H5)
- "Join the WhatsApp group (14)" — link pasted by admin at threshold
- At 3+ eligible people opted in (women, plus nonbinary people who opted into
  women-only): a separate **women-only group** offer, shown only to eligible people.
  Only the total is ever displayed, never the composition (Q9, H7)
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
- **Admin** — behind Cloudflare Access (no admin table). Create a gathering (name,
  date, optional end time, venue, 3 spots, ticket link, map image),
  paste WhatsApp group links, view pins and opt-ins, export CSV, delete a pin on request.

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
show my neighbourhood, count me in the gender mix.
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
- Primary action: **"Pin in — I've got a ticket"**
- Threshold explanation: "Crews open when 5 people opt in."
- The three house rules, verbatim, on every crowd surface (see T2).
- Never use the phrase "not a dating app" in user-facing copy except the single
  onboarding line at A1. Use crew language everywhere else.

---

## 6 · Open items

Deferred to the retention and account-deletion milestone. The initial schema does not
yet satisfy these; they must be fixed there.

- **Deleting a gathering must not take pins and survey responses with it.** Today
  `pins`, `survey_responses` (and the other Test 0 rows) cascade on gathering delete.
  `decisions.md` keeps aggregate counts after pins are deleted, and the Test 0 survey
  data is the whole point of the test.
- **Deleting a person must not remove their confirmations.** Today `confirmations`
  cascades on person delete, so a crewmate can lose their "showed up" badge because
  someone else left.
