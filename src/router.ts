import { admin } from "./admin/routes";
import type { Env } from "./env";
import { page } from "./html";
import { publicRoutes } from "./public/routes";
import { health } from "./routes/health";

export type Handler = (request: Request, env: Env) => Promise<Response>;

// One line per route: "METHOD /path". Later milestones add lines here.
const routes: Record<string, Handler> = {
  "GET /health": health,
};

export async function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  // Admin (M1.2): behind Cloudflare Access, and every request re-checks the Access
  // token in the Worker. See src/admin/routes.ts.
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return admin(request, env);

  const handler = routes[`${request.method} ${pathname}`];
  if (handler) return handler(request, env);

  // The public web layer (M2.1): W1-W4, the OG image, the universal-link file.
  // It returns null for a path that is not one of ours, and hands anything under
  // /g/ that it does not own (/g/<slug>/pin) to the app itself.
  const pub = await publicRoutes(request, env);
  if (pub) return pub;

  // Everything else is the Expo web export, with single-page-app fallback (M2.0).
  if (env.ASSETS) return env.ASSETS.fetch(request);
  return page("Not found", "<h1>Not found</h1>", 404);
}
