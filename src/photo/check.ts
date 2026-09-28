// Running the photo check (Phase 3 M3.1).
//
// **A visitor is never the thing that does the work** (CLAUDE.md). The mechanism is
// the database webhook, which fires when a photo path lands on a `people` row; the
// app's own call after upload is the net, not the mechanism. Neither of them is a
// stranger loading a page.
//
// **Every attempt is recorded, including the ones that fail.** A check that errored,
// timed out or never started leaves the photo at `pending` and writes a `failed` row,
// so the admin can count "never checked" apart from "check failing" apart from
// "waiting for a human". Unset is a different state from broken (M2.3's maps).
//
// Written with the file extension on every import so this module can be run outside
// the Worker — that is how the labelled set is scored before the check is trusted
// (scripts/photo-check-eval.ts), and a module only a deploy can execute is a module
// nobody checks.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canSpend, costUsd } from "../import/ai.ts";
import {
  ESTIMATE_PER_PHOTO,
  parseUnreadable,
  parseVerdict,
  PHOTO_CALL_MS,
  PHOTO_MODEL,
  PHOTO_SCHEMA,
  PHOTO_SYSTEM,
  SUPPORTED,
  type Verdict,
} from "./ai.ts";

export const BUCKET = "photos";
export const DEFAULT_CAP_USD = 3;
export const CITY = "toronto";

export type Source = "webhook" | "app" | "admin" | "eval";

export interface CheckResult {
  // null when the attempt failed: a failure decides nothing.
  verdict: Verdict | null;
  cost: number;
  durationMs: number;
  error?: string;
}

// An image the model can actually read. HEIC is allowed into the bucket and is not
// accepted by the API, so it is named as the fault it is rather than becoming a
// mystery failure (the app uploads JPEG — A2, A27).
export function mediaTypeOf(path: string, blobType: string | undefined): string | null {
  const byBlob = (blobType ?? "").split(";")[0]!.trim().toLowerCase();
  const byName = ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic", heif: "image/heic" } as Record<string, string>)[
    path.split(".").pop()?.toLowerCase() ?? ""
  ];
  const type = SUPPORTED.includes(byBlob as (typeof SUPPORTED)[number]) ? byBlob : (byName ?? byBlob);
  return SUPPORTED.includes(type as (typeof SUPPORTED)[number]) ? type : null;
}

function base64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// One call about one image. Streamed and aborted at four minutes, with at most one
// retry, per the M1.3b pattern. It never throws: a thrown error here would be a
// check that left no record.
// **Pinned to the US** (Alex, M3.2). Without `inference_geo` a request follows the
// workspace default, "global" — any geography — and the privacy policy could only say
// "may be processed in any country". Pinned, a photo is processed and stored in the
// US, a sentence that can be defended. It costs 1.1x on these calls only; the import
// vetting sends no personal data and is left alone. P-cases cannot reach this, so
// tests/unit/photo.test.ts reads the request itself (R01) and the cost (R02).
export const PHOTO_INFERENCE_GEO = "us";
export const US_GEO_MULTIPLIER = 1.1;

export function photoRequest(image: { data: string; mediaType: string }) {
  return {
    model: PHOTO_MODEL,
    max_tokens: 300,
    inference_geo: PHOTO_INFERENCE_GEO,
    system: PHOTO_SYSTEM,
    output_config: {
      effort: "low" as const,
      format: { type: "json_schema" as const, schema: PHOTO_SCHEMA as unknown as Record<string, unknown> },
    },
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "image" as const, source: { type: "base64" as const, media_type: image.mediaType as "image/jpeg", data: image.data } },
          { type: "text" as const, text: "Check this profile photo." },
        ],
      },
    ],
  };
}

// What a pinned call costs, so the daily cap counts what is actually billed.
export function photoCost(usage: Parameters<typeof costUsd>[0]): number {
  return Math.round(costUsd(usage) * US_GEO_MULTIPLIER * 1_000_000) / 1_000_000;
}

export async function judge(
  apiKey: string,
  image: { data: string; mediaType: string },
): Promise<CheckResult> {
  const started = Date.now();
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: PHOTO_CALL_MS });
  try {
    const res = await client.messages
      .stream(
        photoRequest(image),
        { signal: AbortSignal.timeout(PHOTO_CALL_MS) },
      )
      .finalMessage();
    const cost = photoCost(res.usage);
    const durationMs = Date.now() - started;
    if (res.stop_reason !== "end_turn") {
      return { verdict: null, cost, durationMs, error: `the call stopped early (${res.stop_reason})` };
    }
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const verdict = parseVerdict(text);
    if (verdict) return { verdict, cost, durationMs };
    // Nothing to see is a failed check, never an approval (Alex, M3.1).
    const unseen = parseUnreadable(text);
    return {
      verdict: null,
      cost,
      durationMs,
      error: unseen ? `the check could not see an image: ${unseen}` : "the answer was not a verdict",
    };
  } catch (err) {
    // An aborted call is billed and its usage never arrives, so it is counted at the
    // estimate rather than at nothing (M1.3b's cost blind spot).
    return {
      verdict: null,
      cost: Math.round(ESTIMATE_PER_PHOTO * US_GEO_MULTIPLIER * 1_000_000) / 1_000_000,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message.slice(0, 200) : "the photo check failed",
    };
  }
}

// The whole job for one person's photo: budget, download, call, record. Returns the
// status the database ended up with, or null when nothing moved.
export async function checkPhoto(
  db: SupabaseClient,
  apiKey: string | undefined,
  person: { id: string; photo_path: string },
  source: Source,
  capUsd: number,
): Promise<{ status: string | null; cost: number; error?: string }> {
  const record = async (outcome: string, r: Partial<CheckResult> & { reason?: string }) => {
    const { data } = await db.rpc("admin_record_photo_check", {
      p_person: person.id,
      p_photo_path: person.photo_path,
      p_outcome: outcome,
      p_source: source,
      p_reason: r.reason ?? null,
      p_model: PHOTO_MODEL,
      p_cost: (r.cost ?? 0).toFixed(6),
      p_duration_ms: r.durationMs ?? null,
      p_error: r.error ?? null,
    });
    return (data as string | null) ?? null;
  };

  // A missing key is a configuration problem, not N runtime failures — but it still
  // leaves a record, because a photo nothing ever looked at is the state that goes
  // unnoticed. The admin says "ANTHROPIC_API_KEY is not set" once, where photos are
  // managed; this row is what makes the photo itself countable.
  if (!apiKey?.trim()) {
    await record("failed", { error: "ANTHROPIC_API_KEY is not set" });
    return { status: null, cost: 0, error: "ANTHROPIC_API_KEY is not set" };
  }

  const { data: spent } = await db.rpc("admin_ai_spend_today", { p_city: CITY });
  if (!canSpend(Number(spent ?? 0), ESTIMATE_PER_PHOTO, capUsd)) {
    await record("failed", { error: `the daily AI cap of $${capUsd} is reached` });
    return { status: null, cost: 0, error: `the daily AI cap of $${capUsd} is reached` };
  }

  const file = await db.storage.from(BUCKET).download(person.photo_path);
  if (file.error || !file.data) {
    await record("failed", { error: `the photo could not be read: ${file.error?.message ?? "no file"}` });
    return { status: null, cost: 0, error: "the photo could not be read" };
  }
  const mediaType = mediaTypeOf(person.photo_path, file.data.type);
  if (!mediaType) {
    const what = file.data.type || "an unknown type";
    await record("failed", { error: `the API cannot read ${what}; upload JPEG, PNG or WebP` });
    return { status: null, cost: 0, error: `unsupported image type: ${what}` };
  }

  const result = await judge(apiKey, { data: base64(await file.data.arrayBuffer()), mediaType });
  const status = await record(result.verdict?.outcome ?? "failed", {
    ...result,
    reason: result.verdict?.reason,
  });
  return { status, cost: result.cost, error: result.error };
}
