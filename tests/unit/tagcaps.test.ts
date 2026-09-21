// The tag picker's two caps (M3.1) — the half a person sees.
//
// **Written because they could not be**, which is the point. They lived inside a
// React Native component, so `node --test` could not load them, and the eleventh-tap
// refusal — which exists precisely so a tap never silently does nothing — had nothing
// proving it fires. P77 proves the database's half; this proves the screen's.
//
// CLAUDE.md, "A guard that never ran looks exactly like a guard that passed": a rule
// whose job is to refuse is proved by a test that makes it refuse.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  countOnList,
  enoughPicked,
  TAGS_AT_MAXIMUM,
  TAGS_LIST_FULL,
  TAGS_MAXIMUM,
  TAGS_MINIMUM,
  TAGS_ON_LIST,
  toggleOnList,
  toggleTag,
  type PickedTag,
} from "../../packages/shared/src/tags.ts";

const some = (n: number): PickedTag[] =>
  Array.from({ length: n }, (_, i) => ({ slug: `t${i}`, onList: i < TAGS_ON_LIST }));

describe("Picking tags", () => {
  it("T01 adds one, and tapping it again takes it off", () => {
    const one = toggleTag([], "chatty");
    assert.deepEqual(one.next, [{ slug: "chatty", onList: true }]);
    assert.equal(toggleTag(one.next, "chatty").next.length, 0);
  });

  it("T02 the first three land on the list, the fourth does not", () => {
    let picked: PickedTag[] = [];
    for (const slug of ["a", "b", "c", "d"]) picked = toggleTag(picked, slug).next;
    assert.equal(countOnList(picked), TAGS_ON_LIST);
    assert.equal(picked[3]!.onList, false, "a fourth tag put itself on the list");
  });
});

describe("The eleventh tap is refused, and says so", () => {
  it("T03 the cap holds, and the refusal carries a sentence", () => {
    // The whole reason this exists: a tap that does nothing looks broken.
    const full = some(TAGS_MAXIMUM);
    const refused = toggleTag(full, "one-more");
    assert.equal(refused.next.length, TAGS_MAXIMUM, "an eleventh tag got in");
    assert.equal(refused.says, TAGS_AT_MAXIMUM);
    assert.match(String(refused.says), new RegExp(String(TAGS_MAXIMUM)), "the sentence does not name the number");
  });

  it("T04 the boundary from the other side: the tenth is allowed", () => {
    // A cap proved only by what it blocks is half a cap.
    const nine = some(TAGS_MAXIMUM - 1);
    const tenth = toggleTag(nine, "number-ten");
    assert.equal(tenth.next.length, TAGS_MAXIMUM);
    assert.equal(tenth.says, undefined, "the tenth tag was told off");
  });

  it("T05 removing one makes room again — a cap, not a quota spent once", () => {
    const full = some(TAGS_MAXIMUM);
    const freed = toggleTag(full, full[0]!.slug).next;
    assert.equal(toggleTag(freed, "new-one").next.length, TAGS_MAXIMUM);
  });
});

describe("Only three show on the list, and it says so too", () => {
  it("T06 a fourth featured tag is refused with its own sentence", () => {
    const picked = some(5);
    const refused = toggleOnList(picked, "t3");
    assert.equal(countOnList(refused.next), TAGS_ON_LIST, "a fourth tag reached the list");
    assert.equal(refused.says, TAGS_LIST_FULL);
    // It must not read as "you have too many tags" — the tags are fine, the row is
    // full, and the rest are still on the profile.
    assert.match(String(refused.says), /still show on your profile/);
  });

  it("T07 taking one off the list lets another on", () => {
    const picked = some(5);
    const freed = toggleOnList(picked, "t0").next;
    assert.equal(countOnList(freed), TAGS_ON_LIST - 1);
    assert.equal(countOnList(toggleOnList(freed, "t3").next), TAGS_ON_LIST);
  });

  it("T08 a tag that is not picked cannot be featured", () => {
    const picked = some(1);
    assert.deepEqual(toggleOnList(picked, "never-picked").next, picked);
  });
});

describe("Enough picked", () => {
  it("T09 asks for three, and does not ask the database to", () => {
    // The minimum is the screen's rule only: the link path pins with none, so a
    // database minimum would make a pin impossible.
    assert.equal(enoughPicked(some(TAGS_MINIMUM - 1)), false);
    assert.equal(enoughPicked(some(TAGS_MINIMUM)), true);
    assert.equal(enoughPicked([]), false);
  });
});
