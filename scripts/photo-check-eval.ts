// Score the photo check against a labelled set, twice (Phase 3 M3.1, Alex).
//
// **The rule this follows**, established by the comedy rubric in M2.3: a change to a
// rubric or a threshold is judged by running it **twice** — once to find the noise
// floor — against a labelled set, and it ships together with a re-score of whatever it
// has already judged. "It reads better" is not evidence, and neither is a single run.
//
// The photo check is new, so there is no previous wording to compare against. The two
// runs are therefore **the same prompt twice**, which measures the noise floor
// directly: how many photos change outcome between two identical runs. Every later
// change to PHOTO_SYSTEM is judged against that number.
//
// **The uncertain outcome is measured, not only pass and fail** (Alex). A check that
// sends everything to a human is useless and a check that sends nothing is dangerous,
// so `needs_review` gets its own column in the table below, both as a correct answer
// and as a wrong one.
//
// Usage, from the repo root:
//   node --env-file=.dev.vars scripts/photo-check-eval.ts                 # dry: no spend recorded
//   node --env-file=.dev.vars scripts/photo-check-eval.ts --write         # records each call in photo_checks
//   node --env-file=.dev.vars scripts/photo-check-eval.ts --runs 3
//
// **The photos are never committed.** `tests/photos/` is gitignored; only
// `tests/photos/labels.json` is in the repo, so a run is reproducible without real
// people's faces being in git. Its shape:
//
//   [{ "file": "clear-face-1.jpg", "expect": "approved", "note": "arm's length, daylight" }]
//
// `expect` is one of approved / rejected / needs_review.
//
// **Two cases this set deliberately does not hold** (Alex agreed): an actual sexual
// image, and a photo of a child. The inappropriate path is exercised by the boundary
// case that actually matters for a face-photo product — a shirtless or swimwear photo
// — and the minor path by proving that a young-looking ADULT routes to needs_review
// rather than to approved, which is all the rule claims (the check may never decide
// age on its own, H8). A licensed evaluation set is the answer if the harder cases are
// ever needed.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { judge } from "../src/photo/check.ts";
import { mediaTypeOf } from "../src/photo/check.ts";
import { PHOTO_MODEL, type Outcome } from "../src/photo/ai.ts";

const args = process.argv.slice(2);
const write = args.includes("--write");
const runsWanted = Number(args[args.indexOf("--runs") + 1]) || 2;
const DIR = join(process.cwd(), "tests", "photos");

interface Label {
  file: string;
  expect: Outcome;
  note?: string;
}

const ANSWERS: Outcome[] = ["approved", "needs_review", "rejected"];
const SHORT: Record<Outcome, string> = { approved: "approve", needs_review: "review", rejected: "reject" };

function env(name: string): string {
  const value = (process.env[name] ?? process.env[`﻿${name}`])?.trim();
  if (!value) throw new Error(`${name} is missing from .dev.vars`);
  return value;
}

async function labels(): Promise<Label[]> {
  let raw: string;
  try {
    raw = await readFile(join(DIR, "labels.json"), "utf8");
  } catch {
    const there = await readdir(DIR).catch(() => []);
    throw new Error(
      `tests/photos/labels.json is missing. The folder is gitignored and Alex supplies the photos; it currently holds ${there.length} file(s).`,
    );
  }
  const parsed = JSON.parse(raw) as Label[];
  for (const l of parsed) {
    if (!ANSWERS.includes(l.expect)) throw new Error(`${l.file}: "${l.expect}" is not an outcome`);
  }
  return parsed;
}

async function main() {
  const set = await labels();
  console.log(`${set.length} labelled photos, ${runsWanted} runs, model ${PHOTO_MODEL}.`);
  console.log(write ? "Recording every call in photo_checks.\n" : "Dry run: nothing is recorded.\n");

  const apiKey = env("ANTHROPIC_API_KEY");
  const db = write
    ? createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })
    : null;

  // run -> file -> outcome ("failed" when the call itself did not answer).
  const seen: Map<string, string>[] = [];
  let spend = 0;

  for (let run = 0; run < runsWanted; run++) {
    const outcomes = new Map<string, string>();
    for (const label of set) {
      const bytes = await readFile(join(DIR, label.file));
      const mediaType = mediaTypeOf(label.file, undefined);
      if (!mediaType) {
        console.log(`  ${label.file}: not an image the API reads — skipped`);
        continue;
      }
      const result = await judge(apiKey, { data: bytes.toString("base64"), mediaType });
      spend += result.cost;
      outcomes.set(label.file, result.verdict?.outcome ?? "failed");
      if (db) {
        await db.rpc("admin_record_photo_check", {
          p_person: null,
          p_photo_path: `eval/${label.file}`,
          p_outcome: result.verdict?.outcome ?? "failed",
          p_source: "eval",
          p_reason: result.verdict?.reason ?? null,
          p_model: PHOTO_MODEL,
          p_cost: result.cost.toFixed(6),
          p_duration_ms: result.durationMs,
          p_error: result.error ?? null,
        });
      }
      const mark = result.verdict?.outcome === label.expect ? " " : "✗";
      console.log(
        `run ${run + 1}  ${mark} ${label.file.padEnd(28)} expected ${SHORT[label.expect].padEnd(7)} got ${(result.verdict?.outcome ?? "FAILED").padEnd(12)} ${result.verdict?.reason ?? result.error ?? ""}`,
      );
    }
    seen.push(outcomes);
  }

  // The table: expected down, answered across, so a wrong answer says which way it
  // was wrong. An approve that should have been a review is a different failure from
  // a review that should have been an approve, and only one of them is dangerous.
  console.log(`\nRun 1, expected (down) against answered (across):`);
  console.log(`${"".padEnd(14)}${ANSWERS.map((a) => SHORT[a].padEnd(9)).join("")}failed`);
  for (const expect of ANSWERS) {
    const row = set.filter((l) => l.expect === expect);
    const cells = ANSWERS.map((a) => String(row.filter((l) => seen[0]!.get(l.file) === a).length).padEnd(9));
    const failed = row.filter((l) => seen[0]!.get(l.file) === "failed").length;
    console.log(`${SHORT[expect].padEnd(14)}${cells.join("")}${failed}`);
  }

  const right = set.filter((l) => seen[0]!.get(l.file) === l.expect).length;
  console.log(`\nRun 1 agreed with the label on ${right} of ${set.length}.`);

  // **The number this whole exercise exists for.** Two identical runs that disagree
  // are the floor under any later claim that a wording change improved something.
  for (let run = 1; run < seen.length; run++) {
    const moved = set.filter((l) => seen[0]!.get(l.file) !== seen[run]!.get(l.file));
    console.log(
      `Runs 1 and ${run + 1} disagreed on ${moved.length} of ${set.length}${moved.length ? ": " + moved.map((l) => l.file).join(", ") : ""}.`,
    );
  }
  const dangerous = set.filter((l) => l.expect !== "approved" && seen[0]!.get(l.file) === "approved");
  if (dangerous.length) {
    console.log(`\nApproved when they should not have been (the failure that matters): ${dangerous.map((l) => l.file).join(", ")}`);
  }
  console.log(`\nAI spend: $${spend.toFixed(4)} over ${runsWanted} runs — $${(spend / runsWanted / set.length).toFixed(4)} a photo.`);
  if (!write) console.log("Dry run: none of it was recorded. Re-run with --write to put it where the daily cap can see it.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
