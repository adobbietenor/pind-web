// A19 — My Events (M3.2b; Alex, 10 Oct 2026: the room era's reading, no new toggle).
//
// Spec A19 was written for crews ("with crew and spot if any; one day-of reminder
// toggle; past: crew met / went solo"). In force: upcoming shows each pinned gathering
// with your group and its spot and time when you are in one, else where you stand;
// past shows whether you ticked "we met" (A16). The day-of switch stays the one in
// Settings (#4). The line each row says is decided here, where tests reach it.

import { effectiveEnd } from "./copy.ts";
import { localDate } from "./time.ts";
import { SQUAD_COPY } from "./squad.ts";

export interface MyEventInput {
  startsAt: string;
  endsAt: string | null;
  withdrawn: boolean;
  openToMeeting: boolean;
  // Your group at this gathering, while you are in it.
  group: { state: "forming" | "spot_set" | "live" | "done" | "dissolved"; spot: string | null; meetAt: string | null } | null;
  // Your 1-on-1 plan here (M3.4) — a second line, beside the group's, never instead of it.
  solo?: { state: "forming" | "spot_set" | "live" | "done" | "dissolved"; spot: string | null; meetAt: string | null } | null;
  // After the night (A16), read only for past rows: how many you ticked "we met", and
  // whether the ticks are still open.
  after: { weMet: number; open: boolean } | null;
}

export type MyEventStatus =
  | { kind: "withdrawn" }
  | { kind: "group-set"; spot: string; meetAt: string }
  | { kind: "group-forming" }
  | { kind: "open" }
  | { kind: "pinned" }
  | { kind: "met"; n: number }
  | { kind: "tick" }
  | { kind: "past" };

export function isPast(e: Pick<MyEventInput, "startsAt" | "endsAt">, now: Date): boolean {
  return Date.parse(effectiveEnd(e.startsAt, e.endsAt)) <= now.getTime();
}

export function myEventStatus(e: MyEventInput, now: Date): MyEventStatus {
  if (isPast(e, now)) {
    if (e.after && e.after.weMet > 0) return { kind: "met", n: e.after.weMet };
    // after_state's `open` is true only for someone who had a group there (A16), so it
    // alone decides the prompt — a finished group may no longer be readable here.
    if (e.after?.open) return { kind: "tick" };
    return { kind: "past" };
  }
  if (e.withdrawn) return { kind: "withdrawn" };
  const g = e.group;
  if (g && (g.state === "spot_set" || g.state === "live") && g.spot && g.meetAt) return { kind: "group-set", spot: g.spot, meetAt: g.meetAt };
  if (g && (g.state === "forming" || g.state === "spot_set" || g.state === "live")) return { kind: "group-forming" };
  return e.openToMeeting ? { kind: "open" } : { kind: "pinned" };
}

// The 1-on-1 line for an upcoming row with a plan (M3.4); null otherwise.
export function myEventSoloLine(e: MyEventInput, now: Date, clock: (iso: string) => string): string | null {
  const s = e.solo;
  if (isPast(e, now) || e.withdrawn || !s || !(s.state === "spot_set" || s.state === "live") || !s.spot || !s.meetAt) return null;
  return MY_EVENTS_COPY.solo(s.spot, clock(s.meetAt));
}

// Upcoming soonest first, past most recent first — dates, never anything else (Q10).
export function splitMyEvents<T extends Pick<MyEventInput, "startsAt" | "endsAt">>(rows: T[], now: Date): { upcoming: T[]; past: T[] } {
  const upcoming = rows.filter((r) => !isPast(r, now)).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const past = rows.filter((r) => isPast(r, now)).sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  return { upcoming, past };
}

// PROPOSED copy (Tatiana's to reword). The empty line is spec A19's own.
export const MY_EVENTS_COPY = {
  title: "My Events",
  upcoming: "Coming up",
  past: "Been",
  // UI pass 1 (049), copy as drawn.
  emptyHeading: "You haven't Pin'd in to any events yet!",
  empty: "Check out this week's crowds and events. When you tap **Pin in, I'm going**, the event and everyone else going will show up here.",
  emptyLink: "See this week's crowds",
  solo: (spot: string, time: string) => `Your 1-on-1: ${spot}, ${time}`,
  status: (s: MyEventStatus, clock: (iso: string) => string): string => {
    switch (s.kind) {
      case "withdrawn":
        return "This one was withdrawn";
      case "group-set":
        return `Your group: ${s.spot}, ${clock(s.meetAt)}`;
      case "group-forming":
        return "Your group is forming";
      case "open":
        return "Open to meeting";
      case "pinned":
        return "Pinned";
      case "met":
        return s.n === 1 ? "You met 1 person" : `You met ${s.n} people`;
      case "tick":
        return "Did you meet? Tick who you met →";
      case "past":
        return "";
    }
  },
} as const;

// ---------------------------------------------------------------------------
// A19 as the home for your chats (Alex, 16 Oct 2026)
// ---------------------------------------------------------------------------
//
// Each event you pinned is a section, soonest first, tonight's on top and marked; under it,
// in this order: "Everyone going" (the room), your squad, your 1-on-1 plan, then the
// squads open to you — quieter, and a tap on one offers to join rather than opening it.
// Past events below, newest first, folded away; their chats read-only until retention
// takes them (Q11), then the event stays with no chat. All of it comes from one call,
// my_chats (supabase/migrations/20261016190356), read as the person under RLS; the rules
// for what each row says live here, where tests reach them (M07–M16).

export interface ChatLast {
  body: string;
  at: string;
  authorId: string | null;
  // Yours: the preview says "You".
  mine: boolean;
  // Null when you may not see who said it (RLS): the row says "Someone".
  author: string | null;
}

export interface RoomChat {
  roomId: string;
  womenOnly: boolean;
  members: number;
  // Two or more: before that, A9 says "you're the first here" and there is no room to open.
  open: boolean;
  last: ChatLast | null;
  unread: number;
}

export interface CrewChat {
  crewId: string;
  kind: "crew" | "solo";
  name: string | null;
  legacy: boolean;
  state: string;
  spot: string | null;
  meetAt: string | null;
  // A 1-on-1 plan's other person, by first name.
  partner: string | null;
  last: ChatLast | null;
  unread: number;
}

export interface OpenSquad {
  crewId: string;
  name: string;
  womenOnly: boolean;
  spot: string | null;
  meetAt: string;
  seats: number;
  full: boolean;
}

export interface MyChatsEvent extends MyEventInput {
  gatheringId: string;
  slug: string;
  name: string;
  venue: string;
  timezone: string;
  rooms: RoomChat[];
  crews: CrewChat[];
  openSquads: OpenSquad[];
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
function last(v: unknown): ChatLast | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o.body !== "string" || typeof o.at !== "string") return null;
  return { body: o.body, at: o.at, authorId: str(o.author_id), mine: o.mine === true, author: str(o.author) };
}
type PlanState = NonNullable<MyEventInput["group"]>["state"];

// my_chats' answer, read defensively: a field the database leaves out is an empty list or
// null here, never a crash on the tab people open on the night.
export function readMyChats(json: unknown): MyChatsEvent[] {
  return list(json).map((e) => {
    const crews: CrewChat[] = list(e.crews).map((c) => ({
      crewId: String(c.crew_id),
      kind: c.kind === "solo" ? "solo" : "crew",
      name: str(c.name),
      legacy: c.legacy === true,
      state: String(c.state ?? ""),
      spot: str(c.spot),
      meetAt: str(c.meet_at),
      partner: str(c.partner),
      last: last(c.last),
      unread: num(c.unread),
    }));
    const plan = (kind: "crew" | "solo") => {
      const c = crews.find((x) => x.kind === kind);
      return c ? { state: c.state as PlanState, spot: c.spot, meetAt: c.meetAt } : null;
    };
    const after = e.after as { open?: boolean; people?: { we_met?: boolean }[] } | null;
    return {
      gatheringId: String(e.gathering_id),
      slug: String(e.slug),
      name: String(e.name ?? ""),
      venue: str(e.venue) ?? "",
      timezone: str(e.timezone) ?? "America/Toronto",
      startsAt: String(e.starts_at),
      endsAt: str(e.ends_at),
      withdrawn: e.withdrawn === true,
      openToMeeting: e.open_to_meeting === true,
      group: plan("crew"),
      solo: plan("solo"),
      after: after ? { weMet: (after.people ?? []).filter((p) => p.we_met).length, open: after.open === true } : null,
      rooms: list(e.rooms).map((r) => ({
        roomId: String(r.room_id),
        womenOnly: r.women_only === true,
        members: num(r.members),
        open: r.open === true,
        last: last(r.last),
        unread: num(r.unread),
      })),
      crews,
      openSquads: list(e.open_squads).map((s) => ({
        crewId: String(s.crew_id),
        name: String(s.name ?? ""),
        womenOnly: s.women_only === true,
        spot: str(s.spot),
        meetAt: String(s.meet_at),
        seats: num(s.seats),
        full: s.full === true,
      })),
    };
  });
}

// Tonight: under way now, or starting later today where it happens (the venue's own day).
export function isTonight(e: Pick<MyChatsEvent, "startsAt" | "endsAt" | "timezone">, now: Date): boolean {
  if (isPast(e, now)) return false;
  if (Date.parse(e.startsAt) <= now.getTime()) return true;
  return localDate(e.startsAt, e.timezone) === localDate(now.toISOString(), e.timezone);
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Q11: a chat closes (read-only) 24 h after the effective end, and is gone 30 days after that.
export function chatsReadOnly(e: Pick<MyEventInput, "startsAt" | "endsAt">, now: Date): boolean {
  return now.getTime() >= Date.parse(effectiveEnd(e.startsAt, e.endsAt)) + DAY;
}
export function chatsKept(e: Pick<MyEventInput, "startsAt" | "endsAt">, now: Date): boolean {
  return now.getTime() < Date.parse(effectiveEnd(e.startsAt, e.endsAt)) + DAY + 30 * DAY;
}

// ---------------------------------------------------------------------------
// #18 — an ended event says so (Alex, 29 Oct 2026). A9 for an ended event used to keep
// drawing the room card, so a room that never opened still said "You're the first here …
// we'll tell you the moment someone else does" about a night that was over. Three phases
// after the effective end, from Q11's two rules: the LAST DAY, writable ("that's when
// people say it was good to meet you" — Alex), then READ-ONLY for 30 days, then CLEARED.
// ---------------------------------------------------------------------------
export type EndedPhase = "last-day" | "read-only" | "cleared";

export function endedPhase(e: Pick<MyEventInput, "startsAt" | "endsAt">, now: Date): EndedPhase {
  if (!chatsReadOnly(e, now)) return "last-day";
  return chatsKept(e, now) ? "read-only" : "cleared";
}

// When the last day's chats close: 24 h after the effective end.
export function lastDayCloses(e: Pick<MyEventInput, "startsAt" | "endsAt">): string {
  return new Date(Date.parse(effectiveEnd(e.startsAt, e.endsAt)) + DAY).toISOString();
}

export interface EndedChat {
  kind: "room" | "crew";
  id: string;
  label: string;
}

// The chats an ended event still has, in the order A9 lists them: the rooms that opened
// (a room of one was never a chat), then your squad and your 1-on-1. None once cleared.
export function endedChats(e: Pick<MyChatsEvent, "rooms" | "crews" | "startsAt" | "endsAt">, now: Date): EndedChat[] {
  if (endedPhase(e, now) === "cleared") return [];
  const rooms = e.rooms
    .filter((r) => r.open)
    .map((r) => ({ kind: "room" as const, id: r.roomId, label: r.womenOnly ? MY_CHATS_COPY.everyoneGoingWomen : MY_CHATS_COPY.everyoneGoing }));
  const crews = e.crews.map((c) => ({
    kind: "crew" as const,
    id: c.crewId,
    label: c.kind === "solo" ? MY_CHATS_COPY.plan(c.partner) : c.legacy ? MY_CHATS_COPY.yourGroup : (c.name ?? SQUAD_COPY.heading),
  }));
  return [...rooms, ...crews];
}

// PROPOSED copy (Tatiana's to reword).
export const ENDED_COPY = {
  heading: "This event has ended",
  lastDay: (closes: string) => `The chats stay open until ${closes}. Time to say it was good to meet.`,
  readOnly: "The chats are read-only now. They're cleared 30 days after that.",
  cleared: "The chats from this one were cleared 30 days after it ended.",
  none: "No chats from this one.",
  open: "Open",
  read: "Read",
} as const;

// Every chat's unread count, for the tab's dot. Open squads are not yours yet: not counted.
export function unreadTotal(events: Pick<MyChatsEvent, "rooms" | "crews">[]): number {
  return events.reduce((n, e) => n + e.rooms.reduce((a, r) => a + r.unread, 0) + e.crews.reduce((a, c) => a + c.unread, 0), 0);
}

// Upcoming soonest first with tonight's on top; past newest first (splitMyEvents's order).
export function orderMyChats<T extends Pick<MyChatsEvent, "startsAt" | "endsAt" | "timezone">>(rows: T[], now: Date): { tonight: T[]; upcoming: T[]; past: T[] } {
  const { upcoming, past } = splitMyEvents(rows, now);
  return { tonight: upcoming.filter((r) => isTonight(r, now)), upcoming: upcoming.filter((r) => !isTonight(r, now)), past };
}

// What a chat row's time says: the clock today, the weekday this week, else the date.
export function chatWhen(iso: string, tz: string, now: Date): string {
  if (localDate(iso, tz) === localDate(now.toISOString(), tz)) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  }
  if (now.getTime() - Date.parse(iso) < 6 * DAY) return new Intl.DateTimeFormat("en-CA", { timeZone: tz, weekday: "short" }).format(new Date(iso));
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, day: "numeric", month: "short" }).format(new Date(iso));
}

// The preview under a chat's name: "You: …", "Bea: …", or the quiet line when nothing is said yet.
export function chatPreview(l: ChatLast | null, empty: string): string {
  if (!l) return empty;
  const who = l.mine ? "You" : l.author ?? "Someone";
  return `${who}: ${l.body.replace(/\s+/g, " ").trim()}`;
}

// PROPOSED copy (Tatiana's to reword; "Everyone going" is Alex's working name).
export const MY_CHATS_COPY = {
  everyoneGoing: "Everyone going",
  everyoneGoingWomen: "Everyone going · women only",
  firstHere: "Just you so far. We'll tell you when someone else says yes",
  noMessages: "Nobody's said anything yet",
  yourGroup: "Your group",
  plan: (partner: string | null) => (partner ? `1-on-1 with ${partner}` : "Your 1-on-1"),
  openSquads: "Squads you could join",
  squadLine: (spot: string | null, time: string, seats: number) => `${spot ?? "At the gathering"} · ${time} · ${seats} of 8`,
  full: "Full",
  join: "Join this squad",
  joinCancel: "Not now",
  tonight: "Tonight",
  pinnedOnly: "You're pinned. Say you're open to meeting and the people going, and their squads, show up here.",
  pinnedOnlyAction: "Open to meeting",
  readOnly: "Read-only",
  noChatsKept: "The chats from this one have been cleared.",
  pastToggle: (n: number, open: boolean) => (open ? "Hide past events" : `Past events (${n})`),
  unreadLabel: (n: number) => (n === 1 ? "1 unread message" : `${n} unread messages`),
} as const;

// A19 as a chat inbox (UI pass 1, 107/108): the date badge on each row, in the venue's own
// day ("NOV" over "2"), and the quiet lines a row says when it has no message to preview.
export function dateBadge(iso: string, tz: string): { month: string; day: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, month: "short", day: "numeric" }).formatToParts(new Date(iso));
  return {
    month: (parts.find((p) => p.type === "month")?.value ?? "").replace(".", "").toUpperCase(),
    day: parts.find((p) => p.type === "day")?.value ?? "",
  };
}

export const INBOX_COPY = {
  tonight: "Tonight",
  comingUp: "Coming up",
  past: "Past",
  live: "Live",
  filters: [
    { value: "all", name: "All" },
    { value: "unread", name: "Unread" },
    { value: "squads", name: "Squads" },
  ],
  pinnedOnly: "You pinned in · not open to meeting yet",
  quiet: "You're in · nobody chatting yet",
  waiting: "Just you so far",
  ended: "Meeting has ended",
  endedMet: (n: number) => (n === 1 ? "Meeting has ended · you met 1 person" : `Meeting has ended · you met ${n} people`),
  tick: "Did you meet anyone? Say who",
  withdrawn: "This one was withdrawn",
  showAllPast: "Show all past events",
  hidePast: "Show fewer",
  womenOnlyRoom: "Women-only room",
  nothingUnread: "Nothing unread.",
  noSquads: "No squads yet.",
} as const;
export type InboxFilter = (typeof INBOX_COPY.filters)[number]["value"];
