# Pin'd — product decisions

These are binding product rules, not suggestions. They come from the design board
and the research assessment. If an implementation seems to require breaking one,
stop and ask — do not work around it.

Last updated: 18 September 2026 (the revised build plan, `docs/build-plan.md`, merged).

---

## Part 1 — Hard rules (never violated, in any surface)

| # | Rule | Why |
|---|------|-----|
| H1 | **Never a map of people.** A map appears only on a crowd page, showing the venue and its curated meeting spots. | The entire graveyard of "see who's around" products died on this. |
| H2 | **No swipes, likes, matches, hearts, follows, or cold DMs.** | Positioning: this is not a dating app. A swipe UI loses that argument in ten seconds. |
| H3 | **Reciprocal reveal only.** You see a person's name and photo only once you have pinned in AND opted in to meeting at the same gathering — or you share a crew or a connection with them. | Nobody can browse who will be where without committing to be there too. |
| H4 | **No location permission, ever.** The app never requests device location. The only coordinates in the system belong to venues and curated meeting spots. | Removes the stalking class of risk entirely; also removes a permission prompt that reframes the product. |
| H5 | **Crews are 3–8 people, meeting at a curated public spot.** No 1:1 meet-ups. No free-text addresses, ever. | Safety with no host present. Every meeting happens somewhere public with staff and crowds. |
| H6 | **Honest counts, always — including zero.** Never inflate, never hide a small number, never fabricate a user or a pin. | IRL raised $200M on fake users and its founder was charged with fraud. |
| H7 | **Women-only crews available on every gathering.** Open to `gender = woman` plus nonbinary people who set `include_in_women_only`; invisible to everyone else. | The least-safe user is also the most likely customer. |
| H8 | **19+ only** (Ontario drinking age). Under-19 date of birth is a hard stop at sign-up, no soft fail. | Legal and safety. |
| H9 | **Block and report are two taps from any person, crew or message.** Blocking is mutual invisibility and never notifies the other party. Report severity is derived from the reason, never asked: "uncomfortable" and "under 19" auto-hide the target immediately; "not who they said" and "spam" auto-hide at two reports. | Apple Guideline 1.2 and Google UGC policy require it; users look for it first. |
| H10 | **The company is never present at a gathering.** No hosting, no staffing, no attending as operators. | Team constraint. The product's job finishes before the event starts. |
| H11 | **Visibility is decided in the database, never by filtering in application code.** | One place to review, one place to get right. |

**Decided exception (Alex, after Phase 1 M1.3):** the "Solo crew" beta feature is a
deliberate, narrow exception to H2 (no cold DMs) and H5 (no 1:1 meet-ups), with the
guardrails in Part 5, "Future and beta features". Every other rule stands.
Implemented (Alex, revised build plan) as `crews.kind = 'solo'` with exactly two seats;
H5's 3–8 governs `kind = 'crew'`; any report on a person hides them from solo
immediately (`people.hidden_from_solo`).

---

## Part 2 — The eleven UX calls

Each shows the call as designed and the alternative, if it is ever revisited.

### Q1 — How +1 friends exist
**Call:** A pin carries `party_total` (1–10; UI: alone / +1 / +2 / a group) and
everyone in it counts instantly toward "N pinned" (displayed as "Dev +1"). A +1 has
consented to nothing: they never count toward "open to meeting" or the threshold of
5, and never appear in the reciprocal list. **The +1 claim page is dropped** (Alex,
revised build plan): a +1 who wants to be visible pins in themselves through the share
link. `party_total` keeps counting bodies. Crews show "+1 friend" for a seat taken by
an unnamed +1, and a +1 occupies a seat: a member with a +1 takes 2 of the 8.
**Alternative:** force every attendee to pin individually. Cleaner data, but it taxes
the organiser and undercounts real groups.

### Q2 — Photo policy, web vs app
**Call** (Alex, revised build plan; replaces Test 0's "photo **or** Instagram
handle"): the face photo is **required to opt in to meeting** (A27 on the link path, A2
on the store path), **never to pin** — a pin buys a count, which needs no face; opting
in buys visibility, which does. Crews look for faces at a patio table. There is no
Instagram alternative: a handle is an optional profile extra, never a substitute for
the photo (Part 5, "Instagram handle"). The check is automated (Part 5, "Automated
photo moderation").
**Alternative:** require photos everywhere from day one. Safer-feeling list, worse funnel.

### Q3 — Gender mix at tiny counts
**Call:** pin and opt-in counts are always shown honestly; the **gender mix appears
only at 5+ opted in** (A6, A9). Below that it can identify the single woman who opted in.
The mix shows **Women** and **Men**, plus **Other** only when above zero. Other is every
answer that is not woman or man (nonbinary, prefer not to say). The three always add up
to the open-to-meeting count, so the mix never implies a hidden remainder. The small
inference risk that remains is accepted; the pinned list is never ordered by join time.
(Revised by Alex in Phase 1 M1.1; previously woman · man only.)
**Alternative:** always show the mix, rule-literal. Simpler to explain, small safety cost.

### Q4 — Who approves crew joins
**Call:** **any member can approve** (A12). Crews have no owner. Declines are silent —
the requester sees a "crew filled up" framing, never a rejection event.
**Alternative:** creator-only approval. More accountability, but creates a boss of what
should be a table of strangers.

### Q5 — The ninth person
**Call:** when a crew is 8/8, offer a **prefilled sibling crew** at the same spot, 15
minutes later (A15). Never a waitlist.
**Alternative:** waitlist with auto-promote. Handles dropouts, leaves the 9th person
planless until it is too late to matter.

### Q6 — Keep-in-touch mechanics
**Call:** ticks are **invisible until mutual** (A16), gated behind a mutual "we met",
and **expire 72 hours after the event**. No pending state, no rejection receipt.
**Alternative:** show one-way interest. Higher connection rates, reinvents the like button.

### Q7 — "I'm here" without location
**Call:** manual tap plus a **required one-line description** ("green Matthews jersey") (A13).
Unlocks 3 hours before the gathering.
**Alternative:** geofenced check-in. **Rejected outright** — violates H4.

### Q8 — Threshold message channel
**Call** (Alex, revised build plan; replaces Test 0's "email or phone, either works"):
a **permanent identity** — email one-time code, Apple or Google — is required at opt-in
(A27 / A1). Push reaches people with the app; **email is the channel for people without
a device token**; **SMS is never used**. Nothing asks for a phone number.
**Alternative:** require phone. One channel to build, higher form abandonment.

### Q9 — WhatsApp group shape (Test 0 only) — **retired**
*Retired (Alex, revised build plan): the WhatsApp Test 0 is dropped and there are no
WhatsApp groups. Kept for history; do not build. Women-only crews (H7) replace the
women-only group; the "never a number" reasoning still applies to any women-only
signal.*
**Call:** **one group per gathering**, created at threshold, link visible only from the
pinned crowd page (T6). A separate **women-only group opens at 3+ eligible people
opted in** — `gender = woman` plus nonbinary people with `include_in_women_only`. The
same set decides the trigger and who can join (H7); otherwise the product either opens
a group three eligible people can't fill, or fails to open one for three who qualify.
The offer is shown to eligible people **without a number** — next to the public mix, a
total would reveal how many nonbinary people opted in (Phase 1 M1.1).
**Alternative:** a group per crew. Better dress rehearsal for the app, worse critical mass.

### Q10 — Ordering the crowds list
**Call:** **by date, always** (W1, A7). The calendar is the algorithm. Small counts are
shown with the threshold as explanation ("3 pinned · crews open at 5").
**Alternative:** sort by pin count. Better first impression, buries new gatherings at zero forever.

### Q11 — What happens to closed threads
**Call:** the crew thread closes 24h after the gathering, is **read-only for 30 days,
then deleted** (A17).
**Alternative:** hard delete at close. Stronger privacy story, punishes whoever did not
screenshot the plan.

---

## Part 3 — Data retention

"After the gathering" always means after its **effective end**: `ends_at`, or
`starts_at + 180 minutes` when `ends_at` is null.

| Object | Retention |
|--------|-----------|
| Pins | Deleted 30 days after the gathering; aggregate counts kept |
| Crew threads | Read-only 24h after the gathering; deleted at +30 days (Q11) |
| Keep-in-touch ticks | Expire 72h after the gathering if not mutual (Q6) |
| Gender | Kept on the person; never shown per-person, only in the aggregate chip and women-only eligibility |
| Reports and moderation decisions | Kept 12 months |
| Reported message content | Retained with the report for 12 months, independent of thread deletion |
| Profiles, connections, gatherings-attended counts | Persist |
| Date of birth | Year kept after the 19+ check; full date discarded |
| Device location | Never collected (H4) |
| Solo proposals | Expire at the gathering's `starts_at`; deleted with the pin (Alex, revised build plan) |
| Solo plans | Follow crew retention: thread read-only 24h after, deleted at +30 days (Q11) |
| Anonymous people (pinned, never opted in) | Deleted with their last pin, 30 days after the gathering |
| `gathering_stats` snapshots | Persist (aggregates only; what survives pin deletion for §7 of the spec) |
| Instagram handle | Kept on the profile until the person removes it or deletes their account |

## Part 4 — Data deliberately not collected

Device location, contacts, phone numbers (until OTP is ever needed), surnames beyond
an initial, ticket or seat data, message content for any purpose beyond delivery and
moderation, advertising identifiers, third-party ad or attribution SDKs, employer,
school, sexual orientation. Tags are optional on the link path and nudged later
(Alex, revised build plan); "exactly 3" defines a complete profile.

Collected only if the person chooses to add it: an **Instagram handle** — optional,
never required, never a substitute for the face photo, and visible only to crewmates,
a solo-plan partner and connections (Part 5, "Instagram handle").

Collected with a stated purpose: **self-declared gender** (woman / man / nonbinary /
undisclosed), a protected attribute. Its purpose — women-only crews, solo's "women
only" limiter, and the aggregate mix chip — is stated in the privacy policy. It is never exposed on a
profile.

## Part 5 — Implementation decisions

- **Identity** (was "Test 0 identity"; revised by Alex in the revised build plan).
  **Anonymous at pin, permanent at opt-in, same user id.** Quick pin (A26) creates a
  Supabase anonymous user, so every session has a real JWT and RLS applies identically
  on web and in the app (H11). Opting in (A27) links the same user to an email
  (one-time code), Apple or Google identity; the pin, party size and opt-in survive.
  No magic links, no session cookie. The **photo** is asked at opt-in, not at pin
  (Q2). The Worker uses `service_role` only for admin, cron, the imports, AI jobs and
  sending messages — never to read people on behalf of a visitor.
  `people.auth_user_id` stays nullable.
- **Admin** sits behind Cloudflare Access. There is no admin table.
- **"Suggest a gathering"** is a mailto link. Nothing is stored.
- **Crew state** is stored as a column; time-driven transitions (live, done,
  auto-dissolve) are applied by pg_cron. `dissolved` is a fifth, terminal state; the
  row is never deleted.
- **Crew seats:** a member occupies 1 or 2 seats (at most one +1). `pins.party_total`
  stays 1–10 and is independent.
- **Dissolve notification** is folded into A18 notification 3 ("Crew status — formed /
  spot set / dissolved"). Still five. A18's rule is five moments, all about a plan — a
  ban on engagement bait, not a count to defend; a dissolve is a plan-state change.
- **Contact details** (email; phone is not collected — Q8, Part 4) live in their own
  table, never on the person row.
- **Product domain: pind.social** (Alex, Phase 1 M1.1). Crowd pages, share links and
  emails use it. PindScene.com redirects to it once it is live. The domain is bought
  but not yet set up in Cloudflare or the Worker. The switch happens in **M2.1**
  (Alex, revised build plan), with the admin moving to `pind.social/admin` and
  Resend's domain records added.
- **Gathering sourcing** (Alex, Phase 1 M1.2). Gatherings are not typed in by hand.
  They arrive as **drafts** from three sources: a nightly Ticketmaster Discovery API
  import (M1.3); a weekly AI discovery run — Claude with web search — for free and
  community events such as festivals, markets, run clubs and club nights (the
  Community & free run, **M4.4**); and manual entry, as a fallback only. AI vets and
  scores every draft with a one-line reason. The auto-publisher publishes them (M2.2,
  "Auto-publishing, adaptive" below); Alex can still publish by hand. **Publishing
  selectively is deliberate: pins must concentrate so crowds reach 5.** A draft is
  published, dismissed or merged into a duplicate found by another source; an
  importer never changes a published gathering (it only flags it — M1.3, "Importer
  and status changes" below), and a dismissed or merged event is never re-created by
  a later import.
- **Ticketmaster import area** (Alex, Phase 1 M1.3). The nightly import searches
  **30 km** around the city centre (Toronto: Union Station), **8 weeks** ahead. The
  centre point, the search radius and a "core" radius are stored on the `cities` row,
  never in code, so another city is data, not a rebuild. Suburban events are kept but
  ranked a little lower: each venue's distance from the centre is **calculated** (not
  judged by AI), shown in the draft queue, and applied as a modest adjustment to the
  AI score — none inside the core radius, a gentle reduction beyond it — so a strong
  suburban crowd can still outrank a weak downtown one.
- **Ticketmaster data is kept only as long as it is needed** (Alex, Phase 1 M1.3;
  Ticketmaster's terms allow storing event content only "for reasonable periods").
  We keep event facts only — never Ticketmaster's images or descriptions. **30 days
  after a gathering's effective end**, everything that is Ticketmaster's (raw
  response, their IDs, their URLs) is deleted. Our own minimal gathering record
  (name, date, venue, counts) is kept for the beta's metrics.
- **Distance adjustment** (Alex, Phase 1 M1.3). Final score = AI score − adjustment.
  The adjustment is 0 inside the core radius (Toronto: **12 km**), then **1 point per
  km** beyond it, **capped at 15**. All three numbers live on the `cities` row. It is
  computed when the queue is shown, never stored, so changing a number re-ranks at once.
- **Ticketmaster import filter** (Alex, Phase 1 M1.3). Before any AI sees a listing,
  rules drop: Ticketmaster test listings; listings already cancelled that we have never
  imported; Ticketmaster "Upsell" and "Sightseeing/Facility" listings; film and cinema
  screenings; add-on names (parking, "does not include a ticket", VIP, upgrade, season
  pass, package, gift card, voucher); timed-slot series (same name, venue and date at
  3+ start times); multi-day passes; listings with no start time yet. Duplicate listings
  (same venue, start time and name) become one draft with every Ticketmaster ID attached.
  **Off-sale is not a problem** — it usually means sold out — and never raises a flag.
- **AI vetting** (Alex, Phase 1 M1.3). **Claude Sonnet 5** scores each new draft
  0–100 with a one-line reason. Rubric: crowd size (0–30), audience 19–35 (0–25),
  people going alone or in small groups (0–20), time and place to meet before (0–15),
  shared identity (0–10). Hard caps: kids' and family shows, and audiences mostly under
  19, at most 10 (H8); seated theatre and classical at most 35; not an event, 0. Drafts
  below **70** after the distance adjustment are collapsed in the queue (Alex, M1.3,
  after the first real run: at 40, 79% of the next 14 days' drafts showed; raised from
  40 to 70). "Venues needing spots" still lists venues with a draft at 40+. Only new
  drafts are scored; a failed score leaves the draft unscored and it is retried next
  run. **Hard AI spend cap: $3 per Toronto calendar day.**
- **AI spot suggestions** (Alex, Phase 1 M1.3). Sonnet 5 with web search proposes 3
  public, staffed spots (bars, patios, landmarks) a short walk from the entrance, each
  with an address, a one-line reason and the page it checked. Only for venues with fewer
  than 3 active spots, no pending suggestions, and an upcoming draft scoring 40+; at most
  **10 venues per night**. Alex approves each one (the curated-spot rule above).
  **Moved to its own milestone, M1.3b** (Alex, M1.3; scheduled as **M5.2** in the
  revised build plan): built but switched off
  (`AI_SPOT_SUGGESTIONS`, off by default) after calls proved slow, sometimes empty and
  prone to stalling inside the Worker (spec §6). Spots are added by hand until then.
- **Importer and status changes** (Alex, Phase 1 M1.3). On a **draft**, the importer
  may update a changed date or time, and quietly dismiss it when Ticketmaster marks it
  cancelled or postponed, or when it is missing from Ticketmaster two nights running.
  A draft the importer dismissed is **restored automatically** if Ticketmaster lists it
  again as active with a valid date. **A draft Alex dismissed never comes back.** The
  difference is recorded by the `moderation_log` actor (`importer:ticketmaster` vs
  Alex's email). On a **published** gathering the importer changes nothing: a date
  change, cancellation, postponement, reschedule or disappearance raises a **flag** in
  the admin, and Alex decides (apply the new date, withdraw, or ignore).
- **Withdrawn** (Alex, Phase 1 M1.3). A published gathering can be **withdrawn** by
  Alex, **even when it has pins**, with a reason: cancelled / postponed / takedown
  request / other. The reason is kept off the public row. Pins are kept, and Alex can
  undo it. In the database: a withdrawn gathering is readable **only by people pinned
  to it** (so their page shows a short neutral notice instead of a dead page) and drops
  out of every public list; it takes no new pins, spot votes or survey responses; its
  people list and WhatsApp links close. Flags for cancelled and postponed events lead
  here, but the importer never withdraws anything itself.
- **Nightly import runs on the Worker** (Alex, Phase 1 M1.3): a cron trigger at 08:00
  UTC (4am EDT / 3am EST), on Workers Paid, plus a "Run import now" admin button.
- **No revenue from Ticketmaster data** (Alex, Phase 1 M1.3). Ticketmaster's API
  terms forbid deriving revenue, directly or indirectly, from their data. Pin'd is
  free during the beta. **Any paid feature, ad or sponsorship later needs a review of
  these terms first.**
- **A privacy policy exists before public pages go live** (Alex, Phase 1 M1.3). It
  covers Ticketmaster data, the automated photo checks and gender. Ticketmaster's
  terms also require the policy (or a footer on every page) to say how we collect,
  use, store and disclose data.
- **Community gatherings are first-class** (Alex, after Phase 1 M1.3). Small community
  gatherings are a core part of Pin'd, not an afterthought: wellness and social events
  such as run clubs are growing (research assessment). A later sourcing milestone adds
  a separate **"Community & free"** tab in the admin, fed by Claude searching the web
  for publicly listed free and community gatherings — run clubs, markets, street
  festivals, socials, wellness events. It has **its own rubric**, which rewards events
  built around meeting people — social by design, solo-friendly, free or low-cost,
  recurring — rather than crowd size, and it is **ranked separately** from
  Ticketmaster. Manual add stays for word-of-mouth finds. **The first real crowds
  include at least one small community gathering.** Built in **M4.4** (Alex, revised
  build plan), with one auto-publishing slot a week reserved for it.
- **Meeting spots: needed when crews open, not to publish** (Alex, Phase 1 M1.3;
  replaces the M1.2 rule "a gathering cannot be published until its venue has 3
  approved spots"). A gathering can be published with **no** meeting spots; it still
  needs a venue. A venue can have **any number** of approved spots; each spot poll
  shows **up to 3** — the venue's first approved spots in order, each defaulting to
  start minus 60 minutes, editable — fewer if the venue has fewer. A spot approved
  later fills the polls of upcoming published gatherings at that venue, up to 3. If a
  published gathering's crews open (5 opted in) and its venue has **no** approved
  spots, the admin shows it as a flag. Spots are still curated (H5): Alex approves or
  edits each one before it exists, until the automated check below is built.
  Enforced in the database (`20260918214318_m1_3_spots_optional`).
- **Scale** (Alex, after Phase 1 M1.3). **No manual work per event, ever**: no WhatsApp
  groups, no hand-built pages, no per-event setup. The goal is buzz across the whole
  city, not one event at a time. To avoid spreading early users too thin, the number
  of events auto-published each week **adapts to demand**: it starts with a handful,
  and more are published automatically as pins per event rise. The mechanism is
  "Auto-publishing, adaptive" below (spec §8).
- **Automate by default** (Alex, after Phase 1 M1.3). Wherever possible, AI does the
  work and Alex removes what is wrong, rather than approving everything by hand.
- **Auto-publishing** (Alex, after Phase 1 M1.3). The system publishes the **top 5
  drafts per week by final score** (the number is a setting); Alex withdraws or
  unpublishes anything unwanted. Manual publish stays. Built as a fixed target in
  **M2.2** and made adaptive in **M4.5** — see "Auto-publishing, adaptive" below.
- **Spots, automated** (Alex, after Phase 1 M1.3; M1.3b and later).
  - AI-suggested spots are **auto-approved when they pass an automated check**: real,
    currently open, public and staffed, within about 5 minutes' walk, with an
    evidence page attached. Only uncertain ones come to Alex.
  - **Users can suggest spots**, through the same check — never a private address (H5).
  - Each venue keeps a **pool of spots of any size**. The ranking belongs to the
    **venue over time**, not to one gathering: every gathering and crew that picks a
    spot, meets there or reports it counts toward that venue's ranking.
  - Only **anonymous per-spot tallies** are kept (times picked, times a crew met
    there, times reported), never who voted, so the history survives pin deletion.
  - Each poll shows the **top 2 proven spots plus 1 newer or rising spot**, with "see
    all spots", so new suggestions can earn their way up.
  - At scale, crews spread across the pool's spots and staggered times.
- **Maps generated automatically** (Alex, after Phase 1 M1.3). The venue map on public
  pages is drawn from the venue's and its spots' coordinates — venue and spots only,
  never people (H1), and never device location (H4). No manual upload needed; upload
  stays only as an optional override.
- **Look** (Alex, after Phase 1 M1.3). Public pages use the dark, on-brand look:
  near-black background, purple `#582883`, white text, the logo — matching the app and
  pindscene.com. Mobile-first, and still loading in under a second inside a Reddit tab.
  Replaces "white pages" (spec §2).
- **Future and beta features** (Alex, after Phase 1 M1.3).
  - **"Put me in a crew"**: an optional button that places a person in an open crew
    with room, for people who don't want to choose. **Decided yes** (Alex, revised
    build plan): built in M3.3 — it places the person in the open crew with the most
    room, respecting women-only.
  - **"Solo crew"** (working name): an opt-in mode for people pinned to an event who
    want to meet individually as well as in crews. Crews stay the main product and
    story; this is an opt-in extra, not marketed, and not framed as romantic (open,
    not dating, for now). **A deliberate, narrow exception to H2 and H5**, with these
    guardrails:
    - opt-in and off by default, separate from the crew opt-in, with a clear prompt
      explaining groups vs 1-on-1; visible only to others who also opted in at the
      same gathering (reciprocal, like H3);
    - contact only by mutual accept; before that, one preset message from a short
      list, no free-text chat (no cold DMs);
    - meet only at the venue's public spots, never a private address;
    - people can limit who sees them (for example, women only);
    - block and report two taps away; a report hides the person from solo mode
      immediately.

    Implemented as a new branch of the database "can see" rule (`private.can_see_at`),
    with its own harness cases. In scope for the first beta, measured separately from
    crews (crew meetups vs solo meetups).
- **Build direction** (Alex, after Phase 1 M1.3 — decided). The product is built
  **once in Expo for iOS and web**: accounts, required face photo with the AI check,
  profile, pinning in, crews, solo crew, chat and notifications. The **Worker** keeps
  the admin, the nightly import and AI jobs, and the fast public crowd pages (W1, W2,
  W3 `/spot`, share links) that lead into the app or the web product. **The
  WhatsApp-and-email Test 0 is dropped**; the first real crowds run on this beta
  (TestFlight and web), with crews and solo crew measured separately. **The revised
  build plan (`docs/build-plan.md`, rev 2) is merged** into spec.md (Alex, 18 Sept
  2026): Test 0 screens T3–T8 and T10 are **deleted**, not superseded; T2 and T9
  became the Worker pages W2 and W1; Q2 and Q8 are rewritten, Q9 is retired, and T5
  new-device sign-in is replaced by "Identity" above. The milestones are spec §6.
- **Unpublishing** (Alex, Phase 1 M1.2) is allowed only while a gathering has zero
  pins. Enforced in the database.
- **Pin-in button for free events** (Alex, Phase 1 M1.2). Ticketed gatherings keep
  "Pin in — I've got a ticket". Gatherings with `is_free = true` use **"Pin in — I'm
  going"**. The crowd-page milestone (M2.1, W2; A8 in M3.2) implements it.
- **Admin CSV export** (Alex, Phase 1 M1.2) has one row per pin and never includes
  contact details or gender.
- **Venue map images are public** (Alex, Phase 1 M1.2), in their own public bucket
  `venue-maps`, uploaded by admin only (now an optional override: maps are generated
  automatically — "Maps generated automatically" above). They show a public building and its public
  spots, never a person (H1). Pin photos stay private (V6).
- **Automated photo moderation** (Alex, Phase 1 M1.2; built in **M3.1**, the identity
  and profile milestone). On upload, an AI check (Claude vision, via the Anthropic API key,
  server-side only) sorts every photo into one of three outcomes:
  - **clear real-person photo** → auto-approved;
  - **clearly inappropriate** → auto-rejected; the person stays visible without a
    photo (V6);
  - **uncertain** — possible minor, not a real person, or possibly someone else's
    photo → the admin photo queue, for a human decision.

  The AI **never decides "under 19" alone**: it can only flag a photo for review;
  the 19+ rule (H8) stays with the person's attestation, reports and admin review.
  Reports and auto-hide (H9) remain the backstop. **The privacy policy must say that
  photos are checked automatically.**
- **Review of the visibility rules** (Alex, after Phase 1 M1.2). Max's team is not
  reviewing Pin'd. Before the first real crowd, two things replace a developer
  review: (1) an **independent adversarial review** by a fresh Claude Code session
  with no prior context, tasked only with finding leaks, using
  `docs/m1.1-review-brief.md` as its input; and (2) **Alex's own read** of
  `docs/visibility.md`. Leaks it finds are fixed as new migrations, each with a
  harness case. **Scope added by the revised build plan** (Alex; the review is M4.2):
  the brief gains an M3 section covering the solo branch of `private.can_see_at`,
  review-only gatherings, anonymous people, the photo pending state, message snapshots
  on reports, and the Instagram-handle rule (V17); `docs/visibility.md` gains V14
  (solo), V15 (review-only), V16 (anonymous people) and V17 (Instagram handles).

### Decided in the revised build plan

All of the entries below are Alex's decisions, made on 18 September 2026 by accepting
every recommendation in `docs/build-plan.md` §10 (plus the Instagram rule, Alex's own
change). Where the plan has more detail, the plan is the reference.

- **Production project** (Alex, revised build plan). A new Supabase project
  **`pind-prod` on Pro** (daily backups, no pausing), same region, created before any
  real person signs up (M4.3). Migrations applied by the CLI only; **no seed data,
  ever**. pind-staging stays free and keeps its seed data.
- **First crowds on the web, plus email** (Alex, revised build plan). The first real
  crowds run on the web build with email; TestFlight is for volunteers who want push.
  No install is needed for a Reddit visitor.
- **Email delivery** (Alex, revised build plan). **Resend on pind.social**,
  transactional only. The five notifications (spec A18) are mirrored by email for
  people without a device token; the Monday digest email carries an unsubscribe link.
  **SMS is never used**; Twilio is out of the stack.
- **Notification delivery** (Alex, revised build plan). The database decides *what*:
  triggers and pg_cron enqueue rows in `notification_queue`. The Worker decides *how*:
  a cron every **5 minutes** delivers by Expo Push or Resend, with **one retry**, and
  its failures are visible in the admin. Monday 6:00 PM Toronto is handled across DST.
- **Date changes message pinned people** (Alex, revised build plan; closes the open
  item from M1.3). A date change applied from a flag, or a withdrawal, reaches pinned
  people through notification 3, renamed **"plan status"** (formed / spot set /
  dissolved / gathering date changed or withdrawn). Still five notifications.
- **Photo check on the Worker via a database webhook** (Alex, revised build plan). The
  app uploads the photo and inserts the row; a database webhook calls a Worker endpoint,
  which runs the Claude vision check and writes approve / reject / queue to
  `moderation_log` as `ai:photo-check`. Fallback if the webhook is flaky: the app calls
  the Worker directly after upload with its JWT.
- **Generated maps are schematic SVGs from coordinates** (Alex, revised build plan).
  The Worker draws the venue, each spot with its name and walking minutes, a north
  arrow and a scale bar, cached at the edge. No tiles, no API key, nothing but the
  building and its spots (H1). Upload stays an optional override.
- **OG images carry no counts** (Alex, revised build plan). A link preview is cached at
  post time, so a number in it would go stale and be dishonest (H6). Counts live in
  the post title and on the page.
- **Review-only gatherings** (Alex, revised build plan). For App Review (M5.1): a
  `review_only` flag on gatherings and review-only members, visible only to review-only
  people and admin, never in lists, counts or the digest, with policies and a harness
  case proving real users cannot see them. **H6 is preserved**: nothing fabricated is
  ever visible to a real person. Review-only rows are the only non-real data allowed
  anywhere, and only on production for App Review.
- **Repo layout** (Alex, revised build plan). **One repo**: the Expo app in `app/` as
  an npm workspace, shared types and fixed copy in `packages/shared/`, the Worker in
  `src/`. The separate `pind-app` repo is not created. The repository may be renamed
  `pind` later.
- **Web build hosting** (Alex, revised build plan). The Expo web export is served as
  the Worker's static assets on the **same host**; the Worker's own routes are rendered
  first and everything else falls through to the app with SPA fallback (spec §4).
- **Realtime via `postgres_changes` only** (Alex, revised build plan). The crew thread
  uses Supabase Realtime `postgres_changes`, which respects RLS; never broadcast.
  Fallback: poll every 10 seconds while the thread is open.
- **Auto-publishing, adaptive** (Alex, revised build plan). Settings on the `cities`
  row (target 5, floor 3, ceiling 20, lead window 4–21 days, 2 per venue per week, 1
  community slot, score floor 70). A nightly fill publishes the highest-scoring eligible
  drafts up to the target; Alex's "publish" and "never" marks override the score. A
  weekly adjust on Mondays grows the target by 2 when `reach_rate ≥ 0.60` and median
  pins ≥ 8, shrinks it by 1 when `reach_rate < 0.30`, otherwise holds; it holds when
  fewer than 3 gatherings qualify. Every choice and decision is logged. Fixed target in
  M2.2, adaptive switched on in M4.5; Alex can freeze it. Detail: spec §8.
- **Solo's user-facing name and visibility** (Alex, revised build plan). Users see
  **"Meet 1-on-1"** ("solo crew" is the internal name). The opt-in sheet makes a
  **forced choice** between "everyone who opted in" and "women only" — no default.
  Proposals carry one of five preset lines (Tatiana writes the final five), limited to
  3 open per person per gathering and 1 per pair, expiring at the start. A server flag
  per platform can switch solo off (for example if App Review rejects it) while the web
  keeps it.
- **Neighbourhood and tags on the link path** (Alex, revised build plan). Optional,
  nudged later; "exactly 3 tags" defines a complete profile, never a gate before a pin.
- **Instagram handle** (Alex, revised build plan — Alex's own change to the plan, which
  had dropped it). A person may add an Instagram handle to their profile. It is
  **always optional**, never required, and **never a substitute for the face photo**.
  **Who can see it:** only that person's **crewmates**, their **solo-plan partner** and
  their **connections**. Never on the open "going & open to meeting" list, never on any
  public page, never in link previews — this protects H2 (no cold DMs) and solo's
  mutual-accept rule. Enforced in the database like every other visibility rule, with
  harness cases proving both who can and who cannot see it, when the profile is built
  (**M3.1**; `docs/visibility.md` V17, pending).
- **Sign in with Apple on the web: later** (Alex, revised build plan). The email code
  and Google come first on the web. In the app, Apple is offered alongside Google
  (Apple's rule).
- **Android after iOS, from the same code** (Alex, revised build plan). The web build
  serves Android users until then. Register the Play account under the corporation.
- **Analytics and crashes** (Alex, revised build plan). **PostHog** for in-app funnel
  events, **SQL views** in Postgres for outcomes (spec §7), **Sentry** on the app and
  the Worker. Free tiers. They are added in M2.0 as part of that milestone's scope.
- **Incorporation and account ownership** (Alex, revised build plan). Start now; done
  before store submission at the latest. Apple, Play, Supabase, Cloudflare and Resend
  accounts move to the entity.
- **Moderation rota** (Alex, revised build plan) — **proposed, pending confirmation
  from Tatiana and Jayme.** Tatiana's daytime in Spain covers Toronto's night (about
  2 a.m. to 8 a.m.); Alex and Jayme cover the day; nobody wakes up for the queue. Every
  report posts to a private team channel; "by 10 a.m. someone has looked" is the
  standard, 24 hours the promise. Written up in M4.1.
- **Seeding** (Alex, revised build plan) — **proposed, pending confirmation from
  Tatiana and Jayme.** For the first real crowds, **Tatiana and Jayme** write 2–3
  fan-channel posts a week for seeded gatherings (about 1–1.5 hours each). It is
  marketing, not operations, and the adaptive loop measures when the city populates
  itself and the labour can stop. Team members may pin in to gatherings they were going
  to anyway as ordinary members — never as operators (H10).

### Decided in Phase 2 M2.0

- **Apple developer team** (Alex, M2.0). Pin'd publishes under Apple team
  **93M6B4W5PR, Tenor Investments Inc.**, which is the developer. Pin'd is a DBA of
  Tenor Investments. There is no separate Apple account: it would need a DUNS number
  Pin'd does not have. The listing's seller line is made to read "Pin'd" through an
  App Store Connect "Doing Business As" name, requested well before submission
  (M5.1).
- **Apple credentials: create, never revoke** (Alex, M2.0). No prompt that offers to
  revoke an existing certificate or key to make room is ever answered yes. The Tenor
  team has other people's certificates and a Firebase APNs key. Pin'd has **one APNs
  key**, made in M2.0, which the production bundle ID reuses (M4.3); the team is at
  Apple's limit of two.
- **Bundle identifiers** (Alex, M2.0): `social.pind.app` (production) and
  `social.pind.app.staging` (staging, dev builds and internal TestFlight). The EAS
  project is `@alexdobbie/pind`.
- **Analytics, as built** (Alex, M2.0). PostHog runs with autocapture off, session
  replay off, "Discard client IP data" on, `$geoip_disable` sent on every event and
  each event sent immediately. The stored events carry no `$geoip_*` properties and no
  `$ip` (checked 2026-09-19).
