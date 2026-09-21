// Photo approval queue, and reports + hidden people (H9, docs/visibility.md V6, V10).
// Decisions go through admin_* database functions, which write the moderation log.
import type { AdminHandler } from "./context";
import { adminPage, back, e, here, must, one, postButton, str } from "./ui";
import { sweepPhotos } from "../photo/sweep";

const PHOTOS = "photos";
const REASONS: Record<string, string> = {
  uncomfortable: "made me uncomfortable",
  not_who_they_said: "not who they said they were",
  under_19: "under 19",
  spam: "spam",
};

// GET /admin/photos — the photo queue, shown through 60-second signed links.
//
// **Three states, never one number** (Alex, M3.1). A photo that is not visible is in
// one of three situations and they want three different people acting on them:
//
//   waiting for a human   the check ran and could not tell      → decide it here
//   never checked         nothing has looked at it yet          → why did nothing run?
//   check failing         every attempt errored                 → fix the check
//
// The second and third look identical from the `people` row — both are `pending` —
// which is exactly the M2.3 map bug: "never fetched" left no failure record, so it
// was neither ready nor failing and read as fine. `photo_checks` is the record that
// tells them apart, and `admin_photo_states()` is the only place that counts them.
//
// And a missing key says so **once, here, where photos are managed**, rather than as
// one identical failure per photo.
export const photoQueue: AdminHandler = async (request, ctx) => {
  const [states, people] = await Promise.all([
    must(ctx.db.rpc("admin_photo_states")),
    must(
      ctx.db
        .from("people")
        .select("id, first_name, photo_path, photo_status, updated_at, person_handles(instagram)")
        .in("photo_status", ["needs_review", "pending"])
        .not("photo_path", "is", null)
        .order("photo_status")
        .order("updated_at"),
    ),
  ]);
  const count = one<any>(states) ?? { waiting_for_human: 0, never_checked: 0, check_failing: 0 };

  // The latest attempt per photo: its reason when a human is being asked, its error
  // when the check is what is broken.
  const lastCheck = new Map<string, { outcome: string; reason: string | null; error: string | null }>();
  if (people.length) {
    const checks = await must(
      ctx.db
        .from("photo_checks")
        .select("photo_path, outcome, reason, error, at")
        .in("photo_path", people.map((p: any) => p.photo_path))
        .order("at", { ascending: false }),
    );
    for (const c of checks as any[]) if (!lastCheck.has(c.photo_path)) lastCheck.set(c.photo_path, c);
  }

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
      const last = lastCheck.get(p.photo_path);
      // The two sentences that must never converge, plus the third that is not a
      // decision at all.
      const said =
        p.photo_status === "needs_review"
          ? `<span class="bad">the check could not tell</span>${last?.reason ? ` — ${e(last.reason)}` : ""}`
          : last
            ? `<span class="bad">the check is failing</span>${last.error ? ` — ${e(last.error)}` : ""}`
            : `<span class="muted">not checked yet</span>`;
      return `<tr><td>${url ? `<img class="photo" src="${e(url)}" alt="">` : `<span class="bad">file missing</span>`}</td>
<td>${e(p.first_name)}<br><span class="muted">${e(one<any>(p.person_handles)?.instagram ?? "")}</span><br>${said}</td>
<td>${postButton(`/admin/photos/${p.id}`, "Approve", backTo, { fields: { ...fields, status: "approved" } })}
${postButton(`/admin/photos/${p.id}`, "Reject", backTo, { cls: "danger", fields: { ...fields, status: "rejected" } })}</td></tr>`;
    })
    .join("");

  const keyMissing = !ctx.env.ANTHROPIC_API_KEY?.trim()
    ? `<p class="bad"><strong>ANTHROPIC_API_KEY is not set</strong>, so no photo is being checked at all — every upload stays pending and is visible to nobody.
Set it with <code>npx wrangler secret put ANTHROPIC_API_KEY</code>.</p>`
    : "";
  const hookMissing = !ctx.env.PHOTO_WEBHOOK_SECRET?.trim()
    ? `<p class="bad"><strong>PHOTO_WEBHOOK_SECRET is not set</strong>, so the database webhook is refused and photos are checked only when the app asks — the net without the mechanism.</p>`
    : "";

  // **Counting what is missing without a way to act on it is half the pattern.** The
  // nightly sweep at 09:00 is the other half; this is the same pass, for the moment
  // somebody is looking at the queue and does not want to wait until tomorrow.
  const sweepNow =
    count.never_checked + count.check_failing > 0
      ? ` ${postButton("/admin/photos/sweep", `Check the ${count.never_checked + count.check_failing} nothing has decided`, here(request), { cls: "plain" })}`
      : "";

  const body = `${keyMissing}${hookMissing}
<p><strong>${count.waiting_for_human}</strong> waiting for a human ·
<strong>${count.never_checked}</strong> never checked ·
<strong>${count.check_failing}</strong> with a failing check</p>
<p class="muted">Three different situations, deliberately counted apart. <em>Waiting for a human</em> is the automated check saying it could not tell — decide it below.
<em>Never checked</em> means nothing has looked yet, which is a question about the webhook, not about the photo.
<em>A failing check</em> is an operational fault and wants fixing rather than clearing.${sweepNow}</p>
<p class="muted">A nightly pass at 09:00 UTC picks up anything the webhook and the app both missed. <strong>If it ever finds much, the webhook is what is broken</strong> — the Configuration panel says whether it is reaching the Worker. A retry that quietly papers over a broken mechanism is how M2.1's map fallback became the mechanism.</p>
<p class="muted">People appear in lists straight away with their name; their photo shows only once approved.
A rejected photo stays hidden and the person stays visible without one. Links on this page expire after 60 seconds: reload if images stop loading.</p>
<table><tr><th>Photo</th><th>Person</th><th></th></tr>${rows || `<tr><td colspan="3">Nothing to review.</td></tr>`}</table>`;
  return adminPage(request, ctx.email, `Photo queue (${count.waiting_for_human})`, body);
};

// POST /admin/photos/sweep — the nightly pass, now, because the person looking at
// the queue is the person who wants it run.
export const sweepNow: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  try {
    const outcome = await sweepPhotos(ctx.env, { db: ctx.db });
    return back(form, { ok: outcome.message });
  } catch (err) {
    return back(form, { err: err instanceof Error ? err.message : "The sweep failed" });
  }
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
