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
- **Maps generated automatically** (Alex, after Phase 1 M1.3) — **SUPERSEDED in Phase 2
  M2.1, see "A real map, not a schematic"**. The venue map on public pages is drawn from
  the venue's and its spots' coordinates — venue and spots only, never people (H1), and
  never device location (H4). No manual upload needed; upload stays only as an optional
  override. *Kept here rather than deleted: the reasoning held, and what replaced it
  keeps the same two hard rules. What it got wrong was the picture.*
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
- **Dark only** (Alex, M2.0). The app is **black always**, on iOS and on the web,
  whatever the phone or browser is set to. There is **no light mode for now**. This
  **overrides the board's "dark default, light follows the system"**; A25 was the
  light-mode example and is not built. Built as `userInterfaceStyle: "dark"`, a single
  dark palette in `packages/shared` and a dark-only web page. It returns only by a new
  decision.
- **pind.social before production** (Alex, M2.0, for M2.1). Until `pind-prod`
  exists (M4.3), pind.social serves **pind-staging**. **Seed rows never appear on a
  public page.** The `[TEST]` / `pindseed` gatherings and anything attached to them
  are excluded from every public read. This is permanent, not an M2.1 workaround
  (H6). Like every visibility rule it is decided in the database (H11): M2.1 explains
  the rule in plain English, gets Alex's OK, and adds a harness case.
- **Routes: pind.social only** (Alex, M2.0). This repo may add routes and custom
  domains for **pind.social** (M2.1). **PindScene.com stays off-limits** to this
  repo: Alex sets its redirect in the Cloudflare dashboard.
- **Public pages before the privacy policy** (Alex, M2.0). The privacy policy stays
  in M4.1. Until it exists, M2.1's public pages ship **unlinked and noindex**:
  `noindex` on every page and a `robots.txt` that disallows everything, and nothing
  links or posts them publicly.

### Decided in Phase 2 M2.1

- **The seed rule hides seed rows from everyone, signed in included** (Alex, M2.1).
  `is_seed` on `venues`, `gatherings` and `people`; a seed row is invisible to `anon`
  and to `authenticated` alike, and only the service key sees it. Anonymous sign-in is
  one tap at A26, so "signed in" was never a gate. The consequence is accepted: the
  M3.6 dogfood runs on real imported gatherings Alex has published, with real accounts.
  The full rule, and what it does to counts, is `docs/visibility.md` V18 (§12f);
  harness cases P55–P58.
- **The public web reads through one door** (Alex, M2.1). W1, W2, W3, the OG image and
  the `.ics` read `public.public_gatherings` and `public.public_gathering` and nothing
  else, so "on the public web" — published, not withdrawn, not seeded, and carrying a
  slug — is one definition in the database rather than a filter repeated in Worker code
  (H11).
- **Slugs, and a 301 that never dies** (Alex, M2.1). `/g/<slug>` is minted when Alex
  publishes and nothing ever recomputes it; the importer renames nothing on a published
  gathering, it raises a flag. Alex can change a slug by hand in the admin, and the old
  one answers a **301 forever**, so a Reddit post from six weeks ago still lands. A slug
  is spent the moment it is used and is never handed to another gathering; a published
  slug can never be removed. A rename does not send notification 3 — the page shows the
  new name either way and the link still works.
- **The policy harness stays on pind-staging, with a named exception** (Alex, M2.1).
  Flagging harness rows as seed would have the harness testing a world its own rule had
  emptied, and every way of keeping the coverage needs a harness-only session marker,
  which is a backdoor in the visibility layer. The slug gate removes the harness from
  every public page; what is left — two or three slugged rows and direct REST reads
  with the publishable key, for the minute a run lasts, on a domain nothing points at —
  is written up as a deliberate exception in `docs/visibility.md` §12f, expiring at
  M4.3 when pind.social serves pind-prod and the overlap stops existing. Closing it
  sooner means a second Supabase project for the harness; not taken.
- **A seeded venue's uploaded map image stays fetchable** (Alex, M2.1). `venue-maps` is
  a public bucket by decision, and RLS hides rows, not objects. The URL needs a UUID
  nobody can obtain and nothing links to it. Accepted rather than moving every venue map
  behind a signed URL.
- **Meeting spots carry coordinates, and walking minutes are calculated** (Alex, M2.1).
  `meeting_spots.latitude`/`longitude` are optional: a spot with them is plotted on the
  generated map, a spot without is still listed by name. Walking minutes come from the
  distance, with a detour allowance, and `walk_minutes` overrides the calculation where
  it is wrong. Both are entered in the admin. These and venue coordinates are the only
  coordinates the product holds (H4).
- **System fonts on the public pages** (Claude, M2.1; spec §2 allows one web font "only
  if it doesn't hurt load time"). A web font costs a round trip before the first paint
  on a page that has one second inside a Reddit tab, so W1–W4 use the system stack.
  Poppins stays in the app.
- **The lockup is composed, not exported** (Alex, 19 Sept 2026, carried out in M2.1).
  `scripts/build-brand.ts` strips the C2PA metadata, swaps the hard-coded fill for
  `currentColor` and lays the mark beside the wordmark at a fraction of its height,
  writing `src/public/brand.ts`. Two numbers — cap height and gap — are the whole
  layout. It is provisional and Tatiana's to change. `brand/` is untouched.
- **Map view — considered, deferred** (Alex, Phase 2 M2.1). The original PindScene build
  had a map/list toggle: purple pins across Toronto, tap a pin to expand a venue card,
  sign-up wall to see who's going. It did not survive the pivot to attaching to existing
  gatherings, and A5–A7's "No map, no feed, no algorithm" was written for the new product
  rather than as a decision against it. Recording it properly now.

  The list stays the only discovery surface for the beta, for three reasons:
  1. It would look empty. Five to twenty published gatherings a week across a city reads
     as a dead app on a map, where "3 pinned · crews open at 5" reads as progress in a
     list (Q10).
  2. It invites location. A map leads to "near me", which leads to a location permission
     — the one thing the product promises never to ask for (H4). The promise is easier to
     keep when the surface doesn't exist.
  3. It changes nothing at the destination. Tapping a pin to see who's going and what
     crews are forming is A8–A10 exactly. A map changes how people arrive, and people
     arrive from shared links.

  The one map in the product stays the venue schematic on a crowd page: that building and
  its meeting spots, never people (H1).

  When to revisit: the geodata exists from M2.1, so this is a UI decision, not a schema
  one. Revisit when the adaptive publisher's weekly target is high enough that a city map
  looks alive rather than empty — roughly the `publish_max` end of spec §8 — and only if
  the list is demonstrably failing as a discovery surface. Any map view must still work
  with no location permission: the city is the frame, and the user's position is never on
  it.

  **When it comes, half the decision is already made** (Alex, M2.1). The shape is: pan
  around Toronto, one pin per published gathering, tap a pin to open that crowd page. It
  belongs **in the app**, with the Explore tab idea, not on a Worker page. It is built on
  **Protomaps on R2** — a vector extract of the city in our own bucket, read by MapLibre
  over HTTP range requests — for the reason M2.1's measurements gave: R2 has no egress
  fee and there is **no per-load billing**, so a good Reddit day costs nothing, where
  Mapbox GL bills $5 per 1,000 map loads past the free 50,000. It also ships no API key,
  because there is no key. The pins are gatherings, never people (H1), and the map still
  never asks where the viewer is (H4).

  **The three surfaces, and which is the default** (Alex, M2.2 — filed, not built).
  When the landing page eventually has both views, they sit like this:
  1. **List is the default, and it is date-first.** Q10 stands. This is not a layout
     preference: a popularity sort as the *default* is a rich-get-richer loop, and it is
     backwards in a product where everything needs to reach 5. The gatherings that most
     need eyes are the ones a popularity sort buries.
  2. **Map is a toggle**, the deferred city map described above — Protomaps on R2, a pin
     per published gathering, tap to open its crowd page, no per-load billing, no
     geolocation.
  3. **"Popular events" is an option the user chooses**, from either view. Never a
     default, never an automatic re-ordering, never a "for you". The difference that
     matters is who asked for it: a reader who chooses to sort by popularity has decided
     what they want, and nothing has decided it for them.
  5. **Filter by venue, and by neighbourhood** (Alex, M2.2 — filed, not built). Every
     gathering already has a venue and every venue has coordinates, so venue filtering
     needs no new data at all; neighbourhoods exist in `packages/shared` and can be
     derived from those coordinates. **"What is on in the west end" is a more common
     question than "what is on at The Mod Club"**, so neighbourhood is likely the more
     used of the two — but venue is nearly free and matters to someone who goes to one
     place regularly or lives beside it.

     **The connection to the caps, which is the point** (Alex): a venue cap is a crude
     way of stopping one place dominating the list, applied to everybody because nobody
     can choose. Once a reader can filter, they can make one venue dominate their own
     list *deliberately*, which is the better version of the same thing. **So as
     filtering lands, the caps should get looser rather than tighter** — the per-venue
     cap going from 2 to 6 in M2.2 is the first step of that, and the category share
     should be re-examined the same way once the chips exist.
  4. **A category filter across the top of the list** (Alex, M2.2 — filed, not built):
     sports, concerts, bars, clubs, community. A filter, not a sort: it narrows what is
     shown without reordering what is left, so it cannot become a ranking by the back
     door. Unfiltered stays the default. Two things to settle when it is picked up —
     where the categories come from, since Ticketmaster's own classifications are close
     but not these five and the Community & free run (M4.4) has its own shape; and what
     an empty category looks like, because "Clubs (0)" on a Tuesday is worse than no
     chip at all when a handful of gatherings a week are published.
- **A spot is a card, not a maps link** (Alex, M2.2 — filed, not built). Tapping a
  meeting spot opens Google Maps today, and that is the whole interaction. It should
  open a **card**: what the place is like, food and drink, rough capacity, how loud it
  is, whether six people can get a table without booking — with the maps link *inside*
  the card rather than being the card.

  **Why it is not decoration.** A crew choosing between three spots has a name and a
  walking time, which is nothing to choose on; someone new to the city has less than
  that. The card is what turns the spot poll from a coin toss into a decision, and the
  spot poll is the last step before a crew actually meets.

  **The open question is sourcing**, and it is open on purpose:
  - **Google Places** gives photos and hours, and adds a per-request cost plus a third
    party to a page we keep fast. It would have to be fetched server-side and served
    from our own origin like the venue maps (CLAUDE.md), never called from the page.
  - **AI descriptions** are cheap and scale, and **a wrong vibe is worse than none** —
    "quiet enough to talk" about a room nobody can hear in costs more trust than a
    blank field.
  - **Hand-written** is honest and does not scale.

  M1.3b's automated approval check already fetches an evidence page per spot, so the
  richer data may come from **that same run** rather than a second one — worth checking
  before any new job is designed. Picked up with M5.2 (M1.3b) or M3.3, whichever
  reaches the spot poll first.
- **The map is unreadable where spots cluster** (Alex, walking the community pages —
  filed, not built). Three spots within 200 m overlap at the current zoom on a phone,
  labels on labels, which breaks the picture at exactly the venues where spots cluster:
  the downtown ones. Three ways out — collision handling that pushes labels apart,
  numbered pins with a key under the figure, or **a zoom that adapts to how spread the
  spots actually are**. The third treats the cause rather than the symptom and is the
  one to cost first.
- **Spot content starts as a manual pass, deliberately** (Alex, M2.2 — filed, not
  built). Before any automation: gather candidate spots, filter to what actually
  belongs in the app, write the details by hand into a spreadsheet, import once.
  Quality and accuracy first.

  **The point is to learn what "a good spot" means**, in specifics, from real places —
  and that definition becomes the rubric M1.3b automates against later. Automating
  first would encode a guess at the standard instead of a standard. Poetry Jazz Cafe is
  the argument: it was approved, sits in a live spot poll, and is a thirty-minute walk
  (spec §6, "the M5.2 distance ceiling"). A rule that would have caught it is easy to
  write *after* looking at spots and hard to guess at beforehand.

  **Design the card's fields before gathering anything**, so the spreadsheet is an
  import and not notes that need reshaping afterwards. The field list is the first
  deliverable of the pass, not a by-product of it.
- **crowds@ and safety@ are real, monitored inboxes** (Alex, M2.1). The public pages
  carry `crowds@pind.social` (suggest a gathering) and `safety@pind.social` (report).
  **Resend sends mail, it does not receive it**, so both would bounce silently as they
  stand. Alex sets up Cloudflare Email Routing (free) to forward them to his inbox
  before those addresses go on a page anyone is pointed at. `safety@` on a public page
  is an App Review 1.2 requirement and a promise to users, so it has to work — the M4.1
  acceptance list carries "the support address is a real, monitored inbox".
- **The OG image is rasterised in the Worker, by resvg alone** (Alex asked, verified
  and built M2.1). The card is drawn as an SVG (`src/public/og.ts`, unit-tested) and
  turned into a PNG before it is served, because SVG is not a link preview — iMessage,
  Discord and Slack all want a bitmap.
  - **Cloudflare Images cannot do it.** Its own docs: "Cloudflare does not resize SVG
    files and will ignore any optimization parameters", and Images "does not have plans
    to convert svg to raster" — it sanitises SVGs with `svg-hush` and serves them as
    they are. Checked 2026-09-19. Not a pricing question; it does not exist.
  - **One dependency, `@cf-wasm/resvg`, pinned.** Not satori: satori would mean
    rebuilding the card in its flexbox layout, a second wasm module (yoga), and a font
    fetched from Google's CDN at runtime. resvg takes the SVG we already have.
  - **Measured on this Worker, deployed**, which was Alex's condition: Worker Startup
    Time **8 ms → 10 ms**; bundle 288 KB gzipped → 1.37 MB; `/og/<slug>.png` about
    410 ms of CPU, cached 24 h at the edge; W2 unchanged at 80–270 ms. The satori route
    was measured too and cost 33 ms of startup, so it was dropped. Workers **block
    dynamic WebAssembly compilation**, so a wasm module is always a static import and
    always on every route's cold start — which is why the number mattered and why it
    was measured rather than assumed.
  - **Fonts are embedded, not fetched.** The two Poppins faces the app already bundles
    live in `src/public/fonts/` and are imported as bytes (a wrangler `Data` rule). A
    link preview must not depend on somebody else's CDN being up.
  - **Rendering at publish and storing the PNG was considered and not taken.** It would
    not have removed the wasm from the bundle — only a second Worker would — so it
    bought roughly 400 ms on a route only crawlers hit, in exchange for stored objects,
    a failure path at publish and a backfill. Revisit only if the OG route ever gets
    hot, which it should not: previews are cached by whoever posts the link.
- **A real map, not a schematic** (Alex, Phase 2 M2.1). **Supersedes "Maps generated
  automatically"** above. M2.1 built the schematic that decision asked for — venue, spots,
  walking minutes, north arrow, scale bar, drawn from coordinates with no tiles and no
  key. On the page it **reads as a placeholder**, and it is the weakest thing on W2, which
  is one of the three screens that carry the first impression. So the crowd page gets
  real geography: streets, buildings, the actual shape of the block.

  **Shape A, chosen after all three were measured** (Alex, M2.1): a **static** real map
  image on W2, and an **interactive** map in the app at A8, where the load budget is a
  one-time app download rather than a page in a Reddit tab. What the measurements said:
  W2 is 6.7 KB over the wire today; one map view is 92 KB as a single WebP against 285 KB
  of MapLibre before a single tile, or 46 KB of Leaflet plus ~198 KB of raster tiles
  across eight round trips. A static image also bills **per image**, not per map load, so
  a good Reddit day costs nothing.

  **Provider: Mapbox** (Alex, M2.1) — Static Images API, 50,000 requests a month free and
  the only free tier that permits commercial use at our volume. MapTiler's free tier is
  non-commercial and brands the map; commercial starts at $30/month.

  **Attribution: "© OpenStreetMap contributors" is visible on or under the map.** Required
  by the ODbL, so not ours to decline (Alex, M2.1).

  Four conditions, all of them binding, not implementation detail:
  1. **The image is served from our own origin, never Supabase storage.** The same 157 KB
     image measured 911 ms from Supabase and 133 ms from pind.social; the difference is
     one extra connection. This is now a general rule in CLAUDE.md, "Keep the Worker
     lean". **It also applies to the existing uploaded-map override**, which currently
     points a visitor's browser straight at the storage bucket and must move behind our
     origin in the same change.
  2. **One image per venue, generated once and stored.** Not per gathering and not per
     view, so the number of Mapbox requests tracks the number of venues — tens, ever —
     and never the traffic.
  3. **The markers, the spot names and the walking minutes are ours**, drawn in HTML and
     CSS over the image, never baked into the picture. Crisp at any width, correct on a
     retina screen, readable by a screen reader, and changeable without re-rendering
     anything. The north arrow goes with them.
  4. **Every spot marker is tappable, and opens that spot in the phone's own maps app**
     (Alex, M2.1) — Apple Maps on iOS, Google Maps on Android, a sensible desktop
     fallback — with **walking directions to the spot**, not a dropped pin. Nobody plans a
     walk inside a 768-pixel page; they open their own maps app. It is a first-class part
     of the marker, not a small link underneath. **This does not touch H4**: the location
     permission is asked for by the maps app, by the person, after they leave our page,
     and we never see the answer.

  What does not change, and is not negotiable:
  - the map shows the venue and its meeting spots and **nothing else** — no user pins,
    no crowd density, nothing about who is where (H1);
  - **no geolocation on our surface**: no locate control, no permission prompt, no
    IP-based centring. The venue is always the centre (H4). A library that ships a locate
    control by default has it **removed, not hidden**.

  **Caching: immutable, and nothing ever needs invalidating** (Alex asked, M2.1). Both
  map URLs are **content-addressed**, so they are served `max-age=31536000, immutable`:
  - `/map/<venue>-<key>.webp`, where the key is `md5(latitude, longitude)` plus a
    renderer version. **Correcting a venue's coordinates in the admin produces a
    different key, so the page starts asking for a different URL and the old one is
    simply never requested again.** There is no purge to run, no cache API to call, and
    no window in which a stale picture is served. The Worker also refuses a key that is
    not the one the venue's current coordinates produce, so an old URL 404s rather than
    serving an out-of-date map to whoever still has it.
  - `/venue-map/<venue>-<hash>`, the uploaded override, versioned by a hash of its
    storage path for the same reason.
  - Bumping the renderer version (zoom, size, style) changes every key at once.

  **Failures are visible and retries are capped** (Alex, M2.1). Every attempt is
  recorded in `venue_map_renders` with its error; the admin's venue list carries a
  count and names the venues, and each venue page shows the reason. After three
  failures the Worker stops asking — a venue that can never render must not loop
  against a paid API with nobody watching — and a "Fetch the map again" button in the
  admin is the deliberate retry that clears the record. A missing `MAPBOX_TOKEN` is
  reported once, as the configuration problem it is, not as 74 venue failures.

  **A spot outside the frame says so** (Alex, M2.1). It keeps its place in the list,
  its walking minutes and its directions link, and the page reads "not shown on the map
  — it is further away". Someone comparing the list to the picture never has to wonder
  whether the marker is missing or the spot is. The admin flags it on the venue page as
  the M5.2 distance signal. The frame stays at a fixed zoom centred on the venue:
  zooming out to fit a bad spot would shrink the venue to nothing and hide the thing
  the map is for.

  The schematic generator (`src/public/map.ts`) stays in the repo until the replacement
  is proven on Alex's phone — and it has earned a permanent job as the middle step of
  the fallback: real map, then schematic, then the spot list alone.
- **The house rules, rewritten** (Alex, after the M2.1 on-device walk). The old three
  read as a safety notice on a product whose whole pitch is making friends. The new
  three, verbatim on every crowd surface:
  1. Make friends how you used to — in person.
  2. You see each other, or neither of you does.
  3. Come as you are. No pressure, no commitment.

  Underneath, styled as a fact rather than a fourth rule:
  **"Crews meet at a spot near the venue before doors."**

  **The safety property is unchanged — only how it is said.** Line 1 still says this
  happens face to face, not in a chat. Line 2 is H3, reciprocal reveal, stated as
  fairness rather than as a lock. Line 3 is the leave-any-time promise, stated as
  welcome rather than as an exit. The line underneath is H5 and H10: somewhere public,
  before the event, with the company not present.

  **That line is not decoration.** It is what App Review is pointed at under Guideline
  1.2, so it stays on **every** crowd surface, not only the crowd page.

  **Block and report leave the front-page rules and stay two taps away everywhere in
  the product** (H9). Nothing about the mechanism changes; it stops being the third
  thing a stranger reads about a night out. M3.5's acceptance already requires the two
  taps, and that requirement now carries this reason with it.

  Alex's decision, made after walking it on a phone — not a placeholder, and not
  Tatiana's to revisit. The **register** of everything that is not a house rule is
  still hers, in the copy pass spec §5 says is owed.

### Decided in Phase 2 M2.2

- **Once public, only Alex brings it back** (Alex, M2.2). A gathering that has ever
  been published is never picked up by an auto-publishing run again. The condition is
  `slug is null`: a slug is minted at publish and the schema refuses to remove one, so
  "has been public before" is already a fact in the database — no new column, one
  condition covering both withdrawing and unpublishing, and one less thing for the
  M4.2 reviewer to reason about.
  **Why, in Alex's words:** "My unpublish click means 'not this one', and a rule that
  can silently undo it isn't a control. Silent is the problem more than the reversal —
  I'd click, it'd come back, and I'd doubt whether I'd clicked at all. One manual click
  on the rare occasion I change my mind is the cheaper side of that trade."
  The cost is accepted: after an unpublish, only Alex's own Publish button republishes.
- **A refusal has to be as visible as a choice** (Alex, M2.2). The Publishing panel
  lists every draft inside the lead window, published or not, each with its reason in
  one line — "skipped, previously published", "the week was already full at 5",
  "Scotiabank Arena already has 2 that week", "below the floor of 70". A draft that was
  passed over must say so rather than merely be absent. **Why:** "I want to be able to
  see why something didn't publish, not only why something did." Routine refusals
  (below the floor, unscored, no venue) fold into a collapsed row so the four lines
  that say something are not buried under three hundred that do not. This applies to
  every admin surface over an automated run, not only this one.
- **Seeded means somebody recorded posting it** (Alex, M2.2). A new
  `gathering_promotions` table: one row per post, naming the channel as whoever posted
  it would say it (`r/leafs`, Instagram, a Discord), who posted it and when. It is
  ticked next to the share link in the admin, in the same motion as copying the link —
  by whoever posts it, in that minute.
  - **Not inferred from `publish_mark`.** That stays what it is: Alex's instruction to
    the publisher, nothing to do with promotion. The two coincide only until the
    auto-publisher picks a good Leafs game and someone posts it anyway, "which is the
    common case, not an edge", and seeded-vs-organic is the number that decides when
    the seeding labour stops and what the publisher's floor rests on.
  - **Not a weekly reconciliation either.** "A manual tick per gathering, every week,
    on the number I'd most easily forget, is a metric that quietly lies."
  - **The bias is stated and runs against us.** A gathering with no promotion row
    counts as organic, so a forgotten tick makes organic reach look *better* than it
    is, never worse. The unseeded number is therefore a floor, not a measurement, and
    nobody should read it as exact. Both splits are shown; neither decides anything —
    the whole population does.
- **The weekly adjust reads live pins until M4.5, and says so in code** (Alex, M2.2).
  `gathering_stats` (spec §7) is M4.5 work, so the adjust computes `reach_rate` and
  `median_pins` from live pins. That is exact today: the trailing window is 14 days and
  pins live 30 days past the effective end (Part 3), so nothing in range has been
  deleted. Two things keep it from rotting quietly, at Alex's instruction:
  - **The dependency is asserted, not noted.** If the trailing window ever reaches pin
    retention the adjust throws rather than computing something wrong — it would
    otherwise find few pins and return a confident shrink that looks like evidence.
    A check constraint caps `adjust_window_days` at 29 and `src/publish/plan.ts` throws
    at the same line; the unit tests cover both sides of the boundary.
  - **The weekly log keeps its raw inputs** — the gatherings counted, their pins,
    open-to-meeting counts and whether each reached 5 — so when `gathering_stats`
    lands, M4.5 can point the same arithmetic at it and confirm on the same weeks that
    the repoint did not change the answer.
- **Publishing is still one door** (Claude, M2.2, following M2.1). The nightly fill has
  no privilege Alex's button does not: it calls `public.admin_publish_gathering` for
  every pick, which mints the slug, tops up the spot poll and writes the moderation log.
  The selection rules live in `src/publish/plan.ts` as pure arithmetic with unit tests,
  because that is what they are — a ranking over a queue, not a visibility rule. Nothing
  about who sees whom moved out of the database (H11).
- **The publisher is the actor, even on a manual run** (Claude, M2.2). A run started
  from "Run import now" still logs `publisher:auto` against the gatherings it fills, so
  the moderation log keeps "Alex pressed Publish" and "a run filled a slot" apart.
  `import_runs` already records who triggered the run.
- **A failed job must leave a record, and a dead clock needs a second clock**
  (Alex, M2.2, after the nightly import turned out never to have run on schedule).
  Three rules, all of them general:
  1. **Open the run row before anything that can fail.** The import checked its
     Ticketmaster key before `admin_start_import_run` and returned early, so a night
     that failed on a credential wrote nothing and the admin kept showing the last
     good run. Any job with a run record opens it first and records the failure into
     it.
  2. **A watchdog cannot live inside the thing it watches.** The Worker cannot report
     its own cron being dead, so the watchdog is a pg_cron job in Postgres — the one
     clock in this system that does not depend on Cloudflare — writing a failed
     `import_runs` row when no run has started in 26 hours. It is scheduled from a
     migration, not the dashboard, for the same reason schema is.
  3. **Alerts go one way and are rate-limited.** A failed nightly run emails once
     (Resend), at most one of a kind per Toronto day, enforced by a unique index
     rather than by the Worker; a channel that repeats itself gets muted, and a muted
     channel is the silent failure again. Only a *sent* alert suppresses the next, so
     a failed send does not silence tomorrow.

  **Why it matters more than the credential:** M2.2's premise is that the city's list
  refreshes without anyone watching. A silent failure therefore means pind.social
  quietly stops updating and starts looking abandoned, and the first person to notice
  is a visitor. Alex found this one by happening to look.
- **The admin answers "is this thing configured"** (Alex, M2.2). `/admin/config` lists
  every setting the Worker needs with three states — set, **set but EMPTY**, not set —
  what stops working without each, and the exact `wrangler secret put` to fix it. No
  value is ever read, rendered or logged. "Empty" is its own state because a secret set
  to an empty string lists in `wrangler secret list` exactly like a real one and then
  fails at the first `.trim()`, which is the hardest version of this bug to see.
  It is the general form of CLAUDE.md's rule after M2.1's `MAPBOX_TOKEN`: unset is a
  different state from broken, and it belongs in front of whoever can fix it. Checking
  one secret because one broke would have left the rest exactly as invisible.

- **The target is 50 a week, and that is the working assumption** (Alex, M2.2).
  Not a temporary setting to be tuned down: **build assuming it is popular, not
  assuming ten users.**
  **In Alex's words:** "Five events doesn't represent what this app is. Someone landing
  on it needs to see a broad variety across the city — sports, concerts, clubs,
  community — so they understand it's about going out in Toronto and exploring, not
  about arena sports. A thin list teaches people the wrong thing about the product, and
  that costs more than pin concentration buys. We'll adjust with real data; we're not
  launching thin."
  This reverses the emphasis of "Publishing selectively is deliberate: pins must
  concentrate so crowds reach 5" (above). Concentration is still why the floor and the
  caps exist; it is no longer why the *number* is small. `publish_max` rose to 75 so
  the ceiling does not block the target, and `publish_min` stays at 3 — it only binds
  once the adaptive loop is on in M4.5, and it is the floor that keeps the list from
  disappearing after a bad fortnight, not a statement of intent.
- **At 50, the score floor is the limiter, not the target** (measured, M2.2). The real
  Toronto queue holds **88 eligible drafts across 8 weeks at a floor of 70 — about 11 a
  week**, so a target of 50 publishes everything that clears the bar and stays short.
  Lowering the floor is the lever that actually widens the list:

  | floor | eligible over 8 weeks | per week | mix |
  |---|---|---|---|
  | 70 | 88 | ~11 | clubs 31, concerts 29, sports 28 |
  | 60 | 223 | ~28 | concerts 130, clubs 59, sports 30 |
  | 50 | 424 | ~53 | concerts 287, clubs 77, sports 48 |

  **The floor and a per-category cap are one decision, not two.** At 70 the mix is
  already even and a category cap would bind on nothing. At 50 concerts are **68% of
  the queue**, and a list meant to say "going out in Toronto" becomes a concert
  listing. So: keep the floor at 70 until the category cap exists; ship them together.
- **The per-venue cap stays at 2** (checked at the new target, M2.2). At a floor of 70
  it binds almost nowhere — in the busiest week only Scotiabank Arena had more than two
  eligible drafts — so it costs the list nothing today and is exactly what stops a Jays
  homestand or an arena run dominating once the floor drops. Keeping it cheap and in
  place is better than adding it back under pressure.
- **No 72-hour floor** (Alex, M2.2; checked). At a target of 50 with a lead minimum of
  0 the near-term gap closes by itself: over the next fortnight only three days are
  empty, and they are mid-week days when Toronto genuinely has little above the bar.
  A special rule for the first 72 hours would be machinery earning nothing.
- **Bars and community have no source yet, and two chips would be empty** (found in
  M2.2). Ticketmaster classifies everything as Music, Sports or Arts & Theatre. There is
  no "bars" and no "community" in the feed at all, so two of the five categories Alex
  wants across the top of the list have nothing behind them until **M4.4**. This is the
  sharpest argument yet for M4.4 being close: the breadth the 50-a-week target is meant
  to show is, today, three categories wearing five labels.
- **Floor 60 with a per-category cap, together** (Alex, M2.2). "28 a week with a real
  mix beats 53 a week of concerts." `score_floor` drops to 60 and `max_category_share`
  (0.40) lands in the same migration; neither is correct alone. The share is of what is
  actually being published, not of the target, because a count derived from a target of
  50 would never bind on a queue supplying 28 — which is exactly when crowding happens.
  `min_per_category` (3) is the allowance before the share applies, or the first pick
  would be 100% of one kind. Gatherings already published that week count against the
  share, so a week filled by hand is not doubled. Per-venue stays at 2.
  Measured after the change: **41 published over three weeks — concerts 49%, clubs 32%,
  sports 20%**, with 33 concerts held back. The arithmetic to know before changing the
  share: a week can only reach (everything that is not the dominant category) ÷
  (1 − share), so two categories at 40% each can never fill a week between them.
- **An empty category chip is hidden, not greyed** (Alex, M2.2, for M2.3). "Community
  (0)" every day advertises an absence. A chip appears only when something can fill it.
- **The share is of the finished week, solved for — not grown into** (Alex, M2.2 walk).
  The first cap tested each category against the *running* count, so the week grew one
  slot at a time and stopped the moment no category could take the next slot without
  breaching its share at that instant — even though a larger week existed in which
  everyone was inside their share. On the real queue it stopped at **11 where 15 was
  available at exactly 40/40/20**. The publisher now searches for the largest week
  that can be filled with nobody over their share, and uses that week's ceiling. A
  refusal names the ceiling — "the week of 28 Sep is capped at 6 concerts for its 40%
  share" — rather than a tally that was true for one instant, which audits better a
  month later.
  What freezes a week is **the smallest category running out**: once it cannot grow,
  every other category is pinned to its share of a total that can no longer rise. So
  the cap's cost is a function of how many kinds of gathering have real supply, not of
  the share.
  Two rejected alternatives, both measured rather than argued:
  - **Share of the target** (40% of 50 = 20 concerts) — the ceiling lands above what
    the queue supplies, so the cap never binds: **31 published at 65% concerts**. It
    arrives at the concert listing by arithmetic instead of choice.
  - **Raise the allowance to 8** — 19 published at 42–47% concerts, but at these
    volumes the allowance does all the work and the share almost none. It hits the
    number by loosening the definition.
- **A varied Toronto list cannot be built out of Ticketmaster alone** (measured,
  M2.2 walk — the strongest argument in the project for the community work). With the
  algorithm correct and the share honest, the week of 21 September had **49 candidates
  above the floor and published 15**. The numbers that explain it:
  - **three categories, not five** — sports, concerts and clubs; the feed has no bars
    and no community at all;
  - **concerts are 69% of what is available** (35 of 49), so holding them to 40%
    mathematically bounds the week near 15;
  - **the per-venue cap trims the rest** — 49 candidates reduce to ~35 reachable;
  - fixing the algorithm recovered **4 of the 37 missing slots**. The cap was never
    the constraint. **The supply is.**

  Three categories against a 40% share leaves 20% of slack, and the smallest category
  runs out first. Add bars and community and the same share stops binding almost
  entirely. This is why the manual community pass (decisions Part 5) matters more than
  its position in the plan suggests: it is not decoration on the list, it is what makes
  every other rule in the publisher affordable.
- **A mark outranks every automatic rule** (Alex, M2.2 walk). "Publish first" used to
  mean only "skips the score floor", so three drafts Alex marked were refused by the
  venue cap and the category cap and stayed drafts while the confirmation promised they
  would publish. It now means what the button means.
  **The argument that settled it:** the Publish button already ignores every rule, so a
  mark that did not was a *weaker* version of a power Alex already had — which grants
  nothing and only confuses. A mark is "click Publish for me on the next run", and it
  therefore outranks the score floor, the lead window, the weekly target, the per-venue
  cap, the category cap and the community slot.
  What still stops it is what stops the button: no venue, already started (the database
  refuses), or **having been public before** — his own rule that an unpublish is final,
  which a mark left over from earlier must not silently reverse. That case is logged
  saying exactly that, rather than going quiet.
  Marked picks **count towards the caps**, so the automatic picks after them see them:
  the override is for the draft he named, not for everything that follows.
  `Never` was checked at the same time and is safe — it is the first test in the walk,
  before any cap, so a banned draft never enters the ranking at all. It fails closed.
- **No destructive control is ever pre-selected** (Alex, M2.2 walk). The draft queue's
  "Merge into" dropdown had no empty first option, so the browser selected the first
  gathering of that day on *every* row — an unrelated event offered as the merge target
  everywhere. Merge is genuinely two-step (it shows a confirmation page naming both
  gatherings before anything happens), but a wrong default on a destructive action is
  its own bug. There is now a "— merge into… —" placeholder, and a duplicate the queue
  has actually spotted is still pre-selected, because that is a suggestion with evidence
  behind it.
- **The per-venue cap is 6 a week, and is meant to be inert** (Alex, M2.2 walk).
  Raised from 2: six popular nights at Scotiabank Arena in a week is what is actually
  on in Toronto, and a cap of 2 was refusing Phoebe Bridgers, Gorillaz and a Leafs game
  in the week of 28 September alone. Measured over three real weeks:

  | venue cap | week 21 Sep | week 28 Sep | week 5 Oct |
  |---|---|---|---|
  | 2 | 15 | 15 | 15 |
  | 4 | 20 | 16 | 15 |
  | **6** | **23** | **16** | **15** |
  | none at all | 23 | 16 | 15 |

  **At 6 the cap already binds on nothing** — it matches "no cap at all" exactly. That
  is the point rather than an objection: it sits dormant and only fires in the case it
  was written for, a genuine homestand filling a week. A guard that never fires in
  normal weather is a good guard. Past week 21 Sep the binding constraint is the
  category share, not the venue, which is why raising it gains 8 in one week and 1 in
  the next.
- **Per-venue-per-day was considered and is a cap in name only** (Alex asked, M2.2
  walk; measured). The argument for it is sound — a Leafs game on Tuesday and Gorillaz
  on Thursday are different crowds and should not compete, while two shows at one venue
  on one night is the real duplicate problem. But **the same venue is used twice on the
  same day exactly once in three weeks of the eligible queue** (Lee's Palace, 9 Oct), so
  a per-day cap of 2 produces results identical to having no cap at all. It would be a
  rule that never fires.
  The distinction worth keeping from the question: the cap was doing two jobs that were
  indistinguishable at a target of 5 and separate at 50 — stopping the *list* looking
  like one venue's programme (a week question), and stopping one venue's same-night
  shows *splitting a crowd* (a day question). Only the first is live today. If crowd
  splitting shows up in practice, add a per-day cap then, with the evidence.
- **Three entry states, not two** (Alex, after M2.2). `is_free` had two values for a
  world with three: Pub Chess is $10 cash at the door, Snakes & Lattes is $20
  admission, and neither is free or ticketed. Both buttons were wrong — "I've got a
  ticket" described something that does not exist, and "I'm going" hid a cost.
  `gatherings.entry` is now `free` / `door` / `ticketed`, with `door_price_cents` and a
  60-character `entry_note`. **`is_free` is dropped, not derived**: two sources of truth
  for one fact is what the stale `FOLD_THRESHOLD` was, and it cost a week of hidden
  drafts.
  - **No third button.** Free and pay-at-the-door share "Pin in — I'm going", and the
    price goes on its own line beneath. Alex asked for a third copy string and was
    talked out of it: the button is a commitment and the price is a fact; a button
    whose words change with the price cannot be scanned down a list; and money inside
    the button makes it read like a purchase when nothing here is for sale.
  - **Never say free unless it is free**, and an unknown price reads "pay at the door"
    with no amount rather than nothing — silence looks like free to anyone scanning.
    Unknown is a different state from no cost, the same distinction as unset versus
    broken on a credential.
  - **`entry_note` earns its place** because "$10 at the door" and "$10 cash at the
    door" are different promises, and arriving with only a card is the failure that
    matters.
  - **The admin refuses an empty price once.** Choosing "pay at the door" and leaving
    the amount blank is refused with what the page would have said, and a "the price is
    not known" tick lets it through — so an unpriced door is a decision rather than an
    oversight (Alex).
- **"Crews open at 5" describes the rule, not the thing people want** (Alex, after
  M2.2 — filed for M3.3, and for the M2.1 copy pass since the line is on the public
  page). `THRESHOLD_EXPLANATION` currently reads "Crews open when 5 people opt in.",
  which asks a reader to wait on a mechanism. It should describe what they came for —
  "See who's going, form a crew" or near it — and tapping it should lead somewhere
  rather than count down. **The pinned crowd page should lead with the people, with
  forming a crew as the natural next step from seeing them**, not a feature that
  unlocks at a number.
  - **The two thresholds are already separate, and the spec already says so.** Alex
    asked whether seeing people and starting a crew need the same gate. They do not
    have it today: `private.can_see_at` never mentions five — it asks only that both
    people opted in, the list is open, and neither has blocked the other — and A9 says
    in as many words that "the reciprocal list already works at n=2". **Only crews
    opening and the gender-mix chip are gated at 5** (V3, Q3). So the change Alex was
    contemplating costs nothing in the data layer; it is purely a screen decision, and
    the database is already on the side he wanted.
  - **Which narrows the real problem.** The inert "3 of 5 · 2 to go" is the *crew*
    section's copy, and it is being given top billing on a page that already has faces
    to show. What A9 needs is not an earlier threshold but the right order: people
    first, the crew state as a quiet line underneath.
  - Still to answer when A9/A10 are built: **what the locked state offers beyond a
    number.** "3 of 5 · 2 to go" is honest and inert, which is the worst pair.
- **Messaging while crews are forming, and the phrase "Start a crew"** (Alex, after
  M2.2 — filed for M3.3). There is a cold-start gap: five people have opted in, nobody
  has started a crew, and there is no way to say "shall we?". Starting one asks somebody
  to go first with no conversation, and **that hesitation is exactly what the product
  exists to remove**.
  - **The thing to avoid is unsolicited messages, not messaging.** Those are separable,
    and solo crew already has the shape: mutual accept, and before it one preset line
    from a short list, no free text (Part 5, "Solo crew").
  - **Recommendation: the nudge, and build it once.** A preset line — plan-shaped, not
    person-shaped: "Shall we start a crew?", "I'll be at [spot] at 7, join me?" — which
    opens a free-text thread on a one-tap accept. The recipient lets the conversation
    in, which is the property Alex asked for, and accepting costs one tap. **The same
    mechanism is already specified for solo (M3.4)**, so building it in M3.3 and having
    solo reuse it is a saving rather than a cost; building solo's version first and
    retrofitting crews is the expensive order.
  - **Rejected: one message then wait.** Lowest friction, but it permits an unsolicited
    *free-text* message, which is the cold DM itself. Rate-limiting the second message
    does nothing about the content of the first.
  - **Rejected as a solution: free text once both are in a crew.** That is the crew
    thread (A14) and already planned — it arrives after the moment that needs help.
  - **Do the cheap half first.** "Start a crew" sounds like organising something when
    it should read as raising your hand — nearer "I'll be at [spot] at 7:30, join me".
    That reframing is hours, not days, and may shrink the need for the nudge enough to
    change what gets built. Ship the words first, watch the M3.6 dogfood, then decide.

  Both notes are one point, in Alex's words: **the product's hinge is whether people
  convene without a host, and every screen before that moment should pull toward it
  rather than report on it.**
- **A spot must be open at the meeting time** (Alex, entering the community list —
  filed for M5.2's automated approval check). A spot that exists but is shut when
  people are meant to meet is **worse than no spot at all**, because the admin's
  "crews are open and this venue has no approved spots" flag counts spots, not open
  ones: it stays silent, and the poll cheerfully offers a locked door. Two examples
  from the first seven community gatherings:
  - **Hart House chess** runs 4–11pm on a Friday and the Arbor Room, its only spot,
    shuts at 6. The 4pm start means the poll's default meet time of 3pm works, so the
    common case is fine — but anyone arriving at 8 has nowhere, and nothing says so.
  - **Barbara Hall Park** has O'Grady's, an evening pub, attached to a 9am Saturday
    run, because the poll fills from the venue's spots in order and knows nothing
    about hours.

  M5.2's check already fetches an evidence page per spot; opening hours belong in the
  same fetch, and the spot poll should then attach only spots open at the meet time —
  and say "this venue has no spot open then" where none is, which is a flag that can
  actually fire. Until then it is Alex's eye, per gathering, in the admin.
- **One list, one product — the categories were never structural** (Alex, after the
  community pass; recorded because it is the thing he would otherwise re-litigate).
  Community gatherings and big ticketed events belong in the same structure. The
  product is **commit, see who else committed, form a crew by vibe**, and *a Leafs
  game and a run club differ only in what you are committing to*. So the chips are a
  browse aid for a long list, nothing more — **no split, no second mode, no separate
  community product.**
- **The five chips, and why not the four verbs** (Alex, after the community pass). The
  distinction that matters to someone scanning is what they would be *doing*, not what
  the subject is — a run club and a Leafs game are not both "sports". But measured
  against the real feed the pure verb split does not survive: Music 523, Arts & Theatre
  102, Sports 83, Miscellaneous 9. "Watching" would be **87% of the list, which filters
  nothing**. So the watching kinds stay separate, because a reader who wants to watch
  still has to pick what, and the verb idea is kept where it actually divides the list:
  **live_music, sport, comedy, taking_part, markets**.
  - **Comedy singular**: theatre, classical and opera are capped at 35 by the AI rubric
    and never clear the floor of 60, so a "Comedy & theatre" chip would name something
    that cannot appear.
  - **Null is a real answer** — unclassified and still visible. Unfiltered is the
    default, so only a chip can hide a row and nothing disappears for want of a label.
  - **The stored value is an identifier; the label is copy.** Changing what a chip is
    called is one line in `packages/shared`, never a migration.
- **No "going out" chip: the feed cannot tell a DJ night from a gig** (measured,
  after the community pass — recorded with the numbers so nobody tries again from the
  same data). Dance/Electronic looked like a proxy for a club night. It is not, because
  **the same rooms host both**:

  | venue | Dance/Electronic | the rest of Music |
  |---|---|---|
  | History Toronto | 13 | 25 |
  | The Opera House | 6 | 28 |
  | Lee's Palace | 5 | 27 |
  | The Mod Club | 4 | 38 |

  Neither genre nor venue separates them, so a "going out" chip would be a guess, wrong
  often enough to be noticed. **M4.4's own sourcing can do it properly**, because a
  club-night source knows what it is; Ticketmaster never will.
- **The chips and the publisher's category cap are different taxonomies** (measured,
  after the community pass). The chips are what a reader browses by. The cap is a
  monotony guard and needs the finest honest split it can get. They are tempting to
  merge and **merging them is not free**: folding every kind of Music into one bucket
  takes the three upcoming weeks from **23 / 16 / 15 published to 6 / 6 / 6**. So the
  cap keeps its own vocabulary, a stored chip value is translated into it
  (`capBucket`), and the two are changed independently. The cap's concerts/clubs split
  rests on the same unreliable Dance/Electronic proxy as above — it is guarding against
  a distinction it cannot reliably make, which is worth revisiting when M4.4 brings a
  source that knows.
- **`create or replace` on a function somebody has already replaced is a silent
  revert** (Claude, publishing the community list — a bug I caused and found). Adding
  the entry states I rewrote `public_gathering` by copying the definition from
  `m2_1_public_visibility`, which `m2_1_venue_maps` had already superseded. The
  statement did exactly what it says and put the older body back, and four things went
  quietly at once:
  - `map_key` and `map_ready` vanished, so `isReady()` was false everywhere and **every
    crowd page on the site fell back to the schematic** — the real Mapbox picture M2.1
    was built for was gone, ticketed pages included;
  - `timezone` became `city_timezone`, which nothing reads;
  - spots lost their `active` filter and their `sort_order` ordering;
  - counts were rebuilt by hand with three fields, dropping women/men/other, so the
    **gender-mix chip (V3, Q3) had nothing to render**.

  **Nothing caught it.** The typecheck passes because the function returns `jsonb`;
  the unit tests do not call it; the policy harness asks what a visitor may *see*, and
  every one of these was a key that simply stopped being there rather than a row that
  leaked. It showed the instant somebody loaded a page and the map was a drawing.
  **The rule: before replacing a database function, read the live definition** — `\sf`
  or the last migration that touched it — never the migration that first created it.
  And a jsonb-returning function needs a test that names the keys its readers expect,
  which is the gap M2.3 should close while it is in there.
- **The convening is an arena solution applied to everything** (Alex, walking the
  community pages — **rethink, nothing built**). At Gorillaz you are inside a crowd of
  18,000 and cannot find anyone, so a crew has to convene somewhere else first. At a
  run club you arrive and twelve people are standing there: **the gathering is the
  meeting point**, and sending them to a cafe 200 m away to meet before walking to a
  thing they would have walked to anyway invents a step nobody wants.
  **The reveal is identical at both ends — commit, see who committed. The convening is
  not.** The spot poll is the arena's answer, and it has been applied to every
  gathering because until today every gathering was an arena.
  This also explains why the community pages feel off, and why the research pass
  gathered three spots for gatherings that need none.
- **Community gatherings do not need meeting spots** (Alex, same walk). A consequence
  of the above, and the reason the first pass produced spots nobody will use.
- **Spots may belong to a place, not to a venue** (Alex, same walk — costed below,
  not built). Nadege is near Trinity Bellwoods whether or not a run club exists, and
  any gathering in that area could meet there. Today `meeting_spots.venue_id` is
  `not null references venues`, so a spot is owned by exactly one venue and the same
  cafe beside two venues is two rows with two sets of tallies.
- **How a crew convenes is a property of the gathering, decided now** (Alex, after
  walking the community pages; built in M3.3). Three values on `gatherings`:
  - **`at_the_gathering`** — no spot poll. The crew card reads "find each other at the
    start". The crew still forms, the reveal still happens, the confirmation afterwards
    still happens; only the pre-meet disappears.
  - **`a_spot_first`** — today's poll, for arenas and anywhere 18,000 people make
    finding each other the problem.
  - **`after`** — the spot poll runs against the **effective end** rather than the
    start. This is what Frontrunners already does with coffee afterwards, and it is the
    one that is an honest shape for small gatherings rather than a subtraction from the
    arena's.

  **Defaults: `at_the_gathering` for Community, `a_spot_first` for Events**, both
  overridable — which follows the source split and needs no per-gathering judgement.
  **Why not "make the poll optional":** that leaves the arena assumption in place and
  asks Alex to switch it off forty times (his words, and the argument that settled it).
  **Why decide it now rather than when A10 is drawn:** the machinery is identical
  either way — crew, members, thread, confirmation — so allowing for it costs two to
  four hours inside M3.3, where unpicking screens drawn around a poll that is not
  always there costs considerably more. **Deciding late is the expensive version.**
- **Fortnightly and monthly, in the generator** (Alex, before the wider research
  pass). Monthly reads the pattern off the first date — which weekday, and which one
  of it — and **a date in the last seven days of its month is "last", not "fourth"**,
  because that is what "last Sunday of the month" means and a fourth-Sunday reading is
  a week early in any five-Sunday month. Verified: 27 Sep → 25 Oct → 29 Nov → 27 Dec →
  31 Jan → 28 Feb. Still a generator, still no recurrence in the schema.
- **Registering elsewhere is a line on the page; capacity is a publishing rule**
  (Alex, before the wider community pass). Two problems that arrived together and are
  opposites.
  - **Registration: still pinnable, with the line above the button.** "Pin in" means
    *I am going* — a statement about the person, not a claim about availability — so
    somebody who has registered with the ride club is telling the truth. What would
    have been dishonest is letting them find out afterwards. `signup_url` and
    `signup_required`; the notice sits above the call to action because it is a
    precondition, not a footnote.
  - **Capacity: a room too small is a page the product cannot serve.** Not a caveat.
    Crews open at five opted in and §7 expects opt-in at **about half of pinners**, so
    five opted in needs roughly **ten pinners — and a room that cannot hold ten cannot
    produce ten at any conversion rate whatsoever.** That is arithmetic, not a
    forecast. A birding walk with three places would promise a crew that can never
    form.
  - **Why ten and not five** (Alex's question, and he was right to ask): at five, every
    single attendee would have to pin *and* opt in, which will never happen —
    technically possible and practically dead. **Ten is where reasoning stops and
    evidence has to start**: below it is arithmetically impossible, above it is a guess
    about how many attendees ever become pinners, which nothing yet knows. It is
    `cities.min_capacity` rather than a constant for exactly that reason, so it moves
    with evidence instead of argument.
  - **What would justify moving it, so whoever revisits this knows** (Alex): real
    opt-in data, not an opinion. Specifically — the §7 figure this is derived from is
    *opt-in ≥ 50% of pinners*. If the first crowds show opt-in running well above half,
    the floor can come down, because fewer pinners would be needed for five to opt in.
    If they show attendance-to-pin conversion, the floor can rise on evidence instead
    of on the guess that is currently being refused. **Until one of those numbers
    exists, ten is not a preference to be argued with — it is the point where the
    arithmetic runs out.**
  - **Places remaining is deliberately not modelled.** "3 spaces left" is true for an
    hour and then it is a lie on a page we control — the same mistake as storing
    somebody else's opening hours. Capacity is a fact about the room; remaining is a
    fact about right now, and we cannot keep it.
  - **The known edge, named so it is recognised rather than rediscovered** (Alex, on
    entering the wider list). The Toronto Ornithological Club walk at James Gardens has
    a capacity of **15**, which clears the floor of 10 — and had **three places left**
    when the research ran. The rule works exactly as designed and still produces a page
    for a walk that is probably full. That is the cost of choosing capacity over
    remaining, accepted deliberately: the alternative is a number on our page that goes
    stale in an hour. It is published as the evidence. **When it bites, this is the
    argument, already had** — the fix is not to start modelling remaining, it is either
    a link out to the organiser's own count or not publishing gatherings that register
    externally at all.
  - A mark still outranks it, like every other automatic rule, and Alex can publish a
    small room by hand.
- **A series whose venue changes is a series only in name** (Alex, on the ride club's
  rotating start points). Toronto Bike Network starts somewhere different every week —
  Woodbine Beach, then Victoria Park, then Finch, then High Park. Those are **different
  gatherings that share a name**: different venue, different neighbourhood, different
  people within reach. They are entered separately, and the generator gets **no
  per-occurrence venue override**, because the override would then be used for things
  that ought to be one series. It is also another argument against ever making
  recurrence a first-class concept.
