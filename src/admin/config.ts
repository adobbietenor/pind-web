// GET /admin/config — is this Worker actually configured? (Phase 2 M2.2.)
//
// Built the day the nightly import turned out to have been failing for two nights on
// a credential, with nothing saying so. The lesson is CLAUDE.md's own and this is the
// place it lands: unset is a different state from broken, and it belongs in front of
// whoever can fix it. One page answers "is every secret there", live, for every
// secret rather than the one that happened to break — because if one can go missing
// this way, so can the rest.
//
// No value is ever read, rendered or logged. Present, empty and absent are the three
// states, and "empty" is called out separately because a secret set to an empty
// string lists in `wrangler secret list` exactly like a real one and then fails at
// the first `.trim()`.
import { spotSuggestionsOn, type Env } from "../env";
import { alertsConfigured, checkSecrets, type SecretCheck, type SecretName } from "../ops/secrets";

import type { AdminContext, AdminHandler } from "./context";
import { formatLocal } from "./time";
import { adminPage, e, must } from "./ui";

// Compile-time: every name on this page is a real setting on Env. secrets.ts takes a
// plain record so the unit tests can load it under bare node, and this is what stops
// the two drifting — rename a setting in env.ts without renaming it there and the
// typecheck fails here rather than the panel quietly reporting a name nothing reads.
const _everyNameIsAnEnvSetting: Record<SecretName, keyof Env> = {
  SUPABASE_URL: "SUPABASE_URL",
  SUPABASE_SERVICE_ROLE_KEY: "SUPABASE_SERVICE_ROLE_KEY",
  SUPABASE_PUBLISHABLE_KEY: "SUPABASE_PUBLISHABLE_KEY",
  ACCESS_TEAM_DOMAIN: "ACCESS_TEAM_DOMAIN",
  ACCESS_AUD: "ACCESS_AUD",
  ADMIN_EMAILS: "ADMIN_EMAILS",
  TICKETMASTER_CONSUMER_KEY: "TICKETMASTER_CONSUMER_KEY",
  ANTHROPIC_API_KEY: "ANTHROPIC_API_KEY",
  MAPBOX_TOKEN: "MAPBOX_TOKEN",
  RESEND_API_KEY: "RESEND_API_KEY",
  ALERT_EMAIL: "ALERT_EMAIL",
  ALERT_FROM: "ALERT_FROM",
  SESSION_SECRET: "SESSION_SECRET",
};
void _everyNameIsAnEnvSetting;

const TORONTO = "America/Toronto";

export interface ImportHealth {
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_error: string | null;
  last_success_at: string | null;
  hours_since_success: number | null;
  stale: boolean;
}

export async function importHealth(ctx: AdminContext): Promise<ImportHealth> {
  return (await must(ctx.db.rpc("admin_import_health"))) as ImportHealth;
}

// The red line at the top of every admin page. Not tucked into the import panel on
// one page: a stale import means the public site has stopped refreshing, and that
// should be unmissable from wherever Alex happens to be standing.
export function stalenessBanner(health: ImportHealth, alertsOn: boolean): string {
  if (!health.stale) return "";
  const since =
    health.last_success_at === null
      ? "There has never been a successful run."
      : `The last successful run was ${e(formatLocal(health.last_success_at, TORONTO))} — ${health.hours_since_success} hours ago.`;
  const nights = health.hours_since_success === null ? null : Math.floor(health.hours_since_success / 24);
  return `<p class="flash err"><strong>The nightly import is not running.</strong> ${since}
${nights && nights >= 1 ? `That is ${nights} missed night${nights === 1 ? "" : "s"}. ` : ""}
No new gatherings are arriving, so the published list is not refreshing.
${health.last_run_error ? `<br>Last error: ${e(health.last_run_error)}` : ""}
<br><a href="/admin/config">Check the credentials</a> · <a href="/admin/imports">All runs</a>
${alertsOn ? "" : `<br><strong>Nothing emailed you about this.</strong> Set RESEND_API_KEY and ALERT_EMAIL and it will.`}</p>`;
}

const STATE_LABEL: Record<SecretCheck["state"], string> = {
  set: `<span class="good">set</span>`,
  empty: `<span class="bad">set but EMPTY</span>`,
  missing: `<span class="bad">not set</span>`,
};

export const configPage: AdminHandler = async (request, ctx) => {
  const checks = checkSecrets(ctx.env);
  const health = await importHealth(ctx);
  const alertsOn = alertsConfigured(ctx.env);
  const broken = checks.filter((c) => c.required && c.state !== "set");
  const off = checks.filter((c) => !c.required && c.state !== "set");

  const row = (c: SecretCheck) =>
    `<tr><td><code>${e(c.name)}</code></td><td>${STATE_LABEL[c.state]}</td>
<td>${c.required ? "required" : "optional"}</td><td class="muted">${e(c.what)}</td>
<td>${c.state === "set" ? "" : `<code>npx wrangler secret put ${e(c.name)}</code>`}</td></tr>`;

  const summary = broken.length
    ? `<p class="flash err"><strong>${broken.length} required setting${broken.length === 1 ? " is" : "s are"} not usable.</strong>
Until ${broken.length === 1 ? "it is" : "they are"} set, the parts named below do not work — silently, unless something here says so.</p>`
    : `<p class="flash ok">Every required setting is present.</p>`;

  const alerts = alertsOn
    ? `<p class="good">Alerts are on: a failed nightly run emails ${e(ctx.env.ALERT_EMAIL ?? "")}, at most once a day.</p>`
    : `<p class="bad"><strong>Alerts are off.</strong> A failed nightly run is recorded and shown here, and reaches nobody.
Set <code>RESEND_API_KEY</code> (a Worker secret) and <code>ALERT_EMAIL</code> to turn them on.</p>`;

  const body = `
${summary}
<h2>The nightly import</h2>
<p>Last run: ${health.last_run_at ? `<strong>${e(formatLocal(health.last_run_at, TORONTO))}</strong> · ${e(health.last_run_status ?? "")}` : `<span class="bad">never</span>`}
${health.last_run_error ? `<br><span class="bad">${e(health.last_run_error)}</span>` : ""}</p>
<p>Last <em>successful</em> run: ${health.last_success_at ? `<strong>${e(formatLocal(health.last_success_at, TORONTO))}</strong> (${health.hours_since_success} hours ago)` : `<span class="bad">never</span>`}
· ${health.stale ? `<span class="bad">stale — the list is not refreshing</span>` : `<span class="good">healthy</span>`}</p>
<p class="muted">Two clocks watch this, on purpose. Cloudflare's cron runs the import at 08:00 UTC; a pg_cron job in Postgres
checks at 09:00 UTC that it happened, and writes a failed run if it did not. The second one is there because a Worker
cannot report its own cron being dead.</p>
${alerts}
<h2>Settings and secrets</h2>
<p class="muted">Presence only — no value is read or shown here, and none is ever logged.
"Set but EMPTY" is its own state because an empty secret lists like a real one and fails at first use.</p>
<table><tr><th>Name</th><th>State</th><th></th><th>What it is for</th><th>To set it</th></tr>
${checks.map(row).join("")}</table>
${off.length ? `<p class="muted">${off.length} optional setting${off.length === 1 ? " is" : "s are"} unset; the features above are simply off.</p>` : ""}
<h2>Switches</h2>
<table>
<tr><td>AI spot suggestions</td><td>${spotSuggestionsOn(ctx.env) ? `<span class="good">on</span>` : `<span class="muted">off (M1.3b/M5.2)</span>`}</td></tr>
<tr><td>Daily AI cap</td><td>$${e(ctx.env.AI_DAILY_CAP_USD ?? "3")}</td></tr>
</table>`;
  return adminPage(request, ctx.email, "Configuration", body);
};
