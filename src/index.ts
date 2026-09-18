import type { Env } from "./env";
import { escape, page } from "./html";
import { route } from "./router";
import { ConfigError } from "./supabase";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (err) {
      // A missing setting is shown plainly; anything else is logged and hidden,
      // so no internal detail reaches a public page.
      if (err instanceof ConfigError) {
        return page("Error", `<h1>Error</h1><p class="error">${escape(err.message)}</p>`, 500);
      }
      console.error(err);
      return page("Error", `<h1>Something went wrong</h1>`, 500);
    }
  },
} satisfies ExportedHandler<Env>;
