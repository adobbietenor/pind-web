// A8 / A9 — the crowd page in the app: its words, in one place (M3.2).
//
// One route, three states, by what YOU have done at this gathering:
//   not pinned            A8: the facts, the counts, "Pin in".
//   pinned, not open      A9's empty state — the most important empty state in the
//                         product (Alex): they have committed and see counts and no
//                         faces. It must read as ONE STEP AWAY, not a locked door, and
//                         "open to meeting" is the most prominent thing on it.
//                         **PROPOSED COPY — agreed with Alex before the screen is done.**
//   pinned and open       A9: the people the database lets you see (can_see_at works
//                         at two — nobody waits for five to see a face), then the
//                         crews line while it is worth saying.

export const CROWD_COPY = {
  // Pinned, not open — PROPOSED, for Alex.
  notOpenHeading: "You're going",
  notOpenLine: "Say you'd like to meet, and you'll see everyone else here who has — their first name and photo. They see yours only then too.",
  notOpenOthers: (open: number) =>
    open === 0 ? "Nobody has yet — you could be the first." : `${open} ${open === 1 ? "person has" : "people have"} said yes so far.`,
  openToMeeting: "I'd like to meet people here",
  openToMeetingHint: "A photo, your date of birth and a way to sign in, the first time. You can turn it off any time.",
  // Pinned and open.
  listHeading: "Going & open to meeting",
  listEmpty: "Nobody else has said yes yet. You're the first — they'll appear here as they do.",
  turnOff: "Stop being open to meeting here",
  turnedOff: "You're still going, just not on the list.",
  // Not pinned (A8).
  pinIn: "Pin in",
} as const;
