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
import { BUCKET, IMMUTABLE, MAX_ATTEMPTS, mapKey, objectPath, renderVenueMap, shortHash } from "./venuemap";

const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });

async function serveObject(env: Env, path: string, contentType: string): Promise<Response> {
  const { data, error } = await serviceClient(env).storage.from(BUCKET).download(path);
  if (error || !data) return notFound();
  return new Response(await data.arrayBuffer(), {
    headers: { "content-type": contentType, "cache-control": IMMUTABLE },
  });
}

// GET /map/<venue-uuid>-<key>.webp
export async function venueMapImage(env: Env, venueId: string, key: string): Promise<Response> {
  const service = serviceClient(env);
  const { data: venue } = await service
    .from("venues")
    .select("id, latitude, longitude, is_seed")
    .eq("id", venueId)
    .maybeSingle();
  if (!venue || venue.is_seed) return notFound();

  // The key must be the one this venue's current coordinates produce. An old key —
  // from coordinates since corrected — is gone, not stale: that is what makes the
  // response safe to cache for a year.
  const { data: current } = await service.rpc("venue_map_key", {
    p_lat: venue.latitude,
    p_lng: venue.longitude,
  });
  const expected = mapKey({ map_key: (current as string | null) ?? null });
  if (!expected || expected !== key) return notFound();

  return serveObject(env, objectPath(venueId, key), "image/webp");
}

// GET /venue-map/<venue-uuid>-<hash> — the uploaded override, same treatment.
export async function venueMapUpload(env: Env, venueId: string, hash: string): Promise<Response> {
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
  const full = mapKey({ map_key: (key as string | null) ?? null });
  if (!full) return;

  const { data: record } = await service
    .from("venue_map_renders")
    .select("status, attempts")
    .eq("venue_id", venueId)
    .eq("map_key", full)
    .maybeSingle();
  if (record?.status === "ok") return;
  if ((record?.attempts ?? 0) >= MAX_ATTEMPTS) return;

  const outcome = await renderVenueMap(env.MAPBOX_TOKEN, service as never, { ...venue, map_key: (key as string | null) ?? null }, record?.attempts ?? 0);
  if (!outcome.ok) console.warn(JSON.stringify({ venueMap: venueId, key: full, error: outcome.error }));
}
