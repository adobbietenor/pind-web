// A19 — My Events (M3.2b; Alex, 10 Oct 2026: the room era's reading, no new toggle).
//
// Spec A19 was written for crews ("with crew and spot if any; one day-of reminder
// toggle; past: crew met / went solo"). In force: upcoming shows each pinned gathering
// with your group and its spot and time when you are in one, else where you stand;
// past shows whether you ticked "we met" (A16). The day-of switch stays the one in
// Settings (#4). The line each row says is decided here, where tests reach it.

import { effectiveEnd } from "./copy.ts";

export interface MyEventInput {
  startsAt: string;
  endsAt: string | null;
  withdrawn: boolean;
  openToMeeting: boolean;
  // Your group at this gathering, while you are in it.
  group: { state: "forming" | "spot_set" | "live" | "done" | "dissolved"; spot: string | null; meetAt: string | null } | null;
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

// Upcoming soonest first, past most recent first — dates, never anything else (Q10).
export function splitMyEvents<T extends Pick<MyEventInput, "startsAt" | "endsAt">>(rows: T[], now: Date): { upcoming: T[]; past: T[] } {
  const upcoming = rows.filter((r) => !isPast(r, now)).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const past = rows.filter((r) => isPast(r, now)).sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  return { upcoming, past };
}

// The read behind A19's rows — one string, so the policy harness runs exactly what the
// app runs (P193), as the person, under RLS.
export const MY_EVENTS_PINS_SELECT =
  "gathering_id, open_to_meeting, gatherings(slug, name, starts_at, ends_at, withdrawn_at, venues(name, cities(timezone)))";

// PROPOSED copy (Tatiana's to reword). The empty line is spec A19's own.
export const MY_EVENTS_COPY = {
  title: "My Events",
  upcoming: "Coming up",
  past: "Been",
  empty: "Nothing pinned yet",
  emptyLink: "This week’s crowds →",
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
