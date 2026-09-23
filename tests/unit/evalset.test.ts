// The labelled set refuses to score what is not there (M3.1, Alex).
//
// The first run read an empty labels.json, printed "agreed on 0 of 0" and exited
// clean. Each case here puts one kind of gap in front of the check and insists it is
// named — and E01 proves a whole set is let through, so the refusals mean something.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { problemsWithSet, runIsComplete, type Label } from "../../src/photo/evalset.ts";

const files = new Set(["a.jpg", "b.png", "notes.txt"]);
const good: Label[] = [
  { file: "a.jpg", expect: "approved" },
  { file: "b.png", expect: "needs_review" },
];

describe("The labelled set is whole before anything is scored", () => {
  it("E01 a whole set has no problems", () => {
    assert.deepEqual(problemsWithSet(good, files), []);
  });

  it("E02 an empty set is refused, not scored as 0 of 0", () => {
    assert.match(problemsWithSet([], files).join(), /no photos/);
  });

  it("E03 a listed file that is missing is refused, not skipped", () => {
    const p = problemsWithSet([...good, { file: "gone.jpg", expect: "approved" }], files);
    assert.deepEqual(p, ["gone.jpg: listed in labels.json but not in tests/photos"]);
  });

  it("E04 every problem is listed at once", () => {
    const p = problemsWithSet(
      [{ file: "gone.jpg", expect: "approved" }, { file: "notes.txt", expect: "approved" }, { file: "a.jpg", expect: "maybe" }],
      files,
    );
    assert.equal(p.length, 3);
  });

  it("E05 not a list, a duplicate, and an entry with no file are each refused", () => {
    assert.ok(problemsWithSet({}, files).length);
    assert.match(problemsWithSet([...good, good[0]!], files).join(), /listed twice/);
    assert.match(problemsWithSet([{ expect: "approved" }], files).join(), /no "file"/);
  });

  it("E06 a run with a photo that got no verdict is not a complete score", () => {
    assert.deepEqual(runIsComplete(good, new Map([["a.jpg", "approved"], ["b.png", "needs_review"]])), []);
    assert.equal(runIsComplete(good, new Map([["a.jpg", "approved"], ["b.png", "failed"]])).length, 1);
    assert.equal(runIsComplete(good, new Map([["a.jpg", "approved"]])).length, 1);
  });
});
