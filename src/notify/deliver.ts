// Delivering the notifications the database wrote (M3.3; spec A18, six).
//
// The rows are written by the acts themselves — a room's second person (#2), a message
// (#6) — never reconstructed here. This job only carries them, every minute:
//   * **push** to every phone the person registered (Expo), when there is one;
//   * **email** (Resend) otherwise, with a signed one-tap link that switches that kind
//     off (Alex: "off in one tap");
//   * **none** for someone with neither (an anonymous person has no email) — recorded,
//     not retried.
// A phone Expo says is gone is forgotten. A failure is recorded on the row and retried,
// at most three times; the row says what happened either way.
//
// **An unset credential reports itself once, as configuration** (CLAUDE.md): without
// EXPO_ACCESS_TOKEN a person with a phone is emailed instead, and the Configuration panel
// says the token is missing — never N identical push failures.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env";
import { serviceClient } from "../supabase";

import { channelFor, emailFor, stopUrl, type Channel, type Pending } from "./rules.ts";

const DEFAULT_FROM = "Pin'd <hello@pind.social>";

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

async function sendPush(env: Env, n: Pending): Promise<{ error: string | null; gone: string[] }> {
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.EXPO_ACCESS_TOKEN!.trim()}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(
      n.tokens.map((to) => ({ to, title: n.title, body: n.body, data: { path: n.path }, sound: "default" })),
    ),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return { error: `Expo answered ${res.status}: ${(await res.text()).slice(0, 200)}`, gone: [] };
  const out = (await res.json()) as { data?: { status: string; details?: { error?: string }; message?: string }[] };
  const tickets = out.data ?? [];
  const gone = tickets.flatMap((t, i) => (t.details?.error === "DeviceNotRegistered" ? [n.tokens[i]] : []));
  const delivered = tickets.some((t) => t.status === "ok");
  return { error: delivered ? null : tickets.map((t) => t.message ?? t.details?.error ?? t.status).join("; ") || "no ticket", gone };
}

async function sendEmail(env: Env, n: Pending): Promise<string | null> {
  const stop = await stopUrl(env.SESSION_SECRET!, n.person_id, n.kind);
  const mail = emailFor(n, stop);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.NOTIFY_FROM?.trim() || DEFAULT_FROM,
      to: [n.email!.trim()],
      subject: mail.subject,
      text: mail.text,
      // The mail client's own one-tap unsubscribe (RFC 8058): a POST, never a GET, so a
      // scanner opening links cannot switch anyone off.
      headers: { "List-Unsubscribe": `<${stop}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  return res.ok ? null : `Resend answered ${res.status}: ${(await res.text()).slice(0, 200)}`;
}

export async function deliverPending(env: Env, db: SupabaseClient = serviceClient(env)): Promise<{ message: string; sent: Record<Channel, number>; failed: number }> {
  const { data, error } = await db.rpc("admin_pending_notifications", { p_limit: 100 });
  if (error) throw new Error(`pending notifications: ${error.message}`);
  const can = {
    push: !!env.EXPO_ACCESS_TOKEN?.trim(),
    email: !!env.RESEND_API_KEY?.trim() && !!env.SESSION_SECRET?.trim(),
  };
  const sent: Record<Channel, number> = { push: 0, email: 0, none: 0 };
  let failed = 0;
  for (const n of (data ?? []) as Pending[]) {
    const channel = channelFor(n, can);
    let err: string | null = null;
    try {
      if (channel === "push") {
        const r = await sendPush(env, n);
        err = r.error;
        for (const t of r.gone) await db.rpc("admin_forget_device", { p_token: t });
      } else if (channel === "email") {
        err = await sendEmail(env, n);
      }
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    await db.rpc("admin_mark_notification", { p_id: n.id, p_channel: channel, p_error: err });
    if (err) failed++;
    else sent[channel]++;
  }
  return {
    message: `notifications: ${sent.push} push, ${sent.email} email, ${sent.none} with nowhere to go, ${failed} failed`,
    sent,
    failed,
  };
}
