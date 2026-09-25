// The two numbers read one way on W2, A26's confirmation and A9 (Alex, M3.2).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { countLine } from "../../packages/shared/src/copy.ts";

describe("countLine — one wording for the counts everywhere", () => {
  it("C09 nobody going at all: an invitation, never a bare zero (M2.3)", () => {
    assert.deepEqual(countLine(0, 0, 5), { line: "Nobody’s pinned yet — be the first", crews: null });
  });
  it("C10 nobody open: says so, because that is where someone could be first", () => {
    assert.deepEqual(countLine(23, 0, 5), { line: "23 going · nobody open to meeting yet", crews: null });
  });
  it("C11 one or two open: the two numbers, no progress wording yet", () => {
    assert.deepEqual(countLine(23, 1, 5), { line: "23 going · 1 open to meeting", crews: null });
    assert.deepEqual(countLine(23, 2, 5), { line: "23 going · 2 open to meeting", crews: null });
  });
  it("C12 three or four open: the crews line, because it is now worth saying", () => {
    assert.deepEqual(countLine(23, 3, 5), { line: "23 going · 3 open to meeting", crews: "2 more and crews form" });
    assert.deepEqual(countLine(23, 4, 5), { line: "23 going · 4 open to meeting", crews: "1 more and crews form" });
  });
  it("C13 five or more: just the numbers — no '0 to go', no progress", () => {
    assert.deepEqual(countLine(23, 5, 5), { line: "23 going · 5 open to meeting", crews: null });
    assert.deepEqual(countLine(23, 17, 5), { line: "23 going · 17 open to meeting", crews: null });
  });
});
