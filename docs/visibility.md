# Visibility rules — Phase 1 M1.1, extended in M1.2, M1.3, M2.1–M2.3 and M3.1

The plain-English rules that the privileges, RLS policies, storage policies and
database functions in `supabase/migrations/` implement. Agreed with Alex on
2026-09-18. Before the first real crowd (decisions.md Part 5), an independent
adversarial review — a fresh Claude Code session with no prior context, using
`docs/m1.1-review-brief.md` — checks the SQL and the harness (`tests/policies`)
against this file for leaks, and Alex gives this file their own read. Every rule has
an ID (V1–V19), and §16 maps each rule to the SQL that enforces it and the harness
cases (P01–P77) that prove it. M1.2 (admin) added V12, the draft/dismissed states in
V11, and cases P38–P47. M1.3 (Ticketmaster import) added V13 (withdrawn, §12c), the
importer's rights (§12d), three admin-only tables, and cases P48–P54. M2.1 (the public
web layer) added **V18 — seed rows never reach the public** (§12f), the one door the
public pages read through, the public slug, and cases P55–P61. M2.2 and M2.3 added
P62–P66. M3.1 **enforced V17** (§12g), moving the Instagram handle off the `people`
row, and added cases P67–P70, and rewrote **V6** for the automated photo check (§8) with cases
P71–P73, and added **V19 — a person's tags** (§12h) with cases P74–P77.

Binding sources: `decisions.md` H3 (reciprocal reveal), H6 (honest counts), H7
(women-only), H9 (block/report), H11 (visibility in the database), Q1, Q3, Q9, and
Part 5 (anonymous sign-in for web visitors).

**Default: deny.** RLS is on for every table, and every visitor privilege is revoked
and then granted back exactly. Anything not granted below is refused.

---

## 1 · Who is asking

| Who | Database identity | How |
|---|---|---|
| Visitor before pinning | `anon` role, no user | Worker calls with the publishable key |
| Visitor at and after pin-in | `authenticated`, anonymous user | Supabase anonymous sign-in at pin-in; the session travels in the signed cookie |
| App user (later phases) | `authenticated`, normal user | Apple / Google / email sign-in; same rules as a web visitor |
| Admin, cron, message sending | `service_role` | Bypasses RLS entirely. Only in admin routes (behind Cloudflare Access), Edge Functions and cron — never to read people for a visitor |

**Me** = the one `people` row whose `auth_user_id` is the session's user. A session
has at most one person (unique `auth_user_id`).

A visitor's session token is theirs: anyone holding it can call the Supabase API
directly, not only through the Worker. That is why every rule here lives in the
database — the Worker is not a gate.

## 2 · The core rule — V1 "V can see P at G"

A viewer V can see person P **at gathering G** only when all of these hold:

1. G is published (V11) and not withdrawn (V13, M1.3).
2. V and P both have a pin at G with `open_to_meeting = true`.
3. There is no block between V and P, **in either direction**.
4. Neither V nor P is hidden (`hidden_at` set by moderation).
5. The list at G is still open: until **24 hours after G's effective end** (Alex,
   M1.1). After that nobody at G can see anybody at G; counts stay readable.

Seeing is **scoped to G**: seeing Dev at Leafs vs Bruins reveals nothing about any
other gathering Dev is pinned to.

App phases will add "or V and P share a crew or a connection" (H3) as an extra branch
of the same single function (`private.can_see_at`). Nothing else may decide who sees
whom.

## 3 · What each person can see and change

| Data | Before pinning | Pinned, not opted in | Pinned + opted in at G | Service key |
|---|---|---|---|---|
| Published gatherings, their venues, meeting spots, gathering spot options; neighbourhoods | read | read | read | all |
| Unpublished gatherings and their spot options | — | — | — | all |
| Public counts (§4) | numbers only | numbers only | numbers only | all |
| Other people's pins | — | — | opted-in pins at G of people V1 allows | all |
| Other people's first name, neighbourhood, tags (V19) | — | — | people V1 allows | all |
| Other people's Instagram handle (`person_handles`) | — | — | **crewmates and connections only — V1 is not enough (V17)** | all |
| Other people's photo | — | — | people V1 allows, **approved photos only** (V6) | all |
| Gender, women-only flag, birth year, age attestation (`people_private`) | — | own only | own only — **never anyone else's** | all |
| Email / phone (`contact_points`) | — | own only | own only | all |
| +1s (`pin_friends`) | — | own pin's | + claimed +1s of hosts V1 allows (V7) | all |
| Spot poll | — | — | vote counts at G; own vote | all |
| WhatsApp group links | — | — | main link at G; women-only link if the offer is open to them (V5) | all |
| Survey responses | — | own | own | all |
| Blocks | — | own (as blocker) | own (as blocker) | all |
| Reports | — | — | file on people V1 allows; read none | all |

**Writes by a signed-in visitor** — only ever their own rows:
- create their own person (once) and their own `people_private` row;
- create, edit (`party_total`, `open_to_meeting`) and delete their own pins, on
  published gatherings only;
- create and edit their own contact points;
- edit their own first name, last initial, neighbourhood, photo path (own folder
  only), gender and women-only flag;
- add, edit and remove their own Instagram handle (`person_handles`, V17);
- upload, replace and delete photos in their own storage folder;
- cast, change and remove their own spot vote (while pinned and opted in there);
- submit their own survey response (published gatherings);
- create blocks as the blocker; file reports as the reporter.

They can **never** write `hidden_at`, `photo_status`, `auth_user_id` (after insert),
a report's `status`, or any row belonging to someone else. A visitor before pinning
writes nothing. +1 rows (`pin_friends`) are written by the service key until T10.

## 4 · Public counts — V2

`anon` cannot read `pins` or `people`. Counts for T2, T4 and T9 come from one
database function, `public.gathering_counts`, that runs with elevated rights and
**returns numbers only** — no ids of people, no names — for published gatherings:

- **pinned** = sum of `party_total` over pins at G. Includes hidden people (they are
  still going — H6).
- **open_to_meeting** = people with `open_to_meeting`, **excluding hidden people**.
  Never +1s (Q1). This is the threshold count.
- **women, men, other** = the gender mix, per V3.
- **crews_open** = 5+ open to meeting.

Blocks do not change any count. Reviewers: confirm nothing but aggregates leaves the
function.

## 5 · The gender mix — V3

(Alex, M1.1 — replaces the woman · man-only chip in decisions.md Q3.)

- Shown only at **5+ open to meeting**; below that, women, men and other are all null.
- **Women** and **Men** are always shown at 5+.
- **Other** = every answer that is not woman or man (nonbinary, prefer not to say, any
  future option). It is shown only when above zero (null at zero).
- The three always add up to open_to_meeting — the mix never implies a hidden
  remainder.
- Hidden people are left out, like open_to_meeting.
- Women-only eligibility still uses the underlying answer (V5), never the mix.
- The gender question must include **"Prefer not to say"** (stored as `undisclosed`).

Accepted risk (Alex): with small numbers, an "Other: 1" plus a list of names lets
someone guess. Counts are also live, so someone watching as one person opts in can
see which number moved. To keep that from naming anyone:

> **The T6 "Going & open to meeting" list must never be ordered by join time**
> (`created_at` of the pin or person). Order by first name, or anything else that
> does not reveal who joined last.

## 6 · Women-only — V5

**Eligible** = `gender = woman`, or `gender = nonbinary` with `include_in_women_only`.

- The **offer** (`public.women_only_offer`) is a yes/no — **never a number** (Alex,
  M1.1). It is yes only for someone who is eligible, pinned and opted in at G, not
  hidden, and only when **3 or more** eligible people are opted in (and not hidden)
  at G (Q9).
- The women-only WhatsApp link at G is readable under exactly the same condition.
- Everyone else gets nothing — not the link, not a count, not a sign that a group
  exists.
- Gender itself is readable only by its owner (`people_private`); eligibility checks
  run inside the database.

Why no number: next to the public mix, a women-only total would let an eligible
viewer subtract the woman count and learn how many nonbinary people opted in to
women-only — often exactly one.

## 7 · Blocks — V4

A row "A blocks B" makes A and B invisible to each other everywhere a person appears:
people rows, pins, photos, Instagram handles, and the host's +1s. It works in both
directions from one row.

- B cannot read the block row. Nothing else changes for B, counts included — B is
  never notified (H9).
- A can read their own block rows. There is no unblock in Test 0 (it arrives with A23).
- A +1 cannot be blocked on their own; blocking the host hides the host's +1s.
- Accepted: B may notice the list is one shorter than the count. Hidden people cause
  the same gap, so the gap does not prove a block.

## 8 · Photos and Instagram handles — V6

- Private storage bucket `photos`; JPEG, PNG, WebP or HEIC, 5 MB cap. A visitor's
  files live at `<auth user id>/<file name>`, and `people.photo_path` holds that
  name. **There is no public URL.**
- A photo is readable only through a signed URL, and Storage only issues one when the
  requester passes V1 for the photo's owner **and** the photo is `approved` **and**
  it sits in its owner's own folder. The owner can always read their own photo,
  whatever its status.
- **Moderation — rewritten in M3.1, when the automated check replaced the admin as
  the first decider.** A person appears in the list **immediately**, with their name.
  Their photo shows only once it is `approved`. **A photo state never hides the
  person**: a rejected photo leaves them visible without one.

  Four states, and the two that hide a photo are not the same thing:

  | State | What happened | What others see |
  |---|---|---|
  | `pending` | uploaded, not checked yet | the person, without a photo |
  | `approved` | a clear photo of a real person | the photo, to people V1 allows |
  | `needs_review` | **the check could not tell** — possibly not a real person, possibly someone else's, possibly a minor | the person, without a photo; a human decides |
  | `rejected` | **the check refused it** | the person, without a photo; they may upload another |

  - `ai:photo-check` moves `pending` to one of the other three. The admin moves any of
    them to `approved` or `rejected` and **cannot** set `pending` or `needs_review` —
    those are what a human was asked to resolve.
  - **The check never decides age on its own** (H8). A possible minor is routed to
    `needs_review`, never rejected. The 19+ rule stays with the attestation, the date
    of birth, reports and admin review.
  - Changing the photo sends it back to `pending` (trigger
    `people_photo_change_resets_status`), and a check that comes back about a photo the
    person has since replaced is **recorded and applies nothing** — the same
    stale-photo rule the admin's own button follows.
  - **A check that failed is not a state.** An error, a timeout or a missing key
    leaves the photo at `pending` and writes a `failed` row to `photo_checks`, so the
    admin can count *waiting for a human*, *never checked* and *check failing* apart
    (`admin_photo_states`). Unset is a different state from broken — the M2.3 map bug,
    one layer down.
  - `photo_checks` is service-key only, like every other operational record (V12), and
    every attempt's cost lands in `admin_ai_spend_today` so the $3/day cap can see it.
- **Signed URLs:** the Worker requests them with a 5-minute lifetime. The lifetime is
  chosen by whoever asks for the URL, so the database cannot enforce it: someone who
  is *allowed* to see a photo could mint a longer-lived link with their own session
  token. That is no worse than a screenshot, and it never gives access to a photo
  they could not already see.
- Instagram handles are **not** part of V6 and no longer sit on the `people` row.
  They live in `person_handles` behind V17 (§12e), which V1 does not satisfy. They
  are not moderated.
- A visitor can write only inside their own folder, and can point `photo_path` only
  into their own folder.

## 9 · Removing a pin, or switching opt-in off — V8

- They disappear from G for everyone at once, and they lose sight of G's list.
- Their spot vote stops counting (the row stays; it counts again if they opt back in).
- Their person row, private row and contact details stay (they may be pinned
  elsewhere); deletion belongs to the retention milestone.
- Signed photo URLs already issued keep working until they expire (5 minutes).

## 10 · +1s — V7

- A host reads their own pin's +1s (claimed or not).
- A viewer sees a **claimed** +1 ("Rohan · with Dev") only when V1 lets them see the
  host at that gathering. Unclaimed +1s are never listed.
- Readable +1 columns: id, pin, first name, claimed time, created time.
  `claim_token_hash` and the +1's age attestation are readable by nobody except the
  service key.
- +1s count in "pinned" and never in "open to meeting" (Q1).
- The claim itself (T10) is a separate milestone.

## 11 · Reports and auto-hide — V9, V10

- **V9 filing:** a signed-in person can file a report on a person V1 lets them see.
  They cannot read any report, including their own (Test 0). `is_safety` derives from
  the reason (a generated column); `status` cannot be set by the reporter. Crew and
  message reports arrive with the app.
- **V10 auto-hide** (H9), a database trigger on insert:
  - a report with a safety reason (`uncomfortable`, `under_19`) hides the target
    immediately;
  - `not_who_they_said` / `spam` hide the target at **two reports from two different
    reporters** (the same reporter twice counts once);
  - hiding sets `hidden_at` and marks the target's open reports `auto_hidden`, pending
    human review (unhiding is the admin milestone). Dismissed and actioned reports no
    longer count.
  - The trigger also handles crew and message targets, ready for the app.
- **Hidden people:** invisible to everyone (V1), cannot see anyone themselves, still
  counted in "pinned", not in "open to meeting" or the mix.
- Accepted risk: auto-hide on one safety report can be abused, but only by someone
  who pinned in and opted in at the same gathering (V9), and admin reviews every hide.

## 12 · Published gatherings — V11

`gatherings.published_at` (null = not public). A gathering is a **draft**, **published**
or **dismissed** (`status`, derived from `published_at` and `dismissed_at`; M1.2).
Drafts arrive from the Ticketmaster import, the AI discovery run or manual entry;
a draft merged into a duplicate is dismissed with `merged_into_id` set. `anon` and
`authenticated` read only published gatherings, and only those gatherings' spot
options, group links and counts — drafts and dismissed gatherings from every source
are invisible (P38). Pins and survey responses can only be created on published
gatherings (P08, P39). Venues and meeting spots are public places and are readable
regardless; the venue's city (`cities`) is public reference data.

Publishing rules, in the database so the service key cannot skip them (trigger
`gatherings_status_rules`; P42, P43): a gathering is published only with a venue;
unpublished only with zero pins; a published gathering's venue cannot change; a merged
gathering cannot be restored. **Meeting spots are not needed to publish** (Alex, M1.3,
replacing "3 approved spots"): the spot poll takes up to 3 of the venue's approved
spots at publish, and a spot approved later fills upcoming published polls up to 3
(trigger `meeting_spots_top_up_polls`, via `admin_top_up_spot_poll`, service key only —
P42, P48). No visibility changes: spots and published
spot options were already public.

## 12b · Admin-only data — V12 (M1.2)

- **Service key only, no visitor privileges at all:** `gathering_sources` (which
  source found a gathering), `gathering_triage` (AI score and reason),
  `spot_suggestions` (AI-proposed spots before approval — a pending suggestion is not a
  meeting spot and is not public), `venue_aliases`, `venue_external_ids`,
  `moderation_log`. Kept off public rows because RLS hides rows, not columns.
- **Admin actions** (`public.admin_*`: publish, unpublish, dismiss, restore, merge,
  photo approve/reject, unhide, keep hidden, hide now, dismiss reports, delete pin,
  approve/reject spot) are executable by `service_role` only. Each writes
  `moderation_log` with the admin's Cloudflare Access email in the same transaction.
- **Photo approval** applies only to the exact photo the admin looked at
  (`photo_path` must match); a photo changed meanwhile is refused (P46).
- **Venue maps** live in the **public** bucket `venue-maps`. A map shows a public
  building and its public spots — never a person (H1). There are no storage policies
  for visitors: they cannot upload, replace, delete or list (P44). Anything showing a
  person never goes in this bucket.
- **Admin identity:** `/admin` sits behind Cloudflare Access, and the Worker verifies
  the Access token (signature, audience, issuer, expiry, email allowlist) on every
  admin request, refusing with 403 otherwise. The admin reads people with the service
  key; this is the one surface that sees everything, which is why both locks exist.

## 12c · Withdrawn — V13 (Alex, M1.3)

A **withdrawn** gathering is a published gathering that is off — cancelled, postponed,
a takedown request, or another reason. Alex withdraws it in the admin, even when it
has pins (`admin_withdraw_gathering`), and can undo it (`admin_unwithdraw_gathering`).
The importer never withdraws anything: its cancellation and postponement flags lead
Alex here.

- **Who can see it:** only the people pinned to it (opted in or not) can read its row
  and its counts, so their page can show a short neutral notice. Everyone else — anon,
  signed-in visitors not pinned there — gets nothing, and it leaves every public list
  (P49).
- **What closes:** nobody can pin to it, vote in its spot poll or submit its survey;
  its "Going & open to meeting" list closes (V1), and with it photos, +1s and reports
  on people seen there; both WhatsApp links and the women-only offer close (V5); the
  spot options and poll counts are hidden (P50).
- **What stays:** every pin (a pinned person can still read and remove their own);
  the gathering itself (status `withdrawn`, still `published_at` underneath, so its
  venue stays fixed and it cannot be unpublished while withdrawn).
- **The reason** (cancelled / postponed / takedown / other) and Alex's note live in the
  admin-only `gathering_withdrawals`, never on the public row — "takedown" must not
  be readable by anyone else (P48).
- **Undo** restores everything (P51).

How: `private.is_published` and `private.list_open` now also require
`withdrawn_at is null`. Every M1.1 rule goes through one of the two, so pins, votes,
surveys, people, photos, +1s, reports, group links and the women-only offer follow
without their policies changing. The gathering row, its spot options and its counts
have their own conditions (`gatherings_read_published`,
`gathering_spots_read_published`, `public.gathering_counts`), using
`private.i_am_pinned_at`.

## 12d · Importer rights — M1.3

Enforced in `public.admin_import_apply`, not only in the Worker: the Ticketmaster
importer may create drafts and venues, refresh source rows, move a **draft's** date,
dismiss a **draft**, and restore a draft **it** dismissed (the last `moderation_log`
dismiss/restore entry is `importer:ticketmaster`). It can never change a published or
withdrawn gathering — only raise a flag in `gathering_flags` — and never restore a
draft Alex dismissed or merged (P52). Ticketmaster's ids, links and facts are deleted
30 days after each gathering's effective end (`admin_purge_ticketmaster_data`, P53).

## 12e · Instagram handles — V17 (Alex, revised build plan; **enforced in M3.1**)

### V17 · Instagram handles

A person may add an Instagram handle to their profile. It is always optional, never
required, and never a substitute for the face photo.

- **Who can see it:** only the person's **crewmates** (members of a crew they share),
  their **solo-plan partner**, and their **connections**.
- **Who cannot:** everyone else — including people who can see them on the open "going
  & open to meeting" list (V1 alone is **not** enough), `anon`, and every public page
  and link preview. This protects H2 (no cold DMs) and solo's mutual-accept rule.
- The owner can always read and edit their own handle.

**As built (M3.1, `20260921004053_m3_1_instagram_handle_v17`).** M1.1 put
`instagram_handle` on the `people` row, so until M3.1 it was readable by anyone V1
allows — V17 was stricter than the schema for as long as it existed. RLS hides rows,
not columns, so the handle moved to its own table, `public.person_handles`, with its
own policies, for the same reason gender and birth year live in `people_private` (D1).

- **Two branches, not three.** The rule names three readers, but a solo plan **is** a
  crew (`kind = 'solo'`, M3.4), so a solo-plan partner is a crewmate and needs no rule
  of its own. `private.can_see_handle` asks `private.share_crew` **or**
  `private.are_connected`, and then that neither person is blocked by the other or
  hidden by moderation. **M3.4 adds the `kind` column and the harness case that proves
  the solo partner falls out of the crew branch.**
- **A crew is a crew whatever its state** (Alex, M3.1): forming, spot set, live, done
  and dissolved all count. **Leaving** is what ends the sight of a handle
  (`crew_members.left_at`), not the crew's state. Rejected alternative: distinguishing
  a crew that met from one that dissolved — rarer than it sounds, harder to state, and
  harder for the M4.2 reviewer to audit. If it becomes a real problem it is split then,
  with evidence.
- **A crew hidden by moderation (`crews.hidden_at`) grants nothing**, on the same
  footing as a hidden person. Moderation is not a crew state.
- **V1 is deliberately not part of this rule.** Sharing the open list is not enough,
  and, in the other direction, a crewmate is still a crewmate after the list at that
  gathering has closed. A connection can read a handle with no gathering in common at
  all — and that is proved not to make either of them visible to the other under V1.
- The old Test 0 constraint "a photo **or** a handle" (`people_photo_or_instagram`)
  went with the column. It was never right for the link path: a quick pin (A26) has
  neither, and the app requires the photo separately (Q2).
- Harness: **P67–P70**, both sides of each branch. P11 and P24 were inverted in the
  same commit — both used to assert that the handle came back with the person's row.

## 12h · A person's tags — V19 (Alex, M3.1)

A person may carry up to three tags from a fixed vocabulary (spec A3;
`packages/shared/src/tags.ts`). They are **conversation handles, never match
criteria** — there is no matching anywhere in Pin'd.

- **Your own tags are always yours** — read, add, remove, whenever.
- **Someone else's tags are readable exactly when you can see that person at all.**
  The same rule as their first name and neighbourhood, no wider and no narrower:
  `private.can_see`. Both of you pinned and opted in at the same gathering, no block
  in either direction, neither of you hidden, the list still open.
- **Nobody else, ever:** not `anon`, not somebody who pinned without opting in, not a
  blocked person in either direction, not a hidden person, and never on a public page
  or in a link preview.
- **The vocabulary itself is public reference data.** `public.tags` is fifteen seeded
  rows that say nothing about anyone, readable exactly like `neighbourhoods` and
  writable by nobody but the service key.

**Why this rides V1 rather than getting a stricter rule of its own, which V17 needed.**
An Instagram handle is a way to contact someone off Pin'd, so it earned its own rule.
A tag is a handle the person chose **in order to be read by the people on the list with
them** — that is what it is for. So it travels with the first name, and it picks up the
crew and connection branches for free when H3 adds them to `can_see_at`, the same
saving as V17 having two branches instead of three.

**At most three, and no minimum** (Alex, M3.1). "Exactly 3" is what a *complete*
profile means and A3 is what asks for it. A minimum in the database would make a pin
impossible on the link path, where a profile is deliberately incomplete. A maximum is
a different thing: without one, `person_tags` is a place to write fifteen. The cap is
a constraint trigger rather than a screen, because a visitor's session token is theirs
and the app is not a gate (§1).

**P04 was inverted in the same commit** — it asserted `tags` and `person_tags` were
locked to every visitor, which was true until this rule existed.

### Still pending — decided, not yet enforced

V14 (solo), V15 (review-only gatherings) and V16 (anonymous people) are added with
their milestones (M3.4, M5.1, M3.1–M3.2) and reviewed in M4.2.

## 12f · Seed rows never reach the public — V18 (Alex, M2.1)

Until `pind-prod` exists (M4.3), **pind.social serves pind-staging**, which holds the
seeded venues, gatherings and people the admin was built against (decisions.md Part 5,
"pind.social before production"). Before M2.1 those rows were recognisable only by the
text `[TEST] ` at the front of a name — a label, not a rule. Now they carry a marker in
the database, and one rule sits on it.

**The rule: a seed row is invisible to every visitor — signed out and signed in alike.
Only the service key sees it.**

Hiding seed rows from `authenticated` as well as `anon` is deliberate (Alex, M2.1):
anonymous sign-in is one tap at A26, so "signed in" was never a gate. The consequence
is accepted — the M3.6 dogfood runs on real imported gatherings Alex has published,
with real accounts, which is the better rehearsal anyway.

**The marker.** `is_seed` on `venues`, `gatherings` and `people`, false by default, so
everything the importer, the admin and real people create is real. No visitor can write
it: every visitor-writable table grants its columns one by one and this is in none of
the lists (P58). A gathering at a seed venue is a seed gathering whether or not whoever
inserted it remembered — a trigger sets it, and flagging a venue later flags everything
already at it (P57). It is set on the row rather than looked up through the venue
because a policy that had to look the venue up would run that lookup under the
*caller's* RLS, where the seed venue is already hidden, and the test would invert.

**Nobody but the admin can:**

- see a seed gathering on the week's list, or open its crowd page, share card, OG image
  or `.ics` — every public URL answers as though it does not exist;
- read its row, its spot options or its counts;
- see a seed venue or that venue's meeting spots;
- see a seed **person** anywhere a person appears — the open list, a photo, a +1 — even
  when that person is pinned to a *real* gathering;
- have a seeded pin move "pinned", "open to meeting" or the gender mix, on any
  gathering. A fabricated pin is not someone going, so it is not a number (H6).

And it cuts both ways: a seed person sees nobody, exactly as a hidden person does.

**What still works.** The admin is untouched. It reads with the service key, so the
draft queue, the venue screens, the photo queue, the reports queue and the seeded
published gathering are all exactly as they were — which is what the seed was for.

**How.** `private.is_published` and `private.list_open` gain the condition, and every
M1.1 rule already runs through one of those two, so pins, votes, surveys, photos, +1s,
reports, group links and the women-only offer follow without their own policies
changing — the same shape V13 used. `private.is_open_at` carries the person half, one
line below `hidden_at`. The gathering row, the venue, the meeting spots, the retired
slugs and `public.gathering_counts` have their own conditions.

**This is permanent, not an M2.1 workaround.** When pind-prod exists the rule stays.
The only non-real rows ever allowed on production are the review-only ones for App
Review, which get their own rule (V15) in M5.1.

### What the public web may read

W1, W2, W3, the OG image and the `.ics` read through **two functions and nothing
else** — `public.public_gatherings` and `public.public_gathering` — so "what is on the
public web" is one definition in one place rather than a filter repeated in Worker code
(H11):

> **On the public web** = published, not withdrawn, not seeded, **and carrying a slug**.

A slug is minted by `admin_publish_gathering` and by nothing else. Neither function
returns anything about a person; counts come from `gathering_counts`, which returns
aggregates only (V2).

`public.public_gathering` is the one security-definer function that can see a
**withdrawn** row, because `/g/<slug>` has to answer the short neutral "no longer on
Pin'd" rather than a 404 (spec §2 W2). For a withdrawn gathering it returns the single
word `withdrawn` — no name, no venue, no date, no counts (P61). A visitor learns only
that this URL is no longer on Pin'd, which is strictly less than the page told them the
day before.

**What M2.3 added to the two doors, and why neither is a visibility change.** The rule
above is untouched: same definition, same where-clause, no policy added, altered or
dropped, and not one row readable that was not readable before.

- `public_gatherings` returns **`venue_id`** as well as the venue's name. A chip on W1
  appears only where there are three gatherings in at least two distinct *places*, and
  counting places by name is the kind of nearly-right that breaks when two rooms share
  one. A venue is a public building; its id is not a fact about anybody.
- `public_gathering` returns **`venue.map_spots`**: the coordinates of that venue's
  *active* meeting spots, and nothing else about them — no name, no id, no description.
  It is there so the crowd page can choose the map's zoom from the venue's whole spot
  set in the same round trip, which is what keeps one Mapbox picture per venue rather
  than one per gathering. A meeting spot is a curated public place (H5) whose
  coordinates already appear on every crowd page at that venue; no coordinate in this
  product belongs to a person (H1, H4). The only new fact a visitor can infer is how
  many spots a venue has, where its own poll shows up to three.

**The tabs and the chips are not a visibility mechanism.** Events and Community are
split on `source`, and a chip narrows what a reader asked for. Both happen in the
Worker over one read of rows that are already public, and neither can widen a list or
show a person: W1 shows gatherings. Proved by P65 (the doors return every field their
readers need) and P66 (the chip rule itself, and that no visitor may run it).

### Two accepted exceptions, both deliberate

**1 · The policy harness's own rows are real rows, and a few of them are briefly
public.** (Alex, M2.1, after asking whether it could be closed.)

The harness builds a world of published gatherings and people on pind-staging and
sweeps it at the end of each run. Those rows are **not** flagged `is_seed`, because
about twenty-five cases read the world as a signed-out visitor — every counts
assertion, the draft-invisibility cases, the photo-URL-guessing case — and flagging
them would have the harness testing a world its own rule had already emptied.

Building the world unpublished and publishing only inside the transaction that tests
publishing does not work: the harness speaks to Postgres over PostgREST, where one
HTTP request is one transaction, so no transaction can span "publish it, read it as
anon, unpublish it". Every other way of keeping the coverage comes down to a
harness-only session marker — a JWT claim or a request header checked inside a
policy — which is a **backdoor in the visibility layer**, and worse than the gap it
would close.

What is left, after the slug gate above:

- The harness inserts its gatherings straight through the service key, so they get **no
  slug**, so they appear on **no public list and have no public URL** (P59). W1, W2, W3,
  the OG image and the `.ics` cannot reach them at all.
- The two or three drafts that P42, P43 and P49 publish through `admin_publish_gathering`
  **do** get a slug, and are reachable on the public pages for the seconds between that
  call and the sweep.
- Anyone holding the publishable key could call the Supabase REST API directly during a
  run and read a `pindhx` gathering **row** — not a page.

Both residues last as long as a harness run, one or two minutes, on a domain nothing
points at, while every page is `noindex` and unlinked (decisions Part 5, "Public pages
before the privacy policy"). **The exception expires at M4.3**: from then pind.social
serves pind-prod, and the harness only ever runs against staging, so the overlap stops
existing. Closing it sooner means a second Supabase project for the harness, which is
Alex's call and a change to make between milestones.

**2 · A seeded venue's uploaded map image stays fetchable.** `venue-maps` is a public
bucket by decision (V12): a map is a building and its public spots, never a person. RLS
hides rows, not objects in a public bucket, so a seed venue's uploaded map can still be
fetched by anyone who has its URL — which needs the venue's UUID, and the venue itself
is invisible, and nothing links to it. Accepted (Alex, M2.1); the alternative is a
private bucket and a signed URL for every map on every crowd page, which is work with
no reader.

### The public slug, and every slug it has ever had

`gatherings.slug` is the public URL segment, minted at publish. Nothing ever recomputes
it: the importer renames nothing on a published gathering, it raises a flag (§12d).
Alex can change it by hand in the admin (`admin_set_slug`), and then:

- the old slug moves to `gathering_slug_history` and `/g/<old>` answers a **301**
  forever, so a Reddit post from six weeks ago still lands (P60);
- a slug is spent the moment it is used, live or retired, and is **never** handed to
  another gathering (P60);
- a published slug can never be removed — a URL that starts answering 404 is worse than
  one that looks out of date.

Retired slugs are readable by `anon` for the gatherings whose rows are readable, which
is what lets the redirect work; nothing else about them is public.

---

## 13 · Spot poll

- **One vote per person per gathering, changeable** (Alex, M1.1). Enforced by the
  primary key `(gathering_id, person_id)` on `spot_votes`; changing a vote is an
  update of `gathering_spot_id`.
- Voting needs the voter pinned and opted in at that gathering, and not hidden.
- Vote counts (`public.spot_poll`) are returned only to someone opted in at G (T6).
  A person reads only their own vote row.
- `/spot` shows the chosen spot and time only, never counts.

## 14 · Schema changes this milestone makes

- **D1** — `people_private` (owner-only): `gender`, `include_in_women_only`,
  `birth_year`, `age_attested_at` moved out of `people`. RLS hides rows, not columns;
  gender must never be readable per person.
- **D2** — `gathering_group_links`: the two WhatsApp URLs moved out of the public
  `gatherings` row, with V5 rules.
- **D3** — column privileges: `claim_token_hash` unreadable; `hidden_at`,
  `photo_status`, `auth_user_id` (after insert) and report `status` not writable by
  visitors.
- **V11** — `gatherings.published_at`.
- **Spot poll** — `spot_votes.gathering_id`, one vote per person per gathering.
- Storage bucket `photos` (private) with its policies.

## 15 · Scope — tables

| Access | Tables |
|---|---|
| Public read (published only where it applies, and never a seed row — V18) | `venues`, `meeting_spots`, `gatherings`, `gathering_spots`, `gathering_slug_history`, `neighbourhoods`, `cities`; storage `venue-maps` (public URLs, no visitor writes) |
| Rules above | `people`, `people_private`, `person_handles`, `pins`, `pin_friends`, `contact_points`, `spot_votes`, `gathering_group_links`, `blocks`, `reports`, `survey_responses`, storage `photos` |
| Service key only, permanently | `photo_checks`, `magic_links`, `outbound_messages`, `gathering_sources`, `gathering_triage`, `spot_suggestions`, `venue_aliases`, `venue_external_ids`, `moderation_log`, `import_runs`, `gathering_flags`, `gathering_withdrawals`; functions `admin_*` |
| Public reference data | `tags` (the fixed vocabulary; read-only to visitors) |
| Locked until the app phases (no privileges, no policies) | `crews`, `crew_members`, `crew_proposals`, `crew_proposal_votes`, `crew_join_requests`, `crew_messages`, `confirmations`, `connections` (read by V17's rule, never granted to a visitor directly) |

## 16 · Rule → SQL → proof

Migrations are in `supabase/migrations/`, prefixed `20260918134…_m1_1_` (M1.1),
`20260918154…_m1_2_` (M1.2), `20260918192…_m1_3_` (M1.3), `20260920003…_m2_1_` (M2.1),
`20260920143…_m2_2_` (M2.2), `20260920203410_m2_3_the_list` (M2.3) and
`20260921004053_m3_1_instagram_handle_v17` (M3.1).

| Rule | Enforced by | Harness cases |
|---|---|---|
| V1 reciprocal reveal | `private.can_see_at`, `private.can_see`; policies `people_read_visible`, `pins_read_visible` | P09–P13, P37 |
| V2 public counts | `public.gathering_counts` | P02, P05, P16, P21, P34, P37 |
| V3 gender mix | `public.gathering_counts` | P06 |
| V4 blocks | `private.blocked_between` (inside V1); policies `blocks_*` | P14–P16 |
| V5 women-only | `private.women_only_open`, `public.women_only_offer`; policies `group_links_*` | P17–P20 |
| V6 photos | bucket `photos`; `private.can_see_photo`; storage policies `photos_*`; trigger `people_photo_change_resets_status`; `people_insert_self` / `people_update_self` folder check | P07, P07b, P21, P23–P26 |
| V6 the automated check (M3.1) | `photo_status` gains `needs_review`; table `photo_checks`; `admin_record_photo_check`, `admin_photo_states`, `admin_set_photo_status`; trigger `people_photo_check_webhook` → `private.photo_check_webhook` | P71–P73 |
| V7 +1s | column grant on `pin_friends`; policies `pin_friends_read_*` | P27, P28 |
| V8 removing a pin | V1 and `public.spot_poll` read live pins | P21, P22 |
| V9 filing reports | column grant on `reports`; policy `reports_insert_on_visible_person` | P33 |
| V10 auto-hide | trigger `reports_auto_hide` → `private.auto_hide_on_report` | P34–P36 |
| V11 published | policies `gatherings_read_published`, `gathering_spots_read_published`; `private.is_published` in pin/survey inserts | P01, P02, P08, P38, P39 |
| V11 publishing rules | trigger `gatherings_status_rules` → `private.gathering_status_rules`; `admin_publish_gathering`, `admin_merge_gatherings` | P42, P43 |
| V12 admin-only data | `revoke all` on the six admin tables; `admin_*` executable by `service_role` only; bucket `venue-maps` with no visitor policies | P40, P41, P44 |
| V6/V10 after review | `admin_set_photo_status`, `admin_unhide_person`, `admin_hide_person`, `admin_keep_hidden`, `admin_delete_pin` | P45–P47 |
| V12 import data (M1.3) | `revoke all` on `import_runs`, `gathering_flags`, `gathering_withdrawals`; M1.3 `admin_*` executable by `service_role` only | P48 |
| V13 withdrawn | `private.is_published`, `private.list_open`, `private.i_am_pinned_at`; policies `gatherings_read_published`, `gathering_spots_read_published`; `public.gathering_counts`; `admin_withdraw_gathering`, `admin_unwithdraw_gathering` | P49–P51 |
| Importer rights | `admin_import_apply`, `admin_resolve_flag`, `admin_start_import_run`, `admin_purge_ticketmaster_data`, `admin_merge_venues`, `admin_confirm_venue` | P52–P54 |
| V17 Instagram handles (M3.1) | table `public.person_handles`; `private.can_see_handle`, `private.share_crew`, `private.are_connected`, `private.is_hidden`; policies `person_handles_read_own`, `person_handles_read_visible`, `person_handles_*_own` | P67–P70, P11, P24 |
| V19 a person's tags (M3.1) | policies `tags_read`, `person_tags_read_own`, `person_tags_read_visible`, `person_tags_*_own`; `private.can_see`; trigger `person_tags_at_most_three` → `private.person_tags_cap` | P74–P77, P04 |
| V18 seed rows | `venues.is_seed`, `gatherings.is_seed`, `people.is_seed`; triggers `gatherings_seed_follows_venue`, `venues_seed_spreads`; `private.is_published`, `private.list_open`, `private.is_open_at`, `private.is_seed_venue`; policies `gatherings_read_published`, `gathering_spots_read_published`, `venues_read`, `meeting_spots_read`; `public.gathering_counts` | P55–P58 |
| The public web's one door | `public.public_gatherings`, `public.public_gathering` | P55, P59, P61, P65 |
| The chip a Ticketmaster gathering wears (M2.3) | `public.chip_category`, `public.admin_categorise_gatherings` — both `service_role` only; written once, never over an existing value | P66 |
| The public slug and its 301 | `gatherings.slug`, `gathering_slug_history`, trigger `gatherings_slug_history`; `admin_mint_slug`, `admin_set_slug`, `admin_publish_gathering` | P59, P60 |
| Own rows only | policies `*_own`, `*_self`; column grants | P07, P08, P10, P30, P32 |
| Locked tables | `revoke all` with nothing granted back | P03, P04 |
| Spot poll | `spot_votes` primary key; policies `spot_votes_*`; `public.spot_poll` | P21, P29–P31 |

## 17 · Open items

- ~~**T5 new-device sign-in**~~ — *superseded; see decisions.md Part 5, "Identity"*:
  the anonymous user is linked to an email, Apple or Google identity at opt-in, so a
  new device signs in through Supabase Auth.
- ~~**+1 claim (T10)**~~ — *superseded; see decisions.md Part 5, "Identity", and Q1*:
  the claim page is dropped; a +1 who wants to be seen pins in themselves.
- ~~**Anonymous sign-in rate limit (T3)**~~ — *superseded; see decisions.md Part 5,
  "Identity"*: the Expo app (A26) signs people in from their own device, not the Worker.
