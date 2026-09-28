// Every route the Worker imports is actually wired (M3.2).
//
// **Written because a route was imported and never called, and everything passed.**
// A26's GET branch and `POST /session/claim` were added as imports, the lines that use
// them silently failed to land, and typecheck, the unit tests and the deploy were all
// green — an unused import is valid code. The live page served the app's index.html
// with a 200, which is exactly CLAUDE.md's "a missing Worker route does not 404"; a
// browser caught it, nothing in the suite could.
//
// The router cannot be loaded under node (its imports carry no file extension), so
// this reads the routing files and insists every name they import is used somewhere
// other than its import line — and, per S20, first proves it would notice one that
// is not.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROUTING = ["src/router.ts", "src/public/routes.ts"];
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// Names imported as values (type-only imports are exempt: a type can be used once).
function importedNames(source: string): string[] {
  const names: string[] = [];
  for (const m of code(source).matchAll(/^import\s+(?!type\b)\{([^}]*)\}\s+from/gm)) {
    for (const part of m[1]!.split(",")) {
      const name = part.trim().replace(/^type\s+.*/, "").split(/\s+as\s+/).pop()!.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

function unused(source: string): string[] {
  const body = code(source).replace(/^import[\s\S]*?from\s+["'][^"']+["'];?$/gm, "");
  return importedNames(source).filter((name) => !new RegExp(`\\b${name}\\b`).test(body));
}

describe("Every imported route is wired (M3.2)", () => {
  it("W01 the check notices an import nothing calls — or an empty result would mean nothing", () => {
    const planted = `import { claimSession, quickPinSubmit } from "./public/quickpin";\nconst r = { "POST /x": quickPinSubmit };`;
    assert.deepEqual(unused(planted), ["claimSession"]);
    assert.ok(importedNames(readFileSync(ROUTING[0]!, "utf8")).length >= 5, "found almost no imports in the router");
  });

  for (const file of ROUTING) {
    it(`W02 ${file} uses every route it imports`, () => {
      assert.deepEqual(unused(readFileSync(file, "utf8")), [], "imported and never wired");
    });
  }

  it("W03 A26's two entry points and the claim are routed, not only imported", () => {
    assert.match(code(readFileSync("src/public/routes.ts", "utf8")), /quickPinPage\(env, slug\)/, "GET /g/<slug>/pin is not routed");
    const router = code(readFileSync("src/router.ts", "utf8"));
    assert.match(router, /"POST \/session\/claim":\s*claimSession/, "POST /session/claim is not routed");
    assert.match(router, /quickPinSubmit\(request, env,/, "POST /g/<slug>/pin is not routed");
    assert.match(router, /"POST \/account\/merge":\s*mergeAccount/, "POST /account/merge is not routed");
  });
});
