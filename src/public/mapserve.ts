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
import { crowds } from "./data";
import { BUCKET, IMMUTABLE, MAX_ATTEMPTS, chooseZoom, mapKey, objectPath, renderVenueMap, shortHash } from "./venuemap";

// The zoom a venue's picture is drawn at comes from its own active spots (chooseZoom),
// so the render pass has to read them. One query, coordinates only: the same input the
// crowd page gets through public_gathering, so the two always agree on the answer.
//
// **The error is not swallowed.** A failed read used to mean "no spots", which means
// zoom 16, which means a different key — so one transient hiccup would have had the
// job render the wrong picture, or the route answer 404 for the right one. Null says
// "we do not know", and the caller declines to guess.
async function venueZoom(
  service: { from: (t: string) => any },
  venue: { latitude: number | null; longitude: number | null },
  venueId: string,
): Promise<number | null> {
  const { data, error } = await service
    .from("meeting_spots")
    .select("latitude, longitude")
    .eq("venue_id", venueId)
    .eq("active", true);
  if (error || !data) return null;
  return chooseZoom(venue, data as { latitude: number | null; longitude: number | null }[]);
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

  // Two things have to be true of the key being asked for, and they are different
  // questions with different answers:
  //
  //   1. **Its coordinates must be the venue's current ones.** A key from coordinates
  //      since corrected is gone, not stale — that is what makes this response safe to
  //      cache for a year, and it is the whole reason the key is content-addressed.
  //   2. **We must have actually rendered that picture.** Checked against the render
  //      record, not by recomputing the zoom.
  //
  // It used to recompute the zoom and compare, which turned two ordinary events into a
  // missing map: a transient failure reading the venue's spots, and a spot approved in
  // the seconds between the page being rendered and the browser asking for its image.
  // In both cases the picture existed and was the right one for the markers drawn over
  // it — the page and the route had simply computed the zoom from different reads. The
  // record is the fact; the coordinates are the safety property.
  const { data: current } = await service.rpc("venue_map_key", {
    p_lat: venue.latitude,
    p_lng: venue.longitude,
  });
  const coordKey = (current as string | null) ?? null;
  if (!coordKey || !key.startsWith(`${coordKey}-`)) return notFound();

  const { data: record } = await service
    .from("venue_map_renders")
    .select("status")
    .eq("venue_id", venueId)
    .eq("map_key", key)
    .maybeSingle();
  if (record?.status !== "ok") return notFound();

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
  if (zoom === null) return; // the spots could not be read: guessing the zoom renders the wrong picture
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

// ---------------------------------------------------------------------------
// Rendering ahead of anybody looking
//
// **A visitor must never be the thing that fetches the picture.** The safety net above
// is a net: the first person to open a crowd page gets the fallback and the picture is
// made for whoever comes next. That was tolerable when it was a rare event and became
// the mechanism by default — and M2.3 made it plain, because putting the zoom into the
// key retired every render at once. Measured on staging: **29 of 37 venues behind a
// published gathering had no picture at their current key**, so the first view of each
// was a drawing, or nothing at all at the 24 venues with no spots to draw. Which is
// exactly the view that arrives from a fresh Reddit post.
//
// So the nightly run renders them. Mapbox requests still scale with venues and never
// with traffic — tens, ever — and a venue that cannot render stops at the attempt cap
// as before.
// ---------------------------------------------------------------------------

// The venues behind what a visitor can actually open, read as a visitor.
async function publicVenueIds(env: Env, now: Date, days: number): Promise<string[]> {
  const list = await crowds(env, new Date(now.getTime() - 86_400_000), new Date(now.getTime() + days * 86_400_000));
  return [...new Set(list.map((g) => g.venue_id))];
}

export interface MapPassResult {
  considered: number;
  rendered: number;
  failed: number;
  missing: number; // still without a picture after this pass: the number the admin shows
  stopped: number; // at the attempt cap, so not tried again on their own
  noToken: boolean;
}

// **Which venues, asked of the one door.** The set that matters is "venues a visitor
// can reach", and that definition lives in the database — published, not withdrawn,
// not seeded, carrying a slug (M2.1, H11). Repeating it here as a service-key filter
// looked identical and was not: a gathering Alex unpublished keeps its slug (M2.2,
// "once public, only Alex brings it back"), so a hand-written filter counted Scotiabank
// Arena as a venue needing a map for a page nobody can open. The door is read with the
// anon key, as a visitor, and RLS answers the question. The service key then fetches
// the operational detail — coordinates, spots, render records — for exactly those
// venues, which is its own job (V12).
export async function ensureMapsForUpcoming(env: Env, days = 28, limit = 40): Promise<MapPassResult> {
  const service = serviceClient(env);
  const now = new Date();
  const out: MapPassResult = { considered: 0, rendered: 0, failed: 0, missing: 0, stopped: 0, noToken: !env.MAPBOX_TOKEN?.trim() };

  const reachable = await publicVenueIds(env, now, days);
  if (reachable.length === 0) return out;

  const { data: rows, error } = await service
    .from("venues")
    .select("id, latitude, longitude, is_seed, map_image_path, meeting_spots(latitude, longitude, active)")
    .in("id", reachable);
  if (error) throw new Error(`venue maps: ${error.message}`);

  const venues = new Map<string, any>();
  for (const v of (rows ?? []) as any[]) {
    // An uploaded override is the venue's own picture; nothing to fetch.
    if (!v.is_seed && !v.map_image_path && v.latitude !== null && v.longitude !== null) venues.set(v.id, v);
  }
  out.considered = venues.size;
  if (venues.size === 0) return out;

  const { data: keys, error: keyError } = await service.rpc("admin_venue_map_keys");
  if (keyError) throw new Error(`venue maps: ${keyError.message}`);
  const coordKey = new Map(((keys ?? []) as any[]).map((k) => [k.venue_id, k.coord_key as string]));

  const { data: renders } = await service.from("venue_map_renders").select("venue_id, map_key, status, attempts");
  const recorded = new Map<string, { status: string; attempts: number }>();
  for (const r of ((renders ?? []) as any[])) recorded.set(`${r.venue_id}:${r.map_key}`, r);

  let calls = 0;
  for (const v of venues.values()) {
    const zoom = chooseZoom(v, ((v.meeting_spots ?? []) as any[]).filter((s) => s.active));
    const full = mapKey({ map_key: coordKey.get(v.id) ?? null }, zoom);
    if (!full) {
      out.missing += 1;
      continue;
    }
    const record = recorded.get(`${v.id}:${full}`);
    if (record?.status === "ok") continue;
    if ((record?.attempts ?? 0) >= MAX_ATTEMPTS) {
      out.stopped += 1;
      out.missing += 1;
      continue;
    }
    // A bounded number of Mapbox calls a night. Whatever is left is counted as
    // missing, said in the admin, and picked up tomorrow — never silently dropped.
    if (calls >= limit || out.noToken) {
      out.missing += 1;
      continue;
    }
    calls += 1;
    const outcome = await renderVenueMap(
      env.MAPBOX_TOKEN,
      service as never,
      { id: v.id, latitude: v.latitude, longitude: v.longitude, map_key: coordKey.get(v.id) ?? null },
      record?.attempts ?? 0,
      zoom,
    );
    if (outcome.ok) out.rendered += 1;
    else {
      out.failed += 1;
      out.missing += 1;
      console.warn(JSON.stringify({ venueMap: v.id, key: full, error: outcome.error }));
    }
  }
  return out;
}

// What the admin needs to say out loud: the venues a visitor could reach today whose
// picture is not there. "Never fetched" had no render record at all, so it was the one
// state nothing counted — unset is a different state from broken, and it belongs in
// front of whoever can fix it (CLAUDE.md).
export async function venuesWithoutMaps(env: Env, days = 28): Promise<{ id: string; name: string; key: string | null }[]> {
  const service = serviceClient(env);
  const now = new Date();
  const reachable = await publicVenueIds(env, now, days);
  if (reachable.length === 0) return [];

  const { data: rows } = await service
    .from("venues")
    .select("id, name, latitude, longitude, is_seed, map_image_path, meeting_spots(latitude, longitude, active)")
    .in("id", reachable);

  const venues = new Map<string, any>();
  for (const v of ((rows ?? []) as any[])) {
    if (!v.is_seed && !v.map_image_path) venues.set(v.id, v);
  }
  if (venues.size === 0) return [];

  const { data: keys } = await service.rpc("admin_venue_map_keys");
  const coordKey = new Map(((keys ?? []) as any[]).map((k) => [k.venue_id, k.coord_key as string]));
  const { data: renders } = await service.from("venue_map_renders").select("venue_id, map_key, status");
  const ok = new Set(((renders ?? []) as any[]).filter((r) => r.status === "ok").map((r) => `${r.venue_id}:${r.map_key}`));

  const out: { id: string; name: string; key: string | null }[] = [];
  for (const v of venues.values()) {
    const zoom = chooseZoom(v, ((v.meeting_spots ?? []) as any[]).filter((s) => s.active));
    const full = mapKey({ map_key: coordKey.get(v.id) ?? null }, zoom);
    if (!full || !ok.has(`${v.id}:${full}`)) out.push({ id: v.id, name: v.name, key: full });
  }
  return out;
}
