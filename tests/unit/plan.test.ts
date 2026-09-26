// Things the plan must not quietly drop (Alex, M3.2).
//
// M3.1's native walk was carried to M3.2's build and then to M3.2b's — waiting on a build
// two milestones after the work was done. A list carried that far is a list that can
// fall out of a section during an edit with nothing noticing. So its items are pinned
// here to the section that owns them, and so is M4.1's promise-by-promise check of the
// privacy page, which is what makes it safe that the page says something not yet built.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const plan = readFileSync("docs/build-plan.md", "utf8").replace(/\r\n/g, "\n");
function section(heading: string): string {
  const start = plan.indexOf(`#### ${heading}`);
  assert.ok(start >= 0, `no section "${heading}" in the build plan`);
  const next = plan.indexOf("\n#### ", start + 5);
  return plan.slice(start, next < 0 ? undefined : next);
}

describe("The build plan keeps what was carried", () => {
  it("D01 M3.2b holds the native walk: photo picker, HEIC, native Apple sign-in, airplane mode, native Apple at A27 — in its list AND its acceptance", () => {
    const m = section("M3.2b");
    const acceptance = m.slice(m.indexOf("**Acceptance**"));
    assert.ok(m.indexOf("**Acceptance**") > 0, "M3.2b has no acceptance list");
    for (const item of ["photo picker", "HEIC", "native Apple sign-in", "airplane mode", "native Apple at A27"]) {
      assert.ok(m.slice(0, m.indexOf("**Acceptance**")).includes(item), `M3.2b's list lost "${item}"`);
      assert.ok(acceptance.includes(item), `M3.2b's acceptance lost "${item}"`);
    }
    assert.ok(/universal links/i.test(m) && /one build covering both/i.test(m), "M3.2b lost the universal links / one build");
  });

  it("D02 M4.1's acceptance checks every privacy-page promise one line at a time, the rejected-photo deletion among them", () => {
    const m = section("M4.1");
    const acceptance = m.slice(m.indexOf("**Acceptance**"));
    assert.match(acceptance, /Every promise on the privacy page is true before the page is indexed/);
    assert.match(acceptance, /one line at a time/);
    assert.match(m, /rejected photo's immediate deletion and the 12-month purge/);
  });

  it("D03 the check can fail: a section missing an item is caught", () => {
    const planted = "#### X\n- photo picker\n\n**Acceptance**\n\n- nothing\n";
    const acceptance = planted.slice(planted.indexOf("**Acceptance**"));
    assert.ok(!acceptance.includes("photo picker"), "the acceptance slice cannot tell a missing item");
  });
});
