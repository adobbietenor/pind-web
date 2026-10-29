// "Open in Maps" lands on the venue, named — not on a pair of numbers (#8; Tatiana and
// Alex, 19 Oct 2026). W2 and the app's A8 both take the link from venueDirections.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { venueDirections } from "../../src/public/map.ts";

const query = (url: string | null) => (url ? new URL(url).searchParams.get("query") : null);
const venue = { name: "The Opera House", address: "735 Queen St. E., Toronto, M4M 1H1", latitude: 43.659, longitude: -79.349 };

describe("Open in Maps goes to the venue (#8)", () => {
  it("MP01 Google searches the venue's name and street address, so the pin reads as the place", () => {
    assert.equal(query(venueDirections(venue)), "The Opera House, 735 Queen St. E., Toronto, M4M 1H1");
  });

  it("MP02 never the coordinates when there is an address — the numbers Tatiana was shown", () => {
    assert.doesNotMatch(query(venueDirections(venue)) ?? "", /^-?\d+\.\d+,-?\d+\.\d+$/);
  });

  it("MP03 no address (or only spaces): the coordinates, which are at least the right place", () => {
    assert.equal(query(venueDirections({ ...venue, address: null })), "43.659,-79.349");
    assert.equal(query(venueDirections({ ...venue, address: "  " })), "43.659,-79.349");
  });

  it("MP04 no coordinates: no link, as before", () => {
    assert.equal(venueDirections({ ...venue, latitude: null }), null);
  });
});
