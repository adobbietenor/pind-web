import { runSeriesChecks, CHECKER, LIVENESS_CRON } from "./community/run";
import { spotSuggestionsOn, type Env } from "./env";
import { escape, page } from "./html";
import { IMPORTER, runImport } from "./import/run";
import { checkExpiringCredentials } from "./ops/watch";
import { PHOTO_SWEEP_CRON, sweepPhotos } from "./photo/sweep";
import { route } from "./router";
import { ConfigError, serviceClient } from "./supabase";

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

  // Three schedules (wrangler.jsonc "triggers"), and the handler branches on which one
  // fired: the nightly Ticketmaster import (M1.3) at 08:00 UTC, the photo sweep (M3.1)
  // at 09:00, and the community liveness check (M2.3b) at 13:00. **Separate on
  // purpose** — the import must not be delayed by somebody else's slow website, a
  // liveness run that stalls must not stop the city's list refreshing, and a photo
  // that both the webhook and the app missed must not wait on either of them (Alex:
  // "own cron, own budget line, never inside the import"). They hold different locks,
  // so none can report another as busy.
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    if (controller.cron === PHOTO_SWEEP_CRON) {
      // Two small jobs share this trigger. The sweep spends money and is bounded;
      // the credential check is a date comparison that costs nothing and cannot
      // stall, which is why it does not get a cron of its own. Each is wrapped so
      // neither can stop the other — the failure this whole area keeps hitting is
      // one thing quietly preventing another from running at all.
      for (const job of [
        () => sweepPhotos(env),
        () => checkExpiringCredentials(env),
      ]) {
        try {
          console.log((await job()).message);
        } catch (err) {
          console.error("09:00 run:", err instanceof Error ? err.message : err);
        }
      }
      return;
    }
    if (controller.cron === LIVENESS_CRON) {
      const outcome = await runSeriesChecks(env, { trigger: "cron", actor: CHECKER });
      console.log(outcome.message);
      return;
    }

    // First, tell the database what schedule actually fired this — the cron
    // expression Cloudflare matched and the instant it meant to fire (M2.2). The
    // watchdog measures "is the import overdue" against that rather than against a
    // fixed hour, so a changed cron line, or a wrong assumption about which timezone
    // cron triggers use, moves the threshold with it instead of raising a phantom
    // alarm every day. It is also the only evidence that settles the question: this
    // is the scheduler reporting itself, not documentation.
    //
    // Best-effort and first: if this throws, the import still runs.
    try {
      await serviceClient(env).rpc("admin_report_import_schedule", {
        p_cron: controller.cron,
        p_scheduled_time: new Date(controller.scheduledTime).toISOString(),
      });
    } catch (err) {
      console.error("could not report the cron schedule:", err instanceof Error ? err.message : err);
    }

    const outcome = await runImport(env, {
      trigger: "cron",
      actor: IMPORTER,
      deadline: Date.now() + CRON_BUDGET_MS,
      spots: spotSuggestionsOn(env), // off until M1.3b
    });
    console.log(outcome.message);
  },
} satisfies ExportedHandler<Env>;
