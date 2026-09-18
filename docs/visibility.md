# Visibility rules — Phase 1 M1.1, extended in M1.2 and M1.3

The plain-English rules that the privileges, RLS policies, storage policies and
database functions in `supabase/migrations/` implement. Agreed with Alex on
2026-09-18. Before the first real crowd (decisions.md Part 5), an independent
adversarial review — a fresh Claude Code session with no prior context, using
`docs/m1.1-review-brief.md` — checks the SQL and the harness (`tests/policies`)
against this file for leaks, and Alex gives this file their own read. Every rule has
an ID (V1–V13), and §16 maps each rule to the SQL that enforces it and the harness
cases (P01–P54) that prove it. M1.2 (admin) added V12, the draft/dismissed states in
V11, and cases P38–P47. M1.3 (Ticketmaster import) added V13 (withdrawn, §12c), the
importer's rights (§12d), three admin-only tables, and cases P48–P54.

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
| Other people's first name, neighbourhood, Instagram handle | — | — | people V1 allows | all |
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
- edit their own first name, last initial, neighbourhood, Instagram handle, photo
  path (own folder only), gender and women-only flag;
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
- **Moderation (Test 0):** a person appears in the list **immediately** with name and
  Instagram handle. Their photo shows only after admin approves it (the page shows a
  placeholder until then). A rejected photo stays hidden and the person stays
  visible without one. Changing the photo sends it back to `pending`. The
  approve/reject control is built in the admin milestone; this rule and its tests
  are here.
- **Signed URLs:** the Worker requests them with a 5-minute lifetime. The lifetime is
  chosen by whoever asks for the URL, so the database cannot enforce it: someone who
  is *allowed* to see a photo could mint a longer-lived link with their own session
  token. That is no worse than a screenshot, and it never gives access to a photo
  they could not already see.
- Instagram handles get the V1 check (they sit on the `people` row). They are not
  moderated.
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
`gatherings_status_rules`; P42, P43): a gathering is published only with a venue that
has 3 approved (active) meeting spots; unpublished only with zero pins; a published
gathering's venue cannot change; a merged gathering cannot be restored.

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
| Public read (published only where it applies) | `venues`, `meeting_spots`, `gatherings`, `gathering_spots`, `neighbourhoods`, `cities`; storage `venue-maps` (public URLs, no visitor writes) |
| Rules above | `people`, `people_private`, `pins`, `pin_friends`, `contact_points`, `spot_votes`, `gathering_group_links`, `blocks`, `reports`, `survey_responses`, storage `photos` |
| Service key only, permanently | `magic_links`, `outbound_messages`, `gathering_sources`, `gathering_triage`, `spot_suggestions`, `venue_aliases`, `venue_external_ids`, `moderation_log`, `import_runs`, `gathering_flags`, `gathering_withdrawals`; functions `admin_*` |
| Locked until the app phases (no privileges, no policies) | `tags`, `person_tags`, `crews`, `crew_members`, `crew_proposals`, `crew_proposal_votes`, `crew_join_requests`, `crew_messages`, `confirmations`, `connections` |

## 16 · Rule → SQL → proof

Migrations are in `supabase/migrations/`, prefixed `20260918134…_m1_1_` (M1.1) and
`20260918154…_m1_2_` (M1.2) and `20260918192…_m1_3_` (M1.3).

| Rule | Enforced by | Harness cases |
|---|---|---|
| V1 reciprocal reveal | `private.can_see_at`, `private.can_see`; policies `people_read_visible`, `pins_read_visible` | P09–P13, P37 |
| V2 public counts | `public.gathering_counts` | P02, P05, P16, P21, P34, P37 |
| V3 gender mix | `public.gathering_counts` | P06 |
| V4 blocks | `private.blocked_between` (inside V1); policies `blocks_*` | P14–P16 |
| V5 women-only | `private.women_only_open`, `public.women_only_offer`; policies `group_links_*` | P17–P20 |
| V6 photos | bucket `photos`; `private.can_see_photo`; storage policies `photos_*`; trigger `people_photo_change_resets_status`; `people_insert_self` / `people_update_self` folder check | P07, P07b, P21, P23–P26 |
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
| Own rows only | policies `*_own`, `*_self`; column grants | P07, P08, P10, P30, P32 |
| Locked tables | `revoke all` with nothing granted back | P03, P04 |
| Spot poll | `spot_votes` primary key; policies `spot_votes_*`; `public.spot_poll` | P21, P29–P31 |

## 17 · Open items

- **T5 new-device sign-in — open, decided in the T5 milestone.** Sessions for an
  existing user on a new device come from Supabase Auth, not Postgres. Two options:
  Supabase Auth's own email sign-in linked to the anonymous user, or a narrow
  service-key exception. No work in M1.1.
- **+1 claim (T10)** — mechanism and `pin_friends` write rules decided in the T10
  milestone.
- **Anonymous sign-in rate limit (T3)** — Supabase limits anonymous sign-ins per IP.
  If the Worker makes them, visitors may share Cloudflare's IPs. Resolve in T3.
