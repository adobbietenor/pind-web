// M3.4 — 1-on-1 (A28, A29). The visibility is the harness's (P209–P215); these hold the
// admin to the way back (Alex, 14 Oct 2026: "a single bad report must not be a one-way
// door"; solo does not ship until it exists — decisions, "M3.4: who can see whom in 1-on-1").
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { SOLO_LINES, soloLinesFor, soloRefusal, soloTimes } from "../../packages/shared/src/solo.ts";

describe("The way back into 1-on-1 is wired, end to end (M3.4)", () => {
  const routes = readFileSync("src/admin/routes.ts", "utf8");
  const moderation = readFileSync("src/admin/moderation.ts", "utf8");

  it("SO01 the route exists and calls the database's return, not anything else", () => {
    assert.match(routes, /\["POST \/admin\/people\/:id\/return-to-solo", m\.returnToSolo\]/, "no route returns someone to 1-on-1");
    assert.match(moderation, /export const returnToSolo = personAction\("admin_return_to_solo",/, "the handler does not call admin_return_to_solo");
  });

  it("SO02 the report queue finds everyone out of 1-on-1 and offers the button on their card", () => {
    // The pattern must see a real read first, or "no match" would pass by finding nothing.
    assert.match(moderation, /\.eq\("hidden_from_solo", true\)/, "the queue never looks for people out of 1-on-1");
    assert.match(moderation, /actionForm\(personId, "return-to-solo", "Return to 1-on-1"/, "the card offers no way back");
    assert.match(moderation, /Out of 1-on-1, nothing else open/, "someone out of 1-on-1 with no open report would be on no list at all");
  });
});

describe("1-on-1's times, lines and refusals (M3.4)", () => {
  const start = "2026-11-03T00:00:00.000Z"; // 7 pm Toronto
  const past = new Date("2026-10-01T00:00:00.000Z");

  it("SO03 times run every quarter hour from 3 h before the start to 2 h after the effective end, and never in the past", () => {
    const t = soloTimes(start, null, past);
    assert.equal(t[0], "2026-11-02T21:00:00.000Z");
    assert.equal(t[t.length - 1], "2026-11-03T05:00:00.000Z", "the effective end is the start + 3 h; two hours after it");
    assert.equal(t.length, (8 * 60) / 15 + 1);
    assert.equal(soloTimes(start, "2026-11-03T02:00:00.000Z", past).at(-1), "2026-11-03T04:00:00.000Z", "an end time was ignored");
    // A start off the quarter hour: the first time is the next quarter after −3 h.
    assert.equal(soloTimes("2026-11-03T00:10:00.000Z", null, past)[0], "2026-11-02T21:15:00.000Z");
    // Half an hour before the start, only what is still ahead.
    assert.equal(soloTimes(start, null, new Date("2026-11-02T23:30:00.000Z"))[0], "2026-11-02T23:45:00.000Z");
  });

  it("SO04 a time after the start offers only the lines worded for any time; before it, all five", () => {
    assert.deepEqual(soloLinesFor("2026-11-02T23:00:00.000Z", start).map((l) => l.n), [1, 2, 3, 4, 5]);
    assert.deepEqual(soloLinesFor("2026-11-03T04:00:00.000Z", start).map((l) => l.n), [3, 4]);
    assert.equal(SOLO_LINES.length, 5);
    for (const l of SOLO_LINES) assert.ok(l.text("North Gate", "6:00 pm").includes("North Gate") && l.text("North Gate", "6:00 pm").includes("6:00 pm"), `line ${l.n} drops the spot or the time`);
  });

  it("SO05 every refusal the database can give a proposal has its own sentence, and none says why someone is unavailable", () => {
    const dir = "supabase/migrations";
    const sql = readdirSync(dir).filter((f) => f.includes("m3_4_")).map((f) => readFileSync(`${dir}/${f}`, "utf8")).join(String.fromCharCode(10));
    const quote = "'";
    const pattern = new RegExp(`raise exception ${quote}(refused: [^${quote}]+(?:${quote}${quote}[^${quote}]+)*)${quote}`, "g");
    const refusals = [...sql.matchAll(pattern)].map((m) => m[1].split(quote + quote).join(quote))
      .filter((m) => !["refused: no person", "refused: no such proposal", "refused: not in this group", "refused: after closed", "refused: we met first", "refused: matched"].includes(m));
    // The pattern must see the real ones first, or "every one maps" would pass by finding none.
    assert.ok(refusals.length >= 7, `found only ${refusals.length} refusals in the M3.4 migrations`);
    const generic = soloRefusal("something else");
    for (const r of refusals) assert.notEqual(soloRefusal(r), generic, `"${r}" falls through to the generic sentence`);
    for (const r of refusals) assert.doesNotMatch(soloRefusal(r), /block|report|hidden|switched/i, `"${r}" says why`);
  });
});

describe("The 1-on-1 screens use the rules, not their own (M3.4)", () => {
  const section = readFileSync("app/src/components/SoloSection.tsx", "utf8");
  const lib = readFileSync("app/src/lib/solo.ts", "utf8");

  it("SO06 there is nowhere to type: the section has no text input, and a proposal is a spot, a time and a line", () => {
    // The pattern must see the controls it does use first, or "no TextInput" proves nothing.
    assert.match(section, /<Chips options=\{view\.spots/, "the sheet does not offer the venue's spots");
    assert.doesNotMatch(section, /TextInput|<Field|multiline/, "the 1-on-1 section has a free-text field");
    assert.match(section, /proposeSolo\(gatheringId, proposing\.id, spotId, meetAt, line\)/, "a proposal carries something other than a spot, a time and a line");
  });

  it("SO07 the sheet offers the shared times and lines, never its own", () => {
    assert.match(section, /const times = soloTimes\(view\.startsAt, view\.endsAt\)/, "the sheet makes its own list of times");
    assert.match(section, /soloLinesFor\(time, view\.startsAt\)/, "the sheet offers lines without asking which fit the time");
    assert.match(section, /disabled=\{view\.sent\.length >= SOLO_MAX_OPEN\}/, "the fourth proposal is not stopped where it is tapped");
  });

  it("SO08 every write goes through the database's functions, and a refusal comes back in words, where the tap was", () => {
    for (const fn of ["propose_solo", "respond_to_solo", "withdraw_solo"]) assert.ok(lib.includes(`rpc("${fn}"`), `${fn} is not how the app writes`);
    assert.match(lib, /throw new Said\(soloRefusal\(error\)\)/, "a refusal reaches the screen as the database's raw words");
    assert.doesNotMatch(section, /supabase\(\)/, "the section writes around lib/solo");
    assert.match(section, /saidAt\(p\.id\)/, "a refusal on a proposal is not said beside it");
    // The A28 sheet's choice starts empty: no default.
    assert.match(section, /setChoice\(null\); setSaid\(null\); setSheet\(true\)/, "the sheet opens with a choice already made");
    assert.match(section, /disabled=\{!choice\}/, "1-on-1 can be turned on without choosing who can see you");
  });

  it("SO09 nothing shows where 1-on-1 is not offered, and a person with both plans keeps both", () => {
    assert.match(section, /if \(\(!view\.offered \|\| ended\) && !view\.choice\) return null;/);
    const crowd = readFileSync("app/src/app/crowd/[slug].tsx", "utf8");
    assert.match(crowd, /\.eq\("kind", "crew"\)\.is\("left_at", null\)\.maybeSingle\(\)/, "the crowd page's group read would fail with a 1-on-1 plan beside it");
    assert.match(readFileSync("app/src/lib/room.ts", "utf8"), /\.eq\("kind", "crew"\)\.in\("state"/, "a 1-on-1 plan stops 'go together' in the room");
    const events = readFileSync("app/src/lib/myevents.ts", "utf8");
    assert.match(events, /const soloAt = planAt\("solo"\)/, "My Events keys both plans by gathering, one over the other");
  });

  it("SO10 the admin counts gatherings with no spots beside the maps, and has the 1-on-1 page", () => {
    const venues = readFileSync("src/admin/venues.ts", "utf8");
    assert.match(venues, /rpc\("admin_gatherings_without_spots"\)/, "Venues does not count gatherings with no spots");
    assert.match(venues, /\$\{withoutSpotsPanel\(spotless\)\}/, "Venues reads the count and never shows it");
    const routes = readFileSync("src/admin/routes.ts", "utf8");
    assert.match(routes, /\["GET \/admin\/solo", solo\.soloPage\]/);
    assert.match(routes, /\["POST \/admin\/solo\/switch", solo\.setSoloSwitch\]/);
    assert.match(readFileSync("src/admin/ui.ts", "utf8"), /\["\/admin\/solo", "1-on-1"\]/, "the 1-on-1 page is not in the nav");
  });
});
