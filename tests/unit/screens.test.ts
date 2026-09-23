// Every app screen sits in the shared shell, and every tag screen gates on the shared
// rule (M3.1, after the TestFlight walk).
//
// **Why a test reads the source.** No UI tests (CLAUDE.md), and the two faults this
// guards were not in any function a test could call: the Profile tab drew its own
// frame and forgot the header, no screen's ScrollView knew about the keyboard, and
// both tag screens wrote their own Continue rule — `picked.length > 0 &&
// !enoughPicked(picked)` — which let none through while T09 proved a function the
// screens did not ask. The rules are tested where they live; this proves the screens
// use them, so the next screen cannot quietly draw its own again.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROUTES = join(process.cwd(), "app", "src", "app");

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name.endsWith(".tsx") && name !== "_layout.tsx" ? [path] : [];
  });
}

const screens = routeFiles(ROUTES)
  .map((path) => ({ path: path.slice(ROUTES.length + 1), source: readFileSync(path, "utf8") }))
  // A route that only redirects draws nothing.
  .filter((s) => !/return <Redirect /.test(s.source) || /<Screen|<AppScreen/.test(s.source));

describe("Every app screen sits in the shared shell", () => {
  it("S10 there are screens to check (a check that found nothing must not pass)", () => {
    assert.ok(screens.length >= 10, `only ${screens.length} route files found under ${ROUTES}`);
  });

  it("S11 every screen draws its frame through AppScreen or Screen — so every one has the header", () => {
    const own = screens.filter((s) => !/<AppScreen\b|<Screen\b/.test(s.source)).map((s) => s.path);
    assert.deepEqual(own, [], "these screens draw no shared shell, so they have no header");
  });

  it("S12 no screen draws its own SafeAreaView or ScrollView — so none forgets the keyboard", () => {
    const own = screens.filter((s) => /<SafeAreaView\b|<ScrollView\b/.test(s.source)).map((s) => s.path);
    assert.deepEqual(own, [], "these screens build their own frame instead of AppScreen");
  });
});

describe("Every tag screen gates on the shared rule (T10)", () => {
  const tagScreens = screens.filter((s) => /<TagPicker\b/.test(s.source));

  it("S13 the tag screens are found", () => {
    assert.ok(tagScreens.length >= 2, `found ${tagScreens.length}: A3 and Profile → Edit tags both use the picker`);
  });

  it("S14 each gates Continue or Save on tagsCanContinue, and writes no rule of its own", () => {
    for (const s of tagScreens) {
      assert.match(s.source, /disabled=\{!tagsCanContinue\(picked\)\}/, `${s.path} does not gate on tagsCanContinue`);
      assert.doesNotMatch(s.source, /picked\.length\s*>\s*0\s*&&/, `${s.path} still carries its own "none is fine" rule`);
      assert.doesNotMatch(s.source, /enoughPicked\(/, `${s.path} asks enoughPicked instead of the screen rule`);
    }
  });
});
