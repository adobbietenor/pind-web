// The group's share card (M3.3, W3): the app's key and the Worker's match, normalised
// by one function; and the card only ever points at a real spot on the right day.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readShareCard, shareCardUrl, spotKey } from "../../packages/shared/src/share.ts";

const spots = [{ name: "The Bier Markt" }, { name: "Café Rouge" }];
const g = { starts_at: "2026-10-02T23:00:00Z", effective_end: "2026-10-03T02:00:00Z" };
const read = (url: string) => readShareCard(spots, new URL(url).searchParams, g);

describe("share card", () => {
  it("H01 names that differ only in spacing, case or accents give one key", () => {
    assert.equal(spotKey("  The Bier  Markt "), spotKey("the bier markt"));
    assert.equal(spotKey("Café Rouge"), spotKey("CAFE ROUGE"));
    assert.notEqual(spotKey("The Bier Markt"), spotKey("Café Rouge"));
  });
  it("H02 the app's link leads with its spot and time on the Worker's side", () => {
    const r = read(shareCardUrl("https://pind.social", "x", "Café Rouge", "2026-10-02T22:00:00Z"));
    assert.equal(r.spot?.name, "Café Rouge");
    assert.equal(r.meetAt, "2026-10-02T22:00:00.000Z");
  });
  it("H03 a spot that is not this gathering's is refused", () => {
    assert.equal(read("https://p/g/x/spot?at=somewhere-else").spot, null);
  });
  it("H04 a time off the gathering's day is refused, and one on it is kept", () => {
    assert.equal(read("https://p/g/x/spot?at=cafe-rouge&t=2026-12-25T20:00Z").meetAt, null);
    assert.equal(read("https://p/g/x/spot?at=cafe-rouge&t=garbage").meetAt, null);
    assert.ok(read("https://p/g/x/spot?at=cafe-rouge&t=2026-10-02T22:00Z").meetAt);
  });
  it("H05 the link carries no group and no person", () => {
    const u = new URL(shareCardUrl("https://pind.social", "x", "Café Rouge", "2026-10-02T22:00:00Z"));
    assert.deepEqual([...u.searchParams.keys()].sort(), ["at", "t"]);
  });
});
