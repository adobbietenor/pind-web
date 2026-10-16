// The thread on the phone — the room (A10), a squad (A11), a 1-on-1 plan (A29) — merged
// one row at a time (the thread pass, 16 Oct 2026). Every rule here exists to refuse or
// reconcile something, so every test puts the thing in front of the rule and insists on
// the outcome — and where a rule has a boundary, both sides of it.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  firstPage,
  newestConfirmed,
  recheckWindow,
  THREAD_PAGE,
  threadMessage,
  withConfirmed,
  withFailed,
  withFreshPage,
  withIncoming,
  withOlder,
  withRecheck,
  withSending,
  without,
  type ThreadRow,
  type ThreadState,
} from "../../packages/shared/src/thread.ts";

const ME = "me-person";
const at = (s: number, micro = "") => `2026-10-16T20:00:${String(s).padStart(2, "0")}.000${micro}+00:00`;
const row = (id: string, s: number, author = "bea", body = `words ${id}`): ThreadRow => ({ id, author_id: author, body, created_at: at(s) });
const ids = (s: ThreadState) => s.messages.map((m) => m.id);
const state = (...rows: ThreadRow[]): ThreadState => firstPage([...rows].reverse());

describe("A thread holds what the database sent, in order, once", () => {
  it("TH01 the first page is the newest PAGE, oldest first, and knows whether there is more", () => {
    const newestFirst = Array.from({ length: THREAD_PAGE + 1 }, (_, i) => row(`m${THREAD_PAGE - i}`, 0)).map((r, i) => ({ ...r, created_at: new Date(Date.UTC(2026, 9, 16, 20) + (THREAD_PAGE - i) * 1000).toISOString() }));
    const s = firstPage(newestFirst);
    assert.equal(s.messages.length, THREAD_PAGE);
    assert.equal(s.messages[0].id, "m1", "the oldest held is the 50th newest, not the 51st");
    assert.equal(s.messages.at(-1)?.id, `m${THREAD_PAGE}`);
    assert.equal(s.hasOlder, true, "a 51st row means there is history");
    assert.equal(firstPage(newestFirst.slice(0, THREAD_PAGE)).hasOlder, false, "exactly a page means there is none");
  });

  it("TH02 a Realtime row is appended without a read — and the same row twice is held once", () => {
    const s = withIncoming(state(row("a", 1), row("b", 2)), [row("c", 3)], ME);
    assert.deepEqual(ids(s), ["a", "b", "c"]);
    const again = withIncoming(s, [row("c", 3)], ME);
    assert.equal(again, s, "a repeat changes nothing — not even the object, so nothing re-renders");
  });

  it("TH03 rows that arrive out of order are put in time order; a microsecond decides within a millisecond", () => {
    const s = withIncoming(state(row("a", 1)), [row("late", 5), row("early", 3)], ME);
    assert.deepEqual(ids(s), ["a", "early", "late"]);
    const sameMs = withIncoming(state(), [{ id: "z2", author_id: "bea", body: "x", created_at: at(9, "52") }, { id: "z1", author_id: "bea", body: "y", created_at: at(9, "5") }], ME);
    assert.deepEqual(ids(sameMs), ["z1", "z2"], ".0005 comes before .00052, though Date.parse sees one time");
  });

  it("TH04 a group's system line and a payload without its columns are never shown", () => {
    assert.equal(threadMessage({ ...row("s", 1), kind: "system" }), null);
    assert.equal(threadMessage({ id: "x", created_at: at(1) }), null, "no body: refused, not shown blank");
    assert.notEqual(threadMessage({ ...row("u", 1), kind: "user" }), null, "a person's line in a group is shown");
    assert.deepEqual(ids(withIncoming(state(row("a", 1)), [{ ...row("s", 2), kind: "system" }], ME)), ["a"]);
  });

  it("TH05 an older page goes before what is held, a repeat at the boundary is dropped, and the last page says so", () => {
    const s = withOlder(state(row("c", 3), row("d", 4)), [row("c", 3), row("b", 2), row("a", 1)]);
    assert.deepEqual(ids(s), ["a", "b", "c", "d"], "the held oldest, read again by `lte`, is held once");
    assert.equal(s.hasOlder, false);
  });
});

describe("Send: on screen at once, confirmed by the database, or plainly not sent", () => {
  const sending = (s: ThreadState, body = "hello") => withSending(s, { localId: "local:1", authorId: ME, body, at: new Date().toISOString() });

  it("TH06 pressing Send shows the message before any answer, marked as sending, after everything confirmed", () => {
    const s = sending(state(row("a", 1)));
    assert.deepEqual(ids(s), ["a", "local:1"]);
    assert.equal(s.messages[1].status, "sending");
    // A row from someone else that arrives meanwhile goes above mine in flight, not below.
    assert.deepEqual(ids(withIncoming(s, [row("b", 2)], ME)), ["a", "b", "local:1"]);
  });

  it("TH07 the insert's answer replaces the sending copy with the real row", () => {
    const s = withConfirmed(sending(state(row("a", 1))), "local:1", row("real", 2, ME, "hello"));
    assert.deepEqual(ids(s), ["a", "real"]);
    assert.equal(s.messages[1].status, undefined);
  });

  it("TH08 my own row over Realtime BEFORE the insert answers takes the sending copy's place — never shown twice", () => {
    const echoed = withIncoming(sending(state(row("a", 1))), [row("real", 2, ME, "hello")], ME);
    assert.deepEqual(ids(echoed), ["a", "real"], "the echo replaced the sending copy");
    const answered = withConfirmed(echoed, "local:1", row("real", 2, ME, "hello"));
    assert.deepEqual(ids(answered), ["a", "real"], "the late answer adds nothing");
  });

  it("TH09 an echo only takes the place of MY message with the SAME words", () => {
    const s = sending(state(row("a", 1)));
    assert.deepEqual(ids(withIncoming(s, [row("x", 2, "bea", "hello")], ME)), ["a", "x", "local:1"], "someone else's same words are theirs");
    assert.deepEqual(ids(withIncoming(s, [row("y", 2, ME, "something else")], ME)), ["a", "y", "local:1"], "my other words are another message");
  });

  it("TH10 a refusal marks it failed and keeps it on screen; nothing re-sends it, and taking it back removes it", () => {
    const failed = withFailed(sending(state(row("a", 1))), "local:1");
    assert.equal(failed.messages.at(-1)?.status, "failed");
    assert.deepEqual(ids(failed), ["a", "local:1"]);
    assert.deepEqual(ids(without(failed, "local:1")), ["a"]);
    assert.equal(withFailed(state(row("a", 1)), "a").messages[0].status, undefined, "a confirmed message can never be marked failed");
  });

  it("TH11 an answer lost after the insert went through: the echo clears the failed copy", () => {
    const failed = withFailed(sending(state()), "local:1");
    assert.deepEqual(ids(withIncoming(failed, [row("real", 3, ME, "hello")], ME)), ["real"]);
  });

  it("TH12 the 'since' cursor is the newest CONFIRMED message — never mine in flight", () => {
    const s = sending(state(row("a", 1), row("b", 2)));
    assert.equal(newestConfirmed(s), at(2));
    assert.equal(newestConfirmed(sending(state())), null, "nothing confirmed: no cursor, read the page");
  });

  it("TH13 a fresh page after a long gap replaces what is held but keeps mine in flight", () => {
    const s = sending(state(row("old", 1)));
    const fresh = withFreshPage(s, [row("n2", 9), row("n1", 8)], ME);
    assert.deepEqual(ids(fresh), ["n1", "n2", "local:1"]);
    const confirmed = withFreshPage(s, [row("mine", 9, ME, "hello"), row("n1", 8)], ME);
    assert.deepEqual(ids(confirmed), ["n1", "mine"], "the page already holds my message: the sending copy goes");
  });
});

describe("A removal is never broadcast, so a recheck finds it — and only within what it read", () => {
  it("TH14 a message held in the window and no longer readable is dropped", () => {
    const s = state(row("a", 1), row("b", 2), row("c", 3));
    const w = recheckWindow(s)!;
    assert.deepEqual(w, { from: at(1), to: at(3) });
    assert.deepEqual(ids(withRecheck(s, w, ["a", "c"])), ["a", "c"]);
  });

  it("TH15 a message newer than the window survives a recheck that could not have seen it", () => {
    const s = state(row("a", 1), row("b", 2));
    const w = recheckWindow(s)!;
    const meanwhile = withIncoming(s, [row("new", 4)], ME);
    assert.deepEqual(ids(withRecheck(meanwhile, w, ["a", "b"])), ["a", "b", "new"], "arrived after the read: not the read's to judge");
    const sameMs = withIncoming(s, [{ ...row("edge", 0), created_at: at(2, "7") }], ME);
    assert.deepEqual(ids(withRecheck(sameMs, w, ["a", "b"])), ["a", "b", "edge"], "a microsecond past the window's end is past it");
  });

  it("TH16 older than the window survives too, and so does mine in flight", () => {
    const many = state(...Array.from({ length: 30 }, (_, i) => row(`m${i}`, i)));
    const w = recheckWindow(many, 10)!;
    assert.equal(w.from, at(20));
    const after = withRecheck(many, w, []);
    assert.equal(after.messages.length, 20, "the ten it read are gone; the twenty before them are not its to judge");
    const inFlight = withSending(state(row("a", 1)), { localId: "local:9", authorId: ME, body: "hi", at: at(5) });
    assert.deepEqual(ids(withRecheck(inFlight, recheckWindow(inFlight)!, [])), ["local:9"]);
  });

  it("TH17 a recheck that finds everything still there changes nothing", () => {
    const s = state(row("a", 1), row("b", 2));
    assert.equal(withRecheck(s, recheckWindow(s)!, ["a", "b"]), s);
    assert.equal(recheckWindow(state()), null, "an empty thread has nothing to recheck");
  });
});
