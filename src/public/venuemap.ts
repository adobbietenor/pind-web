// The real venue map on W2 (decisions.md Part 5, "A real map, not a schematic").
//
// One picture per venue: streets and buildings around the venue, fetched once from
// Mapbox, stored, and served from OUR origin. Everything with meaning on top of it —
// the venue, each spot, its name, its walking minutes, the north arrow, the link that
// opens walking directions — is our own HTML over the image, never baked into it.
//
// The rules this obeys, all of them binding:
//   - **Our origin, never Supabase.** The visitor's browser talks to pind.social and
//     nothing else. The same 157 KB image measured 911 ms from Supabase storage and
//     133 ms from here; the difference is one connection's DNS, TCP and TLS
//     (CLAUDE.md, "Keep the Worker lean").
//   - **One image per venue, generated once.** Not per gathering, not per view. Mapbox
//     requests track the number of venues — tens, ever — and never the traffic, so a
//     good Reddit day costs nothing.
//   - **Venue and spots, nothing else** (H1). There is no layer here that could draw a
//     person.
//   - **No geolocation** (H4). The venue is always the centre. There is no locate
//     control to remove, because a static image has no controls.
//
// The Mapbox key is a Worker secret and is never in the page: the Worker fetches the
// image server-side, exactly like the Anthropic and Ticketmaster keys.

// Bump this when the picture itself should change — zoom, size, style. It is part of
// the URL, so every page starts asking for a new file and the old ones are simply
// never requested again. Nothing to purge.
const VERSION = "v1";

const STYLE = "mapbox/dark-v11"; // near-black, to sit inside the page rather than glare out of it
const ZOOM = 16;
const WIDTH = 768;
const HEIGHT = 480;
// Measured on the real style, 2026-09-20: @1x is 22.9 KB and @2x is 57.4 KB as WebP.
// 57 KB is less than the schematic's fallback page weight was ever going to save, and
// it is the difference between crisp and soft on every phone made in the last decade.
const RETINA = true;

// Mapbox is asked NOT to draw its own attribution or logo, which their terms allow
// when the attribution appears elsewhere on the page. It does: W2 prints
// "© Mapbox © OpenStreetMap contributors" directly under the map, as real text.
const ATTRIBUTION = "&attribution=false&logo=false";

// How many times a venue's image may be asked for before we stop asking. A venue that
// can never render must not loop against a paid API with nobody watching.
export const MAX_ATTEMPTS = 3;

export const BUCKET = "venue-maps";

export interface MapVenueRow {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  map_key: string | null;
  map_ready: string[];
}

// The full key: the venue's coordinates (from the database) plus this renderer's
// version. Correcting coordinates or changing the picture both change it.
export function mapKey(venue: { map_key: string | null }): string | null {
  return venue.map_key ? `${venue.map_key}-${VERSION}` : null;
}

export const objectPath = (venueId: string, key: string) => `${venueId}/map-${key}.webp`;

// What W2 puts in the img src. Our origin, content-addressed, cacheable forever.
export const mapUrl = (venueId: string, key: string) => `/map/${venueId}-${key}.webp`;

export function isReady(venue: MapVenueRow): boolean {
  const key = mapKey(venue);
  return key !== null && venue.map_ready.includes(key);
}

// ---------------------------------------------------------------------------
// Where a spot lands on the picture
//
// Web Mercator, the same projection the tiles are in. Returns a position as a
// percentage of the image, and whether it is actually inside the frame.
// ---------------------------------------------------------------------------

const TILE = 256;

function project(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const size = TILE * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

export interface Placed {
  // Percent of the image's width and height, for CSS.
  left: number;
  top: number;
  // False when the spot falls outside the picture. It is still listed, with its
  // walking minutes and its directions link, and the page says it is not on the map —
  // so nobody has to wonder whether the marker is missing or the spot is.
  onMap: boolean;
}

export function place(
  centre: { latitude: number; longitude: number },
  point: { latitude: number; longitude: number },
): Placed {
  const c = project(centre.latitude, centre.longitude, ZOOM);
  const p = project(point.latitude, point.longitude, ZOOM);
  const x = WIDTH / 2 + (p.x - c.x);
  const y = HEIGHT / 2 + (p.y - c.y);
  // A margin, so a marker is only called "on the map" when its label has room too.
  const margin = 26;
  return {
    left: (x / WIDTH) * 100,
    top: (y / HEIGHT) * 100,
    onMap: x >= margin && x <= WIDTH - margin && y >= margin && y <= HEIGHT - margin,
  };
}

// The frame's width in metres, for the admin to explain itself with.
export function frameMetres(lat: number): number {
  return Math.round(WIDTH * ((156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** ZOOM));
}

// ---------------------------------------------------------------------------
// Fetching it, once
// ---------------------------------------------------------------------------

function mapboxUrl(token: string, lat: number, lng: number): string {
  // The format matters: a vector style with no extension comes back as PNG, which
  // measured 131.7 KB against WebP's 57.4 KB for the identical picture.
  const size = `${WIDTH}x${HEIGHT}${RETINA ? "@2x" : ""}.webp`;
  return (
    `https://api.mapbox.com/styles/v1/${STYLE}/static/` +
    `${lng.toFixed(6)},${lat.toFixed(6)},${ZOOM},0,0/${size}` +
    `?access_token=${encodeURIComponent(token)}${ATTRIBUTION}`
  );
}

export interface RenderOutcome {
  ok: boolean;
  bytes?: number;
  error?: string;
  stopped?: boolean; // the attempt cap was reached; we did not call Mapbox
}

// Fetch the venue's map and store it. Safe to call twice: a second call for a key
// that already exists is a no-op. Never throws — a map is not worth a 500 on a page
// that has already fallen back.
// The token is passed in rather than the whole Env: this module is loaded directly by
// the unit tests, and keeping it free of every other import is what lets them (see
// src/public/escape.ts).
export async function renderVenueMap(
  token: string | undefined,
  service: { storage: any; rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: unknown }> },
  venue: { id: string; latitude: number | null; longitude: number | null; map_key: string | null },
  attemptsSoFar: number,
): Promise<RenderOutcome> {
  const key = mapKey(venue);
  if (!key || venue.latitude === null || venue.longitude === null) {
    return { ok: false, error: "the venue has no coordinates" };
  }
  if (!token?.trim()) {
    return { ok: false, error: "MAPBOX_TOKEN is missing" };
  }
  if (attemptsSoFar >= MAX_ATTEMPTS) {
    return { ok: false, stopped: true, error: `stopped after ${MAX_ATTEMPTS} attempts` };
  }

  let outcome: RenderOutcome;
  try {
    const response = await fetch(mapboxUrl(token, venue.latitude, venue.longitude));
    if (!response.ok) {
      // Mapbox puts the reason in the body; keep it short and never log the token.
      const detail = (await response.text()).slice(0, 200);
      outcome = { ok: false, error: `Mapbox ${response.status}: ${detail}` };
    } else {
      const bytes = new Uint8Array(await response.arrayBuffer());
      const put = await service.storage
        .from(BUCKET)
        .upload(objectPath(venue.id, key), bytes, { contentType: "image/webp", upsert: true });
      outcome = put.error
        ? { ok: false, error: `storing it failed: ${String(put.error.message)}` }
        : { ok: true, bytes: bytes.byteLength };
    }
  } catch (err) {
    outcome = { ok: false, error: `fetching it failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  await service.rpc("admin_record_map_render", {
    p_venue: venue.id,
    p_key: key,
    p_ok: outcome.ok,
    p_error: outcome.error ?? null,
    p_bytes: outcome.bytes ?? null,
  });
  return outcome;
}

// ---------------------------------------------------------------------------
// Serving it, from our origin
// ---------------------------------------------------------------------------

// A small non-cryptographic hash, for cache keys only. Used to version the URL of an
// uploaded override so that it, too, can be immutable: replace the upload and the URL
// changes, so no stale image can survive.
export function shortHash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, "0");
}

export const uploadUrl = (venueId: string, path: string) => `/venue-map/${venueId}-${shortHash(path)}`;

// Both map routes are content-addressed: the URL changes whenever the picture would,
// so it can be cached for a year and never needs purging. Correcting a venue's
// coordinates in the admin mints a different key, the page starts asking for the new
// file, and the old one is simply never requested again.
export const IMMUTABLE = "public, max-age=31536000, immutable";
