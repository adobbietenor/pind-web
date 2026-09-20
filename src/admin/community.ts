// /admin/community — is that run club still a run club? (M2.3b.)
//
// 28 hand-entered series have produced 188 published dated occurrences, and until this
// page existed nothing re-checked any of them. A defunct run club on the site is worse
// than a thin list, and the failure arrives *after* publication, which is why it needs
// a surface of its own rather than a line on the draft queue.
//
// Two things this page is careful about:
//   * **"we cannot tell" and "the page no longer mentions it" are different sentences**
//     (Alex). No evidence is not evidence, and a page that times out must never read
//     as a gathering that has stopped. The wording comes from series.ts so it cannot
//     drift apart per surface.
//   * **a flag Alex cannot clear becomes a flag he stops reading** (Alex), so "I looked,
//     leave it" is a button that settles the series, records who and when, and shows
//     what he wrote next to it.
//
// This is also where M4.4's Community tab starts: a source list with a row per series,
// its page, and what that page last said.

import { needsAlex, runningOut, RUNNING_OUT_DAYS, saysWhat, stateOf, type SeriesRow } from "../community/series";
import { CHECKER, runSeriesChecks } from "../community/run";
import type { AdminHandler } from "./context";
import { formatLocal } from "./time";
import { adminPage, back, e, here, must, postButton, str } from "./ui";

const TZ = "America/Toronto";

const ago = (iso: string | null): string => {
  if (!iso) return "never";
  const hours = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

export const communityPage: AdminHandler = async (request, ctx) => {
  const backTo = here(request);
  const [series, runs, city] = await Promise.all([
    must(ctx.db.from("community_series").select("*").order("label")),
    must(ctx.db.from("community_check_runs").select("*").order("started_at", { ascending: false }).limit(5)),
    must(ctx.db.from("cities").select("slug, community_weeks").eq("slug", "toronto").maybeSingle()),
  ]);

  // The occurrences behind each series: how many are still to come, and how far the
  // dates run. The second number is the one the generator's cap makes interesting.
  const upcoming = await must(
    ctx.db
      .from("gatherings")
      .select("series_id, starts_at, slug, withdrawn_at")
      .not("series_id", "is", null)
      .gte("starts_at", new Date().toISOString())
      .order("starts_at")
      .limit(2000),
  );
  const perSeries = new Map<string, { live: number; drafts: number; last: string | null }>();
  for (const g of upcoming as any[]) {
    const at = perSeries.get(g.series_id) ?? { live: 0, drafts: 0, last: null };
    if (g.slug && !g.withdrawn_at) at.live += 1;
    else if (!g.slug) at.drafts += 1;
    at.last = g.starts_at.slice(0, 10);
    perSeries.set(g.series_id, at);
  }

  const today = new Date().toISOString().slice(0, 10);
  const rows = (series as SeriesRow[]).map((s) => {
    const state = stateOf(s);
    const counts = perSeries.get(s.id) ?? { live: 0, drafts: 0, last: null };
    const badge =
      state === "doubtful"
        ? `<span class="bad">needs a look</span>`
        : state === "unverifiable"
          ? `<span class="muted">cannot check</span>`
          : state === "settled"
            ? `<span class="good">checked by hand</span>`
            : state === "confirmed"
              ? `<span class="good">on its page</span>`
              : `<span class="muted">not read yet</span>`;
    const out = runningOut(counts.last, today);
    return `<tr>
<td><strong>${e(s.label)}</strong><br><a href="${e(s.url)}" target="_blank" rel="noreferrer noopener">${e(new URL(s.url).host)}</a></td>
<td>${badge}<br><span class="muted">read ${e(ago(s.last_checked_at))}</span></td>
<td class="muted">${e(saysWhat(s))}${s.last_note ? `<br><em>${e(s.last_note)}</em>` : ""}</td>
<td>${counts.live} published${counts.drafts ? `, ${counts.drafts} draft` : ""}<br>
${counts.last ? `<span class="${out ? "bad" : "muted"}">dates to ${e(counts.last)}${out ? ` — under ${RUNNING_OUT_DAYS} days left` : ""}</span>` : `<span class="bad">no upcoming dates</span>`}</td>
<td>${
      needsAlex(s)
        ? postButton(`/admin/community/${s.id}/settle`, "I looked, leave it", backTo, { cls: "plain" }) +
          `<br><span class="muted">or withdraw its occurrences from the gathering pages</span>`
        : ""
    }</td></tr>`;
  });

  const doubtful = (series as SeriesRow[]).filter(needsAlex);
  const cannot = (series as SeriesRow[]).filter((s) => stateOf(s) === "unverifiable");
  const outOf = (series as SeriesRow[]).filter((s) => runningOut(perSeries.get(s.id)?.last ?? null, today));

  // Three banners, three different sentences, deliberately. The middle one is the one
  // that must never read like the first.
  const banners =
    (doubtful.length
      ? `<p class="bad"><strong>${doubtful.length} series ${doubtful.length === 1 ? "has" : "have"} stopped appearing on ${
          doubtful.length === 1 ? "its" : "their"
        } own page.</strong> Nothing has been withdrawn — a machine never withdraws a published gathering, and unpublishing would be worse, because the slug is already minted and no run could bring it back. Read the page, then either withdraw the occurrences or say you looked.</p>`
      : "") +
    (cannot.length
      ? `<p class="muted"><strong>${cannot.length} series cannot be checked from ${
          cannot.length === 1 ? "its" : "their"
        } page.</strong> That is not the same as ${cannot.length === 1 ? "it having" : "them having"} stopped: the page times out, blocks us, or simply does not say. Nothing is being claimed about ${
          cannot.length === 1 ? "it" : "them"
        } either way.</p>`
      : "") +
    (outOf.length
      ? `<p class="bad">${outOf.length} series ${outOf.length === 1 ? "has" : "have"} fewer than ${RUNNING_OUT_DAYS} days of dates left. The generator creates ${
          (city as any)?.community_weeks ?? 8
        } weeks at a time, so they need topping up — a cap without a top-up is a decay mechanism.</p>`
      : "");

  // **The half of "a dead clock needs a second clock" that this page can carry.** The
  // import's watchdog is a pg_cron job in Postgres, because a Worker cannot report its
  // own cron being dead (Alex, M2.2) — and it watches the import, not this. Generalising
  // it to a second job is a refactor of that machinery rather than a copy of it, so for
  // now this is the half that answers "is it still running" to somebody who looks. The
  // difference in urgency is real and worth stating: a missed import means the city's
  // list stops refreshing, while a missed check means a series is re-read a few days
  // late, which changes nothing a visitor sees.
  const lastOk = (runs as any[]).find((r) => r.status === "ok" || r.status === "partial");
  const staleHours = lastOk ? (Date.now() - Date.parse(lastOk.started_at)) / 3_600_000 : null;
  const stale =
    staleHours === null
      ? `<p class="bad">No liveness run has ever finished. Nothing is being checked.</p>`
      : staleHours > 48
        ? `<p class="bad">No liveness run has finished in ${Math.round(staleHours)} hours, and one is due daily at 13:00 UTC. Nothing is being checked in the meantime.</p>`
        : "";

  const runRows = (runs as any[])
    .map(
      (r) =>
        `<tr><td>${e(formatLocal(r.started_at, TZ))}</td><td>${e(r.trigger)}</td><td class="${
          r.status === "ok" ? "good" : r.status === "running" ? "muted" : "bad"
        }">${e(r.status)}</td><td class="muted">${e(
          Object.entries(r.counts ?? {})
            .filter(([k, v]) => k !== "errors" && v)
            .map(([k, v]) => `${k} ${v}`)
            .join(" · "),
        )}</td><td>$${Number(r.ai_cost_usd).toFixed(2)}</td><td class="muted">${e(r.error ?? "")}</td></tr>`,
    )
    .join("");

  const body = `${stale}${banners}
<p class="muted">Each series' own page is read on its own schedule — the four least recently read, every day at 13:00 UTC, so all
${(series as SeriesRow[]).length} come round about weekly. Measured on the first full pass: <strong>$0.42 for all
${(series as SeriesRow[]).length}</strong>, about 1.5 cents a page, so six cents a day — inside the same daily AI cap as
everything else, which now counts this job's spend as well as the import's. It is never part of the nightly import: that must not wait on somebody else's website.</p>
<table><tr><th>Series</th><th>State</th><th>What its page said</th><th>Occurrences</th><th></th></tr>${rows.join("")}</table>
<h2>Runs</h2>
${postButton("/admin/community/check", "Check the next few now", backTo, {})}
<table><tr><th>Started</th><th>Trigger</th><th>Status</th><th>What it read</th><th>AI</th><th>Error</th></tr>${
    runRows || `<tr><td colspan="6" class="muted">No run yet.</td></tr>`
  }</table>`;
  return adminPage(request, ctx.email, "Community", body);
};

export const settleSeries: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const { error } = await ctx.db.rpc("admin_settle_series", {
    p_series: ctx.params.id,
    p_actor: ctx.email,
    p_note: str(form, "note") || null,
  });
  return back(form, error ? { err: error.message } : { ok: "Recorded that you looked. The doubt is cleared until its page changes again." });
};

export const runCheckNow: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const outcome = await runSeriesChecks(ctx.env, { trigger: "manual", actor: ctx.email || CHECKER });
  return back(form, outcome.status === "failed" || outcome.status === "busy" ? { err: outcome.message } : { ok: outcome.message });
};
