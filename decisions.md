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
**Call, as it stands** (Alex, M3.1): a photo is **required to opt in to meeting** (A27
on the link path, A2 on the store path), **never to pin** — a pin buys a count, which
needs no photo; opting in buys visibility, which does. **The photo need not be a
face:** the check approves anything that is not nudity, hate imagery or gore, and sends
only a possible minor to a human (Part 5, "The photo check holds almost nothing now").
The screen encourages one — "A photo of you makes it easier to find each other" — and
does not demand it. There is no Instagram alternative: a handle is an optional profile
extra, never a substitute for the photo (Part 5, "Instagram handle"). The check is
automated (Part 5, "Automated photo moderation").

**Superseded wording** (Alex, revised build plan; replaced Test 0's "photo **or**
Instagram handle"), kept so the history is readable: *"the face photo is required to
opt in to meeting … opting in buys visibility, which does [need a face]. Crews look for
faces at a patio table."* **Superseded in M3.1** because it describes the old photo
rule: once a cartoon, a pet or a landscape is approved, "a face at a patio table" is a
promise the product does not keep, and a binding call that says otherwise is a stale
rule waiting to be walked against (as the M3.1 acceptance line nearly was). What
survives unchanged: required to opt in, never to pin, no Instagram substitute.
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
never required, never a substitute for the photo, and visible only to crewmates,
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
  **always optional**, never required, and **never a substitute for the photo**.
  **Who can see it:** only that person's **crewmates**, their **solo-plan partner** and
  their **connections**. Never on the open "going & open to meeting" list, never on any
  public page, never in link previews — this protects H2 (no cold DMs) and solo's
  mutual-accept rule. Enforced in the database like every other visibility rule, with
  harness cases proving both who can and who cannot see it, when the profile is built
  (**M3.1**; `docs/visibility.md` V17, pending).
- **Sign in with Apple on the web** (Alex, revised build plan: "later"; **reversed in
  M3.1** — see "Apple was built for the web and never rendered there"). Apple, Google
  and the email code are offered on the web and in the app alike. In the app Apple
  is required alongside Google (Apple's rule).
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
- **The Community chips, and when a chip earns its place** (Alex, after the wider
  community pass). `taking_part` was one chip holding everything — 28 of 31 — which
  is a chip row that does nothing. It splits into **games, cycling, running,
  outdoors**, alongside **markets & street**. Events is unchanged: live music, sport,
  comedy.
  - **Running and cycling stay apart** although they look alike, because the numbers
    say they behave oppositely: running is **4 gatherings, 59 rows, 2 venues** — clubs
    meeting constantly in two places — and cycling is **5 gatherings, 13 rows, 8
    venues**, a different place every time. One chip would hide both facts. Somebody
    filtering "running" wants a fixture near them; somebody filtering "cycling" is
    choosing a Saturday out.
  - **A chip needs three gatherings and two venues**, and the second test exists
    because the first one alone was wrong. My original rule was three *venues*, which
    Alex accepted — and it would have **hidden running**, the busiest chip after games,
    for meeting at only two places. Constant fixtures in two places are exactly what a
    run-club filter is for. The pair of tests asks the real question: **are there three
    things to choose between, in more than one place?**
  - **Making** (2 gatherings) and **reading & talking** (2 gatherings, 1 venue) get no
    chip yet. Filtering to reading showed Port Union Library or nothing. Both are
    library programmes and the libraries are where M4.4 starts, so both may earn one.
  - Below the bar nothing disappears: unfiltered is the default, and only a chip can
    hide a row.
  - **A seed row carries no chip.** The re-tagging caught `[TEST] Pride Trivia Night`
    on a name match; seed rows are invisible to every visitor anyway (V18), but a
    category on one is a fact about nothing.
- **One button on every crowd page: "Pin in — I'm going"** (Alex, after the M2.2
  walk). **Supersedes** "Pin-in button for free events" (M1.2), which gave ticketed
  gatherings "Pin in — I've got a ticket", and the copy M2.1 shipped with it. The old
  entries stay above rather than being edited away: the reasoning held for a product
  where every gathering was ticketed, and what changed is the world, not the argument.
  **Why one button:** a pin is a statement about *you* — I am going to this. It is not
  a claim about how you got in and should not change with how you paid. Varying it
  made the button harder to recognise down a list and put a transaction where a
  decision belongs. It is the same argument that kept the price *out* of the button:
  the price and the registration line are facts, and the button is the commitment.
  **The registration line sits above it, the cost line beneath it.**
- **A ticketed gathering says "Ticketed", not nothing** (Claude's call, Alex asked).
  With the button no longer saying it, a ticketed page would have had no cost line at
  all — and **a blank where "Free" sits on the next card reads as free to anyone
  scanning**, which is the trap already refused for an unknown door price. Every entry
  state now has a line, so none is recognised only by its silence; there is a unit
  test saying exactly that.
  **On W1 it is suppressed**, because a "Ticketed" tag on two hundred rows tells a
  reader nothing — unless the gathering carries a note worth reading, like "tickets
  are sold per table".

### Decided in Phase 2 M2.3

- **A chip is set once, at draft, and never overwritten** (Alex, M2.3). Every
  Ticketmaster gathering now carries the chip its own listing implies — Music / * →
  Music, Sports / * → Sport, Arts & Theatre / Comedy → Comedy, everything else nothing —
  written when the draft is created and **only where the column is null**. So an edit in
  the admin is final, and a genre Ticketmaster changes later never silently re-tags a
  published gathering. Null stays a real answer: unclassified, and on every unfiltered
  list, because unfiltered is the default and only a chip can hide a row.
  **The rule lives in the database** (`public.chip_category`), called by both things
  that need it — the nightly import for every new draft, and the one-off backfill — so
  there is no second copy in the Worker to drift away from it. Harness P66.
- **"Music", not "Live music"** (Alex, M2.3). Fifteen of the 39 published Events rows
  are Dance/Electronic club nights, and a DJ set is not live music. The feed cannot tell
  a DJ night from a gig (above, "No 'going out' chip"), so the honest move is the wider
  word rather than a chip claiming a distinction we cannot make. The stored value stays
  `live_music`: an identifier is not copy, and changing a label is one line in
  `packages/shared`.
- **A chip is counted from the rows on the page, not from a table** (Claude, M2.3,
  within Alex's rule). The bar is unchanged — three gatherings at two venues — but it is
  applied to the week and tab being shown, before any chip is applied. Two properties
  follow, and both are the point: **no chip can filter to an empty page**, and **no chip
  advertises an absence**. A hand-typed `?c=` value that did not earn a chip is dropped
  rather than honoured, for the same reason.
  A consequence worth stating: a category is offered in whichever tab has the rows for
  it. An open mic entered by hand is Community *and* is music, and three of them in two
  places should put a Music chip on Community. The `tab` field in `CATEGORIES` is where
  a chip is expected to live and the order it appears in, not a gate.
- **Every chip selected is not the same as no chips selected** (Claude, M2.3). They look
  identical and are not: unfiltered also shows the rows nobody has classified. The first
  version collapsed one into the other and would have quietly added back rows a reader
  had filtered out.
- **The two tabs are two paths** — `/` and `/community` (Claude's call, M2.3; Alex left
  it to me). "pind.social/community" is a link worth pasting into a run-club thread on
  its own, and `/` stays the shortest thing to paste anywhere else. Chips ride as
  `?c=games,running` on either, and **the chips do not follow you across tabs**: they
  are counted per tab, so carrying "Running" into Events would filter for something that
  tab does not have.
- **Both tabs are always shown, even when one is empty this week** (Claude, M2.3). They
  are the shape of the page, not a result of the data. Hiding one would move everything
  else depending on what Toronto happened to have on, and a reader who came for the run
  clubs would find no way to ask for them. An empty tab gets an invitation and a line
  saying what the other tab has that week.
- **A week at a time, with a pager** (Alex, M2.3). At fifty a week the whole published
  horizon is 112 rows today and over 200 once the publisher is full, which is 60 KB of
  HTML on a page with a one-second budget. **In Alex's words:** "Option 2 puts 60 KB of
  HTML on a page with a one-second budget, and option 3 hides most of the list behind a
  tap on the page that exists to show someone the city." A `?from=` in the past, or that
  is not a date, opens on this week rather than on a week that has been — a link kept in
  a Reddit thread should not open on gatherings that have happened.
- **The cap reads the listing's own classification; the stored chip is the fallback**
  (Claude, M2.3 — measured, and the reversal of what it was). Until M2.3 only
  hand-entered rows had a stored category, so "stored wins" and "classification wins"
  were the same rule on different rows. Filling the chip in for every Ticketmaster row
  made them different, and the old precedence folded all 189 music candidates into one
  bucket — losing the club-night-versus-rock-show split the cap exists for.
  Measured on the real queue the night it was filled:

  | precedence | published tonight | the three weeks end at |
  |---|---|---|
  | stored chip first (as it was) | **0** | 4 / 48 / 30 |
  | classification first (now) | **12** | 4 / 50 / 40 |

  **This is the `FOLD_THRESHOLD` shape again**: a data improvement that silently
  switches off a rule, with every line of code still looking right. `CAP_BUCKET` now
  names all eight chip values too — the version that still said `taking_part` after that
  split into four let unlisted values fall through `?? stored` and quietly become cap
  buckets of their own, each with its own allowance.
- **The five Community chips deliberately do not share one cap bucket** (Claude, M2.3;
  measured). Folding them changes nothing today — identical weeks, identical refusals —
  and it would sit Community permanently at or above its 40% share, since 21 of the 50
  rows in the week of 21 September are community. **A guard that fires in normal weather
  teaches the reader to ignore it**, which is Alex's own rule about the watchdog, applied
  to the cap.
- **The map's zoom is a property of the venue, chosen from its own spots** (Alex, M2.3:
  "adaptive zoom first, since it treats the cause"). At a fixed zoom 16 one frame covers
  about 1.3 km in a city where every spot is inside 500 m, so three spots a two-minute
  walk apart landed inside one label's width of each other — measured: of the six venues
  with more than one spot, **three overlap**, and Snakes & Lattes College has three
  inside a box 23% of the picture wide. The picture now zooms in as far as it can while
  every spot that fits at the wide frame still has room. Zoom 16 still decides **what is
  on the map at all**, so nothing changes about a spot being listed as further out, and
  zooming in never adds a spot, so the choice cannot oscillate.
  - **It must be the venue's spots, not the gathering's poll**, or two gatherings at one
    venue would want two different pictures and "one Mapbox image per venue, ever"
    becomes one per gathering. `public_gathering` returns the venue's active spot
    coordinates for exactly this.
  - **The zoom is part of the image's key**, like the coordinates and the renderer
    version, so approving a spot that moves the zoom mints a new immutable URL and
    nothing stale can be served.
  - **"Still inside the frame" was the wrong test for zooming in**, found on the
    deployed page: it chose zoom 18 for Snakes & Lattes and put two of three dots at 6%
    and 96% across, clipped at phone width. Being drawn at all and being drawn with room
    are different questions, and they now have different margins.
- **A spot is a numbered card, and the map is the way into it** (Alex; decisions Part 5,
  "A spot is a card, not a maps link" — the interaction half, built in M2.3). The dot
  used to carry the spot's name, its walking minutes and a Directions link in a box, and
  the box *was* the interaction: tapping it left the site for Google Maps. Now the map
  answers "how far, and which way" with numbered dots, and the cards under it answer
  "what, and when", with the walking directions link inside. It is a plain anchor —
  no JavaScript, and it works with a keyboard.
  - **Adaptive zoom alone was not enough**, which is why the labels went: even at the
    zoom chosen, Snakes & Lattes' closest pair is 14% apart against a label 19.5% wide,
    and three label boxes fill a phone-width picture at any zoom.
  - **Only the spots on the picture are numbered, and consecutively.** The first deploy
    showed dots 1 and 3, with 2 being a two-kilometre walk away and not on the map,
    which leaves a reader hunting for a number that is not there. An off-frame spot
    keeps its card and says where it is instead.
  - **What a card holds is only what we honestly know** — the name, what it is where
    somebody has written it, the walk, the meet time, the link. What the place is like,
    and whether six can get a table, arrive with the manual pass (M5.2). An empty field
    prints nothing rather than something guessed.
- **An uploaded map override carries no markers** (Claude, M2.3). It is somebody else's
  picture at a scale we do not know, so our coordinates mean nothing over it and a dot
  200 m out is worse than no dot. Its spots appear in the cards like everyone else's.
- **A Worker route that is not in `run_worker_first` never runs** (found in M2.3).
  `/community` came back as the Expo app's own `index.html` with a 200 — the
  single-page fallback — so a missing route looked like a working page of the wrong app
  rather than like a 404, and Cloudflare then cached it. It is the same lesson as M2.1's
  injected beacon one layer down: **the deployed URL is the only thing that can tell you
  what a route does.** Adding a public page means adding it to `wrangler.jsonc` and then
  fetching it.
- **Comedy is refused by the scoring, and the admin has to say so** (Alex, M2.3, on the
  finding). A chip appears only where something can fill it, which correctly hides
  Comedy — and thereby hides the fact that **51 comedy listings have never produced a
  single published gathering**, because the AI scores stand-up like seated theatre:
  25–60 against a floor of 60. **In Alex's words:** "That's a scoring problem, not a chip
  problem — and it's the same shape as FOLD_THRESHOLD: a number that looks right and
  quietly excludes things. I'd rather comedy earned its chip than have it hidden
  correctly." The Publishing panel now prints, for every category, whether its chip is
  live, whether it is below the bar, or how many drafts are waiting and the best score
  they have against the floor. **Fixing the rubric is a separate, measured pass** — what
  it involves is in spec §6, M2.3.

### After the M2.3 walk (Alex, on the phone)

- **A visitor must never be the thing that fetches the map** (Alex: "the map doesn't
  load consistently; I often have to refresh before it appears"). Diagnosed and
  measured: **29 of the 37 venues behind a published gathering had no picture at their
  current key**, so the first view of each of those pages showed the schematic — or
  nothing at all, at the 24 venues with no spots to draw one from. The second view
  showed the real map, which is why it looked intermittent rather than broken.
  - **The cause is not a race.** M2.1 built the fetch as a safety net — the page falls
    back and `waitUntil` renders the picture for whoever comes next — and it had quietly
    become *the mechanism*, because nothing else ever rendered anything. M2.3 made it
    visible rather than causing it: putting the zoom into the key retired every existing
    render at once, so every venue needed a new picture and every venue's first visitor
    paid for it. The orphaned `-v1` keys are still in `venue_map_renders`, recorded ok,
    for pictures nothing asks for any more.
  - **So the nightly run renders them**, immediately after publishing, because
    publishing is what creates a page a stranger can open. The fallback stays as a net.
    Mapbox requests still scale with venues and never with traffic — tens, ever — and
    the pass is bounded per night, reports what it did in the run summary, and counts
    whatever is left as missing rather than dropping it.
  - **The admin now says it out loud, and says the right thing.** "Never fetched" leaves
    no render record at all, so it was neither "ready" nor "failing" and read as fine —
    unset is a different state from broken (CLAUDE.md). Worse, the venue list called a
    venue "ready" if it had *ever* rendered anything, so a venue whose key had moved on
    read ready while its crowd page asked for an image that answered 404. **A status
    computed against the wrong fact reads as correct while being wrong**, which is the
    M2.2 venue-cap line again.
  - **Two smaller defects found on the way**, both of which turned an ordinary event
    into a missing map:
    - the image route **recomputed the zoom** from its own read of the venue's spots and
      compared keys, so a transient failure reading them, or a spot approved in the
      seconds between the page rendering and the browser asking for the image, produced
      a 404 for a picture that existed and was correct for the markers drawn over it. It
      now checks the coordinate half of the key against the venue's current coordinates
      — the safety property, which is why the URL is content-addressed — and the rest
      against the render record, which is the fact;
    - the spots read **swallowed its error**, so a failed read meant "no spots", which
      means zoom 16, which means a different key. Null now means "we do not know" and
      the caller declines to guess.
  - **Which venues, asked of the one door.** Both new passes first asked the database
    with a service-key filter — published, not withdrawn, not seeded, carrying a slug —
    which *looked* identical to the public definition and was not: a gathering Alex
    unpublished keeps its slug (M2.2, "once public, only Alex brings it back"), so
    Scotiabank Arena was counted as a venue needing a map for a page nobody can open.
    They now read `public_gatherings` through the anon key, as a visitor, and let RLS
    answer; the service key then fetches the operational detail for exactly those
    venues. **The same hole caught me twice in one milestone** — the admin's chip panel
    had it too — which is the argument for H11 being about more than policies: any
    second copy of "what is public" drifts.
- **What should be in the back button** (Alex: "moving between tabs, chips and crowd
  pages, back doesn't always go where I expect").
  - **The tab and the chips replace the current history entry.** They are
    query-parameter state on one page, not places you went, so four chip taps left four
    entries and "back" walked through a filter state nobody was trying to return to.
    The whole visit to the list is now one entry.
  - **The pager and the cards push.** Next week is somewhere else, and so is a crowd
    page. Back from a crowd page lands on the list exactly as it was, chips and week
    included, because the URL carries all of it.
  - **The map dots no longer push either.** Each `#spot-N` was a history entry, so after
    tapping three dots "back" appeared to do nothing — it was undoing a hash change on
    the same page.
  - **The accepted cost, stated:** because the chips replace, pressing back from a
    filtered list leaves for wherever the visitor arrived from rather than stepping back
    to the unfiltered list. That is the trade Alex asked for; the alternative (the first
    filter pushes, later ones replace) is a state machine in a page that has none.
  - It is 247 bytes of JavaScript on W1 and it is progressive: with JavaScript off every
    control is still an ordinary link that works, it simply also leaves an entry.
    Modifier and middle clicks are left alone, so "open in a new tab" still works.
- **The chip names are not settled** (Alex, M2.3 walk — **owed, nothing to build now**).
  "Community" as a tab name, and cycling and running as separate chips, may not be how a
  reader would divide this. There might be a "clubs" or a "wellness" shape that reads
  better than activity-by-activity.
  **What must survive the rethink, because it was measured:** running is 4 gatherings,
  59 dated rows, 2 venues — clubs meeting constantly in two places — and cycling is 5
  gatherings, 13 rows, 8 venues, a different place every Saturday. **They look alike and
  behave oppositely**, so one chip over both would hide both facts: somebody filtering
  "running" wants a fixture near them, somebody filtering "cycling" is choosing a day
  out. Any renaming has to keep that distinction available even if the words change.
  Cheap to change either way: a chip's label is copy in `packages/shared`, and only the
  stored value would need a migration.
- **The comedy rubric, measured before and after** (Alex, M2.3 walk: "measured
  before-and-after, not a prompt tweak"). Two edits to `SCORING_SYSTEM`: stand-up joins
  the "people come in ones and twos" group rather than the seated-theatre one, and it is
  named as **not** subject to the seated-theatre cap — while panel talks, readings,
  literary events and anything billed "in conversation" are named as capped at 35
  whatever a ticketing site files them under. Run over all 48 comedy drafts in the queue
  plus 17 controls, each set scored twice — once with the current prompt, to measure the
  noise, and once with the candidate:

  | | stored today | current prompt, run again | candidate |
  |---|---|---|---|
  | comedy (48) median | 35 | 40 | **65** |
  | comedy at or over the floor of 60 | 3 | 4 | **32** |
  | theatre / classical / opera (8) | 15–30 | 22–32 | **25–35, still capped** |
  | Jaipur Literature Festival | 32 | 35 | **35** |

  The literature festival is the one Alex named, and the candidate's own reason for it
  is *"In-conversation literary event, capped despite comedian guest and decent theatre
  crowd"* — it holds.
  **The noise floor is worth writing down:** re-running the *same* prompt moved
  individual rows by 5 to 15 points and lifted one extra comedy show over the floor. So
  this is a distribution result, not a per-row promise, and any future rubric change
  should be judged the same way — twice, with a control set.
  **Shipped with its re-score, in one commit** (Alex: "new drafts scored generously
  while the existing 51 aren't is a worse state than either"). Only new drafts are
  scored by the nightly run, so a rubric change without a re-score leaves the publisher
  ranking two wordings against each other under one floor. As applied: all 48 comedy
  drafts re-scored, median **35 → 60**, **3 → 28 at or over the floor**; the literature
  festival held at 35; theatre, classical and opera were not re-scored and did not move
  in the controls. `scripts/rescore.ts` does it, **dry by default and `--write` to
  save**, because a score is what decides whether a stranger ever sees a gathering.
  Whole exercise: **$0.26**.
  **The general rule this establishes:** a change to a rubric or a threshold is judged
  by running it twice with a control set — once with the current wording to find the
  noise floor — and it ships together with the re-score of whatever it has already
  judged. "It reads better" is not evidence, and neither is a single run.
- **Where the map's interactivity goes from here** (Alex asked; costed, nothing built).
  Filed against the city map already being **Protomaps on R2 + MapLibre, in the app**
  (decisions, "When it comes, half the decision is already made"), because that decides
  most of this.
  1. **The pipeline is the shared cost, and it belongs to the city map.** A Toronto
     vector extract as a `.pmtiles` file in R2, served through a Worker route that
     answers HTTP range requests, with the glyphs and sprite in the same bucket so
     nothing loads from a third-party host. **No per-load billing and no egress fee**,
     against Mapbox GL's $5 per 1,000 loads past the free tier, and no API key in any
     page. Roughly **6–12 hours** all in, and every hour of it is reused by the deferred
     city map and by A8.
  2. **Real pan and zoom belongs in the app (A8/A10), not on W2.** The app is already a
     bundle, already has a session, and has no one-second budget inside a Reddit tab.
     Once the pipeline exists this is a MapLibre component with the venue centred and
     its spots as markers: **3–6 hours**, inside M3.2's own map work rather than on top
     of it.
  3. **W2 keeps the static image as its default, for a measured reason.** MapLibre GL JS
     is about 200 KB gzipped before a single tile, against a crowd page that is **9 KB
     of HTML and a 30 KB picture today**. That is twenty times the page, on the surface
     whose whole job is opening in a second inside somebody else's browser.
  4. **What W2 can have cheaply, in rising order of cost:**
     - **"Open in Maps" for the venue as well as each spot** — the phone's own map app
       is a genuinely interactive map, and it is a link. Minutes.
     - **Two or three pre-rendered zooms and a no-JavaScript switch between them.** The
       picture is already content-addressed per zoom, so this is mostly bookkeeping:
       three renders per venue instead of one, a couple of links, no new dependencies,
       no budget change. **1–2 hours.**
     - **A real map behind a tap** — the static image stays the default and MapLibre
       loads only for the visitor who asks for it, from our own R2. The default page
       costs nothing, the person who wanted a map pays for it, and it needs the pipeline
       from (1) plus **2–4 hours** and a measured check inside a Reddit in-app browser,
       which is where heavy JavaScript maps go wrong.
  **The recommendation:** nothing on W2 now; when M3.2 builds A8, build the pipeline for
  it rather than a one-off; then W2's zoom switch and, if it is still wanted, the
  behind-a-tap map. The order matters because every step after the first is cheap only
  once the pipeline exists.
- **One definition of public, and a test that fails if anyone hand-rolls a lookalike**
  (Alex, after the walk: "is there a way to make it structurally hard?"). Yes, and it
  was cheap. Two of M2.3's four map defects were a service-key filter that read exactly
  like the real rule —
  `.not("slug","is",null).is("withdrawn_at",null).eq("is_seed",false)` — and is not it,
  because an unpublished gathering keeps its slug.
  - **`publicVenueIds()` joins `crowds()` in `src/public/data.ts`**, the door module, so
    the question "which venues can a visitor reach" has one answer and a name. The rule
    in one line: *a server-side job that needs to know what is public asks the door, as
    a visitor, through the anon key, and lets RLS answer* — the service key is for the
    operational detail behind those rows, never for a second opinion about visibility.
  - **`tests/unit/door.test.ts` scans every Worker source file** and fails if those
    PostgREST spellings appear outside the door module, naming the file and pointing at
    the helper. It was checked by reintroducing the bug: the test goes red.
  - What it deliberately does not ban: reading `is_seed` on a single row already in
    hand (the map routes check the venue they were asked about), or the publisher
    counting published rows for a week's arithmetic. Those are different questions.
  - It is a grep in a unit test rather than a type, which is the honest level for a repo
    with no build step — a type would need the PostgREST builder wrapped, which is more
    machinery than the mistake is worth.
- **"Open in Maps" for the venue itself** (Alex: the cheapest thing on the
  interactivity list and the one he would use). Beside the figure's caption, on all
  three versions of it — the real picture, the schematic and an uploaded override. It is
  one link; the phone's own map app is a real interactive map that pans, zooms, searches
  and routes, against roughly 200 KB of JavaScript for a map library on a 9 KB page.
  Coordinates rather than a name, because a name search lands on the wrong branch of a
  chain, and the venue's coordinates are what the whole picture is drawn from. On iOS
  the same small script that rewrites the spot links sends this one to Apple Maps.
  Measured cost: **180 bytes**.

### Is that run club still a run club? — the liveness check (M2.3b)

Alex chose this over the W2 zoom switch after the M2.3 walk: "188 rows running to
mid-November with nothing re-checking them is a live problem, and a map you can't zoom
isn't. A defunct run club on the site costs more than any amount of map polish." The
real horizon turned out to be worse than either of us said — **the generator had written
occurrences to 31 December**, three and a half months out.

- **The cheap version does not work, and the numbers say so.** All 28 series' pages were
  fetched on 20 September: **27 answered 200 and not one was gone**, so "is the page
  alive" carries almost no information. Two things kill a deterministic check outright:
  - **four of the 27 name no future date at all** — Running Rats and all three
    Frontrunners runs say "every Tuesday, 6:30pm" and nothing else. A "does it name a
    date" rule would have flagged four live run clubs in its first week, which is the
    guard-fires-in-normal-weather failure for the third time in one milestone;
  - **a page is not a series**: seven series share one 582 KB Snakes & Lattes page, five
    share `tbn.ca`, three share the same 519 page. Keyword or date matching on a shared
    page says nothing about one game night.
  So the check **reads the page and asks one narrow question**: does this page still say
  this gathering happens, how often does it say, and what is the furthest future date it
  names. Deliberately the smallest slice of M4.4's extraction, measured early against 28
  pages whose answers are already known (`docs/m4.4-brief.md`).
- **The lifecycle, confirmed before it was built.** Per series: **unverified** (never
  read) → **confirmed** (the last read found it, with the horizon it named, which may be
  null) → **doubtful** (the page is gone — unambiguous, on the first read — or two
  consecutive good reads did not find it) → **settled** (Alex looked and said leave it),
  with **unverifiable** off to one side for a page that cannot be read at all. Only a
  read moves it.
  - **"No evidence is not evidence" is the rule the design turns on** (Alex). A page that
    times out, blocks us, or simply does not say is `unverifiable`, and it **never**
    accumulates towards doubt however many times it happens. The model's own "unclear"
    answer maps here too, not to absence — which is what protects those four run clubs.
    The admin says the two things in **visibly different sentences**, from one function
    so they cannot drift apart per surface: *"Its page loaded, and did not mention this
    gathering"* against *"We cannot tell from this page… which is not the same as the
    gathering having stopped."*
  - **Nothing is ever withdrawn or unpublished by a machine.** Withdrawing keeps the
    pins and can be undone; **unpublishing cannot be undone by any automatic run**,
    because the slug is already minted and `slug is null` is the re-publish guard (M2.2)
    — so the worse of the two is also the irreversible one. The check's loudest possible
    output is a line in the admin.
  - **"I looked, leave it" clears it**, stamps who and when, and shows the note beside
    the series, because **a flag that cannot be cleared becomes a flag nobody reads**
    (Alex). A settling does not silence the next change: anything that strikes afterwards
    is a fresh doubt and says so.
- **The first full pass, measured:** 28 series read, **27 confirmed, 1 unreadable
  (Kensington Market's page would not load), and not one false absence.** Cost **$0.42
  for all 28** — about 1.5 cents a page — so four a night is six cents a day. The four
  no-date pages confirmed exactly as designed, each with its cadence in the page's own
  words ("Tuesdays and Thursdays @ 6:15pm", "every Friday from 4-11 PM").
- **Its own cron, run row and budget line** (Alex). 13:00 UTC, four series a night, so
  all 28 come round weekly; a separate `community_check_runs` table with its own lock, so
  neither job can report the other as busy; and the credential check sits *inside* the
  try, after the run row is opened, so a night that fails on a missing key leaves a
  failed run behind (M2.2's founding rule).
  - **And `admin_ai_spend_today` now sums both tables.** It read `import_runs` only, so
    **any AI spend outside that table was invisible to the daily cap** — M1.3b's cost
    blind spot, one table over, and the way a $3 cap quietly becomes a $6 day.
- **Eight weeks is the generator's horizon**, on the `cities` row rather than in code
  (`community_weeks`, replacing a guard that allowed a year from the first date).
  **Why eight:** it is the horizon the Ticketmaster import already looks over
  (`import_weeks`), so the product has one idea of how far ahead it looks rather than
  two; it is comfortably more than any of these pages actually confirms; and it is a
  setting because it is a judgement that should move with evidence. Measured **from
  today, not from the first date**, so a series starting in March does not inherit a
  year's licence.
  - **A cap without a top-up is a decay mechanism**, so the same page counts the other
    side: **seven of the 28 already have fewer than 21 days of dates left**. Nothing
    counted that before, which is the same shape as a venue whose map was never fetched —
    unset is a different state from broken.
  - **Nothing already published was touched.** An unconfirmed far date is not evidence of
    anything, and unpublishing 188 rows to tidy a horizon would have cost more than it
    bought (Alex: "lighting up most of the list on day one to tell me something I already
    know is the same mistake as the red 'short by'").
- **Two findings out of the first pass, neither a bug:**
  - **several pages name dates further ahead than we hold** — TBN's Sunday rides confirm
    to late October where our rows stop in September. That is the top-up signal the
    running-out count is for, and it is the first evidence that a source can *extend* a
    series as well as end it.
  - **one horizon looks too good:** College Social Game Night came back confirmed
    through September **2027**. Harmless today, because nothing reads
    `confirmed_through` except the admin, but it is the kind of number that would quietly
    silence a rule later. Worth a sanity ceiling when anything starts depending on it.
- **The gap, stated rather than left implied.** The import's watchdog is a pg_cron job in
  Postgres, because a Worker cannot report its own cron being dead (Alex, M2.2) — and it
  watches the import, not this. The Community page says loudly when no run has finished
  in 48 hours, which is the half that answers somebody who looks; **the half that reaches
  out does not cover this job yet**, and generalising M2.2's machinery to N jobs is a
  refactor rather than a copy. The difference in urgency is real: a missed import means
  the city's list stops refreshing, a missed check means a series is re-read a few days
  late.

- **The threshold is our mechanic, not the reader's reason** (Alex, closing M2.3 — and
  he had never liked the old line). "Crews open at 5" describes a rule somebody is
  waiting on. What a reader came for is to see who else is going, so **the number never
  leads on any surface**:
  - **W2, before pinning, is headed "Who else is going?"** with the counts under it as
    the answer, and `THRESHOLD_EXPLANATION` — still the fixed §5 sentence, unchanged —
    as a quiet line beneath them. "Who else is going?" rather than "See who's going"
    for two reasons: the page's own description already reads "See who's going, meet
    them there.", so the heading would have restated the tagline, and on a page about
    one gathering the question is the sentence already in the reader's head.
  - **A card on W1 says what is true**: "3 pinned", and "crews forming" only when they
    are. A row short of five now says nothing about five — two hundred rows all reading
    "crews open at 5" was the rule being repeated at a reader rather than anything about
    that gathering.
  - **The pinned page leads with "Find your crew"** (Alex; recorded here for A9/A10 in
    M3.3), where forming one is genuinely the next action rather than a state to wait
    for. This is the screen decision the earlier note predicted would cost nothing in
    the data layer: `private.can_see_at` never mentions five, so the reciprocal list
    already works at two, and only crews opening and the gender-mix chip are gated at
    the threshold (V3, Q3).
  - The sentence itself stays fixed copy. It is where it belongs — underneath, in
    smaller grey type — rather than rewritten, because the full copy pass with Tatiana
    is still owed (spec §5, "The voice").
- **A source can extend a series as well as end one, and that is cheap** (Alex asked, at
  the M2.3 close; **costed, not built**). The first liveness pass found TBN's Sunday
  rides confirmed into late October where our rows stop in September — the opposite of
  the problem the check was built for, on day one.
  - The shape: where a page's `confirmed_through` runs past our last occurrence, **top
    up by generating drafts** — never published rows — to the nearer of that date and
    the `community_weeks` horizon. Publishing stays where it is: the mark, the
    publisher, or Alex.
  - The one thing it needs that does not exist: **the cadence**, because there is
    deliberately no recurrence in the schema. It does not need storing — the spacing of
    the occurrences we already hold gives it away (seven days apart is weekly), and all
    28 were generated from a fixed cadence. Inferring it from the rows is both cheaper
    and safer than trusting `cadence_seen`, which is the page's prose.
  - **Two to three hours**, including a "top up" button next to the running-out count
    and its tests. It belongs with M4.4's daily run as a step, or stands alone whenever
    the running-out banner becomes annoying enough to act on.
- **A source claiming a year of horizon is not evidence** (Alex: "note it now rather
  than when something depends on it"). College Social Game Night came back confirmed
  through **September 2027**. Nothing reads `confirmed_through` today except the admin,
  so it is harmless — and it is exactly the kind of number that silences a rule later:
  a top-up that trusted it would generate a year of drafts, and a running-out check that
  trusted it would never fire. **So whatever first depends on that field clamps it** —
  to the city's own horizon plus a small margin — and treats anything beyond as "the
  page said something we are not going to act on". Noted in `readAnswer` where the field
  is parsed, which is where the clamp will go.
- **A search bar: settled in design, filed for M3.2** (Alex asked; his own rule was to
  file anything over an hour or two).
  - **It needs no client JavaScript at all**, which was the open question. A form with
    `method="get"` in the header is a navigation: the magnifying glass submits, the
    Worker renders `/search?q=…` with the same card renderer as W1. Nothing to hydrate,
    nothing to bundle, and it works with JavaScript off, which is the same property the
    chips have.
  - **One door, one predicate.** Search is `public_gatherings` with an optional query
    parameter rather than a third function — "on the public web" stays one definition
    (M2.1, H11), and `ilike` over name and venue is nothing at 235 rows or at ten
    thousand. About **two hours** with the route, the header, the empty state and its
    tests.
  - **Why M3.2 rather than now:** the app's crowds list (A5–A7) needs the same search,
    and the same door function serves both. Building it twice is the expensive order,
    and a search box on the web with no equivalent in the app reads as an oversight.
  - **What "no results" says, which was the real question.** Searching only published
    rows, and **saying plainly what the site is**: we publish a selection of what is on
    in Toronto each week, so most of it is not here. Then two things rather than a dead
    end — the nearest thing we *do* have (the same venue, or the same chip, or simply
    this week), and the suggest-a-gathering mailto with the query already in it.
  - **Rejected: searching the draft queue and offering to publish.** It is a different
    product, and the cost is not hours. Drafts are admin-only by policy (V12), so
    exposing them is a visibility change with harness cases and the M4.2 reviewer's
    attention — call it 6–10 hours plus a policy review. And it inverts the publisher:
    a stranger's search would drive what gets published, where **publishing selectively
    is the point** (decisions Part 5). "We know about it and chose not to show you" is
    also a worse sentence than "we show a selection".
  - **One question it raises, deliberately not answered:** whether to count the searches
    that find nothing. It would be the best possible input to publishing decisions —
    what a hundred people looked for and we did not have — and it is new data collection
    on a page that needs no account, so it belongs with the privacy policy in M4.1
    rather than smuggled in with a search box (Part 4, "Data deliberately not
    collected").
- **Lighthouse on W1 and W2: deliberately skipped, and moved to M3.2** (Alex, closing
  M2.3). Not an oversight and not a shortcut. Three reasons, his:
  1. **The byte measurements are more precise than the score.** Events with 26 cards is
     **9.0 KB against a 7.9 KB empty-page floor** — about 1.1 KB for the whole list —
     with two requests of ours and no image. There is no room in that for a surprise
     that a score would reveal.
  2. **The last Lighthouse run measured the wrong URL** and cost an hour chasing a bug
     that did not exist.
  3. **There is nothing on these pages for it to find.** No framework, no fonts, no
     images on W1, and 247 bytes of JavaScript. M3.2 is where that changes — the quick
     pin (A26) is a real Expo bundle, and M2.1 already measured that holding route at
     **828 KB and a score of 37** against the crowd page's 78 KB and 99. That is where
     a Lighthouse run and a full request list earn their hour, and M3.2's acceptance
     already asks for exactly that.

  **The rule this does not weaken:** load the page in a browser and list its requests.
  That is how M2.1 found the injected beacon and how M2.3 found `/community` serving the
  wrong app, and both were found with `curl` and a request list rather than with a score.
- **What a card says about its crowd, in three states** (Alex, closing M2.3 — taking the
  threshold out was right, and leaving "0 pinned" alone overshot: it reads as dead
  rather than as early).

  | state | the line |
  |---|---|
  | nobody yet | 0 pinned · be the first |
  | some, nobody open to meeting | 3 pinned |
  | some, with some open | 3 pinned · 1 open to meeting |
  | crews forming | 12 pinned · crews forming |

  - **The zero is never hidden.** "Be the first" alone would read better and say less;
    the digit stays, because small counts are shown, never hidden, including zero (H6,
    spec §2 W1), and the invitation sits beside it rather than instead of it. It is also
    the phrase A5–A7 already use for this state.
  - **"See who's going" is deliberately not on every row.** It was the obvious option
    and it has the same failure as the line it replaced: two hundred rows repeating one
    phrase is a slogan said at a reader, not a fact about that gathering — and the page
    already says it once, at the top. What a reader wants to know is whether there is
    anybody to meet, so the second clause is the open-to-meeting count where there is
    one. It differs on every row, which is the test a card line has to pass.
- **The mark top left, the wordmark top right** (Alex, closing M2.3), replacing the
  composed lockup in the corner. One anchor spanning the header, so there is one link
  home with one accessible name rather than two adjacent links to the same place. The
  composed lockup stays in the OG image, where it has a whole card to sit in the middle
  of — and it is still provisional and Tatiana's to change.

- **A line for the reader, and the grounding it depends on** (Alex, closing M2.3:
  "'Toronto Tempo vs New York Liberty' tells a reader nothing — is it basketball, is it
  a season opener, does any of it matter?"). Two passes, one shape, and the measurement
  came before the prose in both, as with the comedy rubric.
  - **The scoring line was never a candidate.** "Leafs home game: huge 19-35 crowd, lots
    of solo fans, bars all round the arena" is a note to an operator judging crowd
    quality, and no rewriting makes it a description. Alex said so before it could be
    tried.
  - **It is a grounding problem, not a prompt problem** (Alex, on the numbers). Asked for
    a reader-facing line from the facts we hold — name, venue, date, what it is filed
    under, what it costs — ten real rows came back **3 recognised of 10, with the "why"
    null for 9**, and the unrecognised ones restated their own titles ("a community
    knitting group at a public library"). The same community rows **with the organiser's
    page in the call** came back **4 of 4 with a real "why"**. So: **descriptions are
    only worth having where we are already fetching a source.**
  - **Community rides on the liveness read**, which already fetches each series' page
    weekly. A second, separate call rather than two jobs in one prompt — it costs the
    page's tokens twice, about 1.5 cents, and happens **once per series, ever**, because
    a line is set once. Keeping the safety-critical question ("has this stopped?") in a
    prompt that asks nothing else is worth two cents. **26 of 28 series described, 185 of
    188 occurrences, $0.69 for the pass.**
  - **Events was measured before it shipped**, because the community numbers do not
    transfer — an organiser's page is written by somebody who cares and a Ticketmaster
    row is a title and a venue. On 40 real published rows: **32 recognised (80%), at
    $0.0012 a row**, and the eight it declined were local DJ and support acts, which is
    exactly the right set to decline. That cleared Alex's bar ("if Events comes back
    mostly known: false, it is not worth the nightly cost").
  - **No line unless the source knew something** — the rule Alex cared about most. A
    `known: false` writes nothing, and a blank beats filler. On the published Events
    rows that is 39 of 47 described and 8 left blank; on W1 today, 25 of 26 cards carry
    a line and 18 of 18 do on Community.
  - **The stale guard, and what it caught.** The first real community pass produced
    "Registration required, 1 hour long, **17 spots remaining**". Places remaining is
    deliberately not modelled anywhere in this product — true for an hour, then a lie on
    a page we control — and a model reading an organiser's page picks it up every time.
    Both prompts forbid it and `src/blurb.ts` refuses it anyway, because **a rule that
    exists only in a prompt has no floor under it**. Then the guard's own first version
    was too wide and refused "Registration required (max 15 spots)", which is capacity —
    a fixed fact, and exactly what the prompts allow. Both halves are in the tests.
  - **A prompt change revisits what it has already written.** Fixing those rules meant
    clearing the 30 occurrences the old wording had produced and letting the new one
    write again — the rule the comedy re-score established, applied at a tenth of the
    scale.
  - **Why the row Alex named had no line, which was not a decline.** Asked alone, the
    model describes the Tempo game perfectly; a batch of 20 had declined it. But the
    eight other declines stayed declined at a batch of four, so **batch size was not the
    cause**. The cause was that the pass started its window at `now` while **W1 shows
    everything from the start of the local day** — so tonight's rows, the ones a reader
    is looking at, were never offered to it. The window now reaches a day back. It is
    the same shape as the map bug: the job and the page disagreed about which rows
    matter.
  - **"Learn more" on W2 only**, labelled honestly — "Tickets" for a ticket page,
    "Learn more" for an organiser's — because one of them is going to ask for money. A
    card is already a link, and an anchor inside an anchor is invalid HTML.
  - **Same lifecycle as the category** (Alex): set once, never overwritten by a machine,
    an admin edit final. Clearing a line by hand leaves no source behind, so a later run
    may write one again — an emptied line still marked "admin" would be a blank nothing
    could ever fill and nobody would remember why.

- **A card says the count and the invitation, and nothing else** (Alex, closing M2.3).
  "Crews forming" is gone from the list: **crew state belongs on the page you land on**,
  not on the row that gets you there. Every row with anybody on it reads "3 pinned · see
  who's going" and a row with nobody reads "0 pinned · be the first". It was the last
  thing on a card that was about our machinery rather than about the reader.
- **The restatement check was built, measured, and deliberately not wired up** (Alex
  asked for it on the correct principle that a prompt instruction has no floor under
  it). Token overlap against the gathering's own name, over all 64 lines on the site:

  | overlap | title → line |
  |---|---|
  | 63% | Toronto Maple Leafs vs. New York Islanders → NHL hockey, Maple Leafs host the New York Islanders |
  | 67% | Thee Sacred Souls, LA LOM & The Womack Sisters → Soul group Thee Sacred Souls headline with… |
  | 43% | Toronto Blue Jays vs. Reds → MLB baseball, Blue Jays host the Cincinnati Reds |
  | 40% | Toronto Argonauts vs. BC Lions → CFL football, Toronto Argonauts hosting the BC Lions |
  | 29% | Totally 2000's Video Dance Party → Dance party playing 2000s music videos and hits |

  **Every line at or above 40% is a good one, and the genuine restatements sit at 29%.**
  The metric is inversely useful here: when a title already carries the proper nouns,
  the line's remaining words *are* the league or the genre — "NHL hockey", "MLB
  baseball", "soul group" — which is exactly the two words that answer "is it
  basketball?". A padded restatement avoids the title's words precisely *because* it is
  padding. Any threshold that hides anything hides the best lines first.
  - What would catch the real thing is a judgement about which new words count as
    informative, which is the same kind of rule as a prompt instruction with my
    taxonomy in place of the model's. So: **the restatement problem is small (2 of 64),
    the prompt already forbids it, and the admin's own edit is the fix for one that
    slips through.**
  - `titleOverlap` stays in `src/public/list.ts`, unused by the render path, with its
    numbers pinned in `tests/unit/list.test.ts` — the same treatment as the "no going-out
    chip" measurement, so nobody builds it again from scratch.
- **One definition of the floor a reader can still see** (Alex: "is 'which rows does
  this job consider' a definition worth having in one place, the way the public door is
  now?"). Yes, and it was cheap, because the disagreement was always at the same edge.
  - **Three times in one milestone two pieces of code disagreed about which rows
    matter**, and every time it was invisible until one specific thing was missing: the
    map pass and the admin's chip panel each wrote their own "on the public web" and
    counted rows RLS hides; then the description pass started its window at `now` while
    W1 opens on the start of today in the city, so **tonight's rows — the ones a reader
    is looking at — were the ones that never got a line**, the game Alex named among
    them.
  - **The windows legitimately differ and the floor does not.** The page shows a week,
    the publisher looks 21 days out, the map pass 28: those are real differences. What
    must never differ is where they start, and that was one line of arithmetic written
    three ways. `readerFloor(now, tz)` and `daysAfterFloor(now, tz, days)` in
    `src/public/list.ts` are now the only expression of it, used by W1's default window,
    the description pass and the map pass, with the horizon left to each job.
  - **This is the same shape as the door, one layer along.** `publicVenueIds` answers
    "which rows are public" by asking the database; `readerFloor` answers "which rows
    are current" in one place. Between them they cover both halves of the question a job
    has to get right before it does any work at all.
- **"Hotspots" — filed, not built** (Alex, closing M2.3). A button leading to a page
  showing both Events and Community ordered by most pins.
  - **Why it does not contradict Q10.** The list stays date-ordered, and the reason is
    unchanged: popularity as the *default* sort is a rich-get-richer loop that buries the
    gatherings which most need to reach five. Hotspots is different because **the reader
    chose it** — the same distinction as the popularity filter already filed (decisions,
    "The three surfaces, and which is the default").
  - **A button, not a third tab** (Alex's constraint, and the reasoning is the point): a
    tab of equal weight beside Events and Community would make popularity the default
    for whoever taps it first, which is exactly what Q10 refused. **It is a detour, not a
    peer.**
  - **Revisit when there are real pins.** Today every gathering has zero, so the page
    would be an empty list ordered by nothing — and it would be the first page in the
    product whose emptiness is a statement about the product rather than about the week.

### Decided in Phase 3 M3.1

- **V17: a crew is a crew whatever its state** (Alex, M3.1). Forming, spot set, live,
  done and dissolved all let crewmates read each other's Instagram handle. **Leaving
  is what ends it** (`crew_members.left_at`), not the crew's state. The alternative —
  a crew that met keeps it, a crew that dissolved does not — was considered and
  rejected: "the rule gets harder to state and harder for the M4.2 reviewer to audit,
  for a case that's rare. And a dissolved crew still had people in a thread together,
  which isn't nothing. If a real problem shows up, split it then with evidence."
- **V17 has two branches, not three** (Alex, M3.1, accepting the recommendation). The
  spec names crewmates, a solo-plan partner and connections, but a solo plan **is** a
  crew (`kind = 'solo'`, M3.4), so the solo partner falls out of the crew branch and
  needs no rule of its own. M3.4 adds the column and the harness case that proves it.
- **A pending join request is not a crewmate** (Alex, M3.1). The handle appears only
  once a member has approved you.
- **A photo that fails its check is a fourth state, and it is recorded** (Alex, M3.1).
  A check that errored, timed out or never ran is **not** "needs a human" and **not**
  "waiting": it leaves `photo_status` at `pending` and writes a failure row to
  `photo_checks`, and the admin counts *waiting for a human*, *never successfully
  checked* and *check failing* separately. Leaving it at pending with no record is the
  M2.3 map bug exactly — unset is a different state from broken. The check's spend
  joins `admin_ai_spend_today` in the same migration that creates the table, so the
  $3/day cap can see it from the first call.
- **A deleted person's messages stay in the thread** (Alex, M3.1), rendered as "someone
  who left". "Removing a departed member's lines rewrites a conversation other people
  are still reading."
- **Export includes the reports you filed** (Alex, M3.1) — your reason and the date,
  never the moderation outcome, "which isn't mine". The export is read **as you**
  through RLS, never with the service key, so it cannot over-return.
- **The tag list is fifteen, and short is the safe error** (Alex, M3.1). The M2.0 draft
  of twenty was replaced: four of its tags meant nothing outside a ticketed arena, ten
  of twenty were sports or music, and the community third of the product had one slug
  between it. The replacement is four groups of ways-of-being — New here, Company, What
  I'm like, Bring me into — so the same three tags say something at an arena, at a gig
  and at a 9am run. Seeded by `20260921010024_m3_1_seed_tags`; the list and its
  reasoning are `packages/shared/src/tags.ts`.
  - **The length was set by an asymmetry in the schema, not by taste.**
    `person_tags.tag references tags (slug) on delete restrict`, so **adding a tag
    later is an insert and removing one anybody has picked is a data migration.** The
    two directions are not symmetric, so the list is deliberately short. Rewording
    stays free forever either way: the slug is the identifier, the name is copy.
  - **The vibe chips own the night; the tags own the person** (Alex). Anything about
    when you arrive, how long you stay or what you drink belongs to the crew (spec §3,
    "Crew vibe"), not to a person's profile. The draft collided with those nine chips
    in seven places, two of them word for word, and they render inches apart on A10.
    "Always slightly late" survives the rule because early is a plan a crew can make
    and late is a confession only a person can make.
  - **A tag that names the gathering it is read at is dead.** Tags are read only inside
    one gathering, so "sport" at a hockey game is true of nineteen thousand people.
    Taste survives as a handle ("here for the support act"), never as a category —
    which is also what keeps a person's tags from being mistaken for W1's filter chips.
  - **Cut for saying nothing:** "here to meet people", because every person whose
    profile can be read has `open_to_meeting = true` (V1 requires it of both parties),
    so it was true of 100% of the people who could ever see it; and "easy company", as
    unfalsifiable.
  - **Cut for leaking past a gate: "better one-on-one"** (Alex: "the one I'd have got
    wrong"). A tag has no visibility control, but solo does — A28 forces a choice
    between "everyone who opted in" and "women only" with no default, and A29 allows
    only preset lines until a mutual accept, specifically so nobody can make a standing
    1-on-1 approach. A tag reading as a solo signal is a standing approach, on the
    profile, visible to people who never opted into solo at all.
  - **`not-drinking` is the load-bearing tag** — the only one that changes what a crew
    does (where it meets) rather than describing someone. Worth knowing when the list
    is next revisited.
  - **"Up for whatever" is kept knowingly** (Alex): the marginal tag, but "the list is
    now short enough to carry one loose tag, and it's the only thing left that someone
    unsure of themselves can pick without claiming a trait."
  - **Three from one group stays possible, and A3 makes it visible** rather than
    costing a slug: the picker shows the four groups as four labelled rows, not one
    pool, so a nervous first-timer spending all three tags on "I'm new" is a choice
    rather than an accident.
- **Two colour tokens, measured** (Alex, M3.1, on the W1 card's count-and-invitation
  line). `colors.textTint` **#EFE8F6** — a near-white carrying a trace of the brand
  hue, at the same lightness as the plain near-white it replaced (L* 92.9 against
  92.8), on the brand's hue (309° against 313°), at about an eighth of its chroma.
  15.13:1 on the card surface. `colors.accentText` **#A874DB** — the lightest purple
  that is still purple and still passes AA as text on dark (5.33:1 on the card, 5.82:1
  on the page), against `accent` #582883's 1.76:1, which fails outright as text.
  **Neither is ever a link colour**: links on the public pages are lilac #c9a6ee, and a
  different purple inside a card that is itself a link reads as a link within a link.
  Held in reserve rather than shipped (Alex): purple on the count alone, with
  "· see who's going" staying near-white — the better next step if the tint is not
  enough on the phone.

### "Add an event" — filed, not built (Alex, M3.1)

A public form where someone submits a gathering. **Nothing is built yet**; this is the
note so it is not designed from scratch later, and so the two rules below are not
rediscovered as opinions.

**It supersedes "Suggest a gathering is a mailto link. Nothing is stored." (Part 5).**

**Two rules, both Alex's, both hard:**

1. **Nothing publishes without Alex's approval.** A submission is a draft like any
   other and takes the same journey: published, dismissed, or merged into a duplicate.
2. **Nothing can be submitted less than 24 hours before it starts.** A gathering that
   starts tonight cannot be added tonight.

**The approval gate deliberately inverts "automate by default"** (Part 5, "Automate by
default": *wherever possible, AI does the work and Alex removes what is wrong*). For
this one path the order is reversed, and the reason is what a submission is rather than
how much work it is: **it is the first place a stranger writes text that other people
read.** Everything user-generated in Pin'd so far is confined — a first name, a photo
behind an automated check, messages inside a crew that only its members can open. A
submitted gathering is **public text on a public page**: it goes into W1's list, a
crowd page, an OG preview cached at post time, and a Reddit thread. So it is the
obvious vector for someone promoting something that is not a gathering, and the gate is
a gate rather than a queue drained when there is time. **A queue that is usually empty
looks exactly like a gate until the week it isn't.**

**Two questions Alex has left open, to answer when it is built:**

- **Can a submitter create a venue that does not already exist?** That is how invented
  addresses reach a map. Ours is not a generic map: it is drawn from the venue's
  coordinates, and its meeting spots are curated by hand (H5), so an invented venue
  produces a picture of a place that is not there, with no spots and nothing to check
  it against.
- **Can they submit a recurring series, or only a single date?** The series machinery
  exists (M2.3: cadence, the eight-week generator cap, the weekly liveness check), so
  the answer is not "we cannot" — it is whether one submission should be allowed to
  create many rows.

**Four more things to have thought about before it is designed** (Claude, M3.1, filed
with the rest so they are cheap now rather than expensive later):

- **The 24-hour floor wants a ceiling too.** The import looks 8 weeks ahead and M2.3
  found that "a horizon a year out is not evidence". A submission dated next August is
  a different kind of problem from one dated tonight, and only one of them has a rule.
- **Scoring is not moderation, and this is why approval cannot just be the existing
  rubric with a human on the end of it** (Alex, M3.1: "make sure that's on the
  record"). The AI rubric scores drafts 0–100 on *would a crowd form here* — crowd
  size, audience age, people going alone, somewhere to meet, shared identity. That is
  a **ranking** question, and its failure mode is a dull gathering published above a
  good one. "Is this a gathering at all, or an advert, a scam, a rally, or somebody's
  contact details typed into a `name` field" is a **safety** question, and its failure
  mode is a stranger's text on a public page with our name on it. Different questions,
  different failure modes, and a high score is no evidence at all about the second —
  a well-written advert for a timeshare scores well on every line of the rubric. So
  the submission check is its own check, with its own three outcomes and its own
  uncertain state meaning *a human looks*, exactly like the photo check's. Running one
  rubric and reading it as an answer to both is the M2.2 venue-cap shape again: a
  status computed against the wrong fact reads as correct while being wrong.
- **A submission needs a person attached, or there is nothing to rate-limit or block.**
  The link path makes anonymous users, which is fine for a pin and is not fine for a
  write that strangers read. Rate limiting is the practical defence and it needs an
  identity to count against.
- **Approval must happen before a slug is minted**, which the existing publish flow
  already does — worth keeping deliberately, because a slug is what a link preview and
  Cloudflare's cache key are built from, and both outlive the row.

**Where it goes:** most naturally alongside **M4.4** (community sourcing), since a
submitted gathering is community sourcing through a different door — but its gate is
the opposite of M4.4's auto-publishing, and that difference is the point, not an
inconsistency to iron out.

### Decided in Phase 3 M3.1 — later

- **V19: a person's tags ride V1** (Alex, M3.1). Reading somebody's three tags is
  allowed exactly when you can see that person at all — the same rule as their first
  name and neighbourhood, `private.can_see`, no wider and no narrower. Unlike V17, it
  needed no rule of its own: an Instagram handle is a way to contact someone off
  Pin'd, while **a tag is a handle the person chose in order to be read by the people
  on the list with them**, which is what it is for. It picks up the crew and
  connection branches free when H3 adds them, the same saving as V17's two branches.
  **At most 10 in the database, at most 3 of them on the list, at least 3 asked for by
  A3** (Alex, M3.1; the cap was 3 until the tag list was redone at 32 tags): a minimum
  in the database would make a pin impossible on the link path, where a profile is
  deliberately incomplete. `docs/visibility.md` V19 (§12h); harness P74–P77, and P04 inverted.
- **expo-web-browser and expo-auth-session are added to the native module list**
  (Alex, M3.1), joining apple-authentication, image-picker, image, notifications and
  secure-store. **The reasoning, so it is not re-argued:** Google is the most common
  sign-in on Android and on the web, and Supabase's OAuth flow cannot work in the
  native app without an in-app browser session — so dropping it in the app would make
  the platforms diverge for no good reason. Pinned like everything else:
  `expo-web-browser` 57.0.3, `expo-auth-session` 57.0.12, and `expo-web-browser` is
  added to the Expo config's plugins so the redirect comes back through the app's own
  scheme.
- **A 401 says which 401 it is** (Claude, M3.1, after the webhook walk). The
  photo-check webhook's refusal now answers `missing` (no header arrived — the trigger
  or pg_net) or `mismatch` (a header arrived and was wrong — the two halves of the
  secret). Both halves are compared by a **fingerprint** — the first ten hex
  characters of each one's SHA-256 — shown side by side on the admin's Configuration
  panel, so a secret set correctly on one side and mistyped on the other can be
  diagnosed without either value being revealed. **"Unset is a different state from
  broken" needed a third sibling: set on both sides and different.** Until that line
  existed, nobody — not Alex, not the Worker, not the database — could tell those two
  apart, and all of them presented as "the photo is still pending".

### Custom SMTP is required, not optional (Alex, M3.1)

Supabase's **built-in email cannot be used for sign-in**, and the reason is worth
writing down because it looks like a preference and is not.

- **It is the only way to send a code at all.** Supabase refuses to let you edit the
  email templates until custom SMTP is configured, and the default Magic Link template
  sends a **link**. Pin'd sends a **six-digit code** (Part 5, "Identity": no magic
  links, no session cookie), so without custom SMTP the third sign-in method — the only
  one that needs no developer console, and the one the web path leans on — **did not
  work at all**.
- **The built-in sender is capped at a few messages an hour**, which is invisible
  while one person tests and would have bitten on the first real crowd, at exactly the
  moment a queue of people are trying to sign in at once.

**As configured** (Alex, 21 Sept 2026): Resend SMTP, `smtp.resend.com`, sender
**auth@pind.social**, with **its own API key named `supabase-auth`** rather than
reusing the alerts key. The Magic Link template carries `{{ .Token }}`, and a
six-digit code was confirmed arriving on a phone from `pind.social/sign-in`.

**Why a separate key rather than one Resend key for everything.** The two paths fail
differently and are rotated for different reasons. An alerts key that is rotated or
revoked costs us a monitoring gap; **a sign-in key that is revoked means nobody can
get in**, and the two should not be able to take each other down. It also keeps the
blast radius of a leak to one of them.

**The blind spot this creates, stated rather than discovered later.** We now have a
**hard dependency for sign-in that our own health page cannot see**. The admin's
Configuration panel asks Resend whether the sending domain is verified — that check
uses `RESEND_API_KEY`, ours, and covers `pind.social`, which both senders share. It
does **not** and cannot check the `supabase-auth` key, which lives in Supabase's SMTP
settings and never reaches the Worker. So a revoked or expired auth key presents as
*people quietly not receiving codes*, with nothing anywhere saying why.

What would actually detect it is a real sign-in attempt. That is a delivery-monitoring
problem and it belongs with **M3.5**, which builds the notification queue, its retries
and its failure records; the auth email should get the same treatment then rather than
a one-off check bolted on here. Until then it is a known gap, not an unknown one.

### Sign in with Apple: the secret is a JWT, and it lapses (Alex, M3.1)

- **Supabase's "Secret Key" field wants a JWT, not the `.p8`.** Apple's client secret
  is a short-lived ES256 JWT *signed with* the `.p8`: `iss` the Team ID, `sub` the
  **Services ID** (`social.pind.web` — not the bundle identifier), `aud`
  `https://appleid.apple.com`, `kid` the Key ID. `scripts/apple-client-secret.ts`
  mints it locally. **The `.p8` never enters the repo, a chat or a web tool**, and the
  script refuses to read a key from inside the repository — a private key one
  `git add -A` from being published is a different risk from one that is not.
  - One detail that is load-bearing rather than trivia: **ES256 in a JWS is the raw
    r‖s signature, not DER.** Node signs EC as DER by default and Apple answers
    `invalid_client` with nothing saying why, so `dsaEncoding: "ieee-p1363"` is the
    difference between working and an evening. Proved before use against a throwaway
    key: 64-byte signature, verifies, correct claims.
- **Apple caps the secret at six months, and when it lapses the break is partial.**
  **Web** Apple sign-in stops; **native iOS keeps working**, because the native flow
  verifies an identity token and never uses this secret. So the half that still works
  hides the half that stopped — easier to miss, not harder (Alex).
- **Nothing can detect it by asking.** The secret lives in Supabase's provider
  settings and never reaches the Worker, and Apple only refuses it in the middle of
  somebody's sign-in. So the expiry is **recorded** where it is minted — the script
  prints the line — in `APPLE_SECRET_EXPIRES` (a date, not a secret), and watched two
  ways: the admin's Configuration panel shows it, and the 09:00 cron sends one alert a
  day from six weeks out. **Unrecorded is its own state and is also worth an alert**,
  because it is the state in which the warning does not exist.
- **The staging Services ID points at the staging App ID.** `social.pind.web` was
  created with `social.pind.app.staging` as its primary, because `social.pind.app` is
  not registered until M4.3. Changing it, and minting a fresh secret, is in M4.3's
  scope and acceptance — and the acceptance says it out loud, because testing the app
  would prove nothing: native sign-in works either way.

### Sign-in email: which templates, and why a link is not a code (Alex, M3.1)

**A link works on the device that opened it and fails the moment somebody reads the
email on their laptop** (Alex, M3.1, after the walk). That is the whole argument for
the six-digit code, and it is also why the problem hid: testing by tapping the link on
the same phone exercises the one case where a link behaves like a code. Part 5
("Identity") already said no magic links; this is what it costs when the template does
not obey.

**Every Supabase template that can deliver a Pin'd sign-in**, and which flow reaches it:

| Template | When it is sent | Ours? |
|---|---|---|
| **Confirm signup** | the first time an address is seen (`signInWithOtp` with `shouldCreateUser`) | **yes** — A1, every new person |
| **Magic Link** | an address that already exists signs in again | **yes** — A1, every returning person |
| **Change Email Address** | `updateUser({ email })` | **yes** — A27, anonymous becoming permanent |
| Invite user | only the admin invite API | no — never called |
| Reset password | only a password flow | no — there is no password path anywhere |
| Reauthentication | only `auth.reauthenticate()` | no — never called |

All three of ours carry `{{ .Token }}` and the subject "Your Pin'd code" (Alex, 21 Sept
2026). **The first one is the one that hid the bug**, because a brand-new address never
touches the Magic Link template at all.

**Two things A27 must get right, recorded here so M3.2 does not rediscover them:**

- **The email-change code verifies with a different type.** `{{ .Token }}` is the right
  variable, but the code it carries is verified with
  `verifyOtp({ type: "email_change" })`, **not** `type: "email"`. The wrong type fails
  with a message about an invalid token, which reads like the person mistyped it.
- **"Secure email change" sends two codes when there is an old address to protect.**
  For the link path there is none — an anonymous user has no email — so one code
  arrives. Somebody later *changing* their email gets two, and a screen that asks for
  one will look broken.

### The email's own domain has a reputation, and it starts at nothing (M3.1)

Delivered to Gmail, junked by Outlook on the first send. The DNS, read on 21 Sept 2026:

- **SPF** — the root is `v=spf1 include:_spf.mx.cloudflare.net ~all`, which is
  Cloudflare Email Routing and **does not authorise Resend**. That is fine *as long as*
  Resend keeps using `send.pind.social` as the envelope sender, which has its own
  `v=spf1 ip4:…` record. **If a send ever goes out with an envelope domain of
  `pind.social` itself, SPF fails** — worth knowing, because it would look like a
  reputation problem and would not be one.
- **DKIM** — `resend._domainkey.pind.social` is present and signs as `pind.social`, so
  it aligns with the `From:` header.
- **DMARC** — `v=DMARC1; p=none;` and nothing else. Present, aligned, and **giving away
  the two things that help most**: no `rua`, so no reports and therefore no evidence;
  and `p=none`, which Microsoft reads as a domain with no policy.

**What to change, in order:** add `rua` so failures become visible at all; run a week
and read the reports; then move to `p=quarantine` once alignment is proven clean.
Jumping straight to a policy without reports is how a domain silently stops delivering
its own sign-in codes.

### The flag came out (Alex, M3.1)

The city label on W1 is **"Toronto, Canada" as text**, top centre and quiet, and it
carried a small Canadian flag for about an hour. **It is gone, and it is not coming
back as a drawing.**

- **A national flag is the one thing on the page that cannot be approximately right.**
  It was drawn by hand, rendered, and looked at — which caught that it was recognisable
  and did not catch that it was wrong, because "looks like the Canadian flag" and "is
  the Canadian flag" are different tests and only the first one can be passed by
  eye. Checking my own work against my own memory is not a check.
- **We would rather have none than a wrong one**, and the label reads correctly without
  it: the country's name is what carries the meaning.
- **If a flag returns, it comes from an official source file** — a real SVG, committed
  and served from our own origin — never a path typed out by hand. The own-origin rule
  and the no-emoji reason both still hold (🇨🇦 renders as the letters "CA" on Windows);
  what changed is where the artwork may come from.

### The crowd-page button follows the pin, not the session (Alex, M3.1)

Every crowd page's button said **"Open"** after Alex signed in during the M3.1 walk. A
script from M2.1 relabelled it whenever `localStorage` held a Supabase session, on the
assumption that a signed-in person has the app.

**A session says somebody exists. It does not say they are coming to this.** The
assumption was true enough in M2.1, when the only way to have a session was to have
used the product, and it stopped being true the moment the web could sign in.

- **not pinned → "Pin in — I'm going"; already pinned → "See who's going".** The
  button follows what the person has done **at that gathering**.
- **"Open" appears nowhere on the web.**
- Checked rather than assumed: the assumption lived in exactly one place, W2's `#cta`.
  W1's cards, the weekly pager and W3's share card are plain links and never looked at
  a session.
- **The second state arrives with A26** (M3.2), because until the web can pin, nobody
  has done anything at any gathering. The swap is removed rather than left inert: on a
  page with a byte budget, dead JavaScript is not free.
- **How it will work, decided now so M3.2 does not have to rediscover it:** the pin
  writes a **same-origin marker** and the script reads it. Asking the database from the
  page would break the own-origin rule (M2.1 measured 911 ms against 133 ms, paid per
  host), and a cookie the Worker could read at render time would make W2 vary by cookie
  and lose its edge cache.

### Tag slugs are generic, tag words are city-specific (Alex, M3.1)

`new-to-toronto` and `toronto-born-and-raised` became **`new-in-town`** and
**`born-and-raised`**, keeping the displayed words "new to Toronto" and "Toronto born
and raised".

**The slug is the contract and the name is copy** — so Vancouver gets the right words
in an ordinary commit rather than a data migration, which is the whole point of the
city being a row on `cities`. Done the same day the city became a row, and while it was
still nearly free: `person_tags` held three rows, **one of them `new-to-toronto`**, so
it was a real move of real data rather than a rename of something nobody had picked.
Three rows is a move; three thousand is a maintenance window.

### The photo check holds almost nothing now (Alex, M3.1)

**The first real photo through the check was held.** A professional wedding photo —
Alex, clearly the subject, friends behind him — came back `needs_review`: *"Multiple
faces in frame, though one is prominent, ambiguity about which person is the profile
subject."* That is an ordinary photo, and **a check that holds ordinary photos turns
Alex into the bottleneck for every new person.**

**Measured when the rubric changed:** the check had reached **23 verdicts and every
single one was `needs_review`**. It had never approved anything in its life. Two of
the 23 were real photographs; the other 21 were test images so small the model
reported receiving no image at all — which is worth separating, because it means the
rate was part rubric and part degenerate input, and only the first part was the
problem being fixed.

**The rubric now:**

| | |
|---|---|
| **rejected** | nudity or sexual content · hate symbols or racist imagery · gore or graphic violence. **Only those.** |
| **needs a human** | only when the person might be under 19. H8 stands: the check never decides age, it only flags. |
| **approved** | everything else, without exception — group photos, a subject with people behind, cartoons, avatars, no face at all, a landscape, a pet. If somebody wants a funny picture, that is their call. |

**Swimwear and shirtless photos are approved**: they are not nudity, and treating them
as such is part of what made the check hold ordinary photos. The labelled set moves
that case from rejected to approved.

**The copy changed with it, because the promise changed.** "A photo, so people know
it's you" and "your crew looks for a face at a patio table" both overclaimed the
moment a photo needed no face and nothing verified that it was you — copy that says a
photo proves who you are while the check approves cartoons describes a different
product. It is now "A photo" and **"A photo of you makes it easier to find each
other"**: encouragement, not a requirement, and still followed by the line saying one
is needed before meeting anybody.

**Re-judged, per the rule the comedy rubric set** (a rubric change ships with the
re-score of whatever it has already judged, run twice):

- every photo that exists, twice, with the new wording;
- **the wedding photo is approved**, and the reason names the thing that used to hold
  it: *"Wedding photo of clearly adult groom with groomsmen; no nudity, hate imagery
  or age concerns"*;
- **the needs_review rate went from 100% — 23 of 23 verdicts — to 0 of 11**;
- **runs 1 and 2 disagreed on 0 of 11.** That is the noise floor, and it is much
  flatter than the comedy rubric's, which moved individual rows by 5 to 15 points. A
  rubric with three narrow refusals and one narrow hold has far less to be uncertain
  about than one scoring a crowd out of 100;
- $0.055 for the whole exercise.

**The n is small and the rate is not yet a rate.** One real photograph and ten seeded
placeholders is not a measurement of how the check behaves on real photos; it is a
measurement that the change does what it says on what exists. The labelled set is
still owed, and it now exists mainly to catch the check **drifting back** to holding
ordinary photos.

### A guard that never ran looks exactly like a guard that passed (M3.1)

`admin_rescore_photo` exists so a re-judge **never overrules a person**: it moves a
photo's status only when the last decision on it came from `ai:photo-check`. The first
real `--write` **overwrote four photos Alex had rejected by hand minutes earlier**, and
attributed the change to the check.

The cause was one character. The guard found the last decision with
`like 'photo\\_%'` — a doubled backslash, which in a standard-conforming string is a
**literal backslash** and matched nothing, so every photo looked undecided. They were
seed rows, so no real person was affected, and that is luck rather than design.

**Why it went unnoticed is the part worth keeping: a guard that correctly finds
nothing to stop and a guard that never ran report the same thing.** Both say "now
approved". There is no failure to see, no error, no count that moves — the safe path
and the broken path are the same path.

So the fix ships with **P81**, which puts a human decision in front of a rescore and
insists the status does not move, and proves the other half too: a verdict the check
itself made *is* re-judgeable, and a refused rescore is still **recorded**, because
what a rubric change would have done to the photos it was not allowed to touch is
evidence.

**A safety rule with no test proving it fires is a comment.** That is the general form,
and it belongs beside the instrument rule: one is about a check that measures the
wrong thing, this is about a check that measures nothing.

### Apple was built for the web and never rendered there (Alex, M3.1)

**Found after the web walk passed:** `pind.social/sign-in` offered Google and the email
code, and no Apple. Everything behind the button existed — the Services ID
`social.pind.web`, the client secret minted from the `.p8`, `APPLE_SECRET_EXPIRES` and
its 09:00 watch — and a probe had confirmed Apple's 302. **The probe proved the path
existed, not that anyone could reach it.**

**Why:** two gates, both deliberate, both from the plan's "Sign in with Apple on the
web: later". `methodsFor()` returned `["google", "email"]` on the web, and the screen
rendered Apple only when `Platform.OS === "ios"`, because Apple's native button does
not exist on the web. The decision was overtaken by the work — the Services ID was
built for the web — and nobody reversed it where it was written, so the code kept
obeying it.

**Decided:** A1 is three methods everywhere. The web draws Apple's white button by hand
(logo inlined, own origin) and uses `signInWithOAuth({ provider: "apple" })` with a
return to `/you`, the same shape as Google's.

**The table moved to `packages/shared` (`signInMethods`)** for the reason the tag caps
did: `lib/auth.ts` imports React Native, so `node --test` could not load it and nothing
proved what it said. S01–S03 now say it.

**The general form, the third time in M3.1** (after the photo line in the acceptance
list and "exactly 3 tags" in spec A3): **a decision that changes a rule is not done
until the rule is edited where it is written** — in the spec, the acceptance list and
the code that obeys it. A stale rule does not look stale; it looks like the plan.

### Apple and Google as one pair — what each brand allows (Alex, M3.1)

Alex, after Apple reached the web: a white Apple button over a black Google one "look
like two different products stacked". Two looks were built to pick from on the phone,
both inside both brands' published rules — **read from the rules, not remembered**,
because Apple can revoke a sign-in method whose button breaks its terms.

**Apple** (HIG, "Sign in with Apple", custom buttons):
- Styles: white (for dark backgrounds), white with outline (light backgrounds only),
  black (light backgrounds). A **custom** button may change the font, weight and size,
  the corner radius, and add "a stroke to emphasize the button bezel"; the overall
  colour **stays black or white**; logo and title are **both black or both white**.
- Titles only "Sign in / Sign up / Continue with Apple". Logo-and-text buttons are
  rectangular (a corner radius is fine).
- **Logo only from Apple Design Resources; never a custom Apple logo.** Its file's
  height matches the button's; never cropped; no added vertical padding. It may be
  inset to align with other providers' logos.
- The title is **43% of the button's height, "regardless of the font you choose"**.
  Minimum 140 × 30. **No smaller than any other sign-in button.**

**Google** (Sign in with Google branding guidelines):
- Themes: light (#FFFFFF, stroke #747775, text #1F1F1F), **dark (#131314, stroke
  #8E918F, text #E3E3E3)**, neutral (#F2F2F2). Google Sans Medium 14/20 in a 40-high
  button. Rectangular or pill.
- **The G is always the standard full-colour gradient G**, never monochrome, never
  redrawn or outdated, on a light, dark or neutral fill only. Padding 12 / 10 / 12.
- "Continue with Google" is allowed. At least as prominent as other third-party
  buttons.

**Where they meet, and the calls made:**
- **One geometry:** 44 high, 1 px stroke, radius 12, the title 18 px (43% of the 42
  inside the stroke) in the **system font**. Apple's proportion is stated as a rule;
  Google's 35% is a spec of its own button. **Deviations from Google's letter, both
  deliberate:** the system font rather than Google Sans (a web font would cost load
  time and a dependency), and a white title rather than #E3E3E3 in the outline look.
- **The marks share one centre line**: the G at Google's padding, Apple's Medium file
  inset to match.
- **Look 1, "matched":** Apple white; Google in its own dark theme. **Look 2,
  "outline" — picked by Alex on the phone, and the only one kept:** both black (#000 — the Apple file's own background is #000, so the fill
  is exactly black rather than our near-black), both with Google's #8E918F stroke,
  both titles white. Apple's HIG steers its *system* black button off dark
  backgrounds; a custom black button with a stroked bezel is its stated allowance.
- **The files are the brands' own**, unmodified except where `app/assets/signin/README.md`
  says: the Apple Medium logos byte-identical from `Logo-Sign-in-with-Apple.dmg`; the G
  from Google's `signin-assets.zip`, with only the button behind it removed, rendered
  to PNG and compared against Google's own PNG of it.
- **The old Google button broke Google's rules and nobody had noticed**: no G at all,
  and a text-only "Continue with Google" is exactly what the guidelines steer away from.
- In the app, Apple stays **Apple's own system button** (white or black to match),
  framed in the same stroke; only the web draws Apple's button by hand.

### The photo's type is its bytes', and A2 is never a dead end (Alex, M3.1, from TestFlight)

**Found by installing the first TestFlight build:** "We could not upload your photo —
mime type text/plain is not supported", and then no way to clear the photo or carry on.
The web path had worked all weekend.

**The type, one layer below where it looked.** The app checked the picker's label
(`asset.mimeType`, or **"image/jpeg" when there was none** — a guard that assumed the
answer to the question it existed to ask), then uploaded `fetch(file://).blob()`.
Handed a Blob, storage-js sends multipart form data and **drops the `contentType`
option entirely**; the part takes the Blob's own type. The web's Blob carries one; React
Native's does not, and Supabase recorded text/plain. So the checked type was never the
sent type, and the HEIC refusal was reading a label rather than the file.

**Fixed at the source, not by accepting another type:** the type is read from the
file's first bytes (`sniffImageType`), refused there if the check cannot read it (HEIC
by its `ftyp` brand), and **those same bytes go up as an ArrayBuffer**, which is the
path where storage-js sends `contentType` as the request's own header. No label is
consulted. `packages/shared/src/image.ts`; I01 reproduces the drop against the real
storage-js, I02 proves the header the app now sends.

**The dead end.** The photo stayed chosen with no Remove, and every Continue retried
the same upload. The photo is optional on A2 (Q2), so **no photo state blocks Continue,
and every state with a photo offers Remove**; a failed upload is marked failed, says
how to get out, and removing it lets Continue save the profile without one.
`packages/shared/src/a2photo.ts`, which the screen renders from; A01–A04.

**Recorded in M3.1's acceptance:** A2's photo path is walked on both platforms. The two
pickers differ in exactly the way that mattered, and only an installed build shows it.

### The harness, an unreadable photo, an empty eval, and the link proved (Alex, M3.1)

- **The live check no longer judges the harness's people.** `test:policies` went red
  (P23, P46): the webhook approved Eve's "pending" photo mid-run. Every harness user is
  now marked in `app_metadata.pind_harness` — writable only by the service key — and
  both the trigger and the 09:00 sweep (`admin_photos_waiting`) skip them. A skipped
  photo stays pending, which is hidden, so the skip can only keep a photo unseen.
  **P82 was run against the old trigger first and failed on exactly "the live check
  judged a harness user's photo"**, then passed after the migration; it also proves the
  sweep takes the same row once unmarked. P83: a session cannot mark itself.
  *My own instrument error on the way:* `npm run test:policies | tail` reported
  `tail`'s exit code, 0, over a run that had failed. The run is now read from its own
  exit code.
- **An unreadable photo is a failed check, not an approval.** "No image at all" is not
  "no face". The model has a fourth answer, `unreadable`, which is not a verdict: it
  is recorded as `failed` with the model's reason (H02b).
- **The eval refuses to score what is not there.** An empty set printed "agreed on 0 of
  0" and exited clean; a missing file was a quiet skip that the totals still counted.
  The set is now checked whole before any call (empty, missing, duplicate, unreadable,
  unknown outcome — every problem listed), and a run where any photo got no verdict
  exits 1 after printing its numbers (E01–E06).
- **Anonymous → permanent, proved as far as a harness can** (for M3.2). P84: an
  anonymous pinner made permanent keeps the same user id, and the person, the pin, the
  party size and the opt-in survive and stay editable under the refreshed token. P85:
  the app's own `updateUser({ email })` from an anonymous session is accepted and
  moves nothing while the code is outstanding. P86: `linkIdentity` for Google and Apple
  — **red until "Allow manual linking" is switched on in Supabase Auth**, which is
  exactly what it is there to say. Not provable here: entering the code
  (`verifyOtp({ type: "email_change" })`), which needs an inbox, and the OAuth round
  trip, which needs a browser — both walked in M3.2.

### The second TestFlight walk: five faults, and why the tests missed the tag ones (Alex, M3.1)

- **Tag limits.** Continue worked with no tags, and the eleventh tap looked like nothing.
  **The tests passed because they proved functions the screens did not use.** Both
  tag screens gated on their own expression, `picked.length > 0 && !enoughPicked(picked)`
  — a "none is fine" exception T09 never saw. The eleventh-tap sentence *was* produced
  (T03), and shown in a notice above all 32 chips, off-screen from the tap. Fixed: one
  rule, `tagsCanContinue` (three to ten; leaving with none is "Skip for now"), with a
  sentence under a disabled Continue; a message on the tap that reaches ten; the
  picker shows its own note under the group that was tapped. **And the gap itself is
  now tested:** `tests/unit/screens.test.ts` reads the route files and fails if a tag
  screen gates on anything but `tagsCanContinue` — run against the old screens it
  failed on exactly this. The general form: **a test of a rule proves nothing about a
  screen that does not call it.**
- **The keyboard and the missing Profile header — one cause.** Every screen drew its
  own frame; Profile forgot the header, and no scroll view knew about the keyboard. Now
  one shell, `AppScreen` (header first, `automaticallyAdjustKeyboardInsets`, taps land
  with the keyboard up), and S11/S12 fail the build if a route draws its own
  SafeAreaView or ScrollView. Both failed against the old screens.
- **The app's Apple button.** Not a deliberate change of mine in the sense Alex saw: the
  app used Apple's **system** button, which centres its logo and scales it with the
  button's height. When the pair went from 52 to 44 high (deliberate: Apple's default
  height and the 43% title rule), the system logo shrank with it, and it could never
  sit on the web's centre line. The app now draws the same custom button as the web,
  with Apple's own logo file — the HIG's stated allowance for aligning logos across
  providers.
- **Cross-platform restore.** Not identity: **every sign-in landed on A2, and A2 showed
  a blank form to a person who already had a profile.** A2 now asks first; somebody who
  finished it goes home (A05), a link-path pinner arrives with their name filled (A06).
- **"That code has expired" with no code in play.** Any message containing "invalid"
  became that sentence — including a stale session. Now the sentence depends on the
  step, only entering a code can say a code expired, and a stale session is cleared
  locally and named as what it is (S05–S07).

### Nothing waits on the photo check (Alex, M3.1)

**A photo shows from the moment it is uploaded, to exactly the people who can see its
owner (V1), unless it is `rejected`. The check runs afterwards and can only remove.**
The industry pattern is Meetup's and Discord's — post, then moderate by background
scanning and reports — not Hinge's.

**Why:** before, a photo showed only once `approved`, so every pipeline failure — a
broken webhook, an unset key, a model that errored, a flag waiting on Alex — meant
**"invisible, and nobody knows"**. Now it means **"unchecked, and counted"**. Nobody is
ever stuck invisible because a pipeline broke.

**The check stays, narrowly:** nudity, hate imagery and gore rejected; a possible minor
flagged to Alex. It is built, it is half a cent and 2.9 seconds, and a product with
user photos and in-person meetings should not have no automated scan at all — App
Review looks for one under 1.2.

- `needs_review` is **"visible, flagged for Alex"**; `pending` means "not checked yet",
  no longer a hiding state. `can_see_photo` asks `<> 'rejected'` instead of
  `= 'approved'` (migration `…_m3_1_nothing_waits_on_the_check`). P23, P46 and P71 were
  inverted and **run red against the old rule first**; P87 proves a rejection removes a
  visible photo and a flag does not; P88 proves the app's preview rule and the
  database's agree on every status.
- **The owner is never told about a possible-minor flag.** Two reasons: it tells anyone
  gaming the check exactly what trips it, and the flag is a note to Alex rather than a
  verdict about them — the same family as H9 keeping an auto-hide quiet from a
  reporter. A21 tells the owner one thing only: a rejection. There is no "checking"
  state to show.
- **The sweep is hourly** (Alex): free when nothing is waiting, and it caps the worst
  case — a photo that will be rejected, visible while the webhook is broken — at an
  hour rather than a day. The credential watch still runs once a day, on the 09:00 run.
  **The scheduled handler had a trap:** any cron it did not recognise fell through to
  the Ticketmaster import, so the new hourly string was one typo from running the
  import every hour. Routing is now `jobsFor` in `src/cron.ts`, where an unknown cron
  runs nothing (C03), and C04 compares `wrangler.jsonc`'s triggers with the code's.
- A22 no longer checks `photo_status === "approved"` itself — a second copy of the rule
  that went stale the day this changed. The database decides, alone (H11).

### Six photos — considered, not built (Alex, M3.1)

Alex asked what up to six photos would cost. **About 9–12 hours**:
- **Schema and V6, ~5 h:** photos move to their own table (person, path, position 1–6,
  status), a cap of six, `can_see_photo` per object against it, the storage policies
  and every photo case in the harness (P07, P07b, P21, P23–P26, P46, P71–P73, P81, P82,
  P87, P88) rewritten.
- **The check, ~1.5 h:** the webhook, the sweep, the admin queue and the rescore guard
  become per photo.
- **The app, ~3–4 h:** A2 stays one photo; A21 adds, removes and reorders up to six, and
  its preview shows them; A22 swipes through them; export includes them all. The list
  and a crew card show the first photo only.

**Not now, and not for the cost** (Alex): six is Hinge's number, and A21 says *no
followers, no grids, no bio*. A profile with six photos is a different product — the
one H2 exists to avoid. **Revisit after the first real crowds**, when it is known
whether one photo is actually the problem.

**Priced three ways** (Alex asked what it costs if only the first photo is checked):

| Version | What is built | Hours |
|---|---|---|
| **A. Every photo checked** | the photo table, V6 and storage policies per photo, every photo case rewritten, and the webhook, sweep, admin queue and rescore per photo; the app | **9–12** |
| **B. Only the first checked** | the first photo stays on `people.photo_path` with its whole pipeline untouched; the extras in their own table, visible exactly when their owner is; their harness cases; the app | **6–8** |
| **C. Extras through the same check** | B, plus a trigger on the extras, verdicts recorded by path, a rejection removing that one image — no new states, no new queue | **8–11** |

The cost is mostly **not the check**: it is the app (A21 add, remove and reorder, the preview, A22 swiping, export — about 3–4 h in every version) and visibility for a new kind of stored object (about 2–3 h). The check is 0 h in B, about 2 in C, about 2.5 in A. **The two things that decide it:**
- **B is a hole in the only automated scan we have.** Pass a clean first photo and put anything behind it; with nothing waiting on the check it is visible from upload; and at App Review "we scan photos" (1.2) would be false for five in six of them.
- **C's upper hour is the possible-minor question.** A flag found on an extra is about the *person*, and the check never decides age (H8), so it must still reach Alex's queue under the person's name — removing the image is only the easy half.

Any version is milestone-sized, not a small thing.

### A bio is a V17 bypass, and so is any free text a stranger can read (Alex, M3.1)

Asked whether profiles are thin for lack of photos or for lack of anything to read, the
cheaper answers were priced, and two are refused **by rule, not by taste**:

- **An "about you" line — no.** Not because A21 says "no bio", but because **free text
  a stranger can read is a way round V17**: "insta @foo" in a bio puts a contact handle
  on the open "going & open to meeting" list, which is exactly the cold-DM path H2 and
  V17 exist to close. **The general rule: any free-text field a stranger can read is a
  V17 bypass unless it is filtered** — for handles, phone numbers and links — and the
  filter is part of the field's cost, not an afterthought.
- **Making the Instagram handle prominent at the deciding moment — no.** That moment is
  the list and A22, before any crew, and V17 allows the handle only to crewmates, a
  1-on-1 partner and connections. Showing it there reverses V17 rather than styling
  something. On the crew card, where it is allowed, prominence is an M3.3 design call.
- **Which gatherings someone has been to — no.** A stranger seeing a pattern of where
  somebody goes is new visibility, against Part 4. **A count** is fine, and is in.
- **What is in**, in M3.2's A22 (build-plan §8): the shared context, all the tags grouped,
  and the gathering count — 2–3 h inside work happening anyway. The "showed up" badge
  follows with M3.3's confirmations (about 0.5 h to show), and is zero for everyone
  until crews have met, so it helps later rather than at launch.

### P86: what refused, found without the dashboard (M3.1)

Alex's screenshot showed **Allow manual linking** on for PIND-staging, and P86 still
failed. Diagnosed from the server's side rather than by toggling again:

- `linkIdentity` calls `GET /auth/v1/user/identities/authorize` with the session's
  token. The reply, for Google and for Apple alike, was **`404` with
  `error_code: manual_linking_disabled`** from GoTrue v2.197.0 — and in GoTrue that
  code comes from one guard that reads one thing, the server's
  `security_manual_linking_enabled`. So the message was not misleading and the test was
  calling the right thing.
- **`npx supabase config diff`** (read-only, through the Management API) lists every
  hosted auth field that differs from `config.toml`. The repo's file says
  `enable_manual_linking = false`, and the diff does **not** list it — so the stored
  hosted value is `false` too. Two independent reads agree: off.
- So the dashboard's toggle state was not what the project held. Alex toggled it off,
  on and **saved**; then `config diff` listed `enable_manual_linking` as hosted `true`
  against the repo's `false`, and P86 passed. The screenshot had proved what the page
  showed, not what was stored — the same one-layer-down gap as a server response
  against a phone.
- **It cost three round trips, and Alex was certain it was done.** The same shape will
  recur with any provider or dashboard setting that is not visible from the repo: the
  page shows a state, the person who set it remembers setting it, and only the thing
  that enforces it knows. So the rule went into CLAUDE.md beside the instrument rule:
  **when a setting is in dispute, read it from the thing that enforces it, not the
  thing that displays it.**

The diff also shows `sms.twilio.enabled: true` on the hosted project. **Nobody set
that:** it is the default showing in Supabase's unused SMS-provider dropdown, and the
auth server's public settings report `phone: false`, so no SMS method is enabled and
there is nothing to turn off. It is not the stack rule ("no SMS, no Twilio") being
broken. Worth knowing only because "Twilio is set as the SMS provider" reads like a
configuration somebody made.
