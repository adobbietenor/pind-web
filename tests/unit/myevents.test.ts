// A19 — My Events (M3.2b; Alex, 10 Oct 2026: the room era's reading, no new toggle).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chatPreview, chatsKept, chatsReadOnly, chatWhen, isTonight, myEventStatus, orderMyChats, readMyChats, splitMyEvents, unreadTotal, type MyEventInput } from "../../packages/shared/src/myevents.ts";

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

describe("A19 as the home for your chats (Alex, 16 Oct 2026)", () => {
  // now = 2026-10-10 18:00 UTC = 14:00 in Toronto.
  const tz = "America/Toronto";
  const row = (o: Record<string, unknown> = {}) => ({
    gathering_id: "g1", slug: "g-one", name: "The Night", venue: "The Hall", timezone: tz,
    starts_at: at(4), ends_at: null, withdrawn: false, open_to_meeting: true, after: null,
    rooms: [{ room_id: "r1", number: 1, women_only: false, members: 4, open: true, unread: 3, last: { body: "see  you\nthere", at: at(-1), author_id: "p2", mine: false, author: "Bea" } }],
    crews: [
      { crew_id: "c1", kind: "crew", name: "Early birds", legacy: false, state: "spot_set", spot: "North gate", meet_at: at(3), partner: null, unread: 2, last: null },
      { crew_id: "c2", kind: "solo", name: null, legacy: false, state: "spot_set", spot: "Bar", meet_at: at(3.5), partner: "Cal", unread: 0, last: { body: "on my way", at: at(-0.5), author_id: "me", mine: true, author: "Ari" } },
    ],
    open_squads: [{ crew_id: "c3", name: "Pints first", women_only: false, spot: null, meet_at: at(3), seats: 3, full: false }],
    ...o,
  });

  it("M07 my_chats' answer is read in full — rooms, my squad and plan (keyed apart), open squads, and the plan lines myEventStatus needs", () => {
    const [e] = readMyChats([row()]);
    assert.equal(e.rooms[0].unread, 3);
    assert.equal(e.crews.length, 2);
    assert.deepEqual(e.group, { state: "spot_set", spot: "North gate", meetAt: at(3) }, "the squad is not the group line");
    assert.deepEqual(e.solo, { state: "spot_set", spot: "Bar", meetAt: at(3.5) }, "the 1-on-1 plan is not its own line — one over the other");
    assert.equal(e.openSquads[0].name, "Pints first");
    assert.equal(myEventStatus(e, now).kind, "group-set");
  });

  it("M08 a field the database leaves out is an empty list or null — never a crash on the night", () => {
    const [e] = readMyChats([{ gathering_id: "g", slug: "s", starts_at: at(4) }]);
    assert.deepEqual([e.rooms, e.crews, e.openSquads], [[], [], []]);
    assert.equal(e.group, null);
    assert.equal(e.timezone, "America/Toronto");
    assert.deepEqual(readMyChats(null), []);
    assert.equal(readMyChats([row({ rooms: [{ room_id: "r", last: { body: 5 } }] })])[0].rooms[0].last, null, "a half-empty last message is no message");
  });

  it("M09 tonight: later today where it happens, or under way — and not tomorrow, and not once it has ended", () => {
    assert.equal(isTonight({ startsAt: at(5), endsAt: null, timezone: tz }, now), true, "19:00 Toronto, today");
    assert.equal(isTonight({ startsAt: at(-1), endsAt: null, timezone: tz }, now), true, "under way");
    // 18:00 UTC is 14:00 in Toronto: 23:00 Toronto is still today, 01:00 Toronto is tomorrow.
    assert.equal(isTonight({ startsAt: at(9), endsAt: null, timezone: tz }, now), true);
    assert.equal(isTonight({ startsAt: at(11), endsAt: null, timezone: tz }, now), false, "after midnight where it happens is not tonight");
    assert.equal(isTonight({ startsAt: at(-4), endsAt: null, timezone: tz }, now), false, "ended an hour ago (start + 3 h)");
  });

  it("M10 the order: tonight on top, then soonest first; past newest first", () => {
    const rows = [{ startsAt: at(48), endsAt: null, timezone: tz }, { startsAt: at(5), endsAt: null, timezone: tz }, { startsAt: at(-30), endsAt: null, timezone: tz }, { startsAt: at(24), endsAt: null, timezone: tz }, { startsAt: at(-80), endsAt: null, timezone: tz }];
    const { tonight, upcoming, past } = orderMyChats(rows, now);
    assert.deepEqual(tonight.map((r) => r.startsAt), [at(5)]);
    assert.deepEqual(upcoming.map((r) => r.startsAt), [at(24), at(48)]);
    assert.deepEqual(past.map((r) => r.startsAt), [at(-30), at(-80)]);
  });

  it("M11 Q11 at both edges: writable until 24 h after the end, read-only after; kept until 30 days after that, gone after", () => {
    const ended = (h: number) => ({ startsAt: at(-3 - h), endsAt: null }); // the effective end was h hours ago
    assert.equal(chatsReadOnly(ended(23.9), now), false);
    assert.equal(chatsReadOnly(ended(24), now), true);
    assert.equal(chatsKept(ended(24 + 30 * 24 - 0.1), now), true);
    assert.equal(chatsKept(ended(24 + 30 * 24), now), false);
  });

  it("M12 the tab's dot counts my chats' unread — rooms, squad and plan — and never an open squad", () => {
    const events = readMyChats([row(), row({ gathering_id: "g2", rooms: [], crews: [] })]);
    assert.equal(unreadTotal(events), 3 + 2 + 0);
    assert.equal(unreadTotal(readMyChats([row({ rooms: [], crews: [] })])), 0, "an open squad alone lit the dot");
  });

  it("M13 the preview: 'You: …' for mine, the name for theirs, 'Someone' when the name is not mine to see, one line", () => {
    const [e] = readMyChats([row()]);
    assert.equal(chatPreview(e.rooms[0].last, "nothing"), "Bea: see you there");
    assert.equal(chatPreview(e.crews[1].last, "nothing"), "You: on my way");
    assert.equal(chatPreview({ body: "hi", at: at(0), authorId: "x", mine: false, author: null }, "nothing"), "Someone: hi");
    assert.equal(chatPreview(null, "Nobody's said anything yet"), "Nobody's said anything yet");
  });

  it("M14 a chat's time: the clock today, the weekday this week, the date before that", () => {
    assert.match(chatWhen(at(-1), tz, now), /1:00/);
    assert.match(chatWhen(at(-48), tz, now), /^[A-Z][a-z]{2}/);
    assert.match(chatWhen(at(-24 * 10), tz, now), /\d/);
    assert.doesNotMatch(chatWhen(at(-24 * 10), tz, now), /:/);
  });

  it("M15 the screen loads in one call, and the tab's dot reads that same call", () => {
    const lib = readFileSync("app/src/lib/myevents.ts", "utf8").replace(/^\s*\/\/.*$/gm, "");
    assert.equal((lib.match(/\.rpc\(/g) ?? []).length, 1, "My Events makes more than one call");
    assert.match(lib, /\.rpc\("my_chats"\)/);
    assert.doesNotMatch(lib, /\.from\(/, "My Events reads a table beside its one call");
    const screen = readFileSync("app/src/app/(tabs)/my-events.tsx", "utf8").replace(/^\s*\/\/.*$/gm, "");
    assert.match(screen, /queryKey: MY_CHATS_KEY, queryFn: loadMyChats/);
    assert.doesNotMatch(screen, /supabase\(\)|\.rpc\(|\.from\(/, "the screen reads something itself");
    const tabs = readFileSync("app/src/app/(tabs)/_layout.tsx", "utf8");
    assert.match(tabs, /queryKey: MY_CHATS_KEY, queryFn: loadMyChats/, "the dot reads a different query — a second call");
    assert.match(tabs, /unreadTotal\(chats\.data\)/);
  });

  it("M16 the inbox's order under an event: the Meeting Room (round 3), then my squad, then my 1-on-1; no join from here; pinned-only leads to A27", () => {
    // UI pass 1 (107): one row per chat. The open squads to join left My Events for the
    // crowd page (A15); a join here would be a second way to do one thing.
    const screen = readFileSync("app/src/app/(tabs)/my-events.tsx", "utf8").replace(/^\s*\/\/.*$/gm, "");
    const at = (s: string) => screen.indexOf(s);
    const order = ['kind: "room"', "for (const c of [squad, plan])"].map(at);
    assert.ok(order.every((i) => i > 0) && order[0] < order[1], "the rows under an event are out of order");
    assert.match(screen, /const squad = e\.crews\.find\(\(c\) => c\.kind === "crew"\);\s*const plan = e\.crews\.find\(\(c\) => c\.kind === "solo"\);/);
    assert.doesNotMatch(screen, /joinSquad|openSquads/, "My Events offers a join again");
    assert.match(screen, /!e\.openToMeeting\s*\?\s*\{ pathname: "\/opt-in\/\[slug\]"/, "pinned but not open to meeting has no way to opt in");
  });
});
