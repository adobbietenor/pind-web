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
//   node --env-file=.dev.vars scripts/rescore.ts --source city            # M4.4
//
// --like matches the source's own classification ("Arts & Theatre / Comedy"), because
// that is the thing a rubric clause is written about. Dry run is the default on
// purpose: the score is what decides whether a stranger ever sees a gathering.
//
// --source picks drafts by where they came from instead (M4.4: the City feed, after its
// own rubric arrived). Either way each draft is judged by the rubric rubricFor gives
// its source, the same one the nightly run uses — and a City event is scored once, its
// score written to every date (shareScores), as the nightly run does.

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { costUsd, MODEL, parseScores, rubricFor, SCORE_SCHEMA, scoringUserMessage, shareScores, systemFor, type ScoreInput } from "../src/import/ai.ts";
import { cityEventKey } from "../src/import/cityfeed.ts";
import { formatLocal } from "../src/admin/time.ts";

const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--") ? args[i + 1]! : null;
};
const write = args.includes("--write");
const like = flag("like") ?? "";
const source = flag("source") ?? "";
const weeks = Number(flag("weeks") ?? 8);
const BATCH = 25;
const TZ = "America/Toronto";

if (!like === !source) {
  console.error('Give one of --like "<part of the classification>" (e.g. --like "Comedy") or --source <source> (e.g. --source city).');
  process.exit(1);
}

const db = createClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), {
  auth: { persistSession: false },
});
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!.trim(), maxRetries: 1, timeout: 300_000 });

const now = new Date();
// Paged: PostgREST answers at most 1,000 rows whatever the limit says, and a read cut
// short re-scored only the first three weeks of the City feed (30 Oct 2026), leaving
// one event with two scores.
const data: any[] = [];
for (let from = 0; ; from += 1000) {
  let q = db
    .from("gatherings")
    .select("id, name, starts_at, source, slug, dismissed_at, is_seed, venues(name), gathering_triage(score, reason), gathering_sources(external_id, snapshot)")
    .gte("starts_at", now.toISOString())
    .lt("starts_at", new Date(now.getTime() + weeks * 7 * 86_400_000).toISOString());
  if (source) q = q.eq("source", source);
  const { data: page, error } = await q.order("starts_at").order("id").range(from, from + 999);
  if (error) throw new Error(error.message);
  data.push(...(page ?? []));
  if (!page || page.length < 1000) break;
}

const classification = (r: any): string => (r.gathering_sources ?? []).map((s: any) => s?.snapshot?.category).find(Boolean) ?? "";

// Drafts only. A published gathering's score is history: it is already public, and
// re-scoring it would change a number nothing acts on while making the audit trail
// harder to read.
const rows = (data as any[]).filter(
  (r) =>
    !r.is_seed &&
    !r.dismissed_at &&
    !r.slug &&
    (source ? r.source === source : classification(r).toLowerCase().includes(like.toLowerCase())),
);
const rubric = rubricFor(source || "ticketmaster");
if (like && rows.some((r) => rubricFor(r.source) !== rubric)) {
  console.error("Those drafts need two different rubrics; re-score them with --source, one source at a time.");
  process.exit(1);
}
console.log(
  `${rows.length} drafts ${source ? `from ${source}` : `whose classification contains "${like}"`}, starting in the next ${weeks} weeks; the ${rubric} rubric.`,
);
if (rows.length === 0) process.exit(0);

const snapshot = (r: any): any => (r.gathering_sources ?? []).map((s: any) => s?.snapshot).find(Boolean) ?? {};
const inputs: ScoreInput[] = rows.map((r) => ({
  id: r.id,
  name: r.name,
  when: formatLocal(r.starts_at, TZ),
  venue: r.venues?.name ?? "unknown",
  category: classification(r),
  distanceKm: null,
  ...(rubric === "community"
    ? { frequency: snapshot(r).frequency ?? null, free: snapshot(r).free ?? null, organiser: snapshot(r).organiser ?? null }
    : {}),
}));

// Every draft here is re-judged, so none lends a score: each event is scored once,
// through its earliest date.
const externalId = (r: any): string | null => (r.gathering_sources ?? []).map((s: any) => s?.external_id).find(Boolean) ?? null;
const shared = shareScores(
  rows.map((r) => ({ id: r.id, group: rubric === "community" && externalId(r) ? cityEventKey(externalId(r)!) : null, score: null })),
);
const alsoOf = new Map(shared.toScore.map((x) => [x.id, x.also]));
const toCall = inputs.filter((x) => alsoOf.has(x.id));
console.log(`${toCall.length} ${rubric === "community" ? "events" : "drafts"} to score.`);

const scores = new Map<string, { score: number; reason: string }>();
let cost = 0;
for (let i = 0; i < toCall.length; i += BATCH) {
  const batch = toCall.slice(i, i + BATCH);
  const res = await claude.messages
    .stream({
      model: MODEL,
      max_tokens: 8000,
      system: systemFor(rubric),
      output_config: { effort: "low", format: { type: "json_schema", schema: SCORE_SCHEMA as unknown as Record<string, unknown> } },
      messages: [{ role: "user", content: scoringUserMessage(batch) }],
    })
    .finalMessage();
  cost += costUsd(res.usage);
  const text = res.content.map((b: any) => (b.type === "text" ? b.text : "")).join("");
  for (const [k, v] of parseScores(text, batch.map((e) => e.id))) {
    for (const id of [k, ...(alsoOf.get(k) ?? [])]) scores.set(id, v);
  }
  console.log(`  batch ${i / BATCH + 1}: ${scores.size} of ${inputs.length} dates scored so far`);
}

// The floor this source is published against, read from where the publisher reads it.
const { data: cityRow } = await db.from("cities").select("score_floor, city_score_floor").eq("slug", "toronto").single();
const FLOOR = Number(source === "city" ? cityRow?.city_score_floor : cityRow?.score_floor);
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
