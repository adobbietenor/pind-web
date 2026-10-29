// The night and after (M3.3): A16's ticks, A17, the after-event question, A20's
// connections and invite, and "women-only rooms only". The rules are in the database
// (V23, docs/visibility.md §12i); these are the words.
//
// PROPOSED — Tatiana's doc replaces it (S25).

export const AFTER_COPY = {
  heading: "After the night",
  whoDidYouMeet: "Who did you meet?",
  tickHint: "Tick anyone you met. They'll only know if they tick you too.",
  weMet: "We met",
  ticked: "Ticked — they'll only see it if they tick you too",
  matched: "You met",
  keepInTouch: "Keep in touch",
  keepTicked: "Asked — you'll be connected if they want to keep in touch too",
  connected: "Connected — they're in your Connections",
  closed: "This closed a week after the night.",
  takeBack: "Take back",
  // Alex: gently, no implication anybody failed — they said they'd like to meet, and
  // we're asking how the night went.
  question: "Would you have gone alone anyway?",
  answers: [
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
    { value: "wasnt_going", label: "I wasn't going to go at all" },
  ] as const,
  questionWhy: "One question, so we know whether Pin'd helps anyone get out who wouldn't have.",
  // #10 (Alex, 14 Oct 2026): optional, sent with the answer, read by its author and by
  // people at Pin'd only. Since 29 Oct picking an answer does not send it: Send does, with
  // the comment. PROPOSED copy for the three lines below (Tatiana's to reword).
  commentLabel: "Anything else you'd like to tell us?",
  commentHint: "Optional. It's sent with your answer, and only people at Pin'd can read it.",
  send: "Send",
  pickFirst: "Pick an answer above, then Send.",
  thanks: "Thank you — that helps.",
  nothing: "Nothing to do here — this is for people who said they'd like to meet.",
  notYet: "This opens once the night is over.",
  // A17
  finished: "This gathering has finished.",
  finishedCounts: (members: number, arrived: number) =>
    `${members} in the group · ${arrived} said they were here`,
  finishedLine: "The group's conversation stays readable for 30 days.",
  howDidItGo: "Who did you meet?",
} as const;

export const CONNECTIONS_COPY = {
  heading: "Connections",
  empty:
    "Connections come from groups: after a night out, tick who you met, and keep in touch with anyone who ticks you back.",
  metAt: (where: string) => `Met at ${where}`,
  invite: "Invite",
  pickHeading: (name: string) => `Invite ${name} to…`,
  pickEmpty: "Pin in to something first — you can invite people to what you're going to.",
  going: "Already going",
  invited: "Invited",
  sent: (name: string) => `Sent — ${name} will get a note from Pin'd.`,
  fiveADay: "That's five invites today — try again tomorrow.",
  close: "Done",
} as const;

export const WOMEN_ONLY_COPY = {
  setting: "Women-only rooms only",
  settingWhat:
    "You'll only be placed in women-only rooms. Until three of you are there you'll be waiting — we'll say so, and you can join the general room for any one gathering.",
  // Never a number (decisions Q9, docs/visibility.md §12i).
  waitingHeading: "Waiting for the women-only room",
  waitingLine: "It opens when there are three of you. We'll tell you the moment it does.",
  joinGeneral: "Join the general room instead",
  joinGeneralWhat: "Just for this one. Your setting stays as it is.",
  room: "Women-only room",
  // M4.2 (Alex, 29 Oct): an ordinary Leave, so leaving the women-only room never points at
  // one reason. Silent, as every departure is. PROPOSED copy (Tatiana's to reword).
  leave: "Leave the women-only room",
  leaveWhat: "You'll stay in the room for everyone going. Nobody is told.",
  leaveConfirm: "Leave it",
  stay: "Stay",
} as const;

// "Get the app" — once, when someone first joins a group: the first moment push is worth
// having (build plan §8 M3.3). On the web only; on the phone they already have it.
//
// **`url` is null until there is somewhere real to send people** — a public TestFlight
// link arrives with M4.3's Beta App Review, the App Store with Phase 5. While it is null
// the nudge is not shown at all, rather than pointing at nothing. Which link it carries,
// and when, is Alex's call.
export const GET_THE_APP = {
  url: null as string | null,
  heading: "You're in a group — get the app",
  line: "Your group's plan, the day-of note and \"I'm here\", on your lock screen instead of your inbox.",
  yes: "Get the app",
  no: "Not now",
} as const;

// A16's comment (#10). The database refuses more than COMMENT_MAX characters or a blank
// one (survey_responses_comment_shape); this is what the screen sends: trimmed, and
// nothing at all when nothing was written. C10 holds the two caps to one number.
export const COMMENT_MAX = 1000;

export function commentToSend(raw: string): string | null {
  const t = raw.trim();
  return t ? t : null;
}
