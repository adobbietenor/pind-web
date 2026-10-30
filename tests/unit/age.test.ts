// The 19+ rule's arithmetic (H8). A hard rule, so it gets the birthday edge tested
// from both sides rather than trusted.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ageOn, isOldEnough, MINIMUM_AGE } from "../../packages/shared/src/age.ts";

const on = (day: string) => new Date(`${day}T12:00:00Z`);

describe("Age on a day", () => {
  it("G01 the birthday itself counts, and the day before does not", () => {
    // The whole rule lives in this pair. Someone turning 19 today is 19.
    assert.equal(ageOn(21, 9, 2007, on("2026-09-21")), 19);
    assert.equal(ageOn(22, 9, 2007, on("2026-09-21")), 18);
  });

  it("G02 a birthday later in the year has not happened yet", () => {
    assert.equal(ageOn(31, 12, 2007, on("2026-09-21")), 18);
    assert.equal(ageOn(1, 1, 2007, on("2026-09-21")), 19);
  });

  it("G03 leap day is a real date; 31 February is not", () => {
    assert.equal(ageOn(29, 2, 2004, on("2026-09-21")), 22);
    assert.equal(ageOn(31, 2, 2000, on("2026-09-21")), null);
    assert.equal(ageOn(29, 2, 2005, on("2026-09-21")), null, "2005 was not a leap year");
    assert.equal(ageOn(31, 4, 2000, on("2026-09-21")), null);
  });

  it("G04 nonsense is null, and null is NOT old enough", () => {
    // "We cannot tell" must never be read as "old enough" — the failure this rule
    // exists to prevent is someone under 19 getting through, not a form annoying
    // someone.
    for (const bad of [[0, 1, 2000], [1, 0, 2000], [1, 13, 2000], [1, 1, 1800], [1, 1, 2030], [32, 1, 2000]]) {
      assert.equal(ageOn(bad[0]!, bad[1]!, bad[2]!, on("2026-09-21")), null, bad.join("/"));
    }
    assert.equal(isOldEnough(null), false);
  });

  it("G05 the threshold is 19 and it is inclusive", () => {
    assert.equal(MINIMUM_AGE, 19);
    assert.equal(isOldEnough(18), false);
    assert.equal(isOldEnough(19), true);
    assert.equal(isOldEnough(20), true);
  });
});

describe("The date-of-birth dropdowns (UI pass 1, 024)", () => {
  it("AG10 the years start at the youngest allowed age, and the 19+ stop still fires inside the first year", async () => {
    const { birthYears, daysIn } = await import("../../packages/shared/src/age.ts");
    const now = on("2026-10-30");
    const years = birthYears(now);
    assert.equal(years[0], 2007, "the newest year is not this year minus 19");
    assert.ok(!years.includes(2008), "a year that can only fail the 19+ check is offered");
    assert.equal(years.length, 100);
    // The first year listed is both sides of the boundary: born before today, 19; after, 18.
    assert.equal(isOldEnough(ageOn(29, 10, 2007, now)), true);
    assert.equal(isOldEnough(ageOn(31, 10, 2007, now)), false, "the list let an 18-year-old through");
    assert.equal(daysIn(2, 2004), 29);
    assert.equal(daysIn(2, 2005), 28);
    assert.equal(daysIn(0, null), 31);
  });
});
