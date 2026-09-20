// Serving venue maps from our own origin.
//
// Two routes, both content-addressed, both cached at the edge for a year:
//   /map/<venue>-<key>.webp   the generated Mapbox picture
//   /venue-map/<venue>-<hash> the optional uploaded override
//
// Neither points a visitor's browser at Supabase. The Worker reads the object with
// the service key — server-side, and a venue map is a public building and its public
// spots, never a person (H1, V12) — and hands the bytes back from pind.social. The
// measured reason is in CLAUDE.md: the same image took 911 ms from Supabase storage
// and 133 ms from here, because a second host means a second DNS lookup, handshake
// and TLS negotiation before a byte of the image moves.

import type { Env } from "../env";
import { serviceClient } from "../supabase";
import { BUCKET, IMMUTABLE, MAX_ATTEMPTS, chooseZoom, mapKey, objectPath, renderVenueMap, shortHash } from "./venuemap";

// The zoom a venue's picture is drawn at comes from its own active spots (chooseZoom),
// so both routes below have to read them. One query, coordinates only: the same input
// the crowd page gets through public_gathering, so the two always agree on the answer.
async function venueZoom(
  service: { from: (t: string) => any },
  venue: { latitude: number | null; longitude: number | null },
  venueId: string,
): Promise<number> {
  const { data } = await service
    .from("meeting_spots")
    .select("latitude, longitude")
    .eq("venue_id", venueId)
    .eq("active", true);
  return chooseZoom(venue, (data ?? []) as { latitude: number | null; longitude: number | null }[]);
}

const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });

// A Worker's own responses are NOT put in Cloudflare's cache just because they carry
// cache headers — that only happens for subrequests. Without this, every visitor's
// request for a map became a fresh download from Supabase inside the Worker: measured
// at 215-460 ms warm and 987 ms cold, which is the very cost the own-origin rule
// exists to avoid, just hidden one layer down. Both map URLs are content-addressed
// and immutable, so the cache can hold them indefinitely and a corrected coordinate
// simply produces a different URL.
async function cached(request: Request, ctx: ExecutionContext | undefined, build: () => Promise<Response>): Promise<Response> {
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await build();
  if (response.ok && ctx) ctx.waitUntil(cache.put(request, response.clone()));
  return response;
}

async function serveObject(env: Env, path: string, contentType: string): Promise<Response> {
  const { data, error } = await serviceClient(env).storage.from(BUCKET).download(path);
  if (error || !data) return notFound();
  return new Response(await data.arrayBuffer(), {
    headers: { "content-type": contentType, "cache-control": IMMUTABLE },
  });
}

// GET /map/<venue-uuid>-<key>.webp
export async function venueMapImage(
  request: Request,
  env: Env,
  ctx: ExecutionContext | undefined,
  venueId: string,
  key: string,
): Promise<Response> {
  return cached(request, ctx, () => buildVenueMapImage(env, venueId, key));
}

async function buildVenueMapImage(env: Env, venueId: string, key: string): Promise<Response> {
  const service = serviceClient(env);
  const { data: venue } = await service
    .from("venues")
    .select("id, latitude, longitude, is_seed")
    .eq("id", venueId)
    .maybeSingle();
  if (!venue || venue.is_seed) return notFound();

  // The key must be the one this venue's current coordinates and current spots
  // produce. An old key — from coordinates since corrected, or from before a spot
  // moved the zoom — is gone, not stale: that is what makes the response safe to
  // cache for a year.
  const { data: current } = await service.rpc("venue_map_key", {
    p_lat: venue.latitude,
    p_lng: venue.longitude,
  });
  const expected = mapKey({ map_key: (current as string | null) ?? null }, await venueZoom(service, venue, venueId));
  if (!expected || expected !== key) return notFound();

  return serveObject(env, objectPath(venueId, key), "image/webp");
}

// GET /venue-map/<venue-uuid>-<hash> — the uploaded override, same treatment.
export async function venueMapUpload(
  request: Request,
  env: Env,
  ctx: ExecutionContext | undefined,
  venueId: string,
  hash: string,
): Promise<Response> {
  return cached(request, ctx, () => buildVenueMapUpload(env, venueId, hash));
}

async function buildVenueMapUpload(env: Env, venueId: string, hash: string): Promise<Response> {
  const service = serviceClient(env);
  const { data: venue } = await service
    .from("venues")
    .select("id, map_image_path, is_seed")
    .eq("id", venueId)
    .maybeSingle();
  if (!venue || venue.is_seed || !venue.map_image_path) return notFound();
  if (shortHash(venue.map_image_path) !== hash) return notFound();

  const ext = venue.map_image_path.split(".").pop()?.toLowerCase();
  const type = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return serveObject(env, venue.map_image_path, type);
}

// The safety net: a crowd page rendered without a map, so make one for next time.
// It runs after the response has been sent (waitUntil), so no visitor ever waits for
// Mapbox, and it stops at the attempt cap so a venue that can never render cannot
// loop against a paid API with nobody watching.
export async function ensureVenueMap(env: Env, venueId: string): Promise<void> {
  const service = serviceClient(env);
  const { data: venue } = await service
    .from("venues")
    .select("id, latitude, longitude, is_seed")
    .eq("id", venueId)
    .maybeSingle();
  if (!venue || venue.is_seed || venue.latitude === null) return;

  const { data: key } = await service.rpc("venue_map_key", { p_lat: venue.latitude, p_lng: venue.longitude });
  const zoom = await venueZoom(service, venue, venueId);
  const full = mapKey({ map_key: (key as string | null) ?? null }, zoom);
  if (!full) return;

  const { data: record } = await service
    .from("venue_map_renders")
    .select("status, attempts")
    .eq("venue_id", venueId)
    .eq("map_key", full)
    .maybeSingle();
  if (record?.status === "ok") return;
  if ((record?.attempts ?? 0) >= MAX_ATTEMPTS) return;

  const outcome = await renderVenueMap(
    env.MAPBOX_TOKEN,
    service as never,
    { ...venue, map_key: (key as string | null) ?? null },
    record?.attempts ?? 0,
    zoom,
  );
  if (!outcome.ok) console.warn(JSON.stringify({ venueMap: venueId, key: full, error: outcome.error }));
}
