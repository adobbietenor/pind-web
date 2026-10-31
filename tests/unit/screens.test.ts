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

describe("A8 never leaves someone with no way forward (Alex, 6 Oct 2026)", () => {
  it("S31 not pinned at a gathering that has finished: A8 says pinning has closed, in place of the button", () => {
    // On the phone: tonight's Leafs game, tapped from the list after its effective end,
    // showed no "Pin in" and nothing else — the button had silently gone.
    const a8 = readFileSync("app/src/app/(tabs)/crowd/[slug].tsx", "utf8").split("\r\n").join("\n");
    const branch = a8.slice(a8.indexOf("// A8 — not pinned here."), a8.indexOf(") : !view.mine.open ?"));
    assert.ok(branch.includes("label={PIN_IN}"), "could not find A8's not-pinned branch — this test would pass by finding nothing");
    assert.match(branch, /\) : \([\s\S]*QUICKPIN_COPY\.closed/, "A8 shows nothing when a gathering has finished");
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
    // Since M3.3b the gate is one name, `ready`, which the notification tap waits on too.
    assert.match(layout, /const ready = fontsLoaded && claimed;/, "'ready' no longer waits for the claim");
    assert.match(layout, /if \(!ready\) return <View/, "the layout renders screens before the claim lands");
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
      [...source.matchAll(/(?:router\.(?:push|replace|dismissTo|navigate)\(|href=\{?)\s*[`"](\/[^`"?#]*)/g)].map((m) =>
        m[1]!.replace(/\$\{[^}]+\}/g, "x").replace(/\/$/, "") || "/",
      );
    const lands = (t: string) => patterns.some((p) => p.test(t));

    // The check's own cases: one that lands, one that does not.
    assert.deepEqual(targets('router.push(`/crowd/${slug}`); <Redirect href="/nowhere/at-all" /> router.dismissTo("/gone")'), ["/crowd/x", "/nowhere/at-all", "/gone"]);
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
    // None left: A19 My Events, the last, was built in M3.2b (10 Oct 2026).
    const SCAFFOLDS: Record<string, string> = {};
    const isScaffold = (source: string) => /return <Screen title="[^"]*" \/>;/.test(source);
    assert.ok(isScaffold('  return <Screen title="Crowds" />;') && !isScaffold("return <AppScreen>"), "the scaffold test cannot tell one");
    const norm = (p: string) => p.split("\\").join("/");
    const scaffolds = screens.filter((sc) => isScaffold(sc.source)).map((sc) => norm(sc.path)).sort();
    assert.deepEqual(scaffolds, Object.keys(SCAFFOLDS).sort(), "a scaffold screen is unnamed, or a named one has been built — update SCAFFOLDS");

    // Copy marked PROPOSED: waiting on Alex's verdict. Approving it means removing the
    // marker, which fails here until the entry goes too.
    const PROPOSED: Record<string, string> = {
      "packages/shared/src/crowd.ts": "A9's pinned-not-open copy — Alex, on the M3.2 walk",
      "packages/shared/src/room.ts": "the room and groups (M3.3) — Tatiana's doc replaces it",
      "packages/shared/src/share.ts": "the group's share message (M3.3) — Tatiana's doc replaces it",
      "packages/shared/src/after.ts": "the night and after (M3.3) — Tatiana's doc replaces it",
      "packages/shared/src/cities.ts": "the app's home — the city picker and its lines (M3.3c, 6 Oct) — Tatiana's to reword",
      "packages/shared/src/notify.ts": "a phone's notifications taken by another account (L8, 6 Oct) — Tatiana's to reword",
      "packages/shared/src/session.ts": "sign out in Settings (A23, 10 Oct) — Tatiana's to reword",
      "packages/shared/src/search.ts": "search and interests (M3.2b, 10 Oct) — Tatiana's to reword",
      "packages/shared/src/myevents.ts": "A19 My Events (M3.2b, 10 Oct) — Tatiana's to reword",
      "packages/shared/src/solo.ts": "1-on-1's sheet, section and lines 2–5 (A28/A29, M3.4) — Alex and Tatiana's; Tatiana writes the final five",
      "packages/shared/src/squad.ts": "squads' list, start sheet and card (A15/A11, M3.7) — the one copy pass (decisions, \"Copy deferred to one pass\")",
      "packages/shared/src/copy.ts": "#14 (29 Oct): the count's next step and W2's rule line, written for the room-and-squads design — Tatiana's to reword; CREWS_MEET is the App Review line",
      "src/public/pages.ts": "#14 (29 Oct): W1's 'people meeting up' and the About page's two paragraphs — Tatiana's to reword",
      "packages/shared/src/quickpin.ts": "F5 (M4.2, 29 Oct): a full squad's refusal of a +1, on both A26s — Tatiana's to reword",
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

  it("S30 'Get the app' shows only on the web, only with somewhere real to go, and is marked seen only by itself", () => {
    const SRC = join(process.cwd(), "app", "src");
    const nudge = readFileSync(join(SRC, "components", "GetTheApp.tsx"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    const guard = /if \(Platform\.OS !== "web" \|\| !GET_THE_APP\.url\) return;/;
    assert.ok(guard.test('    if (Platform.OS !== "web" || !GET_THE_APP.url) return;'), "S30's pattern cannot see a guard");
    assert.match(nudge, guard, "the nudge can show on the phone, or with no link");
    assert.match(nudge, /if \(!show \|\| !GET_THE_APP\.url\) return null;/, "the nudge renders without a link");
    const callers = (function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : /\.tsx$/.test(n) && /markAppNudgeSeen\(/.test(readFileSync(join(dir, n), "utf8")) ? [n] : []));
    })(SRC);
    assert.deepEqual(callers, ["GetTheApp.tsx"], "something other than the nudge marks it seen");
  });

  it("S29 nothing is ever sent for anyone: a message is written only by the Send buttons, and an opener only fills the box", () => {
    // Alex, M3.3: "never send anything for anyone — keep it as a test".
    const SRC = join(process.cwd(), "app", "src");
    const files = (function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : /\.tsx?$/.test(n) ? [join(dir, n)] : []));
    })(SRC).map((f) => ({ path: f.slice(SRC.length + 1).split("\\").join("/"), src: readFileSync(f, "utf8").replace(/^\s*\/\/.*$/gm, "") }));
    const inserts = /from\("(room_messages|crew_messages)"\)\s*\.insert/;
    assert.ok(inserts.test('db.from("room_messages").insert({})'), "S29 cannot see a message insert");
    assert.deepEqual(files.filter((f) => inserts.test(f.src)).map((f) => f.path), ["lib/room.ts"], "a message is written somewhere other than the two send functions");
    const room = files.find((f) => f.path === "app/room/[id].tsx")!.src;
    const group = files.find((f) => f.path === "app/group/[id].tsx")!.src;
    // Each send function is called once, from the code behind that screen's Send — which,
    // since the thread pass, is the shared Composer's `onSend` (its button, or Enter).
    for (const [name, src, fn] of [["the room", room, "sendRoomMessage"], ["the group", group, "sendGroupMessage"]] as const) {
      assert.equal((src.match(new RegExp(`${fn}\\(`, "g")) ?? []).length, 1, `${name} calls ${fn} more than once`);
      assert.match(src, new RegExp(`const send = async \\(\\) => \\{[\\s\\S]{0,300}${fn}\\(`), `${name} sends from somewhere other than its Send`);
      assert.match(src, /<Composer[^>]*onSend=\{\(\) => void send\(\)\}/, `${name}'s box does not send through send()`);
      // A failed message, tapped, goes back into the box — it is never re-sent for you.
      const back = src.slice(src.indexOf("const takeBack"), src.indexOf("\n  };", src.indexOf("const takeBack")));
      assert.ok(back.length > 20 && /setDraft\(/.test(back), `${name} has no take-back into the box`);
      assert.doesNotMatch(back, /send|post\(/i, `${name}'s take-back sends`);
    }
    // In the composer, the button and Enter are one act; nothing else calls onSend.
    const composer = files.find((f) => f.path === "components/Composer.tsx")!.src;
    assert.equal((composer.match(/onSend\(\)/g) ?? []).length, 1, "the composer calls onSend from more than one place");
    assert.match(composer, /const submit = \(\) => \{\s*if \(!can\) return;\s*onSend\(\);/, "onSend is called from somewhere other than submit");
    // Since UI pass 1 the Send is a round arrow (a Tap), still named Send and still submit.
    assert.match(composer, /<Tap accessibilityRole="button" accessibilityLabel=\{THREAD_COPY\.send\}[^>]*onPress=\{submit\}/, "the composer's Send button does not submit");
    const bubbles = files.find((f) => f.path === "components/ThreadMessages.tsx")!.src;
    assert.match(bubbles, /onPress=\{failed \? \(\) => onTakeBack\(m\.id\) : undefined\}/, "a failed message's tap does something other than take it back");
    assert.doesNotMatch(bubbles, /onSend|post\(|insert/, "the thread's bubbles can send");
    // An opener's tap fills the box and does nothing else. Since UI pass 1 the openers are
    // the composer's chips, the row just over the box: the room hands them over, and a chip
    // only sets the box's text.
    assert.match(room, /<Composer[\s\S]{0,400}chips=\{[^}]*openers/, "the room's openers are not the composer's chips");
    const chip = composer.slice(composer.indexOf("chips.map"), composer.indexOf("chips.map") + 300);
    assert.match(chip, /onPress=\{\(\) => onChangeText\(c\)\}/, "an opener does something other than fill the box");
    assert.doesNotMatch(chip, /onSend|submit|insert/i, "an opener sends");
  });
});

describe("Sign out (A23; Alex, 10 Oct 2026)", () => {
  const settings = readFileSync(join(ROUTES, "settings.tsx"), "utf8");
  const auth = readFileSync(join(process.cwd(), "app", "src", "lib", "auth.ts"), "utf8");
  const push = readFileSync(join(process.cwd(), "app", "src", "lib", "push.ts"), "utf8");
  const body = (src: string, name: string) => {
    const at = src.indexOf(`export async function ${name}(`);
    assert.ok(at >= 0, `${name} is gone`);
    return src.slice(at, src.indexOf("\n}", at));
  };

  it("S32 Settings offers Sign out only with a permanent sign-in, read fresh, in its own card above Delete", () => {
    const gate = settings.indexOf("{permanent ? (");
    const heading = settings.indexOf("{SIGN_OUT.heading}");
    const del = settings.indexOf(">Delete your account</Text>");
    assert.ok(gate >= 0 && heading > gate, "Sign out is shown without the permanent gate");
    assert.ok(del > heading, "Sign out is not above Delete, or Delete is gone");
    assert.ok(settings.slice(heading, del).includes(") : null}"), "Sign out and Delete share a block");
    assert.match(settings, /setPermanent\(me\.permanent\)/, "'permanent' is not read from the fresh profile");
    assert.match(settings, /signOutHere\(\)/, "Settings signs out some other way");
    assert.match(settings, /SIGN_OUT\.yes/, "Sign out has no confirm step");
  });

  it("S33 sign-out takes the phone off the account first, then ends the session on this device only, then clears the cache", () => {
    const fn = body(auth, "signOutHere");
    const phone = fn.indexOf("await forgetThisPhone();");
    const out = fn.indexOf('signOut({ scope: "local" })');
    const clear = fn.indexOf("queryClient.clear();");
    assert.ok(phone >= 0 && out > phone, "the session can end while this phone still gets the account's notifications");
    assert.ok(clear > out, "the last person's data can outlive the sign-out");
    assert.match(fn, /if \(error\) throw error;/, "a failed sign-out is reported as done");
  });

  it("S34 the phone comes off the account or the sign-out stops — never silently half-done", () => {
    const fn = body(push, "forgetThisPhone");
    assert.match(fn, /from\("device_tokens"\)\.delete\(\)/);
    const thrown = fn.indexOf("if (error) throw error;");
    assert.ok(thrown >= 0 && fn.indexOf("forgetPushRegistration()") > thrown, "the phone forgets it registered even when the server still has it");
  });
});

describe("'You're going' on the list (#3; A6/A7)", () => {
  const lib = readFileSync("app/src/lib/crowds.ts", "utf8");
  const list = readFileSync("app/src/app/(tabs)/city/[slug].tsx", "utf8");
  const fn = lib.slice(lib.indexOf("export async function myPinnedSlugs"));

  it("S35 the mark reads the person's own pins and nothing else — no RPC, no other table, no write", () => {
    assert.ok(fn.length > 50, "myPinnedSlugs is not in lib/crowds.ts");
    assert.match(fn, /from\("pins"\)\.select\("gatherings\(slug\)"\)\.eq\("person_id", me\.id\)/, "the pins read is not narrowed to the person's own");
    assert.match(fn, /if \(read\.state !== "in"\) return new Set\(\)/, "no session must mean no marks, and no session made");
    const tables = [...fn.matchAll(/\.from\("([^"]+)"\)/g)].map((m) => m[1]);
    assert.deepEqual(tables, ["people", "pins"], "the mark reads a table beyond the person's own row and pins");
    assert.doesNotMatch(fn, /\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|signInAnonymously/, "the mark calls something more than two reads");
  });

  it("S36 a card is marked from that read alone, with the shared words, and the count stays", () => {
    assert.match(list, /myPinnedSlugs\(\)/, "the list does not ask whose pins these are");
    assert.match(list, /going=\{mine\.has\(g\.slug\)\}/, "a card is marked from something other than the person's own pins");
    assert.match(list, /\{going \? <Text style=\{styles\.going\}>\{HOME_COPY\.youreGoing\}<\/Text> : null\}/, "the mark does not use the shared words");
    assert.match(list, /<Text style=\{styles\.tally\}>\{crowdLine\(g\)\}<\/Text>/, "the count line is gone from the card");
    // A7: the crews badge is the only purple element on a row.
    const style = list.slice(list.indexOf("  going: {"), list.indexOf("\n", list.indexOf("  going: {")));
    assert.ok(style.length > 10, "the mark's style is not found");
    assert.doesNotMatch(style, /accent/, "the mark is purple — the crews badge is the only purple on a row (A7)");
  });
});

describe("The header is the way home, on every screen that has one (#1)", () => {
  it("S37 the header is one link to the live city's list, and both shells draw it — so every screen's logo goes home", () => {
    const brand = readFileSync("app/src/components/Brand.tsx", "utf8");
    assert.match(brand, /accessibilityRole="link"/, "the header is not a link");
    // homeList() is `/city/${liveCity().slug}` (K05); the header writes it in the router's typed form.
    assert.match(
      brand,
      /const home = \{ pathname: "\/city\/\[slug\]", params: \{ slug: liveCity\(\)\.slug \} \} as const;/,
      "the header does not go to the live city's list (29 Oct: the city picker was a dead end)",
    );
    assert.match(
      brand,
      /if \(router\.canDismiss\(\)\) router\.dismissTo\(home\);\s*else router\.navigate\(home\);/,
      "the header does not go home both ways — dismissTo alone does nothing from a tab",
    );
    assert.doesNotMatch(brand, /"\/crowds"/, "the header still goes to the city picker");
    assert.doesNotMatch(brand, /accessibilityRole="header"/, "the header is back to being a label");
    for (const shell of ["AppScreen", "Screen"]) {
      const src = readFileSync(`app/src/components/${shell}.tsx`, "utf8");
      assert.match(src, /<Brand \/>/, `${shell} no longer draws the header`);
    }
    // S11 holds every route to AppScreen or Screen; this holds nothing else to a header of its own.
    const own = screens.filter((s) => /<Image[^>]*mark\.png|wordmark\.png/.test(s.source)).map((s) => s.path);
    assert.deepEqual(own, [], "a screen draws the logo itself, outside the shared header");
  });
});

describe("Threads: a message costs a row, and the box rides the keyboard (the thread pass, 16 Oct 2026)", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), "app", "src", p), "utf8").replace(/^\s*\/\/.*$/gm, "");
  const room = read("app/room/[id].tsx");
  const group = read("app/group/[id].tsx");
  const lib = read("lib/thread.ts");
  const roomLib = read("lib/room.ts");
  const composer = read("components/Composer.tsx");
  const frame = read("components/AppScreen.tsx");
  const threads = [["the room", room], ["the group (squads and 1-on-1 plans)", group]] as const;

  it("S38 every thread's box is the one Composer, in AppScreen's footer — no thread draws its own", () => {
    assert.match(composer, /<TextInput\b/, "S38 cannot see a text input in the composer");
    for (const [name, src] of threads) {
      assert.doesNotMatch(src, /<TextInput\b/, `${name} draws its own text box`);
      assert.match(src, /<AppScreen\s+footer=\{[\s\S]{0,200}<Composer\b/, `${name}'s box is not the composer in the frame's footer`);
      assert.match(src, /<ThreadMessages\b/, `${name} draws its own messages, and a sending or failed one would look different`);
      assert.match(src, /useThread\("(room|group)"/, `${name} does not keep its thread through useThread`);
    }
  });

  it("S39 Enter sends: the web's Enter (not Shift+Enter, not mid-composition) and the iPhone's Send key, and the button stays", () => {
    assert.match(composer, /submitBehavior="submit"/, "the iPhone's return key would make a new line instead of sending");
    assert.match(composer, /enterKeyHint="send"/, "the keyboard's return key does not say Send");
    assert.match(composer, /onSubmitEditing=\{Platform\.OS === "web" \? undefined : submit\}/, "the iPhone's Send key does not send");
    assert.match(composer, /onKeyPress=\{Platform\.OS === "web" \? onKeyPress : undefined\}/, "the web's Enter is not handled");
    const keys = composer.slice(composer.indexOf("const onKeyPress"), composer.indexOf("\n  };", composer.indexOf("const onKeyPress")));
    assert.match(keys, /key\.key !== "Enter" \|\| key\.shiftKey \|\| key\.isComposing \|\| key\.keyCode === 229\) return;/, "Shift+Enter or a half-composed word would send");
    assert.match(keys, /e\.preventDefault\(\);\s*submit\(\);/, "Enter sends and ALSO types a new line");
    assert.match(composer, /accessibilityLabel=\{THREAD_COPY\.send\}/, "the Send button is gone");
  });

  it("S40 the frame keeps a footer on the keyboard and the newest message in view — in the shared frame, not a screen", () => {
    // Round 2: the room the keyboard needs is measured once (components/keyboard.ts) and
    // given up at the foot of the frame, on iOS and the web alike (S52-S54).
    const conv = frame.slice(frame.indexOf("function Conversation"), frame.indexOf("const styles"));
    assert.ok(conv.length > 100, "the conversation frame is gone");
    assert.match(conv, /useKeyboardRoom\(edges\)/, "the conversation does not make room for the keyboard");
    assert.match(conv, /paddingBottom: room/, "the footer is not lifted onto the keyboard");
    assert.doesNotMatch(conv, /automaticallyAdjustKeyboardInsets|KeyboardAvoidingView/, "the keyboard counted twice");
    assert.match(conv, /onContentSizeChange=\{follow\}/, "a new message does not keep the newest in view");
    assert.match(conv, /onLayout=\{follow\}/, "the keyboard or a taller box does not keep the newest in view");
    assert.match(conv, /useEffect\(follow, \[room, follow\]\)/, "the keyboard coming up does not keep the newest message over the box");
    // React Native Web dismisses "on-drag" on ANY scroll, its own included: following the
    // newest message blurred the box mid-word (every other new line lost, in real Chrome).
    assert.match(conv, /keyboardDismissMode=\{Platform\.OS === "ios" \? "on-drag" : "none"\}/, "the web blurs the box every time the conversation follows a new message");
    for (const [name, src] of threads) assert.doesNotMatch(src, /KeyboardAvoidingView|visualViewport|Keyboard\./, `${name} handles the keyboard itself`);
  });

  it("S41 a message never reloads the room: Realtime merges its own row, the poll reads 'since', and only postgres_changes", () => {
    const handler = lib.slice(lib.indexOf('.on("postgres_changes"'), lib.indexOf(".subscribe("));
    assert.ok(handler.length > 50, "S41 cannot find the Realtime handler");
    assert.match(handler, /arrived\(\[row\]\)/, "a Realtime row is not merged as itself");
    assert.doesNotMatch(handler, /refetch|invalidate|loadRoom|loadGroup/, "a Realtime event reloads something");
    assert.doesNotMatch(lib, /broadcast/, "broadcast ignores RLS (decisions, 'Realtime via postgres_changes only')");
    assert.match(lib, /\.gte\("created_at", since\)/, "the poll is not a 'since' read");
    assert.match(lib, /POLL_FALLBACK_MS = 10_000/, "Realtime down: decisions says poll every 10 seconds");
    assert.match(lib, /healthy \? POLL_HEALTHY_MS : POLL_FALLBACK_MS/, "the poll does not back off while Realtime is healthy");
    for (const [name, src] of threads) {
      assert.doesNotMatch(src, /\.channel\(|postgres_changes/, `${name} subscribes on its own, outside the thread`);
      assert.doesNotMatch(src, /setInterval\(/, `${name} polls on its own`);
    }
    // The shell no longer reads messages, and a face is signed only through the cache.
    const shell = roomLib.slice(roomLib.indexOf("export async function loadRoomShell"), roomLib.indexOf("export function sharedTag"));
    assert.ok(shell.length > 200, "S41 cannot find the room's shell");
    assert.doesNotMatch(shell, /room_messages/, "the room's shell reads the messages again");
    assert.doesNotMatch(group.slice(group.indexOf("async function loadGroupShell"), group.indexOf("export default")), /crew_messages/, "the group's card reads the messages again");
    const SRC = join(process.cwd(), "app", "src");
    const signers = (function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : /\.tsx?$/.test(n) && /createSignedUrls\(/.test(readFileSync(join(dir, n), "utf8")) ? [n] : []));
    })(SRC);
    assert.ok(signers.includes("signed-photos.ts"), "S41 cannot see the photo cache sign anything");
    for (const f of ["room.ts", "[id].tsx", "thread.ts"]) assert.ok(!signers.includes(f), `${f} signs photos itself, outside the cache`);
  });

  it("S43 a long-press reports the PERSON, from every thread, through one sheet — no message report is written anywhere", () => {
    // Alex, 16 Oct 2026: "We report people, not messages."
    const SRC = join(process.cwd(), "app", "src");
    const all = (function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : /\.tsx?$/.test(n) ? [join(dir, n)] : []));
    })(SRC).map((f) => ({ path: f.slice(SRC.length + 1).split("\\").join("/"), src: readFileSync(f, "utf8").replace(/^\s*\/\/.*$/gm, "") }));
    const messageReport = /target_kind:\s*"message"|target_room_message_id|target_message_id/;
    assert.ok(messageReport.test('{ target_kind: "message" }'), "S43 cannot see a message report");
    assert.deepEqual(all.filter((f) => messageReport.test(f.src)).map((f) => f.path), [], "a message report is still written");
    const fnAt = roomLib.indexOf("export async function reportFromMessage");
    const fn = roomLib.slice(fnAt, roomLib.indexOf(String.fromCharCode(10) + "}", fnAt));
    assert.ok(fn.length > 100, "reportFromMessage is gone");
    assert.match(fn, /target_kind: "person",\s*target_person_id: message\.authorId/, "a report from a message is not a report on its author");
    assert.match(fn, /context_at: message\.createdAt/, "the report does not say when");
    assert.doesNotMatch(fn, /body|snapshot/, "the report carries the message's words");
    const sheet = read("components/MessageSheet.tsx");
    assert.match(sheet, /ROOM_COPY\.reportPerson\(authorName\)/, "the sheet does not say whose report it is");
    for (const [name, src, where] of [["the room", room, "{ roomId: view.roomId }"], ["the group", group, "{ crewId: view.id }"]] as const) {
      assert.ok(src.includes("<MessageSheet"), `${name} draws its own long-press menu`);
      assert.ok(src.includes(`reportFromMessage(`) && src.includes(where), `${name} does not report from its own thread`);
      assert.match(src, /onLongPress=\{/, `${name} has no long-press: report is not two taps from its messages (H9)`);
    }
  });

  it("S44 removal has its own 15-second recheck, apart from the arrivals poll and the shell", () => {
    assert.match(lib, /const RECHECK_MS = 15_000;/, "removal is not on its 15-second path");
    assert.match(lib, /setInterval\(\(\) => void sweep\(\), RECHECK_MS\)/, "the recheck has no timer of its own");
    const sweep = lib.slice(lib.indexOf("const sweep = useCallback"), lib.indexOf("const catchUp = useCallback"));
    assert.ok(sweep.length > 50, "S44 cannot find the recheck");
    assert.match(sweep, /read\(kind, id, "id"\)/, "the recheck reads more than ids");
    assert.equal((sweep.match(/rows\(/g) ?? []).length, 1, "the recheck is more than one query");
    assert.match(room, /const SHELL_MS = 60_000;/, "the room's shell moved off its minute");
  });

  it("S42 'I've looked' is marked as a thread comes into view, at most once a minute while it is, and as you leave — in the room and in a group alike; never on a refresh", () => {
    // The group's half since A19 (16 Oct 2026): My Events counts unread from these marks.
    for (const [name, src, fn] of [["the room", room, "markSeen"], ["the group", group, "markGroupSeen"]] as const) {
      assert.equal((src.match(new RegExp(`${fn}\\(`, "g")) ?? []).length, 1, `${name}: ${fn} is called from more than one place`);
      assert.match(src, new RegExp(`const seen = useCallback\\(\\(\\) => \\{\\s*lastSeen\\.current = Date\\.now\\(\\);\\s*return ${fn}\\(id\\)`), `${name}: ${fn} is not behind the throttle`);
      assert.match(src, /Date\.now\(\) - lastSeen\.current >= SEEN_MS\) void seen\(\)/, `${name}: an arriving message marks seen without the throttle`);
      assert.match(src, /setFocused\(true\);\s*void seen\(\);/, `${name}: coming into view does not mark seen`);
      assert.match(src, /setFocused\(false\);\s*void seen\(\)\.then\(\(\) => queryClient\.invalidateQueries\(\{ queryKey: MY_CHATS_KEY \}\)\)/, `${name}: leaving does not mark seen and refresh My Events — what you just read stays "unread"`);
    }
    assert.doesNotMatch(roomLib.slice(roomLib.indexOf("export async function loadRoomShell"), roomLib.indexOf("export function sharedTag")), /room_seen|markSeen/, "the shell marks seen on every refresh");
    assert.doesNotMatch(group.slice(group.indexOf("async function loadGroupShell"), group.indexOf("export default")), /crew_seen|markGroupSeen/, "the group's card marks seen on every refresh");
  });
});

describe("One way to press, and motion that respects the person (the 'feel alive' pass, 16 Oct 2026)", () => {
  const SRC = join(process.cwd(), "app", "src");
  const all = (function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : /\.tsx?$/.test(n) ? [join(dir, n)] : []));
  })(SRC).map((f) => ({ path: f.slice(SRC.length + 1).split("\\").join("/"), src: readFileSync(f, "utf8").replace(/^\s*\/\/.*$/gm, "") }));
  const read = (p: string) => all.find((f) => f.path === p)?.src ?? "";

  it("S45 nothing presses but Tap: no raw Pressable or Touchable* anywhere in the app — so every press springs, and none forgets its haptic", () => {
    // A pressable from react-native, imported or used — named or as a JSX tag.
    const raw = /\b(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback|TouchableNativeFeedback)\b/;
    assert.ok(raw.test('import { Pressable, View } from "react-native";') && raw.test("<TouchableOpacity onPress={x}>"), "S45 cannot see a raw pressable");
    const offenders = all.filter((f) => f.path !== "components/Tap.tsx" && raw.test(f.src)).map((f) => f.path);
    assert.deepEqual(offenders, [], "these draw their own pressable instead of Tap");
    assert.match(read("components/Tap.tsx"), /Animated\.createAnimatedComponent\(Pressable\)/, "Tap is not the one place a Pressable lives");
    assert.ok(all.filter((f) => /<Tap\b/.test(f.src)).length >= 10, "S45 found almost nothing using Tap — the swap did not happen");
  });

  it("S46 motion stays inside ~250 ms, and Reduce Motion makes it instant — in Tap, the entrances and the tab switch", () => {
    const motion = read("lib/motion.ts");
    const num = (name: string) => Number((motion.match(new RegExp(`export const ${name} = (\\d+)`)) ?? [])[1]);
    for (const n of ["MOTION_MAX_MS", "RISE_MS", "STAGGER_MS", "STAGGER_MAX"]) assert.ok(Number.isFinite(num(n)), `S46 cannot read ${n}`);
    assert.ok(num("MOTION_MAX_MS") <= 250, "the motion budget grew past 250 ms");
    assert.ok(num("RISE_MS") <= num("MOTION_MAX_MS"), "an entrance is longer than the budget");
    assert.ok(num("RISE_MS") + num("STAGGER_MS") * num("STAGGER_MAX") <= num("MOTION_MAX_MS") + 20, "a staggered list takes longer than ~250 ms to land");
    const tabs = read("app/(tabs)/_layout.tsx");
    const tabMs = Number((tabs.match(/duration: (\d+)/) ?? [])[1]);
    assert.ok(tabMs > 0 && tabMs <= num("MOTION_MAX_MS"), "the tab crossfade is missing or too slow");
    assert.match(tabs, /animation: reduce \? "none" : "fade"/, "the tab switch fades even under Reduce Motion");
    assert.match(read("components/Tap.tsx"), /if \(reduce\) value\.setValue\(to\);/, "a press still animates under Reduce Motion");
    assert.match(read("components/Motion.tsx"), /const still = reduce \|\| !animate;/, "an entrance still animates under Reduce Motion");
    // Haptics are not motion: Reduce Motion must not silence them.
    const fnAt = motion.indexOf("export function haptic");
    const body = motion.slice(fnAt, motion.indexOf(String.fromCharCode(10) + "}", fnAt));
    assert.ok(fnAt >= 0 && body.length > 50, "S46 cannot find haptic()");
    assert.doesNotMatch(body, /reduce/i, "Reduce Motion switches haptics off");
  });

  it("S47 the haptic is where it was asked for: pin, send, join, propose, accept — and never on the web", () => {
    const motion = read("lib/motion.ts");
    assert.match(motion, /export function haptic\(kind: HapticKind\): void \{\s*if \(Platform\.OS === "web"\) return;/, "the web gets haptics");
    assert.match(read("components/Composer.tsx"), /const submit = \(\) => \{\s*if \(!can\) return;\s*onSend\(\);\s*haptic\("action"\);/, "send has no haptic (or fires one for an empty box)");
    assert.match(read("components/SquadSection.tsx"), /<Tap accessibilityRole="button" haptic="action"[^>]*onPress=\{onJoin\}/, "join has no haptic");
    assert.match(read("components/SoloSection.tsx"), /label=\{SOLO_COPY\.accept\} haptic="action"/, "accept has no haptic");
    // #17: proposing is "Let's meet up!" now (the sheet is gone).
    assert.match(read("components/SoloSection.tsx"), /label=\{SOLO_COPY\.letsMeetUp\}\s*haptic="action"/, "'Let's meet up!' has no haptic");
    assert.match(read("app/pin/[slug].tsx"), /if \(!pinId && !written\.already\) haptic\("success"\);/, "a new pin is not felt as it lands");
    // A selection, not an act: chips, radios, checkboxes and tabs tick by their role.
    assert.match(read("components/Tap.tsx"), /const SELECTS = new Set\(\["radio", "checkbox", "tab", "switch", "togglebutton"\]\)/, "a chip's tap is no longer a selection tick");
    // Nothing on a passive tap: a plain Button asks for none unless told.
    assert.match(read("components/ui.tsx"), /haptic=\{haptic \?\? null\}/, "every Button buzzes, not only the primary acts");
  });
});

describe("A1 over an anonymous session is the link (#11)", () => {
  const identitySteps = [...screens]
    .flatMap((s) => [...s.source.matchAll(/<IdentityStep\b[\s\S]*?\/>/g)].map((m) => ({ path: s.path, tag: m[0] })));

  it("S49 the identity steps are found (A1 and A27's two) — a pattern that matches nothing must not pass", () => {
    assert.ok(identitySteps.length >= 3, `found ${identitySteps.length}`);
    assert.ok(identitySteps.some((s) => /mode="link"/.test(s.tag)), "cannot see A27's link step, so the pattern below proves nothing");
  });

  it("S50 no screen hands the identity step a fixed sign-in; A1 takes its mode from identityModeFor", () => {
    const fixed = identitySteps.filter((s) => /mode="sign-in"/.test(s.tag)).map((s) => s.path);
    assert.deepEqual(fixed, [], "these sign in over whatever session is on the device — a quick pin's person is left behind, counted");
    const a1 = screens.find((s) => s.path.replace(/\\/g, "/") === "(onboarding)/sign-in.tsx");
    assert.ok(a1, "A1 not found");
    assert.match(a1.source, /identityModeFor\(data\.session\)/, "A1 does not read its mode from the session");
    assert.match(a1.source, /mode=\{mode\}/, "A1 does not pass the mode it read");
  });
});

describe("A16: picking an answer is not sending it (#10)", () => {
  const a16 = readFileSync("app/src/app/after/[slug].tsx", "utf8");

  it("S51 the answers are a Choice, and the answer is sent from one place, Done; Done with nothing picked writes nothing", () => {
    assert.match(a16, /<Choice\b[\s\S]*?options=\{AFTER_COPY\.answers\.map/, "the answers are not a choice");
    const calls = [...a16.matchAll(/\banswer\(view\.gathering\.id/g)];
    assert.equal(calls.length, 1, `answer() is called ${calls.length} times; it must be once, from Done`);
    assert.match(a16, /label=\{AFTER_COPY\.send\}[\s\S]{0,200}picked \? void act\("q", "send your answer", \(\) => answer\(view\.gathering\.id, picked\)\) : setDone\(true\)/, "Done does not send the picked answer, or writes something with none picked");
    assert.doesNotMatch(a16, /AFTER_COPY\.answers\.map\(\(a\) => \(\s*<Button/, "an answer is a button again — one tap would send it");
  });
});
