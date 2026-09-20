// Re-score drafts after a rubric change (M2.3, Alex).
//
// **Why this exists at all.** Only *new* drafts are scored by the nightly run, so a
// change to SCORING_SYSTEM leaves the queue split: whatever arrives tonight is judged
// by the new wording and everything already there by the old. That state is worse than
// either wording, because the publisher ranks them against each other and the floor
// means two different things at once. So a rubric change and a re-score ship together,
// and this is the re-score.
//
// It writes `gathering_triage` and nothing else: no publishing, no moderation log — an
// AI score is not a moderation decision, and the publisher runs on its own schedule
// with its own record of what it chose and why.
//
// Usage, from the repo root:
//   node --env-file=.dev.vars scripts/rescore.ts --like "Comedy"        # dry run
//   node --env-file=.dev.vars scripts/rescore.ts --like "Comedy" --write
//
// --like matches the source's own classification ("Arts & Theatre / Comedy"), because
// that is the thing a rubric clause is written about. Dry run is the default on
// purpose: the score is what decides whether a stranger ever sees a gathering.

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { costUsd, MODEL, parseScores, SCORE_SCHEMA, SCORING_SYSTEM, scoringUserMessage, type ScoreInput } from "../src/import/ai.ts";
import { formatLocal } from "../src/admin/time.ts";

const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--") ? args[i + 1]! : null;
};
const write = args.includes("--write");
const like = flag("like") ?? "";
const weeks = Number(flag("weeks") ?? 8);
const BATCH = 25;
const TZ = "America/Toronto";

if (!like) {
  console.error('Give --like "<part of the classification>", e.g. --like "Comedy".');
  process.exit(1);
}

const db = createClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), {
  auth: { persistSession: false },
});
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!.trim(), maxRetries: 1, timeout: 300_000 });

const now = new Date();
const { data, error } = await db
  .from("gatherings")
  .select("id, name, starts_at, slug, dismissed_at, is_seed, venues(name), gathering_triage(score, reason), gathering_sources(snapshot)")
  .gte("starts_at", now.toISOString())
  .lt("starts_at", new Date(now.getTime() + weeks * 7 * 86_400_000).toISOString())
  .limit(3000);
if (error) throw new Error(error.message);

const classification = (r: any): string => (r.gathering_sources ?? []).map((s: any) => s?.snapshot?.category).find(Boolean) ?? "";

// Drafts only. A published gathering's score is history: it is already public, and
// re-scoring it would change a number nothing acts on while making the audit trail
// harder to read.
const rows = (data as any[]).filter(
  (r) => !r.is_seed && !r.dismissed_at && !r.slug && classification(r).toLowerCase().includes(like.toLowerCase()),
);
console.log(`${rows.length} drafts whose classification contains "${like}", starting in the next ${weeks} weeks.`);
if (rows.length === 0) process.exit(0);

const inputs: ScoreInput[] = rows.map((r) => ({
  id: r.id,
  name: r.name,
  when: formatLocal(r.starts_at, TZ),
  venue: r.venues?.name ?? "unknown",
  category: classification(r),
  distanceKm: null,
}));

const scores = new Map<string, { score: number; reason: string }>();
let cost = 0;
for (let i = 0; i < inputs.length; i += BATCH) {
  const batch = inputs.slice(i, i + BATCH);
  const res = await claude.messages
    .stream({
      model: MODEL,
      max_tokens: 8000,
      system: SCORING_SYSTEM,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCORE_SCHEMA as unknown as Record<string, unknown> } },
      messages: [{ role: "user", content: scoringUserMessage(batch) }],
    })
    .finalMessage();
  cost += costUsd(res.usage);
  const text = res.content.map((b: any) => (b.type === "text" ? b.text : "")).join("");
  for (const [k, v] of parseScores(text, batch.map((e) => e.id))) scores.set(k, v);
  console.log(`  batch ${i / BATCH + 1}: ${scores.size} of ${inputs.length} scored so far`);
}

const FLOOR = 60;
let moved = 0;
let crossed = 0;
for (const r of rows) {
  const before = r.gathering_triage?.score ?? null;
  const after = scores.get(r.id);
  if (!after) {
    console.log(`  no score returned: ${r.name}`);
    continue;
  }
  if (before !== after.score) moved += 1;
  if ((before ?? 0) < FLOOR && after.score >= FLOOR) crossed += 1;
  console.log(
    `${String(before ?? "-").padStart(4)} → ${String(after.score).padStart(3)}${after.score >= FLOOR ? " *" : "  "} ${r.name.slice(0, 52).padEnd(52)} ${after.reason.slice(0, 70)}`,
  );
}
console.log(`\n${moved} scores would change; ${crossed} cross the floor of ${FLOOR}. Cost $${cost.toFixed(4)}.`);

if (!write) {
  console.log("Dry run. Add --write to save these scores.");
  process.exit(0);
}

// One row per gathering in gathering_triage, so this is an upsert on the primary key.
const payload = [...scores].map(([gathering_id, s]) => ({
  gathering_id,
  score: s.score,
  reason: s.reason,
  scored_at: new Date().toISOString(),
}));
for (let i = 0; i < payload.length; i += 100) {
  const { error: err } = await db.from("gathering_triage").upsert(payload.slice(i, i + 100), { onConflict: "gathering_id" });
  if (err) throw new Error(err.message);
}
console.log(`Written: ${payload.length} scores.`);
