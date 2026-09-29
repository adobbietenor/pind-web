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
} as const;
