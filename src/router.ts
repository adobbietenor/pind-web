import type { Env } from "./env";
import { page } from "./html";
import { health } from "./routes/health";

export type Handler = (request: Request, env: Env) => Promise<Response>;

// One line per route: "METHOD /path". Later milestones add lines here.
const routes: Record<string, Handler> = {
  "GET /health": health,
};

export function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const handler = routes[`${request.method} ${pathname}`];
  if (handler) return handler(request, env);
  return Promise.resolve(page("Not found", "<h1>Not found</h1>", 404));
}
