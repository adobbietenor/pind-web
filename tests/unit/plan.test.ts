// Things the plan must not quietly drop (Alex, M3.2).
//
// M3.1's native walk was carried to M3.2's build, then to M3.2b's, then to the build's own
// milestone, M3.3b (Alex, 6 Oct 2026) — waiting on a build milestones after the work was done. A list carried that far is a list that can
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
  it("D01 M3.3b holds the native walk: photo picker, HEIC, native Apple sign-in, airplane mode, native Apple at A27 — in its list AND its acceptance", () => {
    const m = section("M3.3b");
    const acceptance = m.slice(m.indexOf("**Acceptance**"));
    assert.ok(m.indexOf("**Acceptance**") > 0, "M3.3b has no acceptance list");
    for (const item of ["photo picker", "HEIC", "native Apple sign-in", "airplane mode", "native Apple at A27"]) {
      assert.ok(m.slice(0, m.indexOf("**Acceptance**")).includes(item), `M3.3b's list lost "${item}"`);
      assert.ok(acceptance.includes(item), `M3.3b's acceptance lost "${item}"`);
    }
    assert.ok(/universal links/i.test(m) && /one build covering/i.test(m), "M3.3b lost the universal links / one build");
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

  it("D05 the TestFlight build comes after M3.3 and before M3.2b (Alex, 6 Oct 2026), and carries push and the icon", () => {
    const m = section("M3.3b");
    assert.match(m, /The order: M3\.3 → this build → M3\.2b/);
    for (const item of ["M3.1's native list", "universal links", "M3.3's push", "icon and splash"]) assert.ok(m.includes(item), `M3.3b's build lost "${item}"`);
    assert.doesNotMatch(section("M3.2b"), /- \*\*No TestFlight build until M3\.2b is done/, "M3.2b still says the build waits for it");
  });

  it("D06 the app's home (A5–A7) moved from M3.2b to M3.3c with the city picker (Alex, 6 Oct 2026); interests, search and My Events stay in M3.2b", () => {
    const c = section("M3.3c");
    for (const item of ["A5", "A6/A7", "cities.ts", "public_gatherings", "P185"]) assert.ok(c.includes(item), `M3.3c lost "${item}"`);
    const b = section("M3.2b");
    assert.doesNotMatch(b, /^- A5–A7 home from published gatherings/m, "M3.2b still builds the home list");
    for (const item of ["Interests, remembered", "Search", "A19 My Events"]) assert.ok(b.includes(item), `M3.2b lost "${item}"`);
  });

  it("D07 'Add an event' has its milestone, M4.6, carrying both of Alex's hard rules and its own check (6 Oct 2026)", () => {
    const m = section("M4.6");
    assert.match(m, /nothing publishes without Alex's approval/i, "M4.6 lost the approval gate");
    assert.match(m, /less than 24 hours before it starts/i, "M4.6 lost the 24-hour floor");
    assert.match(m, /Its own check, not the rubric/, "M4.6 lost 'scoring is not moderation'");
  });

  it("D04 M3.6 holds M3.3's three deferrals by name: seeing and switching rooms, groups growing, the manual 'Set spot & time'", () => {
    const m = section("M3.6");
    for (const item of ["Seeing and switching rooms", "Groups growing after they form", "Set spot & time"]) {
      assert.ok(m.includes(item), `M3.6 lost "${item}"`);
    }
  });
});
