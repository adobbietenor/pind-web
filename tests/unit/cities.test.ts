// The cities, one list (M3.3c; Alex, 6 Oct 2026): the app's picker, the app's list and
// W1 all read packages/shared/src/cities.ts, and the public list is asked for one city.
// P185 (the harness) proves the database half: a Toronto list never returns another
// city's gathering. These prove nothing on our side goes round it.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CITIES, cityOpens, liveCity } from "../../packages/shared/src/cities.ts";

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full.split("\\").join("/"));
  }
  return out;
}
const appFiles = files("app/src").map((path) => ({ path, source: readFileSync(path, "utf8") }));

describe("The cities, one list (M3.3c)", () => {
  it("K01 four cities; Toronto is the one live; the others and anything unlisted never open", () => {
    assert.deepEqual(CITIES.map((c) => c.name), ["Toronto", "Vancouver", "Calgary", "Montreal"]);
    assert.equal(liveCity().slug, "toronto");
    for (const slug of ["vancouver", "calgary", "montreal", "nowhere", ""]) assert.equal(cityOpens(slug), false, `${slug} opens`);
    assert.equal(cityOpens("toronto"), true, "control: Toronto does not open");
  });

  it("K02 the app reads the public list in ONE place, and always for one city that opens", () => {
    const pattern = /rpc\(\s*["']public_gatherings["']/;
    assert.ok(pattern.test(`supabase().rpc("public_gatherings", {`), "the pattern cannot see a call");
    const readers = appFiles.filter((f) => pattern.test(f.source)).map((f) => f.path);
    assert.deepEqual(readers, ["app/src/lib/crowds.ts"], "something else in the app reads the public list");
    const lib = appFiles.find((f) => f.path === "app/src/lib/crowds.ts")!.source;
    assert.match(lib, /p_city:\s*city\.slug/, "the app's list does not name the city it asks for");
    assert.match(lib, /if \(!city \|\| !cityOpens\(slug\)\) throw/, "the app's list asks for a city without checking it is live");
  });

  it("K03 the picker and the list draw from CITIES and cityOpens — no screen keeps its own list of cities", () => {
    const home = appFiles.find((f) => f.path.endsWith("app/(tabs)/crowds.tsx"))!.source;
    assert.match(home, /CITIES\.map/, "the home screen does not draw the shared list");
    assert.match(home, /disabled=\{!opens\}/, "a city that is not live can be tapped");
    const list = appFiles.find((f) => f.path.endsWith("app/city/[slug].tsx"))!.source;
    assert.match(list, /cityOpens\(city\.slug\)/, "the list screen does not refuse a city that is not live");
    const named = appFiles.filter((f) => /["'](Vancouver|Calgary|Montreal)["']/.test(f.source)).map((f) => f.path);
    assert.deepEqual(named, [], "a screen names a city itself instead of reading CITIES");
  });

  it("K04 W1's door asks the database for the live city, by name of the parameter", () => {
    const door = readFileSync("src/public/data.ts", "utf8");
    assert.match(door, /p_city: city/, "W1's door no longer passes the city");
    assert.match(door, /city: string = liveCity\(\)\.slug/, "W1's door no longer defaults to the live city");
  });
});
