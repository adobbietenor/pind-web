// The Publishing panel (Phase 2 M2.2, spec.md §8): the loop's settings, the next
// three weeks against the target, every choice the last run made in one line each,
// and the weekly adjust's log.
//
// The skipped lines matter as much as the published ones. A draft passed over
// because it had been public before has to say so here — "skipped, previously
// published" — rather than simply not appearing, because a rule whose refusals are
// invisible is a rule Alex cannot tell is working (Alex, M2.2).
import { loadCity } from "../import/run";
import { addWeeks, weekStartOf, type PublishSettings } from "../publish/plan";
import { loadSettings, SETTINGS_SELECT, toSettings, type NumericSetting } from "../publish/run";
import type { AdminContext, AdminHandler } from "./context";
import { formatLocal } from "./time";
import { adminPage, back, e, here, must, postButton, str } from "./ui";

const CITY = "toronto";
const WEEKS_AHEAD = 3;
const DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// The next three weeks, as they stand right now
// ---------------------------------------------------------------------------

interface WeekRow {
  weekStart: string;
  published: number;
  target: number;
}

async function weeksNow(ctx: AdminContext, settings: PublishSettings, tz: string): Promise<WeekRow[]> {
  const first = weekStartOf(new Date().toISOString(), tz);
  const starts = Array.from({ length: WEEKS_AHEAD }, (_, i) => addWeeks(first, i));
  const from = new Date(Date.parse(`${starts[0]}T00:00:00Z`) - DAY).toISOString();
  const to = new Date(Date.parse(`${addWeeks(starts[starts.length - 1]!, 1)}T00:00:00Z`) + DAY).toISOString();
  const live = await must(
    ctx.db
      .from("gatherings")
      .select("id, starts_at, venues(city)")
      .eq("status", "published")
      .eq("is_seed", false)
      .gte("starts_at", from)
      .lte("starts_at", to),
  );
  const counts = new Map(starts.map((s) => [s, 0]));
  for (const g of live as any[]) {
    const city = Array.isArray(g.venues) ? g.venues[0]?.city : g.venues?.city;
    if (city !== CITY) continue;
    const w = weekStartOf(g.starts_at, tz);
    if (counts.has(w)) counts.set(w, counts.get(w)! + 1);
  }
  return starts.map((weekStart) => ({ weekStart, published: counts.get(weekStart)!, target: settings.targetWeekly }));
}

function weekLabel(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00Z`);
  const end = new Date(d.getTime() + 6 * DAY);
  const m = (x: Date) => ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][x.getUTCMonth()];
  return `${d.getUTCDate()} ${m(d)} – ${end.getUTCDate()} ${m(end)}`;
}

// A short panel for the draft queue: where each of the next three weeks stands.
export async function publishingPanel(ctx: AdminContext): Promise<string> {
  const [settings, city] = await Promise.all([loadSettings(ctx.db, CITY), loadCity(ctx.db, CITY)]);
  const weeks = await weeksNow(ctx, settings, city.timezone);
  const cells = weeks
    .map((w) => {
      const short = w.target - w.published;
      const state =
        short > 0
          ? `<span class="bad">${w.published} of ${w.target}</span>`
          : `<span class="good">${w.published} of ${w.target}</span>`;
      return `<td>${e(weekLabel(w.weekStart))}<br>${state}</td>`;
    })
    .join("");
  return `<fieldset><legend>Publishing</legend>
<table><tr>${cells}</tr></table>
<p class="muted">The nightly run fills each week to the target of ${settings.targetWeekly}${settings.adaptive ? "" : " (adaptive off)"}.
<a href="/admin/publishing">Publishing panel</a> — every choice, and why.</p></fieldset>`;
}

// ---------------------------------------------------------------------------
// Marks, in the draft queue and on the gathering page
// ---------------------------------------------------------------------------

// Two buttons and a state. Deliberately not a dropdown: this is the control that
// decides what strangers see, and it should take one tap and read back at a glance.
export function markCell(g: { id: string; publish_mark: string | null }, backTo: string): string {
  const mark = g.publish_mark;
  const set = (value: string, label: string, cls: string) =>
    postButton(`/admin/gatherings/${g.id}/mark`, label, backTo, { fields: { mark: value }, cls });
  if (mark === "publish") {
    return `<strong class="good">publish first</strong><br>${set("", "Clear", "plain")}`;
  }
  if (mark === "never") {
    return `<strong class="bad">never</strong><br>${set("", "Clear", "plain")}`;
  }
  return `${set("publish", "Publish first", "plain")}${set("never", "Never", "plain")}`;
}

export const setPublishMark: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const mark = str(form, "mark");
  const { error } = await ctx.db.rpc("admin_set_publish_mark", {
    p_gathering: ctx.params.id,
    p_mark: mark,
    p_actor: ctx.email,
  });
  const done =
    mark === "publish"
      ? "Marked: the next run publishes it first, whatever it scores"
      : mark === "never"
        ? "Marked never: no run will publish it. You still can."
        : "Mark cleared";
  return back(form, error ? { err: error.message } : { ok: done });
};

// ---------------------------------------------------------------------------
// Promotions — "we posted this", recorded where the share link is copied
//
// Seeded against organic is the number that says whether the city populates itself
// without us posting, so it cannot be guessed from publish_mark: the two part
// company the first time the publisher picks a good game and someone posts it
// anyway. It is ticked by whoever posts it, in the same minute (Alex, M2.2).
// ---------------------------------------------------------------------------

export async function promotionPanel(ctx: AdminContext, gatheringId: string, slug: string | null, backTo: string): Promise<string> {
  if (!slug) return "";
  const rows = await must(
    ctx.db
      .from("gathering_promotions")
      .select("id, channel, note, promoted_by, promoted_at")
      .eq("gathering_id", gatheringId)
      .order("promoted_at", { ascending: false }),
  );
  const list = (rows as any[])
    .map(
      (r) =>
        `<li><strong>${e(r.channel)}</strong>${r.note ? ` — ${e(r.note)}` : ""} · ${e(r.promoted_by)}, ${e(formatLocal(r.promoted_at, "America/Toronto"))}
 ${postButton(`/admin/promotions/${r.id}/delete`, "Undo", backTo, { cls: "plain", confirm: "Remove this? Without it the gathering counts as organic." })}</li>`,
    )
    .join("");
  return `<fieldset><legend>Where we posted it</legend>
<form class="inline" method="post" action="/admin/gatherings/${e(gatheringId)}/promote">
<input type="hidden" name="back" value="${e(backTo)}">
<label style="display:inline">We posted this on <input name="channel" required maxlength="60" size="18" placeholder="r/leafs"></label>
<input name="note" maxlength="200" size="24" placeholder="note (optional)">
<button class="plain">We posted this</button></form>
<p class="muted">Tick it as you post, not afterwards. A gathering with nothing here counts as organic, so a forgotten tick
makes organic reach look better than it is — never worse.</p>
${list ? `<ul>${list}</ul>` : `<p class="muted">Not posted anywhere yet.</p>`}</fieldset>`;
}

// One line, for a list: the channels, and a field to add another.
export function promoteInline(gatheringId: string, channels: string[], backTo: string): string {
  const posted = channels.length ? `<span class="good">${channels.map((c) => e(c)).join(", ")}</span><br>` : "";
  return `${posted}<form class="inline" method="post" action="/admin/gatherings/${e(gatheringId)}/promote">
<input type="hidden" name="back" value="${e(backTo)}"><input name="channel" required maxlength="60" size="10" placeholder="r/leafs">
<button class="plain">Posted</button></form>`;
}

export const recordPromotion: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const { error } = await ctx.db.rpc("admin_record_promotion", {
    p_gathering: ctx.params.id,
    p_channel: str(form, "channel"),
    p_note: str(form, "note") || null,
    p_actor: ctx.email,
  });
  return back(form, error ? { err: error.message } : { ok: "Recorded: it counts as seeded from now on" });
};

export const deletePromotion: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const { error } = await ctx.db.rpc("admin_delete_promotion", { p_promotion: ctx.params.id, p_actor: ctx.email });
  return back(form, error ? { err: error.message } : { ok: "Removed" });
};

// ---------------------------------------------------------------------------
// GET /admin/publishing
// ---------------------------------------------------------------------------

// Reasons Alex reads every time, and reasons that are just the queue being the
// queue. The second kind folds away: three hundred lines of "below the floor" would
// bury the four lines that say something.
const ROUTINE = new Set(["below_floor", "unscored", "no_venue"]);

export const publishingPage: AdminHandler = async (request, ctx) => {
  const { db } = ctx;
  const backTo = here(request);
  const [row, city] = await Promise.all([
    must(db.from("cities").select(`slug, name, ${SETTINGS_SELECT}`).eq("slug", CITY).single()),
    loadCity(db, CITY),
  ]);
  const settings = toSettings(row);
  const weeks = await weeksNow(ctx, settings, city.timezone);

  const [lastRun, adjusts] = await Promise.all([
    must(db.from("publish_decisions").select("run_id, at").eq("city", CITY).order("at", { ascending: false }).limit(1)),
    must(db.from("publish_target_log").select("*").eq("city", CITY).order("at", { ascending: false }).limit(12)),
  ]);

  const runId = (lastRun as any[])[0]?.run_id ?? null;
  const decisions =
    runId === null
      ? []
      : await must(
          db
            .from("publish_decisions")
            .select("*")
            .eq("city", CITY)
            .eq("run_id", runId)
            .order("week_start")
            .order("outcome")
            .order("rank", { nullsFirst: false }),
        );

  const weekRows = weeks
    .map((w) => {
      const short = w.target - w.published;
      return `<tr><td>${e(weekLabel(w.weekStart))}</td><td>${w.published}</td><td>${w.target}</td>
<td class="${short > 0 ? "bad" : "good"}">${short > 0 ? `short by ${short}` : "full"}</td></tr>`;
    })
    .join("");

  const body = `
${settingsForm(row, settings, backTo)}
<h2>The next three weeks</h2>
<table><tr><th>Week</th><th>Published</th><th>Target</th><th></th></tr>${weekRows}</table>
<p class="muted">Published, live and not a seed row, counted by the week the gathering <em>starts</em> in — Toronto's weeks, Monday to Sunday.
A withdrawn gathering is not published, so its week is genuinely short and the next run refills it.</p>
${decisionsSection(decisions as any[], (lastRun as any[])[0]?.at ?? null, city.timezone)}
${adjustSection(adjusts as any[], settings)}`;
  return adminPage(request, ctx.email, "Publishing", body);
};

function decisionsSection(rows: any[], at: string | null, tz: string): string {
  if (!rows.length) {
    return `<h2>The last run</h2><p class="muted">No run has filled a week yet. The nightly import does it; "Run import now" on the draft queue does it too.</p>`;
  }
  const byWeek = new Map<string, any[]>();
  for (const d of rows) byWeek.set(d.week_start, [...(byWeek.get(d.week_start) ?? []), d]);

  const line = (d: any) => {
    const score = d.final_score === null ? "—" : `<strong>${d.final_score}</strong>`;
    const cls = d.outcome === "published" ? "good" : ROUTINE.has(d.reason_code) ? "muted" : "";
    return `<tr><td>${e(formatLocal(d.starts_at, tz))}</td>
<td><a href="/admin/gatherings/${e(d.gathering_id ?? "")}">${e(d.gathering_name)}</a>${d.venue_name ? `<br><span class="muted">${e(d.venue_name)}</span>` : ""}</td>
<td>${score}</td><td class="${cls}">${e(d.reason)}</td></tr>`;
  };

  const sections = [...byWeek]
    .map(([week, list]) => {
      const published = list.filter((d) => d.outcome === "published");
      const notable = list.filter((d) => d.outcome !== "published" && !ROUTINE.has(d.reason_code));
      const routine = list.filter((d) => d.outcome !== "published" && ROUTINE.has(d.reason_code));
      const head = `<tr><th>When</th><th>Gathering</th><th>Score</th><th>Why</th></tr>`;
      const shown = [...published, ...notable];
      return `<h3>Week of ${e(weekLabel(week))} <span class="muted">(${published.length} published, ${list.length} considered)</span></h3>
${shown.length ? `<table>${head}${shown.map(line).join("")}</table>` : `<p class="muted">Nothing was published or passed over for a reason worth reading.</p>`}
${routine.length ? `<details><summary class="muted">${routine.length} more: below the floor, unscored, or no venue yet</summary><table>${head}${routine.map(line).join("")}</table></details>` : ""}`;
    })
    .join("");

  return `<h2>The last run${at ? ` — ${e(formatLocal(at, tz))}` : ""}</h2>
<p class="muted">Every draft inside the lead window, published or not, with the reason in one line. Drafts outside the window are not candidates and are not listed.</p>
${sections}`;
}

function adjustSection(rows: any[], s: PublishSettings): string {
  const state = s.adaptive
    ? `<span class="good">on</span>`
    : `<span class="muted">off until M4.5 — it runs and logs every Monday, and changes nothing</span>`;
  if (!rows.length) {
    return `<h2>The weekly adjust</h2><p>Adaptive: ${state}</p>
<p class="muted">Nothing logged yet. It runs on the first Monday run after this milestone lands.</p>`;
  }
  const pct = (n: number | null) => (n === null ? "—" : n.toFixed(2));
  const num = (n: number | null) => (n === null ? "—" : String(n));
  const body = rows
    .map(
      (r) => `<tr><td>${e(weekLabel(r.week_start))}</td>
<td class="${r.decision === "grow" ? "good" : r.decision === "shrink" ? "bad" : ""}">${e(r.decision)}${r.applied ? "" : ` <span class="muted">(not applied)</span>`}</td>
<td>${r.from_target} → ${r.to_target}</td>
<td>${r.qualifying} · ${pct(r.reach_rate)} · ${num(r.median_pins)}</td>
<td>${r.seeded_qualifying} · ${pct(r.seeded_reach_rate)} · ${num(r.seeded_median_pins)}</td>
<td>${r.organic_qualifying} · ${pct(r.organic_reach_rate)} · ${num(r.organic_median_pins)}</td>
<td>${e(r.reason)}<details><summary class="muted">the ${(r.inputs ?? []).length} gatherings it counted</summary>
<table><tr><th>Gathering</th><th>Pinned</th><th>Open</th><th>Reached 5</th><th>Posted</th></tr>
${(r.inputs ?? [])
  .map(
    (i: any) =>
      `<tr><td>${e(i.name)}</td><td>${i.pinned}</td><td>${i.open_to_meeting}</td><td>${i.reached ? "yes" : "no"}</td><td>${i.promoted ? "seeded" : "organic"}</td></tr>`,
  )
  .join("")}</table></details></td></tr>`,
    )
    .join("");
  return `<h2>The weekly adjust</h2><p>Adaptive: ${state}</p>
<table><tr><th>Week</th><th>Decision</th><th>Target</th><th>All (n · reach · median)</th><th>Seeded</th><th>Organic</th><th>Why</th></tr>${body}</table>
<p class="muted">Seeded means somebody recorded posting it. Only the "all" column decides anything; the split is there to be read.
A gathering counts only if it ended in the last ${s.adjustWindowDays} days and was published at least ${s.adjustMinLeadDays} days before it started.</p>`;
}

// ---------------------------------------------------------------------------
// The settings form
// ---------------------------------------------------------------------------

const FIELDS: [NumericSetting, string, string][] = [
  ["publish_target_weekly", "Target per week", "How many gatherings should be published per week of start dates"],
  ["publish_min", "Floor", "The target never goes below this"],
  ["publish_max", "Ceiling", "The target never goes above this"],
  ["publish_lead_days_min", "Lead days, min", "Nothing is published nearer than this"],
  ["publish_lead_days_max", "Lead days, max", "Nothing is published further out than this; 21 covers the three weeks the run fills"],
  ["max_per_venue_per_week", "Per venue, per week", "A homestand does not fill the week"],
  ["max_category_share", "Category share", "No one kind of gathering takes more than this share of a week (0.40 = 40%). What makes a lower score floor safe"],
  ["min_per_category", "Category allowance", "Every kind may take this many before the share applies at all"],
  ["community_slots_weekly", "Community slots", "Held for a community gathering, and only when one is waiting (from M4.4)"],
  ["score_floor", "Score floor", "Final score below which nothing is auto-published; a draft you mark “publish” ignores it"],
  ["grow_reach", "Grow: reach rate", "Both this and the median must hold to grow"],
  ["grow_median_pins", "Grow: median pins", ""],
  ["shrink_reach", "Shrink: reach rate", "Below this, the target drops"],
  ["step_up", "Step up", "The most the target can rise in one week"],
  ["step_down", "Step down", "The most it can fall"],
  ["adjust_window_days", "Adjust window (days)", "Trailing window. Must stay under 30: pins are deleted 30 days after a gathering"],
  ["adjust_min_lead_days", "Adjust: min lead", "A gathering published later than this does not count as a failed one"],
  ["adjust_min_gatherings", "Adjust: min gatherings", "Fewer than this in the window and it holds"],
];

function settingsForm(row: Record<string, any>, s: PublishSettings, backTo: string): string {
  const inputs = FIELDS.map(
    ([key, label, hint]) =>
      `<label>${e(label)}<br><input name="${e(key)}" value="${e(row[key])}" size="8" inputmode="decimal" required>
${hint ? `<span class="muted"> ${e(hint)}</span>` : ""}</label>`,
  ).join("");
  return `<form method="post" action="/admin/publishing/settings"><input type="hidden" name="back" value="${e(backTo)}">
<fieldset><legend>Settings (on the Toronto row, never in code)</legend>
${inputs}
<label><input type="checkbox" name="adaptive"${s.adaptive ? " checked" : ""}> Adaptive: let the weekly adjust move the target
<span class="muted">Off until M4.5. While it is off the adjust still runs every Monday and still logs, so switching it on is this checkbox and nothing else.</span></label>
<button>Save settings</button></fieldset></form>`;
}

export const savePublishSettings: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const settings: Record<string, unknown> = { adaptive: form.get("adaptive") === "on" };
  for (const [key] of FIELDS) {
    const raw = str(form, key);
    const n = Number(raw);
    if (raw === "" || !Number.isFinite(n)) return back(form, { err: `${key.replace(/_/g, " ")} must be a number` });
    settings[key] = n;
  }
  const { error } = await ctx.db.rpc("admin_save_publish_settings", {
    p_city: CITY,
    p_settings: settings,
    p_actor: ctx.email,
  });
  return back(form, error ? { err: error.message } : { ok: "Settings saved; the next run uses them" });
};
