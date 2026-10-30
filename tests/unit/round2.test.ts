// UI pass 1, round 2 (Alex, 30 Oct 2026): the rules that are shared so no screen can go its
// own way, each proved by a test that fails when one does. Each scanner first proves it can
// see the thing it looks for (CLAUDE.md, "A test that reads the source must prove its own
// pattern matches something real").
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CROWD_COPY } from "../../packages/shared/src/crowd.ts";
import { HERE_COPY, ROOM_COPY } from "../../packages/shared/src/room.ts";
import { oneOnOneLine, oneOnOneState, type OneOnOneState } from "../../packages/shared/src/solo.ts";
import { INBOX_COPY, readMyChats } from "../../packages/shared/src/myevents.ts";

const APP = join("app", "src");
function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}
const unix = (p: string) => p.split(String.fromCharCode(92)).join("/");
const ALL = files(APP).map((p) => ({ path: unix(p), src: readFileSync(p, "utf8") }));
const read = (rel: string) => ALL.find((f) => f.path.endsWith(rel))?.src ?? "";
const isRoute = (p: string) => p.includes("app/src/app/");

describe("Every screen and every step opens at the top (item 3)", () => {
  // A route that changes step re-renders AppScreen in place, so the scroll it had stays.
  const STEP = /\bset(Step|Stage|Page|Sent)\(/;
  const stepping = ALL.filter((f) => STEP.test(f.src) && !f.path.endsWith("components/AppScreen.tsx"));

  it("S56 a route with steps passes each one to the frame, and a component inside it calls useStepTop", () => {
    assert.ok(stepping.length >= 4, `only ${stepping.length} files with steps found: the pattern cannot see them`);
    for (const name of ["app/opt-in/[slug].tsx", "app/pin/[slug].tsx", "profile/WhereStep.tsx", "profile/IdentityStep.tsx"]) {
      assert.ok(stepping.some((f) => f.path.endsWith(name)), `${name} changes step and the scan missed it`);
    }
    for (const f of stepping) {
      if (isRoute(f.path)) {
        const frames = f.src.match(/<AppScreen\b[^>]*>/g) ?? [];
        const scrolling = frames.filter((t) => !/scroll=\{false\}/.test(t));
        assert.ok(scrolling.length > 0, `${f.path} has steps and no frame`);
        for (const t of scrolling) assert.match(t, /\bstep=\{/, `${f.path}: ${t} keeps the last step's scroll`);
      } else {
        assert.match(f.src, /useStepTop\(/, `${f.path} changes step without useStepTop: the next step opens where the last was scrolled`);
      }
    }
  });

  it("S57 the frame scrolls to the top on every step, and nothing else in the app scrolls a page", () => {
    const frame = read("components/AppScreen.tsx");
    assert.match(frame, /useEffect\(toTop, \[step, toTop\]\)/, "the frame ignores a route's step");
    assert.match(frame, /export function useStepTop\(step: unknown\)[\s\S]{0,160}toTop\(\);[\s\S]{0,20}\}, \[step, toTop\]\)/, "useStepTop does not scroll to the top");
    assert.match(frame, /scrollTo\(\{ y: 0, animated: false \}\)/);
    const own = ALL.filter((f) => !/components\/(AppScreen|keyboard)\.tsx?$/.test(f.path) && /\.scrollTo(End)?\(|contentOffset=/.test(f.src)).map((f) => f.path);
    assert.deepEqual(own, [], "these scroll a page themselves");
  });
});

describe("Wherever you type, the screen makes room for the keyboard (item 4)", () => {
  const KEYBOARD = /KeyboardAvoidingView|automaticallyAdjustKeyboardInsets|Keyboard\.addListener|visualViewport/;

  it("S52 the keyboard is measured in one place: no screen or component measures it itself", () => {
    assert.match(read("components/keyboard.ts"), KEYBOARD, "the pattern cannot see the one place that measures it");
    const own = ALL.filter((f) => !f.path.endsWith("components/keyboard.ts") && KEYBOARD.test(f.src)).map((f) => f.path);
    assert.deepEqual(own, [], "these handle the keyboard on their own");
  });

  it("S53 every sheet is the shared frame: no component opens a Modal of its own", () => {
    assert.match(read("components/Sheet.tsx"), /<Modal\b/, "the pattern cannot see the sheet's own Modal");
    const own = ALL.filter((f) => !f.path.endsWith("components/Sheet.tsx") && /<Modal\b|from "react-native-modal"/.test(f.src)).map((f) => f.path);
    assert.deepEqual(own, [], "these open a sheet the keyboard can cover");
  });

  it("S54 the page, the conversation and the sheet each give up the keyboard's room, and keep the field typed in, with its button, in view", () => {
    const frame = read("components/AppScreen.tsx");
    const page = frame.slice(frame.indexOf("function Page"), frame.indexOf("function Conversation"));
    assert.match(page, /useKeyboardRoom\(edges\)/);
    assert.match(page, /paddingBottom: room/, "a page's scroll runs under the keyboard");
    assert.match(page, /useKeepInView\(ref, inset\)/, "a page does not bring the focused field into view");
    assert.match(page, /onScroll=\{onScroll\}/, "the page does not tell useKeepInView where it is");
    const sheet = read("components/Sheet.tsx");
    assert.match(sheet, /bottom: inset/, "a sheet sits behind the keyboard");
    assert.match(sheet, /maxHeight: tallest/, "a sheet can be taller than what the keyboard leaves");
    assert.match(sheet, /useKeepInView\(ref, inset\)/, "a sheet does not bring the focused field into view");
    const kb = read("components/keyboard.ts");
    assert.match(kb, /ROOM_BELOW/, "the field is kept in view but its button is not");
    assert.match(kb, /focusin/, "on the web, moving to the next field does not bring it into view");
    assert.match(kb, /"keyboardDidShow"/, "on iOS, moving to the next field does not bring it into view");
  });

  it("S55 every field is inside one of the two frames: every route with a field draws AppScreen, and every component with one is drawn by a route or a sheet", () => {
    const FIELD = /<TextInput\b|<Field\b/;
    const withFields = ALL.filter((f) => FIELD.test(f.src) && !f.path.endsWith("components/ui.tsx"));
    assert.ok(withFields.length >= 8, `only ${withFields.length} files with a field found`);
    for (const f of withFields.filter((x) => isRoute(x.path))) assert.match(f.src, /<AppScreen\b/, `${f.path} has a field outside the frame`);
    // A component's own vertical ScrollView would sit inside the frame's and keep its field
    // from it. A sideways row (the room's openers over the box) scrolls nothing vertical.
    const VERTICAL = /<ScrollView\b(?![^>]*\bhorizontal\b)/;
    assert.ok(VERTICAL.test("<ScrollView contentContainerStyle={x}>") && !VERTICAL.test("<ScrollView horizontal showsHorizontalScrollIndicator={false}>"), "the pattern cannot tell the two apart");
    for (const f of withFields.filter((x) => !isRoute(x.path))) {
      assert.ok(!VERTICAL.test(f.src), `${f.path} scrolls its field in a ScrollView of its own, out of the frame's reach`);
    }
  });
});

describe("In the room is not at the venue (item 5)", () => {
  it("S58 room copy never says 'here'; arriving says 'arrived', with its own count", () => {
    const words = (o: Record<string, unknown>) =>
      Object.values(o).flatMap((v) => (typeof v === "string" ? [v] : typeof v === "function" ? [String((v as (...a: unknown[]) => unknown)("Sam", "Sam"))] : []));
    const room = words(ROOM_COPY as unknown as Record<string, unknown>);
    assert.ok(room.length > 20, "the scan cannot see the room's copy");
    assert.ok(/\bhere\b/i.test("You're the first here"), "the pattern cannot see the word");
    assert.deepEqual(room.filter((w) => /\bhere\b/i.test(w)), [], "the room says 'here'");
    assert.equal(ROOM_COPY.firstHeading, "You're the first in the room");
    assert.equal(CROWD_COPY.roomCount(4), "4 in the room");
    assert.equal(HERE_COPY.label, "I've arrived");
    assert.equal(HERE_COPY.count(3), "3 have arrived");
    assert.equal(HERE_COPY.count(1), "1 has arrived");
  });

  it("S59 the crowd page: the Meeting Room under the counters, then squads, then 'I've arrived' with its count; the counters carry no arrivals", () => {
    const a9 = read("app/crowd/[slug].tsx");
    const counters = a9.indexOf("<Counters ");
    const room = a9.indexOf("styles.roomCard");
    const squads = a9.indexOf("<SquadSection ");
    const arrived = a9.indexOf("<ImHere ");
    assert.ok(counters > 0 && room > 0 && squads > 0 && arrived > 0, "the page's pieces cannot be found");
    assert.ok(counters < room && room < squads && squads < arrived, "out of order: counters, room, squads, I've arrived");
    assert.doesNotMatch(a9.slice(counters, a9.indexOf("/>", counters)), /extra=|HERE_COPY/, "the arrivals count is back with the top counters");
    assert.equal((a9.match(/<ImHere /g) ?? []).length, 1, "'I've arrived' is drawn twice on the crowd page");
    // Only on the night: the here read is null outside -3 h .. the end, and ImHere hangs on it.
    assert.match(a9, /t < Date\.parse\(g\.startsAt\) - 3 \* 3_600_000 \|\| t >= Date\.parse\(g\.effectiveEnd\)\) return setHereNow\(null\)/);
    assert.match(a9, /\{here \? \(\s*<View[^>]*>\s*<ImHere /, "'I've arrived' shows outside the night");
  });
});

describe("A missing 1-on-1 button always says why (item 8)", () => {
  const base = { atGathering: true, available: true, asked: false, started: false, inPlan: false, mineOn: true, open: true };

  it("O01 the button shows exactly when everything allows it, and each fact on its own turns it into its reason", () => {
    assert.equal(oneOnOneState(base), "ask");
    const one: [Partial<typeof base>, OneOnOneState][] = [
      [{ atGathering: false }, "elsewhere"],
      [{ available: false }, "paused"],
      [{ asked: true }, "asked"],
      [{ started: true }, "closed"],
      [{ inPlan: true }, "planned"],
      [{ mineOn: false }, "turnOn"],
      [{ open: false }, "theirs"],
    ];
    for (const [f, want] of one) assert.equal(oneOnOneState({ ...base, ...f }), want, JSON.stringify(f));
  });

  it("O02 a request already sent stays 'sent' even after the start; your own reason comes before theirs", () => {
    assert.equal(oneOnOneState({ ...base, asked: true, started: true, open: false }), "asked");
    assert.equal(oneOnOneState({ ...base, mineOn: false, open: false }), "turnOn", "it blamed them for your own switch");
    assert.equal(oneOnOneState({ ...base, started: true, open: false }), "closed");
  });

  it("O03 every state but the button has a line, one line, with no em dash; theirs names them and nothing else", () => {
    const states: OneOnOneState[] = ["asked", "theirs", "turnOn", "closed", "paused", "planned", "elsewhere"];
    for (const s of states) {
      const line = oneOnOneLine(s, "Priya");
      assert.ok(line && line.length > 10 && !line.includes("\n") && !line.includes("—"), `${s}: ${line}`);
    }
    assert.equal(oneOnOneLine("ask", "Priya"), null);
    assert.equal(oneOnOneLine("theirs", "Priya"), "Priya isn't taking 1-on-1 requests");
    assert.equal(oneOnOneLine("turnOn", "Priya"), "Turn on 1-on-1 chats to send requests");
    assert.equal(oneOnOneLine("closed", "Priya"), "Requests close when the event starts");
  });

  it("O04 the sheet cannot be drawn without its 1-on-1 part, every caller fills it from useOneOnOne, and 'turn on' comes with the switch", () => {
    const sheet = read("components/PersonSheet.tsx");
    assert.match(sheet, /oneOnOne: SheetOneOnOne \| null;/, "the 1-on-1 part is optional again: a screen can leave it out and show nothing");
    assert.match(sheet, /state === "turnOn" \? <OneOnOneSwitch /, "'Turn on 1-on-1 chats' without the switch");
    assert.match(sheet, /oneOnOneLine\(oneOnOne\.state, person\.firstName\)/);
    const callers = ALL.filter((f) => /<PersonSheet\b/.test(f.src) && !f.path.endsWith("PersonSheet.tsx"));
    assert.ok(callers.length >= 2, "the scan cannot see the sheet's callers");
    for (const f of callers) {
      assert.match(f.src, /oneOnOne=\{sheet \? oneOnOne\.forPerson\(sheet\.id\) : null\}/, `${f.path} draws the sheet without the shared 1-on-1 part`);
      assert.match(f.src, /useOneOnOne\(/, `${f.path} works out 1-on-1 on its own`);
    }
    assert.match(read("app/person/[id].tsx"), /oneOnOneLine\("elsewhere"/, "a full profile says nothing about 1-on-1");
  });
});

describe("The chat leads (item 9)", () => {
  const group = read("app/group/[id].tsx");
  const room = read("app/room/[id].tsx");
  const menuAt = group.indexOf("<Sheet visible={menu}");
  const infoAt = room.indexOf("<Sheet visible={info}");

  it("S60 the squad page: sharing, details, leaving and 'Get the app' are in the ••• sheet; 'I've arrived' is the slim row, with Later", () => {
    assert.ok(menuAt > 0, "the squad's ••• sheet is gone");
    for (const [what, pattern] of [
      ["share", /SHARE_COPY\.button/],
      ["get the app", /<GetTheApp \/>/],
      ["leave", /SQUAD_COPY\.leave/],
      ["call off", /SOLO_COPY\.callOff\b/],
    ] as const) {
      const at = group.search(pattern);
      assert.ok(at > 0, `cannot find ${what}`);
      assert.ok(at > menuAt, `${what} is on the page above the chat, not in the ••• sheet`);
    }
    assert.doesNotMatch(group, /<Field\b/, "the old 'I'm here' form is back on the page");
    assert.match(group, /<ImHere\s+slim\b/, "'I've arrived' is not the slim row");
    assert.match(group, /onLater=\{/, "'I've arrived' cannot be put away");
    assert.match(group, /putAway\(`arrived\.\$\{view\.id\}`\)/, "Later is not for this squad only");
  });

  it("S61 the room: the header, one optional line, then the conversation; the faces are in the info sheet", () => {
    assert.ok(infoAt > 0, "the room's info sheet is gone");
    const faces = room.indexOf("<SideScroll>");
    assert.ok(faces > infoAt, "the row of faces is on the page above the conversation");
    const goTogether = room.indexOf("ROOM_COPY.enoughToGo");
    assert.ok(goTogether > 0 && !room.slice(goTogether - 400, goTogether).includes("styles.go}"), "go-together is a card again, not a line");
  });
});

// UI pass 1, round 3, item 11: A19 says what kind of chat each row is, at a glance.
describe("My Events says what kind of chat each row is (round 3, item 11)", () => {
  const inbox = read("app/(tabs)/my-events.tsx");

  it("M30 my_chats' answer carries a squad's size and faces, and a 1-on-1's other person", () => {
    const [e] = readMyChats([{ gathering_id: "g", slug: "s", starts_at: "2026-10-31T00:00:00Z", crews: [
      { crew_id: "c", kind: "crew", name: "Section 314", members: 3, faces: [{ person_id: "p", first_name: "Ari", photo_path: "a/1.jpg" }] },
      { crew_id: "d", kind: "solo", partner: "Sam" },
    ] }]);
    assert.equal(e.crews[0].members, 3);
    assert.deepEqual(e.crews[0].faces, [{ id: "p", firstName: "Ari", photoPath: "a/1.jpg" }]);
    assert.deepEqual(e.crews[1].faces, [], "a missing list is empty, never a crash");
    assert.equal(INBOX_COPY.squadTag(3), "Squad · 3 of you");
    assert.equal(INBOX_COPY.meetingRoom, "Pin'd Meeting Room");
  });

  it("S62 every chat row has its tag and picture; the Meeting Room is first under its event", () => {
    assert.ok(inbox.length > 0, "cannot read A19");
    for (const tag of ["INBOX_COPY.everyoneTag", "INBOX_COPY.squadTag(", "INBOX_COPY.oneOnOneTag", "INBOX_COPY.womenOnlyTag"]) {
      assert.ok(inbox.includes(tag), `a row lost its tag: ${tag}`);
    }
    const first = inbox.indexOf("const rows: Row[] = [");
    assert.ok(first > 0 && /kind: "room"/.test(inbox.slice(first, first + 200)), "the Meeting Room is not the first row under its event");
    assert.match(inbox, /function KindMark\b/, "rows are told apart by colour alone");
    assert.match(inbox, /<KindMark row=\{row\}/, "a row does not draw its kind");
  });
});
