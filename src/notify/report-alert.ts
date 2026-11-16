// POST /hooks/report — every new report emails the admin within a minute (Alex, 16 Nov 2026).
//
// The database's trigger (reports_alert_admin) posts { report_id } here the moment a report is
// filed, with the photo check's webhook secret in x-pind-webhook. It never posts for a report
// a harness or seed person is in (private.report_alert_wanted, P318). Here: read what the
// report says through the service key (admin_report_alert), and email every ADMIN_EMAILS
// address the reason, who, and a link to their card in the admin, where they can be hidden
// or banned. The words of any message are never in it (reports are on people, 16 Oct 2026).
import type { Env } from "../env";
import { sameSecret } from "../photo/routes.ts";
import { serviceClient } from "../supabase.ts";
import { reportEmail, type ReportAlert } from "./report-email.ts";

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function reportWebhook(request: Request, env: Env): Promise<Response> {
  const expected = env.PHOTO_WEBHOOK_SECRET?.trim();
  const given = (request.headers.get("x-pind-webhook") ?? "").trim();
  if (!expected || !sameSecret(given, expected)) return json(401, { error: "no", header: given ? "mismatch" : "missing" });
  let id = "";
  try {
    id = String(((await request.json()) as { report_id?: string }).report_id ?? "");
  } catch {
    return json(400, { error: "not JSON" });
  }
  if (!/^[0-9a-f-]{36}$/.test(id)) return json(400, { error: "no report" });
  const to = (env.ADMIN_EMAILS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  // A missing credential says so once, as configuration (CLAUDE.md, "Secrets").
  if (!to.length) return json(503, { error: "ADMIN_EMAILS is not set" });
  if (!env.RESEND_API_KEY?.trim()) return json(503, { error: "RESEND_API_KEY is not set" });
  const { data, error } = await serviceClient(env).rpc("admin_report_alert", { p_report: id });
  if (error) return json(500, { error: error.message });
  const alert = ((data ?? []) as ReportAlert[])[0];
  if (!alert) return json(404, { error: "no such report" });
  const mail = reportEmail(alert, new URL(request.url).origin);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY.trim()}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.NOTIFY_FROM?.trim() || "Pin'd <hello@pind.social>", to, subject: mail.subject, text: mail.text }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return json(502, { error: `resend ${res.status}` });
  return json(200, { sent: to.length });
}
