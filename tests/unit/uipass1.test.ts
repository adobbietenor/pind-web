// UI pass 1's rules that apply everywhere (Alex, 30 Oct 2026; docs/design/ui-pass-1/README.md):
// no em dashes in any copy, "crew" is gone, house rules are one collapsed row, and nothing
// public names a person, an address or "Tenor" beyond the legal pages' one operator line.
// Each scanner first proves it can see the thing it looks for, so a pattern that matches
// nothing cannot pass by finding nothing (CLAUDE.md, "A test that reads the source must
// prove its own pattern matches something real").
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["packages/shared/src", "src/public", "app/src"];

function sources(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(f) && !f.endsWith("database.types.ts")) out.push(p);
  }
  return out;
}

// Comments carry the history and may say anything; what a person reads is the code that
// is left. Block comments go first, then line comments (not the "//" inside a URL).
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const FILES = ROOTS.flatMap((r) => sources(r));
const code = (f: string) => withoutComments(readFileSync(f, "utf8"));

function hits(pattern: RegExp): string[] {
  return FILES.flatMap((f) =>
    code(f)
      .split("\n")
      .flatMap((line, i) => (pattern.test(line) ? [`${f}:${i + 1}: ${line.trim().slice(0, 120)}`] : [])),
  );
}

// The body of one exported function, from its signature to the first closing brace at
// the start of a line.
function body(src: string, fn: string): string {
  const at = src.indexOf(`export function ${fn}(`);
  if (at < 0) return "";
  const end = src.search(new RegExp(`\\n\\}`, "g")) < 0 ? src.length : src.indexOf("\n}", at);
  return src.slice(at, end);
}

// A word "crew" in prose, not an identifier (`crews_open`, `.from("crews")`, `kind === "crew"`).
const CREW_PROSE =
  /\b(a|the|your|my|in|of|share|women-only|small|join|start|their)\s+crews?\b|\bcrews?\s+(are|meet|can|is|stays|form|thread|messages|chat)\b|>\s*crews?\s*</i;

describe("UI pass 1, rules that apply everywhere", () => {
  it("U01 no em dash in any copy, app or Worker (rule 1)", () => {
    assert.ok(FILES.length > 100, `only ${FILES.length} source files found`);
    // The scanner keeps strings and drops comments: proved on a line of each.
    assert.equal(withoutComments('const a = "x — y"; // b — c').includes("—"), true);
    assert.equal(withoutComments("// only a comment — here").includes("—"), false);
    assert.equal(withoutComments('const u = "https://pind.social"; // —').trim(), 'const u = "https://pind.social";');
    assert.deepEqual(hits(/—/), [], "an em dash in copy: use a period, comma or colon");
  });

  it("U02 'crew' is gone from what people read: squads, rooms, 1-on-1 (rule 4)", () => {
    assert.ok(CREW_PROSE.test('"Women-only crews on every gathering."') && CREW_PROSE.test("give a crew something"), "the pattern cannot see the word in prose");
    assert.ok(!CREW_PROSE.test('db.from("crews").select("id")') && !CREW_PROSE.test("c.crews_open"), "the pattern catches identifiers");
    assert.deepEqual(hits(CREW_PROSE), []);
  });

  it("U03 the legal pages name the operator once each and nobody else; nothing carries an address (rule 7)", () => {
    const policy = code("src/public/policy.ts");
    for (const name of ["privacy", "terms"]) {
      const src = body(policy, name);
      assert.ok(src.length > 1500, `cannot find ${name}() in policy.ts`);
      assert.equal(src.match(/\$\{OPERATOR\}/g)?.length, 1, `${name} names the operator other than once`);
    }
    assert.equal(policy.match(/Tenor/g)?.length, 1, "policy.ts says Tenor outside OPERATOR");
    assert.match(policy, /const OPERATOR = "Tenor Investments \(dba Pin&#39;d\)";/);
    assert.ok(body(code("src/public/pages.ts"), "about").length > 1000, "cannot find about() in pages.ts");
    assert.doesNotMatch(code("src/public/pages.ts"), /Tenor/, "About or a crowd page names the operator");
    // The address and name it used to carry, so the pattern is proved on the real thing.
    assert.match("Alex Dobbie, 2562 136th Street, Surrey, BC V4P 1S4", /Dobbie|Surrey|136th|V4P/i);
    for (const f of FILES) assert.doesNotMatch(code(f), /Dobbie|Surrey|136th|V4P/i, `${f} names a person or an address`);
  });

  it("U04 house rules are one collapsed row wherever the Worker shows them, with nothing under them (rule 2)", () => {
    assert.match(readFileSync("src/public/layout.ts", "utf8"), /<details class="rules-row"><summary>House rules/);
    const worker = ["src/public/pages.ts", "src/public/policy.ts"].map(code).join("\n");
    assert.ok((worker.match(/houseRulesRow\(\)/g)?.length ?? 0) >= 2, "About and Terms do not use the one row");
    assert.doesNotMatch(worker, /class="rules"|class="crews-meet"|<details class="rules-row" open/);
  });
});
