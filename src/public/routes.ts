// The public web layer's routes (spec §2 and §4).
//
// The Worker renders its own routes first; everything else falls through to the
// Expo web export with single-page-app fallback, so /g/<slug>/pin, /crew/<id> and
// /me are app routes on the same host. One domain, one deploy, one universal-link
// file, no CORS, and the shared link is always the crowd page.

import { ONE_LINER } from "@pind/shared";
import type { Env } from "../env";
import { crowd } from "./data";
import { appSiteAssociation, ogImage } from "./og";
import { pngResponse, rasterise } from "./ogpng";
import { ensureVenueMap, venueMapImage, venueMapUpload } from "./mapserve";
import { about, favicon, ics, robots, w1, w2, w3 } from "./pages";
import { privacy, terms } from "./policy";

// Anything that is not one of ours is the app's (M2.0).
function toApp(request: Request, env: Env): Promise<Response> {
  if (!env.ASSETS) return Promise.resolve(new Response("Not found", { status: 404 }));
  return env.ASSETS.fetch(request);
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Returns a response for any public path, or null when the path is not ours.
export async function publicRoutes(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response | null> {
  const { pathname } = new URL(request.url);

  if (request.method !== "GET" && request.method !== "HEAD") return null;

  // Venue maps, served from our own origin and never from Supabase (CLAUDE.md,
  // "Keep the Worker lean"). Both URLs are content-addressed, so both are immutable.
  const generated = /^\/map\/([0-9a-f-]{36})-([a-z0-9-]{3,40})\.webp$/.exec(pathname);
  if (generated) return venueMapImage(request, env, ctx, generated[1]!, generated[2]!);
  const uploaded = /^\/venue-map\/([0-9a-f-]{36})-([a-z0-9]{1,12})$/.exec(pathname);
  if (uploaded) return venueMapUpload(request, env, ctx, uploaded[1]!, uploaded[2]!);

  // The two tabs are two paths, not a query parameter: "pind.social/community" is a
  // link worth pasting into a run-club thread on its own, and "/" stays the shortest
  // possible thing to paste anywhere else (Claude's call, M2.3 — Alex left it to me).
  if (pathname === "/") return w1(request, env, "events");
  if (pathname === "/community") return w1(request, env, "community");
  if (pathname === "/about") return about();
  // Drafts, at exactly the URLs the Google consent screen links to (M3.2).
  if (pathname === "/privacy") return privacy();
  if (pathname === "/terms") return terms();
  if (pathname === "/robots.txt") return robots();
  if (pathname === "/favicon.svg") return favicon();
  if (pathname === "/.well-known/apple-app-site-association") return appSiteAssociation();

  // The OG image: /og/<slug>.png
  const og = /^\/og\/([a-z0-9-]+)\.png$/.exec(pathname);
  if (og) return ogFor(env, og[1]!);

  if (!pathname.startsWith("/g/")) return null;

  // /g/<slug>.ics — add to calendar
  const cal = /^\/g\/([a-z0-9-]+)\.ics$/.exec(pathname);
  if (cal) return ics(request, env, cal[1]!);

  const rest = pathname.slice(3);
  const [slug, ...tail] = rest.split("/");
  if (!slug || !SLUG.test(slug)) return toApp(request, env);

  if (tail.length === 0 || (tail.length === 1 && tail[0] === "")) return w2(request, env, slug, ctx);
  if (tail.length === 1 && tail[0] === "spot") return w3(request, env, slug);

  // /g/<slug>/pin and anything else under a gathering belong to the app.
  return toApp(request, env);
}

async function ogFor(env: Env, slug: string): Promise<Response> {
  const door = await crowd(env, slug);
  if (door.status !== "ok") return new Response("Not found", { status: 404 });
  const tz = door.venue.timezone;
  const when = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(door.gathering.starts_at));
  const svg = ogImage({ name: door.gathering.name, when, venue: door.venue.name, oneLiner: ONE_LINER });
  return pngResponse(rasterise(svg));
}
