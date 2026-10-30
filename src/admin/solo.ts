// 1-on-1 in the admin (M3.4, A28/A29): the brake, ending every plan, where it is offered,
// its numbers, and the switch per platform.
//
// **The brake is the safety control; the platform switch is cosmetic** (Alex, 14 Oct
// 2026). The brake is held by the database (can_see_solo reads it), so pulling it empties
// every 1-on-1 list for every client. Plans stand: ending them is its own button, "for
// 'something happened'", as Return to 1-on-1 is its own decision. Both are logged.
//
// **Counted, not silent** (Alex, 14 Oct 2026): a gathering whose venue has no active
// meeting spots offers no 1-on-1, and nothing on the gathering says so. If many do, 1-on-1
// is absent from most of the city and §7's groups-vs-solo comparison measures availability
// instead of preference (decisions, "M3.4: the 1-on-1 lifecycle"). So the count stands on
// Venues, beside the missing maps, and on this page above the numbers it qualifies.
import type { AdminHandler } from "./context";
import { adminPage, back, e, must, postButton, str } from "./ui";

export type Spotless = { gathering_id: string; name: string; slug: string | null; starts_at: string; venue_id: string | null; venue_name: string | null };

export function withoutSpotsPanel(rows: Spotless[]): string {
  if (!rows.length) return `<p class="good">Every upcoming published gathering has meeting spots, so 1-on-1 is offered at all of them.</p>`;
  const venues = new Map<string, string>();
  for (const r of rows) if (r.venue_id) venues.set(r.venue_id, r.venue_name ?? r.venue_id);
  const links = [...venues]
    .slice(0, 12)
    .map(([id, name]) => `<a href="/admin/venues/${e(id)}">${e(name)}</a>`)
    .join(", ");
  const noVenue = rows.filter((r) => !r.venue_id).length;
  return `<p class="bad">${rows.length} upcoming published gathering${rows.length === 1 ? " has" : "s have"} no active meeting spots, so 1-on-1 is not offered there.
If this is most of them, the groups-vs-1-on-1 numbers measure where 1-on-1 exists, not what people prefer. Add spots: ${links}${venues.size > 12 ? `, and ${venues.size - 12} more venues` : ""}${noVenue ? `${links ? "; " : ""}${noVenue} with no venue at all` : ""}.</p>`;
}

const COLUMNS: [string, string][] = [
  ["pinned", "Pinned"],
  ["open_to_meeting", "Open"],
  ["solo_opted", "1-on-1 on"],
  ["solo_women_only", "…women only"],
  ["proposals", "Proposals"],
  ["accepted", "Accepted"],
  ["declined", "Declined"],
  ["expired", "Expired"],
  ["withdrawn", "Withdrawn"],
  ["closed", "Closed"],
  ["plans", "Plans"],
  ["plans_dissolved", "Called off"],
  ["arrived", "I've arrived"],
  ["met", "Met"],
  ["also_in_a_group", "Also in a group"],
];

// GET /admin/solo
export const soloPage: AdminHandler = async (request, ctx) => {
  const [brake, switches, spotless, metrics] = await Promise.all([
    must(ctx.db.rpc("admin_solo_brake")),
    must(ctx.db.from("app_switches").select("name, ios, web, updated_at").eq("name", "solo")),
    must(ctx.db.rpc("admin_gatherings_without_spots")),
    must(ctx.db.rpc("admin_solo_metrics", {})),
  ]);
  const sw = (switches as any[])[0] ?? { ios: true, web: true, updated_at: null };
  const b = (brake as any[])[0] ?? { pulled: false, pulled_at: null };
  const when = (t: string | null) => (t ? new Date(t).toLocaleString("en-CA", { timeZone: "America/Toronto", dateStyle: "medium", timeStyle: "short" }) : "");
  const rows = (metrics as any[])
    .map(
      (m) => `<tr><td>${e(m.name)}<br><span class="muted">${e(new Date(m.starts_at).toLocaleString("en-CA", { timeZone: "America/Toronto", dateStyle: "medium", timeStyle: "short" }))}</span></td>
<td>${m.has_spots ? "" : `<span class="bad">no spots</span>`}</td>${COLUMNS.map(([k]) => `<td>${e(String(m[k] ?? 0))}</td>`).join("")}</tr>`,
    )
    .join("");
  const body = `<h2>The brake</h2>
${b.pulled
    ? `<p class="bad">Pulled since ${e(when(b.pulled_at))}. Nobody sees anyone in 1-on-1, and nobody can propose or accept. Plans already made stand.</p>`
    : `<p class="good">1-on-1 is on.</p>`}
<p class="muted">For "this looks wrong". Held by the database: pulled, every 1-on-1 list is empty for every client, proposals and accepts are refused, and a received proposal disappears until it lifts. Open proposals stay, so lifting it brings back those whose gathering has not started. A 1-on-1 proposal notification not yet sent is dropped, never sent later. Logged.</p>
${b.pulled
    ? postButton("/admin/solo/brake", "Lift the brake", "/admin/solo", { fields: { pulled: "off" }, confirm: "Lift the brake? 1-on-1 comes back everywhere." })
    : postButton("/admin/solo/brake", "Pull the brake", "/admin/solo", { fields: { pulled: "on" }, cls: "danger", confirm: "Pull the 1-on-1 brake? Every 1-on-1 list empties at once, everywhere." })}
<h2>End every 1-on-1 plan</h2>
<p class="muted">For "something happened". Ends every set or live 1-on-1 plan, at every gathering, and tells both people in each "Your 1-on-1 for … is off", with no reason. Cannot be undone. Separate from the brake: neither does the other. Logged with the count.</p>
${postButton("/admin/solo/end-all", "End every 1-on-1 plan", "/admin/solo", { cls: "danger", confirm: "End EVERY current 1-on-1 plan and tell both people in each? This cannot be undone." })}
<h2>Where it is offered</h2>
${withoutSpotsPanel(spotless as Spotless[])}
<h2>The switch, per platform (cosmetic)</h2>
<p class="muted">Hides the 1-on-1 switch and section in the app on one platform, for App Review pulling it from iOS while the web keeps it (decisions). <strong>Not a safety control</strong>: the database does not know which platform asks, so it hides screens and nothing else. For safety, use the brake. Logged.</p>
<form method="post" action="/admin/solo/switch"><input type="hidden" name="back" value="/admin/solo">
<label><input type="checkbox" name="ios" value="on"${sw.ios ? " checked" : ""}> iOS app</label>
<label><input type="checkbox" name="web" value="on"${sw.web ? " checked" : ""}> Web</label>
<button>Save</button></form>
<h2>The numbers, per gathering</h2>
<p class="muted">§7's 1-on-1 columns, measured on their own (counts only; nothing names a person). Read "1-on-1 on" against "Where it is offered" above. Groups' columns come with the metrics page (M4.5).</p>
<table><tr><th>Gathering</th><th></th>${COLUMNS.map(([, l]) => `<th>${e(l)}</th>`).join("")}</tr>
${rows || `<tr><td colspan="${COLUMNS.length + 2}">No published gatherings in the last eight weeks or the next four.</td></tr>`}</table>`;
  return adminPage(request, ctx.email, "1-on-1", body);
};

// POST /admin/solo/switch
export const setSoloSwitch: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const { error } = await ctx.db.rpc("admin_set_app_switch", {
    p_name: "solo",
    p_ios: str(form, "ios") === "on",
    p_web: str(form, "web") === "on",
    p_actor: ctx.email,
  });
  return back(form, error ? { err: error.message } : { ok: "1-on-1 switch saved" }, "/admin/solo");
};

// POST /admin/solo/brake
export const setSoloBrake: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const pulled = str(form, "pulled") === "on";
  const { data, error } = await ctx.db.rpc("admin_set_solo_brake", { p_pulled: pulled, p_actor: ctx.email });
  const dropped = Number(data ?? 0);
  const ok = (pulled ? "Brake pulled: 1-on-1 is off everywhere" : "Brake lifted: 1-on-1 is back") + (dropped ? `; ${dropped} proposal notification${dropped === 1 ? "" : "s"} dropped` : "");
  return back(form, error ? { err: error.message } : { ok }, "/admin/solo");
};

// POST /admin/solo/end-all
export const endAllSoloPlans: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const { data, error } = await ctx.db.rpc("admin_end_all_solo_plans", { p_actor: ctx.email });
  const n = Number(data ?? 0);
  return back(form, error ? { err: error.message } : { ok: `${n} 1-on-1 plan${n === 1 ? "" : "s"} ended; both people in each told` }, "/admin/solo");
};
