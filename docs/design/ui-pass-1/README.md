# UI pass 1: Alex's screen review (30 Oct 2026)

Alex walked all 116 current screens (`screens/INDEX.md` on branch
`design/screens-current`) on a design canvas, commented section by section, and
approved the proposed mockups. This folder is the spec of that review.

- `mockups/S1-proposed.png` … `S10-proposed.png`: the approved future state, one
  board per section, each frame labelled with the screen number and ID it replaces
  (e.g. `055 · A9 · PROPOSED`). The `.html` beside each is the same board as markup,
  for exact copy, spacing and colours.
- The "before" for every number is `screens/NNN-*.png` on `design/screens-current`.
- Where this file and a mockup disagree, this file wins (some comments came after
  the drawing).

Copy in the mockups is final unless marked as a placeholder (names, counts, venues,
messages are placeholders).

## Rules that apply everywhere

1. **No em dashes in any copy**, app or Worker. Use a period, comma or colon.
2. **House rules is one collapsed row**, closed by default, everywhere it appears.
   Any text under the house rules box is removed.
3. **We don't engineer meeting places.** Remove every line about where people meet
   ("Squads and 1-on-1s meet at the event itself or a public spot near it…", "Where
   crews meet", "the spots crews meet at"). Place and time stay possible, as optional
   extras, never the lead.
4. **"Crew" is gone.** Squads, rooms, 1-on-1. (Also in the findings list.)
5. **Counters are two stacked lines with icons**: person icon "37 going", handshake
   icon "14 open to meeting" (or "Nobody open to meeting yet"). Every crowd page state.
6. **The crowd page (055) is the reference layout.** Squads, women-only and the
   night-of page follow it; don't invent a second style.
7. **No personal name, no address, no "Tenor"** in anything public. Legal pages name
   the operator once as "Tenor Investments (dba Pin'd)"; contact is
   `privacy@pind.social`.
8. Plain "tap", not "click". Touch targets at least 44 px.

## By section (screen numbers from screens/INDEX.md)

### 1 · Public web pages (Worker)
- **005/006 W2 crowd page**: title, then the one line (date · venue) always visible.
  Everything else (address, description, Learn more, house rules, how the room
  works) behind one "Details" toggle, closed by default. Then "Who else is going?" +
  status line, then **Pin in · I'm going** directly under it, then a **"Spots
  nearby"** placeholder (quiet empty state "Nothing listed near here yet.") replacing
  "Where crews meet", then the map at the bottom with "Open in Maps".
- **006 ended**: same layout; no Pin in, no "1 more and the room opens". "This
  gathering has finished." + "N people pinned in." + "See what's on this week".
- **009 W3 share card** becomes a venue card: title, date · venue, address, map,
  "Open in Maps" button, "19+ · leave any time". No meeting spot or time.
- **015–017 About / Privacy / Terms**: rule 7. Terms must stop saying "once 5
  people… small crews".
- 001 and the rest of section 1: fine for now.

### 2 · Link path (A26, A27, A5, A9)
- **019/020 quick pin**: "Already on Pin'd?" is a larger bold line with the Sign in
  button, no subtitle.
- **022 A5 Home (anonymous)**: the profile offer moves to the bottom, above the tab
  bar, about half the space under the city list: "No profile needed to pin in." then
  three icon lines (pin: "Pin in to any event. Free, no profile." / person: "Meet the
  crowd. See who's going and join the room. Needs a quick profile, about 2 minutes."
  / handshake: "Meet one-on-one. Opt in separately, only when you want to.") and a
  full-width **Set Up Your Profile** button with a person icon.
- **023 A9 pinned, not open**: counters per rule 5. "You're going" box copy:
  above the button "If you're open to meeting people in person before, during or
  after the event, tap the button below to start chatting and making plans." Below
  it (small) "You'll set up a quick profile and join a room with everyone else who
  wants to meet. You can switch it off at any time to hide your profile." Remove
  "Nobody has yet…".
- **024–026 A27 step 1**: "Already on Pin'd?" shows here only in the short form
  (bold line + Sign in); it is gone from every later step. Date of birth is three
  dropdowns, Month / Day / Year (native wheel on iOS; years start at the youngest
  allowed age). Remove "We keep the year and throw the rest away" (privacy policy
  still says what is kept). "women-only crews" → "women-only rooms".
- **027/028 A27 step 2 splits into two pages**:
  - Page 1 "Where in the city?" + "Pin'd never asks where you are. Pick the part of
    town you'd say you're from." Single choice. Next, disabled until one is picked.
  - Page 2 "A few things to say" + "Pick a few conversation starters just for fun."
    and in bold **"Pick at least 3, up to 10."** with a live "2 of 10" count. Next
    disabled until 3. An 11th tap does nothing (existing `tagsCanContinue` rule).

### 3 · Signed out and sign-up (A1–A3, A21)
- **038 A21 Profile signed out**: same bottom block as 022, plus a short "Already on
  Pin'd? Sign in" row.
- **041–046 A2/A3**: same changes as A27 step 1 and step 2 (they share components).

### 4 · Home and lists
- **049 A19 empty**: "You haven't Pin'd in to any events yet!" + "Check out this
  week's crowds and events. When you tap **Pin in, I'm going**, the event and
  everyone else going will show up here." + "See this week's crowds".
- **050 A20 empty**: "No connections yet" + explanation + "How it works" 1-2-3 +
  "Find an event" (copy on the mockup).

### 5 · Crowd page and room (A9, A10)
- **055 A9** (reference layout): counters; the **Pin'd Meeting Room** is the main
  card, solid purple, "6 people here right now", avatars, white "Say hi"; clearly
  different from the squad boxes. The "Open to meeting" list is tappable people; anyone
  with 1-on-1 on has an "Open to 1-on-1" tag. **No separate 1-on-1 box.** Remove
  "up to 8 in each". House rules collapsed.
- **Tapping a person** anywhere (crowd list, room faces) opens their profile sheet
  (075): photo, first name, area, conversation starters, "Let's meet up 1-on-1" if
  they're open to it, "Say hi in the room", Report, Block.
- **056–062 A10 room**: WhatsApp-style group chat (057 mockup): header with stacked
  avatars, "Pin'd Meeting Room", "Event · N here", info button (house rules live
  there); faces row; date and join pills; bubbles left/right with times; opener
  chips above the bar. **The message field and Send button share a centre line and
  height; text vertically centred**; the field grows upward, Send stays at the bottom.
- "Enough to go together" only at exactly the threshold it describes (findings).

### 6 · Squads (A11–A15)
- **064/065 A15 start a squad**: Name (required), Details (optional free text),
  "Add a place" / "Add a time" (optional, each one plain text field, removable). No
  time pills, no 15-minute slots. Start squad enabled once there's a name.
- **069 A15 squads list**: 055 style; "Squads" + "+ Start a squad"; cards lead with
  name and details, member circles, count, Join. Place/time only if set, one grey
  line. Your squad: purple outline, "Open chat". Women-only: small pink tag.
- **071 A11 squad page**: header with member circles, name, "Squad · 3 of you ·
  Event"; the details; plan as one line ("No plan yet · add a place or time"); then
  the chat in the 057 style.
- 086/087 (night of, "I'm here"): same styling.

### 7 · 1-on-1 (A28, A29, A20)
- **073 A28**: when someone taps "I'd like to meet people here", one sheet "How do
  you want to meet?": "The room and squads" (always on) and "1-on-1 chats too" (a
  switch, off by default, one-line explanation). "You can change this any time from
  your profile." No separate 1-on-1 section or opt-in screens on the crowd page
  (072–074 go).
- **075/076 A29**: the request lives on the profile sheet. "Let's meet up 1-on-1" →
  "Request sent ✓, You'll see Priya's reply in Connections."
- **077 A20**: requests arrive in **Connections** under "Requests" (tab dot), Accept /
  Not now. "Not now" is silent to the sender. Then "1-on-1 chats", then "Kept
  connections".
- **079 A29**: accepting opens a plain chat. First line "You're both pinned in and
  open to chatting. Say hi!" Place/time is one optional "Add a place or time" row;
  either person can add it, nobody confirms. The suggest / wait / agree screens
  (078, 080–085) go.
- Collapse long explanations into a closed row. No em dashes (many here today).

### 8 · The night and after (A9, A16, A17, A20)
- **088 A9 tonight**: exactly 055 plus a "Tonight" tag, "Starts at…", a third counter
  "N here now", and one "I'm here" switch row (073 switch style, left-aligned).
- **089/102 A9 ended**: "Ended" tag; one counter "4 people went"; Meeting Room card
  grey "Meeting has ended" with "View chat"; then "Who did you meet?" and "Find your
  next event". No going/open counters, switches or squads.
- **092 A16 who did you meet**: soft rounded person cards (face, name, where you
  crossed paths: squad / 1-on-1 / room), each with its own **Keep in touch** button →
  "✓ Sent". Already connected shows "Connected". Not the black blocks of today.
- **095 A20**: the other person gets the request in Connections → Requests ("Jordan
  wants to keep in touch · You met at …", Accept / Not now), the same card as 1-on-1.
  Accepting makes a kept connection on both sides.
- **097/098**: the question becomes optional "How was it?" with three taps (Great /
  Okay / Not for me), no text box; Done works without answering.

### 9 · Women-only
- Same screens as 055 / 057 / 073 with a soft pink accent: an extra "Women-only room"
  card on the crowd page for women who switched it on; the room has a pink "Women
  only" tag, Leave in the info menu with a small confirm sheet; Settings puts "Open to
  1-on-1 chats" and "Women-only rooms" together under "How you meet".

### 10 · My Events, profile, settings (A19, A21, A22, A23)
- **107/108 A19 My Events as a chat list** (WhatsApp inbox): one row per event (date
  badge, bold name, last-message preview, time, unread count), grouped Tonight /
  Coming up / Past; your squad as its own row under the event; "Live" tag tonight;
  quiet status line when there's no chat yet; past rows greyed "Meeting has ended ·
  4 people went", only the latest shown with "Show all past events". Filter chips All
  / Unread / Squads. No explanation text.
- **Instagram stays a plain optional handle** (never "connected" or "verified"),
  visibility unchanged (V17).
- **Bio**: Alex asked for one only if it doesn't fundamentally change the build. See
  open question 3.

## Behaviour changes (need the plan-first step)

These change lifecycles or who-sees-what, so per CLAUDE.md they are explained and
approved before code:

- **A. 1-on-1** (section 7): opt in by switch, request from the profile, requests in
  Connections, accept opens the chat, place/time optional with no confirmation step.
  Replaces the pair → suggest → plan states from #17.
- **B. Keep in touch** (section 8): a one-sided request and accept, replacing the
  mutual-tick match.
- **C. Squad form** (section 6): free-text details, place and time instead of the
  spot list and time chips.
- **D. Bio** (section 10), if approved.

Free-text place (C, and A's "Add a place") may conflict with the hard rules about
meeting at public spots. If it does, say so before building; don't work around it.

## Open questions (default in brackets if Alex doesn't answer)

1. "Up to 8 in each" is removed from the copy. Does the squad cap stay? [Cap stays;
   a full squad says "This squad is full."]
2. Should "Not now" on a request ever tell the sender? [No, silent.]
3. Bio: optional ~140 characters, checked like squad names, shown on the profile
   sheet to the same people who can see the photo? [Ask Alex before building.]
