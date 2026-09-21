import { admin } from "./admin/routes";
import type { Env } from "./env";
import { page } from "./html";
import { deleteAccount } from "./account/routes";
import { photoCheckForMe, photoWebhook } from "./photo/routes";
import { publicRoutes } from "./public/routes";
import { health } from "./routes/health";

export type Handler = (request: Request, env: Env) => Promise<Response>;

// One line per route: "METHOD /path". Later milestones add lines here.
const routes: Record<string, Handler> = {
  "GET /health": health,
  // M3.1, the automated photo check. The webhook is the mechanism; the app's own
  // call after an upload is the net (decisions Part 5). Both are listed in
  // `run_worker_first` in wrangler.jsonc — a route that is not there never runs.
  "POST /hooks/photo-check": photoWebhook,
  "POST /photo-check": photoCheckForMe,
  // M3.1, A23. Deleting the auth user needs the service key, which never goes in a
  // bundle — and a half-finished delete is worse than either state, so it is one
  // server-side call rather than the app doing the parts it can.
  "POST /account/delete": deleteAccount,
};

export async function route(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  // One host for the product (M2.1). www is routed to the Worker so it can be sent
  // to the apex rather than failing; the shared link is always the apex.
  if (url.hostname.startsWith("www.")) {
    url.hostname = url.hostname.slice(4);
    return Response.redirect(url.toString(), 301);
  }
  // Admin (M1.2): behind Cloudflare Access, and every request re-checks the Access
  // token in the Worker. See src/admin/routes.ts.
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return admin(request, env);

  const handler = routes[`${request.method} ${pathname}`];
  if (handler) return handler(request, env);

  // The public web layer (M2.1): W1-W4, the OG image, the universal-link file.
  // It returns null for a path that is not one of ours, and hands anything under
  // /g/ that it does not own (/g/<slug>/pin) to the app itself.
  const pub = await publicRoutes(request, env, ctx);
  if (pub) return pub;

  // Everything else is the Expo web export, with single-page-app fallback (M2.0).
  if (env.ASSETS) return env.ASSETS.fetch(request);
  return page("Not found", "<h1>Not found</h1>", 404);
}
