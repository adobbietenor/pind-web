import type { Env } from "../env";
import { serviceClient } from "../supabase";
import type { AdminHandler } from "./context";
import * as g from "./gatherings";
import { requireAdmin } from "./guard";
import * as i from "./imports";
import * as m from "./moderation";
import { AdminError, adminPage, notFound, UUID } from "./ui";
import * as v from "./venues";

// "METHOD /path", where :id is a uuid. One line per admin route.
const ROUTES: [string, AdminHandler][] = [
  ["GET /admin", g.draftQueue],
  ["GET /admin/published", g.publishedList],
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
  try {
    return await found.handler(request, { env, email: who.email, params: found.params, db: serviceClient(env) });
  } catch (err) {
    if (err instanceof AdminError) {
      return adminPage(request, who.email, "Database error", `<p class="err">${err.message.replace(/[<>&"']/g, "")}</p>`, 500);
    }
    throw err;
  }
}
