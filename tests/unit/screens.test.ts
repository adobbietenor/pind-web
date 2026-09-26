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
  // The routes, and the shared profile steps they draw (M3.2: A3's picker moved into
  // components/profile/WhereStep.tsx, which A27 draws too).
  const STEPS = join(process.cwd(), "app", "src", "components", "profile");
  const stepFiles = readdirSync(STEPS)
    .filter((n) => n.endsWith(".tsx"))
    .map((n) => ({ path: `components/profile/${n}`, source: readFileSync(join(STEPS, n), "utf8") }));
  const tagScreens = [...screens, ...stepFiles].filter((s) => /<TagPicker\b/.test(s.source));

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
    // The buttons are the shared identity step's (M3.2), drawn by A1 and A27 alike.
    const signIn = { source: readFileSync(join(process.cwd(), "app", "src", "components", "profile", "IdentityStep.tsx"), "utf8") };
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

describe("App screens read gatherings through RLS, never the public door (M3.2)", () => {
  it("S22 no app screen calls public_gathering(s) — a tester could never reach the test crowd through it", () => {
    // The public door never shows a seed row to anyone, signed in or not (V18). App
    // screens read `gatherings` under RLS instead, where the testers exception applies.
    // Found on the way to Alex's walk: the app's A26 still used the door, and the walk
    // would have stopped at "Pin in" with "That crowd is not on Pin'd."
    assert.ok(screens.length >= 10, "found almost no screens (the check found nothing)");
    const planted = `await db.rpc("public_gathering", { p_slug: slug })`;
    assert.match(planted, /rpc\(["']public_gatherings?["']/, "the pattern cannot see a door call");
    const own = screens.filter((s) => /rpc\(["']public_gatherings?["']/.test(s.source)).map((s) => s.path);
    assert.deepEqual(own, [], "these screens read the public door");
  });
});

describe("The web app claims a handed-over session before any screen renders (M3.2)", () => {
  it("S23 the root layout awaits claimOnce and renders nothing until it has", () => {
    // A8 read the gathering before the claim ran and showed an anonymous tester "Not on
    // Pin'd" — the claim lived only inside whoAmI, which the page never reached. The
    // root gate makes the order of any screen's own reads irrelevant.
    const layout = readFileSync(join(ROUTES, "_layout.tsx"), "utf8");
    assert.match(layout, /claimOnce\(\)\.finally\(\(\) => setClaimed\(true\)\)/, "the layout does not await the claim");
    assert.match(layout, /if \(!fontsLoaded \|\| !claimed\) return/, "the layout renders screens before the claim lands");
  });

  it("S24 every in-app link lands on a route that exists", () => {
    // Alex, M3.2 walk: "anything you deliberately left unwired waiting for a screen that
    // now exists — I'd rather you found them all now". The other half of the same fault
    // is a tap wired to a screen that does NOT exist: on the web that is Expo's "Unmatched
    // route" page, a dead end. So every literal navigation target in app/src must name a
    // route file. Checked against its own planted cases first.
    const routes = routeFiles(ROUTES).map((path) =>
        path
          .slice(ROUTES.length)
          .replace(/\\/g, "/")
          .replace(/\.tsx$/, "")
          .replace(/\/\([^/]+\)/g, "")
          .replace(/\/index$/, "") || "/",
      );
    const toPattern = (route: string) => new RegExp(`^${route.replace(/\[[^\]]+\]/g, "[^/]+")}$`);
    const patterns = [...new Set(routes)].map(toPattern);
    const targets = (source: string) =>
      [...source.matchAll(/(?:router\.(?:push|replace)\(|href=\{?)\s*[`"](\/[^`"?#]*)/g)].map((m) =>
        m[1]!.replace(/\$\{[^}]+\}/g, "x").replace(/\/$/, "") || "/",
      );
    const lands = (t: string) => patterns.some((p) => p.test(t));

    // The check's own cases: one that lands, one that does not.
    assert.deepEqual(targets('router.push(`/crowd/${slug}`); <Redirect href="/nowhere/at-all" />'), ["/crowd/x", "/nowhere/at-all"]);
    assert.ok(lands("/crowd/x") && !lands("/nowhere/at-all"), "the route matcher does not tell a real route from a missing one");

    // Wired ahead of its screen ON PURPOSE, each named, each for Alex to decide — and each
    // asserted still missing, so the day its screen lands this list must shrink.
    const PENDING: Record<string, string> = {
      "/person/x/report": "A24, report and block (M3.5) — A22's ⋯ (H9)",
    };
    // Every .tsx under app/src: screens, and the components that navigate (Trouble).
    const all = routeFiles(join(process.cwd(), "app", "src"));
    const found = [...new Set(all)].flatMap((path) => targets(readFileSync(path, "utf8")).map((t) => ({ t, path: path.slice(process.cwd().length + 1) })));
    assert.ok(found.length >= 15, `only ${found.length} navigation targets found — the extractor is not reading the screens`);
    const dead = found.filter(({ t }) => !lands(t) && !(t in PENDING)).map(({ t, path }) => `${path} → ${t}`);
    assert.deepEqual(dead, [], "these taps go to a screen that does not exist");
    for (const t of Object.keys(PENDING)) {
      assert.ok(!lands(t), `${t} exists now — show its tap again and drop it from PENDING`);
      // Hidden, not deleted: the tap is still written, behind its flag, so it comes back.
      assert.ok(found.some((f) => f.t === t), `${t} is no longer in any screen — PENDING names a tap that is gone`);
    }
  });

  it("S25 every placeholder is named, and each name fails the day it is no longer true", () => {
    // Alex, M3.2: "apply the same thinking to anything else deferred with a
    // placeholder". S24's shape for everything else a walker can meet before its time:
    // a named list, a check that finds anything NOT on it, and a check that each entry is
    // still a placeholder — so building it, or approving its copy, makes this fail until
    // the list shrinks.

    // Screens that are still the M2.0 scaffold: a title and nothing else.
    const SCAFFOLDS: Record<string, string> = {
      "(tabs)/crowds.tsx": "A5–A7, This Week's Crowds — M3.2b",
      "(tabs)/my-events.tsx": "A19, My Events — M3.2b",
      "(tabs)/connections.tsx": "A20, Connections — M3.3",
    };
    const isScaffold = (source: string) => /return <Screen title="[^"]*" \/>;/.test(source);
    assert.ok(isScaffold('  return <Screen title="Crowds" />;') && !isScaffold("return <AppScreen>"), "the scaffold test cannot tell one");
    const norm = (p: string) => p.split("\\").join("/");
    const scaffolds = screens.filter((sc) => isScaffold(sc.source)).map((sc) => norm(sc.path)).sort();
    assert.deepEqual(scaffolds, Object.keys(SCAFFOLDS).sort(), "a scaffold screen is unnamed, or a named one has been built — update SCAFFOLDS");

    // Copy marked PROPOSED: waiting on Alex's verdict. Approving it means removing the
    // marker, which fails here until the entry goes too.
    const PROPOSED: Record<string, string> = {
      "packages/shared/src/crowd.ts": "A9's pinned-not-open copy — Alex, on the M3.2 walk",
    };
    assert.ok(/\bPROPOSED\b/.test("// PROPOSED, for Alex") && !/\bPROPOSED\b/.test("UNPROPOSED"), "the marker test cannot see a marker");
    const marked = (function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((name) => {
        if (name === "node_modules" || name === "dist" || name.startsWith(".")) return [];
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return walk(path);
        return /\.tsx?$/.test(name) && /\bPROPOSED\b/.test(readFileSync(path, "utf8")) ? [norm(path.slice(process.cwd().length + 1))] : [];
      });
    })(process.cwd()).filter((p) => /^(app\/src|packages\/shared\/src|src)\//.test(p));
    assert.deepEqual([...new Set(marked)].sort(), Object.keys(PROPOSED).sort(), "PROPOSED copy is unnamed, or named copy was approved — update PROPOSED");
  });

  it("S26 A27 asks the gate's three facts, fresh, before its final write — and after a merge holds nothing from before it", () => {
    // M3.2 walk: after a merge the safety sheet wrote with the deleted anonymous person's
    // id, and the refusal reached the screen as "Pin'd was not allowed to write that".
    const a27 = readFileSync(join(ROUTES, "opt-in", "[slug].tsx"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    const finish = a27.slice(a27.indexOf("const finish = async"), a27.indexOf('if (step === "loading")'));
    assert.ok(finish.length > 100, "S26 cannot find A27's finish");
    const read = finish.indexOf("await readMine(slug)");
    const asked = finish.indexOf("optInMissing(fresh).missing.length) return sendBack(fresh)");
    const write = finish.indexOf('.from("policy_acceptances")');
    assert.ok(read >= 0 && asked > read && write > asked, "finish writes before reading fresh and asking optInMissing");
    assert.doesNotMatch(finish, /mine\.personId|mine\.gatheringId/, "finish writes with ids the screen was holding");
    // Before reading anything, a merge the page left for is finished; then every step
    // is chosen from a fresh read by the shared rule — never from what the screen held.
    const load = a27.slice(a27.indexOf("const load = useCallback"), a27.indexOf("useEffect("));
    assert.ok(load.indexOf("await finishWebReturn()") >= 0 && load.indexOf("await finishWebReturn()") < load.indexOf("await advance()"), "A27 reads before finishing a merge it left the page for");
    assert.match(a27, /const next = await readMine\(slug\);[\s\S]{0,400}setStep\(nextOptInStep\(/, "A27 picks its step with a rule of its own, not the shared one on a fresh read");
  });

  it("S27 only lib/profile.ts and lib/tags.ts write a profile — no screen or step writes date of birth, gender, photo, neighbourhood or tags itself", () => {
    // M3.2 walk: A2 and A27 each wrote their own, and the women-only question drifted.
    const SRC = join(process.cwd(), "app", "src");
    const all = (function walk(dir: string): { path: string; source: string }[] {
      return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return walk(path);
        return /\.tsx?$/.test(name) ? [{ path: path.slice(SRC.length + 1).split("\\").join("/"), source: readFileSync(path, "utf8") }] : [];
      });
    })(SRC);
    const WRITERS = new Set(["lib/profile.ts", "lib/tags.ts"]);
    const writes = (src: string) =>
      /from\("people_private"\)\s*\.(insert|update|upsert)/.test(src) ||
      /from\("person_tags"\)\s*\.(insert|delete|upsert)/.test(src) ||
      /from\("people"\)\s*\.(insert|update|upsert)\(\{[^}]*\b(photo_path|neighbourhood|first_name)\b/.test(src);
    // The guard's own cases: a write it must see, and a read it must not.
    assert.ok(writes('db.from("people").update({ photo_path: p })') && writes('db.from("people_private").insert({})'), "S27 cannot see a profile write");
    assert.ok(!writes('db.from("people").select("photo_path")'), "S27 mistakes a read for a write");
    assert.ok(all.some((f) => WRITERS.has(f.path) && writes(f.source)), "S27 sees no write even in lib/profile.ts — the pattern is broken");
    const own = all.filter((f) => !WRITERS.has(f.path) && writes(f.source)).map((f) => f.path);
    assert.deepEqual(own, [], "these write a profile themselves — call lib/profile.ts");
  });

  it("S28 both paths draw the SAME steps: A1/A2/A3 and A27 render the shared components, and the women-only question exists once", () => {
    const read = (...p: string[]) => readFileSync(join(process.cwd(), "app", "src", ...p), "utf8");
    const a27 = read("app", "opt-in", "[slug].tsx");
    for (const step of ["YouStep", "WhereStep", "IdentityStep"]) assert.match(a27, new RegExp(`<${step}\\b`), `A27 does not draw ${step}`);
    assert.match(read("app", "(onboarding)", "you.tsx"), /<YouStep\b/, "A2 does not draw the shared YouStep");
    assert.match(read("app", "(onboarding)", "where.tsx"), /<WhereStep\b/, "A3 does not draw the shared WhereStep");
    assert.match(read("app", "(onboarding)", "sign-in.tsx"), /<IdentityStep\b/, "A1 does not draw the shared IdentityStep");
    // The women-only question, and the gender choice, are drawn in one file.
    const SRC = join(process.cwd(), "app", "src");
    const files = (function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : /\.tsx$/.test(n) ? [join(dir, n)] : []));
    })(SRC);
    const asking = (re: RegExp) => files.filter((f) => re.test(readFileSync(f, "utf8").replace(/^\s*\/\/.*$/gm, ""))).map((f) => f.slice(SRC.length + 1).split("\\").join("/"));
    assert.deepEqual(asking(/[Ww]omen-only crews"|include_in_women_only|setWomenOnly/), ["components/profile/YouStep.tsx"], "the women-only question is asked in more than one place");
    assert.deepEqual(asking(/options=\{GENDER_CHOICES\}/), ["components/profile/YouStep.tsx"], "gender is asked in more than one place");
  });
});
