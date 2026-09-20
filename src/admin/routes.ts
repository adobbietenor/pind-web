import type { Env } from "../env";
import { serviceClient } from "../supabase";
import { alertsConfigured } from "../ops/secrets";
import * as cfg from "./config";
import type { AdminContext, AdminHandler } from "./context";
import * as g from "./gatherings";
import { requireAdmin } from "./guard";
import * as i from "./imports";
import * as m from "./moderation";
import * as pub from "./publishing";
import { AdminError, adminPage, notFound, UUID } from "./ui";
import * as v from "./venues";

// "METHOD /path", where :id is a uuid. One line per admin route.
const ROUTES: [string, AdminHandler][] = [
  ["GET /admin", g.draftQueue],
  ["GET /admin/published", g.publishedList],
  ["GET /admin/config", cfg.configPage],
  // M2.2 — auto-publishing: the panel, the loop's settings, Alex's marks, promotions
  ["GET /admin/publishing", pub.publishingPage],
  ["POST /admin/publishing/settings", pub.savePublishSettings],
  ["POST /admin/gatherings/:id/mark", pub.setPublishMark],
  ["POST /admin/gatherings/:id/promote", pub.recordPromotion],
  ["POST /admin/promotions/:id/delete", pub.deletePromotion],
  ["GET /admin/gatherings/new", g.newGatheringForm],
  ["POST /admin/gatherings/new", g.createGathering],
  ["GET /admin/gatherings/:id", g.editGathering],
  ["POST /admin/gatherings/:id", g.saveGathering],
  ["POST /admin/gatherings/:id/publish", g.publishGathering],
  ["POST /admin/gatherings/:id/slug", g.changeSlug],
  ["POST /admin/gatherings/:id/unpublish", g.unpublishGathering],
  ["POST /admin/gatherings/:id/dismiss", g.dismissGathering],
  ["POST /admin/gatherings/:id/restore", g.restoreGathering],
  ["POST /admin/gatherings/:id/merge", g.mergeGathering],
  ["GET /admin/gatherings/:id/export.csv", g.exportCsv],
  ["POST /admin/pins/:id/delete", g.deletePin],
  ["GET /admin/venues", v.venueList],
  ["POST /admin/venues", v.createVenue],
  ["GET /admin/venues/:id", v.venueDetail],
  ["POST /admin/venues/:id", v.saveVenue],
  ["POST /admin/venues/:id/spots", v.addSpot],
  ["POST /admin/venues/:id/map", v.uploadMap],
  ["POST /admin/venues/:id/map/fetch", v.fetchVenueMap],
  ["POST /admin/venues/:id/aliases", v.addAlias],
  ["POST /admin/venues/:id/external-ids", v.addExternalId],
  ["POST /admin/venues/:id/external-ids/delete", v.deleteExternalId],
  ["POST /admin/aliases/:id/delete", v.deleteAlias],
  ["POST /admin/spots/:id", v.saveSpot],
  ["POST /admin/suggestions/:id/approve", v.approveSuggestion],
  ["POST /admin/suggestions/:id/reject", v.rejectSuggestion],
  // M1.3 — Ticketmaster import, flags, withdrawn, importer-made venues
  ["POST /admin/import/run", i.runNow],
  ["GET /admin/imports", i.runsPage],
  ["POST /admin/flags/:id/apply", i.applyFlag],
  ["POST /admin/flags/:id/ignore", i.ignoreFlag],
  ["POST /admin/gatherings/:id/withdraw", i.withdrawGathering],
  ["POST /admin/gatherings/:id/unwithdraw", i.unwithdrawGathering],
  ["POST /admin/venues/:id/confirm", i.confirmVenue],
  ["POST /admin/venues/:id/merge", i.mergeVenue],
  ["POST /admin/venues/:id/suggest", i.suggestSpotsNow],
  ["GET /admin/photos", m.photoQueue],
  ["POST /admin/photos/:id", m.decidePhoto],
  ["GET /admin/reports", m.reportQueue],
  ["POST /admin/people/:id/unhide", m.unhidePerson],
  ["POST /admin/people/:id/keep-hidden", m.keepHidden],
  ["POST /admin/people/:id/hide", m.hidePerson],
  ["POST /admin/people/:id/dismiss-reports", m.dismissReports],
];

// A stale nightly import means the public site has stopped refreshing, which is the
// kind of thing that should be unmissable from wherever Alex happens to be standing —
// not tucked into one panel on one page (Alex, M2.2). Injecting it here rather than
// in each handler means every admin page carries it, including ones added later.
//
// Only HTML pages: redirects have no body and the CSV export is a file. A failure to
// read the health is swallowed — the banner is a warning, and it must never be the
// reason a page does not load.
async function withStalenessBanner(response: Response, ctx: AdminContext): Promise<Response> {
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.startsWith("text/html")) return response;
  try {
    const health = await cfg.importHealth(ctx);
    if (!health.stale) return response;
    const banner = cfg.stalenessBanner(health, alertsConfigured(ctx.env));
    const html = (await response.text()).replace("</nav>", `</nav>${banner}`);
    return new Response(html, { status: response.status, headers: response.headers });
  } catch {
    return response;
  }
}

function match(method: string, pathname: string): { handler: AdminHandler; params: Record<string, string> } | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  const segments = path.split("/");
  for (const [key, handler] of ROUTES) {
    const [m, pattern] = key.split(" ") as [string, string];
    if (m !== method) continue;
    const want = pattern.split("/");
    if (want.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const ok = want.every((w, i) => {
      const got = segments[i]!;
      if (w.startsWith(":")) {
        if (!UUID.test(got)) return false;
        params[w.slice(1)] = got.toLowerCase();
        return true;
      }
      return w === got;
    });
    if (ok) return { handler, params };
  }
  return null;
}

// Every /admin request: the Access token first — before routing, so even unknown
// admin paths answer 403 without a valid token.
export async function admin(request: Request, env: Env): Promise<Response> {
  const who = await requireAdmin(request, env);
  if (who instanceof Response) return who;

  const found = match(request.method, new URL(request.url).pathname);
  if (!found) return notFound(request, who.email);
  const ctx: AdminContext = { env, email: who.email, params: found.params, db: serviceClient(env) };
  try {
    return await withStalenessBanner(await found.handler(request, ctx), ctx);
  } catch (err) {
    if (err instanceof AdminError) {
      return adminPage(request, who.email, "Database error", `<p class="err">${err.message.replace(/[<>&"']/g, "")}</p>`, 500);
    }
    throw err;
  }
}
