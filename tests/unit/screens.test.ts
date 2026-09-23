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

describe("The sign-in screen gates each way in on the shared table (signInMethods)", () => {
  it("S15 Apple and Google appear exactly when methodsFor() lists them — no platform check of the screen's own", () => {
    // The web had no Apple button because the screen ALSO checked Platform.OS === "ios"
    // around it, while the table said "later". Two rules, one of them unseen.
    const signIn = screens.find((s) => s.path.split("\\").join("/").endsWith("(onboarding)/sign-in.tsx"));
    assert.ok(signIn, "sign-in screen not found");
    assert.match(signIn.source, /const methods = methodsFor\(\)/);
    assert.match(signIn.source, /methods\.includes\("apple"\) \?/);
    assert.match(signIn.source, /methods\.includes\("google"\) \?/);
    assert.doesNotMatch(signIn.source, /Platform\.OS === "ios"/, "the screen gates a way in on the platform itself");
  });
});

describe("Nothing reads offline as signed out, and every sentence carries its exit (M3.1, airplane mode)", () => {
  // Every source file in the app, not just routes: the fault lived in `loadMe()` too.
  const SRC = join(process.cwd(), "app", "src");
  const all = (function walk(dir: string): { path: string; source: string }[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return walk(path);
      return /\.tsx?$/.test(name) ? [{ path: path.slice(SRC.length + 1), source: readFileSync(path, "utf8") }] : [];
    });
  })(SRC);
  // Code only: the comments explaining why these are banned name them.
  const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("S16 nothing calls auth.getUser() — a network call whose offline null read as a lost sign-in", () => {
    assert.ok(all.length >= 20, `only ${all.length} files found under ${SRC}`);
    const callers = all.filter((f) => /\.getUser\(/.test(code(f.source))).map((f) => f.path);
    assert.deepEqual(callers, [], "ask whoAmI() / myAuthId() in lib/session.ts instead");
  });

  it("S17 no file writes its own 'sign in again' sentence — the shared one comes with its button", () => {
    const own = all
      .filter((f) => !f.path.endsWith("Trouble.tsx"))
      .filter((f) => /lost your sign-in|sign in again|session has expired/i.test(code(f.source)))
      .map((f) => f.path);
    assert.deepEqual(own, []);
  });

  it("S18 Trouble offers Sign in for a sign-out and Try again for the rest", () => {
    const trouble = all.find((f) => f.path.endsWith("Trouble.tsx"));
    assert.ok(trouble, "Trouble.tsx not found");
    assert.match(trouble.source, /wayOut === "sign-in" \?[\s\S]*router\.replace\("\/sign-in"\)/);
    assert.match(trouble.source, /wayOut === "retry" && onRetry \?[\s\S]*label="Try again"/);
  });

  it("S20 no screen shows an error's own text — only sentences we wrote (M3.1: a hostname reached the screen)", () => {
    // Reading `.message` is allowed only where it is classified (errors.ts, the sign-in
    // classifier) or sent to Sentry — never where it could be rendered.
    const allowed = /lib[\\/](errors|sentry|auth)\.ts$/;
    const reads = all
      .filter((f) => !allowed.test(f.path))
      .filter((f) => /\b(err|error|e|cause|reason)\??\.message\b|\b(what|d|err|error)\.detail\b/.test(code(f.source)))
      .map((f) => f.path);
    // The guard must be able to fire: errors.ts reads err.message, and the pattern sees it.
    const errorsFile = all.find((f) => /lib[\\/]errors\.ts$/.test(f.path));
    assert.ok(errorsFile && /\berr\.message\b/.test(code(errorsFile.source)), "S20 cannot see a .message read");
    assert.deepEqual(reads, [], "describe it with failed()/describe(), or throw a Said");
  });

  it("S21 a failed upload is described by uploadReason, never by the error's text", () => {
    const calls = all.flatMap((f) => [...code(f.source).matchAll(/uploadFailed\(([^;]*?)\);/g)].map((m) => ({ path: f.path, args: m[1] })));
    assert.ok(calls.length >= 2, `found ${calls.length}: A2 and Change photo both mark a failed upload`);
    for (const c of calls) assert.match(c.args, /uploadReason\(err\)\s*$/, `${c.path}: ${c.args}`);
  });

  it("S19 no screen prints a described failure by hand — so none can drop its exit (the old A2 shape)", () => {
    const own = screens.filter((s) => /\{\s*\w+\.says\s*\}/.test(s.source)).map((s) => s.path);
    assert.deepEqual(own, [], "render a Described through <Trouble>");
  });
});
