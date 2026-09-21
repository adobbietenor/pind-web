// Re-judge every photo the check has judged, after a rubric change (Phase 3 M3.1).
//
// **The rule** (decisions.md, "The comedy rubric, measured before and after"): a
// change to a rubric ships **together with the re-score of whatever it has already
// judged**, and it is judged by running it **twice**, because a single run is not
// evidence. Only new photos are checked as they arrive, so without this a rubric
// change leaves two wordings' verdicts in one queue.
//
// Usage, from the repo root:
//   node --env-file=.dev.vars scripts/photo-rescore.ts            # dry: decides nothing
//   node --env-file=.dev.vars scripts/photo-rescore.ts --write    # applies run 1
//
// **Dry by default**, like `scripts/rescore.ts`, because a photo's status decides
// whether a stranger sees somebody's face.
//
// **It never overrules a person.** `admin_rescore_photo` moves a status only when the
// last decision on that photo came from `ai:photo-check`; where Alex decided, the new
// verdict is recorded as evidence and the status is left alone. The script says which.

import { createClient } from "@supabase/supabase-js";
import { judge } from "../src/photo/check.ts";
import { mediaTypeOf } from "../src/photo/check.ts";
import { PHOTO_MODEL } from "../src/photo/ai.ts";

const args = process.argv.slice(2);
const write = args.includes("--write");
const runs = Number(args[args.indexOf("--runs") + 1]) || 2;

function env(name: string): string {
  const value = (process.env[name] ?? process.env[`﻿${name}`])?.trim();
  if (!value) throw new Error(`${name} is missing from .dev.vars`);
  return value;
}

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface Subject {
  id: string;
  first_name: string;
  photo_path: string;
  photo_status: string;
  is_seed: boolean;
}

async function main() {
  const { data, error } = await db
    .from("people")
    .select("id, first_name, photo_path, photo_status, is_seed")
    .not("photo_path", "is", null)
    .order("is_seed")
    .order("first_name");
  if (error) throw new Error(error.message);
  const subjects = (data ?? []) as Subject[];
  if (!subjects.length) return console.log("No photos to re-judge.");

  const apiKey = env("ANTHROPIC_API_KEY");
  console.log(`${subjects.length} photos, ${runs} runs each, model ${PHOTO_MODEL}.`);
  console.log(write ? "Applying run 1 where the check's own verdict stands.\n" : "Dry run: nothing is written.\n");

  // photo_path -> outcome per run
  const seen: Map<string, string>[] = [];
  let spend = 0;

  for (let run = 0; run < runs; run++) {
    const outcomes = new Map<string, string>();
    for (const person of subjects) {
      const file = await db.storage.from("photos").download(person.photo_path);
      if (file.error || !file.data) {
        console.log(`  ${person.first_name}: the file is gone — skipped`);
        continue;
      }
      const mediaType = mediaTypeOf(person.photo_path, file.data.type);
      if (!mediaType) {
        console.log(`  ${person.first_name}: not an image the API reads — skipped`);
        continue;
      }
      const bytes = Buffer.from(await file.data.arrayBuffer());
      const result = await judge(apiKey, { data: bytes.toString("base64"), mediaType });
      spend += result.cost;
      const outcome = result.verdict?.outcome ?? "failed";
      outcomes.set(person.photo_path, outcome);

      const moved = outcome !== person.photo_status ? "→" : " ";
      console.log(
        `run ${run + 1} ${moved} ${person.first_name.padEnd(8)} ${person.photo_status.padEnd(13)} ${outcome.padEnd(13)} ${(result.verdict?.reason ?? result.error ?? "").slice(0, 70)}`,
      );

      if (write && run === 0) {
        const applied = await db.rpc("admin_rescore_photo", {
          p_person: person.id,
          p_photo_path: person.photo_path,
          p_outcome: outcome,
          p_reason: result.verdict?.reason ?? result.error ?? null,
          p_model: PHOTO_MODEL,
          p_cost: result.cost.toFixed(6),
          p_duration_ms: result.durationMs,
          p_only_if_ai: true,
        });
        console.log(`          ${applied.error ? `FAILED ${applied.error.message}` : applied.data}`);
      }
    }
    seen.push(outcomes);
  }

  // **The number this change is about.** Reported for real photographs separately
  // from the seeded placeholders: the placeholders are 1x1 and solid-colour PNGs, and
  // a rate dominated by images that are not photographs says nothing about photos.
  const rate = (rows: Subject[], run: number) => {
    const got = rows.map((p) => seen[run]?.get(p.photo_path)).filter(Boolean);
    const held = got.filter((o) => o === "needs_review").length;
    return got.length ? `${held}/${got.length} held (${Math.round((held / got.length) * 100)}%)` : "none";
  };
  const real = subjects.filter((p) => !p.is_seed);
  const placeholders = subjects.filter((p) => p.is_seed);

  console.log(`\nneeds_review rate, run 1`);
  console.log(`  real photographs        ${rate(real, 0)}`);
  console.log(`  seeded placeholders     ${rate(placeholders, 0)}`);
  // **The honest "before".** Current statuses are not it: Alex cleared the queue by
  // hand, so counting rows that still say needs_review measures how much tidying he
  // did, not what the check decided. The check's own verdicts are in photo_checks.
  const { data: history } = await db
    .from("photo_checks")
    .select("outcome")
    .in("source", ["webhook", "app", "admin"]);
  const decided = (history ?? []).filter((r) => r.outcome !== "failed");
  const heldBefore = decided.filter((r) => r.outcome === "needs_review").length;
  console.log(
    `  before, over every verdict the check ever reached: ${heldBefore}/${decided.length} held (${decided.length ? Math.round((heldBefore / decided.length) * 100) : 0}%)`,
  );

  for (let run = 1; run < seen.length; run++) {
    const moved = subjects.filter((p) => seen[0]!.get(p.photo_path) !== seen[run]!.get(p.photo_path));
    console.log(
      `\nRuns 1 and ${run + 1} disagreed on ${moved.length} of ${subjects.length}${moved.length ? ": " + moved.map((p) => p.first_name).join(", ") : ""} — the noise floor.`,
    );
  }

  console.log(`\nAI spend: $${spend.toFixed(4)} over ${runs} runs.`);
  if (!write) console.log("Dry run: nothing was written. Re-run with --write to apply run 1.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
