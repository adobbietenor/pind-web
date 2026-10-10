// M3.2b — search and interests (Alex, 10 Oct 2026). The rules both lists share.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyChips, type Chip, type ListRow } from "../../packages/shared/src/list.ts";
import { interestsHere, rememberAfter, SEARCH_MAX, searchQuery } from "../../packages/shared/src/search.ts";

const chip = (value: string): Chip => ({ value, label: value, gatherings: 3, venues: 2 });

describe("Search reads what was typed one way, everywhere", () => {
  it("Y01 trimmed, one space, capped; blank is no search", () => {
    assert.equal(searchQuery("  Rogers   Centre "), "Rogers Centre");
    assert.equal(searchQuery("   "), null);
    assert.equal(searchQuery(null), null);
    assert.equal(searchQuery(undefined), null);
    assert.equal(searchQuery("x".repeat(SEARCH_MAX + 50))!.length, SEARCH_MAX);
    assert.equal(searchQuery("100%_"), "100%_", "a wildcard character was altered — the database escapes it, not this");
  });
});

describe("Interests narrow, never reorder, and never empty a page (Q10)", () => {
  const offered = [chip("live_music"), chip("comedy")]; // Events tab, this week

  it("Y02 a remembered interest is on only where its chip is offered; one with no chip this week is resting, and the other tab's is neither", () => {
    const here = interestsHere(["comedy", "sport", "running"], offered, "events");
    assert.deepEqual(here.on, ["comedy"]);
    assert.deepEqual(here.resting, ["sport"], "sport belongs on Events and has no chip — it is resting");
    assert.ok(!here.on.includes("running") && !here.resting.includes("running"), "Running is the Community tab's — not this tab's to apply or name");
    assert.deepEqual(interestsHere([], offered, "events"), { on: [], resting: [] });
  });

  it("Y03 whatever is remembered, the page keeps at least the rows of one offered chip — a remembered interest cannot empty it", () => {
    const rows = [
      { category: "comedy", name: "a" },
      { category: "live_music", name: "b" },
    ] as unknown as ListRow[];
    for (const remembered of [["sport"], ["sport", "running"], ["markets"]]) {
      const { on } = interestsHere(remembered, offered, "events");
      assert.equal(applyChips(rows, on).length, rows.length, `remembering ${remembered} filtered rows away with no chip to show for it`);
    }
  });

  it("Y04 narrowing keeps the date order exactly — the moment it becomes 'things you like first', Q10 is dead", () => {
    const rows = [
      { category: "live_music", name: "1 Mon" },
      { category: "comedy", name: "2 Tue" },
      { category: "live_music", name: "3 Wed" },
      { category: "comedy", name: "4 Thu" },
    ] as unknown as ListRow[];
    const { on } = interestsHere(["comedy", "live_music"], offered, "events");
    assert.deepEqual(applyChips(rows, on).map((r) => r.name), ["1 Mon", "2 Tue", "3 Wed", "4 Thu"]);
    const { on: one } = interestsHere(["comedy"], offered, "events");
    assert.deepEqual(applyChips(rows, one).map((r) => r.name), ["2 Tue", "4 Thu"]);
  });

  it("Y05 a tap remembers what is on here and forgets nothing it was not shown; Everything forgets all", () => {
    assert.deepEqual(rememberAfter(["sport", "running"], offered, ["comedy"]), ["sport", "comedy", "running"], "a tap on Comedy forgot a resting or other-tab interest");
    assert.deepEqual(rememberAfter(["comedy", "running"], offered, []), ["running"], "un-tapping Comedy did not forget it");
    assert.deepEqual(rememberAfter(["comedy"], offered, ["comedy", "comedy"]), ["comedy"]);
  });
});

describe("Search on W1 is the one door, as a plain form (decisions, 'A search bar')", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("Y06 /search is in run_worker_first — or the app's index.html would answer it with a 200", () => {
    const config = read("wrangler.jsonc").replace(/^\s*\/\/.*$/gm, "");
    const from = config.indexOf("[", config.indexOf("run_worker_first"));
    const list = JSON.parse(config.slice(from, config.indexOf("]", from) + 1).replace(/,\s*]/, "]"));
    assert.ok(Array.isArray(list) && list.includes("/g/*"), "could not read run_worker_first (the check found nothing)");
    assert.ok(list.includes("/search"), "/search is not in run_worker_first");
    assert.match(read("src/public/routes.ts"), /pathname === "\/search"\) return searchPage\(/);
  });

  it("Y07 the search page reads only through crowds() with the query, and the form is a GET with no script", () => {
    const pages = read("src/public/pages.ts");
    const at = pages.indexOf("export async function searchPage(");
    assert.ok(at >= 0, "searchPage is gone");
    const fn = pages.slice(at, pages.indexOf("\n}", at));
    assert.match(fn, /await crowds\(env, .*, q\);/, "search does not go through the one door with its query");
    assert.doesNotMatch(fn, /\.filter\(|\.rpc\(/, "the search page filters or queries for itself (H11)");
    assert.match(pages, /<form class="search" action="\/search" method="get"/);
    assert.doesNotMatch(fn, /script:/, "the search page ships a script");
    assert.match(read("src/public/data.ts"), /p_query: query,/, "the one door does not pass the query to the database");
  });
});
