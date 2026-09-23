// Is the labelled photo set actually there? (Phase 3 M3.1, Alex.)
//
// **A run that found nothing must not look like a run that passed.** The first real
// attempt read an empty `labels.json`, printed "agreed with the label on 0 of 0", and
// exited clean — the same shape as a pass. A label naming a missing file was a quiet
// "skipped", and the totals still counted it, so a set that was mostly missing could
// report a confident score over the few photos that were there.
//
// So the set is checked in full before a single call is made, and any gap stops the
// run with every problem listed at once. Pure, so tests/unit/evalset.test.ts can make
// each refusal fire.

import { mediaTypeOf } from "./check.ts";
import type { Outcome } from "./ai.ts";

export interface Label {
  file: string;
  expect: Outcome;
  note?: string;
}

const OUTCOMES: Outcome[] = ["approved", "needs_review", "rejected"];

// Every problem with the set, or an empty list when it is whole.
export function problemsWithSet(labels: unknown, filesPresent: ReadonlySet<string>): string[] {
  if (!Array.isArray(labels)) return ["labels.json is not a list"];
  if (labels.length === 0) return ["labels.json lists no photos — there is nothing to score"];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of labels.entries()) {
    const l = raw as Partial<Label>;
    const name = typeof l.file === "string" && l.file ? l.file : `entry ${i + 1}`;
    if (typeof l.file !== "string" || !l.file) {
      problems.push(`${name}: has no "file"`);
      continue;
    }
    if (seen.has(l.file)) problems.push(`${name}: listed twice`);
    seen.add(l.file);
    if (!OUTCOMES.includes(l.expect as Outcome)) problems.push(`${name}: "${String(l.expect)}" is not an outcome`);
    if (!filesPresent.has(l.file)) problems.push(`${name}: listed in labels.json but not in tests/photos`);
    else if (!mediaTypeOf(l.file, undefined)) problems.push(`${name}: not an image the API reads (JPEG, PNG, WebP or GIF)`);
  }
  return problems;
}

// A run in which any photo came back without a verdict has not scored the set: its
// totals would be over fewer photos than they claim.
export function runIsComplete(set: Label[], outcomes: ReadonlyMap<string, string>): string[] {
  return set
    .filter((l) => !outcomes.has(l.file) || outcomes.get(l.file) === "failed")
    .map((l) => `${l.file}: the check gave no verdict`);
}
