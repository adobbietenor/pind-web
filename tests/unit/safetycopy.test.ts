// No promise on a live page that the product does not keep (Alex, 10 Oct 2026). Block
// and report are "two taps from any person, group or message" only once A24 exists; until
// then every page says what is true (SAFETY_TODAY), and the day A24 ships this fails until
// the stronger wording is restored.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SAFETY_TODAY } from "../../packages/shared/src/policy.ts";

const read = (p: string) => readFileSync(p, "utf8");
const files = [
  "src/public/pages.ts",
  "src/public/policy.ts",
  ...readdirSync("packages/shared/src").filter((f) => f.endsWith(".ts")).map((f) => join("packages/shared/src", f)),
];
// "one tap", "two taps", "always one tap away" — a claim about how near block and report are.
const TAPS = /\b(one|two) taps?\b[^"`]{0,40}\b(away|from any)\b|\b(one|two) taps? (away|from any)/i;

describe("Block and report are described as they are (SC01)", () => {
  it("SC01 before A24, nothing claims the taps and every page uses SAFETY_TODAY; after it, SAFETY_TODAY is gone", () => {
    assert.ok(TAPS.test("Block and report are always one tap away.") && TAPS.test("two taps from any person"), "the claim pattern cannot see a claim");
    const shipped = /const A24_EXISTS = true;/.test(read("app/src/app/person/[id].tsx"));
    const claims = files.filter((f) => TAPS.test(read(f).replace(/^\s*\/\/.*$/gm, "")));
    const uses = ["src/public/pages.ts", "src/public/policy.ts", "packages/shared/src/optin.ts"].filter((f) => read(f).includes("SAFETY_TODAY."));
    if (!shipped) {
      assert.deepEqual(claims, [], "a live page claims block and report are a tap or two away — A24 does not exist yet");
      assert.equal(uses.length, 3, "a page about safety no longer says what is true today");
      assert.ok(!/block/i.test(SAFETY_TODAY.sheet) || /coming/i.test(SAFETY_TODAY.app));
    } else {
      assert.deepEqual(uses, [], "A24 has shipped: restore the stronger wording (two taps from any person, group or message) and retire SAFETY_TODAY");
    }
  });
});
