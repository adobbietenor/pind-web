// M3.4 — 1-on-1 (A28, A29). The visibility is the harness's (P209–P215); these hold the
// admin to the way back (Alex, 14 Oct 2026: "a single bad report must not be a one-way
// door"; solo does not ship until it exists — decisions, "M3.4: who can see whom in 1-on-1").
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { soloRefusal, soloTimes } from "../../packages/shared/src/solo.ts";

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

describe("The 1-on-1 screens use the rules, not their own (build 23)", () => {
  const lib = readFileSync("app/src/lib/solo.ts", "utf8");
  const sheet = readFileSync("app/src/components/PersonSheet.tsx", "utf8");
  const here = readFileSync("app/src/components/OneOnOneHere.tsx", "utf8");
  const connections = readFileSync("app/src/app/(tabs)/connections.tsx", "utf8");
  const appFiles = (function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []));
  })("app/src");

  it("SO06 nothing asks for a place or a time before a chat: a request carries nothing, and the spot confirmation is gone", () => {
    // The pattern must see the real request first, or "nothing" proves nothing.
    assert.match(lib, /rpc\("propose_solo", \{ p_gathering: gatheringId, p_to: to, p_spot: null as unknown as string, p_meet_at: null as unknown as string, p_line: null as unknown as number \}\)/, "a request sends a spot, a time or a line");
    assert.ok(appFiles.length > 50, `the scan sees only ${appFiles.length} files`);
    for (const f of appFiles) {
      const src = readFileSync(f, "utf8");
      assert.doesNotMatch(src, /suggest_solo_spot|confirm_solo_spot|solo_spot_suggestions|PairSpot|SoloSection/, `${f} still reaches the removed spot confirmation`);
    }
    for (const [where, src] of [["the person sheet", sheet], ["the 1-on-1 section", here]] as const) {
      assert.doesNotMatch(src, /TextInput|<Field|multiline|SoloPlace/, `${where} asks for something before the chat`);
    }
  });

  it("SO07 Accept opens the chat for the one who accepts, wherever the request is answered", () => {
    for (const [where, src] of [["Connections", connections], ["the crowd page's requests", here]] as const) {
      assert.match(src, /await answerSolo\(proposalId, accept\)/, `${where} does not answer through respond_to_solo`);
      assert.match(src, /accept \? await connectionWith\(personId\) : null|if \(accept\) \{[\s\S]{0,200}connectionWith\(personId\)/, `${where} does not find the chat the yes made`);
      assert.match(src, /pathname: "\/chat\/\[id\]"/, `${where} does not open the chat`);
    }
  });

  it("SO08 every write goes through the database's functions, and a refusal comes back in words, where the tap was", () => {
    for (const fn of ["propose_solo", "respond_to_solo", "withdraw_solo", "set_event_one_on_one"]) assert.ok(lib.includes(`rpc("${fn}"`), `${fn} is not how the app writes`);
    assert.match(lib, /throw new Said\(soloRefusal\(error\)\)/, "a refusal reaches the screen as the database's raw words");
    assert.doesNotMatch(here, /supabase\(\)/, "the section writes around lib/solo");
    assert.match(here, /refusal=\{refusal\?\.id === r\.proposalId \? refusal\.says : null\}/, "a refusal on a request is not said beside it");
    // Requests run to the end now: the refusal after it has its own sentence.
    assert.notEqual(soloRefusal("refused: requests closed at the end"), soloRefusal("something else"));
  });

  it("SO09 a person with both plans keeps both", () => {
    const squads = readFileSync("app/src/lib/squads.ts", "utf8");
    assert.match(squads, /\.eq\("kind", "crew"\)\s*\.is\("left_at", null\)\s*\.maybeSingle\(\)/, "the squad read would fail with a 1-on-1 plan beside it");
    assert.match(readFileSync("app/src/lib/room.ts", "utf8"), /\.eq\("kind", "crew"\)\.in\("state"/, "a 1-on-1 plan stops 'go together' in the room");
    // Since A19 (16 Oct 2026) the keying is readMyChats' (packages/shared/src/myevents.ts); M07 proves it with both.
    const events = readFileSync("packages/shared/src/myevents.ts", "utf8");
    assert.match(events, /group: plan\("crew"\),\s*solo: plan\("solo"\),/, "My Events keys both plans by gathering, one over the other");
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
