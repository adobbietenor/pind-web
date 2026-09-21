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
import { checkSendingDomain, sendAlert, testAlert, type DomainCheck } from "../ops/alert";
import { alertsConfigured, checkSecrets, type SecretCheck, type SecretName } from "../ops/secrets";

import type { AdminContext, AdminHandler } from "./context";
import { webhookSection } from "./webhook";
import { expiringCredentials, type Expiry } from "../ops/expiry";
import { formatLocal } from "./time";
import { adminPage, back, e, here, must, postButton } from "./ui";

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
  PHOTO_WEBHOOK_SECRET: "PHOTO_WEBHOOK_SECRET",
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
  // Measured against the import's own schedule, not a fixed hour: due_at is the most
  // recent time it was meant to run, and it is only stale once the grace has also
  // passed without a success (Alex, M2.2).
  due_at: string | null;
  overdue_at: string | null;
  cron: string | null;
  grace_minutes: number | null;
  reported_scheduled_time: string | null;
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

// A set key proves nothing about deliverability. Resend accepts the key and refuses
// the send while the sending domain is unverified, which is the same silent failure
// as the credential that started all this (Alex, M2.2). So the state is checked live,
// and there is a button to prove the whole chain end to end rather than discovering
// it when a real alert does not arrive.
const DOMAIN_LABEL: Record<DomainCheck["state"], { cls: string; text: string }> = {
  verified: { cls: "good", text: "verified" },
  pending: { cls: "bad", text: "verifying — sends are refused until it finishes" },
  not_started: { cls: "bad", text: "verification never started — every send is refused" },
  failed: { cls: "bad", text: "verification failed — sends are refused" },
  unknown: { cls: "bad", text: "not a domain on this Resend account — sends are refused" },
  no_key: { cls: "bad", text: "no API key, so nothing can be sent" },
  unreachable: { cls: "bad", text: "could not ask Resend" },
};

async function alertsSection(ctx: AdminContext, alertsOn: boolean, backTo: string): Promise<string> {
  const test = postButton("/admin/config/test-alert", "Send a test alert", backTo, { cls: "plain" });
  if (!alertsOn) {
    return `<p class="bad"><strong>Alerts are off.</strong> A failed nightly run is recorded and shown here, and reaches nobody.
Set <code>RESEND_API_KEY</code> (a Worker secret) and <code>ALERT_EMAIL</code> to turn them on.</p>`;
  }
  const domain = await checkSendingDomain(ctx.env);
  const label = DOMAIN_LABEL[domain.state];
  const deliverable = domain.state === "verified";
  return `<p>Alerts go to <strong>${e(ctx.env.ALERT_EMAIL ?? "")}</strong>, at most one of a kind a day.</p>
<p>Sending domain <code>${e(domain.domain)}</code>: <span class="${label.cls}">${e(label.text)}</span>
<br><span class="muted">${e(domain.detail)}</span></p>
${deliverable ? "" : `<p class="bad"><strong>A set key is not a working channel.</strong> Until the domain verifies, every alert is refused by Resend —
the failure is recorded in the alert log, but no mail arrives.</p>`}
<p>${test} <span class="muted">Proves the whole chain: the key, the domain and the address. A test ignores the
once-a-day rule and does not use it up, so it can never silence a real alert.</span></p>`;
}

export const sendTestAlert: AdminHandler = async (request, ctx) => {
  const form = await request.formData();
  const { subject, body } = testAlert();
  const outcome = await sendAlert(ctx.env, ctx.db, "test", subject, body);
  return back(
    form,
    outcome.sent
      ? { ok: `Test alert ${outcome.why}. If it does not arrive, the problem is past Resend — check spam, then the address.` }
      : { err: `Not sent: ${outcome.why}` },
  );
};

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

  const alerts = await alertsSection(ctx, alertsOn, here(request));
  const webhook = await webhookSection(ctx);
  // **A credential nothing can ask about.** Apple's client secret lives in Supabase
  // and lapses on a date; when it does, the web breaks and the app does not, so the
  // half that still works hides the half that stopped.
  const expiries = expiringCredentials(ctx.env);
  const EXPIRY_CLASS: Record<Expiry["state"], string> = {
    ok: "good",
    soon: "bad",
    lapsed: "bad",
    unrecorded: "bad",
    unreadable: "bad",
  };
  const expirySection = `<h2>Credentials that lapse</h2>
<table><tr><th>Setting</th><th>State</th><th>What stops</th></tr>
${expiries
  .map(
    (x) =>
      `<tr><td><code>${e(x.name)}</code></td><td class="${EXPIRY_CLASS[x.state]}">${e(x.says)}</td><td class="muted">${e(x.what)}</td></tr>`,
  )
  .join("")}</table>
<p class="muted">Recorded rather than asked, because nothing can ask: Apple refuses an expired secret in the middle of somebody's
sign-in, and only on the web. <code>scripts/apple-client-secret.ts</code> mints a new one and prints the date to put in
<code>wrangler.jsonc</code>.</p>`;

  const body = `
${summary}
<h2>The nightly import</h2>
<p>Last run: ${health.last_run_at ? `<strong>${e(formatLocal(health.last_run_at, TORONTO))}</strong> · ${e(health.last_run_status ?? "")}` : `<span class="bad">never</span>`}
${health.last_run_error ? `<br><span class="bad">${e(health.last_run_error)}</span>` : ""}</p>
<p>Last <em>successful</em> run: ${health.last_success_at ? `<strong>${e(formatLocal(health.last_success_at, TORONTO))}</strong> (${health.hours_since_success} hours ago)` : `<span class="bad">never</span>`}
· ${health.stale ? `<span class="bad">stale — the list is not refreshing</span>` : `<span class="good">healthy</span>`}</p>
<h3>The schedule, as the database knows it</h3>
<table>
<tr><td>Cron (from <code>wrangler.jsonc</code>)</td><td><code>${e(health.cron ?? "?")}</code></td></tr>
<tr><td>Last due</td><td>${health.due_at ? `${e(formatLocal(health.due_at, TORONTO))} <span class="muted">(${e(health.due_at.slice(11, 16))} UTC)</span>` : "—"}</td></tr>
<tr><td>Counted as missed after</td><td>${health.overdue_at ? `${e(formatLocal(health.overdue_at, TORONTO))} <span class="muted">(${health.grace_minutes} minutes' grace)</span>` : "—"}</td></tr>
<tr><td>Last fired by Cloudflare</td><td>${health.reported_scheduled_time ? `${e(formatLocal(health.reported_scheduled_time, TORONTO))} <span class="muted">(${e(health.reported_scheduled_time.slice(11, 16))} UTC — reported by the run itself)</span>` : `<span class="muted">not yet reported — the next scheduled run records it</span>`}</td></tr>
</table>
<p class="muted">Two clocks watch this, on purpose. Cloudflare's cron runs the import; a pg_cron job in Postgres checks
<em>every hour</em> whether the run that was due has succeeded, and writes a failed run when its grace has passed without one.
The watchdog has no schedule of its own to drift out of step with the import's — it measures against the cron above, and the
Worker overwrites that line with the real expression and fire time on every scheduled run. So a changed cron, a daylight-saving
shift, or a wrong assumption about which timezone cron triggers use moves the threshold instead of raising a false alarm.
The second clock is there because a Worker cannot report its own cron being dead.</p>
${alerts}
${webhook}
${expirySection}
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
