// M2.1 — the pure parts of the public web layer: the walk calculation, the
// generated map, the OG card's line breaking and the .ics escaping. Nothing here
// touches the network, so these run with `npm run test:unit`.
//
// What the database decides — which gatherings are public at all — is proved in the
// policy harness (P55–P61), not here.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { venueMap, walkMinutes, type MapSpot } from "../../src/public/map.ts";
import { ogImage } from "../../src/public/og.ts";
import { frameMetres, isReady, mapKey, mapUrl, place, uploadUrl } from "../../src/public/venuemap.ts";

const spot = (over: Partial<MapSpot>): MapSpot => ({
  name: "Gate 1",
  latitude: null,
  longitude: null,
  walk_minutes: null,
  ...over,
});

// Scotiabank Arena, and two real-ish points near it.
const ARENA = { name: "Scotiabank Arena", latitude: 43.6435, longitude: -79.3791 };

describe("walking minutes", () => {
  it("never says less than a minute, and allows for corners and crossings", () => {
    assert.equal(walkMinutes(0), 1, "a spot at the door is still a minute");
    assert.equal(walkMinutes(10), 1);
    // 400 m of straight line is about 530 m of pavement, which is 6-7 minutes.
    assert.equal(walkMinutes(400), 7);
    assert.equal(walkMinutes(800), 13);
  });
});

describe("the generated venue map", () => {
  it("draws the venue, each located spot, a north arrow and a scale bar", () => {
    const svg = venueMap(ARENA, [
      spot({ name: "Gate 1", latitude: 43.6429, longitude: -79.3776 }),
      spot({ name: "The clock", latitude: 43.6451, longitude: -79.3805 }),
    ]);
    assert.ok(svg, "no map was drawn");
    assert.ok(svg.includes("Scotiabank Arena"), "the venue is not named");
    assert.ok(svg.includes("Gate 1") && svg.includes("The clock"), "a spot is missing");
    assert.match(svg, /min walk/, "no walking minutes");
    assert.match(svg, />N</, "no north arrow");
    assert.match(svg, /\d+ m</, "no scale bar");
    assert.match(svg, /aria-label="[^"]*No people are shown\./, "the map does not say what it shows");
  });

  it("uses the manual override when a spot has one", () => {
    const svg = venueMap(ARENA, [spot({ latitude: 43.6429, longitude: -79.3776, walk_minutes: 14 })])!;
    assert.ok(svg.includes("14 min walk"), "the override was ignored");
  });

  it("draws nothing without coordinates, so the page falls back to a list", () => {
    assert.equal(venueMap({ name: "X", latitude: null, longitude: null }, [spot({ latitude: 1, longitude: 1 })]), null);
    assert.equal(venueMap(ARENA, [spot({})]), null, "a spot with no coordinates cannot be plotted");
    assert.equal(venueMap(ARENA, []), null);
  });

  it("escapes a venue or spot name that contains markup", () => {
    const svg = venueMap({ ...ARENA, name: `<script>x</script>` }, [
      spot({ name: `Gate "1" & 2`, latitude: 43.6429, longitude: -79.3776 }),
    ])!;
    assert.equal(svg.includes("<script>"), false, "a name reached the markup unescaped");
    assert.ok(svg.includes("Gate &quot;1&quot; &amp; 2"));
  });

  it("keeps a far-flung spot inside the frame", () => {
    // 2 km north: the fit has to scale down, not run off the canvas.
    const svg = venueMap(ARENA, [spot({ name: "Far", latitude: 43.6615, longitude: -79.3791 })])!;
    for (const [, x, y] of svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)"/g)) {
      assert.ok(Number(x) >= 0 && Number(x) <= 640, `x ${x} is off the canvas`);
      assert.ok(Number(y) >= 0 && Number(y) <= 400, `y ${y} is off the canvas`);
    }
  });
});

describe("the OG card (W4)", () => {
  const ONE_LINER = "See who's going, meet them there.";
  const card = {
    name: "Maple Leafs vs Bruins",
    when: "Saturday 14 October, 7:00 p.m.",
    venue: "Scotiabank Arena",
    oneLiner: ONE_LINER,
  };

  it("shows the event, the date and the venue — and never a count (H6)", () => {
    const svg = ogImage(card);
    assert.ok(svg.includes("Maple Leafs vs Bruins"));
    assert.ok(svg.includes("Saturday 14 October"));
    assert.ok(svg.includes("Scotiabank Arena"));
    assert.ok(svg.includes("See who&#39;s going, meet them there."));
    assert.equal(/\b\d+ (pinned|open to meeting)\b/.test(svg), false, "a count reached the preview image");
    assert.match(svg, /viewBox="0 0 1200 630"/);
  });

  it("wraps a long name and ends it with an ellipsis rather than mid-word", () => {
    const long = "An Extremely Long Gathering Name That Goes On Well Past Three Lines Of Any Reasonable Size And Then Some More Words After That";
    const svg = ogImage({ ...card, name: long });
    const lines = [...svg.matchAll(/<text x="80" y="\d+" font-size="6[0-9]"/g)];
    assert.ok(lines.length <= 3, `wrapped to ${lines.length} lines`);
    assert.ok(svg.includes("…"), "a name that did not fit was cut without an ellipsis");
  });

  it("escapes a name that contains markup", () => {
    const svg = ogImage({ ...card, name: `<script>alert(1)</script>` });
    assert.equal(svg.includes("<script>"), false);
  });
});

// M2.1 — the real venue map. The projection decides where every marker lands and
// whether a spot is inside the frame at all, so it is worth testing on its own.
describe("placing spots on the real map", () => {
  const ARENA_C = { latitude: 43.6435, longitude: -79.3791 };

  it("puts the venue's own coordinates dead centre", () => {
    const at = place(ARENA_C, ARENA_C);
    assert.ok(Math.abs(at.left - 50) < 0.001, `left was ${at.left}`);
    assert.ok(Math.abs(at.top - 50) < 0.001, `top was ${at.top}`);
    assert.equal(at.onMap, true);
  });

  it("puts north up and east right", () => {
    const north = place(ARENA_C, { latitude: 43.6465, longitude: -79.3791 });
    const east = place(ARENA_C, { latitude: 43.6435, longitude: -79.3751 });
    assert.ok(north.top < 50, "north was not up");
    assert.ok(Math.abs(north.left - 50) < 0.001, "north drifted sideways");
    assert.ok(east.left > 50, "east was not right");
    assert.ok(Math.abs(east.top - 50) < 0.001, "east drifted vertically");
  });

  it("calls a nearby spot on the map and a far one off it", () => {
    // ~250 m away: comfortably inside a frame about 1.3 km across.
    assert.equal(place(ARENA_C, { latitude: 43.6457, longitude: -79.3791 }).onMap, true);
    // Poetry Jazz Cafe, the M5.2 finding: about 2 km from Sneaky Dee's, so off it.
    const sneaky = { latitude: 43.656413, longitude: -79.407486 };
    const poetry = place(sneaky, { latitude: 43.64283, longitude: -79.42031 });
    assert.equal(poetry.onMap, false, "a 2 km spot was drawn on the map");
  });

  it("reports a frame wide enough for a five-minute walk, and no wider", () => {
    const m = frameMetres(43.65);
    assert.ok(m > 900 && m < 1600, `the frame was ${m} m across`);
  });
});

describe("the map's URLs", () => {
  it("changes the image URL when the venue's coordinates change, so nothing stale survives", () => {
    const a = mapKey({ map_key: "abc1234567" });
    const b = mapKey({ map_key: "9999999999" });
    assert.ok(a && b && a !== b, "two different coordinate keys produced the same URL");
    assert.notEqual(mapUrl("v", a!), mapUrl("v", b!));
    assert.equal(mapKey({ map_key: null }), null, "a venue with no coordinates has no map URL");
  });

  it("versions an uploaded override by its path, so replacing the file changes the URL", () => {
    const one = uploadUrl("v", "v/map.png");
    const two = uploadUrl("v", "v/map-2.png");
    assert.notEqual(one, two);
    assert.equal(one, uploadUrl("v", "v/map.png"), "the same path gave two different URLs");
    assert.ok(one.startsWith("/venue-map/"), "an uploaded map must be served from our own origin");
  });

  it("knows a venue is ready only for the key its current coordinates produce", () => {
    const v = { id: "v", name: "V", latitude: 1, longitude: 2, map_key: "abc1234567", map_ready: [] as string[] };
    assert.equal(isReady(v), false);
    assert.equal(isReady({ ...v, map_ready: [mapKey(v)!] }), true);
    assert.equal(isReady({ ...v, map_ready: ["someoldkey-v1"] }), false, "a stale key counted as ready");
  });
});
