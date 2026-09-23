// The photos nothing has looked at (Phase 3 M3.1).
//
// **The hole this closes, which is one I left.** The webhook is the mechanism and the
// app's call is the net — and if both miss, *nothing ever tries again*. The admin
// counts "never checked" and "check failing", which is half the M2.3 pattern and the
// easier half: **a job renders it ahead of time, the fallback stays as a net, and the
// admin counts what is still missing.** Counting without a way to act is a number that
// makes somebody feel informed while the photo stays invisible.
//
// So this is the job. It is bounded, it runs on **its own cron** rather than inside
// the nightly import — the import must not be delayed and this must not be skipped
// because the import stalled (Alex: "own cron, own budget line, never inside the
// import") — and the same pass is an admin button, because the moment somebody is
// looking at the queue is the moment they want it run.
//
// **It cannot be the first thing that checks a photo.** If this is ever doing real
// work, the webhook is broken, and the admin says so in the same panel: a 401, a
// missing Vault entry, a queue that is not draining. A retry that quietly papers over
// a broken mechanism is how the M2.1 map fallback became the mechanism.

import type { SupabaseClient } from "@supabase/supabase-js";
import { canSpend } from "../import/ai.ts";
import { checkPhoto, CITY, DEFAULT_CAP_USD } from "./check.ts";
import { ESTIMATE_PER_PHOTO } from "./ai.ts";
import type { Env } from "../env";
import { serviceClient } from "../supabase.ts";

export const PHOTO_SWEEP_CRON = "0 9 * * *";

// A night's worth. Small on purpose: if there are more than this waiting, the answer
// is to fix the webhook, not to grind through them one cron at a time.
export const SWEEP_LIMIT = 20;

export interface SweepOutcome {
  looked: number;
  approved: number;
  rejected: number;
  needsReview: number;
  failed: number;
  cost: number;
  message: string;
}

// Pending, with a photo, and nothing has successfully decided it, oldest first — and
// never the policy harness's people, which is why the database answers it: the
// harness marker lives in auth.users, where only it can read (M3.1).
async function waiting(db: SupabaseClient, limit: number) {
  const { data, error } = await db.rpc("admin_photos_waiting", { p_limit: limit });
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; photo_path: string }[];
}

export async function sweepPhotos(
  env: Env,
  opts: { limit?: number; db?: SupabaseClient } = {},
): Promise<SweepOutcome> {
  const db = opts.db ?? serviceClient(env);
  const limit = opts.limit ?? SWEEP_LIMIT;
  const cap = Number(env.AI_DAILY_CAP_USD ?? DEFAULT_CAP_USD);
  const out: SweepOutcome = { looked: 0, approved: 0, rejected: 0, needsReview: 0, failed: 0, cost: 0, message: "" };

  const rows = await waiting(db, limit);
  if (rows.length === 0) {
    out.message = "Nothing waiting: every photo has been looked at.";
    return out;
  }

  for (const person of rows) {
    // The cap is checked per photo rather than once, because the day's spend moves
    // while this runs — the import and the liveness check share the same budget.
    const { data: spent } = await db.rpc("admin_ai_spend_today", { p_city: CITY });
    if (!canSpend(Number(spent ?? 0), ESTIMATE_PER_PHOTO, cap)) {
      out.message = `Stopped at the daily AI cap of $${cap} after ${out.looked}. ${rows.length - out.looked} still waiting.`;
      return out;
    }
    const result = await checkPhoto(db, env.ANTHROPIC_API_KEY, person, "admin", cap);
    out.looked += 1;
    out.cost += result.cost;
    if (result.status === "approved") out.approved += 1;
    else if (result.status === "rejected") out.rejected += 1;
    else if (result.status === "needs_review") out.needsReview += 1;
    else out.failed += 1;
  }

  out.message =
    `Looked at ${out.looked}: ${out.approved} approved, ${out.needsReview} for a human, ${out.rejected} refused` +
    (out.failed ? `, ${out.failed} the check could not complete` : "") +
    `. AI $${out.cost.toFixed(4)}.` +
    // **Say when it did real work.** This job existing quietly is fine; this job
    // finding things is a symptom, and the sentence is where somebody notices.
    (out.looked > 0 ? " Anything here means the webhook did not fire for it — check the webhook panel." : "");
  return out;
}
