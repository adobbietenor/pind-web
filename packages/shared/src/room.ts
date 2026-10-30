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
  // "In the room", never "here" (UI pass 1, round 2): "here" is the venue, "I've arrived".
  firstHeading: "You're the first in the room",
  firstLine: "You're the first in the room. We'll tell you the moment someone else joins.",
  firstWhy: "Whoever says yes next will see you straight away. Being first means you're the one they meet.",
  firstByEmail: (email: string) => `We'll email ${email} the moment it happens.`,
  firstShare: "Know someone else going? Send them this crowd.",
  // 2+ — the room.
  inRoom: (n: number) => `${n} in the room`,
  // The room's own header (UI pass 1, 057).
  title: "Pin'd Meeting Room",
  here: (n: number) => `${n} in the room`,
  about: "About this room",
  sayHi: "Say hi in the room",
  whoIsIn: "Who's in the room",
  openRoom: "Open the room",
  arrived: "joined the room",
  sharedTag: (tag: string) => `You both picked ${tag}`,
  morePeople: (n: number) => `${n} in the room`,
  // 3 — once.
  enoughToGo: "There are three of you, enough to go together.",
  goTogether: "Go together",
  sayHiFirst: "Say hi first. You can invite people you've talked with.",
  // The box.
  placeholder: "Say something to the room",
  send: "Send",
  tooFast: "One message every few seconds. Try again in a moment.",
  tooMany: "That's today's messages from you in this room.",
  deleteOwn: "Delete this message? It's removed for everyone.",
  // Long-press someone else's message: a report on THEM, never on the message (Alex,
  // 16 Oct 2026: "We report people, not messages"). It records where and when, not the words.
  reportPerson: (name: string) => `Report ${name}`,
  reportHint: "It's a report on them, not on this message.",
  readOnly: "This room has closed. You can still read it for 30 days.",
} as const;

export const GROUP_COPY = {
  heading: "Your group",
  // Progress without attribution (Alex): who is in, never who hasn't answered or said no.
  soFar: (names: string[]) =>
    names.length === 0 ? "Just you so far. A group needs 3." : `You and ${listNames(names)} so far. A group needs 3.`,
  on: (names: string[]) => `You're on: you and ${listNames(names)}.`,
  deadline: (time: string) => `If there aren't 3 of you by ${time}, the group closes and you're all back in the room.`,
  inviteMore: "Invite someone else you've talked with",
  pickPeople: "Who's going together?",
  pickHint: "People you've talked with in the room. Pick 2 or 3.",
  start: "Send the invites",
  invited: (from: string, others: string[]) =>
    others.length ? `${from} wants to go together, with ${listNames(others)}.` : `${from} wants to go together.`,
  accept: "Go together",
  decline: "Not this time",
  closed: "Not enough people joined your group, so it's closed. You're all still in the room.",
  closedNext: "Go together with others",
  // The plan.
  pollHeading: "Where do you meet?",
  pollHint: "Vote for a spot. Three hours before, the one with the most votes is the plan.",
  atTheStart: "You'll find each other at the start.",
  meets: (spot: string, time: string) => `You meet at ${spot}, ${time}.`,
  here: "I've arrived",
  hereHint: "Say what you're wearing so they can find you, like \"green Matthews jersey\".",
  leave: "Leave this group",
  // The chat header's menu (UI pass 1, round 2): details, sharing and leaving, off the page.
  more: "More",
  threadPlaceholder: "Say something to your group",
  // Q11, as the room says it: writable until 24 h after the night, then read-only.
  readOnly: "This chat has closed. You can still read it for 30 days.",
} as const;

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export type Convening = "at_the_gathering" | "a_spot_first" | "after";

// Three first lines for a new room: one from a tag both people picked (when there is
// one), one about this gathering, one plain hello. Short enough to read at a glance.
export function openersFor(o: { convening: Convening; sharedTag: string | null }): string[] {
  const shared = o.sharedTag ? [`You picked ${o.sharedTag} too. Same here`] : [];
  const about: Record<Convening, string> = {
    a_spot_first: "Anyone planning to get there early?",
    at_the_gathering: "First time at this one?",
    after: "Anyone staying after?",
  };
  const hello = "Hi, who else is going?";
  return [...shared, about[o.convening], hello, "Hey, first time using this"].slice(0, 3);
}

// The four report reasons (H9), in the words the person reads. Severity comes from the
// reason and is never asked (decisions H9).
export const REPORT_REASONS: { value: "uncomfortable" | "not_who_they_said" | "under_19" | "spam"; label: string }[] = [
  { value: "uncomfortable", label: "Made me uncomfortable" },
  { value: "not_who_they_said", label: "Not who they said they were" },
  { value: "under_19", label: "Under 19" },
  { value: "spam", label: "Spam" },
];

// A9 on the night (UI pass 1, 088): one "I've arrived" for the room and your squad (named
// "I'm here" until round 2, when "here" became the venue and the room became "in the room").
// It asks for Q7's line (set_here refuses a blank one, here_note); it switches itself off
// at the end.
export const HERE_COPY = {
  label: "I've arrived",
  later: "Later",
  line: "Let the room and your squad know you've arrived. Switches off after the event.",
  ask: "What are you wearing, so they can find you?",
  placeholder: "green Matthews jersey",
  save: "Tell them",
  cancel: "Not yet",
  yours: (note: string) => `You've arrived: "${note}"`,
  theirs: (name: string, note: string) => `${name} has arrived: "${note}"`,
  count: (n: number) => `${n} ${n === 1 ? "has" : "have"} arrived`,
  refusal: (hint: string | undefined): string =>
    hint === "here_note"
      ? "Say what you're wearing, in a few words."
      : hint === "here_window"
        ? "That switch opens 3 hours before the start."
        : "Only people open to meeting here can say they've arrived.",
} as const;
