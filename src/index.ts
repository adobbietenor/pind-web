import { spotSuggestionsOn, type Env } from "./env";
import { escape, page } from "./html";
import { IMPORTER, runImport } from "./import/run";
import { route } from "./router";
import { ConfigError } from "./supabase";

// The cron trigger has 15 minutes; AI calls stop starting after 13.
const CRON_BUDGET_MS = 13 * 60 * 1000;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await route(request, env, ctx);
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

  // M1.3: the nightly Ticketmaster import (wrangler.jsonc "triggers").
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const outcome = await runImport(env, {
      trigger: "cron",
      actor: IMPORTER,
      deadline: Date.now() + CRON_BUDGET_MS,
      spots: spotSuggestionsOn(env), // off until M1.3b
    });
    console.log(outcome.message);
  },
} satisfies ExportedHandler<Env>;
