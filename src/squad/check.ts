// Running the squad name check (M3.7). The shape of src/photo/check.ts: budget, call,
// record — and every attempt is recorded, including the ones that fail, so the admin can
// count "never checked" apart from "check failing". A failed check decides nothing: the
// squad stays unlisted and the hourly sweep tries again.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canSpend } from "../import/ai.ts";
import { CITY, photoCost, US_GEO_MULTIPLIER } from "../photo/check.ts";
import { ESTIMATE_PER_NAME, parseNameVerdict, SQUAD_NAME_CALL_MS, SQUAD_NAME_MODEL, squadNameRequest, type NameVerdict } from "./ai.ts";

export type NameSource = "webhook" | "app" | "sweep";

export interface NameResult {
  verdict: NameVerdict | null;
  cost: number;
  durationMs: number;
  error?: string;
}

// One call about one name. Never throws: a thrown error would be a check with no record.
export async function judgeName(apiKey: string, name: string): Promise<NameResult> {
  const started = Date.now();
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: SQUAD_NAME_CALL_MS });
  try {
    const res = await client.messages
      .stream(squadNameRequest(name), { signal: AbortSignal.timeout(SQUAD_NAME_CALL_MS) })
      .finalMessage();
    const cost = photoCost(res.usage);
    const durationMs = Date.now() - started;
    if (res.stop_reason !== "end_turn") return { verdict: null, cost, durationMs, error: `the call stopped early (${res.stop_reason})` };
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const verdict = parseNameVerdict(text);
    return verdict ? { verdict, cost, durationMs } : { verdict: null, cost, durationMs, error: "the answer was not a verdict" };
  } catch (err) {
    // Billed, and its usage never arrives: counted at the estimate (M1.3b).
    return {
      verdict: null,
      cost: Math.round(ESTIMATE_PER_NAME * US_GEO_MULTIPLIER * 1_000_000) / 1_000_000,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message.slice(0, 200) : "the name check failed",
    };
  }
}

// The whole job for one squad: re-read what the database holds, budget, call, record.
// Returns the status the database ended up with, or null when nothing moved.
export async function checkSquadName(
  db: SupabaseClient,
  apiKey: string | undefined,
  crewId: string,
  source: NameSource,
  capUsd: number,
): Promise<{ status: string | null; cost: number; checked: boolean; error?: string }> {
  const { data: crew, error } = await db
    .from("crews")
    .select("id, name, name_status, kind, legacy")
    .eq("id", crewId)
    .maybeSingle();
  if (error) return { status: null, cost: 0, checked: false, error: error.message };
  // Nothing to do is not a failure and leaves no failure record.
  if (!crew || crew.kind !== "crew" || crew.legacy || !crew.name) return { status: null, cost: 0, checked: false, error: "not a squad" };
  if (crew.name_status !== "pending") return { status: crew.name_status, cost: 0, checked: false };

  const record = async (outcome: string, r: Partial<NameResult> & { reason?: string }) => {
    const { data } = await db.rpc("admin_record_squad_name_check", {
      p_crew: crew.id,
      p_name: crew.name,
      p_outcome: outcome,
      p_source: source,
      p_reason: r.reason ?? null,
      p_model: SQUAD_NAME_MODEL,
      p_cost: (r.cost ?? 0).toFixed(6),
      p_duration_ms: r.durationMs ?? null,
      p_error: r.error ?? null,
    });
    return (data as string | null) ?? null;
  };

  if (!apiKey?.trim()) {
    await record("failed", { error: "ANTHROPIC_API_KEY is not set" });
    return { status: null, cost: 0, checked: true, error: "ANTHROPIC_API_KEY is not set" };
  }
  const { data: spent } = await db.rpc("admin_ai_spend_today", { p_city: CITY });
  if (!canSpend(Number(spent ?? 0), ESTIMATE_PER_NAME, capUsd)) {
    await record("failed", { error: `the daily AI cap of $${capUsd} is reached` });
    return { status: null, cost: 0, checked: true, error: `the daily AI cap of $${capUsd} is reached` };
  }
  // One call per name (M4.2): the webhook and the app's own request arrive together, and
  // only the one that claims it calls the model. Losing the claim is not a failure.
  const { data: claimed, error: claimError } = await db.rpc("admin_claim_squad_name_check", { p_crew: crew.id, p_name: crew.name });
  if (claimError) return { status: null, cost: 0, checked: false, error: claimError.message };
  if (claimed !== true) return { status: null, cost: 0, checked: false };
  const result = await judgeName(apiKey, crew.name);
  const status = await record(result.verdict?.outcome ?? "failed", { ...result, reason: result.verdict?.reason });
  return { status, cost: result.cost, checked: true, error: result.error };
}

export const NAME_SWEEP_LIMIT = 20;

// Hourly, beside the photo sweep: anything the webhook and the app both missed.
export async function sweepSquadNames(db: SupabaseClient, apiKey: string | undefined, capUsd: number): Promise<string> {
  const { data, error } = await db.rpc("admin_squad_names_waiting", { p_limit: NAME_SWEEP_LIMIT });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { crew_id: string }[];
  if (rows.length === 0) return "Nothing waiting: every squad name has been looked at.";
  let approved = 0, rejected = 0, failed = 0, cost = 0;
  for (const r of rows) {
    const out = await checkSquadName(db, apiKey, r.crew_id, "sweep", capUsd);
    cost += out.cost;
    if (out.status === "approved") approved += 1;
    else if (out.status === "rejected") rejected += 1;
    else failed += 1;
    if (out.error?.includes("daily AI cap")) break;
  }
  return `Squad names: ${approved} approved, ${rejected} refused${failed ? `, ${failed} the check could not complete` : ""}. AI $${cost.toFixed(4)}. Anything here means the webhook did not fire for it.`;
}
