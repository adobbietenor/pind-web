// #18 — an ended event says so, and offers each chat by its phase (Alex, 29 Oct 2026).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ENDED_COPY, endedChats, endedPhase, lastDayCloses, MY_CHATS_COPY } from "../../packages/shared/src/myevents.ts";
import { ROOM_COPY } from "../../packages/shared/src/room.ts";

const HOUR = 3_600_000;
// Starts at 19:00 UTC, ends at 22:00 UTC: effective end 22:00.
const ev = { startsAt: "2026-10-20T19:00:00.000Z", endsAt: "2026-10-20T22:00:00.000Z" };
const end = Date.parse(ev.endsAt);
const at = (msAfterEnd: number) => new Date(end + msAfterEnd);
const chatsOf = (over: Partial<Parameters<typeof endedChats>[0]> = {}) => ({
  ...ev,
  rooms: [
    { roomId: "r1", womenOnly: false, members: 4, open: true, last: null, unread: 0 },
    { roomId: "r2", womenOnly: true, members: 1, open: false, last: null, unread: 0 },
  ],
  crews: [
    { crewId: "c1", kind: "crew" as const, name: "Dog & Bear first", legacy: false, state: "done", spot: null, meetAt: null, partner: null, last: null, unread: 0 },
    { crewId: "c2", kind: "solo" as const, name: null, legacy: false, state: "done", spot: null, meetAt: null, partner: "Sam", last: null, unread: 0 },
  ],
  ...over,
});

describe("An ended event's phases (#18)", () => {
  it("EN01 the last day is writable for 24 h after the effective end — both sides of the boundary", () => {
    assert.equal(endedPhase(ev, at(1)), "last-day");
    assert.equal(endedPhase(ev, at(24 * HOUR - 1)), "last-day");
    assert.equal(endedPhase(ev, at(24 * HOUR)), "read-only");
    assert.equal(lastDayCloses(ev), new Date(end + 24 * HOUR).toISOString());
  });

  it("EN02 read-only for 30 days after that, then cleared — both sides of the boundary", () => {
    assert.equal(endedPhase(ev, at(24 * HOUR + 30 * 24 * HOUR - 1)), "read-only");
    assert.equal(endedPhase(ev, at(24 * HOUR + 30 * 24 * HOUR)), "cleared");
  });

  it("EN03 no end time: the effective end is the start + 180 min, as everywhere else", () => {
    const noEnd = { startsAt: ev.startsAt, endsAt: null };
    const eff = Date.parse(ev.startsAt) + 180 * 60_000;
    assert.equal(endedPhase(noEnd, new Date(eff + 24 * HOUR - 1)), "last-day");
    assert.equal(endedPhase(noEnd, new Date(eff + 24 * HOUR)), "read-only");
  });

  it("EN04 the chats listed: rooms that opened (never a room of one), then the squad by its name, then the 1-on-1 by partner — none once cleared", () => {
    assert.deepEqual(endedChats(chatsOf(), at(HOUR)), [
      { kind: "room", id: "r1", label: MY_CHATS_COPY.everyoneGoing },
      { kind: "crew", id: "c1", label: "Dog & Bear first" },
      { kind: "crew", id: "c2", label: MY_CHATS_COPY.plan("Sam") },
    ]);
    assert.deepEqual(endedChats(chatsOf(), at(32 * 24 * HOUR)), [], "cleared chats are still offered");
    assert.deepEqual(endedChats(chatsOf({ rooms: [], crews: [] }), at(HOUR)), []);
  });

  it("EN05 the ended card never borrows the room's first-here promise", () => {
    const words = Object.values(ENDED_COPY).map((v) => (typeof v === "function" ? (v as (x: string) => string)("Wednesday at 10:00 p.m.") : v)).join(" ");
    assert.doesNotMatch(words, new RegExp(ROOM_COPY.firstHeading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    assert.doesNotMatch(words, /we'll tell you/i);
  });
});

describe("A9 checks the end before anything about the room (#18)", () => {
  const a9 = readFileSync("app/src/app/crowd/[slug].tsx", "utf8");

  it("EN06 the ended branch comes before both pinned branches, so no first-here card, squad or 1-on-1 list is reachable after the end", () => {
    const endedAt = a9.indexOf(") : ended ? (");
    const notOpenAt = a9.indexOf(") : !view.mine.open ? (");
    const firstHereAt = a9.indexOf("ROOM_COPY.firstHeading");
    assert.ok(endedAt > 0 && notOpenAt > 0 && firstHereAt > 0, "cannot find A9's branches — the pattern must match something real");
    assert.ok(endedAt < notOpenAt && endedAt < firstHereAt, "an ended event can reach the room's or the not-open card again");
    assert.match(a9.slice(endedAt, notOpenAt), /<EndedEvent gatheringId=\{g\.id\} slug=\{slug\} \/>/, "the ended branch does not draw EndedEvent");
  });
});
