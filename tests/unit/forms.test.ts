// The issue forms offer exactly the spec's screens, under the spec's names (14 Oct 2026).
//
// **Why.** On 28 Sept the room design reused A10–A13 and A17 for new screens and retired
// A15, and nothing said so. The issue forms went on offering "A11-A13, A15, A17 - App,
// crew", the old meaning, and #6 and #8 were filed against screens that no longer exist
// as described. Two copies of one list across a boundary — spec.md's screen headings and
// the forms' dropdowns — compared, the same shape as C04 (wrangler.jsonc's crons against
// the routed ones). A form option must name a spec heading's IDs AND its title, so a
// stale label cannot hide behind an ID that still exists.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ID = String.raw`[WAT]\d+(?:–[WAT]?\d+)?`;
const GROUP = new RegExp(String.raw`^### (${ID}(?:, ${ID})*) — (.+)$`);

// A heading's title, without its asides: "Notifications (seven, under one rule)" →
// "Notifications"; "This week's crowds *(landing; was T9)*" → "This week's crowds".
const title = (t: string) =>
  t
    .replace(/\s*\*\([^)]*\)\*/g, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();

// The spec's screens: §2 and §3's "### <IDs> — <title>" headings. A screen marked
// dropped is not offered.
export function specScreens(spec: string): Map<string, string> {
  const s = spec.split("\r\n").join("\n");
  const from = s.indexOf("\n## 2 ·");
  const to = s.indexOf("\n## 4 ·");
  const out = new Map<string, string>();
  for (const line of s.slice(from, to).split("\n")) {
    const m = GROUP.exec(line);
    if (!m || /\*\(dropped/.test(m[2]!)) continue;
    out.set(m[1]!, title(m[2]!).toLowerCase());
  }
  return out;
}

// Options that are not a screen, on purpose.
const NOT_SCREENS = ["Not sure / cannot tell", "Something new, no screen yet"];

// A form's screens: its "Which part of Pin'd?" dropdown, "<IDs> - <Web|App>, <title>".
export function formScreens(yml: string): Map<string, string> {
  const s = yml.split("\r\n").join("\n");
  const block = s.slice(s.indexOf("id: screen"), s.indexOf("validations:", s.indexOf("id: screen")));
  const out = new Map<string, string>();
  for (const [, option] of block.matchAll(/^\s+- "(.*)"$/gm)) {
    if (NOT_SCREENS.includes(option!)) continue;
    const m = /^([WAT]\d[\dWAT, -]*?) - (?:(?:Web|App), )?(.+)$/.exec(option!);
    assert.ok(m, `a form option that is neither a screen nor a named exception: "${option}"`);
    out.set(m[1]!.replace(/(\d)-([WAT]?\d)/g, "$1–$2"), m[2]!.toLowerCase());
  }
  return out;
}

const sorted = (m: Map<string, string>) => [...m.entries()].sort(([a], [b]) => a.localeCompare(b));

describe("The issue forms offer the spec's screens (14 Oct 2026)", () => {
  const spec = specScreens(readFileSync("spec.md", "utf8"));
  const forms = ["bug", "feature"].map((n) => ({ n, screens: formScreens(readFileSync(`.github/ISSUE_TEMPLATE/${n}.yml`, "utf8")) }));

  it("F01 both readers see real entries, and the comparison tells a match from a drift", () => {
    assert.ok(spec.size >= 20, `only ${spec.size} screen headings found in spec.md`);
    assert.ok(spec.has("A1–A4") && spec.has("W1") && spec.has("T1"), "the heading reader misses known screens");
    assert.ok(!spec.has("A25"), "a dropped screen is being offered");
    for (const f of forms) assert.ok(f.screens.size >= 20, `${f.n}.yml: only ${f.screens.size} screen options found`);
    const planted = formScreens('  - type: dropdown\n    id: screen\n    options:\n      - "A1-A4 - App, onboarding, store path"\n      - "A11-A13, A15, A17 - App, crew"\n    validations:');
    assert.deepEqual(sorted(planted), [["A1–A4", "onboarding, store path"], ["A11–A13, A15, A17", "crew"]]);
    assert.equal(spec.get("A1–A4"), planted.get("A1–A4"), "a matching option does not read as a match");
    assert.ok(!spec.has("A11–A13, A15, A17"), "the pre-28-Sept crew heading is back in the spec");
  });

  it("F02 each form offers exactly the spec's screens, by ID and by title — nothing stale, nothing missing", () => {
    for (const f of forms) {
      assert.deepEqual(sorted(f.screens), sorted(spec), `${f.n}.yml's screen dropdown has drifted from spec.md's headings`);
    }
  });

  it("F03 the two forms offer the same list", () => {
    assert.deepEqual(sorted(forms[0]!.screens), sorted(forms[1]!.screens));
  });
});
