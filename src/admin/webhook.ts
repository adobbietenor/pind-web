// "Do the two halves of the shared secret match?" — answerable (Phase 3 M3.1).
//
// The photo-check webhook holds its secret in two places that will never show it to
// anyone: Supabase Vault, which the database trigger reads, and a Worker secret, which
// the route compares against. So a value that was set correctly on one side and
// mistyped on the other presents as **a 401 and nothing else**, which looks exactly
// like a missing credential, a wrong URL, or a Worker that is down. The M3.1 walk hit
// precisely that: Vault set, pg_net working, the request delivered, 401 back, and no
// way to tell which of four things was wrong.
//
// `admin_photo_webhook_health()` reports the database half's **fingerprint** — the
// first ten hex characters of its SHA-256. This computes the same thing for the
// Worker's half. Ten hex characters of a hash of a high-entropy secret reveal nothing
// anyone can work backwards from, and two of them side by side answer the only
// question being asked.
//
// **"Unset is a different state from broken" needed a third sibling:** *set on both
// sides and different*. It now has a name and a line on the Configuration panel.

import type { AdminContext } from "./context";
import { e } from "./ui";
import { compare, fingerprint, type WebhookHealth } from "./secretmatch.ts";

export async function webhookSection(ctx: AdminContext): Promise<string> {
  const { data, error } = await ctx.db.rpc("admin_photo_webhook_health");
  if (error) return `<p class="bad">Could not read the webhook's health: ${error.message}</p>`;
  const health = (Array.isArray(data) ? data[0] : data) as WebhookHealth | undefined;
  if (!health) return `<p class="bad">The webhook health check returned nothing.</p>`;

  const worker = await fingerprint(ctx.env.PHOTO_WEBHOOK_SECRET);
  const verdict = compare(health, worker);
  const cls = verdict.state === "match" ? "good" : "bad";
  // **The timestamp only moves when a photo is uploaded.** Saying so matters: an
  // unchanged time after a fix reads as a cached page, and it is not — it is the
  // honest answer that nothing has been tried since.
  const last = health.last_at
    ? `${health.last_status ?? "—"}${health.last_error ? ` · ${e(health.last_error)}` : ""}
${health.last_body ? `<br><code>${e(health.last_body)}</code>` : ""}
<br><span class="muted">at ${health.last_at.slice(0, 16).replace("T", " ")} UTC — this moves only when a photo is uploaded, so an unchanged time means nothing has been tried since, not that this page is stale.</span>`
    : `<span class="muted">nothing recent — pg_net keeps replies for a few hours only, so this is "not lately", not "never"</span>`;

  return `<h2>The photo check's webhook</h2>
<p class="${cls}"><strong>${verdict.text}</strong></p>
<table>
<tr><td>Vault <code>photo_check_url</code></td><td>${health.url ? `<code>${e(health.url)}</code>` : `<span class="bad">not set</span>`}</td></tr>
<tr><td>Vault <code>photo_check_secret</code></td><td>${health.secret_set ? `<span class="good">set</span> · <code>${e(health.secret_fingerprint ?? "")}</code>${health.secret_padded ? ` <span class="muted">(stored with whitespace round it — harmless now, both sides trim)</span>` : ""}` : `<span class="bad">not set</span>`}</td></tr>
<tr><td>Worker <code>PHOTO_WEBHOOK_SECRET</code></td><td>${worker ? `<span class="good">set</span> · <code>${worker}</code>` : `<span class="bad">not set</span>`}</td></tr>
<tr><td>Last reply from the Worker</td><td>${last}</td></tr>
<tr><td>Queued, not yet sent</td><td>${health.waiting}</td></tr>
</table>
<p class="muted">Those two codes are the first ten hex characters of each half's SHA-256, never the value.
They exist because a secret set correctly on one side and mistyped on the other looks exactly like a
missing one from outside — and until this line existed, nobody, including the Worker, could tell the
difference. A 401 here is the webhook working and being turned away, which is a different problem from
a photo nothing has looked at.</p>`;
}
