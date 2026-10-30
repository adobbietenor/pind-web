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
  // UI pass 1 (023): above the button, then the small line below it. "Nobody has yet…"
  // is gone; the counters above already say how many are open.
  notOpenLine:
    "If you're open to meeting people in person before, during or after the event, tap the button below to start chatting and making plans.",
  openToMeeting: "I'd like to meet people here",
  // What it's for, not what it asks (Alex, M3.2 walk, on A26's confirmation — the same
  // principle here).
  openToMeetingHint:
    "You'll set up a quick profile and join a room with everyone else who wants to meet. You can switch it off at any time to hide your profile.",
  // Pinned and open.
  listHeading: "Open to meeting",
  // UI pass 1 (055): the Meeting Room is the main card. "N in the room" rather than the
  // drawn "here right now": the count is who is in the room, not who is looking at it (H6).
  roomKicker: "Main room",
  roomTitle: "The Pin'd Meeting Room",
  roomCount: (n: number) => `${n} ${n === 1 ? "person" : "people"} in the room`,
  roomSayHi: "Say hi",
  seeAll: (n: number) => `See all ${n}`,
  listEmpty: "Nobody else has said yes yet. You're the first. They'll appear here as they do.",
  turnOff: "Stop being open to meeting here",
  turnedOff: "You're still going, just not on the list.",
  // Not pinned (A8).
  pinIn: "Pin in",
} as const;
