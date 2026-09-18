// The Ticketmaster import in the admin (Phase 1 M1.3, decisions Part 5): the last
// run's summary and "Run import now", flags on published gatherings, withdraw /
// un-withdraw, venues needing spots, venues the importer created, and the runs list.
// Every change goes through an admin_* database function, logged with Alex's email.
import { distanceKm } from "../import/ticketmaster";
import { runImport, SCORE_THRESHOLD, suggestForOneVenue } from "../import/run";
import type { AdminHandler, AdminContext } from "./context";
import type { Places } from "./places";
import { formatLocal } from "./time";
import { adminPage, back, e, must, postButton, str, UUID } from "./ui";

const DAY = 24 * 60 * 60 * 1000;
const TORONTO = "America/Toronto";
const NEAR_KM = 0.3;

// The button waits for the import and as much scoring as fits in 45 seconds; the
// rest is scored tonight. Spot suggestions are nightly, or per venue.
const BUTTON_BUDGET_MS = 45_000;

export function scoreCell(p: Places, venueId: string | null, ai: number | null, reason: string | null): string {
  if (ai === null) return `<span class="muted">unscored</span>`;
  const r = p.rank(venueId, ai);
  const parts = [`AI ${ai}`];
  if (r.adjustment) parts.push(`−${r.adjustment}`);
  if (r.km !== null) parts.push(`${r.km.toFixed(1)} km`);
  return `<strong>${r.final}</strong> <span class="muted">· ${parts.join(" · ")}</span><br><span class="muted">${e(reason ?? "")}</span>`;
}

// ---------------------------------------------------------------------------
// Panels on the draft queue
// ---------------------------------------------------------------------------

function applied(counts: any): Record<string, number> {
  return (counts?.applied ?? {}) as Record<string, number>;
}

function skippedTotal(counts: any): number {
  return Object.values((counts?.skipped ?? {}) as Record<string, number>).reduce((a, b) => a + b, 0);
}

export async function importPanel(ctx: AdminContext, backTo: string): Promise<string> {
  const [runs, spent] = await Promise.all([
    must(ctx.db.from("import_runs").select("*").in("trigger", ["cron", "manual"]).order("started_at", { ascending: false }).limit(1)),
    must(ctx.db.rpc("admin_ai_spend_today", { p_city: "toronto" })),
  ]);
  const cap = Number(ctx.env.AI_DAILY_CAP_USD ?? 3);
  const run = runs[0];
  const button = postButton("/admin/import/run", "Run import now", backTo);
  if (!run) return `<fieldset><legend>Ticketmaster import</legend><p>No import has run yet. ${button}</p></fieldset>`;
  const a = applied(run.counts);
  const errors: string[] = run.counts?.errors ?? [];
  const cls = run.status === "ok" ? "good" : run.status === "running" ? "" : "bad";
  const skipped = Object.entries((run.counts?.skipped ?? {}) as Record<string, number>)
    .map(([k, n]) => `${k.replace(/_/g, " ")} ${n}`)
    .join(", ");
  return `<fieldset><legend>Ticketmaster import</legend>
<p>Last run: <strong>${e(formatLocal(run.started_at, TORONTO))}</strong> (${e(run.trigger)}) · <span class="${cls}">${e(run.status)}</span>
· new <strong>${a.new ?? 0}</strong> · updated ${(a.updated ?? 0) + (a.restored ?? 0)} · dismissed ${a.dismissed ?? 0}
· flagged ${a.flagged ?? 0} · skipped ${skippedTotal(run.counts)} · failed ${errors.length}
· scored ${run.counts?.scored ?? 0}${run.counts?.unscored_left ? ` (<span class="bad">${run.counts.unscored_left} still unscored</span>)` : ""}
· Ticketmaster calls ${run.tm_calls} · AI <strong>$${Number(run.ai_cost_usd).toFixed(2)}</strong></p>
${skipped ? `<p class="muted">Skipped: ${e(skipped)}</p>` : ""}
${errors.length ? `<p class="bad">${errors.slice(0, 3).map((x) => e(x)).join("<br>")}</p>` : ""}
${run.counts?.ai_capped ? `<p class="bad">Daily AI cap reached: the rest are scored tomorrow.</p>` : ""}
<p>AI spend today: $${Number(spent).toFixed(2)} of $${cap.toFixed(2)} · ${button} <a href="/admin/imports">All runs</a>
<span class="muted">· nightly at 4am (3am in winter)</span></p></fieldset>`;
}

const FLAG_TEXT: Record<string, string> = {
  date_changed: "Ticketmaster changed the date or time",
  rescheduled: "Ticketmaster says rescheduled",
  postponed: "Ticketmaster says postponed",
  cancelled: "Ticketmaster says cancelled",
  missing: "No longer listed on Ticketmaster (2 nights)",
};

export async function flagsPanel(ctx: AdminContext, p: Places, backTo: string, gatheringId?: string): Promise<string> {
  let q = ctx.db
    .from("gathering_flags")
    .select("id, kind, old_starts_at, new_starts_at, created_at, updated_at, gathering_id, gatherings(name, venue_id, starts_at)")
    .is("resolved_at", null)
    .order("created_at");
  if (gatheringId) q = q.eq("gathering_id", gatheringId);
  const flags = await must(q);
  if (!flags.length) return "";
  const rows = flags
    .map((f: any) => {
      const g = Array.isArray(f.gatherings) ? f.gatherings[0] : f.gatherings;
      const tz = p.tz(g?.venue_id);
      const change =
        f.new_starts_at && f.old_starts_at
          ? `${e(formatLocal(f.old_starts_at, tz))} → <strong>${e(formatLocal(f.new_starts_at, tz))}</strong>`
          : "";
      const apply = f.new_starts_at
        ? postButton(`/admin/flags/${f.id}/apply`, "Apply new date", backTo, {
            confirm: "Move this published gathering and its spot poll to the new date? Pinned people are not told (open item).",
          })
        : "";
      return `<tr><td><a href="/admin/gatherings/${e(f.gathering_id)}">${e(g?.name ?? "")}</a><br><span class="muted">${e(formatLocal(g?.starts_at, tz))}</span></td>
<td class="bad">${e(FLAG_TEXT[f.kind] ?? f.kind)}<br>${change}</td>
<td>${apply} <a href="/admin/gatherings/${e(f.gathering_id)}#withdraw">Withdraw…</a> ${postButton(`/admin/flags/${f.id}/ignore`, "Ignore", backTo, { cls: "plain" })}</td></tr>`;
    })
    .join("");
  return `<h2 class="bad">Changes on published gatherings (${flags.length})</h2>
<p class="muted">The importer never changes a published gathering. You decide.</p>
<table><tr><th>Gathering</th><th>What changed</th><th></th></tr>${rows}</table>`;
}

// Venues with fewer than 3 approved spots and an upcoming draft scoring 40+.
export async function venuesNeedingSpotsPanel(ctx: AdminContext, p: Places): Promise<string> {
  const until = new Date(Date.now() + 56 * DAY).toISOString();
  const [drafts, pending] = await Promise.all([
    must(
      ctx.db
        .from("gatherings")
        .select("venue_id, starts_at, gathering_triage(score)")
        .eq("status", "draft")
        .not("venue_id", "is", null)
        .gt("starts_at", new Date().toISOString())
        .lte("starts_at", until)
        .order("starts_at")
        .limit(1000),
    ),
    must(ctx.db.from("spot_suggestions").select("venue_id").eq("status", "pending")),
  ]);
  const pendingBy = new Map<string, number>();
  for (const s of pending as { venue_id: string }[]) pendingBy.set(s.venue_id, (pendingBy.get(s.venue_id) ?? 0) + 1);
  const need = new Map<string, { first: string; n: number }>();
  for (const d of drafts as any[]) {
    if (p.spots(d.venue_id) >= 3) continue;
    const ai = (Array.isArray(d.gathering_triage) ? d.gathering_triage[0] : d.gathering_triage)?.score ?? null;
    const final = p.rank(d.venue_id, ai).final;
    if (final === null || final < SCORE_THRESHOLD) continue;
    const cur = need.get(d.venue_id);
    need.set(d.venue_id, { first: cur?.first ?? d.starts_at, n: (cur?.n ?? 0) + 1 });
  }
  if (!need.size) return "";
  const rows = [...need]
    .map(([id, x]) => {
      const v = p.byId.get(id);
      const n = pendingBy.get(id) ?? 0;
      return `<tr><td><a href="/admin/venues/${e(id)}">${e(v?.name ?? id)}</a></td><td>${p.spots(id)}/3</td>
<td>${n ? `<strong>${n} to review</strong>` : `<span class="muted">none yet</span>`}</td>
<td>${x.n} · first ${e(formatLocal(x.first, p.tz(id)))}</td></tr>`;
    })
    .join("");
  return `<h2>Venues needing spots (${need.size})</h2>
<p class="muted">Fewer than 3 approved spots, with a draft scoring ${SCORE_THRESHOLD}+ in the next 8 weeks. Approve spots ahead of time.</p>
<table><tr><th>Venue</th><th>Approved</th><th>AI suggestions</th><th>Good drafts</th></tr>${rows}</table>`;
}

// Venues the importer created: confirm, or "this is actually …".
export async function newVenuesPanel(ctx: AdminContext, p: Places, backTo: string): Promise<string> {
  const rows = await must(ctx.db.from("venue_external_ids").select("venue_id, external_id").eq("needs_review", true));
  const ids = [...new Set((rows as { venue_id: string }[]).map((r) => r.venue_id))];
  if (!ids.length) return "";
  const html = ids
    .map((id) => {
      const v = p.byId.get(id);
      if (!v) return "";
      const near = p.venues
        .filter((o) => o.id !== id && o.latitude !== null && v.latitude !== null)
        .map((o) => ({ o, km: distanceKm(v.latitude!, v.longitude!, o.latitude!, o.longitude!) }))
        .filter((x) => x.km <= NEAR_KM)
        .sort((a, b) => a.km - b.km);
      const guess = near[0]?.o.id;
      const options = p.venues
        .filter((o) => o.id !== id)
        .map((o) => `<option value="${e(o.id)}"${o.id === guess ? " selected" : ""}>${e(o.name)}</option>`)
        .join("");
      const km = p.rank(id, null).km;
      return `<tr><td><a href="/admin/venues/${e(id)}">${e(v.name)}</a><br><span class="muted">${e(v.address ?? "")}${km !== null ? ` · ${km.toFixed(1)} km from centre` : ""}</span>
${near.length ? `<br><span class="bad">Close to: ${near.map((x) => `${e(x.o.name)} (${Math.round(x.km * 1000)} m)`).join(", ")}</span>` : ""}</td>
<td>${postButton(`/admin/venues/${id}/confirm`, "Looks right", backTo, { cls: "plain" })}</td>
<td><form class="inline" method="post" action="/admin/venues/${e(id)}/merge" onsubmit="return confirm('Merge this venue into the one chosen? Its drafts, Ticketmaster ids and name move there, and it is deleted.')">
<input type="hidden" name="back" value="${e(backTo)}">This is actually <select name="into"><option value="">—</option>${options}</select> <button class="plain">Merge</button></form></td></tr>`;
    })
    .join("");
  return `<h2>New venues from Ticketmaster — check them (${ids.length})</h2>
<p class="muted">Is it a venue you already have under another name (e.g. Budweiser Stage → RBC Amphitheatre)? Merge it; the old name becomes an alias.</p>
<table>${html}</table>`;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

// POST /admin/import/run
export const runNow: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const outcome = await runImport(ctx.env, {
    trigger: "manual",
    actor: ctx.email,
    deadline: Date.now() + BUTTON_BUDGET_MS,
    spots: false,
  });
  return back(form, outcome.status === "ok" ? { ok: outcome.message } : { err: outcome.message });
};

// GET /admin/imports — the last 30 runs.
export const runsPage: AdminHandler = async (request, ctx) => {
  const runs = await must(ctx.db.from("import_runs").select("*").order("started_at", { ascending: false }).limit(30));
  const rows = runs
    .map((r: any) => {
      const a = applied(r.counts);
      const secs = r.finished_at ? Math.round((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000) : null;
      return `<tr><td>${e(formatLocal(r.started_at, TORONTO))}</td><td>${e(r.trigger)}<br><span class="muted">${e(r.actor)}</span></td>
<td class="${r.status === "ok" ? "good" : "bad"}">${e(r.status)}${secs !== null ? `<br><span class="muted">${secs}s</span>` : ""}</td>
<td>${r.counts?.fetched ?? "—"} fetched · ${r.counts?.kept ?? "—"} kept · ${skippedTotal(r.counts)} skipped<br>
new ${a.new ?? 0} · updated ${(a.updated ?? 0) + (a.restored ?? 0)} · dismissed ${a.dismissed ?? 0} · flagged ${a.flagged ?? 0} · new venues ${a.venues_created ?? 0}<br>
scored ${r.counts?.scored ?? 0}${r.counts?.unscored_left ? ` · ${r.counts.unscored_left} unscored` : ""}${r.counts?.spots_suggested ? ` · ${r.counts.spots_suggested} spots suggested` : ""}</td>
<td>${r.tm_calls}</td><td>$${Number(r.ai_cost_usd).toFixed(2)}</td><td class="bad">${e(r.error ?? "")}</td></tr>`;
    })
    .join("");
  const body = `<table><tr><th>Started</th><th>How</th><th>Status</th><th>Counts</th><th>TM calls</th><th>AI</th><th>Error</th></tr>
${rows || `<tr><td colspan="7">No runs yet.</td></tr>`}</table>`;
  return adminPage(request, ctx.email, "Import runs", body);
};

function flagAction(resolution: "applied" | "ignored", done: string): AdminHandler {
  return async (request, ctx) => {
    const form = await request.formData();
    const { error } = await ctx.db.rpc("admin_resolve_flag", { p_flag: ctx.params.id, p_resolution: resolution, p_actor: ctx.email });
    return back(form, error ? { err: error.message } : { ok: done });
  };
}

export const applyFlag = flagAction("applied", "New date applied; the spot poll moved with it");
export const ignoreFlag = flagAction("ignored", "Flag ignored");

const REASONS = ["cancelled", "postponed", "takedown", "other"];

// POST /admin/gatherings/:id/withdraw
export const withdrawGathering: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const reason = str(form, "reason");
  if (!REASONS.includes(reason)) return back(form, { err: "Choose a reason" });
  const note = str(form, "note").slice(0, 500);
  const { error } = await ctx.db.rpc("admin_withdraw_gathering", {
    p_gathering: ctx.params.id,
    p_reason: reason,
    p_note: note,
    p_actor: ctx.email,
  });
  return back(form, error ? { err: error.message } : { ok: "Withdrawn: only the people pinned to it can see it now" });
};

// POST /admin/gatherings/:id/unwithdraw
export const unwithdrawGathering: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const { error } = await ctx.db.rpc("admin_unwithdraw_gathering", { p_gathering: ctx.params.id, p_actor: ctx.email });
  return back(form, error ? { err: error.message } : { ok: "Back to published" });
};

export function withdrawForm(id: string, backTo: string): string {
  const options = [
    ["cancelled", "Cancelled"],
    ["postponed", "Postponed"],
    ["takedown", "Takedown request"],
    ["other", "Other"],
  ]
    .map(([v, l]) => `<option value="${v}">${l}</option>`)
    .join("");
  return `<form id="withdraw" method="post" action="/admin/gatherings/${e(id)}/withdraw" onsubmit="return confirm('Withdraw? It leaves every public list; pinned people see a short notice. Pins are kept. You can undo this.')">
<input type="hidden" name="back" value="${e(backTo)}"><fieldset><legend>Withdraw (works even with pins)</legend>
<label>Reason <select name="reason" required><option value="">—</option>${options}</select></label>
<label>Note (only you see it)<br><input name="note" maxlength="500" size="60"></label>
<button class="danger">Withdraw</button></fieldset></form>`;
}

export async function withdrawnNote(ctx: AdminContext, id: string, backTo: string): Promise<string> {
  const w = await must(ctx.db.from("gathering_withdrawals").select("reason, note, withdrawn_by, withdrawn_at").eq("gathering_id", id).maybeSingle());
  return `<p class="bad"><strong>Withdrawn</strong>${w ? `: ${e(w.reason)}${w.note ? ` — ${e(w.note)}` : ""} · by ${e(w.withdrawn_by)}, ${e(formatLocal(w.withdrawn_at, TORONTO))}` : ""}.
Only the people pinned to it can see it; they get a short notice. ${postButton(`/admin/gatherings/${id}/unwithdraw`, "Un-withdraw", backTo, { cls: "plain" })}</p>`;
}

// POST /admin/venues/:id/confirm
export const confirmVenue: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const { error } = await ctx.db.rpc("admin_confirm_venue", { p_venue: ctx.params.id, p_actor: ctx.email });
  return back(form, error ? { err: error.message } : { ok: "Venue confirmed" });
};

// POST /admin/venues/:id/merge
export const mergeVenue: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const into = str(form, "into");
  if (!UUID.test(into)) return back(form, { err: "Choose the venue it really is" });
  const { error } = await ctx.db.rpc("admin_merge_venues", { p_from: ctx.params.id, p_into: into, p_actor: ctx.email });
  if (error) return back(form, { err: error.message });
  return back(null, { ok: "Merged: drafts, Ticketmaster ids and the old name moved here" }, `/admin/venues/${into}`);
};

// POST /admin/venues/:id/suggest — "Suggest spots now" / "Suggest again".
export const suggestSpotsNow: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const outcome = await suggestForOneVenue(ctx.env, ctx.params.id!, ctx.email);
  return back(form, outcome.status === "ok" ? { ok: outcome.message } : { err: outcome.message });
};
