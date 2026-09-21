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

export interface WebhookHealth {
  url_set: boolean;
  secret_set: boolean;
  secret_fingerprint: string | null;
  last_at: string | null;
  last_status: number | null;
  last_error: string | null;
  waiting: number;
}

export async function fingerprint(secret: string | undefined): Promise<string | null> {
  const value = secret ?? "";
  if (!value) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 10);
}

export type Verdict =
  | { state: "match"; text: string }
  | { state: "differ"; text: string }
  | { state: "missing"; text: string };

export function compare(db: WebhookHealth, worker: string | null): Verdict {
  if (!db.secret_set && !worker) {
    return { state: "missing", text: "Neither half is set, so the webhook is refused and photos are checked only when the app asks." };
  }
  if (!db.secret_set) {
    return { state: "missing", text: "The database half is missing. Create the Vault secret photo_check_secret." };
  }
  if (!worker) {
    return { state: "missing", text: "The Worker half is missing. Set it with npx wrangler secret put PHOTO_WEBHOOK_SECRET." };
  }
  if (db.secret_fingerprint === worker) {
    return { state: "match", text: "Both halves are the same value." };
  }
  return {
    state: "differ",
    text: "Both halves are set and they are DIFFERENT — which is why the webhook is answered 401. Set one to the other's value.",
  };
}

export async function webhookSection(ctx: AdminContext): Promise<string> {
  const { data, error } = await ctx.db.rpc("admin_photo_webhook_health");
  if (error) return `<p class="bad">Could not read the webhook's health: ${error.message}</p>`;
  const health = (Array.isArray(data) ? data[0] : data) as WebhookHealth | undefined;
  if (!health) return `<p class="bad">The webhook health check returned nothing.</p>`;

  const worker = await fingerprint(ctx.env.PHOTO_WEBHOOK_SECRET?.trim());
  const verdict = compare(health, worker);
  const cls = verdict.state === "match" ? "good" : "bad";
  const last = health.last_at
    ? `${health.last_status ?? "—"}${health.last_error ? ` · ${health.last_error}` : ""} <span class="muted">at ${health.last_at.slice(0, 16).replace("T", " ")} UTC</span>`
    : `<span class="muted">nothing recent — pg_net keeps replies for a few hours only, so this is "not lately", not "never"</span>`;

  return `<h2>The photo check's webhook</h2>
<p class="${cls}"><strong>${verdict.text}</strong></p>
<table>
<tr><td>Vault <code>photo_check_url</code></td><td>${health.url_set ? `<span class="good">set</span>` : `<span class="bad">not set</span>`}</td></tr>
<tr><td>Vault <code>photo_check_secret</code></td><td>${health.secret_set ? `<span class="good">set</span> · <code>${health.secret_fingerprint}</code>` : `<span class="bad">not set</span>`}</td></tr>
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
