// A19 — My Events (M3.2b; Alex, 10 Oct 2026: the room era's reading, no new toggle).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { myEventStatus, splitMyEvents, type MyEventInput } from "../../packages/shared/src/myevents.ts";

const now = new Date("2026-10-10T18:00:00Z");
const at = (h: number) => new Date(now.getTime() + h * 3_600_000).toISOString();
const base: MyEventInput = { startsAt: at(24), endsAt: null, withdrawn: false, openToMeeting: false, group: null, after: null };

describe("A19 says where you stand at each gathering", () => {
  it("M01 upcoming: your group's spot and time when set; forming; open to meeting; pinned", () => {
    assert.deepEqual(myEventStatus({ ...base, group: { state: "spot_set", spot: "North gate", meetAt: at(23) } }, now), { kind: "group-set", spot: "North gate", meetAt: at(23) });
    assert.deepEqual(myEventStatus({ ...base, group: { state: "live", spot: "North gate", meetAt: at(23) } }, now).kind, "group-set");
    assert.equal(myEventStatus({ ...base, group: { state: "forming", spot: null, meetAt: null } }, now).kind, "group-forming");
    assert.equal(myEventStatus({ ...base, openToMeeting: true }, now).kind, "open");
    assert.equal(myEventStatus(base, now).kind, "pinned");
  });

  it("M02 a group that closed is no group; a withdrawn gathering says so before anything else", () => {
    assert.equal(myEventStatus({ ...base, openToMeeting: true, group: { state: "dissolved", spot: null, meetAt: null } }, now).kind, "open");
    assert.equal(myEventStatus({ ...base, withdrawn: true, group: { state: "spot_set", spot: "x", meetAt: at(23) } }, now).kind, "withdrawn");
  });

  it("M03 past: how many you ticked 'we met'; a prompt only while ticks are open and you were in a group; otherwise nothing", () => {
    const past = { ...base, startsAt: at(-30) };
    assert.deepEqual(myEventStatus({ ...past, after: { weMet: 2, open: true } }, now), { kind: "met", n: 2 });
    assert.equal(myEventStatus({ ...past, group: null, after: { weMet: 0, open: true } }, now).kind, "tick", "A16's 'open' (true only with a group) did not prompt");
    assert.equal(myEventStatus({ ...past, group: null, after: { weMet: 0, open: false } }, now).kind, "past", "someone in no group was prompted to tick");
    assert.equal(myEventStatus({ ...past, after: null }, now).kind, "past");
    assert.equal(myEventStatus({ ...past, group: { state: "done", spot: null, meetAt: null }, after: { weMet: 0, open: false } }, now).kind, "past");
  });

  it("M04 past is decided by the effective end (starts + 180 min with no end): 2 h after the start is still upcoming", () => {
    assert.equal(myEventStatus({ ...base, startsAt: at(-2), openToMeeting: true }, now).kind, "open");
    assert.equal(myEventStatus({ ...base, startsAt: at(-4) }, now).kind, "past");
    assert.equal(myEventStatus({ ...base, startsAt: at(-4), endsAt: at(1) }, now).kind, "pinned", "an explicit end was ignored");
  });

  it("M05 upcoming soonest first, past most recent first — by date only", () => {
    const rows = [{ startsAt: at(48), endsAt: null }, { startsAt: at(-50), endsAt: null }, { startsAt: at(5), endsAt: null }, { startsAt: at(-10), endsAt: null }];
    const { upcoming, past } = splitMyEvents(rows, now);
    assert.deepEqual(upcoming.map((r) => r.startsAt), [at(5), at(48)]);
    assert.deepEqual(past.map((r) => r.startsAt), [at(-10), at(-50)]);
  });

  it("M06 the screen decides each line through myEventStatus and reads its pins fresh on every visit", () => {
    const screen = readFileSync("app/src/app/(tabs)/my-events.tsx", "utf8");
    assert.match(screen, /myEventStatus\(/, "My Events decides its lines some other way");
    assert.match(screen, /useFocusEffect\(/, "My Events does not re-read on focus — a removed pin would stay listed");
    assert.match(screen, /A19/, "the screen does not name its board ID");
  });
});
