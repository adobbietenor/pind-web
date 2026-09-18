# Pin'd — product decisions

These are binding product rules, not suggestions. They come from the design board
and the research assessment. If an implementation seems to require breaking one,
stop and ask — do not work around it.

Last updated: 18 September 2026 (Phase 1 M1.3).

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

---

## Part 2 — The eleven UX calls

Each shows the call as designed and the alternative, if it is ever revisited.

### Q1 — How +1 friends exist
**Call:** A pin carries `party_total` (1–10; UI: alone / +1 / +2 / a group) and
everyone in it counts instantly toward "N pinned" (displayed as "Dev +1"). A +1 has
consented to nothing: they never count toward "open to meeting" or the threshold of
5, and never appear in the reciprocal list until they claim the share link (T10) —
first name and 19+ confirmation only, no account. Crews show "+1 friend" until claimed,
and a +1 occupies a seat: a member with a +1 takes 2 of the 8.
**Alternative:** force every attendee to pin individually. Cleaner data, but it taxes
the organiser and undercounts real groups.

### Q2 — Photo policy, web vs app
**Call:** Test 0 accepts a photo **or** an Instagram handle (T3) — a hard photo step would
halve conversions from a Reddit tab. The app hard-requires a face photo (A2), because
crews look for faces at a patio table.
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
**Call:** one field at pin-in, **email or phone, either works** (T3). SMS converts better
on a Thursday evening; email feels safer to give to a link from Reddit.
**Alternative:** require phone. One channel to build, higher form abandonment.

### Q9 — WhatsApp group shape (Test 0 only)
**Call:** **one group per gathering**, created at threshold, link visible only from the
pinned crowd page (T6). A separate **women-only group opens at 3+ eligible people
opted in** — `gender = woman` plus nonbinary people with `include_in_women_only`. The
same set decides the trigger and who can join (H7); otherwise the product either opens
a group three eligible people can't fill, or fails to open one for three who qualify.
The offer is shown to eligible people **without a number** — next to the public mix, a
total would reveal how many nonbinary people opted in (Phase 1 M1.1).
**Alternative:** a group per crew. Better dress rehearsal for the app, worse critical mass.

### Q10 — Ordering the crowds list
**Call:** **by date, always** (T9, A7). The calendar is the algorithm. Small counts are
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

## Part 4 — Data deliberately not collected

Device location, contacts, phone numbers (until OTP is ever needed), surnames beyond
an initial, ticket or seat data, message content for any purpose beyond delivery and
moderation, advertising identifiers, third-party ad or attribution SDKs, employer,
school, sexual orientation. Tags are not collected in Test 0 (app only).

Collected with a stated purpose: **self-declared gender** (woman / man / nonbinary /
undisclosed), a protected attribute. Its purpose — women-only crews and groups, and
the aggregate mix chip — is stated in the privacy policy. It is never exposed on a
profile.

## Part 5 — Implementation decisions

- **Test 0 identity.** Web visitors use Supabase anonymous sign-in, so every session
  has a real JWT and RLS applies identically to web and app (H11). The Worker uses
  `service_role` only for admin, cron, the Ticketmaster import and the AI discovery run — never to read
  people on behalf of a visitor. `people.auth_user_id` stays nullable.
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
- **Contact details** (email / phone) live in their own table, never on the person row.
- **Product domain: pind.social** (Alex, Phase 1 M1.1). Crowd pages, share links and
  emails use it. PindScene.com redirects to it once it is live. The domain is bought
  but not yet set up in Cloudflare or the Worker. The switch happens at M1.6
  (threshold email) or the first public crowd page, whichever comes first. No work
  on it before then.
- **Gathering sourcing** (Alex, Phase 1 M1.2). Gatherings are not typed in by hand.
  They arrive as **drafts** from three sources: a nightly Ticketmaster Discovery API
  import (M1.3); a weekly AI discovery run — Claude with web search — for free and
  non-Ticketmaster events such as festivals, markets, run clubs and club nights
  (M1.4); and manual entry, as a fallback only. AI vets and scores every draft with a
  one-line reason. Alex publishes a handful per week with one click. **Publishing
  selectively is deliberate: pins must concentrate so crowds reach 5.** A draft is
  published, dismissed or merged into a duplicate found by another source; an
  importer never changes a gathering's status, and a dismissed or merged event is
  never re-created by a later import.
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
  (name, date, venue, counts) is kept for Test 0 metrics.
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
  below **40** after the distance adjustment are collapsed in the queue (to be tuned
  after the first real run). Only new drafts are scored; a failed score leaves the draft
  unscored and it is retried next run. **Hard AI spend cap: $3 per Toronto calendar day.**
- **AI spot suggestions** (Alex, Phase 1 M1.3). Sonnet 5 with web search proposes 3
  public, staffed spots (bars, patios, landmarks) a short walk from the entrance, each
  with an address, a one-line reason and the page it checked. Only for venues with fewer
  than 3 active spots, no pending suggestions, and an upcoming draft scoring 40+; at most
  **10 venues per night**. Alex approves each one (the curated-spot rule above).
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
  free during Test 0. **Any paid feature, ad or sponsorship later needs a review of
  these terms first.**
- **A privacy policy exists before public pages go live** (Alex, Phase 1 M1.3). It
  covers Ticketmaster data, the automated photo checks and gender. Ticketmaster's
  terms also require the policy (or a footer on every page) to say how we collect,
  use, store and disclose data.
- **Meeting spots stay curated** (Alex, Phase 1 M1.2). AI proposes 3 spots per venue;
  Alex approves or edits each one before it exists. **A gathering cannot be published
  until its venue has 3 approved spots** — enforced in the database. At publish the
  spot poll gets the venue's first 3 spots, each defaulting to start time minus 60
  minutes, editable.
- **Unpublishing** (Alex, Phase 1 M1.2) is allowed only while a gathering has zero
  pins. Enforced in the database.
- **Pin-in button for free events** (Alex, Phase 1 M1.2). Ticketed gatherings keep
  "Pin in — I've got a ticket". Gatherings with `is_free = true` use **"Pin in — I'm
  going"**. The crowd-page milestone implements it.
- **Admin CSV export** (Alex, Phase 1 M1.2) has one row per pin and never includes
  contact details or gender.
- **Venue map images are public** (Alex, Phase 1 M1.2), in their own public bucket
  `venue-maps`, uploaded by admin only. They show a public building and its public
  spots, never a person (H1). Pin photos stay private (V6).
- **Automated photo moderation** (Alex, Phase 1 M1.2; built in the T3 pin-in
  milestone). On upload, an AI check (Claude vision, via the Anthropic API key,
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
  harness case.
