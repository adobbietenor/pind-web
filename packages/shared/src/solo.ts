// 1-on-1 (A28, A29; M3.4): its words, its five lines, and the times on offer.
//
// PROPOSED COPY (spec §5 calls it Draft): only the label "Meet 1-on-1" and preset line 1 are final; the
// sheet's words and lines 2–5 are Alex's and Tatiana's to replace, and Tatiana writes the
// final five. The database stores a line by number (1–5), so her copy replaces these with
// no migration (decisions, "M3.4: the 1-on-1 lifecycle").
//
// **The database is the rule.** propose_solo refuses a spot, a time or a line this file
// would not offer; these copies only decide what the sheet shows. P216 proposes at the
// first and the last of soloTimes(), so the two cannot drift apart unnoticed.

import { effectiveEnd } from "./copy.ts";

export const SOLO_MAX_OPEN = 3;
export const SOLO_STEP_MINUTES = 15;
export const SOLO_BEFORE_MINUTES = 180; // from 3 h before the start…
export const SOLO_AFTER_END_MINUTES = 120; // …to 2 h after the effective end (Alex, 14 Oct 2026)

// "before": worded for meeting before it starts ("walk in together", "before it starts",
// "then head in"); offered only for a time at or before the start. "any": fits any time.
// Until Tatiana's five arrive, a time after the start offers lines 3 and 4 only — her five
// need to cover meeting afterwards (decisions).
export const SOLO_LINES: { n: 1 | 2 | 3 | 4 | 5; fits: "before" | "any"; text: (spot: string, time: string) => string }[] = [
  { n: 1, fits: "before", text: (s, t) => `Meet at ${s} at ${t} and walk in together?` },
  { n: 2, fits: "before", text: (s, t) => `Grab a drink at ${s} at ${t} before it starts?` },
  { n: 3, fits: "any", text: (s, t) => `I'll be at ${s} at ${t}. Want to meet there?` },
  { n: 4, fits: "any", text: (s, t) => `Going alone too. Meet at ${s} at ${t}?` },
  { n: 5, fits: "before", text: (s, t) => `Quick hello at ${s} at ${t}, then head in?` },
];

export function soloLine(n: number, spot: string, time: string): string {
  const line = SOLO_LINES.find((l) => l.n === n);
  return line ? line.text(spot, time) : `Meet at ${spot} at ${time}?`;
}

// The lines that read true for a meeting time.
export function soloLinesFor(meetAt: string, startsAt: string): typeof SOLO_LINES {
  const before = Date.parse(meetAt) <= Date.parse(startsAt);
  return SOLO_LINES.filter((l) => l.fits === "any" || before);
}

// The times on offer: every quarter hour from 3 h before the start to 2 h after the
// effective end, never in the past — what private.solo_time_ok accepts.
export function soloTimes(startsAt: string, endsAt: string | null, now: Date = new Date()): string[] {
  const step = SOLO_STEP_MINUTES * 60_000;
  const from = Math.ceil((Date.parse(startsAt) - SOLO_BEFORE_MINUTES * 60_000) / step) * step;
  const to = Date.parse(effectiveEnd(startsAt, endsAt)) + SOLO_AFTER_END_MINUTES * 60_000;
  const out: string[] = [];
  for (let t = from; t <= to; t += step) if (t > now.getTime()) out.push(new Date(t).toISOString());
  return out;
}

// Proposals close at the start (they "vanish at the gathering's start").
export function soloProposalsOpen(startsAt: string, now: Date = new Date()): boolean {
  return now.getTime() < Date.parse(startsAt);
}

export const SOLO_COPY = {
  // A28 — the switch and the sheet. "Meet 1-on-1" is final; the rest is Draft (spec §5).
  label: "Meet 1-on-1",
  sheetTitle: "Meet 1-on-1",
  sheetLine:
    "Meet 1-on-1 is optional. You'll only see, and be seen by, people who also turned it on for this gathering. Meetings happen only at this venue's public spots. Choose who can see you:",
  groupsVsSolo:
    "Squads are small groups anyone here can join. 1-on-1 is one person you choose, at a spot and a time, and they choose you back.",
  everyone: "Everyone who opted in",
  womenOnly: "Women only",
  womenOnlyNote: "Women and nonbinary people who chose to be included in women-only spaces. They see you, and you see only them.",
  turnOn: "Turn on",
  turnOff: "Turn 1-on-1 off",
  offNote: "Your open proposals close when you turn it off.",
  // A29 — the section.
  sectionHeading: "1-on-1",
  nobodyYet: "Nobody else here has turned on 1-on-1 yet. You'll see them here when they do.",
  propose: "Propose a meet",
  sent: "Sent",
  sentNote: "They'll see it until the start. If they say yes, you'll get a plan here.",
  withdraw: "Withdraw",
  received: "wants to meet",
  accept: "Yes, let's meet",
  decline: "No thanks",
  declineNote: "They aren't told.",
  openCount: (n: number) => `${n} of ${SOLO_MAX_OPEN} proposals open`,
  closedAtStart: "Proposals closed when it started.",
  // The proposal sheet: a spot, a time and a line — nothing to type.
  sheetSpot: "Where",
  sheetTime: "When",
  sheetLinePick: "Say",
  sheetSend: "Send",
  yourGroup: (spot: string, time: string) => `Your group meets at ${spot}, ${time}.`,
  yourGroupAtStart: "Your group meets at the start.",
  // The plan card.
  planHeading: (name: string) => `Your 1-on-1 with ${name}`,
  planWhere: (spot: string, time: string) => `${spot}, ${time}`,
  openPlan: "Open",
  planOff: "This 1-on-1 is off.",
  callOff: "Call off this 1-on-1",
  callOffNote: "They'll be told it's off, not why. You can't send each other another proposal here.",
  threadPlaceholder: (name: string) => `Say something to ${name}`,
  // #17 (Tatiana's "Let's meet up!", Alex, 29 Oct 2026): connect first, pick the spot after.
  // A pair is not a plan until one of you suggests a spot and the other says yes. PROPOSED.
  letsMeetUp: "Let's meet up!",
  invited: "wants to meet up",
  inviteNote: "If they say yes, you can say hi and pick a spot together.",
  pairHeading: (name: string) => `You and ${name} are meeting up`,
  pairLine: "Say hi, then pick a spot together. It's a plan once you both agree on one.",
  pairPick: "Pick a spot",
  pairSuggest: "Suggest a spot",
  pairSuggestAnother: "Suggest another",
  pairTheirs: (name: string, spot: string, time: string) => `${name} suggested ${spot}, ${time}.`,
  pairMine: (name: string, spot: string, time: string) => `You suggested ${spot}, ${time}. It's ${name}'s to say yes to.`,
  pairConfirm: "Sounds good",
  pairSend: "Suggest it",
  pairClosed: "It started before you two picked a spot, so this one won't become a plan.",
  // A23: a summary only; it is switched at each gathering (spec A23).
  settingsHeading: "Meet 1-on-1",
  settingsNone: "Off everywhere. You turn it on at a gathering, on its crowd page.",
  settingsAt: (name: string, womenOnly: boolean) => `On at ${name}: ${womenOnly ? "women only" : "everyone who opted in"}`,
  noSpots: "1-on-1 isn't offered here: this venue has no meeting spots yet.",
} as const;

// A refusal from the database, in words, put where the tap was. Every refusal names what
// to do; none says why someone is unavailable (a block, a report, their switch).
// Takes the database's error (or its words) and classifies it; its own text is never shown.
export function soloRefusal(refusal: unknown): string {
  const m = typeof refusal === "string" ? refusal : String((refusal as { message?: unknown } | null)?.message ?? "");
  if (m.includes("three open")) return `You have ${SOLO_MAX_OPEN} proposals open. Withdraw one to send another.`;
  if (m.includes("already asked")) return "You've already asked each other here. One proposal per person per gathering.";
  if (m.includes("closed at the start")) return SOLO_COPY.closedAtStart;
  // #17's pair (29 Oct 2026), above "spot": its stale-spot refusal names a spot too.
  if (m.includes("pair is not open")) return SOLO_COPY.pairClosed;
  if (m.includes("the other person confirms")) return "That one's theirs to say yes to, or suggest another.";
  if (m.includes("no longer on offer")) return "That spot or time isn't on offer any more. Suggest another.";
  if (m.includes("a spot and a time together")) return "Pick a spot and a time together, or neither.";
  if (m.includes("not available")) return "They're not available for 1-on-1 now.";
  if (m.includes("spot")) return "Pick one of the spots on the list.";
  if (m.includes("times on offer")) return "Pick one of the times on the list.";
  if (m.includes("five lines")) return "Pick one of the lines to send.";
  if (m.includes("no longer open")) return "That proposal is no longer open.";
  if (m.includes("solo_no_spots") || m.includes("no meeting spots")) return SOLO_COPY.noSpots;
  return "That didn't work. Try again in a moment.";
}

// 1-on-1 since UI pass 1 (Alex, 30 Oct 2026; 073, 075/076, 077, 079): one account switch,
// requests from the profile sheet, requests in Connections, a plain chat whose place and
// time either of you adds. Copy as drawn.
export const ONE_ON_ONE_COPY = {
  switchLabel: "Open to 1-on-1 chats",
  switchLine: "Others can send you a Let's meet up request.",
  audienceLabel: "Who can see you for 1-on-1",
  everyone: "Everyone open to meeting",
  womenOnly: "Women only",
  sheetTitle: "How do you want to meet?",
  roomAndSquads: "The room and squads",
  roomAndSquadsLine: "Always on: everyone here who wants to meet.",
  sheetLine: "One person at a time, only if you both say yes.",
  sheetFoot: "You can change this any time from your profile.",
  done: "Done",
  tag: "Open to 1-on-1",
  ask: "Let's meet up 1-on-1",
  sent: (name: string) => `Request sent ✓ You'll see ${name}'s reply in Connections.`,
  requests: "Requests",
  wantsToMeet: (name: string) => `${name} wants to meet up 1-on-1`,
  at: (event: string) => `At ${event}`,
  accept: "Accept",
  notNow: "Not now",
  chats: "1-on-1 chats",
  firstLine: "You're both pinned in and open to chatting. Say hi!",
  addPlace: "Add a place or time",
  place: "A place",
  time: "A time",
  atTheEvent: "At the event itself",
  timePlaceholder: "e.g. around 7",
  save: "Save",
  clear: "Take the place away",
} as const;
