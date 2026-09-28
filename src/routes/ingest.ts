// PostHog through our own origin (Alex, M3.2 — the own-origin rule).
//
// A26 is a public page pasted into Reddit threads, and it was talking to
// `us.i.posthog.com` and `us-assets.i.posthog.com`: two more hosts, two more
// connection setups on a page with a one-second feel to hit, and two more parties
// learning a visitor's IP and referring thread. Now the app on the web sends to
// `pind.social/ingest`, and this forwards it.
//
// What is forwarded is the request and nothing about the person beyond it: **no
// cookie, no client IP header** — PostHog sees Cloudflare's address, which is
// stricter than "Discard client IP data" already made it (decisions Part 5,
// "Analytics, as built").
//
// Listed in `run_worker_first` as `/ingest/*` (K05 checks it), or the assets binding
// would answer it with the app's index.html and a 200 (CLAUDE.md, "A missing Worker
// route does not 404").

export const INGEST_PREFIX = "/ingest";
const API_HOST = "us.i.posthog.com";
const ASSET_HOST = "us-assets.i.posthog.com";

// Where a request under /ingest goes. Static files and remote config live on the
// assets host; everything else (events, flags) on the API host.
export function ingestTarget(url: URL): URL | null {
  if (url.pathname !== INGEST_PREFIX && !url.pathname.startsWith(`${INGEST_PREFIX}/`)) return null;
  const rest = url.pathname.slice(INGEST_PREFIX.length) || "/";
  const host = rest.startsWith("/static/") || rest.startsWith("/array/") ? ASSET_HOST : API_HOST;
  return new URL(`https://${host}${rest}${url.search}`);
}

// Only what PostHog needs to read the request. Everything else — cookies, Cloudflare's
// client-IP headers, the referring page — stays here.
const KEEP = ["content-type", "content-encoding", "accept", "accept-encoding", "user-agent"];

export function ingestHeaders(incoming: Headers): Headers {
  const out = new Headers();
  for (const name of KEEP) {
    const value = incoming.get(name);
    if (value) out.set(name, value);
  }
  return out;
}

export async function ingest(request: Request): Promise<Response | null> {
  const target = ingestTarget(new URL(request.url));
  if (!target) return null;
  const upstream = await fetch(target.toString(), {
    method: request.method,
    headers: ingestHeaders(request.headers),
    body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
  });
  // PostHog's own caching headers pass through; nothing sets a cookie on our origin.
  const headers = new Headers(upstream.headers);
  headers.delete("set-cookie");
  return new Response(upstream.body, { status: upstream.status, headers });
}
