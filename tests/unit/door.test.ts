// One definition of "on the public web", and no opportunity to hand-roll a lookalike
// (Alex, after the M2.3 walk: "is there a way to make it structurally hard?").
//
// M2.3 got this wrong twice in one milestone, both times in new code, both times by
// writing a filter that reads exactly like the real rule:
//
//     .not("slug", "is", null).is("withdrawn_at", null).eq("is_seed", false)
//
// It is not the real rule. A gathering Alex unpublished keeps its slug — that is how
// "once public, only Alex brings it back" is enforced (M2.2) — so the filter above
// includes rows RLS hides from every visitor. The admin's chip panel and the venue-map
// pass both counted gatherings nobody can open.
//
// H11 says visibility is decided by policies in the database, never by filtering in
// Worker code. This test is the half of that a type system cannot check: the *shape*
// of the mistake, banned everywhere but the one module that is allowed to know.
//
// What it does NOT ban: reading `is_seed` on a single row you already have (the map
// routes check the venue they were asked for), or the publisher counting its own
// published rows for a week's arithmetic. Those are different questions. The banned
// thing is treating a slug, or a null withdrawal, as the definition of public.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

// The one module allowed to express it: it reads through public_gatherings and
// public_gathering, which ARE the definition (M2.1).
const DOOR = "public/data.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

// The PostgREST spellings that mean "I am deciding what is public myself".
const BANNED = [
  { pattern: /\.not\(\s*["']slug["']\s*,\s*["']is["']\s*,\s*null\s*\)/, says: '.not("slug", "is", null) — a slug is not a publication' },
  { pattern: /\.is\(\s*["']withdrawn_at["']\s*,\s*null\s*\)/, says: '.is("withdrawn_at", null) — withdrawal is one of several reasons a row is not public' },
  { pattern: /\.not\(\s*["']published_at["']\s*,\s*["']is["']\s*,\s*null\s*\)/, says: '.not("published_at", "is", null) — read the door instead' },
];

describe("the public web has one definition", () => {
  it("is expressed in the door module and nowhere else", () => {
    const offences: string[] = [];
    for (const file of walk(ROOT)) {
      const rel = file.slice(ROOT.length).replace(/\\/g, "/");
      if (rel === DOOR) continue;
      const source = readFileSync(file, "utf8");
      for (const { pattern, says } of BANNED) {
        if (pattern.test(source)) offences.push(`${rel}: ${says}`);
      }
    }
    assert.deepEqual(
      offences,
      [],
      `These files decide for themselves what is on the public web:\n  ${offences.join("\n  ")}\n` +
        `Ask the door instead — crowds() or publicVenueIds() in src/${DOOR}, which read as a visitor and let RLS answer.`,
    );
  });

  it("finds the door module where it says it is, so this test cannot pass by looking in the wrong place", () => {
    const files = walk(ROOT).map((f) => f.slice(ROOT.length).replace(/\\/g, "/"));
    assert.ok(files.includes(DOOR), `${DOOR} is missing, so nothing above was checked`);
    assert.ok(files.length > 20, `only ${files.length} source files were scanned`);
    // And the door really does hold the definition, rather than having quietly moved.
    const door = readFileSync(join(ROOT, DOOR), "utf8");
    assert.match(door, /public_gatherings/, "the door no longer reads public_gatherings");
    assert.match(door, /public_gathering"/, "the door no longer reads public_gathering");
  });
});
