// Squads in the admin (M3.7, A15): the name check, counted rather than queued.
//
// Alex: "Check it with AI on the same loose standard as photos: reject only genuinely
// harmful, approve everything else. Automate it; do not build me an approval queue." So
// nothing here waits on a click. The page counts what the photos page counts — never
// checked, check failing, how long the oldest has waited — and shows recent refusals with
// the model's reason, so the standard can be watched. One action, "approve anyway", for a
// refusal that was wrong; logged (decisions, "M3.7: named squads, open to join").
//
// **A missing key reports itself once, here** (CLAUDE.md, Secrets): with no Anthropic key
// or no webhook secret, every name would sit unchecked and unlisted with nothing saying why.
import type { AdminHandler } from "./context";
import { adminPage, back, e, must, postButton, str } from "./ui";

const when = (t: string | null) =>
  t ? new Date(t).toLocaleString("en-CA", { timeZone: "America/Toronto", dateStyle: "medium", timeStyle: "short" }) : "";

// GET /admin/squads
export const squadsPage: AdminHandler = async (request, ctx) => {
  const [states, checks, listed] = await Promise.all([
    must(ctx.db.rpc("admin_squad_name_states")),
    must(
      ctx.db
        .from("squad_name_checks")
        .select("crew_id, name, outcome, reason, error, source, at")
        .in("outcome", ["rejected", "failed"])
        .gte("at", new Date(Date.now() - 7 * 86_400_000).toISOString())
        .order("at", { ascending: false })
        .limit(50),
    ),
    must(ctx.db.from("crews").select("id, name_status, state").eq("kind", "crew").eq("legacy", false).in("state", ["spot_set", "live"])),
  ]);
  const st = ((states as any[])[0] ?? { never_checked: 0, check_failing: 0, oldest_waiting: null, rejected_7d: 0 }) as {
    never_checked: number;
    check_failing: number;
    oldest_waiting: string | null;
    rejected_7d: number;
  };
  const open = listed as { id: string; name_status: string }[];
  const missing = [
    !ctx.env.ANTHROPIC_API_KEY?.trim() ? "ANTHROPIC_API_KEY is not set: no squad name can be checked, so none is listed." : null,
    !ctx.env.PHOTO_WEBHOOK_SECRET?.trim() ? "PHOTO_WEBHOOK_SECRET is not set: the database cannot ask for a check; the app's call and the hourly sweep still can." : null,
  ].filter(Boolean);
  const stillRefused = new Set(open.filter((c) => c.name_status === "rejected").map((c) => c.id));
  const rows = (checks as any[])
    .map(
      (k) => `<tr><td>${e(when(k.at))}</td><td>${e(k.name)}</td><td>${k.outcome === "rejected" ? `<span class="bad">refused</span>` : "check failed"}</td>
<td>${e(k.reason ?? k.error ?? "")}</td><td>${e(k.source)}</td>
<td>${k.outcome === "rejected" && k.crew_id && stillRefused.has(k.crew_id) ? postButton("/admin/squads/approve", "Approve anyway", "/admin/squads", { fields: { crew: k.crew_id }, cls: "plain", confirm: `List "${k.name}"? The check refused it.` }) : ""}</td></tr>`,
    )
    .join("");
  const body = `${missing.map((m) => `<p class="bad">${e(m!)}</p>`).join("")}
<h2>Names</h2>
<p>${open.filter((c) => c.name_status === "approved").length} open squad${open.length === 1 ? "" : "s"} listed · ${open.filter((c) => c.name_status === "pending").length} waiting for the check · ${open.filter((c) => c.name_status === "rejected").length} refused, waiting for a new name.</p>
${st.never_checked || st.check_failing
    ? `<p class="bad">${st.never_checked} never checked, ${st.check_failing} whose checks keep failing${st.oldest_waiting ? `; the oldest has waited since ${e(when(st.oldest_waiting))}` : ""}. Unlisted until checked: the hourly sweep retries them.</p>`
    : `<p class="good">No squad name is waiting on the check.</p>`}
<p class="muted">The check refuses only genuinely harmful names (sexual content, hate, threats, targeting someone, drugs) and approves everything else, the photos' standard. Nothing waits on this page: it is here to watch the standard. ${st.rejected_7d} refused in the last 7 days.</p>
<h2>Refused or failed, the last 7 days</h2>
<table><tr><th>When</th><th>Name</th><th>Outcome</th><th>Why</th><th>From</th><th></th></tr>
${rows || `<tr><td colspan="6">None.</td></tr>`}</table>`;
  return adminPage(request, ctx.email, "Squads", body);
};

// POST /admin/squads/approve
export const approveSquadName: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const { error } = await ctx.db.rpc("admin_approve_squad_name", { p_crew: str(form, "crew"), p_actor: ctx.email });
  return back(form, error ? { err: error.message } : { ok: "Name approved; the squad is listed" }, "/admin/squads");
};
