// The daily look at credentials that lapse on a date (Phase 3 M3.1).
//
// **Why this is a push and not only a panel.** Alex's ask was "a warning well before
// it lapses, rather than finding out when someone can't sign in" — and a page somebody
// has to visit is exactly finding out later. The Configuration panel is the pull; this
// is the part that reaches out.
//
// **It shares the 09:00 cron rather than owning one.** The repo's rule is own cron,
// own budget line, never inside the import — and that rule is about jobs that spend
// money or time and can stall somebody else's. This is a date comparison: it costs
// nothing, it cannot stall, and a cron trigger of its own for one subtraction would be
// machinery pretending to be caution. It runs beside the photo sweep and is named
// separately so nobody reads it as part of it.
//
// One alert per kind per Toronto day is enforced in the database, so a lapsed secret
// nags once a day rather than once a run.
import { sendAlert } from "./alert";
import { expiringCredentials, worthAnAlert } from "./expiry";
import type { Env } from "../env";
import { serviceClient } from "../supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function checkExpiringCredentials(
  env: Env,
  db: SupabaseClient = serviceClient(env),
): Promise<{ message: string; alerted: boolean }> {
  const all = expiringCredentials(env);
  const needed = worthAnAlert(all);
  if (needed.length === 0) {
    return { message: `Credentials: ${all.map((x) => `${x.name} ${x.says}`).join(" · ")}`, alerted: false };
  }
  const subject = needed.some((x) => x.state === "lapsed")
    ? "Pin'd: a credential has lapsed"
    : "Pin'd: a credential is about to lapse";
  const body =
    needed.map((x) => `${x.name}\n${x.says}\nWhat stops: ${x.what}`).join("\n\n") +
    "\n\nMint a new Apple client secret with:\n  node scripts/apple-client-secret.ts --key <path to the .p8> --kid <Key ID>\n" +
    "then paste it into Supabase → Authentication → Providers → Apple, and put the printed date in wrangler.jsonc.";
  const outcome = await sendAlert(env, db, "credential_expiring", subject, body);
  return { message: `${subject} — ${needed.map((x) => x.name).join(", ")}. Alert ${outcome.why}.`, alerted: outcome.sent };
}
