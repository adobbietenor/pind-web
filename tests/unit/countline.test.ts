// The two numbers read one way on W2, A26's confirmation and A9 (Alex, M3.2), and the next
// step is the real one: the room at 2, going together at 3 (#14, 29 Oct 2026).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { countLine } from "../../packages/shared/src/copy.ts";
import { GO_TOGETHER_AT, ROOM_OPENS_AT } from "../../packages/shared/src/constants.ts";

describe("countLine — one wording for the counts everywhere", () => {
  it("C09 nobody going at all: an invitation, never a bare zero (M2.3)", () => {
    assert.deepEqual(countLine(0, 0), { line: "Nobody’s pinned yet — be the first", next: null });
  });
  it("C10 nobody open: says so, because that is where someone could be first", () => {
    assert.deepEqual(countLine(23, 0), { line: "23 going · nobody open to meeting yet", next: null });
  });
  it("C11 one open: one more and the room opens", () => {
    assert.deepEqual(countLine(23, 1), { line: "23 going · 1 open to meeting", next: "1 more and the room opens" });
  });
  it("C12 two open: the room is open; one more and there's enough to go together", () => {
    assert.deepEqual(countLine(23, 2), { line: "23 going · 2 open to meeting", next: "1 more and there’s enough to go together" });
  });
  it("C13 three or more: just the numbers — and never the retired crews line", () => {
    for (const open of [3, 4, 5, 17]) {
      const c = countLine(23, open);
      assert.equal(c.next, null, `${open} open still has a next step`);
      assert.doesNotMatch(c.line, /crew/i);
    }
    for (const open of [1, 2]) assert.doesNotMatch(countLine(23, open).next ?? "", /crew/i, "the retired crew design is back in the count");
  });
});

describe("The room's number is the database's (#14)", () => {
  it("C16 my_rooms opens a room at ROOM_OPENS_AT — read from the migration, not assumed", () => {
    const dir = "supabase/migrations";
    const defs = readdirSync(dir)
      .sort()
      .map((f) => readFileSync(`${dir}/${f}`, "utf8"))
      .filter((sql) => /function public\.my_rooms\b/.test(sql));
    assert.ok(defs.length > 0, "no migration defines my_rooms — this check would prove nothing");
    const latest = defs.at(-1)!;
    const n = /c\.n >= (\d+)\s*(?:,|\n|$)/.exec(latest)?.[1];
    assert.ok(n, "cannot see the open rule in my_rooms — the pattern must match something real");
    assert.equal(Number(n), ROOM_OPENS_AT, "the app says the room opens at one number and the database at another");
    assert.equal(GO_TOGETHER_AT, ROOM_OPENS_AT + 1);
  });
});
