// M2.1 — the pure parts of the public web layer: the walk calculation, the
// generated map, the OG card's line breaking and the .ics escaping. Nothing here
// touches the network, so these run with `npm run test:unit`.
//
// What the database decides — which gatherings are public at all — is proved in the
// policy harness (P55–P61), not here.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { entryLine } from "../../packages/shared/src/copy.ts";
import { venueMap, walkMinutes, type MapSpot } from "../../src/public/map.ts";
import { ogImage } from "../../src/public/og.ts";
import { chooseZoom, frameMetres, isReady, mapKey, mapUrl, place, uploadUrl } from "../../src/public/venuemap.ts";

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
  // Zoom 16 is the widest frame we draw, and what "on the map" is measured against.
  const Z = 16;

  it("puts the venue's own coordinates dead centre", () => {
    const at = place(ARENA_C, ARENA_C, Z);
    assert.ok(Math.abs(at.left - 50) < 0.001, `left was ${at.left}`);
    assert.ok(Math.abs(at.top - 50) < 0.001, `top was ${at.top}`);
    assert.equal(at.onMap, true);
  });

  it("puts north up and east right", () => {
    const north = place(ARENA_C, { latitude: 43.6465, longitude: -79.3791 }, Z);
    const east = place(ARENA_C, { latitude: 43.6435, longitude: -79.3751 }, Z);
    assert.ok(north.top < 50, "north was not up");
    assert.ok(Math.abs(north.left - 50) < 0.001, "north drifted sideways");
    assert.ok(east.left > 50, "east was not right");
    assert.ok(Math.abs(east.top - 50) < 0.001, "east drifted vertically");
  });

  it("calls a nearby spot on the map and a far one off it", () => {
    // ~250 m away: comfortably inside a frame about 1.3 km across.
    assert.equal(place(ARENA_C, { latitude: 43.6457, longitude: -79.3791 }, Z).onMap, true);
    // Poetry Jazz Cafe, the M5.2 finding: about 2 km from Sneaky Dee's, so off it.
    const sneaky = { latitude: 43.656413, longitude: -79.407486 };
    const poetry = place(sneaky, { latitude: 43.64283, longitude: -79.42031 }, Z);
    assert.equal(poetry.onMap, false, "a 2 km spot was drawn on the map");
  });

  it("reports a frame wide enough for a five-minute walk, and no wider", () => {
    const m = frameMetres(43.65, 16);
    assert.ok(m > 900 && m < 1600, `the frame was ${m} m across`);
  });
});

describe("the map's URLs", () => {
  it("changes the image URL when the venue's coordinates change, so nothing stale survives", () => {
    const a = mapKey({ map_key: "abc1234567" }, 16);
    const b = mapKey({ map_key: "9999999999" }, 16);
    assert.ok(a && b && a !== b, "two different coordinate keys produced the same URL");
    assert.notEqual(mapUrl("v", a!), mapUrl("v", b!));
    assert.equal(mapKey({ map_key: null }, 16), null, "a venue with no coordinates has no map URL");
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
    assert.equal(isReady(v, 16), false);
    assert.equal(isReady({ ...v, map_ready: [mapKey(v, 16)!] }, 16), true);
    assert.equal(isReady({ ...v, map_ready: ["someoldkey-v1"] }, 16), false, "a stale key counted as ready");
    // The zoom is part of the key, so a picture drawn before a spot moved the zoom is
    // gone rather than stale — which is what lets both URLs be cached for a year.
    assert.equal(isReady({ ...v, map_ready: [mapKey(v, 16)!] }, 17), false, "a picture at the wrong zoom counted as ready");
  });
});

describe("what it costs to walk in", () => {
  // Alex, after M2.2. is_free had two values and the world has three: Pub Chess is $10
  // cash at the door, which is neither free nor ticketed. The failure that matters is
  // somebody arriving at a door with no cash, so the rule is: never say free unless it
  // is free, and an unknown price says "pay at the door" rather than nothing.
  it("says Free only when it is free", () => {
    assert.equal(entryLine({ entry: "free", door_price_cents: null, entry_note: null }), "Free");
  });

  // The button no longer carries it: every crowd page reads "Pin in — I'm going".
  // So a ticketed gathering says "Ticketed" rather than nothing, because a blank
  // where "Free" sits on the next card reads as free to anyone scanning.
  it("says Ticketed rather than nothing, now that the button says the same thing everywhere", () => {
    assert.equal(entryLine({ entry: "ticketed", door_price_cents: null, entry_note: null }), "Ticketed");
    assert.equal(entryLine({ entry: "ticketed", door_price_cents: null, entry_note: "sold out at the door" }), "sold out at the door");
  });

  it("gives every entry state a line, so no state is recognised only by its silence", () => {
    for (const entry of ["free", "door", "ticketed"] as const) {
      assert.notEqual(entryLine({ entry, door_price_cents: null, entry_note: null }), "", `${entry} said nothing`);
    }
  });

  // The note is about the cost whatever the cost is. Frontrunners is a free drop-in
  // with an optional membership, and dropping it made the page say less than the truth.
  it("keeps the note on a free or ticketed gathering too", () => {
    assert.equal(
      entryLine({ entry: "free", door_price_cents: null, entry_note: "optional $30/yr membership" }),
      "Free — optional $30/yr membership",
    );
    assert.equal(entryLine({ entry: "ticketed", door_price_cents: null, entry_note: "tickets by table" }), "tickets by table");
  });

  it("shows the amount at the door", () => {
    assert.equal(entryLine({ entry: "door", door_price_cents: 1000, entry_note: null }), "$10 at the door");
    assert.equal(entryLine({ entry: "door", door_price_cents: 2000, entry_note: null }), "$20 at the door");
    assert.equal(entryLine({ entry: "door", door_price_cents: 1250, entry_note: null }), "$12.50 at the door");
    assert.equal(entryLine({ entry: "door", door_price_cents: 0, entry_note: null }), "$0 at the door");
  });

  it("keeps the note, because cash-only is a different promise from a price", () => {
    assert.equal(
      entryLine({ entry: "door", door_price_cents: 1000, entry_note: "cash only" }),
      "$10 at the door — cash only",
    );
  });

  it("says pay at the door when the price is unknown, and never free", () => {
    const unknown = entryLine({ entry: "door", door_price_cents: null, entry_note: null });
    assert.equal(unknown, "Pay at the door");
    assert.doesNotMatch(unknown, /free/i);
    assert.equal(entryLine({ entry: "door", door_price_cents: null, entry_note: "cash only" }), "Pay at the door — cash only");
  });
});

// M2.3 — how far in the picture goes. The numbers here are the real venues, so the
// test says what happens to the actual crowd pages rather than to invented ones.
describe("choosing a venue's zoom", () => {
  const SNAKES = { latitude: 43.6559759, longitude: -79.4093377 };
  const SNAKES_SPOTS = [
    { latitude: 43.6556037, longitude: -79.4111487 }, // Liu Loqum Atelier
    { latitude: 43.6562462, longitude: -79.4074325 }, // Sneaky Dee's
    { latitude: 43.6558305, longitude: -79.409924 }, // Bar Raval
  ];
  const SNEAKY = { latitude: 43.656413, longitude: -79.407486 };
  const SNEAKY_SPOTS = [
    { latitude: 43.65731, longitude: -79.40213 }, // Free Times Cafe, near the frame's edge
    { latitude: 43.65513, longitude: -79.4131 }, // Grace Restaurant
    { latitude: 43.64283, longitude: -79.42031 }, // Poetry Jazz Cafe, 2 km out
  ];

  it("zooms in on a venue whose spots are all close, which is what pulls them apart", () => {
    const zoom = chooseZoom(SNAKES, SNAKES_SPOTS);
    assert.equal(zoom, 17, "the three spots two minutes apart did not get a tighter frame");
    // Every one of them is still on the map at the zoom chosen: zooming in must never
    // push a spot out of the frame it was already in.
    for (const s of SNAKES_SPOTS) assert.equal(place(SNAKES, s, zoom).onMap, true, "a spot fell off the map");
    // And the closest pair is genuinely further apart than it was.
    const before = Math.abs(place(SNAKES, SNAKES_SPOTS[0]!, 16).left - place(SNAKES, SNAKES_SPOTS[2]!, 16).left);
    const after = Math.abs(place(SNAKES, SNAKES_SPOTS[0]!, zoom).left - place(SNAKES, SNAKES_SPOTS[2]!, zoom).left);
    assert.ok(after > before * 1.5, `the closest pair went from ${before.toFixed(1)}% to ${after.toFixed(1)}% apart`);
  });

  it("leaves every marker room, rather than filling the frame to its edges", () => {
    // Seen on the deployed page: "still inside the picture" chose zoom 18 and put two
    // of three dots at 6% and 96% across — clipped at phone width. Zooming in has to
    // clear a wider margin than being drawn at all does.
    const zoom = chooseZoom(SNAKES, SNAKES_SPOTS);
    for (const s of SNAKES_SPOTS) {
      const at = place(SNAKES, s, zoom);
      assert.ok(at.left > 8 && at.left < 92, `a marker sat at ${at.left.toFixed(1)}% across`);
      assert.ok(at.top > 12 && at.top < 88, `a marker sat at ${at.top.toFixed(1)}% down`);
    }
  });

  it("stays wide when a spot sits near the edge of the frame", () => {
    // Free Times Cafe is at 83% across at zoom 16; one step in and it is off the
    // picture, so Sneaky Dee's keeps the wide frame.
    assert.equal(chooseZoom(SNEAKY, SNEAKY_SPOTS), 16);
  });

  it("ignores a spot that is already off the map, rather than zooming out to reach it", () => {
    // Poetry Jazz Cafe is 2 km away. It is listed on the page and said to be further
    // out; it must not drag the picture wider for everybody else.
    const zoom = chooseZoom(SNAKES, [...SNAKES_SPOTS, { latitude: 43.64283, longitude: -79.42031 }]);
    assert.equal(zoom, chooseZoom(SNAKES, SNAKES_SPOTS));
  });

  it("falls back to the wide frame with no spots, no coordinates, or nothing placeable", () => {
    assert.equal(chooseZoom(SNAKES, []), 16);
    assert.equal(chooseZoom({ latitude: null, longitude: null }, SNAKES_SPOTS), 16);
    assert.equal(chooseZoom(SNAKES, [{ latitude: null, longitude: null }]), 16);
  });

  it("never goes further in than the ceiling, however tight the spots are", () => {
    const onTop = [
      { latitude: SNAKES.latitude + 0.00002, longitude: SNAKES.longitude },
      { latitude: SNAKES.latitude - 0.00002, longitude: SNAKES.longitude },
    ];
    assert.equal(chooseZoom(SNAKES, onTop), 18);
  });
});
