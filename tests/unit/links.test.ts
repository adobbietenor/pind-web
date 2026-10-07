// Universal links (M3.3b): every path pind.social claims for the app has a page in the
// app — two copies across a boundary, compared (CLAUDE.md). A claimed path with no route
// opens the installed app on "no such page", from the very link someone was sent.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { APP_LINK_COMPONENTS } from "../../src/public/og.ts";

// The app's routes, as Expo Router sees them: groups like (tabs) do not appear in the URL.
function routes(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...routes(full, /^\(.*\)$/.test(name) ? prefix : `${prefix}/${name}`));
    } else if (name.endsWith(".tsx") && !name.startsWith("_")) {
      const base = name.replace(/\.tsx$/, "");
      out.push(base === "index" ? prefix || "/" : `${prefix}/${base}`);
    }
  }
  return out;
}
const appRoutes = routes("app/src/app");
const toPattern = (route: string) => new RegExp(`^${route.replace(/\[[^\]]+\]/g, "[^/]+")}$`);
const routeFor = (path: string) => appRoutes.find((r) => toPattern(r).test(path));
// A concrete path for a claimed pattern: each * becomes a segment.
const example = (claim: string) => claim.replace(/\*/g, "x-slug");

describe("Universal links land on a page (M3.3b)", () => {
  it("L01 every path the Worker claims for the app has a route in the app", () => {
    assert.ok(routeFor("/crowd/x-slug"), "the route finder sees nothing — it would pass by finding nothing");
    // …and it can say no: the list before M3.3b claimed /crew/*, which has no page.
    assert.equal(routeFor("/crew/x-slug"), undefined, "the route finder finds a page for anything — it would pass whatever is claimed");
    for (const c of APP_LINK_COMPONENTS.filter((c) => !c.exclude)) {
      assert.ok(routeFor(example(c["/"])), `pind.social claims ${c["/"]} for the app, which has no page for it`);
    }
  });

  it("L02 a crowd link and its quick pin both land: /g/<slug> and /g/<slug>/pin", () => {
    assert.ok(routeFor("/g/leafs-bruins"), "/g/<slug> has no page in the app");
    assert.ok(routeFor("/g/leafs-bruins/pin"), "/g/<slug>/pin has no page in the app");
  });

  it("L03 the share card and the admin stay in the browser, ahead of the rules that would claim them", () => {
    const at = (p: string) => APP_LINK_COMPONENTS.findIndex((c) => c["/"] === p);
    assert.ok(at("/g/*/spot") >= 0 && APP_LINK_COMPONENTS[at("/g/*/spot")]!.exclude, "the share card is not excluded");
    assert.ok(at("/g/*/spot") < at("/g/*"), "the share card's exclusion comes after /g/* — the first match wins, so it never applies");
    assert.ok(APP_LINK_COMPONENTS[at("/admin*")]?.exclude && at("/admin*") === 0);
  });
});
