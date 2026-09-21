// Photo approval queue, and reports + hidden people (H9, docs/visibility.md V6, V10).
// Decisions go through admin_* database functions, which write the moderation log.
import type { AdminHandler } from "./context";
import { adminPage, back, e, here, must, one, postButton, str } from "./ui";

const PHOTOS = "photos";
const REASONS: Record<string, string> = {
  uncomfortable: "made me uncomfortable",
  not_who_they_said: "not who they said they were",
  under_19: "under 19",
  spam: "spam",
};

// GET /admin/photos — pending photos, shown through 60-second signed links.
export const photoQueue: AdminHandler = async (request, ctx) => {
  const people = await must(
    ctx.db
      .from("people")
      .select("id, first_name, photo_path, updated_at, person_handles(instagram)")
      .eq("photo_status", "pending")
      .not("photo_path", "is", null)
      .order("updated_at"),
  );
  const signed = new Map<string, string>();
  if (people.length) {
    const { data } = await ctx.db.storage.from(PHOTOS).createSignedUrls(
      people.map((p: any) => p.photo_path),
      60,
    );
    for (const s of data ?? []) if (s.path && s.signedUrl) signed.set(s.path, s.signedUrl);
  }
  const backTo = here(request);
  const rows = people
    .map((p: any) => {
      const url = signed.get(p.photo_path);
      const fields = { photo_path: p.photo_path };
      return `<tr><td>${url ? `<img class="photo" src="${e(url)}" alt="">` : `<span class="bad">file missing</span>`}</td>
<td>${e(p.first_name)}<br><span class="muted">${e(one<any>(p.person_handles)?.instagram ?? "")}</span></td>
<td>${postButton(`/admin/photos/${p.id}`, "Approve", backTo, { fields: { ...fields, status: "approved" } })}
${postButton(`/admin/photos/${p.id}`, "Reject", backTo, { cls: "danger", fields: { ...fields, status: "rejected" } })}</td></tr>`;
    })
    .join("");
  const body = `<p class="muted">People appear in lists straight away with their name; their photo shows only once approved.
A rejected photo stays hidden and the person stays visible without one. Links on this page expire after 60 seconds: reload if images stop loading.</p>
<table><tr><th>Photo</th><th>Person</th><th></th></tr>${rows || `<tr><td colspan="3">Nothing to review.</td></tr>`}</table>`;
  return adminPage(request, ctx.email, `Photo queue (${people.length})`, body);
};

// POST /admin/photos/:id — applies only if the photo is still the one shown.
export const decidePhoto: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const status = str(form, "status");
  if (status !== "approved" && status !== "rejected") return back(form, { err: "Unknown decision" });
  const { error } = await ctx.db.rpc("admin_set_photo_status", {
    p_person: ctx.params.id,
    p_photo_path: str(form, "photo_path"),
    p_status: status,
    p_actor: ctx.email,
  });
  return back(form, error ? { err: error.message } : { ok: `Photo ${status}` });
};

// GET /admin/reports — hidden people and open reports, grouped by person.
export const reportQueue: AdminHandler = async (request, ctx) => {
  const { db } = ctx;
  const [reports, hidden] = await Promise.all([
    must(
      db
        .from("reports")
        .select("id, reporter_id, target_person_id, reason, is_safety, status, created_at")
        .eq("target_kind", "person")
        .in("status", ["open", "auto_hidden"])
        .order("created_at"),
    ),
    must(db.from("people").select("id").not("hidden_at", "is", null)),
  ]);
  const ids = new Set<string>([
    ...hidden.map((p: { id: string }) => p.id),
    ...reports.flatMap((r: any) => [r.target_person_id, r.reporter_id].filter(Boolean)),
  ]);
  const people = ids.size
    ? await must(db.from("people").select("id, first_name, hidden_at, person_handles(instagram)").in("id", [...ids]))
    : [];
  const byId = new Map<string, any>(people.map((p: any) => [p.id, p]));
  const pinCounts = new Map<string, number>();
  const targets = [...new Set<string>([...hidden.map((p: any) => p.id), ...reports.map((r: any) => r.target_person_id)])].filter(Boolean);
  if (targets.length) {
    const pins = await must(db.from("pins").select("person_id").in("person_id", targets));
    for (const p of pins as { person_id: string }[]) pinCounts.set(p.person_id, (pinCounts.get(p.person_id) ?? 0) + 1);
  }

  const backTo = here(request);
  const note = `<input name="note" size="24" placeholder="note (optional)">`;
  const actionForm = (personId: string, path: string, label: string, cls = "") =>
    `<form class="inline" method="post" action="/admin/people/${e(personId)}/${path}"><input type="hidden" name="back" value="${e(backTo)}">${note} <button class="${cls}">${label}</button></form>`;

  const card = (personId: string) => {
    const p = byId.get(personId) ?? {};
    const theirs = reports.filter((r: any) => r.target_person_id === personId);
    const list = theirs
      .map(
        (r: any) =>
          `<li>${e(REASONS[r.reason] ?? r.reason)}${r.is_safety ? " <strong>(safety)</strong>" : ""} — by ${e(byId.get(r.reporter_id)?.first_name ?? "someone")}, ${e(r.created_at.slice(0, 16).replace("T", " "))} UTC · ${e(r.status)}</li>`,
      )
      .join("");
    const actions = p.hidden_at
      ? actionForm(personId, "unhide", "Unhide") + " " + (theirs.length ? actionForm(personId, "keep-hidden", "Keep hidden", "danger") : "")
      : actionForm(personId, "hide", "Hide now", "danger") + " " + actionForm(personId, "dismiss-reports", "Dismiss reports", "plain");
    return `<tr><td><strong>${e(p.first_name ?? "?")}</strong> <span class="muted">${e(one<any>(p.person_handles)?.instagram ?? "")}</span><br>
${p.hidden_at ? `<span class="bad">hidden since ${e(p.hidden_at.slice(0, 16).replace("T", " "))} UTC</span>` : "visible"} · pins: ${pinCounts.get(personId) ?? 0}
<ul>${list || `<li class="muted">No open reports (reviewed earlier).</li>`}</ul></td><td>${actions}</td></tr>`;
  };

  const hiddenIds = hidden.map((p: any) => p.id);
  const reportedVisible = [...new Set<string>(reports.map((r: any) => r.target_person_id))].filter(
    (id) => id && !byId.get(id)?.hidden_at,
  );
  const needsReview = hiddenIds.filter((id: string) => reports.some((r: any) => r.target_person_id === id));
  const reviewed = hiddenIds.filter((id: string) => !needsReview.includes(id));

  const body = `<p class="muted">Safety reasons hide at once; "not who they said" and spam hide at two reports from different people.
Unhide dismisses their reports (a new report starts the count again). Keep hidden upholds them.</p>
<h2>Hidden, awaiting review (${needsReview.length})</h2>
<table>${needsReview.map(card).join("") || `<tr><td class="muted">None.</td></tr>`}</table>
<h2>Reported, still visible (${reportedVisible.length})</h2>
<table>${reportedVisible.map(card).join("") || `<tr><td class="muted">None.</td></tr>`}</table>
<h2>Hidden, reviewed (${reviewed.length})</h2>
<table>${reviewed.map(card).join("") || `<tr><td class="muted">None.</td></tr>`}</table>`;
  return adminPage(request, ctx.email, `Reports (${needsReview.length + reportedVisible.length})`, body);
};

function personAction(fn: string, done: string): AdminHandler {
  return async (request, ctx) => {
    const form = await request.formData();
    const { error } = await ctx.db.rpc(fn, {
      p_person: ctx.params.id,
      p_actor: ctx.email,
      p_note: str(form, "note") || null,
    });
    return back(form, error ? { err: error.message } : { ok: done });
  };
}

export const unhidePerson = personAction("admin_unhide_person", "Unhidden: visible again, reports dismissed");
export const keepHidden = personAction("admin_keep_hidden", "Kept hidden: reports upheld");
export const hidePerson = personAction("admin_hide_person", "Hidden");
export const dismissReports = personAction("admin_dismiss_reports", "Reports dismissed");
