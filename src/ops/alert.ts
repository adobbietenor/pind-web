// Operational alerts (Phase 2 M2.2).
//
// M2.2's premise is that the city's list refreshes without anyone watching. A
// nightly run that fails silently therefore means the site quietly stops updating
// and starts looking abandoned — which is worse than the credential that caused it,
// because nothing says it is happening. The admin now shows it, but the admin only
// helps someone who opens the admin. This is the part that goes the other way.
//
// Deliberately narrow: one recipient, plain text, no template, no tracking, at most
// one alert of a kind per day. An alert channel that cries wolf gets muted, and a
// muted channel is the silent failure again with extra steps.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env";
import { alertsConfigured, domainOf } from "./secrets";

const DEFAULT_FROM = "Pin'd alerts <alerts@pind.social>";
// The cron has no request to take an origin from, and the admin is always here.
const SITE = "https://pind.social";

export type AlertKind = "import_failed" | "import_missing" | "credential_expiring" | "test";

export interface AlertResult {
  sent: boolean;
  why: string;
}

// One per kind per Toronto day, enforced in the database so two runs (or a run and
// the watchdog) cannot both send. The moderation log is the wrong home for this —
// it is a record of decisions about people — so alerts get their own small table.
async function alreadySentToday(db: SupabaseClient, kind: AlertKind): Promise<boolean> {
  const { data, error } = await db.rpc("admin_alert_already_sent_today", { p_kind: kind });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function sendAlert(
  env: Env,
  db: SupabaseClient,
  kind: AlertKind,
  subject: string,
  body: string,
): Promise<AlertResult> {
  // Unset is a different state from broken, and it is reported where it can be
  // fixed (the admin's Configuration panel) rather than here, once per run rather
  // than once per failure.
  if (!alertsConfigured(env)) {
    return { sent: false, why: "RESEND_API_KEY or ALERT_EMAIL is not set: the alert was recorded but not sent" };
  }
  // A test is exempt from the once-a-day rule and does not consume it: its whole
  // job is to be sendable on demand, and it must not silence a real alert later.
  if (kind !== "test" && (await alreadySentToday(db, kind))) {
    return { sent: false, why: "an alert of this kind already went today" };
  }

  const to = env.ALERT_EMAIL!.trim();
  const from = env.ALERT_FROM?.trim() || DEFAULT_FROM;
  let error: string | null = null;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text: body }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) error = `Resend answered ${res.status}: ${(await res.text()).slice(0, 200)}`;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  // Recorded either way: an alert that could not be sent is itself worth seeing in
  // the admin, and recording it before knowing the outcome would make a failed send
  // suppress tomorrow's.
  const { error: logError } = await db.rpc("admin_record_alert", {
    p_kind: kind,
    p_subject: subject,
    p_sent: error === null,
    p_error: error,
  });
  if (logError) console.error("could not record the alert:", logError.message);

  return error === null ? { sent: true, why: `sent to ${to}` } : { sent: false, why: error };
}

// Is the sending domain actually verified? A set API key proves nothing about
// deliverability: Resend accepts the key and refuses the send, which is the same
// class of silent failure as the credential that started all this (Alex, M2.2).
//
// Checked live rather than remembered, because the state changes on Resend's side
// with nothing to tell us.
export type DomainState = "verified" | "pending" | "not_started" | "failed" | "unknown" | "no_key" | "unreachable";

export interface DomainCheck {
  domain: string;
  state: DomainState;
  detail: string;
}

export async function checkSendingDomain(env: Env): Promise<DomainCheck> {
  const domain = domainOf(env.ALERT_FROM?.trim() || DEFAULT_FROM);
  const key = env.RESEND_API_KEY?.trim();
  if (!key) return { domain, state: "no_key", detail: "RESEND_API_KEY is not set, so nothing can be sent." };

  try {
    const res = await fetch("https://api.resend.com/domains", {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return { domain, state: "unreachable", detail: `Resend answered ${res.status} when asked about domains.` };
    }
    const body = (await res.json()) as { data?: { name?: string; status?: string }[] };
    const match = (body.data ?? []).find((d) => d.name?.toLowerCase() === domain);
    if (!match) {
      return { domain, state: "unknown", detail: `Resend has no domain called ${domain}. Mail from it will be refused.` };
    }
    const status = (match.status ?? "").toLowerCase();
    if (status === "verified") return { domain, state: "verified", detail: "Verified: mail from this domain is deliverable." };
    if (status.includes("pending")) return { domain, state: "pending", detail: "Verification is in progress. Until it finishes, sends are refused." };
    if (status.includes("not_started")) return { domain, state: "not_started", detail: "Verification has never been started, so every send is refused." };
    return { domain, state: "failed", detail: `Resend reports the domain as "${match.status}". Sends are refused.` };
  } catch (err) {
    return { domain, state: "unreachable", detail: err instanceof Error ? err.message : String(err) };
  }
}

export function testAlert(): { subject: string; body: string } {
  return {
    subject: "Pin'd: test alert",
    body: [
      "This is a test, sent from the admin's Configuration page.",
      "",
      "If you are reading it, the whole chain works: the Resend key, the sending domain,",
      "and the address alerts go to. A real alert about a failed nightly import would",
      "arrive the same way.",
      "",
      `The admin: ${SITE}/admin/config`,
    ].join("\n"),
  };
}

// The nightly import failed, or did not produce what it should have.
export function importFailedAlert(summary: string, errors: string[]): { subject: string; body: string } {
  return {
    subject: "Pin'd: the nightly import failed",
    body: [
      summary,
      "",
      errors.length ? `What went wrong:\n${errors.slice(0, 5).map((e) => `  - ${e}`).join("\n")}` : "No error was recorded.",
      "",
      "While the import is failing, no new gatherings arrive and the auto-publisher has",
      "nothing new to choose from, so pind.social stops refreshing.",
      "",
      `The admin: ${SITE}/admin/imports`,
      `Check the credentials: ${SITE}/admin/config`,
    ].join("\n"),
  };
}
