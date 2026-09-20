// The generated venue map (spec §2 W2; decisions Part 5, "Maps generated
// automatically").
//
// A schematic SVG drawn by the Worker from the venue's coordinates and its meeting
// spots': the building, each spot with its name and walking minutes, a north arrow
// and a scale bar. No tiles, no API key, nothing to load — which is the point: a map
// that needs an uploaded image per venue is manual work per event, and a tile layer
// is a second network round trip on a page that has one second.
//
// It shows the venue and its curated public spots and NOTHING ELSE. There is no
// layer this could ever draw a person on (H1), and no coordinate in this product
// belongs to a person (H4).
//
// An uploaded image stays as the optional override (venues.map_image_path).

import { escape } from "./escape.ts";

const W = 640;
const H = 400;
const PAD = 54; // room for labels outside the points' bounding box

// Metres per degree, near enough at Toronto's latitude for a schematic.
const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LNG = 111_320;

// A brisk walk, plus a third again for corners, crossings and doors — street
// distance is never the straight line.
const WALK_M_PER_MIN = 80;
const DETOUR = 1.33;

export interface MapVenue {
  name: string;
  latitude: number | null;
  longitude: number | null;
}

// Only what the drawing needs. data.ts's Spot has these and more, so it fits.
// Declared here rather than imported so this module stays free of every other
// import, which is what lets the unit tests load it in Node (see ./escape.ts).
export interface MapSpot {
  name: string;
  latitude: number | null;
  longitude: number | null;
  walk_minutes: number | null;
}

interface Placed {
  x: number;
  y: number;
  name: string;
  minutes: number;
  right: boolean;
}

export function walkMinutes(metres: number): number {
  return Math.max(1, Math.round((metres * DETOUR) / WALK_M_PER_MIN));
}

// Straight-line metres between two points.
function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): { dx: number; dy: number; d: number } {
  const midLat = ((aLat + bLat) / 2) * (Math.PI / 180);
  const dx = (bLng - aLng) * M_PER_DEG_LNG * Math.cos(midLat);
  const dy = (bLat - aLat) * M_PER_DEG_LAT;
  return { dx, dy, d: Math.hypot(dx, dy) };
}

// A rounded number that reads well on a scale bar.
function niceDistance(metres: number): number {
  const steps = [25, 50, 100, 150, 200, 300, 500, 750, 1000];
  for (const s of steps) if (metres <= s) return s;
  return 1000;
}

// Returns null when there is nothing to draw: no venue coordinates, or no spot with
// coordinates. W2 then lists the spots without a map, which is still a usable page.
export function venueMap(venue: MapVenue, spots: MapSpot[]): string | null {
  if (venue.latitude === null || venue.longitude === null) return null;
  const located = spots.filter((s) => s.latitude !== null && s.longitude !== null);
  if (located.length === 0) return null;

  // Metres relative to the venue, y already flipped so north is up on screen.
  const points = located.map((s) => {
    const { dx, dy, d } = metresBetween(venue.latitude!, venue.longitude!, s.latitude!, s.longitude!);
    return { mx: dx, my: -dy, name: s.name, minutes: s.walk_minutes ?? walkMinutes(d) };
  });

  // Fit the venue and every spot into the frame, with the venue kept on screen.
  const xs = [0, ...points.map((p) => p.mx)];
  const ys = [0, ...points.map((p) => p.my)];
  const spanX = Math.max(Math.max(...xs) - Math.min(...xs), 60);
  const spanY = Math.max(Math.max(...ys) - Math.min(...ys), 60);
  const scale = Math.min((W - PAD * 2) / spanX, (H - PAD * 2) / spanY);
  const midX = (Math.max(...xs) + Math.min(...xs)) / 2;
  const midY = (Math.max(...ys) + Math.min(...ys)) / 2;
  const px = (mx: number) => W / 2 + (mx - midX) * scale;
  const py = (my: number) => H / 2 + (my - midY) * scale;

  const vx = px(0);
  const vy = py(0);
  const placed: Placed[] = points.map((p) => ({
    x: px(p.mx),
    y: py(p.my),
    name: p.name,
    minutes: p.minutes,
    // The label goes on the side away from the venue, so it never crosses it.
    right: px(p.mx) >= vx,
  }));

  // Scale bar: a round number of metres, drawn at the same scale as everything else.
  const barMetres = niceDistance(Math.round(120 / scale));
  const barPx = barMetres * scale;

  const parts: string[] = [];
  parts.push(
    `<defs><clipPath id="frame"><rect width="${W}" height="${H}" rx="14"/></clipPath></defs>`,
    `<rect width="${W}" height="${H}" rx="14" fill="#17151B"/>`,
  );

  // Faint rings one scale bar apart, so the eye can read distance at a glance. They
  // are clipped to the frame, and a ring that would fall entirely outside it is not
  // drawn at all.
  const reach = Math.hypot(Math.max(vx, W - vx), Math.max(vy, H - vy));
  const rings: string[] = [];
  for (let i = 1; barPx * i <= reach && i <= 6; i++) {
    rings.push(
      `<circle cx="${vx.toFixed(1)}" cy="${vy.toFixed(1)}" r="${(barPx * i).toFixed(1)}" fill="none" stroke="#2A2730" stroke-width="1"/>`,
    );
  }
  if (rings.length) parts.push(`<g clip-path="url(#frame)">${rings.join("")}</g>`);

  // A line from the venue to each spot: this is a walk, and it should look like one.
  for (const p of placed) {
    parts.push(
      `<line x1="${vx.toFixed(1)}" y1="${vy.toFixed(1)}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="#3B3546" stroke-width="1.5" stroke-dasharray="4 4"/>`,
    );
  }

  // The venue.
  parts.push(
    `<circle cx="${vx.toFixed(1)}" cy="${vy.toFixed(1)}" r="9" fill="#FFFFFF"/>`,
    `<text x="${vx.toFixed(1)}" y="${(vy + 26).toFixed(1)}" text-anchor="middle" fill="#FFFFFF" font-size="14" font-weight="600" font-family="system-ui,-apple-system,sans-serif">${escape(venue.name)}</text>`,
  );

  // The spots.
  for (const p of placed) {
    const tx = p.right ? p.x + 12 : p.x - 12;
    const anchor = p.right ? "start" : "end";
    parts.push(
      `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="6.5" fill="#582883" stroke="#0B0A0D" stroke-width="2"/>`,
      `<text x="${tx.toFixed(1)}" y="${(p.y - 1).toFixed(1)}" text-anchor="${anchor}" fill="#FFFFFF" font-size="13" font-weight="600" font-family="system-ui,-apple-system,sans-serif">${escape(p.name)}</text>`,
      `<text x="${tx.toFixed(1)}" y="${(p.y + 14).toFixed(1)}" text-anchor="${anchor}" fill="#A7A2AF" font-size="11.5" font-family="system-ui,-apple-system,sans-serif">${p.minutes} min walk</text>`,
    );
  }

  // North arrow.
  parts.push(
    `<g transform="translate(${W - 34},26)" fill="#A7A2AF">` +
      `<path d="M0,-11 L5.5,7 L0,3.2 L-5.5,7 Z" fill="#A7A2AF"/>` +
      `<text x="0" y="22" text-anchor="middle" font-size="11" font-family="system-ui,-apple-system,sans-serif">N</text>` +
      `</g>`,
  );

  // Scale bar.
  const bx = 22;
  const by = H - 24;
  parts.push(
    `<g stroke="#A7A2AF" stroke-width="1.5">` +
      `<line x1="${bx}" y1="${by}" x2="${(bx + barPx).toFixed(1)}" y2="${by}"/>` +
      `<line x1="${bx}" y1="${by - 4}" x2="${bx}" y2="${by + 4}"/>` +
      `<line x1="${(bx + barPx).toFixed(1)}" y1="${by - 4}" x2="${(bx + barPx).toFixed(1)}" y2="${by + 4}"/>` +
      `</g>` +
      `<text x="${bx}" y="${by - 10}" fill="#A7A2AF" font-size="11" font-family="system-ui,-apple-system,sans-serif">${barMetres} m</text>`,
  );

  const label = `Map of ${venue.name} and its ${placed.length} meeting spot${placed.length === 1 ? "" : "s"}. No people are shown.`;
  return (
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escape(label)}" xmlns="http://www.w3.org/2000/svg">` +
    parts.join("") +
    `</svg>`
  );
}
