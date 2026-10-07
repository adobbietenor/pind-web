// The room and small groups: their words, and the one piece of logic about words — the
// openers (M3.3; build plan §8 M3.3, "The room at 1, 2, 3 and 5").
//
// PROPOSED COPY — Tatiana's doc "M3.3 copy — for Tatiana" has every line with its
// context; hers replaces these as it arrives (Alex: ship with ours marked proposed).
//
// **Nothing here is ever sent for anyone.** An opener fills the message box; the person
// edits it and presses send. S29 fails if any code path inserts a message the person did
// not send.

export const ROOM_COPY = {
  // 1 — just you. It has to read as a good place to be, not an empty room (Alex).
  firstHeading: "You're the first here",
  firstLine: "You're the first here to say you'd like to meet. We'll tell you the moment someone else does.",
  firstWhy: "Whoever says yes next will see you straight away — being first means you're the one they meet.",
  firstByEmail: (email: string) => `We'll email ${email} the moment it happens.`,
  firstShare: "Know someone else going? Send them this crowd.",
  // 2+ — the room.
  inRoom: (n: number) => `${n} in the room`,
  sayHi: "Say hi in the room",
  openRoom: "Open the room",
  arrived: "is here",
  sharedTag: (tag: string) => `You both picked ${tag}`,
  morePeople: (n: number) => `${n} here`,
  // 3 — once.
  enoughToGo: "There are three of you — enough to go together.",
  goTogether: "Go together",
  sayHiFirst: "Say hi first — you can invite people you've talked with.",
  // The box.
  placeholder: "Say something to the room",
  send: "Send",
  tooFast: "One message every few seconds — try again in a moment.",
  tooMany: "That's today's messages from you in this room.",
  deleteOwn: "Delete this message? It's removed for everyone.",
  report: "Report this message",
  readOnly: "This room has closed. You can still read it for 30 days.",
} as const;

export const GROUP_COPY = {
  heading: "Your group",
  // Progress without attribution (Alex): who is in, never who hasn't answered or said no.
  soFar: (names: string[]) =>
    names.length === 0 ? "Just you so far — a group needs 3." : `You and ${listNames(names)} so far — a group needs 3.`,
  on: (names: string[]) => `You're on — you and ${listNames(names)}.`,
  deadline: (time: string) => `If there aren't 3 of you by ${time}, the group closes and you're all back in the room.`,
  inviteMore: "Invite someone else you've talked with",
  pickPeople: "Who's going together?",
  pickHint: "People you've talked with in the room. Pick 2 or 3.",
  start: "Send the invites",
  invited: (from: string, others: string[]) =>
    others.length ? `${from} wants to go together — with ${listNames(others)}.` : `${from} wants to go together.`,
  accept: "Go together",
  decline: "Not this time",
  closed: "Not enough people joined your group, so it's closed. You're all still in the room.",
  closedNext: "Go together with others",
  // The plan.
  pollHeading: "Where do you meet?",
  pollHint: "Vote for a spot. Three hours before, the one with the most votes is the plan.",
  atTheStart: "You'll find each other at the start.",
  meets: (spot: string, time: string) => `You meet at ${spot}, ${time}.`,
  here: "I'm here",
  hereHint: "Say what you're wearing so they can find you — \"green Matthews jersey\".",
  leave: "Leave this group",
  threadPlaceholder: "Say something to your group",
} as const;

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export type Convening = "at_the_gathering" | "a_spot_first" | "after";

// Three first lines for a new room: one from a tag both people picked (when there is
// one), one about this gathering, one plain hello. Short enough to read at a glance.
export function openersFor(o: { convening: Convening; sharedTag: string | null }): string[] {
  const shared = o.sharedTag ? [`You picked ${o.sharedTag} too — same here`] : [];
  const about: Record<Convening, string> = {
    a_spot_first: "Anyone planning to get there early?",
    at_the_gathering: "First time at this one?",
    after: "Anyone staying after?",
  };
  const hello = "Hi — who else is going?";
  return [...shared, about[o.convening], hello, "Hey — first time using this"].slice(0, 3);
}

// The four report reasons (H9), in the words the person reads. Severity comes from the
// reason and is never asked (decisions H9).
export const REPORT_REASONS: { value: "uncomfortable" | "not_who_they_said" | "under_19" | "spam"; label: string }[] = [
  { value: "uncomfortable", label: "Made me uncomfortable" },
  { value: "not_who_they_said", label: "Not who they said they were" },
  { value: "under_19", label: "Under 19" },
  { value: "spam", label: "Spam" },
];
