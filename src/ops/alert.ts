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
import { alertsConfigured } from "./secrets";

const DEFAULT_FROM = "Pin'd alerts <alerts@pind.social>";
// The cron has no request to take an origin from, and the admin is always here.
const SITE = "https://pind.social";

export type AlertKind = "import_failed" | "import_missing";

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
  if (await alreadySentToday(db, kind)) {
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
