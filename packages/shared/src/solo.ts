// 1-on-1 (A9, A28, A29, A20, A22): its words, its refusals, and the times squads still offer.
//
// Since build 23 (Alex, 16 Nov 2026) a 1-on-1 asks for nothing: a request carries no spot,
// time or line; an accept makes the two of you connections with one chat; a place or time is
// an optional row in that chat. The old proposal sheet, its five lines and the spot
// confirmation are gone. PROPOSED COPY throughout: Tatiana rewords.
//
// **The database is the rule** (propose_solo, respond_to_solo, can_see_solo, the pair chat's
// policies); these only decide what a screen says.

import { effectiveEnd } from "./copy.ts";

export const SOLO_MAX_OPEN = 3;
export const SOLO_STEP_MINUTES = 15;
export const SOLO_BEFORE_MINUTES = 180; // from 3 h before the start…
export const SOLO_AFTER_END_MINUTES = 120; // …to 2 h after the effective end (Alex, 14 Oct 2026)

// The times on offer: every quarter hour from 3 h before the start to 2 h after the
// effective end, never in the past — what private.solo_time_ok accepts. Squads use it; a
// 1-on-1 no longer offers times.
export function soloTimes(startsAt: string, endsAt: string | null, now: Date = new Date()): string[] {
  const step = SOLO_STEP_MINUTES * 60_000;
  const from = Math.ceil((Date.parse(startsAt) - SOLO_BEFORE_MINUTES * 60_000) / step) * step;
  const to = Date.parse(effectiveEnd(startsAt, endsAt)) + SOLO_AFTER_END_MINUTES * 60_000;
  const out: string[] = [];
  for (let t = from; t <= to; t += step) if (t > now.getTime()) out.push(new Date(t).toISOString());
  return out;
}

export const SOLO_COPY = {
  // The chat's own words (A29).
  planHeading: (name: string) => `Your 1-on-1 with ${name}`,
  planOff: "This 1-on-1 is off.",
  callOff: "Call off this 1-on-1",
  callOffNote: "Your chat ends and you're no longer connected. They aren't told.",
  threadPlaceholder: (name: string) => `Say something to ${name}`,
} as const;

// A refusal from the database, in words, put where the tap was. Every refusal names what
// to do; none says why someone is unavailable (a block, a report, their switch).
// Takes the database's error (or its words) and classifies it; its own text is never shown.
export function soloRefusal(refusal: unknown): string {
  const m = typeof refusal === "string" ? refusal : String((refusal as { message?: unknown } | null)?.message ?? "");
  if (m.includes("three open")) return `You have ${SOLO_MAX_OPEN} requests waiting. One needs an answer before you send another.`;
  if (m.includes("already asked")) return "You've already asked each other here. One request per person per event.";
  if (m.includes("closed at the end") || m.includes("closed at the start")) return ONE_ON_ONE_COPY.closedAtEnd;
  if (m.includes("a spot and a time together")) return "That didn't go through. Try again.";
  if (m.includes("not available")) return "They're not available for 1-on-1 now.";
  if (m.includes("spot")) return "Pick one of the places on the list.";
  if (m.includes("times on offer")) return "Pick one of the times on the list.";
  if (m.includes("five lines")) return "That didn't go through. Try again.";
  if (m.includes("no longer open")) return "That request is no longer open.";
  // The per-event switch (round 3, item 10): set_event_one_on_one and the pin's own triggers.
  if (m.includes("open to meeting first")) return "Turn on Open to meeting at this event first.";
  if (m.includes("pin in first")) return "Pin in to this event first.";
  if (m.includes("Women only is for women")) return "Women only is for women, and nonbinary people who chose to be included.";
  if (m.includes("no longer on Pin'd")) return "This event isn't on Pin'd any more, so this can't change.";
  return "That didn't work. Try again in a moment.";
}

export const ONE_ON_ONE_COPY = {
  // A9: one question per event, visible as soon as you've pinned in.
  switchLabel: "Open to meeting people 1-on-1 at this event?",
  switchLine: "Only people who turn this on here too can see you, and a chat starts only if you both say yes.",
  audienceLabel: "Who can see you for 1-on-1",
  everyone: "Everyone open to meeting",
  womenOnly: "Women only",
  // The section, once it is on (reciprocal, H3: with it off you see nobody).
  sectionHeading: "Open to 1-on-1 here",
  offLine: "Turn this on to see who's open to 1-on-1",
  nobodyYet: "Nobody else here has turned this on yet. They'll show up here when they do.",
  youHaveOne: (name: string) => `You have a 1-on-1 with ${name} here`,
  openChat: "Open your chat",
  requestsHere: "Requests for you here",
  // "How do you want to meet?" (073), after "I'd like to meet people" and at A27's end.
  sheetTitle: "How do you want to meet?",
  roomAndSquads: "The room and squads",
  roomAndSquadsLine: "Always on: everyone here who wants to meet.",
  sheetLine: "One person at a time, only if you both say yes.",
  sheetFoot: "You can change this any time on this event's page.",
  tapAnyone: "Tap anyone to say hi.",
  done: "Done",
  tag: "Open to 1-on-1",
  // The person sheet.
  ask: "Request to chat",
  sent: (_name: string) => "Request sent",
  message: "Message",
  // Requests (Connections, and the event's crowd page).
  requests: "Requests",
  wantsToMeet: (name: string) => `${name} wants to chat 1-on-1`,
  at: (event: string) => `At ${event}`,
  accept: "Accept",
  notNow: "Not now",
  // The chat (A29) and Connections (A20).
  firstLine: "You both said yes. Say hi!",
  chatEnded: "This chat has ended.",
  oneOnOneAt: (event: string) => `1-on-1 at ${event}`,
  addPlace: "Add a place or time",
  place: "A place",
  time: "A time",
  atTheEvent: "At the event itself",
  timePlaceholder: "e.g. around 7",
  save: "Save",
  clear: "Take the place away",
  removeConnection: "Remove connection",
  removeNote: "Your chat ends for both of you. They aren't told.",
  seeProfile: "See their profile",
  // Block and report, on a profile (H9).
  report: (name: string) => `Report ${name}`,
  reportHint: "Pick what happened. Your chat with them ends.",
  block: (name: string) => `Block ${name}`,
  blockNote: "You won't see each other on Pin'd any more, and your chat ends. They aren't told.",
  blockConfirm: "Block",
  blocked: (name: string) => `You've blocked ${name}.`,
  reported: "Thanks. A person reads every report.",
  // Where the button would be, when it can't be (UI pass 1, round 2: never a missing
  // button with no reason). One line each; oneOnOneState picks which.
  notTaking: (name: string) => `${name} isn't taking 1-on-1 requests`,
  turnOnToAsk: "Turn on 1-on-1 at this event to send requests",
  closedAtEnd: "Requests closed when the event ended",
  paused: "1-on-1 chats are paused right now",
  alreadyHave: "You already have a 1-on-1 at this event",
  fromAnEvent: "1-on-1 requests are sent from an event's page",
  openEvent: (event: string) => `Open ${event}`,
} as const;

// What the person sheet shows where "Request to chat" goes (UI pass 1, round 2). Every fact is
// the viewer's own or public: their switch, their requests, their 1-on-1, their connections,
// the end time, the brake. Whether the other person can be asked is solo_people's answer
// (can_see_solo), and when it is no, the reason on their side is one line, "isn't taking
// 1-on-1 requests", so the sheet tells nobody which it is. Someone you're already connected
// with gets "Message" — the one chat you already share — whatever else is true.
export type OneOnOneState = "connected" | "ask" | "asked" | "theirs" | "turnOn" | "closed" | "paused" | "planned" | "elsewhere";

export function oneOnOneState(f: {
  atGathering: boolean;
  available: boolean;
  asked: boolean;
  // Requests run to the effective end (16 Nov 2026; was the start).
  ended: boolean;
  inPlan: boolean;
  mineOn: boolean;
  open: boolean;
  connected?: boolean;
}): OneOnOneState {
  if (f.connected) return "connected";
  if (!f.atGathering) return "elsewhere";
  // A request already sent stays "sent" whatever happens next (a "Not now" is silent).
  if (f.asked) return "asked";
  if (!f.available) return "paused";
  if (f.ended) return "closed";
  if (f.inPlan) return "planned";
  if (!f.mineOn) return "turnOn";
  return f.open ? "ask" : "theirs";
}

// The line for every state but "ask" and "connected" (which are buttons).
export function oneOnOneLine(state: OneOnOneState, name: string): string | null {
  switch (state) {
    case "ask":
    case "connected":
      return null;
    case "asked":
      return ONE_ON_ONE_COPY.sent(name);
    case "theirs":
      return ONE_ON_ONE_COPY.notTaking(name);
    case "turnOn":
      return ONE_ON_ONE_COPY.turnOnToAsk;
    case "closed":
      return ONE_ON_ONE_COPY.closedAtEnd;
    case "paused":
      return ONE_ON_ONE_COPY.paused;
    case "planned":
      return ONE_ON_ONE_COPY.alreadyHave;
    case "elsewhere":
      return ONE_ON_ONE_COPY.fromAnEvent;
  }
}
